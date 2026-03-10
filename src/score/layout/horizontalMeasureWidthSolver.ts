import { BarlineType, Renderer, Stave } from 'vexflow'
import { getKeySignatureSpecFromFifths } from '../accidentals'
import { SYSTEM_BASS_OFFSET_Y, SYSTEM_TREBLE_OFFSET_Y, TICKS_PER_BEAT } from '../constants'
import { drawMeasureToContext } from '../render/drawMeasure'
import type { MeasurePair, ScoreNote, TimeSignature } from '../types'
import type { TimeAxisSpacingConfig } from './timeAxisSpacing'
import {
  PUBLIC_AXIS_CONSUMPTION_MODE,
  attachMeasureTimelineAxisLayout,
  buildMeasureTimelineBundle,
  getMeasureUniformTimelineWeightSpan,
  getUniformTickSpacingPadding,
  resolvePublicAxisLayoutForConsumption,
} from './timeAxisSpacing'
import { resolveEffectiveBoundary } from './effectiveBoundary'

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
  showEndDecorations: boolean
  preferMeasureStartBarlineAxis: boolean
  preferMeasureEndBarlineAxis: boolean
}

export type SolveHorizontalMeasureWidthsParams = {
  context: ReturnType<Renderer['getContext']>
  measurePairs: MeasurePair[]
  measureKeyFifthsByPair: number[] | null
  measureTimeSignaturesByPair: TimeSignature[] | null
  spacingConfig: TimeAxisSpacingConfig
  minMeasureWidthPx: number
  maxIterations?: number
  eagerProbeMeasureLimit?: number
  widthCache?: Map<string, number>
}

type MeasureProbeGeometry = {
  noteStartX: number
  noteEndX: number
  formatWidth: number
}

type MeasureSpacingProbe = {
  effectiveLeftGapPx: number
  effectiveRightGapPx: number
  rightOverflowPx: number
}

const MIN_FORMAT_WIDTH_PX = 8
const EPS = 0.05
const STEP_PAD_PX = 0.5
const SOLVER_CACHE_VERSION = 'v1'
const SOLVER_CACHE_MAX_ENTRIES = 12000
const EST_SYSTEM_START_DECORATION_PX = 96
const EST_INLINE_DECORATION_PX = 24

function toTimeSignatureKey(signature: TimeSignature): string {
  return `${signature.beats}/${signature.beatType}`
}

function resolveMeasureMeta(params: {
  measurePairs: MeasurePair[]
  keyFifthsByPair: number[] | null
  timeSignaturesByPair: TimeSignature[] | null
}): SolverMeasureMeta[] {
  const { measurePairs, keyFifthsByPair, timeSignaturesByPair } = params
  const metas: SolverMeasureMeta[] = []
  let previousKeyFifths = 0
  let previousTimeSignature: TimeSignature = { beats: 4, beatType: 4 }

  for (let pairIndex = 0; pairIndex < measurePairs.length; pairIndex += 1) {
    const measure = measurePairs[pairIndex]
    const isSystemStart = pairIndex === 0
    const keyFifths = keyFifthsByPair?.[pairIndex] ?? previousKeyFifths
    const timeSignature = timeSignaturesByPair?.[pairIndex] ?? previousTimeSignature
    const showKeySignature = isSystemStart || keyFifths !== previousKeyFifths
    const showTimeSignature =
      isSystemStart ||
      timeSignature.beats !== previousTimeSignature.beats ||
      timeSignature.beatType !== previousTimeSignature.beatType
    const includeMeasureStartDecorations = !isSystemStart && (showKeySignature || showTimeSignature)
    const showStartDecorations = isSystemStart || showKeySignature || showTimeSignature || includeMeasureStartDecorations
    const showEndTimeSignature = false
    const showEndDecorations = showEndTimeSignature
    const preferMeasureStartBarlineAxis = !showStartDecorations
    const preferMeasureEndBarlineAxis = !showEndDecorations

    metas.push({
      pairIndex,
      measure,
      isSystemStart,
      keyFifths,
      showKeySignature,
      timeSignature,
      showTimeSignature,
      showEndTimeSignature,
      includeMeasureStartDecorations,
      showStartDecorations,
      showEndDecorations,
      preferMeasureStartBarlineAxis,
      preferMeasureEndBarlineAxis,
    })

    previousKeyFifths = keyFifths
    previousTimeSignature = timeSignature
  }
  return metas
}

