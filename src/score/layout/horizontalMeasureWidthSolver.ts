import { Renderer, Stave } from 'vexflow'
import { TICKS_PER_BEAT } from '../constants'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import { drawMeasureToContext } from '../render/drawMeasure'
import type { MeasurePair, ScoreNote, TimeSignature } from '../types'
import type { AppliedTimeAxisSpacingMetrics, TimeAxisSpacingConfig } from './timeAxisSpacing'
import {
  PUBLIC_AXIS_CONSUMPTION_MODE,
  attachMeasureTimelineAxisLayout,
  buildMeasureTimelineBundle,
  getMeasureUniformTimelineWeightMetrics,
  getMeasureUniformTimelineWeightSpan,
  resolveMeasureMinWidthStretchPlan,
  resolvePublicAxisLayoutForConsumption,
} from './timeAxisSpacing'
import { resolveEffectiveBoundary } from './effectiveBoundary'
import {
  applyMeasureStartDecorationsToStave,
  resolveActualStartDecorationWidths,
  resolveMeasureStartDecorationReserve,
  resolveStartDecorationDisplayMetas,
  toTimeSignatureKey,
} from './startDecorationReserve'

type SolverMeasureMeta = {
  pairIndex: number
  measure: MeasurePair
  isSystemStart: boolean
  keyFifths: number
  showKeySignature: boolean
  timeSignature: TimeSignature
  showTimeSignature: boolean
  showEndTimeSignature: boolean
  includeMeasureStartDecorations: boolean
  showStartDecorations: boolean
  showStartBoundaryReserve: boolean
  showEndDecorations: boolean
  actualStartDecorationWidthPx: number
  preferMeasureStartBarlineAxis: boolean
  preferMeasureEndBarlineAxis: boolean
}

export type SolveHorizontalMeasureWidthsParams = {
  context: ReturnType<Renderer['getContext']>
  measurePairs: MeasurePair[]
  measureKeyFifthsByPair: number[] | null
  measureTimeSignaturesByPair: TimeSignature[] | null
  supplementalSpacingTicksByPair?: number[][] | null
  spacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  maxIterations?: number
  eagerProbeMeasureLimit?: number
  widthCache?: Map<string, number>
}

type MeasureProbeGeometry = {
  renderedMeasureWidth: number
  noteStartX: number
  noteEndX: number
  formatWidth: number
}

type ProbeLayoutLike = {
  anchorX?: number
  visualRightX?: number
  isRest?: boolean
  hasFlag?: boolean
  x?: number
  rightX?: number
  spacingRightX?: number
}

type MeasureSpacingProbe = {
  leadingGapPx: number
  trailingGapPx: number
  rightOverflowPx: number
  trailingFlagVisualOverflowPx: number
  spacingAnchorGapFirstToLastPx: number
  leadingOccupiedInsetPx: number
  trailingOccupiedTailPx: number
}

const MIN_FORMAT_WIDTH_PX = 8
const EPS = 0.05
const PROBE_MEASURE_X = 1024
const SOLVER_CACHE_VERSION = 'v11'
const SOLVER_CACHE_MAX_ENTRIES = 12000
const TRAILING_FLAG_BARLINE_SAFE_GAP_PX = 1

function pickTrailingLayout(layouts: ProbeLayoutLike[]): ProbeLayoutLike | null {
  let trailingLayout: ProbeLayoutLike | null = null
  let trailingAnchorX = Number.NEGATIVE_INFINITY
  let trailingVisualRightX = Number.NEGATIVE_INFINITY

  layouts.forEach((layout) => {
    const anchorX = Number.isFinite(layout.anchorX)
      ? (layout.anchorX as number)
      : Number.isFinite(layout.x)
        ? (layout.x as number)
        : Number.NEGATIVE_INFINITY
    const visualRightX = Number.isFinite(layout.visualRightX)
      ? (layout.visualRightX as number)
      : Number.isFinite(layout.spacingRightX)
        ? (layout.spacingRightX as number)
        : Number.NEGATIVE_INFINITY
    if (!Number.isFinite(anchorX) || !Number.isFinite(visualRightX)) return
    if (anchorX > trailingAnchorX + EPS) {
      trailingLayout = layout
      trailingAnchorX = anchorX
      trailingVisualRightX = visualRightX
      return
    }
    if (Math.abs(anchorX - trailingAnchorX) <= EPS && visualRightX > trailingVisualRightX + EPS) {
      trailingLayout = layout
      trailingAnchorX = anchorX
      trailingVisualRightX = visualRightX
    }
  })

  return trailingLayout
}

