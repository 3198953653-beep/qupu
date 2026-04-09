import { Renderer, Stave } from 'vexflow'
import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH, TICKS_PER_BEAT } from '../constants'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import { drawMeasureToContext } from '../render/drawMeasure'
import type { MeasureFrame, MeasurePair, TimeSignature } from '../types'
import type { SystemMeasureRange } from './demand'
import { resolveEffectiveBoundary } from './effectiveBoundary'
import {
  applyMeasureStartDecorationsToStave,
  measureActualStartDecorationWidthPx,
  resolveMeasureStartDecorationReserve,
  toTimeSignatureKey,
} from './startDecorationReserve'
import {
  attachMeasureTimelineAxisLayout,
  buildMeasureTimelineBundle,
  getMeasureUniformTimelineWeightMetrics,
  getTimeAxisGapWeightPx,
  resolvePublicAxisLayoutForConsumption,
  type TimeAxisSpacingConfig,
} from './timeAxisSpacing'
import type { MeasureTimelineBundle } from '../timeline/types'

const MIN_FORMAT_WIDTH_PX = 8
const PROBE_MEASURE_X = 1024
const PROBE_MEASURE_WIDTH_PX = 320
const FIXED_WIDTH_OVERFLOW_PAD_PX = 2
const FIXED_WIDTH_OVERFLOW_MAX_PASSES = 12
const FIT_EPS = 0.0001

type FixedWidthMeasureMeta = {
  pairIndex: number
  measure: MeasurePair
  isSystemStart: boolean
  keyFifths: number
  showKeySignature: boolean
  timeSignature: TimeSignature
  showTimeSignature: boolean
  nextTimeSignature: TimeSignature
  showEndTimeSignature: boolean
  actualStartDecorationWidthPx: number
  showStartBoundaryReserve: boolean
  preferMeasureStartBarlineAxis: boolean
  preferMeasureEndBarlineAxis: boolean
}

type FixedWidthMeasureBasis = {
  meta: FixedWidthMeasureMeta
  timelineBundle: MeasureTimelineBundle
  leadingGapPx: number
  elasticBasisPx: number
  actualStartDecorationWidthPx: number
  fixedWidthBasePx: number
}

export type NativePreviewSolvedMeasure = {
  pairIndex: number
  measureWidth: number
  contentMeasureWidth: number
  fixedWidthPx: number
  elasticWidthPx: number
  actualStartDecorationWidthPx: number
}

export type NativePreviewSystemLayout = {
  range: SystemMeasureRange
  measures: NativePreviewSolvedMeasure[]
  equivalentEighthGapPx: number
  elasticScale: number
  fixedWidthTotalPx: number
  elasticWidthTotalPx: number
  usableWidthPx: number
  totalWidthPx: number
}

export type NativePreviewPageLayout = {
  pageIndex: number
  pageNumber: number
  systemLayouts: NativePreviewSystemLayout[]
  systemRanges: SystemMeasureRange[]
  systemTopPxBySystemIndex: number[]
  measureFramesByPair: MeasureFrame[]
  actualSystemGapPx: number
  minEquivalentEighthGapPx: number
}

export type NativePreviewLayoutResult = {
  pages: NativePreviewPageLayout[]
}

function resolveTimeSignatureSeries(
  measurePairsLength: number,
  timeSignaturesByPair: TimeSignature[] | null,
): TimeSignature[] {
  const resolved: TimeSignature[] = []
  let previous: TimeSignature = { beats: 4, beatType: 4 }
  for (let pairIndex = 0; pairIndex < measurePairsLength; pairIndex += 1) {
    const timeSignature = timeSignaturesByPair?.[pairIndex] ?? previous
    resolved.push(timeSignature)
    previous = timeSignature
  }
  return resolved
}

