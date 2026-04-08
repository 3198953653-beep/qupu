import { getLayoutNoteKey } from '../layout/renderPosition'
import type { ScoreNote, StaffKind } from '../types'

export type BeamHighlightFrameScope = 'combined' | StaffKind | null
export type BeamHighlightMode = 'default' | 'shift-first-note'

export type BeamSourceNoteEntry = {
  sourceNote: ScoreNote
  sourceNoteIndex: number
}

function isSourceNoteFullySelected(params: {
  sourceNote: ScoreNote
  staff: StaffKind
  selectionKeySetByLayout: Map<string, Set<number>>
}): boolean {
  const { sourceNote, staff, selectionKeySetByLayout } = params
  const selectionKeySet = selectionKeySetByLayout.get(getLayoutNoteKey(staff, sourceNote.id))
  if (!selectionKeySet) return false

  const keyCount = 1 + (sourceNote.chordPitches?.length ?? 0)
  for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
    if (!selectionKeySet.has(keyIndex)) return false
  }

  return true
}

export function shouldHighlightBeamGroup(params: {
  staff: StaffKind
  beamSourceNotes: BeamSourceNoteEntry[]
  selectionKeySetByLayout: Map<string, Set<number>>
  frameScope: BeamHighlightFrameScope
  mode?: BeamHighlightMode
}): boolean {
  const {
    staff,
    beamSourceNotes,
    selectionKeySetByLayout,
    frameScope,
    mode = 'default',
  } = params
  if (beamSourceNotes.length === 0) return false

  if (mode === 'shift-first-note') {
    const firstBeamSourceNote = beamSourceNotes.reduce((earliest, current) =>
      current.sourceNoteIndex < earliest.sourceNoteIndex ? current : earliest,
    )

    return isSourceNoteFullySelected({
      sourceNote: firstBeamSourceNote.sourceNote,
      staff,
      selectionKeySetByLayout,
    })
  }

  if (frameScope === null) return false
  if (frameScope === staff) return true
  if (frameScope !== 'combined') return false

  return beamSourceNotes.every(({ sourceNote }) =>
    isSourceNoteFullySelected({
      sourceNote,
      staff,
      selectionKeySetByLayout,
    }),
  )
}
