import type { Pitch, ScoreNote } from './types'

export type TieFrozenIncoming = {
  pitch: Pitch
  fromNoteId: string | null
  fromKeyIndex: number | null
}

function normalizeChordArrayLength<T>(
  source: T[] | undefined,
  targetLength: number,
  fillValue: T,
): T[] {
  const next = source ? source.slice(0, targetLength) : []
  while (next.length < targetLength) {
    next.push(fillValue)
  }
  return next
}

function getChordLength(note: ScoreNote): number {
  return note.chordPitches?.length ?? 0
}

export function getTieFrozenIncoming(note: ScoreNote | undefined, keyIndex: number): TieFrozenIncoming | null {
  if (!note || note.isRest) return null
  if (keyIndex <= 0) {
    if (!note.tieFrozenIncomingPitch) return null
    return {
      pitch: note.tieFrozenIncomingPitch,
      fromNoteId: note.tieFrozenIncomingFromNoteId ?? null,
      fromKeyIndex: note.tieFrozenIncomingFromKeyIndex ?? null,
    }
  }
  const chordIndex = keyIndex - 1
  const pitch = note.chordTieFrozenIncomingPitches?.[chordIndex] ?? null
  if (!pitch) return null
  return {
    pitch,
    fromNoteId: note.chordTieFrozenIncomingFromNoteIds?.[chordIndex] ?? null,
    fromKeyIndex: note.chordTieFrozenIncomingFromKeyIndices?.[chordIndex] ?? null,
  }
}

export function clearTieFrozenIncoming(note: ScoreNote, keyIndex: number): ScoreNote {
  if (note.isRest) return note
  if (keyIndex <= 0) {
    const hasRootFreeze =
      note.tieFrozenIncomingPitch !== undefined ||
      note.tieFrozenIncomingFromNoteId !== undefined ||
      note.tieFrozenIncomingFromKeyIndex !== undefined
    if (!hasRootFreeze) return note
    const next: ScoreNote = { ...note }
    delete next.tieFrozenIncomingPitch
    delete next.tieFrozenIncomingFromNoteId
    delete next.tieFrozenIncomingFromKeyIndex
    return next
  }

  const chordLength = getChordLength(note)
  const chordIndex = keyIndex - 1
  if (chordLength <= 0 || chordIndex < 0 || chordIndex >= chordLength) return note
  const pitches = normalizeChordArrayLength(note.chordTieFrozenIncomingPitches, chordLength, null)
  const fromNoteIds = normalizeChordArrayLength(note.chordTieFrozenIncomingFromNoteIds, chordLength, null)
  const fromKeyIndices = normalizeChordArrayLength(note.chordTieFrozenIncomingFromKeyIndices, chordLength, null)
  if (
    pitches[chordIndex] === null &&
    fromNoteIds[chordIndex] === null &&
    fromKeyIndices[chordIndex] === null
  ) {
    return note
  }
  pitches[chordIndex] = null
  fromNoteIds[chordIndex] = null
  fromKeyIndices[chordIndex] = null
  return {
    ...note,
    chordTieFrozenIncomingPitches: pitches,
    chordTieFrozenIncomingFromNoteIds: fromNoteIds,
    chordTieFrozenIncomingFromKeyIndices: fromKeyIndices,
  }
}

export function setTieFrozenIncoming(
  note: ScoreNote,
  keyIndex: number,
  incoming: TieFrozenIncoming,
): ScoreNote {
  if (note.isRest) return note
  if (keyIndex <= 0) {
    if (
      note.tieFrozenIncomingPitch === incoming.pitch &&
      (note.tieFrozenIncomingFromNoteId ?? null) === incoming.fromNoteId &&
      (note.tieFrozenIncomingFromKeyIndex ?? null) === incoming.fromKeyIndex
    ) {
      return note
    }
    return {
      ...note,
      tieFrozenIncomingPitch: incoming.pitch,
      tieFrozenIncomingFromNoteId: incoming.fromNoteId,
      tieFrozenIncomingFromKeyIndex: incoming.fromKeyIndex,
    }
  }

  const chordLength = getChordLength(note)
  const chordIndex = keyIndex - 1
  if (chordLength <= 0 || chordIndex < 0 || chordIndex >= chordLength) return note
  const pitches = normalizeChordArrayLength(note.chordTieFrozenIncomingPitches, chordLength, null)
  const fromNoteIds = normalizeChordArrayLength(note.chordTieFrozenIncomingFromNoteIds, chordLength, null)
  const fromKeyIndices = normalizeChordArrayLength(note.chordTieFrozenIncomingFromKeyIndices, chordLength, null)
  if (
    pitches[chordIndex] === incoming.pitch &&
    fromNoteIds[chordIndex] === incoming.fromNoteId &&
    fromKeyIndices[chordIndex] === incoming.fromKeyIndex
  ) {
    return note
  }
  pitches[chordIndex] = incoming.pitch
  fromNoteIds[chordIndex] = incoming.fromNoteId
  fromKeyIndices[chordIndex] = incoming.fromKeyIndex
  return {
    ...note,
    chordTieFrozenIncomingPitches: pitches,
    chordTieFrozenIncomingFromNoteIds: fromNoteIds,
    chordTieFrozenIncomingFromKeyIndices: fromKeyIndices,
  }
}
