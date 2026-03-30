import { useCallback, useRef } from 'react'
import { mergeFullMeasureRestCollapseScopeKeys, toMeasureStaffScopeKey } from '../fullMeasureRestCollapse'
import { findSelectionLocationInPairs } from '../keyboardEdits'
import { resolvePairTimeSignature } from '../measureRestUtils'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useScoreEditingSessionHelpers } from './useScoreEditingSessionHelpers'
import type { ActivePedalSelection, MeasurePair, Selection, TieSelection, TimeSignature } from '../types'

function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}

export function useScoreWorkspaceSelectionBindings(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  sessionHelpers: ReturnType<typeof useScoreEditingSessionHelpers>
  clearActiveChordSelection: () => void
  onTrebleSelectionDoubleTap?: (selection: Selection) => void
  pushUndoSnapshot: (sourcePairs: MeasurePair[]) => void
  buildSelectionsForMeasureStaff: (
    pair: MeasurePair,
    staff: Selection['staff'],
    options?: { collapseFullMeasureRest?: boolean; timeSignature?: TimeSignature | null },
  ) => Selection[]
}) {
  const {
    appState,
    editorRefs,
    sessionHelpers,
    clearActiveChordSelection,
    onTrebleSelectionDoubleTap,
    pushUndoSnapshot,
    buildSelectionsForMeasureStaff,
  } = params
  const lastTrebleTapRef = useRef<{ selection: Selection; atMs: number } | null>(null)

  const clearTrebleTapCandidate = useCallback(() => {
    lastTrebleTapRef.current = null
  }, [])

  const normalizeTrebleDialogSelection = useCallback((selection: Selection): Selection | null => {
    if (selection.staff !== 'treble') return null
    const normalizedSelection: Selection = {
      noteId: selection.noteId,
      staff: 'treble',
      keyIndex: 0,
    }
    const location = findSelectionLocationInPairs({
      pairs: editorRefs.measurePairsRef.current,
      selection: normalizedSelection,
      importedNoteLookup: editorRefs.importedNoteLookupRef.current,
    })
    if (!location || location.staff !== 'treble') return null
    const pair = editorRefs.measurePairsRef.current[location.pairIndex]
    const note = pair?.treble[location.noteIndex]
    if (!note || note.isRest) return null
    return normalizedSelection
  }, [editorRefs.importedNoteLookupRef, editorRefs.measurePairsRef])

  const onSelectionPointerDown = useCallback((
    _selection: Selection,
    nextSelections: Selection[],
    _mode: string,
  ) => {
    void _selection
    void _mode
    sessionHelpers.resetMidiStepChain()
    appState.setActiveAccidentalSelection(null)
    appState.setActiveTieSelection(null)
    appState.setActivePedalSelection(null)
    appState.setSelectedMeasureScope(null)
    clearActiveChordSelection()
    const nextTargetSelections = nextSelections
    appState.setSelectedSelections((current) => {
      if (
        current.length === nextTargetSelections.length &&
        current.every((entry, index) => isSameSelection(entry, nextTargetSelections[index]))
      ) {
        return current
      }
      return nextTargetSelections
    })
  }, [appState, clearActiveChordSelection, sessionHelpers])

  const onSelectionTapRelease = useCallback((selection: Selection) => {
    sessionHelpers.resetMidiStepChain()
    appState.setActiveAccidentalSelection(null)
    appState.setActiveTieSelection(null)
    appState.setActivePedalSelection(null)
    appState.setSelectedMeasureScope(null)
    clearActiveChordSelection()
    appState.setSelectedSelections([selection])
    appState.setActiveSelection(selection)
    appState.setIsSelectionVisible(true)

    const normalizedSelection = normalizeTrebleDialogSelection(selection)
    if (!normalizedSelection) {
      clearTrebleTapCandidate()
      return
    }

    const nowMs = Date.now()
    const lastTap = lastTrebleTapRef.current
    const isRepeatedTrebleTap =
      lastTap &&
      isSameSelection(lastTap.selection, normalizedSelection) &&
      nowMs - lastTap.atMs <= 350

    if (isRepeatedTrebleTap) {
      clearTrebleTapCandidate()
      onTrebleSelectionDoubleTap?.(normalizedSelection)
      return
    }

    lastTrebleTapRef.current = {
      selection: normalizedSelection,
      atMs: nowMs,
    }
  }, [
    appState,
    clearActiveChordSelection,
    clearTrebleTapCandidate,
    normalizeTrebleDialogSelection,
    onTrebleSelectionDoubleTap,
    sessionHelpers,
  ])

  const onAccidentalPointerDown = useCallback((selection: Selection) => {
    sessionHelpers.resetMidiStepChain()
    appState.setActiveAccidentalSelection(selection)
    appState.setActiveTieSelection(null)
    appState.setActivePedalSelection(null)
    appState.setSelectedMeasureScope(null)
    clearActiveChordSelection()
    appState.setDraggingSelection(null)
    appState.setSelectedSelections([])
    appState.setIsSelectionVisible(false)
    clearTrebleTapCandidate()
  }, [appState, clearActiveChordSelection, clearTrebleTapCandidate, sessionHelpers])

  const onTiePointerDown = useCallback((selection: TieSelection) => {
    sessionHelpers.resetMidiStepChain()
    appState.setActiveTieSelection(selection)
    appState.setActiveAccidentalSelection(null)
    appState.setActivePedalSelection(null)
    appState.setSelectedMeasureScope(null)
    clearActiveChordSelection()
    appState.setDraggingSelection(null)
    appState.setSelectedSelections([])
    appState.setIsSelectionVisible(false)
    clearTrebleTapCandidate()
  }, [appState, clearActiveChordSelection, clearTrebleTapCandidate, sessionHelpers])

  const onBeforeApplyScoreChange = useCallback((sourcePairs: MeasurePair[]) => {
    pushUndoSnapshot(sourcePairs)
  }, [pushUndoSnapshot])

  const onAfterApplyScoreChange = useCallback(({ sourcePairs, nextPairs }: {
    sourcePairs: MeasurePair[]
    nextPairs: MeasurePair[]
  }) => {
    appState.setFullMeasureRestCollapseScopeKeys((current) =>
      mergeFullMeasureRestCollapseScopeKeys({
        currentScopeKeys: current,
        sourcePairs,
        nextPairs,
      }),
    )
  }, [appState])

  const onBlankPointerDown = useCallback(({ pairIndex, staff }: {
    pairIndex: number | null
    staff: Selection['staff'] | null
  }) => {
    sessionHelpers.resetMidiStepChain()
    appState.setActiveAccidentalSelection(null)
    appState.setActiveTieSelection(null)
    appState.setActivePedalSelection(null)
    clearActiveChordSelection()
    if (pairIndex === null || staff === null) {
      appState.setIsSelectionVisible(false)
      appState.setSelectedSelections([])
      appState.setSelectedMeasureScope(null)
      clearTrebleTapCandidate()
      return
    }
    const targetPair = editorRefs.measurePairsRef.current[pairIndex]
    if (!targetPair) {
      appState.setIsSelectionVisible(false)
      appState.setSelectedSelections([])
      appState.setSelectedMeasureScope(null)
      clearTrebleTapCandidate()
      return
    }
    const timeSignature = resolvePairTimeSignature(pairIndex, editorRefs.measureTimeSignaturesFromImportRef.current)
    const canCollapseFullMeasureRest = appState.fullMeasureRestCollapseScopeKeys.includes(
      toMeasureStaffScopeKey({ pairIndex, staff }),
    )
    const nextSelections = buildSelectionsForMeasureStaff(targetPair, staff, {
      collapseFullMeasureRest: canCollapseFullMeasureRest,
      timeSignature,
    })
    if (nextSelections.length === 0) {
      appState.setIsSelectionVisible(false)
      appState.setSelectedSelections([])
      appState.setSelectedMeasureScope(null)
      clearTrebleTapCandidate()
      return
    }
    appState.setIsSelectionVisible(true)
    appState.setSelectedSelections(nextSelections)
    appState.setActiveSelection(nextSelections[0])
    appState.setSelectedMeasureScope({ pairIndex, staff })
    clearTrebleTapCandidate()
  }, [
    appState,
    buildSelectionsForMeasureStaff,
    clearTrebleTapCandidate,
    clearActiveChordSelection,
    editorRefs.measurePairsRef,
    editorRefs.measureTimeSignaturesFromImportRef,
    sessionHelpers,
  ])

  const onSelectionActivated = useCallback(() => {
    sessionHelpers.resetMidiStepChain()
    appState.setActiveAccidentalSelection(null)
    appState.setActiveTieSelection(null)
    appState.setActivePedalSelection(null)
    clearActiveChordSelection()
    appState.setIsSelectionVisible(true)
  }, [appState, clearActiveChordSelection, sessionHelpers])

  const onPedalPointerDown = useCallback((selection: ActivePedalSelection) => {
    sessionHelpers.resetMidiStepChain()
    appState.setActivePedalSelection(selection)
    appState.setActiveAccidentalSelection(null)
    appState.setActiveTieSelection(null)
    appState.setSelectedMeasureScope(null)
    clearActiveChordSelection()
    appState.setDraggingSelection(null)
    appState.setSelectedSelections([])
    appState.setIsSelectionVisible(false)
    clearTrebleTapCandidate()
  }, [appState, clearActiveChordSelection, clearTrebleTapCandidate, sessionHelpers])

  return {
    onSelectionPointerDown,
    onSelectionTapRelease,
    onAccidentalPointerDown,
    onTiePointerDown,
    onPedalPointerDown,
    onBeforeApplyScoreChange,
    onAfterApplyScoreChange,
    onBlankPointerDown,
    onSelectionActivated,
  }
}
