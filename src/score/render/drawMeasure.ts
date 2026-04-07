import { Accidental, BarlineType, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveConnector, StaveNote, StaveTie, Voice } from 'vexflow'
import { TICKS_PER_BEAT } from '../constants'
import {
  buildRenderedNoteKeys,
  getAccidentalStateKey,
  getEffectiveAlterFromContext,
  getKeySignatureSpecFromFifths,
  getRequiredAccidentalForTargetAlter,
} from '../accidentals'
import { getDurationDots, toVexDuration } from '../layout/demand'
import {
  deltaOrNull,
  finiteOrNull,
  getAccidentalRightXByRenderedIndex,
  getAccidentalVisualX,
  getLayoutNoteKey,
  getRenderedNoteAnchorX,
  getRenderedNoteGlyphBounds,
  getRenderedNoteVisualX,
} from '../layout/renderPosition'
import { getRenderedNoteHeadAbsoluteX, getRenderedNoteHeadColumnMetrics, getRenderedNoteHeadWidth } from '../layout/noteHeadColumns'
import { applyUnifiedTimeAxisSpacing } from '../layout/timeAxisSpacing'
import type { AppliedTimeAxisSpacingMetrics, TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import { getStepOctaveAlterFromPitch } from '../pitchMath'
import { buildPitchLineMap, createPianoPitches, getPitchLine, getStrictStemDirection } from '../pitchUtils'
import { getTieFrozenIncoming } from '../tieFrozen'
import { isStaffFullMeasureRest } from '../measureRestUtils'
import { getDragPreviewTargetKey } from './dragPreviewOverrides'
import { getJianpuNumeralForPitch, hasFilledNoteHead } from './noteheadNumerals'
import { buildTieLayout } from './tieLayoutGeometry'
import type { RenderedNoteKey } from '../accidentals'
import type { MeasureTimelineBundle, PublicAxisLayout } from '../timeline/types'
import type {
  DragDebugRow,
  DragDebugSnapshot,
  DragDebugStaticRecord,
  MeasurePair,
  NoteLayout,
  Pitch,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
  StaffKind,
  StemDirection,
  TieEndpoint,
  TieLayout,
  TimeSignature,
} from '../types'

const PITCHES: Pitch[] = createPianoPitches()
const PITCH_LINE_MAP: Record<StaffKind, Record<Pitch, number>> = {
  treble: buildPitchLineMap('treble', PITCHES),
  bass: buildPitchLineMap('bass', PITCHES),
}
const VALID_BEAM_DURATIONS = ['4', '8', '16', '32', '64'] as const
const ACCIDENTAL_NOTEHEAD_CLEARANCE_PX = 2
const ACCIDENTAL_PREVIOUS_NOTE_CLEARANCE_PX = 1
const ACCIDENTAL_BLOCKER_NOTEHEAD_CLEARANCE_PX = 0
const ACCIDENTAL_COLUMN_SAFE_GAP_PX = 1
const MAX_ACCIDENTAL_COLUMNS = 6
const ACCIDENTAL_MAX_LEFT_GAP_FROM_HEAD_PX = 96
const ACCIDENTAL_STATIC_PREFERRED_TOLERANCE_PX = 2
const ACCIDENTAL_TARGET_EPSILON_PX = 0.001
const ACCIDENTAL_BBOX_POSITION_TOLERANCE_PX = 24
const ACCIDENTAL_COLUMN_PRIORITY = [2, 3, 1, 4, 0, 5] as const
const ACCIDENTAL_FULL_CONFLICT_PATTERNS: Partial<Record<number, readonly number[]>> = {
  2: [1, 2],
  3: [2, 1, 3],
  4: [2, 3, 1, 4],
  5: [3, 2, 4, 1, 5],
  6: [3, 4, 2, 5, 1, 6],
}
const NOTEHEAD_BOUNDS_MIN_WIDTH_PX = 4
const NOTEHEAD_BOUNDS_MAX_WIDTH_PX = 10
const NOTEHEAD_MAX_OFFSET_FROM_BASE_PX = 45
const NOTEHEAD_BBOX_TO_ABSOLUTE_TOLERANCE_PX = 4
const NOTEHEAD_DISPLACED_ABSOLUTE_TO_LEFT_OFFSET_PX = 1
const STEM_INVARIANT_RIGHT_PADDING_PX = 3.5
const MIN_FORMAT_WIDTH_PX = 8
const DEFAULT_NOTE_HEAD_HIT_RADIUS_X = 5.5
const DEFAULT_NOTE_HEAD_HIT_RADIUS_Y = 4.2
const DEFAULT_ACCIDENTAL_HIT_RADIUS_Y = 7
const NOTEHEAD_NUMERAL_DEFAULT_COLOR = '#111111'
const NOTEHEAD_NUMERAL_LIGHT_COLOR = '#ffffff'
const NOTEHEAD_NUMERAL_FONT_FAMILY = '"Arial", "Noto Sans", sans-serif'
const NOTEHEAD_NUMERAL_FONT_WEIGHT = 600
const NOTEHEAD_NUMERAL_MIN_FONT_PX = 3
const NOTEHEAD_NUMERAL_MAX_FONT_PX = 18
const NOTEHEAD_NUMERAL_CLIP_INSET_X_PX = 0.8
const NOTEHEAD_NUMERAL_CLIP_INSET_Y_PX = 0.65
const DIATONIC_STEP_INDEX: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
}

function getRestAnchorPitch(staff: StaffKind): Pitch {
  return staff === 'treble' ? 'b/4' : 'd/3'
}

function toStemDirectionOrNull(value: number | null | undefined): StemDirection | null {
  return value === 1 || value === -1 ? value : null
}

type NoteHeadHitGeometry = {
  hitCenterX: number
  hitCenterY: number
  hitRadiusX: number
  hitRadiusY: number
  hitMinX: number
  hitMaxX: number
  hitMinY: number
  hitMaxY: number
}

type AccidentalHitGeometry = {
  hitCenterX: number
  hitCenterY: number
  hitRadiusX: number
  hitRadiusY: number
  hitMinX: number
  hitMaxX: number
  hitMinY: number
  hitMaxY: number
}

type NoteHeadGeometry = {
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
  boxX: number
  boxY: number
  boxWidth: number
  boxHeight: number
}

type VexNoteHeadLike = {
  getAbsoluteX?: () => number
  getBoundingBox?: () =>
    | {
        getX: () => number
        getY: () => number
        getW: () => number
        getH: () => number
      }
    | null
  getWidth?: () => number
  isDisplaced?: () => boolean
  preFormatted?: boolean
  getStyle?: () => { fillStyle?: string; strokeStyle?: string }
}

type MeasuredNumeralMetrics = {
  left: number
  right: number
  ascent: number
  descent: number
  height: number
  baselineOffsetY: number
}

function getRenderedNoteHead(vexNote: StaveNote, renderedIndex: number): VexNoteHeadLike | null {
  return (vexNote.noteHeads?.[renderedIndex] ?? null) as VexNoteHeadLike | null
}

function isReadyAbsoluteX(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 0.0001
}

type NoteHeadBoundsResolution = {
  leftX: number
  rightX: number
  width: number
  usedFallback: boolean
}

function resolveRenderedNoteHeadBounds(params: {
  noteHead: VexNoteHeadLike | null
  noteBaseX: number
  stemDirection: number
}): NoteHeadBoundsResolution | null {
  const { noteHead, noteBaseX, stemDirection } = params
  if (!noteHead || !Number.isFinite(noteBaseX)) return null

  const resolvedHeadLeftX = getRenderedNoteHeadAbsoluteX({
    noteHead,
    anchorX: noteBaseX,
    stemDirection,
  })
  const widthRaw = noteHead.getWidth?.()
  const resolvedWidth =
    typeof widthRaw === 'number' && Number.isFinite(widthRaw) && widthRaw > 0
      ? Math.min(NOTEHEAD_BOUNDS_MAX_WIDTH_PX, Math.max(NOTEHEAD_BOUNDS_MIN_WIDTH_PX, widthRaw))
      : getRenderedNoteHeadWidth(noteHead)

  const bbox = noteHead.getBoundingBox?.() ?? null
  const bboxLeftX = bbox?.getX?.()
  const bboxWidthRaw = bbox?.getW?.()
  const bboxWidth =
    typeof bboxWidthRaw === 'number' && Number.isFinite(bboxWidthRaw)
      ? Math.min(NOTEHEAD_BOUNDS_MAX_WIDTH_PX, Math.max(NOTEHEAD_BOUNDS_MIN_WIDTH_PX, bboxWidthRaw))
      : null
  const bboxLooksSane =
    typeof bboxLeftX === 'number' &&
    Number.isFinite(bboxLeftX) &&
    typeof bboxWidth === 'number' &&
    Number.isFinite(bboxWidth) &&
    bboxWidth > 0 &&
    Math.abs((bboxLeftX as number) - noteBaseX) <= NOTEHEAD_MAX_OFFSET_FROM_BASE_PX + NOTEHEAD_BOUNDS_MAX_WIDTH_PX
  const bboxMatchesResolvedHead =
    bboxLooksSane &&
    typeof resolvedHeadLeftX === 'number' &&
    Number.isFinite(resolvedHeadLeftX) &&
    Math.abs((bboxLeftX as number) - (resolvedHeadLeftX as number)) <= NOTEHEAD_BBOX_TO_ABSOLUTE_TOLERANCE_PX
  if (bboxMatchesResolvedHead) {
    return {
      leftX: bboxLeftX as number,
      rightX: (bboxLeftX as number) + (bboxWidth as number),
      width: bboxWidth as number,
      usedFallback: false,
    }
  }

  if (typeof resolvedHeadLeftX !== 'number' || !Number.isFinite(resolvedHeadLeftX)) {
    if (!bboxLooksSane) {
      return null
    }
    return {
      leftX: bboxLeftX as number,
      rightX: (bboxLeftX as number) + (bboxWidth as number),
      width: bboxWidth as number,
      usedFallback: true,
    }
  }
  const rawAbsoluteX = noteHead.getAbsoluteX?.()
  const hasReadyAbsoluteX =
    typeof rawAbsoluteX === 'number' && Number.isFinite(rawAbsoluteX) && Math.abs(rawAbsoluteX) > 0.0001
  const absoluteDeltaFromBase = resolvedHeadLeftX - noteBaseX
  const shouldApplyDisplacedFallback =
    Math.abs(absoluteDeltaFromBase) >= resolvedWidth + NOTEHEAD_DISPLACED_ABSOLUTE_TO_LEFT_OFFSET_PX
  const adjustedDisplacedLeftX =
    shouldApplyDisplacedFallback
      ? resolvedHeadLeftX + (noteBaseX - resolvedHeadLeftX) / 2
      : null
  const leftX =
    typeof adjustedDisplacedLeftX === 'number' &&
    Number.isFinite(adjustedDisplacedLeftX) &&
    Math.abs(adjustedDisplacedLeftX - noteBaseX) <= NOTEHEAD_MAX_OFFSET_FROM_BASE_PX + NOTEHEAD_BOUNDS_MAX_WIDTH_PX
      ? adjustedDisplacedLeftX
      : resolvedHeadLeftX
  const usedFallback = !hasReadyAbsoluteX || leftX !== resolvedHeadLeftX
  return {
    leftX,
    rightX: leftX + resolvedWidth,
    width: resolvedWidth,
    usedFallback,
  }
}

function resolveMeasuredNoteHeadBounds(params: {
  noteHead: VexNoteHeadLike | null
  noteBaseX: number
  stemDirection: number
}): NoteHeadBoundsResolution | null {
  const { noteHead, noteBaseX, stemDirection } = params
  if (!noteHead || !Number.isFinite(noteBaseX)) return null

  const bbox = noteHead.getBoundingBox?.() ?? null
  const bboxLeftX = bbox?.getX?.()
  const bboxWidthRaw = bbox?.getW?.()
  const bboxWidth =
    typeof bboxWidthRaw === 'number' && Number.isFinite(bboxWidthRaw)
      ? Math.min(NOTEHEAD_BOUNDS_MAX_WIDTH_PX, Math.max(NOTEHEAD_BOUNDS_MIN_WIDTH_PX, bboxWidthRaw))
      : null
  const bboxLooksSane =
    typeof bboxLeftX === 'number' &&
    Number.isFinite(bboxLeftX) &&
    typeof bboxWidth === 'number' &&
    Number.isFinite(bboxWidth) &&
    bboxWidth > 0 &&
    Math.abs((bboxLeftX as number) - noteBaseX) <= NOTEHEAD_MAX_OFFSET_FROM_BASE_PX + NOTEHEAD_BOUNDS_MAX_WIDTH_PX
  if (bboxLooksSane) {
    return {
      leftX: bboxLeftX as number,
      rightX: (bboxLeftX as number) + (bboxWidth as number),
      width: bboxWidth as number,
      usedFallback: false,
    }
  }

  return resolveRenderedNoteHeadBounds({
    noteHead,
    noteBaseX,
    stemDirection,
  })
}

function resolveChordHeadLeftX(params: { vexNote: StaveNote; noteBaseX: number }): {
  chordHeadLeftX: number
  usedFallback: boolean
} {
  const { vexNote, noteBaseX } = params
  const noteHeads = (vexNote.noteHeads ?? []) as VexNoteHeadLike[]
  if (!Number.isFinite(noteBaseX) || noteHeads.length === 0) {
    return {
      chordHeadLeftX: noteBaseX,
      usedFallback: true,
    }
  }
  let minHeadLeftX = Number.POSITIVE_INFINITY
  let usedFallback = false
  const stemDirection = vexNote.getStemDirection()
  noteHeads.forEach((noteHead) => {
    const resolvedBounds = resolveMeasuredNoteHeadBounds({
      noteHead,
      noteBaseX,
      stemDirection,
    })
    if (!resolvedBounds) {
      usedFallback = true
      return
    }
    if (resolvedBounds.usedFallback) {
      usedFallback = true
    }
    minHeadLeftX = Math.min(minHeadLeftX, resolvedBounds.leftX)
  })
  if (Number.isFinite(minHeadLeftX)) {
    return {
      chordHeadLeftX: minHeadLeftX,
      usedFallback,
    }
  }

  const { minHeadX } = getRenderedNoteHeadColumnMetrics(vexNote, noteBaseX)
  if (Number.isFinite(minHeadX)) {
    return {
      chordHeadLeftX: minHeadX,
      usedFallback: true,
    }
  }

  return {
    chordHeadLeftX: noteBaseX,
    usedFallback: true,
  }
}

function resolveCurrentAccidentalLeftX(params: {
  vexNote: StaveNote
  modifier: Accidental
  renderedIndex: number
}): {
  leftX: number | null
  usedFallback: boolean
} {
  const { vexNote, modifier, renderedIndex } = params
  const startBasedX = resolveAccidentalLeftXFromStart({
    vexNote,
    modifier,
    renderedIndex,
  })
  if (isReadyAbsoluteX(startBasedX)) {
    return {
      leftX: startBasedX,
      usedFallback: false,
    }
  }

  const nativeX = getAccidentalVisualX(vexNote, modifier, renderedIndex)
  if (isReadyAbsoluteX(nativeX)) {
    return {
      leftX: nativeX,
      usedFallback: true,
    }
  }

  return {
    leftX: null,
    usedFallback: true,
  }
}

function resolveAccidentalWidth(params: {
  modifier: Accidental
  accidentalCode: string | null | undefined
}): number {
  const { modifier, accidentalCode } = params
  const widthRaw = modifier.getWidth()
  if (Number.isFinite(widthRaw) && widthRaw > 0) {
    return widthRaw
  }
  switch (accidentalCode) {
    case 'bb':
      return 16
    case '##':
      return 12
    case 'b':
    case '#':
      return 10
    case 'n':
      return 9
    default:
      return 10
  }
}

function resolveMeasuredAccidentalBounds(params: {
  vexNote: StaveNote
  modifier: Accidental
  renderedIndex: number
  fallbackWidth: number
}): {
  leftX: number
  rightX: number
  width: number
  usedFallback: boolean
} | null {
  const { vexNote, modifier, renderedIndex, fallbackWidth } = params
  const startBasedLeftX = resolveAccidentalLeftXFromStart({
    vexNote,
    modifier,
    renderedIndex,
  })
  const nativeLeftX = getAccidentalVisualX(vexNote, modifier, renderedIndex)
  const referenceLeftX =
    typeof startBasedLeftX === 'number' && Number.isFinite(startBasedLeftX)
      ? startBasedLeftX
      : typeof nativeLeftX === 'number' && Number.isFinite(nativeLeftX)
        ? nativeLeftX
        : null

  const bbox = (
    modifier as unknown as {
      getBoundingBox?: () =>
        | {
            getX?: () => number
            getW?: () => number
          }
        | null
    }
  ).getBoundingBox?.()
  const bboxLeftX = bbox?.getX?.()
  const bboxWidth = bbox?.getW?.()
  if (
    typeof bboxLeftX === 'number' &&
    Number.isFinite(bboxLeftX) &&
    typeof bboxWidth === 'number' &&
    Number.isFinite(bboxWidth) &&
    bboxWidth > 0
  ) {
    const bboxMatchesReference =
      referenceLeftX === null
        ? true
        : Math.abs(bboxLeftX - referenceLeftX) <= ACCIDENTAL_BBOX_POSITION_TOLERANCE_PX
    if (bboxMatchesReference) {
      return {
        leftX: bboxLeftX,
        rightX: bboxLeftX + bboxWidth,
        width: bboxWidth,
        usedFallback: false,
      }
    }
  }

  const widthRaw = modifier.getWidth()
  const resolvedWidth =
    typeof widthRaw === 'number' && Number.isFinite(widthRaw) && widthRaw > 0
      ? widthRaw
      : fallbackWidth
  if (referenceLeftX !== null) {
    return {
      leftX: referenceLeftX,
      rightX: referenceLeftX + resolvedWidth,
      width: resolvedWidth,
      usedFallback: true,
    }
  }

  return null
}

function resolveAccidentalLeftXFromStart(params: {
  vexNote: StaveNote
  modifier: Accidental
  renderedIndex: number
}): number | null {
  const { vexNote, modifier, renderedIndex } = params
  const startX = vexNote.getModifierStartXY(1, renderedIndex)?.x
  const width = modifier.getWidth()
  if (
    typeof startX !== 'number' ||
    !Number.isFinite(startX) ||
    typeof width !== 'number' ||
    !Number.isFinite(width)
  ) {
    return null
  }
  const leftX = startX - width + modifier.getXShift()
  return Number.isFinite(leftX) ? leftX : null
}

function applyAccidentalLeftXTarget(params: {
  vexNote: StaveNote
  modifier: Accidental
  renderedIndex: number
  targetLeftX: number
}): {
  applied: boolean
  delta: number
} {
  const { vexNote, modifier, renderedIndex, targetLeftX } = params
  if (!Number.isFinite(targetLeftX)) {
    return {
      applied: false,
      delta: 0,
    }
  }
  const initialXShift = modifier.getXShift()
  const readLeftX = (xShift: number): number | null => {
    modifier.setXShift(xShift)
    const leftX = getAccidentalVisualX(vexNote, modifier, renderedIndex)
    return typeof leftX === 'number' && Number.isFinite(leftX) ? leftX : null
  }

  let bestXShift = initialXShift
  let bestLeftX = readLeftX(initialXShift)
  if (bestLeftX === null) {
    modifier.setXShift(initialXShift)
    return {
      applied: false,
      delta: 0,
    }
  }
  let bestError = Math.abs(targetLeftX - bestLeftX)
  if (bestError < ACCIDENTAL_TARGET_EPSILON_PX) {
    modifier.setXShift(initialXShift)
    return {
      applied: false,
      delta: 0,
    }
  }

  let currentXShift = initialXShift
  let currentLeftX = bestLeftX
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const error = targetLeftX - currentLeftX
    if (Math.abs(error) < ACCIDENTAL_TARGET_EPSILON_PX) {
      break
    }

    const probeStep = 1
    const probeLeftX = readLeftX(currentXShift + probeStep)
    if (probeLeftX === null) {
      break
    }
    const sensitivity = (probeLeftX - currentLeftX) / probeStep
    if (!Number.isFinite(sensitivity) || Math.abs(sensitivity) < ACCIDENTAL_TARGET_EPSILON_PX) {
      break
    }

    const candidateXShift = currentXShift + error / sensitivity
    const candidateLeftX = readLeftX(candidateXShift)
    if (candidateLeftX === null) {
      break
    }
    const candidateError = Math.abs(targetLeftX - candidateLeftX)
    if (candidateError + ACCIDENTAL_TARGET_EPSILON_PX < bestError) {
      bestError = candidateError
      bestXShift = candidateXShift
      bestLeftX = candidateLeftX
    }
    currentXShift = candidateXShift
    currentLeftX = candidateLeftX
  }

  modifier.setXShift(bestXShift)
  const appliedDelta = bestXShift - initialXShift
  if (Math.abs(appliedDelta) < ACCIDENTAL_TARGET_EPSILON_PX) {
    return {
      applied: false,
      delta: 0,
    }
  }

  return {
    applied: true,
    delta: appliedDelta,
  }
}

function isAccidentalLeftXOutlier(params: {
  candidateLeftX: number | null
  referenceHeadLeftX: number
  modifierWidth: number
}): boolean {
  const { candidateLeftX, referenceHeadLeftX, modifierWidth } = params
  if (candidateLeftX === null || !Number.isFinite(candidateLeftX)) return false
  if (!Number.isFinite(referenceHeadLeftX)) return false
  if (!Number.isFinite(modifierWidth) || modifierWidth <= 0) return false
  const candidateRightX = candidateLeftX + modifierWidth
  const gapToChordHead = referenceHeadLeftX - candidateRightX
  return (
    gapToChordHead > ACCIDENTAL_MAX_LEFT_GAP_FROM_HEAD_PX ||
    gapToChordHead < -ACCIDENTAL_MAX_LEFT_GAP_FROM_HEAD_PX
  )
}

