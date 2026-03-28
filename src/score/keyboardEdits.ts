import { buildAccidentalStateBeforeNote, getEffectiveAlterFromContext, normalizeMeasurePairAt } from './accidentals'
import { PIANO_MAX_MIDI, PIANO_MIN_MIDI, STEP_TO_SEMITONE } from './constants'
import { getStepOctaveAlterFromPitch, toPitchFromStepAlter } from './pitchMath'
import type { ImportedNoteLocation, MeasurePair, Pitch, ScoreNote, Selection, StaffKind } from './types'

const DIATONIC_STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const

type SelectionLocation = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
}

export type KeyboardEditResult = {
  nextPairs: MeasurePair[]
  nextSelection: Selection
  changedPairIndex: number
}

function resolveStaffNotes(pair: MeasurePair, staff: StaffKind): ScoreNote[] {
  return staff === 'treble' ? pair.treble : pair.bass
}

function resolvePairKeyFifths(pairIndex: number, keyFifthsByMeasure?: number[] | null): number {
  if (!keyFifthsByMeasure || keyFifthsByMeasure.length === 0) return 0
  for (let index = pairIndex; index >= 0; index -= 1) {
    const fifths = keyFifthsByMeasure[index]
    if (Number.isFinite(fifths)) return Math.trunc(fifths)
  }
  return 0
}

function updateNoteInPairs(
  pairs: MeasurePair[],
  location: SelectionLocation,
  updater: (note: ScoreNote) => ScoreNote,
): MeasurePair[] {
  const pair = pairs[location.pairIndex]
  if (!pair) return pairs
  const sourceNotes = resolveStaffNotes(pair, location.staff)
  const sourceNote = sourceNotes[location.noteIndex]
  if (!sourceNote) return pairs

  const nextNote = updater(sourceNote)
  if (nextNote === sourceNote) return pairs

  const nextPairs = pairs.slice()
  const nextPair: MeasurePair = { treble: pair.treble, bass: pair.bass }
  const nextNotes = sourceNotes.slice()
  nextNotes[location.noteIndex] = nextNote
  if (location.staff === 'treble') {
    nextPair.treble = nextNotes
  } else {
    nextPair.bass = nextNotes
  }
  nextPairs[location.pairIndex] = nextPair
  return nextPairs
}

function getSelectedPitch(note: ScoreNote, keyIndex: number): string | null {
  if (note.isRest) return null
  if (keyIndex <= 0) return note.pitch
  return note.chordPitches?.[keyIndex - 1] ?? null
}

function normalizeChordArrays(
  chordPitches: string[] | undefined,
  chordAccidentals: Array<string | null> | undefined,
): { chordPitches?: string[]; chordAccidentals?: Array<string | null> } {
  if (!chordPitches || chordPitches.length === 0) {
    return {}
  }
  const safeAccidentals = chordAccidentals ?? new Array(chordPitches.length).fill(null)
  const trimmedAccidentals = chordPitches.map((_, index) => safeAccidentals[index] ?? null)
  return {
    chordPitches,
    chordAccidentals: trimmedAccidentals,
  }
}

