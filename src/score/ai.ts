import { clamp } from './math'
import type { Pitch, ScoreNote } from './types'

export function createAiVariation(notes: ScoreNote[], pitches: Pitch[]): ScoreNote[] {
  let cursor = Math.floor(Math.random() * pitches.length)

  return notes.map((note) => {
    const deltaOptions = [-2, -1, 0, 1, 2]
    const delta = deltaOptions[Math.floor(Math.random() * deltaOptions.length)]
    cursor = clamp(cursor + delta, 0, pitches.length - 1)
    const { accidental: _accidental, ...rest } = note
    return { ...rest, pitch: pitches[cursor] }
  })
}
