import {
  useMemo,
  type ComponentProps,
} from 'react'
import { DEFAULT_TIME_AXIS_SPACING_CONFIG } from '../layout/timeAxisSpacing'
import { toDisplayDuration } from '../layout/demand'
import {
  DEFAULT_CHORD_MARKER_PADDING_PX,
  DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT,
  DEFAULT_PAGE_HORIZONTAL_PADDING_PX,
  clampBaseMinGap32Px,
  clampCanvasHeightPercent,
  clampChordMarkerPaddingPx,
  clampChordMarkerUiScalePercent,
  clampDurationGapRatio,
  clampLeadingBarlineGapPx,
  clampPageHorizontalPaddingPx,
  clampScalePercent,
  clampSecondChordSafeGapPx,
} from '../scorePresentation'
import { ScoreBoard } from '../components/ScoreBoard'
import { ScoreControls } from '../components/ScoreControls'
import { useScoreAppState } from './useScoreAppState'
import { useScoreEditorRefs } from './useScoreEditorRefs'
import { useHorizontalScoreLayout } from './useHorizontalScoreLayout'
import { useScoreCoreEditingController } from './useScoreCoreEditingController'
import { useScoreInteractionRuntimeController } from './useScoreInteractionRuntimeController'

type ScoreControlsProps = ComponentProps<typeof ScoreControls>
type ScoreBoardProps = ComponentProps<typeof ScoreBoard>

