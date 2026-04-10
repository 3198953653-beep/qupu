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
  resolveStartDecorationDisplayMetas,
  toTimeSignatureKey,
} from './startDecorationReserve'
import {
  buildEffectiveSpacingTicks,
  attachMeasureTimelineAxisLayout,
  buildMeasureTimelineBundle,
  getMeasureUniformTimelineWeightMetrics,
  getTimeAxisGapWeightPx,
  resolveMeasureMinWidthStretchPlan,
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
  measureTicks: number
  timelineBundle: MeasureTimelineBundle
  baseSpacingAnchorCount: number
  previewSpacingAnchorTicks: number[]
  leadingGapPx: number
  elasticBasisPx: number
  actualStartDecorationWidthPx: number
  fixedWidthBasePx: number
  baseTimelineStretchScale: number
}

export type NativePreviewSolvedMeasure = {
  pairIndex: number
  measureWidth: number
  contentMeasureWidth: number
  fixedWidthPx: number
  elasticWidthPx: number
  actualStartDecorationWidthPx: number
  showTimeSignature: boolean
  timelineStretchScale: number
  previewSpacingAnchorTicks: number[] | null
}

export type NativePreviewSystemLayout = {
  range: SystemMeasureRange
  measures: NativePreviewSolvedMeasure[]
  equivalentEighthGapPx: number
  equivalentEighthGapNotationPx: number
  elasticScale: number
  fixedWidthTotalPx: number
  fixedWidthTotalNotationPx: number
  elasticWidthTotalPx: number
  elasticWidthTotalNotationPx: number
  usableWidthPx: number
  usableWidthNotationPx: number
  totalWidthPx: number
  totalWidthNotationPx: number
}

