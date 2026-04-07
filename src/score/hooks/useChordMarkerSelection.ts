import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import { collectMeasureTickRangeNotes } from '../chordRangeNoteCoverage'
import type { MeasurePair, Selection, SelectionFrameIntent } from '../types'
import type { ActiveChordSelection, ChordRulerMarkerMeta } from './chordMarkerTypes'

function buildSelectionsForMeasureTickRange(
  pair: MeasurePair,
  startTickInclusive: number,
  endTickExclusive: number,
): Selection[] {
  const selections: Selection[] = []
  collectMeasureTickRangeNotes({
    pair,
    startTickInclusive,
    endTickExclusive,
    includeRests: true,
  }).forEach(({ staff, note }) => {
    const maxKeyIndex = note.chordPitches?.length ?? 0
    for (let keyIndex = 0; keyIndex <= maxKeyIndex; keyIndex += 1) {
      selections.push({
        noteId: note.id,
        staff,
        keyIndex,
      })
    }
  })
  return selections
}

export function useChordMarkerSelection(params: {
  measurePairsRef: MutableRefObject<MeasurePair[]>
  chordRulerMarkerMetaByKey: Map<string, ChordRulerMarkerMeta>
  setIsSelectionVisible: (visible: boolean) => void
  setSelectedSelections: (selections: Selection[]) => void
  setActiveSelection: (selection: Selection) => void
  setSelectionFrameIntent: (intent: SelectionFrameIntent) => void
  clearActiveAccidentalSelection: () => void
  clearActiveTieSelection: () => void
  clearActivePedalSelection: () => void
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
    setSelectionFrameIntent,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearActivePedalSelection,
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
    clearActivePedalSelection()
    clearSelectedMeasureScope()
    clearDraggingSelection()
    setSelectionFrameIntent('default')
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
    clearActivePedalSelection,
    clearActiveTieSelection,
    clearDraggingSelection,
    clearSelectedMeasureScope,
    measurePairsRef,
    resetMidiStepChain,
    setActiveSelection,
    setIsSelectionVisible,
    setSelectionFrameIntent,
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
