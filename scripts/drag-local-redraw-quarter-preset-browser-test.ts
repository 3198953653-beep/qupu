import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
  scoreScale: number
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
  x: number
  rightX: number
  spacingRightX: number
  noteHeads: DumpNoteHead[]
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  notes: DumpNoteRow[]
}

type MeasureDump = {
  generatedAt: string
  totalMeasureCount: number
  renderedMeasureCount: number
  rows: MeasureDumpRow[]
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
}

type DragDebugSnapshot = {
  frame: number
  pairIndex: number
  draggedNoteId: string
  draggedStaff: 'treble' | 'bass'
  rows: DragDebugRow[]
}

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
      typeof api.setAutoScaleEnabled === 'function' &&
      typeof api.setManualScalePercent === 'function' &&
      typeof api.getScaleConfig === 'function' &&
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.getDragPreviewFrames === 'function' &&
      typeof api.getOverlayDebugInfo === 'function'
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
          scoreScale: number
        }
      }
    }).__scoreDebug
    return api.getScaleConfig()
  })
}

async function clickQuarterPulsePreset(page: Page): Promise<void> {
  const quarterBtn = page.locator('button.rhythm-btn', { hasText: 'Quarter Pulse' })
  if ((await quarterBtn.count()) > 0) {
    await quarterBtn.first().click()
  } else {
    await page.locator('button.rhythm-btn').first().click()
  }
  await page.waitForTimeout(180)
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump } }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

async function getDragDebugFrames(page: Page): Promise<DragDebugSnapshot[]> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getDragPreviewFrames: () => DragDebugSnapshot[] } }).__scoreDebug
    return api.getDragPreviewFrames()
  })
}

async function getOverlayDebugInfo(page: Page): Promise<OverlayDebugInfo> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getOverlayDebugInfo: () => OverlayDebugInfo } }).__scoreDebug
    return api.getOverlayDebugInfo()
  })
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

function roundOrNull(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(3))
}

function hasDelta(value: number | null): boolean {
  return typeof value === 'number' && Math.abs(value) > EPSILON
}

function computeOverlayScreenDrift(params: {
  frameRows: Array<{
    staff: 'treble' | 'bass'
    noteId: string
    keyIndex: number
    pitch: string
    headXPreview: number | null
    headYPreview: number | null
  }>
  overlayInfo: OverlayDebugInfo
}): {
  maxAbsScreenDriftX: number | null
  maxAbsScreenDriftY: number | null
  rowDrifts: Array<{
    staff: 'treble' | 'bass'
    noteId: string
    keyIndex: number
    pitch: string
    screenDriftX: number | null
    screenDriftY: number | null
  }>
} {
  const { frameRows, overlayInfo } = params
  if (!overlayInfo || !overlayInfo.overlayRectInScore) {
    return {
      maxAbsScreenDriftX: null,
      maxAbsScreenDriftY: null,
      rowDrifts: frameRows.map((row) => ({
        staff: row.staff,
        noteId: row.noteId,
        keyIndex: row.keyIndex,
        pitch: row.pitch,
        screenDriftX: null,
        screenDriftY: null,
      })),
    }
  }

  const rect = overlayInfo.overlayRectInScore
  const mainScaleX =
    overlayInfo.surfaceElement.width > 0
      ? overlayInfo.surfaceClientRect.width / overlayInfo.surfaceElement.width
      : 0
  const mainScaleY =
    overlayInfo.surfaceElement.height > 0
      ? overlayInfo.surfaceClientRect.height / overlayInfo.surfaceElement.height
      : 0
  const overlayScaleX =
    overlayInfo.overlayElement.width > 0
      ? overlayInfo.overlayClientRect.width / overlayInfo.overlayElement.width
      : 0
  const overlayScaleY =
    overlayInfo.overlayElement.height > 0
      ? overlayInfo.overlayClientRect.height / overlayInfo.overlayElement.height
      : 0

  const drifts = frameRows.map((row) => {
    const mainX =
      typeof row.headXPreview === 'number' ? overlayInfo.surfaceClientRect.left + row.headXPreview * mainScaleX : null
    const mainY =
      typeof row.headYPreview === 'number' ? overlayInfo.surfaceClientRect.top + row.headYPreview * mainScaleY : null
    const overlayX =
      typeof row.headXPreview === 'number'
        ? overlayInfo.overlayClientRect.left + (row.headXPreview - rect.x) * overlayScaleX
        : null
    const overlayY =
      typeof row.headYPreview === 'number'
        ? overlayInfo.overlayClientRect.top + (row.headYPreview - rect.y) * overlayScaleY
        : null
    const driftX =
      typeof mainX === 'number' && typeof overlayX === 'number' ? overlayX - mainX : null
    const driftY =
      typeof mainY === 'number' && typeof overlayY === 'number' ? overlayY - mainY : null
    return {
      staff: row.staff,
      noteId: row.noteId,
      keyIndex: row.keyIndex,
      pitch: row.pitch,
      screenDriftX: roundOrNull(driftX),
      screenDriftY: roundOrNull(driftY),
    }
  })

  const maxX = drifts.reduce((max, row) => {
    if (typeof row.screenDriftX !== 'number') return max
    return Math.max(max, Math.abs(row.screenDriftX))
  }, 0)
  const maxY = drifts.reduce((max, row) => {
    if (typeof row.screenDriftY !== 'number') return max
    return Math.max(max, Math.abs(row.screenDriftY))
  }, 0)

  return {
    maxAbsScreenDriftX: roundOrNull(maxX),
    maxAbsScreenDriftY: roundOrNull(maxY),
    rowDrifts: drifts,
  }
}