function resolveKeyFifthsSeries(measurePairsLength: number, keyFifthsByPair: number[] | null): number[] {
  const resolved: number[] = []
  let previous = 0
  for (let pairIndex = 0; pairIndex < measurePairsLength; pairIndex += 1) {
    const keyFifths = keyFifthsByPair?.[pairIndex] ?? previous
    resolved.push(keyFifths)
    previous = keyFifths
  }
  return resolved
}

function hasTimeSignatureChanged(current: TimeSignature, previous: TimeSignature): boolean {
  return current.beats !== previous.beats || current.beatType !== previous.beatType
}

function getMeasureTicks(timeSignature: TimeSignature): number {
  return Math.max(1, Math.round(timeSignature.beats * TICKS_PER_BEAT * (4 / timeSignature.beatType)))
}

function getLayoutSpacingRightX(layout: { spacingRightX: number; rightX: number; x: number }): number {
  if (Number.isFinite(layout.spacingRightX)) return layout.spacingRightX
  if (Number.isFinite(layout.rightX)) return layout.rightX
  return layout.x
}

function getMeasureSpacingRightEdge(params: {
  layouts: Array<{ spacingRightX: number; rightX: number; x: number }>
  spacingMetrics?: { spacingOccupiedRightX?: number } | null
}): number {
  const { layouts, spacingMetrics = null } = params
  let rightX = Number.NEGATIVE_INFINITY
  layouts.forEach((layout) => {
    rightX = Math.max(rightX, getLayoutSpacingRightX(layout))
  })
  const occupiedRightX = spacingMetrics?.spacingOccupiedRightX
  if (Number.isFinite(occupiedRightX)) {
    rightX = Math.max(rightX, occupiedRightX as number)
  }
  return rightX
}

function buildSystemMeasureMeta(params: {
  measurePairs: MeasurePair[]
  range: SystemMeasureRange
  resolvedKeyFifths: number[]
  resolvedTimeSignatures: TimeSignature[]
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}): FixedWidthMeasureMeta[] {
  const {
    measurePairs,
    range,
    resolvedKeyFifths,
    resolvedTimeSignatures,
    grandStaffLayoutMetrics,
  } = params
  const metas: FixedWidthMeasureMeta[] = []
  for (let pairIndex = range.startPairIndex; pairIndex < range.endPairIndexExclusive; pairIndex += 1) {
    const measure = measurePairs[pairIndex]
    if (!measure) continue
    const isSystemStart = pairIndex === range.startPairIndex
    const previousKeyFifths = pairIndex > 0 ? resolvedKeyFifths[pairIndex - 1] ?? 0 : 0
    const previousTimeSignature =
      pairIndex > 0 ? resolvedTimeSignatures[pairIndex - 1] ?? { beats: 4, beatType: 4 } : { beats: 4, beatType: 4 }
    const keyFifths = resolvedKeyFifths[pairIndex] ?? previousKeyFifths
    const timeSignature = resolvedTimeSignatures[pairIndex] ?? previousTimeSignature
    const showKeySignature = isSystemStart || keyFifths !== previousKeyFifths
    const showTimeSignature = isSystemStart || hasTimeSignatureChanged(timeSignature, previousTimeSignature)
    const nextTimeSignature =
      pairIndex + 1 < measurePairs.length
        ? resolvedTimeSignatures[pairIndex + 1] ?? timeSignature
        : timeSignature
    const showEndTimeSignature =
      pairIndex === range.endPairIndexExclusive - 1 &&
      pairIndex + 1 < measurePairs.length &&
      hasTimeSignatureChanged(nextTimeSignature, timeSignature)
    const actualStartDecorationWidthPx = measureActualStartDecorationWidthPx(
      {
        isSystemStart,
        keyFifths,
        showKeySignature,
        timeSignature,
        showTimeSignature,
      },
      grandStaffLayoutMetrics,
    )
    const startDecorationReserve = resolveMeasureStartDecorationReserve({
      actualStartDecorationWidthPx,
    })
    metas.push({
      pairIndex,
      measure,
      isSystemStart,
      keyFifths,
      showKeySignature,
      timeSignature,
      showTimeSignature,
      nextTimeSignature,
      showEndTimeSignature,
      actualStartDecorationWidthPx,
      showStartBoundaryReserve: startDecorationReserve.showStartBoundaryReserve,
      preferMeasureStartBarlineAxis: startDecorationReserve.preferMeasureStartBarlineAxis,
      preferMeasureEndBarlineAxis: !showEndTimeSignature,
    })
  }
  return metas
}

