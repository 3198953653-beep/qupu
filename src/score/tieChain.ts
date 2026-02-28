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

function findSpecByKeyIndex(note: ScoreNote | undefined, keyIndex: number): TieKeySpec | null {
  if (!note || note.isRest) return null
  return getTieKeySpecs(note).find((spec) => spec.keyIndex === keyIndex) ?? null
}

function resolveFrozenIncomingFromKeyIndex(rawValue: number | null | undefined): number {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return Math.max(0, Math.trunc(rawValue))
  }
  return 0
}

function getFrozenIncomingFromSourceForKey(note: ScoreNote | undefined, keyIndex: number): {
  fromNoteId: string | null
  fromKeyIndex: number
} | null {
  if (!note || note.isRest) return null
  if (keyIndex <= 0) {
    if (!note.tieFrozenIncomingPitch) return null
    return {
      fromNoteId: note.tieFrozenIncomingFromNoteId ?? null,
      fromKeyIndex: resolveFrozenIncomingFromKeyIndex(note.tieFrozenIncomingFromKeyIndex),
    }
  }
  const chordIndex = keyIndex - 1
  const frozenPitch = note.chordTieFrozenIncomingPitches?.[chordIndex] ?? null
  if (!frozenPitch) return null
  return {
    fromNoteId: note.chordTieFrozenIncomingFromNoteIds?.[chordIndex] ?? null,
    fromKeyIndex: resolveFrozenIncomingFromKeyIndex(note.chordTieFrozenIncomingFromKeyIndices?.[chordIndex]),
  }
}

function hasFrozenIncomingFromSourceNode(note: ScoreNote | undefined, sourceNode: TieNode): boolean {
  if (!note || note.isRest) return false
  const rootMatches =
    Boolean(note.tieStop) &&
    Boolean(note.tieFrozenIncomingPitch) &&
    note.tieFrozenIncomingFromNoteId === sourceNode.noteId &&
    resolveFrozenIncomingFromKeyIndex(note.tieFrozenIncomingFromKeyIndex) === sourceNode.keyIndex
  if (rootMatches) return true

  const chordLength = note.chordPitches?.length ?? 0
  for (let chordIndex = 0; chordIndex < chordLength; chordIndex += 1) {
    const tieStop = Boolean(note.chordTieStops?.[chordIndex])
    const frozenPitch = note.chordTieFrozenIncomingPitches?.[chordIndex] ?? null
    const fromNoteId = note.chordTieFrozenIncomingFromNoteIds?.[chordIndex] ?? null
    const fromKeyIndex = resolveFrozenIncomingFromKeyIndex(note.chordTieFrozenIncomingFromKeyIndices?.[chordIndex])
    if (tieStop && frozenPitch && fromNoteId === sourceNode.noteId && fromKeyIndex === sourceNode.keyIndex) {
      return true
    }
  }

  return false
}

function findSpecByPitchWithRequirements(params: {
  note: ScoreNote | undefined
  pitch: Pitch
  requireTieStart?: boolean
  requireTieStop?: boolean
}): TieKeySpec | null {
  const { note, pitch, requireTieStart = false, requireTieStop = false } = params
  if (!note || note.isRest) return null
  const specs = getTieKeySpecs(note)
  for (const spec of specs) {
    if (spec.pitch !== pitch) continue
    if (requireTieStart && !spec.tieStart) continue
    if (requireTieStop && !spec.tieStop) continue
    return spec
  }
  return null
}

