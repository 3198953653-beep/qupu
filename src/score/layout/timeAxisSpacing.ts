import { Accidental, type StaveNote } from 'vexflow'
import { DURATION_TICKS } from '../constants'
import { getAccidentalVisualX, getRenderedNoteVisualX } from './renderPosition'
import type { MeasurePair, ScoreNote } from '../types'

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
const UNIFORM_TIMELINE_EDGE_TICK_RATIO = 0.82
const ACCIDENTAL_PREALLOCATED_CLEARANCE_PX = 2
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
  baseMinGap32Px: 4,
  maxBarlineEdgeGapPx: 18,
  durationGapRatios: {
    thirtySecond: 0.7,
    sixteenth: 0.78,
    eighth: 0.93,
    quarter: 1.02,
    half: 1.22,
  },
}

export function getUniformTickSpacingPadding(
  spacingConfig: TimeAxisSpacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
): { startPadPx: number; endPadPx: number } {
  return {
    startPadPx: spacingConfig.leftEdgePaddingPx + UNIFORM_TICK_SPACING_START_GUARD_PX,
    endPadPx: Math.max(0, spacingConfig.rightEdgePaddingPx + UNIFORM_TICK_SPACING_END_GUARD_PX),
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
    const leftDisplacedHeadPx = Number.isFinite(metrics.leftDisplacedHeadPx) ? (metrics.leftDisplacedHeadPx as number) : 0
    const rightDisplacedHeadPx = Number.isFinite(metrics.rightDisplacedHeadPx)
      ? (metrics.rightDisplacedHeadPx as number)
      : 0

    // Keep extents anchored to note-head geometry with pitch-invariant right padding.
    leftExtent = Math.max(0, leftDisplacedHeadPx)
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
      leftExtent = Math.max(
        leftExtent,
        noteHeadX - accidentalMinX + ACCIDENTAL_PREALLOCATED_CLEARANCE_PX,
      )
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
    maxBarlineEdgeGapPx,
  } = params

  if (!Number.isFinite(maxBarlineEdgeGapPx)) return
  const maxGap = Math.max(0, maxBarlineEdgeGapPx)
  if (noteOnsets.length === 0) return

  const positions = noteOnsets.map((onset) => targetXByOnset.get(onset))
  if (positions.some((value) => value === undefined || !Number.isFinite(value))) return
  const safePositions = positions as number[]

  const firstIndex = 0
  const lastIndex = safePositions.length - 1
  const currentFirstX = safePositions[firstIndex]
  const currentLastX = safePositions[lastIndex]
  if (!Number.isFinite(currentFirstX) || !Number.isFinite(currentLastX)) return

  // Keep full glyph envelope (including accidentals) inside legal boundaries.
  const minFirstX = legalBoundaryStart + Math.max(0, firstLeftExtent)
  const maxLastX = legalBoundaryEnd - Math.max(0, lastRightExtent)
  if (!Number.isFinite(minFirstX) || !Number.isFinite(maxLastX) || minFirstX > maxLastX) return

  // Preserve all inter-onset spacing and only resolve by translation.
  const legalShiftMin = minFirstX - currentFirstX
  const legalShiftMax = maxLastX - currentLastX
  if (!Number.isFinite(legalShiftMin) || !Number.isFinite(legalShiftMax) || legalShiftMin > legalShiftMax) return

  // Cap is interpreted as full-glyph envelope distance to measure edges.
  const currentLeftEdgeGap = currentFirstX - firstLeftExtent - edgeBoundaryStart
  const currentRightEdgeGap = edgeBoundaryEnd - (currentLastX + lastRightExtent)
  if (!Number.isFinite(currentLeftEdgeGap) || !Number.isFinite(currentRightEdgeGap)) return

  // leftGap' = currentLeftEdgeGap + shift <= maxGap
  // rightGap' = currentRightEdgeGap - shift <= maxGap
  const capShiftMin = currentRightEdgeGap - maxGap
  const capShiftMax = maxGap - currentLeftEdgeGap

  const feasibleShiftMin = Math.max(legalShiftMin, capShiftMin)
  const feasibleShiftMax = Math.min(legalShiftMax, capShiftMax)

  const clampShift = (value: number): number => Math.max(legalShiftMin, Math.min(legalShiftMax, value))

  let resolvedShift = 0
  if (feasibleShiftMin <= feasibleShiftMax) {
    resolvedShift = Math.max(feasibleShiftMin, Math.min(0, feasibleShiftMax))
  } else {
    // When cap constraints are infeasible under pure translation, prefer a
    // balanced placement (left/right gaps as equal as possible) instead of
    // forcing one side to the cap and exploding the opposite side.
    const balancedShift = (currentRightEdgeGap - currentLeftEdgeGap) * 0.5
    resolvedShift = clampShift(balancedShift)
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
): number {
  void measureTicks
  const onsets = collectMeasureOnsetTicks(measure).sort((left, right) => left - right)
  if (onsets.length <= 1) return 0
  let totalGapPx = 0
  for (let i = 1; i < onsets.length; i += 1) {
    const deltaTicks = Math.max(1, onsets[i] - onsets[i - 1])
    totalGapPx += Math.max(0, mapTickGapToWeight(deltaTicks, spacingConfig))
  }
  return Math.max(0, totalGapPx)
}

export function applyUnifiedTimeAxisSpacing(params: ApplyUnifiedTimeAxisSpacingParams): void {
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
    preferMeasureBarlineAxis = false,
    preferMeasureEndBarlineAxis = false,
    enableEdgeGapCap = true,
  } = params

  const refs = [
    ...buildTimeAxisRefs(measure.treble, trebleRendered),
    ...buildTimeAxisRefs(measure.bass, bassRendered),
  ]
  if (refs.length === 0) return

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
  if (noteOnsets.length === 0) return

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
  if (onsetTicks.length === 0) return

  const firstOnsetRefs = refsByOnset.get(firstNoteOnset) ?? []
  const lastOnsetRefs = refsByOnset.get(lastNoteOnset) ?? []
  const firstLeftExtent = firstOnsetRefs.reduce((max, ref) => Math.max(max, ref.leftExtent), 0)
  const lastRightExtent = lastOnsetRefs.reduce((max, ref) => Math.max(max, ref.rightExtent), DEFAULT_NOTE_HEAD_WIDTH_PX)

  const usableFormatWidth = Math.max(MIN_RENDER_WIDTH_PX, formatWidth)
  const cappedEdgePaddingLeft = Math.max(
    0,
    Math.min(spacingConfig.leftEdgePaddingPx, spacingConfig.maxBarlineEdgeGapPx),
  )
  const cappedEdgePaddingRight = Math.max(
    0,
    Math.min(spacingConfig.rightEdgePaddingPx, spacingConfig.maxBarlineEdgeGapPx),
  )
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
  const axisBoundaryStart =
    uniformSpacingByTicks && preferMeasureBarlineAxis ? barlineAxisBoundaryStart : defaultAxisBoundaryStart
  const axisBoundaryEnd =
    uniformSpacingByTicks && preferMeasureEndBarlineAxis ? barlineAxisBoundaryEnd : defaultAxisBoundaryEnd

  const startPad = uniformSpacingByTicks
    ? Math.max(
      Math.max(0, cappedEdgePaddingLeft + UNIFORM_TICK_SPACING_START_GUARD_PX),
      firstLeftExtent + cappedEdgePaddingLeft,
    )
    : Math.max(1, firstLeftExtent + cappedEdgePaddingLeft)
  const endPad = uniformSpacingByTicks
    ? Math.max(
      Math.max(0, cappedEdgePaddingRight + UNIFORM_TICK_SPACING_END_GUARD_PX),
      lastRightExtent + cappedEdgePaddingRight,
    )
    : Math.max(1, lastRightExtent + cappedEdgePaddingRight)

  const axisStart = axisBoundaryStart + startPad
  const axisEnd = axisBoundaryEnd - endPad

  const targetXByOnset = new Map<number, number>()

  if (uniformSpacingByTicks) {
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
  } else {

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
    applyMeasureEdgeGapCap({
      noteOnsets,
      targetXByOnset,
      // Use effective spacing boundaries (noteStartX / noteEndX when
      // key/time signatures occupy measure edges) so edge-cap logic doesn't
      // push notes into decorations.
      edgeBoundaryStart: axisBoundaryStart,
      edgeBoundaryEnd: axisBoundaryEnd,
      legalBoundaryStart: axisBoundaryStart,
      legalBoundaryEnd: axisBoundaryEnd,
      firstLeftExtent,
      lastRightExtent,
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
}
