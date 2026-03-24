import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
}

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
  scoreScale?: number
}

type PagingState = {
  currentPage: number
  pageCount: number
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
  rightReservePx?: number | null
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  measureWidth?: number | null
  trailingTailTicks?: number | null
  trailingGapPx?: number | null
  effectiveRightGapPx?: number | null
  spacingOnsetReserves?: DumpSpacingOnsetReserve[]
  spacingSegments?: DumpSpacingSegment[]
}

type MeasureDump = {
  totalMeasureCount: number
  renderedMeasureCount: number
  rows: MeasureDumpRow[]
}

type GapSample = {
  pairIndex: number
  measureWidth: number | null
  fromOnsetTicks: number
  toOnsetTicks: number
  deltaTicks: number
  baseGapPx: number
  extraReservePx: number
  appliedGapPx: number
}

type GapGroupReport = {
  deltaTicks: number
  sampleCount: number
  minBaseGapPx: number
  maxBaseGapPx: number
  spreadPx: number
  samples: GapSample[]
}

type MeasureSummary = {
  pairIndex: number
  rendered: boolean
  measureWidth: number | null
  trailingTailTicks: number | null
  trailingGapPx: number | null
  effectiveRightGapPx: number | null
  lastOnsetRightReservePx: number | null
  segmentCount: number
  baseGaps: Array<{
    deltaTicks: number
    baseGapPx: number | null
    extraReservePx: number | null
    appliedGapPx: number | null
  }>
}

type FinalReport = {
  generatedAt: string
  xmlPath: string
  scale: DebugScaleConfig
  measureSummaries: MeasureSummary[]
  gapGroups: GapGroupReport[]
  passed: boolean
  failureReasons: string[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4179
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const TARGET_PAIR_COUNT = 8
const TARGET_DELTAS = [4, 8, 12]
const GAP_EPSILON_PX = 0.15

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
        typeof api.importMusicXmlText === 'function' &&
        typeof api.getImportFeedback === 'function' &&
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

async function waitForImportSuccess(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api =
        (window as unknown as { __scoreDebug?: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
      if (!api || typeof api.getImportFeedback !== 'function') return false
      const feedback = api.getImportFeedback()
      return feedback.kind === 'success' || feedback.kind === 'error'
    },
    undefined,
    { timeout: 120000 },
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

async function importMusicXml(page: Page, xmlText: string): Promise<void> {
  await page.evaluate((xml) => {
    const api = (window as unknown as { __scoreDebug: { importMusicXmlText: (text: string) => void } }).__scoreDebug
    api.importMusicXmlText(xml)
  }, xmlText)
  await waitForImportSuccess(page)
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

async function waitForRenderedRows(page: Page, expectedRowCount: number): Promise<void> {
  await page.waitForFunction(
    (targetRowCount) => {
      const api = (window as unknown as {
        __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
      }).__scoreDebug
      const dump = api.dumpAllMeasureCoordinates()
      if (!dump || !Array.isArray(dump.rows) || dump.rows.length < targetRowCount) return false
      return dump.rows.some((row) => row?.rendered)
    },
    expectedRowCount,
    { timeout: 120000 },
  )
}

async function getPaging(page: Page): Promise<PagingState> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { getPaging: () => PagingState }
    }).__scoreDebug
    return api.getPaging()
  })
}

