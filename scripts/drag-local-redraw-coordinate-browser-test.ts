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
  scoreScale: number
}

type DragDebugRow = {
  frame: number
  pairIndex: number
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: string
  noteXStatic: number | null
  noteXPreview: number | null
  noteXDelta: number | null
  headXStatic: number | null
  headXPreview: number | null
  headXDelta: number | null
  headYStatic: number | null
  headYPreview: number | null
  headYDelta: number | null
  accidentalRightXStatic: number | null
  accidentalRightXPreview: number | null
  accidentalRightXDelta: number | null
  hasAccidentalModifier: boolean
}

type DragDebugSnapshot = {
  frame: number
  pairIndex: number
  draggedNoteId: string
  draggedStaff: 'treble' | 'bass'
  rows: DragDebugRow[]
}

type DragSessionState = {
  noteId: string
  staff: 'treble' | 'bass'
  keyIndex: number
  pairIndex: number
  noteIndex: number
  pitch: string
  previewStarted: boolean
} | null

type TargetStaff = 'treble' | 'bass' | 'any'

type OverlayDebugInfo = {
  scoreScale: number
  overlayRectInScore: { x: number; y: number; width: number; height: number } | null
  overlayElement: {
    width: number
    height: number
    styleLeft: string
    styleTop: string
    styleWidth: string
    styleHeight: string
    display: string
  }
  overlayClientRect: { left: number; top: number; width: number; height: number }
  surfaceElement: { width: number; height: number }
  surfaceClientRect: { left: number; top: number; width: number; height: number }
} | null

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_TARGET_PAIR_INDEX = 1
const DEFAULT_DRAG_DELTA_CLIENT_Y = -42
const DEFAULT_MANUAL_SCALE_PERCENT = 100

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
      // retry
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
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.getDragPreviewFrames === 'function' &&
      typeof api.getDragSessionState === 'function' &&
      typeof api.getOverlayDebugInfo === 'function'
    )
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
          scoreScale: number
        }
      }
    }).__scoreDebug
    return api.getScaleConfig()
  })
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

async function collectMergedDump(page: Page): Promise<{ rows: MeasureDumpRow[]; totalMeasureCount: number }> {
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

  if (!latestDump) throw new Error('No coordinate dump produced.')

  const rows = Array.from({ length: latestDump.totalMeasureCount }, (_, pairIndex) => {
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
        notes: [],
      }
    )
  })
  return { rows, totalMeasureCount: latestDump.totalMeasureCount }
}

function pickTargetHeadByRule(params: {
  row: MeasureDumpRow
  targetStaff: TargetStaff
  targetOrder: number
  targetPitch: string | null
  targetOnsetTicksInMeasure: number | null
}): { note: DumpNoteRow; head: DumpNoteHead } {
  const { row, targetStaff, targetOrder, targetPitch, targetOnsetTicksInMeasure } = params
  const ordered = row.notes
    .filter((item) => item.noteHeads.length > 0)
    .sort((a, b) => {
      if (a.staff !== b.staff) {
        if (a.staff === 'treble') return -1
        if (b.staff === 'treble') return 1
        return a.staff.localeCompare(b.staff)
      }
      if (a.noteIndex !== b.noteIndex) return a.noteIndex - b.noteIndex
      return a.x - b.x
    })
  const scopedByStaff =
    targetStaff === 'any' ? ordered : ordered.filter((note) => note.staff === targetStaff)
  const scopedByPitchAndOnset = scopedByStaff.filter((note) => {
    const pitchMatches = targetPitch === null ? true : note.pitch === targetPitch
    const onsetMatches =
      targetOnsetTicksInMeasure === null
        ? true
        : note.onsetTicksInMeasure === targetOnsetTicksInMeasure
    return pitchMatches && onsetMatches
  })
  const scoped = scopedByPitchAndOnset.length > 0 ? scopedByPitchAndOnset : scopedByStaff
  if (scoped.length === 0) {
    throw new Error(
      `No draggable note for staff=${targetStaff} pitch=${targetPitch ?? 'any'} onset=${targetOnsetTicksInMeasure ?? 'any'} in pair ${row.pairIndex}`,
    )
  }
  const safeOrder = Math.max(0, Math.min(scoped.length - 1, Math.floor(targetOrder)))
  const note = scoped[safeOrder]
  const head = note.noteHeads.find((item) => item.keyIndex === 0) ?? note.noteHeads[0]
  return { note, head }
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

async function getDragDebugFrames(page: Page): Promise<DragDebugSnapshot[]> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getDragPreviewFrames: () => DragDebugSnapshot[] } }).__scoreDebug
    return api.getDragPreviewFrames()
  })
}

