import type { MutableRefObject } from 'react'
import { applyDeleteAccidentalSelection } from '../accidentalEdits'
import {
  getDeleteAccidentalFailureMessage,
  getDeleteMeasureFailureMessage,
  getDeleteTieFailureMessage,
} from '../editorMessages'
import { applyDeleteMeasureSelection } from '../measureEdits'
import { applyDeleteTieSelection } from '../tieEdits'
import { deleteSelectedKey } from '../keyboardEdits'
import type {
  ActivePedalSelection,
  ImportedNoteLocation,
  MeasurePair,
  PedalSpan,
  Selection,
  TieSelection,
  TimeSignature,
} from '../types'
import type { MeasureScope } from './keyboardCommandShared'
import type {
  KeyboardAccidentalPreviewPlayer,
  KeyboardEditResultApplier,
  StateSetter,
} from './keyboardCommandTypes'

export function handleEscapeCommand(params: {
  activeTieSelection: TieSelection | null
  activeAccidentalSelection: Selection | null
  activePedalSelection: ActivePedalSelection | null
  setActiveTieSelection: StateSetter<TieSelection | null>
  setActiveAccidentalSelection: StateSetter<Selection | null>
  setActivePedalSelection: StateSetter<ActivePedalSelection | null>
}): boolean {
  const {
    activeTieSelection,
    activeAccidentalSelection,
    activePedalSelection,
    setActiveTieSelection,
    setActiveAccidentalSelection,
    setActivePedalSelection,
  } = params

  if (activeTieSelection) {
    setActiveTieSelection(null)
    return true
  }
  if (activeAccidentalSelection) {
    setActiveAccidentalSelection(null)
    return true
  }
  if (activePedalSelection) {
    setActivePedalSelection(null)
    return true
  }
  return false
}

export function handleDeletePedalCommand(params: {
  measurePairs: MeasurePair[]
  pedalSpans: PedalSpan[]
  activePedalSelection: ActivePedalSelection
  pushUndoSnapshot: (sourcePairs: MeasurePair[]) => void
  setPedalSpans: StateSetter<PedalSpan[]>
  setActivePedalSelection: StateSetter<ActivePedalSelection | null>
  setIsSelectionVisible: StateSetter<boolean>
  setSelectedSelections: StateSetter<Selection[]>
  setSelectedMeasureScope: StateSetter<MeasureScope>
  setNotationPaletteLastAction: StateSetter<string>
}): boolean {
  const {
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
  } = params

  const targetExists = pedalSpans.some((span) => span.id === activePedalSelection.pedalId)
  if (!targetExists) {
    setActivePedalSelection(null)
    setNotationPaletteLastAction('未找到可删除的踏板')
    console.info('[pedal-delete] 未找到可删除的踏板')
    return true
  }

  pushUndoSnapshot(measurePairs)
  setPedalSpans((current) => current.filter((span) => span.id !== activePedalSelection.pedalId))
  setActivePedalSelection(null)
  setIsSelectionVisible(false)
  setSelectedSelections([])
  setSelectedMeasureScope(null)
  setNotationPaletteLastAction('已删除踏板')
  console.info('[pedal-delete] 已删除踏板')
  return true
}

export function handleDeleteTieCommand(params: {
  measurePairs: MeasurePair[]
  activeTieSelection: TieSelection
  activeSelection: Selection
  applyKeyboardEditResult: KeyboardEditResultApplier
  setActiveTieSelection: StateSetter<TieSelection | null>
  setIsSelectionVisible: StateSetter<boolean>
  setSelectedSelections: StateSetter<Selection[]>
  setSelectedMeasureScope: StateSetter<MeasureScope>
  setNotationPaletteLastAction: StateSetter<string>
}): boolean {
  const {
    measurePairs,
    activeTieSelection,
    activeSelection,
    applyKeyboardEditResult,
    setActiveTieSelection,
    setIsSelectionVisible,
    setSelectedSelections,
    setSelectedMeasureScope,
    setNotationPaletteLastAction,
  } = params

  const deleteAttempt = applyDeleteTieSelection({
    pairs: measurePairs,
    selection: activeTieSelection,
    fallbackSelection: activeSelection,
  })
  if (deleteAttempt.error || !deleteAttempt.result) {
    const message = getDeleteTieFailureMessage(deleteAttempt.error ?? 'selection-not-found')
    setNotationPaletteLastAction(message)
    console.info('[tie-delete]', message)
    return true
  }
  applyKeyboardEditResult(
    deleteAttempt.result.nextPairs,
    deleteAttempt.result.nextSelection,
    deleteAttempt.result.nextSelections,
  )
  setActiveTieSelection(null)
  setIsSelectionVisible(false)
  setSelectedSelections([])
  setSelectedMeasureScope(null)
  setNotationPaletteLastAction('已删除延音线')
  console.info('[tie-delete] 已删除延音线')
  return true
}