export type NativePreviewPageLayout = {
  pageIndex: number
  pageNumber: number
  notationScale: number
  systemLayouts: NativePreviewSystemLayout[]
  systemRanges: SystemMeasureRange[]
  systemTopPxBySystemIndex: number[]
  measureFramesByPair: MeasureFrame[]
  actualSystemGapPx: number
  actualSystemGapNotationPx: number
  minEquivalentEighthGapPx: number
  minEquivalentEighthGapNotationPx: number
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

function getBeatTickStep(timeSignature: TimeSignature): number {
  return Math.max(1, Math.round(TICKS_PER_BEAT * (4 / timeSignature.beatType)))
}

function buildPreviewSpacingAnchorTicks(params: {
  measure: MeasurePair
  measureTicks: number
  timeSignature: TimeSignature
  supplementalSpacingTicks?: readonly number[] | null
  enableSparseExpansion: boolean
}): number[] {
  const {
    measure,
    measureTicks,
    timeSignature,
    supplementalSpacingTicks = null,
    enableSparseExpansion,
  } = params
  const baseTicks = buildEffectiveSpacingTicks({
    measure,
    measureTicks,
    supplementalTicks: supplementalSpacingTicks,
  })
  if (!enableSparseExpansion || baseTicks.length > 2) {
    return baseTicks
  }
  const tickSet = new Set<number>(baseTicks)
  const beatTickStep = getBeatTickStep(timeSignature)
  for (let tick = 0; tick <= measureTicks; tick += beatTickStep) {
    tickSet.add(Math.max(0, Math.min(measureTicks, tick)))
  }
  tickSet.add(measureTicks)
  return [...tickSet]
    .filter((tick) => Number.isFinite(tick))
    .sort((left, right) => left - right)
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
  const displayMetaByPairIndex = new Map(
    resolveStartDecorationDisplayMetas({
      measureCount: measurePairs.length,
      keyFifthsByPair: resolvedKeyFifths,
      timeSignaturesByPair: resolvedTimeSignatures,
      systemStartPairIndices: new Set([range.startPairIndex]),
      repeatTimeSignatureAtSystemStart: false,
    }).map((meta) => [meta.pairIndex, meta] as const),
  )
  const metas: FixedWidthMeasureMeta[] = []
  for (let pairIndex = range.startPairIndex; pairIndex < range.endPairIndexExclusive; pairIndex += 1) {
    const measure = measurePairs[pairIndex]
    if (!measure) continue
    const displayMeta = displayMetaByPairIndex.get(pairIndex)
    if (!displayMeta) continue
    const isSystemStart = displayMeta.isSystemStart
    const keyFifths = displayMeta.keyFifths
    const timeSignature = displayMeta.timeSignature
    const showKeySignature = displayMeta.showKeySignature
    const showTimeSignature = displayMeta.showTimeSignature
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
  sparseExpansionPairIndexSet?: ReadonlySet<number>
}): FixedWidthMeasureBasis[] {
  const {
    metas,
    supplementalSpacingTicksByPair = null,
    spacingConfig,
    grandStaffLayoutMetrics,
    sparseExpansionPairIndexSet = new Set<number>(),
  } = params
  return metas.map((meta) => {
    const measureTicks = getMeasureTicks(meta.timeSignature)
    const baseSpacingAnchorTicks = buildEffectiveSpacingTicks({
      measure: meta.measure,
      measureTicks,
      supplementalTicks: supplementalSpacingTicksByPair?.[meta.pairIndex] ?? null,
    })
    const previewSpacingAnchorTicks = buildPreviewSpacingAnchorTicks({
      measure: meta.measure,
      measureTicks,
      timeSignature: meta.timeSignature,
      supplementalSpacingTicks: supplementalSpacingTicksByPair?.[meta.pairIndex] ?? null,
      enableSparseExpansion: sparseExpansionPairIndexSet.has(meta.pairIndex),
    })
    const timelineBundle = {
      ...buildMeasureTimelineBundle({
        measure: meta.measure,
        measureIndex: meta.pairIndex,
        timeSignature: meta.timeSignature,
        spacingConfig,
        timelineMode: 'dual',
        supplementalSpacingTicks: supplementalSpacingTicksByPair?.[meta.pairIndex] ?? null,
      }),
      spacingAnchorTicks: previewSpacingAnchorTicks,
    }
    const timelineMetrics = getMeasureUniformTimelineWeightMetrics(
      meta.measure,
      measureTicks,
      spacingConfig,
      timelineBundle,
    )
    const baseStretchPlan = resolveMeasureMinWidthStretchPlan({
      spacingConfig,
      leadingGapPx: timelineMetrics.leadingGapPx,
      anchorSpanPx: timelineMetrics.anchorSpanPx,
      trailingGapPx: timelineMetrics.trailingGapPx,
    })
    const elasticBasisPx = Math.max(
      0,
      (timelineMetrics.anchorSpanPx + timelineMetrics.trailingGapPx) * baseStretchPlan.segmentStretchScale,
    )
    const probeGeometry = getMeasureProbeGeometry(meta, grandStaffLayoutMetrics.trebleOffsetY)
    const endDecorationReservePx = meta.preferMeasureEndBarlineAxis
      ? 0
      : Math.max(0, PROBE_MEASURE_WIDTH_PX - probeGeometry.noteEndOffset)
    return {
      meta,
      measureTicks,
      timelineBundle,
      baseSpacingAnchorCount: baseSpacingAnchorTicks.length,
      previewSpacingAnchorTicks,
      leadingGapPx: timelineMetrics.leadingGapPx,
      elasticBasisPx,
      actualStartDecorationWidthPx: meta.actualStartDecorationWidthPx,
      fixedWidthBasePx: meta.actualStartDecorationWidthPx + endDecorationReservePx + timelineMetrics.leadingGapPx,
      baseTimelineStretchScale: baseStretchPlan.segmentStretchScale,
    }
  })
}

function solveSystemWidths(params: {
  bases: FixedWidthMeasureBasis[]
  usableWidthNotationPx: number
  fixedWidthBonuses?: number[]
}): {
  elasticScale: number
  fixedWidthTotalPx: number
  elasticBasisTotalPx: number
  measureWidths: number[]
  totalWidthPx: number
} {
  const { bases, usableWidthNotationPx, fixedWidthBonuses = [] } = params
  const fixedWidthTotalPx = bases.reduce(
    (sum, basis, index) => sum + basis.fixedWidthBasePx + (fixedWidthBonuses[index] ?? 0),
    0,
  )
  const elasticBasisTotalPx = bases.reduce((sum, basis) => sum + basis.elasticBasisPx, 0)
  const safeUsableWidthPx = Math.max(1, usableWidthNotationPx)
  const elasticScale =
    elasticBasisTotalPx > FIT_EPS
      ? Math.max(FIT_EPS, (safeUsableWidthPx - fixedWidthTotalPx) / elasticBasisTotalPx)
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
    elasticBasisTotalPx,
    measureWidths,
    totalWidthPx: measureWidths.reduce((sum, width) => sum + width, 0),
  }
}