async function getDragSessionState(page: Page): Promise<DragSessionState> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getDragSessionState: () => DragSessionState } }).__scoreDebug
    return api.getDragSessionState()
  })
}

async function getOverlayDebugInfo(page: Page): Promise<OverlayDebugInfo> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getOverlayDebugInfo: () => OverlayDebugInfo } }).__scoreDebug
    return api.getOverlayDebugInfo()
  })
}

function round(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(3))
}

function computeOverlayScreenDrift(params: {
  frames: DragDebugSnapshot[]
  overlayInfo: OverlayDebugInfo
}): {
  hasOverlay: boolean
  rowCount: number
  maxAbsHeadScreenDriftX: number | null
  maxAbsHeadScreenDriftY: number | null
  topHeadScreenDriftRows: Array<{
    frame: number
    pairIndex: number
    staff: 'treble' | 'bass'
    noteId: string
    keyIndex: number
    pitch: string
    headXPreview: number | null
    headYPreview: number | null
    mainScreenX: number | null
    mainScreenY: number | null
    overlayScreenX: number | null
    overlayScreenY: number | null
    screenDriftX: number | null
    screenDriftY: number | null
  }>
} {
  const { frames, overlayInfo } = params
  if (!overlayInfo || !overlayInfo.overlayRectInScore) {
    return {
      hasOverlay: false,
      rowCount: 0,
      maxAbsHeadScreenDriftX: null,
      maxAbsHeadScreenDriftY: null,
      topHeadScreenDriftRows: [],
    }
  }

  const overlayRect = overlayInfo.overlayRectInScore
  const mainScaleX =
    overlayInfo.surfaceElement.width > 0
      ? overlayInfo.surfaceClientRect.width / overlayInfo.surfaceElement.width
      : 0
  const overlayScaleX =
    overlayInfo.overlayElement.width > 0
      ? overlayInfo.overlayClientRect.width / overlayInfo.overlayElement.width
      : 0
  const mainScaleY =
    overlayInfo.surfaceElement.height > 0
      ? overlayInfo.surfaceClientRect.height / overlayInfo.surfaceElement.height
      : 0
  const overlayScaleY =
    overlayInfo.overlayElement.height > 0
      ? overlayInfo.overlayClientRect.height / overlayInfo.overlayElement.height
      : 0

  const rows = frames.flatMap((frame) =>
    frame.rows.map((row) => {
      const headXPreview = row.headXPreview
      const headYPreview = row.headYPreview
      const mainScreenX =
        typeof headXPreview === 'number' && Number.isFinite(headXPreview)
          ? overlayInfo.surfaceClientRect.left + headXPreview * mainScaleX
          : null
      const mainScreenY =
        typeof headYPreview === 'number' && Number.isFinite(headYPreview)
          ? overlayInfo.surfaceClientRect.top + headYPreview * mainScaleY
          : null
      const overlayScreenX =
        typeof headXPreview === 'number' && Number.isFinite(headXPreview)
          ? overlayInfo.overlayClientRect.left + (headXPreview - overlayRect.x) * overlayScaleX
          : null
      const overlayScreenY =
        typeof headYPreview === 'number' && Number.isFinite(headYPreview)
          ? overlayInfo.overlayClientRect.top + (headYPreview - overlayRect.y) * overlayScaleY
          : null
      const screenDriftX =
        typeof mainScreenX === 'number' && Number.isFinite(mainScreenX) && typeof overlayScreenX === 'number' && Number.isFinite(overlayScreenX)
          ? overlayScreenX - mainScreenX
          : null
      const screenDriftY =
        typeof mainScreenY === 'number' && Number.isFinite(mainScreenY) && typeof overlayScreenY === 'number' && Number.isFinite(overlayScreenY)
          ? overlayScreenY - mainScreenY
          : null

      return {
        frame: frame.frame,
        pairIndex: row.pairIndex,
        staff: row.staff,
        noteId: row.noteId,
        keyIndex: row.keyIndex,
        pitch: row.pitch,
        headXPreview: round(headXPreview),
        headYPreview: round(headYPreview),
        mainScreenX: round(mainScreenX),
        mainScreenY: round(mainScreenY),
        overlayScreenX: round(overlayScreenX),
        overlayScreenY: round(overlayScreenY),
        screenDriftX: round(screenDriftX),
        screenDriftY: round(screenDriftY),
      }
    }),
  )

  const sortable = rows
    .filter(
      (row) =>
        (typeof row.screenDriftX === 'number' && Number.isFinite(row.screenDriftX)) ||
        (typeof row.screenDriftY === 'number' && Number.isFinite(row.screenDriftY)),
    )
    .sort((a, b) => {
      const am = Math.max(Math.abs(a.screenDriftX ?? 0), Math.abs(a.screenDriftY ?? 0))
      const bm = Math.max(Math.abs(b.screenDriftX ?? 0), Math.abs(b.screenDriftY ?? 0))
      return bm - am
    })
  const top = sortable.slice(0, 20)
  const maxAbsX = sortable.length > 0 ? Math.max(...sortable.map((row) => Math.abs(row.screenDriftX ?? 0))) : 0
  const maxAbsY = sortable.length > 0 ? Math.max(...sortable.map((row) => Math.abs(row.screenDriftY ?? 0))) : 0

  return {
    hasOverlay: true,
    rowCount: sortable.length,
    maxAbsHeadScreenDriftX: Number(maxAbsX.toFixed(3)),
    maxAbsHeadScreenDriftY: Number(maxAbsY.toFixed(3)),
    topHeadScreenDriftRows: top,
  }
}

