import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
  scoreScale: number
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
  measureStartBarX?: number | null
  measureEndBarX?: number | null
  noteStartX?: number | null
  noteEndX?: number | null
  leadingGapPx?: number | null
  trailingTailTicks?: number | null
  trailingGapPx?: number | null
  maxSpacingRightX?: number | null
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

type DurationUniformitySample = {
  pairIndex: number
  staff: 'treble' | 'bass'
  fromOnsetTicksInMeasure: number
  toOnsetTicksInMeasure: number
  deltaTicks: number
  gapPx: number
}

type BarlineEdgeSample = {
  pairIndex: number
  leadingGapPx: number
  trailingTailTicks: number
  trailingGapPx: number
  pass: boolean
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const GAP_COMPARE_EPSILON = 0.001
const TICK_COMPARE_EPSILON = 0.0001
const DURATION_UNIFORMITY_EPSILON_PX = 0.01
const LEADING_GAP_EPSILON_PX = 0.75
const TRAILING_GAP_EPSILON_PX = 0.75
const DEFAULT_MANUAL_SCALE_PERCENT = 100
const DEFAULT_AUTO_SCALE_ENABLED = false

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

async function waitForDebugApi(page: import('playwright').Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
    return (
      !!api &&
      typeof api.importMusicXmlText === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.getPaging === 'function' &&
      typeof api.goToPage === 'function' &&
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.getScaleConfig === 'function' &&
      typeof api.setAutoScaleEnabled === 'function' &&
      typeof api.setManualScalePercent === 'function'
    )
  })
}

async function setScoreScale(
  page: import('playwright').Page,
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
          getScaleConfig: () => { autoScaleEnabled: boolean; manualScalePercent: number }
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
        getScaleConfig: () => { autoScaleEnabled: boolean; manualScalePercent: number; scoreScale: number }
      }
    }).__scoreDebug
    return api.getScaleConfig()
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

function buildLineDurationUniformity(rows: MergedMeasureDumpRow[]) {
  const grouped = new Map<
    string,
    {
      lineKey: string
      pageIndex: number
      systemTop: number | null
      samplesByDeltaTicks: Map<number, DurationUniformitySample[]>
    }
  >()

  rows.forEach((row) => {
    if (!row.rendered || row.renderedPageIndex === null) return
    const normalizedSystemTop = roundOrNull(row.systemTop, 3)
    const lineKey = `${row.renderedPageIndex}|${normalizedSystemTop ?? `pair-${row.pairIndex}`}`
    const entry = grouped.get(lineKey) ?? {
      lineKey,
      pageIndex: row.renderedPageIndex,
      systemTop: normalizedSystemTop,
      samplesByDeltaTicks: new Map<number, DurationUniformitySample[]>(),
    }

    ;(['treble', 'bass'] as const).forEach((staff) => {
      const staffNotes = row.notes
        .filter((note) => note.staff === staff && typeof note.onsetTicksInMeasure === 'number')
        .sort((left, right) => {
          const leftOnset = left.onsetTicksInMeasure as number
          const rightOnset = right.onsetTicksInMeasure as number
          if (leftOnset !== rightOnset) return leftOnset - rightOnset
          return left.noteIndex - right.noteIndex
        })
      for (let i = 1; i < staffNotes.length; i += 1) {
        const previous = staffNotes[i - 1]
        const next = staffNotes[i]
        if (!Number.isFinite(previous.x) || !Number.isFinite(next.x)) continue
        const deltaTicks = Math.round((next.onsetTicksInMeasure as number) - (previous.onsetTicksInMeasure as number))
        if (!Number.isFinite(deltaTicks) || deltaTicks <= 0) continue
        const gapPx = next.x - previous.x
        if (!Number.isFinite(gapPx) || gapPx <= 0) continue
        const bucket = entry.samplesByDeltaTicks.get(deltaTicks) ?? []
        bucket.push({
          pairIndex: row.pairIndex,
          staff,
          fromOnsetTicksInMeasure: previous.onsetTicksInMeasure as number,
          toOnsetTicksInMeasure: next.onsetTicksInMeasure as number,
          deltaTicks,
          gapPx,
        })
        entry.samplesByDeltaTicks.set(deltaTicks, bucket)
      }
    })
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
      const durationRows = [...line.samplesByDeltaTicks.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([deltaTicks, samples]) => {
          const minGapPx = samples.reduce((minValue, sample) => Math.min(minValue, sample.gapPx), Number.POSITIVE_INFINITY)
          const maxGapPx = samples.reduce((maxValue, sample) => Math.max(maxValue, sample.gapPx), Number.NEGATIVE_INFINITY)
          const rangePx = maxGapPx - minGapPx
          const pass = samples.length <= 1 || rangePx <= DURATION_UNIFORMITY_EPSILON_PX
          return {
            deltaTicks,
            sampleCount: samples.length,
            minGapPx: roundOrNull(minGapPx, 3),
            maxGapPx: roundOrNull(maxGapPx, 3),
            rangePx: roundOrNull(rangePx, 4),
            pass,
            samplePreview: samples.slice(0, 8).map((sample) => ({
              pairIndex: sample.pairIndex,
              staff: sample.staff,
              fromOnsetTicksInMeasure: sample.fromOnsetTicksInMeasure,
              toOnsetTicksInMeasure: sample.toOnsetTicksInMeasure,
              gapPx: roundOrNull(sample.gapPx, 3),
            })),
          }
        })
      const comparableDurations = durationRows.filter((item) => item.sampleCount > 1)
      const pass = comparableDurations.every((item) => item.pass)
      return {
        lineKey: line.lineKey,
        pageIndex: line.pageIndex,
        systemTop: line.systemTop,
        comparedDurationCount: comparableDurations.length,
        pass,
        durationRows,
      }
    })

  const comparableLines = lines.filter((line) => line.comparedDurationCount > 0)
  const failedLines = comparableLines.filter((line) => !line.pass)
  return {
    comparedLineCount: comparableLines.length,
    failedLineCount: failedLines.length,
    passed: failedLines.length === 0,
    lines,
    failedLines,
  }
}