function resolveTrailingFlagVisualOverflowPx(
  layouts: ProbeLayoutLike[],
  effectiveBoundaryEndX: number,
): number {
  if (!Number.isFinite(effectiveBoundaryEndX)) return 0
  const trailingLayout = pickTrailingLayout(layouts)
  if (!trailingLayout || trailingLayout.isRest === true || trailingLayout.hasFlag !== true) return 0
  const trailingVisualRightX = Number.isFinite(trailingLayout.visualRightX)
    ? (trailingLayout.visualRightX as number)
    : Number.isFinite(trailingLayout.spacingRightX)
      ? (trailingLayout.spacingRightX as number)
      : Number.NaN
  if (!Number.isFinite(trailingVisualRightX)) return 0
  const safeBoundaryRightX = effectiveBoundaryEndX - TRAILING_FLAG_BARLINE_SAFE_GAP_PX
  return Math.max(0, trailingVisualRightX - safeBoundaryRightX)
}

function resolveMeasureMeta(params: {
  measurePairs: MeasurePair[]
  keyFifthsByPair: number[] | null
  timeSignaturesByPair: TimeSignature[] | null
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}): SolverMeasureMeta[] {
  const { measurePairs, keyFifthsByPair, timeSignaturesByPair, grandStaffLayoutMetrics } = params
  const displayMetas = resolveStartDecorationDisplayMetas({
    measureCount: measurePairs.length,
    keyFifthsByPair,
    timeSignaturesByPair,
  })
  const { actualStartDecorationWidthPxByPair } = resolveActualStartDecorationWidths({
    metas: displayMetas,
    grandStaffLayoutMetrics,
  })

  return displayMetas.map((displayMeta) => {
    const actualStartDecorationWidthPx = actualStartDecorationWidthPxByPair[displayMeta.pairIndex] ?? 0
    const startDecorationReserve = resolveMeasureStartDecorationReserve({
      actualStartDecorationWidthPx,
    })
    const includeMeasureStartDecorations =
      !displayMeta.isSystemStart && (displayMeta.showKeySignature || displayMeta.showTimeSignature)
    const showEndTimeSignature = false
    const showEndDecorations = showEndTimeSignature

    return {
      pairIndex: displayMeta.pairIndex,
      measure: measurePairs[displayMeta.pairIndex] as MeasurePair,
      isSystemStart: displayMeta.isSystemStart,
      keyFifths: displayMeta.keyFifths,
      showKeySignature: displayMeta.showKeySignature,
      timeSignature: displayMeta.timeSignature,
      showTimeSignature: displayMeta.showTimeSignature,
      showEndTimeSignature,
      includeMeasureStartDecorations,
      showStartDecorations: startDecorationReserve.showStartBoundaryReserve,
      showStartBoundaryReserve: startDecorationReserve.showStartBoundaryReserve,
      showEndDecorations,
      actualStartDecorationWidthPx,
      preferMeasureStartBarlineAxis: startDecorationReserve.preferMeasureStartBarlineAxis,
      preferMeasureEndBarlineAxis: !showEndDecorations,
    }
  })
}

function serializeScoreNoteForWidthCache(note: ScoreNote): string {
  const chordPitchCount = note.chordPitches?.length ?? 0
  const pitchSignature = note.pitch ?? '.'
  const chordPitchSignature =
    note.chordPitches && note.chordPitches.length > 0
      ? note.chordPitches.join(',')
      : '-'
  const chordAccidentals =
    note.chordAccidentals && note.chordAccidentals.length > 0
      ? note.chordAccidentals.map((value) => value ?? '.').join(',')
      : '-'
  return [
    note.duration,
    note.isRest ? '1' : '0',
    pitchSignature,
    note.accidental ?? '.',
    String(chordPitchCount),
    chordPitchSignature,
    chordAccidentals,
  ].join('|')
}

function serializeStaffNotesForWidthCache(notes: ScoreNote[]): string {
  if (notes.length === 0) return '-'
  return notes.map(serializeScoreNoteForWidthCache).join(';')
}

