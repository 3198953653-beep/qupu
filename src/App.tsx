import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import './App.css'
import {
  A4_PAGE_WIDTH,
  INITIAL_NOTES,
  PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
  PREVIEW_START_THRESHOLD_PX,
} from './score/constants'
import {
  DEFAULT_TIME_AXIS_SPACING_CONFIG,
} from './score/layout/timeAxisSpacing'
import { useMidiInputController } from './score/hooks/useMidiInputController'
import { usePlaybackController } from './score/hooks/usePlaybackController'
import { useScoreAudioPreviewController } from './score/hooks/useScoreAudioPreviewController'
import { useChordMarkerController } from './score/hooks/useChordMarkerController'
import { useScoreMutationController } from './score/hooks/useScoreMutationController'
import { useNotationPaletteController } from './score/hooks/useNotationPaletteController'
import { useScoreSelectionController } from './score/hooks/useScoreSelectionController'
import {
  getInitialChordDegreeDisplayEnabled,
  getInitialPlayheadFollowEnabled,
  useEditorPreferencePersistence,
} from './score/hooks/useEditorPreferencePersistence'
import { useOsmdPreviewController } from './score/hooks/useOsmdPreviewController'
import { usePlaybackCursorLayout } from './score/hooks/usePlaybackCursorLayout'
import { useKeyboardCommandController } from './score/hooks/useKeyboardCommandController'
import { useScoreRuntimeDebugController } from './score/hooks/useScoreRuntimeDebugController'
import { useScoreViewProps } from './score/hooks/useScoreViewProps'
import { useHorizontalScoreLayout } from './score/hooks/useHorizontalScoreLayout'
import { useScoreSurfaceController } from './score/hooks/useScoreSurfaceController'
import { useScoreDocumentActionsController } from './score/hooks/useScoreDocumentActionsController'
import { ScoreControls } from './score/components/ScoreControls'
import { ScoreBoard } from './score/components/ScoreBoard'
import {
  createPianoPitches,
} from './score/pitchUtils'
import {
  buildBassMockNotes,
} from './score/scoreOps'
import { isStaffFullMeasureRest, resolvePairTimeSignature } from './score/measureRestUtils'
import type { ChordRulerEntry } from './score/chordRuler'
import { mergeFullMeasureRestCollapseScopeKeys, toMeasureStaffScopeKey } from './score/fullMeasureRestCollapse'
import { ImportProgressModal } from './score/components/ImportProgressModal'
import { OsmdPreviewModal } from './score/components/OsmdPreviewModal'
import type { MeasureTimelineBundle } from './score/timeline/types'
import {
  getDefaultNotationPaletteSelection,
  type NotationPaletteSelection,
} from './score/notationPaletteConfig'
import {
  DEFAULT_CHORD_MARKER_PADDING_PX,
  DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT,
  DEFAULT_PAGE_HORIZONTAL_PADDING_PX,
  toSequencePreview,
} from './score/scorePresentation'
import type { HitGridIndex } from './score/layout/hitTest'
import type {
  BuiltInDemoMode,
  DragDebugSnapshot,
  DragState,
  ImportFeedback,
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  Pitch,
  RhythmPresetId,
  ScoreNote,
  Selection,
  TieSelection,
  TimeSignature,
} from './score/types'

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
  const [notes, setNotes] = useState<ScoreNote[]>(INITIAL_NOTES)
  const [bassNotes, setBassNotes] = useState<ScoreNote[]>(INITIAL_BASS_NOTES)
  const [rhythmPreset, setRhythmPreset] = useState<RhythmPresetId>('quarter')
  const [activeBuiltInDemo, setActiveBuiltInDemo] = useState<BuiltInDemoMode>('none')
  const [activeSelection, setActiveSelection] = useState<Selection>({ noteId: INITIAL_NOTES[0].id, staff: 'treble', keyIndex: 0 })
  const [activeAccidentalSelection, setActiveAccidentalSelection] = useState<Selection | null>(null)
  const [activeTieSelection, setActiveTieSelection] = useState<TieSelection | null>(null)
  const [selectedSelections, setSelectedSelections] = useState<Selection[]>([
    { noteId: INITIAL_NOTES[0].id, staff: 'treble', keyIndex: 0 },
  ])
  const [selectedMeasureScope, setSelectedMeasureScope] = useState<{ pairIndex: number; staff: Selection['staff'] } | null>(null)
  const [fullMeasureRestCollapseScopeKeys, setFullMeasureRestCollapseScopeKeys] = useState<string[]>([])
  const [isSelectionVisible, setIsSelectionVisible] = useState(true)
  const [draggingSelection, setDraggingSelection] = useState<Selection | null>(null)
  const [dragPreviewState, setDragPreviewState] = useState<DragState | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [musicXmlInput, setMusicXmlInput] = useState<string>('')
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>({ kind: 'idle', message: '' })
  const [isNotationPaletteOpen, setIsNotationPaletteOpen] = useState(false)
  const [notationPaletteSelection, setNotationPaletteSelection] = useState<NotationPaletteSelection>(
    () => getDefaultNotationPaletteSelection(),
  )
  const [notationPaletteLastAction, setNotationPaletteLastAction] = useState('未选择')
  const [isRhythmLinked, setIsRhythmLinked] = useState(false)
  const [measurePairsFromImport, setMeasurePairsFromImport] = useState<MeasurePair[] | null>(null)
  const [measureKeyFifthsFromImport, setMeasureKeyFifthsFromImport] = useState<number[] | null>(null)
  const [measureKeyModesFromImport, setMeasureKeyModesFromImport] = useState<string[] | null>(null)
  const [measureDivisionsFromImport, setMeasureDivisionsFromImport] = useState<number[] | null>(null)
  const [measureTimeSignaturesFromImport, setMeasureTimeSignaturesFromImport] = useState<TimeSignature[] | null>(null)
  const [musicXmlMetadataFromImport, setMusicXmlMetadataFromImport] = useState<MusicXmlMetadata | null>(null)
  const [importedChordRulerEntriesByPairFromImport, setImportedChordRulerEntriesByPairFromImport] = useState<ChordRulerEntry[][] | null>(null)
  const [, setDragDebugReport] = useState<string>('')
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false)
  const [manualScalePercent, setManualScalePercent] = useState(100)
  const [canvasHeightPercent, setCanvasHeightPercent] = useState(100)
  const [playheadFollowEnabled, setPlayheadFollowEnabled] = useState(() => getInitialPlayheadFollowEnabled())
  const [showChordDegreeEnabled, setShowChordDegreeEnabled] = useState(() => getInitialChordDegreeDisplayEnabled())
  const [showInScoreMeasureNumbers, setShowInScoreMeasureNumbers] = useState(false)
  const [showNoteHeadJianpuEnabled, setShowNoteHeadJianpuEnabled] = useState(false)
  const [pageHorizontalPaddingPx, setPageHorizontalPaddingPx] = useState(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
  const [chordMarkerUiScalePercent, setChordMarkerUiScalePercent] = useState(DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT)
  const [chordMarkerPaddingPx, setChordMarkerPaddingPx] = useState(DEFAULT_CHORD_MARKER_PADDING_PX)
  const [timeAxisSpacingConfig, setTimeAxisSpacingConfig] = useState(DEFAULT_TIME_AXIS_SPACING_CONFIG)
  const [horizontalViewportXRange, setHorizontalViewportXRange] = useState<{ startX: number; endX: number }>({
    startX: 0,
    endX: A4_PAGE_WIDTH,
  })

  const scoreRef = useRef<HTMLCanvasElement | null>(null)
  const scoreOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const scoreScrollRef = useRef<HTMLDivElement | null>(null)
  const scoreStageRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | Tone.Sampler | null>(null)

  const noteLayoutsRef = useRef<NoteLayout[]>([])
  const noteLayoutsByPairRef = useRef<Map<number, NoteLayout[]>>(new Map())
  const noteLayoutByKeyRef = useRef<Map<string, NoteLayout>>(new Map())
  const horizontalRenderOffsetXRef = useRef(0)
  const hitGridRef = useRef<HitGridIndex | null>(null)
  const measureLayoutsRef = useRef<Map<number, MeasureLayout>>(new Map())
  const measureTimelineBundlesRef = useRef<Map<number, MeasureTimelineBundle>>(new Map())
  const measurePairsRef = useRef<MeasurePair[]>([])
  const dragDebugFramesRef = useRef<DragDebugSnapshot[]>([])
  const dragRef = useRef<DragState | null>(null)
  const dragPreviewFrameRef = useRef(0)
  const dragRafRef = useRef<number | null>(null)
  const dragPendingRef = useRef<{ drag: DragState; pitch: Pitch } | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const widthProbeRendererRef = useRef<Renderer | null>(null)
  const horizontalMeasureWidthCacheRef = useRef<Map<string, number>>(new Map())
  const overlayRendererRef = useRef<Renderer | null>(null)
  const overlayRendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const overlayLastRectRef = useRef<MeasureLayout['overlayRect'] | null>(null)
  const stopPlayTimerRef = useRef<number | null>(null)
  const playbackPointTimerIdsRef = useRef<number[]>([])
  const playbackSessionIdRef = useRef(0)
  const measurePairsFromImportRef = useRef<MeasurePair[] | null>(null)
  const measureKeyFifthsFromImportRef = useRef<number[] | null>(null)
  const measureKeyModesFromImportRef = useRef<string[] | null>(null)
  const measureDivisionsFromImportRef = useRef<number[] | null>(null)
  const measureTimeSignaturesFromImportRef = useRef<TimeSignature[] | null>(null)
  const musicXmlMetadataFromImportRef = useRef<MusicXmlMetadata | null>(null)
  const importedNoteLookupRef = useRef<Map<string, ImportedNoteLocation>>(new Map())
  const importFeedbackRef = useRef<ImportFeedback>(importFeedback)
  const activeSelectionRef = useRef<Selection>(activeSelection)
  const selectedSelectionsRef = useRef<Selection[]>(selectedSelections)
  const fullMeasureRestCollapseScopeKeysRef = useRef<string[]>(fullMeasureRestCollapseScopeKeys)
  const isSelectionVisibleRef = useRef<boolean>(isSelectionVisible)
  const draggingSelectionRef = useRef<Selection | null>(draggingSelection)
  const clearDragOverlayRef = useRef<() => void>(() => {})
  const layoutReflowHintRef = useRef<LayoutReflowHint | null>(null)
  const midiStepChainRef = useRef(false)
  const midiStepLastSelectionRef = useRef<Selection | null>(null)
  const isOsmdPreviewOpenRef = useRef(false)
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

  const trebleSequenceText = useMemo(() => toSequencePreview(notes), [notes])
  const bassSequenceText = useMemo(() => toSequencePreview(bassNotes), [bassNotes])
  const isImportLoading = importFeedback.kind === 'loading'
  const importProgressPercent =
    typeof importFeedback.progress === 'number' ? Math.max(0, Math.min(100, importFeedback.progress)) : null
  const {
    currentSelection,
    currentSelectionPosition,
    currentSelectionPitchLabel,
    selectedPoolSize,
    derivedNotationPaletteDisplay,
  } = useScoreSelectionController({
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
  })
  useEditorPreferencePersistence({
    playheadFollowEnabled,
    showChordDegreeEnabled,
    showInScoreMeasureNumbers,
    setShowInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
  })
  const {
    midiPermissionState,
    midiInputOptions,
    selectedMidiInputId,
    setSelectedMidiInputId,
  } = useMidiInputController({
    onMidiNoteNumber: applyMidiReplacementByNoteNumber,
  })
  const midiSupported = midiPermissionState !== 'unsupported'
  const {
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
  } = useOsmdPreviewController({
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
  })

  useEffect(() => {
    isOsmdPreviewOpenRef.current = isOsmdPreviewOpen
  }, [isOsmdPreviewOpen])
  const {
    openBeamGroupingTool,
    toggleNotationPalette,
    closeNotationPalette,
    onNotationPaletteSelectionChange,
  } = useNotationPaletteController({
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    currentSelection,
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
  })
  useKeyboardCommandController({
    isOsmdPreviewOpen,
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
  })

  const { playheadRectPx, playbackCursorState } = usePlaybackCursorLayout({
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
  })
  const {
    onBeginDragWithFirstMeasureDebug,
    onEndDragWithFirstMeasureDebug,
  } = useScoreRuntimeDebugController({
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
    playbackCursorState,
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


