import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useScoreEditingSessionHelpers } from './useScoreEditingSessionHelpers'
import { useScoreWorkspaceDocumentActions } from './useScoreWorkspaceDocumentActions'
import { useScoreWorkspaceSelectionBindings } from './useScoreWorkspaceSelectionBindings'
import { useScoreWorkspaceSurfaceRuntime } from './useScoreWorkspaceSurfaceRuntime'
import type { ChordRulerEntry } from '../chordRuler'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import type { Pitch, ScoreNote, Selection, TimeSignature } from '../types'

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
    chordRulerEntriesByPair: ChordRulerEntry[][] | null
    spacingLayoutMode: import('../types').SpacingLayoutMode
    grandStaffLayoutMetrics: GrandStaffLayoutMetrics
    trebleNoteById: Map<string, ScoreNote>
    bassNoteById: Map<string, ScoreNote>
  }
  onAfterScoreRender: () => void
  clearActiveChordSelection: () => void
  clearActivePedalSelection: () => void
  onTrebleSelectionDoubleTap?: (selection: Selection) => void
  onBassSelectionDoubleTap?: (selection: Selection) => void
  onTimelineSegmentDoubleClick?: (scopeKey: string) => void
  pushUndoSnapshot: (sourcePairs: import('../types').MeasurePair[]) => void
  handlePreviewScoreNote: ReturnType<typeof import('./useScoreAudioPreviewController').useScoreAudioPreviewController>['handlePreviewScoreNote']
  handlePlaybackStart: Parameters<typeof import('./useScoreDocumentActionsController').useScoreDocumentActionsController>[0]['editorHandlers']['onPlaybackStart']
  handlePlaybackPoint: Parameters<typeof import('./useScoreDocumentActionsController').useScoreDocumentActionsController>[0]['editorHandlers']['onPlaybackPoint']
  handlePlaybackComplete: Parameters<typeof import('./useScoreDocumentActionsController').useScoreDocumentActionsController>[0]['editorHandlers']['onPlaybackComplete']
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
    clearActivePedalSelection,
    onTrebleSelectionDoubleTap,
    onBassSelectionDoubleTap,
    onTimelineSegmentDoubleClick,
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

  const selectionBindings = useScoreWorkspaceSelectionBindings({
    appState,
    editorRefs,
    sessionHelpers,
    clearActiveChordSelection,
    onTrebleSelectionDoubleTap,
    onBassSelectionDoubleTap,
    pushUndoSnapshot,
    buildSelectionsForMeasureStaff,
  })

  const { clearDragOverlay, onSurfacePointerMove, endDrag, beginDrag } = useScoreWorkspaceSurfaceRuntime({
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
  })

  const documentActions = useScoreWorkspaceDocumentActions({
    appState,
    editorRefs,
    measurePairs,
    playbackTimelineEvents,
    clearDragOverlay,
    clearActiveChordSelection,
    clearActivePedalSelection,
    handlePlaybackStart,
    handlePlaybackPoint,
    handlePlaybackComplete,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
    initialTrebleNotes,
    initialBassNotes,
    pitches,
  })

  return {
    clearDragOverlay,
    onSurfacePointerMove,
    endDrag,
    beginDrag,
    onTimelineSegmentDoubleClick: onTimelineSegmentDoubleClick ?? (() => {}),
    ...documentActions,
  }
}
