import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
  scoreScale?: number
}

type DumpSpacingSegment = {
  fromOnsetTicks: number
  toOnsetTicks: number
  baseGapPx: number | null
  extraReservePx?: number | null
  appliedGapPx?: number | null
}

type DumpSpacingOnsetReserve = {
  onsetTicks: number
  leftReservePx?: number | null
  rightReservePx?: number | null
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  pitch?: string | null
  duration?: string | null
  isRest?: boolean | null
  onsetTicksInMeasure?: number | null
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  measureWidth?: number | null
  leadingGapPx?: number | null
  trailingTailTicks?: number | null
  trailingGapPx?: number | null
  spacingAnchorGapFirstToLastPx?: number | null
  spacingAnchorTicks?: number[] | null
  spacingSegments?: DumpSpacingSegment[] | null
  spacingOnsetReserves?: DumpSpacingOnsetReserve[] | null
  notes?: DumpNoteRow[] | null
}

type MeasureDump = {
  totalMeasureCount: number
  renderedMeasureCount: number
  rows: MeasureDumpRow[]
}

type DemoKind = 'half-note' | 'whole-note'

type DemoRowReport = {
  pairIndex: number
  rendered: boolean
  measureWidth: number | null
  leadingGapPx: number | null
  trailingTailTicks: number | null
  trailingGapPx: number | null
  spacingAnchorGapFirstToLastPx: number | null
  spacingAnchorTicks: number[]
  reserveCount: number
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

type DemoReport = {
  demo: DemoKind
  buttonLabel: string
  rows: DemoRowReport[]
}

type FinalReport = {
  generatedAt: string
  scale: DebugScaleConfig
  demos: DemoReport[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4180
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const TARGET_ROW_COUNT = 4
const EPSILON_PX = 0.15
const EXPECTED_HALF_ANCHOR_TICKS = [0, 32]
const EXPECTED_WHOLE_ANCHOR_TICKS = [0, 32]
const EXPECTED_WHOLE_TAIL_TICKS = 32
const LEGACY_MIN_MEASURE_WIDTH_PX = 120

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

async function clickButton(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label }).first()
  await button.waitFor()
  await button.evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
}

async function waitForHalfNoteDemo(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
      }).__scoreDebug
      const firstRow = api.dumpAllMeasureCoordinates().rows[0]
      if (!firstRow) return false
      const notes = firstRow.notes ?? []
      const trebleNotes = notes.filter((note) => note.staff === 'treble' && !note.isRest)
      const bassNotes = notes.filter((note) => note.staff === 'bass' && !note.isRest)
      const trebleTicks = trebleNotes.map((note) => note.onsetTicksInMeasure ?? null).join(',')
      const bassTicks = bassNotes.map((note) => note.onsetTicksInMeasure ?? null).join(',')
      return (
        trebleNotes.length === 2 &&
        bassNotes.length === 2 &&
        trebleNotes.every((note) => note.pitch === 'c/5' && note.duration === 'h') &&
        bassNotes.every((note) => note.pitch === 'c/3' && note.duration === 'h') &&
        trebleTicks === '0,32' &&
        bassTicks === '0,32'
      )
    },
    undefined,
    { timeout: 120000 },
  )
}

async function waitForWholeNoteDemo(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
      }).__scoreDebug
      const firstRow = api.dumpAllMeasureCoordinates().rows[0]
      if (!firstRow) return false
      const notes = firstRow.notes ?? []
      const trebleNotes = notes.filter((note) => note.staff === 'treble' && !note.isRest)
      const bassNotes = notes.filter((note) => note.staff === 'bass' && !note.isRest)
      return (
        trebleNotes.length === 1 &&
        bassNotes.length === 1 &&
        trebleNotes[0]?.pitch === 'c/5' &&
        trebleNotes[0]?.duration === 'w' &&
        bassNotes[0]?.pitch === 'c/3' &&
        bassNotes[0]?.duration === 'w'
      )
    },
    undefined,
    { timeout: 120000 },
  )
}

async function waitForDemoRows(page: Page, expectedRowCount: number): Promise<void> {
  await page.waitForFunction(
    (targetRowCount) => {
      const api = (window as unknown as {
        __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
      }).__scoreDebug
      const dump = api.dumpAllMeasureCoordinates()
      if (!dump || !Array.isArray(dump.rows) || dump.rows.length < targetRowCount) return false
      return dump.rows.slice(0, targetRowCount).every((row) => {
        if (!row?.rendered) return false
        if (typeof row.measureWidth !== 'number' || !Number.isFinite(row.measureWidth)) return false
        return Array.isArray(row.spacingAnchorTicks)
      })
    },
    expectedRowCount,
    { timeout: 120000 },
  )
}

function roundFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null
}

function approximatelyEqual(left: number | null, right: number | null, epsilon = EPSILON_PX): boolean {
  if (left === null || right === null) return false
  return Math.abs(left - right) <= epsilon
}

function normalizeTicks(ticks: number[] | null | undefined): number[] {
  return Array.isArray(ticks) ? ticks.map((tick) => Math.round(tick)) : []
}

function hasAnyReserve(row: MeasureDumpRow): boolean {
  return (row.spacingOnsetReserves ?? []).some((entry) =>
    Math.abs(entry.leftReservePx ?? 0) > EPSILON_PX || Math.abs(entry.rightReservePx ?? 0) > EPSILON_PX,
  )
}

function buildDemoRowReport(row: MeasureDumpRow, demo: DemoKind): DemoRowReport {
  const failureReasons: string[] = []
  const measureWidth = roundFinite(row.measureWidth)
  const leadingGapPx = roundFinite(row.leadingGapPx)
  const trailingTailTicks =
    typeof row.trailingTailTicks === 'number' && Number.isFinite(row.trailingTailTicks)
      ? Math.round(row.trailingTailTicks)
      : null
  const trailingGapPx = roundFinite(row.trailingGapPx)
  const spacingAnchorGapFirstToLastPx = roundFinite(row.spacingAnchorGapFirstToLastPx)
  const spacingAnchorTicks = normalizeTicks(row.spacingAnchorTicks)
  const spacingSegments = (row.spacingSegments ?? []).map((entry) => ({
    fromOnsetTicks: Math.round(entry.fromOnsetTicks),
    toOnsetTicks: Math.round(entry.toOnsetTicks),
    baseGapPx: roundFinite(entry.baseGapPx),
    extraReservePx: roundFinite(entry.extraReservePx),
    appliedGapPx: roundFinite(entry.appliedGapPx),
  }))
  const reserveCount = row.spacingOnsetReserves?.length ?? 0

  if (!row.rendered) {
    failureReasons.push('measure-not-rendered')
  }
  if (measureWidth === null || leadingGapPx === null || trailingGapPx === null || spacingAnchorGapFirstToLastPx === null) {
    failureReasons.push('missing-spacing-metrics')
  }
  if (measureWidth !== null && measureWidth >= LEGACY_MIN_MEASURE_WIDTH_PX - EPSILON_PX) {
    failureReasons.push(`measure-width-still-clamped:${measureWidth}`)
  }
  if (hasAnyReserve(row)) {
    failureReasons.push('unexpected-onset-reserve')
  }
  spacingSegments.forEach((segment, index) => {
    if (!approximatelyEqual(segment.extraReservePx, 0)) {
      failureReasons.push(`segment-extra-reserve-${index}:${segment.extraReservePx ?? 'null'}`)
    }
    if (segment.baseGapPx !== null && segment.appliedGapPx !== null && !approximatelyEqual(segment.baseGapPx, segment.appliedGapPx)) {
      failureReasons.push(`segment-gap-mismatch-${index}:${segment.baseGapPx}:${segment.appliedGapPx}`)
    }
  })

  if (demo === 'half-note') {
    if (spacingAnchorTicks.length !== EXPECTED_HALF_ANCHOR_TICKS.length || spacingAnchorTicks.some((tick, index) => tick !== EXPECTED_HALF_ANCHOR_TICKS[index])) {
      failureReasons.push(`unexpected-anchor-ticks:${spacingAnchorTicks.join(',')}`)
    }
    if (spacingSegments.length !== 1) {
      failureReasons.push(`unexpected-segment-count:${spacingSegments.length}`)
    } else {
      const firstSegment = spacingSegments[0]
      if (!approximatelyEqual(firstSegment.baseGapPx, trailingGapPx)) {
        failureReasons.push(`half-gap-tail-mismatch:${firstSegment.baseGapPx ?? 'null'}:${trailingGapPx ?? 'null'}`)
      }
    }
  } else {
    if (spacingAnchorTicks.length !== EXPECTED_WHOLE_ANCHOR_TICKS.length || spacingAnchorTicks.some((tick, index) => tick !== EXPECTED_WHOLE_ANCHOR_TICKS[index])) {
      failureReasons.push(`unexpected-anchor-ticks:${spacingAnchorTicks.join(',')}`)
    }
    if (trailingTailTicks !== EXPECTED_WHOLE_TAIL_TICKS) {
      failureReasons.push(`unexpected-trailing-tail-ticks:${trailingTailTicks ?? 'null'}`)
    }
    if (spacingSegments.length !== 1) {
      failureReasons.push(`unexpected-segment-count:${spacingSegments.length}`)
    } else {
      const firstSegment = spacingSegments[0]
      if (!approximatelyEqual(firstSegment.baseGapPx, trailingGapPx)) {
        failureReasons.push(`whole-gap-tail-mismatch:${firstSegment.baseGapPx ?? 'null'}:${trailingGapPx ?? 'null'}`)
      }
    }
  }

  if (
    measureWidth !== null &&
    leadingGapPx !== null &&
    spacingAnchorGapFirstToLastPx !== null &&
    trailingGapPx !== null &&
    !approximatelyEqual(measureWidth, leadingGapPx + spacingAnchorGapFirstToLastPx + trailingGapPx)
  ) {
    failureReasons.push(
      `intrinsic-width-mismatch:${measureWidth}:${Number((leadingGapPx + spacingAnchorGapFirstToLastPx + trailingGapPx).toFixed(3))}`,
    )
  }

  return {
    pairIndex: row.pairIndex,
    rendered: row.rendered,
    measureWidth,
    leadingGapPx,
    trailingTailTicks,
    trailingGapPx,
    spacingAnchorGapFirstToLastPx,
    spacingAnchorTicks,
    reserveCount,
    spacingSegments,
    passed: failureReasons.length === 0,
    failureReasons,
  }
}