function findNodeByNoteIdAndKey(params: {
  measurePairs: MeasurePair[]
  staff: StaffKind
  noteId: string
  keyIndex: number
}): TieNode | null {
  const { measurePairs, staff, noteId, keyIndex } = params
  for (let pairIndex = 0; pairIndex < measurePairs.length; pairIndex += 1) {
    const notes = getStaffNotes(measurePairs, pairIndex, staff)
    if (!notes || notes.length === 0) continue
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
      const note = notes[noteIndex]
      if (!note || note.id !== noteId) continue
      const spec = findSpecByKeyIndex(note, keyIndex)
      if (!spec) continue
      return {
        pairIndex,
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

function findNextCrossMeasureNode(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  staff: StaffKind
  pitch: Pitch
}): TieNode | null {
  const { measurePairs, pairIndex, staff, pitch } = params
  const nextPairIndex = pairIndex + 1
  if (nextPairIndex >= measurePairs.length) return null
  const notes = getStaffNotes(measurePairs, nextPairIndex, staff)
  if (!notes || notes.length === 0) return null
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
  return null
}

function findPreviousCrossMeasureNode(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  staff: StaffKind
  pitch: Pitch
}): TieNode | null {
  const { measurePairs, pairIndex, staff, pitch } = params
  const previousPairIndex = pairIndex - 1
  if (previousPairIndex < 0) return null
  const notes = getStaffNotes(measurePairs, previousPairIndex, staff)
  if (!notes || notes.length === 0) return null
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

function resolveSourceNode(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  noteIndex: number
  keyIndex: number
  staff: StaffKind
  pitchHint?: Pitch | null
}): TieNode | null {
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
  if (!sourceNote || !sourceSpec) return null
  return {
    pairIndex,
    noteIndex,
    keyIndex: sourceSpec.keyIndex,
    noteId: sourceNote.id,
    staff,
    pitch: sourceSpec.pitch,
    tieStart: sourceSpec.tieStart,
    tieStop: sourceSpec.tieStop,
  }
}

function resolvePreviousTieNode(params: {
  measurePairs: MeasurePair[]
  sourceNode: TieNode
}): TieNode | null {
  const { measurePairs, sourceNode } = params
  if (!sourceNode.tieStop) return null
  const currentNotes = getStaffNotes(measurePairs, sourceNode.pairIndex, sourceNode.staff)
  const sourceNote = currentNotes?.[sourceNode.noteIndex]
  const frozenIncoming = getFrozenIncomingFromSourceForKey(sourceNote, sourceNode.keyIndex)
  if (frozenIncoming?.fromNoteId) {
    const frozenNode = findNodeByNoteIdAndKey({
      measurePairs,
      staff: sourceNode.staff,
      noteId: frozenIncoming.fromNoteId,
      keyIndex: frozenIncoming.fromKeyIndex,
    })
    if (frozenNode) return frozenNode
  }

  const inMeasurePrevious: ScoreNote | undefined =
    currentNotes && sourceNode.noteIndex - 1 >= 0 ? currentNotes[sourceNode.noteIndex - 1] : undefined
  const inMeasurePreviousSpec = findSpecByPitchWithRequirements({
    note: inMeasurePrevious,
    pitch: sourceNode.pitch,
    requireTieStart: true,
  })
  if (inMeasurePrevious && inMeasurePreviousSpec) {
    return {
      pairIndex: sourceNode.pairIndex,
      noteIndex: sourceNode.noteIndex - 1,
      keyIndex: inMeasurePreviousSpec.keyIndex,
      noteId: inMeasurePrevious.id,
      staff: sourceNode.staff,
      pitch: inMeasurePreviousSpec.pitch,
      tieStart: inMeasurePreviousSpec.tieStart,
      tieStop: inMeasurePreviousSpec.tieStop,
    }
  }
  // Only allow cross-measure backward linking when the current node is the
  // first event in the measure. Otherwise this is likely a broken chain.
  if (!currentNotes || sourceNode.noteIndex !== 0) return null
  return findPreviousCrossMeasureNode({
    measurePairs,
    pairIndex: sourceNode.pairIndex,
    staff: sourceNode.staff,
    pitch: sourceNode.pitch,
  })
}

function resolveNextTieNode(params: {
  measurePairs: MeasurePair[]
  sourceNode: TieNode
}): TieNode | null {
  const { measurePairs, sourceNode } = params
  if (!sourceNode.tieStart) return null
  const currentNotes = getStaffNotes(measurePairs, sourceNode.pairIndex, sourceNode.staff)
  const inMeasureNext: ScoreNote | undefined =
    currentNotes && sourceNode.noteIndex + 1 < currentNotes.length ? currentNotes[sourceNode.noteIndex + 1] : undefined
  const inMeasureNextSpec = findSpecByPitchWithRequirements({
    note: inMeasureNext,
    pitch: sourceNode.pitch,
    requireTieStop: true,
  })
  if (inMeasureNext && inMeasureNextSpec) {
    return {
      pairIndex: sourceNode.pairIndex,
      noteIndex: sourceNode.noteIndex + 1,
      keyIndex: inMeasureNextSpec.keyIndex,
      noteId: inMeasureNext.id,
      staff: sourceNode.staff,
      pitch: inMeasureNextSpec.pitch,
      tieStart: inMeasureNextSpec.tieStart,
      tieStop: inMeasureNextSpec.tieStop,
    }
  }

  if (currentNotes) {
    for (let noteIndex = sourceNode.noteIndex + 1; noteIndex < currentNotes.length; noteIndex += 1) {
      if (hasFrozenIncomingFromSourceNode(currentNotes[noteIndex], sourceNode)) return null
    }
  }
  const nextPairNotes = getStaffNotes(measurePairs, sourceNode.pairIndex + 1, sourceNode.staff)
  if (nextPairNotes) {
    for (const note of nextPairNotes) {
      if (hasFrozenIncomingFromSourceNode(note, sourceNode)) return null
    }
  }
  // Only allow cross-measure forward linking when the current node is the
  // last event in the measure. Otherwise this is likely a broken chain.
  if (!currentNotes || sourceNode.noteIndex !== currentNotes.length - 1) return null

  return findNextCrossMeasureNode({
    measurePairs,
    pairIndex: sourceNode.pairIndex,
    staff: sourceNode.staff,
    pitch: sourceNode.pitch,
  })
}

export function resolveForwardTieTargets(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  noteIndex: number
  keyIndex: number
  staff: StaffKind
  pitchHint?: Pitch | null
}): DragTieTarget[] {
  const sourceNode = resolveSourceNode(params)
  if (!sourceNode) return []
  const targets: DragTieTarget[] = [toDragTieTarget(sourceNode)]
  const visited = new Set<string>([getNodeKey(sourceNode)])

  let cursor: TieNode | null = sourceNode
  while (cursor) {
    const next = resolveNextTieNode({
      measurePairs: params.measurePairs,
      sourceNode: cursor,
    })
    if (!next) break
    const key = getNodeKey(next)
    if (visited.has(key)) break
    visited.add(key)
    targets.push(toDragTieTarget(next))
    cursor = next
  }
  return targets
}

