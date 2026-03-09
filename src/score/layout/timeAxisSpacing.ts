import { Accidental, type StaveNote } from 'vexflow'
import { DURATION_TICKS } from '../constants'
import { getAccidentalVisualX, getRenderedNoteVisualX } from './renderPosition'
import type { MeasurePair, ScoreNote } from '../types'
import { resolveEffectiveBoundary } from './effectiveBoundary'
import { buildPublicAxisLayout } from '../timeline/axisLayout'
import { compareLegacyAndMergedTimeline } from '../timeline/debug'
import { mergeStaffTimelines } from '../timeline/mergedTimeline'
import { buildStaffTimeline } from '../timeline/staffTimeline'
import type { MeasureTimelineBundle, PublicAxisLayout } from '../timeline/types'

type RenderedStaffNote = {
  vexNote: StaveNote
}

type TimeAxisNoteRef = {
  onsetTicks: number
  vexNote: StaveNote
  leftExtent: number
  rightExtent: number
}

type ApplyUnifiedTimeAxisSpacingParams = {
  measure: MeasurePair
  noteStartX: number
  formatWidth: number
  trebleRendered: RenderedStaffNote[]
  bassRendered: RenderedStaffNote[]
  spacingConfig?: TimeAxisSpacingConfig
  measureTicks?: number
  sparseTailAnchorMode?: 'none' | 'measure-end' | 'compact-tail'
  compactTailAnchorTicks?: number
  uniformSpacingByTicks?: boolean
  measureStartBarX?: number
  measureEndBarX?: number
  publicAxisLayout?: PublicAxisLayout | null
  preferMeasureBarlineAxis?: boolean
  preferMeasureEndBarlineAxis?: boolean
  enableEdgeGapCap?: boolean
}

const MIN_RENDER_WIDTH_PX = 1
const DEFAULT_LEFT_EDGE_PADDING_PX = 2
const DEFAULT_RIGHT_EDGE_PADDING_PX = 3
const DEFAULT_NOTE_HEAD_WIDTH_PX = 9
const TICKS_PER_QUARTER = 16
const DEFAULT_COMPACT_TAIL_ANCHOR_TICKS = 4
const UNIFORM_TICK_SPACING_START_GUARD_PX = 0
const UNIFORM_TICK_SPACING_END_GUARD_PX = 0
const UNIFORM_TIMELINE_EDGE_TICK_RATIO = 0
const ACCIDENTAL_PREALLOCATED_CLEARANCE_PX = 0
const STEM_INVARIANT_RIGHT_PADDING_PX = 3.5
const BASE_GAP_UNIT_PX = 3.5
const MIN_GAP_BEATS = 1 / 32
const GAP_GAMMA = 0.7
const GAP_BASE_WEIGHT = 0.45

export type TimeAxisSpacingConfig = {
  minGapBeats: number
  gapGamma: number
  gapBaseWeight: number
  leftEdgePaddingPx: number
  rightEdgePaddingPx: number
  interOnsetPaddingPx: number
  baseMinGap32Px: number
  minBarlineEdgeGapPx: number
  maxBarlineEdgeGapPx: number
  durationGapRatios: DurationGapRatioConfig
}

export type DurationGapRatioConfig = {
  thirtySecond: number
  sixteenth: number
  eighth: number
  quarter: number
  half: number
}

export const DEFAULT_TIME_AXIS_SPACING_CONFIG: TimeAxisSpacingConfig = {
  minGapBeats: MIN_GAP_BEATS,
  gapGamma: GAP_GAMMA,
  gapBaseWeight: GAP_BASE_WEIGHT,
  leftEdgePaddingPx: DEFAULT_LEFT_EDGE_PADDING_PX,
  rightEdgePaddingPx: DEFAULT_RIGHT_EDGE_PADDING_PX,
  interOnsetPaddingPx: 1,
  baseMinGap32Px: 6.9,
  minBarlineEdgeGapPx: 9.7,
  maxBarlineEdgeGapPx: 12.7,
  durationGapRatios: {
    thirtySecond: 0.7,
    sixteenth: 0.78,
    eighth: 0.93,
    quarter: 1.02,
    half: 1.22,
  },
}

function resolveEffectiveEdgeGapRange(
  spacingConfig: TimeAxisSpacingConfig,
): { minGapPx: number; maxGapPx: number } {
  const maxGapPx = Math.max(0, spacingConfig.maxBarlineEdgeGapPx)
  const minCandidate = Number.isFinite(spacingConfig.minBarlineEdgeGapPx)
    ? Math.max(0, spacingConfig.minBarlineEdgeGapPx)
    : 0
  const minGapPx = minCandidate <= maxGapPx ? minCandidate : maxGapPx
  return { minGapPx, maxGapPx }
}

function resolveEffectiveEdgePadding(
  spacingConfig: TimeAxisSpacingConfig,
): { leftPadPx: number; rightPadPx: number; minGapPx: number; maxGapPx: number } {
  const { minGapPx, maxGapPx } = resolveEffectiveEdgeGapRange(spacingConfig)
  const leftPadPx = Math.min(maxGapPx, Math.max(0, Math.max(spacingConfig.leftEdgePaddingPx, minGapPx)))
  const rightPadPx = Math.min(maxGapPx, Math.max(0, Math.max(spacingConfig.rightEdgePaddingPx, minGapPx)))
  return { leftPadPx, rightPadPx, minGapPx, maxGapPx }
}

