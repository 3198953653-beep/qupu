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
}

const MIN_RENDER_WIDTH_PX = 1
const DEFAULT_LEFT_EDGE_PADDING_PX = 2
const DEFAULT_RIGHT_EDGE_PADDING_PX = 3
const DEFAULT_NOTE_HEAD_WIDTH_PX = 9
const TICKS_PER_QUARTER = 16
const DEFAULT_COMPACT_TAIL_ANCHOR_TICKS = 4
const UNIFORM_TICK_SPACING_START_GUARD_PX = 0
const UNIFORM_TICK_SPACING_END_GUARD_PX = -2
const UNIFORM_EDGE_GAP_RATIO = 0.82
const UNIFORM_DELTA_FLOOR_RATIO = 1
const ACCIDENTAL_PREALLOCATED_CLEARANCE_PX = 2
const MIN_GAP_BEATS = 1 / 32
const GAP_GAMMA = 0.72
const GAP_BASE_WEIGHT = 0.45

export type TimeAxisSpacingConfig = {
  minGapBeats: number
  gapGamma: number
  gapBaseWeight: number
  leftEdgePaddingPx: number
  rightEdgePaddingPx: number
  interOnsetPaddingPx: number
}

export const DEFAULT_TIME_AXIS_SPACING_CONFIG: TimeAxisSpacingConfig = {
  minGapBeats: MIN_GAP_BEATS,
  gapGamma: GAP_GAMMA,
  gapBaseWeight: GAP_BASE_WEIGHT,
  leftEdgePaddingPx: DEFAULT_LEFT_EDGE_PADDING_PX,
  rightEdgePaddingPx: DEFAULT_RIGHT_EDGE_PADDING_PX,
  interOnsetPaddingPx: 1,
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
  let rightExtent = DEFAULT_NOTE_HEAD_WIDTH_PX

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

    // Keep spacing extent stable for equal rhythmic values:
    // use only displaced note-head geometry and ignore modifier/stem width.
    // This prevents pitch drags (crossing stem direction or accidental state)
    // from perturbing equal-duration onset gaps.
    leftExtent = Math.max(0, leftDisplacedHeadPx)
    rightExtent = Math.max(DEFAULT_NOTE_HEAD_WIDTH_PX, DEFAULT_NOTE_HEAD_WIDTH_PX + rightDisplacedHeadPx)
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

  const startEdgeTicks = Math.max(1, firstForwardGapTicks * UNIFORM_EDGE_GAP_RATIO)
  const endEdgeTicks = Math.max(1, trailingGapTicks * UNIFORM_EDGE_GAP_RATIO)
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
  const beats = deltaTicks / TICKS_PER_QUARTER
  const compressed = Math.pow(Math.max(config.minGapBeats, beats), config.gapGamma)
  return compressed + config.gapBaseWeight * beats
}

function buildUniformTimelineWeightMap(
  noteOnsets: number[],
  measureTicks: number,
  config: TimeAxisSpacingConfig,
): UniformTimelineWeightMap {
  const timeline = getUniformTickTimeline(noteOnsets, measureTicks)
  const orderedTicks = [
    timeline.domainStartTicks,
    ...[...new Set(noteOnsets)].filter((tick) => Number.isFinite(tick) && tick >= timeline.domainStartTicks && tick <= timeline.domainEndTicks),
    timeline.domainEndTicks,
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

export function getMeasureUniformTimelineWeightSpan(
  measure: MeasurePair,
  measureTicks: number,
  spacingConfig: TimeAxisSpacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
): number {
  const onsets = collectMeasureOnsetTicks(measure)
  const weightMap = buildUniformTimelineWeightMap(onsets, measureTicks, spacingConfig)
  return Math.max(0.0001, weightMap.totalWeight)
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
  const uniformPadding = getUniformTickSpacingPadding(spacingConfig)
  const startPad = uniformSpacingByTicks
    ? uniformPadding.startPadPx
    : Math.max(1, firstLeftExtent + spacingConfig.leftEdgePaddingPx)
  const endPad = uniformSpacingByTicks
    ? uniformPadding.endPadPx
    : Math.max(1, lastRightExtent + spacingConfig.rightEdgePaddingPx)
  const defaultAxisStart = noteStartX + startPad
  const defaultAxisEnd = noteStartX + usableFormatWidth - endPad
  const barlineAxisStart =
    typeof measureStartBarX === 'number' && Number.isFinite(measureStartBarX)
      ? measureStartBarX + startPad
      : defaultAxisStart
  const barlineAxisEnd =
    typeof measureEndBarX === 'number' && Number.isFinite(measureEndBarX)
      ? measureEndBarX - endPad
      : defaultAxisEnd
  const axisStart = uniformSpacingByTicks && preferMeasureBarlineAxis ? barlineAxisStart : defaultAxisStart
  const axisEnd = uniformSpacingByTicks && preferMeasureEndBarlineAxis ? barlineAxisEnd : defaultAxisEnd

  const targetXByOnset = new Map<number, number>()

  if (uniformSpacingByTicks) {
    const timelineWeightMap = buildUniformTimelineWeightMap(noteOnsets, measureTotalTicks, spacingConfig)
    const spanWidth = Math.max(1, axisEnd - axisStart)
    noteOnsets.forEach((onset) => {
      const cumulativeWeight = timelineWeightMap.cumulativeWeightByTick.get(onset)
      if (cumulativeWeight === undefined) return
      const ratio = cumulativeWeight / timelineWeightMap.totalWeight
      targetXByOnset.set(onset, axisStart + spanWidth * ratio)
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
          spacingConfig.interOnsetPaddingPx

        const currentBaseGap = baseGapByDeltaTicks.get(deltaTicks) ?? 0
        if (baseGap > currentBaseGap) {
          baseGapByDeltaTicks.set(deltaTicks, baseGap)
        }
        requiredMinGapBySegment.set(i, minGap)
      }
      const floorGapByDeltaTicks = new Map<number, number>()
      baseGapByDeltaTicks.forEach((baseGap, deltaTicks) => {
        floorGapByDeltaTicks.set(deltaTicks, baseGap * UNIFORM_DELTA_FLOOR_RATIO)
      })

      const adjustedPositions = [...basePositions]
      for (let i = 1; i < onsetSequence.length; i += 1) {
        const deltaTicks = Math.max(1, onsetSequence[i] - onsetSequence[i - 1])
        const floorGap = floorGapByDeltaTicks.get(deltaTicks) ?? 0
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
        const glyphGap = rightExtents[index] + leftExtents[index + 1] + spacingConfig.interOnsetPaddingPx
        return Math.max(1, glyphGap)
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
