import { KEY_FIFTHS_TO_MAJOR } from './constants'
import { getKeySignatureAlterForStep, getStepOctaveAlterFromPitch, toPitchFromStepAlter } from './pitchMath'
import type { MeasurePair, Pitch, ScoreNote, StaffKind } from './types'

export type RenderedNoteKey = {
  pitch: Pitch
  accidental: string | null
  keyIndex: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getAccidentalFromPitch(pitch: Pitch): string | null {
  const [note] = pitch.split('/')
  const accidental = note.slice(1)
  return accidental.length > 0 ? accidental : null
}

function getAccidentalSymbolFromAlter(alter: number): string | null {
  if (alter === 2) return '##'
  if (alter === 1) return '#'
  if (alter === -1) return 'b'
  if (alter === -2) return 'bb'
  if (alter === 0) return null
  return null
}

export function getAccidentalStateKey(step: string, octave: number): string {
  return `${step}${octave}`
}

export function getEffectiveAlterFromContext(
  step: string,
  octave: number,
  keyFifths: number,
  accidentalStateBeforeNote?: Map<string, number> | null,
): number {
  const carried = accidentalStateBeforeNote?.get(getAccidentalStateKey(step, octave))
  if (carried !== undefined) return carried
  return getKeySignatureAlterForStep(step, keyFifths)
}

export function getEffectivePitchForStaffPosition(
  staffPositionPitch: Pitch,
  keyFifths: number,
  accidentalStateBeforeNote?: Map<string, number> | null,
): Pitch {
  const { step, octave } = getStepOctaveAlterFromPitch(staffPositionPitch)
  const effectiveAlter = getEffectiveAlterFromContext(step, octave, keyFifths, accidentalStateBeforeNote)
  return toPitchFromStepAlter(step, effectiveAlter, octave)
}

export function isSameStaffPositionPitch(left: Pitch, right: Pitch): boolean {
  const leftParts = getStepOctaveAlterFromPitch(left)
  const rightParts = getStepOctaveAlterFromPitch(right)
  return leftParts.step === rightParts.step && leftParts.octave === rightParts.octave
}

function getAccidentalFromPitchAgainstContext(
  renderedPitch: Pitch,
  keyFifths: number,
  accidentalStateBeforeNote?: Map<string, number> | null,
): string | null {
  const { step, octave, alter } = getStepOctaveAlterFromPitch(renderedPitch)
  const expectedAlter = getEffectiveAlterFromContext(step, octave, keyFifths, accidentalStateBeforeNote)
  if (alter === expectedAlter) return null
  if (alter === 0 && expectedAlter !== 0) return 'n'
  return getAccidentalSymbolFromAlter(alter)
}

function getRenderedAccidental(
  note: ScoreNote,
  renderedPitch: Pitch,
  keyFifths: number,
  accidentalStateBeforeNote?: Map<string, number> | null,
  forceFromPitch = false,
): string | null {
  if (!forceFromPitch && note.accidental !== undefined) return note.accidental
  return forceFromPitch
    ? getAccidentalFromPitchAgainstContext(renderedPitch, keyFifths, accidentalStateBeforeNote)
    : getAccidentalFromPitch(renderedPitch)
}

function getAlterFromAccidentalSymbol(accidental: string): number | undefined {
  const ACCIDENTAL_ALTER_MAP: Record<string, number> = {
    '#': 1,
    b: -1,
    n: 0,
    '##': 2,
    bb: -2,
  }
  return ACCIDENTAL_ALTER_MAP[accidental]
}

export function getKeySignatureSpecFromFifths(fifths: number): string {
  const clamped = clamp(Math.trunc(fifths), -7, 7)
  return KEY_FIFTHS_TO_MAJOR[clamped] ?? 'C'
}

function resolvePitchByAccidentalState(
  pitch: Pitch,
  accidental: string | null | undefined,
  state: Map<string, number>,
  keyFifths: number,
): Pitch {
  const { step, octave, alter: pitchAlter } = getStepOctaveAlterFromPitch(pitch)
  const key = `${step}${octave}`

  let resolvedAlter = pitchAlter
  if (accidental === null) {
    resolvedAlter = getEffectiveAlterFromContext(step, octave, keyFifths, state)
  } else if (typeof accidental === 'string') {
    resolvedAlter = getAlterFromAccidentalSymbol(accidental) ?? pitchAlter
  }

  state.set(key, resolvedAlter)
  return toPitchFromStepAlter(step, resolvedAlter, octave)
}

export function buildAccidentalStateBeforeNote(notes: ScoreNote[], noteIndex: number, keyFifths: number): Map<string, number> {
  const state = new Map<string, number>()
  const end = clamp(noteIndex, 0, notes.length)
  for (let index = 0; index < end; index += 1) {
    const note = notes[index]
    if (note.isRest) continue
    resolvePitchByAccidentalState(note.pitch, note.accidental, state, keyFifths)
    note.chordPitches?.forEach((chordPitch, chordIndex) => {
      const chordAccidental = note.chordAccidentals?.[chordIndex]
      resolvePitchByAccidentalState(chordPitch, chordAccidental, state, keyFifths)
    })
  }
  return state
}

export function getRequiredAccidentalForTargetAlter(targetAlter: number, expectedAlter: number): string | null {
  if (targetAlter === expectedAlter) return null
  if (targetAlter === 0 && expectedAlter !== 0) return 'n'
  return getAccidentalSymbolFromAlter(targetAlter)
}

function normalizeMeasureStaffByAccidentalState(notes: ScoreNote[], keyFifths: number): ScoreNote[] {
  const state = new Map<string, number>()
  let changed = false

  const next = notes.map((note) => {
    if (note.isRest) {
      const hadAccidental = note.accidental !== undefined
      const hadChord = Boolean(note.chordPitches?.length || note.chordAccidentals?.length)
      if (!hadAccidental && !hadChord) return note
      changed = true
      const nextRest: ScoreNote = { ...note }
      delete nextRest.accidental
      delete nextRest.chordPitches
      delete nextRest.chordAccidentals
      return nextRest
    }

    const { step, octave, alter } = getStepOctaveAlterFromPitch(note.pitch)
    const expectedAlter = getEffectiveAlterFromContext(step, octave, keyFifths, state)
    const nextAccidental = getRequiredAccidentalForTargetAlter(alter, expectedAlter)
    state.set(getAccidentalStateKey(step, octave), alter)

    const currentAccidental = note.accidental ?? null
    const rootChanged = currentAccidental !== nextAccidental

    let nextChordAccidentals = note.chordAccidentals
    let chordChanged = false
    if (note.chordPitches?.length) {
      const computedChordAccidentals = note.chordPitches.map((chordPitch) => {
        const chordParts = getStepOctaveAlterFromPitch(chordPitch)
        const chordExpectedAlter = getEffectiveAlterFromContext(chordParts.step, chordParts.octave, keyFifths, state)
        const chordAccidental = getRequiredAccidentalForTargetAlter(chordParts.alter, chordExpectedAlter)
        state.set(getAccidentalStateKey(chordParts.step, chordParts.octave), chordParts.alter)
        return chordAccidental
      })
      const currentChordAccidentals = note.chordAccidentals ?? new Array(computedChordAccidentals.length).fill(null)
      chordChanged =
        currentChordAccidentals.length !== computedChordAccidentals.length ||
        computedChordAccidentals.some((accidental, index) => accidental !== currentChordAccidentals[index])
      if (chordChanged) {
        nextChordAccidentals = computedChordAccidentals
      }
    }

    if (!rootChanged && !chordChanged) return note
    changed = true
    const nextNote: ScoreNote = { ...note, accidental: nextAccidental }
    if (note.chordPitches?.length) {
      nextNote.chordAccidentals = nextChordAccidentals
    }
    return nextNote
  })

  return changed ? next : notes
}

export function normalizeMeasurePairAt(pairs: MeasurePair[], pairIndex: number, keyFifthsByMeasure?: number[] | null): MeasurePair[] {
  const pair = pairs[pairIndex]
  if (!pair) return pairs

  const keyFifths = keyFifthsByMeasure?.[pairIndex] ?? 0
  const nextTreble = normalizeMeasureStaffByAccidentalState(pair.treble, keyFifths)
  const nextBass = normalizeMeasureStaffByAccidentalState(pair.bass, keyFifths)
  if (nextTreble === pair.treble && nextBass === pair.bass) return pairs

  const nextPairs = pairs.slice()
  nextPairs[pairIndex] = { treble: nextTreble, bass: nextBass }
  return nextPairs
}

export function buildRenderedNoteKeys(
  note: ScoreNote,
  staff: StaffKind,
  renderedPitch: Pitch,
  renderedChordPitches: Pitch[] | undefined,
  keyFifths: number,
  accidentalStateBeforeNote: Map<string, number> | null,
  forceRootAccidentalFromPitch: boolean,
  forceChordAccidentalFromPitchIndex: number | null,
  accidentalOverridesByKeyIndex: Map<number, string | null> | null | undefined,
  getPitchLine: (staff: StaffKind, pitch: Pitch) => number,
): RenderedNoteKey[] {
  if (note.isRest) {
    return [{ pitch: renderedPitch, accidental: null, keyIndex: 0 }]
  }

  const rootOverride = accidentalOverridesByKeyIndex?.get(0)
  const keys: RenderedNoteKey[] = [
    {
      pitch: renderedPitch,
      accidental:
        rootOverride !== undefined
          ? rootOverride
          : getRenderedAccidental(
              note,
              renderedPitch,
              keyFifths,
              accidentalStateBeforeNote,
              forceRootAccidentalFromPitch,
            ),
      keyIndex: 0,
    },
  ]

  renderedChordPitches?.forEach((pitch, index) => {
    const chordOverride = accidentalOverridesByKeyIndex?.get(index + 1)
    const chordAccidental = note.chordAccidentals?.[index]
    const accidental =
      chordOverride !== undefined
        ? chordOverride
        : forceChordAccidentalFromPitchIndex === index
          ? getAccidentalFromPitchAgainstContext(pitch, keyFifths, accidentalStateBeforeNote)
          : chordAccidental !== undefined
            ? chordAccidental
            : getAccidentalFromPitch(pitch)
    keys.push({ pitch, accidental, keyIndex: index + 1 })
  })

  keys.sort((left, right) => getPitchLine(staff, left.pitch) - getPitchLine(staff, right.pitch))
  return keys
}