function deleteKeyFromNote(note: ScoreNote, keyIndex: number): { nextNote: ScoreNote; nextKeyIndex: number } {
  if (note.isRest) return { nextNote: note, nextKeyIndex: 0 }

  const sourceChordPitches = note.chordPitches ?? []
  const sourceChordAccidentals = note.chordAccidentals ?? new Array(sourceChordPitches.length).fill(null)

  if (keyIndex <= 0) {
    if (sourceChordPitches.length === 0) {
      return {
        nextNote: {
          id: note.id,
          pitch: note.pitch,
          duration: note.duration,
          isRest: true,
        },
        nextKeyIndex: 0,
      }
    }
    const promotedPitch = sourceChordPitches[0]
    const remainingChordPitches = sourceChordPitches.slice(1)
    const remainingChordAccidentals = sourceChordAccidentals.slice(1)
    const normalizedChord = normalizeChordArrays(remainingChordPitches, remainingChordAccidentals)
    return {
      nextNote: {
        id: note.id,
        pitch: promotedPitch,
        duration: note.duration,
        isRest: false,
        accidental: null,
        ...normalizedChord,
      },
      nextKeyIndex: 0,
    }
  }

  const chordIndex = keyIndex - 1
  if (chordIndex < 0 || chordIndex >= sourceChordPitches.length) {
    return { nextNote: note, nextKeyIndex: 0 }
  }
  const nextChordPitches = sourceChordPitches.slice(0, chordIndex).concat(sourceChordPitches.slice(chordIndex + 1))
  const nextChordAccidentals = sourceChordAccidentals
    .slice(0, chordIndex)
    .concat(sourceChordAccidentals.slice(chordIndex + 1))
  const normalizedChord = normalizeChordArrays(nextChordPitches, nextChordAccidentals)
  const maxKeyIndex = normalizedChord.chordPitches?.length ?? 0
  return {
    nextNote: {
      ...note,
      isRest: false,
      chordPitches: undefined,
      chordAccidentals: undefined,
      ...normalizedChord,
    },
    nextKeyIndex: Math.max(0, Math.min(keyIndex, maxKeyIndex)),
  }
}

function shiftDiatonicStep(step: string, octave: number, shift: number): { step: string; octave: number } | null {
  const sourceIndex = DIATONIC_STEPS.indexOf(step.toUpperCase() as (typeof DIATONIC_STEPS)[number])
  if (sourceIndex < 0) return null
  const rawIndex = sourceIndex + shift
  const octaveShift = Math.floor(rawIndex / DIATONIC_STEPS.length)
  const wrappedIndex = ((rawIndex % DIATONIC_STEPS.length) + DIATONIC_STEPS.length) % DIATONIC_STEPS.length
  return {
    step: DIATONIC_STEPS[wrappedIndex],
    octave: octave + octaveShift,
  }
}

function isPitchInPianoRange(step: string, octave: number, alter: number): boolean {
  const semitone = STEP_TO_SEMITONE[step]
  if (semitone === undefined) return false
  const midi = (octave + 1) * 12 + semitone + alter
  return midi >= PIANO_MIN_MIDI && midi <= PIANO_MAX_MIDI
}

export function findSelectionLocationInPairs(params: {
  pairs: MeasurePair[]
  selection: Selection
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}): SelectionLocation | null {
  const { pairs, selection, importedNoteLookup } = params
  const located = importedNoteLookup?.get(selection.noteId)
  if (located) {
    const pair = pairs[located.pairIndex]
    const note = pair ? resolveStaffNotes(pair, located.staff)[located.noteIndex] : null
    if (note?.id === selection.noteId) {
      return {
        pairIndex: located.pairIndex,
        noteIndex: located.noteIndex,
        staff: located.staff,
      }
    }
  }

  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    const pair = pairs[pairIndex]
    const notes = resolveStaffNotes(pair, selection.staff)
    const noteIndex = notes.findIndex((note) => note.id === selection.noteId)
    if (noteIndex >= 0) {
      return {
        pairIndex,
        noteIndex,
        staff: selection.staff,
      }
    }
  }
  return null
}

