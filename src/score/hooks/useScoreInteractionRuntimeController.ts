import { useRef } from 'react'
import { useScoreAudioPreviewController } from './useScoreAudioPreviewController'
import { useScoreEditorUiRuntime } from './useScoreEditorUiRuntime'
import {
  useScorePlaybackRuntimeBridge,
  type WorkspaceRuntimeRefs,
} from './useScorePlaybackRuntimeBridge'
import { useScoreWorkspaceRuntime } from './useScoreWorkspaceRuntime'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useHorizontalScoreLayout } from './useHorizontalScoreLayout'
import { useScoreCoreEditingController } from './useScoreCoreEditingController'
import { useSmartChordToneDialogController } from './useSmartChordToneDialogController'
import { useImportedSegmentRhythmTemplateController } from './useImportedSegmentRhythmTemplateController'
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

  const smartChordToneDialog = useSmartChordToneDialogController({
    measurePairsRef: editorRefs.measurePairsRef,
    importedNoteLookupRef: editorRefs.importedNoteLookupRef,
    measureKeyFifthsByMeasure: appState.measureKeyFifthsFromImport,
    chordRulerMarkerMetaByKey: coreEditing.chordMarker.chordRulerMarkerMetaByKey,
    handlePreviewPitchStack: audioPreview.handlePreviewPitchStack,
    applyKeyboardEditResult: coreEditing.mutation.applyKeyboardEditResult,
    setIsSelectionVisible: appState.setIsSelectionVisible,
    setSelectedSelections: appState.setSelectedSelections,
    setActiveSelection: appState.setActiveSelection,
    clearActiveAccidentalSelection: coreEditing.sessionHelpers.clearActiveAccidentalSelection,
    clearActiveTieSelection: coreEditing.sessionHelpers.clearActiveTieSelection,
    clearSelectedMeasureScope: coreEditing.sessionHelpers.clearSelectedMeasureScope,
    clearActiveChordSelection: coreEditing.chordMarker.clearActiveChordSelection,
    resetMidiStepChain: coreEditing.sessionHelpers.resetMidiStepChain,
  })

  const importedSegmentRhythmTemplate = useImportedSegmentRhythmTemplateController({
    scoreSourceKind: appState.scoreSourceKind,
    measurePairsRef: editorRefs.measurePairsRef,
    chordRulerEntriesByPair: appState.importedChordRulerEntriesByPairFromImport,
    measureTimeSignaturesByMeasure: appState.measureTimeSignaturesFromImport,
    measureKeyFifthsByMeasure: appState.measureKeyFifthsFromImport,
    segmentRhythmTemplateBindings: appState.segmentRhythmTemplateBindings,
    setSegmentRhythmTemplateBindings: appState.setSegmentRhythmTemplateBindings,
    applyKeyboardEditResult: coreEditing.mutation.applyKeyboardEditResult,
  })

  const workspaceRuntimeRefs: WorkspaceRuntimeRefs = {
    beginDragRef: useRef(null),
    endDragRef: useRef(null),
    importMusicXmlTextWithCollapseResetRef: useRef(null),
    playScoreRef: useRef(null),
  }

  const editorUi = useScoreEditorUiRuntime({
    appState,
    editorRefs,
    layout,
    coreEditing,
    audioPreview,
    initialTrebleNotes,
  })

  const playbackBridge = useScorePlaybackRuntimeBridge({
    appState,
    editorRefs,
    layout,
    coreEditing,
    audioPreview,
    editorUi,
    workspaceRuntimeRefs,
  })

  const workspace = useScoreWorkspaceRuntime({
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
    workspacePlaybackHandlers: playbackBridge.workspacePlaybackHandlers,
    onTrebleSelectionDoubleTap: smartChordToneDialog.openSmartChordToneDialogForSelection,
    onTimelineSegmentDoubleClick: importedSegmentRhythmTemplate.onTimelineSegmentDoubleClick,
  })

  playbackBridge.syncWorkspaceRuntimeRefs(workspace)

  return {
    audioPreview,
    workspace,
    editorUi,
    playback: playbackBridge.playback,
    smartChordToneDialog: smartChordToneDialog.smartChordToneDialog,
    rhythmTemplateLoadModal: importedSegmentRhythmTemplate.rhythmTemplateLoadModal,
  }
}
