import { useCallback } from 'react'
import './App.css'
import {
  INITIAL_NOTES,
  PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
  PREVIEW_START_THRESHOLD_PX,
} from './score/constants'
import { usePlaybackController } from './score/hooks/usePlaybackController'
import { useScoreAudioPreviewController } from './score/hooks/useScoreAudioPreviewController'
import { useChordMarkerController } from './score/hooks/useChordMarkerController'
import { useScoreMutationController } from './score/hooks/useScoreMutationController'
import { useScoreViewProps } from './score/hooks/useScoreViewProps'
import { useHorizontalScoreLayout } from './score/hooks/useHorizontalScoreLayout'
import { useScoreSurfaceController } from './score/hooks/useScoreSurfaceController'
import { useScoreDocumentActionsController } from './score/hooks/useScoreDocumentActionsController'
import { useScoreEditorUiController } from './score/hooks/useScoreEditorUiController'
import { useScorePlaybackDebugController } from './score/hooks/useScorePlaybackDebugController'
import { useScoreAppState } from './score/hooks/useScoreAppState'
import { useScoreEditorRefs } from './score/hooks/useScoreEditorRefs'
import { ScoreControls } from './score/components/ScoreControls'
import { ScoreBoard } from './score/components/ScoreBoard'
import {
  createPianoPitches,
} from './score/pitchUtils'
import {
  buildBassMockNotes,
} from './score/scoreOps'
import { isStaffFullMeasureRest, resolvePairTimeSignature } from './score/measureRestUtils'
import { mergeFullMeasureRestCollapseScopeKeys, toMeasureStaffScopeKey } from './score/fullMeasureRestCollapse'
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