export function replaceNoteChordPitches(params: {
  pairs: MeasurePair[]
  selection: Selection
  chordPitches: Pitch[]
  keyFifthsByMeasure?: number[] | null
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}): KeyboardEditResult | null {
  const {
    pairs,
    selection,
    chordPitches,
    keyFifthsByMeasure = null,
    importedNoteLookup = null,
  } = params
  const location = findSelectionLocationInPairs({ pairs, selection, importedNoteLookup })
  if (!location) return null
  const pair = pairs[location.pairIndex]
  if (!pair) return null
  const sourceNote = resolveStaffNotes(pair, location.staff)[location.noteIndex]
  if (!sourceNote || sourceNote.isRest) return null

  const normalizedChordPitches = chordPitches.filter((pitch, index) => {
    if (pitch === sourceNote.pitch) return false
    return chordPitches.indexOf(pitch) === index
  })
  const sourceChordPitches = sourceNote.chordPitches ?? []
  const hasSameChordPitches =
    sourceChordPitches.length === normalizedChordPitches.length &&
    sourceChordPitches.every((pitch, index) => pitch === normalizedChordPitches[index])
  if (hasSameChordPitches) {
    return null
  }

  const updatedPairs = updateNoteInPairs(pairs, location, (note) => {
    const nextChord = normalizeChordArrays(
      normalizedChordPitches.length > 0 ? normalizedChordPitches : undefined,
      normalizedChordPitches.length > 0 ? new Array(normalizedChordPitches.length).fill(null) : undefined,
    )
    return {
      ...note,
      isRest: false,
      chordPitches: undefined,
      chordAccidentals: undefined,
      ...nextChord,
    }
  })
  if (updatedPairs === pairs) return null

  const normalizedPairs = normalizeMeasurePairAt(updatedPairs, location.pairIndex, keyFifthsByMeasure)
  return {
    nextPairs: normalizedPairs,
    nextSelection: {
      noteId: sourceNote.id,
      staff: location.staff,
      keyIndex: 0,
    },
    changedPairIndex: location.pairIndex,
  }
}

export function deleteSelectedKey(params: {
  pairs: MeasurePair[]
  selection: Selection
  keyFifthsByMeasure?: number[] | null
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}): KeyboardEditResult | null {
  const { pairs, selection, keyFifthsByMeasure = null, importedNoteLookup = null } = params
  const location = findSelectionLocationInPairs({ pairs, selection, importedNoteLookup })
  if (!location) return null
  const pair = pairs[location.pairIndex]
  if (!pair) return null
  const sourceNote = resolveStaffNotes(pair, location.staff)[location.noteIndex]
  if (!sourceNote || sourceNote.isRest) return null

  const { nextNote, nextKeyIndex } = deleteKeyFromNote(sourceNote, selection.keyIndex)
  if (nextNote === sourceNote) return null

  const updatedPairs = updateNoteInPairs(pairs, location, () => nextNote)
  const normalizedPairs = normalizeMeasurePairAt(updatedPairs, location.pairIndex, keyFifthsByMeasure)
  return {
    nextPairs: normalizedPairs,
    nextSelection: {
      noteId: selection.noteId,
      staff: selection.staff,
      keyIndex: nextKeyIndex,
    },
    changedPairIndex: location.pairIndex,
  }
}

export function appendIntervalKey(params: {
  pairs: MeasurePair[]
  selection: Selection
  intervalDegree: number
  direction: 'up' | 'down'
  keyFifthsByMeasure?: number[] | null
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}): KeyboardEditResult | null {
  const {
    pairs,
    selection,
    intervalDegree,
    direction,
    keyFifthsByMeasure = null,
    importedNoteLookup = null,
  } = params
  if (!Number.isFinite(intervalDegree) || intervalDegree < 2 || intervalDegree > 8) return null

  const location = findSelectionLocationInPairs({ pairs, selection, importedNoteLookup })
  if (!location) return null
  const pair = pairs[location.pairIndex]
  if (!pair) return null
  const notes = resolveStaffNotes(pair, location.staff)
  const sourceNote = notes[location.noteIndex]
  if (!sourceNote || sourceNote.isRest) return null
  const selectedPitch = getSelectedPitch(sourceNote, selection.keyIndex)
  if (!selectedPitch) return null

  const { step, octave } = getStepOctaveAlterFromPitch(selectedPitch)
  const shiftSteps = intervalDegree - 1
  const shifted = shiftDiatonicStep(step, octave, direction === 'up' ? shiftSteps : -shiftSteps)
  if (!shifted) return null

  const keyFifths = resolvePairKeyFifths(location.pairIndex, keyFifthsByMeasure)
  const accidentalStateBeforeNote = buildAccidentalStateBeforeNote(notes, location.noteIndex, keyFifths)
  const effectiveAlter = getEffectiveAlterFromContext(shifted.step, shifted.octave, keyFifths, accidentalStateBeforeNote)
  if (!isPitchInPianoRange(shifted.step, shifted.octave, effectiveAlter)) return null
  const targetPitch = toPitchFromStepAlter(shifted.step, effectiveAlter, shifted.octave)

  const sourceChordPitches = sourceNote.chordPitches ? sourceNote.chordPitches.slice() : []
  const sourceChordAccidentals = sourceNote.chordAccidentals
    ? sourceNote.chordAccidentals.slice()
    : new Array(sourceChordPitches.length).fill(null)
  sourceChordPitches.push(targetPitch)
  sourceChordAccidentals.push(null)
  const appendedKeyIndex = sourceChordPitches.length

  const updatedPairs = updateNoteInPairs(pairs, location, (note) => ({
    ...note,
    isRest: false,
    chordPitches: sourceChordPitches,
    chordAccidentals: sourceChordAccidentals,
  }))
  const normalizedPairs = normalizeMeasurePairAt(updatedPairs, location.pairIndex, keyFifthsByMeasure)
  return {
    nextPairs: normalizedPairs,
    nextSelection: {
      noteId: selection.noteId,
      staff: selection.staff,
      keyIndex: appendedKeyIndex,
    },
    changedPairIndex: location.pairIndex,
  }
}

