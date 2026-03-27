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
  })

  playbackBridge.syncWorkspaceRuntimeRefs(workspace)

  return {
    audioPreview,
    workspace,
    editorUi,
    playback: playbackBridge.playback,
  }
}