function getMeasureProbeGeometry(
  entry: FixedWidthMeasureMeta,
  trebleOffsetY: number,
  measureWidth: number = PROBE_MEASURE_WIDTH_PX,
): { noteStartOffset: number; noteEndOffset: number; formatWidth: number } {
  const safeWidth = Math.max(1, Number(measureWidth.toFixed(3)))
  const noteStartProbe = new Stave(0, trebleOffsetY, safeWidth)
  applyMeasureStartDecorationsToStave(noteStartProbe, 'treble', entry)
  if (entry.showEndTimeSignature) {
    noteStartProbe.setEndTimeSignature(toTimeSignatureKey(entry.nextTimeSignature))
  }
  const rawNoteEndOffset = noteStartProbe.getNoteEndX()
  const noteStartOffset = entry.preferMeasureStartBarlineAxis ? 0 : entry.actualStartDecorationWidthPx
  const noteEndOffset = rawNoteEndOffset
  return {
    noteStartOffset,
    noteEndOffset,
    formatWidth: Math.max(MIN_FORMAT_WIDTH_PX, noteEndOffset - noteStartOffset - 8),
  }
}

function buildMeasureBasis(params: {
  metas: FixedWidthMeasureMeta[]
  supplementalSpacingTicksByPair?: number[][] | null
  spacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}): FixedWidthMeasureBasis[] {
  const { metas, supplementalSpacingTicksByPair = null, spacingConfig, grandStaffLayoutMetrics } = params
  return metas.map((meta) => {
    const measureTicks = getMeasureTicks(meta.timeSignature)
    const timelineBundle = buildMeasureTimelineBundle({
      measure: meta.measure,
      measureIndex: meta.pairIndex,
      timeSignature: meta.timeSignature,
      spacingConfig,
      timelineMode: 'dual',
      supplementalSpacingTicks: supplementalSpacingTicksByPair?.[meta.pairIndex] ?? null,
    })
    const timelineMetrics = getMeasureUniformTimelineWeightMetrics(
      meta.measure,
      measureTicks,
      spacingConfig,
      timelineBundle,
    )
    const probeGeometry = getMeasureProbeGeometry(meta, grandStaffLayoutMetrics.trebleOffsetY)
    const endDecorationReservePx = meta.preferMeasureEndBarlineAxis
      ? 0
      : Math.max(0, PROBE_MEASURE_WIDTH_PX - probeGeometry.noteEndOffset)
    return {
      meta,
      timelineBundle,
      leadingGapPx: timelineMetrics.leadingGapPx,
      elasticBasisPx: Math.max(0, timelineMetrics.anchorSpanPx + timelineMetrics.trailingGapPx),
      actualStartDecorationWidthPx: meta.actualStartDecorationWidthPx,
      fixedWidthBasePx: meta.actualStartDecorationWidthPx + endDecorationReservePx + timelineMetrics.leadingGapPx,
    }
  })
}

