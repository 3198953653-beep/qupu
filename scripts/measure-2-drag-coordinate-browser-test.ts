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

type DumpCollection = {
  pageCount: number
  totalMeasureCount: number
  renderedMeasureCount: number
  rows: MeasureDumpRow[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const TARGET_PAIR_INDEX = 1
const DEFAULT_DRAG_DELTA_CLIENT_Y = -42
const EPSILON = 0.001

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
    return !!api && typeof api.importMusicXmlText === 'function'
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
  secondMeasureRow: MeasureDumpRow,
  targetStaff: 'treble' | 'bass' | 'any',
  targetOrder: number,
): { note: DumpNoteRow; head: DumpNoteHead } {
  const withHead = secondMeasureRow.notes.filter((note) => note.noteHeads.length > 0)
  if (withHead.length === 0) {
    throw new Error(`Measure pair ${TARGET_PAIR_INDEX} has no draggable note heads.`)
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
    throw new Error(`No draggable notes for staff=${targetStaff} in pair ${TARGET_PAIR_INDEX}.`)
  }
  const safeOrder = Math.max(0, Math.min(scoped.length - 1, Math.floor(targetOrder)))
  const target = scoped[safeOrder]
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

function roundOrNull(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(3))
}

function hasMeaningfulDelta(value: number | null): boolean {
  return typeof value === 'number' && Math.abs(value) > EPSILON
}

function buildDeltaSummary(beforeRows: MeasureDumpRow[], afterRows: MeasureDumpRow[]) {
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

  const changedOutsideTarget = changedNotes.filter((item) => item.pairIndex !== TARGET_PAIR_INDEX)

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

    const before = await collectMergedDump(page)
    const secondMeasure = before.rows.find((row) => row.pairIndex === TARGET_PAIR_INDEX)
    if (!secondMeasure) {
      throw new Error(`Measure pair ${TARGET_PAIR_INDEX} not found.`)
    }
    if (!secondMeasure.rendered) {
      throw new Error(`Measure pair ${TARGET_PAIR_INDEX} is not rendered.`)
    }

    const target = pickTargetNote(secondMeasure, targetStaff, targetOrder)
    await goToPage(page, 0)
    await page.locator('canvas.score-surface').scrollIntoViewIfNeeded()

    const startPoint = await toClientPoint(page, target.head.x, target.head.y)
    const endPoint = { x: startPoint.x, y: startPoint.y + dragDeltaClientY }

    await page.mouse.move(startPoint.x, startPoint.y)
    await page.mouse.down()
    await page.mouse.move(endPoint.x, endPoint.y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(180)

    const after = await collectMergedDump(page)
    const deltaSummary = buildDeltaSummary(before.rows, after.rows)
    const overflowRowsAfter = after.rows.filter(
      (row) => typeof row.overflowVsMeasureEndBarX === 'number' && row.overflowVsMeasureEndBarX > 0,
    )
    const noteEndOverflowRowsAfter = after.rows.filter(
      (row) => typeof row.overflowVsNoteEndX === 'number' && row.overflowVsNoteEndX > 0,
    )

    const report = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      targetPairIndex: TARGET_PAIR_INDEX,
      dragDeltaClientY,
      draggedNote: {
        staff: target.note.staff,
        noteId: target.note.noteId,
        noteIndex: target.note.noteIndex,
        pitchBefore: target.note.pitch,
        headKeyIndex: target.head.keyIndex,
        headXBefore: target.head.x,
        headYBefore: target.head.y,
        clientStart: startPoint,
        clientEnd: endPoint,
      },
      before,
      after,
      deltaSummary,
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
    console.log(`Target measure pair: ${TARGET_PAIR_INDEX}`)
    console.log(`Target staff/order: ${targetStaff}/${Math.floor(targetOrder)}`)
    console.log(`Dragged note: ${target.note.staff}:${target.note.noteId} idx=${target.note.noteIndex}`)
    console.log(`Changed notes: ${deltaSummary.changedNoteCount}`)
    console.log(`Changed outside pair ${TARGET_PAIR_INDEX}: ${deltaSummary.changedOutsideTargetMeasureCount}`)
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
