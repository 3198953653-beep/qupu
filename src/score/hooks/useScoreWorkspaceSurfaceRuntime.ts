import { useScoreSurfaceController } from './useScoreSurfaceController'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useHorizontalScoreLayout } from './useHorizontalScoreLayout'
import { useScoreWorkspaceSelectionBindings } from './useScoreWorkspaceSelectionBindings'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import type { ChordRulerEntry } from '../chordRuler'
import type { Pitch, ScoreNote } from '../types'
import type { MeasurePair } from '../types'
import type { useScoreAudioPreviewController } from './useScoreAudioPreviewController'

export function useScoreWorkspaceSurfaceRuntime(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  measurePairs: MeasurePair[]
  layout: {
    totalScoreWidth: number
    displayScoreWidth: number
    scoreScaleX: number
    scoreScaleY: number
    scoreWidth: number
    scoreHeight: number
    systemRanges: ReturnType<typeof useHorizontalScoreLayout>['systemRanges']
    visibleSystemRange: ReturnType<typeof useHorizontalScoreLayout>['visibleSystemRange']
    horizontalRenderOffsetX: number
    horizontalRenderWindow: { startPairIndex: number; endPairIndexExclusive: number }
    horizontalMeasureFramesByPair: ReturnType<typeof useHorizontalScoreLayout>['horizontalMeasureFramesByPair']
    layoutStabilityKey: string
    renderQualityScale: ReturnType<typeof useHorizontalScoreLayout>['renderQualityScale']
    supplementalSpacingTicksByPair: ReturnType<typeof useHorizontalScoreLayout>['supplementalSpacingTicksByPair']
    chordRulerEntriesByPair: ChordRulerEntry[][] | null
    spacingLayoutMode: ReturnType<typeof useHorizontalScoreLayout>['spacingLayoutMode']
    grandStaffLayoutMetrics: GrandStaffLayoutMetrics
    trebleNoteById: Map<string, ScoreNote>
    bassNoteById: Map<string, ScoreNote>
  }
  onAfterScoreRender: () => void
  selectionBindings: ReturnType<typeof useScoreWorkspaceSelectionBindings>
  handlePreviewScoreNote: ReturnType<typeof useScoreAudioPreviewController>['handlePreviewScoreNote']
  pitches: Pitch[]
  backend: number
  previewDefaultAccidentalOffsetPx: number
  previewStartThresholdPx: number
}) {
  const {
    appState,
    editorRefs,
    measurePairs,
    layout,
    onAfterScoreRender,
    selectionBindings,
    handlePreviewScoreNote,
    pitches,
    backend,
    previewDefaultAccidentalOffsetPx,
    previewStartThresholdPx,
  } = params

  return useScoreSurfaceController({
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
      pedalSpans: appState.pedalSpans,
      chordRulerEntriesByPair: layout.chordRulerEntriesByPair,
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
      grandStaffLayoutMetrics: layout.grandStaffLayoutMetrics,
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
      staffInterGapPx: appState.staffInterGapPx,
      setStaffInterGapPx: appState.setStaffInterGapPx,
      currentSelections: appState.selectedSelections,
      onSelectionPointerDown: selectionBindings.onSelectionPointerDown,
      onSelectionTapRelease: selectionBindings.onSelectionTapRelease,
      onAccidentalPointerDown: selectionBindings.onAccidentalPointerDown,
      onTiePointerDown: selectionBindings.onTiePointerDown,
      onBeforeApplyScoreChange: selectionBindings.onBeforeApplyScoreChange,
      onAfterApplyScoreChange: selectionBindings.onAfterApplyScoreChange,
      onBlankPointerDown: selectionBindings.onBlankPointerDown,
      onSelectionActivated: selectionBindings.onSelectionActivated,
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
}