function solveSystemWidths(params: {
  bases: FixedWidthMeasureBasis[]
  usableWidthPx: number
  fixedWidthBonuses?: number[]
}): {
  elasticScale: number
  fixedWidthTotalPx: number
  elasticWidthTotalPx: number
  measureWidths: number[]
  totalWidthPx: number
} {
  const { bases, usableWidthPx, fixedWidthBonuses = [] } = params
  const fixedWidthTotalPx = bases.reduce(
    (sum, basis, index) => sum + basis.fixedWidthBasePx + (fixedWidthBonuses[index] ?? 0),
    0,
  )
  const elasticWidthTotalPx = bases.reduce((sum, basis) => sum + basis.elasticBasisPx, 0)
  const safeUsableWidthPx = Math.max(1, usableWidthPx)
  const elasticScale =
    elasticWidthTotalPx > FIT_EPS
      ? Math.max(0, (safeUsableWidthPx - fixedWidthTotalPx) / elasticWidthTotalPx)
      : 0
  const measureWidths = bases.map((basis, index) =>
    Math.max(1, basis.fixedWidthBasePx + (fixedWidthBonuses[index] ?? 0) + basis.elasticBasisPx * elasticScale),
  )
  const totalWidthPx = measureWidths.reduce((sum, width) => sum + width, 0)
  if (measureWidths.length > 0 && fixedWidthTotalPx <= safeUsableWidthPx + FIT_EPS) {
    const delta = safeUsableWidthPx - totalWidthPx
    measureWidths[measureWidths.length - 1] = Math.max(1, measureWidths[measureWidths.length - 1] + delta)
  }
  return {
    elasticScale,
    fixedWidthTotalPx,
    elasticWidthTotalPx,
    measureWidths,
    totalWidthPx: measureWidths.reduce((sum, width) => sum + width, 0),
  }
}

function probeMeasureOverflow(params: {
  context: ReturnType<Renderer['getContext']>
  basis: FixedWidthMeasureBasis
  measureWidth: number
  spacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  showNoteHeadJianpu: boolean
}): number {
  const { context, basis, measureWidth, spacingConfig, grandStaffLayoutMetrics, showNoteHeadJianpu } = params
  const probeGeometry = getMeasureProbeGeometry(basis.meta, grandStaffLayoutMetrics.trebleOffsetY, measureWidth)
  const measureX = PROBE_MEASURE_X
  const noteStartX = measureX + probeGeometry.noteStartOffset
  const noteEndX = measureX + probeGeometry.noteEndOffset
  const spacingRightLimitX = basis.meta.preferMeasureEndBarlineAxis ? measureX + measureWidth : noteEndX
  const effectiveBoundary = resolveEffectiveBoundary({
    measureX,
    measureWidth,
    noteStartX,
    noteEndX,
    showStartDecorations: basis.meta.showStartBoundaryReserve,
    showEndDecorations: !basis.meta.preferMeasureEndBarlineAxis,
  })
  const timelineBundle = attachMeasureTimelineAxisLayout({
    bundle: basis.timelineBundle,
    effectiveBoundaryStartX: effectiveBoundary.effectiveStartX,
    effectiveBoundaryEndX: effectiveBoundary.effectiveEndX,
    widthPx: measureWidth,
    spacingConfig,
  })
  let spacingMetrics: { spacingOccupiedRightX?: number } | null = null
  const layouts = drawMeasureToContext({
    context,
    measure: basis.meta.measure,
    pairIndex: basis.meta.pairIndex,
    measureX,
    measureWidth,
    trebleY: grandStaffLayoutMetrics.trebleOffsetY,
    bassY: grandStaffLayoutMetrics.bassOffsetY,
    isSystemStart: basis.meta.isSystemStart,
    keyFifths: basis.meta.keyFifths,
    showKeySignature: basis.meta.showKeySignature,
    timeSignature: basis.meta.timeSignature,
    showTimeSignature: basis.meta.showTimeSignature,
    endTimeSignature: basis.meta.nextTimeSignature,
    showEndTimeSignature: basis.meta.showEndTimeSignature,
    activeSelection: null,
    draggingSelection: null,
    activeSelections: null,
    draggingSelections: null,
    beamHighlightFrameScope: null,
    beamHighlightMode: 'default',
    collectLayouts: true,
    skipPainting: true,
    noteStartXOverride: noteStartX,
    formatWidthOverride: probeGeometry.formatWidth,
    timeAxisSpacingConfig: spacingConfig,
    spacingLayoutMode: 'custom',
    timelineBundle,
    publicAxisLayout: resolvePublicAxisLayoutForConsumption(timelineBundle),
    spacingAnchorTicks: timelineBundle.spacingAnchorTicks ?? null,
    staticAnchorXById: null,
    staticAccidentalRightXById: null,
    layoutDetail: 'full',
    showMeasureNumberLabel: false,
    showNoteHeadJianpu,
    allowTrebleFullMeasureRestCollapse: false,
    allowBassFullMeasureRestCollapse: false,
    preferMeasureEndBarlineAxis: basis.meta.preferMeasureEndBarlineAxis,
    preferMeasureBarlineAxis: basis.meta.preferMeasureStartBarlineAxis,
    enableEdgeGapCap: true,
    onSpacingMetrics: (metrics) => {
      spacingMetrics = metrics as { spacingOccupiedRightX?: number } | null
    },
  })
  const spacingRightEdge = getMeasureSpacingRightEdge({
    layouts,
    spacingMetrics,
  })
  if (!Number.isFinite(spacingRightEdge)) return 0
  return Math.max(0, spacingRightEdge - spacingRightLimitX)
}