function serializeScoreNoteForWidthCache(note: ScoreNote): string {
  const chordPitchCount = note.chordPitches?.length ?? 0
  const chordAccidentals =
    note.chordAccidentals && note.chordAccidentals.length > 0
      ? note.chordAccidentals.map((value) => value ?? '.').join(',')
      : '-'
  return [
    note.duration,
    note.isRest ? '1' : '0',
    note.accidental ?? '.',
    String(chordPitchCount),
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
}): string {
  const { meta, spacingConfig, minMeasureWidthPx } = params
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
    `endDecor=${meta.showEndDecorations ? 1 : 0}`,
    `minW=${minMeasureWidthPx.toFixed(3)}`,
    `g32=${spacingConfig.baseMinGap32Px}`,
    `minEdge=${spacingConfig.minBarlineEdgeGapPx}`,
    `maxEdge=${spacingConfig.maxBarlineEdgeGapPx}`,
    `leftPad=${spacingConfig.leftEdgePaddingPx}`,
    `rightPad=${spacingConfig.rightEdgePaddingPx}`,
    `inter=${spacingConfig.interOnsetPaddingPx}`,
    `r32=${ratios.thirtySecond}`,
    `r16=${ratios.sixteenth}`,
    `r8=${ratios.eighth}`,
    `r4=${ratios.quarter}`,
    `r2=${ratios.half}`,
    `treble=${serializeStaffNotesForWidthCache(meta.measure.treble)}`,
    `bass=${serializeStaffNotesForWidthCache(meta.measure.bass)}`,
  ].join('||')
}

function buildMeasureProbeGeometry(meta: SolverMeasureMeta, measureWidth: number): MeasureProbeGeometry {
  const safeWidth = Math.max(1, Number(measureWidth.toFixed(3)))
  const probeStave = new Stave(0, SYSTEM_TREBLE_OFFSET_Y, safeWidth)
  if (meta.isSystemStart) {
    probeStave.addClef('treble')
    if (meta.showKeySignature) {
      probeStave.addKeySignature(getKeySignatureSpecFromFifths(meta.keyFifths))
    }
    if (meta.showTimeSignature) {
      probeStave.addTimeSignature(toTimeSignatureKey(meta.timeSignature))
    }
  } else {
    probeStave.setBegBarType(BarlineType.NONE)
    if (meta.showKeySignature) {
      probeStave.addKeySignature(getKeySignatureSpecFromFifths(meta.keyFifths))
    }
    if (meta.showTimeSignature) {
      probeStave.addTimeSignature(toTimeSignatureKey(meta.timeSignature))
    }
  }
  if (meta.showEndTimeSignature) {
    probeStave.setEndTimeSignature(toTimeSignatureKey(meta.timeSignature))
  }

  const rawNoteStartOffset = probeStave.getNoteStartX()
  const rawNoteEndOffset = probeStave.getNoteEndX()
  const noteStartOffset = meta.preferMeasureStartBarlineAxis ? 0 : rawNoteStartOffset
  const noteEndOffset = rawNoteEndOffset
  return {
    noteStartX: noteStartOffset,
    noteEndX: noteEndOffset,
    formatWidth: Math.max(MIN_FORMAT_WIDTH_PX, noteEndOffset - noteStartOffset - 8),
  }
}

