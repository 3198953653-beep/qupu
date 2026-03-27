import type { MutableRefObject } from 'react'
import { getCopyPasteFailureMessage } from '../editorMessages'
import { toDisplayDuration } from '../layout/demand'
import {
  applyClipboardPaste,
  buildClipboardFromSelections,
} from '../copyPasteEdits'
import type { NoteClipboardPayload } from '../copyPasteTypes'
import type { ImportedNoteLocation, MeasurePair, Selection, TimeSignature } from '../types'
import type { KeyboardEditResultApplier, StateSetter } from './keyboardCommandTypes'

export function handleCopyShortcut(params: {
  measurePairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  isSelectionVisible: boolean
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  noteClipboardRef: MutableRefObject<NoteClipboardPayload | null>
  setNotationPaletteLastAction: StateSetter<string>
}): boolean {
  const {
    measurePairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookupRef,
    noteClipboardRef,
    setNotationPaletteLastAction,
  } = params

  const copyAttempt = buildClipboardFromSelections({
    pairs: measurePairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup: importedNoteLookupRef.current,
  })
  if (!copyAttempt.payload || copyAttempt.error) {
    const message = getCopyPasteFailureMessage(copyAttempt.error ?? 'selection-not-found')
    setNotationPaletteLastAction(message)
    console.info('[copy-paste]', message)
    return true
  }
  noteClipboardRef.current = copyAttempt.payload
  const message = `已复制 ${copyAttempt.payload.pitches.length} 个音（${toDisplayDuration(copyAttempt.payload.duration)}）`
  setNotationPaletteLastAction(message)
  console.info('[copy-paste]', message, copyAttempt.payload)
  return true
}

export function handlePasteShortcut(params: {
  measurePairs: MeasurePair[]
  noteClipboardRef: MutableRefObject<NoteClipboardPayload | null>
  activeSelection: Selection
  isSelectionVisible: boolean
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  applyKeyboardEditResult: KeyboardEditResultApplier
  setNotationPaletteLastAction: StateSetter<string>
}): boolean {
  const {
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
  } = params

  const pasteAttempt = applyClipboardPaste({
    pairs: measurePairs,
    clipboard: noteClipboardRef.current,
    activeSelection,
    isSelectionVisible,
    importedNoteLookup: importedNoteLookupRef.current,
    keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
    timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
    importedMode: measurePairsFromImportRef.current !== null,
  })
  if (!pasteAttempt.result || pasteAttempt.error) {
    const message = getCopyPasteFailureMessage(pasteAttempt.error ?? 'selection-not-found')
    setNotationPaletteLastAction(message)
    console.info('[copy-paste]', message)
    return true
  }
  applyKeyboardEditResult(
    pasteAttempt.result.nextPairs,
    pasteAttempt.result.nextSelection,
    pasteAttempt.result.nextSelections,
  )
  const copiedCount = noteClipboardRef.current?.pitches.length ?? 0
  const message = `已粘贴 ${copiedCount} 个音`
  setNotationPaletteLastAction(message)
  console.info('[copy-paste]', message)
  return true
}