export function getUniformTickSpacingPadding(
  spacingConfig: TimeAxisSpacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
): { startPadPx: number; endPadPx: number } {
  const { leftPadPx, rightPadPx } = resolveEffectiveEdgePadding(spacingConfig)
  return {
    startPadPx: leftPadPx + UNIFORM_TICK_SPACING_START_GUARD_PX,
    endPadPx: Math.max(0, rightPadPx + UNIFORM_TICK_SPACING_END_GUARD_PX),
  }
}

function getTickDuration(note: ScoreNote): number {
  const ticks = DURATION_TICKS[note.duration]
  if (!Number.isFinite(ticks)) return TICKS_PER_QUARTER
  return Math.max(1, ticks)
}

function getStaffTotalTicks(notes: ScoreNote[]): number {
  let cursorTicks = 0
  notes.forEach((note) => {
    cursorTicks += getTickDuration(note)
  })
  return Math.max(1, cursorTicks)
}

function getNoteHorizontalExtents(vexNote: StaveNote): { leftExtent: number; rightExtent: number } {
  let leftExtent = 0
  const stemInvariantPadding = vexNote.hasStem() ? STEM_INVARIANT_RIGHT_PADDING_PX : 0
  let rightExtent = DEFAULT_NOTE_HEAD_WIDTH_PX + stemInvariantPadding

  const metrics = (vexNote as unknown as {
    getMetrics?: () => {
      notePx?: number
      modLeftPx?: number
      modRightPx?: number
      leftDisplacedHeadPx?: number
      rightDisplacedHeadPx?: number
    }
  }).getMetrics?.()

  if (metrics) {
    const rightDisplacedHeadPx = Number.isFinite(metrics.rightDisplacedHeadPx)
      ? (metrics.rightDisplacedHeadPx as number)
      : 0

    // Keep right extent anchored to note-head geometry with pitch-invariant
    // stem padding. Left extent is derived from rendered glyph edges below.
    rightExtent = Math.max(
      DEFAULT_NOTE_HEAD_WIDTH_PX + stemInvariantPadding,
      DEFAULT_NOTE_HEAD_WIDTH_PX + rightDisplacedHeadPx + stemInvariantPadding,
    )
  }

  const noteHeadX = getRenderedNoteVisualX(vexNote)
  if (Number.isFinite(noteHeadX)) {
    let accidentalMinX = Number.POSITIVE_INFINITY
    vexNote.getModifiersByType(Accidental.CATEGORY).forEach((modifier) => {
      const accidental = modifier as Accidental
      const renderedIndex = accidental.getIndex()
      if (typeof renderedIndex !== 'number' || !Number.isFinite(renderedIndex)) return
      const accidentalX = getAccidentalVisualX(vexNote, accidental, renderedIndex)
      if (typeof accidentalX === 'number' && Number.isFinite(accidentalX)) {
        accidentalMinX = Math.min(accidentalMinX, accidentalX)
      }
    })
    if (Number.isFinite(accidentalMinX)) {
      // Accidental columns in VexFlow metrics are intentionally conservative.
      // Use the actual rendered accidental edge so edge-gap=0 can visually
      // reach the boundary instead of leaving hidden reserved whitespace.
      leftExtent = Math.max(0, noteHeadX - accidentalMinX + ACCIDENTAL_PREALLOCATED_CLEARANCE_PX)
    }
  }

  return { leftExtent, rightExtent }
}

function buildTimeAxisRefs(notes: ScoreNote[], rendered: RenderedStaffNote[]): TimeAxisNoteRef[] {
  const refs: TimeAxisNoteRef[] = []
  let cursorTicks = 0

  notes.forEach((note, noteIndex) => {
    const durationTicks = getTickDuration(note)
    const renderedEntry = rendered[noteIndex]
    if (renderedEntry) {
      const headX = getRenderedNoteVisualX(renderedEntry.vexNote)
      if (Number.isFinite(headX)) {
        const extents = getNoteHorizontalExtents(renderedEntry.vexNote)
        refs.push({
          onsetTicks: cursorTicks,
          vexNote: renderedEntry.vexNote,
          leftExtent: extents.leftExtent,
          rightExtent: extents.rightExtent,
        })
      }
    }
    cursorTicks += durationTicks
  })

  return refs
}

function buildStaffOnsetTicks(notes: ScoreNote[]): number[] {
  const onsetTicks: number[] = []
  let cursorTicks = 0
  notes.forEach((note) => {
    onsetTicks.push(cursorTicks)
    cursorTicks += getTickDuration(note)
  })
  return onsetTicks
}

export function collectMeasureOnsetTicks(measure: MeasurePair): number[] {
  const onsetTicksSet = new Set<number>()
  buildStaffOnsetTicks(measure.treble).forEach((onset) => onsetTicksSet.add(onset))
  buildStaffOnsetTicks(measure.bass).forEach((onset) => onsetTicksSet.add(onset))
  return [...onsetTicksSet].sort((left, right) => left - right)
}

export function buildLegacyOnsetTicks(measure: MeasurePair): number[] {
  return collectMeasureOnsetTicks(measure)
}

