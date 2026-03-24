import { Renderer, Stave } from 'vexflow'
import { SYSTEM_BASS_OFFSET_Y, SYSTEM_TREBLE_OFFSET_Y, TICKS_PER_BEAT } from '../constants'
import { drawMeasureToContext } from '../render/drawMeasure'
import type { MeasurePair, ScoreNote, TimeSignature } from '../types'
import type { AppliedTimeAxisSpacingMetrics, TimeAxisSpacingConfig } from './timeAxisSpacing'
import {
  PUBLIC_AXIS_CONSUMPTION_MODE,
  attachMeasureTimelineAxisLayout,
  buildMeasureTimelineBundle,
  getMeasureUniformTimelineWeightMetrics,
  getMeasureUniformTimelineWeightSpan,
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
  minMeasureWidthPx: number
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
  x?: number
  rightX?: number
  spacingRightX?: number
}

type MeasureSpacingProbe = {
  leadingGapPx: number
  trailingGapPx: number
  rightOverflowPx: number
  spacingAnchorGapFirstToLastPx: number
  leadingOccupiedInsetPx: number
  trailingOccupiedTailPx: number
}

const MIN_FORMAT_WIDTH_PX = 8
const MIN_VISIBLE_GAP_PX = 2
const EPS = 0.05
const STEP_PAD_PX = 0.5
const PROBE_MEASURE_X = 1024
const SOLVER_CACHE_VERSION = 'v7'
const SOLVER_CACHE_MAX_ENTRIES = 12000

function resolveMeasureMeta(params: {
  measurePairs: MeasurePair[]
  keyFifthsByPair: number[] | null
  timeSignaturesByPair: TimeSignature[] | null
}): SolverMeasureMeta[] {
  const { measurePairs, keyFifthsByPair, timeSignaturesByPair } = params
  const displayMetas = resolveStartDecorationDisplayMetas({
    measureCount: measurePairs.length,
    keyFifthsByPair,
    timeSignaturesByPair,
  })
  const { actualStartDecorationWidthPxByPair } = resolveActualStartDecorationWidths({
    metas: displayMetas,
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
  minMeasureWidthPx: number
  supplementalSpacingTicksSignature: string
}): string {
  const { meta, spacingConfig, minMeasureWidthPx, supplementalSpacingTicksSignature } = params
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
    `minW=${minMeasureWidthPx.toFixed(3)}`,
    `lead=${spacingConfig.leadingBarlineGapPx}`,
    `g32=${spacingConfig.baseMinGap32Px}`,
    `inter=${spacingConfig.interOnsetPaddingPx}`,
    `r32=${ratios.thirtySecond}`,
    `r16=${ratios.sixteenth}`,
    `r8=${ratios.eighth}`,
    `r4=${ratios.quarter}`,
    `r2=${ratios.half}`,
    `r1=${ratios.whole}`,
    `spacingTicks=${supplementalSpacingTicksSignature}`,
    `treble=${serializeStaffNotesForWidthCache(meta.measure.treble)}`,
    `bass=${serializeStaffNotesForWidthCache(meta.measure.bass)}`,
  ].join('||')
}

