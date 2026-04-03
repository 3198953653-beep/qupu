import { Accidental, Stem, type StaveNote } from 'vexflow'
import { DURATION_TICKS } from '../constants'
import {
  getAccidentalVisualX,
  getRenderedNoteGlyphBounds,
  getRenderedNoteVisualX,
} from './renderPosition'
import {
  getRenderedNoteHeadAbsoluteX,
  getRenderedNoteHeadColumnMetrics,
  getRenderedNoteHeadWidth,
  type RenderedNoteHeadLike,
} from './noteHeadColumns'
import type { MeasurePair, ScoreNote, StaffKind } from '../types'
import { resolveEffectiveBoundary } from './effectiveBoundary'
import { buildPublicAxisLayout } from '../timeline/axisLayout'
import { compareLegacyAndMergedTimeline } from '../timeline/debug'
import { mergeStaffTimelines } from '../timeline/mergedTimeline'
import { buildStaffTimeline } from '../timeline/staffTimeline'
import type { MeasureTimelineBundle, PublicAxisLayout, StaffTimeline } from '../timeline/types'

type RenderedStaffNote = {
  vexNote: StaveNote
}

type TimeAxisNoteRef = {
  staff: StaffKind
  onsetTicks: number
  vexNote: StaveNote
  rawLeftReservePx: number
  rawLeftStructuralReservePx: number
  rawRightReservePx: number
  leftOccupiedInsetPx: number
  rightOccupiedTailPx: number
  collisionRightBodyTailPx: number
}

type TimeAxisRenderedRef = {
  staff: StaffKind
  noteIndex: number
  onsetTicks: number
  vexNote: StaveNote
  isRest: boolean
  duration: ScoreNote['duration']
}

type OnsetCollisionMetrics = {
  rawLeftReservePx: number
  rawLeftStructuralReservePx: number
  rawRightReservePx: number
  leftOccupiedInsetPx: number
  rightOccupiedTailPx: number
  collisionRightBodyTailPx: number
}

type StaffOnsetCollisionMetrics = OnsetCollisionMetrics & {
  staff: StaffKind
  onsetTicks: number
  sharedOnsetIndex: number
}

type StaffVisualBlockerRef = {
  staff: StaffKind
  noteIndex: number
  onsetTicks: number
  isRest: boolean
  hasRest: boolean
  hasNonRest: boolean
  hasStandaloneFlaggedNote: boolean
  hasRenderedAccidental: boolean
  accidentalCount: number
  minAccidentalWidthPx: number | null
  anchorX: number
  visualLeftX: number
  visualRightX: number
  occupiedLeftX: number
  occupiedRightX: number
  accidentalLeftX: number | null
  accidentalLeftForSpacing: number | null
  projectedLeftExtraPx: number
  projectedRightExtraPx: number
}

type ProjectedVisualBlockerBounds = {
  visualLeftX: number
  visualRightX: number
  occupiedLeftX: number
  occupiedRightX: number
  accidentalLeftX: number | null
  accidentalLeftForSpacing: number | null
  accidentalCount: number
  minAccidentalWidthPx: number | null
}

function getStandaloneFlagProjectionPx(duration: ScoreNote['duration']): number | null {
  switch (duration) {
    case '8':
    case '8d':
      return 7
    case '16':
    case '16d':
      return 8
    case '32':
    case '32d':
      return 9
    default:
      return null
  }
}

type StaffSlotWinner = StaffKind | 'tie' | 'none'

type StaffSide = 'left' | 'right'

type StaffSlotRequest = {
  extraPx: number
  onsetTicks: number
  side: StaffSide
}

type LeadingTrailingDebug = {
  trebleRequestedExtraPx: number
  bassRequestedExtraPx: number
  winningStaff: StaffSlotWinner
}

type NoteSpacingGeometry = {
  rawLeftReservePx: number
  rawLeftStructuralReservePx: number
  rawRightReservePx: number
  leftOccupiedInsetPx: number
  rightOccupiedTailPx: number
  collisionRightBodyTailPx: number
}

type ApplyUnifiedTimeAxisSpacingParams = {
  measure: MeasurePair
  noteStartX: number
  formatWidth: number
  trebleRendered: RenderedStaffNote[]
  bassRendered: RenderedStaffNote[]
  timelineBundle?: MeasureTimelineBundle | null
  spacingConfig?: TimeAxisSpacingConfig
  measureTicks?: number
  sparseTailAnchorMode?: 'none' | 'measure-end' | 'compact-tail'
  compactTailAnchorTicks?: number
  uniformSpacingByTicks?: boolean
  measureStartBarX?: number
  measureEndBarX?: number
  publicAxisLayout?: PublicAxisLayout | null
  spacingAnchorTicks?: number[] | null
  preferMeasureBarlineAxis?: boolean
  preferMeasureEndBarlineAxis?: boolean
  enableEdgeGapCap?: boolean
}

const MIN_RENDER_WIDTH_PX = 1
const TICKS_PER_QUARTER = 16
const DEFAULT_COMPACT_TAIL_ANCHOR_TICKS = 4
const UNIFORM_TICK_SPACING_START_GUARD_PX = 0
const UNIFORM_TICK_SPACING_END_GUARD_PX = 0
const UNIFORM_TIMELINE_EDGE_TICK_RATIO = 0
const ACCIDENTAL_PREALLOCATED_CLEARANCE_PX = 0
const STEM_INVARIANT_RIGHT_PADDING_PX = 3.5
const COLLISION_RIGHT_BODY_PADDING_PX = 1.0
const ACCIDENTAL_COLLISION_SAFE_GAP_PX = 1
const ACCIDENTAL_OWN_HEAD_CLEARANCE_PX = 2
const ACCIDENTAL_COLUMN_SAFE_GAP_PX = 1
const MAX_ACCIDENTAL_COLUMNS = 6
const STRUCTURAL_RESERVE_EPSILON_PX = 0.0001
const MAX_SECOND_CHORD_STRUCTURAL_COMPENSATION_PX = 12
const BASE_GAP_UNIT_PX = 3.5
const DEFAULT_MIN_MEASURE_WIDTH_PX = 120
const MIN_GAP_BEATS = 1 / 32
const GAP_GAMMA = 0.7
const GAP_BASE_WEIGHT = 0.45
const DIATONIC_STEP_INDEX: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
}

export type TimeAxisSpacingConfig = {
  minGapBeats: number
  gapGamma: number
  gapBaseWeight: number
  minMeasureWidthPx: number
  leadingBarlineGapPx: number
  interOnsetPaddingPx: number
  baseMinGap32Px: number
  secondChordSafeGapPx: number
  durationGapRatios: DurationGapRatioConfig
}

export type DurationGapRatioConfig = {
  thirtySecond: number
  sixteenth: number
  eighth: number
  quarter: number
  half: number
  whole: number
}

export type PublicAxisConsumptionMode = 'legacy' | 'merged'

// Stage switch for timeline refactor rollout.
// Toggle back to 'legacy' for immediate rollback if needed.
export const PUBLIC_AXIS_CONSUMPTION_MODE: PublicAxisConsumptionMode = 'legacy'

