import { handleCopyShortcut, handlePasteShortcut } from './keyboardClipboardCommands'
import {
  handleDeleteAccidentalCommand,
  handleDeleteMeasureCommand,
  handleDeletePedalCommand,
  handleDeleteSelectedKeyCommand,
  handleDeleteTieCommand,
  handleEscapeCommand,
} from './keyboardDeleteCommands'
import { handleAppendIntervalCommand } from './keyboardIntervalCommands'
import {
  getIntervalDegreeFromKeyboardEvent,
  isActiveSelectionMoveShortcut,
  isCopyShortcut,
  isPasteShortcut,
  isSelectedScopeMoveShortcut,
  isUndoShortcut,
} from './keyboardCommandPredicates'
import type { KeyboardCommandEventParams, KeyboardCommandResult } from './keyboardCommandTypes'

export function handleGlobalKeyboardCommand(params: KeyboardCommandEventParams): KeyboardCommandResult {
  const {
    event,
    activeTieSelection,
    activeAccidentalSelection,
    activePedalSelection,
    undoLastScoreEdit,
    measurePairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookupRef,
    noteClipboardRef,
    measureKeyFifthsFromImportRef,
    measureTimeSignaturesFromImportRef,
    measurePairsFromImportRef,
    applyKeyboardEditResult,
    setActiveTieSelection,
    setActiveAccidentalSelection,
    setActivePedalSelection,
    setNotationPaletteLastAction,
  } = params

  if (isUndoShortcut(event)) {
    const restored = undoLastScoreEdit()
    return restored ? 'handled-prevent-default' : 'handled'
  }

  if (event.key === 'Escape') {
    const handled = handleEscapeCommand({
      activeTieSelection,
      activeAccidentalSelection,
      activePedalSelection,
      setActiveTieSelection,
      setActiveAccidentalSelection,
      setActivePedalSelection,
    })
    return handled ? 'handled-prevent-default' : 'handled'
  }

  if (isCopyShortcut(event)) {
    handleCopyShortcut({
      measurePairs,
      activeSelection,
      selectedSelections,
      isSelectionVisible,
      importedNoteLookupRef,
      noteClipboardRef,
      setNotationPaletteLastAction,
    })
    return 'handled-prevent-default'
  }

  if (isPasteShortcut(event)) {
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
    return 'handled-prevent-default'
  }

  return 'not-handled'
}

export function handleDeleteKeyboardCommand(params: KeyboardCommandEventParams): KeyboardCommandResult {
  const {
    event,
    measurePairs,
    activeSelection,
    activeTieSelection,
    activeAccidentalSelection,
    activePedalSelection,
    pedalSpans,
    selectedMeasureScope,
    isSelectionVisible,
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    importedNoteLookupRef,
    measureTimeSignaturesFromImportRef,
    applyKeyboardEditResult,
    pushUndoSnapshot,
    playAccidentalEditPreview,
    setPedalSpans,
    setActiveTieSelection,
    setActiveAccidentalSelection,
    setActivePedalSelection,
    setIsSelectionVisible,
    setSelectedSelections,
    setSelectedMeasureScope,
    setNotationPaletteLastAction,
  } = params

  if (event.key !== 'Delete') return 'not-handled'

  if (activeTieSelection) {
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
    return 'handled-prevent-default'
  }

  if (activeAccidentalSelection) {
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
    return 'handled-prevent-default'
  }

  if (activePedalSelection) {
    handleDeletePedalCommand({
      measurePairs,
      pedalSpans,
      activePedalSelection,
      pushUndoSnapshot,
      setPedalSpans,
      setActivePedalSelection,
      setIsSelectionVisible,
      setSelectedSelections,
      setSelectedMeasureScope,
      setNotationPaletteLastAction,
    })
    return 'handled-prevent-default'
  }

  if (selectedMeasureScope) {
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
    return handled ? 'handled-prevent-default' : 'handled'
  }

  if (!isSelectionVisible) {
    return 'not-handled'
  }

  const handled = handleDeleteSelectedKeyCommand({
    measurePairs,
    activeSelection,
    measureKeyFifthsFromImport,
    importedNoteLookupRef,
    applyKeyboardEditResult,
  })
  return handled ? 'handled-prevent-default' : 'handled'
}

export function handleSelectionKeyboardCommand(params: KeyboardCommandEventParams): KeyboardCommandResult {
  const {
    event,
    handleMoveSelectionsByKeyboardSteps,
    handleMoveSelectionByKeyboardArrow,
  } = params

  if (isSelectedScopeMoveShortcut(event)) {
    const moved = handleMoveSelectionsByKeyboardSteps(event.key === 'ArrowUp' ? 'up' : 'down', 7, 'selected')
    return moved ? 'handled-prevent-default' : 'handled'
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return 'not-handled'
  }

  if (isActiveSelectionMoveShortcut(event)) {
    const moved = handleMoveSelectionByKeyboardArrow(event.key === 'ArrowUp' ? 'up' : 'down')
    return moved ? 'handled-prevent-default' : 'handled'
  }

  return 'not-handled'
}

export function handleIntervalKeyboardCommand(params: KeyboardCommandEventParams): KeyboardCommandResult {
  const {
    event,
    measurePairs,
    activeSelection,
    measureKeyFifthsFromImport,
    importedNoteLookupRef,
    applyKeyboardEditResult,
  } = params

  const intervalDegree = getIntervalDegreeFromKeyboardEvent(event)
  if (intervalDegree === null) return 'not-handled'

  const handled = handleAppendIntervalCommand({
    measurePairs,
    activeSelection,
    intervalDegree,
    shiftKey: event.shiftKey,
    measureKeyFifthsFromImport,
    importedNoteLookupRef,
    applyKeyboardEditResult,
  })
  return handled ? 'handled-prevent-default' : 'handled'
}
