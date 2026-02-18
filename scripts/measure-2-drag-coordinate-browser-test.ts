import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type DumpNoteHead = {
  keyIndex: number
  pitch: string | null
  x: number
  y: number
}

type DumpAccidentalCoord = {
  keyIndex: number
  rightX: number
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  pitch: string | null
  duration: string | null
  onsetTicksInMeasure?: number | null
  x: number
  rightX: number
  spacingRightX: number
  noteHeads: DumpNoteHead[]
  accidentalCoords: DumpAccidentalCoord[]
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  measureX: number | null
  measureWidth: number | null
  measureStartBarX: number | null
  measureEndBarX: number | null
  noteStartX: number | null
  noteEndX: number | null
  maxVisualRightX: number | null
  maxSpacingRightX: number | null
  overflowVsNoteEndX: number | null
  overflowVsMeasureEndBarX: number | null
  notes: DumpNoteRow[]
}

type MeasureDump = {
  generatedAt: string
  totalMeasureCount: number
  renderedMeasureCount: number
  visibleSystemRange: { start: number; end: number }
  rows: MeasureDumpRow[]
}

type PagingInfo = {
  currentPage: number
  pageCount: number
}

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
}

type DumpCollection = {
  pageCount: number
  totalMeasureCount: number
  renderedMeasureCount: number
  rows: MeasureDumpRow[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_TARGET_PAIR_INDEX = 1
const DEFAULT_DRAG_DELTA_CLIENT_Y = -42
const EPSILON = 0.001
const DEFAULT_MANUAL_SCALE_PERCENT = 100

type DragTargetParams = {
  pairIndex: number
  targetStaff: 'treble' | 'bass' | 'any'
  targetOrder: number
  targetPitch: string | null
  targetOnsetTicksInMeasure: number | null
  dragDeltaClientY: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' })
      if (response.ok) return
    } catch {
      // wait and retry
    }
    await sleep(350)
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

function startDevServer(): ChildProcess {
  const command = `npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT} --strictPort`
  return spawn(command, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: true,
  })
}

function stopDevServer(server: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (server.exitCode !== null || server.killed) {
      resolve()
      return
    }
    server.once('exit', () => resolve())
    if (process.platform === 'win32' && server.pid) {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    }
    server.kill('SIGTERM')
    setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL')
    }, 2500)
  })
}

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
    return (
      !!api &&
      typeof api.importMusicXmlText === 'function' &&
      typeof api.setAutoScaleEnabled === 'function' &&
      typeof api.setManualScalePercent === 'function' &&
      typeof api.getScaleConfig === 'function'
    )
  })
}

async function setScoreScale(
  page: Page,
  params: { autoScaleEnabled: boolean; manualScalePercent: number },
): Promise<DebugScaleConfig> {
  await page.evaluate(({ enabled, percent }) => {
    const api = (window as unknown as {
      __scoreDebug: {
        setAutoScaleEnabled: (next: boolean) => void
        setManualScalePercent: (next: number) => void
      }
    }).__scoreDebug
    api.setAutoScaleEnabled(enabled)
    api.setManualScalePercent(percent)
  }, { enabled: params.autoScaleEnabled, percent: params.manualScalePercent })

  await page.waitForFunction(
    ({ enabled, percent }) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getScaleConfig: () => {
            autoScaleEnabled: boolean
            manualScalePercent: number
          }
        }
      }).__scoreDebug
      const next = api.getScaleConfig()
      return next.autoScaleEnabled === enabled && Math.abs(next.manualScalePercent - percent) < 0.001
    },
    { enabled: params.autoScaleEnabled, percent: params.manualScalePercent },
  )
  await page.waitForTimeout(120)
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getScaleConfig: () => {
          autoScaleEnabled: boolean
          manualScalePercent: number
        }
      }
    }).__scoreDebug
    return api.getScaleConfig()
  })
}

async function importMusicXmlViaDebugApi(page: Page, xmlText: string): Promise<void> {
  await page.evaluate((xml) => {
    const api = (window as unknown as { __scoreDebug: { importMusicXmlText: (text: string) => void } }).__scoreDebug
    api.importMusicXmlText(xml)
  }, xmlText)

  await page.waitForFunction(
    () => {
      const api =
        (window as unknown as { __scoreDebug?: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
      if (!api || typeof api.getImportFeedback !== 'function') return false
      const feedback = api.getImportFeedback()
      return feedback.kind !== 'idle' && feedback.kind !== 'loading'
    },
    { timeout: 120_000 },
  )

  const feedback = await page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
    return api.getImportFeedback()
  })
  if (feedback.kind !== 'success') {
    throw new Error(`MusicXML import failed: ${feedback.message}`)
  }
}

