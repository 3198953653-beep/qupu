import type { DragTieTarget, MeasurePair, Pitch, ScoreNote, StaffKind } from './types'

type TieKeySpec = {
  keyIndex: number
  pitch: Pitch
  tieStart: boolean
  tieStop: boolean
}

type TieNode = {
  pairIndex: number
  noteIndex: number
  keyIndex: number
  noteId: string
  staff: StaffKind
  pitch: Pitch
  tieStart: boolean
  tieStop: boolean
}

function getStaffNotes(
  measurePairs: MeasurePair[],
  pairIndex: number,
  staff: StaffKind,
): ScoreNote[] | null {
  const pair = measurePairs[pairIndex]
  if (!pair) return null
  return staff === 'treble' ? pair.treble : pair.bass
}

function getTieKeySpecs(note: ScoreNote): TieKeySpec[] {
  if (!note || note.isRest) return []
  const specs: TieKeySpec[] = [
    {
      keyIndex: 0,
      pitch: note.pitch,
      tieStart: Boolean(note.tieStart),
      tieStop: Boolean(note.tieStop),
    },
  ]
  ;(note.chordPitches ?? []).forEach((pitch, chordIndex) => {
    specs.push({
      keyIndex: chordIndex + 1,
      pitch,
      tieStart: Boolean(note.chordTieStarts?.[chordIndex]),
      tieStop: Boolean(note.chordTieStops?.[chordIndex]),
    })
  })
  return specs
}

function findSpecByKeyIndexOrPitch(note: ScoreNote | undefined, keyIndex: number, pitchHint?: Pitch | null): TieKeySpec | null {
  if (!note || note.isRest) return null
  const specs = getTieKeySpecs(note)
  if (specs.length === 0) return null
  const byKeyIndex = specs.find((spec) => spec.keyIndex === keyIndex)
  if (byKeyIndex) return byKeyIndex
  if (pitchHint) {
    const byPitch = specs.find((spec) => spec.pitch === pitchHint)
    if (byPitch) return byPitch
  }
  return specs[0] ?? null
}

function findSpecByPitch(note: ScoreNote | undefined, pitch: Pitch): TieKeySpec | null {
  if (!note || note.isRest) return null
  return getTieKeySpecs(note).find((spec) => spec.pitch === pitch) ?? null
}

function findNextCrossMeasureNode(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  staff: StaffKind
  pitch: Pitch
}): TieNode | null {
  const { measurePairs, pairIndex, staff, pitch } = params
  for (let nextPairIndex = pairIndex + 1; nextPairIndex < measurePairs.length; nextPairIndex += 1) {
    const notes = getStaffNotes(measurePairs, nextPairIndex, staff)
    if (!notes || notes.length === 0) continue
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
      const note = notes[noteIndex]
      const spec = findSpecByPitch(note, pitch)
      if (!spec || !spec.tieStop) continue
      return {
        pairIndex: nextPairIndex,
        noteIndex,
        keyIndex: spec.keyIndex,
        noteId: note.id,
        staff,
        pitch: spec.pitch,
        tieStart: spec.tieStart,
        tieStop: spec.tieStop,
      }
    }
  }
  return null
}

function findPreviousCrossMeasureNode(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  staff: StaffKind
  pitch: Pitch
}): TieNode | null {
  const { measurePairs, pairIndex, staff, pitch } = params
  for (let previousPairIndex = pairIndex - 1; previousPairIndex >= 0; previousPairIndex -= 1) {
    const notes = getStaffNotes(measurePairs, previousPairIndex, staff)
    if (!notes || notes.length === 0) continue
    for (let noteIndex = notes.length - 1; noteIndex >= 0; noteIndex -= 1) {
      const note = notes[noteIndex]
      const spec = findSpecByPitch(note, pitch)
      if (!spec || !spec.tieStart) continue
      return {
        pairIndex: previousPairIndex,
        noteIndex,
        keyIndex: spec.keyIndex,
        noteId: note.id,
        staff,
        pitch: spec.pitch,
        tieStart: spec.tieStart,
        tieStop: spec.tieStop,
      }
    }
  }
  return null
}

function getNodeKey(node: { pairIndex: number; noteIndex: number; keyIndex: number; staff: StaffKind }): string {
  return `${node.staff}:${node.pairIndex}:${node.noteIndex}:${node.keyIndex}`
}

