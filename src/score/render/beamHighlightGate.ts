import { getLayoutNoteKey } from '../layout/renderPosition'
import type { ScoreNote, StaffKind } from '../types'

export type BeamHighlightFrameScope = 'combined' | StaffKind | null

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
  beamSourceNotes: ScoreNote[]
  selectionKeySetByLayout: Map<string, Set<number>>
  frameScope: BeamHighlightFrameScope
}): boolean {
  const { staff, beamSourceNotes, selectionKeySetByLayout, frameScope } = params
  if (frameScope === null || beamSourceNotes.length === 0) return false
  if (frameScope === staff) return true
  if (frameScope !== 'combined') return false

  return beamSourceNotes.every((sourceNote) =>
    isSourceNoteFullySelected({
      sourceNote,
      staff,
      selectionKeySetByLayout,
    }),
  )
}