function resolvePreviousNoteOccupiedRightX(params: {
  sourceNotes: ScoreNote[]
  renderedBySourceIndex: Map<number, RenderedMeasureNote>
  noteIndex: number
}): number | null {
  const { sourceNotes, renderedBySourceIndex, noteIndex } = params
  for (let previousNoteIndex = noteIndex - 1; previousNoteIndex >= 0; previousNoteIndex -= 1) {
    const previousSourceNote = sourceNotes[previousNoteIndex]
    if (!previousSourceNote || previousSourceNote.isRest) continue
    const previousRenderedEntry = renderedBySourceIndex.get(previousNoteIndex)
    if (!previousRenderedEntry) continue
    const previousVexNote = previousRenderedEntry.vexNote
    const previousNoteBaseX = getRenderedNoteVisualX(previousVexNote)
    const previousStemDirection = previousVexNote.getStemDirection()
    const occupiedRightXCandidates: number[] = []

    const previousNoteHeads = (previousVexNote.noteHeads ?? []) as VexNoteHeadLike[]
    previousNoteHeads.forEach((noteHead) => {
      const resolvedBounds = resolveMeasuredNoteHeadBounds({
        noteHead,
        noteBaseX: previousNoteBaseX,
        stemDirection: previousStemDirection,
      })
      if (resolvedBounds && Number.isFinite(resolvedBounds.rightX)) {
        occupiedRightXCandidates.push(resolvedBounds.rightX)
      }

      const rawAbsoluteLeftX = getRenderedNoteHeadAbsoluteX({
        noteHead,
        anchorX: previousNoteBaseX,
        stemDirection: previousStemDirection,
      })
      const rawWidth = noteHead.getWidth?.()
      if (
        Number.isFinite(rawAbsoluteLeftX) &&
        Number.isFinite(rawWidth) &&
        (rawWidth as number) > 0 &&
        (rawWidth as number) <= NOTEHEAD_MAX_OFFSET_FROM_BASE_PX
      ) {
        occupiedRightXCandidates.push((rawAbsoluteLeftX as number) + (rawWidth as number))
      }

      const bbox = noteHead.getBoundingBox?.() ?? null
      const bboxLeftX = bbox?.getX?.()
      const bboxWidth = bbox?.getW?.()
      if (
        Number.isFinite(bboxLeftX) &&
        Number.isFinite(bboxWidth) &&
        (bboxWidth as number) > 0 &&
        Math.abs((bboxLeftX as number) - previousNoteBaseX) <=
          NOTEHEAD_MAX_OFFSET_FROM_BASE_PX + NOTEHEAD_BOUNDS_MAX_WIDTH_PX
      ) {
        occupiedRightXCandidates.push((bboxLeftX as number) + (bboxWidth as number))
      }
    })

    const previousAccidentalModifiers = previousVexNote
      .getModifiersByType(Accidental.CATEGORY)
      .map((modifier) => modifier as Accidental)
    previousAccidentalModifiers.forEach((modifier) => {
      const renderedIndex = modifier.getIndex()
      if (typeof renderedIndex !== 'number' || !Number.isFinite(renderedIndex)) return
      const renderedKey = previousRenderedEntry.renderedKeys[renderedIndex]
      const fallbackWidth = resolveAccidentalWidth({
        modifier,
        accidentalCode: renderedKey?.accidental ?? null,
      })
      const resolvedBounds = resolveMeasuredAccidentalBounds({
        vexNote: previousVexNote,
        modifier,
        renderedIndex,
        fallbackWidth,
      })
      if (resolvedBounds && Number.isFinite(resolvedBounds.rightX)) {
        occupiedRightXCandidates.push(resolvedBounds.rightX)
      }
    })

    if (occupiedRightXCandidates.length === 0) {
      const headEndX = previousVexNote.getNoteHeadEndX()
      if (Number.isFinite(headEndX)) {
        occupiedRightXCandidates.push(headEndX)
      }
      const visualBounds = getRenderedNoteGlyphBounds(previousVexNote)
      const visualRightX = visualBounds?.rightX
      if (typeof visualRightX === 'number' && Number.isFinite(visualRightX)) {
        occupiedRightXCandidates.push(visualRightX)
      }
      const previousGlyphWidth = previousVexNote.getGlyphWidth()
      if (Number.isFinite(previousNoteBaseX) && Number.isFinite(previousGlyphWidth)) {
        occupiedRightXCandidates.push(previousNoteBaseX + previousGlyphWidth)
      }
    }

    const previousOccupiedRightX = occupiedRightXCandidates.reduce(
      (maxValue, candidate) => (Number.isFinite(candidate) ? Math.max(maxValue, candidate) : maxValue),
      Number.NEGATIVE_INFINITY,
    )
    if (Number.isFinite(previousOccupiedRightX)) {
      return previousOccupiedRightX
    }
  }
  return null
}

function resolveRenderedIndexForRenderedKey(params: {
  renderedKeys: RenderedNoteKey[]
  renderedKey: RenderedNoteKey
  fallbackRenderedIndex: number
}): number {
  const { renderedKeys, renderedKey, fallbackRenderedIndex } = params
  const byKeyIndex = renderedKeys.findIndex((entry) => entry.keyIndex === renderedKey.keyIndex)
  if (byKeyIndex >= 0) return byKeyIndex
  const byPitch = renderedKeys.findIndex((entry) => entry.pitch === renderedKey.pitch)
  if (byPitch >= 0) return byPitch
  return fallbackRenderedIndex
}

function resolveAccidentalModifierForRenderedKey(params: {
  accidentalModifiers: Accidental[]
  renderedKeys: RenderedNoteKey[]
  renderedKey: RenderedNoteKey
  fallbackRenderedIndex: number
}): {
  modifier: Accidental | null
  keyRenderedIndex: number
} {
  const { accidentalModifiers, renderedKeys, renderedKey, fallbackRenderedIndex } = params
  const keyRenderedIndex = resolveRenderedIndexForRenderedKey({
    renderedKeys,
    renderedKey,
    fallbackRenderedIndex,
  })
  const modifier =
    accidentalModifiers.find((item) => item.getIndex() === keyRenderedIndex) ??
    (accidentalModifiers.length === 1 ? accidentalModifiers[0] : null)
  return {
    modifier,
    keyRenderedIndex,
  }
}

function resolveOwnHeadLeftX(params: {
  vexNote: StaveNote
  renderedIndex: number
  noteBaseX: number
}): {
  ownHeadLeftX: number | null
  usedFallback: boolean
} {
  const { vexNote, renderedIndex, noteBaseX } = params
  const noteHead = (vexNote.noteHeads?.[renderedIndex] ?? null) as VexNoteHeadLike | null
  if (!noteHead || !Number.isFinite(noteBaseX)) {
    return {
      ownHeadLeftX: null,
      usedFallback: true,
    }
  }
  const resolvedBounds = resolveMeasuredNoteHeadBounds({
    noteHead,
    noteBaseX,
    stemDirection: vexNote.getStemDirection(),
  })
  if (!resolvedBounds) {
    return {
      ownHeadLeftX: null,
      usedFallback: true,
    }
  }
  return {
    ownHeadLeftX: resolvedBounds.leftX,
    usedFallback: resolvedBounds.usedFallback,
  }
}

function resolveMeasuredOwnHeadLeftX(params: {
  vexNote: StaveNote
  renderedIndex: number
  noteBaseX: number
}): {
  ownHeadLeftX: number | null
  usedFallback: boolean
} {
  const { vexNote, renderedIndex, noteBaseX } = params
  const noteHead = (vexNote.noteHeads?.[renderedIndex] ?? null) as VexNoteHeadLike | null
  if (!noteHead || !Number.isFinite(noteBaseX)) {
    return {
      ownHeadLeftX: null,
      usedFallback: true,
    }
  }
  const resolvedBounds = resolveMeasuredNoteHeadBounds({
    noteHead,
    noteBaseX,
    stemDirection: vexNote.getStemDirection(),
  })
  if (!resolvedBounds) {
    return {
      ownHeadLeftX: null,
      usedFallback: true,
    }
  }
  return {
    ownHeadLeftX: resolvedBounds.leftX,
    usedFallback: resolvedBounds.usedFallback,
  }
}

type ChordBlockerHeadBounds = {
  leftX: number
  rightX: number
}

function resolveChordBlockerHeadBounds(params: {
  vexNote: StaveNote
  renderedIndex: number
  noteBaseX: number
}): {
  blockerHeadBounds: ChordBlockerHeadBounds[]
  usedFallback: boolean
} {
  const { vexNote, renderedIndex, noteBaseX } = params
  const noteHeads = (vexNote.noteHeads ?? []) as VexNoteHeadLike[]
  if (!Number.isFinite(noteBaseX) || noteHeads.length === 0) {
    return {
      blockerHeadBounds: [],
      usedFallback: true,
    }
  }
  const stemDirection = vexNote.getStemDirection()
  const blockerHeadBounds: ChordBlockerHeadBounds[] = []
  let usedFallback = false
  noteHeads.forEach((noteHead, noteHeadIndex) => {
    if (noteHeadIndex === renderedIndex) return
    const resolvedBounds = resolveMeasuredNoteHeadBounds({
      noteHead,
      noteBaseX,
      stemDirection,
    })
    if (!resolvedBounds) {
      usedFallback = true
      return
    }
    if (resolvedBounds.usedFallback) {
      usedFallback = true
    }

    blockerHeadBounds.push({
      leftX: resolvedBounds.leftX,
      rightX: resolvedBounds.rightX,
    })
  })
  return {
    blockerHeadBounds,
    usedFallback,
  }
}

function resolveAccidentalLeftAfterChordHeadAvoidance(params: {
  candidateLeftX: number
  modifierWidth: number
  blockerHeadBounds: ChordBlockerHeadBounds[]
}): {
  leftX: number
  clamped: boolean
} {
  const { candidateLeftX, modifierWidth, blockerHeadBounds } = params
  if (!Number.isFinite(candidateLeftX) || !Number.isFinite(modifierWidth) || modifierWidth <= 0) {
    return {
      leftX: candidateLeftX,
      clamped: false,
    }
  }
  let resolvedLeftX = candidateLeftX
  let clamped = false
  const maxIterations = Math.max(1, blockerHeadBounds.length + 1)
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const overlappingBounds = blockerHeadBounds.filter((bound) => {
      return (
        resolvedLeftX + modifierWidth > bound.leftX + ACCIDENTAL_BLOCKER_NOTEHEAD_CLEARANCE_PX + ACCIDENTAL_TARGET_EPSILON_PX &&
        resolvedLeftX < bound.rightX - ACCIDENTAL_BLOCKER_NOTEHEAD_CLEARANCE_PX - ACCIDENTAL_TARGET_EPSILON_PX
      )
    })
    if (overlappingBounds.length === 0) {
      break
    }
    const nextLeftX = overlappingBounds.reduce((leftMost, bound) => {
      return Math.min(leftMost, bound.leftX - modifierWidth - ACCIDENTAL_BLOCKER_NOTEHEAD_CLEARANCE_PX)
    }, resolvedLeftX)
    if (!(nextLeftX < resolvedLeftX - ACCIDENTAL_TARGET_EPSILON_PX)) {
      break
    }
    resolvedLeftX = nextLeftX
    clamped = true
  }
  return {
    leftX: resolvedLeftX,
    clamped,
  }
}

type AccidentalColumnNode = {
  rowKey: string
  renderedIndex: number
  keyRenderedIndex: number
  keyIndex: number
  pitch: Pitch
  diatonicOrdinal: number
  modifier: Accidental
  width: number
  baseLeftX: number
  minLeftX: number | null
  maxLeftX: number | null
}

type AccidentalColumnPlan = {
  placementByRenderedIndex: Map<number, { columnIndex: number; componentId: number }>
  hasStagger: boolean
  overflowInfeasible: boolean
}

type AccidentalColumnTargetResult = {
  targetLeftByRenderedIndex: Map<number, number>
  overflowInfeasible: boolean
  hardInfeasibleByRenderedIndex: Map<number, boolean>
}

function resolvePitchDiatonicOrdinal(pitch: Pitch): number | null {
  const { step, octave } = getStepOctaveAlterFromPitch(pitch)
  const stepIndex = DIATONIC_STEP_INDEX[step]
  if (!Number.isFinite(octave) || !Number.isFinite(stepIndex)) return null
  return octave * 7 + stepIndex
}

function isAccidentalConflictByDiatonicDistance(leftOrdinal: number, rightOrdinal: number): boolean {
  const distance = Math.abs(leftOrdinal - rightOrdinal)
  return distance >= 1 && distance <= 5
}

function resolveAccidentalColumnPlan(params: {
  nodes: readonly AccidentalColumnNode[]
}): AccidentalColumnPlan {
  const { nodes } = params
  const placementByRenderedIndex = new Map<number, { columnIndex: number; componentId: number }>()
  if (nodes.length <= 1) {
    return {
      placementByRenderedIndex,
      hasStagger: false,
      overflowInfeasible: false,
    }
  }

  const orderedNodeIndices = nodes
    .map((_, index) => index)
    .sort((left, right) => {
      const leftNode = nodes[left]!
      const rightNode = nodes[right]!
      if (leftNode.diatonicOrdinal !== rightNode.diatonicOrdinal) {
        return leftNode.diatonicOrdinal - rightNode.diatonicOrdinal
      }
      if (leftNode.renderedIndex !== rightNode.renderedIndex) {
        return leftNode.renderedIndex - rightNode.renderedIndex
      }
      return leftNode.keyIndex - rightNode.keyIndex
    })

  const size = orderedNodeIndices.length
  const conflictMatrix = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  for (let left = 0; left < size; left += 1) {
    const leftNode = nodes[orderedNodeIndices[left]!]!
    for (let right = left + 1; right < size; right += 1) {
      const rightNode = nodes[orderedNodeIndices[right]!]!
      const conflict = isAccidentalConflictByDiatonicDistance(leftNode.diatonicOrdinal, rightNode.diatonicOrdinal)
      conflictMatrix[left]![right] = conflict
      conflictMatrix[right]![left] = conflict
    }
  }

  const visited = new Array<boolean>(size).fill(false)
  const components: number[][] = []
  for (let start = 0; start < size; start += 1) {
    if (visited[start]) continue
    const stack = [start]
    visited[start] = true
    const component: number[] = []
    while (stack.length > 0) {
      const current = stack.pop() as number
      component.push(current)
      for (let next = 0; next < size; next += 1) {
        if (visited[next]) continue
        if (!conflictMatrix[current]![next]) continue
        visited[next] = true
        stack.push(next)
      }
    }
    component.sort((left, right) => left - right)
    components.push(component)
  }

  let hasStagger = false
  let overflowInfeasible = false

  components.forEach((component, componentId) => {
    if (component.length <= 1) {
      const localIndex = component[0]
      if (typeof localIndex === 'number') {
        const node = nodes[orderedNodeIndices[localIndex]!]!
        placementByRenderedIndex.set(node.renderedIndex, {
          columnIndex: 0,
          componentId,
        })
      }
      return
    }
    let componentColumnByLocalIndex = new Map<number, number>()
    const completeEdgeCount = (component.length * (component.length - 1)) / 2
    let componentEdgeCount = 0
    for (let left = 0; left < component.length; left += 1) {
      for (let right = left + 1; right < component.length; right += 1) {
        if (conflictMatrix[component[left]!]![component[right]!]) {
          componentEdgeCount += 1
        }
      }
    }
    const isCompleteConflictComponent = componentEdgeCount === completeEdgeCount
    const template = isCompleteConflictComponent ? ACCIDENTAL_FULL_CONFLICT_PATTERNS[component.length] : null

    if (template && template.length === component.length) {
      template.forEach((columnOneBased, localOrderIndex) => {
        const localIndex = component[localOrderIndex]
        if (typeof localIndex !== 'number') return
        componentColumnByLocalIndex.set(localIndex, Math.max(0, columnOneBased - 1))
      })
    } else {
      component.forEach((localIndex, componentOrderIndex) => {
        const currentNode = nodes[orderedNodeIndices[localIndex]!]!
        const blockedColumns = new Set<number>()
        for (let previousOrderIndex = 0; previousOrderIndex < componentOrderIndex; previousOrderIndex += 1) {
          const previousLocalIndex = component[previousOrderIndex]!
          if (!conflictMatrix[localIndex]![previousLocalIndex]) continue
          const previousColumn = componentColumnByLocalIndex.get(previousLocalIndex)
          if (typeof previousColumn === 'number') {
            blockedColumns.add(previousColumn)
          }
        }

        const preferredColumns: number[] = []
        for (let previousOrderIndex = componentOrderIndex - 1; previousOrderIndex >= 0; previousOrderIndex -= 1) {
          const previousLocalIndex = component[previousOrderIndex]!
          const previousNode = nodes[orderedNodeIndices[previousLocalIndex]!]!
          const diatonicDistance = currentNode.diatonicOrdinal - previousNode.diatonicOrdinal
          if (diatonicDistance <= 0) continue
          if (diatonicDistance % 7 !== 0) continue
          const previousSameStepColumn = componentColumnByLocalIndex.get(previousLocalIndex)
          if (typeof previousSameStepColumn === 'number') {
            preferredColumns.push(previousSameStepColumn)
            break
          }
        }
        const previousSixthOrderIndex = componentOrderIndex - MAX_ACCIDENTAL_COLUMNS
        if (previousSixthOrderIndex >= 0) {
          const previousSixthLocalIndex = component[previousSixthOrderIndex]!
          const preferredReuseColumn = componentColumnByLocalIndex.get(previousSixthLocalIndex)
          if (typeof preferredReuseColumn === 'number') {
            preferredColumns.push(preferredReuseColumn)
          }
        }
        ACCIDENTAL_COLUMN_PRIORITY.forEach((column) => preferredColumns.push(column))
        for (let column = 0; column < MAX_ACCIDENTAL_COLUMNS; column += 1) {
          preferredColumns.push(column)
        }
        const dedupedPreferredColumns = [...new Set(preferredColumns)].filter(
          (column) => Number.isFinite(column) && column >= 0 && column < MAX_ACCIDENTAL_COLUMNS,
        )

        const availableColumn = dedupedPreferredColumns.find((column) => !blockedColumns.has(column))
        if (typeof availableColumn === 'number') {
          componentColumnByLocalIndex.set(localIndex, availableColumn)
          return
        }

        overflowInfeasible = true
        let selectedColumn = 0
        let selectedScore = Number.POSITIVE_INFINITY
        dedupedPreferredColumns.forEach((column) => {
          let conflictScore = 0
          for (let previousOrderIndex = 0; previousOrderIndex < componentOrderIndex; previousOrderIndex += 1) {
            const previousLocalIndex = component[previousOrderIndex]!
            const previousColumn = componentColumnByLocalIndex.get(previousLocalIndex)
            if (!conflictMatrix[localIndex]![previousLocalIndex]) continue
            if (previousColumn === column) {
              conflictScore += 1
            }
          }
          if (conflictScore + ACCIDENTAL_TARGET_EPSILON_PX < selectedScore) {
            selectedScore = conflictScore
            selectedColumn = column
          }
        })
        componentColumnByLocalIndex.set(localIndex, selectedColumn)
      })
    }

    componentColumnByLocalIndex.forEach((columnIndex, localIndex) => {
      const node = nodes[orderedNodeIndices[localIndex]!]!
      placementByRenderedIndex.set(node.renderedIndex, {
        columnIndex,
        componentId,
      })
    })

    for (let left = 0; left < component.length; left += 1) {
      const leftLocalIndex = component[left]!
      const leftColumn = componentColumnByLocalIndex.get(leftLocalIndex)
      if (typeof leftColumn !== 'number' || !Number.isFinite(leftColumn)) continue
      for (let right = left + 1; right < component.length; right += 1) {
        const rightLocalIndex = component[right]!
        if (!conflictMatrix[leftLocalIndex]![rightLocalIndex]) continue
        const rightColumn = componentColumnByLocalIndex.get(rightLocalIndex)
        if (typeof rightColumn !== 'number' || !Number.isFinite(rightColumn)) continue
        if (leftColumn === rightColumn) {
          overflowInfeasible = true
        }
      }
    }

    const usedColumns = new Set<number>(componentColumnByLocalIndex.values())
    if (usedColumns.size > 1) {
      hasStagger = true
    }
  })

  return {
    placementByRenderedIndex,
    hasStagger,
    overflowInfeasible,
  }
}

function resolveAccidentalColumnTargets(params: {
  nodes: readonly AccidentalColumnNode[]
  columnPlan: AccidentalColumnPlan
}): AccidentalColumnTargetResult {
  const { nodes, columnPlan } = params
  const targetLeftByRenderedIndex = new Map<number, number>()
  const hardInfeasibleByRenderedIndex = new Map<number, boolean>()
  if (!columnPlan.hasStagger || nodes.length <= 1) {
    return {
      targetLeftByRenderedIndex,
      overflowInfeasible: columnPlan.overflowInfeasible,
      hardInfeasibleByRenderedIndex,
    }
  }

  const nodesByComponent = new Map<number, AccidentalColumnNode[]>()
  nodes.forEach((node) => {
    const placement = columnPlan.placementByRenderedIndex.get(node.renderedIndex)
    if (!placement) return
    const existing = nodesByComponent.get(placement.componentId)
    if (existing) {
      existing.push(node)
      return
    }
    nodesByComponent.set(placement.componentId, [node])
  })

  let overflowInfeasible = columnPlan.overflowInfeasible
  nodesByComponent.forEach((componentNodes) => {
    if (componentNodes.length <= 1) return
    const columnNodes = new Map<number, AccidentalColumnNode[]>()
    componentNodes.forEach((node) => {
      const placement = columnPlan.placementByRenderedIndex.get(node.renderedIndex)
      if (!placement) return
      const existing = columnNodes.get(placement.columnIndex)
      if (existing) {
        existing.push(node)
        return
      }
      columnNodes.set(placement.columnIndex, [node])
    })
    const orderedColumns = [...columnNodes.keys()].sort((left, right) => left - right)
    if (orderedColumns.length <= 1) return

    const columnLeftByIndex = new Map<number, number>()
    const hardInfeasibleColumns = new Set<number>()
    for (let orderIndex = orderedColumns.length - 1; orderIndex >= 0; orderIndex -= 1) {
      const columnIndex = orderedColumns[orderIndex]!
      const members = columnNodes.get(columnIndex) ?? []
      const columnWidth = members.reduce((maxValue, member) => Math.max(maxValue, member.width), 0)
      const fallbackColumnMaxLeft = members.reduce(
        (minValue, member) => Math.min(minValue, member.baseLeftX),
        Number.POSITIVE_INFINITY,
      )
      const columnMaxLeftRaw = members.reduce((minValue, member) => {
        const boundedMaxLeft =
          typeof member.maxLeftX === 'number' && Number.isFinite(member.maxLeftX)
            ? member.maxLeftX
            : member.baseLeftX
        return Math.min(minValue, boundedMaxLeft)
      }, Number.POSITIVE_INFINITY)
      const columnMaxLeft = Number.isFinite(columnMaxLeftRaw) ? columnMaxLeftRaw : fallbackColumnMaxLeft
      const columnMinLeft = members.reduce((maxValue, member) => {
        if (typeof member.minLeftX !== 'number' || !Number.isFinite(member.minLeftX)) return maxValue
        return Math.max(maxValue, member.minLeftX)
      }, Number.NEGATIVE_INFINITY)
      const rightNeighborColumnIndex = orderIndex < orderedColumns.length - 1 ? orderedColumns[orderIndex + 1] : null
      const rightNeighborLeftX =
        typeof rightNeighborColumnIndex === 'number' ? columnLeftByIndex.get(rightNeighborColumnIndex) : undefined
      const rightConstraint =
        typeof rightNeighborLeftX === 'number' && Number.isFinite(rightNeighborLeftX)
          ? rightNeighborLeftX - columnWidth - ACCIDENTAL_COLUMN_SAFE_GAP_PX
          : Number.POSITIVE_INFINITY
      const maxAllowedLeftX = Math.min(columnMaxLeft, rightConstraint)
      let resolvedLeftX = maxAllowedLeftX
      if (
        typeof columnMinLeft === 'number' &&
        Number.isFinite(columnMinLeft) &&
        maxAllowedLeftX < columnMinLeft - ACCIDENTAL_TARGET_EPSILON_PX
      ) {
        resolvedLeftX = maxAllowedLeftX
        hardInfeasibleColumns.add(columnIndex)
        overflowInfeasible = true
      }
      if (!Number.isFinite(resolvedLeftX)) {
        resolvedLeftX = Number.isFinite(columnMaxLeft) ? columnMaxLeft : fallbackColumnMaxLeft
        if (!Number.isFinite(resolvedLeftX)) {
          overflowInfeasible = true
          hardInfeasibleColumns.add(columnIndex)
        }
      }
      columnLeftByIndex.set(columnIndex, resolvedLeftX)
    }

    for (let orderIndex = 0; orderIndex < orderedColumns.length - 1; orderIndex += 1) {
      const leftColumnIndex = orderedColumns[orderIndex]!
      const rightColumnIndex = orderedColumns[orderIndex + 1]!
      const leftMembers = columnNodes.get(leftColumnIndex) ?? []
      const leftWidth = leftMembers.reduce((maxValue, member) => Math.max(maxValue, member.width), 0)
      const leftColumnLeftX = columnLeftByIndex.get(leftColumnIndex)
      const rightColumnLeftX = columnLeftByIndex.get(rightColumnIndex)
      if (
        typeof leftColumnLeftX !== 'number' ||
        !Number.isFinite(leftColumnLeftX) ||
        typeof rightColumnLeftX !== 'number' ||
        !Number.isFinite(rightColumnLeftX)
      ) {
        continue
      }
      if (leftColumnLeftX + leftWidth + ACCIDENTAL_COLUMN_SAFE_GAP_PX > rightColumnLeftX + ACCIDENTAL_TARGET_EPSILON_PX) {
        overflowInfeasible = true
        hardInfeasibleColumns.add(leftColumnIndex)
        hardInfeasibleColumns.add(rightColumnIndex)
      }
    }

    orderedColumns.forEach((columnIndex) => {
      const columnLeftX = columnLeftByIndex.get(columnIndex)
      if (typeof columnLeftX !== 'number' || !Number.isFinite(columnLeftX)) {
        overflowInfeasible = true
        return
      }
      const members = columnNodes.get(columnIndex) ?? []
      const columnMinLeft = members.reduce((maxValue, member) => {
        if (typeof member.minLeftX !== 'number' || !Number.isFinite(member.minLeftX)) return maxValue
        return Math.max(maxValue, member.minLeftX)
      }, Number.NEGATIVE_INFINITY)
      const columnMaxLeft = members.reduce((minValue, member) => {
        const boundedMaxLeft =
          typeof member.maxLeftX === 'number' && Number.isFinite(member.maxLeftX)
            ? member.maxLeftX
            : member.baseLeftX
        return Math.min(minValue, boundedMaxLeft)
      }, Number.POSITIVE_INFINITY)
      if (Number.isFinite(columnMinLeft) && columnLeftX < columnMinLeft - ACCIDENTAL_TARGET_EPSILON_PX) {
        hardInfeasibleColumns.add(columnIndex)
        overflowInfeasible = true
      }
      if (Number.isFinite(columnMaxLeft) && columnLeftX > columnMaxLeft + ACCIDENTAL_TARGET_EPSILON_PX) {
        overflowInfeasible = true
        hardInfeasibleColumns.add(columnIndex)
      }
    })

    componentNodes.forEach((node) => {
      const placement = columnPlan.placementByRenderedIndex.get(node.renderedIndex)
      if (!placement) return
      const resolvedLeftX = columnLeftByIndex.get(placement.columnIndex)
      if (typeof resolvedLeftX !== 'number' || !Number.isFinite(resolvedLeftX)) return
      targetLeftByRenderedIndex.set(node.renderedIndex, resolvedLeftX)
      if (hardInfeasibleColumns.has(placement.columnIndex)) {
        hardInfeasibleByRenderedIndex.set(node.renderedIndex, true)
      }
    })
  })

  return {
    targetLeftByRenderedIndex,
    overflowInfeasible,
    hardInfeasibleByRenderedIndex,
  }
}

