import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { buildImportedNoteLookup, flattenBassFromPairs, flattenTrebleFromPairs } from '../scoreOps'
import { mergeFullMeasureRestCollapseScopeKeys, type MeasureStaffScope } from '../fullMeasureRestCollapse'
import type { ImportedNoteLocation, MeasurePair, ScoreNote, Selection, SelectionFrameIntent } from '../types'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function applyScoreMutationResult(params: {
  nextPairs: MeasurePair[]
  nextSelection: Selection
  nextSelections?: Selection[]
  source?: 'default' | 'midi-step'
  skipUndoSnapshot?: boolean
  options?: { collapseScopesToAdd?: MeasureStaffScope[] }
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  pushUndoSnapshot: (sourcePairs: MeasurePair[]) => void
  resetMidiStepChain: () => void
  clearActiveAccidentalSelection: () => void
  clearActiveTieSelection: () => void
  clearSelectedMeasureScope: () => void
  clearActiveChordSelection: () => void
  setMeasurePairsFromImport: StateSetter<MeasurePair[] | null>
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setIsSelectionVisible: StateSetter<boolean>
  setFullMeasureRestCollapseScopeKeys: StateSetter<string[]>
  setActiveSelection: StateSetter<Selection>
  setSelectedSelections: StateSetter<Selection[]>
  setSelectionFrameIntent: StateSetter<SelectionFrameIntent>
  setIsRhythmLinked: StateSetter<boolean>
}): void {
  const {
    nextPairs,
    nextSelection,
    nextSelections = [nextSelection],
    source = 'default',
    skipUndoSnapshot = false,
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
  } = params

  const sourcePairs = measurePairsRef.current
  const collapseScopesToAdd = options?.collapseScopesToAdd ?? []
  if (!skipUndoSnapshot && nextPairs !== sourcePairs) {
    pushUndoSnapshot(sourcePairs)
  }
  if (nextPairs !== sourcePairs || collapseScopesToAdd.length > 0) {
    setFullMeasureRestCollapseScopeKeys((current) =>
      mergeFullMeasureRestCollapseScopeKeys({
        currentScopeKeys: current,
        sourcePairs,
        nextPairs,
        collapseScopesToAdd,
      }),
    )
  }
  if (source !== 'midi-step') {
    resetMidiStepChain()
  }
  setIsRhythmLinked(false)
  if (measurePairsFromImportRef.current) {
    measurePairsFromImportRef.current = nextPairs
    setMeasurePairsFromImport(nextPairs)
  }
  importedNoteLookupRef.current = buildImportedNoteLookup(nextPairs)
  setNotes(flattenTrebleFromPairs(nextPairs))
  setBassNotes(flattenBassFromPairs(nextPairs))
  setIsSelectionVisible(true)
  clearActiveAccidentalSelection()
  clearActiveTieSelection()
  clearSelectedMeasureScope()
  clearActiveChordSelection()
  setSelectionFrameIntent('default')
  setActiveSelection(nextSelection)
  setSelectedSelections(nextSelections)
}
