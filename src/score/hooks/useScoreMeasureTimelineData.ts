import { useMemo } from 'react'
import { buildPlaybackTimeline, type PlaybackTimelineEvent } from '../playbackTimeline'
import { buildChordRulerEntries, type ChordRulerEntry } from '../chordRuler'
import { buildMeasurePairs } from '../scoreOps'
import { resolvePairTimeSignature } from '../measureRestUtils'
import { getPlaybackPointKey } from './usePlaybackController'
import type { MeasurePair, PlaybackPoint, ScoreNote, TimeSignature } from '../types'

function buildNoteIndexByIdMap(notes: ScoreNote[]): Map<string, number> {
  const byId = new Map<string, number>()
  notes.forEach((note, index) => byId.set(note.id, index))
  return byId
}

export function useScoreMeasureTimelineData(params: {
  notes: ScoreNote[]
  bassNotes: ScoreNote[]
  measurePairsFromImport: MeasurePair[] | null
  importedChordRulerEntriesByPairFromImport: ChordRulerEntry[][] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
}) {
  const {
    notes,
    bassNotes,
    measurePairsFromImport,
    importedChordRulerEntriesByPairFromImport,
    measureTimeSignaturesFromImport,
  } = params

  const measurePairs = useMemo(
    () => measurePairsFromImport ?? buildMeasurePairs(notes, bassNotes),
    [bassNotes, measurePairsFromImport, notes],
  )

  const chordRulerEntriesByPair = useMemo(() => {
    if (measurePairsFromImport !== null) {
      if (!importedChordRulerEntriesByPairFromImport) return null
      return measurePairs.map((_, pairIndex) => importedChordRulerEntriesByPairFromImport[pairIndex] ?? [])
    }
    return measurePairs.map((_, pairIndex) =>
      buildChordRulerEntries({
        pairIndex,
        timeSignature: resolvePairTimeSignature(pairIndex, measureTimeSignaturesFromImport),
      }),
    )
  }, [
    importedChordRulerEntriesByPairFromImport,
    measurePairs,
    measurePairsFromImport,
    measureTimeSignaturesFromImport,
  ])

  const supplementalSpacingTicksByPair = useMemo(
    () =>
      chordRulerEntriesByPair
        ? chordRulerEntriesByPair.map((entries) => entries.map((entry) => entry.startTick))
        : null,
    [chordRulerEntriesByPair],
  )

  const playbackTimelineEvents = useMemo(
    () =>
      buildPlaybackTimeline({
        measurePairs,
        timeSignaturesByMeasure: measureTimeSignaturesFromImport,
      }),
    [measurePairs, measureTimeSignaturesFromImport],
  )

  const playbackTimelineEventByPointKey = useMemo(
    () =>
      new Map<string, PlaybackTimelineEvent>(
        playbackTimelineEvents.map((event) => [getPlaybackPointKey(event.point), event] as const),
      ),
    [playbackTimelineEvents],
  )

  const firstPlaybackPoint: PlaybackPoint | null = playbackTimelineEvents[0]?.point ?? null
  const trebleNoteById = useMemo(() => new Map(notes.map((note) => [note.id, note] as const)), [notes])
  const bassNoteById = useMemo(() => new Map(bassNotes.map((note) => [note.id, note] as const)), [bassNotes])
  const trebleNoteIndexById = useMemo(() => buildNoteIndexByIdMap(notes), [notes])
  const bassNoteIndexById = useMemo(() => buildNoteIndexByIdMap(bassNotes), [bassNotes])

  return {
    measurePairs,
    chordRulerEntriesByPair,
    supplementalSpacingTicksByPair,
    playbackTimelineEvents,
    playbackTimelineEventByPointKey,
    firstPlaybackPoint,
    trebleNoteById,
    bassNoteById,
    trebleNoteIndexById,
    bassNoteIndexById,
  }
}