function buildMeasureProbeGeometry(meta: SolverMeasureMeta, contentMeasureWidth: number): MeasureProbeGeometry {
  const safeContentWidth = Math.max(1, Number(contentMeasureWidth.toFixed(3)))
  const renderedMeasureWidth = Math.max(1, Number((safeContentWidth + meta.actualStartDecorationWidthPx).toFixed(3)))
  const probeStave = new Stave(PROBE_MEASURE_X, SYSTEM_TREBLE_OFFSET_Y, renderedMeasureWidth)
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
): MeasureSpacingProbe | null {
  const geometry = buildMeasureProbeGeometry(meta, contentMeasureWidth)
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
    trebleY: SYSTEM_TREBLE_OFFSET_Y,
    bassY: SYSTEM_BASS_OFFSET_Y,
    isSystemStart: meta.isSystemStart,
    keyFifths: meta.keyFifths,
    showKeySignature: meta.showKeySignature,
    timeSignature: meta.timeSignature,
    showTimeSignature: meta.showTimeSignature,
    showEndTimeSignature: meta.showEndTimeSignature,
    activeSelection: null,
    draggingSelection: null,
    collectLayouts: true,
    skipPainting: false,
    noteStartXOverride: geometry.noteStartX,
    formatWidthOverride: geometry.formatWidth,
    timeAxisSpacingConfig: spacingConfig,
    spacingLayoutMode: 'custom',
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
  let layoutOccupiedLeftX = Number.POSITIVE_INFINITY
  let layoutOccupiedRightX = Number.NEGATIVE_INFINITY
  ;(measureNoteLayouts as ProbeLayoutLike[]).forEach((layout) => {
    if (typeof layout.x === 'number' && Number.isFinite(layout.x)) {
      layoutOccupiedLeftX = Math.min(layoutOccupiedLeftX, layout.x)
    }
    const spacingRightX =
      typeof layout.spacingRightX === 'number' && Number.isFinite(layout.spacingRightX)
        ? layout.spacingRightX
        : Number.NEGATIVE_INFINITY
    const visualRightX =
      typeof layout.rightX === 'number' && Number.isFinite(layout.rightX) ? layout.rightX : Number.NEGATIVE_INFINITY
    const occupiedRightX = Math.max(spacingRightX, visualRightX)
    if (Number.isFinite(occupiedRightX)) {
      layoutOccupiedRightX = Math.max(layoutOccupiedRightX, occupiedRightX)
    }
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
      Number.isFinite(lastAnchorX) &&
      Number.isFinite(
        Number.isFinite(layoutOccupiedRightX)
          ? Math.max(layoutOccupiedRightX, appliedMetrics.spacingOccupiedRightX)
          : appliedMetrics.spacingOccupiedRightX,
      )
        ? Math.max(
            0,
            (Number.isFinite(layoutOccupiedRightX)
              ? Math.max(layoutOccupiedRightX, appliedMetrics.spacingOccupiedRightX)
              : appliedMetrics.spacingOccupiedRightX) - lastAnchorX,
          )
        : 0
    const occupiedLeftX =
      Number.isFinite(layoutOccupiedLeftX)
        ? Number.isFinite(appliedMetrics.spacingOccupiedLeftX)
          ? Math.min(layoutOccupiedLeftX, appliedMetrics.spacingOccupiedLeftX)
          : layoutOccupiedLeftX
        : appliedMetrics.spacingOccupiedLeftX
    const occupiedRightX =
      Number.isFinite(layoutOccupiedRightX)
        ? Number.isFinite(appliedMetrics.spacingOccupiedRightX)
          ? Math.max(layoutOccupiedRightX, appliedMetrics.spacingOccupiedRightX)
          : layoutOccupiedRightX
        : appliedMetrics.spacingOccupiedRightX
    return {
      leadingGapPx: appliedMetrics.leadingGapPx,
      trailingGapPx: appliedMetrics.trailingGapPx,
      rightOverflowPx: Math.max(0, occupiedRightX - appliedMetrics.effectiveBoundaryEndX),
      spacingAnchorGapFirstToLastPx: Math.max(0, appliedMetrics.spacingAnchorGapFirstToLastPx),
      leadingOccupiedInsetPx:
        Number.isFinite(firstAnchorX) && Number.isFinite(occupiedLeftX)
          ? Math.max(0, firstAnchorX - occupiedLeftX)
          : leadingOccupiedInsetPx,
      trailingOccupiedTailPx,
    }
  }
  if (measureNoteLayouts.length === 0) {
    return {
      leadingGapPx: 0,
      trailingGapPx: 0,
      rightOverflowPx: 0,
      spacingAnchorGapFirstToLastPx: 0,
      leadingOccupiedInsetPx: 0,
      trailingOccupiedTailPx: 0,
    }
  }

  let firstVisualLeftX = Number.POSITIVE_INFINITY
  let lastVisualRightX = Number.NEGATIVE_INFINITY
  measureNoteLayouts.forEach((layout) => {
    if (Number.isFinite(layout.x)) {
      firstVisualLeftX = Math.min(firstVisualLeftX, layout.x)
    }
    const spacingRightX = Number.isFinite(layout.spacingRightX) ? layout.spacingRightX : Number.NEGATIVE_INFINITY
    const visualRightX = Number.isFinite(layout.rightX) ? layout.rightX : Number.NEGATIVE_INFINITY
    const rightX = Math.max(spacingRightX, visualRightX)
    if (Number.isFinite(rightX)) {
      lastVisualRightX = Math.max(lastVisualRightX, rightX)
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
    Number.isFinite(anchorLeftX) && Number.isFinite(firstVisualLeftX)
      ? Math.min(firstVisualLeftX, anchorLeftX)
      : Number.isFinite(anchorLeftX)
        ? anchorLeftX
        : firstVisualLeftX
  const occupiedRightX =
    Number.isFinite(anchorRightX) && Number.isFinite(lastVisualRightX)
      ? Math.max(lastVisualRightX, anchorRightX)
      : Number.isFinite(anchorRightX)
        ? anchorRightX
        : lastVisualRightX
  if (!Number.isFinite(occupiedLeftX) || !Number.isFinite(occupiedRightX)) return null

  const boundary = resolveEffectiveBoundary({
    measureX: PROBE_MEASURE_X,
    measureWidth: geometry.renderedMeasureWidth,
    noteStartX: geometry.noteStartX,
    noteEndX: geometry.noteEndX,
    showStartDecorations: meta.showStartBoundaryReserve,
    showEndDecorations: meta.showEndDecorations,
  })
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
    minMeasureWidthPx,
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
  })

  return metas.map((meta) => {
    const shouldProbePrecisely = meta.pairIndex < eagerProbeMeasureLimit
    const supplementalSpacingTicks = supplementalSpacingTicksByPair?.[meta.pairIndex] ?? null
    const supplementalSpacingTicksSignature =
      supplementalSpacingTicks && supplementalSpacingTicks.length > 0 ? supplementalSpacingTicks.join(',') : '-'
    const minSolvedMeasureWidthPx = Number(minMeasureWidthPx.toFixed(3))
    const cacheKey =
      shouldProbePrecisely && widthCache !== undefined
        ? buildMeasureWidthCacheKey({
            meta,
            spacingConfig,
            minMeasureWidthPx,
            supplementalSpacingTicksSignature,
          })
        : null
    if (cacheKey && widthCache) {
      const cachedWidth = widthCache.get(cacheKey)
      if (Number.isFinite(cachedWidth)) {
        return Math.max(minSolvedMeasureWidthPx, cachedWidth as number)
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
    let width = Math.max(
      minSolvedMeasureWidthPx,
      Number(timelineSpan.toFixed(3)),
    )

    if (!shouldProbePrecisely) {
      if (cacheKey && widthCache) {
        widthCache.set(cacheKey, width)
      }
      return width
    }

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const probe = probeMeasureSpacing(context, meta, width, spacingConfig, supplementalSpacingTicks)
      if (!probe) break
      const requiredLeadingAnchorGap = probe.leadingOccupiedInsetPx + MIN_VISIBLE_GAP_PX
      const requiredTrailingAnchorGap = probe.trailingOccupiedTailPx + MIN_VISIBLE_GAP_PX
      const leadingGapDeficit = Math.max(0, requiredLeadingAnchorGap - probe.leadingGapPx)
      const trailingGapDeficit = Math.max(0, requiredTrailingAnchorGap - probe.trailingGapPx)
      const timelineCompressionDeficit = Math.max(0, timelineMetrics.anchorSpanPx - probe.spacingAnchorGapFirstToLastPx)

      if (
        probe.rightOverflowPx <= EPS &&
        leadingGapDeficit <= EPS &&
        trailingGapDeficit <= EPS &&
        timelineCompressionDeficit <= EPS
      ) {
        break
      }

      if (
        probe.rightOverflowPx > EPS ||
        leadingGapDeficit > EPS ||
        trailingGapDeficit > EPS ||
        timelineCompressionDeficit > EPS
      ) {
        const growBy =
          probe.rightOverflowPx +
          leadingGapDeficit +
          trailingGapDeficit +
          timelineCompressionDeficit +
          STEP_PAD_PX
        width = Number((Math.max(minSolvedMeasureWidthPx, width + growBy)).toFixed(3))
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