function resolveNoteHeadGeometry(params: {
  vexNote: StaveNote
  renderedIndex: number
  headX: number
  headY: number
}): NoteHeadGeometry {
  const { vexNote, renderedIndex, headX, headY } = params
  const fallbackCenterX = headX + 6
  const fallbackCenterY = headY
  let centerX = fallbackCenterX
  let centerY = fallbackCenterY
  let radiusX = DEFAULT_NOTE_HEAD_HIT_RADIUS_X
  let radiusY = DEFAULT_NOTE_HEAD_HIT_RADIUS_Y
  let boxX = centerX - radiusX
  let boxY = centerY - radiusY
  let boxWidth = radiusX * 2
  let boxHeight = radiusY * 2

  const bbox = getRenderedNoteHead(vexNote, renderedIndex)?.getBoundingBox?.() ?? null
  if (bbox) {
    const x = bbox.getX()
    const y = bbox.getY()
    const w = bbox.getW()
    const h = bbox.getH()
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      centerX = x + w / 2
      centerY = y + h / 2
      radiusX = Math.max(2, w / 2)
      radiusY = Math.max(2, h / 2)
      boxX = x
      boxY = y
      boxWidth = w
      boxHeight = h
    }
  }

  return {
    centerX,
    centerY,
    radiusX,
    radiusY,
    boxX,
    boxY,
    boxWidth,
    boxHeight,
  }
}

function parseCssColorToRgb(color: string | undefined): { r: number; g: number; b: number } | null {
  if (!color) return null
  const trimmed = color.trim()
  const shortHexMatch = /^#([\da-f]{3,4})$/i.exec(trimmed)
  if (shortHexMatch) {
    const [r, g, b] = shortHexMatch[1].split('').map((entry) => Number.parseInt(entry + entry, 16))
    return { r, g, b }
  }
  const longHexMatch = /^#([\da-f]{6})(?:[\da-f]{2})?$/i.exec(trimmed)
  if (longHexMatch) {
    const value = longHexMatch[1]
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
    }
  }
  const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(trimmed)
  if (!rgbMatch) return null
  const channels = rgbMatch[1].split(',').map((entry) => Number.parseFloat(entry.trim()))
  const [r, g, b] = channels
  if (![r, g, b].every((entry) => Number.isFinite(entry))) return null
  return {
    r: Math.min(255, Math.max(0, r)),
    g: Math.min(255, Math.max(0, g)),
    b: Math.min(255, Math.max(0, b)),
  }
}

function getRelativeLuminance(color: { r: number; g: number; b: number }): number {
  const normalize = (channel: number) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * normalize(color.r) + 0.7152 * normalize(color.g) + 0.0722 * normalize(color.b)
}

function resolveNoteHeadNumeralColor(params: {
  isFilled: boolean
  noteHeadStyle: { fillStyle?: string; strokeStyle?: string } | null | undefined
}): string {
  const { isFilled, noteHeadStyle } = params
  const primaryColor =
    noteHeadStyle?.fillStyle ?? noteHeadStyle?.strokeStyle ?? NOTEHEAD_NUMERAL_DEFAULT_COLOR
  if (!isFilled) {
    return noteHeadStyle?.strokeStyle ?? primaryColor
  }
  const parsed = parseCssColorToRgb(primaryColor)
  if (!parsed) return NOTEHEAD_NUMERAL_LIGHT_COLOR
  return getRelativeLuminance(parsed) >= 0.58 ? NOTEHEAD_NUMERAL_DEFAULT_COLOR : NOTEHEAD_NUMERAL_LIGHT_COLOR
}

function toMeasuredNumeralMetrics(metrics: TextMetrics, fontSizePx: number): MeasuredNumeralMetrics {
  const left =
    Number.isFinite(metrics.actualBoundingBoxLeft) && metrics.actualBoundingBoxLeft >= 0
      ? metrics.actualBoundingBoxLeft
      : metrics.width / 2
  const right =
    Number.isFinite(metrics.actualBoundingBoxRight) && metrics.actualBoundingBoxRight >= 0
      ? metrics.actualBoundingBoxRight
      : Math.max(metrics.width - left, metrics.width / 2)
  const ascent =
    Number.isFinite(metrics.actualBoundingBoxAscent) && metrics.actualBoundingBoxAscent > 0
      ? metrics.actualBoundingBoxAscent
      : fontSizePx * 0.72
  const descent =
    Number.isFinite(metrics.actualBoundingBoxDescent) && metrics.actualBoundingBoxDescent >= 0
      ? metrics.actualBoundingBoxDescent
      : fontSizePx * 0.18
  const height = ascent + descent
  return {
    left,
    right,
    ascent,
    descent,
    height,
    baselineOffsetY: (ascent - descent) / 2,
  }
}

function doesNumeralFitEllipse(params: {
  metrics: MeasuredNumeralMetrics
  radiusX: number
  radiusY: number
}): boolean {
  const { metrics, radiusX, radiusY } = params
  if (!Number.isFinite(radiusX) || !Number.isFinite(radiusY) || radiusX <= 0 || radiusY <= 0) return false
  const top = -metrics.height / 2
  const bottom = metrics.height / 2
  const samples: Array<[number, number]> = [
    [-metrics.left, 0],
    [metrics.right, 0],
    [0, top],
    [0, bottom],
    [-metrics.left * 0.82, top * 0.72],
    [metrics.right * 0.82, top * 0.72],
    [-metrics.left * 0.82, bottom * 0.72],
    [metrics.right * 0.82, bottom * 0.72],
  ]
  return samples.every(([sampleX, sampleY]) => {
    const ellipseRatio = (sampleX * sampleX) / (radiusX * radiusX) + (sampleY * sampleY) / (radiusY * radiusY)
    return ellipseRatio <= 1
  })
}

function resolveNoteHeadNumeralLayout(params: {
  context2D: CanvasRenderingContext2D
  numeral: string
  radiusX: number
  radiusY: number
}): { fontSizePx: number; metrics: MeasuredNumeralMetrics; clipRadiusX: number; clipRadiusY: number } | null {
  const { context2D, numeral, radiusX, radiusY } = params
  const clipRadiusX = Math.max(1.35, radiusX - NOTEHEAD_NUMERAL_CLIP_INSET_X_PX)
  const clipRadiusY = Math.max(1.1, radiusY - NOTEHEAD_NUMERAL_CLIP_INSET_Y_PX)
  if (clipRadiusX <= 0 || clipRadiusY <= 0) return null
  const maxFontSizePx = Math.min(
    NOTEHEAD_NUMERAL_MAX_FONT_PX,
    Math.max(NOTEHEAD_NUMERAL_MIN_FONT_PX, Math.min(clipRadiusX * 2.25, clipRadiusY * 2.5)),
  )
  for (let fontSizePx = maxFontSizePx; fontSizePx >= NOTEHEAD_NUMERAL_MIN_FONT_PX; fontSizePx -= 0.1) {
    context2D.font = `${NOTEHEAD_NUMERAL_FONT_WEIGHT} ${fontSizePx}px ${NOTEHEAD_NUMERAL_FONT_FAMILY}`
    const measured = toMeasuredNumeralMetrics(context2D.measureText(numeral), fontSizePx)
    if (
      doesNumeralFitEllipse({
        metrics: measured,
        radiusX: clipRadiusX,
        radiusY: clipRadiusY,
      })
    ) {
      return {
        fontSizePx,
        metrics: measured,
        clipRadiusX,
        clipRadiusY,
      }
    }
  }
  return null
}

function buildNoteHeadHitGeometry(params: {
  vexNote: StaveNote
  renderedIndex: number
  headX: number
  headY: number
}): NoteHeadHitGeometry {
  const { centerX, centerY, radiusX, radiusY } = resolveNoteHeadGeometry(params)

  return {
    hitCenterX: centerX,
    hitCenterY: centerY,
    hitRadiusX: radiusX,
    hitRadiusY: radiusY,
    hitMinX: centerX - radiusX,
    hitMaxX: centerX + radiusX,
    hitMinY: centerY - radiusY,
    hitMaxY: centerY + radiusY,
  }
}

function buildAccidentalHitGeometry(params: {
  centerX: number
  centerY: number
  width: number
}): AccidentalHitGeometry {
  const { centerX, centerY, width } = params
  const radiusX = Math.max(2, width / 2)
  const radiusY = Math.max(DEFAULT_ACCIDENTAL_HIT_RADIUS_Y, radiusX + 1)
  return {
    hitCenterX: centerX,
    hitCenterY: centerY,
    hitRadiusX: radiusX,
    hitRadiusY: radiusY,
    hitMinX: centerX - radiusX,
    hitMaxX: centerX + radiusX,
    hitMinY: centerY - radiusY,
    hitMaxY: centerY + radiusY,
  }
}

type PreviewNoteOverride = {
  noteId: string
  staff: StaffKind
  pitch: Pitch
  keyIndex: number
}

type RenderedMeasureNote = {
  vexNote: StaveNote
  renderedKeys: RenderedNoteKey[]
  sourceNoteIndex: number
}

type AccidentalLockState = {
  targetRightX: number | null
  applied: boolean
  reason: string
  previousOccupiedRightX?: number | null
  previousGapMeasured?: number | null
  columnIndex?: number | null
  columnBaseLeftX?: number | null
  columnTargetLeftX?: number | null
  columnAppliedDeltaX?: number | null
  columnCountMeasured?: number | null
  leftMostMeasured?: number | null
}

type AccidentalAlignPassResult = {
  maxLeftShiftPx: number
  hardConstraintViolationCount: number
  requiresSpacingReflow: boolean
}

function drawRenderedNoteHeadNumerals(params: {
  context2D: CanvasRenderingContext2D
  sourceNotes: ScoreNote[]
  rendered: RenderedMeasureNote[]
}): void {
  const { context2D, sourceNotes, rendered } = params
  rendered.forEach((renderedEntry) => {
    const sourceNote = sourceNotes[renderedEntry.sourceNoteIndex]
    if (!sourceNote || sourceNote.isRest) return
    const isFilled = hasFilledNoteHead(sourceNote.duration)
    const ys = renderedEntry.vexNote.getYs()
    renderedEntry.renderedKeys.forEach((entry, renderedIndex) => {
      const numeral = getJianpuNumeralForPitch(entry.pitch)
      if (!numeral) return
      const headX = renderedEntry.vexNote.noteHeads[renderedIndex]?.getAbsoluteX() ?? getRenderedNoteVisualX(renderedEntry.vexNote)
      const headY = ys[renderedIndex] ?? ys[0]
      if (!Number.isFinite(headX) || !Number.isFinite(headY)) return
      const geometry = resolveNoteHeadGeometry({
        vexNote: renderedEntry.vexNote,
        renderedIndex,
        headX,
        headY,
      })
      const numeralLayout = resolveNoteHeadNumeralLayout({
        context2D,
        numeral,
        radiusX: geometry.radiusX,
        radiusY: geometry.radiusY,
      })
      if (!numeralLayout) return
      const noteHeadStyle = getRenderedNoteHead(renderedEntry.vexNote, renderedIndex)?.getStyle?.() ?? null
      const fillStyle = resolveNoteHeadNumeralColor({
        isFilled,
        noteHeadStyle,
      })

      context2D.save()
      context2D.beginPath()
      context2D.ellipse(
        geometry.centerX,
        geometry.centerY,
        numeralLayout.clipRadiusX,
        numeralLayout.clipRadiusY,
        0,
        0,
        Math.PI * 2,
      )
      context2D.clip()
      context2D.fillStyle = fillStyle
      context2D.font = `${NOTEHEAD_NUMERAL_FONT_WEIGHT} ${numeralLayout.fontSizePx}px ${NOTEHEAD_NUMERAL_FONT_FAMILY}`
      context2D.textAlign = 'center'
      context2D.textBaseline = 'alphabetic'
      context2D.fillText(
        numeral,
        geometry.centerX,
        geometry.centerY + numeralLayout.metrics.baselineOffsetY,
      )
      context2D.restore()
    })
  })
}

export type DrawMeasureParams = {
  context: ReturnType<Renderer['getContext']>
  measure: MeasurePair
  pairIndex: number
  measureX: number
  measureWidth: number
  trebleY: number
  bassY: number
  isSystemStart: boolean
  keyFifths: number
  showKeySignature: boolean
  timeSignature: TimeSignature
  showTimeSignature: boolean
  endTimeSignature?: TimeSignature | null
  showEndTimeSignature?: boolean
  activeSelection: Selection | null
  activeAccidentalSelection?: Selection | null
  activeTieSegmentKey?: string | null
  draggingSelection: Selection | null
  activeSelections?: Selection[] | null
  draggingSelections?: Selection[] | null
  highlightStaff?: StaffKind | null
  previewNotes?: PreviewNoteOverride[] | null
  previewNote?: { noteId: string; staff: StaffKind; pitch: Pitch; keyIndex: number } | null
  previewAccidentalStateBeforeNote?: Map<string, number> | null
  previewFrozenBoundaryCurve?: {
    fromPairIndex: number
    fromStaff: StaffKind
    fromNoteId: string
    fromKeyIndex: number
    toPairIndex: number
    toStaff: StaffKind
    toNoteId: string
    toKeyIndex: number
    startX: number
    startY: number
    endX: number
    endY: number
  } | null
  suppressedTieStartKeys?: Set<string> | null
  suppressedTieStopKeys?: Set<string> | null
  collectLayouts?: boolean
  suppressSystemDecorations?: boolean
  noteStartXOverride?: number
  freezePreviewAccidentalLayout?: boolean
  formatWidthOverride?: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
  layoutDetail?: 'full' | 'spacing-only'
  skipPainting?: boolean
  showMeasureNumberLabel?: boolean
  showNoteHeadJianpu?: boolean
  allowTrebleFullMeasureRestCollapse?: boolean
  allowBassFullMeasureRestCollapse?: boolean
  staticAnchorXById?: Map<string, number> | null
  staticAccidentalRightXById?: Map<string, Map<number, number>> | null
  publicAxisLayout?: PublicAxisLayout | null
  timelineBundle?: MeasureTimelineBundle | null
  spacingAnchorTicks?: number[] | null
  preferMeasureBarlineAxis?: boolean
  preferMeasureEndBarlineAxis?: boolean
  enableEdgeGapCap?: boolean
  onSpacingMetrics?: (metrics: AppliedTimeAxisSpacingMetrics | null) => void
  debugCapture?: {
    frame: number
    draggedNoteId: string
    draggedStaff: StaffKind
    staticByNoteKey: Map<string, DragDebugStaticRecord>
    pushSnapshot: (snapshot: DragDebugSnapshot) => void
  } | null
  renderBoundaryPartialTies?: boolean
  forceLeadingConnector?: boolean
  onStaffLineBounds?: (bounds: {
    trebleLineTopY: number
    trebleLineBottomY: number
    bassLineTopY: number
    bassLineBottomY: number
  }) => void
}