async function getPaging(page: Page): Promise<PagingInfo> {
  return page.evaluate(() => {
    const api =
      (window as unknown as {
        __scoreDebug: { getPaging: () => { currentPage: number; pageCount: number } }
      }).__scoreDebug
    return api.getPaging()
  })
}

async function goToPage(page: Page, targetPage: number): Promise<void> {
  await page.evaluate((pageIndex) => {
    const api =
      (window as unknown as { __scoreDebug: { goToPage: (page: number) => void } }).__scoreDebug
    api.goToPage(pageIndex)
  }, targetPage)
  await page.waitForFunction(
    (pageIndex) => {
      const api =
        (window as unknown as { __scoreDebug: { getPaging: () => { currentPage: number } } }).__scoreDebug
      return api.getPaging().currentPage === pageIndex
    },
    targetPage,
  )
  await page.waitForTimeout(80)
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump } }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

async function collectMergedDump(page: Page): Promise<DumpCollection> {
  const paging = await getPaging(page)
  const renderedByPair = new Map<number, MeasureDumpRow>()
  let latestDump: MeasureDump | null = null

  for (let pageIndex = 0; pageIndex < paging.pageCount; pageIndex += 1) {
    await goToPage(page, pageIndex)
    const dump = await dumpAllMeasureCoordinates(page)
    latestDump = dump
    dump.rows.forEach((row) => {
      if (row.rendered) renderedByPair.set(row.pairIndex, row)
    })
  }

  if (!latestDump) throw new Error('No layout dump produced.')

  const mergedRows = Array.from({ length: latestDump.totalMeasureCount }, (_, pairIndex) => {
    return (
      renderedByPair.get(pairIndex) ?? {
        pairIndex,
        rendered: false,
        measureX: null,
        measureWidth: null,
        measureStartBarX: null,
        measureEndBarX: null,
        noteStartX: null,
        noteEndX: null,
        maxVisualRightX: null,
        maxSpacingRightX: null,
        overflowVsNoteEndX: null,
        overflowVsMeasureEndBarX: null,
        notes: [],
      }
    )
  })

  return {
    pageCount: paging.pageCount,
    totalMeasureCount: latestDump.totalMeasureCount,
    renderedMeasureCount: mergedRows.filter((row) => row.rendered).length,
    rows: mergedRows,
  }
}

function pickTargetNote(
  targetMeasureRow: MeasureDumpRow,
  targetPairIndex: number,
  targetStaff: 'treble' | 'bass' | 'any',
  targetOrder: number,
  targetPitch: string | null,
  targetOnsetTicksInMeasure: number | null,
): { note: DumpNoteRow; head: DumpNoteHead } {
  const withHead = targetMeasureRow.notes.filter((note) => note.noteHeads.length > 0)
  if (withHead.length === 0) {
    throw new Error(`Measure pair ${targetPairIndex} has no draggable note heads.`)
  }

  const sorted = withHead
    .slice()
    .sort((left, right) => {
      if (left.staff !== right.staff) {
        if (left.staff === 'treble') return -1
        if (right.staff === 'treble') return 1
        return left.staff.localeCompare(right.staff)
      }
      if (left.noteIndex !== right.noteIndex) return left.noteIndex - right.noteIndex
      return left.x - right.x
    })
  const scoped =
    targetStaff === 'any'
      ? sorted
      : sorted.filter((note) => note.staff === targetStaff)
  if (scoped.length === 0) {
    throw new Error(`No draggable notes for staff=${targetStaff} in pair ${targetPairIndex}.`)
  }
  const byPitchAndOnset =
    targetPitch !== null || targetOnsetTicksInMeasure !== null
      ? scoped.filter((note) => {
          const pitchMatches = targetPitch === null ? true : note.pitch === targetPitch
          const onsetMatches =
            targetOnsetTicksInMeasure === null
              ? true
              : note.onsetTicksInMeasure === targetOnsetTicksInMeasure
          return pitchMatches && onsetMatches
        })
      : scoped
  if (byPitchAndOnset.length === 0) {
    throw new Error(
      `No draggable note matches pitch=${targetPitch ?? 'any'} onset=${targetOnsetTicksInMeasure ?? 'any'} in pair ${targetPairIndex}.`,
    )
  }
  const safeOrder = Math.max(0, Math.min(byPitchAndOnset.length - 1, Math.floor(targetOrder)))
  const target = byPitchAndOnset[safeOrder]
  const rootHead = target.noteHeads.find((head) => head.keyIndex === 0) ?? target.noteHeads[0]
  return { note: target, head: rootHead }
}

