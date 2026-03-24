import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type PagingState = {
  currentPage: number
  pageCount: number
}

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
  scoreScale?: number
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
  isRest?: boolean
  onsetTicksInMeasure: number | null
  x: number
  noteHeads: DumpNoteHead[]
  accidentalCoords?: Array<{
    keyIndex: number
    rightX: number
  }>
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

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  measureWidth?: number | null
  measureStartBarX?: number | null
  measureEndBarX?: number | null
  effectiveBoundaryStartX?: number | null
  effectiveBoundaryEndX?: number | null
  effectiveLeftGapPx?: number | null
  effectiveRightGapPx?: number | null
  leadingGapPx?: number | null
  trailingGapPx?: number | null
  trailingTailTicks?: number | null
  spacingOccupiedLeftX?: number | null
  spacingOccupiedRightX?: number | null
  spacingOnsetReserves?: DumpSpacingOnsetReserve[]
  spacingSegments?: DumpSpacingSegment[]
  overflowVsNoteEndX: number | null
  overflowVsMeasureEndBarX: number | null
  notes: DumpNoteRow[]
}

type MeasureDump = {
  totalMeasureCount: number
  renderedMeasureCount: number
  rows: MeasureDumpRow[]
}

type MergedMeasureDumpRow = MeasureDumpRow & {
  renderedPageIndex: number | null
}

type ScaleCase = {
  key: string
  autoScaleEnabled: boolean
  manualScalePercent: number
}

type TargetMeasureAnalysis = {
  pairIndex: number
  renderedPageIndex: number | null
  noteIndex: number | null
  measureWidth: number | null
  totalReserveWidthPx: number | null
  baseMeasureWidthPx: number | null
  anchorX: number | null
  headXs: number[]
  candidateNotes: Array<{
    noteIndex: number
    onsetTicksInMeasure: number | null
    headXs: number[]
  }>
  direction: 'aligned' | 'backward' | 'forward' | 'both' | 'missing'
  onsetReserve: DumpSpacingOnsetReserve | null
  previousSegment: DumpSpacingSegment | null
  nextSegment: DumpSpacingSegment | null
  effectiveBoundaryStartX: number | null
  effectiveBoundaryEndX: number | null
  spacingOccupiedLeftX: number | null
  spacingOccupiedRightX: number | null
  visibleLeftGapPx: number | null
  visibleRightGapPx: number | null
  effectiveLeftGapPx: number | null
  effectiveRightGapPx: number | null
  overflowVsNoteEndX: number | null
  overflowVsMeasureEndBarX: number | null
  hasDisplacedColumns: boolean
  passed: boolean
  failureReasons: string[]
}

type ScenarioReport = {
  key: string
  scale: DebugScaleConfig
  passed: boolean
  targets: TargetMeasureAnalysis[]
}

type FinalReport = {
  generatedAt: string
  xmlPath: string
  scenarios: ScenarioReport[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4176
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const TARGET_PAIR_COUNT = 8
const GAP_EPSILON_PX = 0.01
const HEAD_X_EPSILON_PX = 0.01
const MIN_VISIBLE_GAP_PX = 2
const BASE_GAP_UNIT_PX = 3.5
const DEFAULT_BASE_MIN_GAP_32_PX = 6.9
const DEFAULT_DURATION_GAP_RATIOS = {
  thirtySecond: 0.7,
  sixteenth: 0.78,
  eighth: 0.93,
  quarter: 1.02,
  half: 1.22,
  whole: 1.4,
} as const

const SCALE_CASES: ScaleCase[] = [
  { key: 'manual-100', autoScaleEnabled: false, manualScalePercent: 100 },
  { key: 'auto-scale', autoScaleEnabled: true, manualScalePercent: 100 },
]

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
      typeof api.getPaging === 'function' &&
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

async function setScoreScale(page: Page, params: ScaleCase): Promise<DebugScaleConfig> {
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
    { timeout: 120000 },
  )
  await page.waitForTimeout(150)
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getScaleConfig: () => { autoScaleEnabled: boolean; manualScalePercent: number; scoreScale?: number }
      }
    }).__scoreDebug
    return api.getScaleConfig()
  })
}