function resolveMeasureTicksFromTimeSignature(timeSignature: { beats: number; beatType: number }): number {
  const beats = Number.isFinite(timeSignature.beats) ? Math.max(1, timeSignature.beats) : 4
  const beatType = Number.isFinite(timeSignature.beatType) ? Math.max(1, timeSignature.beatType) : 4
  const measureTicks = beats * TICKS_PER_QUARTER * (4 / beatType)
  if (Number.isFinite(measureTicks) && measureTicks > 0) {
    return Math.max(1, Math.round(measureTicks))
  }
  return TICKS_PER_QUARTER * 4
}

export function buildMeasureTimelineBundle(params: {
  measure: MeasurePair
  measureIndex: number
  timeSignature: { beats: number; beatType: number }
  spacingConfig?: TimeAxisSpacingConfig
  timelineMode?: 'legacy' | 'dual' | 'merged'
}): MeasureTimelineBundle {
  const {
    measure,
    measureIndex,
    timeSignature,
    timelineMode = 'dual',
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
  } = params
  const legacyOnsets = buildLegacyOnsetTicks(measure)
  const measureTicks = resolveMeasureTicksFromTimeSignature(timeSignature)
  const trebleTimeline = buildStaffTimeline(measure.treble, 'treble', measureIndex, measureTicks)
  const bassTimeline = buildStaffTimeline(measure.bass, 'bass', measureIndex, measureTicks)
  const publicTimeline = mergeStaffTimelines({
    measureIndex,
    measureTicks,
    timeSignature,
    trebleTimeline,
    bassTimeline,
  })
  const publicAxisLayout = buildPublicAxisLayout({
    measureIndex,
    measureTicks,
    publicTimeline,
    spacingConfig: {
      baseMinGap32Px: spacingConfig.baseMinGap32Px,
      durationGapRatios: spacingConfig.durationGapRatios,
    },
    effectiveBoundaryStartX: 0,
    effectiveBoundaryEndX: 1,
  })
  return {
    measureIndex,
    measureTicks,
    legacyOnsets,
    trebleTimeline,
    bassTimeline,
    publicTimeline,
    publicAxisLayout: publicAxisLayout.widthPx > 0 ? publicAxisLayout : null,
    timelineDiffSummary: compareLegacyAndMergedTimeline({
      legacyOnsets,
      publicTimeline,
      publicAxisLayout,
    }),
    timelineMode,
  }
}

export function attachMeasureTimelineAxisLayout(params: {
  bundle: MeasureTimelineBundle
  effectiveBoundaryStartX: number
  effectiveBoundaryEndX: number
  widthPx: number
  spacingConfig?: TimeAxisSpacingConfig
}): MeasureTimelineBundle {
  const {
    bundle,
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
    widthPx,
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
  } = params
  const publicAxisLayout = buildPublicAxisLayout({
    measureIndex: bundle.measureIndex,
    measureTicks: bundle.measureTicks,
    publicTimeline: bundle.publicTimeline,
    spacingConfig: {
      baseMinGap32Px: spacingConfig.baseMinGap32Px,
      durationGapRatios: spacingConfig.durationGapRatios,
    },
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
  })
  return {
    ...bundle,
    publicAxisLayout: {
      ...publicAxisLayout,
      widthPx,
    },
    timelineDiffSummary: compareLegacyAndMergedTimeline({
      legacyOnsets: bundle.legacyOnsets,
      publicTimeline: bundle.publicTimeline,
      publicAxisLayout,
    }),
  }
}

export type UniformTickTimeline = {
  firstOnsetTicks: number
  lastOnsetTicks: number
  startEdgeTicks: number
  endEdgeTicks: number
  domainStartTicks: number
  domainEndTicks: number
  domainSpanTicks: number
}

type UniformTimelineWeightMap = {
  timeline: UniformTickTimeline
  orderedTicks: number[]
  cumulativeWeightByTick: Map<number, number>
  totalWeight: number
}

export type AppliedTimeAxisSpacingMetrics = {
  effectiveBoundaryStartX: number
  effectiveBoundaryEndX: number
  effectiveLeftGapPx: number
  effectiveRightGapPx: number
}

export function getUniformTickTimeline(noteOnsets: number[], measureTicks: number): UniformTickTimeline {
  const safeMeasureTicks = Math.max(1, measureTicks)
  const sortedOnsets = [...new Set(noteOnsets.filter((value) => Number.isFinite(value)))].sort((left, right) => left - right)
  if (sortedOnsets.length === 0) {
    return {
      firstOnsetTicks: 0,
      lastOnsetTicks: safeMeasureTicks,
      startEdgeTicks: 0,
      endEdgeTicks: 0,
      domainStartTicks: 0,
      domainEndTicks: safeMeasureTicks,
      domainSpanTicks: safeMeasureTicks,
    }
  }

  const firstOnsetTicks = sortedOnsets[0]
  const lastOnsetTicks = sortedOnsets[sortedOnsets.length - 1]
  const fallbackGapTicks = Math.max(1, safeMeasureTicks / 2)
  const firstForwardGapTicks =
    sortedOnsets.length > 1 ? Math.max(1, sortedOnsets[1] - sortedOnsets[0]) : fallbackGapTicks
  const trailingToMeasureEndTicks = safeMeasureTicks - lastOnsetTicks
  const lastBackwardGapTicks =
    sortedOnsets.length > 1 ? Math.max(1, sortedOnsets[sortedOnsets.length - 1] - sortedOnsets[sortedOnsets.length - 2]) : firstForwardGapTicks
  const trailingGapTicks =
    trailingToMeasureEndTicks > 0 ? Math.max(1, trailingToMeasureEndTicks) : lastBackwardGapTicks

  const startEdgeTicks = Math.max(0, firstForwardGapTicks * UNIFORM_TIMELINE_EDGE_TICK_RATIO)
  const endEdgeTicks = Math.max(0, trailingGapTicks * UNIFORM_TIMELINE_EDGE_TICK_RATIO)
  const domainStartTicks = firstOnsetTicks - startEdgeTicks
  const domainEndTicks = lastOnsetTicks + endEdgeTicks
  const domainSpanTicks = Math.max(1, domainEndTicks - domainStartTicks)

  return {
    firstOnsetTicks,
    lastOnsetTicks,
    startEdgeTicks,
    endEdgeTicks,
    domainStartTicks,
    domainEndTicks,
    domainSpanTicks,
  }
}