export function useScoreViewProps(params: {
  appState: ReturnType<typeof useScoreAppState>
  editorRefs: ReturnType<typeof useScoreEditorRefs>
  layout: ReturnType<typeof useHorizontalScoreLayout>
  chordMarker: ReturnType<typeof useScoreCoreEditingController>['chordMarker']
  workspace: ReturnType<typeof useScoreInteractionRuntimeController>['workspace']
  editorUi: ReturnType<typeof useScoreInteractionRuntimeController>['editorUi']
  playback: ReturnType<typeof useScoreInteractionRuntimeController>['playback']
}): {
  scoreControlsProps: ScoreControlsProps
  scoreBoardProps: ScoreBoardProps
} {
  const { appState, editorRefs, layout, chordMarker, workspace, editorUi, playback } = params
  const {
    isPlaying,
    playheadFollowEnabled,
    setPlayheadFollowEnabled,
    showChordDegreeEnabled,
    setShowChordDegreeEnabled,
    showInScoreMeasureNumbers,
    setShowInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
    autoScaleEnabled,
    setAutoScaleEnabled,
    setManualScalePercent,
    setCanvasHeightPercent,
    pageHorizontalPaddingPx,
    setPageHorizontalPaddingPx,
    setChordMarkerUiScalePercent,
    setChordMarkerPaddingPx,
    timeAxisSpacingConfig,
    setTimeAxisSpacingConfig,
    isNotationPaletteOpen,
    notationPaletteSelection,
    notationPaletteLastAction,
    importFeedback,
    rhythmPreset,
    activeBuiltInDemo,
    draggingSelection,
    activeSelection,
  } = appState
  const {
    fileInputRef,
    scoreScrollRef,
    scoreStageRef,
    scoreRef,
    scoreOverlayRef,
  } = editorRefs
  const {
    autoScalePercent,
    safeManualScalePercent,
    safeCanvasHeightPercent,
    safeChordMarkerUiScalePercent,
    safeChordMarkerPaddingPx,
    chordMarkerStyleMetrics,
    displayScoreWidth,
    displayScoreHeight,
    scoreWidth,
    scoreHeight,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
  } = layout
  const {
    measureRulerTicks,
    chordRulerMarkers,
    onChordRulerMarkerClick,
    selectedMeasureHighlightRectPx,
  } = chordMarker
  const {
    playScore,
    openMusicXmlFilePicker,
    exportMusicXmlFile,
    importMusicXmlFromTextareaWithCollapseReset,
    onMusicXmlFileChangeWithCollapseReset,
    loadSampleMusicXmlWithCollapseReset,
    loadWholeNoteDemoWithCollapseReset,
    loadHalfNoteDemoWithCollapseReset,
    resetScoreWithCollapseReset,
    applyRhythmPresetWithCollapseReset,
    onSurfacePointerMove,
  } = workspace
  const {
    trebleSequenceText,
    bassSequenceText,
    currentSelection,
    currentSelectionPosition,
    currentSelectionPitchLabel,
    selectedPoolSize,
    derivedNotationPaletteDisplay,
    midiPermissionState,
    midiInputOptions,
    selectedMidiInputId,
    setSelectedMidiInputId,
    midiSupported,
    osmdDirectFileInputRef,
    onOsmdDirectFileChange,
    openOsmdPreview,
    openDirectOsmdFilePicker,
    openBeamGroupingTool,
    toggleNotationPalette,
    closeNotationPalette,
    onNotationPaletteSelectionChange,
  } = editorUi
  const {
    stopActivePlaybackSession,
    playheadElementRef,
    playheadDebugLogText,
    playheadRectPx,
    playheadStatus,
    onBeginDragWithFirstMeasureDebug,
    onEndDragWithFirstMeasureDebug,
  } = playback

  const scoreControlsProps = useMemo<ScoreControlsProps>(() => ({
    isPlaying,
    onPlayScore: playScore,
    onStopScore: stopActivePlaybackSession,
    onReset: resetScoreWithCollapseReset,
    playheadFollowEnabled,
    onTogglePlayheadFollow: () => setPlayheadFollowEnabled((enabled) => !enabled),
    showChordDegreeEnabled,
    onToggleChordDegreeDisplay: () => setShowChordDegreeEnabled((enabled) => !enabled),
    showInScoreMeasureNumbers,
    onToggleInScoreMeasureNumbers: () => setShowInScoreMeasureNumbers((current) => !current),
    showNoteHeadJianpuEnabled,
    onToggleNoteHeadJianpuDisplay: () => setShowNoteHeadJianpuEnabled((current) => !current),
    autoScaleEnabled,
    autoScalePercent,
    onToggleAutoScale: () => setAutoScaleEnabled((enabled) => !enabled),
    manualScalePercent: safeManualScalePercent,
    onManualScalePercentChange: (nextPercent: number) => setManualScalePercent(clampScalePercent(nextPercent)),
    canvasHeightPercent: safeCanvasHeightPercent,
    onCanvasHeightPercentChange: (nextPercent: number) => setCanvasHeightPercent(clampCanvasHeightPercent(nextPercent)),
    pageHorizontalPaddingPx,
    chordMarkerUiScalePercent: safeChordMarkerUiScalePercent,
    chordMarkerPaddingPx: safeChordMarkerPaddingPx,
    baseMinGap32Px: timeAxisSpacingConfig.baseMinGap32Px,
    leadingBarlineGapPx: timeAxisSpacingConfig.leadingBarlineGapPx,
    secondChordSafeGapPx: timeAxisSpacingConfig.secondChordSafeGapPx,
    durationGapRatio32: timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    durationGapRatio16: timeAxisSpacingConfig.durationGapRatios.sixteenth,
    durationGapRatio8: timeAxisSpacingConfig.durationGapRatios.eighth,
    durationGapRatio4: timeAxisSpacingConfig.durationGapRatios.quarter,
    durationGapRatio2: timeAxisSpacingConfig.durationGapRatios.half,
    durationGapRatioWhole: timeAxisSpacingConfig.durationGapRatios.whole,
    onPageHorizontalPaddingPxChange: (nextValue: number) =>
      setPageHorizontalPaddingPx(clampPageHorizontalPaddingPx(nextValue)),
    onChordMarkerUiScalePercentChange: (nextValue: number) =>
      setChordMarkerUiScalePercent(clampChordMarkerUiScalePercent(nextValue)),
    onChordMarkerPaddingPxChange: (nextValue: number) =>
      setChordMarkerPaddingPx(clampChordMarkerPaddingPx(nextValue)),
    onBaseMinGap32PxChange: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        baseMinGap32Px: clampBaseMinGap32Px(nextValue),
      })),
    onLeadingBarlineGapPxChange: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        leadingBarlineGapPx: clampLeadingBarlineGapPx(nextValue),
      })),
    onSecondChordSafeGapPxChange: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        secondChordSafeGapPx: clampSecondChordSafeGapPx(nextValue),
      })),
    onDurationGapRatio32Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          thirtySecond: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatio16Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          sixteenth: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatio8Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          eighth: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatio4Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          quarter: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatio2Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          half: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatioWholeChange: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          whole: clampDurationGapRatio(nextValue),
        },
      })),
    onResetSpacingConfig: () => {
      setTimeAxisSpacingConfig({
        ...DEFAULT_TIME_AXIS_SPACING_CONFIG,
        durationGapRatios: { ...DEFAULT_TIME_AXIS_SPACING_CONFIG.durationGapRatios },
      })
      setPageHorizontalPaddingPx(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
      setChordMarkerUiScalePercent(DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT)
      setChordMarkerPaddingPx(DEFAULT_CHORD_MARKER_PADDING_PX)
    },
    onOpenMusicXmlFilePicker: openMusicXmlFilePicker,
    onLoadSampleMusicXml: loadSampleMusicXmlWithCollapseReset,
    onLoadWholeNoteDemo: loadWholeNoteDemoWithCollapseReset,
    onLoadHalfNoteDemo: loadHalfNoteDemoWithCollapseReset,
    onExportMusicXmlFile: exportMusicXmlFile,
    onOpenOsmdPreview: openOsmdPreview,
    onOpenBeamGroupingTool: openBeamGroupingTool,
    isNotationPaletteOpen,
    onToggleNotationPalette: toggleNotationPalette,
    onCloseNotationPalette: closeNotationPalette,
    notationPaletteSelection,
    notationPaletteLastAction,
    notationPaletteActiveItemIdsOverride: derivedNotationPaletteDisplay?.activeItemIds ?? null,
    notationPaletteSummaryOverride: derivedNotationPaletteDisplay?.summary ?? null,
    onNotationPaletteSelectionChange,
    onOpenDirectOsmdFilePicker: openDirectOsmdFilePicker,
    onImportMusicXmlFromTextarea: importMusicXmlFromTextareaWithCollapseReset,
    midiSupported,
    midiPermissionState,
    midiInputOptions,
    selectedMidiInputId,
    onSelectedMidiInputIdChange: setSelectedMidiInputId,
    fileInputRef,
    osmdDirectFileInputRef,
    onMusicXmlFileChange: onMusicXmlFileChangeWithCollapseReset,
    onOsmdDirectFileChange,
    importFeedback,
    rhythmPreset,
    activeBuiltInDemo,
    onApplyRhythmPreset: applyRhythmPresetWithCollapseReset,
  }), [
    activeBuiltInDemo,
    applyRhythmPresetWithCollapseReset,
    autoScaleEnabled,
    autoScalePercent,
    closeNotationPalette,
    derivedNotationPaletteDisplay,
    exportMusicXmlFile,
    fileInputRef,
    importFeedback,
    importMusicXmlFromTextareaWithCollapseReset,
    isNotationPaletteOpen,
    isPlaying,
    loadHalfNoteDemoWithCollapseReset,
    loadSampleMusicXmlWithCollapseReset,
    loadWholeNoteDemoWithCollapseReset,
    midiInputOptions,
    midiPermissionState,
    midiSupported,
    notationPaletteLastAction,
    notationPaletteSelection,
    onMusicXmlFileChangeWithCollapseReset,
    onNotationPaletteSelectionChange,
    onOsmdDirectFileChange,
    openBeamGroupingTool,
    openDirectOsmdFilePicker,
    openMusicXmlFilePicker,
    openOsmdPreview,
    osmdDirectFileInputRef,
    pageHorizontalPaddingPx,
    playScore,
    playheadFollowEnabled,
    resetScoreWithCollapseReset,
    rhythmPreset,
    safeCanvasHeightPercent,
    safeChordMarkerPaddingPx,
    safeChordMarkerUiScalePercent,
    safeManualScalePercent,
    selectedMidiInputId,
    setAutoScaleEnabled,
    setCanvasHeightPercent,
    setChordMarkerPaddingPx,
    setChordMarkerUiScalePercent,
    setPageHorizontalPaddingPx,
    setPlayheadFollowEnabled,
    setSelectedMidiInputId,
    setShowChordDegreeEnabled,
    setShowInScoreMeasureNumbers,
    setShowNoteHeadJianpuEnabled,
    setTimeAxisSpacingConfig,
    setManualScalePercent,
    showChordDegreeEnabled,
    showInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    stopActivePlaybackSession,
    timeAxisSpacingConfig,
    toggleNotationPalette,
  ])

  const scoreBoardProps = useMemo<ScoreBoardProps>(() => ({
    scoreScrollRef,
    scoreStageRef,
    playheadRef: playheadElementRef,
    displayScoreWidth,
    displayScoreHeight,
    chordMarkerStyleMetrics,
    scoreSurfaceLogicalWidthPx: scoreWidth,
    scoreSurfaceLogicalHeightPx: scoreHeight,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    measureRulerTicks,
    chordRulerMarkers,
    onChordRulerMarkerClick,
    playheadRectPx,
    playheadStatus,
    selectedMeasureHighlightRectPx,
    draggingSelection,
    scoreRef,
    scoreOverlayRef,
    onBeginDrag: onBeginDragWithFirstMeasureDebug,
    onSurfacePointerMove,
    onEndDrag: onEndDragWithFirstMeasureDebug,
    selectedStaffLabel: activeSelection.staff === 'treble' ? '高音谱表' : '低音谱表',
    selectedPitchLabel: currentSelectionPitchLabel,
    selectedDurationLabel: toDisplayDuration(currentSelection.duration),
    selectedPosition: currentSelectionPosition,
    selectedPoolSize,
    trebleSequenceText,
    bassSequenceText,
    playheadDebugLogText,
  }), [
    activeSelection.staff,
    bassSequenceText,
    chordMarkerStyleMetrics,
    chordRulerMarkers,
    currentSelection.duration,
    currentSelectionPitchLabel,
    currentSelectionPosition,
    displayScoreHeight,
    displayScoreWidth,
    draggingSelection,
    measureRulerTicks,
    onBeginDragWithFirstMeasureDebug,
    onChordRulerMarkerClick,
    onEndDragWithFirstMeasureDebug,
    onSurfacePointerMove,
    playheadDebugLogText,
    playheadElementRef,
    playheadRectPx,
    playheadStatus,
    scoreHeight,
    scoreOverlayRef,
    scoreRef,
    scoreScrollRef,
    scoreScaleX,
    scoreScaleY,
    scoreStageRef,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    scoreWidth,
    selectedPoolSize,
    selectedMeasureHighlightRectPx,
    trebleSequenceText,
  ])

  return {
    scoreControlsProps,
    scoreBoardProps,
  }
}