function maxAbs(rows: DragDebugRow[], pick: (row: DragDebugRow) => number | null): number {
  let maxValue = 0
  rows.forEach((row) => {
    const value = pick(row)
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    maxValue = Math.max(maxValue, Math.abs(value))
  })
  return Number(maxValue.toFixed(3))
}

function summarizeFrames(frames: DragDebugSnapshot[]): {
  frameCount: number
  rowCount: number
  maxAbsNoteXDelta: number
  maxAbsHeadXDelta: number
  maxAbsAccidentalDelta: number
  topHeadShiftRows: Array<{
    frame: number
    pairIndex: number
    staff: 'treble' | 'bass'
    noteId: string
    keyIndex: number
    pitch: string
    headXStatic: number | null
    headXPreview: number | null
    headXDelta: number | null
  }>
} {
  const allRows = frames.flatMap((frame) => frame.rows)
  const topHeadShiftRows = allRows
    .filter((row) => typeof row.headXDelta === 'number' && Number.isFinite(row.headXDelta))
    .sort((a, b) => Math.abs(b.headXDelta ?? 0) - Math.abs(a.headXDelta ?? 0))
    .slice(0, 20)
    .map((row) => ({
      frame: row.frame,
      pairIndex: row.pairIndex,
      staff: row.staff,
      noteId: row.noteId,
      keyIndex: row.keyIndex,
      pitch: row.pitch,
      headXStatic: round(row.headXStatic),
      headXPreview: round(row.headXPreview),
      headXDelta: round(row.headXDelta),
    }))

  return {
    frameCount: frames.length,
    rowCount: allRows.length,
    maxAbsNoteXDelta: maxAbs(allRows, (row) => row.noteXDelta),
    maxAbsHeadXDelta: maxAbs(allRows, (row) => row.headXDelta),
    maxAbsAccidentalDelta: maxAbs(allRows, (row) => row.accidentalRightXDelta),
    topHeadShiftRows,
  }
}

