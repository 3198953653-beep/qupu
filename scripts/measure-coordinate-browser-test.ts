import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type TimeAxisPoint = {
  pointIndex: number
  onsetTicksInMeasure: number
  onsetBeatsInMeasure: number | null
  x: number | null
  noteCount: number
  trebleNoteCount: number
  bassNoteCount: number
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  duration: string | null
  durationTicksInMeasure: number | null
  onsetTicksInMeasure: number | null
  onsetBeatsInMeasure: number | null
  timeAxisPointIndex: number | null
  timeAxisPointX: number | null
  x: number
  rightX: number
  spacingRightX: number
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  systemTop: number | null
  timeAxisTicksPerBeat: number | null
  timeAxisPoints: TimeAxisPoint[]
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

type MergedMeasureDumpRow = MeasureDumpRow & {
  renderedPageIndex: number | null
}

type GapSample = {
  pairIndex: number
  fromPointIndex: number
  toPointIndex: number
  fromOnsetTicksInMeasure: number
  toOnsetTicksInMeasure: number
  gapPx: number
}

type MeasureGapStats = {
  quarterGaps: GapSample[]
  eighthGaps: GapSample[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const GAP_COMPARE_EPSILON = 0.001
const TICK_COMPARE_EPSILON = 0.0001

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

function roundOrNull(value: number | null | undefined, digits: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(digits))
}

function getMeasureGapStats(row: MeasureDumpRow): MeasureGapStats {
  const quarterGaps: GapSample[] = []
  const eighthGaps: GapSample[] = []
  const ticksPerBeat =
    typeof row.timeAxisTicksPerBeat === 'number' && Number.isFinite(row.timeAxisTicksPerBeat) && row.timeAxisTicksPerBeat > 0
      ? row.timeAxisTicksPerBeat
      : 16
  const notesByStaff = new Map<'treble' | 'bass', DumpNoteRow[]>()
  row.notes.forEach((note) => {
    const list = notesByStaff.get(note.staff) ?? []
    list.push(note)
    notesByStaff.set(note.staff, list)
  })

  notesByStaff.forEach((staffNotes) => {
    const ordered = staffNotes
      .slice()
      .filter((note) => typeof note.onsetTicksInMeasure === 'number' && Number.isFinite(note.onsetTicksInMeasure))
      .sort((left, right) => {
        const leftOnset = left.onsetTicksInMeasure as number
        const rightOnset = right.onsetTicksInMeasure as number
        if (leftOnset !== rightOnset) return leftOnset - rightOnset
        return left.noteIndex - right.noteIndex
      })

    for (let index = 1; index < ordered.length; index += 1) {
      const left = ordered[index - 1]
      const right = ordered[index]
      if (typeof left.onsetTicksInMeasure !== 'number' || typeof right.onsetTicksInMeasure !== 'number') continue
      if (!Number.isFinite(left.x) || !Number.isFinite(right.x)) continue
      const deltaTicks = right.onsetTicksInMeasure - left.onsetTicksInMeasure
      if (!Number.isFinite(deltaTicks) || deltaTicks <= 0) continue
      const gapPx = right.x - left.x
      if (!Number.isFinite(gapPx) || gapPx <= 0) continue

      const sample: GapSample = {
        pairIndex: row.pairIndex,
        fromPointIndex: left.timeAxisPointIndex ?? left.noteIndex,
        toPointIndex: right.timeAxisPointIndex ?? right.noteIndex,
        fromOnsetTicksInMeasure: left.onsetTicksInMeasure,
        toOnsetTicksInMeasure: right.onsetTicksInMeasure,
        gapPx,
      }
      const deltaBeats = deltaTicks / ticksPerBeat
      if (Math.abs(deltaBeats - 1) <= TICK_COMPARE_EPSILON) {
        quarterGaps.push(sample)
      } else if (Math.abs(deltaBeats - 0.5) <= TICK_COMPARE_EPSILON) {
        eighthGaps.push(sample)
      }
    }
  })

  return { quarterGaps, eighthGaps }
}

function buildLineSpacingAnalysis(rows: MergedMeasureDumpRow[]) {
  const grouped = new Map<
    string,
    {
      lineKey: string
      pageIndex: number
      systemTop: number | null
      pairIndices: Set<number>
      quarterGaps: GapSample[]
      eighthGaps: GapSample[]
    }
  >()

  rows.forEach((row) => {
    if (!row.rendered || row.renderedPageIndex === null) return
    if (!row.timeAxisPoints || row.timeAxisPoints.length < 2) return
    const normalizedSystemTop = roundOrNull(row.systemTop, 3)
    const lineKey = `${row.renderedPageIndex}|${normalizedSystemTop ?? `pair-${row.pairIndex}`}`
    const entry = grouped.get(lineKey) ?? {
      lineKey,
      pageIndex: row.renderedPageIndex,
      systemTop: normalizedSystemTop,
      pairIndices: new Set<number>(),
      quarterGaps: [],
      eighthGaps: [],
    }
    entry.pairIndices.add(row.pairIndex)
    const gapStats = getMeasureGapStats(row)
    entry.quarterGaps.push(...gapStats.quarterGaps)
    entry.eighthGaps.push(...gapStats.eighthGaps)
    grouped.set(lineKey, entry)
  })

  const lines = [...grouped.values()]
    .sort((left, right) => {
      if (left.pageIndex !== right.pageIndex) return left.pageIndex - right.pageIndex
      if (left.systemTop === null && right.systemTop !== null) return 1
      if (left.systemTop !== null && right.systemTop === null) return -1
      if (left.systemTop !== null && right.systemTop !== null) return left.systemTop - right.systemTop
      return left.lineKey.localeCompare(right.lineKey)
    })
    .map((line) => {
      const minQuarterByPair = new Map<number, number>()
      const maxEighthByPair = new Map<number, number>()
      line.quarterGaps.forEach((sample) => {
        const current = minQuarterByPair.get(sample.pairIndex)
        if (current === undefined || sample.gapPx < current) {
          minQuarterByPair.set(sample.pairIndex, sample.gapPx)
        }
      })
      line.eighthGaps.forEach((sample) => {
        const current = maxEighthByPair.get(sample.pairIndex)
        if (current === undefined || sample.gapPx > current) {
          maxEighthByPair.set(sample.pairIndex, sample.gapPx)
        }
      })
      const crossPairComparisons: Array<{
        quarterPairIndex: number
        eighthPairIndex: number
        minQuarterGapPx: number
        maxEighthGapPx: number
        pass: boolean
      }> = []
      minQuarterByPair.forEach((minQuarterGapPx, quarterPairIndex) => {
        maxEighthByPair.forEach((maxEighthGapPx, eighthPairIndex) => {
          if (quarterPairIndex === eighthPairIndex) return
          crossPairComparisons.push({
            quarterPairIndex,
            eighthPairIndex,
            minQuarterGapPx,
            maxEighthGapPx,
            pass: minQuarterGapPx > maxEighthGapPx + GAP_COMPARE_EPSILON,
          })
        })
      })
      const orderingPass = crossPairComparisons.length > 0 ? crossPairComparisons.every((item) => item.pass) : null
      const minQuarterGapPx =
        crossPairComparisons.length > 0
          ? crossPairComparisons.reduce((minValue, item) => Math.min(minValue, item.minQuarterGapPx), Number.POSITIVE_INFINITY)
          : null
      const maxEighthGapPx =
        crossPairComparisons.length > 0
          ? crossPairComparisons.reduce((maxValue, item) => Math.max(maxValue, item.maxEighthGapPx), Number.NEGATIVE_INFINITY)
          : null
      return {
        lineKey: line.lineKey,
        pageIndex: line.pageIndex,
        systemTop: line.systemTop,
        pairIndices: [...line.pairIndices].sort((left, right) => left - right),
        quarterGapCount: line.quarterGaps.length,
        eighthGapCount: line.eighthGaps.length,
        minQuarterGapPx: roundOrNull(minQuarterGapPx, 3),
        maxEighthGapPx: roundOrNull(maxEighthGapPx, 3),
        orderingPass,
        crossPairComparisons: crossPairComparisons.slice(0, 24).map((item) => ({
          quarterPairIndex: item.quarterPairIndex,
          eighthPairIndex: item.eighthPairIndex,
          minQuarterGapPx: roundOrNull(item.minQuarterGapPx, 3),
          maxEighthGapPx: roundOrNull(item.maxEighthGapPx, 3),
          pass: item.pass,
        })),
        quarterGapSamples: line.quarterGaps.slice(0, 12).map((sample) => ({
          pairIndex: sample.pairIndex,
          fromPointIndex: sample.fromPointIndex,
          toPointIndex: sample.toPointIndex,
          fromOnsetTicksInMeasure: sample.fromOnsetTicksInMeasure,
          toOnsetTicksInMeasure: sample.toOnsetTicksInMeasure,
          gapPx: roundOrNull(sample.gapPx, 3),
        })),
        eighthGapSamples: line.eighthGaps.slice(0, 12).map((sample) => ({
          pairIndex: sample.pairIndex,
          fromPointIndex: sample.fromPointIndex,
          toPointIndex: sample.toPointIndex,
          fromOnsetTicksInMeasure: sample.fromOnsetTicksInMeasure,
          toOnsetTicksInMeasure: sample.toOnsetTicksInMeasure,
          gapPx: roundOrNull(sample.gapPx, 3),
        })),
      }
    })

  const comparableLines = lines.filter((line) => line.orderingPass !== null)
  const failedLines = comparableLines.filter((line) => line.orderingPass === false)
  return {
    comparedLineCount: comparableLines.length,
    failedLineCount: failedLines.length,
    passed: failedLines.length === 0,
    lines,
    failedLines,
  }
}

function buildFirstVsSecondMeasureComparison(rows: MergedMeasureDumpRow[]) {
  const firstMeasure = rows.find((row) => row.pairIndex === 0 && row.rendered)
  const secondMeasure = rows.find((row) => row.pairIndex === 1 && row.rendered)
  if (!firstMeasure || !secondMeasure) {
    return {
      comparable: false,
      reason: 'pair-0-or-pair-1-not-rendered',
    }
  }
  if (
    firstMeasure.renderedPageIndex !== secondMeasure.renderedPageIndex ||
    roundOrNull(firstMeasure.systemTop, 3) !== roundOrNull(secondMeasure.systemTop, 3)
  ) {
    return {
      comparable: false,
      reason: 'pair-0-and-pair-1-not-on-same-line',
      pair0PageIndex: firstMeasure.renderedPageIndex,
      pair1PageIndex: secondMeasure.renderedPageIndex,
      pair0SystemTop: roundOrNull(firstMeasure.systemTop, 3),
      pair1SystemTop: roundOrNull(secondMeasure.systemTop, 3),
    }
  }
  const firstGaps = getMeasureGapStats(firstMeasure)
  const secondGaps = getMeasureGapStats(secondMeasure)
  const firstMaxEighthGapPx =
    firstGaps.eighthGaps.length > 0
      ? firstGaps.eighthGaps.reduce((maxValue, sample) => Math.max(maxValue, sample.gapPx), Number.NEGATIVE_INFINITY)
      : null
  const secondMinQuarterGapPx =
    secondGaps.quarterGaps.length > 0
      ? secondGaps.quarterGaps.reduce((minValue, sample) => Math.min(minValue, sample.gapPx), Number.POSITIVE_INFINITY)
      : null
  const comparable = typeof firstMaxEighthGapPx === 'number' && typeof secondMinQuarterGapPx === 'number'
  return {
    comparable,
    reason: comparable ? null : 'missing-eighth-in-pair-0-or-quarter-in-pair-1',
    pair0PageIndex: firstMeasure.renderedPageIndex,
    pair0SystemTop: roundOrNull(firstMeasure.systemTop, 3),
    pair0MaxEighthGapPx: roundOrNull(firstMaxEighthGapPx, 3),
    pair1MinQuarterGapPx: roundOrNull(secondMinQuarterGapPx, 3),
    pair1PairIndex: secondMeasure.pairIndex,
    orderingPass:
      comparable && firstMaxEighthGapPx !== null && secondMinQuarterGapPx !== null
        ? secondMinQuarterGapPx > firstMaxEighthGapPx + GAP_COMPARE_EPSILON
        : null,
  }
}

async function main() {
  const xmlPath = process.argv[2] ?? 'C:\\Users\\76743\\Desktop\\1234.musicxml'
  const outputPath = process.argv[3] ?? path.resolve('debug', 'measure-coordinate-report.browser.json')
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
    await page.waitForFunction(() => {
      const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
      return !!api && typeof api.importMusicXmlText === 'function'
    })

    await page.evaluate((xml) => {
      const api = (window as unknown as { __scoreDebug: { importMusicXmlText: (text: string) => void } }).__scoreDebug
      api.importMusicXmlText(xml)
    }, xmlText)

    await page.waitForFunction(() => {
      const api =
        (window as unknown as { __scoreDebug?: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
      if (!api || typeof api.getImportFeedback !== 'function') return false
      const feedback = api.getImportFeedback()
      return feedback.kind !== 'idle' && feedback.kind !== 'loading'
    }, { timeout: 120_000 })

    const feedback = await page.evaluate(() => {
      const api =
        (window as unknown as { __scoreDebug: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
      return api.getImportFeedback()
    })
    if (feedback.kind !== 'success') {
      throw new Error(`MusicXML import failed: ${feedback.message}`)
    }

    const paging = await page.evaluate(() => {
      const api =
        (window as unknown as {
          __scoreDebug: { getPaging: () => { currentPage: number; pageCount: number } }
        }).__scoreDebug
      return api.getPaging()
    })

    const renderedByPair = new Map<number, { row: MeasureDumpRow; renderedPageIndex: number }>()
    let latestDump: MeasureDump | null = null

    for (let pageIndex = 0; pageIndex < paging.pageCount; pageIndex += 1) {
      await page.evaluate((targetPage) => {
        const api =
          (window as unknown as { __scoreDebug: { goToPage: (page: number) => void } }).__scoreDebug
        api.goToPage(targetPage)
      }, pageIndex)
      await page.waitForFunction((targetPage) => {
        const api =
          (window as unknown as {
            __scoreDebug: { getPaging: () => { currentPage: number } }
          }).__scoreDebug
        return api.getPaging().currentPage === targetPage
      }, pageIndex)
      await page.waitForTimeout(80)
      const dump = await page.evaluate(() => {
        const api =
          (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump } }).__scoreDebug
        return api.dumpAllMeasureCoordinates()
      })
      latestDump = dump
      dump.rows.forEach((row) => {
        if (row.rendered) renderedByPair.set(row.pairIndex, { row, renderedPageIndex: pageIndex })
      })
    }

    if (!latestDump) throw new Error('No layout dump produced.')

    const mergedRows: MergedMeasureDumpRow[] = Array.from({ length: latestDump.totalMeasureCount }, (_, pairIndex) => {
      const renderedEntry = renderedByPair.get(pairIndex)
      return (
        renderedEntry ?? {
          pairIndex,
          row: {
            pairIndex,
            rendered: false,
            systemTop: null,
            timeAxisTicksPerBeat: null,
            timeAxisPoints: [],
            overflowVsNoteEndX: null,
            overflowVsMeasureEndBarX: null,
            notes: [],
          },
          renderedPageIndex: null,
        }
      )
    }).map((entry) => ({
      ...entry.row,
      renderedPageIndex: entry.renderedPageIndex,
    }))

    const overflowRows = mergedRows.filter((row) => typeof row.overflowVsNoteEndX === 'number' && row.overflowVsNoteEndX > 0)
    const lineSpacingAnalysis = buildLineSpacingAnalysis(mergedRows)
    const firstVsSecondMeasureComparison = buildFirstVsSecondMeasureComparison(mergedRows)
    const report = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      pageCount: paging.pageCount,
      totalMeasureCount: latestDump.totalMeasureCount,
      renderedMeasureCount: mergedRows.filter((row) => row.rendered).length,
      overflowMeasureCount: overflowRows.length,
      gapOrderingRule: 'Within the same line: quarter gap should be greater than eighth gap (4th > 8th).',
      lineSpacingAnalysis,
      firstVsSecondMeasureComparison,
      overflowPairs: overflowRows.map((row) => ({
        pairIndex: row.pairIndex,
        overflowVsNoteEndX: row.overflowVsNoteEndX,
        overflowVsMeasureEndBarX: row.overflowVsMeasureEndBarX,
      })),
      rows: mergedRows,
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')

    console.log(`Generated: ${outputPath}`)
    console.log(`Measures rendered: ${report.renderedMeasureCount}/${report.totalMeasureCount}`)
    console.log(`Overflow measures: ${report.overflowMeasureCount}`)
    console.log(
      `Line spacing ordering (quarter > eighth): ${lineSpacingAnalysis.passed ? 'PASS' : 'FAIL'} ` +
      `(compared=${lineSpacingAnalysis.comparedLineCount}, failed=${lineSpacingAnalysis.failedLineCount})`,
    )
    if (firstVsSecondMeasureComparison.comparable) {
      console.log(
        `Pair0(8th max) vs Pair1(quarter min): ` +
          `${firstVsSecondMeasureComparison.pair0MaxEighthGapPx} -> ${firstVsSecondMeasureComparison.pair1MinQuarterGapPx} ` +
          `(${firstVsSecondMeasureComparison.orderingPass ? 'PASS' : 'FAIL'})`,
      )
    } else {
      console.log(`Pair0 vs Pair1 comparison skipped: ${firstVsSecondMeasureComparison.reason}`)
    }
    if (!lineSpacingAnalysis.passed) {
      lineSpacingAnalysis.failedLines.slice(0, 5).forEach((line) => {
        console.log(
          `Failed line ${line.lineKey}: minQuarter=${line.minQuarterGapPx}, maxEighth=${line.maxEighthGapPx}, pairs=${line.pairIndices.join(',')}`,
        )
      })
    }

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
