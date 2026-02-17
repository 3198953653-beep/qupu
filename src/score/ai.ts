import { clamp } from './math'
import type { Pitch, ScoreNote } from './types'

export function createAiVariation(notes: ScoreNote[], pitches: Pitch[]): ScoreNote[] {
  let cursor = Math.floor(Math.random() * pitches.length)

  return notes.map((note) => {
    const deltaOptions = [-2, -1, 0, 1, 2]
    const delta = deltaOptions[Math.floor(Math.random() * deltaOptions.length)]
    cursor = clamp(cursor + delta, 0, pitches.length - 1)
    const next = { ...note, pitch: pitches[cursor] }
    delete next.accidental
    return next
  })
}