async function getPaging(page: Page): Promise<PagingState> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { getPaging: () => PagingState }
    }).__scoreDebug
    return api.getPaging()
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

async function collectMergedRows(page: Page): Promise<MergedMeasureDumpRow[]> {
  const paging = await getPaging(page)
  const initialDump = await dumpAllMeasureCoordinates(page)
  const renderedPageIndex = paging.currentPage
  const mergedRows = Array.from({ length: initialDump.totalMeasureCount }, (_, pairIndex) => {
    const row = initialDump.rows[pairIndex]
    if (row) {
      return {
        ...row,
        renderedPageIndex: row.rendered ? renderedPageIndex : null,
      }
    }
    return {
      pairIndex,
      rendered: false,
      renderedPageIndex: null,
      overflowVsNoteEndX: null,
      overflowVsMeasureEndBarX: null,
      notes: [],
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
        mergedRows[pairIndex] = {
          ...row,
          renderedPageIndex,
        }
      })
    }
  }

  return mergedRows
}

function resolveDesktopXmlPath(candidatePath: string | undefined): Promise<string> {
  if (candidatePath) {
    return Promise.resolve(path.resolve(candidatePath))
  }

  const desktopDir = path.resolve(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Desktop')
  const exactPath = path.join(desktopDir, '三个声部2（D调）.musicxml')

  return readdir(desktopDir, { withFileTypes: true }).then((entries) => {
    const exactMatch = entries.find((entry) => entry.isFile() && entry.name === path.basename(exactPath))
    if (exactMatch) {
      return exactPath
    }

    const fuzzyMatch = entries.find(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.musicxml') &&
        entry.name.includes('三个声部2') &&
        entry.name.includes('D调'),
    )
    if (fuzzyMatch) {
      return path.join(desktopDir, fuzzyMatch.name)
    }

    throw new Error(`Cannot find 三个声部2（D调）.musicxml under ${desktopDir}`)
  })
}

function dedupeSortedNumbers(values: number[], epsilon: number): number[] {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Number(value.toFixed(3)))
    .sort((left, right) => left - right)
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]) > epsilon)
}

function classifyDirection(anchorX: number | null, headXs: number[]): 'aligned' | 'backward' | 'forward' | 'both' | 'missing' {
  if (anchorX === null || !Number.isFinite(anchorX) || headXs.length === 0) return 'missing'
  const hasBackward = headXs.some((headX) => headX < anchorX - HEAD_X_EPSILON_PX)
  const hasForward = headXs.some((headX) => headX > anchorX + HEAD_X_EPSILON_PX)
  if (hasBackward && hasForward) return 'both'
  if (hasBackward) return 'backward'
  if (hasForward) return 'forward'
  return 'aligned'
}

function toRoundedFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null
}

function approximatelyEqual(left: number | null, right: number | null, epsilon = GAP_EPSILON_PX): boolean {
  if (left === null || right === null) return false
  return Math.abs(left - right) <= epsilon
}

function getDurationGapRatioByDeltaTicks(deltaTicks: number): number {
  const anchors: Array<{ ticks: number; ratio: number }> = [
    { ticks: 2, ratio: DEFAULT_DURATION_GAP_RATIOS.thirtySecond },
    { ticks: 4, ratio: DEFAULT_DURATION_GAP_RATIOS.sixteenth },
    { ticks: 8, ratio: DEFAULT_DURATION_GAP_RATIOS.eighth },
    { ticks: 16, ratio: DEFAULT_DURATION_GAP_RATIOS.quarter },
    { ticks: 32, ratio: DEFAULT_DURATION_GAP_RATIOS.half },
    { ticks: 64, ratio: DEFAULT_DURATION_GAP_RATIOS.whole },
  ]
  const safeTicks = Math.max(1, deltaTicks)
  if (safeTicks <= anchors[0].ticks) return anchors[0].ratio
  if (safeTicks >= anchors[anchors.length - 1].ticks) return anchors[anchors.length - 1].ratio
  for (let index = 1; index < anchors.length; index += 1) {
    const left = anchors[index - 1]
    const right = anchors[index]
    if (safeTicks === right.ticks) return right.ratio
    if (safeTicks < right.ticks) {
      const leftLog = Math.log2(left.ticks)
      const rightLog = Math.log2(right.ticks)
      const tickLog = Math.log2(safeTicks)
      const blend = (tickLog - leftLog) / Math.max(0.0001, rightLog - leftLog)
      return left.ratio + (right.ratio - left.ratio) * blend
    }
  }
  return anchors[anchors.length - 1]?.ratio ?? 1
}

