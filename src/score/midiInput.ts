import { PIANO_MAX_MIDI, PIANO_MIN_MIDI } from './constants'
import { getKeySignatureAlterForStep, toPitchFromStepAlter } from './pitchMath'
import type { Pitch } from './types'

const NATURAL_SEMITONE_TO_STEP: Record<number, string> = {
  0: 'C',
  2: 'D',
  4: 'E',
  5: 'F',
  7: 'G',
  9: 'A',
  11: 'B',
}

const BLACK_KEY_CANDIDATES: Record<number, Array<{ step: string; alter: number }>> = {
  1: [
    { step: 'C', alter: 1 },
    { step: 'D', alter: -1 },
  ],
  3: [
    { step: 'D', alter: 1 },
    { step: 'E', alter: -1 },
  ],
  6: [
    { step: 'F', alter: 1 },
    { step: 'G', alter: -1 },
  ],
  8: [
    { step: 'G', alter: 1 },
    { step: 'A', alter: -1 },
  ],
  10: [
    { step: 'A', alter: 1 },
    { step: 'B', alter: -1 },
  ],
}

function clampMidi(value: number): number {
  if (!Number.isFinite(value)) return PIANO_MIN_MIDI
  return Math.max(PIANO_MIN_MIDI, Math.min(PIANO_MAX_MIDI, Math.trunc(value)))
}

export function isMidiNoteOnMessage(data: Uint8Array): boolean {
  if (!(data instanceof Uint8Array) || data.length < 3) return false
  const status = data[0] ?? 0
  const velocity = data[2] ?? 0
  const command = status & 0xf0
  return command === 0x90 && velocity > 0
}

export function getMidiNoteNumber(data: Uint8Array): number | null {
  if (!isMidiNoteOnMessage(data)) return null
  const noteNumber = data[1]
  if (!Number.isFinite(noteNumber)) return null
  return clampMidi(noteNumber)
}

export function toPitchFromMidiWithKeyPreference(midi: number, keyFifths: number): Pitch {
  const clampedMidi = clampMidi(midi)
  const semitoneInOctave = ((clampedMidi % 12) + 12) % 12
  const octave = Math.floor(clampedMidi / 12) - 1

  const naturalStep = NATURAL_SEMITONE_TO_STEP[semitoneInOctave]
  if (naturalStep) {
    return toPitchFromStepAlter(naturalStep, 0, octave)
  }

  const candidates = BLACK_KEY_CANDIDATES[semitoneInOctave]
  if (!candidates || candidates.length === 0) {
    return toPitchFromStepAlter('C', 0, 4)
  }

  const preferred = candidates.find((candidate) => {
    return getKeySignatureAlterForStep(candidate.step, keyFifths) === candidate.alter
  })
  if (preferred) {
    return toPitchFromStepAlter(preferred.step, preferred.alter, octave)
  }

  const sharpCandidate = candidates.find((candidate) => candidate.alter > 0) ?? candidates[0]
  return toPitchFromStepAlter(sharpCandidate.step, sharpCandidate.alter, octave)
}