function arePairIndexSetsEqual(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

function probeMeasureOverflow(params: {
  context: ReturnType<Renderer['getContext']>
  basis: FixedWidthMeasureBasis
  measureWidth: number
  spacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  showNoteHeadJianpu: boolean
  timelineStretchScale?: number | null
}): number {
  const {
    context,
    basis,
    measureWidth,
    spacingConfig,
    grandStaffLayoutMetrics,
    showNoteHeadJianpu,
    timelineStretchScale = null,
  } = params
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
    timelineScaleOverride: timelineStretchScale,
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
    spacingAnchorTicks: basis.previewSpacingAnchorTicks.length > 0 ? basis.previewSpacingAnchorTicks : timelineBundle.spacingAnchorTicks ?? null,
    timelineStretchScaleOverride: timelineStretchScale,
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

function solveNativePreviewSystemPass(params: {
  context: ReturnType<Renderer['getContext']>
  measurePairs: MeasurePair[]
  range: SystemMeasureRange
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  supplementalSpacingTicksByPair?: number[][] | null
  spacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  usableWidthNotationPx: number
  showNoteHeadJianpu: boolean
  sparseExpansionPairIndexSet?: ReadonlySet<number>
}): {
  bases: FixedWidthMeasureBasis[]
  fixedWidthBonuses: number[]
  solved: ReturnType<typeof solveSystemWidths>
} {
  const {
    context,
    measurePairs,
    range,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair = null,
    spacingConfig,
    grandStaffLayoutMetrics,
    usableWidthNotationPx,
    showNoteHeadJianpu,
    sparseExpansionPairIndexSet = new Set<number>(),
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
    sparseExpansionPairIndexSet,
  })
  const fixedWidthBonuses = new Array<number>(bases.length).fill(0)
  let solved = solveSystemWidths({
    bases,
    usableWidthNotationPx,
    fixedWidthBonuses,
  })

  for (let pass = 0; pass < FIXED_WIDTH_OVERFLOW_MAX_PASSES; pass += 1) {
    let changed = false
    bases.forEach((basis, index) => {
      const finalTimelineStretchScale =
        basis.elasticBasisPx > FIT_EPS
          ? basis.baseTimelineStretchScale * solved.elasticScale
          : basis.baseTimelineStretchScale
      const overflowPx = probeMeasureOverflow({
        context,
        basis,
        measureWidth: solved.measureWidths[index] ?? Math.max(1, basis.fixedWidthBasePx),
        spacingConfig,
        grandStaffLayoutMetrics,
        showNoteHeadJianpu,
        timelineStretchScale: finalTimelineStretchScale,
      })
      if (overflowPx <= FIT_EPS) return
      fixedWidthBonuses[index] = (fixedWidthBonuses[index] ?? 0) + overflowPx + FIXED_WIDTH_OVERFLOW_PAD_PX
      changed = true
    })
    if (!changed) break
    solved = solveSystemWidths({
      bases,
      usableWidthNotationPx,
      fixedWidthBonuses,
    })
  }

  return {
    bases,
    fixedWidthBonuses,
    solved,
  }
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
  usableWidthNotationPx: number
  notationScale: number
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
    usableWidthNotationPx,
    notationScale,
    showNoteHeadJianpu,
  } = params
  const safeNotationScale = Number.isFinite(notationScale) && notationScale > 0 ? notationScale : 1
  let sparseExpansionPairIndexSet = new Set<number>()
  let solvePass = solveNativePreviewSystemPass({
    context,
    measurePairs,
    range,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair,
    spacingConfig,
    grandStaffLayoutMetrics,
    usableWidthNotationPx,
    showNoteHeadJianpu,
    sparseExpansionPairIndexSet,
  })

  for (let pass = 0; pass < 2; pass += 1) {
    const nextSparseExpansionPairIndexSet = new Set<number>(sparseExpansionPairIndexSet)
    solvePass.bases.forEach((basis) => {
      const finalTimelineStretchScale =
        basis.elasticBasisPx > FIT_EPS
          ? basis.baseTimelineStretchScale * solvePass.solved.elasticScale
          : basis.baseTimelineStretchScale
      if (basis.baseSpacingAnchorCount <= 2 && finalTimelineStretchScale > 1 + FIT_EPS) {
        nextSparseExpansionPairIndexSet.add(basis.meta.pairIndex)
      }
    })
    if (arePairIndexSetsEqual(nextSparseExpansionPairIndexSet, sparseExpansionPairIndexSet)) {
      break
    }
    sparseExpansionPairIndexSet = nextSparseExpansionPairIndexSet
    solvePass = solveNativePreviewSystemPass({
      context,
      measurePairs,
      range,
      measureKeyFifthsFromImport,
      measureTimeSignaturesFromImport,
      supplementalSpacingTicksByPair,
      spacingConfig,
      grandStaffLayoutMetrics,
      usableWidthNotationPx,
      showNoteHeadJianpu,
      sparseExpansionPairIndexSet,
    })
  }

  const measures = solvePass.bases.map((basis, index) => {
    const measureWidth = solvePass.solved.measureWidths[index] ?? Math.max(1, basis.fixedWidthBasePx)
    const fixedWidthPx = basis.fixedWidthBasePx + (solvePass.fixedWidthBonuses[index] ?? 0)
    const elasticWidthPx = Math.max(0, measureWidth - fixedWidthPx)
    const finalTimelineStretchScale =
      basis.elasticBasisPx > FIT_EPS
        ? basis.baseTimelineStretchScale * solvePass.solved.elasticScale
        : basis.baseTimelineStretchScale
    return {
      pairIndex: basis.meta.pairIndex,
      measureWidth,
      contentMeasureWidth: Math.max(1, measureWidth - basis.actualStartDecorationWidthPx),
      fixedWidthPx,
      elasticWidthPx,
      actualStartDecorationWidthPx: basis.actualStartDecorationWidthPx,
      showTimeSignature: basis.meta.showTimeSignature,
      timelineStretchScale: finalTimelineStretchScale,
      previewSpacingAnchorTicks: basis.previewSpacingAnchorTicks.length > 0 ? [...basis.previewSpacingAnchorTicks] : null,
    } satisfies NativePreviewSolvedMeasure
  })
  const minTimelineStretchScale = measures.reduce(
    (minValue, measure) =>
      Number.isFinite(measure.timelineStretchScale)
        ? Math.min(minValue, measure.timelineStretchScale)
        : minValue,
    Number.POSITIVE_INFINITY,
  )
  const equivalentEighthGapNotationPx = Number.isFinite(minTimelineStretchScale)
    ? getTimeAxisGapWeightPx(8, spacingConfig) * Math.max(0, minTimelineStretchScale)
    : 0
  const elasticWidthTotalNotationPx = solvePass.solved.elasticBasisTotalPx * solvePass.solved.elasticScale

  return {
    range,
    measures,
    equivalentEighthGapPx: equivalentEighthGapNotationPx * safeNotationScale,
    equivalentEighthGapNotationPx,
    elasticScale: solvePass.solved.elasticScale,
    fixedWidthTotalPx: solvePass.solved.fixedWidthTotalPx * safeNotationScale,
    fixedWidthTotalNotationPx: solvePass.solved.fixedWidthTotalPx,
    elasticWidthTotalPx: elasticWidthTotalNotationPx * safeNotationScale,
    elasticWidthTotalNotationPx,
    usableWidthPx: usableWidthNotationPx * safeNotationScale,
    usableWidthNotationPx,
    totalWidthPx: solvePass.solved.totalWidthPx * safeNotationScale,
    totalWidthNotationPx: solvePass.solved.totalWidthPx,
  }
}

