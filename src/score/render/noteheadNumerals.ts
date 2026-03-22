import { getStepOctaveAlterFromPitch } from '../pitchMath'
import type { NoteDuration, Pitch } from '../types'

const STEP_TO_JIANPU_NUMERAL: Record<string, string> = {
  C: '1',
  D: '2',
  E: '3',
  F: '4',
  G: '5',
  A: '6',
  B: '7',
}

export function getJianpuNumeralForPitch(pitch: Pitch): string | null {
  const { step } = getStepOctaveAlterFromPitch(pitch)
  return STEP_TO_JIANPU_NUMERAL[step.toUpperCase()] ?? null
}

export function hasFilledNoteHead(duration: NoteDuration): boolean {
  return duration !== 'w' && duration !== 'h'
}
