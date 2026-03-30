import { useChordMarkerController } from './useChordMarkerController'
import { useScoreEditingSessionHelpers } from './useScoreEditingSessionHelpers'
import { useScoreMutationController } from './useScoreMutationController'
import { useHorizontalScoreLayout } from './useHorizontalScoreLayout'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'

export function useScoreCoreEditingController(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  layout: Pick<
    ReturnType<typeof useHorizontalScoreLayout>,
    | 'measurePairs'
    | 'chordRulerEntriesByPair'
    | 'horizontalMeasureFramesByPair'
    | 'horizontalRenderOffsetX'
    | 'scoreScaleX'
    | 'scoreScaleY'
    | 'scoreSurfaceOffsetXPx'
    | 'scoreSurfaceOffsetYPx'
    | 'layoutStabilityKey'
    | 'getMeasureFrameContentGeometry'
  >
  chordMarkerLabelLeftInsetPx: number
  stageBorderPx: number
  chordHighlightPadXPx: number
  chordHighlightPadYPx: number
}) {
  const {
    appState,
    editorRefs,
    layout,
    chordMarkerLabelLeftInsetPx,
    stageBorderPx,
    chordHighlightPadXPx,
    chordHighlightPadYPx,
  } = params

  const sessionHelpers = useScoreEditingSessionHelpers({
    appState,
    editorRefs,
  })

  const chordMarker = useChordMarkerController({
    measurePairs: layout.measurePairs,
    measurePairsRef: editorRefs.measurePairsRef,
    chordRulerEntriesByPair: layout.chordRulerEntriesByPair,
    horizontalMeasureFramesByPair: layout.horizontalMeasureFramesByPair,
    measureTimeSignaturesFromImport: appState.measureTimeSignaturesFromImport,
    measureKeyFifthsFromImport: appState.measureKeyFifthsFromImport,
    measureKeyModesFromImport: appState.measureKeyModesFromImport,
    horizontalRenderOffsetX: layout.horizontalRenderOffsetX,
    horizontalRenderOffsetXRef: editorRefs.horizontalRenderOffsetXRef,
    noteLayoutsByPairRef: editorRefs.noteLayoutsByPairRef,
    measureLayoutsRef: editorRefs.measureLayoutsRef,
    measureTimelineBundlesRef: editorRefs.measureTimelineBundlesRef,
    scoreScaleX: layout.scoreScaleX,
    scoreScaleY: layout.scoreScaleY,
    scoreSurfaceOffsetXPx: layout.scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx: layout.scoreSurfaceOffsetYPx,
    selectedMeasureScope: appState.selectedMeasureScope,
    activeSelection: appState.activeSelection,
    selectedSelections: appState.selectedSelections,
    isSelectionVisible: appState.isSelectionVisible,
    timelineSegmentOverlayMode: appState.timelineSegmentOverlayMode,
    importedTimelineSegmentStartPairIndexes: appState.importedTimelineSegmentStartPairIndexesFromImport,
    showChordDegreeEnabled: appState.showChordDegreeEnabled,
    chordMarkerLabelLeftInsetPx,
    stageBorderPx,
    chordHighlightPadXPx,
    chordHighlightPadYPx,
    layoutStabilityKey: layout.layoutStabilityKey,
    getMeasureFrameContentGeometry: layout.getMeasureFrameContentGeometry,
    setIsSelectionVisible: appState.setIsSelectionVisible,
    setSelectedSelections: appState.setSelectedSelections,
    setActiveSelection: appState.setActiveSelection,
    clearActiveAccidentalSelection: sessionHelpers.clearActiveAccidentalSelection,
    clearActiveTieSelection: sessionHelpers.clearActiveTieSelection,
    clearActivePedalSelection: sessionHelpers.clearActivePedalSelection,
    clearSelectedMeasureScope: sessionHelpers.clearSelectedMeasureScope,
    clearDraggingSelection: sessionHelpers.clearDraggingSelection,
    resetMidiStepChain: sessionHelpers.resetMidiStepChain,
  })

  const mutation = useScoreMutationController({
    measurePairsRef: editorRefs.measurePairsRef,
    measurePairsFromImportRef: editorRefs.measurePairsFromImportRef,
    measureKeyFifthsFromImport: appState.measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef: editorRefs.measureKeyFifthsFromImportRef,
    measureDivisionsFromImport: appState.measureDivisionsFromImport,
    measureDivisionsFromImportRef: editorRefs.measureDivisionsFromImportRef,
    measureTimeSignaturesFromImport: appState.measureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef: editorRefs.measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImport: appState.musicXmlMetadataFromImport,
    importedNoteLookupRef: editorRefs.importedNoteLookupRef,
    selectedSelectionsRef: editorRefs.selectedSelectionsRef,
    activeSelectionRef: editorRefs.activeSelectionRef,
    activePedalSelectionRef: editorRefs.activePedalSelectionRef,
    pedalSpansRef: editorRefs.pedalSpansRef,
    isSelectionVisibleRef: editorRefs.isSelectionVisibleRef,
    fullMeasureRestCollapseScopeKeysRef: editorRefs.fullMeasureRestCollapseScopeKeysRef,
    midiStepChainRef: editorRefs.midiStepChainRef,
    midiStepLastSelectionRef: editorRefs.midiStepLastSelectionRef,
    dragRef: editorRefs.dragRef,
    draggingSelectionRef: editorRefs.draggingSelectionRef,
    isOsmdPreviewOpenRef: editorRefs.isOsmdPreviewOpenRef,
    clearDragOverlayRef: editorRefs.clearDragOverlayRef,
    clearDragPreviewState: sessionHelpers.clearDragPreviewState,
    clearDraggingSelection: sessionHelpers.clearDraggingSelection,
    resetMidiStepChain: sessionHelpers.resetMidiStepChain,
    clearActiveAccidentalSelection: sessionHelpers.clearActiveAccidentalSelection,
    clearActiveTieSelection: sessionHelpers.clearActiveTieSelection,
    clearActivePedalSelection: sessionHelpers.clearActivePedalSelection,
    clearSelectedMeasureScope: sessionHelpers.clearSelectedMeasureScope,
    clearActiveChordSelection: chordMarker.clearActiveChordSelection,
    setPedalSpans: appState.setPedalSpans,
    setMeasurePairsFromImport: appState.setMeasurePairsFromImport,
    clearImportedChordRulerEntries: sessionHelpers.clearImportedChordRulerEntries,
    setNotes: appState.setNotes,
    setBassNotes: appState.setBassNotes,
    setIsSelectionVisible: appState.setIsSelectionVisible,
    setFullMeasureRestCollapseScopeKeys: appState.setFullMeasureRestCollapseScopeKeys,
    setActiveSelection: appState.setActiveSelection,
    setSelectedSelections: appState.setSelectedSelections,
    setActivePedalSelection: appState.setActivePedalSelection,
    setIsRhythmLinked: appState.setIsRhythmLinked,
    setMeasureKeyFifthsFromImport: appState.setMeasureKeyFifthsFromImport,
    setMeasureDivisionsFromImport: appState.setMeasureDivisionsFromImport,
    setMeasureTimeSignaturesFromImport: appState.setMeasureTimeSignaturesFromImport,
  })

  return {
    sessionHelpers,
    chordMarker,
    mutation,
  }
}
