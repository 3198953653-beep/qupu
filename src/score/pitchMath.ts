import { CHROMATIC_STEPS, KEY_FLAT_ORDER, KEY_SHARP_ORDER, PIANO_MAX_MIDI, PIANO_MIN_MIDI, STEP_TO_SEMITONE } from './constants'
import type { Pitch } from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function midiToPitch(midi: number): Pitch {
  const note = CHROMATIC_STEPS[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${note}/${octave}`
}

export function toPitchFromStepAlter(step: string, alter: number, octave: number): Pitch {
  const normalizedStep = step?.toUpperCase() ?? 'C'
  const semitone = STEP_TO_SEMITONE[normalizedStep]
  if (semitone === undefined) return `c/${octave}`

  if (Number.isInteger(alter) && alter >= -2 && alter <= 2) {
    const accidental = alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : ''
    return `${normalizedStep.toLowerCase()}${accidental}/${octave}`
  }

  const midi = clamp((octave + 1) * 12 + semitone + alter, PIANO_MIN_MIDI, PIANO_MAX_MIDI)
  return midiToPitch(midi)
}

export function getStepOctaveAlterFromPitch(pitch: Pitch): { step: string; octave: number; alter: number } {
  const [rawNote, octaveText] = pitch.toLowerCase().split('/')
  const octave = Number(octaveText)
  const note = rawNote?.trim() || 'c'
  const step = note[0]?.toUpperCase() || 'C'
  const accidentalText = note.slice(1)
  const alter = (accidentalText.match(/#/g)?.length ?? 0) - (accidentalText.match(/b/g)?.length ?? 0)
  return { step, octave: Number.isFinite(octave) ? octave : 4, alter }
}

export function getKeySignatureAlterForStep(step: string, fifths: number): number {
  if (!Number.isFinite(fifths) || fifths === 0) return 0
  if (fifths > 0) {
    const count = Math.min(Math.trunc(fifths), KEY_SHARP_ORDER.length)
    const sharpSteps: readonly string[] = KEY_SHARP_ORDER.slice(0, count)
    return sharpSteps.includes(step) ? 1 : 0
  }
  const count = Math.min(Math.abs(Math.trunc(fifths)), KEY_FLAT_ORDER.length)
  const flatSteps: readonly string[] = KEY_FLAT_ORDER.slice(0, count)
  return flatSteps.includes(step) ? -1 : 0
}
