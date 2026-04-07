import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { MeasureStaffScope } from '../fullMeasureRestCollapse'
import type {
  ActivePedalSelection,
  DragState,
  ImportedNoteLocation,
  MeasurePair,
  MusicXmlMetadata,
  PedalSpan,
  ScoreNote,
  Selection,
  TimeSignature,
} from '../types'
import { applyScoreMutationResult } from './applyScoreMutationResult'
import { useScoreMidiStepMutation } from './useScoreMidiStepMutation'
import { useScoreUndoHistory } from './useScoreUndoHistory'

export function useScoreMutationController(params: {
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  measureKeyFifthsFromImport: number[] | null
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureDivisionsFromImport: number[] | null
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImport: TimeSignature[] | null
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  musicXmlMetadataFromImport: MusicXmlMetadata | null
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  selectedSelectionsRef: MutableRefObject<Selection[]>
  activeSelectionRef: MutableRefObject<Selection>
  activePedalSelectionRef: MutableRefObject<ActivePedalSelection | null>
  pedalSpansRef: MutableRefObject<PedalSpan[]>
  isSelectionVisibleRef: MutableRefObject<boolean>
  fullMeasureRestCollapseScopeKeysRef: MutableRefObject<string[]>
  midiStepChainRef: MutableRefObject<boolean>
  midiStepLastSelectionRef: MutableRefObject<Selection | null>
  dragRef: MutableRefObject<DragState | null>
  draggingSelectionRef: MutableRefObject<Selection | null>
  isOsmdPreviewOpenRef: MutableRefObject<boolean>
  clearDragOverlayRef: MutableRefObject<() => void>
  clearDragPreviewState: () => void
  clearDraggingSelection: () => void
  resetMidiStepChain: () => void
  clearActiveAccidentalSelection: () => void
  clearActiveTieSelection: () => void
  clearActivePedalSelection: () => void
  clearSelectedMeasureScope: () => void
  clearActiveChordSelection: () => void
  setPedalSpans: Dispatch<SetStateAction<PedalSpan[]>>
  setMeasurePairsFromImport: Dispatch<SetStateAction<MeasurePair[] | null>>
  clearImportedChordRulerEntries: () => void
  setNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setBassNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setIsSelectionVisible: Dispatch<SetStateAction<boolean>>
  setFullMeasureRestCollapseScopeKeys: Dispatch<SetStateAction<string[]>>
  setActiveSelection: Dispatch<SetStateAction<Selection>>
  setSelectedSelections: Dispatch<SetStateAction<Selection[]>>
  setSelectionFrameIntent: Dispatch<SetStateAction<import('../types').SelectionFrameIntent>>
  setActivePedalSelection: Dispatch<SetStateAction<ActivePedalSelection | null>>
  setIsRhythmLinked: Dispatch<SetStateAction<boolean>>
  setMeasureKeyFifthsFromImport: Dispatch<SetStateAction<number[] | null>>
  setMeasureDivisionsFromImport: Dispatch<SetStateAction<number[] | null>>
  setMeasureTimeSignaturesFromImport: Dispatch<SetStateAction<TimeSignature[] | null>>
}): {
  pushUndoSnapshot: (sourcePairs: MeasurePair[]) => void
  undoLastScoreEdit: () => boolean
  applyKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections?: Selection[],
    source?: 'default' | 'midi-step',
    options?: { collapseScopesToAdd?: MeasureStaffScope[] },
  ) => void
  applyMidiReplacementByNoteNumber: (midiNoteNumber: number) => void
  applyTemporaryKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections?: Selection[],
    options?: { collapseScopesToAdd?: MeasureStaffScope[] },
  ) => void
} {
  const {
    measurePairsRef,
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImport,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImport,
    importedNoteLookupRef,
    selectedSelectionsRef,
    activeSelectionRef,
    activePedalSelectionRef,
    pedalSpansRef,
    isSelectionVisibleRef,
    fullMeasureRestCollapseScopeKeysRef,
    midiStepChainRef,
    midiStepLastSelectionRef,
    dragRef,
    draggingSelectionRef,
    isOsmdPreviewOpenRef,
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
    setSelectedSelections,
    setSelectionFrameIntent,
    setActivePedalSelection,
    setIsRhythmLinked,
    setMeasureKeyFifthsFromImport,
    setMeasureDivisionsFromImport,
    setMeasureTimeSignaturesFromImport,
  } = params

  const { pushUndoSnapshot, undoLastScoreEdit } = useScoreUndoHistory({
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
  })

  const applyKeyboardEditResult = useCallback((
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections: Selection[] = [nextSelection],
    source: 'default' | 'midi-step' = 'default',
    options?: { collapseScopesToAdd?: MeasureStaffScope[] },
  ) => {
    applyScoreMutationResult({
      nextPairs,
      nextSelection,
      nextSelections,
      source,
      options,
      measurePairsRef,
      measurePairsFromImportRef,
      importedNoteLookupRef,
      pushUndoSnapshot,
      resetMidiStepChain,
      clearActiveAccidentalSelection,
      clearActiveTieSelection,
      clearSelectedMeasureScope,
      clearActiveChordSelection,
      setMeasurePairsFromImport,
      setNotes,
      setBassNotes,
      setIsSelectionVisible,
      setFullMeasureRestCollapseScopeKeys,
      setActiveSelection,
      setSelectedSelections,
      setSelectionFrameIntent,
      setIsRhythmLinked,
    })
  }, [
    clearActiveAccidentalSelection,
    clearActiveChordSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    importedNoteLookupRef,
    measurePairsFromImportRef,
    measurePairsRef,
    pushUndoSnapshot,
    resetMidiStepChain,
    setActiveSelection,
    setBassNotes,
    setFullMeasureRestCollapseScopeKeys,
    setIsRhythmLinked,
    setIsSelectionVisible,
    setMeasurePairsFromImport,
    setNotes,
    setSelectionFrameIntent,
    setSelectedSelections,
  ])

  const { applyMidiReplacementByNoteNumber } = useScoreMidiStepMutation({
    measurePairsRef,
    measurePairsFromImportRef,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    importedNoteLookupRef,
    selectedSelectionsRef,
    activeSelectionRef,
    isSelectionVisibleRef,
    midiStepChainRef,
    midiStepLastSelectionRef,
    dragRef,
    draggingSelectionRef,
    isOsmdPreviewOpenRef,
    applyKeyboardEditResult,
    setMeasureKeyFifthsFromImport,
    setMeasureDivisionsFromImport,
    setMeasureTimeSignaturesFromImport,
  })

  const applyTemporaryKeyboardEditResult = useCallback((
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections: Selection[] = [nextSelection],
    options?: { collapseScopesToAdd?: MeasureStaffScope[] },
  ) => {
    applyScoreMutationResult({
      nextPairs,
      nextSelection,
      nextSelections,
      source: 'default',
      skipUndoSnapshot: true,
      options,
      measurePairsRef,
      measurePairsFromImportRef,
      importedNoteLookupRef,
      pushUndoSnapshot,
      resetMidiStepChain,
      clearActiveAccidentalSelection,
      clearActiveTieSelection,
      clearSelectedMeasureScope,
      clearActiveChordSelection,
      setMeasurePairsFromImport,
      setNotes,
      setBassNotes,
      setIsSelectionVisible,
      setFullMeasureRestCollapseScopeKeys,
      setActiveSelection,
      setSelectedSelections,
      setSelectionFrameIntent,
      setIsRhythmLinked,
    })
  }, [
    clearActiveAccidentalSelection,
    clearActiveChordSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    importedNoteLookupRef,
    measurePairsFromImportRef,
    measurePairsRef,
    pushUndoSnapshot,
    resetMidiStepChain,
    setActiveSelection,
    setBassNotes,
    setFullMeasureRestCollapseScopeKeys,
    setIsRhythmLinked,
    setIsSelectionVisible,
    setMeasurePairsFromImport,
    setNotes,
    setSelectionFrameIntent,
    setSelectedSelections,
  ])

  return {
    pushUndoSnapshot,
    undoLastScoreEdit,
    applyKeyboardEditResult,
    applyMidiReplacementByNoteNumber,
    applyTemporaryKeyboardEditResult,
  }
}
