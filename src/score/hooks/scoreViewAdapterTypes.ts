import type { ComponentProps } from 'react'
import { ScoreBoard } from '../components/ScoreBoard'
import { ScoreControls } from '../components/ScoreControls'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useHorizontalScoreLayout } from './useHorizontalScoreLayout'
import { useScoreCoreEditingController } from './useScoreCoreEditingController'
import { useScoreInteractionRuntimeController } from './useScoreInteractionRuntimeController'

export type ScoreControlsProps = ComponentProps<typeof ScoreControls>
export type ScoreBoardProps = ComponentProps<typeof ScoreBoard>

export type ScoreViewAdapterParams = {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  layout: ReturnType<typeof useHorizontalScoreLayout>
  chordMarker: ReturnType<typeof useScoreCoreEditingController>['chordMarker']
  workspace: ReturnType<typeof useScoreInteractionRuntimeController>['workspace']
  editorUi: ReturnType<typeof useScoreInteractionRuntimeController>['editorUi']
  playback: ReturnType<typeof useScoreInteractionRuntimeController>['playback']
  pedalApplyDialog: ReturnType<typeof useScoreInteractionRuntimeController>['pedalApplyDialog']
  canOpenPedalModal: ReturnType<typeof useScoreInteractionRuntimeController>['canOpenPedalModal']
  openPedalModal: ReturnType<typeof useScoreInteractionRuntimeController>['openPedalModal']
  playbackVolumeDialog: ReturnType<typeof useScoreInteractionRuntimeController>['playbackVolumeDialog']
  openPlaybackVolumeModal: ReturnType<typeof useScoreInteractionRuntimeController>['openPlaybackVolumeModal']
}
