import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { NoteClipboardPayload } from '../copyPasteTypes'
import type {
  ActivePedalSelection,
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  PedalSpan,
  ScoreNote,
  Selection,
  TieSelection,
  TimeSignature,
} from '../types'
import { type MeasureScope } from './keyboardCommandShared'
import type {
  KeyboardAccidentalPreviewPlayer,
  KeyboardEditResultApplier,
} from './keyboardCommandTypes'
import { useKeyboardCommandEffect } from './useKeyboardCommandEffect'
import { moveSelectionByKeyboardArrow, moveSelectionsByKeyboardSteps } from './keyboardSelectionCommands'

export function useKeyboardCommandController(params: {
  isOsmdPreviewOpen: boolean
  draggingSelection: Selection | null
  isSelectionVisible: boolean
  measurePairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  selectedMeasureScope: MeasureScope
  activeTieSelection: TieSelection | null
  activeAccidentalSelection: Selection | null
  activePedalSelection: ActivePedalSelection | null
  pedalSpans: PedalSpan[]
  measureKeyFifthsFromImport: number[] | null
  activeSelectionRef: MutableRefObject<Selection>
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  layoutReflowHintRef: MutableRefObject<LayoutReflowHint | null>
  layoutStabilityKey: string
  pushUndoSnapshot: (sourcePairs: MeasurePair[]) => void
  resetMidiStepChain: () => void
  undoLastScoreEdit: () => boolean
  applyKeyboardEditResult: KeyboardEditResultApplier
  playAccidentalEditPreview: KeyboardAccidentalPreviewPlayer
  setPedalSpans: Dispatch<SetStateAction<PedalSpan[]>>
  setNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setBassNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setMeasurePairsFromImport: Dispatch<SetStateAction<MeasurePair[] | null>>
  setIsSelectionVisible: Dispatch<SetStateAction<boolean>>
  setSelectedSelections: Dispatch<SetStateAction<Selection[]>>
  setSelectedMeasureScope: Dispatch<SetStateAction<MeasureScope>>
  setActiveSelection: Dispatch<SetStateAction<Selection>>
  setActiveTieSelection: Dispatch<SetStateAction<TieSelection | null>>
  setActiveAccidentalSelection: Dispatch<SetStateAction<Selection | null>>
  setActivePedalSelection: Dispatch<SetStateAction<ActivePedalSelection | null>>
  setNotationPaletteLastAction: Dispatch<SetStateAction<string>>
}): void {
  const {
    isOsmdPreviewOpen,
    draggingSelection,
    isSelectionVisible,
    measurePairs,
    activeSelection,
    selectedSelections,
    selectedMeasureScope,
    activeTieSelection,
    activeAccidentalSelection,
    activePedalSelection,
    pedalSpans,
    measureKeyFifthsFromImport,
    activeSelectionRef,
    measurePairsRef,
    measurePairsFromImportRef,
    importedNoteLookupRef,
    measureLayoutsRef,
    measureKeyFifthsFromImportRef,
    measureTimeSignaturesFromImportRef,
    scoreScrollRef,
    layoutReflowHintRef,
    layoutStabilityKey,
    pushUndoSnapshot,
    resetMidiStepChain,
    undoLastScoreEdit,
    applyKeyboardEditResult,
    playAccidentalEditPreview,
    setPedalSpans,
    setNotes,
    setBassNotes,
    setMeasurePairsFromImport,
    setIsSelectionVisible,
    setSelectedSelections,
    setSelectedMeasureScope,
    setActiveSelection,
    setActiveTieSelection,
    setActiveAccidentalSelection,
    setActivePedalSelection,
    setNotationPaletteLastAction,
  } = params

  const noteClipboardRef = useRef<NoteClipboardPayload | null>(null)

  const handleMoveSelectionsByKeyboardSteps = useCallback((
    direction: 'up' | 'down',
    staffSteps: number,
    scope: 'active' | 'selected' = 'active',
  ): boolean => {
    return moveSelectionsByKeyboardSteps({
      direction,
      staffSteps,
      scope,
      activeSelectionRef,
      selectedSelections,
      measurePairsRef,
      measurePairsFromImportRef,
      importedNoteLookupRef,
      measureLayoutsRef,
      measureKeyFifthsFromImportRef,
      layoutReflowHintRef,
      layoutStabilityKey,
      pushUndoSnapshot,
      resetMidiStepChain,
      setNotes,
      setBassNotes,
      setMeasurePairsFromImport,
      setIsSelectionVisible,
      setActiveSelection,
      setSelectedSelections,
    })
  }, [
    activeSelectionRef,
    importedNoteLookupRef,
    layoutReflowHintRef,
    layoutStabilityKey,
    measureKeyFifthsFromImportRef,
    measureLayoutsRef,
    measurePairsFromImportRef,
    measurePairsRef,
    pushUndoSnapshot,
    resetMidiStepChain,
    selectedSelections,
    setActiveSelection,
    setBassNotes,
    setIsSelectionVisible,
    setMeasurePairsFromImport,
    setNotes,
    setSelectedSelections,
  ])

  const handleMoveSelectionByKeyboardArrow = useCallback((direction: 'up' | 'down'): boolean => {
    return moveSelectionByKeyboardArrow({
      direction,
      activeSelectionRef,
      selectedSelections,
      measurePairsRef,
      measurePairsFromImportRef,
      importedNoteLookupRef,
      measureLayoutsRef,
      measureKeyFifthsFromImportRef,
      layoutReflowHintRef,
      layoutStabilityKey,
      pushUndoSnapshot,
      resetMidiStepChain,
      setNotes,
      setBassNotes,
      setMeasurePairsFromImport,
      setIsSelectionVisible,
      setActiveSelection,
      setSelectedSelections,
    })
  }, [
    activeSelectionRef,
    importedNoteLookupRef,
    layoutReflowHintRef,
    layoutStabilityKey,
    measureKeyFifthsFromImportRef,
    measureLayoutsRef,
    measurePairsFromImportRef,
    measurePairsRef,
    pushUndoSnapshot,
    resetMidiStepChain,
    selectedSelections,
    setActiveSelection,
    setBassNotes,
    setIsSelectionVisible,
    setMeasurePairsFromImport,
    setNotes,
    setSelectedSelections,
  ])

  useKeyboardCommandEffect({
    isOsmdPreviewOpen,
    draggingSelection,
    isSelectionVisible,
    measurePairs,
    activeSelection,
    selectedSelections,
    selectedMeasureScope,
    activeTieSelection,
    activeAccidentalSelection,
    activePedalSelection,
    pedalSpans,
    measureKeyFifthsFromImport,
    noteClipboardRef,
    importedNoteLookupRef,
    measureKeyFifthsFromImportRef,
    measureTimeSignaturesFromImportRef,
    measurePairsFromImportRef,
    scoreScrollRef,
    undoLastScoreEdit,
    handleMoveSelectionsByKeyboardSteps,
    handleMoveSelectionByKeyboardArrow,
    pushUndoSnapshot,
    applyKeyboardEditResult,
    playAccidentalEditPreview,
    setPedalSpans,
    setActiveTieSelection,
    setActiveAccidentalSelection,
    setActivePedalSelection,
    setIsSelectionVisible,
    setSelectedSelections,
    setSelectedMeasureScope,
    setNotationPaletteLastAction,
  })
}
