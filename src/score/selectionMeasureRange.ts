import type { MeasurePair, Selection } from './types'

function getSelectionKey(selection: Selection): string {
  return `${selection.staff}|${selection.noteId}|${selection.keyIndex}`
}

export function buildSelectionsForMeasureRange(params: {
  measurePairs: MeasurePair[]
  startPairIndex: number
  endPairIndexInclusive: number
}): Selection[] {
  const { measurePairs, startPairIndex, endPairIndexInclusive } = params
  if (measurePairs.length === 0) return []

  const safeStartPairIndex = Math.max(0, Math.min(measurePairs.length - 1, Math.trunc(startPairIndex)))
  const safeEndPairIndex = Math.max(safeStartPairIndex, Math.min(measurePairs.length - 1, Math.trunc(endPairIndexInclusive)))
  const selections: Selection[] = []

  for (let pairIndex = safeStartPairIndex; pairIndex <= safeEndPairIndex; pairIndex += 1) {
    const pair = measurePairs[pairIndex]
    if (!pair) continue

    ;(['treble', 'bass'] as const).forEach((staff) => {
      const notes = staff === 'treble' ? pair.treble : pair.bass
      notes.forEach((note) => {
        const maxKeyIndex = note.chordPitches?.length ?? 0
        for (let keyIndex = 0; keyIndex <= maxKeyIndex; keyIndex += 1) {
          selections.push({
            noteId: note.id,
            staff,
            keyIndex,
          })
        }
      })
    })
  }

  return selections
}

export function buildSelectionSetSignature(selections: Selection[]): string {
  if (selections.length === 0) return ''
  const uniqueKeys = new Set<string>()
  selections.forEach((selection) => {
    uniqueKeys.add(getSelectionKey(selection))
  })
  return [...uniqueKeys].sort().join(',')
}