export function getMeasureUniformTimelineTicks(measure: MeasurePair, measureTicks: number): number {
  const onsets = collectMeasureOnsetTicks(measure)
  return getUniformTickTimeline(onsets, measureTicks).domainSpanTicks
}

function mapTickGapToWeight(deltaTicks: number, config: TimeAxisSpacingConfig): number {
  const durationRatio = Math.max(0.0001, getDurationGapRatioByDeltaTicks(deltaTicks, config.durationGapRatios))
  const base32GapPx = Math.max(0, config.baseMinGap32Px)
  return base32GapPx * durationRatio * BASE_GAP_UNIT_PX
}

function getDurationGapRatioByDeltaTicks(deltaTicks: number, ratios: DurationGapRatioConfig): number {
  const anchors: Array<{ ticks: number; ratio: number }> = [
    { ticks: 2, ratio: ratios.thirtySecond },
    { ticks: 4, ratio: ratios.sixteenth },
    { ticks: 8, ratio: ratios.eighth },
    { ticks: 16, ratio: ratios.quarter },
    { ticks: 32, ratio: ratios.half },
  ]
  const safeTicks = Math.max(1, deltaTicks)
  if (safeTicks <= anchors[0].ticks) return anchors[0].ratio
  if (safeTicks >= anchors[anchors.length - 1].ticks) return anchors[anchors.length - 1].ratio
  for (let i = 1; i < anchors.length; i += 1) {
    const left = anchors[i - 1]
    const right = anchors[i]
    if (safeTicks === right.ticks) return right.ratio
    if (safeTicks < right.ticks) {
      const leftLog = Math.log2(left.ticks)
      const rightLog = Math.log2(right.ticks)
      const tickLog = Math.log2(safeTicks)
      const blend = (tickLog - leftLog) / Math.max(0.0001, rightLog - leftLog)
      return left.ratio + (right.ratio - left.ratio) * blend
    }
  }
  return anchors[anchors.length - 1].ratio
}

function getDurationAddedMinGapPx(deltaTicks: number, spacingConfig: TimeAxisSpacingConfig): number {
  void deltaTicks
  void spacingConfig
  return 0
}

function buildUniformTimelineWeightMap(
  noteOnsets: number[],
  measureTicks: number,
  config: TimeAxisSpacingConfig,
): UniformTimelineWeightMap {
  const timeline = getUniformTickTimeline(noteOnsets, measureTicks)
  const orderedTicks = [
    ...new Set([
      timeline.domainStartTicks,
      ...[...new Set(noteOnsets)].filter(
        (tick) => Number.isFinite(tick) && tick >= timeline.domainStartTicks && tick <= timeline.domainEndTicks,
      ),
      timeline.domainEndTicks,
    ]),
  ].sort((left, right) => left - right)

  const cumulativeWeightByTick = new Map<number, number>()
  if (orderedTicks.length === 0) {
    return {
      timeline,
      orderedTicks: [],
      cumulativeWeightByTick,
      totalWeight: 1,
    }
  }

  cumulativeWeightByTick.set(orderedTicks[0], 0)
  let cumulativeWeight = 0
  for (let i = 1; i < orderedTicks.length; i += 1) {
    const deltaTicks = Math.max(1, orderedTicks[i] - orderedTicks[i - 1])
    cumulativeWeight += mapTickGapToWeight(deltaTicks, config)
    cumulativeWeightByTick.set(orderedTicks[i], cumulativeWeight)
  }

  return {
    timeline,
    orderedTicks,
    cumulativeWeightByTick,
    totalWeight: Math.max(0.0001, cumulativeWeight),
  }
}