function buildMeasureWidthCacheKey(params: {
  meta: SolverMeasureMeta
  spacingConfig: TimeAxisSpacingConfig
  supplementalSpacingTicksSignature: string
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}): string {
  const { meta, spacingConfig, supplementalSpacingTicksSignature, grandStaffLayoutMetrics } = params
  const ratios = spacingConfig.durationGapRatios
  return [
    SOLVER_CACHE_VERSION,
    `pair=${meta.pairIndex}`,
    `sys=${meta.isSystemStart ? 1 : 0}`,
    `key=${meta.keyFifths}`,
    `ts=${meta.timeSignature.beats}/${meta.timeSignature.beatType}`,
    `showK=${meta.showKeySignature ? 1 : 0}`,
    `showT=${meta.showTimeSignature ? 1 : 0}`,
    `showEndT=${meta.showEndTimeSignature ? 1 : 0}`,
    `startDecor=${meta.showStartDecorations ? 1 : 0}`,
    `actualStart=${meta.actualStartDecorationWidthPx.toFixed(3)}`,
    `endDecor=${meta.showEndDecorations ? 1 : 0}`,
    `minW=${spacingConfig.minMeasureWidthPx}`,
    `lead=${spacingConfig.leadingBarlineGapPx}`,
    `g32=${spacingConfig.baseMinGap32Px}`,
    `m2safe=${spacingConfig.secondChordSafeGapPx}`,
    `inter=${spacingConfig.interOnsetPaddingPx}`,
    `r32=${ratios.thirtySecond}`,
    `r16=${ratios.sixteenth}`,
    `r8=${ratios.eighth}`,
    `r4=${ratios.quarter}`,
    `r2=${ratios.half}`,
    `r1=${ratios.whole}`,
    `staffGap=${grandStaffLayoutMetrics.staffInterGapPx}`,
    `spacingTicks=${supplementalSpacingTicksSignature}`,
    `treble=${serializeStaffNotesForWidthCache(meta.measure.treble)}`,
    `bass=${serializeStaffNotesForWidthCache(meta.measure.bass)}`,
  ].join('||')
}

function buildMeasureProbeGeometry(
  meta: SolverMeasureMeta,
  contentMeasureWidth: number,
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics,
): MeasureProbeGeometry {
  const safeContentWidth = Math.max(1, Number(contentMeasureWidth.toFixed(3)))
  const renderedMeasureWidth = Math.max(1, Number((safeContentWidth + meta.actualStartDecorationWidthPx).toFixed(3)))
  const probeStave = new Stave(PROBE_MEASURE_X, grandStaffLayoutMetrics.trebleOffsetY, renderedMeasureWidth)
  applyMeasureStartDecorationsToStave(probeStave, 'treble', meta)
  if (meta.showEndTimeSignature) {
    probeStave.setEndTimeSignature(toTimeSignatureKey(meta.timeSignature))
  }

  const rawNoteEndOffset = probeStave.getNoteEndX()
  const noteStartOffset = meta.preferMeasureStartBarlineAxis ? 0 : meta.actualStartDecorationWidthPx
  const noteStartX = PROBE_MEASURE_X + noteStartOffset
  const noteEndX = rawNoteEndOffset
  return {
    renderedMeasureWidth,
    noteStartX,
    noteEndX,
    formatWidth: Math.max(MIN_FORMAT_WIDTH_PX, noteEndX - noteStartX - 8),
  }
}

