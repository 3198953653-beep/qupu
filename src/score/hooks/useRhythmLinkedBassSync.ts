import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { syncBassNotesToTreble } from '../scoreOps'
import type { ScoreNote } from '../types'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useRhythmLinkedBassSync(params: {
  notes: ScoreNote[]
  isRhythmLinked: boolean
  setBassNotes: StateSetter<ScoreNote[]>
}): void {
  const { notes, isRhythmLinked, setBassNotes } = params

  useEffect(() => {
    if (!isRhythmLinked) return

    setBassNotes((currentBass) => {
      const sameShape =
        currentBass.length === notes.length &&
        currentBass.every((bassNote, index) => bassNote.duration === notes[index]?.duration)
      if (sameShape) return currentBass
      return syncBassNotesToTreble(notes, currentBass)
    })
  }, [notes, isRhythmLinked, setBassNotes])
}