function paginateNativePreviewSystems(params: {
  systemLayouts: NativePreviewSystemLayout[]
  notationScale: number
  horizontalMarginPx: number
  firstPageTopMarginPx: number
  topMarginPx: number
  bottomMarginPx: number
  minGrandStaffGapPx: number
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}): NativePreviewPageLayout[] {
  const {
    systemLayouts,
    notationScale,
    horizontalMarginPx,
    firstPageTopMarginPx,
    topMarginPx,
    bottomMarginPx,
    minGrandStaffGapPx,
    grandStaffLayoutMetrics,
  } = params
  const safeNotationScale = Number.isFinite(notationScale) && notationScale > 0 ? notationScale : 1
  const horizontalMarginNotationPx = horizontalMarginPx / safeNotationScale
  const systemHeightNotationPx = grandStaffLayoutMetrics.systemHeightPx
  if (systemLayouts.length === 0) {
    return [{
      pageIndex: 0,
      pageNumber: 1,
      notationScale: safeNotationScale,
      systemLayouts: [],
      systemRanges: [],
      systemTopPxBySystemIndex: [],
      measureFramesByPair: [],
      actualSystemGapPx: 0,
      actualSystemGapNotationPx: 0,
      minEquivalentEighthGapPx: 0,
      minEquivalentEighthGapNotationPx: 0,
    }]
  }

  const pages: NativePreviewPageLayout[] = []
  let systemIndex = 0
  while (systemIndex < systemLayouts.length) {
    const isFirstPage = pages.length === 0
    const topMarginForPagePx = isFirstPage ? firstPageTopMarginPx : topMarginPx
    const topMarginForPageNotationPx = topMarginForPagePx / safeNotationScale
    const usableHeightNotationPx = Math.max(
      1,
      (A4_PAGE_HEIGHT - bottomMarginPx - topMarginForPagePx) / safeNotationScale,
    )
    let endExclusive = systemIndex

    while (endExclusive < systemLayouts.length) {
      const candidateCount = endExclusive - systemIndex + 1
      const remainingHeightNotationPx = usableHeightNotationPx - candidateCount * systemHeightNotationPx
      if (candidateCount === 1) {
        endExclusive += 1
        continue
      }
      const actualGapNotationPx = remainingHeightNotationPx / (candidateCount - 1)
      const actualGapPx = actualGapNotationPx * safeNotationScale
      if (remainingHeightNotationPx >= -FIT_EPS && actualGapPx + FIT_EPS >= minGrandStaffGapPx) {
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
    const remainingHeightNotationPx = usableHeightNotationPx - count * systemHeightNotationPx
    const actualSystemGapNotationPx =
      count > 1 ? Math.max(0, remainingHeightNotationPx / Math.max(1, count - 1)) : 0
    const actualSystemGapPx = actualSystemGapNotationPx * safeNotationScale
    const systemTopPxBySystemIndex = pageSystems.map(
      (_layout, index) =>
        topMarginForPageNotationPx + index * (systemHeightNotationPx + actualSystemGapNotationPx),
    )
    const measureFramesByPair: MeasureFrame[] = []
    pageSystems.forEach((systemLayout) => {
      let cursorX = horizontalMarginNotationPx
      systemLayout.measures.forEach((measure) => {
        measureFramesByPair[measure.pairIndex] = {
          measureX: cursorX,
          measureWidth: measure.measureWidth,
          contentMeasureWidth: measure.contentMeasureWidth,
          renderedMeasureWidth: measure.measureWidth,
          actualStartDecorationWidthPx: measure.actualStartDecorationWidthPx,
          timelineStretchScale: measure.timelineStretchScale,
          previewSpacingAnchorTicks:
            measure.previewSpacingAnchorTicks && measure.previewSpacingAnchorTicks.length > 0
              ? [...measure.previewSpacingAnchorTicks]
              : null,
        }
        cursorX += measure.measureWidth
      })
    })
    const minEquivalentEighthGapNotationPx = pageSystems.reduce(
      (minGap, system) => Math.min(minGap, system.equivalentEighthGapNotationPx),
      Number.POSITIVE_INFINITY,
    )
    pages.push({
      pageIndex: pages.length,
      pageNumber: pages.length + 1,
      notationScale: safeNotationScale,
      systemLayouts: pageSystems,
      systemRanges: pageSystems.map((system) => system.range),
      systemTopPxBySystemIndex,
      measureFramesByPair,
      actualSystemGapPx,
      actualSystemGapNotationPx,
      minEquivalentEighthGapPx: Number.isFinite(minEquivalentEighthGapNotationPx)
        ? minEquivalentEighthGapNotationPx * safeNotationScale
        : 0,
      minEquivalentEighthGapNotationPx: Number.isFinite(minEquivalentEighthGapNotationPx)
        ? minEquivalentEighthGapNotationPx
        : 0,
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
  notationScale: number
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
    notationScale,
    horizontalMarginPx,
    firstPageTopMarginPx,
    topMarginPx,
    bottomMarginPx,
    minEighthGapPx,
    minGrandStaffGapPx,
    showNoteHeadJianpu,
  } = params
  const safeNotationScale = Number.isFinite(notationScale) && notationScale > 0 ? notationScale : 1

  if (measurePairs.length === 0) {
    return {
      pages: [{
        pageIndex: 0,
        pageNumber: 1,
        notationScale: safeNotationScale,
        systemLayouts: [],
        systemRanges: [],
        systemTopPxBySystemIndex: [],
        measureFramesByPair: [],
        actualSystemGapPx: 0,
        actualSystemGapNotationPx: 0,
        minEquivalentEighthGapPx: 0,
        minEquivalentEighthGapNotationPx: 0,
      }],
    }
  }

  const usableWidthNotationPx = Math.max(1, (A4_PAGE_WIDTH - horizontalMarginPx * 2) / safeNotationScale)
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
      usableWidthNotationPx,
      notationScale: safeNotationScale,
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
        candidateLayout.totalWidthNotationPx <= usableWidthNotationPx + FIT_EPS
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
      notationScale: safeNotationScale,
      horizontalMarginPx,
      firstPageTopMarginPx,
      topMarginPx,
      bottomMarginPx,
      minGrandStaffGapPx,
      grandStaffLayoutMetrics,
    }),
  }
}
