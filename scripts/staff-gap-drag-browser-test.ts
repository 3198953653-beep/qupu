import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  measureX?: number | null
  noteStartX?: number | null
  trebleY?: number | null
  bassY?: number | null
  trebleLineTopY?: number | null
  trebleLineBottomY?: number | null
  bassLineTopY?: number | null
  bassLineBottomY?: number | null
}

type MeasureDump = {
  rows: MeasureDumpRow[]
}

type DebugHighlightRect = {
  x: number
  y: number
  width: number
  height: number
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4181
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const STAFF_LINE_SPAN_PX = 40
const DEFAULT_STAFF_INTER_GAP_PX = 46
const VALUE_TOLERANCE_PX = 2

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startDevServer(): ChildProcess {
  const command = `npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT} --strictPort`
  return spawn(command, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: true,
  })
}

async function stopDevServer(server: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (server.exitCode !== null || server.killed) {
      resolve()
      return
    }
    server.stdout?.destroy()
    server.stderr?.destroy()
    server.once('exit', () => resolve())
    if (process.platform === 'win32' && server.pid) {
      const killer = spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.unref()
      server.unref()
      setTimeout(() => resolve(), 1000)
      return
    }
    server.kill('SIGTERM')
    setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL')
    }, 2500)
  })
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
    await sleep(300)
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
    return (
      !!api &&
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.getScaleConfig === 'function' &&
      typeof api.setAutoScaleEnabled === 'function' &&
      typeof api.setManualScalePercent === 'function' &&
      typeof api.getSelectedMeasureHighlightRect === 'function'
    )
  })
}

async function setScoreScale(page: Page, autoScaleEnabled: boolean, manualScalePercent: number): Promise<DebugScaleConfig> {
  await page.evaluate(({ enabled, percent }) => {
    const api = (window as unknown as {
      __scoreDebug: {
        setAutoScaleEnabled: (next: boolean) => void
        setManualScalePercent: (next: number) => void
      }
    }).__scoreDebug
    api.setAutoScaleEnabled(enabled)
    api.setManualScalePercent(percent)
  }, { enabled: autoScaleEnabled, percent: manualScalePercent })

  await page.waitForFunction(
    ({ enabled, percent }) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getScaleConfig: () => { autoScaleEnabled: boolean; manualScalePercent: number }
        }
      }).__scoreDebug
      const next = api.getScaleConfig()
      return next.autoScaleEnabled === enabled && Math.abs(next.manualScalePercent - percent) < 0.001
    },
    { enabled: autoScaleEnabled, percent: manualScalePercent },
  )

  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { getScaleConfig: () => DebugScaleConfig }
    }).__scoreDebug
    return api.getScaleConfig()
  })
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
    }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

async function waitForFirstRenderedMeasure(page: Page): Promise<MeasureDumpRow> {
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
    }).__scoreDebug
    const firstRow = api.dumpAllMeasureCoordinates().rows[0]
    return Boolean(
      firstRow &&
      firstRow.rendered &&
      typeof firstRow.measureX === 'number' &&
      typeof firstRow.noteStartX === 'number' &&
      typeof firstRow.trebleY === 'number' &&
      typeof firstRow.bassY === 'number',
    )
  })
  const dump = await dumpAllMeasureCoordinates(page)
  const firstRow = dump.rows[0]
  if (!firstRow) {
    throw new Error('Missing first rendered measure row.')
  }
  return firstRow
}

async function getSelectedMeasureHighlightRect(page: Page): Promise<DebugHighlightRect | null> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { getSelectedMeasureHighlightRect: () => DebugHighlightRect | null }
    }).__scoreDebug
    return api.getSelectedMeasureHighlightRect()
  })
}

async function waitForSelectedMeasureHighlight(page: Page): Promise<DebugHighlightRect> {
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: { getSelectedMeasureHighlightRect: () => DebugHighlightRect | null }
    }).__scoreDebug
    return api.getSelectedMeasureHighlightRect() !== null
  })
  const rect = await getSelectedMeasureHighlightRect(page)
  if (!rect) {
    throw new Error('Expected selected measure highlight rect.')
  }
  return rect
}

async function clickButton(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label }).first()
  await button.waitFor()
  await button.evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
}

