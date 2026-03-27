import { useScoreDocumentActionsController } from './useScoreDocumentActionsController'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import type { Pitch, ScoreNote } from '../types'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import type { MeasurePair } from '../types'

export function useScoreWorkspaceDocumentActions(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  measurePairs: MeasurePair[]
  playbackTimelineEvents: PlaybackTimelineEvent[]
  clearDragOverlay: () => void
  clearActiveChordSelection: () => void
  handlePlaybackStart: Parameters<typeof useScoreDocumentActionsController>[0]['editorHandlers']['onPlaybackStart']
  handlePlaybackPoint: Parameters<typeof useScoreDocumentActionsController>[0]['editorHandlers']['onPlaybackPoint']
  handlePlaybackComplete: Parameters<typeof useScoreDocumentActionsController>[0]['editorHandlers']['onPlaybackComplete']
  requestPlaybackCursorReset: () => void
  stopActivePlaybackSession: () => void
  initialTrebleNotes: ScoreNote[]
  initialBassNotes: ScoreNote[]
  pitches: Pitch[]
}) {
  const {
    appState,
    editorRefs,
    measurePairs,
    playbackTimelineEvents,
    clearDragOverlay,
    clearActiveChordSelection,
    handlePlaybackStart,
    handlePlaybackPoint,
    handlePlaybackComplete,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
    initialTrebleNotes,
    initialBassNotes,
    pitches,
  } = params

  return useScoreDocumentActionsController({
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
      setTimelineSegmentOverlayMode: appState.setTimelineSegmentOverlayMode,
      setFullMeasureRestCollapseScopeKeys: appState.setFullMeasureRestCollapseScopeKeys,
    },
    stopPlayTimerRef: editorRefs.stopPlayTimerRef,
    playbackPointTimerIdsRef: editorRefs.playbackPointTimerIdsRef,
    playbackSessionIdRef: editorRefs.playbackSessionIdRef,
    synthRef: editorRefs.synthRef,
  })
}
