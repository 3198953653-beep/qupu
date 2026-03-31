import { useCallback, useRef } from 'react'
import { useScoreDocumentActionsController } from './useScoreDocumentActionsController'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import type { ImportResult, Pitch, ScoreNote, ScoreSourceKind } from '../types'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import type { MeasurePair } from '../types'

export function useScoreWorkspaceDocumentActions(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  measurePairs: MeasurePair[]
  playbackTimelineEvents: PlaybackTimelineEvent[]
  clearDragOverlay: () => void
  clearActiveChordSelection: () => void
  clearActivePedalSelection: () => void
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
    clearActivePedalSelection,
    handlePlaybackStart,
    handlePlaybackPoint,
    handlePlaybackComplete,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
    initialTrebleNotes,
    initialBassNotes,
    pitches,
  } = params
  const pendingImportedScoreSourceKindRef =
    useRef<Extract<ScoreSourceKind, 'musicxml-file' | 'musicxml-text'> | null>(null)
  const handleImportedScoreApplied = useCallback((result: ImportResult) => {
    requestPlaybackCursorReset()
    const nextSourceKind = pendingImportedScoreSourceKindRef.current ?? 'musicxml-text'
    appState.setScoreSourceKind(nextSourceKind)
    appState.setSegmentRhythmTemplateBindings({})
    appState.setActivePedalSelection(null)
    appState.setTimelineSegmentOverlayMode(
      result.importedTimelineSegmentStartPairIndexes && result.importedTimelineSegmentStartPairIndexes.length > 0
        ? 'imported-last-part'
        : 'curated-two-measure',
    )
    pendingImportedScoreSourceKindRef.current = null
  }, [
    appState.setScoreSourceKind,
    appState.setActivePedalSelection,
    appState.setSegmentRhythmTemplateBindings,
    appState.setTimelineSegmentOverlayMode,
    requestPlaybackCursorReset,
  ])

  return useScoreDocumentActionsController({
    editorHandlers: {
      synthRef: editorRefs.synthRef,
      notes: appState.notes,
      playbackTimelineEvents,
      playbackTrebleVolumePercent: appState.playbackTrebleVolumePercent,
      playbackBassVolumePercent: appState.playbackBassVolumePercent,
      stopPlayTimerRef: editorRefs.stopPlayTimerRef,
      playbackPointTimerIdsRef: editorRefs.playbackPointTimerIdsRef,
      playbackSessionIdRef: editorRefs.playbackSessionIdRef,
      setIsPlaying: appState.setIsPlaying,
      onPlaybackStart: handlePlaybackStart,
      onPlaybackPoint: handlePlaybackPoint,
      onPlaybackComplete: handlePlaybackComplete,
      onImportedScoreApplied: handleImportedScoreApplied,
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
      setImportedTimelineSegmentStartPairIndexesFromImport: appState.setImportedTimelineSegmentStartPairIndexesFromImport,
      setPedalSpans: appState.setPedalSpans,
      setFullMeasureRestCollapseScopeKeys: appState.setFullMeasureRestCollapseScopeKeys,
      importedNoteLookupRef: editorRefs.importedNoteLookupRef,
      dragRef: editorRefs.dragRef,
      clearDragOverlay,
      setDraggingSelection: appState.setDraggingSelection,
      setActiveSelection: appState.setActiveSelection,
      setIsRhythmLinked: appState.setIsRhythmLinked,
      setImportFeedback: appState.setImportFeedback,
      fileInputRef: editorRefs.fileInputRef,
      measurePairs,
      pedalSpans: appState.pedalSpans,
      setRhythmPreset: appState.setRhythmPreset,
      pitches,
      initialTrebleNotes,
      initialBassNotes,
    },
    editorActionWrappersBase: {
      stopActivePlaybackSession,
      requestPlaybackCursorReset,
      clearActiveChordSelection,
      clearActivePedalSelection,
      setActiveBuiltInDemo: appState.setActiveBuiltInDemo,
      setTimelineSegmentOverlayMode: appState.setTimelineSegmentOverlayMode,
      setScoreSourceKind: appState.setScoreSourceKind,
      setSegmentRhythmTemplateBindings: appState.setSegmentRhythmTemplateBindings,
      setPedalSpans: appState.setPedalSpans,
      setFullMeasureRestCollapseScopeKeys: appState.setFullMeasureRestCollapseScopeKeys,
      setPendingImportedScoreSourceKind: (kind) => {
        pendingImportedScoreSourceKindRef.current = kind
      },
    },
    stopPlayTimerRef: editorRefs.stopPlayTimerRef,
    playbackPointTimerIdsRef: editorRefs.playbackPointTimerIdsRef,
    playbackSessionIdRef: editorRefs.playbackSessionIdRef,
    synthRef: editorRefs.synthRef,
  })
}
