import type { MeasurePair, ScoreNote, Selection, TimeSignature } from '../types'

export type UndoSnapshot = {
  pairs: MeasurePair[]
  imported: boolean
  selection: Selection
  isSelectionVisible: boolean
  fullMeasureRestCollapseScopeKeys: string[]
}

export function cloneScoreNote(note: ScoreNote): ScoreNote {
  return {
    ...note,
    chordPitches: note.chordPitches ? [...note.chordPitches] : undefined,
    chordAccidentals: note.chordAccidentals ? [...note.chordAccidentals] : undefined,
    chordTieStarts: note.chordTieStarts ? [...note.chordTieStarts] : undefined,
    chordTieStops: note.chordTieStops ? [...note.chordTieStops] : undefined,
    chordTieFrozenIncomingPitches: note.chordTieFrozenIncomingPitches ? [...note.chordTieFrozenIncomingPitches] : undefined,
    chordTieFrozenIncomingFromNoteIds: note.chordTieFrozenIncomingFromNoteIds
      ? [...note.chordTieFrozenIncomingFromNoteIds]
      : undefined,
    chordTieFrozenIncomingFromKeyIndices: note.chordTieFrozenIncomingFromKeyIndices
      ? [...note.chordTieFrozenIncomingFromKeyIndices]
      : undefined,
  }
}

export function cloneMeasurePairs(pairs: MeasurePair[]): MeasurePair[] {
  return pairs.map((pair) => ({
    treble: pair.treble.map(cloneScoreNote),
    bass: pair.bass.map(cloneScoreNote),
  }))
}

export function resolvePairKeyFifthsForKeyboard(pairIndex: number, keyFifthsByMeasure?: number[] | null): number {
  if (!keyFifthsByMeasure || keyFifthsByMeasure.length === 0) return 0
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyFifthsByMeasure[index]
    if (Number.isFinite(value)) return Math.trunc(value)
  }
  return 0
}

export function extendNumberSeries(
  source: number[] | null,
  targetLength: number,
  fallback: number,
  normalize: (value: number) => number,
): number[] {
  const next: number[] = []
  let carry = normalize(fallback)
  for (let index = 0; index < targetLength; index += 1) {
    const raw = source?.[index]
    if (Number.isFinite(raw)) {
      carry = normalize(raw as number)
    }
    next.push(carry)
  }
  return next
}

export function extendTimeSignatureSeries(source: TimeSignature[] | null, targetLength: number): TimeSignature[] {
  const next: TimeSignature[] = []
  let carry: TimeSignature = { beats: 4, beatType: 4 }
  for (let index = 0; index < targetLength; index += 1) {
    const candidate = source?.[index]
    if (
      candidate &&
      Number.isFinite(candidate.beats) &&
      candidate.beats > 0 &&
      Number.isFinite(candidate.beatType) &&
      candidate.beatType > 0
    ) {
      carry = {
        beats: Math.max(1, Math.round(candidate.beats)),
        beatType: Math.max(1, Math.round(candidate.beatType)),
      }
    }
    next.push({
      beats: carry.beats,
      beatType: carry.beatType,
    })
  }
  return next
}