async function collectMergedRows(page: Page): Promise<MeasureDumpRow[]> {
  const paging = await getPaging(page)
  const initialDump = await dumpAllMeasureCoordinates(page)
  const mergedRows = Array.from({ length: initialDump.totalMeasureCount }, (_, pairIndex) => {
    const row = initialDump.rows[pairIndex]
    if (row) return row
    return {
      pairIndex,
      rendered: false,
      measureWidth: null,
      spacingSegments: [],
    }
  })

  const scrollMetrics = await page.evaluate(() => {
    const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLElement | null
    if (scrollHost) {
      return {
        mode: 'host' as const,
        maxScrollLeft: Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth),
        maxScrollTop: Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight),
        clientWidth: scrollHost.clientWidth,
        clientHeight: scrollHost.clientHeight,
      }
    }
    return {
      mode: 'window' as const,
      maxScrollLeft: Math.max(
        0,
        Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - window.innerWidth,
      ),
      maxScrollTop: Math.max(
        0,
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight,
      ),
      clientWidth: window.innerWidth,
      clientHeight: window.innerHeight,
    }
  })
  const scrollLeftPositions = new Set<number>([0])
  const scrollTopPositions = new Set<number>([0])
  const horizontalStep = Math.max(1, Math.floor(scrollMetrics.clientWidth * 0.85))
  const verticalStep = Math.max(1, Math.floor(scrollMetrics.clientHeight * 0.85))
  for (let scrollLeft = 0; scrollLeft <= scrollMetrics.maxScrollLeft; scrollLeft += horizontalStep) {
    scrollLeftPositions.add(scrollLeft)
  }
  for (let scrollTop = 0; scrollTop <= scrollMetrics.maxScrollTop; scrollTop += verticalStep) {
    scrollTopPositions.add(scrollTop)
  }
  scrollLeftPositions.add(scrollMetrics.maxScrollLeft)
  scrollTopPositions.add(scrollMetrics.maxScrollTop)

  for (const scrollTop of [...scrollTopPositions].sort((left, right) => left - right)) {
    for (const scrollLeft of [...scrollLeftPositions].sort((left, right) => left - right)) {
      await page.evaluate(
        ({ mode, nextScrollLeft, nextScrollTop }) => {
          if (mode === 'host') {
            const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLElement | null
            scrollHost?.scrollTo({ left: nextScrollLeft, top: nextScrollTop })
            return
          }
          window.scrollTo(nextScrollLeft, nextScrollTop)
        },
        {
          mode: scrollMetrics.mode,
          nextScrollLeft: scrollLeft,
          nextScrollTop: scrollTop,
        },
      )
      await page.waitForTimeout(150)
      const dump = await dumpAllMeasureCoordinates(page)
      dump.rows.forEach((row, pairIndex) => {
        if (!row?.rendered) return
        mergedRows[pairIndex] = row
      })
    }
  }

  if (paging.currentPage !== 0) {
    await page.evaluate(() => window.scrollTo(0, 0))
  }

  return mergedRows
}

async function resolveDesktopXmlPath(candidatePath: string | undefined): Promise<string> {
  if (candidatePath) {
    return path.resolve(candidatePath)
  }

  const desktopDir = path.resolve(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Desktop')
  const exactPath = path.join(desktopDir, '三个声部2（D调）.musicxml')
  const entries = await readdir(desktopDir, { withFileTypes: true })
  const exactMatch = entries.find((entry) => entry.isFile() && entry.name === path.basename(exactPath))
  if (exactMatch) return exactPath

  const fuzzyMatch = entries.find(
    (entry) =>
      entry.isFile() &&
      entry.name.toLowerCase().endsWith('.musicxml') &&
      entry.name.includes('三个声部2') &&
      entry.name.includes('D调'),
  )
  if (fuzzyMatch) return path.join(desktopDir, fuzzyMatch.name)

  throw new Error(`Cannot find 三个声部2（D调）.musicxml under ${desktopDir}`)
}

function roundFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null
}

