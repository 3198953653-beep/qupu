import {
  useMemo,
  type ComponentProps,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { DEFAULT_TIME_AXIS_SPACING_CONFIG, type TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
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
  type ChordMarkerStyleMetrics,
} from '../scorePresentation'
import { ScoreBoard } from '../components/ScoreBoard'
import { ScoreControls } from '../components/ScoreControls'
import type {
  BuiltInDemoMode,
  ImportFeedback,
  PlaybackCursorRect,
  RhythmPresetId,
  ScoreNote,
  Selection,
} from '../types'
import type { NotationPaletteSelection } from '../notationPaletteConfig'

type ScoreControlsProps = ComponentProps<typeof ScoreControls>
type ScoreBoardProps = ComponentProps<typeof ScoreBoard>

export function useScoreViewProps(params: {
  isPlaying: boolean
  playScore: () => void | Promise<void>
  stopActivePlaybackSession: () => void
  resetScoreWithCollapseReset: () => void
  playheadFollowEnabled: boolean
  setPlayheadFollowEnabled: Dispatch<SetStateAction<boolean>>
  showChordDegreeEnabled: boolean
  setShowChordDegreeEnabled: Dispatch<SetStateAction<boolean>>
  showInScoreMeasureNumbers: boolean
  setShowInScoreMeasureNumbers: Dispatch<SetStateAction<boolean>>
  showNoteHeadJianpuEnabled: boolean
  setShowNoteHeadJianpuEnabled: Dispatch<SetStateAction<boolean>>
  autoScaleEnabled: boolean
  autoScalePercent: number
  setAutoScaleEnabled: Dispatch<SetStateAction<boolean>>
  safeManualScalePercent: number
  setManualScalePercent: Dispatch<SetStateAction<number>>
  safeCanvasHeightPercent: number
  setCanvasHeightPercent: Dispatch<SetStateAction<number>>
  pageHorizontalPaddingPx: number
  setPageHorizontalPaddingPx: Dispatch<SetStateAction<number>>
  safeChordMarkerUiScalePercent: number
  setChordMarkerUiScalePercent: Dispatch<SetStateAction<number>>
  safeChordMarkerPaddingPx: number
  setChordMarkerPaddingPx: Dispatch<SetStateAction<number>>
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  setTimeAxisSpacingConfig: Dispatch<SetStateAction<TimeAxisSpacingConfig>>
  openMusicXmlFilePicker: () => void
  loadSampleMusicXmlWithCollapseReset: () => void
  loadWholeNoteDemoWithCollapseReset: () => void
  loadHalfNoteDemoWithCollapseReset: () => void
  exportMusicXmlFile: () => void
  openOsmdPreview: () => void
  openBeamGroupingTool: () => void
  isNotationPaletteOpen: boolean
  toggleNotationPalette: () => void
  closeNotationPalette: () => void
  notationPaletteSelection: NotationPaletteSelection
  notationPaletteLastAction: string
  derivedNotationPaletteDisplay: {
    activeItemIds?: ReadonlySet<string> | null
    summary?: string | null
  } | null
  onNotationPaletteSelectionChange: ScoreControlsProps['onNotationPaletteSelectionChange']
  openDirectOsmdFilePicker: () => void
  importMusicXmlFromTextareaWithCollapseReset: () => void
  midiSupported: boolean
  midiPermissionState: ScoreControlsProps['midiPermissionState']
  midiInputOptions: ScoreControlsProps['midiInputOptions']
  selectedMidiInputId: string
  setSelectedMidiInputId: (id: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  osmdDirectFileInputRef: RefObject<HTMLInputElement | null>
  onMusicXmlFileChangeWithCollapseReset: ScoreControlsProps['onMusicXmlFileChange']
  onOsmdDirectFileChange: ScoreControlsProps['onOsmdDirectFileChange']
  importFeedback: ImportFeedback
  rhythmPreset: RhythmPresetId
  activeBuiltInDemo: BuiltInDemoMode
  applyRhythmPresetWithCollapseReset: (presetId: RhythmPresetId) => void
  scoreScrollRef: RefObject<HTMLDivElement | null>
  scoreStageRef: RefObject<HTMLDivElement | null>
  playheadElementRef: RefObject<HTMLDivElement | null>
  displayScoreWidth: number
  displayScoreHeight: number
  chordMarkerStyleMetrics: ChordMarkerStyleMetrics
  scoreWidth: number
  scoreHeight: number
  scoreScaleX: number
  scoreScaleY: number
  scoreSurfaceOffsetXPx: number
  scoreSurfaceOffsetYPx: number
  measureRulerTicks: ScoreBoardProps['measureRulerTicks']
  chordRulerMarkers: ScoreBoardProps['chordRulerMarkers']
  onChordRulerMarkerClick: (markerKey: string) => void
  playheadRectPx: PlaybackCursorRect | null
  playheadStatus: ScoreBoardProps['playheadStatus']
  selectedMeasureHighlightRectPx: ScoreBoardProps['selectedMeasureHighlightRectPx']
  draggingSelection: Selection | null
  scoreRef: RefObject<HTMLCanvasElement | null>
  scoreOverlayRef: RefObject<HTMLCanvasElement | null>
  onBeginDragWithFirstMeasureDebug: ScoreBoardProps['onBeginDrag']
  onSurfacePointerMove: ScoreBoardProps['onSurfacePointerMove']
  onEndDragWithFirstMeasureDebug: ScoreBoardProps['onEndDrag']
  activeSelection: Selection
  currentSelection: ScoreNote
  currentSelectionPitchLabel: string
  currentSelectionPosition: number
  selectedPoolSize: number
  trebleSequenceText: string
  bassSequenceText: string
  playheadDebugLogText: string
}): {
  scoreControlsProps: ScoreControlsProps
  scoreBoardProps: ScoreBoardProps
} {
  const {
    isPlaying,
    playScore,
    stopActivePlaybackSession,
    resetScoreWithCollapseReset,
    playheadFollowEnabled,
    setPlayheadFollowEnabled,
    showChordDegreeEnabled,
    setShowChordDegreeEnabled,
    showInScoreMeasureNumbers,
    setShowInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
    autoScaleEnabled,
    autoScalePercent,
    setAutoScaleEnabled,
    safeManualScalePercent,
    setManualScalePercent,
    safeCanvasHeightPercent,
    setCanvasHeightPercent,
    pageHorizontalPaddingPx,
    setPageHorizontalPaddingPx,
    safeChordMarkerUiScalePercent,
    setChordMarkerUiScalePercent,
    safeChordMarkerPaddingPx,
    setChordMarkerPaddingPx,
    timeAxisSpacingConfig,
    setTimeAxisSpacingConfig,
    openMusicXmlFilePicker,
    loadSampleMusicXmlWithCollapseReset,
    loadWholeNoteDemoWithCollapseReset,
    loadHalfNoteDemoWithCollapseReset,
    exportMusicXmlFile,
    openOsmdPreview,
    openBeamGroupingTool,
    isNotationPaletteOpen,
    toggleNotationPalette,
    closeNotationPalette,
    notationPaletteSelection,
    notationPaletteLastAction,
    derivedNotationPaletteDisplay,
    onNotationPaletteSelectionChange,
    openDirectOsmdFilePicker,
    importMusicXmlFromTextareaWithCollapseReset,
    midiSupported,
    midiPermissionState,
    midiInputOptions,
    selectedMidiInputId,
    setSelectedMidiInputId,
    fileInputRef,
    osmdDirectFileInputRef,
    onMusicXmlFileChangeWithCollapseReset,
    onOsmdDirectFileChange,
    importFeedback,
    rhythmPreset,
    activeBuiltInDemo,
    applyRhythmPresetWithCollapseReset,
    scoreScrollRef,
    scoreStageRef,
    playheadElementRef,
    displayScoreWidth,
    displayScoreHeight,
    chordMarkerStyleMetrics,
    scoreWidth,
    scoreHeight,
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
    onBeginDragWithFirstMeasureDebug,
    onSurfacePointerMove,
    onEndDragWithFirstMeasureDebug,
    activeSelection,
    currentSelection,
    currentSelectionPitchLabel,
    currentSelectionPosition,
    selectedPoolSize,
    trebleSequenceText,
    bassSequenceText,
    playheadDebugLogText,
  } = params

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