function mapTickGapToWeight(deltaTicks: number): number {
  return DEFAULT_BASE_MIN_GAP_32_PX * Math.max(0.0001, getDurationGapRatioByDeltaTicks(deltaTicks)) * BASE_GAP_UNIT_PX
}

function sanitizeSpacingOnsetReserve(
  entry: DumpSpacingOnsetReserve | null | undefined,
): DumpSpacingOnsetReserve | null {
  if (!entry || !Number.isFinite(entry.onsetTicks)) return null
  return {
    onsetTicks: Math.round(entry.onsetTicks),
    baseX: toRoundedFiniteNumber(entry.baseX),
    finalX: toRoundedFiniteNumber(entry.finalX),
    leftReservePx: toRoundedFiniteNumber(entry.leftReservePx),
    rightReservePx: toRoundedFiniteNumber(entry.rightReservePx),
  }
}

function sanitizeSpacingSegment(entry: DumpSpacingSegment | null | undefined): DumpSpacingSegment | null {
  if (!entry || !Number.isFinite(entry.fromOnsetTicks) || !Number.isFinite(entry.toOnsetTicks)) return null
  return {
    fromOnsetTicks: Math.round(entry.fromOnsetTicks),
    toOnsetTicks: Math.round(entry.toOnsetTicks),
    baseGapPx: toRoundedFiniteNumber(entry.baseGapPx),
    extraReservePx: toRoundedFiniteNumber(entry.extraReservePx),
    appliedGapPx: toRoundedFiniteNumber(entry.appliedGapPx),
  }
}