async function toClientPoint(page: Page, logicalX: number, logicalY: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas.score-surface') as HTMLCanvasElement | null
    if (!canvas) throw new Error('Canvas .score-surface not found.')
    const rect = canvas.getBoundingClientRect()
    const widthBase = canvas.width > 0 ? canvas.width : rect.width || 1
    const heightBase = canvas.height > 0 ? canvas.height : rect.height || 1
    const scaleX = rect.width / widthBase
    const scaleY = rect.height / heightBase
    return {
      x: rect.left + x * scaleX,
      y: rect.top + y * scaleY,
    }
  }, { x: logicalX, y: logicalY })
}

async function performDragAndCollect(params: {
  page: Page
  rows: MeasureDumpRow[]
  target: DragTargetParams
}): Promise<{
  targetNote: DumpNoteRow
  targetHead: DumpNoteHead
  startPoint: { x: number; y: number }
  endPoint: { x: number; y: number }
  dumpAfterDrag: DumpCollection
}> {
  const { page, rows, target } = params
  const measure = rows.find((row) => row.pairIndex === target.pairIndex)
  if (!measure) {
    throw new Error(`Measure pair ${target.pairIndex} not found.`)
  }
  if (!measure.rendered) {
    throw new Error(`Measure pair ${target.pairIndex} is not rendered.`)
  }

  const picked = pickTargetNote(
    measure,
    target.pairIndex,
    target.targetStaff,
    target.targetOrder,
    target.targetPitch,
    target.targetOnsetTicksInMeasure,
  )
  await goToPage(page, 0)
  await page.locator('canvas.score-surface').scrollIntoViewIfNeeded()

  const startPoint = await toClientPoint(page, picked.head.x, picked.head.y)
  const endPoint = { x: startPoint.x, y: startPoint.y + target.dragDeltaClientY }

  await page.mouse.move(startPoint.x, startPoint.y)
  await page.mouse.down()
  await page.mouse.move(endPoint.x, endPoint.y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(180)

  const dumpAfterDrag = await collectMergedDump(page)
  return {
    targetNote: picked.note,
    targetHead: picked.head,
    startPoint,
    endPoint,
    dumpAfterDrag,
  }
}

function roundOrNull(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(3))
}

function hasMeaningfulDelta(value: number | null): boolean {
  return typeof value === 'number' && Math.abs(value) > EPSILON
}

function toNullableString(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0 || normalized === 'null' || normalized === 'none' || normalized === '-') {
    return null
  }
  return raw.trim()
}

