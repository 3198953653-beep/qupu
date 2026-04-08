import assert from 'node:assert/strict'
import { getLayoutNoteKey } from '../src/score/layout/renderPosition'
import {
  shouldHighlightBeamGroup,
  type BeamHighlightFrameScope,
  type BeamHighlightMode,
  type BeamSourceNoteEntry,
} from '../src/score/render/beamHighlightGate'
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
  beamSourceNotes: BeamSourceNoteEntry[]
  selectionKeySetByLayout: Map<string, Set<number>>
  expected: boolean
  mode?: BeamHighlightMode
}): void {
  const { label, staff, frameScope, beamSourceNotes, selectionKeySetByLayout, expected, mode } = params
  const actual = shouldHighlightBeamGroup({
    staff,
    frameScope,
    beamSourceNotes,
    selectionKeySetByLayout,
    mode,
  })
  assert.equal(actual, expected, label)
}

function buildBeamSourceNotes(notes: ScoreNote[]): BeamSourceNoteEntry[] {
  return notes.map((sourceNote, sourceNoteIndex) => ({ sourceNote, sourceNoteIndex }))
}

const singleA = createNote('single-a')
const singleB = createNote('single-b')
const chordA = createNote('chord-a', { chordPitches: ['e/4'] })

expectHighlight({
  label: 'no frame scope should not highlight even when all notes are selected',
  staff: 'bass',
  frameScope: null,
  beamSourceNotes: buildBeamSourceNotes([singleA, singleB]),
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
  beamSourceNotes: buildBeamSourceNotes([singleA, singleB]),
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
  beamSourceNotes: buildBeamSourceNotes([singleA, singleB]),
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
  beamSourceNotes: buildBeamSourceNotes([chordA]),
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
  beamSourceNotes: buildBeamSourceNotes([chordA]),
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
  beamSourceNotes: buildBeamSourceNotes([singleA, singleB]),
  selectionKeySetByLayout: new Map(),
  expected: true,
})

expectHighlight({
  label: 'staff frame should not highlight beams from the other staff',
  staff: 'bass',
  frameScope: 'treble',
  beamSourceNotes: buildBeamSourceNotes([singleA, singleB]),
  selectionKeySetByLayout: new Map(),
  expected: false,
})

expectHighlight({
  label: 'shift-first-note mode should highlight when the first beam note is selected',
  staff: 'bass',
  frameScope: null,
  mode: 'shift-first-note',
  beamSourceNotes: buildBeamSourceNotes([singleA, singleB]),
  selectionKeySetByLayout: buildSelectionKeySet({
    staff: 'bass',
    notes: [singleA, singleB],
    selectedKeyIndicesByNoteId: {
      'single-a': [0],
    },
  }),
  expected: true,
})

expectHighlight({
  label: 'shift-first-note mode should not highlight when only a later beam note is selected',
  staff: 'bass',
  frameScope: null,
  mode: 'shift-first-note',
  beamSourceNotes: buildBeamSourceNotes([singleA, singleB]),
  selectionKeySetByLayout: buildSelectionKeySet({
    staff: 'bass',
    notes: [singleA, singleB],
    selectedKeyIndicesByNoteId: {
      'single-b': [0],
    },
  }),
  expected: false,
})

expectHighlight({
  label: 'shift-first-note mode should use the earliest source index even if entries are unordered',
  staff: 'bass',
  frameScope: null,
  mode: 'shift-first-note',
  beamSourceNotes: [
    { sourceNote: singleB, sourceNoteIndex: 1 },
    { sourceNote: singleA, sourceNoteIndex: 0 },
  ],
  selectionKeySetByLayout: buildSelectionKeySet({
    staff: 'bass',
    notes: [singleA, singleB],
    selectedKeyIndicesByNoteId: {
      'single-a': [0],
    },
  }),
  expected: true,
})

expectHighlight({
  label: 'shift-first-note mode should require full chord coverage for a chord beam start note',
  staff: 'bass',
  frameScope: null,
  mode: 'shift-first-note',
  beamSourceNotes: buildBeamSourceNotes([chordA, singleB]),
  selectionKeySetByLayout: buildSelectionKeySet({
    staff: 'bass',
    notes: [chordA, singleB],
    selectedKeyIndicesByNoteId: {
      'chord-a': [0],
    },
  }),
  expected: false,
})

console.log('Beam highlight gating test passed.')