export const drawMeasureToContext = (params: DrawMeasureParams): NoteLayout[] => {
  const {
    context,
    measure,
    pairIndex,
    measureX,
    measureWidth,
    trebleY,
    bassY,
    isSystemStart,
    keyFifths,
    showKeySignature,
    timeSignature,
    showTimeSignature,
    endTimeSignature = null,
    showEndTimeSignature = false,
    activeSelection: selection,
    activeAccidentalSelection = null,
    activeTieSegmentKey = null,
    draggingSelection: dragging,
    activeSelections = null,
    draggingSelections = null,
    highlightStaff = null,
    previewNotes = null,
    previewNote = null,
    previewAccidentalStateBeforeNote = null,
    previewFrozenBoundaryCurve = null,
    suppressedTieStartKeys = null,
    suppressedTieStopKeys = null,
    collectLayouts = true,
    suppressSystemDecorations = false,
    noteStartXOverride,
    freezePreviewAccidentalLayout = false,
    formatWidthOverride,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
    layoutDetail = 'full',
    skipPainting = false,
    showMeasureNumberLabel = true,
    showNoteHeadJianpu = false,
    allowTrebleFullMeasureRestCollapse = false,
    allowBassFullMeasureRestCollapse = false,
    staticAnchorXById = null,
    staticAccidentalRightXById = null,
    publicAxisLayout = null,
    timelineBundle = null,
    spacingAnchorTicks = null,
    preferMeasureBarlineAxis = !isSystemStart && !showKeySignature && !showTimeSignature,
    preferMeasureEndBarlineAxis = !showEndTimeSignature,
    enableEdgeGapCap = true,
    onSpacingMetrics,
    debugCapture = null,
    renderBoundaryPartialTies = true,
    forceLeadingConnector = false,
    onStaffLineBounds,
  } = params
  const isSpacingOnlyLayout = layoutDetail === 'spacing-only'
  const noteLayouts: NoteLayout[] = []
  const timeSignatureLabel = `${timeSignature.beats}/${timeSignature.beatType}`
  const endTimeSignatureLabel =
    showEndTimeSignature && endTimeSignature ? `${endTimeSignature.beats}/${endTimeSignature.beatType}` : null
  const normalizedPreviewNotes = previewNotes ?? (previewNote ? [previewNote] : [])
  const previewNoteByLayoutKey = new Map<string, Map<number, PreviewNoteOverride>>()
  normalizedPreviewNotes.forEach((entry) => {
    const layoutKey = getLayoutNoteKey(entry.staff, entry.noteId)
    const existing = previewNoteByLayoutKey.get(layoutKey)
    if (existing) {
      existing.set(entry.keyIndex, entry)
      return
    }
    previewNoteByLayoutKey.set(layoutKey, new Map([[entry.keyIndex, entry]]))
  })
  const selectionEntries: Selection[] = selection ? [selection] : []
  const draggingEntries: Selection[] = dragging ? [dragging] : []
  activeSelections?.forEach((entry) => selectionEntries.push(entry))
  draggingSelections?.forEach((entry) => draggingEntries.push(entry))
  const selectionKeySetByLayout = new Map<string, Set<number>>()
  const draggingKeySetByLayout = new Map<string, Set<number>>()
  const appendSelectionKey = (
    store: Map<string, Set<number>>,
    selectionEntry: Selection,
  ) => {
    const key = getLayoutNoteKey(selectionEntry.staff, selectionEntry.noteId)
    const current = store.get(key)
    if (current) {
      current.add(selectionEntry.keyIndex)
      return
    }
    store.set(key, new Set([selectionEntry.keyIndex]))
  }
  selectionEntries.forEach((entry) => appendSelectionKey(selectionKeySetByLayout, entry))
  draggingEntries.forEach((entry) => appendSelectionKey(draggingKeySetByLayout, entry))
  const inMeasureTieLayoutsByLayoutKey = new Map<string, TieLayout[]>()
  const appendInMeasureTieLayout = (layoutKey: string, tieLayout: TieLayout) => {
    const existing = inMeasureTieLayoutsByLayoutKey.get(layoutKey)
    if (existing) {
      if (!existing.some((entry) => entry.key === tieLayout.key)) {
        existing.push(tieLayout)
      }
      return
    }
    inMeasureTieLayoutsByLayoutKey.set(layoutKey, [tieLayout])
  }
  const lockPreviewAccidentalLayout = freezePreviewAccidentalLayout && normalizedPreviewNotes.length > 0
  const previewAccidentalByRowKey = new Map<string, number>()
  const accidentalLockByRowKey = new Map<string, AccidentalLockState>()

  const resolveRenderedNoteData = (
    note: ScoreNote,
    staff: StaffKind,
  ): { rootPitch: Pitch; chordPitches?: Pitch[]; previewedKeyIndices: Set<number>; isRest: boolean } => {
    if (note.isRest) {
      return {
        rootPitch: getRestAnchorPitch(staff),
        chordPitches: undefined,
        previewedKeyIndices: new Set(),
        isRest: true,
      }
    }

    const previewEntries = previewNoteByLayoutKey.get(getLayoutNoteKey(staff, note.id))
    if (!previewEntries || previewEntries.size === 0) {
      return {
        rootPitch: note.pitch,
        chordPitches: note.chordPitches,
        previewedKeyIndices: new Set(),
        isRest: false,
      }
    }

    let rootPitch = note.pitch
    let chordPitches = note.chordPitches
    const previewedKeyIndices = new Set<number>()
    previewEntries.forEach((previewEntry, keyIndex) => {
      if (keyIndex <= 0) {
        rootPitch = previewEntry.pitch
        previewedKeyIndices.add(0)
        return
      }

      const chordIndex = keyIndex - 1
      const sourceChordPitches = note.chordPitches
      if (!sourceChordPitches || chordIndex < 0 || chordIndex >= sourceChordPitches.length) {
        return
      }

      const nextChordPitches =
        chordPitches === note.chordPitches || !chordPitches ? sourceChordPitches.slice() : chordPitches
      nextChordPitches[chordIndex] = previewEntry.pitch
      chordPitches = nextChordPitches
      previewedKeyIndices.add(keyIndex)
    })

    return { rootPitch, chordPitches, previewedKeyIndices, isRest: false }
  }

  const buildPreviewAccidentalOverridesForStaff = (
    notes: ScoreNote[],
    staff: StaffKind,
  ): Map<string, Map<number, string | null>> | null => {
    if (previewNoteByLayoutKey.size === 0 || lockPreviewAccidentalLayout) return null

    const state = new Map<string, number>()
    const overrides = new Map<string, Map<number, string | null>>()
    notes.forEach((note) => {
      const rendered = resolveRenderedNoteData(note, staff)
      if (rendered.isRest) {
        overrides.set(note.id, new Map([[0, null]]))
        return
      }
      const noteOverrides = new Map<number, string | null>()

      const rootParts = getStepOctaveAlterFromPitch(rendered.rootPitch)
      const rootExpectedAlter = getEffectiveAlterFromContext(rootParts.step, rootParts.octave, keyFifths, state)
      const rootAccidental = getRequiredAccidentalForTargetAlter(rootParts.alter, rootExpectedAlter)
      noteOverrides.set(0, rootAccidental)
      state.set(getAccidentalStateKey(rootParts.step, rootParts.octave), rootParts.alter)

      rendered.chordPitches?.forEach((chordPitch, chordIndex) => {
        const chordParts = getStepOctaveAlterFromPitch(chordPitch)
        const chordExpectedAlter = getEffectiveAlterFromContext(chordParts.step, chordParts.octave, keyFifths, state)
        const chordAccidental = getRequiredAccidentalForTargetAlter(chordParts.alter, chordExpectedAlter)
        noteOverrides.set(chordIndex + 1, chordAccidental)
        state.set(getAccidentalStateKey(chordParts.step, chordParts.octave), chordParts.alter)
      })

      overrides.set(note.id, noteOverrides)
    })

    return overrides
  }

  const treblePreviewAccidentalOverrides = buildPreviewAccidentalOverridesForStaff(measure.treble, 'treble')
  const bassPreviewAccidentalOverrides = buildPreviewAccidentalOverridesForStaff(measure.bass, 'bass')

  const trebleStave = new Stave(measureX, trebleY, measureWidth)
  const bassStave = new Stave(measureX, bassY, measureWidth)
  const resolveStaffLineBounds = () => {
    const rawTrebleTop = trebleStave.getYForLine(0)
    const rawTrebleBottom = trebleStave.getYForLine(4)
    const rawBassTop = bassStave.getYForLine(0)
    const rawBassBottom = bassStave.getYForLine(4)
    const trebleLineTopY = Number.isFinite(rawTrebleTop) ? rawTrebleTop : trebleY
    const trebleLineBottomY = Number.isFinite(rawTrebleBottom) ? rawTrebleBottom : trebleY + 40
    const bassLineTopY = Number.isFinite(rawBassTop) ? rawBassTop : bassY
    const bassLineBottomY = Number.isFinite(rawBassBottom) ? rawBassBottom : bassY + 40
    return {
      trebleLineTopY: Math.min(trebleLineTopY, trebleLineBottomY),
      trebleLineBottomY: Math.max(trebleLineTopY, trebleLineBottomY),
      bassLineTopY: Math.min(bassLineTopY, bassLineBottomY),
      bassLineBottomY: Math.max(bassLineTopY, bassLineBottomY),
    }
  }
  onStaffLineBounds?.(resolveStaffLineBounds())
  const setImplicitClefContext = (stave: Stave, clefSpec: 'treble' | 'bass') => {
    // Keep correct clef-dependent modifier placement on mid-system measures
    // without drawing an extra clef glyph.
    ;(stave as unknown as { clef: string }).clef = clefSpec
  }

  if (suppressSystemDecorations) {
    trebleStave.setBegBarType(BarlineType.NONE)
    bassStave.setBegBarType(BarlineType.NONE)
    if (!isSystemStart) {
      setImplicitClefContext(trebleStave, 'treble')
      setImplicitClefContext(bassStave, 'bass')
      if (showKeySignature) {
        const keySignature = getKeySignatureSpecFromFifths(keyFifths)
        trebleStave.addKeySignature(keySignature)
        bassStave.addKeySignature(keySignature)
      }
      if (showTimeSignature) {
        trebleStave.addTimeSignature(timeSignatureLabel)
        bassStave.addTimeSignature(timeSignatureLabel)
      }
    }
  } else if (isSystemStart) {
    trebleStave.addClef('treble')
    bassStave.addClef('bass')
    if (showKeySignature) {
      const keySignature = getKeySignatureSpecFromFifths(keyFifths)
      trebleStave.addKeySignature(keySignature)
      bassStave.addKeySignature(keySignature)
    }
    if (showTimeSignature) {
      trebleStave.addTimeSignature(timeSignatureLabel)
      bassStave.addTimeSignature(timeSignatureLabel)
    }
  } else {
    trebleStave.setBegBarType(BarlineType.NONE)
    bassStave.setBegBarType(BarlineType.NONE)
    setImplicitClefContext(trebleStave, 'treble')
    setImplicitClefContext(bassStave, 'bass')
    if (showKeySignature) {
      const keySignature = getKeySignatureSpecFromFifths(keyFifths)
      trebleStave.addKeySignature(keySignature)
      bassStave.addKeySignature(keySignature)
    }
    if (showTimeSignature) {
      trebleStave.addTimeSignature(timeSignatureLabel)
      bassStave.addTimeSignature(timeSignatureLabel)
    }
  }

  if (endTimeSignatureLabel) {
    trebleStave.setEndTimeSignature(endTimeSignatureLabel)
    bassStave.setEndTimeSignature(endTimeSignatureLabel)
  }

  if (typeof noteStartXOverride === 'number') {
    trebleStave.setNoteStartX(noteStartXOverride)
    bassStave.setNoteStartX(noteStartXOverride)
  }

  // In barline-axis mode (mid-system measure without start decorations),
  // remove VexFlow's implicit left note-start inset so edge-cap=0 can
  // truly touch the measure start boundary.
  if (
    typeof noteStartXOverride !== 'number' &&
    !suppressSystemDecorations &&
    preferMeasureBarlineAxis
  ) {
    trebleStave.setNoteStartX(measureX)
    bassStave.setNoteStartX(measureX)
  }

  if (!skipPainting) {
    trebleStave.setContext(context).draw()
    bassStave.setContext(context).draw()
  }

  if (!skipPainting && showMeasureNumberLabel) {
    const context2D = (context as unknown as { context2D?: CanvasRenderingContext2D }).context2D
    if (context2D) {
      context2D.save()
      context2D.fillStyle = '#111111'
      context2D.font = '14px "Times New Roman", serif'
      context2D.textAlign = 'center'
      context2D.textBaseline = 'bottom'
      const labelX = measureX
      const labelY = trebleY + 24
      context2D.fillText(String(pairIndex + 1), labelX, labelY)
      context2D.restore()
    }
  }

  if (!skipPainting) {
    if (!suppressSystemDecorations && isSystemStart) {
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.BRACE).setContext(context).draw()
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw()
    } else if (forceLeadingConnector) {
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw()
    }
    if (!showEndTimeSignature) {
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw()
    }
  }

  const trebleIsFullMeasureRest =
    allowTrebleFullMeasureRestCollapse &&
    isStaffFullMeasureRest(measure.treble, timeSignature)
  const bassIsFullMeasureRest =
    allowBassFullMeasureRestCollapse &&
    isStaffFullMeasureRest(measure.bass, timeSignature)

  const buildRenderedStaffNote = (params: {
    note: ScoreNote
    noteIndex: number
    staff: StaffKind
    previewAccidentalOverrides: Map<string, Map<number, string | null>> | null
    forceWholeMeasureRestGlyph: boolean
  }): RenderedMeasureNote => {
    const { note, noteIndex, staff, previewAccidentalOverrides, forceWholeMeasureRestGlyph } = params
    const rendered = resolveRenderedNoteData(note, staff)
    const renderedKeys: RenderedNoteKey[] = rendered.isRest
      ? [{ pitch: rendered.rootPitch, accidental: null, keyIndex: 0 }]
      : (() => {
          const forceAccidentalFromPitchKeyIndices =
            !lockPreviewAccidentalLayout && rendered.previewedKeyIndices.size > 0
              ? rendered.previewedKeyIndices
              : null
          return buildRenderedNoteKeys(
            note,
            staff,
            rendered.rootPitch,
            rendered.chordPitches,
            keyFifths,
            previewAccidentalStateBeforeNote,
            forceAccidentalFromPitchKeyIndices,
            previewAccidentalOverrides?.get(note.id) ?? null,
            getPitchLine,
          )
        })()

    const clef = staff === 'treble' ? 'treble' : 'bass'
    const vexNote = forceWholeMeasureRestGlyph
      ? new StaveNote({
          keys: ['r/4'],
          duration: 'wr',
          clef,
          line: 4,
          alignCenter: true,
          durationOverride: new Fraction(
            Math.max(1, Math.round(timeSignature.beats)),
            Math.max(1, Math.round(timeSignature.beatType)),
          ),
        })
      : (() => {
          const dots = getDurationDots(note.duration)
          const nextVexNote =
            staff === 'treble'
              ? new StaveNote({
                  keys: renderedKeys.map((entry) => entry.pitch),
                  duration: rendered.isRest ? `${toVexDuration(note.duration)}r` : toVexDuration(note.duration),
                  dots,
                  clef,
                  stemDirection: getStrictStemDirection(rendered.rootPitch),
                })
              : new StaveNote({
                  keys: renderedKeys.map((entry) => entry.pitch),
                  duration: rendered.isRest ? `${toVexDuration(note.duration)}r` : toVexDuration(note.duration),
                  dots,
                  clef,
                  autoStem: true,
                })
          if (!rendered.isRest) {
            renderedKeys.forEach((entry, keyIndex) => {
              if (!entry.accidental) return
              nextVexNote.addModifier(new Accidental(entry.accidental), keyIndex)
            })
          }
          if (dots > 0) {
            Dot.buildAndAttach([nextVexNote], { all: true })
          }
          return nextVexNote
        })()

    return {
      vexNote,
      renderedKeys,
      sourceNoteIndex: noteIndex,
    }
  }

  const buildRenderedStaffNotes = (
    staff: StaffKind,
    sourceNotes: ScoreNote[],
    previewAccidentalOverrides: Map<string, Map<number, string | null>> | null,
    fullMeasureRestMode: boolean,
  ): RenderedMeasureNote[] => {
    if (fullMeasureRestMode && sourceNotes[0]) {
      return [
        buildRenderedStaffNote({
          note: sourceNotes[0],
          noteIndex: 0,
          staff,
          previewAccidentalOverrides,
          forceWholeMeasureRestGlyph: true,
        }),
      ]
    }
    return sourceNotes.map((note, noteIndex) =>
      buildRenderedStaffNote({
        note,
        noteIndex,
        staff,
        previewAccidentalOverrides,
        forceWholeMeasureRestGlyph: false,
      }),
    )
  }

  const buildSourceNoteIndexByVexNote = (
    rendered: RenderedMeasureNote[],
  ): Map<StaveNote, number> => {
    const sourceNoteIndexByVexNote = new Map<StaveNote, number>()
    rendered.forEach(({ vexNote, sourceNoteIndex }) => {
      sourceNoteIndexByVexNote.set(vexNote, sourceNoteIndex)
    })
    return sourceNoteIndexByVexNote
  }

  const trebleRendered = buildRenderedStaffNotes(
    'treble',
    measure.treble,
    treblePreviewAccidentalOverrides,
    trebleIsFullMeasureRest,
  )
  const bassRendered = buildRenderedStaffNotes(
    'bass',
    measure.bass,
    bassPreviewAccidentalOverrides,
    bassIsFullMeasureRest,
  )

  const trebleVexNotes = trebleRendered.map((entry) => entry.vexNote)
  const bassVexNotes = bassRendered.map((entry) => entry.vexNote)
  trebleVexNotes.forEach((vexNote) => vexNote.setStave(trebleStave))
  bassVexNotes.forEach((vexNote) => vexNote.setStave(bassStave))
  const trebleRenderedBySourceIndex = new Map<number, RenderedMeasureNote>()
  const bassRenderedBySourceIndex = new Map<number, RenderedMeasureNote>()
  trebleRendered.forEach((entry) => {
    trebleRenderedBySourceIndex.set(entry.sourceNoteIndex, entry)
  })
  bassRendered.forEach((entry) => {
    bassRenderedBySourceIndex.set(entry.sourceNoteIndex, entry)
  })
  const trebleSourceNoteIndexByVexNote = buildSourceNoteIndexByVexNote(trebleRendered)
  const bassSourceNoteIndexByVexNote = buildSourceNoteIndexByVexNote(bassRendered)

  const selectionHighlightStyle = { fillStyle: '#2437E8', strokeStyle: '#2437E8' }
  const draggingHighlightStyle = { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' }

  if (highlightStaff === 'treble' || highlightStaff === 'bass') {
    if (highlightStaff === 'treble') {
      trebleVexNotes.forEach((vexNote) => vexNote.setStyle(selectionHighlightStyle))
    } else {
      bassVexNotes.forEach((vexNote) => vexNote.setStyle(selectionHighlightStyle))
    }
  }

  trebleRendered.forEach(({ vexNote, renderedKeys, sourceNoteIndex }) => {
    const sourceNote = measure.treble[sourceNoteIndex]
    if (!sourceNote) return
    const noteId = sourceNote.id
    const layoutKey = getLayoutNoteKey('treble', noteId)
    const draggingKeySet = draggingKeySetByLayout.get(layoutKey)
    const selectedKeySet = selectionKeySetByLayout.get(layoutKey)
    renderedKeys.forEach((entry, renderedIndex) => {
      if (draggingKeySet?.has(entry.keyIndex)) {
        vexNote.setKeyStyle(Math.max(0, renderedIndex), draggingHighlightStyle)
      } else if (selectedKeySet?.has(entry.keyIndex)) {
        vexNote.setKeyStyle(Math.max(0, renderedIndex), selectionHighlightStyle)
      }
    })
  })

  bassRendered.forEach(({ vexNote, renderedKeys, sourceNoteIndex }) => {
    const sourceNote = measure.bass[sourceNoteIndex]
    if (!sourceNote) return
    const noteId = sourceNote.id
    const layoutKey = getLayoutNoteKey('bass', noteId)
    const draggingKeySet = draggingKeySetByLayout.get(layoutKey)
    const selectedKeySet = selectionKeySetByLayout.get(layoutKey)
    renderedKeys.forEach((entry, renderedIndex) => {
      if (draggingKeySet?.has(entry.keyIndex)) {
        vexNote.setKeyStyle(Math.max(0, renderedIndex), draggingHighlightStyle)
      } else if (selectedKeySet?.has(entry.keyIndex)) {
        vexNote.setKeyStyle(Math.max(0, renderedIndex), selectionHighlightStyle)
      }
    })
  })

  if (activeAccidentalSelection) {
    const applyAccidentalHighlight = (
      staff: StaffKind,
      sourceNotes: ScoreNote[],
      renderedBySourceIndex: Map<number, RenderedMeasureNote>,
    ) => {
      if (activeAccidentalSelection.staff !== staff) return
      sourceNotes.forEach((sourceNote, noteIndex) => {
        if (sourceNote.id !== activeAccidentalSelection.noteId) return
        const renderedEntry = renderedBySourceIndex.get(noteIndex)
        if (!renderedEntry) return
        const renderedIndex = renderedEntry.renderedKeys.findIndex(
          (entry) => entry.keyIndex === activeAccidentalSelection.keyIndex,
        )
        if (renderedIndex < 0) return
        const targetRenderedKey = renderedEntry.renderedKeys[renderedIndex]
        if (!targetRenderedKey) return
        const accidentalModifiers = renderedEntry.vexNote
          .getModifiersByType(Accidental.CATEGORY)
          .map((modifier) => modifier as Accidental)
        const { modifier: accidentalModifier } = resolveAccidentalModifierForRenderedKey({
          accidentalModifiers,
          renderedKeys: renderedEntry.renderedKeys,
          renderedKey: targetRenderedKey,
          fallbackRenderedIndex: renderedIndex,
        })
        accidentalModifier?.setStyle(selectionHighlightStyle)
      })
    }
    applyAccidentalHighlight('treble', measure.treble, trebleRenderedBySourceIndex)
    applyAccidentalHighlight('bass', measure.bass, bassRenderedBySourceIndex)
  }

  const trebleVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(trebleVexNotes)
  const bassVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(bassVexNotes)
  const formatWidth =
    typeof formatWidthOverride === 'number' && Number.isFinite(formatWidthOverride)
      ? Math.max(MIN_FORMAT_WIDTH_PX, formatWidthOverride)
      : Math.max(MIN_FORMAT_WIDTH_PX, trebleStave.getNoteEndX() - trebleStave.getNoteStartX() - 8)

  new Formatter().joinVoices([trebleVoice]).joinVoices([bassVoice]).format([trebleVoice, bassVoice], formatWidth)
  // Beam generation can flip stem direction, which rebuilds noteheads and changes
  // the displaced column side for second-interval chords. Build beams before custom
  // spacing so reserve detection sees the same geometry that will actually render.
  const trebleBeams: Beam[] = Beam.generateBeams(trebleVexNotes, {
    groups: [new Fraction(1, 4)],
  })
  const bassBeams: Beam[] = Beam.generateBeams(bassVexNotes, {
    groups: [new Fraction(1, 4)],
  })

  // Beam generation may rebuild notehead internals; rebind stave/context so
  // pre-draw accidental alignment reads stable notehead geometry.
  trebleVexNotes.forEach((vexNote) => {
    vexNote.setStave(trebleStave)
    vexNote.setContext(context)
  })
  bassVexNotes.forEach((vexNote) => {
    vexNote.setStave(bassStave)
    vexNote.setContext(context)
  })

  const resolveBeamHighlightStyle = (params: {
    beam: Beam
    staff: StaffKind
    sourceNotes: ScoreNote[]
    sourceNoteIndexByVexNote: Map<StaveNote, number>
  }): { fillStyle: string; strokeStyle: string } | null => {
    const { beam, staff, sourceNotes, sourceNoteIndexByVexNote } = params
    let hasSelectedNote = highlightStaff === staff
    let hasDraggingNote = false

    beam.getNotes().forEach((note) => {
      const sourceNoteIndex = sourceNoteIndexByVexNote.get(note as StaveNote)
      if (sourceNoteIndex === undefined) return
      const sourceNote = sourceNotes[sourceNoteIndex]
      if (!sourceNote) return
      const layoutKey = getLayoutNoteKey(staff, sourceNote.id)
      if ((draggingKeySetByLayout.get(layoutKey)?.size ?? 0) > 0) {
        hasDraggingNote = true
        return
      }
      if ((selectionKeySetByLayout.get(layoutKey)?.size ?? 0) > 0) {
        hasSelectedNote = true
      }
    })

    if (hasDraggingNote) return draggingHighlightStyle
    if (hasSelectedNote) return selectionHighlightStyle
    return null
  }

  if (spacingLayoutMode === 'custom') {
    alignRenderedAccidentalOffset('treble', measure.treble, trebleRenderedBySourceIndex, {
      captureLockState: false,
    })
    alignRenderedAccidentalOffset('bass', measure.bass, bassRenderedBySourceIndex, {
      captureLockState: false,
    })
  }

  const applyTimeAxisSpacingPass = (): AppliedTimeAxisSpacingMetrics | null =>
    applyUnifiedTimeAxisSpacing({
      measure,
      noteStartX: trebleStave.getNoteStartX(),
      formatWidth,
      trebleRendered,
      bassRendered,
      timelineBundle,
      spacingConfig: timeAxisSpacingConfig,
      measureTicks: Math.max(1, Math.round(timeSignature.beats * TICKS_PER_BEAT * (4 / timeSignature.beatType))),
      sparseTailAnchorMode: 'none',
      compactTailAnchorTicks: 4,
      uniformSpacingByTicks: true,
      measureStartBarX: measureX,
      measureEndBarX: measureX + measureWidth,
      publicAxisLayout,
      spacingAnchorTicks,
      preferMeasureBarlineAxis,
      preferMeasureEndBarlineAxis,
      enableEdgeGapCap,
    })

  let appliedSpacingMetrics: AppliedTimeAxisSpacingMetrics | null = null
  if (spacingLayoutMode === 'custom') {
    appliedSpacingMetrics = applyTimeAxisSpacingPass()
  }

  if (staticAnchorXById && staticAnchorXById.size > 0) {
    const alignRenderedAnchorX = (
      staff: StaffKind,
      sourceNotes: ScoreNote[],
      rendered: { vexNote: StaveNote }[],
    ) => {
      sourceNotes.forEach((sourceNote, noteIndex) => {
        const targetX = staticAnchorXById.get(getLayoutNoteKey(staff, sourceNote.id))
        const vexNote = rendered[noteIndex]?.vexNote
        if (targetX === undefined || !vexNote) return
        const currentX = getRenderedNoteAnchorX(vexNote)
        if (!Number.isFinite(currentX)) return
        const delta = targetX - currentX
        if (Math.abs(delta) < 0.001) return
        vexNote.setXShift(vexNote.getXShift() + delta)
      })
    }

    alignRenderedAnchorX('treble', measure.treble, trebleRendered)
    alignRenderedAnchorX('bass', measure.bass, bassRendered)
  }

  const alignRenderedRestToMeasureCenter = (staff: StaffKind, entry: RenderedMeasureNote | undefined) => {
    if (!entry) return
    const targetStave = staff === 'treble' ? trebleStave : bassStave
    const targetX = targetStave.getX() + targetStave.getWidth() / 2
    const headBeginX = entry.vexNote.getNoteHeadBeginX()
    const headEndX = entry.vexNote.getNoteHeadEndX()
    const centerFromHeads =
      Number.isFinite(headBeginX) && Number.isFinite(headEndX)
        ? (headBeginX + headEndX) / 2
        : Number.NaN
    const fallbackAbsoluteX = entry.vexNote.getAbsoluteX()
    const fallbackCenter =
      Number.isFinite(fallbackAbsoluteX) && Number.isFinite(entry.vexNote.getGlyphWidth())
        ? fallbackAbsoluteX + entry.vexNote.getGlyphWidth() / 2
        : Number.NaN
    const currentCenterX = Number.isFinite(centerFromHeads) ? centerFromHeads : fallbackCenter
    if (!Number.isFinite(currentCenterX)) return
    const delta = targetX - currentCenterX
    if (Math.abs(delta) < 0.001) return
    entry.vexNote.setXShift(entry.vexNote.getXShift() + delta)
  }

  if (trebleIsFullMeasureRest) {
    alignRenderedRestToMeasureCenter('treble', trebleRendered[0])
  }
  if (bassIsFullMeasureRest) {
    alignRenderedRestToMeasureCenter('bass', bassRendered[0])
  }

  function alignRenderedAccidentalOffset(
    staff: StaffKind,
    sourceNotes: ScoreNote[],
    renderedBySourceIndex: Map<number, RenderedMeasureNote>,
    options?: {
      captureLockState?: boolean
      reasonSuffix?: string
    },
  ): AccidentalAlignPassResult {
    const captureLockState = options?.captureLockState ?? true
    const reasonSuffix = typeof options?.reasonSuffix === 'string' ? options.reasonSuffix.trim() : ''
    const passResult: AccidentalAlignPassResult = {
      maxLeftShiftPx: 0,
      hardConstraintViolationCount: 0,
      requiresSpacingReflow: false,
    }
    const trackLeftShift = (baseLeftX: number | null, finalLeftX: number | null) => {
      if (
        typeof baseLeftX !== 'number' ||
        !Number.isFinite(baseLeftX) ||
        typeof finalLeftX !== 'number' ||
        !Number.isFinite(finalLeftX)
      ) {
        return
      }
      const shiftPx = baseLeftX - finalLeftX
      if (shiftPx > ACCIDENTAL_TARGET_EPSILON_PX) {
        passResult.maxLeftShiftPx = Math.max(passResult.maxLeftShiftPx, shiftPx)
        passResult.requiresSpacingReflow = true
      }
    }
    const markHardConstraintViolation = () => {
      passResult.hardConstraintViolationCount += 1
      passResult.requiresSpacingReflow = true
    }
    const appendReasonSuffix = (baseReason: string): string => {
      if (!reasonSuffix) return baseReason
      return baseReason.includes(reasonSuffix) ? baseReason : `${baseReason}+${reasonSuffix}`
    }
    const setAccidentalLockState = (
      rowKey: string,
      value: AccidentalLockState,
    ) => {
      if (!captureLockState) return
      accidentalLockByRowKey.set(rowKey, value)
    }
    const setPreviewAccidentalRightX = (rowKey: string, value: number) => {
      if (!captureLockState) return
      previewAccidentalByRowKey.set(rowKey, value)
    }
    sourceNotes.forEach((sourceNote, noteIndex) => {
      const renderedEntry = renderedBySourceIndex.get(noteIndex)
      if (!renderedEntry) return
      const layoutKey = getLayoutNoteKey(staff, sourceNote.id)
      const targetByKeyIndex = staticAccidentalRightXById?.get(layoutKey)
      const noteBaseX = getRenderedNoteVisualX(renderedEntry.vexNote)
      const accidentalModifiers = renderedEntry.vexNote
        .getModifiersByType(Accidental.CATEGORY)
        .map((modifier) => modifier as Accidental)

      renderedEntry.renderedKeys.forEach((renderedKey, renderedIndex) => {
        if (!renderedKey.accidental) return
        const rowKey = `${layoutKey}|${renderedKey.keyIndex}`
        const { modifier, keyRenderedIndex } = resolveAccidentalModifierForRenderedKey({
          accidentalModifiers,
          renderedKeys: renderedEntry.renderedKeys,
          renderedKey,
          fallbackRenderedIndex: renderedIndex,
        })
        if (!modifier) {
          setAccidentalLockState(rowKey, {
            targetRightX: null,
            applied: false,
            reason: appendReasonSuffix('no-modifier'),
            columnBaseLeftX: null,
            columnTargetLeftX: null,
            columnAppliedDeltaX: null,
            columnCountMeasured: null,
            leftMostMeasured: null,
          })
          return
        }

        const modifierWidth = resolveAccidentalWidth({
          modifier,
          accidentalCode: renderedKey.accidental,
        })
        const resolvedChordHead = resolveChordHeadLeftX({
          vexNote: renderedEntry.vexNote,
          noteBaseX,
        })
        const resolvedChordBlockerHeads = resolveChordBlockerHeadBounds({
          vexNote: renderedEntry.vexNote,
          renderedIndex,
          noteBaseX,
        })
        const previousNoteOccupiedRightX = resolvePreviousNoteOccupiedRightX({
          sourceNotes,
          renderedBySourceIndex,
          noteIndex,
        })
        const minAccidentalLeftX =
          typeof previousNoteOccupiedRightX === 'number' && Number.isFinite(previousNoteOccupiedRightX)
            ? previousNoteOccupiedRightX + ACCIDENTAL_PREVIOUS_NOTE_CLEARANCE_PX
            : null

        const targetedX = targetByKeyIndex?.get(renderedKey.keyIndex)
        const targetedCandidateX =
          typeof targetedX === 'number' && Number.isFinite(targetedX) ? targetedX : null
        const resolvedCurrentAccidental = resolveCurrentAccidentalLeftX({
          vexNote: renderedEntry.vexNote,
          modifier,
          renderedIndex: keyRenderedIndex,
        })
        const currentLeftX = resolvedCurrentAccidental.leftX
        const resolvedOwnHead = resolveOwnHeadLeftX({
          vexNote: renderedEntry.vexNote,
          renderedIndex: keyRenderedIndex,
          noteBaseX,
        })
        const preferredLeftByOwnHead =
          typeof resolvedOwnHead.ownHeadLeftX === 'number' && Number.isFinite(resolvedOwnHead.ownHeadLeftX)
            ? resolvedOwnHead.ownHeadLeftX - modifierWidth - ACCIDENTAL_NOTEHEAD_CLEARANCE_PX
            : null
        const outlierReferenceHeadLeftX =
          typeof resolvedOwnHead.ownHeadLeftX === 'number' && Number.isFinite(resolvedOwnHead.ownHeadLeftX)
            ? resolvedOwnHead.ownHeadLeftX
            : resolvedChordHead.chordHeadLeftX
        const staticOutlierRejected = isAccidentalLeftXOutlier({
          candidateLeftX: targetedCandidateX,
          referenceHeadLeftX: outlierReferenceHeadLeftX,
          modifierWidth,
        })
        const nativeOutlierRejected = isAccidentalLeftXOutlier({
          candidateLeftX: currentLeftX,
          referenceHeadLeftX: outlierReferenceHeadLeftX,
          modifierWidth,
        })

        const isCandidateInsideCorridor = (candidateLeftX: number): boolean => {
          if (!Number.isFinite(candidateLeftX)) return false
          if (
            typeof minAccidentalLeftX === 'number' &&
            Number.isFinite(minAccidentalLeftX) &&
            candidateLeftX < minAccidentalLeftX - ACCIDENTAL_TARGET_EPSILON_PX
          ) {
            return false
          }
          return true
        }

        const staticNearPreferred =
          targetedCandidateX !== null &&
          preferredLeftByOwnHead !== null &&
          Math.abs(targetedCandidateX - preferredLeftByOwnHead) <= ACCIDENTAL_STATIC_PREFERRED_TOLERANCE_PX

        let chosenTargetX: number | null = null
        let chosenTargetSource:
          | 'preferred-own-head'
          | 'static-near-preferred'
          | 'native-fallback'
          | 'head-safe'
          | 'previous-safe'
          | null = null
        if (preferredLeftByOwnHead !== null) {
          if (
            staticNearPreferred &&
            targetedCandidateX !== null &&
            !staticOutlierRejected &&
            isCandidateInsideCorridor(targetedCandidateX)
          ) {
            chosenTargetX = targetedCandidateX
            chosenTargetSource = 'static-near-preferred'
          } else {
            chosenTargetX = preferredLeftByOwnHead
            chosenTargetSource = 'preferred-own-head'
          }
        } else if (currentLeftX !== null && !nativeOutlierRejected) {
          chosenTargetX = currentLeftX
          chosenTargetSource = 'native-fallback'
        }

        if (chosenTargetX === null) {
          if (
            typeof resolvedChordHead.chordHeadLeftX === 'number' &&
            Number.isFinite(resolvedChordHead.chordHeadLeftX)
          ) {
            chosenTargetX = resolvedChordHead.chordHeadLeftX - modifierWidth - ACCIDENTAL_NOTEHEAD_CLEARANCE_PX
            chosenTargetSource = 'head-safe'
          } else if (typeof minAccidentalLeftX === 'number' && Number.isFinite(minAccidentalLeftX)) {
            chosenTargetX = minAccidentalLeftX
            chosenTargetSource = 'previous-safe'
          } else if (currentLeftX !== null) {
            chosenTargetX = currentLeftX
            chosenTargetSource = 'native-fallback'
          }
        }

        const lockReasonSuffixes: string[] = []
        if (resolvedOwnHead.usedFallback) lockReasonSuffixes.push('own-head-fallback')
        if (resolvedChordHead.usedFallback) lockReasonSuffixes.push('chord-head-fallback')
        if (resolvedChordBlockerHeads.usedFallback) lockReasonSuffixes.push('chord-blocker-fallback')
        if (staticOutlierRejected) lockReasonSuffixes.push('static-outlier-fallback')
        if (nativeOutlierRejected) lockReasonSuffixes.push('native-outlier-fallback')
        const buildLockReason = (base: string): string => {
          const baseWithFallback =
            lockReasonSuffixes.length === 0 ? base : `${base}+${lockReasonSuffixes.join('+')}`
          return appendReasonSuffix(baseWithFallback)
        }

        if (chosenTargetX === null) {
          setAccidentalLockState(rowKey, {
            targetRightX: null,
            applied: false,
            reason: buildLockReason('no-target'),
            previousOccupiedRightX: previousNoteOccupiedRightX,
            previousGapMeasured: null,
            columnBaseLeftX: null,
            columnTargetLeftX: null,
            columnAppliedDeltaX: null,
            columnCountMeasured: null,
            leftMostMeasured: null,
          })
          return
        }

        const initialChordCollisionResolution = resolveAccidentalLeftAfterChordHeadAvoidance({
          candidateLeftX: chosenTargetX,
          modifierWidth,
          blockerHeadBounds: resolvedChordBlockerHeads.blockerHeadBounds,
        })
        let clampedTargetRightX = initialChordCollisionResolution.leftX
        let clampedByChordBoundary = initialChordCollisionResolution.clamped
        let clampedByPreviousBoundary = false
        let clampedByOwnHeadBoundary = false
        let infeasibleCorridor = false
        let usedExactAccidentalBoundsFallback = false
        let usedExactOwnHeadFallback = false
        if (typeof minAccidentalLeftX === 'number' && Number.isFinite(minAccidentalLeftX)) {
          if (
            clampedTargetRightX < minAccidentalLeftX - ACCIDENTAL_TARGET_EPSILON_PX
          ) {
            clampedTargetRightX = minAccidentalLeftX
            clampedByPreviousBoundary = true
          }
          const postPreviousCollisionResolution = resolveAccidentalLeftAfterChordHeadAvoidance({
            candidateLeftX: clampedTargetRightX,
            modifierWidth,
            blockerHeadBounds: resolvedChordBlockerHeads.blockerHeadBounds,
          })
          if (postPreviousCollisionResolution.clamped) {
            clampedByChordBoundary = true
            if (
              typeof minAccidentalLeftX === 'number' &&
              Number.isFinite(minAccidentalLeftX) &&
              postPreviousCollisionResolution.leftX < minAccidentalLeftX - ACCIDENTAL_TARGET_EPSILON_PX
            ) {
              infeasibleCorridor = true
            }
            clampedTargetRightX = postPreviousCollisionResolution.leftX
          }
        }

        const effectiveCurrentLeftX =
          currentLeftX !== null && !nativeOutlierRejected
            ? currentLeftX
            : null
        const effectiveCurrentRightX =
          effectiveCurrentLeftX ??
          (Number.isFinite(noteBaseX) ? noteBaseX - modifierWidth : null)

        if (effectiveCurrentRightX === null) {
          const invalidCurrentReasonBase = infeasibleCorridor
            ? 'hard-infeasible-invalid-current-x'
            : clampedByChordBoundary || chosenTargetSource === 'head-safe'
              ? 'chord-collision-clamped-invalid-current-x'
            : clampedByPreviousBoundary || chosenTargetSource === 'previous-safe'
                ? 'previous-boundary-clamped-invalid-current-x'
                : chosenTargetSource === 'native-fallback'
                  ? 'native-fallback-used-invalid-current-x'
                  : 'preferred-own-head-aligned-invalid-current-x'
          setAccidentalLockState(rowKey, {
            targetRightX: clampedTargetRightX,
            applied: false,
            reason: buildLockReason(invalidCurrentReasonBase),
            previousOccupiedRightX: previousNoteOccupiedRightX,
            previousGapMeasured:
              typeof previousNoteOccupiedRightX === 'number' && Number.isFinite(previousNoteOccupiedRightX)
                ? clampedTargetRightX - previousNoteOccupiedRightX
                : null,
            columnBaseLeftX: null,
            columnTargetLeftX: null,
            columnAppliedDeltaX: null,
            columnCountMeasured: null,
            leftMostMeasured: null,
          })
          markHardConstraintViolation()
          return
        }

        const delta = clampedTargetRightX - effectiveCurrentRightX
        const baseLeftXBeforeAlign = effectiveCurrentRightX
        if (Math.abs(delta) >= ACCIDENTAL_TARGET_EPSILON_PX) {
          applyAccidentalLeftXTarget({
            vexNote: renderedEntry.vexNote,
            modifier,
            renderedIndex: keyRenderedIndex,
            targetLeftX: clampedTargetRightX,
          })
        }

        const postApplyMaxIterations = Math.max(3, resolvedChordBlockerHeads.blockerHeadBounds.length + 3)
        for (let iteration = 0; iteration < postApplyMaxIterations; iteration += 1) {
          const exactOwnHead = resolveOwnHeadLeftX({
            vexNote: renderedEntry.vexNote,
            renderedIndex: keyRenderedIndex,
            noteBaseX,
          })
          const exactBounds = resolveMeasuredAccidentalBounds({
            vexNote: renderedEntry.vexNote,
            modifier,
            renderedIndex: keyRenderedIndex,
            fallbackWidth: modifierWidth,
          })
          if (exactBounds?.usedFallback) usedExactAccidentalBoundsFallback = true
          if (exactOwnHead.usedFallback) usedExactOwnHeadFallback = true
          if (!exactBounds || typeof exactOwnHead.ownHeadLeftX !== 'number' || !Number.isFinite(exactOwnHead.ownHeadLeftX)) {
            break
          }

          const ownGapPxExact = exactOwnHead.ownHeadLeftX - exactBounds.rightX
          if (ownGapPxExact >= ACCIDENTAL_NOTEHEAD_CLEARANCE_PX - ACCIDENTAL_TARGET_EPSILON_PX) {
            break
          }

          let nextLeftX = exactBounds.leftX - (ACCIDENTAL_NOTEHEAD_CLEARANCE_PX - ownGapPxExact)
          clampedByOwnHeadBoundary = true
          const postOwnCollisionResolution = resolveAccidentalLeftAfterChordHeadAvoidance({
            candidateLeftX: nextLeftX,
            modifierWidth: exactBounds.width,
            blockerHeadBounds: resolvedChordBlockerHeads.blockerHeadBounds,
          })
          if (postOwnCollisionResolution.clamped) {
            clampedByChordBoundary = true
            nextLeftX = postOwnCollisionResolution.leftX
          }

          const postApplyShiftDelta = nextLeftX - exactBounds.leftX
          if (postApplyShiftDelta < -ACCIDENTAL_TARGET_EPSILON_PX) {
            applyAccidentalLeftXTarget({
              vexNote: renderedEntry.vexNote,
              modifier,
              renderedIndex: keyRenderedIndex,
              targetLeftX: nextLeftX,
            })
            continue
          }
          if (clampedByOwnHeadBoundary) {
            infeasibleCorridor = true
          }
          break
        }

        let finalOwnHead = resolveOwnHeadLeftX({
          vexNote: renderedEntry.vexNote,
          renderedIndex: keyRenderedIndex,
          noteBaseX,
        })
        let finalAccidentalBounds = resolveMeasuredAccidentalBounds({
          vexNote: renderedEntry.vexNote,
          modifier,
          renderedIndex: keyRenderedIndex,
          fallbackWidth: modifierWidth,
        })
        if (finalAccidentalBounds?.usedFallback) usedExactAccidentalBoundsFallback = true
        if (finalOwnHead.usedFallback) usedExactOwnHeadFallback = true

        if (
          typeof minAccidentalLeftX === 'number' &&
          Number.isFinite(minAccidentalLeftX) &&
          finalAccidentalBounds &&
          finalAccidentalBounds.leftX < minAccidentalLeftX - ACCIDENTAL_TARGET_EPSILON_PX
        ) {
          const candidateLeftX = minAccidentalLeftX
          const candidateRightX = candidateLeftX + finalAccidentalBounds.width
          const candidateAllowedByOwnHead =
            typeof finalOwnHead.ownHeadLeftX !== 'number' ||
            !Number.isFinite(finalOwnHead.ownHeadLeftX) ||
            candidateRightX <=
              finalOwnHead.ownHeadLeftX - ACCIDENTAL_NOTEHEAD_CLEARANCE_PX + ACCIDENTAL_TARGET_EPSILON_PX
          const candidateChordCollisionResolution = resolveAccidentalLeftAfterChordHeadAvoidance({
            candidateLeftX,
            modifierWidth: finalAccidentalBounds.width,
            blockerHeadBounds: resolvedChordBlockerHeads.blockerHeadBounds,
          })
          const candidateAllowedByChord =
            Math.abs(candidateChordCollisionResolution.leftX - candidateLeftX) <= ACCIDENTAL_TARGET_EPSILON_PX

          if (candidateAllowedByOwnHead && candidateAllowedByChord) {
            const previousBoundaryShiftDelta = candidateLeftX - finalAccidentalBounds.leftX
            if (Math.abs(previousBoundaryShiftDelta) >= ACCIDENTAL_TARGET_EPSILON_PX) {
              applyAccidentalLeftXTarget({
                vexNote: renderedEntry.vexNote,
                modifier,
                renderedIndex: keyRenderedIndex,
                targetLeftX: candidateLeftX,
              })
            }
            clampedByPreviousBoundary = true
            finalOwnHead = resolveOwnHeadLeftX({
              vexNote: renderedEntry.vexNote,
              renderedIndex: keyRenderedIndex,
              noteBaseX,
            })
            finalAccidentalBounds = resolveMeasuredAccidentalBounds({
              vexNote: renderedEntry.vexNote,
              modifier,
              renderedIndex: keyRenderedIndex,
              fallbackWidth: modifierWidth,
            })
            if (finalAccidentalBounds?.usedFallback) usedExactAccidentalBoundsFallback = true
            if (finalOwnHead.usedFallback) usedExactOwnHeadFallback = true
          } else {
            infeasibleCorridor = true
          }
        }

        if (finalAccidentalBounds) {
          const finalChordCollisionResolution = resolveAccidentalLeftAfterChordHeadAvoidance({
            candidateLeftX: finalAccidentalBounds.leftX,
            modifierWidth: finalAccidentalBounds.width,
            blockerHeadBounds: resolvedChordBlockerHeads.blockerHeadBounds,
          })
          if (finalChordCollisionResolution.leftX < finalAccidentalBounds.leftX - ACCIDENTAL_TARGET_EPSILON_PX) {
            const finalChordShiftDelta = finalChordCollisionResolution.leftX - finalAccidentalBounds.leftX
            if (Math.abs(finalChordShiftDelta) >= ACCIDENTAL_TARGET_EPSILON_PX) {
              applyAccidentalLeftXTarget({
                vexNote: renderedEntry.vexNote,
                modifier,
                renderedIndex: keyRenderedIndex,
                targetLeftX: finalChordCollisionResolution.leftX,
              })
            }
            clampedByChordBoundary = true
            finalOwnHead = resolveOwnHeadLeftX({
              vexNote: renderedEntry.vexNote,
              renderedIndex: keyRenderedIndex,
              noteBaseX,
            })
            finalAccidentalBounds = resolveMeasuredAccidentalBounds({
              vexNote: renderedEntry.vexNote,
              modifier,
              renderedIndex: keyRenderedIndex,
              fallbackWidth: modifierWidth,
            })
            if (finalAccidentalBounds?.usedFallback) usedExactAccidentalBoundsFallback = true
            if (finalOwnHead.usedFallback) usedExactOwnHeadFallback = true
            if (
              typeof minAccidentalLeftX === 'number' &&
              Number.isFinite(minAccidentalLeftX) &&
              finalAccidentalBounds &&
              finalAccidentalBounds.leftX < minAccidentalLeftX - ACCIDENTAL_TARGET_EPSILON_PX
            ) {
              infeasibleCorridor = true
            }
          }
        }

        if (
          finalAccidentalBounds &&
          typeof finalOwnHead.ownHeadLeftX === 'number' &&
          Number.isFinite(finalOwnHead.ownHeadLeftX)
        ) {
          const finalOwnGapPxExact = finalOwnHead.ownHeadLeftX - finalAccidentalBounds.rightX
          if (finalOwnGapPxExact < ACCIDENTAL_NOTEHEAD_CLEARANCE_PX - ACCIDENTAL_TARGET_EPSILON_PX) {
            clampedByOwnHeadBoundary = true
            if (typeof minAccidentalLeftX === 'number' && finalAccidentalBounds.leftX <= minAccidentalLeftX + ACCIDENTAL_TARGET_EPSILON_PX) {
              infeasibleCorridor = true
            }
          }
        }

        if (usedExactAccidentalBoundsFallback) lockReasonSuffixes.push('accidental-bounds-fallback')
        if (usedExactOwnHeadFallback) lockReasonSuffixes.push('own-head-exact-fallback')

        const alignedRightX = getAccidentalVisualX(renderedEntry.vexNote, modifier, keyRenderedIndex)
        if (alignedRightX !== null) {
          setPreviewAccidentalRightX(rowKey, alignedRightX)
        } else {
          setPreviewAccidentalRightX(rowKey, clampedTargetRightX)
        }
        const reasonBase = infeasibleCorridor
          ? 'hard-infeasible'
          : clampedByChordBoundary || chosenTargetSource === 'head-safe'
            ? 'chord-collision-clamped'
            : clampedByPreviousBoundary || chosenTargetSource === 'previous-safe'
              ? 'previous-boundary-clamped'
              : clampedByOwnHeadBoundary
                ? 'preferred-own-head-aligned'
              : chosenTargetSource === 'native-fallback'
                ? 'native-fallback-used'
                : 'preferred-own-head-aligned'
        const previousGapMeasured =
          typeof previousNoteOccupiedRightX === 'number' &&
          Number.isFinite(previousNoteOccupiedRightX) &&
          finalAccidentalBounds
            ? finalAccidentalBounds.leftX - previousNoteOccupiedRightX
            : null
        trackLeftShift(
          baseLeftXBeforeAlign,
          finalAccidentalBounds && Number.isFinite(finalAccidentalBounds.leftX) ? finalAccidentalBounds.leftX : null,
        )
        if (
          typeof previousGapMeasured === 'number' &&
          Number.isFinite(previousGapMeasured) &&
          previousGapMeasured < ACCIDENTAL_PREVIOUS_NOTE_CLEARANCE_PX - ACCIDENTAL_TARGET_EPSILON_PX
        ) {
          infeasibleCorridor = true
          markHardConstraintViolation()
        }
        if (infeasibleCorridor) {
          markHardConstraintViolation()
        }
        setAccidentalLockState(rowKey, {
          targetRightX: clampedTargetRightX,
          applied: true,
          reason: buildLockReason(reasonBase),
          previousOccupiedRightX: previousNoteOccupiedRightX,
          previousGapMeasured,
          columnBaseLeftX: null,
          columnTargetLeftX: null,
          columnAppliedDeltaX: null,
          columnCountMeasured: null,
          leftMostMeasured:
            finalAccidentalBounds && Number.isFinite(finalAccidentalBounds.leftX)
              ? finalAccidentalBounds.leftX
              : null,
        })
      })

      const previousOccupiedRightXForColumns = resolvePreviousNoteOccupiedRightX({
        sourceNotes,
        renderedBySourceIndex,
        noteIndex,
      })
      const minAccidentalLeftXForColumns =
        typeof previousOccupiedRightXForColumns === 'number' && Number.isFinite(previousOccupiedRightXForColumns)
          ? previousOccupiedRightXForColumns + ACCIDENTAL_PREVIOUS_NOTE_CLEARANCE_PX
          : null
      const accidentalColumnNodes: AccidentalColumnNode[] = []
      renderedEntry.renderedKeys.forEach((renderedKey, renderedIndex) => {
        if (!renderedKey.accidental) return
        const rowKey = `${layoutKey}|${renderedKey.keyIndex}`
        const { modifier, keyRenderedIndex } = resolveAccidentalModifierForRenderedKey({
          accidentalModifiers,
          renderedKeys: renderedEntry.renderedKeys,
          renderedKey,
          fallbackRenderedIndex: renderedIndex,
        })
        if (!modifier) return
        const fallbackWidth = resolveAccidentalWidth({
          modifier,
          accidentalCode: renderedKey.accidental,
        })
        const measuredBounds = resolveMeasuredAccidentalBounds({
          vexNote: renderedEntry.vexNote,
          modifier,
          renderedIndex: keyRenderedIndex,
          fallbackWidth,
        })
        if (!measuredBounds) return
        const resolvedOwnHeadForColumn = resolveOwnHeadLeftX({
          vexNote: renderedEntry.vexNote,
          renderedIndex: keyRenderedIndex,
          noteBaseX,
        })
        const resolvedBlockerHeadsForColumn = resolveChordBlockerHeadBounds({
          vexNote: renderedEntry.vexNote,
          renderedIndex: keyRenderedIndex,
          noteBaseX,
        })
        const maxLeftCandidateByOwnHead =
          typeof resolvedOwnHeadForColumn.ownHeadLeftX === 'number' &&
          Number.isFinite(resolvedOwnHeadForColumn.ownHeadLeftX)
            ? resolvedOwnHeadForColumn.ownHeadLeftX - measuredBounds.width - ACCIDENTAL_NOTEHEAD_CLEARANCE_PX
            : measuredBounds.leftX
        const resolvedMaxLeftByBlocker = resolveAccidentalLeftAfterChordHeadAvoidance({
          candidateLeftX: maxLeftCandidateByOwnHead,
          modifierWidth: measuredBounds.width,
          blockerHeadBounds: resolvedBlockerHeadsForColumn.blockerHeadBounds,
        })
        const maxLeftXForColumn =
          Number.isFinite(resolvedMaxLeftByBlocker.leftX) && Number.isFinite(maxLeftCandidateByOwnHead)
            ? Math.min(resolvedMaxLeftByBlocker.leftX, maxLeftCandidateByOwnHead)
            : measuredBounds.leftX
        const diatonicOrdinal = resolvePitchDiatonicOrdinal(renderedKey.pitch)
        if (typeof diatonicOrdinal !== 'number' || !Number.isFinite(diatonicOrdinal)) return
        accidentalColumnNodes.push({
          rowKey,
          renderedIndex,
          keyRenderedIndex,
          keyIndex: renderedKey.keyIndex,
          pitch: renderedKey.pitch,
          diatonicOrdinal,
          modifier,
          width: measuredBounds.width,
          baseLeftX: measuredBounds.leftX,
          minLeftX: minAccidentalLeftXForColumns,
          maxLeftX: maxLeftXForColumn,
        })
      })

      if (accidentalColumnNodes.length > 1) {
        const columnPlan = resolveAccidentalColumnPlan({
          nodes: accidentalColumnNodes,
        })
        if (captureLockState) {
          accidentalColumnNodes.forEach((node) => {
            const placement = columnPlan.placementByRenderedIndex.get(node.renderedIndex)
            if (!placement) return
            const existingLockState = accidentalLockByRowKey.get(node.rowKey)
            if (!existingLockState) return
            setAccidentalLockState(node.rowKey, {
              ...existingLockState,
              columnIndex: placement.columnIndex,
            })
          })
        }

        if (columnPlan.hasStagger) {
          const columnTargets = resolveAccidentalColumnTargets({
            nodes: accidentalColumnNodes,
            columnPlan,
          })

          accidentalColumnNodes.forEach((node) => {
            const placement = columnPlan.placementByRenderedIndex.get(node.renderedIndex)
            if (!placement) return
            const targetLeftX = columnTargets.targetLeftByRenderedIndex.get(node.renderedIndex)
            const currentBounds = resolveMeasuredAccidentalBounds({
              vexNote: renderedEntry.vexNote,
              modifier: node.modifier,
              renderedIndex: node.keyRenderedIndex,
              fallbackWidth: node.width,
            })
            const baseLeftXForColumn =
              currentBounds && Number.isFinite(currentBounds.leftX) ? currentBounds.leftX : node.baseLeftX
            let columnAppliedDeltaX: number | null = null
            let columnMoveApplied = false
            if (typeof targetLeftX === 'number' && Number.isFinite(targetLeftX)) {
              const deltaToTarget = targetLeftX - baseLeftXForColumn
              if (Math.abs(deltaToTarget) >= ACCIDENTAL_TARGET_EPSILON_PX) {
                const appliedResult = applyAccidentalLeftXTarget({
                  vexNote: renderedEntry.vexNote,
                  modifier: node.modifier,
                  renderedIndex: node.keyRenderedIndex,
                  targetLeftX,
                })
                const resolvedAfterBounds = resolveMeasuredAccidentalBounds({
                  vexNote: renderedEntry.vexNote,
                  modifier: node.modifier,
                  renderedIndex: node.keyRenderedIndex,
                  fallbackWidth: node.width,
                })
                const resolvedAfterLeftX =
                  resolvedAfterBounds && Number.isFinite(resolvedAfterBounds.leftX)
                    ? resolvedAfterBounds.leftX
                    : targetLeftX
                columnAppliedDeltaX = resolvedAfterLeftX - baseLeftXForColumn
                columnMoveApplied =
                  appliedResult.applied ||
                  Math.abs(columnAppliedDeltaX) >= ACCIDENTAL_TARGET_EPSILON_PX
              } else {
                columnAppliedDeltaX = 0
              }
            }

            const postColumnBlockerBounds = resolveChordBlockerHeadBounds({
              vexNote: renderedEntry.vexNote,
              renderedIndex: node.keyRenderedIndex,
              noteBaseX,
            })
            const columnTargetMarkedInfeasible =
              columnTargets.hardInfeasibleByRenderedIndex.get(node.renderedIndex) === true
            if (columnTargetMarkedInfeasible) {
              passResult.requiresSpacingReflow = true
            }
            let postColumnHardAdjusted = false
            let hardConstraintViolation = false
            const hardClampMaxIterations = Math.max(
              3,
              postColumnBlockerBounds.blockerHeadBounds.length + 3,
            )
            for (let iteration = 0; iteration < hardClampMaxIterations; iteration += 1) {
              const measuredBounds = resolveMeasuredAccidentalBounds({
                vexNote: renderedEntry.vexNote,
                modifier: node.modifier,
                renderedIndex: node.keyRenderedIndex,
                fallbackWidth: node.width,
              })
              const measuredOwnHead = resolveOwnHeadLeftX({
                vexNote: renderedEntry.vexNote,
                renderedIndex: node.keyRenderedIndex,
                noteBaseX,
              })
              if (!measuredBounds) break
              let nextLeftX = measuredBounds.leftX
              let requiresAdjustment = false
              const minLeftHard =
                typeof node.minLeftX === 'number' && Number.isFinite(node.minLeftX)
                  ? node.minLeftX
                  : Number.NEGATIVE_INFINITY
              const ownMaxLeftX =
                typeof measuredOwnHead.ownHeadLeftX === 'number' &&
                Number.isFinite(measuredOwnHead.ownHeadLeftX)
                  ? measuredOwnHead.ownHeadLeftX - measuredBounds.width - ACCIDENTAL_NOTEHEAD_CLEARANCE_PX
                  : Number.POSITIVE_INFINITY
              const chordMaxLeftX = resolveAccidentalLeftAfterChordHeadAvoidance({
                candidateLeftX:
                  Number.isFinite(ownMaxLeftX) && ownMaxLeftX < Number.POSITIVE_INFINITY
                    ? ownMaxLeftX
                    : measuredBounds.leftX,
                modifierWidth: measuredBounds.width,
                blockerHeadBounds: postColumnBlockerBounds.blockerHeadBounds,
              }).leftX
              const maxLeftHard = Math.min(ownMaxLeftX, chordMaxLeftX)
              if (
                Number.isFinite(minLeftHard) &&
                Number.isFinite(maxLeftHard) &&
                minLeftHard > maxLeftHard + ACCIDENTAL_TARGET_EPSILON_PX
              ) {
                hardConstraintViolation = true
                nextLeftX = maxLeftHard
                requiresAdjustment = true
              } else {
                if (Number.isFinite(minLeftHard) && nextLeftX < minLeftHard - ACCIDENTAL_TARGET_EPSILON_PX) {
                  nextLeftX = minLeftHard
                  requiresAdjustment = true
                }
                if (Number.isFinite(maxLeftHard) && nextLeftX > maxLeftHard + ACCIDENTAL_TARGET_EPSILON_PX) {
                  nextLeftX = maxLeftHard
                  requiresAdjustment = true
                }
              }

              if (
                typeof measuredOwnHead.ownHeadLeftX === 'number' &&
                Number.isFinite(measuredOwnHead.ownHeadLeftX)
              ) {
                const ownGapPx = measuredOwnHead.ownHeadLeftX - measuredBounds.rightX
                if (ownGapPx < ACCIDENTAL_NOTEHEAD_CLEARANCE_PX - ACCIDENTAL_TARGET_EPSILON_PX) {
                  nextLeftX = Math.min(
                    nextLeftX,
                    measuredBounds.leftX - (ACCIDENTAL_NOTEHEAD_CLEARANCE_PX - ownGapPx),
                  )
                  requiresAdjustment = true
                }
              }

              const chordAdjustedLeft = resolveAccidentalLeftAfterChordHeadAvoidance({
                candidateLeftX: nextLeftX,
                modifierWidth: measuredBounds.width,
                blockerHeadBounds: postColumnBlockerBounds.blockerHeadBounds,
              })
              if (chordAdjustedLeft.leftX < nextLeftX - ACCIDENTAL_TARGET_EPSILON_PX) {
                nextLeftX = chordAdjustedLeft.leftX
                requiresAdjustment = true
              }

              if (!requiresAdjustment) {
                break
              }
              if (Math.abs(nextLeftX - measuredBounds.leftX) < ACCIDENTAL_TARGET_EPSILON_PX) {
                hardConstraintViolation = true
                break
              }
              const hardApplyResult = applyAccidentalLeftXTarget({
                vexNote: renderedEntry.vexNote,
                modifier: node.modifier,
                renderedIndex: node.keyRenderedIndex,
                targetLeftX: nextLeftX,
              })
              if (hardApplyResult.applied) {
                postColumnHardAdjusted = true
              }
            }

            const finalColumnBounds = resolveMeasuredAccidentalBounds({
              vexNote: renderedEntry.vexNote,
              modifier: node.modifier,
              renderedIndex: node.keyRenderedIndex,
              fallbackWidth: node.width,
            })
            const finalColumnOwnHead = resolveOwnHeadLeftX({
              vexNote: renderedEntry.vexNote,
              renderedIndex: node.keyRenderedIndex,
              noteBaseX,
            })
            if (
              finalColumnBounds &&
              typeof finalColumnOwnHead.ownHeadLeftX === 'number' &&
              Number.isFinite(finalColumnOwnHead.ownHeadLeftX)
            ) {
              const finalOwnGap = finalColumnOwnHead.ownHeadLeftX - finalColumnBounds.rightX
              if (finalOwnGap < ACCIDENTAL_NOTEHEAD_CLEARANCE_PX - ACCIDENTAL_TARGET_EPSILON_PX) {
                hardConstraintViolation = true
              }
            }
            if (finalColumnBounds) {
              const finalChordCheck = resolveAccidentalLeftAfterChordHeadAvoidance({
                candidateLeftX: finalColumnBounds.leftX,
                modifierWidth: finalColumnBounds.width,
                blockerHeadBounds: postColumnBlockerBounds.blockerHeadBounds,
              })
              if (finalChordCheck.leftX < finalColumnBounds.leftX - ACCIDENTAL_TARGET_EPSILON_PX) {
                hardConstraintViolation = true
              }
              if (
                typeof node.minLeftX === 'number' &&
                Number.isFinite(node.minLeftX) &&
                finalColumnBounds.leftX < node.minLeftX - ACCIDENTAL_TARGET_EPSILON_PX
              ) {
                hardConstraintViolation = true
              }
            }

            if (finalColumnBounds) {
              columnAppliedDeltaX = finalColumnBounds.leftX - baseLeftXForColumn
              if (Math.abs(columnAppliedDeltaX) >= ACCIDENTAL_TARGET_EPSILON_PX) {
                columnMoveApplied = true
              }
              trackLeftShift(baseLeftXForColumn, finalColumnBounds.leftX)
            }
            if (hardConstraintViolation) {
              markHardConstraintViolation()
            }
            if (!captureLockState) return
            const existingLockState = accidentalLockByRowKey.get(node.rowKey)
            const columnReasonSuffix = hardConstraintViolation
              ? 'hard-infeasible'
              : columnMoveApplied
                ? 'column-staggered'
                : 'column-assigned-only'
            const nextReasonBase = existingLockState?.reason ?? 'preferred-own-head-aligned'
            const nextReason = nextReasonBase.includes(columnReasonSuffix)
              ? nextReasonBase
              : `${nextReasonBase}+${columnReasonSuffix}`
            const nextReasonWithSuffix = appendReasonSuffix(nextReason)
            const columnPreviousGapMeasured =
              typeof previousOccupiedRightXForColumns === 'number' &&
              Number.isFinite(previousOccupiedRightXForColumns) &&
              finalColumnBounds &&
              Number.isFinite(finalColumnBounds.leftX)
                ? finalColumnBounds.leftX - previousOccupiedRightXForColumns
                : existingLockState?.previousGapMeasured ?? null
            const previewRightX = getAccidentalVisualX(renderedEntry.vexNote, node.modifier, node.keyRenderedIndex)
            if (typeof previewRightX === 'number' && Number.isFinite(previewRightX)) {
              setPreviewAccidentalRightX(node.rowKey, previewRightX)
            }
            setAccidentalLockState(node.rowKey, {
              targetRightX:
                existingLockState?.targetRightX ??
                (typeof targetLeftX === 'number' && Number.isFinite(targetLeftX) ? targetLeftX : node.baseLeftX),
              applied:
                typeof existingLockState?.applied === 'boolean'
                  ? existingLockState.applied || columnMoveApplied || postColumnHardAdjusted
                  : columnMoveApplied || postColumnHardAdjusted,
              reason: nextReasonWithSuffix,
              previousOccupiedRightX: existingLockState?.previousOccupiedRightX ?? previousOccupiedRightXForColumns,
              previousGapMeasured: columnPreviousGapMeasured,
              columnIndex: placement.columnIndex,
              columnBaseLeftX: baseLeftXForColumn,
              columnTargetLeftX:
                typeof targetLeftX === 'number' && Number.isFinite(targetLeftX) ? targetLeftX : null,
              columnAppliedDeltaX,
              columnCountMeasured: null,
              leftMostMeasured:
                finalColumnBounds && Number.isFinite(finalColumnBounds.leftX)
                  ? finalColumnBounds.leftX
                  : null,
            })
          })

          const hardInfeasibleRowKeys = new Set<string>()
          const markNodeHardInfeasible = (node: AccidentalColumnNode) => {
            hardInfeasibleRowKeys.add(node.rowKey)
          }
          const resolveNodeBounds = (node: AccidentalColumnNode) =>
            resolveMeasuredAccidentalBounds({
              vexNote: renderedEntry.vexNote,
              modifier: node.modifier,
              renderedIndex: node.keyRenderedIndex,
              fallbackWidth: node.width,
            })

          const normalizeColumnsByMeasuredGeometry = () => {
            const normalizedNodes: AccidentalColumnNode[] = []
            accidentalColumnNodes.forEach((node) => {
              const measuredBounds = resolveNodeBounds(node)
              if (!measuredBounds) return
              const resolvedOwnHead = resolveOwnHeadLeftX({
                vexNote: renderedEntry.vexNote,
                renderedIndex: node.keyRenderedIndex,
                noteBaseX,
              })
              const ownMaxLeftX =
                typeof resolvedOwnHead.ownHeadLeftX === 'number' && Number.isFinite(resolvedOwnHead.ownHeadLeftX)
                  ? resolvedOwnHead.ownHeadLeftX - measuredBounds.width - ACCIDENTAL_NOTEHEAD_CLEARANCE_PX
                  : measuredBounds.leftX
              const blockerBounds = resolveChordBlockerHeadBounds({
                vexNote: renderedEntry.vexNote,
                renderedIndex: node.keyRenderedIndex,
                noteBaseX,
              })
              const blockerMaxLeftX = resolveAccidentalLeftAfterChordHeadAvoidance({
                candidateLeftX: ownMaxLeftX,
                modifierWidth: measuredBounds.width,
                blockerHeadBounds: blockerBounds.blockerHeadBounds,
              }).leftX
              normalizedNodes.push({
                ...node,
                baseLeftX: measuredBounds.leftX,
                width: measuredBounds.width,
                minLeftX: node.minLeftX,
                maxLeftX: Math.min(ownMaxLeftX, blockerMaxLeftX),
              })
            })
            if (normalizedNodes.length <= 1) return
            const normalizedTargets = resolveAccidentalColumnTargets({
              nodes: normalizedNodes,
              columnPlan,
            })
            normalizedNodes.forEach((node) => {
              const targetLeftX = normalizedTargets.targetLeftByRenderedIndex.get(node.renderedIndex)
              if (typeof targetLeftX !== 'number' || !Number.isFinite(targetLeftX)) return
              const currentBounds = resolveNodeBounds(node)
              if (!currentBounds) return
              if (Math.abs(targetLeftX - currentBounds.leftX) < ACCIDENTAL_TARGET_EPSILON_PX) return
              applyAccidentalLeftXTarget({
                vexNote: renderedEntry.vexNote,
                modifier: node.modifier,
                renderedIndex: node.keyRenderedIndex,
                targetLeftX,
              })
              const updatedBounds = resolveNodeBounds(node)
              trackLeftShift(
                currentBounds.leftX,
                updatedBounds && Number.isFinite(updatedBounds.leftX) ? updatedBounds.leftX : null,
              )
            })
          }

          normalizeColumnsByMeasuredGeometry()

          for (let leftIndex = 0; leftIndex < accidentalColumnNodes.length; leftIndex += 1) {
            const leftNode = accidentalColumnNodes[leftIndex]!
            const leftPlacement = columnPlan.placementByRenderedIndex.get(leftNode.renderedIndex)
            if (!leftPlacement) continue
            for (let rightIndex = leftIndex + 1; rightIndex < accidentalColumnNodes.length; rightIndex += 1) {
              const rightNode = accidentalColumnNodes[rightIndex]!
              if (!isAccidentalConflictByDiatonicDistance(leftNode.diatonicOrdinal, rightNode.diatonicOrdinal)) {
                continue
              }
              const rightPlacement = columnPlan.placementByRenderedIndex.get(rightNode.renderedIndex)
              if (!rightPlacement) continue
              if (leftPlacement.columnIndex === rightPlacement.columnIndex) {
                markNodeHardInfeasible(leftNode)
                markNodeHardInfeasible(rightNode)
                continue
              }
              const leftBounds = resolveNodeBounds(leftNode)
              const rightBounds = resolveNodeBounds(rightNode)
              if (!leftBounds || !rightBounds) {
                markNodeHardInfeasible(leftNode)
                markNodeHardInfeasible(rightNode)
                continue
              }
              const overlapStillExists =
                leftBounds.rightX > rightBounds.leftX + ACCIDENTAL_TARGET_EPSILON_PX &&
                leftBounds.leftX < rightBounds.rightX - ACCIDENTAL_TARGET_EPSILON_PX
              if (overlapStillExists) {
                markNodeHardInfeasible(leftNode)
                markNodeHardInfeasible(rightNode)
              }
            }
          }

          hardInfeasibleRowKeys.forEach((rowKey) => {
            markHardConstraintViolation()
            if (!captureLockState) return
            const existingLockState = accidentalLockByRowKey.get(rowKey)
            if (!existingLockState) return
            const nextReasonBase = existingLockState.reason.includes('hard-infeasible')
              ? existingLockState.reason
              : `${existingLockState.reason}+hard-infeasible`
            setAccidentalLockState(rowKey, {
              ...existingLockState,
              reason: appendReasonSuffix(nextReasonBase),
            })
          })
        }
      }
    })
    return passResult
  }

  let finalTrebleAlignResult = alignRenderedAccidentalOffset('treble', measure.treble, trebleRenderedBySourceIndex)
  let finalBassAlignResult = alignRenderedAccidentalOffset('bass', measure.bass, bassRenderedBySourceIndex)
  if (spacingLayoutMode === 'custom') {
    const maxReflowPasses = 3
    let reflowPass = 0
    while (
      reflowPass < maxReflowPasses &&
      (finalTrebleAlignResult.requiresSpacingReflow || finalBassAlignResult.requiresSpacingReflow)
    ) {
      reflowPass += 1
      appliedSpacingMetrics = applyTimeAxisSpacingPass()
      finalTrebleAlignResult = alignRenderedAccidentalOffset('treble', measure.treble, trebleRenderedBySourceIndex, {
        reasonSuffix: 'spacing-reflow-applied',
      })
      finalBassAlignResult = alignRenderedAccidentalOffset('bass', measure.bass, bassRenderedBySourceIndex, {
        reasonSuffix: 'spacing-reflow-applied',
      })
    }
  }

  if (onSpacingMetrics) {
    onSpacingMetrics(appliedSpacingMetrics)
  }

  if (debugCapture) {
    const rows: DragDebugRow[] = []
    const captureDebugRowsForStaff = (
      staff: StaffKind,
      sourceNotes: ScoreNote[],
      renderedBySourceIndex: Map<number, RenderedMeasureNote>,
    ) => {
      sourceNotes.forEach((sourceNote, noteIndex) => {
        const renderedEntry = renderedBySourceIndex.get(noteIndex)
        if (!renderedEntry) return
        const noteKey = getLayoutNoteKey(staff, sourceNote.id)
        const staticRecord = debugCapture.staticByNoteKey.get(noteKey)
        const noteXPreview = finiteOrNull(getRenderedNoteVisualX(renderedEntry.vexNote))
        const noteXStatic = finiteOrNull(staticRecord?.noteX ?? null)
        const anchorXPreview = finiteOrNull(getRenderedNoteAnchorX(renderedEntry.vexNote))
        const anchorXStatic = finiteOrNull(staticRecord?.anchorX ?? null)
        const accidentalPreviewByRenderedIndex = getAccidentalRightXByRenderedIndex(renderedEntry.vexNote)

        renderedEntry.renderedKeys.forEach((renderedKey, renderedIndex) => {
          const lockInfo = accidentalLockByRowKey.get(`${noteKey}|${renderedKey.keyIndex}`)
          const rawHeadXPreview = finiteOrNull(renderedEntry.vexNote.noteHeads[renderedIndex]?.getAbsoluteX())
          const headXPreview =
            rawHeadXPreview !== null && Math.abs(rawHeadXPreview) > 0.0001 ? rawHeadXPreview : noteXPreview
          const headXStatic = finiteOrNull(staticRecord?.headXByKeyIndex.get(renderedKey.keyIndex))
          const rawHeadYPreview = finiteOrNull(renderedEntry.vexNote.getYs()[renderedIndex] ?? renderedEntry.vexNote.getYs()[0])
          const headYPreview = rawHeadYPreview
          const headYStatic = finiteOrNull(staticRecord?.headYByKeyIndex.get(renderedKey.keyIndex))
          const previewByLock = finiteOrNull(previewAccidentalByRowKey.get(`${noteKey}|${renderedKey.keyIndex}`))
          const accidentalRightXPreview =
            previewByLock ?? finiteOrNull(accidentalPreviewByRenderedIndex.get(renderedIndex))
          const accidentalRightXStatic = finiteOrNull(
            staticRecord?.accidentalRightXByKeyIndex.get(renderedKey.keyIndex),
          )
          rows.push({
            frame: debugCapture.frame,
            pairIndex,
            staff,
            noteId: sourceNote.id,
            noteIndex,
            keyIndex: renderedKey.keyIndex,
            pitch: renderedKey.pitch,
            noteXStatic,
            noteXPreview,
            noteXDelta: deltaOrNull(noteXPreview, noteXStatic),
            anchorXStatic,
            anchorXPreview,
            anchorXDelta: deltaOrNull(anchorXPreview, anchorXStatic),
            headXStatic,
            headXPreview,
            headXDelta: deltaOrNull(headXPreview, headXStatic),
            headYStatic,
            headYPreview,
            headYDelta: deltaOrNull(headYPreview, headYStatic),
            accidentalRightXStatic,
            accidentalRightXPreview,
            accidentalRightXDelta: deltaOrNull(accidentalRightXPreview, accidentalRightXStatic),
            hasAccidentalModifier: Boolean(renderedKey.accidental),
            accidentalTargetRightX: lockInfo?.targetRightX ?? null,
            accidentalLockApplied: lockInfo?.applied ?? false,
            accidentalLockReason: lockInfo?.reason ?? 'no-lock-record',
            accidentalPreviousOccupiedRightX: lockInfo?.previousOccupiedRightX ?? null,
            accidentalPreviousGapMeasured: lockInfo?.previousGapMeasured ?? null,
          })
        })
      })
    }

    captureDebugRowsForStaff('treble', measure.treble, trebleRenderedBySourceIndex)
    captureDebugRowsForStaff('bass', measure.bass, bassRenderedBySourceIndex)
    debugCapture.pushSnapshot({
      frame: debugCapture.frame,
      pairIndex,
      draggedNoteId: debugCapture.draggedNoteId,
      draggedStaff: debugCapture.draggedStaff,
      rows,
    })
  }


  if (!skipPainting) {
    trebleVoice.draw(context, trebleStave)
    bassVoice.draw(context, bassStave)
    trebleBeams.forEach((beam) => {
      const beamHighlightStyle = resolveBeamHighlightStyle({
        beam,
        staff: 'treble',
        sourceNotes: measure.treble,
        sourceNoteIndexByVexNote: trebleSourceNoteIndexByVexNote,
      })
      beam.setContext(context)
      if (beamHighlightStyle) {
        beam.setStyle(beamHighlightStyle).drawWithStyle()
        return
      }
      beam.draw()
    })
    bassBeams.forEach((beam) => {
      const beamHighlightStyle = resolveBeamHighlightStyle({
        beam,
        staff: 'bass',
        sourceNotes: measure.bass,
        sourceNoteIndexByVexNote: bassSourceNoteIndexByVexNote,
      })
      beam.setContext(context)
      if (beamHighlightStyle) {
        beam.setStyle(beamHighlightStyle).drawWithStyle()
        return
      }
      beam.draw()
    })
  }

  const getTieKeySpecs = (
    note: ScoreNote,
    renderedNote: { renderedKeys: RenderedNoteKey[] } | undefined,
  ): Array<{
    keyIndex: number
    pitch: Pitch
    tieStart: boolean
    tieStop: boolean
    frozenIncomingPitch: Pitch | null
    frozenIncomingFromNoteId: string | null
    frozenIncomingFromKeyIndex: number | null
  }> => {
    if (note.isRest) return []
    const renderedPitchByKeyIndex = new Map<number, Pitch>()
    renderedNote?.renderedKeys.forEach((entry) => {
      renderedPitchByKeyIndex.set(entry.keyIndex, entry.pitch)
    })
    const resolvePitch = (keyIndex: number, fallbackPitch: Pitch): Pitch =>
      renderedPitchByKeyIndex.get(keyIndex) ?? fallbackPitch
    const rootFrozenIncoming = getTieFrozenIncoming(note, 0)
    const specs: Array<{
      keyIndex: number
      pitch: Pitch
      tieStart: boolean
      tieStop: boolean
      frozenIncomingPitch: Pitch | null
      frozenIncomingFromNoteId: string | null
      frozenIncomingFromKeyIndex: number | null
    }> = [
      {
        keyIndex: 0,
        pitch: resolvePitch(0, note.pitch),
        tieStart: Boolean(note.tieStart),
        tieStop: Boolean(note.tieStop),
        frozenIncomingPitch: rootFrozenIncoming?.pitch ?? null,
        frozenIncomingFromNoteId: rootFrozenIncoming?.fromNoteId ?? null,
        frozenIncomingFromKeyIndex: rootFrozenIncoming?.fromKeyIndex ?? null,
      },
    ]
    ;(note.chordPitches ?? []).forEach((pitch, chordIndex) => {
      const frozenIncoming = getTieFrozenIncoming(note, chordIndex + 1)
      specs.push({
        keyIndex: chordIndex + 1,
        pitch: resolvePitch(chordIndex + 1, pitch),
        tieStart: Boolean(note.chordTieStarts?.[chordIndex]),
        tieStop: Boolean(note.chordTieStops?.[chordIndex]),
        frozenIncomingPitch: frozenIncoming?.pitch ?? null,
        frozenIncomingFromNoteId: frozenIncoming?.fromNoteId ?? null,
        frozenIncomingFromKeyIndex: frozenIncoming?.fromKeyIndex ?? null,
      })
    })
    return specs
  }

  const findRenderedIndexByKeyIndex = (
    rendered: { renderedKeys: RenderedNoteKey[] } | undefined,
    keyIndex: number,
  ): number => {
    if (!rendered) return -1
    return rendered.renderedKeys.findIndex((entry) => entry.keyIndex === keyIndex)
  }

  const findRenderedIndexByPitch = (
    rendered: { renderedKeys: RenderedNoteKey[] } | undefined,
    pitch: Pitch,
  ): number => {
    if (!rendered) return -1
    return rendered.renderedKeys.findIndex((entry) => entry.pitch === pitch)
  }

  const tieHighlightFill = selectionHighlightStyle.fillStyle
  const createTieAnchorNote = (y: number): StaveNote => ({ getYs: () => [y] }) as unknown as StaveNote

  const drawTieCurveByAnchors = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    direction: number,
    highlighted: boolean,
  ) => {
    const safeStartX = Math.min(startX, endX - 0.5)
    const safeEndX = Math.max(endX, startX + 0.5)
    const tie = new StaveTie({
      firstNote: createTieAnchorNote(startY),
      lastNote: createTieAnchorNote(endY),
      firstIndexes: [0],
      lastIndexes: [0],
    })
    if (highlighted) {
      context.save()
      context.setFillStyle(tieHighlightFill)
      context.setStrokeStyle(tieHighlightFill)
    }
    tie.setContext(context)
    tie.renderTie({
      firstX: safeStartX,
      lastX: safeEndX,
      firstYs: [startY],
      lastYs: [endY],
      direction,
    })
    if (highlighted) {
      context.restore()
    }
  }

  const getTieAnchorX = (
    renderedNote: { vexNote: StaveNote; renderedKeys: RenderedNoteKey[] } | undefined,
    renderedIndex: number,
  ): number | null => {
    if (!renderedNote) return null
    const raw = renderedNote.vexNote.noteHeads[renderedIndex]?.getAbsoluteX()
    if (Number.isFinite(raw)) return raw + 6
    const fallback = renderedNote.vexNote.getAbsoluteX()
    return Number.isFinite(fallback) ? fallback : null
  }

  const findFrozenIncomingTargetInMeasure = (params: {
    sourceNotes: ScoreNote[]
    rendered: Array<{ vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }>
    sourceNoteIndex: number
    sourceNoteId: string
    sourceKeyIndex: number
  }): { noteIndex: number; keyIndex: number; frozenPitch: Pitch } | null => {
    const {
      sourceNotes,
      rendered,
      sourceNoteIndex,
      sourceNoteId,
      sourceKeyIndex,
    } = params
    for (let candidateIndex = sourceNoteIndex + 1; candidateIndex < sourceNotes.length; candidateIndex += 1) {
      const candidate = sourceNotes[candidateIndex]
      if (!candidate || candidate.isRest) continue
      const specs = getTieKeySpecs(candidate, rendered[candidateIndex])
      const matched = specs.find(
        (spec) =>
          spec.tieStop &&
          spec.frozenIncomingPitch &&
          spec.frozenIncomingFromNoteId === sourceNoteId &&
          spec.frozenIncomingFromKeyIndex === sourceKeyIndex,
      )
      if (!matched || !matched.frozenIncomingPitch) continue
      return {
        noteIndex: candidateIndex,
        keyIndex: matched.keyIndex,
        frozenPitch: matched.frozenIncomingPitch,
      }
    }
    return null
  }

  const findGhostTargetInMeasure = (params: {
    sourceNotes: ScoreNote[]
    rendered: Array<{ vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }>
    sourceNoteIndex: number
  }): { noteIndex: number; keyIndex: number } | null => {
    const { sourceNotes, rendered, sourceNoteIndex } = params
    for (let candidateIndex = sourceNoteIndex + 1; candidateIndex < sourceNotes.length; candidateIndex += 1) {
      const candidate = sourceNotes[candidateIndex]
      if (!candidate || candidate.isRest) continue
      const renderedNext = rendered[candidateIndex]
      if (!renderedNext || renderedNext.renderedKeys.length === 0) continue
      const keyIndex = renderedNext.renderedKeys[0]?.keyIndex ?? 0
      return {
        noteIndex: candidateIndex,
        keyIndex: Number.isFinite(keyIndex) ? keyIndex : 0,
      }
    }
    return null
  }

  const resolveStopEndpointInMeasure = (params: {
    sourceNotes: ScoreNote[]
    rendered: Array<{ vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }>
    staff: StaffKind
    targetNoteIndex: number
    targetPitch: Pitch
  }): TieEndpoint | null => {
    const { sourceNotes, rendered, staff, targetNoteIndex, targetPitch } = params
    const note = sourceNotes[targetNoteIndex]
    if (!note || note.isRest) return null
    const specs = getTieKeySpecs(note, rendered[targetNoteIndex])
    const resolvedSpec =
      specs.find((spec) => spec.tieStop && spec.pitch === targetPitch) ??
      specs.find((spec) => spec.pitch === targetPitch) ??
      null
    if (!resolvedSpec) return null
    return {
      pairIndex,
      noteIndex: targetNoteIndex,
      staff,
      noteId: note.id,
      keyIndex: resolvedSpec.keyIndex,
      tieType: 'stop',
    }
  }

  const drawTiesForStaff = (
    sourceNotes: ScoreNote[],
    rendered: Array<{ vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }>,
    staff: StaffKind,
  ) => {
    if (isSpacingOnlyLayout) return

    for (let noteIndex = 0; noteIndex < sourceNotes.length; noteIndex += 1) {
      const sourceNote = sourceNotes[noteIndex]
      if (sourceNote.isRest) continue
      const renderedCurrent = rendered[noteIndex]
      if (!renderedCurrent) continue

      const tieSpecs = getTieKeySpecs(sourceNote, renderedCurrent)
      tieSpecs.forEach((spec) => {
        if (!spec.tieStart && !spec.tieStop) return

        const currentRenderedIndex = findRenderedIndexByKeyIndex(renderedCurrent, spec.keyIndex)
        if (currentRenderedIndex < 0) return
        const tieTargetKey = getDragPreviewTargetKey({
          pairIndex,
          staff,
          noteId: sourceNote.id,
          keyIndex: spec.keyIndex,
        })
        const tieDirection = getPitchLine(staff, spec.pitch) < 3 ? 1 : -1
        const sourceLayoutKey = getLayoutNoteKey(staff, sourceNote.id)
        const sourceStartEndpoint: TieEndpoint = {
          pairIndex,
          noteIndex,
          staff,
          noteId: sourceNote.id,
          keyIndex: spec.keyIndex,
          tieType: 'start',
        }
        const sourceStopEndpoint: TieEndpoint = {
          pairIndex,
          noteIndex,
          staff,
          noteId: sourceNote.id,
          keyIndex: spec.keyIndex,
          tieType: 'stop',
        }
        const drawInMeasureTieSegment = (params: {
          startX: number
          endX: number
          y: number
          endpoints: TieEndpoint[]
        }) => {
          const { startX, endX, y, endpoints } = params
          if (!Number.isFinite(startX) || !Number.isFinite(endX) || !Number.isFinite(y)) return
          const tieLayout = buildTieLayout({
            startX,
            startY: y,
            endX,
            endY: y,
            direction: tieDirection,
            endpoints,
          })
          appendInMeasureTieLayout(sourceLayoutKey, tieLayout)
          if (skipPainting) return
          drawTieCurveByAnchors(
            startX,
            y,
            endX,
            y,
            tieDirection,
            activeTieSegmentKey === tieLayout.key,
          )
        }

        if (spec.tieStart) {
          if (suppressedTieStartKeys?.has(tieTargetKey)) return
          if (
            previewFrozenBoundaryCurve &&
            previewFrozenBoundaryCurve.fromPairIndex === pairIndex &&
            previewFrozenBoundaryCurve.fromStaff === staff &&
            previewFrozenBoundaryCurve.fromNoteId === sourceNote.id &&
            previewFrozenBoundaryCurve.fromKeyIndex === spec.keyIndex
          ) {
            if (!skipPainting) {
              drawTieCurveByAnchors(
                previewFrozenBoundaryCurve.startX,
                previewFrozenBoundaryCurve.startY,
                previewFrozenBoundaryCurve.endX,
                previewFrozenBoundaryCurve.endY,
                tieDirection,
                false,
              )
            }
            return
          }

          const frozenTarget = findFrozenIncomingTargetInMeasure({
            sourceNotes,
            rendered,
            sourceNoteIndex: noteIndex,
            sourceNoteId: sourceNote.id,
            sourceKeyIndex: spec.keyIndex,
          })
          if (frozenTarget) {
              const renderedNext = rendered[frozenTarget.noteIndex]
              const nextRenderedIndex = findRenderedIndexByKeyIndex(renderedNext, frozenTarget.keyIndex)
              if (renderedNext && nextRenderedIndex >= 0) {
                const translatedY =
                  renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
                const startX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
                const endX = getTieAnchorX(renderedNext, nextRenderedIndex)
                if (
                  Number.isFinite(translatedY) &&
                  typeof startX === 'number' &&
                  Number.isFinite(startX) &&
                  typeof endX === 'number' &&
                  Number.isFinite(endX)
                ) {
                  const targetNote = sourceNotes[frozenTarget.noteIndex]
                  if (!targetNote) return
                  const targetEndpoint: TieEndpoint = {
                    pairIndex,
                    noteIndex: frozenTarget.noteIndex,
                    staff,
                    noteId: targetNote.id,
                    keyIndex: frozenTarget.keyIndex,
                    tieType: 'stop',
                  }
                  drawInMeasureTieSegment({
                    startX,
                    endX,
                    y: translatedY,
                    endpoints: [sourceStartEndpoint, targetEndpoint],
                  })
                  return
                }
              }
          }

          const renderedNext = rendered[noteIndex + 1]
          const nextRenderedIndex = findRenderedIndexByPitch(renderedNext, spec.pitch)
          if (renderedNext && nextRenderedIndex >= 0) {
            const translatedY =
              renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
            const startX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
            const endX = getTieAnchorX(renderedNext, nextRenderedIndex)
            if (
              Number.isFinite(translatedY) &&
              typeof startX === 'number' &&
              Number.isFinite(startX) &&
              typeof endX === 'number' &&
              Number.isFinite(endX)
            ) {
              const targetEndpoint = resolveStopEndpointInMeasure({
                sourceNotes,
                rendered,
                staff,
                targetNoteIndex: noteIndex + 1,
                targetPitch: spec.pitch,
              })
              drawInMeasureTieSegment({
                startX,
                endX,
                y: translatedY,
                endpoints: targetEndpoint ? [sourceStartEndpoint, targetEndpoint] : [sourceStartEndpoint],
              })
              return
            }
          }

          const ghostTarget = findGhostTargetInMeasure({
            sourceNotes,
            rendered,
            sourceNoteIndex: noteIndex,
          })
          if (ghostTarget) {
            const renderedGhost = rendered[ghostTarget.noteIndex]
            const ghostRenderedIndex = findRenderedIndexByKeyIndex(renderedGhost, ghostTarget.keyIndex)
            if (renderedGhost && ghostRenderedIndex >= 0) {
              const translatedY =
                renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
              const startX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
              const endX = getTieAnchorX(renderedGhost, ghostRenderedIndex)
              if (
                Number.isFinite(translatedY) &&
                typeof startX === 'number' &&
                Number.isFinite(startX) &&
                typeof endX === 'number' &&
                Number.isFinite(endX)
              ) {
                drawInMeasureTieSegment({
                  startX,
                  endX,
                  y: translatedY,
                  endpoints: [sourceStartEndpoint],
                })
                return
              }
            }
          } else if (renderBoundaryPartialTies) {
            const translatedY =
              renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
            const startX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
            const rightBoundaryX = measureX + measureWidth - 1
            if (
              Number.isFinite(translatedY) &&
              typeof startX === 'number' &&
              Number.isFinite(startX) &&
              Number.isFinite(rightBoundaryX) &&
              rightBoundaryX > startX + 0.5
            ) {
              drawInMeasureTieSegment({
                startX,
                endX: rightBoundaryX,
                y: translatedY,
                endpoints: [sourceStartEndpoint],
              })
            }
          }
        }

        if (spec.tieStop) {
          if (suppressedTieStopKeys?.has(tieTargetKey)) return
          if (spec.frozenIncomingPitch) return
          const previousNote = sourceNotes[noteIndex - 1]
          const previousRendered = rendered[noteIndex - 1]
          const hasIncomingTieInCurrentMeasure =
            noteIndex > 0 &&
            Boolean(previousNote) &&
            getTieKeySpecs(previousNote, previousRendered).some(
              (previousSpec) => previousSpec.tieStart && previousSpec.pitch === spec.pitch,
            )
          if (hasIncomingTieInCurrentMeasure) return

          if (renderBoundaryPartialTies) {
            const translatedY =
              renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
            const endX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
            const leftBoundaryX = measureX + 1
            if (
              Number.isFinite(translatedY) &&
              typeof endX === 'number' &&
              Number.isFinite(endX) &&
              Number.isFinite(leftBoundaryX) &&
              endX > leftBoundaryX + 0.5
            ) {
              drawInMeasureTieSegment({
                startX: leftBoundaryX,
                endX,
                y: translatedY,
                endpoints: [sourceStopEndpoint],
              })
            }
          }
        }
      })
    }
  }

  drawTiesForStaff(measure.treble, trebleRendered, 'treble')
  drawTiesForStaff(measure.bass, bassRendered, 'bass')
  if (!skipPainting && !isSpacingOnlyLayout && showNoteHeadJianpu) {
    const context2D = (context as unknown as { context2D?: CanvasRenderingContext2D }).context2D
    if (context2D) {
      drawRenderedNoteHeadNumerals({
        context2D,
        sourceNotes: measure.treble,
        rendered: trebleRendered,
      })
      drawRenderedNoteHeadNumerals({
        context2D,
        sourceNotes: measure.bass,
        rendered: bassRendered,
      })
    }
  }

  if (!collectLayouts) return noteLayouts

  if (isSpacingOnlyLayout) {
    const buildMinimalLayouts = (
      staff: StaffKind,
      sourceNotes: ScoreNote[],
      rendered: RenderedMeasureNote[],
    ): NoteLayout[] =>
      rendered.flatMap((renderedEntry) => {
        const sourceNote = sourceNotes[renderedEntry.sourceNoteIndex]
        if (!sourceNote) return []
        const vexNote = renderedEntry.vexNote
        const x = vexNote ? getRenderedNoteVisualX(vexNote) : 0
        const anchorX = vexNote ? getRenderedNoteAnchorX(vexNote) : x
        const visualBounds = vexNote ? getRenderedNoteGlyphBounds(vexNote) : null
        const visualBoundsY = vexNote
          ? (() => {
              const bbox = vexNote.getBoundingBox()
              const bboxTopY = bbox?.getY()
              const bboxHeight = bbox?.getH()
              if (Number.isFinite(bboxTopY) && Number.isFinite(bboxHeight)) {
                return {
                  topY: bboxTopY as number,
                  bottomY: (bboxTopY as number) + (bboxHeight as number),
                }
              }
              const fallbackY = vexNote.getYs()[0] ?? 0
              return {
                topY: fallbackY - DEFAULT_NOTE_HEAD_HIT_RADIUS_Y,
                bottomY: fallbackY + DEFAULT_NOTE_HEAD_HIT_RADIUS_Y,
              }
            })()
          : { topY: 0, bottomY: 0 }
        const hasStandaloneFlag = vexNote?.hasFlag() === true && !vexNote.getBeam()
        let spacingRightX = vexNote ? getRenderedNoteVisualX(vexNote) + 9 : x
        if (vexNote) {
          if (vexNote.hasStem()) {
            const stemX = vexNote.getStemX()
            if (Number.isFinite(stemX)) {
              spacingRightX = Math.max(spacingRightX, stemX + 1)
            }
          }
        }
        return {
          id: sourceNote.id,
          staff,
          pairIndex,
          noteIndex: renderedEntry.sourceNoteIndex,
          isRest: sourceNote.isRest === true,
          hasFlag: hasStandaloneFlag,
          x,
          anchorX,
          visualLeftX: visualBounds?.leftX ?? x,
          visualRightX: visualBounds?.rightX ?? spacingRightX,
          visualTopY: visualBoundsY.topY,
          visualBottomY: visualBoundsY.bottomY,
          rightX: spacingRightX,
          spacingRightX,
          y: 0,
          pitchYMap: {},
          noteHeads: [],
          accidentalLayouts: [],
          inMeasureTieLayouts: [],
          crossMeasureTieLayouts: [],
          accidentalRightXByKeyIndex: {},
          stemDirection: toStemDirectionOrNull(vexNote?.getStemDirection()),
        }
      })

    noteLayouts.push(...buildMinimalLayouts('treble', measure.treble, trebleRendered))
    noteLayouts.push(...buildMinimalLayouts('bass', measure.bass, bassRendered))
    return noteLayouts
  }

  const getRenderedNoteRightX = (
    vexNote: StaveNote,
    noteHeads: Array<{ x: number }>,
  ): number => {
    const fallbackRightX = noteHeads.reduce(
      (maxX, head) => Math.max(maxX, head.x),
      getRenderedNoteVisualX(vexNote),
    )
    const bbox = vexNote.getBoundingBox()
    const rightFromBBox = bbox ? bbox.getX() + bbox.getW() : Number.NEGATIVE_INFINITY

    let rightFromMetrics = Number.NEGATIVE_INFINITY
    try {
      const metrics = vexNote.getMetrics()
      const absoluteX = vexNote.getAbsoluteX()
      const metricRightEdge =
        absoluteX + metrics.notePx + metrics.rightDisplacedHeadPx + metrics.modRightPx
      if (Number.isFinite(metricRightEdge)) {
        rightFromMetrics = metricRightEdge
      }
    } catch {
      rightFromMetrics = Number.NEGATIVE_INFINITY
    }

    let rightFromStem = Number.NEGATIVE_INFINITY
    if (vexNote.hasStem()) {
      const stemX = vexNote.getStemX()
      if (Number.isFinite(stemX)) {
        rightFromStem = stemX + 1
      }
    }

    const computedRightX = Math.max(fallbackRightX, rightFromBBox, rightFromMetrics, rightFromStem)
    return Number.isFinite(computedRightX) ? computedRightX : fallbackRightX
  }

  const getRenderedNoteSpacingRightX = (
    vexNote: StaveNote,
    noteHeads: Array<{ x: number }>,
  ): number => {
    const fallbackHeadRightX = noteHeads.reduce(
      (maxX, head) => Math.max(maxX, head.x + 9),
      getRenderedNoteVisualX(vexNote) + 9,
    )
    const stemInvariantPadding = vexNote.hasStem() ? STEM_INVARIANT_RIGHT_PADDING_PX : 0
    const spacingRightX = fallbackHeadRightX + stemInvariantPadding
    return Number.isFinite(spacingRightX) ? spacingRightX : getRenderedNoteVisualX(vexNote) + 9
  }

  const getRenderedNoteVerticalBounds = (params: {
    vexNote: StaveNote
    noteHeads: Array<{ y: number; hitMinY?: number; hitMaxY?: number; hitRadiusY?: number }>
    accidentalLayouts: Array<{ y: number; hitMinY?: number; hitMaxY?: number; hitRadiusY?: number }>
  }): { topY: number; bottomY: number } => {
    const { vexNote, noteHeads, accidentalLayouts } = params
    const topCandidates: number[] = []
    const bottomCandidates: number[] = []

    const pushBounds = (topY: number, bottomY: number) => {
      if (!Number.isFinite(topY) || !Number.isFinite(bottomY) || bottomY < topY) return
      topCandidates.push(topY)
      bottomCandidates.push(bottomY)
    }

    const pushAnchorBounds = (
      anchors: Array<{ y: number; hitMinY?: number; hitMaxY?: number; hitRadiusY?: number }>,
      fallbackRadiusY: number,
    ) => {
      anchors.forEach((anchor) => {
        const radiusY = Number.isFinite(anchor.hitRadiusY) ? (anchor.hitRadiusY as number) : fallbackRadiusY
        const topY = Number.isFinite(anchor.hitMinY) ? (anchor.hitMinY as number) : anchor.y - radiusY
        const bottomY = Number.isFinite(anchor.hitMaxY) ? (anchor.hitMaxY as number) : anchor.y + radiusY
        pushBounds(topY, bottomY)
      })
    }

    pushAnchorBounds(noteHeads, DEFAULT_NOTE_HEAD_HIT_RADIUS_Y)
    pushAnchorBounds(accidentalLayouts, DEFAULT_ACCIDENTAL_HIT_RADIUS_Y)

    const bbox = vexNote.getBoundingBox()
    const bboxTopY = bbox?.getY()
    const bboxHeight = bbox?.getH()
    if (Number.isFinite(bboxTopY) && Number.isFinite(bboxHeight)) {
      pushBounds(bboxTopY as number, (bboxTopY as number) + (bboxHeight as number))
    }

    if (vexNote.hasStem()) {
      const stemExtents = vexNote.getStemExtents()
      pushBounds(
        Math.min(stemExtents.topY, stemExtents.baseY),
        Math.max(stemExtents.topY, stemExtents.baseY),
      )
    }

    if (topCandidates.length === 0 || bottomCandidates.length === 0) {
      const fallbackY = noteHeads[0]?.y ?? accidentalLayouts[0]?.y ?? (vexNote.getYs()[0] ?? 0)
      pushBounds(fallbackY - DEFAULT_NOTE_HEAD_HIT_RADIUS_Y, fallbackY + DEFAULT_NOTE_HEAD_HIT_RADIUS_Y)
    }

    return {
      topY: Math.min(...topCandidates),
      bottomY: Math.max(...bottomCandidates),
    }
  }

  const getBeamSegmentBounds = (beam: Beam): Array<{
    leftX: number
    rightX: number
    topY: number
    bottomY: number
  }> => {
    const beamNotes = beam.getNotes()
    const firstNote = beamNotes[0] as StaveNote | undefined
    if (!firstNote) return []
    const firstStemX = firstNote.getStemX()
    if (!Number.isFinite(firstStemX)) return []

    let beamY = beam.getBeamYToDraw()
    const beamThickness = beam.renderOptions.beamWidth * beam.getStemDirection()
    const bounds: Array<{
      leftX: number
      rightX: number
      topY: number
      bottomY: number
    }> = []

    VALID_BEAM_DURATIONS.forEach((duration) => {
      const beamLines = beam.getBeamLines(duration)
      beamLines.forEach((line) => {
        if (!Number.isFinite(line.start) || !Number.isFinite(line.end)) return
        const startBeamX = line.start as number
        const endBeamX = line.end as number
        const startBeamY = beam.getSlopeY(startBeamX, firstStemX, beamY, beam.slope)
        const endBeamY = beam.getSlopeY(endBeamX, firstStemX, beamY, beam.slope)
        const startEdgeY = startBeamY + beamThickness
        const endEdgeY = endBeamY + beamThickness
        bounds.push({
          leftX: Math.min(startBeamX, endBeamX + 1),
          rightX: Math.max(startBeamX, endBeamX + 1),
          topY: Math.min(startBeamY, endBeamY, startEdgeY, endEdgeY),
          bottomY: Math.max(startBeamY, endBeamY, startEdgeY, endEdgeY),
        })
      })
      beamY += beamThickness * 1.5
    })

    return bounds
  }

  const applyBeamVerticalBoundsToLayouts = (params: {
    beams: Beam[]
    sourceNoteIndexByVexNote: Map<StaveNote, number>
    layoutByNoteIndex: Map<number, NoteLayout>
  }) => {
    const { beams, sourceNoteIndexByVexNote, layoutByNoteIndex } = params
    beams.forEach((beam) => {
      const beamSegmentBounds = getBeamSegmentBounds(beam)
      if (beamSegmentBounds.length === 0) return
      beam.getNotes().forEach((note) => {
        const sourceNoteIndex = sourceNoteIndexByVexNote.get(note as StaveNote)
        if (sourceNoteIndex === undefined) return
        const layout = layoutByNoteIndex.get(sourceNoteIndex)
        if (!layout) return
        beamSegmentBounds.forEach((segment) => {
          if (layout.visualRightX < segment.leftX || layout.visualLeftX > segment.rightX) return
          layout.visualTopY = Math.min(layout.visualTopY, segment.topY)
          layout.visualBottomY = Math.max(layout.visualBottomY, segment.bottomY)
        })
      })
    })
  }

  const getMaxBeamRightX = (beams: Beam[]): number => {
    let maxRightX = Number.NEGATIVE_INFINITY
    beams.forEach((beam) => {
      VALID_BEAM_DURATIONS.forEach((duration) => {
        const beamLines = beam.getBeamLines(duration)
        beamLines.forEach((line) => {
          const start = line.start
          const end = line.end
          if (Number.isFinite(start)) {
            maxRightX = Math.max(maxRightX, start + 1)
          }
          if (typeof end === 'number' && Number.isFinite(end)) {
            maxRightX = Math.max(maxRightX, end + 1)
          }
        })
      })
    })
    return maxRightX
  }

  const treblePitchYMap = {} as Record<Pitch, number>
  const bassPitchYMap = {} as Record<Pitch, number>
  if (!isSpacingOnlyLayout) {
    for (const pitch of PITCHES) {
      treblePitchYMap[pitch] = trebleStave.getYForNote(PITCH_LINE_MAP.treble[pitch])
      bassPitchYMap[pitch] = bassStave.getYForNote(PITCH_LINE_MAP.bass[pitch])
    }

    const trebleExtraPitches = new Set<Pitch>()
    const bassExtraPitches = new Set<Pitch>()
    trebleRendered.forEach(({ renderedKeys }) => renderedKeys.forEach((entry) => trebleExtraPitches.add(entry.pitch)))
    bassRendered.forEach(({ renderedKeys }) => renderedKeys.forEach((entry) => bassExtraPitches.add(entry.pitch)))

    trebleExtraPitches.forEach((pitch) => {
      if (treblePitchYMap[pitch] !== undefined) return
      treblePitchYMap[pitch] = trebleStave.getYForNote(getPitchLine('treble', pitch))
    })
    bassExtraPitches.forEach((pitch) => {
      if (bassPitchYMap[pitch] !== undefined) return
      bassPitchYMap[pitch] = bassStave.getYForNote(getPitchLine('bass', pitch))
    })
  }

  const trebleNoteLayouts = trebleRendered.flatMap(({ vexNote, renderedKeys, sourceNoteIndex }) => {
      const sourceNote = measure.treble[sourceNoteIndex]
      if (!sourceNote) return []
      const layoutKey = getLayoutNoteKey('treble', sourceNote.id)
      const ys = vexNote.getYs()
      const noteBaseX = getRenderedNoteVisualX(vexNote)
      const renderedHeadXByIndex = new Map<number, number>()
      renderedKeys.forEach((_, renderedIndex) => {
        const headX = vexNote.noteHeads[renderedIndex]?.getAbsoluteX() ?? noteBaseX
        if (!Number.isFinite(headX)) return
        renderedHeadXByIndex.set(renderedIndex, headX)
      })
      const accidentalByRenderedIndex = getAccidentalRightXByRenderedIndex(vexNote)
      const accidentalRightXByKeyIndex: Record<number, number> = {}
      const accidentalModifiers = vexNote
        .getModifiersByType(Accidental.CATEGORY)
        .map((modifier) => modifier as Accidental)
      let accidentalLayouts = renderedKeys.flatMap((entry, renderedIndex) => {
        if (!entry.accidental) return []
        const rowKey = `${layoutKey}|${entry.keyIndex}`
        const lockInfo = accidentalLockByRowKey.get(rowKey)
        const { modifier, keyRenderedIndex } = resolveAccidentalModifierForRenderedKey({
          accidentalModifiers,
          renderedKeys,
          renderedKey: entry,
          fallbackRenderedIndex: renderedIndex,
        })
        const accidentalX = accidentalByRenderedIndex.get(keyRenderedIndex)
        if (accidentalX === undefined) return []
        const width = Number.isFinite(modifier?.getWidth()) ? (modifier?.getWidth() as number) : 8
        const resolvedMeasuredOwnHead = resolveMeasuredOwnHeadLeftX({
          vexNote,
          renderedIndex: keyRenderedIndex,
          noteBaseX,
        })
        const exactMeasuredBounds = modifier
          ? resolveMeasuredAccidentalBounds({
              vexNote,
              modifier,
              renderedIndex: keyRenderedIndex,
              fallbackWidth: width,
            })
          : null
        const visualLeftXExact = exactMeasuredBounds?.leftX ?? accidentalX
        const visualRightXExact = exactMeasuredBounds?.rightX ?? visualLeftXExact + width
        const ownHeadLeftXExact =
          typeof resolvedMeasuredOwnHead.ownHeadLeftX === 'number' && Number.isFinite(resolvedMeasuredOwnHead.ownHeadLeftX)
            ? resolvedMeasuredOwnHead.ownHeadLeftX
            : undefined
        const ownGapPxExact =
          typeof ownHeadLeftXExact === 'number' && Number.isFinite(visualRightXExact)
            ? ownHeadLeftXExact - visualRightXExact
            : undefined
        const measuredWidth =
          exactMeasuredBounds && Number.isFinite(exactMeasuredBounds.width) && exactMeasuredBounds.width > 0
            ? exactMeasuredBounds.width
            : width
        const centerX =
          Number.isFinite(visualLeftXExact) && Number.isFinite(visualRightXExact)
            ? (visualLeftXExact + visualRightXExact) / 2
            : accidentalX + measuredWidth / 2
        const centerY = ys[renderedIndex] ?? ys[0] ?? 0
        return [
          {
            keyIndex: entry.keyIndex,
            x: centerX,
            y: centerY,
            renderedAccidental: entry.accidental,
            visualLeftXExact,
            visualRightXExact,
            ownHeadLeftXExact,
            ownGapPxExact,
            reason: lockInfo?.reason,
            columnIndex:
              typeof lockInfo?.columnIndex === 'number' && Number.isFinite(lockInfo.columnIndex)
                ? lockInfo.columnIndex
                : undefined,
            columnBaseLeftX:
              typeof lockInfo?.columnBaseLeftX === 'number' && Number.isFinite(lockInfo.columnBaseLeftX)
                ? lockInfo.columnBaseLeftX
                : undefined,
            columnTargetLeftX:
              typeof lockInfo?.columnTargetLeftX === 'number' && Number.isFinite(lockInfo.columnTargetLeftX)
                ? lockInfo.columnTargetLeftX
                : undefined,
            columnAppliedDeltaX:
              typeof lockInfo?.columnAppliedDeltaX === 'number' && Number.isFinite(lockInfo.columnAppliedDeltaX)
                ? lockInfo.columnAppliedDeltaX
                : undefined,
            ...buildAccidentalHitGeometry({
              centerX,
              centerY,
              width: measuredWidth,
            }),
          },
        ]
      })
      const distinctMeasuredColumns = new Set(
        accidentalLayouts
          .map((layout) => layout.columnIndex)
          .filter((columnIndex): columnIndex is number => typeof columnIndex === 'number' && Number.isFinite(columnIndex)),
      )
      const columnCountMeasured =
        distinctMeasuredColumns.size > 0
          ? distinctMeasuredColumns.size
          : accidentalLayouts.length > 0
            ? 1
            : null
      const leftMostMeasured = accidentalLayouts.reduce((minValue, layout) => {
        const candidateLeftX =
          typeof layout.visualLeftXExact === 'number' && Number.isFinite(layout.visualLeftXExact)
            ? layout.visualLeftXExact
            : typeof layout.hitMinX === 'number' && Number.isFinite(layout.hitMinX)
              ? layout.hitMinX
              : Number.POSITIVE_INFINITY
        return Math.min(minValue, candidateLeftX)
      }, Number.POSITIVE_INFINITY)
      accidentalLayouts = accidentalLayouts.map((layout) => ({
        ...layout,
        columnCountMeasured,
        leftMostMeasured: Number.isFinite(leftMostMeasured) ? leftMostMeasured : null,
      }))
      renderedKeys.forEach((entry, renderedIndex) => {
        if (!entry.accidental) return
        const { keyRenderedIndex } = resolveAccidentalModifierForRenderedKey({
          accidentalModifiers,
          renderedKeys,
          renderedKey: entry,
          fallbackRenderedIndex: renderedIndex,
        })
        const offset = accidentalByRenderedIndex.get(keyRenderedIndex)
        if (offset === undefined) return
        accidentalRightXByKeyIndex[entry.keyIndex] = offset
      })
      const noteHeads = renderedKeys.map((entry, renderedIndex) => {
        const headX = renderedHeadXByIndex.get(renderedIndex) ?? getRenderedNoteVisualX(vexNote)
        const headY = ys[renderedIndex] ?? ys[0]
        const hitGeometry = buildNoteHeadHitGeometry({
          vexNote,
          renderedIndex,
          headX,
          headY,
        })
        return {
          x: headX,
          y: headY,
          pitch: entry.pitch,
          keyIndex: entry.keyIndex,
          ...hitGeometry,
        }
      })
      const rootHead = noteHeads.find((head) => head.keyIndex === 0) ?? noteHeads[0]
      const noteSpacingRightX = getRenderedNoteSpacingRightX(vexNote, noteHeads)
      const noteRightX = isSpacingOnlyLayout ? noteSpacingRightX : getRenderedNoteRightX(vexNote, noteHeads)
      const visualBounds = getRenderedNoteGlyphBounds(vexNote)
      const verticalBounds = getRenderedNoteVerticalBounds({
        vexNote,
        noteHeads,
        accidentalLayouts,
      })
      return {
        id: sourceNote.id,
        staff: 'treble' as const,
        pairIndex,
        noteIndex: sourceNoteIndex,
        isRest: sourceNote.isRest === true,
        hasFlag: vexNote.hasFlag() && !vexNote.getBeam(),
        x: getRenderedNoteVisualX(vexNote),
        anchorX: getRenderedNoteAnchorX(vexNote),
        visualLeftX: visualBounds?.leftX ?? getRenderedNoteVisualX(vexNote),
        visualRightX: visualBounds?.rightX ?? noteRightX,
        visualTopY: verticalBounds.topY,
        visualBottomY: verticalBounds.bottomY,
        rightX: noteRightX,
        spacingRightX: noteSpacingRightX,
        y: rootHead?.y ?? ys[0] ?? 0,
        pitchYMap: treblePitchYMap,
        noteHeads,
        accidentalLayouts,
        inMeasureTieLayouts: inMeasureTieLayoutsByLayoutKey.get(layoutKey) ?? [],
        crossMeasureTieLayouts: [],
        accidentalRightXByKeyIndex,
        stemDirection: toStemDirectionOrNull(vexNote.getStemDirection()),
      }
    })
  const bassNoteLayouts = bassRendered.flatMap(({ vexNote, renderedKeys, sourceNoteIndex }) => {
      const sourceNote = measure.bass[sourceNoteIndex]
      if (!sourceNote) return []
      const layoutKey = getLayoutNoteKey('bass', sourceNote.id)
      const ys = vexNote.getYs()
      const noteBaseX = getRenderedNoteVisualX(vexNote)
      const renderedHeadXByIndex = new Map<number, number>()
      renderedKeys.forEach((_, renderedIndex) => {
        const headX = vexNote.noteHeads[renderedIndex]?.getAbsoluteX() ?? noteBaseX
        if (!Number.isFinite(headX)) return
        renderedHeadXByIndex.set(renderedIndex, headX)
      })
      const accidentalByRenderedIndex = getAccidentalRightXByRenderedIndex(vexNote)
      const accidentalRightXByKeyIndex: Record<number, number> = {}
      const accidentalModifiers = vexNote
        .getModifiersByType(Accidental.CATEGORY)
        .map((modifier) => modifier as Accidental)
      let accidentalLayouts = renderedKeys.flatMap((entry, renderedIndex) => {
        if (!entry.accidental) return []
        const rowKey = `${layoutKey}|${entry.keyIndex}`
        const lockInfo = accidentalLockByRowKey.get(rowKey)
        const { modifier, keyRenderedIndex } = resolveAccidentalModifierForRenderedKey({
          accidentalModifiers,
          renderedKeys,
          renderedKey: entry,
          fallbackRenderedIndex: renderedIndex,
        })
        const accidentalX = accidentalByRenderedIndex.get(keyRenderedIndex)
        if (accidentalX === undefined) return []
        const width = Number.isFinite(modifier?.getWidth()) ? (modifier?.getWidth() as number) : 8
        const resolvedMeasuredOwnHead = resolveMeasuredOwnHeadLeftX({
          vexNote,
          renderedIndex: keyRenderedIndex,
          noteBaseX,
        })
        const exactMeasuredBounds = modifier
          ? resolveMeasuredAccidentalBounds({
              vexNote,
              modifier,
              renderedIndex: keyRenderedIndex,
              fallbackWidth: width,
            })
          : null
        const visualLeftXExact = exactMeasuredBounds?.leftX ?? accidentalX
        const visualRightXExact = exactMeasuredBounds?.rightX ?? visualLeftXExact + width
        const ownHeadLeftXExact =
          typeof resolvedMeasuredOwnHead.ownHeadLeftX === 'number' && Number.isFinite(resolvedMeasuredOwnHead.ownHeadLeftX)
            ? resolvedMeasuredOwnHead.ownHeadLeftX
            : undefined
        const ownGapPxExact =
          typeof ownHeadLeftXExact === 'number' && Number.isFinite(visualRightXExact)
            ? ownHeadLeftXExact - visualRightXExact
            : undefined
        const measuredWidth =
          exactMeasuredBounds && Number.isFinite(exactMeasuredBounds.width) && exactMeasuredBounds.width > 0
            ? exactMeasuredBounds.width
            : width
        const centerX =
          Number.isFinite(visualLeftXExact) && Number.isFinite(visualRightXExact)
            ? (visualLeftXExact + visualRightXExact) / 2
            : accidentalX + measuredWidth / 2
        const centerY = ys[renderedIndex] ?? ys[0] ?? 0
        return [
          {
            keyIndex: entry.keyIndex,
            x: centerX,
            y: centerY,
            renderedAccidental: entry.accidental,
            visualLeftXExact,
            visualRightXExact,
            ownHeadLeftXExact,
            ownGapPxExact,
            reason: lockInfo?.reason,
            columnIndex:
              typeof lockInfo?.columnIndex === 'number' && Number.isFinite(lockInfo.columnIndex)
                ? lockInfo.columnIndex
                : undefined,
            columnBaseLeftX:
              typeof lockInfo?.columnBaseLeftX === 'number' && Number.isFinite(lockInfo.columnBaseLeftX)
                ? lockInfo.columnBaseLeftX
                : undefined,
            columnTargetLeftX:
              typeof lockInfo?.columnTargetLeftX === 'number' && Number.isFinite(lockInfo.columnTargetLeftX)
                ? lockInfo.columnTargetLeftX
                : undefined,
            columnAppliedDeltaX:
              typeof lockInfo?.columnAppliedDeltaX === 'number' && Number.isFinite(lockInfo.columnAppliedDeltaX)
                ? lockInfo.columnAppliedDeltaX
                : undefined,
            ...buildAccidentalHitGeometry({
              centerX,
              centerY,
              width: measuredWidth,
            }),
          },
        ]
      })
      const distinctMeasuredColumns = new Set(
        accidentalLayouts
          .map((layout) => layout.columnIndex)
          .filter((columnIndex): columnIndex is number => typeof columnIndex === 'number' && Number.isFinite(columnIndex)),
      )
      const columnCountMeasured =
        distinctMeasuredColumns.size > 0
          ? distinctMeasuredColumns.size
          : accidentalLayouts.length > 0
            ? 1
            : null
      const leftMostMeasured = accidentalLayouts.reduce((minValue, layout) => {
        const candidateLeftX =
          typeof layout.visualLeftXExact === 'number' && Number.isFinite(layout.visualLeftXExact)
            ? layout.visualLeftXExact
            : typeof layout.hitMinX === 'number' && Number.isFinite(layout.hitMinX)
              ? layout.hitMinX
              : Number.POSITIVE_INFINITY
        return Math.min(minValue, candidateLeftX)
      }, Number.POSITIVE_INFINITY)
      accidentalLayouts = accidentalLayouts.map((layout) => ({
        ...layout,
        columnCountMeasured,
        leftMostMeasured: Number.isFinite(leftMostMeasured) ? leftMostMeasured : null,
      }))
      renderedKeys.forEach((entry, renderedIndex) => {
        if (!entry.accidental) return
        const { keyRenderedIndex } = resolveAccidentalModifierForRenderedKey({
          accidentalModifiers,
          renderedKeys,
          renderedKey: entry,
          fallbackRenderedIndex: renderedIndex,
        })
        const offset = accidentalByRenderedIndex.get(keyRenderedIndex)
        if (offset === undefined) return
        accidentalRightXByKeyIndex[entry.keyIndex] = offset
      })
      const noteHeads = renderedKeys.map((entry, renderedIndex) => {
        const headX = renderedHeadXByIndex.get(renderedIndex) ?? getRenderedNoteVisualX(vexNote)
        const headY = ys[renderedIndex] ?? ys[0]
        const hitGeometry = buildNoteHeadHitGeometry({
          vexNote,
          renderedIndex,
          headX,
          headY,
        })
        return {
          x: headX,
          y: headY,
          pitch: entry.pitch,
          keyIndex: entry.keyIndex,
          ...hitGeometry,
        }
      })
      const rootHead = noteHeads.find((head) => head.keyIndex === 0) ?? noteHeads[0]
      const noteSpacingRightX = getRenderedNoteSpacingRightX(vexNote, noteHeads)
      const noteRightX = isSpacingOnlyLayout ? noteSpacingRightX : getRenderedNoteRightX(vexNote, noteHeads)
      const visualBounds = getRenderedNoteGlyphBounds(vexNote)
      const verticalBounds = getRenderedNoteVerticalBounds({
        vexNote,
        noteHeads,
        accidentalLayouts,
      })
      return {
        id: sourceNote.id,
        staff: 'bass' as const,
        pairIndex,
        noteIndex: sourceNoteIndex,
        isRest: sourceNote.isRest === true,
        hasFlag: vexNote.hasFlag() && !vexNote.getBeam(),
        x: getRenderedNoteVisualX(vexNote),
        anchorX: getRenderedNoteAnchorX(vexNote),
        visualLeftX: visualBounds?.leftX ?? getRenderedNoteVisualX(vexNote),
        visualRightX: visualBounds?.rightX ?? noteRightX,
        visualTopY: verticalBounds.topY,
        visualBottomY: verticalBounds.bottomY,
        rightX: noteRightX,
        spacingRightX: noteSpacingRightX,
        y: rootHead?.y ?? ys[0] ?? 0,
        pitchYMap: bassPitchYMap,
        noteHeads,
        accidentalLayouts,
        inMeasureTieLayouts: inMeasureTieLayoutsByLayoutKey.get(layoutKey) ?? [],
        crossMeasureTieLayouts: [],
        accidentalRightXByKeyIndex,
        stemDirection: toStemDirectionOrNull(vexNote.getStemDirection()),
      }
    })
  noteLayouts.push(...trebleNoteLayouts)
  noteLayouts.push(...bassNoteLayouts)

  applyBeamVerticalBoundsToLayouts({
    beams: trebleBeams,
    sourceNoteIndexByVexNote: trebleSourceNoteIndexByVexNote,
    layoutByNoteIndex: new Map(trebleNoteLayouts.map((layout) => [layout.noteIndex, layout])),
  })
  applyBeamVerticalBoundsToLayouts({
    beams: bassBeams,
    sourceNoteIndexByVexNote: bassSourceNoteIndexByVexNote,
    layoutByNoteIndex: new Map(bassNoteLayouts.map((layout) => [layout.noteIndex, layout])),
  })

  if (!isSpacingOnlyLayout) {
    const beamRightX = getMaxBeamRightX([...trebleBeams, ...bassBeams])
    if (Number.isFinite(beamRightX) && noteLayouts.length > 0) {
      let rightMostLayoutIndex = 0
      for (let i = 1; i < noteLayouts.length; i += 1) {
        if (noteLayouts[i].rightX > noteLayouts[rightMostLayoutIndex].rightX) {
          rightMostLayoutIndex = i
        }
      }
      noteLayouts[rightMostLayoutIndex].rightX = Math.max(noteLayouts[rightMostLayoutIndex].rightX, beamRightX)
    }
  }

  return noteLayouts
}