function buildMeasureSummary(row: MeasureDumpRow, fallbackPairIndex: number): MeasureSummary {
  const lastOnsetReserve = row.spacingOnsetReserves?.length
    ? row.spacingOnsetReserves[row.spacingOnsetReserves.length - 1]
    : null
  return {
    pairIndex: typeof row.pairIndex === 'number' ? row.pairIndex : fallbackPairIndex,
    rendered: row.rendered,
    measureWidth: roundFinite(row.measureWidth),
    trailingTailTicks:
      typeof row.trailingTailTicks === 'number' && Number.isFinite(row.trailingTailTicks)
        ? Math.round(row.trailingTailTicks)
        : null,
    trailingGapPx: roundFinite(row.trailingGapPx),
    effectiveRightGapPx: roundFinite(row.effectiveRightGapPx),
    lastOnsetRightReservePx: roundFinite(lastOnsetReserve?.rightReservePx),
    segmentCount: row.spacingSegments?.length ?? 0,
    baseGaps:
      row.spacingSegments?.map((segment) => ({
        deltaTicks: Math.round(segment.toOnsetTicks - segment.fromOnsetTicks),
        baseGapPx: roundFinite(segment.baseGapPx),
        extraReservePx: roundFinite(segment.extraReservePx),
        appliedGapPx: roundFinite(segment.appliedGapPx),
      })) ?? [],
  }
}

function buildGapSamples(rows: MeasureDumpRow[]): GapSample[] {
  const samples: GapSample[] = []
  rows.forEach((row, index) => {
    const pairIndex = typeof row.pairIndex === 'number' ? row.pairIndex : index
    const measureWidth = roundFinite(row.measureWidth)
    ;(row.spacingSegments ?? []).forEach((segment) => {
      const baseGapPx = roundFinite(segment.baseGapPx)
      const extraReservePx = roundFinite(segment.extraReservePx) ?? 0
      const appliedGapPx = roundFinite(segment.appliedGapPx) ?? 0
      if (baseGapPx === null) return
      samples.push({
        pairIndex,
        measureWidth,
        fromOnsetTicks: Math.round(segment.fromOnsetTicks),
        toOnsetTicks: Math.round(segment.toOnsetTicks),
        deltaTicks: Math.round(segment.toOnsetTicks - segment.fromOnsetTicks),
        baseGapPx,
        extraReservePx,
        appliedGapPx,
      })
    })
  })
  return samples
}

function buildGapGroups(samples: GapSample[]): GapGroupReport[] {
  const groups = new Map<number, GapSample[]>()
  samples.forEach((sample) => {
    const list = groups.get(sample.deltaTicks)
    if (list) {
      list.push(sample)
    } else {
      groups.set(sample.deltaTicks, [sample])
    }
  })

  return [...groups.entries()]
    .map(([deltaTicks, gapSamples]) => {
      const sortedSamples = gapSamples
        .slice()
        .sort((left, right) => left.pairIndex - right.pairIndex || left.fromOnsetTicks - right.fromOnsetTicks)
      const baseGapValues = sortedSamples.map((sample) => sample.baseGapPx)
      const minBaseGapPx = Math.min(...baseGapValues)
      const maxBaseGapPx = Math.max(...baseGapValues)
      return {
        deltaTicks,
        sampleCount: sortedSamples.length,
        minBaseGapPx: Number(minBaseGapPx.toFixed(3)),
        maxBaseGapPx: Number(maxBaseGapPx.toFixed(3)),
        spreadPx: Number((maxBaseGapPx - minBaseGapPx).toFixed(3)),
        samples: sortedSamples,
      }
    })
    .sort((left, right) => left.deltaTicks - right.deltaTicks)
}