function analyzeTargetRow(row: MergedMeasureDumpRow, pairIndex: number): TargetMeasureAnalysis {
  const candidateNotes = row.notes
    .filter((note) => note.staff === 'bass' && note.isRest !== true && Array.isArray(note.noteHeads) && note.noteHeads.length > 1)
    .map((note) => ({
      noteIndex: note.noteIndex,
      onsetTicksInMeasure: note.onsetTicksInMeasure,
      headXs: dedupeSortedNumbers(note.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX),
    }))
    .sort((left, right) => {
      const leftOnset = left.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
      const rightOnset = right.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
      if (leftOnset !== rightOnset) return leftOnset - rightOnset
      return left.noteIndex - right.noteIndex
    })

  const targetNote =
    row.notes
      .filter((note) => note.staff === 'bass' && note.isRest !== true && Array.isArray(note.noteHeads) && note.noteHeads.length > 1)
      .sort((left, right) => {
        const leftOnset = left.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
        const rightOnset = right.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
        if (leftOnset !== rightOnset) return leftOnset - rightOnset
        return left.noteIndex - right.noteIndex
      })[0] ?? null

  const failureReasons: string[] = []
  if (!row.rendered) {
    failureReasons.push('measure-not-rendered')
  }
  if (!targetNote) {
    failureReasons.push('target-bass-second-chord-missing')
  }

  const headXs = targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []
  const anchorX = targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null
  const targetHasRenderedAccidentals =
    targetNote && Array.isArray(targetNote.accidentalCoords) ? targetNote.accidentalCoords.length > 0 : false
  const hasDisplacedColumns = headXs.length > 1
  if (targetNote && !hasDisplacedColumns) {
    failureReasons.push('displaced-head-columns-not-detected')
  }
  const targetOnsetTicks =
    targetNote && typeof targetNote.onsetTicksInMeasure === 'number' && Number.isFinite(targetNote.onsetTicksInMeasure)
      ? Math.round(targetNote.onsetTicksInMeasure)
      : null
  const direction = classifyDirection(anchorX, headXs)

  const spacingOnsetReserves = (row.spacingOnsetReserves ?? [])
    .map((entry) => sanitizeSpacingOnsetReserve(entry))
    .filter((entry): entry is DumpSpacingOnsetReserve => entry !== null)
  const spacingSegments = (row.spacingSegments ?? [])
    .map((entry) => sanitizeSpacingSegment(entry))
    .filter((entry): entry is DumpSpacingSegment => entry !== null)
  const measureWidth =
    typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
      ? Number(row.measureWidth.toFixed(3))
      : null
  const leadingGapPx =
    typeof row.leadingGapPx === 'number' && Number.isFinite(row.leadingGapPx)
      ? Number(row.leadingGapPx.toFixed(3))
      : null
  const trailingGapPx =
    typeof row.trailingGapPx === 'number' && Number.isFinite(row.trailingGapPx)
      ? Number(row.trailingGapPx.toFixed(3))
      : null
  const trailingTailTicks =
    typeof row.trailingTailTicks === 'number' && Number.isFinite(row.trailingTailTicks)
      ? Math.max(0, Math.round(row.trailingTailTicks))
      : null
  const onsetReserveByTick = new Map<number, DumpSpacingOnsetReserve>()
  spacingOnsetReserves.forEach((entry) => {
    onsetReserveByTick.set(entry.onsetTicks, entry)
  })
  const onsetReserve = targetOnsetTicks !== null ? onsetReserveByTick.get(targetOnsetTicks) ?? null : null
  const previousSegment =
    targetOnsetTicks !== null
      ? spacingSegments.find((entry) => entry.toOnsetTicks === targetOnsetTicks) ?? null
      : null
  const nextSegment =
    targetOnsetTicks !== null
      ? spacingSegments.find((entry) => entry.fromOnsetTicks === targetOnsetTicks) ?? null
      : null

  if (targetNote && !onsetReserve) {
    failureReasons.push('target-onset-reserve-missing')
  }
  if (targetNote && onsetReserve && !targetHasRenderedAccidentals) {
    if (direction === 'forward') {
      if ((onsetReserve.leftReservePx ?? 0) > GAP_EPSILON_PX) {
        failureReasons.push(`forward-without-accidentals-left-reserve:${onsetReserve.leftReservePx ?? 'null'}`)
      }
      if ((onsetReserve.rightReservePx ?? 0) <= GAP_EPSILON_PX) {
        failureReasons.push(`forward-without-accidentals-missing-right-reserve:${onsetReserve.rightReservePx ?? 'null'}`)
      }
    } else if (direction === 'backward') {
      if ((onsetReserve.rightReservePx ?? 0) > GAP_EPSILON_PX) {
        failureReasons.push(`backward-without-accidentals-right-reserve:${onsetReserve.rightReservePx ?? 'null'}`)
      }
      if ((onsetReserve.leftReservePx ?? 0) <= GAP_EPSILON_PX) {
        failureReasons.push(`backward-without-accidentals-missing-left-reserve:${onsetReserve.leftReservePx ?? 'null'}`)
      }
    }
  }

  spacingSegments.forEach((segment) => {
    const fromReserve = onsetReserveByTick.get(segment.fromOnsetTicks) ?? null
    const toReserve = onsetReserveByTick.get(segment.toOnsetTicks) ?? null
    const expectedExtraReservePx = Number(
      (
        (fromReserve?.rightReservePx ?? 0) +
        (toReserve?.leftReservePx ?? 0)
      ).toFixed(3),
    )
    if (!approximatelyEqual(segment.extraReservePx, expectedExtraReservePx)) {
      failureReasons.push(
        `segment-extra-reserve-mismatch:${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.extraReservePx ?? 'null'}!=${expectedExtraReservePx}`,
      )
    }
    const expectedAppliedGapPx =
      segment.baseGapPx !== null ? Number((segment.baseGapPx + expectedExtraReservePx).toFixed(3)) : null
    if (!approximatelyEqual(segment.appliedGapPx, expectedAppliedGapPx)) {
      failureReasons.push(
        `segment-applied-gap-mismatch:${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.appliedGapPx ?? 'null'}!=${expectedAppliedGapPx ?? 'null'}`,
      )
    }
  })

  const sortedOnsetReserves = spacingOnsetReserves
    .slice()
    .sort((left, right) => left.onsetTicks - right.onsetTicks)
  const firstOnsetReserve = sortedOnsetReserves[0] ?? null
  const lastOnsetReserve = sortedOnsetReserves[sortedOnsetReserves.length - 1] ?? null
  const firstLeftReservePx = Math.max(0, firstOnsetReserve?.leftReservePx ?? 0)
  const lastRightReservePx = Math.max(0, lastOnsetReserve?.rightReservePx ?? 0)
  const totalSegmentReservePx = Number(
    spacingSegments.reduce((sum, segment) => sum + Math.max(0, segment.extraReservePx ?? 0), 0).toFixed(3),
  )
  const totalReserveWidthPx = Number((firstLeftReservePx + totalSegmentReservePx + lastRightReservePx).toFixed(3))
  const baseMeasureWidthPx =
    measureWidth !== null ? Number((measureWidth - totalReserveWidthPx).toFixed(3)) : null

  if (
    measureWidth !== null &&
    leadingGapPx !== null &&
    trailingGapPx !== null &&
    trailingTailTicks !== null &&
    baseMeasureWidthPx !== null
  ) {
    const baseLeadingGapPx = Number((leadingGapPx - firstLeftReservePx).toFixed(3))
    const rawTrailingGapPx = Number(mapTickGapToWeight(trailingTailTicks).toFixed(3))
    const rawAnchorWeightPx = Number(
      spacingSegments.reduce(
        (sum, segment) => sum + mapTickGapToWeight(Math.max(1, segment.toOnsetTicks - segment.fromOnsetTicks)),
        0,
      ).toFixed(3),
    )
    const rawTotalWeightPx = Number((rawAnchorWeightPx + rawTrailingGapPx).toFixed(3))

    if (baseLeadingGapPx < -GAP_EPSILON_PX) {
      failureReasons.push('base-leading-gap-negative')
    } else if (rawTotalWeightPx > GAP_EPSILON_PX) {
      const baseDistributableWidthPx = Number((baseMeasureWidthPx - baseLeadingGapPx).toFixed(3))
      const baseTimelineScale = baseDistributableWidthPx / rawTotalWeightPx

      spacingSegments.forEach((segment) => {
        const rawGapPx = mapTickGapToWeight(Math.max(1, segment.toOnsetTicks - segment.fromOnsetTicks))
        const expectedBaseGapPx = Number((rawGapPx * baseTimelineScale).toFixed(3))
        if (!approximatelyEqual(segment.baseGapPx ?? null, expectedBaseGapPx)) {
          failureReasons.push(
            `segment-base-gap-scaled:${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.baseGapPx ?? 'null'}!=${expectedBaseGapPx}`,
          )
        }
      })

      const expectedTrailingGapPx = Number((rawTrailingGapPx * baseTimelineScale).toFixed(3))
      if (!approximatelyEqual(trailingGapPx, expectedTrailingGapPx)) {
        failureReasons.push(`trailing-gap-scaled:${trailingGapPx ?? 'null'}!=${expectedTrailingGapPx}`)
      }
    }
  }

  const effectiveLeftGapPx =
    typeof row.effectiveLeftGapPx === 'number' && Number.isFinite(row.effectiveLeftGapPx)
      ? Number(row.effectiveLeftGapPx.toFixed(3))
      : null
  const effectiveRightGapPx =
    typeof row.effectiveRightGapPx === 'number' && Number.isFinite(row.effectiveRightGapPx)
      ? Number(row.effectiveRightGapPx.toFixed(3))
      : null
  const overflowVsNoteEndX =
    typeof row.overflowVsNoteEndX === 'number' && Number.isFinite(row.overflowVsNoteEndX)
      ? Number(row.overflowVsNoteEndX.toFixed(3))
      : null
  const overflowVsMeasureEndBarX =
    typeof row.overflowVsMeasureEndBarX === 'number' && Number.isFinite(row.overflowVsMeasureEndBarX)
      ? Number(row.overflowVsMeasureEndBarX.toFixed(3))
      : null
  const effectiveBoundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const effectiveBoundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null
  const spacingOccupiedLeftX =
    typeof row.spacingOccupiedLeftX === 'number' && Number.isFinite(row.spacingOccupiedLeftX)
      ? Number(row.spacingOccupiedLeftX.toFixed(3))
      : null
  const spacingOccupiedRightX =
    typeof row.spacingOccupiedRightX === 'number' && Number.isFinite(row.spacingOccupiedRightX)
      ? Number(row.spacingOccupiedRightX.toFixed(3))
      : null
  const visibleLeftGapPx =
    effectiveBoundaryStartX !== null && spacingOccupiedLeftX !== null
      ? Number((spacingOccupiedLeftX - effectiveBoundaryStartX).toFixed(3))
      : null
  const visibleRightGapPx =
    effectiveBoundaryEndX !== null && spacingOccupiedRightX !== null
      ? Number((effectiveBoundaryEndX - spacingOccupiedRightX).toFixed(3))
      : null

  if (
    visibleLeftGapPx !== null &&
    effectiveLeftGapPx !== null &&
    !approximatelyEqual(visibleLeftGapPx, effectiveLeftGapPx)
  ) {
    failureReasons.push('effective-left-gap-mismatch')
  }
  if (
    visibleRightGapPx !== null &&
    effectiveRightGapPx !== null &&
    !approximatelyEqual(visibleRightGapPx, effectiveRightGapPx)
  ) {
    failureReasons.push('effective-right-gap-mismatch')
  }

  if (
    direction === 'backward' &&
    (visibleLeftGapPx === null || visibleLeftGapPx < MIN_VISIBLE_GAP_PX - GAP_EPSILON_PX)
  ) {
    failureReasons.push('visible-left-gap-too-small')
  }
  if (direction === 'backward') {
    if (Math.max(onsetReserve?.leftReservePx ?? 0, onsetReserve?.rightReservePx ?? 0) <= GAP_EPSILON_PX) {
      failureReasons.push('backward-reserve-missing')
    }
  }
  if (direction === 'forward') {
    if (Math.max(onsetReserve?.leftReservePx ?? 0, onsetReserve?.rightReservePx ?? 0) <= GAP_EPSILON_PX) {
      failureReasons.push('forward-reserve-missing')
    }
  }
  if (overflowVsMeasureEndBarX !== null && overflowVsMeasureEndBarX > GAP_EPSILON_PX) {
    failureReasons.push('overflow-vs-measure-end-barline')
  }

  if (targetNote && onsetReserve && (direction === 'aligned' || direction === 'missing')) {
    failureReasons.push(`unexpected-direction:${direction}`)
  }

  return {
    pairIndex,
    renderedPageIndex: row.renderedPageIndex,
    noteIndex: targetNote?.noteIndex ?? null,
    measureWidth,
    totalReserveWidthPx,
    baseMeasureWidthPx,
    anchorX,
    headXs,
    candidateNotes,
    direction,
    onsetReserve,
    previousSegment,
    nextSegment,
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
    spacingOccupiedLeftX,
    spacingOccupiedRightX,
    visibleLeftGapPx,
    visibleRightGapPx,
    effectiveLeftGapPx,
    effectiveRightGapPx,
    overflowVsNoteEndX,
    overflowVsMeasureEndBarX,
    hasDisplacedColumns,
    passed: failureReasons.length === 0,
    failureReasons,
  }
}

