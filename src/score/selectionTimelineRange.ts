import { DURATION_TICKS, TICKS_PER_BEAT } from './constants'
import type { ImportedNoteLocation, MeasurePair, ScoreNote, Selection, StaffKind } from './types'

export type SelectionLocation = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
}

export type SelectionTimelinePoint = SelectionLocation & {
  selection: Selection
  startTickInclusive: number
  endTickExclusive: number
}

function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}

function buildSelectionKey(selection: Selection): string {
  return `${selection.staff}|${selection.noteId}|${selection.keyIndex}`
}

export function resolveSelectionLocation(params: {
  pairs: MeasurePair[]
  selection: Selection
  importedNoteLookup: Map<string, ImportedNoteLocation>
}): SelectionLocation | null {
  const { pairs, selection, importedNoteLookup } = params
  const imported = importedNoteLookup.get(selection.noteId)
  if (imported) {
    const pair = pairs[imported.pairIndex]
    const note = imported.staff === 'treble' ? pair?.treble[imported.noteIndex] : pair?.bass[imported.noteIndex]
    if (note?.id === selection.noteId) {
      return {
        pairIndex: imported.pairIndex,
        noteIndex: imported.noteIndex,
        staff: imported.staff,
      }
    }
  }

  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    const pair = pairs[pairIndex]
    const notes = selection.staff === 'treble' ? pair.treble : pair.bass
    const noteIndex = notes.findIndex((note) => note.id === selection.noteId)
    if (noteIndex >= 0) {
      return {
        pairIndex,
        noteIndex,
        staff: selection.staff,
      }
    }
  }
  return null
}

export function buildStaffOnsetTicks(notes: ScoreNote[]): number[] {
  const onsetTicks: number[] = []
  let cursorTicks = 0
  notes.forEach((note) => {
    onsetTicks.push(cursorTicks)
    const ticks = DURATION_TICKS[note.duration]
    const safeTicks = Number.isFinite(ticks) ? Math.max(1, ticks) : TICKS_PER_BEAT
    cursorTicks += safeTicks
  })
  return onsetTicks
}

export function resolveSelectionTimelinePoint(params: {
  pairs: MeasurePair[]
  selection: Selection
  importedNoteLookup: Map<string, ImportedNoteLocation>
}): SelectionTimelinePoint | null {
  const { pairs, selection, importedNoteLookup } = params
  const location = resolveSelectionLocation({ pairs, selection, importedNoteLookup })
  if (!location) return null
  const pair = pairs[location.pairIndex]
  if (!pair) return null
  const notes = location.staff === 'treble' ? pair.treble : pair.bass
  const note = notes[location.noteIndex]
  if (!note) return null
  const onsetTicks = buildStaffOnsetTicks(notes)
  const startTickInclusive = onsetTicks[location.noteIndex]
  if (!Number.isFinite(startTickInclusive)) return null
  const durationTicks = DURATION_TICKS[note.duration]
  const safeDurationTicks = Number.isFinite(durationTicks) ? Math.max(1, durationTicks) : TICKS_PER_BEAT
  const endTickExclusive = startTickInclusive + safeDurationTicks
  return {
    ...location,
    selection,
    startTickInclusive,
    endTickExclusive,
  }
}

export function compareTimelinePoint(left: SelectionTimelinePoint, right: SelectionTimelinePoint): number {
  if (left.pairIndex !== right.pairIndex) return left.pairIndex - right.pairIndex
  if (left.startTickInclusive !== right.startTickInclusive) {
    return left.startTickInclusive - right.startTickInclusive
  }
  if (left.endTickExclusive !== right.endTickExclusive) {
    return left.endTickExclusive - right.endTickExclusive
  }
  return 0
}

export function buildSelectionsInTimelineRange(params: {
  anchors: Selection[]
  measurePairs: MeasurePair[]
  importedNoteLookup: Map<string, ImportedNoteLocation>
}): Selection[] {
  const { anchors, measurePairs, importedNoteLookup } = params
  if (anchors.length === 0 || measurePairs.length === 0) return []

  const resolvedAnchors = anchors
    .map((selection) =>
      resolveSelectionTimelinePoint({
        pairs: measurePairs,
        selection,
        importedNoteLookup,
      }),
    )
    .filter((entry): entry is SelectionTimelinePoint => entry !== null)
  if (resolvedAnchors.length === 0) return []

  let earliest = resolvedAnchors[0]
  let latestEnding = resolvedAnchors[0]
  resolvedAnchors.forEach((entry) => {
    if (compareTimelinePoint(entry, earliest) < 0) earliest = entry
    if (
      entry.pairIndex > latestEnding.pairIndex ||
      (entry.pairIndex === latestEnding.pairIndex && entry.endTickExclusive > latestEnding.endTickExclusive)
    ) {
      latestEnding = entry
    }
  })

  const rangeStartPairIndex = earliest.pairIndex
  const rangeStartTickInclusive = earliest.startTickInclusive
  const rangeEndPairIndex = latestEnding.pairIndex
  const rangeEndTickExclusive = latestEnding.endTickExclusive

  const staffsToScan = [...new Set(resolvedAnchors.map((entry) => entry.staff))]

  const nextSelections: Selection[] = []
  const seen = new Set<string>()

  for (let pairIndex = rangeStartPairIndex; pairIndex <= rangeEndPairIndex; pairIndex += 1) {
    const pair = measurePairs[pairIndex]
    if (!pair) continue

    staffsToScan.forEach((staff) => {
      const notes = staff === 'treble' ? pair.treble : pair.bass
      const onsetTicksByNoteIndex = buildStaffOnsetTicks(notes)
      notes.forEach((note, noteIndex) => {
        const onsetTicksInMeasure = onsetTicksByNoteIndex[noteIndex]
        if (!Number.isFinite(onsetTicksInMeasure)) return
        if (pairIndex === rangeStartPairIndex && onsetTicksInMeasure < rangeStartTickInclusive) return
        if (pairIndex === rangeEndPairIndex && onsetTicksInMeasure >= rangeEndTickExclusive) return

        const maxKeyIndex = note.chordPitches?.length ?? 0
        for (let keyIndex = 0; keyIndex <= maxKeyIndex; keyIndex += 1) {
          const selection: Selection = {
            staff,
            noteId: note.id,
            keyIndex,
          }
          const key = buildSelectionKey(selection)
          if (seen.has(key)) continue
          seen.add(key)
          nextSelections.push(selection)
        }
      })
    })
  }

  if (nextSelections.length > 0) return nextSelections

  // Fallback for defensive completeness.
  return anchors.reduce<Selection[]>((acc, selection) => {
    if (acc.some((entry) => isSameSelection(entry, selection))) return acc
    acc.push(selection)
    return acc
  }, [])
}
