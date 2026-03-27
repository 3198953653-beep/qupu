import { useScoreAudioPreviewController } from './useScoreAudioPreviewController'
import { useScoreEditorUiController } from './useScoreEditorUiController'
import { useScoreWorkspaceController } from './useScoreWorkspaceController'
import { useScorePlaybackRuntimeController } from './useScorePlaybackRuntimeController'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useHorizontalScoreLayout } from './useHorizontalScoreLayout'
import { useScoreCoreEditingController } from './useScoreCoreEditingController'
import type { Pitch, ScoreNote, Selection, TimeSignature } from '../types'

export function useScoreInteractionRuntimeController(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  layout: ReturnType<typeof useHorizontalScoreLayout>
  coreEditing: ReturnType<typeof useScoreCoreEditingController>
  buildSelectionsForMeasureStaff: (
    pair: import('../types').MeasurePair,
    staff: Selection['staff'],
    options?: { collapseFullMeasureRest?: boolean; timeSignature?: TimeSignature | null },
  ) => Selection[]
  initialTrebleNotes: ScoreNote[]
  initialBassNotes: ScoreNote[]
  pitches: Pitch[]
  backend: number
  previewDefaultAccidentalOffsetPx: number
  previewStartThresholdPx: number
}) {
  const {
    appState,
    editorRefs,
    layout,
    coreEditing,
    buildSelectionsForMeasureStaff,
    initialTrebleNotes,
    initialBassNotes,
    pitches,
    backend,
    previewDefaultAccidentalOffsetPx,
    previewStartThresholdPx,
  } = params

  const audioPreview = useScoreAudioPreviewController({
    synthRef: editorRefs.synthRef,
  })

  const workspace = useScoreWorkspaceController({
    appState,
    editorRefs,
    sessionHelpers: coreEditing.sessionHelpers,
    measurePairs: layout.measurePairs,
    playbackTimelineEvents: layout.playbackTimelineEvents,
    layout: {
      totalScoreWidth: layout.totalScoreWidth,
      displayScoreWidth: layout.displayScoreWidth,
      scoreScaleX: layout.scoreScaleX,
      scoreScaleY: layout.scoreScaleY,
      scoreWidth: layout.scoreWidth,
      scoreHeight: layout.scoreHeight,
      systemRanges: layout.systemRanges,
      visibleSystemRange: layout.visibleSystemRange,
      horizontalRenderOffsetX: layout.horizontalRenderOffsetX,
      horizontalRenderWindow: layout.horizontalRenderWindow,
      horizontalMeasureFramesByPair: layout.horizontalMeasureFramesByPair,
      layoutStabilityKey: layout.layoutStabilityKey,
      renderQualityScale: layout.renderQualityScale,
      supplementalSpacingTicksByPair: layout.supplementalSpacingTicksByPair,
      spacingLayoutMode: layout.spacingLayoutMode,
      trebleNoteById: layout.trebleNoteById,
      bassNoteById: layout.bassNoteById,
    },
    onAfterScoreRender: coreEditing.chordMarker.onAfterScoreRender,
    clearActiveChordSelection: coreEditing.chordMarker.clearActiveChordSelection,
    pushUndoSnapshot: coreEditing.mutation.pushUndoSnapshot,
    handlePreviewScoreNote: audioPreview.handlePreviewScoreNote,
    handlePlaybackStart: (playbackParams) => {
      playback.handlePlaybackStart(playbackParams)
    },
    handlePlaybackPoint: (playbackParams) => {
      playback.handlePlaybackPoint(playbackParams)
    },
    handlePlaybackComplete: (playbackParams) => {
      playback.handlePlaybackComplete(playbackParams)
    },
    requestPlaybackCursorReset: () => {
      playback.requestPlaybackCursorReset()
    },
    stopActivePlaybackSession: () => {
      playback.stopActivePlaybackSession()
    },
    buildSelectionsForMeasureStaff,
    initialTrebleNotes,
    initialBassNotes,
    pitches,
    backend,
    previewDefaultAccidentalOffsetPx,
    previewStartThresholdPx,
  })

  const editorUi = useScoreEditorUiController({
    notes: appState.notes,
    bassNotes: appState.bassNotes,
    importFeedback: appState.importFeedback,
    selectionController: {
      notes: appState.notes,
      bassNotes: appState.bassNotes,
      measurePairs: layout.measurePairs,
      activeSelection: appState.activeSelection,
      selectedSelections: appState.selectedSelections,
      selectedMeasureScope: appState.selectedMeasureScope,
      activeTieSelection: appState.activeTieSelection,
      isSelectionVisible: appState.isSelectionVisible,
      draggingSelection: appState.draggingSelection,
      importFeedback: appState.importFeedback,
      fallbackSelectionNote: initialTrebleNotes[0],
      trebleNoteById: layout.trebleNoteById,
      bassNoteById: layout.bassNoteById,
      trebleNoteIndexById: layout.trebleNoteIndexById,
      bassNoteIndexById: layout.bassNoteIndexById,
      importedNoteLookupRef: editorRefs.importedNoteLookupRef,
      activeSelectionRef: editorRefs.activeSelectionRef,
      selectedSelectionsRef: editorRefs.selectedSelectionsRef,
      fullMeasureRestCollapseScopeKeys: appState.fullMeasureRestCollapseScopeKeys,
      fullMeasureRestCollapseScopeKeysRef: editorRefs.fullMeasureRestCollapseScopeKeysRef,
      isSelectionVisibleRef: editorRefs.isSelectionVisibleRef,
      draggingSelectionRef: editorRefs.draggingSelectionRef,
      importFeedbackRef: editorRefs.importFeedbackRef,
      setIsSelectionVisible: appState.setIsSelectionVisible,
      setActiveSelection: appState.setActiveSelection,
      setSelectedSelections: appState.setSelectedSelections,
      setSelectedMeasureScope: appState.setSelectedMeasureScope,
      setActiveTieSelection: appState.setActiveTieSelection,
    },
    editorPreferencePersistence: {
      playheadFollowEnabled: appState.playheadFollowEnabled,
      showChordDegreeEnabled: appState.showChordDegreeEnabled,
      showInScoreMeasureNumbers: appState.showInScoreMeasureNumbers,
      setShowInScoreMeasureNumbers: appState.setShowInScoreMeasureNumbers,
      showNoteHeadJianpuEnabled: appState.showNoteHeadJianpuEnabled,
      setShowNoteHeadJianpuEnabled: appState.setShowNoteHeadJianpuEnabled,
    },
    midiInputController: {
      onMidiNoteNumber: coreEditing.mutation.applyMidiReplacementByNoteNumber,
    },
    osmdPreviewController: {
      measurePairs: layout.measurePairs,
      measurePairsRef: editorRefs.measurePairsRef,
      measureKeyFifthsFromImportRef: editorRefs.measureKeyFifthsFromImportRef,
      measureDivisionsFromImportRef: editorRefs.measureDivisionsFromImportRef,
      measureTimeSignaturesFromImportRef: editorRefs.measureTimeSignaturesFromImportRef,
      musicXmlMetadataFromImportRef: editorRefs.musicXmlMetadataFromImportRef,
      importedNoteLookupRef: editorRefs.importedNoteLookupRef,
      horizontalMeasureFramesByPair: layout.horizontalMeasureFramesByPair,
      noteLayoutsByPairRef: editorRefs.noteLayoutsByPairRef,
      noteLayoutByKeyRef: editorRefs.noteLayoutByKeyRef,
      horizontalRenderOffsetXRef: editorRefs.horizontalRenderOffsetXRef,
      scoreScrollRef: editorRefs.scoreScrollRef,
      scoreScaleX: layout.scoreScaleX,
      setIsSelectionVisible: appState.setIsSelectionVisible,
      setActiveSelection: appState.setActiveSelection,
      setSelectedSelections: appState.setSelectedSelections,
      setDraggingSelection: appState.setDraggingSelection,
      setSelectedMeasureScope: appState.setSelectedMeasureScope,
      clearActiveChordSelection: coreEditing.chordMarker.clearActiveChordSelection,
      resetMidiStepChain: coreEditing.sessionHelpers.resetMidiStepChain,
    },
    isOsmdPreviewOpenRef: editorRefs.isOsmdPreviewOpenRef,
    notationPaletteController: {
      activeSelection: appState.activeSelection,
      selectedSelections: appState.selectedSelections,
      isSelectionVisible: appState.isSelectionVisible,
      measurePairsRef: editorRefs.measurePairsRef,
      measurePairsFromImportRef: editorRefs.measurePairsFromImportRef,
      importedNoteLookupRef: editorRefs.importedNoteLookupRef,
      measureKeyFifthsFromImportRef: editorRefs.measureKeyFifthsFromImportRef,
      measureTimeSignaturesFromImportRef: editorRefs.measureTimeSignaturesFromImportRef,
      setImportFeedback: appState.setImportFeedback,
      setIsNotationPaletteOpen: appState.setIsNotationPaletteOpen,
      setNotationPaletteSelection: appState.setNotationPaletteSelection,
      setNotationPaletteLastAction: appState.setNotationPaletteLastAction,
      applyKeyboardEditResult: coreEditing.mutation.applyKeyboardEditResult,
      playAccidentalEditPreview: audioPreview.playAccidentalEditPreview,
    },
    keyboardCommandController: {
      draggingSelection: appState.draggingSelection,
      isSelectionVisible: appState.isSelectionVisible,
      measurePairs: layout.measurePairs,
      activeSelection: appState.activeSelection,
      selectedSelections: appState.selectedSelections,
      selectedMeasureScope: appState.selectedMeasureScope,
      activeTieSelection: appState.activeTieSelection,
      activeAccidentalSelection: appState.activeAccidentalSelection,
      measureKeyFifthsFromImport: appState.measureKeyFifthsFromImport,
      activeSelectionRef: editorRefs.activeSelectionRef,
      measurePairsRef: editorRefs.measurePairsRef,
      measurePairsFromImportRef: editorRefs.measurePairsFromImportRef,
      importedNoteLookupRef: editorRefs.importedNoteLookupRef,
      measureLayoutsRef: editorRefs.measureLayoutsRef,
      measureKeyFifthsFromImportRef: editorRefs.measureKeyFifthsFromImportRef,
      measureTimeSignaturesFromImportRef: editorRefs.measureTimeSignaturesFromImportRef,
      scoreScrollRef: editorRefs.scoreScrollRef,
      layoutReflowHintRef: editorRefs.layoutReflowHintRef,
      layoutStabilityKey: layout.layoutStabilityKey,
      pushUndoSnapshot: coreEditing.mutation.pushUndoSnapshot,
      resetMidiStepChain: coreEditing.sessionHelpers.resetMidiStepChain,
      undoLastScoreEdit: coreEditing.mutation.undoLastScoreEdit,
      applyKeyboardEditResult: coreEditing.mutation.applyKeyboardEditResult,
      playAccidentalEditPreview: audioPreview.playAccidentalEditPreview,
      setNotes: appState.setNotes,
      setBassNotes: appState.setBassNotes,
      setMeasurePairsFromImport: appState.setMeasurePairsFromImport,
      setIsSelectionVisible: appState.setIsSelectionVisible,
      setSelectedSelections: appState.setSelectedSelections,
      setSelectedMeasureScope: appState.setSelectedMeasureScope,
      setActiveSelection: appState.setActiveSelection,
      setActiveTieSelection: appState.setActiveTieSelection,
      setActiveAccidentalSelection: appState.setActiveAccidentalSelection,
      setNotationPaletteLastAction: appState.setNotationPaletteLastAction,
    },
  })

  const playback = useScorePlaybackRuntimeController({
    playbackController: {
      synthRef: editorRefs.synthRef,
      stopPlayTimerRef: editorRefs.stopPlayTimerRef,
      playbackPointTimerIdsRef: editorRefs.playbackPointTimerIdsRef,
      playbackSessionIdRef: editorRefs.playbackSessionIdRef,
      setIsPlaying: appState.setIsPlaying,
      firstPlaybackPoint: layout.firstPlaybackPoint,
      scoreScrollRef: editorRefs.scoreScrollRef,
      playheadGeometryRevision: `${layout.layoutStabilityKey}:${coreEditing.chordMarker.chordMarkerLayoutRevision}`,
      playheadFollowEnabled: appState.playheadFollowEnabled,
    },
    playbackDebug: {
      playbackCursorLayout: {
        playbackTimelineEventByPointKey: layout.playbackTimelineEventByPointKey,
        noteLayoutsByPairRef: editorRefs.noteLayoutsByPairRef,
        measureTimelineBundlesRef: editorRefs.measureTimelineBundlesRef,
        measureLayoutsRef: editorRefs.measureLayoutsRef,
        horizontalMeasureFramesByPair: layout.horizontalMeasureFramesByPair,
        getMeasureFrameContentGeometry: layout.getMeasureFrameContentGeometry,
        horizontalRenderOffsetX: layout.horizontalRenderOffsetX,
        layoutStabilityKey: layout.layoutStabilityKey,
        chordMarkerLayoutRevision: coreEditing.chordMarker.chordMarkerLayoutRevision,
        scoreScaleX: layout.scoreScaleX,
        scoreScaleY: layout.scoreScaleY,
        scoreSurfaceOffsetYPx: layout.scoreSurfaceOffsetYPx,
      },
      runtimeDebugController: {
        enabled: import.meta.env.DEV,
        beginDrag: workspace.beginDrag,
        endDrag: workspace.endDrag,
        scoreScrollRef: editorRefs.scoreScrollRef,
        measureLayoutsRef: editorRefs.measureLayoutsRef,
        noteLayoutsByPairRef: editorRefs.noteLayoutsByPairRef,
        measureTimelineBundlesRef: editorRefs.measureTimelineBundlesRef,
        measurePairsRef: editorRefs.measurePairsRef,
        dragDebugFramesRef: editorRefs.dragDebugFramesRef,
        dragRef: editorRefs.dragRef,
        scoreOverlayRef: editorRefs.scoreOverlayRef,
        scoreRef: editorRefs.scoreRef,
        overlayLastRectRef: editorRefs.overlayLastRectRef,
        importFeedbackRef: editorRefs.importFeedbackRef,
        notePreviewEventsRef: audioPreview.notePreviewEventsRef,
        applyChordSelectionRange: coreEditing.chordMarker.applyChordSelectionRange,
        selectedSelectionsRef: editorRefs.selectedSelectionsRef,
        activeChordSelection: coreEditing.chordMarker.activeChordSelection,
        selectedMeasureHighlightRectPx: coreEditing.chordMarker.selectedMeasureHighlightRectPx,
        chordRulerMarkerMetaByKey: coreEditing.chordMarker.chordRulerMarkerMetaByKey,
        playbackTimelineEvents: layout.playbackTimelineEvents,
        safeCurrentPage: layout.safeCurrentPage,
        pageCount: layout.pageCount,
        systemsPerPage: layout.systemsPerPage,
        visibleSystemRange: layout.visibleSystemRange,
        activeSelection: appState.activeSelection,
        osmdPreviewSelectedSelectionKeyRef: editorUi.osmdPreviewSelectedSelectionKeyRef,
        osmdPreviewNoteLookupBySelectionRef: editorUi.osmdPreviewNoteLookupBySelectionRef,
        importMusicXmlTextWithCollapseReset: workspace.importMusicXmlTextWithCollapseReset,
        playScore: workspace.playScore,
        autoScaleEnabled: appState.autoScaleEnabled,
        setAutoScaleEnabled: appState.setAutoScaleEnabled,
        showNoteHeadJianpuEnabled: appState.showNoteHeadJianpuEnabled,
        setShowNoteHeadJianpuEnabled: appState.setShowNoteHeadJianpuEnabled,
        safeManualScalePercent: layout.safeManualScalePercent,
        setManualScalePercent: appState.setManualScalePercent,
        baseScoreScale: layout.baseScoreScale,
        scoreScale: layout.scoreScale,
        scoreScaleX: layout.scoreScaleX,
        scoreScaleY: layout.scoreScaleY,
        spacingLayoutMode: layout.spacingLayoutMode,
        dumpOsmdPreviewSystemMetrics: editorUi.dumpOsmdPreviewSystemMetrics,
        osmdPreviewLastRebalanceStatsRef: editorUi.osmdPreviewLastRebalanceStatsRef,
        osmdPreviewInstanceRef: editorUi.osmdPreviewInstanceRef,
      },
    },
  })

  return {
    audioPreview,
    workspace,
    editorUi,
    playback,
  }
}