function analyzeScenario(rows: MergedMeasureDumpRow[], scale: DebugScaleConfig, key: string): ScenarioReport {
  const targets = Array.from({ length: TARGET_PAIR_COUNT }, (_, pairIndex) =>
    analyzeTargetRow(rows[pairIndex] ?? {
      pairIndex,
      rendered: false,
      renderedPageIndex: null,
      overflowVsNoteEndX: null,
      overflowVsMeasureEndBarX: null,
      notes: [],
    }, pairIndex),
  )

  return {
    key,
    scale,
    passed: targets.every((target) => target.passed),
    targets,
  }
}

async function main(): Promise<void> {
  const xmlPath = await resolveDesktopXmlPath(process.argv[2])
  const reportPath = process.argv[3] ?? path.resolve('debug', 'second-chord-spacing-browser-report.json')
  const xmlText = await readFile(xmlPath, 'utf8')

  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  server.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk))

  try {
    await waitForServer(DEV_URL, 120000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 4200, height: 1800 } })
    page.on('console', (message) => {
      console.log(`[browser:${message.type()}] ${message.text()}`)
    })
    page.on('pageerror', (error) => {
      console.error(`[browser:pageerror] ${error.stack ?? error.message}`)
    })
    console.log('[second-chord-spacing] opening app')
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    console.log('[second-chord-spacing] waiting for debug API')
    await waitForDebugApi(page)
    console.log('[second-chord-spacing] importing MusicXML')
    await importMusicXml(page, xmlText)

    const scenarios: ScenarioReport[] = []
    for (const scaleCase of SCALE_CASES) {
      console.log(`[second-chord-spacing] applying scale ${scaleCase.key}`)
      const appliedScale = await setScoreScale(page, scaleCase)
      console.log(`[second-chord-spacing] collecting rows for ${scaleCase.key}`)
      const mergedRows = await collectMergedRows(page)
      scenarios.push(analyzeScenario(mergedRows, appliedScale, scaleCase.key))
    }

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      scenarios,
    }

    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    scenarios.forEach((scenario) => {
      console.log(
        `[second-chord-spacing] ${scenario.key}: ${scenario.passed ? 'PASS' : 'FAIL'} ` +
          `(scale=${scenario.scale.scoreScale ?? 'n/a'})`,
      )
      scenario.targets.forEach((target) => {
        console.log(
          `  pair=${target.pairIndex} page=${target.renderedPageIndex ?? 'n/a'} direction=${target.direction} ` +
            `measureWidth=${target.measureWidth ?? 'null'} baseMeasureWidth=${target.baseMeasureWidthPx ?? 'null'} ` +
            `reserveWidth=${target.totalReserveWidthPx ?? 'null'} ` +
            `headXs=${JSON.stringify(target.headXs)} visibleLeftGap=${target.visibleLeftGapPx} ` +
            `visibleRightGap=${target.visibleRightGapPx} reportedLeftGap=${target.effectiveLeftGapPx} ` +
            `reportedRightGap=${target.effectiveRightGapPx} occupiedLeft=${target.spacingOccupiedLeftX} ` +
            `occupiedRight=${target.spacingOccupiedRightX} boundaryStart=${target.effectiveBoundaryStartX} ` +
            `boundaryEnd=${target.effectiveBoundaryEndX} overflowNoteEnd=${target.overflowVsNoteEndX} ` +
          `overflowBar=${target.overflowVsMeasureEndBarX} onsetReserve=${JSON.stringify(target.onsetReserve)} ` +
            `prevSegment=${JSON.stringify(target.previousSegment)} nextSegment=${JSON.stringify(target.nextSegment)} ` +
            `candidates=${JSON.stringify(target.candidateNotes)} ` +
            `${target.passed ? 'PASS' : 'FAIL'}`,
        )
      })
    })
    console.log(`Generated: ${reportPath}`)

    if (!scenarios.every((scenario) => scenario.passed)) {
      throw new Error('Second-chord spacing regression detected.')
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
