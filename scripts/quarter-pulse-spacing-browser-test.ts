import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
  scoreScale?: number
}

type DumpSpacingOnsetReserve = {
  onsetTicks: number
  baseX: number | null
  finalX: number | null
  leftReservePx: number | null
  rightReservePx: number | null
}

type DumpSpacingSegment = {
  fromOnsetTicks: number
  toOnsetTicks: number
  baseGapPx: number | null
  extraReservePx: number | null
  appliedGapPx: number | null
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  onsetTicksInMeasure: number | null
  x: number
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  measureWidth?: number | null
  spacingAnchorGapFirstToLastPx?: number | null
  spacingOnsetReserves?: DumpSpacingOnsetReserve[]
  spacingSegments?: DumpSpacingSegment[]
  notes: DumpNoteRow[]
}

type MeasureDump = {
  totalMeasureCount: number
  renderedMeasureCount: number
  rows: MeasureDumpRow[]
}

type RowReport = {
  pairIndex: number
  rendered: boolean
  measureWidth: number | null
  spacingAnchorGapFirstToLastPx: number | null
  bassSegmentGapsPx: number[]
  reserveEntries: Array<{
    onsetTicks: number
    leftReservePx: number | null
    rightReservePx: number | null
  }>
  spacingSegments: Array<{
    fromOnsetTicks: number
    toOnsetTicks: number
    baseGapPx: number | null
    extraReservePx: number | null
    appliedGapPx: number | null
  }>
  passed: boolean
  failureReasons: string[]
}

type FinalReport = {
  generatedAt: string
  scale: DebugScaleConfig
  rows: RowReport[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4178
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const TARGET_ROW_COUNT = 6
const EXPECTED_MEASURE_WIDTH_PX = 120
const EXPECTED_ANCHOR_SPAN_PX = 82.725
const EXPECTED_SEGMENT_GAP_PX = 27.575
const EPSILON_PX = 0.15

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

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
      return (
        !!api &&
        typeof api.dumpAllMeasureCoordinates === 'function' &&
        typeof api.getScaleConfig === 'function' &&
        typeof api.setAutoScaleEnabled === 'function' &&
        typeof api.setManualScalePercent === 'function'
      )
    },
    undefined,
    { timeout: 120000 },
  )
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
    { timeout: 120000 },
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

function roundFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null
}

function approximatelyEqual(left: number | null, right: number | null, epsilon = EPSILON_PX): boolean {
  if (left === null || right === null) return false
  return Math.abs(left - right) <= epsilon
}

function buildRowReport(row: MeasureDumpRow, pairIndex: number): RowReport {
  const failureReasons: string[] = []
  const measureWidth = roundFinite(row.measureWidth)
  const spacingAnchorGapFirstToLastPx = roundFinite(row.spacingAnchorGapFirstToLastPx)
  const bassNotes = row.notes
    .filter((note) => note.staff === 'bass')
    .slice()
    .sort((left, right) => {
      const leftOnset = left.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
      const rightOnset = right.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
      if (leftOnset !== rightOnset) return leftOnset - rightOnset
      return left.x - right.x
    })
  const bassSegmentGapsPx = bassNotes.slice(1).map((note, index) =>
    Number((note.x - bassNotes[index].x).toFixed(3)),
  )
  const reserveEntries = (row.spacingOnsetReserves ?? []).map((entry) => ({
    onsetTicks: Math.round(entry.onsetTicks),
    leftReservePx: roundFinite(entry.leftReservePx),
    rightReservePx: roundFinite(entry.rightReservePx),
  }))
  const spacingSegments = (row.spacingSegments ?? []).map((entry) => ({
    fromOnsetTicks: Math.round(entry.fromOnsetTicks),
    toOnsetTicks: Math.round(entry.toOnsetTicks),
    baseGapPx: roundFinite(entry.baseGapPx),
    extraReservePx: roundFinite(entry.extraReservePx),
    appliedGapPx: roundFinite(entry.appliedGapPx),
  }))

  if (!row.rendered) {
    failureReasons.push('measure-not-rendered')
  }
  if (!approximatelyEqual(measureWidth, EXPECTED_MEASURE_WIDTH_PX)) {
    failureReasons.push(`measure-width:${measureWidth ?? 'null'}`)
  }
  if (!approximatelyEqual(spacingAnchorGapFirstToLastPx, EXPECTED_ANCHOR_SPAN_PX)) {
    failureReasons.push(`anchor-span:${spacingAnchorGapFirstToLastPx ?? 'null'}`)
  }
  if (bassNotes.length !== 4) {
    failureReasons.push(`unexpected-bass-note-count:${bassNotes.length}`)
  }
  bassSegmentGapsPx.forEach((gapPx, index) => {
    if (!approximatelyEqual(gapPx, EXPECTED_SEGMENT_GAP_PX)) {
      failureReasons.push(`bass-gap-${index}:${gapPx}`)
    }
  })

  reserveEntries.forEach((entry) => {
    if ((entry.leftReservePx ?? 0) > EPSILON_PX || (entry.rightReservePx ?? 0) > EPSILON_PX) {
      failureReasons.push(
        `unexpected-reserve:${entry.onsetTicks}:${entry.leftReservePx ?? 'null'}:${entry.rightReservePx ?? 'null'}`,
      )
    }
  })

  if (spacingSegments.length !== 3) {
    failureReasons.push(`unexpected-segment-count:${spacingSegments.length}`)
  }
  spacingSegments.forEach((segment, index) => {
    if (!approximatelyEqual(segment.baseGapPx, EXPECTED_SEGMENT_GAP_PX)) {
      failureReasons.push(`segment-base-gap-${index}:${segment.baseGapPx ?? 'null'}`)
    }
    if (!approximatelyEqual(segment.extraReservePx, 0)) {
      failureReasons.push(`segment-extra-reserve-${index}:${segment.extraReservePx ?? 'null'}`)
    }
    if (!approximatelyEqual(segment.appliedGapPx, EXPECTED_SEGMENT_GAP_PX)) {
      failureReasons.push(`segment-applied-gap-${index}:${segment.appliedGapPx ?? 'null'}`)
    }
  })

  return {
    pairIndex,
    rendered: row.rendered,
    measureWidth,
    spacingAnchorGapFirstToLastPx,
    bassSegmentGapsPx,
    reserveEntries,
    spacingSegments,
    passed: failureReasons.length === 0,
    failureReasons,
  }
}

