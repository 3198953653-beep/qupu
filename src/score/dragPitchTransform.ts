import { getEffectivePitchForStaffPosition } from './accidentals'
import { CHROMATIC_STEPS, PIANO_MAX_MIDI, PIANO_MIN_MIDI, STEP_TO_SEMITONE } from './constants'
import { getStepOctaveAlterFromPitch, toPitchFromStepAlter } from './pitchMath'
import type { DragTieTarget, Pitch } from './types'

const DIATONIC_STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const

function getDiatonicIndex(step: string, octave: number): number | null {
  const index = DIATONIC_STEPS.indexOf(step.toUpperCase() as (typeof DIATONIC_STEPS)[number])
  if (index < 0) return null
  return octave * DIATONIC_STEPS.length + index
}

export function getStaffStepDelta(fromPitch: Pitch, toPitch: Pitch): number | null {
  const from = getStepOctaveAlterFromPitch(fromPitch)
  const to = getStepOctaveAlterFromPitch(toPitch)
  const fromIndex = getDiatonicIndex(from.step, from.octave)
  const toIndex = getDiatonicIndex(to.step, to.octave)
  if (fromIndex === null || toIndex === null) return null
  return toIndex - fromIndex
}

export function shiftPitchByStaffSteps(sourcePitch: Pitch, delta: number): Pitch | null {
  if (!Number.isFinite(delta)) return null
  const source = getStepOctaveAlterFromPitch(sourcePitch)
  const sourceIndex = DIATONIC_STEPS.indexOf(source.step.toUpperCase() as (typeof DIATONIC_STEPS)[number])
  if (sourceIndex < 0) return null
  const rawIndex = sourceIndex + Math.trunc(delta)
  const octaveShift = Math.floor(rawIndex / DIATONIC_STEPS.length)
  const wrappedIndex = ((rawIndex % DIATONIC_STEPS.length) + DIATONIC_STEPS.length) % DIATONIC_STEPS.length
  return toPitchFromStepAlter(DIATONIC_STEPS[wrappedIndex], 0, source.octave + octaveShift)
}

function pitchToMidi(pitch: Pitch): number | null {
  const { step, octave, alter } = getStepOctaveAlterFromPitch(pitch)
  const semitone = STEP_TO_SEMITONE[step]
  if (semitone === undefined) return null
  return (octave + 1) * 12 + semitone + alter
}

function midiToPitch(midi: number): Pitch {
  const clamped = Math.max(PIANO_MIN_MIDI, Math.min(PIANO_MAX_MIDI, Math.round(midi)))
  const note = CHROMATIC_STEPS[clamped % 12]
  const octave = Math.floor(clamped / 12) - 1
  return `${note}/${octave}`
}

export function clampPitchToPianoRange(pitch: Pitch): Pitch {
  const midi = pitchToMidi(pitch)
  if (midi === null) return pitch
  const clamped = Math.max(PIANO_MIN_MIDI, Math.min(PIANO_MAX_MIDI, Math.round(midi)))
  if (clamped === midi) return pitch
  return midiToPitch(clamped)
}

export function resolvePitchByContext(
  staffPositionPitch: Pitch,
  keyFifths: number,
  accidentalStateBeforeNote?: Map<string, number> | null,
): Pitch {
  return getEffectivePitchForStaffPosition(staffPositionPitch, keyFifths, accidentalStateBeforeNote)
}

export function resolveGroupedTargetPitch(
  target: DragTieTarget,
  staffStepDelta: number | null,
): Pitch | null {
  if (staffStepDelta === null) return null
  const shiftedStaffPositionPitch = shiftPitchByStaffSteps(target.pitch, staffStepDelta)
  if (!shiftedStaffPositionPitch) return null
  const contextualPitch = resolvePitchByContext(
    shiftedStaffPositionPitch,
    target.contextKeyFifths ?? 0,
    target.contextAccidentalStateBeforeNote ?? null,
  )
  return clampPitchToPianoRange(contextualPitch)
}