function probeMeasureSpacing(
  context: ReturnType<Renderer['getContext']>,
  meta: SolverMeasureMeta,
  contentMeasureWidth: number,
  spacingConfig: TimeAxisSpacingConfig,
  supplementalSpacingTicks: readonly number[] | null,
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics,
): MeasureSpacingProbe | null {
  const geometry = buildMeasureProbeGeometry(meta, contentMeasureWidth, grandStaffLayoutMetrics)
  const baseTimelineBundle = buildMeasureTimelineBundle({
    measure: meta.measure,
    measureIndex: meta.pairIndex,
    timeSignature: meta.timeSignature,
    spacingConfig,
    timelineMode: 'dual',
    supplementalSpacingTicks,
  })
  let probeTimelineBundle: ReturnType<typeof buildMeasureTimelineBundle> | null = baseTimelineBundle
  if (PUBLIC_AXIS_CONSUMPTION_MODE === 'merged') {
    const effectiveBoundary = resolveEffectiveBoundary({
      measureX: 0,
      measureWidth: geometry.renderedMeasureWidth,
      noteStartX: geometry.noteStartX,
      noteEndX: geometry.noteEndX,
      showStartDecorations: meta.showStartBoundaryReserve,
      showEndDecorations: !meta.preferMeasureEndBarlineAxis,
    })
    probeTimelineBundle = attachMeasureTimelineAxisLayout({
      bundle: baseTimelineBundle,
      effectiveBoundaryStartX: effectiveBoundary.effectiveStartX,
      effectiveBoundaryEndX: effectiveBoundary.effectiveEndX,
      widthPx: geometry.renderedMeasureWidth,
      spacingConfig,
    })
  }
  const spacingMetricsRef: { current: AppliedTimeAxisSpacingMetrics | null } = { current: null }
  const measureNoteLayouts = drawMeasureToContext({
    context,
    measure: meta.measure,
    pairIndex: meta.pairIndex,
    measureX: PROBE_MEASURE_X,
    measureWidth: geometry.renderedMeasureWidth,
    trebleY: grandStaffLayoutMetrics.trebleOffsetY,
    bassY: grandStaffLayoutMetrics.bassOffsetY,
    isSystemStart: meta.isSystemStart,
    keyFifths: meta.keyFifths,
    showKeySignature: meta.showKeySignature,
    timeSignature: meta.timeSignature,
    showTimeSignature: meta.showTimeSignature,
    showEndTimeSignature: meta.showEndTimeSignature,
    activeSelection: null,
    draggingSelection: null,
    beamHighlightFrameScope: null,
    collectLayouts: true,
    layoutDetail: 'spacing-only',
    skipPainting: true,
    noteStartXOverride: geometry.noteStartX,
    formatWidthOverride: geometry.formatWidth,
    timeAxisSpacingConfig: spacingConfig,
    spacingLayoutMode: 'custom',
    timelineBundle: probeTimelineBundle,
    publicAxisLayout: resolvePublicAxisLayoutForConsumption(probeTimelineBundle),
    spacingAnchorTicks: probeTimelineBundle?.spacingAnchorTicks ?? null,
    preferMeasureBarlineAxis: meta.preferMeasureStartBarlineAxis,
    preferMeasureEndBarlineAxis: meta.preferMeasureEndBarlineAxis,
    enableEdgeGapCap: true,
    onSpacingMetrics: (
      metrics: AppliedTimeAxisSpacingMetrics | null,
    ) => {
      spacingMetricsRef.current = metrics
    },
  })
  const probeLayouts = measureNoteLayouts as ProbeLayoutLike[]
  const boundary = resolveEffectiveBoundary({
    measureX: PROBE_MEASURE_X,
    measureWidth: geometry.renderedMeasureWidth,
    noteStartX: geometry.noteStartX,
    noteEndX: geometry.noteEndX,
    showStartDecorations: meta.showStartBoundaryReserve,
    showEndDecorations: meta.showEndDecorations,
  })
  const appliedMetrics = spacingMetricsRef.current
  if (
    appliedMetrics &&
    Number.isFinite(appliedMetrics.leadingGapPx) &&
    Number.isFinite(appliedMetrics.trailingGapPx)
  ) {
    const firstSpacingTick = appliedMetrics.spacingAnchorTicks[0]
    const lastSpacingTick = appliedMetrics.spacingAnchorTicks[appliedMetrics.spacingAnchorTicks.length - 1]
    const firstAnchorX =
      typeof firstSpacingTick === 'number' ? appliedMetrics.spacingTickToX.get(firstSpacingTick) ?? Number.NaN : Number.NaN
    const lastAnchorX =
      typeof lastSpacingTick === 'number' ? appliedMetrics.spacingTickToX.get(lastSpacingTick) ?? Number.NaN : Number.NaN
    const leadingOccupiedInsetPx =
      Number.isFinite(firstAnchorX) && Number.isFinite(appliedMetrics.spacingOccupiedLeftX)
        ? Math.max(0, firstAnchorX - appliedMetrics.spacingOccupiedLeftX)
        : 0
    const trailingOccupiedTailPx =
      Number.isFinite(lastAnchorX) && Number.isFinite(appliedMetrics.spacingOccupiedRightX)
        ? Math.max(
            0,
            appliedMetrics.spacingOccupiedRightX - lastAnchorX,
          )
        : 0
    return {
      leadingGapPx: appliedMetrics.leadingGapPx,
      trailingGapPx: appliedMetrics.trailingGapPx,
      rightOverflowPx: Math.max(0, appliedMetrics.spacingOccupiedRightX - appliedMetrics.effectiveBoundaryEndX),
      trailingFlagVisualOverflowPx: resolveTrailingFlagVisualOverflowPx(
        probeLayouts,
        appliedMetrics.effectiveBoundaryEndX,
      ),
      spacingAnchorGapFirstToLastPx: Math.max(0, appliedMetrics.spacingAnchorGapFirstToLastPx),
      leadingOccupiedInsetPx,
      trailingOccupiedTailPx,
    }
  }
  if (measureNoteLayouts.length === 0) {
    return {
      leadingGapPx: 0,
      trailingGapPx: 0,
      rightOverflowPx: 0,
      trailingFlagVisualOverflowPx: 0,
      spacingAnchorGapFirstToLastPx: 0,
      leadingOccupiedInsetPx: 0,
      trailingOccupiedTailPx: 0,
    }
  }

  let firstOccupiedLeftX = Number.POSITIVE_INFINITY
  let lastSpacingOccupiedRightX = Number.NEGATIVE_INFINITY
  probeLayouts.forEach((layout) => {
    const layoutX = layout.x
    if (typeof layoutX === 'number' && Number.isFinite(layoutX)) {
      firstOccupiedLeftX = Math.min(firstOccupiedLeftX, layoutX)
    }
    if (Number.isFinite(layout.spacingRightX)) {
      lastSpacingOccupiedRightX = Math.max(lastSpacingOccupiedRightX, layout.spacingRightX as number)
    }
  })
  const anchorTicks = probeTimelineBundle?.spacingAnchorTicks ?? []
  const anchorLeftX =
    anchorTicks.length > 0
      ? probeTimelineBundle?.spacingTickToX.get(anchorTicks[0] as number) ?? Number.NaN
      : Number.NaN
  const anchorRightX =
    anchorTicks.length > 0
      ? probeTimelineBundle?.spacingTickToX.get(anchorTicks[anchorTicks.length - 1] as number) ?? Number.NaN
      : Number.NaN
  const occupiedLeftX =
    Number.isFinite(anchorLeftX) && Number.isFinite(firstOccupiedLeftX)
      ? Math.min(firstOccupiedLeftX, anchorLeftX)
      : Number.isFinite(anchorLeftX)
        ? anchorLeftX
        : firstOccupiedLeftX
  const occupiedRightX =
    Number.isFinite(anchorRightX) && Number.isFinite(lastSpacingOccupiedRightX)
      ? Math.max(lastSpacingOccupiedRightX, anchorRightX)
      : Number.isFinite(anchorRightX)
        ? anchorRightX
        : lastSpacingOccupiedRightX
  if (!Number.isFinite(occupiedLeftX) || !Number.isFinite(occupiedRightX)) return null
  const effectiveLeftGapPx = occupiedLeftX - boundary.effectiveStartX
  const effectiveRightGapPx = boundary.effectiveEndX - occupiedRightX
  const leadingGapPx =
    Number.isFinite(anchorLeftX) && Number.isFinite(boundary.effectiveStartX)
      ? Math.max(0, anchorLeftX - boundary.effectiveStartX)
      : effectiveLeftGapPx
  const trailingGapPx =
    Number.isFinite(anchorRightX) && Number.isFinite(boundary.effectiveEndX)
      ? Math.max(0, boundary.effectiveEndX - anchorRightX)
      : effectiveRightGapPx
  return {
    leadingGapPx,
    trailingGapPx,
    rightOverflowPx: Math.max(0, occupiedRightX - boundary.effectiveEndX),
    trailingFlagVisualOverflowPx: resolveTrailingFlagVisualOverflowPx(probeLayouts, boundary.effectiveEndX),
    spacingAnchorGapFirstToLastPx:
      Number.isFinite(anchorLeftX) && Number.isFinite(anchorRightX)
        ? Math.max(0, anchorRightX - anchorLeftX)
        : 0,
    leadingOccupiedInsetPx:
      Number.isFinite(anchorLeftX) ? Math.max(0, anchorLeftX - occupiedLeftX) : 0,
    trailingOccupiedTailPx:
      Number.isFinite(anchorRightX) ? Math.max(0, occupiedRightX - anchorRightX) : 0,
  }
}