export function replaceSelectedKeyPitch(params: {
  pairs: MeasurePair[]
  selection: Selection
  targetPitch: Pitch
  keyFifthsByMeasure?: number[] | null
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}): KeyboardEditResult | null {
  const {
    pairs,
    selection,
    targetPitch,
    keyFifthsByMeasure = null,
    importedNoteLookup = null,
  } = params
  const location = findSelectionLocationInPairs({ pairs, selection, importedNoteLookup })
  if (!location) return null
  const pair = pairs[location.pairIndex]
  if (!pair) return null
  const notes = resolveStaffNotes(pair, location.staff)
  const sourceNote = notes[location.noteIndex]
  if (!sourceNote) return null

  const selectedPitch = getSelectedPitch(sourceNote, selection.keyIndex)
  if (!sourceNote.isRest && selectedPitch === targetPitch) return null

  let nextKeyIndex = selection.keyIndex
  const updatedPairs = updateNoteInPairs(pairs, location, (note) => {
    if (note.isRest) {
      nextKeyIndex = 0
      return {
        id: note.id,
        pitch: targetPitch,
        duration: note.duration,
        isRest: false,
      }
    }

    if (selection.keyIndex <= 0) {
      nextKeyIndex = 0
      return {
        ...note,
        pitch: targetPitch,
      }
    }

    const chordIndex = selection.keyIndex - 1
    const sourceChordPitches = note.chordPitches ?? []
    if (chordIndex < 0 || chordIndex >= sourceChordPitches.length) {
      nextKeyIndex = 0
      return note
    }
    const nextChordPitches = sourceChordPitches.slice()
    nextChordPitches[chordIndex] = targetPitch
    const sourceChordAccidentals = note.chordAccidentals
      ? note.chordAccidentals.slice()
      : new Array(nextChordPitches.length).fill(null)
    if (chordIndex < sourceChordAccidentals.length) {
      sourceChordAccidentals[chordIndex] = null
    }
    nextKeyIndex = selection.keyIndex
    return {
      ...note,
      chordPitches: nextChordPitches,
      chordAccidentals: sourceChordAccidentals,
    }
  })
  if (updatedPairs === pairs) return null

  const normalizedPairs = normalizeMeasurePairAt(updatedPairs, location.pairIndex, keyFifthsByMeasure)
  return {
    nextPairs: normalizedPairs,
    nextSelection: {
      noteId: selection.noteId,
      staff: selection.staff,
      keyIndex: Math.max(0, nextKeyIndex),
    },
    changedPairIndex: location.pairIndex,
  }
}
