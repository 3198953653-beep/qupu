import assert from 'node:assert/strict'
import { buildSelectionsInTimelineRange } from '../src/score/selectionTimelineRange'
import type { ImportedNoteLocation, MeasurePair, ScoreNote, Selection } from '../src/score/types'

function note(id: string, duration: ScoreNote['duration']): ScoreNote {
  return {
    id,
    pitch: 'c/4',
    duration,
  }
}

function selection(staff: Selection['staff'], noteId: string): Selection {
  return {
    staff,
    noteId,
    keyIndex: 0,
  }
}

function buildImportedLookup(measurePairs: MeasurePair[]): Map<string, ImportedNoteLocation> {
  const lookup = new Map<string, ImportedNoteLocation>()
  measurePairs.forEach((pair, pairIndex) => {
    pair.treble.forEach((entry, noteIndex) => {
      lookup.set(entry.id, { pairIndex, noteIndex, staff: 'treble' })
    })
    pair.bass.forEach((entry, noteIndex) => {
      lookup.set(entry.id, { pairIndex, noteIndex, staff: 'bass' })
    })
  })
  return lookup
}

function selectionIdsByStaff(selections: Selection[]) {
  return {
    treble: selections.filter((entry) => entry.staff === 'treble').map((entry) => entry.noteId),
    bass: selections.filter((entry) => entry.staff === 'bass').map((entry) => entry.noteId),
  }
}

const sameStaffMeasure: MeasurePair = {
  treble: [note('treble-1', 'q'), note('treble-2', 'q')],
  bass: [note('bass-1', '8'), note('bass-2', '8'), note('bass-3', '8'), note('bass-4', '8')],
}
const sameStaffLookup = buildImportedLookup([sameStaffMeasure])

const sameTrebleSelections = buildSelectionsInTimelineRange({
  anchors: [selection('treble', 'treble-1'), selection('treble', 'treble-2')],
  measurePairs: [sameStaffMeasure],
  importedNoteLookup: sameStaffLookup,
})
assert.deepEqual(selectionIdsByStaff(sameTrebleSelections), {
  treble: ['treble-1', 'treble-2'],
  bass: [],
}, 'same-staff treble SHIFT range should stay on treble only')

const sameBassSelections = buildSelectionsInTimelineRange({
  anchors: [selection('bass', 'bass-1'), selection('bass', 'bass-3')],
  measurePairs: [sameStaffMeasure],
  importedNoteLookup: sameStaffLookup,
})
assert.deepEqual(selectionIdsByStaff(sameBassSelections), {
  treble: [],
  bass: ['bass-1', 'bass-2', 'bass-3'],
}, 'same-staff bass SHIFT range should stay on bass only')

const crossStaffMeasure: MeasurePair = {
  treble: [note('treble-q1', 'q'), note('treble-q2', 'q')],
  bass: [
    note('bass-16-1', '16'),
    note('bass-16-2', '16'),
    note('bass-16-3', '16'),
    note('bass-16-4', '16'),
    note('bass-16-5', '16'),
    note('bass-16-6', '16'),
    note('bass-16-7', '16'),
    note('bass-16-8', '16'),
  ],
}
const crossStaffLookup = buildImportedLookup([crossStaffMeasure])

const crossStaffSelections = buildSelectionsInTimelineRange({
  anchors: [selection('bass', 'bass-16-1'), selection('treble', 'treble-q2')],
  measurePairs: [crossStaffMeasure],
  importedNoteLookup: crossStaffLookup,
})
assert.deepEqual(selectionIdsByStaff(crossStaffSelections), {
  treble: ['treble-q1', 'treble-q2'],
  bass: [
    'bass-16-1',
    'bass-16-2',
    'bass-16-3',
    'bass-16-4',
    'bass-16-5',
    'bass-16-6',
    'bass-16-7',
    'bass-16-8',
  ],
}, 'cross-staff SHIFT range should still scan both staffs and keep long-note end coverage')

console.log('Selection timeline range test passed.')