function applyMeasureEdgeGapCap(params: {
  noteOnsets: number[]
  targetXByOnset: Map<number, number>
  edgeBoundaryStart: number
  edgeBoundaryEnd: number
  legalBoundaryStart: number
  legalBoundaryEnd: number
  firstLeftExtent: number
  lastRightExtent: number
  minBarlineEdgeGapPx: number
  maxBarlineEdgeGapPx: number
}): void {
  const {
    noteOnsets,
    targetXByOnset,
    edgeBoundaryStart,
    edgeBoundaryEnd,
    legalBoundaryStart,
    legalBoundaryEnd,
    firstLeftExtent,
    lastRightExtent,
    minBarlineEdgeGapPx,
    maxBarlineEdgeGapPx,
  } = params

  if (!Number.isFinite(maxBarlineEdgeGapPx)) return
  const maxGap = Math.max(0, maxBarlineEdgeGapPx)
  const minGapCandidate = Number.isFinite(minBarlineEdgeGapPx) ? Math.max(0, minBarlineEdgeGapPx) : 0
  const minGap = minGapCandidate <= maxGap ? minGapCandidate : maxGap
  const hasEffectiveMinGap = minGap > 0
  if (noteOnsets.length === 0) return

  const positions = noteOnsets.map((onset) => targetXByOnset.get(onset))
  if (positions.some((value) => value === undefined || !Number.isFinite(value))) return
  const safePositions = positions as number[]

  const firstIndex = 0
  const lastIndex = safePositions.length - 1
  const currentFirstX = safePositions[firstIndex]
  const currentLastX = safePositions[lastIndex]
  if (!Number.isFinite(currentFirstX) || !Number.isFinite(currentLastX)) return

  const minFirstX = legalBoundaryStart
  const maxLastX = legalBoundaryEnd
  if (!Number.isFinite(minFirstX) || !Number.isFinite(maxLastX) || minFirstX > maxLastX) return

  // Preserve all inter-onset spacing and only resolve by translation.
  const legalShiftMin = minFirstX - currentFirstX
  const legalShiftMax = maxLastX - currentLastX
  if (!Number.isFinite(legalShiftMin) || !Number.isFinite(legalShiftMax) || legalShiftMin > legalShiftMax) return

  // Cap is interpreted as visual edge distance: first/last note glyph edge to
  // measure boundary. This keeps "=0" behavior aligned with user expectation
  // (touching boundaries), instead of onset anchor distance.
  const currentLeftEdgeGap = currentFirstX - firstLeftExtent - edgeBoundaryStart
  const currentRightEdgeGap = edgeBoundaryEnd - (currentLastX + lastRightExtent)
  if (!Number.isFinite(currentLeftEdgeGap) || !Number.isFinite(currentRightEdgeGap)) return

  // leftGap' = currentLeftEdgeGap + shift <= maxGap
  // rightGap' = currentRightEdgeGap - shift <= maxGap
  const capShiftMin = currentRightEdgeGap - maxGap
  const capShiftMax = maxGap - currentLeftEdgeGap

  const minShiftMin = minGap - currentLeftEdgeGap
  const minShiftMax = currentRightEdgeGap - minGap
  const feasibleShiftMin = Math.max(legalShiftMin, capShiftMin, hasEffectiveMinGap ? minShiftMin : Number.NEGATIVE_INFINITY)
  const feasibleShiftMax = Math.min(legalShiftMax, capShiftMax, hasEffectiveMinGap ? minShiftMax : Number.POSITIVE_INFINITY)

  const clampShift = (value: number): number => Math.max(legalShiftMin, Math.min(legalShiftMax, value))

  let resolvedShift = 0
  if (feasibleShiftMin <= feasibleShiftMax) {
    resolvedShift = Math.max(feasibleShiftMin, Math.min(0, feasibleShiftMax))
  } else {
    // If min-gap constraints are infeasible, disable min-gap and keep max-gap behavior.
    const feasibleWithoutMinShiftMin = Math.max(legalShiftMin, capShiftMin)
    const feasibleWithoutMinShiftMax = Math.min(legalShiftMax, capShiftMax)
    if (feasibleWithoutMinShiftMin <= feasibleWithoutMinShiftMax) {
      resolvedShift = Math.max(feasibleWithoutMinShiftMin, Math.min(0, feasibleWithoutMinShiftMax))
    } else {
    // When cap constraints are infeasible under pure translation, prefer a
    // balanced placement (left/right gaps as equal as possible) instead of
    // forcing one side to the cap and exploding the opposite side.
      const balancedShift = (currentRightEdgeGap - currentLeftEdgeGap) * 0.5
      resolvedShift = clampShift(balancedShift)
    }
  }

  if (!Number.isFinite(resolvedShift) || Math.abs(resolvedShift) < 0.001) return

  for (let i = 0; i < safePositions.length; i += 1) {
    targetXByOnset.set(noteOnsets[i], safePositions[i] + resolvedShift)
  }
}

export function getMeasureUniformTimelineWeightSpan(
  measure: MeasurePair,
  measureTicks: number,
  spacingConfig: TimeAxisSpacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
  timelineBundle: MeasureTimelineBundle | null = null,
): number {
  void measureTicks
  const onsets = timelineBundle
    ? timelineBundle.publicTimeline.points.map((point) => point.tick).sort((left, right) => left - right)
    : collectMeasureOnsetTicks(measure).sort((left, right) => left - right)
  if (onsets.length <= 1) return 0
  let totalGapPx = 0
  for (let i = 1; i < onsets.length; i += 1) {
    const deltaTicks = Math.max(1, onsets[i] - onsets[i - 1])
    totalGapPx += Math.max(0, mapTickGapToWeight(deltaTicks, spacingConfig))
  }
  return Math.max(0, totalGapPx)
}