async function collectDemoReport(page: Page, params: {
  buttonLabel: string
  demo: DemoKind
}): Promise<DemoReport> {
  const { buttonLabel, demo } = params
  await clickButton(page, buttonLabel)
  if (demo === 'half-note') {
    await waitForHalfNoteDemo(page)
  } else {
    await waitForWholeNoteDemo(page)
  }
  await waitForDemoRows(page, TARGET_ROW_COUNT)
  const dump = await dumpAllMeasureCoordinates(page)
  return {
    demo,
    buttonLabel,
    rows: dump.rows.slice(0, TARGET_ROW_COUNT).map((row) => buildDemoRowReport(row, demo)),
  }
}

async function main(): Promise<void> {
  const reportPath = process.argv[2] ?? path.resolve('debug', 'built-in-demo-spacing-browser-report.json')
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

    console.log('[built-in-demo-spacing] opening app')
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForDebugApi(page)
    console.log('[built-in-demo-spacing] forcing scale to manual 100%')
    const appliedScale = await setScoreScale(page, false, 100)

    const demos: DemoReport[] = []
    demos.push(
      await collectDemoReport(page, {
        buttonLabel: '加载二分音符示例',
        demo: 'half-note',
      }),
    )
    demos.push(
      await collectDemoReport(page, {
        buttonLabel: '加载全音符示例',
        demo: 'whole-note',
      }),
    )

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      scale: appliedScale,
      demos,
    }

    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    const failureReasons: string[] = []
    demos.forEach((demo) => {
      demo.rows.forEach((row) => {
        console.log(
          `[built-in-demo-spacing] demo=${demo.demo} pair=${row.pairIndex} ` +
            `width=${row.measureWidth} lead=${row.leadingGapPx} anchorSpan=${row.spacingAnchorGapFirstToLastPx} ` +
            `tail=${row.trailingTailTicks}/${row.trailingGapPx} ticks=${JSON.stringify(row.spacingAnchorTicks)} ` +
            `segments=${JSON.stringify(row.spacingSegments)} ${row.passed ? 'PASS' : 'FAIL'}`,
        )
        if (!row.passed) {
          console.log(`  reasons=${row.failureReasons.join(', ')}`)
          failureReasons.push(`${demo.demo}:${row.pairIndex}:${row.failureReasons.join('|')}`)
        }
      })
    })
    console.log(`Generated: ${reportPath}`)

    if (failureReasons.length > 0) {
      throw new Error(`Built-in demo spacing regression detected: ${failureReasons.join(', ')}`)
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
