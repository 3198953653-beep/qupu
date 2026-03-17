import { clearTieFrozenIncoming } from './tieFrozen'
import type {
  MeasurePair,
  ScoreNote,
  Selection,
  StaffKind,
  TieEndpoint,
  TieSelection,
} from './types'

export type TieDeleteFailureReason = 'selection-not-found' | 'no-op'

export type TieDeleteResult = {
  nextPairs: MeasurePair[]
  nextSelection: Selection
  nextSelections: Selection[]
  changedPairIndices: number[]
}

type TieDeleteAttempt = {
  result: TieDeleteResult | null
  error: TieDeleteFailureReason | null
}

function resolveStaffNotes(pair: MeasurePair, staff: StaffKind): ScoreNote[] {
  return staff === 'treble' ? pair.treble : pair.bass
}

function normalizeChordTieFlags(source: boolean[] | undefined, chordLength: number): boolean[] {
  const next = source ? source.slice(0, chordLength) : []
  while (next.length < chordLength) next.push(false)
  return next
}

function clearTieStartAtKey(note: ScoreNote, keyIndex: number): ScoreNote {
  if (note.isRest) return note
  if (keyIndex <= 0) {
    if (!note.tieStart) return note
    const next = { ...note }
    delete next.tieStart
    return next
  }
  const chordLength = note.chordPitches?.length ?? 0
  const chordIndex = keyIndex - 1
  if (chordLength <= 0 || chordIndex < 0 || chordIndex >= chordLength) return note
  const nextChordTieStarts = normalizeChordTieFlags(note.chordTieStarts, chordLength)
  if (!nextChordTieStarts[chordIndex]) return note
  nextChordTieStarts[chordIndex] = false
  return {
    ...note,
    chordTieStarts: nextChordTieStarts,
  }
}

function clearTieStopAtKey(note: ScoreNote, keyIndex: number): ScoreNote {
  if (note.isRest) return note
  if (keyIndex <= 0) {
    if (!note.tieStop) return note
    const next = { ...note }
    delete next.tieStop
    return next
  }
  const chordLength = note.chordPitches?.length ?? 0
  const chordIndex = keyIndex - 1
  if (chordLength <= 0 || chordIndex < 0 || chordIndex >= chordLength) return note
  const nextChordTieStops = normalizeChordTieFlags(note.chordTieStops, chordLength)
  if (!nextChordTieStops[chordIndex]) return note
  nextChordTieStops[chordIndex] = false
  return {
    ...note,
    chordTieStops: nextChordTieStops,
  }
}

function applyEndpointDeletion(note: ScoreNote, endpoint: TieEndpoint): ScoreNote {
  if (endpoint.tieType === 'start') {
    return clearTieStartAtKey(note, endpoint.keyIndex)
  }
  const withoutStop = clearTieStopAtKey(note, endpoint.keyIndex)
  return clearTieFrozenIncoming(withoutStop, endpoint.keyIndex)
}

function resolveFallbackSelection(
  pairs: MeasurePair[],
  fallbackSelection: Selection,
): Selection | null {
  const targetPair = pairs.find((pair) => {
    const notes = fallbackSelection.staff === 'treble' ? pair.treble : pair.bass
    return notes.some((note) => note.id === fallbackSelection.noteId)
  })
  if (targetPair) {
    const notes = resolveStaffNotes(targetPair, fallbackSelection.staff)
    const note = notes.find((entry) => entry.id === fallbackSelection.noteId)
    if (note) {
      const keyCount = 1 + (note.chordPitches?.length ?? 0)
      return {
        noteId: note.id,
        staff: fallbackSelection.staff,
        keyIndex: Math.max(0, Math.min(fallbackSelection.keyIndex, keyCount - 1)),
      }
    }
  }

  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    const pair = pairs[pairIndex]
    if (pair.treble[0]) {
      return { noteId: pair.treble[0].id, staff: 'treble', keyIndex: 0 }
    }
    if (pair.bass[0]) {
      return { noteId: pair.bass[0].id, staff: 'bass', keyIndex: 0 }
    }
  }

  return null
}

export function applyDeleteTieSelection(params: {
  pairs: MeasurePair[]
  selection: TieSelection
  fallbackSelection: Selection
}): TieDeleteAttempt {
  const { pairs, selection, fallbackSelection } = params
  if (selection.endpoints.length === 0) {
    return { result: null, error: 'selection-not-found' }
  }

  let nextPairs = pairs
  const changedPairIndices = new Set<number>()
  let matchedEndpointCount = 0

  selection.endpoints.forEach((endpoint) => {
    const sourcePair = nextPairs[endpoint.pairIndex]
    if (!sourcePair) return

    const sourceNotes = resolveStaffNotes(sourcePair, endpoint.staff)
    let resolvedNoteIndex = endpoint.noteIndex
    let sourceNote = sourceNotes[resolvedNoteIndex]
    if (!sourceNote || sourceNote.id !== endpoint.noteId) {
      resolvedNoteIndex = sourceNotes.findIndex((note) => note.id === endpoint.noteId)
      if (resolvedNoteIndex < 0) return
      sourceNote = sourceNotes[resolvedNoteIndex]
    }
    if (!sourceNote) return
    matchedEndpointCount += 1

    const nextNote = applyEndpointDeletion(sourceNote, endpoint)
    if (nextNote === sourceNote) return

    if (nextPairs === pairs) {
      nextPairs = pairs.slice()
    }
    const workingPair = nextPairs[endpoint.pairIndex] ?? sourcePair
    const workingStaffNotes = resolveStaffNotes(workingPair, endpoint.staff).slice()
    workingStaffNotes[resolvedNoteIndex] = nextNote
    nextPairs[endpoint.pairIndex] =
      endpoint.staff === 'treble'
        ? { treble: workingStaffNotes, bass: workingPair.bass }
        : { treble: workingPair.treble, bass: workingStaffNotes }
    changedPairIndices.add(endpoint.pairIndex)
  })

  if (matchedEndpointCount === 0) {
    return { result: null, error: 'selection-not-found' }
  }

  if (changedPairIndices.size === 0) {
    return { result: null, error: 'no-op' }
  }

  const nextSelection = resolveFallbackSelection(nextPairs, fallbackSelection)
  if (!nextSelection) {
    return { result: null, error: 'selection-not-found' }
  }

  return {
    result: {
      nextPairs,
      nextSelection,
      nextSelections: [nextSelection],
      changedPairIndices: [...changedPairIndices].sort((left, right) => left - right),
    },
    error: null,
  }
}
