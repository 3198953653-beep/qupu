import * as Tone from 'tone'
import { toTonePitch } from './pitchUtils'
import type { Pitch, ScoreNote } from './types'

export type PlaybackSynth = Tone.PolySynth | Tone.Sampler
export type ScoreNotePreviewMode = 'click' | 'drag'

const PREVIEW_DURATION_BY_MODE: Record<ScoreNotePreviewMode, string> = {
  click: '16n',
  drag: '32n',
}

const PREVIEW_VELOCITY_BY_MODE: Record<ScoreNotePreviewMode, number> = {
  click: 0.84,
  drag: 0.72,
}

let toneStartPromise: Promise<void> | null = null

export function ensureToneStarted(): Promise<void> {
  if (!toneStartPromise) {
    toneStartPromise = Tone.start()
      .then(() => undefined)
      .catch((error: unknown) => {
        toneStartPromise = null
        throw error
      })
  }
  return toneStartPromise
}

export function resolveScoreNotePreviewPitch(params: {
  note: ScoreNote
  keyIndex: number
  targetPitch?: Pitch | null
}): Pitch | null {
  const { note, keyIndex, targetPitch = null } = params
  if (note.isRest) return null
  if (targetPitch) return targetPitch
  if (keyIndex <= 0) return note.pitch
  return note.chordPitches?.[keyIndex - 1] ?? note.pitch
}

export async function previewScoreNote(params: {
  synth: PlaybackSynth | null
  note: ScoreNote
  keyIndex: number
  mode: ScoreNotePreviewMode
  targetPitch?: Pitch | null
}): Promise<Pitch | null> {
  const { synth, note, keyIndex, mode, targetPitch = null } = params
  const previewPitch = resolveScoreNotePreviewPitch({ note, keyIndex, targetPitch })
  if (!synth || !previewPitch) return null

  await ensureToneStarted()
  synth.triggerAttackRelease(
    toTonePitch(previewPitch),
    PREVIEW_DURATION_BY_MODE[mode],
    undefined,
    PREVIEW_VELOCITY_BY_MODE[mode],
  )
  return previewPitch
}

export async function previewPitchStack(params: {
  synth: PlaybackSynth | null
  pitches: Pitch[]
  mode: ScoreNotePreviewMode
}): Promise<Pitch[]> {
  const { synth, pitches, mode } = params
  const previewPitches = pitches.filter((pitch, index) => pitches.indexOf(pitch) === index)
  if (!synth || previewPitches.length === 0) return []

  await ensureToneStarted()
  synth.triggerAttackRelease(
    previewPitches.map((pitch) => toTonePitch(pitch)),
    PREVIEW_DURATION_BY_MODE[mode],
    undefined,
    PREVIEW_VELOCITY_BY_MODE[mode],
  )
  return previewPitches
}