function toNullableNumber(raw: string | undefined): number | null {
  const text = toNullableString(raw)
  if (text === null) return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${raw}`)
  }
  return parsed
}

function buildDeltaSummary(beforeRows: MeasureDumpRow[], afterRows: MeasureDumpRow[], targetPairIndex: number) {
  const beforeByNoteKey = new Map<string, { pairIndex: number; note: DumpNoteRow }>()
  beforeRows.forEach((row) => {
    row.notes.forEach((note) => {
      beforeByNoteKey.set(`${row.pairIndex}|${note.staff}|${note.noteId}|${note.noteIndex}`, { pairIndex: row.pairIndex, note })
    })
  })

  const afterByNoteKey = new Map<string, { pairIndex: number; note: DumpNoteRow }>()
  afterRows.forEach((row) => {
    row.notes.forEach((note) => {
      afterByNoteKey.set(`${row.pairIndex}|${note.staff}|${note.noteId}|${note.noteIndex}`, { pairIndex: row.pairIndex, note })
    })
  })

  const changedNotes: Array<{
    pairIndex: number
    staff: 'treble' | 'bass'
    noteId: string
    noteIndex: number
    pitch: string | null
    xDelta: number | null
    rightXDelta: number | null
    spacingRightXDelta: number | null
    changedHeadCount: number
    changedAccidentalCount: number
  }> = []

  beforeByNoteKey.forEach((beforeEntry, key) => {
    const afterEntry = afterByNoteKey.get(key)
    if (!afterEntry) return
    const beforeNote = beforeEntry.note
    const afterNote = afterEntry.note

    const xDelta = roundOrNull(afterNote.x - beforeNote.x)
    const rightXDelta = roundOrNull(afterNote.rightX - beforeNote.rightX)
    const spacingRightXDelta = roundOrNull(afterNote.spacingRightX - beforeNote.spacingRightX)

    const beforeHeadsByKey = new Map<number, DumpNoteHead>()
    beforeNote.noteHeads.forEach((head) => beforeHeadsByKey.set(head.keyIndex, head))
    let changedHeadCount = 0
    afterNote.noteHeads.forEach((head) => {
      const beforeHead = beforeHeadsByKey.get(head.keyIndex)
      if (!beforeHead) return
      const dx = roundOrNull(head.x - beforeHead.x)
      const dy = roundOrNull(head.y - beforeHead.y)
      if (hasMeaningfulDelta(dx) || hasMeaningfulDelta(dy)) changedHeadCount += 1
    })

    const beforeAccByKey = new Map<number, DumpAccidentalCoord>()
    beforeNote.accidentalCoords.forEach((acc) => beforeAccByKey.set(acc.keyIndex, acc))
    let changedAccidentalCount = 0
    afterNote.accidentalCoords.forEach((acc) => {
      const beforeAcc = beforeAccByKey.get(acc.keyIndex)
      if (!beforeAcc) return
      const delta = roundOrNull(acc.rightX - beforeAcc.rightX)
      if (hasMeaningfulDelta(delta)) changedAccidentalCount += 1
    })

    if (
      hasMeaningfulDelta(xDelta) ||
      hasMeaningfulDelta(rightXDelta) ||
      hasMeaningfulDelta(spacingRightXDelta) ||
      changedHeadCount > 0 ||
      changedAccidentalCount > 0
    ) {
      changedNotes.push({
        pairIndex: beforeEntry.pairIndex,
        staff: beforeNote.staff,
        noteId: beforeNote.noteId,
        noteIndex: beforeNote.noteIndex,
        pitch: afterNote.pitch,
        xDelta,
        rightXDelta,
        spacingRightXDelta,
        changedHeadCount,
        changedAccidentalCount,
      })
    }
  })

  const changedOutsideTarget = changedNotes.filter((item) => item.pairIndex !== targetPairIndex)

  return {
    changedNoteCount: changedNotes.length,
    changedOutsideTargetMeasureCount: changedOutsideTarget.length,
    changedOutsideTargetPairIndices: [...new Set(changedOutsideTarget.map((item) => item.pairIndex))].sort((a, b) => a - b),
    changedNotes,
  }
}

async function main() {
  const xmlPath = process.argv[2] ?? 'C:\\Users\\76743\\Desktop\\1234.musicxml'
  const outputPath = process.argv[3] ?? path.resolve('debug', 'measure-2-drag-coordinate-report.browser.json')
  const dragDeltaClientYRaw = process.argv[4]
  const targetStaffRaw = process.argv[5]
  const targetOrderRaw = process.argv[6]
  const targetPairIndexRaw = process.argv[7]
  const targetPitchRaw = process.argv[8]
  const targetOnsetTicksRaw = process.argv[9]
  const secondDragDeltaClientYRaw = process.argv[10]
  const secondTargetStaffRaw = process.argv[11]
  const secondTargetOrderRaw = process.argv[12]
  const secondTargetPairIndexRaw = process.argv[13]
  const secondTargetPitchRaw = process.argv[14]
  const secondTargetOnsetTicksRaw = process.argv[15]
  const manualScalePercentRaw = process.argv[16]
  const autoScaleEnabledRaw = process.argv[17]
  const dragDeltaClientY =
    dragDeltaClientYRaw !== undefined ? Number(dragDeltaClientYRaw) : DEFAULT_DRAG_DELTA_CLIENT_Y
  if (!Number.isFinite(dragDeltaClientY)) {
    throw new Error(`Invalid drag delta: ${dragDeltaClientYRaw}`)
  }
  const targetStaff: 'treble' | 'bass' | 'any' =
    targetStaffRaw === 'treble' || targetStaffRaw === 'bass' || targetStaffRaw === 'any'
      ? targetStaffRaw
      : 'treble'
  const targetOrder = targetOrderRaw !== undefined ? Number(targetOrderRaw) : 0
  if (!Number.isFinite(targetOrder)) {
    throw new Error(`Invalid target order: ${targetOrderRaw}`)
  }
  const targetPairIndex = targetPairIndexRaw !== undefined ? Number(targetPairIndexRaw) : DEFAULT_TARGET_PAIR_INDEX
  if (!Number.isFinite(targetPairIndex) || targetPairIndex < 0) {
    throw new Error(`Invalid target pair index: ${targetPairIndexRaw}`)
  }
  const targetPitch = toNullableString(targetPitchRaw)
  const targetOnsetTicksInMeasure = toNullableNumber(targetOnsetTicksRaw)
  const hasSecondDrag = secondTargetPairIndexRaw !== undefined || secondDragDeltaClientYRaw !== undefined
  const secondTargetPairIndex =
    secondTargetPairIndexRaw !== undefined ? Number(secondTargetPairIndexRaw) : DEFAULT_TARGET_PAIR_INDEX
  if (hasSecondDrag && (!Number.isFinite(secondTargetPairIndex) || secondTargetPairIndex < 0)) {
    throw new Error(`Invalid second target pair index: ${secondTargetPairIndexRaw}`)
  }
  const secondDragDeltaClientY =
    secondDragDeltaClientYRaw !== undefined ? Number(secondDragDeltaClientYRaw) : DEFAULT_DRAG_DELTA_CLIENT_Y
  if (hasSecondDrag && !Number.isFinite(secondDragDeltaClientY)) {
    throw new Error(`Invalid second drag delta: ${secondDragDeltaClientYRaw}`)
  }
  const secondTargetStaff: 'treble' | 'bass' | 'any' =
    secondTargetStaffRaw === 'treble' || secondTargetStaffRaw === 'bass' || secondTargetStaffRaw === 'any'
      ? secondTargetStaffRaw
      : 'treble'
  const secondTargetOrder = secondTargetOrderRaw !== undefined ? Number(secondTargetOrderRaw) : 0
  if (hasSecondDrag && !Number.isFinite(secondTargetOrder)) {
    throw new Error(`Invalid second target order: ${secondTargetOrderRaw}`)
  }
  const secondTargetPitch = toNullableString(secondTargetPitchRaw)
  const secondTargetOnsetTicksInMeasure = toNullableNumber(secondTargetOnsetTicksRaw)
  const manualScalePercent =
    manualScalePercentRaw !== undefined ? Number(manualScalePercentRaw) : DEFAULT_MANUAL_SCALE_PERCENT
  if (!Number.isFinite(manualScalePercent) || manualScalePercent <= 0) {
    throw new Error(`Invalid manual scale percent: ${manualScalePercentRaw}`)
  }
  const autoScaleEnabled =
    autoScaleEnabledRaw !== undefined
      ? ['1', 'true', 'yes', 'on'].includes(autoScaleEnabledRaw.trim().toLowerCase())
      : false
  const xmlText = await readFile(xmlPath, 'utf8')

  const devServer = startDevServer()
  devServer.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('Local:') || text.includes('ready in')) {
      process.stdout.write(text)
    }
  })
  devServer.stderr?.on('data', (chunk) => {
    process.stderr.write(chunk.toString())
  })

  let browserClosed = false
  try {
    await waitForServer(DEV_URL, 45_000)
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } })

    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)
    await importMusicXmlViaDebugApi(page, xmlText)
    const effectiveScale = await setScoreScale(page, {
      autoScaleEnabled,
      manualScalePercent,
    })

    const before = await collectMergedDump(page)
    const firstTargetParams: DragTargetParams = {
      pairIndex: targetPairIndex,
      targetStaff,
      targetOrder,
      targetPitch,
      targetOnsetTicksInMeasure,
      dragDeltaClientY,
    }
    const firstDrag = await performDragAndCollect({
      page,
      rows: before.rows,
      target: firstTargetParams,
    })
    const afterFirst = firstDrag.dumpAfterDrag
    const firstDeltaSummary = buildDeltaSummary(before.rows, afterFirst.rows, targetPairIndex)

    const secondTargetParams: DragTargetParams | null = hasSecondDrag
      ? {
          pairIndex: secondTargetPairIndex,
          targetStaff: secondTargetStaff,
          targetOrder: secondTargetOrder,
          targetPitch: secondTargetPitch,
          targetOnsetTicksInMeasure: secondTargetOnsetTicksInMeasure,
          dragDeltaClientY: secondDragDeltaClientY,
        }
      : null
    const secondDrag = secondTargetParams
      ? await performDragAndCollect({
          page,
          rows: afterFirst.rows,
          target: secondTargetParams,
        })
      : null
    const finalAfter = secondDrag?.dumpAfterDrag ?? afterFirst
    const secondDeltaSummary = secondDrag ? buildDeltaSummary(afterFirst.rows, finalAfter.rows, secondTargetPairIndex) : null
    const overflowRowsAfter = finalAfter.rows.filter(
      (row) => typeof row.overflowVsMeasureEndBarX === 'number' && row.overflowVsMeasureEndBarX > 0,
    )
    const noteEndOverflowRowsAfter = finalAfter.rows.filter(
      (row) => typeof row.overflowVsNoteEndX === 'number' && row.overflowVsNoteEndX > 0,
    )

    const report = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      scale: effectiveScale,
      firstDrag: {
        targetPairIndex,
        dragDeltaClientY,
        targetPitch,
        targetOnsetTicksInMeasure,
        draggedNote: {
          staff: firstDrag.targetNote.staff,
          noteId: firstDrag.targetNote.noteId,
          noteIndex: firstDrag.targetNote.noteIndex,
          pitchBefore: firstDrag.targetNote.pitch,
          headKeyIndex: firstDrag.targetHead.keyIndex,
          headXBefore: firstDrag.targetHead.x,
          headYBefore: firstDrag.targetHead.y,
          clientStart: firstDrag.startPoint,
          clientEnd: firstDrag.endPoint,
        },
      },
      secondDrag:
        secondDrag && secondTargetParams
          ? {
              targetPairIndex: secondTargetParams.pairIndex,
              dragDeltaClientY: secondTargetParams.dragDeltaClientY,
              targetPitch: secondTargetParams.targetPitch,
              targetOnsetTicksInMeasure: secondTargetParams.targetOnsetTicksInMeasure,
              draggedNote: {
                staff: secondDrag.targetNote.staff,
                noteId: secondDrag.targetNote.noteId,
                noteIndex: secondDrag.targetNote.noteIndex,
                pitchBefore: secondDrag.targetNote.pitch,
                headKeyIndex: secondDrag.targetHead.keyIndex,
                headXBefore: secondDrag.targetHead.x,
                headYBefore: secondDrag.targetHead.y,
                clientStart: secondDrag.startPoint,
                clientEnd: secondDrag.endPoint,
              },
            }
          : null,
      before,
      afterFirst,
      afterSecond: secondDrag ? finalAfter : null,
      deltaSummaryFirst: firstDeltaSummary,
      deltaSummarySecond: secondDeltaSummary,
      overflowAfter: {
        noteEndOverflowMeasureCount: noteEndOverflowRowsAfter.length,
        barlineOverflowMeasureCount: overflowRowsAfter.length,
        barlineOverflowPairs: overflowRowsAfter.map((row) => ({
          pairIndex: row.pairIndex,
          overflowVsNoteEndX: row.overflowVsNoteEndX,
          overflowVsMeasureEndBarX: row.overflowVsMeasureEndBarX,
        })),
      },
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')

    console.log(`Generated: ${outputPath}`)
    console.log(
      `Scale: auto=${String(effectiveScale.autoScaleEnabled)}, manual=${effectiveScale.manualScalePercent.toFixed(2)}%`,
    )
    console.log(`First drag pair: ${targetPairIndex}, staff/order: ${targetStaff}/${Math.floor(targetOrder)}`)
    console.log(`First drag pitch/onset: ${targetPitch ?? 'any'}/${targetOnsetTicksInMeasure ?? 'any'}`)
    console.log(
      `First changed outside pair ${targetPairIndex}: ${firstDeltaSummary.changedOutsideTargetMeasureCount}`,
    )
    if (secondDrag && secondTargetParams && secondDeltaSummary) {
      console.log(
        `Second drag pair: ${secondTargetParams.pairIndex}, staff/order: ${secondTargetParams.targetStaff}/${Math.floor(secondTargetParams.targetOrder)}`,
      )
      console.log(
        `Second drag pitch/onset: ${secondTargetParams.targetPitch ?? 'any'}/${secondTargetParams.targetOnsetTicksInMeasure ?? 'any'}`,
      )
      console.log(
        `Second changed outside pair ${secondTargetParams.pairIndex}: ${secondDeltaSummary.changedOutsideTargetMeasureCount}`,
      )
    }
    console.log(`Barline overflow measures (after drag): ${overflowRowsAfter.length}`)

    await browser.close()
    browserClosed = true
  } finally {
    await stopDevServer(devServer)
    if (!browserClosed) {
      // no-op: browser might not have been created
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
