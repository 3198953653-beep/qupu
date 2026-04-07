import assert from 'node:assert/strict'
import { getLayoutNoteKey } from '../src/score/layout/renderPosition'
import { shouldHighlightBeamGroup, type BeamHighlightFrameScope } from '../src/score/render/beamHighlightGate'
import type { ScoreNote, StaffKind } from '../src/score/types'

function createNote(id: string, options?: { chordPitches?: string[] }): ScoreNote {
  return {
    id,
    pitch: 'c/4',
    duration: '8',
    chordPitches: options?.chordPitches,
  }
}

function buildSelectionKeySet(params: {
  staff: StaffKind
  notes: ScoreNote[]
  selectedKeyIndicesByNoteId: Record<string, number[]>
}): Map<string, Set<number>> {
  const { staff, notes, selectedKeyIndicesByNoteId } = params
  const selectionKeySetByLayout = new Map<string, Set<number>>()
  notes.forEach((note) => {
    const keyIndices = selectedKeyIndicesByNoteId[note.id]
    if (!keyIndices) return
    selectionKeySetByLayout.set(getLayoutNoteKey(staff, note.id), new Set(keyIndices))
  })
  return selectionKeySetByLayout
}

function expectHighlight(params: {
  label: string
  staff: StaffKind
  frameScope: BeamHighlightFrameScope
  beamSourceNotes: ScoreNote[]
  selectionKeySetByLayout: Map<string, Set<number>>
  expected: boolean
}): void {
  const { label, staff, frameScope, beamSourceNotes, selectionKeySetByLayout, expected } = params
  const actual = shouldHighlightBeamGroup({
    staff,
    frameScope,
    beamSourceNotes,
    selectionKeySetByLayout,
  })
  assert.equal(actual, expected, label)
}

const singleA = createNote('single-a')
const singleB = createNote('single-b')
const chordA = createNote('chord-a', { chordPitches: ['e/4'] })

expectHighlight({
  label: 'no frame scope should not highlight even when all notes are selected',
  staff: 'bass',
  frameScope: null,
  beamSourceNotes: [singleA, singleB],
  selectionKeySetByLayout: buildSelectionKeySet({
    staff: 'bass',
    notes: [singleA, singleB],
    selectedKeyIndicesByNoteId: {
      'single-a': [0],
      'single-b': [0],
    },
  }),
  expected: false,
})

expectHighlight({
  label: 'combined frame should not highlight when only part of the beam is selected',
  staff: 'bass',
  frameScope: 'combined',
  beamSourceNotes: [singleA, singleB],
  selectionKeySetByLayout: buildSelectionKeySet({
    staff: 'bass',
    notes: [singleA, singleB],
    selectedKeyIndicesByNoteId: {
      'single-a': [0],
    },
  }),
  expected: false,
})

expectHighlight({
  label: 'combined frame should highlight when every beam note is fully selected',
  staff: 'bass',
  frameScope: 'combined',
  beamSourceNotes: [singleA, singleB],
  selectionKeySetByLayout: buildSelectionKeySet({
    staff: 'bass',
    notes: [singleA, singleB],
    selectedKeyIndicesByNoteId: {
      'single-a': [0],
      'single-b': [0],
    },
  }),
  expected: true,
})

expectHighlight({
  label: 'combined frame should not highlight when a chord note is only partially selected',
  staff: 'bass',
  frameScope: 'combined',
  beamSourceNotes: [chordA],
  selectionKeySetByLayout: buildSelectionKeySet({
    staff: 'bass',
    notes: [chordA],
    selectedKeyIndicesByNoteId: {
      'chord-a': [0],
    },
  }),
  expected: false,
})

expectHighlight({
  label: 'combined frame should highlight when a chord note has every key selected',
  staff: 'bass',
  frameScope: 'combined',
  beamSourceNotes: [chordA],
  selectionKeySetByLayout: buildSelectionKeySet({
    staff: 'bass',
    notes: [chordA],
    selectedKeyIndicesByNoteId: {
      'chord-a': [0, 1],
    },
  }),
  expected: true,
})

expectHighlight({
  label: 'staff frame should highlight same-staff beams without requiring explicit key coverage',
  staff: 'bass',
  frameScope: 'bass',
  beamSourceNotes: [singleA, singleB],
  selectionKeySetByLayout: new Map(),
  expected: true,
})

expectHighlight({
  label: 'staff frame should not highlight beams from the other staff',
  staff: 'bass',
  frameScope: 'treble',
  beamSourceNotes: [singleA, singleB],
  selectionKeySetByLayout: new Map(),
  expected: false,
})

console.log('Beam highlight gating test passed.')