async function main(): Promise<void> {
  const xmlPath = await resolveDesktopXmlPath(process.argv[2])
  const reportPath = process.argv[3] ?? path.resolve('debug', 'global-tick-gap-browser-report.json')
  const xmlText = await readFile(xmlPath, 'utf8')
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

    console.log('[global-tick-gap] opening app')
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForDebugApi(page)
    console.log('[global-tick-gap] importing desktop sample')
    await importMusicXml(page, xmlText)
    console.log('[global-tick-gap] forcing scale to manual 100%')
    const appliedScale = await setScoreScale(page, false, 100)
    await page.waitForTimeout(200)
    await waitForRenderedRows(page, TARGET_PAIR_COUNT)

    const rows = (await collectMergedRows(page)).slice(0, TARGET_PAIR_COUNT)
    const measureSummaries = rows.map((row, index) => buildMeasureSummary(row, index))
    const gapSamples = buildGapSamples(rows)
    const gapGroups = buildGapGroups(gapSamples)

    const failureReasons: string[] = []
    if (rows.length < TARGET_PAIR_COUNT) {
      failureReasons.push(`missing-rows:${rows.length}`)
    }
    const unrenderedPairs = measureSummaries.filter((summary) => !summary.rendered).map((summary) => summary.pairIndex)
    if (unrenderedPairs.length > 0) {
      failureReasons.push(`unrendered-pairs:${unrenderedPairs.join(',')}`)
    }

    const uniqueMeasureWidths = [...new Set(measureSummaries.map((summary) => summary.measureWidth).filter((value) => value !== null))]
    if (uniqueMeasureWidths.length < 2) {
      failureReasons.push(`insufficient-measure-width-variance:${uniqueMeasureWidths.join(',') || 'none'}`)
    }

    TARGET_DELTAS.forEach((deltaTicks) => {
      const group = gapGroups.find((entry) => entry.deltaTicks === deltaTicks)
      if (!group) {
        failureReasons.push(`missing-delta:${deltaTicks}`)
        return
      }
      if (group.sampleCount < 2) {
        failureReasons.push(`insufficient-samples:${deltaTicks}:${group.sampleCount}`)
        return
      }
      if (group.spreadPx > GAP_EPSILON_PX) {
        failureReasons.push(`spread-too-large:${deltaTicks}:${group.spreadPx}`)
      }
    })

    gapGroups
      .filter((group) => group.sampleCount >= 2)
      .forEach((group) => {
        if (group.spreadPx > GAP_EPSILON_PX) {
          failureReasons.push(`global-spread-too-large:${group.deltaTicks}:${group.spreadPx}`)
        }
      })

    const quarterTickGapGroup = gapGroups.find((entry) => entry.deltaTicks === 4) ?? null
    const expectedTrailingGapPx = quarterTickGapGroup?.minBaseGapPx ?? null
    measureSummaries.forEach((summary) => {
      if (summary.trailingTailTicks !== 4) {
        failureReasons.push(`unexpected-trailing-tail-ticks:${summary.pairIndex}:${summary.trailingTailTicks ?? 'null'}`)
      }
      if ((summary.lastOnsetRightReservePx ?? 0) > GAP_EPSILON_PX) {
        failureReasons.push(
          `unexpected-last-right-reserve:${summary.pairIndex}:${summary.lastOnsetRightReservePx ?? 'null'}`,
        )
      }
      if (
        expectedTrailingGapPx !== null &&
        (summary.trailingGapPx === null || Math.abs(summary.trailingGapPx - expectedTrailingGapPx) > GAP_EPSILON_PX)
      ) {
        failureReasons.push(
          `unexpected-trailing-gap:${summary.pairIndex}:${summary.trailingGapPx ?? 'null'}!=${expectedTrailingGapPx}`,
        )
      }
    })

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      scale: appliedScale,
      measureSummaries,
      gapGroups,
      passed: failureReasons.length === 0,
      failureReasons,
    }

    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    measureSummaries.forEach((summary) => {
      console.log(
        `[global-tick-gap] pair=${summary.pairIndex} width=${summary.measureWidth} ` +
          `tail=${summary.trailingTailTicks}/${summary.trailingGapPx} rightGap=${summary.effectiveRightGapPx} ` +
          `lastReserve=${summary.lastOnsetRightReservePx} ` +
          `segments=${summary.baseGaps.map((entry) => `${entry.deltaTicks}:${entry.baseGapPx}`).join(',')}`,
      )
    })
    gapGroups.forEach((group) => {
      console.log(
        `[global-tick-gap] delta=${group.deltaTicks} count=${group.sampleCount} ` +
          `min=${group.minBaseGapPx} max=${group.maxBaseGapPx} spread=${group.spreadPx}`,
      )
    })
    console.log(`Generated: ${reportPath}`)

    if (failureReasons.length > 0) {
      throw new Error(`Global tick-gap regression detected: ${failureReasons.join(', ')}`)
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