export function solveNativePreviewSystemLayout(params: {
  context: ReturnType<Renderer['getContext']>
  measurePairs: MeasurePair[]
  range: SystemMeasureRange
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  supplementalSpacingTicksByPair?: number[][] | null
  spacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  usableWidthPx: number
  showNoteHeadJianpu: boolean
}): NativePreviewSystemLayout {
  const {
    context,
    measurePairs,
    range,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair = null,
    spacingConfig,
    grandStaffLayoutMetrics,
    usableWidthPx,
    showNoteHeadJianpu,
  } = params

  const resolvedKeyFifths = resolveKeyFifthsSeries(measurePairs.length, measureKeyFifthsFromImport)
  const resolvedTimeSignatures = resolveTimeSignatureSeries(measurePairs.length, measureTimeSignaturesFromImport)
  const metas = buildSystemMeasureMeta({
    measurePairs,
    range,
    resolvedKeyFifths,
    resolvedTimeSignatures,
    grandStaffLayoutMetrics,
  })
  const bases = buildMeasureBasis({
    metas,
    supplementalSpacingTicksByPair,
    spacingConfig,
    grandStaffLayoutMetrics,
  })
  const fixedWidthBonuses = new Array<number>(bases.length).fill(0)
  let solved = solveSystemWidths({
    bases,
    usableWidthPx,
    fixedWidthBonuses,
  })

  for (let pass = 0; pass < FIXED_WIDTH_OVERFLOW_MAX_PASSES; pass += 1) {
    let changed = false
    bases.forEach((basis, index) => {
      const overflowPx = probeMeasureOverflow({
        context,
        basis,
        measureWidth: solved.measureWidths[index] ?? Math.max(1, basis.fixedWidthBasePx),
        spacingConfig,
        grandStaffLayoutMetrics,
        showNoteHeadJianpu,
      })
      if (overflowPx <= FIT_EPS) return
      fixedWidthBonuses[index] = (fixedWidthBonuses[index] ?? 0) + overflowPx + FIXED_WIDTH_OVERFLOW_PAD_PX
      changed = true
    })
    if (!changed) break
    solved = solveSystemWidths({
      bases,
      usableWidthPx,
      fixedWidthBonuses,
    })
  }

  const measures = bases.map((basis, index) => {
    const measureWidth = solved.measureWidths[index] ?? Math.max(1, basis.fixedWidthBasePx)
    const fixedWidthPx = basis.fixedWidthBasePx + (fixedWidthBonuses[index] ?? 0)
    const elasticWidthPx = Math.max(0, measureWidth - fixedWidthPx)
    return {
      pairIndex: basis.meta.pairIndex,
      measureWidth,
      contentMeasureWidth: Math.max(1, measureWidth - basis.actualStartDecorationWidthPx),
      fixedWidthPx,
      elasticWidthPx,
      actualStartDecorationWidthPx: basis.actualStartDecorationWidthPx,
    } satisfies NativePreviewSolvedMeasure
  })

  return {
    range,
    measures,
    equivalentEighthGapPx: getTimeAxisGapWeightPx(8, spacingConfig) * solved.elasticScale,
    elasticScale: solved.elasticScale,
    fixedWidthTotalPx: solved.fixedWidthTotalPx,
    elasticWidthTotalPx: solved.elasticWidthTotalPx * solved.elasticScale,
    usableWidthPx,
    totalWidthPx: solved.totalWidthPx,
  }
}

