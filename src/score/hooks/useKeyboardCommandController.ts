import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { NoteClipboardPayload } from '../copyPasteTypes'
import type {
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  Pitch,
  ScoreNote,
  Selection,
  TieSelection,
  TimeSignature,
} from '../types'
import { handleCopyShortcut, handlePasteShortcut } from './keyboardClipboardCommands'
import {
  handleDeleteAccidentalCommand,
  handleDeleteMeasureCommand,
  handleDeleteSelectedKeyCommand,
  handleDeleteTieCommand,
  handleEscapeCommand,
} from './keyboardDeleteCommands'
import { handleAppendIntervalCommand } from './keyboardIntervalCommands'
import { isTextInputTarget, type MeasureScope } from './keyboardCommandShared'
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
  applyKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections?: Selection[],
    source?: 'default' | 'midi-step',
    options?: { collapseScopesToAdd?: Array<{ pairIndex: number; staff: Selection['staff'] }> },
  ) => void
  playAccidentalEditPreview: (params: {
    pairs: MeasurePair[]
    previewSelection: Selection | null
    previewPitch: Pitch | null
    importedNoteLookup?: Map<string, ImportedNoteLocation> | null
  }) => void
  setNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setBassNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setMeasurePairsFromImport: Dispatch<SetStateAction<MeasurePair[] | null>>
  setIsSelectionVisible: Dispatch<SetStateAction<boolean>>
  setSelectedSelections: Dispatch<SetStateAction<Selection[]>>
  setSelectedMeasureScope: Dispatch<SetStateAction<MeasureScope>>
  setActiveSelection: Dispatch<SetStateAction<Selection>>
  setActiveTieSelection: Dispatch<SetStateAction<TieSelection | null>>
  setActiveAccidentalSelection: Dispatch<SetStateAction<Selection | null>>
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
    setNotes,
    setBassNotes,
    setMeasurePairsFromImport,
    setIsSelectionVisible,
    setSelectedSelections,
    setSelectedMeasureScope,
    setActiveSelection,
    setActiveTieSelection,
    setActiveAccidentalSelection,
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOsmdPreviewOpen) return
      if (draggingSelection) return
      if (isTextInputTarget(event.target)) return

      const scrollHost = scoreScrollRef.current
      if (!scrollHost) return
      const activeElement = document.activeElement
      if (!(activeElement instanceof HTMLElement)) return
      if (!(activeElement === scrollHost || scrollHost.contains(activeElement))) return

      const isUndoShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z'
      if (isUndoShortcut) {
        const restored = undoLastScoreEdit()
        if (restored) {
          event.preventDefault()
        }
        return
      }

      if (event.key === 'Escape') {
        const handled = handleEscapeCommand({
          activeTieSelection,
          activeAccidentalSelection,
          setActiveTieSelection,
          setActiveAccidentalSelection,
        })
        if (handled) {
          event.preventDefault()
        }
        return
      }

      const isCopyShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'c'
      if (isCopyShortcut) {
        event.preventDefault()
        handleCopyShortcut({
          measurePairs,
          activeSelection,
          selectedSelections,
          isSelectionVisible,
          importedNoteLookupRef,
          noteClipboardRef,
          setNotationPaletteLastAction,
        })
        return
      }

      const isPasteShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'v'
      if (isPasteShortcut) {
        event.preventDefault()
        handlePasteShortcut({
          measurePairs,
          noteClipboardRef,
          activeSelection,
          isSelectionVisible,
          importedNoteLookupRef,
          measureKeyFifthsFromImportRef,
          measureTimeSignaturesFromImportRef,
          measurePairsFromImportRef,
          applyKeyboardEditResult,
          setNotationPaletteLastAction,
        })
        return
      }

      if (event.key === 'Delete' && activeTieSelection) {
        event.preventDefault()
        handleDeleteTieCommand({
          measurePairs,
          activeTieSelection,
          activeSelection,
          applyKeyboardEditResult,
          setActiveTieSelection,
          setIsSelectionVisible,
          setSelectedSelections,
          setSelectedMeasureScope,
          setNotationPaletteLastAction,
        })
        return
      }

      if (event.key === 'Delete' && activeAccidentalSelection) {
        event.preventDefault()
        handleDeleteAccidentalCommand({
          measurePairs,
          activeAccidentalSelection,
          importedNoteLookupRef,
          measureKeyFifthsFromImportRef,
          applyKeyboardEditResult,
          playAccidentalEditPreview,
          setActiveAccidentalSelection,
          setIsSelectionVisible,
          setSelectedSelections,
          setSelectedMeasureScope,
          setNotationPaletteLastAction,
        })
        return
      }

      if (event.key === 'Delete' && selectedMeasureScope) {
        const handled = handleDeleteMeasureCommand({
          measurePairs,
          selectedMeasureScope,
          isSelectionVisible,
          measurePairsFromImportRef,
          measureKeyFifthsFromImportRef,
          measureTimeSignaturesFromImportRef,
          applyKeyboardEditResult,
          setSelectedMeasureScope,
          setSelectedSelections,
          setNotationPaletteLastAction,
        })
        if (handled) {
          event.preventDefault()
        }
        return
      }

      if (!isSelectionVisible) return

      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        const moved = handleMoveSelectionsByKeyboardSteps(event.key === 'ArrowUp' ? 'up' : 'down', 7, 'selected')
        if (moved) {
          event.preventDefault()
        }
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const moved = handleMoveSelectionByKeyboardArrow(event.key === 'ArrowUp' ? 'up' : 'down')
        if (moved) {
          event.preventDefault()
        }
        return
      }

      if (event.key === 'Delete') {
        const handled = handleDeleteSelectedKeyCommand({
          measurePairs,
          activeSelection,
          measureKeyFifthsFromImport,
          importedNoteLookupRef,
          applyKeyboardEditResult,
        })
        if (handled) {
          event.preventDefault()
        }
        return
      }

      const digitMatch = /^Digit([2-8])$/.exec(event.code)
      if (!digitMatch) return
      const intervalDegree = Number(digitMatch[1])
      if (!Number.isFinite(intervalDegree)) return
      const handled = handleAppendIntervalCommand({
        measurePairs,
        activeSelection,
        intervalDegree,
        shiftKey: event.shiftKey,
        measureKeyFifthsFromImport,
        importedNoteLookupRef,
        applyKeyboardEditResult,
      })
      if (handled) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    activeAccidentalSelection,
    activeSelection,
    activeTieSelection,
    applyKeyboardEditResult,
    draggingSelection,
    handleMoveSelectionByKeyboardArrow,
    handleMoveSelectionsByKeyboardSteps,
    importedNoteLookupRef,
    isOsmdPreviewOpen,
    isSelectionVisible,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    measurePairs,
    measurePairsFromImportRef,
    measureTimeSignaturesFromImportRef,
    playAccidentalEditPreview,
    scoreScrollRef,
    selectedMeasureScope,
    selectedSelections,
    setActiveAccidentalSelection,
    setActiveTieSelection,
    setIsSelectionVisible,
    setNotationPaletteLastAction,
    setSelectedMeasureScope,
    setSelectedSelections,
    undoLastScoreEdit,
  ])
}
