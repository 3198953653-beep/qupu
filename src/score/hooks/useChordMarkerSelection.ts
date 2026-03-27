import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import { buildStaffOnsetTicks } from '../selectionTimelineRange'
import type { MeasurePair, Selection } from '../types'
import type { ActiveChordSelection, ChordRulerMarkerMeta } from './chordMarkerTypes'

function buildSelectionsForMeasureTickRange(
  pair: MeasurePair,
  startTickInclusive: number,
  endTickExclusive: number,
): Selection[] {
  const safeStartTick = Math.max(0, Math.round(startTickInclusive))
  const safeEndTick = Math.max(safeStartTick, Math.round(endTickExclusive))
  if (safeEndTick <= safeStartTick) return []
  const selections: Selection[] = []
  ;(['treble', 'bass'] as const).forEach((staff) => {
    const notes = staff === 'treble' ? pair.treble : pair.bass
    const onsetTicksByNoteIndex = buildStaffOnsetTicks(notes)
    notes.forEach((note, noteIndex) => {
      const onsetTick = onsetTicksByNoteIndex[noteIndex]
      if (!Number.isFinite(onsetTick)) return
      if (onsetTick < safeStartTick || onsetTick >= safeEndTick) return
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
  return selections
}

export function useChordMarkerSelection(params: {
  measurePairsRef: MutableRefObject<MeasurePair[]>
  chordRulerMarkerMetaByKey: Map<string, ChordRulerMarkerMeta>
  setIsSelectionVisible: (visible: boolean) => void
  setSelectedSelections: (selections: Selection[]) => void
  setActiveSelection: (selection: Selection) => void
  clearActiveAccidentalSelection: () => void
  clearActiveTieSelection: () => void
  clearSelectedMeasureScope: () => void
  clearDraggingSelection: () => void
  resetMidiStepChain: () => void
}) {
  const {
    measurePairsRef,
    chordRulerMarkerMetaByKey,
    setIsSelectionVisible,
    setSelectedSelections,
    setActiveSelection,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    clearDraggingSelection,
    resetMidiStepChain,
  } = params

  const [activeChordSelection, setActiveChordSelection] = useState<ActiveChordSelection | null>(null)

  const clearActiveChordSelection = useCallback(() => {
    setActiveChordSelection(null)
  }, [])

  useEffect(() => {
    if (!activeChordSelection) return
    if (activeChordSelection.markerKey === null) return
    if (chordRulerMarkerMetaByKey.has(activeChordSelection.markerKey)) return
    setActiveChordSelection(null)
  }, [activeChordSelection, chordRulerMarkerMetaByKey])

  const applyChordSelectionRange = useCallback((selectionParams: {
    pairIndex: number
    startTick: number
    endTick: number
    markerKey?: string | null
  }): Selection[] => {
    const targetPair = measurePairsRef.current[selectionParams.pairIndex]
    if (!targetPair) return []
    const nextSelections = buildSelectionsForMeasureTickRange(
      targetPair,
      selectionParams.startTick,
      selectionParams.endTick,
    )
    resetMidiStepChain()
    clearActiveAccidentalSelection()
    clearActiveTieSelection()
    clearSelectedMeasureScope()
    clearDraggingSelection()
    if (nextSelections.length > 0) {
      setIsSelectionVisible(true)
      setSelectedSelections(nextSelections)
      setActiveSelection(nextSelections[0])
    } else {
      setIsSelectionVisible(false)
      setSelectedSelections([])
    }
    setActiveChordSelection({
      markerKey: selectionParams.markerKey ?? null,
      pairIndex: selectionParams.pairIndex,
      startTick: selectionParams.startTick,
      endTick: selectionParams.endTick,
    })
    return nextSelections
  }, [
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearDraggingSelection,
    clearSelectedMeasureScope,
    measurePairsRef,
    resetMidiStepChain,
    setActiveSelection,
    setIsSelectionVisible,
    setSelectedSelections,
  ])

  const onChordRulerMarkerClick = useCallback((markerKey: string) => {
    const marker = chordRulerMarkerMetaByKey.get(markerKey)
    if (!marker) return
    applyChordSelectionRange({
      pairIndex: marker.pairIndex,
      startTick: marker.startTick,
      endTick: marker.endTick,
      markerKey: marker.key,
    })
  }, [applyChordSelectionRange, chordRulerMarkerMetaByKey])

  return {
    activeChordSelection,
    clearActiveChordSelection,
    applyChordSelectionRange,
    onChordRulerMarkerClick,
  }
}