async function openSpacingPanel(page: Page): Promise<void> {
  await clickButton(page, '间距大小')
  await page.locator('#staff-inter-gap-input').waitFor()
}

async function getStaffInterGapInputValue(page: Page): Promise<number> {
  const rawValue = await page.locator('#staff-inter-gap-input').inputValue()
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Unexpected staff-inter-gap input value: ${rawValue}`)
  }
  return parsed
}

async function waitForStaffInterGapInputValue(page: Page, expectedValue: number): Promise<void> {
  await page.waitForFunction((targetValue) => {
    const input = document.getElementById('staff-inter-gap-input') as HTMLInputElement | null
    if (!input) return false
    return Number(input.value) === targetValue
  }, expectedValue)
}

async function setStaffInterGapInputValue(page: Page, nextValue: number): Promise<void> {
  await page.locator('#staff-inter-gap-input').fill(String(nextValue))
  await waitForStaffInterGapInputValue(page, nextValue)
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

function getBlankStaffLogicalPoint(
  row: MeasureDumpRow,
  staff: 'treble' | 'bass',
): { x: number; y: number } {
  const measureX = row.measureX
  const noteStartX = row.noteStartX
  const staffLineTopY = staff === 'treble' ? row.trebleLineTopY : row.bassLineTopY
  const staffLineBottomY = staff === 'treble' ? row.trebleLineBottomY : row.bassLineBottomY
  if (
    typeof measureX !== 'number' ||
    !Number.isFinite(measureX) ||
    typeof noteStartX !== 'number' ||
    !Number.isFinite(noteStartX) ||
    typeof staffLineTopY !== 'number' ||
    !Number.isFinite(staffLineTopY) ||
    typeof staffLineBottomY !== 'number' ||
    !Number.isFinite(staffLineBottomY)
  ) {
    throw new Error(`Missing blank-staff logical point metrics for ${staff}.`)
  }

  const blankWidth = Math.max(8, noteStartX - measureX)
  const lineTopY = Math.min(staffLineTopY, staffLineBottomY)
  const lineBottomY = Math.max(staffLineTopY, staffLineBottomY)
  return {
    x: measureX + Math.min(24, blankWidth * 0.5),
    y: (lineTopY + lineBottomY) / 2,
  }
}

function extractStaffInterGapFromRow(row: MeasureDumpRow): number {
  if (
    typeof row.trebleY !== 'number' ||
    !Number.isFinite(row.trebleY) ||
    typeof row.bassY !== 'number' ||
    !Number.isFinite(row.bassY)
  ) {
    throw new Error('Missing trebleY/bassY for staff gap extraction.')
  }
  return row.bassY - row.trebleY - STAFF_LINE_SPAN_PX
}

function assertCloseTo(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > VALUE_TOLERANCE_PX) {
    throw new Error(`${label} mismatch. expected=${expected} actual=${actual}`)
  }
}

async function clickBlankStaff(page: Page, staff: 'treble' | 'bass'): Promise<void> {
  const row = await waitForFirstRenderedMeasure(page)
  const point = getBlankStaffLogicalPoint(row, staff)
  const clientPoint = await toClientPoint(page, point.x, point.y)
  await page.mouse.move(clientPoint.x, clientPoint.y)
  await page.mouse.down()
  await page.mouse.up()
}

async function dragBlankStaff(params: {
  page: Page
  staff: 'treble' | 'bass'
  deltaY: number
}): Promise<void> {
  const { page, staff, deltaY } = params
  const row = await waitForFirstRenderedMeasure(page)
  const point = getBlankStaffLogicalPoint(row, staff)
  const clientPoint = await toClientPoint(page, point.x, point.y)
  await page.mouse.move(clientPoint.x, clientPoint.y)
  await page.mouse.down()
  await waitForSelectedMeasureHighlight(page)
  await page.mouse.move(clientPoint.x, clientPoint.y + deltaY, { steps: 10 })
  await page.mouse.up()
}

async function readCurrentGeometryGap(page: Page): Promise<number> {
  const row = await waitForFirstRenderedMeasure(page)
  return extractStaffInterGapFromRow(row)
}

async function clickSpacingResetButton(page: Page): Promise<void> {
  await page.locator('.spacing-panel .spacing-reset-btn').click()
}

async function main(): Promise<void> {
  const devServer = startDevServer()
  let browser: Browser | null = null

  try {
    await waitForServer(DEV_URL, 30_000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1720, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'networkidle' })
    await waitForDebugApi(page)
    await setScoreScale(page, false, 100)
    await openSpacingPanel(page)
    await waitForFirstRenderedMeasure(page)

    const initialInputGap = await getStaffInterGapInputValue(page)
    const initialGeometryGap = await readCurrentGeometryGap(page)
    assertCloseTo(initialInputGap, DEFAULT_STAFF_INTER_GAP_PX, 'initial staff gap input')
    assertCloseTo(initialGeometryGap, DEFAULT_STAFF_INTER_GAP_PX, 'initial geometry staff gap')

    await clickBlankStaff(page, 'treble')
    await waitForSelectedMeasureHighlight(page)
    const clickOnlyGap = await getStaffInterGapInputValue(page)
    assertCloseTo(clickOnlyGap, initialInputGap, 'click-only staff gap input')

    await dragBlankStaff({ page, staff: 'treble', deltaY: 18 })
    const afterTrebleDragGap = await getStaffInterGapInputValue(page)
    const afterTrebleDragGeometryGap = await readCurrentGeometryGap(page)
    assertCloseTo(afterTrebleDragGap, initialInputGap + 18, 'treble blank-drag staff gap input')
    assertCloseTo(afterTrebleDragGeometryGap, afterTrebleDragGap, 'treble blank-drag geometry gap')

    await dragBlankStaff({ page, staff: 'bass', deltaY: -12 })
    const afterBassDragGap = await getStaffInterGapInputValue(page)
    const afterBassDragGeometryGap = await readCurrentGeometryGap(page)
    assertCloseTo(afterBassDragGap, afterTrebleDragGap - 12, 'bass blank-drag staff gap input')
    assertCloseTo(afterBassDragGeometryGap, afterBassDragGap, 'bass blank-drag geometry gap')

    await setStaffInterGapInputValue(page, 70)
    const afterManualInputGeometryGap = await readCurrentGeometryGap(page)
    assertCloseTo(afterManualInputGeometryGap, 70, 'manual-input geometry gap')

    await dragBlankStaff({ page, staff: 'treble', deltaY: 8 })
    const afterManualThenDragGap = await getStaffInterGapInputValue(page)
    const afterManualThenDragGeometryGap = await readCurrentGeometryGap(page)
    assertCloseTo(afterManualThenDragGap, 78, 'manual-then-drag staff gap input')
    assertCloseTo(afterManualThenDragGeometryGap, 78, 'manual-then-drag geometry gap')

    await clickSpacingResetButton(page)
    await waitForStaffInterGapInputValue(page, DEFAULT_STAFF_INTER_GAP_PX)
    const afterResetGeometryGap = await readCurrentGeometryGap(page)
    assertCloseTo(afterResetGeometryGap, DEFAULT_STAFF_INTER_GAP_PX, 'reset geometry gap')

    await dragBlankStaff({ page, staff: 'treble', deltaY: 6 })
    const afterResetThenDragGap = await getStaffInterGapInputValue(page)
    const afterResetThenDragGeometryGap = await readCurrentGeometryGap(page)
    assertCloseTo(afterResetThenDragGap, DEFAULT_STAFF_INTER_GAP_PX + 6, 'reset-then-drag staff gap input')
    assertCloseTo(afterResetThenDragGeometryGap, afterResetThenDragGap, 'reset-then-drag geometry gap')

    console.table([
      { step: 'initial', inputGap: initialInputGap, geometryGap: initialGeometryGap },
      { step: 'after-treble-drag', inputGap: afterTrebleDragGap, geometryGap: afterTrebleDragGeometryGap },
      { step: 'after-bass-drag', inputGap: afterBassDragGap, geometryGap: afterBassDragGeometryGap },
      { step: 'after-manual-then-drag', inputGap: afterManualThenDragGap, geometryGap: afterManualThenDragGeometryGap },
      { step: 'after-reset-then-drag', inputGap: afterResetThenDragGap, geometryGap: afterResetThenDragGeometryGap },
    ])
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
