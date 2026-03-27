import type { MutableRefObject } from 'react'
import { appendIntervalKey } from '../keyboardEdits'
import type { ImportedNoteLocation, MeasurePair, Selection } from '../types'
import type { KeyboardEditResultApplier } from './keyboardCommandTypes'

export function handleAppendIntervalCommand(params: {
  measurePairs: MeasurePair[]
  activeSelection: Selection
  intervalDegree: number
  shiftKey: boolean
  measureKeyFifthsFromImport: number[] | null
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  applyKeyboardEditResult: KeyboardEditResultApplier
}): boolean {
  const {
    measurePairs,
    activeSelection,
    intervalDegree,
    shiftKey,
    measureKeyFifthsFromImport,
    importedNoteLookupRef,
    applyKeyboardEditResult,
  } = params

  const result = appendIntervalKey({
    pairs: measurePairs,
    selection: activeSelection,
    intervalDegree,
    direction: shiftKey ? 'down' : 'up',
    keyFifthsByMeasure: measureKeyFifthsFromImport,
    importedNoteLookup: importedNoteLookupRef.current,
  })
  if (!result) return false
  applyKeyboardEditResult(result.nextPairs, result.nextSelection)
  return true
}