export function applyUnifiedTimeAxisSpacing(params: ApplyUnifiedTimeAxisSpacingParams): AppliedTimeAxisSpacingMetrics | null {
  const {
    measure,
    noteStartX,
    formatWidth,
    trebleRendered,
    bassRendered,
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
    measureTicks,
    sparseTailAnchorMode = 'none',
    compactTailAnchorTicks = DEFAULT_COMPACT_TAIL_ANCHOR_TICKS,
    uniformSpacingByTicks = false,
    measureStartBarX,
    measureEndBarX,
    publicAxisLayout = null,
    preferMeasureBarlineAxis = false,
    preferMeasureEndBarlineAxis = false,
    enableEdgeGapCap = true,
  } = params

  const refs = [
    ...buildTimeAxisRefs(measure.treble, trebleRendered),
    ...buildTimeAxisRefs(measure.bass, bassRendered),
  ]
  if (refs.length === 0) return null

  const refsByOnset = new Map<number, TimeAxisNoteRef[]>()
  refs.forEach((ref) => {
    const list = refsByOnset.get(ref.onsetTicks)
    if (list) {
      list.push(ref)
    } else {
      refsByOnset.set(ref.onsetTicks, [ref])
    }
  })

  const noteOnsets = [...refsByOnset.keys()].sort((a, b) => a - b)
  if (noteOnsets.length === 0) return null

  const measuredTotalTicks = Math.max(getStaffTotalTicks(measure.treble), getStaffTotalTicks(measure.bass))
  const measureTotalTicks =
    typeof measureTicks === 'number' && Number.isFinite(measureTicks) && measureTicks > 0
      ? Math.max(1, Math.round(measureTicks))
      : measuredTotalTicks
  const timelineOnsetsSet = new Set<number>(noteOnsets)
  const firstNoteOnset = noteOnsets[0]
  const lastNoteOnset = noteOnsets[noteOnsets.length - 1]
  const shouldInjectTimelineAnchors = sparseTailAnchorMode !== 'none' && noteOnsets.length <= 2
  if (shouldInjectTimelineAnchors && firstNoteOnset > 0) {
    timelineOnsetsSet.add(0)
  }
  if (shouldInjectTimelineAnchors) {
    if (sparseTailAnchorMode === 'measure-end') {
      if (measureTotalTicks > lastNoteOnset) {
        timelineOnsetsSet.add(measureTotalTicks)
      }
    } else if (sparseTailAnchorMode === 'compact-tail') {
      const safeTailTicks = Math.max(1, Math.min(TICKS_PER_QUARTER, Math.round(compactTailAnchorTicks)))
      timelineOnsetsSet.add(lastNoteOnset + safeTailTicks)
    }
  }
  const onsetTicks = [...timelineOnsetsSet].sort((a, b) => a - b)
  if (onsetTicks.length === 0) return null

  const firstOnsetRefs = refsByOnset.get(firstNoteOnset) ?? []
  const lastOnsetRefs = refsByOnset.get(lastNoteOnset) ?? []
  const firstLeftExtent = firstOnsetRefs.reduce((max, ref) => Math.max(max, ref.leftExtent), 0)
  const lastRightExtent = lastOnsetRefs.reduce((max, ref) => Math.max(max, ref.rightExtent), DEFAULT_NOTE_HEAD_WIDTH_PX)

  const usableFormatWidth = Math.max(MIN_RENDER_WIDTH_PX, formatWidth)
  const { leftPadPx: cappedEdgePaddingLeft, rightPadPx: cappedEdgePaddingRight, minGapPx: minBarlineEdgeGapPx } =
    resolveEffectiveEdgePadding(spacingConfig)
  const defaultAxisBoundaryStart = noteStartX
  const defaultAxisBoundaryEnd = noteStartX + usableFormatWidth
  const barlineAxisBoundaryStart =
    typeof measureStartBarX === 'number' && Number.isFinite(measureStartBarX)
      ? measureStartBarX
      : defaultAxisBoundaryStart
  const barlineAxisBoundaryEnd =
    typeof measureEndBarX === 'number' && Number.isFinite(measureEndBarX)
      ? measureEndBarX
      : defaultAxisBoundaryEnd
  const effectiveBoundary = resolveEffectiveBoundary({
    measureX: barlineAxisBoundaryStart,
    measureWidth: barlineAxisBoundaryEnd - barlineAxisBoundaryStart,
    noteStartX: defaultAxisBoundaryStart,
    noteEndX: defaultAxisBoundaryEnd,
    showStartDecorations: !preferMeasureBarlineAxis,
    showEndDecorations: !preferMeasureEndBarlineAxis,
  })
  const axisBoundaryStart = uniformSpacingByTicks ? effectiveBoundary.effectiveStartX : defaultAxisBoundaryStart
  const axisBoundaryEnd = uniformSpacingByTicks ? effectiveBoundary.effectiveEndX : defaultAxisBoundaryEnd

  const edgeLegalStartInset = firstLeftExtent
  const edgeLegalEndInset = lastRightExtent
  const startPad = uniformSpacingByTicks
    ? Math.max(
      Math.max(0, cappedEdgePaddingLeft + UNIFORM_TICK_SPACING_START_GUARD_PX),
      edgeLegalStartInset + cappedEdgePaddingLeft,
    )
    : Math.max(1, edgeLegalStartInset + cappedEdgePaddingLeft)
  const endPad = uniformSpacingByTicks
    ? Math.max(
      Math.max(0, cappedEdgePaddingRight + UNIFORM_TICK_SPACING_END_GUARD_PX),
      edgeLegalEndInset + cappedEdgePaddingRight,
    )
    : Math.max(1, edgeLegalEndInset + cappedEdgePaddingRight)

  const axisStart = axisBoundaryStart + startPad
  const axisEnd = axisBoundaryEnd - endPad

  const targetXByOnset = new Map<number, number>()

  if (publicAxisLayout?.tickToX && publicAxisLayout.tickToX.size > 0) {
    noteOnsets.forEach((onset) => {
      const axisX = publicAxisLayout.tickToX.get(onset)
      if (Number.isFinite(axisX)) {
        targetXByOnset.set(onset, axisX as number)
      }
    })
  }

  if (targetXByOnset.size === 0 && uniformSpacingByTicks) {
    const timelineWeightMap = buildUniformTimelineWeightMap(noteOnsets, measureTotalTicks, spacingConfig)
    const spanWidth = Math.max(1, axisEnd - axisStart)
    const intrinsicSpan = Math.max(0.0001, timelineWeightMap.totalWeight)
    // Keep inter-onset spacing stable across measures: do not stretch when
    // there is extra measure width, only compress when axis span is smaller
    // than intrinsic timeline span.
    const timelineScale = Math.min(1, spanWidth / intrinsicSpan)
    noteOnsets.forEach((onset) => {
      const cumulativeWeight = timelineWeightMap.cumulativeWeightByTick.get(onset)
      if (cumulativeWeight === undefined) return
      targetXByOnset.set(onset, axisStart + cumulativeWeight * timelineScale)
    })

    if (noteOnsets.length > 1) {
      const onsetSequence = noteOnsets
      const basePositions = onsetSequence.map((onset) => targetXByOnset.get(onset) ?? axisStart)
      const leftExtents = onsetSequence.map((onset) =>
        (refsByOnset.get(onset) ?? []).reduce((max, ref) => Math.max(max, ref.leftExtent), 0),
      )
      const rightExtents = onsetSequence.map((onset) => {
        const list = refsByOnset.get(onset) ?? []
        if (list.length === 0) return DEFAULT_NOTE_HEAD_WIDTH_PX
        return list.reduce((max, ref) => Math.max(max, ref.rightExtent), DEFAULT_NOTE_HEAD_WIDTH_PX)
      })
      const baseGapByDeltaTicks = new Map<number, number>()
      const requiredMinGapBySegment = new Map<number, number>()
      for (let i = 1; i < onsetSequence.length; i += 1) {
        const deltaTicks = Math.max(1, onsetSequence[i] - onsetSequence[i - 1])
        const baseGap = Math.max(0.001, basePositions[i] - basePositions[i - 1])
        const minGap =
          rightExtents[i - 1] +
          leftExtents[i] +
          spacingConfig.interOnsetPaddingPx +
          getDurationAddedMinGapPx(deltaTicks, spacingConfig)

        const currentBaseGap = baseGapByDeltaTicks.get(deltaTicks) ?? 0
        if (baseGap > currentBaseGap) {
          baseGapByDeltaTicks.set(deltaTicks, baseGap)
        }
        requiredMinGapBySegment.set(i, minGap)
      }
      const adjustedPositions = [...basePositions]
      for (let i = 1; i < onsetSequence.length; i += 1) {
        const deltaTicks = Math.max(1, onsetSequence[i] - onsetSequence[i - 1])
        const floorGap = baseGapByDeltaTicks.get(deltaTicks) ?? 0
        const segmentMinGap = requiredMinGapBySegment.get(i) ?? 0
        const targetMinGap = Math.max(floorGap, segmentMinGap)
        const minAllowed = adjustedPositions[i - 1] + targetMinGap
        if (adjustedPositions[i] < minAllowed) {
          adjustedPositions[i] = minAllowed
        }
      }

      const hasAdjustedGap = adjustedPositions.some((x, index) => Math.abs(x - basePositions[index]) > 0.001)
      if (hasAdjustedGap) {
        const overflow = adjustedPositions[adjustedPositions.length - 1] - axisEnd
        if (overflow > 0) {
          const availableLeftShift = Math.max(0, adjustedPositions[0] - axisStart)
          const shift = Math.min(overflow, availableLeftShift)
          if (shift > 0) {
            for (let i = 0; i < adjustedPositions.length; i += 1) {
              adjustedPositions[i] -= shift
            }
          }
        }

        onsetSequence.forEach((onset, index) => {
          targetXByOnset.set(onset, adjustedPositions[index])
        })
      }
    }
  } else if (targetXByOnset.size === 0) {

    if (axisEnd <= axisStart) {
      const fallbackX = noteStartX + usableFormatWidth * 0.5
      onsetTicks.forEach((onset) => {
        targetXByOnset.set(onset, fallbackX)
      })
    } else if (onsetTicks.length === 1) {
      targetXByOnset.set(onsetTicks[0], (axisStart + axisEnd) * 0.5)
    } else {
      const spanWidth = axisEnd - axisStart
      const gapWeights: number[] = []
      for (let i = 1; i < onsetTicks.length; i += 1) {
        const deltaTicks = Math.max(1, onsetTicks[i] - onsetTicks[i - 1])
        gapWeights.push(mapTickGapToWeight(deltaTicks, spacingConfig))
      }
      const totalWeight = gapWeights.reduce((sum, value) => sum + value, 0)
      if (totalWeight <= 0) {
        const step = spanWidth / (onsetTicks.length - 1)
        onsetTicks.forEach((onset, index) => {
          targetXByOnset.set(onset, axisStart + step * index)
        })
      } else {
        targetXByOnset.set(onsetTicks[0], axisStart)
        let cumulative = 0
        for (let i = 1; i < onsetTicks.length; i += 1) {
          cumulative += gapWeights[i - 1]
          const ratio = cumulative / totalWeight
          targetXByOnset.set(onsetTicks[i], axisStart + spanWidth * ratio)
        }
      }
    }

    if (onsetTicks.length > 1) {
      const basePositions = onsetTicks.map((onset) => targetXByOnset.get(onset) ?? axisStart)
      const leftExtents = onsetTicks.map((onset) =>
        (refsByOnset.get(onset) ?? []).reduce((max, ref) => Math.max(max, ref.leftExtent), 0),
      )
      const rightExtents = onsetTicks.map((onset) => {
        const list = refsByOnset.get(onset) ?? []
        if (list.length === 0) return 0
        return list.reduce((max, ref) => Math.max(max, ref.rightExtent), DEFAULT_NOTE_HEAD_WIDTH_PX)
      })
      const minGaps = onsetTicks.slice(1).map((_, index) => {
        const deltaTicks = Math.max(1, onsetTicks[index + 1] - onsetTicks[index])
        const glyphGap = rightExtents[index] + leftExtents[index + 1] + spacingConfig.interOnsetPaddingPx
        return Math.max(1, glyphGap + getDurationAddedMinGapPx(deltaTicks, spacingConfig))
      })
      const spanWidth = Math.max(1, axisEnd - axisStart)
      const minGapTotal = minGaps.reduce((sum, value) => sum + value, 0)
      const gapScale = minGapTotal > spanWidth ? spanWidth / minGapTotal : 1
      const scaledMinGaps = minGaps.map((value) => value * gapScale)
      const constrained = [...basePositions]

      for (let i = 1; i < constrained.length; i += 1) {
        const minAllowed = constrained[i - 1] + scaledMinGaps[i - 1]
        if (constrained[i] < minAllowed) {
          constrained[i] = minAllowed
        }
      }

      const overflow = constrained[constrained.length - 1] - axisEnd
      if (overflow > 0) {
        for (let i = 0; i < constrained.length; i += 1) {
          constrained[i] -= overflow
        }
      }

      for (let i = constrained.length - 2; i >= 0; i -= 1) {
        const maxAllowed = constrained[i + 1] - scaledMinGaps[i]
        if (constrained[i] > maxAllowed) {
          constrained[i] = maxAllowed
        }
      }

      const underflow = axisStart - constrained[0]
      if (underflow > 0) {
        for (let i = 0; i < constrained.length; i += 1) {
          constrained[i] += underflow
        }
      }

      for (let i = 1; i < constrained.length; i += 1) {
        const minAllowed = constrained[i - 1] + scaledMinGaps[i - 1]
        if (constrained[i] < minAllowed) {
          constrained[i] = minAllowed
        }
      }

      onsetTicks.forEach((onset, index) => {
        targetXByOnset.set(onset, constrained[index])
      })
    }
  }

  if (enableEdgeGapCap) {
    const legalBoundaryStart = axisBoundaryStart + Math.max(0, edgeLegalStartInset)
    const legalBoundaryEnd = axisBoundaryEnd - Math.max(0, edgeLegalEndInset)
    applyMeasureEdgeGapCap({
      noteOnsets,
      targetXByOnset,
      // Use effective spacing boundaries (noteStartX / noteEndX when
      // key/time signatures occupy measure edges) so edge-cap logic doesn't
      // push notes into decorations.
      edgeBoundaryStart: axisBoundaryStart,
      edgeBoundaryEnd: axisBoundaryEnd,
      legalBoundaryStart,
      legalBoundaryEnd,
      firstLeftExtent,
      lastRightExtent,
      minBarlineEdgeGapPx,
      maxBarlineEdgeGapPx: spacingConfig.maxBarlineEdgeGapPx,
    })
  }

  refs.forEach((ref) => {
    const targetX = targetXByOnset.get(ref.onsetTicks)
    if (targetX === undefined) return
    const currentX = getRenderedNoteVisualX(ref.vexNote)
    if (!Number.isFinite(currentX)) return
    const delta = targetX - currentX
    if (Math.abs(delta) < 0.001) return
    ref.vexNote.setXShift(ref.vexNote.getXShift() + delta)
  })

  const firstOnset = noteOnsets[0]
  const lastOnset = noteOnsets[noteOnsets.length - 1]
  const resolvedFirstX = targetXByOnset.get(firstOnset)
  const resolvedLastX = targetXByOnset.get(lastOnset)
  if (
    typeof resolvedFirstX !== 'number' ||
    !Number.isFinite(resolvedFirstX) ||
    typeof resolvedLastX !== 'number' ||
    !Number.isFinite(resolvedLastX)
  ) {
    return null
  }

  return {
    effectiveBoundaryStartX: axisBoundaryStart,
    effectiveBoundaryEndX: axisBoundaryEnd,
    effectiveLeftGapPx: resolvedFirstX - firstLeftExtent - axisBoundaryStart,
    effectiveRightGapPx: axisBoundaryEnd - (resolvedLastX + lastRightExtent),
  }
}