export const DEFAULT_TIME_AXIS_SPACING_CONFIG: TimeAxisSpacingConfig = {
  minGapBeats: MIN_GAP_BEATS,
  gapGamma: GAP_GAMMA,
  gapBaseWeight: GAP_BASE_WEIGHT,
  minMeasureWidthPx: DEFAULT_MIN_MEASURE_WIDTH_PX,
  leadingBarlineGapPx: 9.7,
  interOnsetPaddingPx: 1,
  baseMinGap32Px: 6.9,
  secondChordSafeGapPx: 3,
  durationGapRatios: {
    thirtySecond: 0.7,
    sixteenth: 0.78,
    eighth: 0.93,
    quarter: 1.02,
    half: 1.22,
    whole: 1.4,
  },
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

function getRenderedNoteOccupiedBounds(
  vexNote: StaveNote,
  params?: {
    rightPaddingPx?: number
  },
): { leftX: number; rightX: number } | null {
  const noteHeads = (vexNote.noteHeads ?? []) as RenderedNoteHeadLike[]
  const anchorX = getRenderedNoteVisualX(vexNote)
  const stemDirection = vexNote.getStemDirection()

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY

  noteHeads.forEach((noteHead) => {
    const headX = getRenderedNoteHeadAbsoluteX({
      noteHead,
      anchorX,
      stemDirection,
    })
    if (typeof headX !== 'number' || !Number.isFinite(headX)) return
    const headWidth = getRenderedNoteHeadWidth(noteHead)
    minX = Math.min(minX, headX)
    maxX = Math.max(maxX, headX + headWidth)
  })

  vexNote.getModifiersByType(Accidental.CATEGORY).forEach((modifier) => {
    const accidental = modifier as Accidental
    const renderedIndex = accidental.getIndex()
    if (typeof renderedIndex !== 'number' || !Number.isFinite(renderedIndex)) return
    const accidentalX = getAccidentalVisualX(vexNote, accidental, renderedIndex)
    if (typeof accidentalX !== 'number' || !Number.isFinite(accidentalX)) return
    const accidentalWidth = accidental.getWidth()
    minX = Math.min(minX, accidentalX)
    maxX = Math.max(maxX, accidentalX + (Number.isFinite(accidentalWidth) ? accidentalWidth : 0))
  })

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null
  const rightPaddingPx =
    vexNote.hasStem()
      ? Math.max(
          0,
          Number.isFinite(params?.rightPaddingPx) ? (params?.rightPaddingPx as number) : STEM_INVARIANT_RIGHT_PADDING_PX,
        )
      : 0
  return {
    leftX: minX,
    rightX: maxX + rightPaddingPx,
  }
}

function getRenderedNoteAccidentalLeftX(vexNote: StaveNote): number | null {
  let accidentalMinX = Number.POSITIVE_INFINITY
  vexNote.getModifiersByType(Accidental.CATEGORY).forEach((modifier) => {
    const accidental = modifier as Accidental
    const renderedIndex = accidental.getIndex()
    if (typeof renderedIndex !== 'number' || !Number.isFinite(renderedIndex)) return
    const accidentalX = getAccidentalVisualX(vexNote, accidental, renderedIndex)
    if (typeof accidentalX !== 'number' || !Number.isFinite(accidentalX)) return
    accidentalMinX = Math.min(accidentalMinX, accidentalX)
  })
  return Number.isFinite(accidentalMinX) ? accidentalMinX : null
}

function getRenderedNoteHeadLeftXByRenderedIndex(vexNote: StaveNote, renderedIndex: number): number | null {
  const noteHead = (vexNote.noteHeads?.[renderedIndex] ?? null) as RenderedNoteHeadLike | null
  if (!noteHead) return null
  const bboxLeftX = noteHead.getBoundingBox?.()?.getX?.()
  if (typeof bboxLeftX === 'number' && Number.isFinite(bboxLeftX)) return bboxLeftX
  const anchorX = getRenderedNoteVisualX(vexNote)
  if (!Number.isFinite(anchorX)) return null
  const stemDirection = vexNote.getStemDirection()
  const resolvedLeftX = getRenderedNoteHeadAbsoluteX({
    noteHead,
    anchorX,
    stemDirection,
  })
  if (typeof resolvedLeftX === 'number' && Number.isFinite(resolvedLeftX)) {
    return resolvedLeftX
  }
  return null
}

function getRenderedChordMaxHeadLeftX(vexNote: StaveNote): number | null {
  const noteHeads = (vexNote.noteHeads ?? []) as RenderedNoteHeadLike[]
  if (noteHeads.length === 0) return null
  const anchorX = getRenderedNoteVisualX(vexNote)
  if (!Number.isFinite(anchorX)) return null
  const stemDirection = vexNote.getStemDirection()
  let maxHeadLeftX = Number.NEGATIVE_INFINITY
  noteHeads.forEach((noteHead) => {
    const bboxLeftX = noteHead.getBoundingBox?.()?.getX?.()
    if (typeof bboxLeftX === 'number' && Number.isFinite(bboxLeftX)) {
      maxHeadLeftX = Math.max(maxHeadLeftX, bboxLeftX)
      return
    }
    const resolvedLeftX = getRenderedNoteHeadAbsoluteX({
      noteHead,
      anchorX,
      stemDirection,
    })
    if (typeof resolvedLeftX === 'number' && Number.isFinite(resolvedLeftX)) {
      maxHeadLeftX = Math.max(maxHeadLeftX, resolvedLeftX)
    }
  })
  return Number.isFinite(maxHeadLeftX) ? maxHeadLeftX : null
}

function resolvePitchDiatonicOrdinalFromKeyText(keyText: string | null | undefined): number | null {
  if (!keyText) return null
  const match = /^([a-gA-G])(?:[#bxn]*)?\/(-?\d+)$/.exec(keyText.trim())
  if (!match) return null
  const stepIndex = DIATONIC_STEP_INDEX[match[1]!.toUpperCase()]
  const octave = Number.parseInt(match[2]!, 10)
  if (!Number.isFinite(stepIndex) || !Number.isFinite(octave)) return null
  return octave * 7 + stepIndex
}

function isAccidentalConflictByDiatonicDistance(leftOrdinal: number, rightOrdinal: number): boolean {
  const distance = Math.abs(leftOrdinal - rightOrdinal)
  return distance >= 1 && distance <= 5
}

function getRenderedNoteAccidentalLeftForSpacing(vexNote: StaveNote): number | null {
  const noteBaseX = getRenderedNoteVisualX(vexNote)
  const stableNoteBaseX = Number.isFinite(noteBaseX) ? noteBaseX : null
  const noteHeadBeginXRaw = vexNote.getNoteHeadBeginX()
  const stableNoteHeadBeginX = Number.isFinite(noteHeadBeginXRaw) ? noteHeadBeginXRaw : null
  const chordMaxHeadLeftX = getRenderedChordMaxHeadLeftX(vexNote)
  const accidentalModifiers = vexNote
    .getModifiersByType(Accidental.CATEGORY)
    .map((modifier) => modifier as Accidental)
  const keyTexts = vexNote.getKeys?.() ?? []
  const spacingNodes: Array<{
    renderedIndex: number
    width: number
    actualLeftX: number | null
    preferredLeftX: number | null
    diatonicOrdinal: number | null
  }> = []
  let accidentalMinX = Number.POSITIVE_INFINITY
  accidentalModifiers.forEach((accidental) => {
    const renderedIndex = accidental.getIndex()
    if (typeof renderedIndex !== 'number' || !Number.isFinite(renderedIndex)) return
    const accidentalLeftX = getAccidentalVisualX(vexNote, accidental, renderedIndex)
    const accidentalWidthRaw = accidental.getWidth()
    const accidentalWidth =
      typeof accidentalWidthRaw === 'number' && Number.isFinite(accidentalWidthRaw) && accidentalWidthRaw > 0
        ? accidentalWidthRaw
        : 0
    const ownHeadLeftX = getRenderedNoteHeadLeftXByRenderedIndex(vexNote, renderedIndex)
    const stableOwnHeadLeftX =
      typeof ownHeadLeftX === 'number' && Number.isFinite(ownHeadLeftX)
        ? Math.max(
            ownHeadLeftX,
            typeof stableNoteBaseX === 'number' && Number.isFinite(stableNoteBaseX) ? stableNoteBaseX : Number.NEGATIVE_INFINITY,
            typeof stableNoteHeadBeginX === 'number' && Number.isFinite(stableNoteHeadBeginX)
              ? stableNoteHeadBeginX
              : Number.NEGATIVE_INFINITY,
            typeof chordMaxHeadLeftX === 'number' && Number.isFinite(chordMaxHeadLeftX)
              ? chordMaxHeadLeftX
              : Number.NEGATIVE_INFINITY,
          )
        : Math.max(
            typeof stableNoteBaseX === 'number' && Number.isFinite(stableNoteBaseX)
              ? stableNoteBaseX
              : Number.NEGATIVE_INFINITY,
            typeof stableNoteHeadBeginX === 'number' && Number.isFinite(stableNoteHeadBeginX)
              ? stableNoteHeadBeginX
              : Number.NEGATIVE_INFINITY,
            typeof chordMaxHeadLeftX === 'number' && Number.isFinite(chordMaxHeadLeftX)
              ? chordMaxHeadLeftX
              : Number.NEGATIVE_INFINITY,
          )
    const preferredLeftX =
      typeof stableOwnHeadLeftX === 'number' && Number.isFinite(stableOwnHeadLeftX)
        ? stableOwnHeadLeftX - accidentalWidth - ACCIDENTAL_OWN_HEAD_CLEARANCE_PX
        : null

    let candidateLeftX: number | null =
      typeof accidentalLeftX === 'number' && Number.isFinite(accidentalLeftX) ? accidentalLeftX : null
    if (candidateLeftX === null && preferredLeftX !== null) {
      candidateLeftX = preferredLeftX
    }

    if (candidateLeftX !== null && Number.isFinite(candidateLeftX)) {
      accidentalMinX = Math.min(accidentalMinX, candidateLeftX)
    }

    spacingNodes.push({
      renderedIndex,
      width: accidentalWidth > 0 ? accidentalWidth : 10,
      actualLeftX:
        typeof accidentalLeftX === 'number' && Number.isFinite(accidentalLeftX) ? accidentalLeftX : null,
      preferredLeftX:
        typeof preferredLeftX === 'number' && Number.isFinite(preferredLeftX) ? preferredLeftX : null,
      diatonicOrdinal: resolvePitchDiatonicOrdinalFromKeyText(keyTexts[renderedIndex] ?? null),
    })
  })
  if (!Number.isFinite(accidentalMinX)) {
    return null
  }
  if (spacingNodes.length <= 1) {
    return accidentalMinX
  }

  const orderedNodeIndices = spacingNodes
    .map((_, index) => index)
    .sort((left, right) => {
      const leftNode = spacingNodes[left]!
      const rightNode = spacingNodes[right]!
      const leftOrdinal = leftNode.diatonicOrdinal
      const rightOrdinal = rightNode.diatonicOrdinal
      if (
        typeof leftOrdinal === 'number' &&
        Number.isFinite(leftOrdinal) &&
        typeof rightOrdinal === 'number' &&
        Number.isFinite(rightOrdinal) &&
        leftOrdinal !== rightOrdinal
      ) {
        return leftOrdinal - rightOrdinal
      }
      return leftNode.renderedIndex - rightNode.renderedIndex
    })

  const assignedColumnByNodeIndex = new Map<number, number>()
  orderedNodeIndices.forEach((nodeIndex, orderedIndex) => {
    const node = spacingNodes[nodeIndex]!
    const blockedColumns = new Set<number>()
    for (let previousOrderIndex = 0; previousOrderIndex < orderedIndex; previousOrderIndex += 1) {
      const previousNodeIndex = orderedNodeIndices[previousOrderIndex]!
      const previousNode = spacingNodes[previousNodeIndex]!
      const previousColumn = assignedColumnByNodeIndex.get(previousNodeIndex)
      if (typeof previousColumn !== 'number' || !Number.isFinite(previousColumn)) continue
      const currentOrdinal = node.diatonicOrdinal
      const previousOrdinal = previousNode.diatonicOrdinal
      const conflict =
        typeof currentOrdinal === 'number' &&
        Number.isFinite(currentOrdinal) &&
        typeof previousOrdinal === 'number' &&
        Number.isFinite(previousOrdinal)
          ? isAccidentalConflictByDiatonicDistance(currentOrdinal, previousOrdinal)
          : true
      if (conflict) {
        blockedColumns.add(previousColumn)
      }
    }
    let selectedColumn: number | null = null
    for (let column = 0; column < MAX_ACCIDENTAL_COLUMNS; column += 1) {
      if (blockedColumns.has(column)) continue
      selectedColumn = column
      break
    }
    if (selectedColumn === null) {
      selectedColumn = 0
    }
    assignedColumnByNodeIndex.set(nodeIndex, selectedColumn)
  })

  const widthByColumn = new Map<number, number>()
  const preferredLeftByColumn = new Map<number, number>()
  assignedColumnByNodeIndex.forEach((columnIndex, nodeIndex) => {
    const node = spacingNodes[nodeIndex]!
    const width = Number.isFinite(node.width) && node.width > 0 ? node.width : 10
    const preferredLeft =
      typeof node.preferredLeftX === 'number' && Number.isFinite(node.preferredLeftX)
        ? node.preferredLeftX
        : typeof node.actualLeftX === 'number' && Number.isFinite(node.actualLeftX)
          ? node.actualLeftX
          : Number.POSITIVE_INFINITY
    widthByColumn.set(columnIndex, Math.max(widthByColumn.get(columnIndex) ?? 0, width))
    preferredLeftByColumn.set(
      columnIndex,
      Math.min(preferredLeftByColumn.get(columnIndex) ?? Number.POSITIVE_INFINITY, preferredLeft),
    )
  })

  const orderedColumns = [...widthByColumn.keys()].sort((left, right) => left - right)
  const columnLeftByIndex = new Map<number, number>()
  for (let orderIndex = orderedColumns.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const columnIndex = orderedColumns[orderIndex]!
    const preferredLeft = preferredLeftByColumn.get(columnIndex) ?? Number.POSITIVE_INFINITY
    const rightNeighbor = orderIndex < orderedColumns.length - 1 ? orderedColumns[orderIndex + 1] : null
    const rightNeighborLeftX =
      typeof rightNeighbor === 'number' ? columnLeftByIndex.get(rightNeighbor) : undefined
    const rightConstraint =
      typeof rightNeighborLeftX === 'number' && Number.isFinite(rightNeighborLeftX)
        ? rightNeighborLeftX - (widthByColumn.get(columnIndex) ?? 10) - ACCIDENTAL_COLUMN_SAFE_GAP_PX
        : Number.POSITIVE_INFINITY
    let columnLeftX = Math.min(preferredLeft, rightConstraint)
    if (!Number.isFinite(columnLeftX)) {
      columnLeftX = Number.isFinite(preferredLeft) ? preferredLeft : rightConstraint
    }
    if (!Number.isFinite(columnLeftX)) {
      columnLeftX = accidentalMinX
    }
    columnLeftByIndex.set(columnIndex, columnLeftX)
  }

  const estimatedLeftMost = [...columnLeftByIndex.values()].reduce(
    (minValue, value) => Math.min(minValue, value),
    Number.POSITIVE_INFINITY,
  )
  if (Number.isFinite(estimatedLeftMost)) {
    return Math.min(accidentalMinX, estimatedLeftMost)
  }
  return accidentalMinX
}

function getNoteRawReserveExtents(vexNote: StaveNote): {
  rawLeftReservePx: number
  rawLeftStructuralReservePx: number
  rawRightReservePx: number
} {
  let rawLeftReservePx = 0
  let rawLeftStructuralReservePx = 0
  let rawRightReservePx = 0
  const fallbackAnchorX = getRenderedNoteVisualX(vexNote)
  if (Number.isFinite(fallbackAnchorX)) {
    const {
      resolvedAnchorX,
      hasMultipleColumns,
      leftColumnReservePx,
      rightColumnReservePx,
    } = getRenderedNoteHeadColumnMetrics(vexNote, fallbackAnchorX)
    if (hasMultipleColumns) {
      rawLeftStructuralReservePx = Math.max(rawLeftStructuralReservePx, leftColumnReservePx)
      rawRightReservePx = Math.max(rawRightReservePx, rightColumnReservePx)
    }
    rawLeftReservePx = Math.max(rawLeftReservePx, rawLeftStructuralReservePx)
    const accidentalMinX = getRenderedNoteAccidentalLeftX(vexNote)
    if (typeof accidentalMinX === 'number' && Number.isFinite(accidentalMinX)) {
      rawLeftReservePx = Math.max(
        rawLeftReservePx,
        resolvedAnchorX - accidentalMinX + ACCIDENTAL_PREALLOCATED_CLEARANCE_PX,
      )
    }
  }
  return { rawLeftReservePx, rawLeftStructuralReservePx, rawRightReservePx }
}

function getNoteOccupiedInsets(vexNote: StaveNote): {
  leftOccupiedInsetPx: number
  rightOccupiedTailPx: number
  collisionRightBodyTailPx: number
} {
  const anchorX = getRenderedNoteVisualX(vexNote)
  const occupiedBounds = getRenderedNoteOccupiedBounds(vexNote)
  const collisionOccupiedBounds = getRenderedNoteOccupiedBounds(vexNote, {
    rightPaddingPx: COLLISION_RIGHT_BODY_PADDING_PX,
  })
  if (!Number.isFinite(anchorX) || !occupiedBounds) {
    return {
      leftOccupiedInsetPx: 0,
      rightOccupiedTailPx: 0,
      collisionRightBodyTailPx: 0,
    }
  }

  return {
    leftOccupiedInsetPx: Math.max(0, anchorX - occupiedBounds.leftX),
    rightOccupiedTailPx: Math.max(0, occupiedBounds.rightX - anchorX),
    collisionRightBodyTailPx: Math.max(
      0,
      (collisionOccupiedBounds?.rightX ?? occupiedBounds.rightX) - anchorX,
    ),
  }
}

function getNoteSpacingGeometry(vexNote: StaveNote): NoteSpacingGeometry {
  const { rawLeftReservePx, rawLeftStructuralReservePx, rawRightReservePx } = getNoteRawReserveExtents(vexNote)
  const { leftOccupiedInsetPx, rightOccupiedTailPx, collisionRightBodyTailPx } = getNoteOccupiedInsets(vexNote)
  return {
    rawLeftReservePx,
    rawLeftStructuralReservePx,
    rawRightReservePx,
    leftOccupiedInsetPx,
    rightOccupiedTailPx,
    collisionRightBodyTailPx,
  }
}

function buildTimeAxisRefs(params: {
  staff: StaffKind
  notes: ScoreNote[]
  rendered: RenderedStaffNote[]
  timeline: StaffTimeline | null
}): TimeAxisNoteRef[] {
  const { staff, notes, rendered, timeline } = params
  const refs: TimeAxisNoteRef[] = []
  const pushRef = (noteIndex: number, onsetTicks: number) => {
    const sourceNote = notes[noteIndex]
    const renderedEntry = rendered[noteIndex]
    if (!sourceNote || sourceNote.isRest === true || !renderedEntry) return
    const headX = getRenderedNoteVisualX(renderedEntry.vexNote)
    if (!Number.isFinite(headX)) return
    const geometry = getNoteSpacingGeometry(renderedEntry.vexNote)
    refs.push({
      staff,
      onsetTicks,
      vexNote: renderedEntry.vexNote,
      rawLeftReservePx: geometry.rawLeftReservePx,
      rawLeftStructuralReservePx: geometry.rawLeftStructuralReservePx,
      rawRightReservePx: geometry.rawRightReservePx,
      leftOccupiedInsetPx: geometry.leftOccupiedInsetPx,
      rightOccupiedTailPx: geometry.rightOccupiedTailPx,
      collisionRightBodyTailPx: geometry.collisionRightBodyTailPx,
    })
  }

  if (timeline?.events?.length) {
    timeline.events.forEach((event) => {
      pushRef(event.noteIndex, event.startTick)
    })
    return refs
  }

  let cursorTicks = 0
  notes.forEach((note, noteIndex) => {
    const durationTicks = getTickDuration(note)
    pushRef(noteIndex, cursorTicks)
    cursorTicks += durationTicks
  })

  return refs
}

function buildTimeAxisRenderedRefs(params: {
  staff: StaffKind
  notes: ScoreNote[]
  rendered: RenderedStaffNote[]
  timeline: StaffTimeline | null
}): TimeAxisRenderedRef[] {
  const { staff, notes, rendered, timeline } = params
  const refs: TimeAxisRenderedRef[] = []
  const pushRef = (noteIndex: number, onsetTicks: number) => {
    const sourceNote = notes[noteIndex]
    const renderedEntry = rendered[noteIndex]
    if (!sourceNote || !renderedEntry) return
    refs.push({
      staff,
      noteIndex,
      onsetTicks,
      vexNote: renderedEntry.vexNote,
      isRest: sourceNote.isRest === true,
      duration: sourceNote.duration,
    })
  }

  if (timeline?.events?.length) {
    timeline.events.forEach((event) => {
      pushRef(event.noteIndex, event.startTick)
    })
    return refs
  }

  let cursorTicks = 0
  notes.forEach((note, noteIndex) => {
    const durationTicks = getTickDuration(note)
    pushRef(noteIndex, cursorTicks)
    cursorTicks += durationTicks
  })

  return refs
}

function resolveStaffVisualBlockerBounds(vexNote: StaveNote): {
  visualLeftX: number
  visualRightX: number
  occupiedLeftX: number
  occupiedRightX: number
} | null {
  const glyphBounds = getRenderedNoteGlyphBounds(vexNote)
  const occupiedBounds = getRenderedNoteOccupiedBounds(vexNote, {
    rightPaddingPx: 0,
  })
  const visualLeftXRaw = glyphBounds?.leftX
  const visualRightXRaw = glyphBounds?.rightX
  const occupiedLeftXRaw = occupiedBounds?.leftX
  const occupiedRightXRaw = occupiedBounds?.rightX
  const visualLeftX =
    typeof visualLeftXRaw === 'number' && Number.isFinite(visualLeftXRaw)
      ? visualLeftXRaw
      : typeof occupiedLeftXRaw === 'number' && Number.isFinite(occupiedLeftXRaw)
        ? occupiedLeftXRaw
        : null
  const visualRightX =
    typeof visualRightXRaw === 'number' && Number.isFinite(visualRightXRaw)
      ? visualRightXRaw
      : typeof occupiedRightXRaw === 'number' && Number.isFinite(occupiedRightXRaw)
        ? occupiedRightXRaw
        : null
  const occupiedLeftX =
    typeof occupiedLeftXRaw === 'number' && Number.isFinite(occupiedLeftXRaw)
      ? occupiedLeftXRaw
      : visualLeftX
  const occupiedRightX =
    typeof occupiedRightXRaw === 'number' && Number.isFinite(occupiedRightXRaw)
      ? occupiedRightXRaw
      : visualRightX
  if (
    typeof visualLeftX !== 'number' ||
    !Number.isFinite(visualLeftX) ||
    typeof visualRightX !== 'number' ||
    !Number.isFinite(visualRightX) ||
    typeof occupiedLeftX !== 'number' ||
    !Number.isFinite(occupiedLeftX) ||
    typeof occupiedRightX !== 'number' ||
    !Number.isFinite(occupiedRightX)
  ) {
    return null
  }
  return {
    visualLeftX,
    visualRightX,
    occupiedLeftX,
    occupiedRightX,
  }
}

function buildStaffVisualBlockerRefs(refs: TimeAxisRenderedRef[]): Record<StaffKind, StaffVisualBlockerRef[]> {
  const blockers: Record<StaffKind, StaffVisualBlockerRef[]> = {
    treble: [],
    bass: [],
  }

  refs.forEach((ref) => {
    const blockerBounds = resolveStaffVisualBlockerBounds(ref.vexNote)
    if (!blockerBounds) return
    const anchorX = getRenderedNoteVisualX(ref.vexNote)
    const visualLeftX = blockerBounds.visualLeftX
    const visualRightX = blockerBounds.visualRightX
    const accidentalLeftX = getRenderedNoteAccidentalLeftX(ref.vexNote)
    const accidentalLeftForSpacing = getRenderedNoteAccidentalLeftForSpacing(ref.vexNote)
    const accidentalModifiers = ref.vexNote
      .getModifiersByType(Accidental.CATEGORY)
      .map((modifier) => modifier as Accidental)
    const minAccidentalWidthPx = accidentalModifiers.reduce((minValue, modifier) => {
      const width = modifier.getWidth()
      if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return minValue
      return Math.min(minValue, width)
    }, Number.POSITIVE_INFINITY)
    const flagProjectionPx =
      ref.isRest !== true && ref.vexNote.hasFlag() && !ref.vexNote.getBeam()
        ? getStandaloneFlagProjectionPx(ref.duration)
        : null
    const projectedLeftExtraPx = flagProjectionPx !== null && ref.vexNote.getStemDirection() === Stem.DOWN ? flagProjectionPx : 0
    const projectedRightExtraPx =
      flagProjectionPx !== null && ref.vexNote.getStemDirection() === Stem.UP ? flagProjectionPx : 0
    blockers[ref.staff].push({
      staff: ref.staff,
      noteIndex: ref.noteIndex,
      onsetTicks: ref.onsetTicks,
      isRest: ref.isRest,
      hasRest: ref.isRest,
      hasNonRest: !ref.isRest,
      hasStandaloneFlaggedNote: flagProjectionPx !== null,
      hasRenderedAccidental: typeof accidentalLeftX === 'number' && Number.isFinite(accidentalLeftX),
      accidentalCount: accidentalModifiers.length,
      minAccidentalWidthPx:
        Number.isFinite(minAccidentalWidthPx) ? minAccidentalWidthPx : accidentalModifiers.length > 0 ? 10 : null,
      anchorX: Number.isFinite(anchorX) ? anchorX : blockerBounds.visualLeftX,
      visualLeftX,
      visualRightX,
      occupiedLeftX: blockerBounds.occupiedLeftX,
      occupiedRightX: blockerBounds.occupiedRightX,
      accidentalLeftX,
      accidentalLeftForSpacing,
      projectedLeftExtraPx,
      projectedRightExtraPx,
    })
  })

  ;(['treble', 'bass'] as StaffKind[]).forEach((staff) => {
    blockers[staff].sort((left, right) => {
      if (left.onsetTicks !== right.onsetTicks) return left.onsetTicks - right.onsetTicks
      if (left.noteIndex !== right.noteIndex) return left.noteIndex - right.noteIndex
      return left.anchorX - right.anchorX
    })
  })

  return blockers
}

function getRenderedOccupiedBounds(refs: TimeAxisRenderedRef[]): { leftX: number; rightX: number } | null {
  let leftX = Number.POSITIVE_INFINITY
  let rightX = Number.NEGATIVE_INFINITY

  refs.forEach((ref) => {
    const occupiedBounds =
      ref.isRest === true ? getRenderedNoteGlyphBounds(ref.vexNote) : getRenderedNoteOccupiedBounds(ref.vexNote)
    if (!occupiedBounds) return
    leftX = Math.min(leftX, occupiedBounds.leftX)
    rightX = Math.max(rightX, occupiedBounds.rightX)
  })

  if (!Number.isFinite(leftX) || !Number.isFinite(rightX)) return null
  return { leftX, rightX }
}

function getOccupiedBoundsFromOnsetReserves(
  onsetReserves: TimeAxisSpacingOnsetReserve[],
): { leftX: number; rightX: number } | null {
  let leftX = Number.POSITIVE_INFINITY
  let rightX = Number.NEGATIVE_INFINITY
  let hasOccupiedGeometry = false

  onsetReserves.forEach((reserve) => {
    const finalX = reserve.finalX
    if (typeof finalX !== 'number' || !Number.isFinite(finalX)) return
    const leftOccupiedInsetPx =
      typeof reserve.leftOccupiedInsetPx === 'number' && Number.isFinite(reserve.leftOccupiedInsetPx)
        ? Math.max(0, reserve.leftOccupiedInsetPx)
        : 0
    const rightOccupiedTailPx =
      typeof reserve.rightOccupiedTailPx === 'number' && Number.isFinite(reserve.rightOccupiedTailPx)
        ? Math.max(0, reserve.rightOccupiedTailPx)
        : 0

    if (leftOccupiedInsetPx > 0 || rightOccupiedTailPx > 0) {
      hasOccupiedGeometry = true
    }

    leftX = Math.min(leftX, finalX - leftOccupiedInsetPx)
    rightX = Math.max(rightX, finalX + rightOccupiedTailPx)
  })

  if (!hasOccupiedGeometry || !Number.isFinite(leftX) || !Number.isFinite(rightX)) return null
  return { leftX, rightX }
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

function clampMeasureTick(value: number, measureTicks: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.min(measureTicks, Math.round(value)))
}

export function buildEffectiveSpacingTicks(params: {
  measure: MeasurePair
  measureTicks: number
  supplementalTicks?: readonly number[] | null
}): number[] {
  const { measure, measureTicks, supplementalTicks = null } = params
  const safeMeasureTicks = Math.max(1, Math.round(measureTicks))
  const tickSet = new Set<number>(collectMeasureOnsetTicks(measure))

  supplementalTicks?.forEach((tick) => {
    const safeTick = clampMeasureTick(tick, safeMeasureTicks)
    if (safeTick === null) return
    tickSet.add(safeTick)
  })

  return [...tickSet]
    .filter((tick) => Number.isFinite(tick))
    .sort((left, right) => left - right)
}

type MeasureSpacingWeights = {
  orderedTicks: number[]
  leadingGapPx: number
  segmentWeights: number[]
  anchorSpanWeight: number
  trailingTailTicks: number
  trailingTailWeight: number
  totalWeight: number
}

export type MeasureTimelineWeightMetrics = {
  spacingAnchorTicks: number[]
  leadingGapPx: number
  anchorSpanPx: number
  trailingTailTicks: number
  trailingGapPx: number
  totalWidthPx: number
}

export type MeasureMinWidthStretchPlan = {
  targetContentWidthPx: number
  intrinsicContentWidthPx: number
  stretchableSpanPx: number
  segmentStretchScale: number
}

export type TimeAxisSpacingOnsetReserve = {
  onsetTicks: number
  baseX: number
  finalX: number
  leftReservePx: number
  rightReservePx: number
  rawLeftReservePx: number
  rawRightReservePx: number
  leftOccupiedInsetPx: number
  rightOccupiedTailPx: number
  leadingTrebleRequestedExtraPx: number
  leadingBassRequestedExtraPx: number
  leadingWinningStaff: StaffSlotWinner
  trailingTrebleRequestedExtraPx: number
  trailingBassRequestedExtraPx: number
  trailingWinningStaff: StaffSlotWinner
}

export type TimeAxisSpacingSegmentReserve = {
  fromOnsetTicks: number
  toOnsetTicks: number
  baseGapPx: number
  extraReservePx: number
  appliedGapPx: number
  trebleRequestedExtraPx: number
  bassRequestedExtraPx: number
  noteRestRequestedExtraPx: number
  noteRestVisibleGapPx: number | null
  accidentalRequestedExtraPx: number
  accidentalVisibleGapPx: number | null
  winningStaff: StaffSlotWinner
}

export function getLeadingBarlineGapPx(
  spacingConfig: TimeAxisSpacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
): number {
  if (!Number.isFinite(spacingConfig.leadingBarlineGapPx)) return 0
  return Math.max(0, spacingConfig.leadingBarlineGapPx)
}

export function resolveMeasureMinWidthStretchPlan(params: {
  spacingConfig: TimeAxisSpacingConfig
  leadingGapPx: number
  anchorSpanPx: number
  trailingGapPx: number
}): MeasureMinWidthStretchPlan {
  const { spacingConfig, leadingGapPx, anchorSpanPx, trailingGapPx } = params
  const safeMinMeasureWidthPx = Number.isFinite(spacingConfig.minMeasureWidthPx)
    ? Math.max(0, spacingConfig.minMeasureWidthPx)
    : DEFAULT_MIN_MEASURE_WIDTH_PX
  const safeLeadingGapPx = Number.isFinite(leadingGapPx) ? Math.max(0, leadingGapPx) : 0
  const safeAnchorSpanPx = Number.isFinite(anchorSpanPx) ? Math.max(0, anchorSpanPx) : 0
  const safeTrailingGapPx = Number.isFinite(trailingGapPx) ? Math.max(0, trailingGapPx) : 0
  const targetContentWidthPx = Math.max(0, safeMinMeasureWidthPx)
  const intrinsicContentWidthPx = safeLeadingGapPx + safeAnchorSpanPx + safeTrailingGapPx
  const stretchableSpanPx = safeAnchorSpanPx + safeTrailingGapPx
  if (targetContentWidthPx <= intrinsicContentWidthPx + 0.0001 || stretchableSpanPx <= 0.0001) {
    return {
      targetContentWidthPx,
      intrinsicContentWidthPx,
      stretchableSpanPx,
      segmentStretchScale: 1,
    }
  }
  const requiredStretchableSpanPx = Math.max(stretchableSpanPx, targetContentWidthPx - safeLeadingGapPx)
  const segmentStretchScale = Math.max(1, requiredStretchableSpanPx / Math.max(0.0001, stretchableSpanPx))
  return {
    targetContentWidthPx,
    intrinsicContentWidthPx,
    stretchableSpanPx,
    segmentStretchScale,
  }
}

function buildMeasureSpacingWeights(params: {
  spacingTicks: readonly number[]
  measureTicks: number
  spacingConfig?: TimeAxisSpacingConfig
  segmentStretchScale?: number
}): MeasureSpacingWeights {
  const {
    spacingTicks,
    measureTicks,
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
    segmentStretchScale = 1,
  } = params
  const safeSegmentStretchScale =
    Number.isFinite(segmentStretchScale) && segmentStretchScale > 0 ? segmentStretchScale : 1
  const safeMeasureTicks = Math.max(1, Math.round(measureTicks))
  const orderedTicks = [...new Set(spacingTicks)]
    .map((tick) => clampMeasureTick(tick, safeMeasureTicks))
    .filter((tick): tick is number => tick !== null && Number.isFinite(tick))
    .sort((left, right) => left - right)
  if (orderedTicks.length === 0) {
    return {
      orderedTicks: [],
      leadingGapPx: 0,
      segmentWeights: [],
      anchorSpanWeight: 0,
      trailingTailTicks: 0,
      trailingTailWeight: 0,
      totalWeight: 0,
    }
  }

  const segmentWeights: number[] = []
  let anchorSpanWeight = 0
  for (let index = 1; index < orderedTicks.length; index += 1) {
    const deltaTicks = Math.max(1, orderedTicks[index] - orderedTicks[index - 1])
    const gapWeight = mapTickGapToWeight(deltaTicks, spacingConfig) * safeSegmentStretchScale
    segmentWeights.push(gapWeight)
    anchorSpanWeight += gapWeight
  }

  const lastTick = orderedTicks[orderedTicks.length - 1] ?? 0
  const trailingTailTicks = Math.max(0, safeMeasureTicks - lastTick)
  const trailingTailWeight =
    trailingTailTicks > 0 ? mapTickGapToWeight(trailingTailTicks, spacingConfig) * safeSegmentStretchScale : 0
  const leadingGapPx = getLeadingBarlineGapPx(spacingConfig)
  const totalWeight = anchorSpanWeight + trailingTailWeight

  return {
    orderedTicks,
    leadingGapPx,
    segmentWeights,
    anchorSpanWeight,
    trailingTailTicks,
    trailingTailWeight,
    totalWeight,
  }
}

export function getMeasureUniformTimelineWeightMetrics(
  measure: MeasurePair,
  measureTicks: number,
  spacingConfig: TimeAxisSpacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
  timelineBundle: MeasureTimelineBundle | null = null,
): MeasureTimelineWeightMetrics {
  const spacingAnchorTicks =
    timelineBundle?.spacingAnchorTicks?.length
      ? [...timelineBundle.spacingAnchorTicks].sort((left, right) => left - right)
      : timelineBundle?.legacyOnsets?.length
        ? [...timelineBundle.legacyOnsets].sort((left, right) => left - right)
        : collectMeasureOnsetTicks(measure).sort((left, right) => left - right)
  const weights = buildMeasureSpacingWeights({
    spacingTicks: spacingAnchorTicks,
    measureTicks,
    spacingConfig,
  })
  return {
    spacingAnchorTicks: weights.orderedTicks,
    leadingGapPx: weights.leadingGapPx,
    anchorSpanPx: Math.max(0, weights.anchorSpanWeight),
    trailingTailTicks: weights.trailingTailTicks,
    trailingGapPx: Math.max(0, weights.trailingTailWeight),
    totalWidthPx: Math.max(0, weights.leadingGapPx + weights.totalWeight),
  }
}

export function getUniformTickSpacingPadding(
  spacingConfig: TimeAxisSpacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
  params?: { spacingTicks?: readonly number[] | null; measureTicks?: number | null },
): { startPadPx: number; endPadPx: number; trailingTailTicks: number; trailingGapPx: number } {
  const spacingTicks = params?.spacingTicks ?? null
  const measureTicks = params?.measureTicks ?? null
  if (
    spacingTicks &&
    spacingTicks.length > 0 &&
    typeof measureTicks === 'number' &&
    Number.isFinite(measureTicks) &&
    measureTicks > 0
  ) {
    const weights = buildMeasureSpacingWeights({
      spacingTicks,
      measureTicks,
      spacingConfig,
    })
    return {
      startPadPx: weights.leadingGapPx + UNIFORM_TICK_SPACING_START_GUARD_PX,
      endPadPx: Math.max(0, weights.trailingTailWeight + UNIFORM_TICK_SPACING_END_GUARD_PX),
      trailingTailTicks: weights.trailingTailTicks,
      trailingGapPx: Math.max(0, weights.trailingTailWeight),
    }
  }
  return {
    startPadPx: getLeadingBarlineGapPx(spacingConfig) + UNIFORM_TICK_SPACING_START_GUARD_PX,
    endPadPx: Math.max(0, UNIFORM_TICK_SPACING_END_GUARD_PX),
    trailingTailTicks: 0,
    trailingGapPx: 0,
  }
}

export function buildSpacingTickToX(params: {
  spacingTicks: readonly number[]
  measureTicks: number
  effectiveBoundaryStartX: number
  effectiveBoundaryEndX: number
  spacingConfig?: TimeAxisSpacingConfig
}): Map<number, number> {
  const {
    spacingTicks,
    measureTicks,
    effectiveBoundaryStartX,
    effectiveBoundaryEndX: _effectiveBoundaryEndX,
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
  } = params
  const tickToX = new Map<number, number>()
  const weights = buildMeasureSpacingWeights({
    spacingTicks,
    measureTicks,
    spacingConfig,
  })
  const orderedTicks = weights.orderedTicks
  if (orderedTicks.length === 0) return tickToX

  const contentStartX = effectiveBoundaryStartX + Math.max(0, weights.leadingGapPx)
  tickToX.set(orderedTicks[0], contentStartX)
  let cumulative = 0
  for (let index = 1; index < orderedTicks.length; index += 1) {
    cumulative += weights.segmentWeights[index - 1] ?? 0
    tickToX.set(orderedTicks[index], contentStartX + cumulative)
  }

  return tickToX
}

export function buildMeasureTimelineBundle(params: {
  measure: MeasurePair
  measureIndex: number
  timeSignature: { beats: number; beatType: number }
  spacingConfig?: TimeAxisSpacingConfig
  timelineMode?: 'legacy' | 'dual' | 'merged'
  supplementalSpacingTicks?: readonly number[] | null
}): MeasureTimelineBundle {
  const {
    measure,
    measureIndex,
    timeSignature,
    timelineMode = 'dual',
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
    supplementalSpacingTicks = null,
  } = params
  const legacyOnsets = buildLegacyOnsetTicks(measure)
  const measureTicks = resolveMeasureTicksFromTimeSignature(timeSignature)
  const spacingAnchorTicks = buildEffectiveSpacingTicks({
    measure,
    measureTicks,
    supplementalTicks: supplementalSpacingTicks,
  })
  const { startPadPx, endPadPx } = getUniformTickSpacingPadding(spacingConfig, {
    spacingTicks: spacingAnchorTicks,
    measureTicks,
  })
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
      startPadPx,
      endPadPx,
    },
    effectiveBoundaryStartX: 0,
    effectiveBoundaryEndX: 1,
  })
  const spacingTickToX = buildSpacingTickToX({
    spacingTicks: spacingAnchorTicks,
    measureTicks,
    effectiveBoundaryStartX: 0,
    effectiveBoundaryEndX: 1,
    spacingConfig,
  })
  return {
    measureIndex,
    measureTicks,
    legacyOnsets,
    spacingAnchorTicks,
    spacingTickToX,
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
  timelineScaleOverride?: number | null
}): MeasureTimelineBundle {
  const {
    bundle,
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
    widthPx,
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
    timelineScaleOverride = null,
  } = params
  const { startPadPx, endPadPx } = getUniformTickSpacingPadding(spacingConfig, {
    spacingTicks: bundle.spacingAnchorTicks,
    measureTicks: bundle.measureTicks,
  })
  const publicAxisLayout = buildPublicAxisLayout({
    measureIndex: bundle.measureIndex,
    measureTicks: bundle.measureTicks,
    publicTimeline: bundle.publicTimeline,
    spacingConfig: {
      baseMinGap32Px: spacingConfig.baseMinGap32Px,
      durationGapRatios: spacingConfig.durationGapRatios,
      startPadPx,
      endPadPx,
    },
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
    timelineScaleOverride,
  })
  const spacingTickToX = buildSpacingTickToX({
    spacingTicks: bundle.spacingAnchorTicks,
    measureTicks: bundle.measureTicks,
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
    spacingConfig,
  })
  return {
    ...bundle,
    spacingTickToX,
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

export type AppliedTimeAxisSpacingMetrics = {
  effectiveBoundaryStartX: number
  effectiveBoundaryEndX: number
  effectiveLeftGapPx: number
  effectiveRightGapPx: number
  leadingGapPx: number
  trailingTailTicks: number
  trailingGapPx: number
  spacingOccupiedLeftX: number
  spacingOccupiedRightX: number
  spacingAnchorGapFirstToLastPx: number
  spacingAnchorTicks: number[]
  spacingTickToX: Map<number, number>
  spacingOnsetReserves: TimeAxisSpacingOnsetReserve[]
  spacingSegments: TimeAxisSpacingSegmentReserve[]
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
    { ticks: 64, ratio: ratios.whole },
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

export function resolvePublicAxisLayoutForConsumption(
  timelineBundle: MeasureTimelineBundle | null | undefined,
): PublicAxisLayout | null {
  if (PUBLIC_AXIS_CONSUMPTION_MODE !== 'merged') return null
  return timelineBundle?.publicAxisLayout ?? null
}

function getOnsetCollisionMetrics(noteRefs: TimeAxisNoteRef[] | undefined): OnsetCollisionMetrics {
  if (!noteRefs || noteRefs.length === 0) {
    return {
      rawLeftReservePx: 0,
      rawLeftStructuralReservePx: 0,
      rawRightReservePx: 0,
      leftOccupiedInsetPx: 0,
      rightOccupiedTailPx: 0,
      collisionRightBodyTailPx: 0,
    }
  }
  return {
    rawLeftReservePx: noteRefs.reduce((max, ref) => Math.max(max, ref.rawLeftReservePx), 0),
    rawLeftStructuralReservePx: noteRefs.reduce((max, ref) => Math.max(max, ref.rawLeftStructuralReservePx), 0),
    rawRightReservePx: noteRefs.reduce((max, ref) => Math.max(max, ref.rawRightReservePx), 0),
    leftOccupiedInsetPx: noteRefs.reduce((max, ref) => Math.max(max, ref.leftOccupiedInsetPx), 0),
    rightOccupiedTailPx: noteRefs.reduce((max, ref) => Math.max(max, ref.rightOccupiedTailPx), 0),
    collisionRightBodyTailPx: noteRefs.reduce((max, ref) => Math.max(max, ref.collisionRightBodyTailPx), 0),
  }
}

function buildStaffOnsetCollisionMetricsByStaff(params: {
  onsetTicks: number[]
  refsByOnset: Map<number, TimeAxisNoteRef[]>
}): Record<StaffKind, StaffOnsetCollisionMetrics[]> {
  const { onsetTicks, refsByOnset } = params
  const refsByStaff: Record<StaffKind, StaffOnsetCollisionMetrics[]> = {
    treble: [],
    bass: [],
  }

  onsetTicks.forEach((onsetTick, sharedOnsetIndex) => {
    const refs = refsByOnset.get(onsetTick) ?? []
    ;(['treble', 'bass'] as StaffKind[]).forEach((staff) => {
      const staffRefs = refs.filter((ref) => ref.staff === staff)
      if (staffRefs.length === 0) return
      const metrics = getOnsetCollisionMetrics(staffRefs)
      refsByStaff[staff].push({
        staff,
        onsetTicks: onsetTick,
        sharedOnsetIndex,
        rawLeftReservePx: metrics.rawLeftReservePx,
        rawLeftStructuralReservePx: metrics.rawLeftStructuralReservePx,
        rawRightReservePx: metrics.rawRightReservePx,
        leftOccupiedInsetPx: metrics.leftOccupiedInsetPx,
        rightOccupiedTailPx: metrics.rightOccupiedTailPx,
        collisionRightBodyTailPx: metrics.collisionRightBodyTailPx,
      })
    })
  })

  return refsByStaff
}

function resolveWinningStaff(params: {
  trebleRequestedExtraPx: number
  bassRequestedExtraPx: number
}): StaffSlotWinner {
  const safeTrebleRequestedExtraPx = Math.max(0, params.trebleRequestedExtraPx)
  const safeBassRequestedExtraPx = Math.max(0, params.bassRequestedExtraPx)
  if (safeTrebleRequestedExtraPx <= 0 && safeBassRequestedExtraPx <= 0) return 'none'
  if (Math.abs(safeTrebleRequestedExtraPx - safeBassRequestedExtraPx) <= 0.001) return 'tie'
  return safeTrebleRequestedExtraPx > safeBassRequestedExtraPx ? 'treble' : 'bass'
}

function selectPreferredStaffSlotRequest(
  current: StaffSlotRequest | null,
  candidate: StaffSlotRequest,
): StaffSlotRequest {
  if (!current) return candidate
  if (candidate.extraPx > current.extraPx + 0.001) return candidate
  if (Math.abs(candidate.extraPx - current.extraPx) > 0.001) return current
  if (candidate.side === 'right' && current.side !== 'right') return candidate
  if (candidate.side !== 'right' && current.side === 'right') return current
  if (candidate.onsetTicks < current.onsetTicks) return candidate
  return current
}

function pickWinningStaffSlotRequest(params: {
  trebleRequest: StaffSlotRequest | null
  bassRequest: StaffSlotRequest | null
}): StaffSlotRequest | null {
  const { trebleRequest, bassRequest } = params
  if (trebleRequest && !bassRequest) return trebleRequest
  if (!trebleRequest && bassRequest) return bassRequest
  if (!trebleRequest && !bassRequest) return null
  if ((trebleRequest?.extraPx ?? 0) > (bassRequest?.extraPx ?? 0) + 0.001) return trebleRequest
  if ((bassRequest?.extraPx ?? 0) > (trebleRequest?.extraPx ?? 0) + 0.001) return bassRequest
  return trebleRequest
}

function createStaffSlotRequestRecord(): Record<StaffKind, StaffSlotRequest | null> {
  return {
    treble: null,
    bass: null,
  }
}

function createStaffExtraRecord(): Record<StaffKind, number> {
  return {
    treble: 0,
    bass: 0,
  }
}

function isNoteRestCollisionPair(left: StaffVisualBlockerRef, right: StaffVisualBlockerRef): boolean {
  if (left.isRest === right.isRest) return false
  const noteBlocker = left.isRest ? right : left
  return noteBlocker.hasStandaloneFlaggedNote
}

function isBoundaryCollisionCandidate(blocker: StaffVisualBlockerRef): boolean {
  return blocker.isRest
}

function resolveProjectedVisualBlockerBounds(
  blocker: StaffVisualBlockerRef,
  baseXByOnset: Map<number, number>,
): ProjectedVisualBlockerBounds {
  const projectedAnchorX = baseXByOnset.get(blocker.onsetTicks)
  const deltaX =
    typeof projectedAnchorX === 'number' && Number.isFinite(projectedAnchorX) && Number.isFinite(blocker.anchorX)
      ? projectedAnchorX - blocker.anchorX
      : 0
  return {
    visualLeftX: blocker.visualLeftX + deltaX,
    visualRightX: blocker.visualRightX + deltaX,
    occupiedLeftX: blocker.occupiedLeftX + deltaX,
    occupiedRightX: blocker.occupiedRightX + deltaX,
    accidentalLeftX:
      typeof blocker.accidentalLeftX === 'number' && Number.isFinite(blocker.accidentalLeftX)
        ? blocker.accidentalLeftX + deltaX
        : null,
    accidentalLeftForSpacing:
      typeof blocker.accidentalLeftForSpacing === 'number' && Number.isFinite(blocker.accidentalLeftForSpacing)
        ? blocker.accidentalLeftForSpacing + deltaX
        : null,
    accidentalCount: blocker.accidentalCount,
    minAccidentalWidthPx: blocker.minAccidentalWidthPx,
  }
}

function buildBaseTargetXByOnset(params: {
  onsetTicks: number[]
  axisStart: number
  spacingWeights: MeasureSpacingWeights
  uniformSpacingByTicks: boolean
  publicAxisLayout: PublicAxisLayout | null
}): Map<number, number> {
  const { onsetTicks, axisStart, spacingWeights, publicAxisLayout } = params
  const targetXByOnset = new Map<number, number>()
  if (onsetTicks.length === 0) return targetXByOnset

  if (publicAxisLayout?.tickToX && publicAxisLayout.tickToX.size > 0) {
    onsetTicks.forEach((onset) => {
      const axisX = publicAxisLayout.tickToX.get(onset)
      if (Number.isFinite(axisX)) {
        targetXByOnset.set(onset, axisX as number)
      }
    })
    if (targetXByOnset.size === onsetTicks.length) {
      return targetXByOnset
    }
    targetXByOnset.clear()
  }

  targetXByOnset.set(onsetTicks[0] as number, axisStart)
  let cumulative = 0
  for (let index = 1; index < onsetTicks.length; index += 1) {
    cumulative += spacingWeights.segmentWeights[index - 1] ?? 0
    targetXByOnset.set(onsetTicks[index] as number, axisStart + cumulative)
  }
  return targetXByOnset
}

function resolveCollisionDrivenOverlay(params: {
  onsetTicks: number[]
  baseTargetXByOnset: Map<number, number>
  refsByOnset: Map<number, TimeAxisNoteRef[]>
  visualBlockersByStaff: Record<StaffKind, StaffVisualBlockerRef[]>
  effectiveBoundaryStartX: number
  effectiveBoundaryEndX: number
  spacingConfig: TimeAxisSpacingConfig
}): {
  finalTargetXByOnset: Map<number, number>
  onsetReserves: TimeAxisSpacingOnsetReserve[]
  spacingSegments: TimeAxisSpacingSegmentReserve[]
  totalAppliedExtraPx: number
} {
  const {
    onsetTicks,
    baseTargetXByOnset,
    refsByOnset,
    visualBlockersByStaff,
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
    spacingConfig,
  } = params
  const finalTargetXByOnset = new Map<number, number>()
  const onsetReserves: TimeAxisSpacingOnsetReserve[] = []
  const spacingSegments: TimeAxisSpacingSegmentReserve[] = []
  if (onsetTicks.length === 0) {
    return {
      finalTargetXByOnset,
      onsetReserves,
      spacingSegments,
      totalAppliedExtraPx: 0,
    }
  }
  const secondChordSafeGapPx = Number.isFinite(spacingConfig.secondChordSafeGapPx)
    ? Math.max(0, spacingConfig.secondChordSafeGapPx)
    : 0

  const sharedOnsetCollisionMetricsByTick = onsetTicks.map((onsetTick) =>
    getOnsetCollisionMetrics(refsByOnset.get(onsetTick)),
  )
  const staffOnsetCollisionMetricsByStaff = buildStaffOnsetCollisionMetricsByStaff({
    onsetTicks,
    refsByOnset,
  })
  const safeLeftReserves = onsetTicks.map(() => 0)
  const safeRightReserves = onsetTicks.map(() => 0)
  const leadingRequests = createStaffSlotRequestRecord()
  const trailingRequests = createStaffSlotRequestRecord()
  const segmentRequests = onsetTicks.slice(1).map(() => createStaffSlotRequestRecord())
  const noteRestLeadingRequests = createStaffExtraRecord()
  const noteRestTrailingRequests = createStaffExtraRecord()
  const noteRestSegmentRequests = onsetTicks.slice(1).map(() => createStaffExtraRecord())
  const accidentalLeadingRequests = createStaffExtraRecord()
  const accidentalSegmentRequests = onsetTicks.slice(1).map(() => createStaffExtraRecord())
  const noteRestSegmentVisibleGaps = onsetTicks
    .slice(1)
    .map(() => ({ treble: null as number | null, bass: null as number | null }))
  const accidentalSegmentVisibleGaps = onsetTicks
    .slice(1)
    .map(() => ({ treble: null as number | null, bass: null as number | null }))
  const baseXs = onsetTicks.map((onset, index) => {
    const baseX = baseTargetXByOnset.get(onset)
    if (typeof baseX === 'number' && Number.isFinite(baseX)) {
      return baseX
    }
    const previousBaseX = index > 0 ? finalTargetXByOnset.get(onsetTicks[index - 1] as number) : null
    return typeof previousBaseX === 'number' && Number.isFinite(previousBaseX) ? previousBaseX : 0
  })
  const baseXByOnset = new Map<number, number>(onsetTicks.map((onsetTick, index) => [onsetTick, baseXs[index] ?? 0]))
  const onsetIndexByTick = new Map<number, number>(onsetTicks.map((onsetTick, index) => [onsetTick, index]))

  ;(['treble', 'bass'] as StaffKind[]).forEach((staff) => {
    const staffCollisionMetrics = staffOnsetCollisionMetricsByStaff[staff]
    staffCollisionMetrics.forEach((metrics, index) => {
      const baseAnchorX = baseXByOnset.get(metrics.onsetTicks)
      if (typeof baseAnchorX !== 'number' || !Number.isFinite(baseAnchorX)) return
      const previousMetrics = index > 0 ? staffCollisionMetrics[index - 1] ?? null : null
      const nextMetrics = index < staffCollisionMetrics.length - 1 ? staffCollisionMetrics[index + 1] ?? null : null

      const rawLeftStructuralReservePx = Math.max(0, metrics.rawLeftStructuralReservePx)
      if (rawLeftStructuralReservePx > 0) {
        const visibleLeftGapPx =
          previousMetrics === null
            ? (baseAnchorX - rawLeftStructuralReservePx) - effectiveBoundaryStartX
            : baseAnchorX -
              (baseXByOnset.get(previousMetrics.onsetTicks) ?? 0) -
              Math.max(0, previousMetrics.rawRightReservePx) -
              rawLeftStructuralReservePx
        const leftRequestPx = Math.max(0, secondChordSafeGapPx - visibleLeftGapPx)
        if (leftRequestPx > 0) {
          const request = {
            extraPx: leftRequestPx,
            onsetTicks: metrics.onsetTicks,
            side: 'left' as const,
          }
          if (metrics.sharedOnsetIndex <= 0) {
            leadingRequests[staff] = selectPreferredStaffSlotRequest(leadingRequests[staff], request)
          } else {
            const slotIndex = metrics.sharedOnsetIndex - 1
            segmentRequests[slotIndex]![staff] = selectPreferredStaffSlotRequest(segmentRequests[slotIndex]![staff], request)
          }
        }
      }

      if (Math.max(0, metrics.rawRightReservePx) > 0) {
        const visibleRightGapPx =
          nextMetrics === null
            ? effectiveBoundaryEndX - (baseAnchorX + Math.max(0, metrics.rawRightReservePx))
            : (baseXByOnset.get(nextMetrics.onsetTicks) ?? 0) -
              baseAnchorX -
              Math.max(0, metrics.rawRightReservePx) -
              Math.max(0, nextMetrics.rawLeftStructuralReservePx)
        const rightRequestPx = Math.max(0, secondChordSafeGapPx - visibleRightGapPx)
        if (rightRequestPx > 0) {
          const request = {
            extraPx: rightRequestPx,
            onsetTicks: metrics.onsetTicks,
            side: 'right' as const,
          }
          if (metrics.sharedOnsetIndex >= onsetTicks.length - 1) {
            trailingRequests[staff] = selectPreferredStaffSlotRequest(trailingRequests[staff], request)
          } else {
            const slotIndex = metrics.sharedOnsetIndex
            segmentRequests[slotIndex]![staff] = selectPreferredStaffSlotRequest(segmentRequests[slotIndex]![staff], request)
          }
        }
      }
    })
  })

  ;(['treble', 'bass'] as StaffKind[]).forEach((staff) => {
    const staffBlockers = visualBlockersByStaff[staff] ?? []
    if (staffBlockers.length === 0) return
    const staffCollisionMetricsByOnset = new Map<number, StaffOnsetCollisionMetrics>(
      (staffOnsetCollisionMetricsByStaff[staff] ?? []).map((metrics) => [metrics.onsetTicks, metrics]),
    )

    const firstBlocker = staffBlockers[0]
    if (firstBlocker && isBoundaryCollisionCandidate(firstBlocker)) {
      const projectedFirstBounds = resolveProjectedVisualBlockerBounds(firstBlocker, baseXByOnset)
      const visibleLeadingGapPx =
        projectedFirstBounds.visualLeftX - firstBlocker.projectedLeftExtraPx - effectiveBoundaryStartX
      const requestPx = Math.max(0, -visibleLeadingGapPx)
      if (requestPx > 0) {
        noteRestLeadingRequests[staff] = Math.max(noteRestLeadingRequests[staff], requestPx)
      }
    }

    const lastBlocker = staffBlockers[staffBlockers.length - 1]
    if (lastBlocker && isBoundaryCollisionCandidate(lastBlocker)) {
      const projectedLastBounds = resolveProjectedVisualBlockerBounds(lastBlocker, baseXByOnset)
      const visibleTrailingGapPx =
        effectiveBoundaryEndX - (projectedLastBounds.visualRightX + lastBlocker.projectedRightExtraPx)
      const requestPx = Math.max(0, -visibleTrailingGapPx)
      if (requestPx > 0) {
        noteRestTrailingRequests[staff] = Math.max(noteRestTrailingRequests[staff], requestPx)
      }
    }

    for (let index = 1; index < staffBlockers.length; index += 1) {
      const previousBlocker = staffBlockers[index - 1]!
      const nextBlocker = staffBlockers[index]!
      if (!isNoteRestCollisionPair(previousBlocker, nextBlocker)) continue
      const previousSharedIndex = onsetIndexByTick.get(previousBlocker.onsetTicks)
      const nextSharedIndex = onsetIndexByTick.get(nextBlocker.onsetTicks)
      if (
        typeof previousSharedIndex !== 'number' ||
        !Number.isFinite(previousSharedIndex) ||
        typeof nextSharedIndex !== 'number' ||
        !Number.isFinite(nextSharedIndex) ||
        nextSharedIndex <= previousSharedIndex
      ) {
        continue
      }
      const slotIndex = nextSharedIndex - 1
      const projectedPreviousBounds = resolveProjectedVisualBlockerBounds(previousBlocker, baseXByOnset)
      const projectedNextBounds = resolveProjectedVisualBlockerBounds(nextBlocker, baseXByOnset)
      const visibleGapPx =
        projectedNextBounds.visualLeftX -
        projectedPreviousBounds.visualRightX -
        previousBlocker.projectedRightExtraPx -
        nextBlocker.projectedLeftExtraPx
      const currentVisibleGapPx = noteRestSegmentVisibleGaps[slotIndex]?.[staff]
      noteRestSegmentVisibleGaps[slotIndex]![staff] =
        typeof currentVisibleGapPx === 'number' && Number.isFinite(currentVisibleGapPx)
          ? Math.min(currentVisibleGapPx, visibleGapPx)
          : visibleGapPx
      const requestPx = Math.max(0, -visibleGapPx)
      if (requestPx <= 0) continue
      noteRestSegmentRequests[slotIndex]![staff] = Math.max(noteRestSegmentRequests[slotIndex]![staff], requestPx)
    }

    const firstAccidentalBlocker = staffBlockers[0]
    if (firstAccidentalBlocker?.hasRenderedAccidental) {
      const projectedFirstBounds = resolveProjectedVisualBlockerBounds(firstAccidentalBlocker, baseXByOnset)
      const accidentalLeftX = projectedFirstBounds.accidentalLeftX
      if (typeof accidentalLeftX === 'number' && Number.isFinite(accidentalLeftX)) {
        const visibleLeadingGapPx = accidentalLeftX - effectiveBoundaryStartX
        const requestPx = Math.max(0, ACCIDENTAL_COLLISION_SAFE_GAP_PX - visibleLeadingGapPx)
        if (requestPx > 0) {
          accidentalLeadingRequests[staff] = Math.max(accidentalLeadingRequests[staff], requestPx)
        }
      }
    }

    for (let index = 1; index < staffBlockers.length; index += 1) {
      const previousBlocker = staffBlockers[index - 1]!
      const nextBlocker = staffBlockers[index]!
      if (!nextBlocker.hasRenderedAccidental) continue
      const previousSharedIndex = onsetIndexByTick.get(previousBlocker.onsetTicks)
      const nextSharedIndex = onsetIndexByTick.get(nextBlocker.onsetTicks)
      if (
        typeof previousSharedIndex !== 'number' ||
        !Number.isFinite(previousSharedIndex) ||
        typeof nextSharedIndex !== 'number' ||
        !Number.isFinite(nextSharedIndex) ||
        nextSharedIndex <= previousSharedIndex
      ) {
        continue
      }
      const slotIndex = nextSharedIndex - 1
      const projectedPreviousBounds = resolveProjectedVisualBlockerBounds(previousBlocker, baseXByOnset)
      const projectedNextBounds = resolveProjectedVisualBlockerBounds(nextBlocker, baseXByOnset)
      const nextBaseX = baseXByOnset.get(nextBlocker.onsetTicks)
      const nextStructuralMetrics = staffCollisionMetricsByOnset.get(nextBlocker.onsetTicks)
      const previousStructuralMetrics = staffCollisionMetricsByOnset.get(previousBlocker.onsetTicks)
      const isSecondChordSensitiveSegment =
        Math.max(0, previousStructuralMetrics?.rawRightReservePx ?? 0) > STRUCTURAL_RESERVE_EPSILON_PX ||
        Math.max(0, nextStructuralMetrics?.rawLeftStructuralReservePx ?? 0) > STRUCTURAL_RESERVE_EPSILON_PX
      const requiredGapPx = isSecondChordSensitiveSegment ? secondChordSafeGapPx : ACCIDENTAL_COLLISION_SAFE_GAP_PX
      const accidentalReserveInsetPx =
        typeof nextStructuralMetrics?.rawLeftReservePx === 'number' && Number.isFinite(nextStructuralMetrics.rawLeftReservePx)
          ? Math.max(
              0,
              nextStructuralMetrics.rawLeftReservePx - Math.max(0, nextStructuralMetrics.rawLeftStructuralReservePx),
            )
          : null
      const accidentalLeftByReserve =
        typeof nextBaseX === 'number' &&
        Number.isFinite(nextBaseX) &&
        typeof accidentalReserveInsetPx === 'number' &&
        Number.isFinite(accidentalReserveInsetPx)
          ? nextBaseX - accidentalReserveInsetPx
          : null
      let accidentalLeftX =
        typeof projectedNextBounds.accidentalLeftForSpacing === 'number' &&
        Number.isFinite(projectedNextBounds.accidentalLeftForSpacing)
          ? projectedNextBounds.accidentalLeftForSpacing
          : typeof projectedNextBounds.accidentalLeftX === 'number' &&
              Number.isFinite(projectedNextBounds.accidentalLeftX)
            ? projectedNextBounds.accidentalLeftX
            : null
      const accidentalLeftByAnchor =
        isSecondChordSensitiveSegment &&
        typeof nextBaseX === 'number' &&
        Number.isFinite(nextBaseX) &&
        typeof projectedNextBounds.minAccidentalWidthPx === 'number' &&
        Number.isFinite(projectedNextBounds.minAccidentalWidthPx)
          ? nextBaseX -
            Math.min(12, Math.max(6, projectedNextBounds.minAccidentalWidthPx)) -
            ACCIDENTAL_OWN_HEAD_CLEARANCE_PX
          : null
      if (!(typeof accidentalLeftX === 'number' && Number.isFinite(accidentalLeftX))) {
        if (typeof accidentalLeftByReserve === 'number' && Number.isFinite(accidentalLeftByReserve)) {
          accidentalLeftX = accidentalLeftByReserve
        } else if (typeof accidentalLeftByAnchor === 'number' && Number.isFinite(accidentalLeftByAnchor)) {
          accidentalLeftX = accidentalLeftByAnchor
        }
      }
      if (typeof accidentalLeftX !== 'number' || !Number.isFinite(accidentalLeftX)) continue
      const previousOccupiedRightX =
        typeof projectedPreviousBounds.occupiedRightX === 'number' && Number.isFinite(projectedPreviousBounds.occupiedRightX)
          ? projectedPreviousBounds.occupiedRightX
          : projectedPreviousBounds.visualRightX
      const visibleGapPx = accidentalLeftX - previousOccupiedRightX
      const baseStructuralRightCompensationPx = isSecondChordSensitiveSegment
        ? Math.min(
            MAX_SECOND_CHORD_STRUCTURAL_COMPENSATION_PX,
            Math.max(0, previousStructuralMetrics?.rawRightReservePx ?? 0),
          )
        : 0
      // Compensation can relax over-pessimistic structural reserve, but it must never
      // turn an actual overlap into an apparently-safe positive gap.
      const structuralRightCompensationPx = Math.min(
        baseStructuralRightCompensationPx,
        Math.max(0, -visibleGapPx),
      )
      const effectiveVisibleGapPx = visibleGapPx + structuralRightCompensationPx
      const currentVisibleGapPx = accidentalSegmentVisibleGaps[slotIndex]?.[staff]
      accidentalSegmentVisibleGaps[slotIndex]![staff] =
        typeof currentVisibleGapPx === 'number' && Number.isFinite(currentVisibleGapPx)
          ? Math.min(currentVisibleGapPx, effectiveVisibleGapPx)
          : effectiveVisibleGapPx
      const requestPx = Math.max(0, requiredGapPx - effectiveVisibleGapPx)
      if (requestPx <= 0) continue
      accidentalSegmentRequests[slotIndex]![staff] = Math.max(accidentalSegmentRequests[slotIndex]![staff], requestPx)
    }
  })

  const leadingDebug: LeadingTrailingDebug = {
    trebleRequestedExtraPx: Math.max(0, leadingRequests.treble?.extraPx ?? 0),
    bassRequestedExtraPx: Math.max(0, leadingRequests.bass?.extraPx ?? 0),
    winningStaff: resolveWinningStaff({
      trebleRequestedExtraPx: Math.max(0, leadingRequests.treble?.extraPx ?? 0),
      bassRequestedExtraPx: Math.max(0, leadingRequests.bass?.extraPx ?? 0),
    }),
  }
  const leadingNoteRestRequestedExtraPx = Math.max(
    0,
    noteRestLeadingRequests.treble,
    noteRestLeadingRequests.bass,
  )
  const leadingAccidentalRequestedExtraPx = Math.max(
    0,
    accidentalLeadingRequests.treble,
    accidentalLeadingRequests.bass,
  )
  const leadingAppliedExtraPx = Math.max(
    0,
    leadingDebug.trebleRequestedExtraPx,
    leadingDebug.bassRequestedExtraPx,
    leadingNoteRestRequestedExtraPx,
    leadingAccidentalRequestedExtraPx,
  )
  if (leadingAppliedExtraPx > 0) {
    safeLeftReserves[0] += leadingAppliedExtraPx
  }

  const firstFinalX = baseXs[0] + leadingAppliedExtraPx
  finalTargetXByOnset.set(onsetTicks[0] as number, firstFinalX)

  for (let index = 1; index < onsetTicks.length; index += 1) {
    const previousFinalX = finalTargetXByOnset.get(onsetTicks[index - 1] as number) ?? firstFinalX
    const baseGapPx = Math.max(0, baseXs[index] - baseXs[index - 1])
    const currentSegmentRequests = segmentRequests[index - 1] ?? createStaffSlotRequestRecord()
    const trebleRequestedExtraPx = Math.max(0, currentSegmentRequests.treble?.extraPx ?? 0)
    const bassRequestedExtraPx = Math.max(0, currentSegmentRequests.bass?.extraPx ?? 0)
    const currentNoteRestRequests = noteRestSegmentRequests[index - 1] ?? createStaffExtraRecord()
    const noteRestRequestedExtraPx = Math.max(
      0,
      currentNoteRestRequests.treble,
      currentNoteRestRequests.bass,
    )
    const currentNoteRestVisibleGap = noteRestSegmentVisibleGaps[index - 1] ?? { treble: null, bass: null }
    const noteRestVisibleGapPx = [currentNoteRestVisibleGap.treble, currentNoteRestVisibleGap.bass]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .reduce<number | null>((minValue, value) => (minValue === null ? value : Math.min(minValue, value)), null)
    const currentAccidentalRequests = accidentalSegmentRequests[index - 1] ?? createStaffExtraRecord()
    const accidentalRequestedExtraPx = Math.max(
      0,
      currentAccidentalRequests.treble,
      currentAccidentalRequests.bass,
    )
    const currentAccidentalVisibleGap = accidentalSegmentVisibleGaps[index - 1] ?? { treble: null, bass: null }
    const accidentalVisibleGapPx = [currentAccidentalVisibleGap.treble, currentAccidentalVisibleGap.bass]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .reduce<number | null>((minValue, value) => (minValue === null ? value : Math.min(minValue, value)), null)
    const extraReservePx = Math.max(
      0,
      trebleRequestedExtraPx,
      bassRequestedExtraPx,
      noteRestRequestedExtraPx,
      accidentalRequestedExtraPx,
    )
    const winningRequest = pickWinningStaffSlotRequest({
      trebleRequest: currentSegmentRequests.treble,
      bassRequest: currentSegmentRequests.bass,
    })
    if (extraReservePx > 0 && winningRequest && extraReservePx <= Math.max(0, trebleRequestedExtraPx, bassRequestedExtraPx) + 0.001) {
      if (winningRequest.side === 'right') {
        safeRightReserves[index - 1] += extraReservePx
      } else {
        safeLeftReserves[index] += extraReservePx
      }
    }

    const finalX = previousFinalX + baseGapPx + extraReservePx
    finalTargetXByOnset.set(onsetTicks[index] as number, finalX)
    spacingSegments.push({
      fromOnsetTicks: onsetTicks[index - 1] as number,
      toOnsetTicks: onsetTicks[index] as number,
      baseGapPx,
      extraReservePx,
      appliedGapPx: baseGapPx + extraReservePx,
      trebleRequestedExtraPx,
      bassRequestedExtraPx,
      noteRestRequestedExtraPx,
      noteRestVisibleGapPx,
      accidentalRequestedExtraPx,
      accidentalVisibleGapPx,
      winningStaff: resolveWinningStaff({
        trebleRequestedExtraPx,
        bassRequestedExtraPx,
      }),
    })
  }

  const trailingDebug: LeadingTrailingDebug = {
    trebleRequestedExtraPx: Math.max(0, trailingRequests.treble?.extraPx ?? 0),
    bassRequestedExtraPx: Math.max(0, trailingRequests.bass?.extraPx ?? 0),
    winningStaff: resolveWinningStaff({
      trebleRequestedExtraPx: Math.max(0, trailingRequests.treble?.extraPx ?? 0),
      bassRequestedExtraPx: Math.max(0, trailingRequests.bass?.extraPx ?? 0),
    }),
  }
  const trailingNoteRestRequestedExtraPx = Math.max(
    0,
    noteRestTrailingRequests.treble,
    noteRestTrailingRequests.bass,
  )
  const trailingAppliedExtraPx = Math.max(
    0,
    trailingDebug.trebleRequestedExtraPx,
    trailingDebug.bassRequestedExtraPx,
    trailingNoteRestRequestedExtraPx,
  )
  const lastIndex = onsetTicks.length - 1
  if (trailingAppliedExtraPx > 0) {
    safeRightReserves[lastIndex] += trailingAppliedExtraPx
  }

  onsetTicks.forEach((onsetTick, index) => {
    const collisionMetrics = sharedOnsetCollisionMetricsByTick[index]
    onsetReserves.push({
      onsetTicks: onsetTick,
      baseX: baseXs[index],
      finalX: finalTargetXByOnset.get(onsetTick) ?? baseXs[index],
      leftReservePx: safeLeftReserves[index],
      rightReservePx: safeRightReserves[index],
      rawLeftReservePx: Math.max(0, collisionMetrics?.rawLeftReservePx ?? 0),
      rawRightReservePx: Math.max(0, collisionMetrics?.rawRightReservePx ?? 0),
      leftOccupiedInsetPx: Math.max(0, collisionMetrics?.leftOccupiedInsetPx ?? 0),
      rightOccupiedTailPx: Math.max(0, collisionMetrics?.rightOccupiedTailPx ?? 0),
      leadingTrebleRequestedExtraPx: index === 0 ? leadingDebug.trebleRequestedExtraPx : 0,
      leadingBassRequestedExtraPx: index === 0 ? leadingDebug.bassRequestedExtraPx : 0,
      leadingWinningStaff: index === 0 ? leadingDebug.winningStaff : 'none',
      trailingTrebleRequestedExtraPx: index === lastIndex ? trailingDebug.trebleRequestedExtraPx : 0,
      trailingBassRequestedExtraPx: index === lastIndex ? trailingDebug.bassRequestedExtraPx : 0,
      trailingWinningStaff: index === lastIndex ? trailingDebug.winningStaff : 'none',
    })
  })

  const totalAppliedExtraPx = Number(
    (
      Math.max(0, leadingAppliedExtraPx) +
      spacingSegments.reduce((sum, segment) => sum + Math.max(0, segment.extraReservePx), 0) +
      Math.max(0, trailingAppliedExtraPx)
    ).toFixed(6),
  )

  return {
    finalTargetXByOnset,
    onsetReserves,
    spacingSegments,
    totalAppliedExtraPx,
  }
}

export function getMeasureUniformTimelineWeightSpan(
  measure: MeasurePair,
  measureTicks: number,
  spacingConfig: TimeAxisSpacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
  timelineBundle: MeasureTimelineBundle | null = null,
): number {
  return getMeasureUniformTimelineWeightMetrics(
    measure,
    measureTicks,
    spacingConfig,
    timelineBundle,
  ).totalWidthPx
}

export function applyUnifiedTimeAxisSpacing(params: ApplyUnifiedTimeAxisSpacingParams): AppliedTimeAxisSpacingMetrics | null {
  const {
    measure,
    noteStartX,
    formatWidth,
    trebleRendered,
    bassRendered,
    timelineBundle = null,
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
    measureTicks,
    sparseTailAnchorMode = 'none',
    compactTailAnchorTicks = DEFAULT_COMPACT_TAIL_ANCHOR_TICKS,
    uniformSpacingByTicks = false,
    measureStartBarX,
    measureEndBarX,
    publicAxisLayout = null,
    spacingAnchorTicks = null,
    preferMeasureBarlineAxis = false,
    preferMeasureEndBarlineAxis = false,
  } = params

  const refs = [
    ...buildTimeAxisRefs({
      staff: 'treble',
      notes: measure.treble,
      rendered: trebleRendered,
      timeline: timelineBundle?.trebleTimeline ?? null,
    }),
    ...buildTimeAxisRefs({
      staff: 'bass',
      notes: measure.bass,
      rendered: bassRendered,
      timeline: timelineBundle?.bassTimeline ?? null,
    }),
  ]
  const renderedRefs = [
    ...buildTimeAxisRenderedRefs({
      staff: 'treble',
      notes: measure.treble,
      rendered: trebleRendered,
      timeline: timelineBundle?.trebleTimeline ?? null,
    }),
    ...buildTimeAxisRenderedRefs({
      staff: 'bass',
      notes: measure.bass,
      rendered: bassRendered,
      timeline: timelineBundle?.bassTimeline ?? null,
    }),
  ]
  if (renderedRefs.length === 0) return null

  const refsByOnset = new Map<number, TimeAxisNoteRef[]>()
  refs.forEach((ref) => {
    const list = refsByOnset.get(ref.onsetTicks)
    if (list) {
      list.push(ref)
    } else {
      refsByOnset.set(ref.onsetTicks, [ref])
    }
  })
  const visualBlockersByStaff = buildStaffVisualBlockerRefs(renderedRefs)

  const noteOnsets = [...new Set(renderedRefs.map((ref) => ref.onsetTicks))].sort((a, b) => a - b)
  if (noteOnsets.length === 0) return null

  const measuredTotalTicks = Math.max(getStaffTotalTicks(measure.treble), getStaffTotalTicks(measure.bass))
  const measureTotalTicks =
    typeof measureTicks === 'number' && Number.isFinite(measureTicks) && measureTicks > 0
      ? Math.max(1, Math.round(measureTicks))
      : measuredTotalTicks
  const timelineOnsetsSet = new Set<number>(noteOnsets)
  if (spacingAnchorTicks && spacingAnchorTicks.length > 0) {
    timelineOnsetsSet.clear()
    spacingAnchorTicks.forEach((tick) => {
      const safeTick = clampMeasureTick(tick, measureTotalTicks)
      if (safeTick === null) return
      timelineOnsetsSet.add(safeTick)
    })
    noteOnsets.forEach((tick) => timelineOnsetsSet.add(tick))
  }
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

  const firstSpacingTick = onsetTicks[0]
  const lastSpacingTick = onsetTicks[onsetTicks.length - 1]
  const usableFormatWidth = Math.max(MIN_RENDER_WIDTH_PX, formatWidth)
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
  const intrinsicSpacingWeights = buildMeasureSpacingWeights({
    spacingTicks: onsetTicks,
    measureTicks: measureTotalTicks,
    spacingConfig,
  })
  const minWidthStretchPlan = resolveMeasureMinWidthStretchPlan({
    spacingConfig,
    leadingGapPx: intrinsicSpacingWeights.leadingGapPx,
    anchorSpanPx: intrinsicSpacingWeights.anchorSpanWeight,
    trailingGapPx: intrinsicSpacingWeights.trailingTailWeight,
  })
  const spacingWeights = buildMeasureSpacingWeights({
    spacingTicks: onsetTicks,
    measureTicks: measureTotalTicks,
    spacingConfig,
    segmentStretchScale: minWidthStretchPlan.segmentStretchScale,
  })
  const axisStart = axisBoundaryStart + Math.max(0, spacingWeights.leadingGapPx)
  const baseTargetXByOnset = buildBaseTargetXByOnset({
    onsetTicks,
    axisStart,
    spacingWeights,
    uniformSpacingByTicks,
    publicAxisLayout,
  })
  const overlay = resolveCollisionDrivenOverlay({
    onsetTicks,
    baseTargetXByOnset,
    refsByOnset,
    visualBlockersByStaff,
    effectiveBoundaryStartX: axisBoundaryStart,
    effectiveBoundaryEndX: axisBoundaryEnd,
    spacingConfig,
  })
  const finalTargetXByOnset = overlay.finalTargetXByOnset
  const onsetReserves = overlay.onsetReserves
  const spacingSegments = overlay.spacingSegments

  renderedRefs.forEach((ref) => {
    const targetX = finalTargetXByOnset.get(ref.onsetTicks)
    if (targetX === undefined) return
    const currentX = getRenderedNoteVisualX(ref.vexNote)
    if (!Number.isFinite(currentX)) return
    const delta = targetX - currentX
    if (Math.abs(delta) < 0.001) return
    ref.vexNote.setXShift(ref.vexNote.getXShift() + delta)
  })

  const resolvedFirstX = finalTargetXByOnset.get(firstSpacingTick)
  const resolvedLastX = finalTargetXByOnset.get(lastSpacingTick)
  if (
    typeof resolvedFirstX !== 'number' ||
    !Number.isFinite(resolvedFirstX) ||
    typeof resolvedLastX !== 'number' ||
    !Number.isFinite(resolvedLastX)
  ) {
    return null
  }

  const resolvedOccupiedBounds =
    getOccupiedBoundsFromOnsetReserves(onsetReserves) ??
    getRenderedOccupiedBounds(renderedRefs)
  const spacingOccupiedLeftX = resolvedOccupiedBounds?.leftX ?? resolvedFirstX
  const spacingOccupiedRightX = resolvedOccupiedBounds?.rightX ?? resolvedLastX
  const spacingAnchorGapFirstToLastPx = Math.max(0, resolvedLastX - resolvedFirstX)
  const leadingGapPx = Math.max(0, resolvedFirstX - axisBoundaryStart)
  const trailingGapPx = Math.max(0, axisBoundaryEnd - resolvedLastX)
  const effectiveLeftGapPx = spacingOccupiedLeftX - axisBoundaryStart
  const effectiveRightGapPx = axisBoundaryEnd - spacingOccupiedRightX

  return {
    effectiveBoundaryStartX: axisBoundaryStart,
    effectiveBoundaryEndX: axisBoundaryEnd,
    effectiveLeftGapPx,
    effectiveRightGapPx,
    leadingGapPx,
    trailingTailTicks: spacingWeights.trailingTailTicks,
    trailingGapPx,
    spacingOccupiedLeftX,
    spacingOccupiedRightX,
    spacingAnchorGapFirstToLastPx,
    spacingAnchorTicks: [...onsetTicks],
    spacingTickToX: new Map(finalTargetXByOnset),
    spacingOnsetReserves: onsetReserves,
    spacingSegments,
  }
}
