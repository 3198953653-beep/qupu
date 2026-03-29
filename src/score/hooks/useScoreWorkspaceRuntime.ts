import { useScoreAudioPreviewController } from './useScoreAudioPreviewController'
import { useScoreWorkspaceController } from './useScoreWorkspaceController'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useHorizontalScoreLayout } from './useHorizontalScoreLayout'
import { useScoreCoreEditingController } from './useScoreCoreEditingController'
import { useScorePlaybackRuntimeBridge } from './useScorePlaybackRuntimeBridge'
import type { Pitch, ScoreNote, Selection, TimeSignature } from '../types'

export function useScoreWorkspaceRuntime(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  layout: ReturnType<typeof useHorizontalScoreLayout>
  coreEditing: ReturnType<typeof useScoreCoreEditingController>
  audioPreview: ReturnType<typeof useScoreAudioPreviewController>
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
  workspacePlaybackHandlers: ReturnType<typeof useScorePlaybackRuntimeBridge>['workspacePlaybackHandlers']
  onTrebleSelectionDoubleTap?: (selection: Selection) => void
}) {
  const {
    appState,
    editorRefs,
    layout,
    coreEditing,
    audioPreview,
    buildSelectionsForMeasureStaff,
    initialTrebleNotes,
    initialBassNotes,
    pitches,
    backend,
    previewDefaultAccidentalOffsetPx,
    previewStartThresholdPx,
    workspacePlaybackHandlers,
    onTrebleSelectionDoubleTap,
  } = params

  return useScoreWorkspaceController({
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
      grandStaffLayoutMetrics: layout.grandStaffLayoutMetrics,
      trebleNoteById: layout.trebleNoteById,
      bassNoteById: layout.bassNoteById,
    },
    onAfterScoreRender: coreEditing.chordMarker.onAfterScoreRender,
    clearActiveChordSelection: coreEditing.chordMarker.clearActiveChordSelection,
    onTrebleSelectionDoubleTap,
    pushUndoSnapshot: coreEditing.mutation.pushUndoSnapshot,
    handlePreviewScoreNote: audioPreview.handlePreviewScoreNote,
    handlePlaybackStart: workspacePlaybackHandlers.handlePlaybackStart,
    handlePlaybackPoint: workspacePlaybackHandlers.handlePlaybackPoint,
    handlePlaybackComplete: workspacePlaybackHandlers.handlePlaybackComplete,
    requestPlaybackCursorReset: workspacePlaybackHandlers.requestPlaybackCursorReset,
    stopActivePlaybackSession: workspacePlaybackHandlers.stopActivePlaybackSession,
    buildSelectionsForMeasureStaff,
    initialTrebleNotes,
    initialBassNotes,
    pitches,
    backend,
    previewDefaultAccidentalOffsetPx,
    previewStartThresholdPx,
  })
}