async function waitForQuarterPulseRows(page: Page): Promise<void> {
  await page.waitForFunction(
    (expectedRowCount) => {
      const api = (window as unknown as {
        __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
      }).__scoreDebug
      const dump = api.dumpAllMeasureCoordinates()
      if (!dump || !Array.isArray(dump.rows) || dump.rows.length < expectedRowCount) return false
      return dump.rows.slice(0, expectedRowCount).every((row) => {
        if (!row?.rendered) return false
        if (typeof row.measureWidth !== 'number' || !Number.isFinite(row.measureWidth)) return false
        if (
          typeof row.spacingAnchorGapFirstToLastPx !== 'number' ||
          !Number.isFinite(row.spacingAnchorGapFirstToLastPx)
        ) {
          return false
        }
        const bassNoteCount = row.notes.filter((note) => note.staff === 'bass').length
        return bassNoteCount === 4
      })
    },
    TARGET_ROW_COUNT,
    { timeout: 120000 },
  )
}

async function main(): Promise<void> {
  const reportPath = process.argv[2] ?? path.resolve('debug', 'quarter-pulse-spacing-browser-report.json')
  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  server.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk))

  try {
    await waitForServer(DEV_URL, 120000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } })
    page.on('console', (message) => {
      console.log(`[browser:${message.type()}] ${message.text()}`)
    })
    page.on('pageerror', (error) => {
      console.error(`[browser:pageerror] ${error.stack ?? error.message}`)
    })

    console.log('[quarter-pulse-spacing] opening app')
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForDebugApi(page)
    console.log('[quarter-pulse-spacing] forcing scale to manual 100%')
    const appliedScale = await setScoreScale(page, false, 100)
    console.log('[quarter-pulse-spacing] applying quarter-pulse preset')
    await page.getByRole('button', { name: '四分脉冲' }).click()
    await page.waitForTimeout(150)
    await waitForQuarterPulseRows(page)

    const dump = await dumpAllMeasureCoordinates(page)
    const rows = dump.rows.slice(0, TARGET_ROW_COUNT).map((row, index) => buildRowReport(row, row?.pairIndex ?? index))
    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      scale: appliedScale,
      rows,
    }

    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    rows.forEach((row) => {
      console.log(
        `[quarter-pulse-spacing] pair=${row.pairIndex} width=${row.measureWidth} ` +
          `anchorSpan=${row.spacingAnchorGapFirstToLastPx} gaps=${JSON.stringify(row.bassSegmentGapsPx)} ` +
          `reserves=${JSON.stringify(row.reserveEntries)} segments=${JSON.stringify(row.spacingSegments)} ` +
          `${row.passed ? 'PASS' : 'FAIL'}`,
      )
      if (!row.passed) {
        console.log(`  reasons=${row.failureReasons.join(', ')}`)
      }
    })
    console.log(`Generated: ${reportPath}`)

    if (!rows.every((row) => row.passed)) {
      throw new Error('Quarter-pulse spacing regression detected.')
    }
  } finally {
    if (browser) {
      await browser.close()
    }
    await stopDevServer(server)
  }
}

void main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message)
  } else {
    console.error(error)
  }
  process.exitCode = 1
})
