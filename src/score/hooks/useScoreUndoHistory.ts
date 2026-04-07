import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { buildImportedNoteLookup, flattenBassFromPairs, flattenTrebleFromPairs } from '../scoreOps'
import type {
  ActivePedalSelection,
  DragState,
  ImportedNoteLocation,
  MeasurePair,
  MusicXmlMetadata,
  PedalSpan,
  Selection,
  SelectionFrameIntent,
  TimeSignature,
} from '../types'
import { cloneMeasurePairs, clonePedalSpans, type UndoSnapshot } from './scoreMutationShared'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useScoreUndoHistory(params: {
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  measureKeyFifthsFromImport: number[] | null
  measureDivisionsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  musicXmlMetadataFromImport: MusicXmlMetadata | null
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  activeSelectionRef: MutableRefObject<Selection>
  activePedalSelectionRef: MutableRefObject<ActivePedalSelection | null>
  pedalSpansRef: MutableRefObject<PedalSpan[]>
  isSelectionVisibleRef: MutableRefObject<boolean>
  fullMeasureRestCollapseScopeKeysRef: MutableRefObject<string[]>
  dragRef: MutableRefObject<DragState | null>
  clearDragOverlayRef: MutableRefObject<() => void>
  clearDragPreviewState: () => void
  clearDraggingSelection: () => void
  resetMidiStepChain: () => void
  clearActiveAccidentalSelection: () => void
  clearActiveTieSelection: () => void
  clearActivePedalSelection: () => void
  clearSelectedMeasureScope: () => void
  clearActiveChordSelection: () => void
  setPedalSpans: StateSetter<PedalSpan[]>
  setMeasurePairsFromImport: StateSetter<MeasurePair[] | null>
  clearImportedChordRulerEntries: () => void
  setNotes: StateSetter<import('../types').ScoreNote[]>
  setBassNotes: StateSetter<import('../types').ScoreNote[]>
  setIsSelectionVisible: StateSetter<boolean>
  setFullMeasureRestCollapseScopeKeys: StateSetter<string[]>
  setActiveSelection: StateSetter<Selection>
  setActivePedalSelection: StateSetter<ActivePedalSelection | null>
  setSelectedSelections: StateSetter<Selection[]>
  setSelectionFrameIntent: StateSetter<SelectionFrameIntent>
}) {
  const {
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureDivisionsFromImport,
    measureTimeSignaturesFromImport,
    musicXmlMetadataFromImport,
    importedNoteLookupRef,
    activeSelectionRef,
    activePedalSelectionRef,
    pedalSpansRef,
    isSelectionVisibleRef,
    fullMeasureRestCollapseScopeKeysRef,
    dragRef,
    clearDragOverlayRef,
    clearDragPreviewState,
    clearDraggingSelection,
    resetMidiStepChain,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearActivePedalSelection,
    clearSelectedMeasureScope,
    clearActiveChordSelection,
    setPedalSpans,
    setMeasurePairsFromImport,
    clearImportedChordRulerEntries,
    setNotes,
    setBassNotes,
    setIsSelectionVisible,
    setFullMeasureRestCollapseScopeKeys,
    setActiveSelection,
    setActivePedalSelection,
    setSelectedSelections,
    setSelectionFrameIntent,
  } = params

  const undoHistoryRef = useRef<UndoSnapshot[]>([])

  useEffect(() => {
    undoHistoryRef.current = []
  }, [
    measureKeyFifthsFromImport,
    measureDivisionsFromImport,
    measureTimeSignaturesFromImport,
    musicXmlMetadataFromImport,
  ])

  const pushUndoSnapshot = useCallback((sourcePairs: MeasurePair[]) => {
    if (!sourcePairs || sourcePairs.length === 0) return
    const stack = undoHistoryRef.current
    stack.push({
      pairs: cloneMeasurePairs(sourcePairs),
      imported: measurePairsFromImportRef.current !== null,
      selection: { ...activeSelectionRef.current },
      isSelectionVisible: isSelectionVisibleRef.current,
      fullMeasureRestCollapseScopeKeys: [...fullMeasureRestCollapseScopeKeysRef.current],
      pedalSpans: clonePedalSpans(pedalSpansRef.current),
      activePedalSelection: activePedalSelectionRef.current ? { ...activePedalSelectionRef.current } : null,
    })
    if (stack.length > 120) {
      stack.splice(0, stack.length - 120)
    }
  }, [
    activeSelectionRef,
    fullMeasureRestCollapseScopeKeysRef,
    isSelectionVisibleRef,
    measurePairsFromImportRef,
  ])

  const undoLastScoreEdit = useCallback((): boolean => {
    const stack = undoHistoryRef.current
    if (stack.length === 0) return false
    const snapshot = stack.pop()
    if (!snapshot) return false

    const restoredPairs = cloneMeasurePairs(snapshot.pairs)
    clearDragPreviewState()
    dragRef.current = null
    clearDragOverlayRef.current()
    clearDraggingSelection()
    resetMidiStepChain()

    if (snapshot.imported) {
      measurePairsFromImportRef.current = restoredPairs
      setMeasurePairsFromImport(restoredPairs)
    } else {
      measurePairsFromImportRef.current = null
      setMeasurePairsFromImport(null)
      clearImportedChordRulerEntries()
    }
    importedNoteLookupRef.current = buildImportedNoteLookup(restoredPairs)
    setNotes(flattenTrebleFromPairs(restoredPairs))
    setBassNotes(flattenBassFromPairs(restoredPairs))
    setPedalSpans(clonePedalSpans(snapshot.pedalSpans))
    setIsSelectionVisible(snapshot.isSelectionVisible)
    clearActiveAccidentalSelection()
    clearActiveTieSelection()
    clearActivePedalSelection()
    clearSelectedMeasureScope()
    clearActiveChordSelection()
    setFullMeasureRestCollapseScopeKeys(snapshot.fullMeasureRestCollapseScopeKeys)
    setSelectionFrameIntent('default')
    setActiveSelection(snapshot.selection)
    setActivePedalSelection(
      snapshot.activePedalSelection &&
        snapshot.pedalSpans.some((span) => span.id === snapshot.activePedalSelection?.pedalId)
        ? { ...snapshot.activePedalSelection }
        : null,
    )
    setSelectedSelections(snapshot.isSelectionVisible ? [snapshot.selection] : [])
    return true
  }, [
    clearActiveAccidentalSelection,
    clearActiveChordSelection,
    clearActivePedalSelection,
    clearActiveTieSelection,
    clearDragOverlayRef,
    clearDragPreviewState,
    clearDraggingSelection,
    clearImportedChordRulerEntries,
    clearSelectedMeasureScope,
    dragRef,
    importedNoteLookupRef,
    measurePairsFromImportRef,
    resetMidiStepChain,
    setActiveSelection,
    setActivePedalSelection,
    setBassNotes,
    setFullMeasureRestCollapseScopeKeys,
    setIsSelectionVisible,
    setMeasurePairsFromImport,
    setNotes,
    setPedalSpans,
    setSelectedSelections,
    setSelectionFrameIntent,
  ])

  return {
    pushUndoSnapshot,
    undoLastScoreEdit,
  }
}