export function handleDeleteAccidentalCommand(params: {
  measurePairs: MeasurePair[]
  activeAccidentalSelection: Selection
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  applyKeyboardEditResult: KeyboardEditResultApplier
  playAccidentalEditPreview: KeyboardAccidentalPreviewPlayer
  setActiveAccidentalSelection: StateSetter<Selection | null>
  setIsSelectionVisible: StateSetter<boolean>
  setSelectedSelections: StateSetter<Selection[]>
  setSelectedMeasureScope: StateSetter<MeasureScope>
  setNotationPaletteLastAction: StateSetter<string>
}): boolean {
  const {
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
  } = params

  const sourceImportedNoteLookup = importedNoteLookupRef.current
  const deleteAttempt = applyDeleteAccidentalSelection({
    pairs: measurePairs,
    selection: activeAccidentalSelection,
    importedNoteLookup: sourceImportedNoteLookup,
    keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
  })
  if (deleteAttempt.error || !deleteAttempt.result) {
    const message = getDeleteAccidentalFailureMessage(deleteAttempt.error ?? 'selection-not-found')
    setNotationPaletteLastAction(message)
    console.info('[accidental-delete]', message)
    return true
  }
  applyKeyboardEditResult(
    deleteAttempt.result.nextPairs,
    deleteAttempt.result.nextSelection,
    deleteAttempt.result.nextSelections,
  )
  playAccidentalEditPreview({
    pairs: measurePairs,
    previewSelection: deleteAttempt.result.previewSelection,
    previewPitch: deleteAttempt.result.previewPitch,
    importedNoteLookup: sourceImportedNoteLookup,
  })
  setActiveAccidentalSelection(null)
  setIsSelectionVisible(false)
  setSelectedSelections([])
  setSelectedMeasureScope(null)
  setNotationPaletteLastAction('已删除变音记号（按上下文回落并重算）')
  console.info('[accidental-delete] 已删除变音记号（按上下文回落并重算）')
  return true
}

export function handleDeleteMeasureCommand(params: {
  measurePairs: MeasurePair[]
  selectedMeasureScope: NonNullable<MeasureScope>
  isSelectionVisible: boolean
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  applyKeyboardEditResult: KeyboardEditResultApplier
  setSelectedMeasureScope: StateSetter<MeasureScope>
  setSelectedSelections: StateSetter<Selection[]>
  setNotationPaletteLastAction: StateSetter<string>
}): boolean {
  const {
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
  } = params

  if (!isSelectionVisible) return false
  const deleteAttempt = applyDeleteMeasureSelection({
    pairs: measurePairs,
    selectedMeasureScope,
    importedMode: measurePairsFromImportRef.current !== null,
    keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
    timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
  })
  if (deleteAttempt.error || !deleteAttempt.result) {
    const message = getDeleteMeasureFailureMessage(deleteAttempt.error ?? 'selection-not-found')
    setNotationPaletteLastAction(message)
    console.info('[measure-delete]', message)
    return true
  }
  applyKeyboardEditResult(
    deleteAttempt.result.nextPairs,
    deleteAttempt.result.nextSelection,
    deleteAttempt.result.nextSelections,
    'default',
    {
      collapseScopesToAdd: [{
        pairIndex: selectedMeasureScope.pairIndex,
        staff: selectedMeasureScope.staff,
      }],
    },
  )
  setSelectedMeasureScope({
    pairIndex: selectedMeasureScope.pairIndex,
    staff: selectedMeasureScope.staff,
  })
  setSelectedSelections([deleteAttempt.result.nextSelection])
  setNotationPaletteLastAction('已清空该小节并替换为全休止符')
  console.info('[measure-delete] 已清空该小节并替换为全休止符', selectedMeasureScope)
  return true
}

export function handleDeleteSelectedKeyCommand(params: {
  measurePairs: MeasurePair[]
  activeSelection: Selection
  measureKeyFifthsFromImport: number[] | null
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  applyKeyboardEditResult: KeyboardEditResultApplier
}): boolean {
  const { measurePairs, activeSelection, measureKeyFifthsFromImport, importedNoteLookupRef, applyKeyboardEditResult } = params
  const result = deleteSelectedKey({
    pairs: measurePairs,
    selection: activeSelection,
    keyFifthsByMeasure: measureKeyFifthsFromImport,
    importedNoteLookup: importedNoteLookupRef.current,
  })
  if (!result) return false
  applyKeyboardEditResult(result.nextPairs, result.nextSelection)
  return true
}