export function resolvePreviousTieTarget(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  noteIndex: number
  keyIndex: number
  staff: StaffKind
  pitchHint?: Pitch | null
}): DragTieTarget | null {
  const sourceNode = resolveSourceNode(params)
  if (!sourceNode) return null
  const previous = resolvePreviousTieNode({
    measurePairs: params.measurePairs,
    sourceNode,
  })
  return previous ? toDragTieTarget(previous) : null
}

export function resolveConnectedTieTargets(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  noteIndex: number
  keyIndex: number
  staff: StaffKind
  pitchHint?: Pitch | null
}): DragTieTarget[] {
  const sourceNode = resolveSourceNode(params)
  if (!sourceNode) return []

  const visited = new Set<string>([getNodeKey(sourceNode)])
  const backwardTargets: DragTieTarget[] = []
  const forwardTargets: DragTieTarget[] = []

  let backwardNode: TieNode | null = sourceNode
  while (backwardNode && backwardNode.tieStop) {
    const previous = resolvePreviousTieNode({ measurePairs: params.measurePairs, sourceNode: backwardNode })
    if (!previous) break
    const previousKey = getNodeKey(previous)
    if (visited.has(previousKey)) break
    visited.add(previousKey)
    backwardTargets.unshift(toDragTieTarget(previous))
    backwardNode = previous
  }

  let forwardNode: TieNode | null = sourceNode
  while (forwardNode && forwardNode.tieStart) {
    const next = resolveNextTieNode({ measurePairs: params.measurePairs, sourceNode: forwardNode })
    if (!next) break
    const nextKey = getNodeKey(next)
    if (visited.has(nextKey)) break
    visited.add(nextKey)
    forwardTargets.push(toDragTieTarget(next))
    forwardNode = next
  }

  return [...backwardTargets, toDragTieTarget(sourceNode), ...forwardTargets]
}