export function solveHorizontalMeasureWidths(params: SolveHorizontalMeasureWidthsParams): number[] {
  const {
    context,
    measurePairs,
    measureKeyFifthsByPair,
    measureTimeSignaturesByPair,
    supplementalSpacingTicksByPair = null,
    spacingConfig,
    grandStaffLayoutMetrics,
    maxIterations = 20,
    eagerProbeMeasureLimit = Number.POSITIVE_INFINITY,
    widthCache,
  } = params
  if (measurePairs.length === 0) return []

  if (widthCache && widthCache.size > SOLVER_CACHE_MAX_ENTRIES) {
    widthCache.clear()
  }

  const metas = resolveMeasureMeta({
    measurePairs,
    keyFifthsByPair: measureKeyFifthsByPair,
    timeSignaturesByPair: measureTimeSignaturesByPair,
    grandStaffLayoutMetrics,
  })

  return metas.map((meta) => {
    const shouldProbePrecisely = meta.pairIndex < eagerProbeMeasureLimit
    const supplementalSpacingTicks = supplementalSpacingTicksByPair?.[meta.pairIndex] ?? null
    const supplementalSpacingTicksSignature =
      supplementalSpacingTicks && supplementalSpacingTicks.length > 0 ? supplementalSpacingTicks.join(',') : '-'
    const cacheKey =
      shouldProbePrecisely && widthCache !== undefined
        ? buildMeasureWidthCacheKey({
            meta,
            spacingConfig,
            supplementalSpacingTicksSignature,
            grandStaffLayoutMetrics,
          })
        : null
    if (cacheKey && widthCache) {
      const cachedWidth = widthCache.get(cacheKey)
      if (Number.isFinite(cachedWidth)) {
        return cachedWidth as number
      }
    }

    const measureTicks = Math.max(
      1,
      Math.round(meta.timeSignature.beats * TICKS_PER_BEAT * (4 / meta.timeSignature.beatType)),
    )
    const timelineBundle = buildMeasureTimelineBundle({
      measure: meta.measure,
      measureIndex: meta.pairIndex,
      timeSignature: meta.timeSignature,
      spacingConfig,
      timelineMode: 'dual',
      supplementalSpacingTicks,
    })
    const timelineSpan = getMeasureUniformTimelineWeightSpan(
      meta.measure,
      measureTicks,
      spacingConfig,
      timelineBundle,
    )
    const timelineMetrics = getMeasureUniformTimelineWeightMetrics(
      meta.measure,
      measureTicks,
      spacingConfig,
      timelineBundle,
    )
    const minWidthStretchPlan = resolveMeasureMinWidthStretchPlan({
      spacingConfig,
      leadingGapPx: timelineMetrics.leadingGapPx,
      anchorSpanPx: timelineMetrics.anchorSpanPx,
      trailingGapPx: timelineMetrics.trailingGapPx,
    })
    let width = Number(Math.max(timelineSpan, minWidthStretchPlan.targetContentWidthPx).toFixed(3))

    if (!shouldProbePrecisely) {
      if (cacheKey && widthCache) {
        widthCache.set(cacheKey, width)
      }
      return width
    }

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const probe = probeMeasureSpacing(
        context,
        meta,
        width,
        spacingConfig,
        supplementalSpacingTicks,
        grandStaffLayoutMetrics,
      )
      if (!probe) break
      // Growing the measure width only extends the trailing edge. It cannot
      // increase the first-anchor gap, so leading-side deficits must be
      // resolved by spacing/layout, not by the width solver.
      const leadingGapDeficit = 0
      const trailingGapDeficit = Math.max(0, timelineMetrics.trailingGapPx - probe.trailingGapPx)
      const trailingWidthDemandPx = Math.max(
        probe.rightOverflowPx,
        trailingGapDeficit,
        probe.trailingFlagVisualOverflowPx,
      )
      const timelineCompressionDeficit = Math.max(0, timelineMetrics.anchorSpanPx - probe.spacingAnchorGapFirstToLastPx)

      if (
        trailingWidthDemandPx <= EPS &&
        leadingGapDeficit <= EPS &&
        timelineCompressionDeficit <= EPS
      ) {
        break
      }

      if (
        trailingWidthDemandPx > EPS ||
        leadingGapDeficit > EPS ||
        timelineCompressionDeficit > EPS
      ) {
        const growBy =
          trailingWidthDemandPx +
          leadingGapDeficit +
          timelineCompressionDeficit
        width = Number((width + growBy).toFixed(3))
        continue
      }
      break
    }

    if (cacheKey && widthCache) {
      widthCache.set(cacheKey, width)
    }
    return width
  })
}
