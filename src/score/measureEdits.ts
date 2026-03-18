import { normalizeMeasurePairAt } from './accidentals'
import {
  buildMeasureRestNotes,
  getStaffNotesFromPair,
  resolveKeyFifthsSeries,
  resolvePairTimeSignature,
} from './measureRestUtils'
import type {
  MeasurePair,
  ScoreNote,
  Selection,
  StaffKind,
  TimeSignature,
} from './types'

export type MeasureDeleteFailureReason =
  | 'selection-not-found'
  | 'invalid-scope'
  | 'unsupported-grouping'

export type MeasureDeleteResult = {
  nextPairs: MeasurePair[]
  nextSelection: Selection
  nextSelections: Selection[]
  changedPairIndices: number[]
}

type MeasureDeleteAttempt = {
  result: MeasureDeleteResult | null
  error: MeasureDeleteFailureReason | null
}

function clearOutgoingTieFields(note: ScoreNote): ScoreNote {
  if (note.tieStart === undefined && note.chordTieStarts === undefined) return note
  const next = { ...note }
  delete next.tieStart
  delete next.chordTieStarts
  return next
}

function clearIncomingTieFields(note: ScoreNote): ScoreNote {
  const hasIncomingTieFields =
    note.tieStop !== undefined ||
    note.chordTieStops !== undefined ||
    note.tieFrozenIncomingPitch !== undefined ||
    note.tieFrozenIncomingFromNoteId !== undefined ||
    note.tieFrozenIncomingFromKeyIndex !== undefined ||
    note.chordTieFrozenIncomingPitches !== undefined ||
    note.chordTieFrozenIncomingFromNoteIds !== undefined ||
    note.chordTieFrozenIncomingFromKeyIndices !== undefined
  if (!hasIncomingTieFields) return note
  const next = { ...note }
  delete next.tieStop
  delete next.chordTieStops
  delete next.tieFrozenIncomingPitch
  delete next.tieFrozenIncomingFromNoteId
  delete next.tieFrozenIncomingFromKeyIndex
  delete next.chordTieFrozenIncomingPitches
  delete next.chordTieFrozenIncomingFromNoteIds
  delete next.chordTieFrozenIncomingFromKeyIndices
  return next
}

function replaceStaffNotes(pair: MeasurePair, staff: StaffKind, notes: ScoreNote[]): MeasurePair {
  return staff === 'treble'
    ? { treble: notes, bass: pair.bass }
    : { treble: pair.treble, bass: notes }
}

function updateStaffNoteAt(params: {
  pairs: MeasurePair[]
  pairIndex: number
  staff: StaffKind
  noteIndex: number
  changedPairIndices: Set<number>
  transform: (note: ScoreNote) => ScoreNote
}): void {
  const { pairs, pairIndex, staff, noteIndex, changedPairIndices, transform } = params
  const pair = pairs[pairIndex]
  if (!pair) return
  const sourceNotes = getStaffNotesFromPair(pair, staff)
  const sourceNote = sourceNotes[noteIndex]
  if (!sourceNote) return
  const nextNote = transform(sourceNote)
  if (nextNote === sourceNote) return
  const nextNotes = sourceNotes.slice()
  nextNotes[noteIndex] = nextNote
  pairs[pairIndex] = replaceStaffNotes(pair, staff, nextNotes)
  changedPairIndices.add(pairIndex)
}

export function applyDeleteMeasureSelection(params: {
  pairs: MeasurePair[]
  selectedMeasureScope: { pairIndex: number; staff: StaffKind } | null
  importedMode: boolean
  keyFifthsByMeasure?: number[] | null
  timeSignaturesByMeasure?: TimeSignature[] | null
}): MeasureDeleteAttempt {
  const {
    pairs,
    selectedMeasureScope,
    importedMode,
    keyFifthsByMeasure = null,
    timeSignaturesByMeasure = null,
  } = params
  if (!selectedMeasureScope) {
    return { result: null, error: 'invalid-scope' }
  }

  const { pairIndex, staff } = selectedMeasureScope
  if (!Number.isFinite(pairIndex) || pairIndex < 0 || pairIndex >= pairs.length) {
    return { result: null, error: 'selection-not-found' }
  }

  const sourcePair = pairs[pairIndex]
  if (!sourcePair) {
    return { result: null, error: 'selection-not-found' }
  }

  const sourceStaffNotes = getStaffNotesFromPair(sourcePair, staff)
  const firstNoteId = sourceStaffNotes[0]?.id ?? null
  const timeSignature = resolvePairTimeSignature(pairIndex, timeSignaturesByMeasure)
  const replacementRests = buildMeasureRestNotes({
    staff,
    timeSignature,
    importedMode,
    firstNoteId,
  })
  if (!replacementRests || replacementRests.length === 0) {
    return { result: null, error: 'unsupported-grouping' }
  }

  const nextPairs = pairs.slice()
  const changedPairIndices = new Set<number>()
  nextPairs[pairIndex] = replaceStaffNotes(sourcePair, staff, replacementRests)
  changedPairIndices.add(pairIndex)

  const previousPair = nextPairs[pairIndex - 1]
  if (previousPair) {
    const previousNotes = getStaffNotesFromPair(previousPair, staff)
    if (previousNotes.length > 0) {
      updateStaffNoteAt({
        pairs: nextPairs,
        pairIndex: pairIndex - 1,
        staff,
        noteIndex: previousNotes.length - 1,
        changedPairIndices,
        transform: clearOutgoingTieFields,
      })
    }
  }

  const nextPair = nextPairs[pairIndex + 1]
  if (nextPair) {
    const nextNotes = getStaffNotesFromPair(nextPair, staff)
    if (nextNotes.length > 0) {
      updateStaffNoteAt({
        pairs: nextPairs,
        pairIndex: pairIndex + 1,
        staff,
        noteIndex: 0,
        changedPairIndices,
        transform: clearIncomingTieFields,
      })
    }
  }

  let normalizedPairs = nextPairs
  const sortedChangedPairIndices = [...changedPairIndices].sort((left, right) => left - right)
  if (sortedChangedPairIndices.length > 0) {
    const keyFifthsSeries = resolveKeyFifthsSeries(nextPairs.length, keyFifthsByMeasure)
    for (const changedPairIndex of sortedChangedPairIndices) {
      normalizedPairs = normalizeMeasurePairAt(normalizedPairs, changedPairIndex, keyFifthsSeries)
    }
  }

  const normalizedPair = normalizedPairs[pairIndex]
  if (!normalizedPair) {
    return { result: null, error: 'selection-not-found' }
  }
  const normalizedStaffNotes = getStaffNotesFromPair(normalizedPair, staff)
  const representative = normalizedStaffNotes[0]
  if (!representative) {
    return { result: null, error: 'selection-not-found' }
  }

  const nextSelection: Selection = {
    noteId: representative.id,
    staff,
    keyIndex: 0,
  }

  return {
    result: {
      nextPairs: normalizedPairs,
      nextSelection,
      nextSelections: [nextSelection],
      changedPairIndices: sortedChangedPairIndices,
    },
    error: null,
  }
}
