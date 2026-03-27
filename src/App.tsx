import './App.css'
import {
  INITIAL_NOTES,
  PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
  PREVIEW_START_THRESHOLD_PX,
} from './score/constants'
import { useScoreAudioPreviewController } from './score/hooks/useScoreAudioPreviewController'
import { useScoreViewProps } from './score/hooks/useScoreViewProps'
import { useHorizontalScoreLayout } from './score/hooks/useHorizontalScoreLayout'
import { useScoreEditorUiController } from './score/hooks/useScoreEditorUiController'
import { useScoreAppState } from './score/hooks/useScoreAppState'
import { useScoreEditorRefs } from './score/hooks/useScoreEditorRefs'
import { useScoreWorkspaceController } from './score/hooks/useScoreWorkspaceController'
import { useScoreCoreEditingController } from './score/hooks/useScoreCoreEditingController'
import { useScorePlaybackRuntimeController } from './score/hooks/useScorePlaybackRuntimeController'
import { ScoreControls } from './score/components/ScoreControls'
import { ScoreBoard } from './score/components/ScoreBoard'
import {
  createPianoPitches,
} from './score/pitchUtils'
import {
  buildBassMockNotes,
} from './score/scoreOps'
import { isStaffFullMeasureRest } from './score/measureRestUtils'
import { ImportProgressModal } from './score/components/ImportProgressModal'
import { OsmdPreviewModal } from './score/components/OsmdPreviewModal'
import type {
  MeasurePair,
  Pitch,
  ScoreNote,
  Selection,
  TimeSignature,
} from './score/types'
import { Renderer } from 'vexflow'

const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const SCORE_STAGE_BORDER_PX = 1
const CHORD_HIGHLIGHT_PAD_X_PX = 4
const CHORD_HIGHLIGHT_PAD_Y_PX = 4

const PITCHES: Pitch[] = createPianoPitches()
const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)
function buildSelectionsForMeasureStaff(
  pair: MeasurePair,
  staff: Selection['staff'],
  options?: {
    collapseFullMeasureRest?: boolean
    timeSignature?: TimeSignature | null
  },
): Selection[] {
  const notes = staff === 'treble' ? pair.treble : pair.bass
  if (
    options?.collapseFullMeasureRest &&
    options.timeSignature &&
    isStaffFullMeasureRest(notes, options.timeSignature) &&
    notes[0]
  ) {
    return [{ noteId: notes[0].id, staff, keyIndex: 0 }]
  }
  const selections: Selection[] = []
  notes.forEach((note) => {
    const keyCount = 1 + (note.chordPitches?.length ?? 0)
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
      selections.push({ noteId: note.id, staff, keyIndex })
    }
  })
  return selections
}