function paginateNativePreviewSystems(params: {
  systemLayouts: NativePreviewSystemLayout[]
  horizontalMarginPx: number
  firstPageTopMarginPx: number
  topMarginPx: number
  bottomMarginPx: number
  minGrandStaffGapPx: number
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}): NativePreviewPageLayout[] {
  const {
    systemLayouts,
    horizontalMarginPx,
    firstPageTopMarginPx,
    topMarginPx,
    bottomMarginPx,
    minGrandStaffGapPx,
    grandStaffLayoutMetrics,
  } = params
  if (systemLayouts.length === 0) {
    return [{
      pageIndex: 0,
      pageNumber: 1,
      systemLayouts: [],
      systemRanges: [],
      systemTopPxBySystemIndex: [],
      measureFramesByPair: [],
      actualSystemGapPx: 0,
      minEquivalentEighthGapPx: 0,
    }]
  }

  const pages: NativePreviewPageLayout[] = []
  let systemIndex = 0
  while (systemIndex < systemLayouts.length) {
    const isFirstPage = pages.length === 0
    const topMarginForPage = isFirstPage ? firstPageTopMarginPx : topMarginPx
    const usableHeightPx = A4_PAGE_HEIGHT - bottomMarginPx - topMarginForPage
    let endExclusive = systemIndex

    while (endExclusive < systemLayouts.length) {
      const candidateCount = endExclusive - systemIndex + 1
      const remainingHeightPx = usableHeightPx - candidateCount * grandStaffLayoutMetrics.systemHeightPx
      if (candidateCount === 1) {
        endExclusive += 1
        continue
      }
      const actualGapPx = remainingHeightPx / (candidateCount - 1)
      if (remainingHeightPx >= -FIT_EPS && actualGapPx + FIT_EPS >= minGrandStaffGapPx) {
        endExclusive += 1
        continue
      }
      break
    }

    if (endExclusive === systemIndex) {
      endExclusive = systemIndex + 1
    }

    const pageSystems = systemLayouts.slice(systemIndex, endExclusive)
    const count = pageSystems.length
    const remainingHeightPx = usableHeightPx - count * grandStaffLayoutMetrics.systemHeightPx
    const actualSystemGapPx =
      count > 1 ? Math.max(0, remainingHeightPx / Math.max(1, count - 1)) : 0
    const systemTopPxBySystemIndex = pageSystems.map(
      (_layout, index) => topMarginForPage + index * (grandStaffLayoutMetrics.systemHeightPx + actualSystemGapPx),
    )
    const measureFramesByPair: MeasureFrame[] = []
    pageSystems.forEach((systemLayout) => {
      let cursorX = horizontalMarginPx
      systemLayout.measures.forEach((measure) => {
        measureFramesByPair[measure.pairIndex] = {
          measureX: cursorX,
          measureWidth: measure.measureWidth,
          contentMeasureWidth: measure.contentMeasureWidth,
          renderedMeasureWidth: measure.measureWidth,
          actualStartDecorationWidthPx: measure.actualStartDecorationWidthPx,
        }
        cursorX += measure.measureWidth
      })
    })
    pages.push({
      pageIndex: pages.length,
      pageNumber: pages.length + 1,
      systemLayouts: pageSystems,
      systemRanges: pageSystems.map((system) => system.range),
      systemTopPxBySystemIndex,
      measureFramesByPair,
      actualSystemGapPx,
      minEquivalentEighthGapPx: pageSystems.reduce(
        (minGap, system) => Math.min(minGap, system.equivalentEighthGapPx),
        Number.POSITIVE_INFINITY,
      ),
    })
    systemIndex = endExclusive
  }

  return pages
}

