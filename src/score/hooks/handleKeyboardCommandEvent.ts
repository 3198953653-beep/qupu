import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { NoteClipboardPayload } from '../copyPasteTypes'
import type {
  ImportedNoteLocation,
  MeasurePair,
  Pitch,
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

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function handleKeyboardCommandEvent(params: {
  event: KeyboardEvent
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
  noteClipboardRef: MutableRefObject<NoteClipboardPayload | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  undoLastScoreEdit: () => boolean
  handleMoveSelectionsByKeyboardSteps: (
    direction: 'up' | 'down',
    staffSteps: number,
    scope?: 'active' | 'selected',
  ) => boolean
  handleMoveSelectionByKeyboardArrow: (direction: 'up' | 'down') => boolean
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
  setActiveTieSelection: StateSetter<TieSelection | null>
  setActiveAccidentalSelection: StateSetter<Selection | null>
  setIsSelectionVisible: StateSetter<boolean>
  setSelectedSelections: StateSetter<Selection[]>
  setSelectedMeasureScope: StateSetter<MeasureScope>
  setNotationPaletteLastAction: StateSetter<string>
}) {
  const {
    event,
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
    noteClipboardRef,
    importedNoteLookupRef,
    measureKeyFifthsFromImportRef,
    measureTimeSignaturesFromImportRef,
    measurePairsFromImportRef,
    scoreScrollRef,
    undoLastScoreEdit,
    handleMoveSelectionsByKeyboardSteps,
    handleMoveSelectionByKeyboardArrow,
    applyKeyboardEditResult,
    playAccidentalEditPreview,
    setActiveTieSelection,
    setActiveAccidentalSelection,
    setIsSelectionVisible,
    setSelectedSelections,
    setSelectedMeasureScope,
    setNotationPaletteLastAction,
  } = params

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