function toDragTieTarget(node: TieNode): DragTieTarget {
  return {
    pairIndex: node.pairIndex,
    noteIndex: node.noteIndex,
    staff: node.staff,
    noteId: node.noteId,
    keyIndex: node.keyIndex,
    pitch: node.pitch,
  }
}

export function resolveConnectedTieTargets(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  noteIndex: number
  keyIndex: number
  staff: StaffKind
  pitchHint?: Pitch | null
}): DragTieTarget[] {
  const {
    measurePairs,
    pairIndex,
    noteIndex,
    keyIndex,
    staff,
    pitchHint = null,
  } = params
  const notes = getStaffNotes(measurePairs, pairIndex, staff)
  const sourceNote = notes?.[noteIndex]
  const sourceSpec = findSpecByKeyIndexOrPitch(sourceNote, keyIndex, pitchHint)
  if (!sourceNote || !sourceSpec) return []

  const sourceNode: TieNode = {
    pairIndex,
    noteIndex,
    keyIndex: sourceSpec.keyIndex,
    noteId: sourceNote.id,
    staff,
    pitch: sourceSpec.pitch,
    tieStart: sourceSpec.tieStart,
    tieStop: sourceSpec.tieStop,
  }

  const visited = new Set<string>([getNodeKey(sourceNode)])
  const backwardTargets: DragTieTarget[] = []
  const forwardTargets: DragTieTarget[] = []

  let backwardNode: TieNode | null = sourceNode
  while (backwardNode && backwardNode.tieStop) {
    let previous: TieNode | null = null
    const currentNotes = getStaffNotes(measurePairs, backwardNode.pairIndex, staff)
    const inMeasurePrevious: ScoreNote | undefined =
      currentNotes && backwardNode.noteIndex - 1 >= 0 ? currentNotes[backwardNode.noteIndex - 1] : undefined
    const inMeasurePreviousSpec = findSpecByPitch(inMeasurePrevious, sourceNode.pitch)
    if (inMeasurePrevious && inMeasurePreviousSpec) {
      previous = {
        pairIndex: backwardNode.pairIndex,
        noteIndex: backwardNode.noteIndex - 1,
        keyIndex: inMeasurePreviousSpec.keyIndex,
        noteId: inMeasurePrevious.id,
        staff,
        pitch: inMeasurePreviousSpec.pitch,
        tieStart: inMeasurePreviousSpec.tieStart,
        tieStop: inMeasurePreviousSpec.tieStop,
      }
    } else {
      previous = findPreviousCrossMeasureNode({
        measurePairs,
        pairIndex: backwardNode.pairIndex,
        staff,
        pitch: sourceNode.pitch,
      })
    }
    if (!previous) break
    const previousKey = getNodeKey(previous)
    if (visited.has(previousKey)) break
    visited.add(previousKey)
    backwardTargets.unshift(toDragTieTarget(previous))
    backwardNode = previous
  }

  let forwardNode: TieNode | null = sourceNode
  while (forwardNode && forwardNode.tieStart) {
    let next: TieNode | null = null
    const currentNotes = getStaffNotes(measurePairs, forwardNode.pairIndex, staff)
    const inMeasureNext: ScoreNote | undefined =
      currentNotes && forwardNode.noteIndex + 1 < currentNotes.length ? currentNotes[forwardNode.noteIndex + 1] : undefined
    const inMeasureNextSpec = findSpecByPitch(inMeasureNext, sourceNode.pitch)
    if (inMeasureNext && inMeasureNextSpec) {
      next = {
        pairIndex: forwardNode.pairIndex,
        noteIndex: forwardNode.noteIndex + 1,
        keyIndex: inMeasureNextSpec.keyIndex,
        noteId: inMeasureNext.id,
        staff,
        pitch: inMeasureNextSpec.pitch,
        tieStart: inMeasureNextSpec.tieStart,
        tieStop: inMeasureNextSpec.tieStop,
      }
    } else {
      next = findNextCrossMeasureNode({
        measurePairs,
        pairIndex: forwardNode.pairIndex,
        staff,
        pitch: sourceNode.pitch,
      })
    }
    if (!next) break
    const nextKey = getNodeKey(next)
    if (visited.has(nextKey)) break
    visited.add(nextKey)
    forwardTargets.push(toDragTieTarget(next))
    forwardNode = next
  }

  return [...backwardTargets, toDragTieTarget(sourceNode), ...forwardTargets]
}
