import { Accidental, Stem, type StaveNote } from 'vexflow'
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
  leftReservePx: number
  rightReservePx: number
}

type OnsetReserveExtents = {
  leftReservePx: number
  rightReservePx: number
}

type VexBoundingBoxLike = {
  getW?: () => number
}

type VexNoteHeadLike = {
  getAbsoluteX?: () => number
  getBoundingBox?: () => VexBoundingBoxLike | null
  getWidth?: () => number
  isDisplaced?: () => boolean
  preFormatted?: boolean
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
  spacingAnchorTicks?: number[] | null
  preferMeasureBarlineAxis?: boolean
  preferMeasureEndBarlineAxis?: boolean
  enableEdgeGapCap?: boolean
}

const MIN_RENDER_WIDTH_PX = 1
const DEFAULT_NOTE_HEAD_WIDTH_PX = 9
const TICKS_PER_QUARTER = 16
const DEFAULT_COMPACT_TAIL_ANCHOR_TICKS = 4
const UNIFORM_TICK_SPACING_START_GUARD_PX = 0
const UNIFORM_TICK_SPACING_END_GUARD_PX = 0
const UNIFORM_TIMELINE_EDGE_TICK_RATIO = 0
const ACCIDENTAL_PREALLOCATED_CLEARANCE_PX = 0
const STEM_INVARIANT_RIGHT_PADDING_PX = 3.5
const MAX_RENDERED_NOTE_HEAD_WIDTH_PX = DEFAULT_NOTE_HEAD_WIDTH_PX * 2.5
const MAX_NOTE_HEAD_COLUMN_OFFSET_PX = DEFAULT_NOTE_HEAD_WIDTH_PX * 5
const NOTE_HEAD_COLUMN_COMPARE_EPSILON_PX = 0.01
const BASE_GAP_UNIT_PX = 3.5
const MIN_GAP_BEATS = 1 / 32
const GAP_GAMMA = 0.7
const GAP_BASE_WEIGHT = 0.45