function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}
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
  const {
    notes,
    setNotes,
    bassNotes,
    setBassNotes,
    rhythmPreset,
    setRhythmPreset,
    activeBuiltInDemo,
    setActiveBuiltInDemo,
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
    setFullMeasureRestCollapseScopeKeys,
    isSelectionVisible,
    setIsSelectionVisible,
    draggingSelection,
    setDraggingSelection,
    dragPreviewState,
    setDragPreviewState,
    isPlaying,
    setIsPlaying,
    musicXmlInput,
    setMusicXmlInput,
    importFeedback,
    setImportFeedback,
    isNotationPaletteOpen,
    setIsNotationPaletteOpen,
    notationPaletteSelection,
    setNotationPaletteSelection,
    notationPaletteLastAction,
    setNotationPaletteLastAction,
    isRhythmLinked,
    setIsRhythmLinked,
    measurePairsFromImport,
    setMeasurePairsFromImport,
    measureKeyFifthsFromImport,
    setMeasureKeyFifthsFromImport,
    measureKeyModesFromImport,
    setMeasureKeyModesFromImport,
    measureDivisionsFromImport,
    setMeasureDivisionsFromImport,
    measureTimeSignaturesFromImport,
    setMeasureTimeSignaturesFromImport,
    musicXmlMetadataFromImport,
    setMusicXmlMetadataFromImport,
    importedChordRulerEntriesByPairFromImport,
    setImportedChordRulerEntriesByPairFromImport,
    setDragDebugReport,
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
    setHorizontalViewportXRange,
  } = useScoreAppState(INITIAL_BASS_NOTES)

  const {
    scoreRef,
    scoreOverlayRef,
    scoreScrollRef,
    scoreStageRef,
    fileInputRef,
    synthRef,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    hitGridRef,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    measurePairsRef,
    dragDebugFramesRef,
    dragRef,
    dragPreviewFrameRef,
    dragRafRef,
    dragPendingRef,
    rendererRef,
    rendererSizeRef,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    measurePairsFromImportRef,
    measureKeyFifthsFromImportRef,
    measureKeyModesFromImportRef,
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
    clearDragOverlayRef,
    layoutReflowHintRef,
    midiStepChainRef,
    midiStepLastSelectionRef,
    isOsmdPreviewOpenRef,
  } = useScoreEditorRefs({
    importFeedback,
    activeSelection,
    selectedSelections,
    fullMeasureRestCollapseScopeKeys,
    isSelectionVisible,
    draggingSelection,
  })
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
  const clearActiveAccidentalSelection = useCallback(() => {
    setActiveAccidentalSelection(null)
  }, [])
  const clearActiveTieSelection = useCallback(() => {
    setActiveTieSelection(null)
  }, [])
  const clearSelectedMeasureScope = useCallback(() => {
    setSelectedMeasureScope(null)
  }, [])
  const clearDraggingSelection = useCallback(() => {
    setDraggingSelection(null)
  }, [])
  const clearDragPreviewState = useCallback(() => {
    setDragPreviewState(null)
  }, [])
  const clearImportedChordRulerEntries = useCallback(() => {
    setImportedChordRulerEntriesByPairFromImport(null)
  }, [])
  const resetMidiStepChain = useCallback(() => {
    midiStepChainRef.current = false
    midiStepLastSelectionRef.current = null
  }, [])
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
  } = useChordMarkerController({
    measurePairs,
    measurePairsRef,
    chordRulerEntriesByPair,
    horizontalMeasureFramesByPair,
    measureTimeSignaturesFromImport,
    measureKeyFifthsFromImport,
    measureKeyModesFromImport,
    horizontalRenderOffsetX,
    horizontalRenderOffsetXRef,
    noteLayoutsByPairRef,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    selectedMeasureScope,
    showChordDegreeEnabled,
    chordMarkerLabelLeftInsetPx: chordMarkerStyleMetrics.labelLeftInsetPx,
    stageBorderPx: SCORE_STAGE_BORDER_PX,
    chordHighlightPadXPx: CHORD_HIGHLIGHT_PAD_X_PX,
    chordHighlightPadYPx: CHORD_HIGHLIGHT_PAD_Y_PX,
    layoutStabilityKey,
    getMeasureFrameContentGeometry,
    setIsSelectionVisible,
    setSelectedSelections,
    setActiveSelection,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    clearDraggingSelection,
    resetMidiStepChain,
  })
  const {
    pushUndoSnapshot,
    undoLastScoreEdit,
    applyKeyboardEditResult,
    applyMidiReplacementByNoteNumber,
  } = useScoreMutationController({
    measurePairsRef,
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImport,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImport,
    importedNoteLookupRef,
    selectedSelectionsRef,
    activeSelectionRef,
    isSelectionVisibleRef,
    fullMeasureRestCollapseScopeKeysRef,
    midiStepChainRef,
    midiStepLastSelectionRef,
    dragRef,
    draggingSelectionRef,
    isOsmdPreviewOpenRef,
    clearDragOverlayRef,
    clearDragPreviewState,
    clearDraggingSelection,
    resetMidiStepChain,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    clearActiveChordSelection,
    setMeasurePairsFromImport,
    clearImportedChordRulerEntries,
    setNotes,
    setBassNotes,
    setIsSelectionVisible,
    setFullMeasureRestCollapseScopeKeys,
    setActiveSelection,
    setSelectedSelections,
    setIsRhythmLinked,
    setMeasureKeyFifthsFromImport,
    setMeasureDivisionsFromImport,
    setMeasureTimeSignaturesFromImport,
  })
  const {
    playbackCursorPoint,
    playbackCursorColor,
    playbackSessionId,
    playheadStatus,
    playheadElementRef,
    playheadDebugLogText,
    playbackCursorEventsRef,
    playheadDebugLogRowsRef,
    latestPlayheadDebugSnapshotRef,
    playheadDebugSequenceRef,
    measurePlayheadDebugLogRow,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
    handlePlaybackStart,
    handlePlaybackPoint,
    handlePlaybackComplete,
  } = usePlaybackController({
    synthRef,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    setIsPlaying,
    firstPlaybackPoint,
    scoreScrollRef,
    getPlayheadRectPx: () => playheadRectPx,
    playheadGeometryRevision: `${layoutStabilityKey}:${chordMarkerLayoutRevision}`,
    playheadFollowEnabled,
  })

  const {
    clearDragOverlay,
    onSurfacePointerMove,
    endDrag,
    beginDrag,
  } = useScoreSurfaceController({
    scoreScrollRef,
    setHorizontalViewportXRange,
    scoreScaleX,
    totalScoreWidth,
    displayScoreWidth,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
    timeAxisSpacingConfig,
    clearDragOverlayRef,
    importedRefsSync: {
      measurePairsFromImport,
      measurePairsFromImportRef,
      measureKeyFifthsFromImport,
      measureKeyFifthsFromImportRef,
      measureKeyModesFromImport,
      measureKeyModesFromImportRef,
      measureDivisionsFromImport,
      measureDivisionsFromImportRef,
      measureTimeSignaturesFromImport,
      measureTimeSignaturesFromImportRef,
      musicXmlMetadataFromImport,
      musicXmlMetadataFromImportRef,
      measurePairs,
      measurePairsRef,
    },
    rhythmLinkedBassSync: {
      notes,
      isRhythmLinked,
      setBassNotes,
    },
    scoreRender: {
      scoreRef,
      rendererRef,
      rendererSizeRef,
      scoreWidth,
      scoreHeight,
      measurePairs,
      systemRanges,
      visibleSystemRange,
      renderOriginSystemIndex: visibleSystemRange.start,
      visiblePairRange: {
        startPairIndex: horizontalRenderWindow.startPairIndex,
        endPairIndexExclusive: horizontalRenderWindow.endPairIndexExclusive,
      },
      clearViewportXRange: null,
      measureFramesByPair: horizontalMeasureFramesByPair,
      renderOffsetX: horizontalRenderOffsetX,
      measureKeyFifthsFromImport,
      measureTimeSignaturesFromImport,
      supplementalSpacingTicksByPair,
      activeSelection: isSelectionVisible ? activeSelection : null,
      activeAccidentalSelection,
      activeTieSegmentKey: activeTieSelection?.key ?? null,
      draggingSelection,
      activeSelections: isSelectionVisible ? selectedSelections : [],
      draggingSelections: draggingSelection ? [draggingSelection] : [],
      selectedMeasureScope,
      fullMeasureRestCollapseScopeKeys,
      layoutReflowHintRef,
      layoutStabilityKey,
      noteLayoutsRef,
      noteLayoutsByPairRef,
      noteLayoutByKeyRef,
      hitGridRef,
      measureLayoutsRef,
      measureTimelineBundlesRef,
      backend: SCORE_RENDER_BACKEND,
      pagePaddingX: pageHorizontalPaddingPx,
      timeAxisSpacingConfig,
      spacingLayoutMode,
      showInScoreMeasureNumbers,
      showNoteHeadJianpuEnabled,
      renderScaleX: scoreScaleX,
      renderScaleY: scoreScaleY,
      renderQualityScaleX: renderQualityScale.x,
      renderQualityScaleY: renderQualityScale.y,
      dragPreview: draggingSelection ? dragPreviewState : null,
      onAfterRender: onAfterScoreRender,
    },
    synthLifecycle: {
      synthRef,
    },
    rendererCleanup: {
      dragRafRef,
      dragPendingRef,
      rendererRef,
      rendererSizeRef,
      overlayRendererRef,
      overlayRendererSizeRef,
      overlayLastRectRef,
    },
    dragHandlers: {
      scoreRef,
      scoreOverlayRef,
      noteLayoutsRef,
      noteLayoutsByPairRef,
      noteLayoutByKeyRef,
      hitGridRef,
      measureLayoutsRef,
      measureTimelineBundlesRef,
      measurePairsRef,
      dragDebugFramesRef,
      dragRef,
      dragPreviewFrameRef,
      dragRafRef,
      dragPendingRef,
      overlayRendererRef,
      overlayRendererSizeRef,
      overlayLastRectRef,
      setDragDebugReport,
      setLayoutReflowHint: (hint) => {
        const decoratedHint = hint ? { ...hint, layoutStabilityKey } : null
        layoutReflowHintRef.current = decoratedHint
      },
      setMeasurePairsFromImport,
      setNotes,
      setBassNotes,
      setDragPreviewState,
      setActiveSelection,
      setDraggingSelection,
      currentSelections: selectedSelections,
      onSelectionPointerDown: (_selection, nextSelections, _mode) => {
        void _selection
        void _mode
        resetMidiStepChain()
        setActiveAccidentalSelection(null)
        setActiveTieSelection(null)
        setSelectedMeasureScope(null)
        clearActiveChordSelection()
        const nextTargetSelections = nextSelections
        setSelectedSelections((current) => {
          if (
            current.length === nextTargetSelections.length &&
            current.every((entry, index) => isSameSelection(entry, nextTargetSelections[index]))
          ) {
            return current
          }
          return nextTargetSelections
        })
      },
      onSelectionTapRelease: (selection) => {
        resetMidiStepChain()
        setActiveAccidentalSelection(null)
        setActiveTieSelection(null)
        setSelectedMeasureScope(null)
        clearActiveChordSelection()
        setSelectedSelections([selection])
        setActiveSelection(selection)
        setIsSelectionVisible(true)
      },
      onAccidentalPointerDown: (selection) => {
        resetMidiStepChain()
        setActiveAccidentalSelection(selection)
        setActiveTieSelection(null)
        setSelectedMeasureScope(null)
        clearActiveChordSelection()
        setDraggingSelection(null)
        setSelectedSelections([])
        setIsSelectionVisible(false)
      },
      onTiePointerDown: (selection) => {
        resetMidiStepChain()
        setActiveTieSelection(selection)
        setActiveAccidentalSelection(null)
        setSelectedMeasureScope(null)
        clearActiveChordSelection()
        setDraggingSelection(null)
        setSelectedSelections([])
        setIsSelectionVisible(false)
      },
      onBeforeApplyScoreChange: (sourcePairs) => {
        pushUndoSnapshot(sourcePairs)
      },
      onAfterApplyScoreChange: ({ sourcePairs, nextPairs }) => {
        setFullMeasureRestCollapseScopeKeys((current) =>
          mergeFullMeasureRestCollapseScopeKeys({
            currentScopeKeys: current,
            sourcePairs,
            nextPairs,
          }),
        )
      },
      onBlankPointerDown: ({ pairIndex, staff }) => {
        resetMidiStepChain()
        setActiveAccidentalSelection(null)
        setActiveTieSelection(null)
        clearActiveChordSelection()
        if (pairIndex === null || staff === null) {
          setIsSelectionVisible(false)
          setSelectedSelections([])
          setSelectedMeasureScope(null)
          return
        }
        const targetPair = measurePairsRef.current[pairIndex]
        if (!targetPair) {
          setIsSelectionVisible(false)
          setSelectedSelections([])
          setSelectedMeasureScope(null)
          return
        }
        const timeSignature = resolvePairTimeSignature(pairIndex, measureTimeSignaturesFromImportRef.current)
        const canCollapseFullMeasureRest = fullMeasureRestCollapseScopeKeys.includes(
          toMeasureStaffScopeKey({ pairIndex, staff }),
        )
        const nextSelections = buildSelectionsForMeasureStaff(targetPair, staff, {
          collapseFullMeasureRest: canCollapseFullMeasureRest,
          timeSignature,
        })
        if (nextSelections.length === 0) {
          setIsSelectionVisible(false)
          setSelectedSelections([])
          setSelectedMeasureScope(null)
          return
        }
        setIsSelectionVisible(true)
        setSelectedSelections(nextSelections)
        setActiveSelection(nextSelections[0])
        setSelectedMeasureScope({ pairIndex, staff })
      },
      onSelectionActivated: () => {
        resetMidiStepChain()
        setActiveAccidentalSelection(null)
        setActiveTieSelection(null)
        clearActiveChordSelection()
        setIsSelectionVisible(true)
      },
      onPreviewScoreNote: handlePreviewScoreNote,
      measurePairsFromImportRef,
      importedNoteLookupRef,
      measureKeyFifthsFromImportRef,
      trebleNoteById,
      bassNoteById,
      pitches: PITCHES,
      previewDefaultAccidentalOffsetPx: PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
      previewStartThresholdPx: PREVIEW_START_THRESHOLD_PX,
      backend: SCORE_RENDER_BACKEND,
      scoreScaleX,
      scoreScaleY,
      renderQualityScaleX: renderQualityScale.x,
      renderQualityScaleY: renderQualityScale.y,
      viewportXRange: horizontalViewportXRange,
      renderOffsetX: horizontalRenderOffsetX,
      timeAxisSpacingConfig,
      spacingLayoutMode,
      showNoteHeadJianpu: showNoteHeadJianpuEnabled,
    },
  })

  const {
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
  } = useScoreDocumentActionsController({
    editorHandlers: {
      synthRef,
      notes,
      playbackTimelineEvents,
      stopPlayTimerRef,
      playbackPointTimerIdsRef,
      playbackSessionIdRef,
      setIsPlaying,
      onPlaybackStart: handlePlaybackStart,
      onPlaybackPoint: handlePlaybackPoint,
      onPlaybackComplete: handlePlaybackComplete,
      onImportedScoreApplied: requestPlaybackCursorReset,
      setNotes,
      setBassNotes,
      setMeasurePairsFromImport,
      measurePairsFromImportRef,
      setMeasureKeyFifthsFromImport,
      measureKeyFifthsFromImportRef,
      setMeasureKeyModesFromImport,
      measureKeyModesFromImportRef,
      setMeasureDivisionsFromImport,
      measureDivisionsFromImportRef,
      setMeasureTimeSignaturesFromImport,
      measureTimeSignaturesFromImportRef,
      setMusicXmlMetadataFromImport,
      musicXmlMetadataFromImportRef,
      setImportedChordRulerEntriesByPairFromImport,
      importedNoteLookupRef,
      dragRef,
      clearDragOverlay,
      setDraggingSelection,
      setActiveSelection,
      setIsRhythmLinked,
      setImportFeedback,
      musicXmlInput,
      setMusicXmlInput,
      fileInputRef,
      measurePairs,
      setRhythmPreset,
      pitches: PITCHES,
      initialTrebleNotes: INITIAL_NOTES,
      initialBassNotes: INITIAL_BASS_NOTES,
    },
    editorActionWrappersBase: {
      stopActivePlaybackSession,
      requestPlaybackCursorReset,
      clearActiveChordSelection,
      setActiveBuiltInDemo,
      setFullMeasureRestCollapseScopeKeys,
    },
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    synthRef,
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
    playheadRectPx,
    onBeginDragWithFirstMeasureDebug,
    onEndDragWithFirstMeasureDebug,
  } = useScorePlaybackDebugController({
    playbackCursorLayout: {
      playbackCursorPoint,
      playbackCursorColor,
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
      playbackCursorEventsRef,
      playbackSessionId,
      playheadStatus,
      playheadDebugLogRowsRef,
      playheadDebugSequenceRef,
      latestPlayheadDebugSnapshotRef,
      measurePlayheadDebugLogRow,
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