async function main() {
  const outPath =
    process.argv[2] ?? path.resolve('debug', 'drag-local-redraw-quarter-preset-report.browser.json')
  const dragDeltaClientYRaw = process.argv[3]
  const targetOrderRaw = process.argv[4]
  const pageZoomRaw = process.argv[5]
  const dragDeltaClientY = dragDeltaClientYRaw !== undefined ? Number(dragDeltaClientYRaw) : -42
  if (!Number.isFinite(dragDeltaClientY)) {
    throw new Error(`Invalid drag delta: ${dragDeltaClientYRaw}`)
  }
  const targetOrder = targetOrderRaw !== undefined ? Number(targetOrderRaw) : 1
  if (!Number.isFinite(targetOrder)) {
    throw new Error(`Invalid target order: ${targetOrderRaw}`)
  }
  const pageZoom = pageZoomRaw !== undefined ? Number(pageZoomRaw) : 1
  if (!Number.isFinite(pageZoom) || pageZoom <= 0) {
    throw new Error(`Invalid page zoom: ${pageZoomRaw}`)
  }

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
    if (Math.abs(pageZoom - 1) > 0.0001) {
      await page.evaluate((zoom) => {
        const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
        document.documentElement.style.zoom = String(safeZoom)
      }, pageZoom)
      await page.waitForTimeout(120)
    }
    await waitForDebugApi(page)

    const effectiveScale = await setScoreScale(page, {
      autoScaleEnabled: false,
      manualScalePercent: 100,
    })
    await clickQuarterPulsePreset(page)
    const before = await dumpAllMeasureCoordinates(page)

    const pair0 = before.rows.find((row) => row.pairIndex === 0)
    if (!pair0 || !pair0.rendered) {
      throw new Error('Quarter preset pair 0 is not rendered.')
    }
    const trebleNotes = pair0.notes
      .filter((note) => note.staff === 'treble' && note.noteHeads.length > 0)
      .sort((a, b) => a.noteIndex - b.noteIndex)
    if (trebleNotes.length === 0) {
      throw new Error('Quarter preset has no draggable treble note.')
    }
    const safeOrder = Math.max(0, Math.min(trebleNotes.length - 1, Math.floor(targetOrder)))
    const targetNote = trebleNotes[safeOrder]
    const targetHead = targetNote.noteHeads.find((head) => head.keyIndex === 0) ?? targetNote.noteHeads[0]

    await page.locator('canvas.score-surface').scrollIntoViewIfNeeded()
    const start = await toClientPoint(page, targetHead.x, targetHead.y)
    const end = { x: start.x, y: start.y + dragDeltaClientY }

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.waitForTimeout(220)

    const duringHold = await dumpAllMeasureCoordinates(page)
    const frames = await getDragDebugFrames(page)
    const overlayInfo = await getOverlayDebugInfo(page)
    const lastFrame = frames.length > 0 ? frames[frames.length - 1] : null

    const rows =
      lastFrame?.rows.map((row) => ({
        frame: row.frame,
        pairIndex: row.pairIndex,
        staff: row.staff,
        noteId: row.noteId,
        noteIndex: row.noteIndex,
        keyIndex: row.keyIndex,
        pitch: row.pitch,
        noteXStatic: roundOrNull(row.noteXStatic),
        noteXPreview: roundOrNull(row.noteXPreview),
        noteXDelta: roundOrNull(row.noteXDelta),
        headXStatic: roundOrNull(row.headXStatic),
        headXPreview: roundOrNull(row.headXPreview),
        headXDelta: roundOrNull(row.headXDelta),
        headYStatic: roundOrNull(row.headYStatic),
        headYPreview: roundOrNull(row.headYPreview),
        headYDelta: roundOrNull(row.headYDelta),
        accidentalRightXStatic: roundOrNull(row.accidentalRightXStatic),
        accidentalRightXPreview: roundOrNull(row.accidentalRightXPreview),
        accidentalRightXDelta: roundOrNull(row.accidentalRightXDelta),
      })) ?? []
    const screenDrift = computeOverlayScreenDrift({
      frameRows: rows.map((row) => ({
        staff: row.staff,
        noteId: row.noteId,
        keyIndex: row.keyIndex,
        pitch: row.pitch,
        headXPreview: row.headXPreview,
        headYPreview: row.headYPreview,
      })),
      overlayInfo,
    })

    const changedRows = rows.filter(
      (row) =>
        hasDelta(row.noteXDelta) ||
        hasDelta(row.headXDelta) ||
        hasDelta(row.headYDelta) ||
        hasDelta(row.accidentalRightXDelta),
    )

    const report = {
      generatedAt: new Date().toISOString(),
      scale: effectiveScale,
      drag: {
        pairIndex: 0,
        targetOrder: safeOrder,
        noteId: targetNote.noteId,
        noteIndex: targetNote.noteIndex,
        pitchBefore: targetNote.pitch,
        pageZoom,
        logicalStart: { x: roundOrNull(targetHead.x), y: roundOrNull(targetHead.y) },
        clientStart: { x: roundOrNull(start.x), y: roundOrNull(start.y) },
        clientEnd: { x: roundOrNull(end.x), y: roundOrNull(end.y) },
        dragDeltaClientY,
      },
      before,
      duringHold,
      overlayInfo,
      overlayScreenDrift: screenDrift,
      localRedrawFrameCount: frames.length,
      lastLocalRedrawRows: rows,
      changedRowCount: changedRows.length,
      changedRows,
    }

    await mkdir(path.dirname(outPath), { recursive: true })
    await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8')

    await page.mouse.up()
    await browser.close()

    console.log(`Generated: ${outPath}`)
    console.log(
      `Scale: auto=${String(effectiveScale.autoScaleEnabled)}, manual=${effectiveScale.manualScalePercent.toFixed(2)}%`,
    )
    console.log(`Page zoom: ${pageZoom}`)
    console.log(`Local redraw frames: ${frames.length}`)
    console.log(`Rows in last local redraw frame: ${rows.length}`)
    console.log(`Rows with coordinate delta: ${changedRows.length}`)
    console.log(`Max |overlay-main screen drift X|: ${String(screenDrift.maxAbsScreenDriftX)}`)
    console.log(`Max |overlay-main screen drift Y|: ${String(screenDrift.maxAbsScreenDriftY)}`)
    rows.forEach((row) => {
      console.log(
        `${row.staff} note=${row.noteId}[${row.keyIndex}] noteX=${String(row.noteXStatic)}->${String(row.noteXPreview)} d=${String(row.noteXDelta)} headX=${String(row.headXStatic)}->${String(row.headXPreview)} d=${String(row.headXDelta)} headY=${String(row.headYStatic)}->${String(row.headYPreview)} d=${String(row.headYDelta)} acc=${String(row.accidentalRightXStatic)}->${String(row.accidentalRightXPreview)} d=${String(row.accidentalRightXDelta)}`,
      )
    })
  } finally {
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
