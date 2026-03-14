import { normalizeMeasurePairAt } from './accidentals'
import { applyDurationChangeAtTargetLocation, resolveEditableSelectionTarget, type DurationEditFailureReason } from './durationEdits'
import { findSelectionLocationInPairs } from './keyboardEdits'
import type { NoteClipboardPayload } from './copyPasteTypes'
import type {
  ImportedNoteLocation,
  MeasurePair,
  Pitch,
  ScoreNote,
  Selection,
  StaffKind,
  TimeSignature,
} from './types'

export type CopyPasteFailureReason =
  | 'no-selection'
  | 'multi-timepoint'
  | 'selection-not-found'
  | 'rest-source'
  | 'clipboard-empty'
  | DurationEditFailureReason

export type CopyPasteResult = {
  nextPairs: MeasurePair[]
  nextSelection: Selection
  nextSelections: Selection[]
}

type ResolvedSingleTimepointSelectionGroup = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
  note: ScoreNote
  selectedKeyIndices: number[]
}

function resolvePairKeyFifths(pairIndex: number, keyFifthsByMeasure?: number[] | null): number {
  if (!keyFifthsByMeasure || keyFifthsByMeasure.length === 0) return 0
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyFifthsByMeasure[index]
    if (Number.isFinite(value)) return Math.trunc(value)
  }
  return 0
}

function getPitchAtKeyIndex(note: ScoreNote, keyIndex: number): Pitch | null {
  if (keyIndex <= 0) return note.pitch ?? null
  const chordPitch = note.chordPitches?.[keyIndex - 1]
  return chordPitch ?? null
}

function resolveSelectedKeyIndices(note: ScoreNote, selections: Selection[], fallbackKeyIndex: number): number[] {
  const maxKeyIndex = note.chordPitches?.length ?? 0
  const toSafeKeyIndex = (value: number): number => {
    if (!Number.isFinite(value)) return 0
    const rounded = Math.trunc(value)
    if (rounded < 0) return 0
    if (rounded > maxKeyIndex) return maxKeyIndex
    return rounded
  }

  const unique = new Set<number>()
  selections.forEach((selection) => {
    unique.add(toSafeKeyIndex(selection.keyIndex))
  })
  if (unique.size === 0) {
    unique.add(toSafeKeyIndex(fallbackKeyIndex))
  }
  return [...unique].sort((left, right) => left - right)
}

function clearOutgoingTieFields(note: ScoreNote): ScoreNote {
  const next: ScoreNote = { ...note }
  delete next.tieStart
  delete next.chordTieStarts
  return next
}

function clearChordSpecificTieFields(note: ScoreNote): ScoreNote {
  const next: ScoreNote = { ...note }
  delete next.chordTieStops
  delete next.chordTieFrozenIncomingPitches
  delete next.chordTieFrozenIncomingFromNoteIds
  delete next.chordTieFrozenIncomingFromKeyIndices
  return next
}

function replacePairStaffNotes(
  pairs: MeasurePair[],
  pairIndex: number,
  staff: StaffKind,
  nextStaffNotes: ScoreNote[],
): MeasurePair[] {
  const pair = pairs[pairIndex]
  if (!pair) return pairs
  const nextPairs = pairs.slice()
  nextPairs[pairIndex] =
    staff === 'treble'
      ? { treble: nextStaffNotes, bass: pair.bass }
      : { treble: pair.treble, bass: nextStaffNotes }
  return nextPairs
}

function createPastedNote(note: ScoreNote, pitches: Pitch[]): ScoreNote | null {
  if (pitches.length === 0) return null
  const [rootPitch, ...chordPitches] = pitches
  const next: ScoreNote = clearChordSpecificTieFields(
    clearOutgoingTieFields({
      ...note,
      isRest: false,
      pitch: rootPitch,
      chordPitches: chordPitches.length > 0 ? chordPitches : undefined,
      chordAccidentals: chordPitches.length > 0 ? new Array(chordPitches.length).fill(null) : undefined,
      accidental: null,
    }),
  )
  return next
}

export function resolveSingleTimepointSelectionGroup(params: {
  pairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  isSelectionVisible: boolean
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}): { group: ResolvedSingleTimepointSelectionGroup | null; error: CopyPasteFailureReason | null } {
  const {
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup = null,
  } = params
  const resolved = resolveEditableSelectionTarget({
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup,
  })
  if (!resolved.target || resolved.error) {
    if (resolved.error === 'multi-note-block') return { group: null, error: 'multi-timepoint' }
    return { group: null, error: resolved.error }
  }

  const selectedKeyIndices = resolveSelectedKeyIndices(
    resolved.target.note,
    resolved.target.selections,
    resolved.target.selection.keyIndex,
  )
  return {
    group: {
      pairIndex: resolved.target.pairIndex,
      noteIndex: resolved.target.noteIndex,
      staff: resolved.target.staff,
      note: resolved.target.note,
      selectedKeyIndices,
    },
    error: null,
  }
}

