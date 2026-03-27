import { useCallback, type MutableRefObject } from 'react'
import { useScoreAudioPreviewController } from './useScoreAudioPreviewController'
import { useScoreEditorUiController } from './useScoreEditorUiController'
import { useScorePlaybackRuntimeController } from './useScorePlaybackRuntimeController'
import { useScoreWorkspaceController } from './useScoreWorkspaceController'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useHorizontalScoreLayout } from './useHorizontalScoreLayout'
import { useScoreCoreEditingController } from './useScoreCoreEditingController'

export type WorkspaceRuntimeRefs = {
  beginDragRef: MutableRefObject<ReturnType<typeof useScoreWorkspaceController>['beginDrag'] | null>
  endDragRef: MutableRefObject<ReturnType<typeof useScoreWorkspaceController>['endDrag'] | null>
  importMusicXmlTextWithCollapseResetRef: MutableRefObject<
    ReturnType<typeof useScoreWorkspaceController>['importMusicXmlTextWithCollapseReset'] | null
  >
  playScoreRef: MutableRefObject<ReturnType<typeof useScoreWorkspaceController>['playScore'] | null>
}

export function useScorePlaybackRuntimeBridge(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  layout: ReturnType<typeof useHorizontalScoreLayout>
  coreEditing: ReturnType<typeof useScoreCoreEditingController>
  audioPreview: ReturnType<typeof useScoreAudioPreviewController>
  editorUi: ReturnType<typeof useScoreEditorUiController>
  workspaceRuntimeRefs: WorkspaceRuntimeRefs
}) {
  const { appState, editorRefs, layout, coreEditing, audioPreview, editorUi, workspaceRuntimeRefs } = params

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
        beginDrag: (event) => {
          workspaceRuntimeRefs.beginDragRef.current?.(event)
        },
        endDrag: (event) => {
          workspaceRuntimeRefs.endDragRef.current?.(event)
        },
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
        importMusicXmlTextWithCollapseReset: (xmlText) => {
          workspaceRuntimeRefs.importMusicXmlTextWithCollapseResetRef.current?.(xmlText)
        },
        playScore: () => workspaceRuntimeRefs.playScoreRef.current?.(),
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

  const workspacePlaybackHandlers = {
    handlePlaybackStart: playback.handlePlaybackStart,
    handlePlaybackPoint: playback.handlePlaybackPoint,
    handlePlaybackComplete: playback.handlePlaybackComplete,
    requestPlaybackCursorReset: playback.requestPlaybackCursorReset,
    stopActivePlaybackSession: playback.stopActivePlaybackSession,
  }

  const syncWorkspaceRuntimeRefs = useCallback((workspace: ReturnType<typeof useScoreWorkspaceController>) => {
    workspaceRuntimeRefs.beginDragRef.current = workspace.beginDrag
    workspaceRuntimeRefs.endDragRef.current = workspace.endDrag
    workspaceRuntimeRefs.importMusicXmlTextWithCollapseResetRef.current =
      workspace.importMusicXmlTextWithCollapseReset
    workspaceRuntimeRefs.playScoreRef.current = workspace.playScore
  }, [workspaceRuntimeRefs])

  return {
    playback,
    workspacePlaybackHandlers,
    syncWorkspaceRuntimeRefs,
  }
}
