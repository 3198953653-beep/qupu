import { DURATION_TICKS } from './constants'
import {
  decomposeRestSpanNoDot,
  getMeasureTicksByTimeSignature,
  isXOver4TimeSignature,
} from './rhythmRegroup'
import { createImportedNoteId, createNoteId, splitTicksToDurations } from './scoreOps'
import type {
  MeasurePair,
  NoteDuration,
  ScoreNote,
  StaffKind,
  TimeSignature,
} from './types'

export const REST_ANCHOR_PITCH_BY_STAFF: Record<StaffKind, string> = {
  treble: 'b/4',
  bass: 'd/3',
}

function sanitizeTimeSignature(value: TimeSignature | null | undefined): TimeSignature | null {
  if (!value) return null
  if (
    !Number.isFinite(value.beats) ||
    value.beats <= 0 ||
    !Number.isFinite(value.beatType) ||
    value.beatType <= 0
  ) {
    return null
  }
  return {
    beats: Math.max(1, Math.round(value.beats)),
    beatType: Math.max(1, Math.round(value.beatType)),
  }
}

export function resolvePairTimeSignature(
  pairIndex: number,
  timeSignaturesByMeasure?: TimeSignature[] | null,
): TimeSignature {
  if (!timeSignaturesByMeasure || timeSignaturesByMeasure.length === 0) {
    return { beats: 4, beatType: 4 }
  }
  for (let index = pairIndex; index >= 0; index -= 1) {
    const candidate = sanitizeTimeSignature(timeSignaturesByMeasure[index])
    if (candidate) return candidate
  }
  return { beats: 4, beatType: 4 }
}

export function resolvePairKeyFifths(pairIndex: number, keyFifthsByMeasure?: number[] | null): number {
  if (!keyFifthsByMeasure || keyFifthsByMeasure.length === 0) return 0
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyFifthsByMeasure[index]
    if (Number.isFinite(value)) return Math.trunc(value)
  }
  return 0
}

export function resolveKeyFifthsSeries(pairCount: number, keyFifthsByMeasure?: number[] | null): number[] {
  if (pairCount <= 0) return []
  const series: number[] = []
  for (let index = 0; index < pairCount; index += 1) {
    series.push(resolvePairKeyFifths(index, keyFifthsByMeasure))
  }
  return series
}

function getTotalTicksForDurations(durations: NoteDuration[]): number {
  return durations.reduce((sum, duration) => sum + (DURATION_TICKS[duration] ?? 0), 0)
}

export function getTotalTicksForNotes(notes: ScoreNote[]): number {
  return notes.reduce((sum, note) => sum + (DURATION_TICKS[note.duration] ?? 0), 0)
}

export function decomposeMeasureRestDurations(timeSignature: TimeSignature): NoteDuration[] | null {
  const measureTicks = getMeasureTicksByTimeSignature(timeSignature)
  const durations = isXOver4TimeSignature(timeSignature)
    ? decomposeRestSpanNoDot({
        startTick: 0,
        endTick: measureTicks,
        measureTicks,
        timeSignature,
      })
    : splitTicksToDurations(measureTicks)

  if (!durations) return null
  if (getTotalTicksForDurations(durations) !== measureTicks) return null
  return durations
}

export function isStaffFullMeasureRest(notes: ScoreNote[], timeSignature: TimeSignature): boolean {
  if (notes.length === 0) return false
  if (notes.some((note) => !note.isRest)) return false
  return getTotalTicksForNotes(notes) === getMeasureTicksByTimeSignature(timeSignature)
}

export function buildMeasureRestNotes(params: {
  staff: StaffKind
  timeSignature: TimeSignature
  importedMode: boolean
  firstNoteId?: string | null
}): ScoreNote[] | null {
  const { staff, timeSignature, importedMode, firstNoteId = null } = params
  const durations = decomposeMeasureRestDurations(timeSignature)
  if (!durations || durations.length === 0) return null
  return durations.map((duration, index) => ({
    id: index === 0 && firstNoteId ? firstNoteId : importedMode ? createImportedNoteId(staff) : createNoteId(),
    pitch: REST_ANCHOR_PITCH_BY_STAFF[staff],
    duration,
    isRest: true,
  }))
}

export function getStaffNotesFromPair(pair: MeasurePair, staff: StaffKind): ScoreNote[] {
  return staff === 'treble' ? pair.treble : pair.bass
}