export function buildClipboardFromSelections(params: {
  pairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  isSelectionVisible: boolean
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}): { payload: NoteClipboardPayload | null; error: CopyPasteFailureReason | null } {
  const {
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup = null,
  } = params
  const { group, error } = resolveSingleTimepointSelectionGroup({
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup,
  })
  if (!group || error) return { payload: null, error }
  if (group.note.isRest) return { payload: null, error: 'rest-source' }

  const pitches = group.selectedKeyIndices
    .map((keyIndex) => getPitchAtKeyIndex(group.note, keyIndex))
    .filter((pitch): pitch is Pitch => Boolean(pitch))

  if (pitches.length === 0) return { payload: null, error: 'selection-not-found' }

  return {
    payload: {
      duration: group.note.duration,
      pitches,
      sourceStaff: group.staff,
      sourceKeyIndices: group.selectedKeyIndices,
    },
    error: null,
  }
}

export function applyClipboardPaste(params: {
  pairs: MeasurePair[]
  clipboard: NoteClipboardPayload | null
  activeSelection: Selection
  isSelectionVisible: boolean
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
  keyFifthsByMeasure?: number[] | null
  timeSignaturesByMeasure?: TimeSignature[] | null
  importedMode: boolean
}): { result: CopyPasteResult | null; error: CopyPasteFailureReason | null } {
  const {
    pairs,
    clipboard,
    activeSelection,
    isSelectionVisible,
    importedNoteLookup = null,
    keyFifthsByMeasure = null,
    timeSignaturesByMeasure = null,
    importedMode,
  } = params

  if (!clipboard) return { result: null, error: 'clipboard-empty' }
  if (!isSelectionVisible) return { result: null, error: 'no-selection' }

  const targetLocation = findSelectionLocationInPairs({
    pairs,
    selection: activeSelection,
    importedNoteLookup,
  })
  if (!targetLocation) return { result: null, error: 'selection-not-found' }
  const targetPair = pairs[targetLocation.pairIndex]
  const targetNotes = targetLocation.staff === 'treble' ? targetPair?.treble : targetPair?.bass
  const targetNote = targetNotes?.[targetLocation.noteIndex]
  if (!targetPair || !targetNote || targetNote.id !== activeSelection.noteId) {
    return { result: null, error: 'selection-not-found' }
  }

  const durationAttempt = applyDurationChangeAtTargetLocation({
    pairs,
    target: {
      pairIndex: targetLocation.pairIndex,
      noteIndex: targetLocation.noteIndex,
      staff: targetLocation.staff,
      noteId: targetNote.id,
      keyIndex: activeSelection.keyIndex,
    },
    targetDuration: clipboard.duration,
    keyFifthsByMeasure,
    timeSignaturesByMeasure,
    importedMode,
    allowCrossMeasureExtend: true,
    changeKind: 'duration',
  })
  if (durationAttempt.error) {
    return { result: null, error: durationAttempt.error }
  }

  const durationPairs = durationAttempt.result?.nextPairs ?? pairs
  const durationSelection = durationAttempt.result?.nextSelection ?? activeSelection
  const rewrittenLocation = findSelectionLocationInPairs({
    pairs: durationPairs,
    selection: durationSelection,
    importedNoteLookup: null,
  })
  if (!rewrittenLocation) return { result: null, error: 'selection-not-found' }

  const rewrittenPair = durationPairs[rewrittenLocation.pairIndex]
  if (!rewrittenPair) return { result: null, error: 'selection-not-found' }
  const rewrittenStaffNotes = (rewrittenLocation.staff === 'treble' ? rewrittenPair.treble : rewrittenPair.bass).slice()
  const rewrittenTarget = rewrittenStaffNotes[rewrittenLocation.noteIndex]
  if (!rewrittenTarget || rewrittenTarget.id !== durationSelection.noteId) {
    return { result: null, error: 'selection-not-found' }
  }

  const pastedTarget = createPastedNote(rewrittenTarget, clipboard.pitches)
  if (!pastedTarget) return { result: null, error: 'selection-not-found' }
  rewrittenStaffNotes[rewrittenLocation.noteIndex] = pastedTarget

  const nextPairsBase = replacePairStaffNotes(
    durationPairs,
    rewrittenLocation.pairIndex,
    rewrittenLocation.staff,
    rewrittenStaffNotes,
  )
  const keyFifthsList = keyFifthsByMeasure
    ? keyFifthsByMeasure.map((_, index) => resolvePairKeyFifths(index, keyFifthsByMeasure))
    : null
  const normalizedPairs = normalizeMeasurePairAt(nextPairsBase, rewrittenLocation.pairIndex, keyFifthsList)
  const nextSelection: Selection = {
    noteId: durationSelection.noteId,
    staff: durationSelection.staff,
    keyIndex: 0,
  }

  return {
    result: {
      nextPairs: normalizedPairs,
      nextSelection,
      nextSelections: [nextSelection],
    },
    error: null,
  }
}

