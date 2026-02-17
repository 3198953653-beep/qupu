import { CHROMATIC_STEPS, KEY_FLAT_ORDER, KEY_SHARP_ORDER, STEP_TO_SEMITONE } from './constants'
import type { Pitch } from './types'

export function toPitchFromStepAlter(step: string, alter: number, octave: number): Pitch {
  const semitone = STEP_TO_SEMITONE[step]
  if (semitone === undefined) return `c/${octave}`
  const note = CHROMATIC_STEPS[(semitone + alter + 120) % 12]
  return `${note}/${octave}`
}

export function getStepOctaveAlterFromPitch(pitch: Pitch): { step: string; octave: number; alter: number } {
  const [rawNote, octaveText] = pitch.toLowerCase().split('/')
  const octave = Number(octaveText)
  const note = rawNote?.trim() || 'c'
  const step = note[0]?.toUpperCase() || 'C'
  const alter = (note.match(/#/g)?.length ?? 0) - (note.match(/b/g)?.length ?? 0)
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