async function main() {
  const xmlPath = process.argv[2] ?? 'C:\\Users\\76743\\Desktop\\1234.musicxml'
  const outputPath = process.argv[3] ?? path.resolve('debug', 'drag-local-redraw-coordinate-report.browser.json')
  const dragDeltaClientYRaw = process.argv[4]
  const targetPairIndexRaw = process.argv[5]
  const manualScalePercentRaw = process.argv[6]
  const autoScaleEnabledRaw = process.argv[7]
  const targetStaffRaw = process.argv[8]
  const targetOrderRaw = process.argv[9]
  const targetPitchRaw = process.argv[10]
  const targetOnsetTicksRaw = process.argv[11]

  const dragDeltaClientY =
    dragDeltaClientYRaw !== undefined ? Number(dragDeltaClientYRaw) : DEFAULT_DRAG_DELTA_CLIENT_Y
  if (!Number.isFinite(dragDeltaClientY)) {
    throw new Error(`Invalid drag delta: ${dragDeltaClientYRaw}`)
  }
  const targetPairIndex =
    targetPairIndexRaw !== undefined ? Number(targetPairIndexRaw) : DEFAULT_TARGET_PAIR_INDEX
  if (!Number.isFinite(targetPairIndex) || targetPairIndex < 0) {
    throw new Error(`Invalid target pair index: ${targetPairIndexRaw}`)
  }
  const manualScalePercent =
    manualScalePercentRaw !== undefined ? Number(manualScalePercentRaw) : DEFAULT_MANUAL_SCALE_PERCENT
  if (!Number.isFinite(manualScalePercent) || manualScalePercent <= 0) {
    throw new Error(`Invalid manual scale percent: ${manualScalePercentRaw}`)
  }
  const autoScaleEnabled =
    autoScaleEnabledRaw !== undefined
      ? ['1', 'true', 'yes', 'on'].includes(autoScaleEnabledRaw.trim().toLowerCase())
      : false
  const targetStaff: TargetStaff =
    targetStaffRaw === 'treble' || targetStaffRaw === 'bass' || targetStaffRaw === 'any'
      ? targetStaffRaw
      : 'treble'
  const targetOrder = targetOrderRaw !== undefined ? Number(targetOrderRaw) : 0
  if (!Number.isFinite(targetOrder)) {
    throw new Error(`Invalid target order: ${targetOrderRaw}`)
  }
  const targetPitch =
    targetPitchRaw !== undefined && targetPitchRaw.trim().length > 0 && targetPitchRaw.trim().toLowerCase() !== 'any'
      ? targetPitchRaw.trim()
      : null
  const targetOnsetTicksInMeasure =
    targetOnsetTicksRaw !== undefined && targetOnsetTicksRaw.trim().length > 0 && targetOnsetTicksRaw.trim().toLowerCase() !== 'any'
      ? Number(targetOnsetTicksRaw)
      : null
  if (
    targetOnsetTicksInMeasure !== null &&
    (!Number.isFinite(targetOnsetTicksInMeasure) || targetOnsetTicksInMeasure < 0)
  ) {
    throw new Error(`Invalid target onset ticks: ${targetOnsetTicksRaw}`)
  }

  const xmlText = await readFile(xmlPath, 'utf8')

  const devServer = startDevServer()
  devServer.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('Local:') || text.includes('ready in')) {
      process.stdout.write(text)
    }
  })
  devServer.stderr?.on('data', (chunk) => process.stderr.write(chunk.toString()))

  try {
    await waitForServer(DEV_URL, 45_000)
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)
    await importMusicXmlViaDebugApi(page, xmlText)
    const effectiveScale = await setScoreScale(page, { autoScaleEnabled, manualScalePercent })
    const before = await collectMergedDump(page)

    const targetMeasure = before.rows.find((row) => row.pairIndex === targetPairIndex)
    if (!targetMeasure || !targetMeasure.rendered) {
      throw new Error(`Target measure pair ${targetPairIndex} is not rendered.`)
    }
    const target = pickTargetHeadByRule({
      row: targetMeasure,
      targetStaff,
      targetOrder,
      targetPitch,
      targetOnsetTicksInMeasure,
    })
    await goToPage(page, 0)
    await page.locator('canvas.score-surface').scrollIntoViewIfNeeded()
    const start = await toClientPoint(page, target.head.x, target.head.y)
    const end = { x: start.x, y: start.y + dragDeltaClientY }

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.waitForTimeout(220)

    const dragSession = await getDragSessionState(page)
    const frames = await getDragDebugFrames(page)
    const overlayInfo = await getOverlayDebugInfo(page)
    const duringHold = await collectMergedDump(page)
    const summary = summarizeFrames(frames)
    const overlayDrift = computeOverlayScreenDrift({ frames, overlayInfo })

    const report = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      scale: effectiveScale,
      drag: {
        targetPairIndex,
        targetStaff,
        targetOrder: Math.floor(targetOrder),
        targetPitch,
        targetOnsetTicksInMeasure,
        dragDeltaClientY,
        noteId: target.note.noteId,
        noteIndex: target.note.noteIndex,
        pitchBefore: target.note.pitch,
        headKeyIndex: target.head.keyIndex,
        logicalStart: { x: round(target.head.x), y: round(target.head.y) },
        clientStart: { x: round(start.x), y: round(start.y) },
        clientEnd: { x: round(end.x), y: round(end.y) },
      },
      dragSession,
      overlayInfo,
      before,
      duringHold,
      localRedrawFrames: frames,
      localRedrawSummary: summary,
      overlayScreenDrift: overlayDrift,
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')

    await page.mouse.up()
    await browser.close()

    console.log(`Generated: ${outputPath}`)
    console.log(
      `Scale: auto=${String(effectiveScale.autoScaleEnabled)}, manual=${effectiveScale.manualScalePercent.toFixed(2)}%`,
    )
    console.log(`Drag target pair=${targetPairIndex} note=${target.note.noteId} pitch=${target.note.pitch ?? 'unknown'}`)
    console.log(`Frames captured (hold): ${summary.frameCount}`)
    console.log(`Max |noteXDelta|: ${summary.maxAbsNoteXDelta}`)
    console.log(`Max |headXDelta|: ${summary.maxAbsHeadXDelta}`)
    console.log(`Max |accidentalDelta|: ${summary.maxAbsAccidentalDelta}`)
    console.log(`Max |overlay-main screen drift X|: ${overlayDrift.maxAbsHeadScreenDriftX ?? 'n/a'}`)
    console.log(`Max |overlay-main screen drift Y|: ${overlayDrift.maxAbsHeadScreenDriftY ?? 'n/a'}`)
  } finally {
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