function buildLineBarlineEdgeAnalysis(rows: MergedMeasureDumpRow[]) {
  const grouped = new Map<
    string,
    {
      lineKey: string
      pageIndex: number
      systemTop: number | null
      samples: BarlineEdgeSample[]
    }
  >()

  rows.forEach((row) => {
    if (!row.rendered || row.renderedPageIndex === null) return
    if (
      typeof row.leadingGapPx !== 'number' ||
      !Number.isFinite(row.leadingGapPx) ||
      typeof row.trailingTailTicks !== 'number' ||
      !Number.isFinite(row.trailingTailTicks) ||
      typeof row.trailingGapPx !== 'number' ||
      !Number.isFinite(row.trailingGapPx)
    ) {
      return
    }

    const pass = row.leadingGapPx >= 0 && row.trailingTailTicks >= 0 && row.trailingGapPx >= 0

    const normalizedSystemTop = roundOrNull(row.systemTop, 3)
    const lineKey = `${row.renderedPageIndex}|${normalizedSystemTop ?? `pair-${row.pairIndex}`}`
    const entry = grouped.get(lineKey) ?? {
      lineKey,
      pageIndex: row.renderedPageIndex,
      systemTop: normalizedSystemTop,
      samples: [],
    }
    entry.samples.push({
      pairIndex: row.pairIndex,
      leadingGapPx: row.leadingGapPx,
      trailingTailTicks: Math.round(row.trailingTailTicks),
      trailingGapPx: row.trailingGapPx,
      pass,
    })
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
      const sampleCount = line.samples.length
      const failedSamples = line.samples.filter((sample) => !sample.pass)
      const leadingGapValues = line.samples.map((sample) => sample.leadingGapPx)
      const minLeadingGapPx =
        leadingGapValues.length > 0 ? Math.min(...leadingGapValues) : Number.POSITIVE_INFINITY
      const maxLeadingGapPx =
        leadingGapValues.length > 0 ? Math.max(...leadingGapValues) : Number.NEGATIVE_INFINITY
      const leadingGapRangePx =
        leadingGapValues.length > 0 ? maxLeadingGapPx - minLeadingGapPx : Number.NaN

      const trailingGroups = new Map<number, number[]>()
      line.samples.forEach((sample) => {
        const bucket = trailingGroups.get(sample.trailingTailTicks) ?? []
        bucket.push(sample.trailingGapPx)
        trailingGroups.set(sample.trailingTailTicks, bucket)
      })
      const trailingGroupSummaries = [...trailingGroups.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([trailingTailTicks, gaps]) => {
          const minGap = Math.min(...gaps)
          const maxGap = Math.max(...gaps)
          const rangePx = maxGap - minGap
          return {
            trailingTailTicks,
            sampleCount: gaps.length,
            minGapPx: roundOrNull(minGap, 3),
            maxGapPx: roundOrNull(maxGap, 3),
            rangePx: roundOrNull(rangePx, 4),
            pass: gaps.length <= 1 || rangePx <= TRAILING_GAP_EPSILON_PX,
          }
        })
      const trailingGroupsPass = trailingGroupSummaries.every((group) => group.pass)
      const leadingGapPass = sampleCount <= 1 || leadingGapRangePx <= LEADING_GAP_EPSILON_PX
      return {
        lineKey: line.lineKey,
        pageIndex: line.pageIndex,
        systemTop: line.systemTop,
        sampleCount,
        failedSampleCount: failedSamples.length,
        leadingGapRangePx: roundOrNull(leadingGapRangePx, 4),
        leadingGapPass,
        trailingGroupsPass,
        pass: sampleCount > 0 ? failedSamples.length === 0 && leadingGapPass && trailingGroupsPass : true,
        trailingGroupSummaries,
        samples: line.samples.slice(0, 16).map((sample) => ({
          pairIndex: sample.pairIndex,
          leadingGapPx: roundOrNull(sample.leadingGapPx, 3),
          trailingTailTicks: sample.trailingTailTicks,
          trailingGapPx: roundOrNull(sample.trailingGapPx, 3),
          pass: sample.pass,
        })),
      }
    })

  const comparableLines = lines.filter((line) => line.sampleCount > 0)
  const failedLines = comparableLines.filter((line) => !line.pass)
  return {
    comparedLineCount: comparableLines.length,
    failedLineCount: failedLines.length,
    passed: failedLines.length === 0,
    lines,
    failedLines,
  }
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
  const manualScalePercentRaw = process.argv[4]
  const autoScaleEnabledRaw = process.argv[5]
  const manualScalePercent =
    manualScalePercentRaw !== undefined ? Number(manualScalePercentRaw) : DEFAULT_MANUAL_SCALE_PERCENT
  if (!Number.isFinite(manualScalePercent) || manualScalePercent <= 0) {
    throw new Error(`Invalid manual scale percent: ${manualScalePercentRaw}`)
  }
  const autoScaleEnabled =
    autoScaleEnabledRaw !== undefined
      ? ['1', 'true', 'yes', 'on'].includes(autoScaleEnabledRaw.trim().toLowerCase())
      : DEFAULT_AUTO_SCALE_ENABLED
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
    const scale = await setScoreScale(page, { autoScaleEnabled, manualScalePercent })

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
    const lineDurationUniformity = buildLineDurationUniformity(mergedRows)
    const lineBarlineEdgeAnalysis = buildLineBarlineEdgeAnalysis(mergedRows)
    const firstVsSecondMeasureComparison = buildFirstVsSecondMeasureComparison(mergedRows)
    const report = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      scale,
      pageCount: paging.pageCount,
      totalMeasureCount: latestDump.totalMeasureCount,
      renderedMeasureCount: mergedRows.filter((row) => row.rendered).length,
      overflowMeasureCount: overflowRows.length,
      gapOrderingRule: 'Within the same line: quarter gap should be greater than eighth gap (4th > 8th).',
      lineSpacingAnalysis,
      lineDurationUniformity,
      lineBarlineEdgeAnalysis,
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
    console.log(`Scale: auto=${String(scale.autoScaleEnabled)}, manual=${scale.manualScalePercent.toFixed(2)}%`)
    console.log(`Measures rendered: ${report.renderedMeasureCount}/${report.totalMeasureCount}`)
    console.log(`Overflow measures: ${report.overflowMeasureCount}`)
    console.log(
      `Line spacing ordering (quarter > eighth): ${lineSpacingAnalysis.passed ? 'PASS' : 'FAIL'} ` +
      `(compared=${lineSpacingAnalysis.comparedLineCount}, failed=${lineSpacingAnalysis.failedLineCount})`,
    )
    console.log(
      `Line duration uniformity (same deltaTicks equal gap): ${lineDurationUniformity.passed ? 'PASS' : 'FAIL'} ` +
      `(compared=${lineDurationUniformity.comparedLineCount}, failed=${lineDurationUniformity.failedLineCount})`,
    )
    console.log(
      `Line anchor-gap rule (leading fixed, trailing follows tail ticks): ${lineBarlineEdgeAnalysis.passed ? 'PASS' : 'FAIL'} ` +
      `(compared=${lineBarlineEdgeAnalysis.comparedLineCount}, failed=${lineBarlineEdgeAnalysis.failedLineCount})`,
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
    if (!lineDurationUniformity.passed) {
      lineDurationUniformity.failedLines.slice(0, 5).forEach((line) => {
        const failedDurations = line.durationRows.filter((item) => !item.pass && item.sampleCount > 1)
        failedDurations.slice(0, 6).forEach((duration) => {
          console.log(
            `Failed uniformity line ${line.lineKey}: deltaTicks=${duration.deltaTicks}, range=${duration.rangePx}, min=${duration.minGapPx}, max=${duration.maxGapPx}`,
          )
        })
      })
    }
    if (!lineBarlineEdgeAnalysis.passed) {
      lineBarlineEdgeAnalysis.failedLines.slice(0, 5).forEach((line) => {
        line.samples
          .filter((sample) => !sample.pass)
          .slice(0, 8)
          .forEach((sample) => {
            console.log(
              `Failed edge line ${line.lineKey} pair=${sample.pairIndex}: ` +
                `leading=${sample.leadingGapPx}, ` +
                `trailingTicks=${sample.trailingTailTicks}, ` +
                `trailing=${sample.trailingGapPx}`,
            )
          })
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