export function buildNativePreviewLayout(params: {
  context: ReturnType<Renderer['getContext']>
  measurePairs: MeasurePair[]
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  supplementalSpacingTicksByPair?: number[][] | null
  spacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  horizontalMarginPx: number
  firstPageTopMarginPx: number
  topMarginPx: number
  bottomMarginPx: number
  minEighthGapPx: number
  minGrandStaffGapPx: number
  showNoteHeadJianpu: boolean
}): NativePreviewLayoutResult {
  const {
    context,
    measurePairs,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair = null,
    spacingConfig,
    grandStaffLayoutMetrics,
    horizontalMarginPx,
    firstPageTopMarginPx,
    topMarginPx,
    bottomMarginPx,
    minEighthGapPx,
    minGrandStaffGapPx,
    showNoteHeadJianpu,
  } = params

  if (measurePairs.length === 0) {
    return {
      pages: [{
        pageIndex: 0,
        pageNumber: 1,
        systemLayouts: [],
        systemRanges: [],
        systemTopPxBySystemIndex: [],
        measureFramesByPair: [],
        actualSystemGapPx: 0,
        minEquivalentEighthGapPx: 0,
      }],
    }
  }

  const usableWidthPx = Math.max(1, A4_PAGE_WIDTH - horizontalMarginPx * 2)
  const solvedSystemCache = new Map<string, NativePreviewSystemLayout>()
  const getSolvedSystem = (range: SystemMeasureRange): NativePreviewSystemLayout => {
    const key = `${range.startPairIndex}:${range.endPairIndexExclusive}`
    const cached = solvedSystemCache.get(key)
    if (cached) return cached
    const solved = solveNativePreviewSystemLayout({
      context,
      measurePairs,
      range,
      measureKeyFifthsFromImport,
      measureTimeSignaturesFromImport,
      supplementalSpacingTicksByPair,
      spacingConfig,
      grandStaffLayoutMetrics,
      usableWidthPx,
      showNoteHeadJianpu,
    })
    solvedSystemCache.set(key, solved)
    return solved
  }

  const systemLayouts: NativePreviewSystemLayout[] = []
  let startPairIndex = 0
  while (startPairIndex < measurePairs.length) {
    let endPairIndexExclusive = startPairIndex + 1
    let bestLayout = getSolvedSystem({
      startPairIndex,
      endPairIndexExclusive,
    })
    while (endPairIndexExclusive <= measurePairs.length) {
      const candidateLayout = getSolvedSystem({
        startPairIndex,
        endPairIndexExclusive,
      })
      const canFitByGap =
        candidateLayout.equivalentEighthGapPx + FIT_EPS >= minEighthGapPx &&
        candidateLayout.totalWidthPx <= usableWidthPx + FIT_EPS
      if (canFitByGap) {
        bestLayout = candidateLayout
        endPairIndexExclusive += 1
        continue
      }
      if (endPairIndexExclusive === startPairIndex + 1) {
        bestLayout = candidateLayout
      }
      break
    }
    systemLayouts.push(bestLayout)
    startPairIndex = bestLayout.range.endPairIndexExclusive
  }

  return {
    pages: paginateNativePreviewSystems({
      systemLayouts,
      horizontalMarginPx,
      firstPageTopMarginPx,
      topMarginPx,
      bottomMarginPx,
      minGrandStaffGapPx,
      grandStaffLayoutMetrics,
    }),
  }
}
