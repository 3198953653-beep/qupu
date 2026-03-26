import { useScoreDocumentActionsController } from './useScoreDocumentActionsController'
import { useScoreSurfaceController } from './useScoreSurfaceController'
import { mergeFullMeasureRestCollapseScopeKeys, toMeasureStaffScopeKey } from '../fullMeasureRestCollapse'
import { resolvePairTimeSignature } from '../measureRestUtils'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useScoreEditingSessionHelpers } from './useScoreEditingSessionHelpers'
import type { Pitch, ScoreNote, Selection, TimeSignature } from '../types'

function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}

export function useScoreWorkspaceController(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  sessionHelpers: ReturnType<typeof useScoreEditingSessionHelpers>
  measurePairs: ReturnType<typeof useScoreAppState>['measurePairsFromImport'] extends infer _ ? import('../types').MeasurePair[] : never
  playbackTimelineEvents: import('../playbackTimeline').PlaybackTimelineEvent[]
  layout: {
    totalScoreWidth: number
    displayScoreWidth: number
    scoreScaleX: number
    scoreScaleY: number
    scoreWidth: number
    scoreHeight: number
    systemRanges: { startPairIndex: number; endPairIndexExclusive: number }[]
    visibleSystemRange: { start: number; end: number }
    horizontalRenderOffsetX: number
    horizontalRenderWindow: { startPairIndex: number; endPairIndexExclusive: number }
    horizontalMeasureFramesByPair: import('../types').MeasureFrame[]
    layoutStabilityKey: string
    renderQualityScale: { x: number; y: number }
    supplementalSpacingTicksByPair: number[][] | null
    spacingLayoutMode: import('../types').SpacingLayoutMode
    trebleNoteById: Map<string, ScoreNote>
    bassNoteById: Map<string, ScoreNote>
  }
  onAfterScoreRender: () => void
  clearActiveChordSelection: () => void
  pushUndoSnapshot: (sourcePairs: import('../types').MeasurePair[]) => void
  handlePreviewScoreNote: ReturnType<typeof import('./useScoreAudioPreviewController').useScoreAudioPreviewController>['handlePreviewScoreNote']
  handlePlaybackStart: Parameters<typeof useScoreDocumentActionsController>[0]['editorHandlers']['onPlaybackStart']
  handlePlaybackPoint: Parameters<typeof useScoreDocumentActionsController>[0]['editorHandlers']['onPlaybackPoint']
  handlePlaybackComplete: Parameters<typeof useScoreDocumentActionsController>[0]['editorHandlers']['onPlaybackComplete']
  requestPlaybackCursorReset: () => void
  stopActivePlaybackSession: () => void
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
    sessionHelpers,
    measurePairs,
    playbackTimelineEvents,
    layout,
    onAfterScoreRender,
    clearActiveChordSelection,
    pushUndoSnapshot,
    handlePreviewScoreNote,
    handlePlaybackStart,
    handlePlaybackPoint,
    handlePlaybackComplete,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
    buildSelectionsForMeasureStaff,
    initialTrebleNotes,
    initialBassNotes,
    pitches,
    backend,
    previewDefaultAccidentalOffsetPx,
    previewStartThresholdPx,
  } = params

  const { clearDragOverlay, onSurfacePointerMove, endDrag, beginDrag } = useScoreSurfaceController({
    scoreScrollRef: editorRefs.scoreScrollRef,
    setHorizontalViewportXRange: appState.setHorizontalViewportXRange,
    scoreScaleX: layout.scoreScaleX,
    totalScoreWidth: layout.totalScoreWidth,
    displayScoreWidth: layout.displayScoreWidth,
    widthProbeRendererRef: editorRefs.widthProbeRendererRef,
    horizontalMeasureWidthCacheRef: editorRefs.horizontalMeasureWidthCacheRef,
    timeAxisSpacingConfig: appState.timeAxisSpacingConfig,
    clearDragOverlayRef: editorRefs.clearDragOverlayRef,
    importedRefsSync: {
      measurePairsFromImport: appState.measurePairsFromImport,
      measurePairsFromImportRef: editorRefs.measurePairsFromImportRef,
      measureKeyFifthsFromImport: appState.measureKeyFifthsFromImport,
      measureKeyFifthsFromImportRef: editorRefs.measureKeyFifthsFromImportRef,
      measureKeyModesFromImport: appState.measureKeyModesFromImport,
      measureKeyModesFromImportRef: editorRefs.measureKeyModesFromImportRef,
      measureDivisionsFromImport: appState.measureDivisionsFromImport,
      measureDivisionsFromImportRef: editorRefs.measureDivisionsFromImportRef,
      measureTimeSignaturesFromImport: appState.measureTimeSignaturesFromImport,
      measureTimeSignaturesFromImportRef: editorRefs.measureTimeSignaturesFromImportRef,
      musicXmlMetadataFromImport: appState.musicXmlMetadataFromImport,
      musicXmlMetadataFromImportRef: editorRefs.musicXmlMetadataFromImportRef,
      measurePairs,
      measurePairsRef: editorRefs.measurePairsRef,
    },
    rhythmLinkedBassSync: {
      notes: appState.notes,
      isRhythmLinked: appState.isRhythmLinked,
      setBassNotes: appState.setBassNotes,
    },
    scoreRender: {
      scoreRef: editorRefs.scoreRef,
      rendererRef: editorRefs.rendererRef,
      rendererSizeRef: editorRefs.rendererSizeRef,
      scoreWidth: layout.scoreWidth,
      scoreHeight: layout.scoreHeight,
      measurePairs,
      systemRanges: layout.systemRanges,
      visibleSystemRange: layout.visibleSystemRange,
      renderOriginSystemIndex: layout.visibleSystemRange.start,
      visiblePairRange: {
        startPairIndex: layout.horizontalRenderWindow.startPairIndex,
        endPairIndexExclusive: layout.horizontalRenderWindow.endPairIndexExclusive,
      },
      clearViewportXRange: null,
      measureFramesByPair: layout.horizontalMeasureFramesByPair,
      renderOffsetX: layout.horizontalRenderOffsetX,
      measureKeyFifthsFromImport: appState.measureKeyFifthsFromImport,
      measureTimeSignaturesFromImport: appState.measureTimeSignaturesFromImport,
      supplementalSpacingTicksByPair: layout.supplementalSpacingTicksByPair,
      activeSelection: appState.isSelectionVisible ? appState.activeSelection : null,
      activeAccidentalSelection: appState.activeAccidentalSelection,
      activeTieSegmentKey: appState.activeTieSelection?.key ?? null,
      draggingSelection: appState.draggingSelection,
      activeSelections: appState.isSelectionVisible ? appState.selectedSelections : [],
      draggingSelections: appState.draggingSelection ? [appState.draggingSelection] : [],
      selectedMeasureScope: appState.selectedMeasureScope,
      fullMeasureRestCollapseScopeKeys: appState.fullMeasureRestCollapseScopeKeys,
      layoutReflowHintRef: editorRefs.layoutReflowHintRef,
      layoutStabilityKey: layout.layoutStabilityKey,
      noteLayoutsRef: editorRefs.noteLayoutsRef,
      noteLayoutsByPairRef: editorRefs.noteLayoutsByPairRef,
      noteLayoutByKeyRef: editorRefs.noteLayoutByKeyRef,
      hitGridRef: editorRefs.hitGridRef,
      measureLayoutsRef: editorRefs.measureLayoutsRef,
      measureTimelineBundlesRef: editorRefs.measureTimelineBundlesRef,
      backend,
      pagePaddingX: appState.pageHorizontalPaddingPx,
      timeAxisSpacingConfig: appState.timeAxisSpacingConfig,
      spacingLayoutMode: layout.spacingLayoutMode,
      showInScoreMeasureNumbers: appState.showInScoreMeasureNumbers,
      showNoteHeadJianpuEnabled: appState.showNoteHeadJianpuEnabled,
      renderScaleX: layout.scoreScaleX,
      renderScaleY: layout.scoreScaleY,
      renderQualityScaleX: layout.renderQualityScale.x,
      renderQualityScaleY: layout.renderQualityScale.y,
      dragPreview: appState.draggingSelection ? appState.dragPreviewState : null,
      onAfterRender: onAfterScoreRender,
    },
    synthLifecycle: {
      synthRef: editorRefs.synthRef,
    },
    rendererCleanup: {
      dragRafRef: editorRefs.dragRafRef,
      dragPendingRef: editorRefs.dragPendingRef,
      rendererRef: editorRefs.rendererRef,
      rendererSizeRef: editorRefs.rendererSizeRef,
      overlayRendererRef: editorRefs.overlayRendererRef,
      overlayRendererSizeRef: editorRefs.overlayRendererSizeRef,
      overlayLastRectRef: editorRefs.overlayLastRectRef,
    },
    dragHandlers: {
      scoreRef: editorRefs.scoreRef,
      scoreOverlayRef: editorRefs.scoreOverlayRef,
      noteLayoutsRef: editorRefs.noteLayoutsRef,
      noteLayoutsByPairRef: editorRefs.noteLayoutsByPairRef,
      noteLayoutByKeyRef: editorRefs.noteLayoutByKeyRef,
      hitGridRef: editorRefs.hitGridRef,
      measureLayoutsRef: editorRefs.measureLayoutsRef,
      measureTimelineBundlesRef: editorRefs.measureTimelineBundlesRef,
      measurePairsRef: editorRefs.measurePairsRef,
      dragDebugFramesRef: editorRefs.dragDebugFramesRef,
      dragRef: editorRefs.dragRef,
      dragPreviewFrameRef: editorRefs.dragPreviewFrameRef,
      dragRafRef: editorRefs.dragRafRef,
      dragPendingRef: editorRefs.dragPendingRef,
      overlayRendererRef: editorRefs.overlayRendererRef,
      overlayRendererSizeRef: editorRefs.overlayRendererSizeRef,
      overlayLastRectRef: editorRefs.overlayLastRectRef,
      setDragDebugReport: appState.setDragDebugReport,
      setLayoutReflowHint: (hint) => {
        const decoratedHint = hint ? { ...hint, layoutStabilityKey: layout.layoutStabilityKey } : null
        editorRefs.layoutReflowHintRef.current = decoratedHint
      },
      setMeasurePairsFromImport: appState.setMeasurePairsFromImport,
      setNotes: appState.setNotes,
      setBassNotes: appState.setBassNotes,
      setDragPreviewState: appState.setDragPreviewState,
      setActiveSelection: appState.setActiveSelection,
      setDraggingSelection: appState.setDraggingSelection,
      currentSelections: appState.selectedSelections,
      onSelectionPointerDown: (_selection, nextSelections, _mode) => {
        void _selection
        void _mode
        sessionHelpers.resetMidiStepChain()
        appState.setActiveAccidentalSelection(null)
        appState.setActiveTieSelection(null)
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
      },
      onSelectionTapRelease: (selection) => {
        sessionHelpers.resetMidiStepChain()
        appState.setActiveAccidentalSelection(null)
        appState.setActiveTieSelection(null)
        appState.setSelectedMeasureScope(null)
        clearActiveChordSelection()
        appState.setSelectedSelections([selection])
        appState.setActiveSelection(selection)
        appState.setIsSelectionVisible(true)
      },
      onAccidentalPointerDown: (selection) => {
        sessionHelpers.resetMidiStepChain()
        appState.setActiveAccidentalSelection(selection)
        appState.setActiveTieSelection(null)
        appState.setSelectedMeasureScope(null)
        clearActiveChordSelection()
        appState.setDraggingSelection(null)
        appState.setSelectedSelections([])
        appState.setIsSelectionVisible(false)
      },
      onTiePointerDown: (selection) => {
        sessionHelpers.resetMidiStepChain()
        appState.setActiveTieSelection(selection)
        appState.setActiveAccidentalSelection(null)
        appState.setSelectedMeasureScope(null)
        clearActiveChordSelection()
        appState.setDraggingSelection(null)
        appState.setSelectedSelections([])
        appState.setIsSelectionVisible(false)
      },
      onBeforeApplyScoreChange: (sourcePairs) => {
        pushUndoSnapshot(sourcePairs)
      },
      onAfterApplyScoreChange: ({ sourcePairs, nextPairs }) => {
        appState.setFullMeasureRestCollapseScopeKeys((current) =>
          mergeFullMeasureRestCollapseScopeKeys({
            currentScopeKeys: current,
            sourcePairs,
            nextPairs,
          }),
        )
      },
      onBlankPointerDown: ({ pairIndex, staff }) => {
        sessionHelpers.resetMidiStepChain()
        appState.setActiveAccidentalSelection(null)
        appState.setActiveTieSelection(null)
        clearActiveChordSelection()
        if (pairIndex === null || staff === null) {
          appState.setIsSelectionVisible(false)
          appState.setSelectedSelections([])
          appState.setSelectedMeasureScope(null)
          return
        }
        const targetPair = editorRefs.measurePairsRef.current[pairIndex]
        if (!targetPair) {
          appState.setIsSelectionVisible(false)
          appState.setSelectedSelections([])
          appState.setSelectedMeasureScope(null)
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
          return
        }
        appState.setIsSelectionVisible(true)
        appState.setSelectedSelections(nextSelections)
        appState.setActiveSelection(nextSelections[0])
        appState.setSelectedMeasureScope({ pairIndex, staff })
      },
      onSelectionActivated: () => {
        sessionHelpers.resetMidiStepChain()
        appState.setActiveAccidentalSelection(null)
        appState.setActiveTieSelection(null)
        clearActiveChordSelection()
        appState.setIsSelectionVisible(true)
      },
      onPreviewScoreNote: handlePreviewScoreNote,
      measurePairsFromImportRef: editorRefs.measurePairsFromImportRef,
      importedNoteLookupRef: editorRefs.importedNoteLookupRef,
      measureKeyFifthsFromImportRef: editorRefs.measureKeyFifthsFromImportRef,
      trebleNoteById: layout.trebleNoteById,
      bassNoteById: layout.bassNoteById,
      pitches,
      previewDefaultAccidentalOffsetPx,
      previewStartThresholdPx,
      backend,
      scoreScaleX: layout.scoreScaleX,
      scoreScaleY: layout.scoreScaleY,
      renderQualityScaleX: layout.renderQualityScale.x,
      renderQualityScaleY: layout.renderQualityScale.y,
      viewportXRange: appState.horizontalViewportXRange,
      renderOffsetX: layout.horizontalRenderOffsetX,
      timeAxisSpacingConfig: appState.timeAxisSpacingConfig,
      spacingLayoutMode: layout.spacingLayoutMode,
      showNoteHeadJianpu: appState.showNoteHeadJianpuEnabled,
    },
  })

  const documentActions = useScoreDocumentActionsController({
    editorHandlers: {
      synthRef: editorRefs.synthRef,
      notes: appState.notes,
      playbackTimelineEvents,
      stopPlayTimerRef: editorRefs.stopPlayTimerRef,
      playbackPointTimerIdsRef: editorRefs.playbackPointTimerIdsRef,
      playbackSessionIdRef: editorRefs.playbackSessionIdRef,
      setIsPlaying: appState.setIsPlaying,
      onPlaybackStart: handlePlaybackStart,
      onPlaybackPoint: handlePlaybackPoint,
      onPlaybackComplete: handlePlaybackComplete,
      onImportedScoreApplied: requestPlaybackCursorReset,
      setNotes: appState.setNotes,
      setBassNotes: appState.setBassNotes,
      setMeasurePairsFromImport: appState.setMeasurePairsFromImport,
      measurePairsFromImportRef: editorRefs.measurePairsFromImportRef,
      setMeasureKeyFifthsFromImport: appState.setMeasureKeyFifthsFromImport,
      measureKeyFifthsFromImportRef: editorRefs.measureKeyFifthsFromImportRef,
      setMeasureKeyModesFromImport: appState.setMeasureKeyModesFromImport,
      measureKeyModesFromImportRef: editorRefs.measureKeyModesFromImportRef,
      setMeasureDivisionsFromImport: appState.setMeasureDivisionsFromImport,
      measureDivisionsFromImportRef: editorRefs.measureDivisionsFromImportRef,
      setMeasureTimeSignaturesFromImport: appState.setMeasureTimeSignaturesFromImport,
      measureTimeSignaturesFromImportRef: editorRefs.measureTimeSignaturesFromImportRef,
      setMusicXmlMetadataFromImport: appState.setMusicXmlMetadataFromImport,
      musicXmlMetadataFromImportRef: editorRefs.musicXmlMetadataFromImportRef,
      setImportedChordRulerEntriesByPairFromImport: appState.setImportedChordRulerEntriesByPairFromImport,
      importedNoteLookupRef: editorRefs.importedNoteLookupRef,
      dragRef: editorRefs.dragRef,
      clearDragOverlay,
      setDraggingSelection: appState.setDraggingSelection,
      setActiveSelection: appState.setActiveSelection,
      setIsRhythmLinked: appState.setIsRhythmLinked,
      setImportFeedback: appState.setImportFeedback,
      musicXmlInput: appState.musicXmlInput,
      setMusicXmlInput: appState.setMusicXmlInput,
      fileInputRef: editorRefs.fileInputRef,
      measurePairs,
      setRhythmPreset: appState.setRhythmPreset,
      pitches,
      initialTrebleNotes,
      initialBassNotes,
    },
    editorActionWrappersBase: {
      stopActivePlaybackSession,
      requestPlaybackCursorReset,
      clearActiveChordSelection,
      setActiveBuiltInDemo: appState.setActiveBuiltInDemo,
      setFullMeasureRestCollapseScopeKeys: appState.setFullMeasureRestCollapseScopeKeys,
    },
    stopPlayTimerRef: editorRefs.stopPlayTimerRef,
    playbackPointTimerIdsRef: editorRefs.playbackPointTimerIdsRef,
    playbackSessionIdRef: editorRefs.playbackSessionIdRef,
    synthRef: editorRefs.synthRef,
  })

  return {
    clearDragOverlay,
    onSurfacePointerMove,
    endDrag,
    beginDrag,
    ...documentActions,
  }
}
