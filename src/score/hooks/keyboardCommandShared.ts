import {
  PIANO_MAX_MIDI,
  PIANO_MIN_MIDI,
  STEP_TO_SEMITONE,
} from '../constants'
import { getStepOctaveAlterFromPitch, toPitchFromStepAlter } from '../pitchMath'
import type { Pitch, Selection } from '../types'

export type MeasureScope = { pairIndex: number; staff: Selection['staff'] } | null

export function resolvePairKeyFifthsForKeyboard(pairIndex: number, keyFifthsByMeasure?: number[] | null): number {
  if (!keyFifthsByMeasure || keyFifthsByMeasure.length === 0) return 0
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyFifthsByMeasure[index]
    if (Number.isFinite(value)) return Math.trunc(value)
  }
  return 0
}

export function shiftPitchByStaffSteps(pitch: Pitch, direction: 'up' | 'down', staffSteps = 1): Pitch | null {
  const diatonicSteps = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
  const { step, octave } = getStepOctaveAlterFromPitch(pitch)
  const sourceIndex = diatonicSteps.indexOf(step)
  if (sourceIndex < 0) return null
  const shift = Math.max(1, Math.trunc(staffSteps))
  const shiftedRawIndex = sourceIndex + (direction === 'up' ? shift : -shift)
  const octaveShift = Math.floor(shiftedRawIndex / diatonicSteps.length)
  const wrappedIndex = ((shiftedRawIndex % diatonicSteps.length) + diatonicSteps.length) % diatonicSteps.length
  const targetStep = diatonicSteps[wrappedIndex]
  const targetOctave = octave + octaveShift
  return toPitchFromStepAlter(targetStep, 0, targetOctave)
}

export function isPitchWithinPianoRange(pitch: Pitch): boolean {
  const { step, octave, alter } = getStepOctaveAlterFromPitch(pitch)
  const semitone = STEP_TO_SEMITONE[step]
  if (semitone === undefined) return false
  const midi = (octave + 1) * 12 + semitone + alter
  return midi >= PIANO_MIN_MIDI && midi <= PIANO_MAX_MIDI
}

export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('[contenteditable="true"]'))
}

export function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}

export function appendUniqueSelection(current: Selection[], next: Selection): Selection[] {
  if (current.some((entry) => isSameSelection(entry, next))) return current
  return [...current, next]
}
