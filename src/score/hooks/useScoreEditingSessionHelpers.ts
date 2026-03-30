import { useCallback } from 'react'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'

export function useScoreEditingSessionHelpers(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
}) {
  const { appState, editorRefs } = params

  const clearActiveAccidentalSelection = useCallback(() => {
    appState.setActiveAccidentalSelection(null)
  }, [appState])

  const clearActiveTieSelection = useCallback(() => {
    appState.setActiveTieSelection(null)
  }, [appState])

  const clearActivePedalSelection = useCallback(() => {
    appState.setActivePedalSelection(null)
  }, [appState])

  const clearSelectedMeasureScope = useCallback(() => {
    appState.setSelectedMeasureScope(null)
  }, [appState])

  const clearDraggingSelection = useCallback(() => {
    appState.setDraggingSelection(null)
  }, [appState])

  const clearDragPreviewState = useCallback(() => {
    appState.setDragPreviewState(null)
  }, [appState])

  const clearImportedChordRulerEntries = useCallback(() => {
    appState.setImportedChordRulerEntriesByPairFromImport(null)
  }, [appState])

  const resetMidiStepChain = useCallback(() => {
    editorRefs.midiStepChainRef.current = false
    editorRefs.midiStepLastSelectionRef.current = null
  }, [editorRefs])

  return {
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearActivePedalSelection,
    clearSelectedMeasureScope,
    clearDraggingSelection,
    clearDragPreviewState,
    clearImportedChordRulerEntries,
    resetMidiStepChain,
  }
}