export type TimeAxisSpacingConfig = {
  minGapBeats: number
  gapGamma: number
  gapBaseWeight: number
  leadingBarlineGapPx: number
  interOnsetPaddingPx: number
  baseMinGap32Px: number
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
  leadingBarlineGapPx: 9.7,
  interOnsetPaddingPx: 1,
  baseMinGap32Px: 6.9,
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

function getRenderedNoteHeadWidth(noteHead: VexNoteHeadLike | null | undefined): number {
  const bboxWidth = noteHead?.getBoundingBox?.()?.getW?.()
  if (typeof bboxWidth === 'number' && Number.isFinite(bboxWidth) && bboxWidth > 0) {
    return Math.min(MAX_RENDERED_NOTE_HEAD_WIDTH_PX, bboxWidth)
  }
  const rawWidth = noteHead?.getWidth?.()
  if (typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0) {
    return Math.min(MAX_RENDERED_NOTE_HEAD_WIDTH_PX, rawWidth)
  }
  return DEFAULT_NOTE_HEAD_WIDTH_PX
}

function getRenderedNoteHeadAbsoluteX(params: {
  noteHead: VexNoteHeadLike | null | undefined
  anchorX: number
  stemDirection: number
}): number | null {
  const { noteHead, anchorX, stemDirection } = params
  const absoluteX = noteHead?.getAbsoluteX?.()
  const isPreFormatted = noteHead?.preFormatted === true
  if (
    isPreFormatted &&
    typeof absoluteX === 'number' &&
    Number.isFinite(absoluteX) &&
    Math.abs(absoluteX - anchorX) <= MAX_NOTE_HEAD_COLUMN_OFFSET_PX
  ) {
    return absoluteX
  }

  const headWidth = getRenderedNoteHeadWidth(noteHead)
  const isDisplaced = noteHead?.isDisplaced?.() === true
  const displacementPx = isDisplaced ? (headWidth - Stem.WIDTH / 2) * stemDirection : 0
  const displacementMultiplier = isPreFormatted ? 1 : 2
  return anchorX + displacementPx * displacementMultiplier
}

function getRenderedNoteHeadColumnReserves(vexNote: StaveNote, anchorX: number): {
  hasMultipleColumns: boolean
  leftColumnReservePx: number
  rightColumnReservePx: number
} {
  const noteHeads = (vexNote.noteHeads ?? []) as VexNoteHeadLike[]
  const stemDirection = vexNote.getStemDirection()
  if (noteHeads.length === 0) {
    return {
      hasMultipleColumns: false,
      leftColumnReservePx: 0,
      rightColumnReservePx: 0,
    }
  }

  let minHeadX = Number.POSITIVE_INFINITY
  let maxHeadX = Number.NEGATIVE_INFINITY
  const acceptedHeadXs: number[] = []
  const acceptedHeads: Array<{ x: number; isDisplaced: boolean }> = []

  noteHeads.forEach((noteHead) => {
    const headX = getRenderedNoteHeadAbsoluteX({
      noteHead,
      anchorX,
      stemDirection,
    })
    if (typeof headX !== 'number' || !Number.isFinite(headX)) return
    if (Math.abs(headX - anchorX) > MAX_NOTE_HEAD_COLUMN_OFFSET_PX) return
    minHeadX = Math.min(minHeadX, headX)
    maxHeadX = Math.max(maxHeadX, headX)
    acceptedHeadXs.push(headX)
    acceptedHeads.push({
      x: headX,
      isDisplaced: noteHead?.isDisplaced?.() === true,
    })
  })

  if (!Number.isFinite(minHeadX) || !Number.isFinite(maxHeadX) || acceptedHeadXs.length === 0) {
    return {
      hasMultipleColumns: false,
      leftColumnReservePx: 0,
      rightColumnReservePx: 0,
    }
  }

  const distinctColumns = acceptedHeadXs
    .map((headX) => Number(headX.toFixed(3)))
    .sort((left, right) => left - right)
    .filter((headX, index, list) => index === 0 || Math.abs(headX - list[index - 1]) > NOTE_HEAD_COLUMN_COMPARE_EPSILON_PX)
  const hasMultipleColumns = distinctColumns.length > 1

  const nonDisplacedHeadXs = acceptedHeads
    .filter((head) => head.isDisplaced !== true)
    .map((head) => head.x)
  const displacedHeadXs = acceptedHeads
    .filter((head) => head.isDisplaced === true)
    .map((head) => head.x)
  if (hasMultipleColumns && nonDisplacedHeadXs.length > 0 && displacedHeadXs.length > 0) {
    const primaryColumnMinX = nonDisplacedHeadXs.reduce((min, headX) => Math.min(min, headX), Number.POSITIVE_INFINITY)
    const primaryColumnMaxX = nonDisplacedHeadXs.reduce((max, headX) => Math.max(max, headX), Number.NEGATIVE_INFINITY)
    const displacedColumnMinX = displacedHeadXs.reduce((min, headX) => Math.min(min, headX), Number.POSITIVE_INFINITY)
    const displacedColumnMaxX = displacedHeadXs.reduce((max, headX) => Math.max(max, headX), Number.NEGATIVE_INFINITY)
    return {
      hasMultipleColumns,
      leftColumnReservePx: Math.max(0, primaryColumnMinX - displacedColumnMinX),
      rightColumnReservePx: Math.max(0, displacedColumnMaxX - primaryColumnMaxX),
    }
  }

  const columnShiftPx = Math.max(0, maxHeadX - minHeadX)
  return {
    hasMultipleColumns,
    leftColumnReservePx:
      hasMultipleColumns && columnShiftPx > NOTE_HEAD_COLUMN_COMPARE_EPSILON_PX && stemDirection === Stem.UP
        ? columnShiftPx
        : 0,
    rightColumnReservePx:
      hasMultipleColumns && columnShiftPx > NOTE_HEAD_COLUMN_COMPARE_EPSILON_PX && stemDirection === Stem.DOWN
        ? columnShiftPx
        : 0,
  }
}

function getRenderedNoteOccupiedBounds(vexNote: StaveNote): { leftX: number; rightX: number } | null {
  const noteHeads = (vexNote.noteHeads ?? []) as VexNoteHeadLike[]
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
  return {
    leftX: minX,
    rightX: maxX + (vexNote.hasStem() ? STEM_INVARIANT_RIGHT_PADDING_PX : 0),
  }
}

function getSpacingOccupiedBounds(refs: TimeAxisNoteRef[]): { leftX: number; rightX: number } | null {
  let leftX = Number.POSITIVE_INFINITY
  let rightX = Number.NEGATIVE_INFINITY

  refs.forEach((ref) => {
    const noteBounds = getRenderedNoteOccupiedBounds(ref.vexNote)
    if (!noteBounds) return
    leftX = Math.min(leftX, noteBounds.leftX)
    rightX = Math.max(rightX, noteBounds.rightX)
  })

  if (!Number.isFinite(leftX) || !Number.isFinite(rightX)) return null
  return { leftX, rightX }
}

function getSpacingOccupiedBoundsForTargetXs(params: {
  refs: TimeAxisNoteRef[]
  targetXByOnset: Map<number, number>
}): { leftX: number; rightX: number } | null {
  const { refs, targetXByOnset } = params
  let leftX = Number.POSITIVE_INFINITY
  let rightX = Number.NEGATIVE_INFINITY

  refs.forEach((ref) => {
    const noteBounds = getRenderedNoteOccupiedBounds(ref.vexNote)
    if (!noteBounds) return
    const currentX = getRenderedNoteVisualX(ref.vexNote)
    if (!Number.isFinite(currentX)) return
    const targetX = targetXByOnset.get(ref.onsetTicks)
    if (typeof targetX !== 'number' || !Number.isFinite(targetX)) return
    const deltaX = targetX - currentX
    leftX = Math.min(leftX, noteBounds.leftX + deltaX)
    rightX = Math.max(rightX, noteBounds.rightX + deltaX)
  })

  if (!Number.isFinite(leftX) || !Number.isFinite(rightX)) return null
  return { leftX, rightX }
}

function getNoteReserveExtents(vexNote: StaveNote): { leftReservePx: number; rightReservePx: number } {
  let leftReservePx = 0
  let rightReservePx = 0
  const noteHeadX = getRenderedNoteVisualX(vexNote)
  if (Number.isFinite(noteHeadX)) {
    const {
      hasMultipleColumns,
      leftColumnReservePx,
      rightColumnReservePx,
    } = getRenderedNoteHeadColumnReserves(vexNote, noteHeadX)
    if (hasMultipleColumns) {
      leftReservePx = Math.max(leftReservePx, leftColumnReservePx)
      rightReservePx = Math.max(rightReservePx, rightColumnReservePx)
    }

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
      leftReservePx = Math.max(
        leftReservePx,
        noteHeadX - accidentalMinX + ACCIDENTAL_PREALLOCATED_CLEARANCE_PX,
      )
    }
  }

  return { leftReservePx, rightReservePx }
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
        const extents = getNoteReserveExtents(renderedEntry.vexNote)
        refs.push({
          onsetTicks: cursorTicks,
          vexNote: renderedEntry.vexNote,
          leftReservePx: extents.leftReservePx,
          rightReservePx: extents.rightReservePx,
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

export type TimeAxisSpacingOnsetReserve = {
  onsetTicks: number
  baseX: number
  finalX: number
  leftReservePx: number
  rightReservePx: number
}

export type TimeAxisSpacingSegmentReserve = {
  fromOnsetTicks: number
  toOnsetTicks: number
  baseGapPx: number
  extraReservePx: number
  appliedGapPx: number
}

export function getLeadingBarlineGapPx(
  spacingConfig: TimeAxisSpacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
): number {
  if (!Number.isFinite(spacingConfig.leadingBarlineGapPx)) return 0
  return Math.max(0, spacingConfig.leadingBarlineGapPx)
}

function buildMeasureSpacingWeights(params: {
  spacingTicks: readonly number[]
  measureTicks: number
  spacingConfig?: TimeAxisSpacingConfig
}): MeasureSpacingWeights {
  const {
    spacingTicks,
    measureTicks,
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
  } = params
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
    const gapWeight = mapTickGapToWeight(deltaTicks, spacingConfig)
    segmentWeights.push(gapWeight)
    anchorSpanWeight += gapWeight
  }

  const lastTick = orderedTicks[orderedTicks.length - 1] ?? 0
  const trailingTailTicks = Math.max(0, safeMeasureTicks - lastTick)
  const trailingTailWeight = trailingTailTicks > 0 ? mapTickGapToWeight(trailingTailTicks, spacingConfig) : 0
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
    effectiveBoundaryEndX,
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

  const contentStartX = Math.min(
    effectiveBoundaryEndX,
    effectiveBoundaryStartX + Math.max(0, weights.leadingGapPx),
  )
  const distributableWidth = Math.max(0, effectiveBoundaryEndX - contentStartX)

  if (orderedTicks.length === 1) {
    tickToX.set(orderedTicks[0], contentStartX)
    return tickToX
  }

  if (weights.totalWeight <= 0) {
    const step = distributableWidth / Math.max(1, orderedTicks.length - 1)
    orderedTicks.forEach((tick, index) => {
      tickToX.set(tick, contentStartX + step * index)
    })
    return tickToX
  }

  tickToX.set(orderedTicks[0], contentStartX)
  let cumulative = 0
  for (let index = 1; index < orderedTicks.length; index += 1) {
    cumulative += weights.segmentWeights[index - 1] ?? 0
    tickToX.set(orderedTicks[index], contentStartX + distributableWidth * (cumulative / weights.totalWeight))
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

function getOnsetReserveExtents(noteRefs: TimeAxisNoteRef[] | undefined): OnsetReserveExtents {
  if (!noteRefs || noteRefs.length === 0) {
    return {
      leftReservePx: 0,
      rightReservePx: 0,
    }
  }
  return {
    leftReservePx: noteRefs.reduce((max, ref) => Math.max(max, ref.leftReservePx), 0),
    rightReservePx: noteRefs.reduce((max, ref) => Math.max(max, ref.rightReservePx), 0),
  }
}

function buildBaseTargetXByOnset(params: {
  onsetTicks: number[]
  axisStart: number
  axisEnd: number
  spacingWeights: MeasureSpacingWeights
  uniformSpacingByTicks: boolean
  publicAxisLayout: PublicAxisLayout | null
}): Map<number, number> {
  const { onsetTicks, axisStart, axisEnd, spacingWeights, uniformSpacingByTicks, publicAxisLayout } = params
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

  const distributableWidth = Math.max(0, axisEnd - axisStart)

  if (uniformSpacingByTicks) {
    if (onsetTicks.length === 1 || spacingWeights.totalWeight <= 0.0001) {
      onsetTicks.forEach((onset) => {
        targetXByOnset.set(onset, axisStart)
      })
      return targetXByOnset
    }
    targetXByOnset.set(onsetTicks[0] as number, axisStart)
    let cumulativeWeight = 0
    for (let index = 1; index < onsetTicks.length; index += 1) {
      cumulativeWeight += spacingWeights.segmentWeights[index - 1] ?? 0
      targetXByOnset.set(
        onsetTicks[index] as number,
        axisStart + distributableWidth * (cumulativeWeight / Math.max(0.0001, spacingWeights.totalWeight)),
      )
    }
    return targetXByOnset
  }

  if (axisEnd <= axisStart) {
    onsetTicks.forEach((onset) => {
      targetXByOnset.set(onset, axisStart)
    })
    return targetXByOnset
  }

  if (onsetTicks.length === 1) {
    targetXByOnset.set(onsetTicks[0] as number, axisStart)
    return targetXByOnset
  }

  const totalWeight = Math.max(0, spacingWeights.totalWeight)
  if (totalWeight <= 0.0001) {
    const step = distributableWidth / (onsetTicks.length - 1)
    onsetTicks.forEach((onset, index) => {
      targetXByOnset.set(onset, axisStart + step * index)
    })
    return targetXByOnset
  }

  targetXByOnset.set(onsetTicks[0] as number, axisStart)
  let cumulative = 0
  for (let index = 1; index < onsetTicks.length; index += 1) {
    cumulative += spacingWeights.segmentWeights[index - 1] ?? 0
    targetXByOnset.set(onsetTicks[index] as number, axisStart + distributableWidth * (cumulative / totalWeight))
  }
  return targetXByOnset
}

function applyLocalReserveOverlay(params: {
  onsetTicks: number[]
  baseTargetXByOnset: Map<number, number>
  onsetReservesByTick: OnsetReserveExtents[]
  appliedLeftReservePxByIndex?: number[]
  appliedRightReservePxByIndex?: number[]
}): {
  finalTargetXByOnset: Map<number, number>
  onsetReserves: TimeAxisSpacingOnsetReserve[]
  spacingSegments: TimeAxisSpacingSegmentReserve[]
} {
  const {
    onsetTicks,
    baseTargetXByOnset,
    onsetReservesByTick,
    appliedLeftReservePxByIndex,
    appliedRightReservePxByIndex,
  } = params
  const finalTargetXByOnset = new Map<number, number>()
  const onsetReserves: TimeAxisSpacingOnsetReserve[] = []
  const spacingSegments: TimeAxisSpacingSegmentReserve[] = []
  if (onsetTicks.length === 0) {
    return {
      finalTargetXByOnset,
      onsetReserves,
      spacingSegments,
    }
  }

  const safeLeftReserves = onsetTicks.map((_, index) =>
    Math.max(0, appliedLeftReservePxByIndex?.[index] ?? onsetReservesByTick[index]?.leftReservePx ?? 0),
  )
  const safeRightReserves = onsetTicks.map((_, index) =>
    Math.max(0, appliedRightReservePxByIndex?.[index] ?? onsetReservesByTick[index]?.rightReservePx ?? 0),
  )
  const baseXs = onsetTicks.map((onset, index) => {
    const baseX = baseTargetXByOnset.get(onset)
    if (typeof baseX === 'number' && Number.isFinite(baseX)) {
      return baseX
    }
    const previousBaseX = index > 0 ? finalTargetXByOnset.get(onsetTicks[index - 1] as number) : null
    return typeof previousBaseX === 'number' && Number.isFinite(previousBaseX) ? previousBaseX : 0
  })

  const firstFinalX = baseXs[0] + safeLeftReserves[0]
  finalTargetXByOnset.set(onsetTicks[0] as number, firstFinalX)
  onsetReserves.push({
    onsetTicks: onsetTicks[0] as number,
    baseX: baseXs[0],
    finalX: firstFinalX,
    leftReservePx: safeLeftReserves[0],
    rightReservePx: safeRightReserves[0],
  })

  for (let index = 1; index < onsetTicks.length; index += 1) {
    const previousFinalX = finalTargetXByOnset.get(onsetTicks[index - 1] as number) ?? firstFinalX
    const baseGapPx = Math.max(0, baseXs[index] - baseXs[index - 1])
    const extraReservePx = safeRightReserves[index - 1] + safeLeftReserves[index]
    const finalX = previousFinalX + baseGapPx + extraReservePx
    finalTargetXByOnset.set(onsetTicks[index] as number, finalX)
    onsetReserves.push({
      onsetTicks: onsetTicks[index] as number,
      baseX: baseXs[index],
      finalX,
      leftReservePx: safeLeftReserves[index],
      rightReservePx: safeRightReserves[index],
    })
    spacingSegments.push({
      fromOnsetTicks: onsetTicks[index - 1] as number,
      toOnsetTicks: onsetTicks[index] as number,
      baseGapPx,
      extraReservePx,
      appliedGapPx: baseGapPx + extraReservePx,
    })
  }

  return {
    finalTargetXByOnset,
    onsetReserves,
    spacingSegments,
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
  const onsetReservesByTick = onsetTicks.map((onset) => getOnsetReserveExtents(refsByOnset.get(onset)))

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
  const spacingWeights = buildMeasureSpacingWeights({
    spacingTicks: onsetTicks,
    measureTicks: measureTotalTicks,
    spacingConfig,
  })
  const axisStart = Math.min(
    axisBoundaryEnd,
    axisBoundaryStart + Math.max(0, spacingWeights.leadingGapPx),
  )
  const axisEnd = Math.max(axisStart, axisBoundaryEnd)
  const baseTargetXByOnset = buildBaseTargetXByOnset({
    onsetTicks,
    axisStart,
    axisEnd,
    spacingWeights,
    uniformSpacingByTicks,
    publicAxisLayout,
  })
  const appliedLeftReservePxByIndex = onsetReservesByTick.map((entry) => entry.leftReservePx)
  const appliedRightReservePxByIndex = onsetReservesByTick.map((entry) => entry.rightReservePx)
  let overlay = applyLocalReserveOverlay({
    onsetTicks,
    baseTargetXByOnset,
    onsetReservesByTick,
    appliedLeftReservePxByIndex,
    appliedRightReservePxByIndex,
  })
  let occupiedBounds = getSpacingOccupiedBoundsForTargetXs({
    refs,
    targetXByOnset: overlay.finalTargetXByOnset,
  })
  if (typeof barlineAxisBoundaryEnd === 'number' && Number.isFinite(barlineAxisBoundaryEnd)) {
    const maxClampIterations = Math.max(1, onsetTicks.length * 2)
    for (let iteration = 0; iteration < maxClampIterations; iteration += 1) {
      const barlineOverflowPx =
        occupiedBounds && Number.isFinite(occupiedBounds.rightX)
          ? Math.max(0, occupiedBounds.rightX - barlineAxisBoundaryEnd)
          : 0
      if (barlineOverflowPx <= 0.001) break

      let reducibleKind: 'left' | 'right' | null = null
      let reducibleIndex = -1
      let reducibleStartIndex = -1
      for (let index = onsetTicks.length - 1; index >= 0; index -= 1) {
        const leftReservePx = appliedLeftReservePxByIndex[index] ?? 0
        if (leftReservePx > 0.001 && index >= reducibleStartIndex) {
          reducibleKind = 'left'
          reducibleIndex = index
          reducibleStartIndex = index
        }
        const rightReservePx = appliedRightReservePxByIndex[index] ?? 0
        const rightReserveStartIndex = index + 1
        if (rightReservePx > 0.001 && rightReserveStartIndex >= reducibleStartIndex && rightReserveStartIndex < onsetTicks.length) {
          reducibleKind = 'right'
          reducibleIndex = index
          reducibleStartIndex = rightReserveStartIndex
        }
      }
      if (reducibleKind === null || reducibleIndex < 0) break

      if (reducibleKind === 'left') {
        const currentValue = appliedLeftReservePxByIndex[reducibleIndex] ?? 0
        appliedLeftReservePxByIndex[reducibleIndex] = Math.max(0, currentValue - Math.min(barlineOverflowPx, currentValue))
      } else {
        const currentValue = appliedRightReservePxByIndex[reducibleIndex] ?? 0
        appliedRightReservePxByIndex[reducibleIndex] = Math.max(0, currentValue - Math.min(barlineOverflowPx, currentValue))
      }

      overlay = applyLocalReserveOverlay({
        onsetTicks,
        baseTargetXByOnset,
        onsetReservesByTick,
        appliedLeftReservePxByIndex,
        appliedRightReservePxByIndex,
      })
      occupiedBounds = getSpacingOccupiedBoundsForTargetXs({
        refs,
        targetXByOnset: overlay.finalTargetXByOnset,
      })
    }
  }
  const { finalTargetXByOnset, onsetReserves, spacingSegments } = overlay

  refs.forEach((ref) => {
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

  const resolvedOccupiedBounds = getSpacingOccupiedBounds(refs)
  const spacingOccupiedLeftX = resolvedOccupiedBounds?.leftX ?? resolvedFirstX
  const spacingOccupiedRightX = resolvedOccupiedBounds?.rightX ?? resolvedLastX
  const spacingAnchorGapFirstToLastPx = Math.max(0, resolvedLastX - resolvedFirstX)
  const leadingGapPx = spacingOccupiedLeftX - axisBoundaryStart
  const trailingGapPx = axisBoundaryEnd - spacingOccupiedRightX
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
