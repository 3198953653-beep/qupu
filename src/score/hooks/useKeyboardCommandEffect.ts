import { useEffect } from 'react'
import { handleKeyboardCommandEvent } from './handleKeyboardCommandEvent'
import type { KeyboardCommandEffectParams } from './keyboardCommandTypes'

export function useKeyboardCommandEffect(params: KeyboardCommandEffectParams): void {
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleKeyboardCommandEvent({
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
      })
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
    noteClipboardRef,
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