function probeMeasureSpacing(
  context: ReturnType<Renderer['getContext']>,
  meta: SolverMeasureMeta,
  measureWidth: number,
  spacingConfig: TimeAxisSpacingConfig,
): MeasureSpacingProbe | null {
  const geometry = buildMeasureProbeGeometry(meta, measureWidth)
  let probeTimelineBundle: ReturnType<typeof buildMeasureTimelineBundle> | null = null
  if (PUBLIC_AXIS_CONSUMPTION_MODE === 'merged') {
    const baseTimelineBundle = buildMeasureTimelineBundle({
      measure: meta.measure,
      measureIndex: meta.pairIndex,
      timeSignature: meta.timeSignature,
      spacingConfig,
      timelineMode: 'dual',
    })
    const effectiveBoundary = resolveEffectiveBoundary({
      measureX: 0,
      measureWidth,
      noteStartX: geometry.noteStartX,
      noteEndX: geometry.noteEndX,
      showStartDecorations: !meta.preferMeasureStartBarlineAxis,
      showEndDecorations: !meta.preferMeasureEndBarlineAxis,
    })
    probeTimelineBundle = attachMeasureTimelineAxisLayout({
      bundle: baseTimelineBundle,
      effectiveBoundaryStartX: effectiveBoundary.effectiveStartX,
      effectiveBoundaryEndX: effectiveBoundary.effectiveEndX,
      widthPx: measureWidth,
      spacingConfig,
    })
  }
  const spacingMetricsRef: {
    current:
      | {
          effectiveBoundaryStartX: number
          effectiveBoundaryEndX: number
          effectiveLeftGapPx: number
          effectiveRightGapPx: number
        }
      | null
  } = { current: null }
  const measureNoteLayouts = drawMeasureToContext({
    context,
    measure: meta.measure,
    pairIndex: meta.pairIndex,
    measureX: 0,
    measureWidth,
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
    skipPainting: true,
    formatWidthOverride: geometry.formatWidth,
    timeAxisSpacingConfig: spacingConfig,
    spacingLayoutMode: 'custom',
    publicAxisLayout: resolvePublicAxisLayoutForConsumption(probeTimelineBundle),
    preferMeasureBarlineAxis: meta.preferMeasureStartBarlineAxis,
    preferMeasureEndBarlineAxis: meta.preferMeasureEndBarlineAxis,
    enableEdgeGapCap: true,
    onSpacingMetrics: (
      metrics:
        | {
            effectiveBoundaryStartX: number
            effectiveBoundaryEndX: number
            effectiveLeftGapPx: number
            effectiveRightGapPx: number
          }
        | null,
    ) => {
      spacingMetricsRef.current = metrics
    },
  })
  const appliedMetrics = spacingMetricsRef.current
  if (
    appliedMetrics &&
    Number.isFinite(appliedMetrics.effectiveLeftGapPx) &&
    Number.isFinite(appliedMetrics.effectiveRightGapPx)
  ) {
    return {
      effectiveLeftGapPx: appliedMetrics.effectiveLeftGapPx,
      effectiveRightGapPx: appliedMetrics.effectiveRightGapPx,
      rightOverflowPx: Math.max(0, -appliedMetrics.effectiveRightGapPx),
    }
  }
  if (measureNoteLayouts.length === 0) {
    return {
      effectiveLeftGapPx: 0,
      effectiveRightGapPx: 0,
      rightOverflowPx: 0,
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
  if (!Number.isFinite(firstVisualLeftX) || !Number.isFinite(lastVisualRightX)) return null

  const boundary = resolveEffectiveBoundary({
    measureX: 0,
    measureWidth,
    noteStartX: geometry.noteStartX,
    noteEndX: geometry.noteEndX,
    showStartDecorations: meta.showStartDecorations,
    showEndDecorations: meta.showEndDecorations,
  })
  const effectiveLeftGapPx = firstVisualLeftX - boundary.effectiveStartX
  const effectiveRightGapPx = boundary.effectiveEndX - lastVisualRightX
  return {
    effectiveLeftGapPx,
    effectiveRightGapPx,
    rightOverflowPx: Math.max(0, lastVisualRightX - boundary.effectiveEndX),
  }
}

export function solveHorizontalMeasureWidths(params: SolveHorizontalMeasureWidthsParams): number[] {
  const {
    context,
    measurePairs,
    measureKeyFifthsByPair,
    measureTimeSignaturesByPair,
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

  const maxGapPx = Math.max(0, spacingConfig.maxBarlineEdgeGapPx)
  const minGapCandidate = Math.max(0, spacingConfig.minBarlineEdgeGapPx)
  const minGapPx = minGapCandidate <= maxGapPx ? minGapCandidate : maxGapPx
  const uniformPadding = getUniformTickSpacingPadding(spacingConfig)
  const sharedAxisPaddingPx = Math.max(
    0,
    Math.min(Math.max(0, uniformPadding.startPadPx), maxGapPx) +
      Math.min(Math.max(0, uniformPadding.endPadPx), maxGapPx),
  )
  const edgeGapBudgetPx = maxGapPx * 2
  const metas = resolveMeasureMeta({
    measurePairs,
    keyFifthsByPair: measureKeyFifthsByPair,
    timeSignaturesByPair: measureTimeSignaturesByPair,
  })

  return metas.map((meta) => {
    const shouldProbePrecisely = meta.pairIndex < eagerProbeMeasureLimit
    const cacheKey =
      shouldProbePrecisely && widthCache !== undefined
        ? buildMeasureWidthCacheKey({
            meta,
            spacingConfig,
            minMeasureWidthPx,
          })
        : null
    if (cacheKey && widthCache) {
      const cachedWidth = widthCache.get(cacheKey)
      if (Number.isFinite(cachedWidth)) {
        return Math.max(minMeasureWidthPx, cachedWidth as number)
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
    })
    const timelineSpan = getMeasureUniformTimelineWeightSpan(
      meta.measure,
      measureTicks,
      spacingConfig,
      timelineBundle,
    )
    const estimatedDecorationWidth =
      meta.isSystemStart
        ? EST_SYSTEM_START_DECORATION_PX
        : meta.showKeySignature || meta.showTimeSignature
          ? EST_INLINE_DECORATION_PX
          : 0
    let width = Math.max(
      minMeasureWidthPx,
      Number((sharedAxisPaddingPx + edgeGapBudgetPx + timelineSpan + estimatedDecorationWidth).toFixed(3)),
    )

    if (!shouldProbePrecisely) {
      if (cacheKey && widthCache) {
        widthCache.set(cacheKey, width)
      }
      return width
    }

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const probe = probeMeasureSpacing(context, meta, width, spacingConfig)
      if (!probe) break
      const leftDeficit = Math.max(0, minGapPx - probe.effectiveLeftGapPx)
      const rightDeficit = Math.max(0, minGapPx - probe.effectiveRightGapPx)
      const leftExcess = Math.max(0, probe.effectiveLeftGapPx - maxGapPx)
      const rightExcess = Math.max(0, probe.effectiveRightGapPx - maxGapPx)

      if (
        probe.rightOverflowPx <= EPS &&
        leftDeficit <= EPS &&
        rightDeficit <= EPS &&
        leftExcess <= EPS &&
        rightExcess <= EPS
      ) {
        break
      }

      if (probe.rightOverflowPx > EPS || leftDeficit > EPS || rightDeficit > EPS) {
        const growBy = probe.rightOverflowPx + leftDeficit + rightDeficit + STEP_PAD_PX
        width = Number((Math.max(minMeasureWidthPx, width + growBy)).toFixed(3))
        continue
      }

      const shrinkBy = Math.max(leftExcess, rightExcess)
      if (shrinkBy <= EPS) break
      const nextWidth = Number((Math.max(minMeasureWidthPx, width - shrinkBy)).toFixed(3))
      if (Math.abs(nextWidth - width) <= EPS) break
      width = nextWidth
    }

    if (cacheKey && widthCache) {
      widthCache.set(cacheKey, width)
    }
    return width
  })
}