function App() {
  const appState = useScoreAppState(INITIAL_BASS_NOTES)
  const {
    notes,
    setNotes,
    bassNotes,
    setBassNotes,
    rhythmPreset,
    activeBuiltInDemo,
    activeSelection,
    setActiveSelection,
    activeAccidentalSelection,
    setActiveAccidentalSelection,
    activeTieSelection,
    setActiveTieSelection,
    selectedSelections,
    setSelectedSelections,
    selectedMeasureScope,
    setSelectedMeasureScope,
    fullMeasureRestCollapseScopeKeys,
    isSelectionVisible,
    setIsSelectionVisible,
    draggingSelection,
    setDraggingSelection,
    isPlaying,
    setIsPlaying,
    importFeedback,
    setImportFeedback,
    isNotationPaletteOpen,
    setIsNotationPaletteOpen,
    notationPaletteSelection,
    setNotationPaletteSelection,
    notationPaletteLastAction,
    setNotationPaletteLastAction,
    measurePairsFromImport,
    setMeasurePairsFromImport,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    importedChordRulerEntriesByPairFromImport,
    autoScaleEnabled,
    setAutoScaleEnabled,
    manualScalePercent,
    setManualScalePercent,
    canvasHeightPercent,
    setCanvasHeightPercent,
    playheadFollowEnabled,
    setPlayheadFollowEnabled,
    showChordDegreeEnabled,
    setShowChordDegreeEnabled,
    showInScoreMeasureNumbers,
    setShowInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
    pageHorizontalPaddingPx,
    setPageHorizontalPaddingPx,
    chordMarkerUiScalePercent,
    setChordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    setChordMarkerPaddingPx,
    timeAxisSpacingConfig,
    setTimeAxisSpacingConfig,
    horizontalViewportXRange,
  } = appState

  const editorRefs = useScoreEditorRefs({
    importFeedback,
    activeSelection,
    selectedSelections,
    fullMeasureRestCollapseScopeKeys,
    isSelectionVisible,
    draggingSelection,
  })
  const {
    scoreRef,
    scoreOverlayRef,
    scoreScrollRef,
    scoreStageRef,
    fileInputRef,
    synthRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    measurePairsRef,
    dragDebugFramesRef,
    dragRef,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
    overlayLastRectRef,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    measurePairsFromImportRef,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    importFeedbackRef,
    activeSelectionRef,
    selectedSelectionsRef,
    fullMeasureRestCollapseScopeKeysRef,
    isSelectionVisibleRef,
    draggingSelectionRef,
    layoutReflowHintRef,
    isOsmdPreviewOpenRef,
  } = editorRefs
  const { notePreviewEventsRef, handlePreviewScoreNote, playAccidentalEditPreview } =
    useScoreAudioPreviewController({
      synthRef,
    })
  const {
    measurePairs,
    chordRulerEntriesByPair,
    supplementalSpacingTicksByPair,
    playbackTimelineEvents,
    playbackTimelineEventByPointKey,
    firstPlaybackPoint,
    spacingLayoutMode,
    safeChordMarkerUiScalePercent,
    safeChordMarkerPaddingPx,
    safeManualScalePercent,
    safeCanvasHeightPercent,
    chordMarkerStyleMetrics,
    autoScalePercent,
    baseScoreScale,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    displayScoreWidth,
    displayScoreHeight,
    scoreWidth,
    scoreHeight,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    totalScoreWidth,
    trebleNoteById,
    bassNoteById,
    trebleNoteIndexById,
    bassNoteIndexById,
    horizontalMeasureFramesByPair,
    getMeasureFrameContentGeometry,
    systemRanges,
    renderQualityScale,
    systemsPerPage,
    pageCount,
    safeCurrentPage,
    visibleSystemRange,
    horizontalRenderOffsetX,
    horizontalRenderWindow,
    layoutStabilityKey,
  } = useHorizontalScoreLayout({
    notes,
    bassNotes,
    measurePairsFromImport,
    importedChordRulerEntriesByPairFromImport,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    autoScaleEnabled,
    manualScalePercent,
    canvasHeightPercent,
    pageHorizontalPaddingPx,
    chordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    timeAxisSpacingConfig,
    horizontalViewportXRange,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
    horizontalRenderOffsetXRef,
  })
  const {
    sessionHelpers,
    chordMarker,
    mutation,
  } = useScoreCoreEditingController({
    appState,
    editorRefs,
    layout: {
      measurePairs,
      chordRulerEntriesByPair,
      horizontalMeasureFramesByPair,
      horizontalRenderOffsetX,
      scoreScaleX,
      scoreScaleY,
      scoreSurfaceOffsetXPx,
      scoreSurfaceOffsetYPx,
      layoutStabilityKey,
      getMeasureFrameContentGeometry,
    },
    chordMarkerLabelLeftInsetPx: chordMarkerStyleMetrics.labelLeftInsetPx,
    stageBorderPx: SCORE_STAGE_BORDER_PX,
    chordHighlightPadXPx: CHORD_HIGHLIGHT_PAD_X_PX,
    chordHighlightPadYPx: CHORD_HIGHLIGHT_PAD_Y_PX,
  })
  const {
    resetMidiStepChain,
  } = sessionHelpers
  const {
    chordMarkerLayoutRevision,
    activeChordSelection,
    clearActiveChordSelection,
    onAfterScoreRender,
    measureRulerTicks,
    chordRulerMarkerMetaByKey,
    chordRulerMarkers,
    applyChordSelectionRange,
    onChordRulerMarkerClick,
    selectedMeasureHighlightRectPx,
  } = chordMarker
  const {
    pushUndoSnapshot,
    undoLastScoreEdit,
    applyKeyboardEditResult,
    applyMidiReplacementByNoteNumber,
  } = mutation

  const {
    onSurfacePointerMove,
    endDrag,
    beginDrag,
    playScore,
    openMusicXmlFilePicker,
    exportMusicXmlFile,
    importMusicXmlTextWithCollapseReset,
    importMusicXmlFromTextareaWithCollapseReset,
    onMusicXmlFileChangeWithCollapseReset,
    loadSampleMusicXmlWithCollapseReset,
    loadWholeNoteDemoWithCollapseReset,
    loadHalfNoteDemoWithCollapseReset,
    resetScoreWithCollapseReset,
    applyRhythmPresetWithCollapseReset,
  } = useScoreWorkspaceController({
    appState,
    editorRefs,
    sessionHelpers,
    measurePairs,
    playbackTimelineEvents,
    layout: {
      totalScoreWidth,
      displayScoreWidth,
      scoreScaleX,
      scoreScaleY,
      scoreWidth,
      scoreHeight,
      systemRanges,
      visibleSystemRange,
      horizontalRenderOffsetX,
      horizontalRenderWindow,
      horizontalMeasureFramesByPair,
      layoutStabilityKey,
      renderQualityScale,
      supplementalSpacingTicksByPair,
      spacingLayoutMode,
      trebleNoteById,
      bassNoteById,
    },
    onAfterScoreRender,
    clearActiveChordSelection,
    pushUndoSnapshot,
    handlePreviewScoreNote,
    handlePlaybackStart: (params) => {
      handlePlaybackStart(params)
    },
    handlePlaybackPoint: (params) => {
      handlePlaybackPoint(params)
    },
    handlePlaybackComplete: (params) => {
      handlePlaybackComplete(params)
    },
    requestPlaybackCursorReset: () => {
      requestPlaybackCursorReset()
    },
    stopActivePlaybackSession: () => {
      stopActivePlaybackSession()
    },
    buildSelectionsForMeasureStaff,
    initialTrebleNotes: INITIAL_NOTES,
    initialBassNotes: INITIAL_BASS_NOTES,
    pitches: PITCHES,
    backend: SCORE_RENDER_BACKEND,
    previewDefaultAccidentalOffsetPx: PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
    previewStartThresholdPx: PREVIEW_START_THRESHOLD_PX,
  })

  const {
    trebleSequenceText,
    bassSequenceText,
    isImportLoading,
    importProgressPercent,
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
    isOsmdPreviewOpen,
    isOsmdPreviewExportingPdf,
    osmdPreviewStatusText,
    osmdPreviewError,
    osmdPreviewPageIndex,
    osmdPreviewPageCount,
    osmdPreviewShowPageNumbers,
    osmdPreviewZoomDraftPercent,
    safeOsmdPreviewPaperScalePercent,
    safeOsmdPreviewHorizontalMarginPx,
    safeOsmdPreviewFirstPageTopMarginPx,
    safeOsmdPreviewTopMarginPx,
    safeOsmdPreviewBottomMarginPx,
    osmdPreviewPaperScale,
    osmdPreviewPaperWidthPx,
    osmdPreviewPaperHeightPx,
    osmdPreviewContainerRef,
    osmdDirectFileInputRef,
    osmdPreviewInstanceRef,
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewNoteLookupBySelectionRef,
    osmdPreviewSelectedSelectionKeyRef,
    closeOsmdPreview,
    openOsmdPreview,
    openDirectOsmdFilePicker,
    onOsmdDirectFileChange,
    exportOsmdPreviewPdf,
    goToPrevOsmdPreviewPage,
    goToNextOsmdPreviewPage,
    commitOsmdPreviewZoomPercent,
    scheduleOsmdPreviewZoomPercentCommit,
    onOsmdPreviewPaperScalePercentChange,
    onOsmdPreviewHorizontalMarginPxChange,
    onOsmdPreviewFirstPageTopMarginPxChange,
    onOsmdPreviewTopMarginPxChange,
    onOsmdPreviewBottomMarginPxChange,
    onOsmdPreviewShowPageNumbersChange,
    onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick,
    dumpOsmdPreviewSystemMetrics,
    openBeamGroupingTool,
    toggleNotationPalette,
    closeNotationPalette,
    onNotationPaletteSelectionChange,
  } = useScoreEditorUiController({
    notes,
    bassNotes,
    importFeedback,
    selectionController: {
      notes,
      bassNotes,
      measurePairs,
      activeSelection,
      selectedSelections,
      selectedMeasureScope,
      activeTieSelection,
      isSelectionVisible,
      draggingSelection,
      importFeedback,
      fallbackSelectionNote: INITIAL_NOTES[0],
      trebleNoteById,
      bassNoteById,
      trebleNoteIndexById,
      bassNoteIndexById,
      importedNoteLookupRef,
      activeSelectionRef,
      selectedSelectionsRef,
      fullMeasureRestCollapseScopeKeys,
      fullMeasureRestCollapseScopeKeysRef,
      isSelectionVisibleRef,
      draggingSelectionRef,
      importFeedbackRef,
      setIsSelectionVisible,
      setActiveSelection,
      setSelectedSelections,
      setSelectedMeasureScope,
      setActiveTieSelection,
    },
    editorPreferencePersistence: {
      playheadFollowEnabled,
      showChordDegreeEnabled,
      showInScoreMeasureNumbers,
      setShowInScoreMeasureNumbers,
      showNoteHeadJianpuEnabled,
      setShowNoteHeadJianpuEnabled,
    },
    midiInputController: {
      onMidiNoteNumber: applyMidiReplacementByNoteNumber,
    },
    osmdPreviewController: {
      measurePairs,
      measurePairsRef,
      measureKeyFifthsFromImportRef,
      measureDivisionsFromImportRef,
      measureTimeSignaturesFromImportRef,
      musicXmlMetadataFromImportRef,
      importedNoteLookupRef,
      horizontalMeasureFramesByPair,
      noteLayoutsByPairRef,
      noteLayoutByKeyRef,
      horizontalRenderOffsetXRef,
      scoreScrollRef,
      scoreScaleX,
      setIsSelectionVisible,
      setActiveSelection,
      setSelectedSelections,
      setDraggingSelection,
      setSelectedMeasureScope,
      clearActiveChordSelection,
      resetMidiStepChain,
    },
    isOsmdPreviewOpenRef,
    notationPaletteController: {
      activeSelection,
      selectedSelections,
      isSelectionVisible,
      measurePairsRef,
      measurePairsFromImportRef,
      importedNoteLookupRef,
      measureKeyFifthsFromImportRef,
      measureTimeSignaturesFromImportRef,
      setImportFeedback,
      setIsNotationPaletteOpen,
      setNotationPaletteSelection,
      setNotationPaletteLastAction,
      applyKeyboardEditResult,
      playAccidentalEditPreview,
    },
    keyboardCommandController: {
      draggingSelection,
      isSelectionVisible,
      measurePairs,
      activeSelection,
      selectedSelections,
      selectedMeasureScope,
      activeTieSelection,
      activeAccidentalSelection,
      measureKeyFifthsFromImport,
      activeSelectionRef,
      measurePairsRef,
      measurePairsFromImportRef,
      importedNoteLookupRef,
      measureLayoutsRef,
      measureKeyFifthsFromImportRef,
      measureTimeSignaturesFromImportRef,
      scoreScrollRef,
      layoutReflowHintRef,
      layoutStabilityKey,
      pushUndoSnapshot,
      resetMidiStepChain,
      undoLastScoreEdit,
      applyKeyboardEditResult,
      playAccidentalEditPreview,
      setNotes,
      setBassNotes,
      setMeasurePairsFromImport,
      setIsSelectionVisible,
      setSelectedSelections,
      setSelectedMeasureScope,
      setActiveSelection,
      setActiveTieSelection,
      setActiveAccidentalSelection,
      setNotationPaletteLastAction,
    },
  })

  const {
    playheadStatus,
    playheadElementRef,
    playheadDebugLogText,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
    handlePlaybackStart,
    handlePlaybackPoint,
    handlePlaybackComplete,
    playheadRectPx,
    onBeginDragWithFirstMeasureDebug,
    onEndDragWithFirstMeasureDebug,
  } = useScorePlaybackRuntimeController({
    playbackController: {
      synthRef,
      stopPlayTimerRef,
      playbackPointTimerIdsRef,
      playbackSessionIdRef,
      setIsPlaying,
      firstPlaybackPoint,
      scoreScrollRef,
      playheadGeometryRevision: `${layoutStabilityKey}:${chordMarkerLayoutRevision}`,
      playheadFollowEnabled,
    },
    playbackDebug: {
      playbackCursorLayout: {
        playbackTimelineEventByPointKey,
        noteLayoutsByPairRef,
        measureTimelineBundlesRef,
        measureLayoutsRef,
        horizontalMeasureFramesByPair,
        getMeasureFrameContentGeometry,
        horizontalRenderOffsetX,
        layoutStabilityKey,
        chordMarkerLayoutRevision,
        scoreScaleX,
        scoreScaleY,
        scoreSurfaceOffsetYPx,
      },
      runtimeDebugController: {
        enabled: import.meta.env.DEV,
        beginDrag,
        endDrag,
        scoreScrollRef,
        measureLayoutsRef,
        noteLayoutsByPairRef,
        measureTimelineBundlesRef,
        measurePairsRef,
        dragDebugFramesRef,
        dragRef,
        scoreOverlayRef,
        scoreRef,
        overlayLastRectRef,
        importFeedbackRef,
        notePreviewEventsRef,
        applyChordSelectionRange,
        selectedSelectionsRef,
        activeChordSelection,
        selectedMeasureHighlightRectPx,
        chordRulerMarkerMetaByKey,
        playbackTimelineEvents,
        safeCurrentPage,
        pageCount,
        systemsPerPage,
        visibleSystemRange,
        activeSelection,
        osmdPreviewSelectedSelectionKeyRef,
        osmdPreviewNoteLookupBySelectionRef,
        importMusicXmlTextWithCollapseReset,
        playScore,
        autoScaleEnabled,
        setAutoScaleEnabled,
        showNoteHeadJianpuEnabled,
        setShowNoteHeadJianpuEnabled,
        safeManualScalePercent,
        setManualScalePercent,
        baseScoreScale,
        scoreScale,
        scoreScaleX,
        scoreScaleY,
        spacingLayoutMode,
        dumpOsmdPreviewSystemMetrics,
        osmdPreviewLastRebalanceStatsRef,
        osmdPreviewInstanceRef,
      },
    },
  })

  const { scoreControlsProps, scoreBoardProps } = useScoreViewProps({
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
  })

  return (
    <main className="app-shell">
      <ScoreControls {...scoreControlsProps} />

      <ScoreBoard {...scoreBoardProps} />

      <ImportProgressModal
        isOpen={isImportLoading}
        message={importFeedback.message}
        progressPercent={importProgressPercent}
      />

      <OsmdPreviewModal
        isOpen={isOsmdPreviewOpen}
        isExportingPdf={isOsmdPreviewExportingPdf}
        statusText={osmdPreviewStatusText}
        error={osmdPreviewError}
        pageIndex={osmdPreviewPageIndex}
        pageCount={osmdPreviewPageCount}
        showPageNumbers={osmdPreviewShowPageNumbers}
        zoomDraftPercent={osmdPreviewZoomDraftPercent}
        safePaperScalePercent={safeOsmdPreviewPaperScalePercent}
        safeHorizontalMarginPx={safeOsmdPreviewHorizontalMarginPx}
        safeFirstPageTopMarginPx={safeOsmdPreviewFirstPageTopMarginPx}
        safeTopMarginPx={safeOsmdPreviewTopMarginPx}
        safeBottomMarginPx={safeOsmdPreviewBottomMarginPx}
        paperScale={osmdPreviewPaperScale}
        paperWidthPx={osmdPreviewPaperWidthPx}
        paperHeightPx={osmdPreviewPaperHeightPx}
        containerRef={osmdPreviewContainerRef}
        closeOsmdPreview={closeOsmdPreview}
        exportOsmdPreviewPdf={exportOsmdPreviewPdf}
        goToPrevOsmdPreviewPage={goToPrevOsmdPreviewPage}
        goToNextOsmdPreviewPage={goToNextOsmdPreviewPage}
        commitOsmdPreviewZoomPercent={commitOsmdPreviewZoomPercent}
        scheduleOsmdPreviewZoomPercentCommit={scheduleOsmdPreviewZoomPercentCommit}
        onOsmdPreviewPaperScalePercentChange={onOsmdPreviewPaperScalePercentChange}
        onOsmdPreviewHorizontalMarginPxChange={onOsmdPreviewHorizontalMarginPxChange}
        onOsmdPreviewFirstPageTopMarginPxChange={onOsmdPreviewFirstPageTopMarginPxChange}
        onOsmdPreviewTopMarginPxChange={onOsmdPreviewTopMarginPxChange}
        onOsmdPreviewBottomMarginPxChange={onOsmdPreviewBottomMarginPxChange}
        onOsmdPreviewShowPageNumbersChange={onOsmdPreviewShowPageNumbersChange}
        onOsmdPreviewSurfaceClick={onOsmdPreviewSurfaceClick}
        onOsmdPreviewSurfaceDoubleClick={onOsmdPreviewSurfaceDoubleClick}
      />
    </main>
  )
}

export default App


