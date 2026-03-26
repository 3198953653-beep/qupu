import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import './App.css'
import {
  A4_PAGE_WIDTH,
  INITIAL_NOTES,
  PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
  PREVIEW_START_THRESHOLD_PX,
  SCORE_TOP_PADDING,
  SYSTEM_HEIGHT,
} from './score/constants'
import {
  DEFAULT_TIME_AXIS_SPACING_CONFIG,
} from './score/layout/timeAxisSpacing'
import { solveHorizontalMeasureWidths } from './score/layout/horizontalMeasureWidthSolver'
import {
  resolveActualStartDecorationWidths,
  resolveStartDecorationDisplayMetas,
} from './score/layout/startDecorationReserve'
import { useDragHandlers } from './score/dragHandlers'
import { useEditorHandlers } from './score/editorHandlers'
import { buildPlaybackTimeline, type PlaybackTimelineEvent } from './score/playbackTimeline'
import {
  useImportedRefsSync,
  useRendererCleanup,
  useRhythmLinkedBassSync,
  useScoreRenderEffect,
  useSynthLifecycle,
} from './score/hooks/useScoreEffects'
import { useMidiInputController } from './score/hooks/useMidiInputController'
import { getPlaybackPointKey, usePlaybackController } from './score/hooks/usePlaybackController'
import { useScoreAudioPreviewController } from './score/hooks/useScoreAudioPreviewController'
import { useChordMarkerController } from './score/hooks/useChordMarkerController'
import { useScoreMutationController } from './score/hooks/useScoreMutationController'
import { useEditorActionWrappers } from './score/hooks/useEditorActionWrappers'
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
import { ScoreControls } from './score/components/ScoreControls'
import { ScoreBoard } from './score/components/ScoreBoard'
import {
  createPianoPitches,
} from './score/pitchUtils'
import {
  buildBassMockNotes,
  buildMeasurePairs,
} from './score/scoreOps'
import { isStaffFullMeasureRest, resolvePairTimeSignature } from './score/measureRestUtils'
import { buildChordRulerEntries, type ChordRulerEntry } from './score/chordRuler'
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
  applyChordMarkerVisualZoom,
  clampCanvasHeightPercent,
  clampChordMarkerPaddingPx,
  clampChordMarkerUiScalePercent,
  clampScalePercent,
  getAutoScoreScale,
  getChordMarkerBaseStyleMetrics,
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
  MeasureFrame,
  MeasureLayout,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  Pitch,
  RhythmPresetId,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
  TieSelection,
  TimeSignature,
} from './score/types'

const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const MANUAL_SCALE_BASELINE = 1
const SCORE_STAGE_BORDER_PX = 1
const HORIZONTAL_VIEW_MEASURE_WIDTH_PX = 220
const HORIZONTAL_VIEW_HEIGHT_PX = SCORE_TOP_PADDING * 2 + SYSTEM_HEIGHT + 26
const MAX_CANVAS_RENDER_DIM_PX = 32760
const HORIZONTAL_RENDER_BUFFER_PX = 400
const HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES = 1
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
  const measurePairs = useMemo(
    () => measurePairsFromImport ?? buildMeasurePairs(notes, bassNotes),
    [measurePairsFromImport, notes, bassNotes],
  )
  const chordRulerEntriesByPair = useMemo(
    () => {
      if (measurePairsFromImport !== null) {
        if (!importedChordRulerEntriesByPairFromImport) return null
        return measurePairs.map((_, pairIndex) => importedChordRulerEntriesByPairFromImport[pairIndex] ?? [])
      }
      return measurePairs.map((_, pairIndex) =>
        buildChordRulerEntries({
          pairIndex,
          timeSignature: resolvePairTimeSignature(pairIndex, measureTimeSignaturesFromImport),
        }),
      )
    },
    [importedChordRulerEntriesByPairFromImport, measurePairs, measurePairsFromImport, measureTimeSignaturesFromImport],
  )
  const supplementalSpacingTicksByPair = useMemo(
    () =>
      chordRulerEntriesByPair
        ? chordRulerEntriesByPair.map((entries) => entries.map((entry) => entry.startTick))
        : null,
    [chordRulerEntriesByPair],
  )
  const playbackTimelineEvents = useMemo(
    () =>
      buildPlaybackTimeline({
        measurePairs,
        timeSignaturesByMeasure: measureTimeSignaturesFromImport,
      }),
    [measurePairs, measureTimeSignaturesFromImport],
  )
  const playbackTimelineEventByPointKey = useMemo(
    () =>
      new Map<string, PlaybackTimelineEvent>(
        playbackTimelineEvents.map((event) => [getPlaybackPointKey(event.point), event] as const),
      ),
    [playbackTimelineEvents],
  )
  const firstPlaybackPoint = playbackTimelineEvents[0]?.point ?? null
  const spacingLayoutMode: SpacingLayoutMode = 'custom'
  const safeChordMarkerUiScalePercent = clampChordMarkerUiScalePercent(chordMarkerUiScalePercent)
  const safeChordMarkerPaddingPx = clampChordMarkerPaddingPx(chordMarkerPaddingPx)
  const chordMarkerBaseStyleMetrics = useMemo(
    () => getChordMarkerBaseStyleMetrics(safeChordMarkerUiScalePercent, safeChordMarkerPaddingPx),
    [safeChordMarkerPaddingPx, safeChordMarkerUiScalePercent],
  )
  const getWidthProbeContext = useCallback((): ReturnType<Renderer['getContext']> | null => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null
    const probeWidth = 2048
    const probeHeight = 768
    const existing = widthProbeRendererRef.current
    if (existing) {
      existing.resize(probeWidth, probeHeight)
      return existing.getContext()
    }
    const canvas = document.createElement('canvas')
    const renderer = new Renderer(canvas, SCORE_RENDER_BACKEND)
    renderer.resize(probeWidth, probeHeight)
    widthProbeRendererRef.current = renderer
    return renderer.getContext()
  }, [])
  const horizontalMeasureStartDecorationWidths = useMemo(() => {
    if (measurePairs.length === 0) return []
    const displayMetas = resolveStartDecorationDisplayMetas({
      measureCount: measurePairs.length,
      keyFifthsByPair: measureKeyFifthsFromImport,
      timeSignaturesByPair: measureTimeSignaturesFromImport,
    })
    return resolveActualStartDecorationWidths({
      metas: displayMetas,
    }).actualStartDecorationWidthPxByPair
  }, [measurePairs.length, measureKeyFifthsFromImport, measureTimeSignaturesFromImport])
  const horizontalContentMeasureWidths = useMemo(() => {
    if (measurePairs.length === 0) return []
    const probeContext = getWidthProbeContext()
    if (!probeContext) {
      return measurePairs.map(() => HORIZONTAL_VIEW_MEASURE_WIDTH_PX)
    }
    const solverMaxIterations =
      measurePairs.length > 120 ? 8 : measurePairs.length > 48 ? 16 : 60
    const eagerProbeMeasureLimit =
      measurePairs.length > 120 ? 16 : measurePairs.length > 60 ? 24 : Number.POSITIVE_INFINITY
    return solveHorizontalMeasureWidths({
      context: probeContext,
      measurePairs,
      measureKeyFifthsByPair: measureKeyFifthsFromImport,
      measureTimeSignaturesByPair: measureTimeSignaturesFromImport,
      supplementalSpacingTicksByPair,
      spacingConfig: timeAxisSpacingConfig,
      maxIterations: solverMaxIterations,
      eagerProbeMeasureLimit,
      widthCache: horizontalMeasureWidthCacheRef.current,
    })
  }, [
    getWidthProbeContext,
    measurePairs,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
  ])
  const horizontalRenderedMeasureWidths = useMemo(
    () =>
      horizontalContentMeasureWidths.map((contentMeasureWidth, pairIndex) =>
        Math.max(1, contentMeasureWidth + (horizontalMeasureStartDecorationWidths[pairIndex] ?? 0)),
      ),
    [horizontalContentMeasureWidths, horizontalMeasureStartDecorationWidths],
  )
  const horizontalEstimatedMeasureWidthTotal = useMemo(() => {
    if (horizontalRenderedMeasureWidths.length === 0) return HORIZONTAL_VIEW_MEASURE_WIDTH_PX
    const total = horizontalRenderedMeasureWidths.reduce((sum, width) => sum + width, 0)
    return Math.max(HORIZONTAL_VIEW_MEASURE_WIDTH_PX, total)
  }, [horizontalRenderedMeasureWidths])
  const autoScoreScale = useMemo(() => getAutoScoreScale(measurePairs.length), [measurePairs.length])
  const safeManualScalePercent = clampScalePercent(manualScalePercent)
  const safeCanvasHeightPercent = clampCanvasHeightPercent(canvasHeightPercent)
  const relativeScale = autoScaleEnabled ? autoScoreScale : safeManualScalePercent / 100
  const horizontalDisplayScale = relativeScale * MANUAL_SCALE_BASELINE
  const provisionalDisplayScoreHeight = HORIZONTAL_VIEW_HEIGHT_PX
  const displayScoreWidth = useMemo(() => {
    const totalMeasureWidth = horizontalEstimatedMeasureWidthTotal
    const baseWidth = Math.max(A4_PAGE_WIDTH, pageHorizontalPaddingPx * 2 + totalMeasureWidth)
    // Keep horizontal display width in the same scale space as canvas transform.
    // Otherwise scroll-space and render-space drift apart and can leave blank tails.
    return Math.max(A4_PAGE_WIDTH, Math.round(baseWidth * horizontalDisplayScale))
  }, [horizontalEstimatedMeasureWidthTotal, pageHorizontalPaddingPx, horizontalDisplayScale])
  const baseScoreScale = relativeScale * MANUAL_SCALE_BASELINE
  const minScaleForCanvasHeight = provisionalDisplayScoreHeight / MAX_CANVAS_RENDER_DIM_PX
  const scoreScaleX = baseScoreScale
  const scoreScaleY = Math.max(baseScoreScale, minScaleForCanvasHeight)
  const chordMarkerStyleMetrics = useMemo(
    () => applyChordMarkerVisualZoom(chordMarkerBaseStyleMetrics, baseScoreScale),
    [baseScoreScale, chordMarkerBaseStyleMetrics],
  )
  const canvasHeightScale = safeCanvasHeightPercent / 100
  const viewportHeightScaleByZoom = Math.max(0.1, scoreScaleY / MANUAL_SCALE_BASELINE)
  const scoreScale = scoreScaleX
  const autoScalePercent = Math.round(baseScoreScale * 100)
  const totalScoreWidth = Math.max(1, Math.round(displayScoreWidth / scoreScaleX))
  const trebleNoteById = useMemo(() => new Map(notes.map((note) => [note.id, note] as const)), [notes])
  const bassNoteById = useMemo(() => new Map(bassNotes.map((note) => [note.id, note] as const)), [bassNotes])
  const trebleNoteIndexById = useMemo(() => {
    const byId = new Map<string, number>()
    notes.forEach((note, index) => byId.set(note.id, index))
    return byId
  }, [notes])
  const bassNoteIndexById = useMemo(() => {
    const byId = new Map<string, number>()
    bassNotes.forEach((note, index) => byId.set(note.id, index))
    return byId
  }, [bassNotes])
  const horizontalMeasureFramesByPair = useMemo(() => {
    if (horizontalRenderedMeasureWidths.length === 0) return [] as MeasureFrame[]
    let cursorX = pageHorizontalPaddingPx
    return horizontalRenderedMeasureWidths.map((measureWidth, pairIndex) => {
      const contentMeasureWidth = horizontalContentMeasureWidths[pairIndex] ?? Math.max(1, measureWidth)
      const actualStartDecorationWidthPx = horizontalMeasureStartDecorationWidths[pairIndex] ?? 0
      const frame: MeasureFrame = {
        measureX: cursorX,
        measureWidth,
        contentMeasureWidth,
        renderedMeasureWidth: measureWidth,
        actualStartDecorationWidthPx,
      }
      cursorX += measureWidth
      return frame
    })
  }, [
    horizontalContentMeasureWidths,
    horizontalRenderedMeasureWidths,
    horizontalMeasureStartDecorationWidths,
    pageHorizontalPaddingPx,
  ])
  const getMeasureFrameContentGeometry = useCallback((frame: MeasureFrame | null | undefined) => {
    if (!frame) return null
    const actualStartDecorationWidthPx =
      typeof frame.actualStartDecorationWidthPx === 'number' && Number.isFinite(frame.actualStartDecorationWidthPx)
        ? Math.max(0, frame.actualStartDecorationWidthPx)
        : 0
    const contentMeasureWidth =
      typeof frame.contentMeasureWidth === 'number' && Number.isFinite(frame.contentMeasureWidth)
        ? Math.max(1, frame.contentMeasureWidth)
        : Math.max(1, frame.measureWidth - actualStartDecorationWidthPx)
    return {
      contentStartX: frame.measureX + actualStartDecorationWidthPx,
      contentMeasureWidth,
    }
  }, [])
  const horizontalViewportWidthInScore = Math.max(1, horizontalViewportXRange.endX - horizontalViewportXRange.startX)
  const horizontalRenderSurfaceWidth = useMemo(() => {
    const desiredWidth = Math.ceil(horizontalViewportWidthInScore + HORIZONTAL_RENDER_BUFFER_PX * 2)
    const targetWidth = Math.max(1200, desiredWidth)
    return Math.max(1, Math.min(totalScoreWidth, Math.min(MAX_CANVAS_RENDER_DIM_PX, targetWidth)))
  }, [totalScoreWidth, horizontalViewportWidthInScore])
  const horizontalRenderOffsetX = useMemo(() => {
    // Keep a left buffer inside the render surface so partially visible
    // measures at viewport start are not clipped when scrolling settles.
    const desiredOffset = Math.max(0, Math.floor(horizontalViewportXRange.startX - HORIZONTAL_RENDER_BUFFER_PX))
    const maxOffset = Math.max(0, totalScoreWidth - horizontalRenderSurfaceWidth)
    return Math.max(0, Math.min(maxOffset, desiredOffset))
  }, [horizontalViewportXRange.startX, totalScoreWidth, horizontalRenderSurfaceWidth])
  horizontalRenderOffsetXRef.current = horizontalRenderOffsetX
  const scoreWidth = horizontalRenderSurfaceWidth
  const systemRanges = useMemo(() => [{ startPairIndex: 0, endPairIndexExclusive: measurePairs.length }], [measurePairs.length])
  const scaledScoreContentHeight = Math.max(1, HORIZONTAL_VIEW_HEIGHT_PX * viewportHeightScaleByZoom)
  const displayScoreHeight = Math.max(1, Math.round(scaledScoreContentHeight * canvasHeightScale))
  const scoreHeight = Math.max(1, Math.round(scaledScoreContentHeight / scoreScaleY))
  const scoreSurfaceOffsetXPx = horizontalRenderOffsetX * scoreScaleX
  const scaledRenderedScoreHeight = Math.max(1, scoreHeight * scoreScaleY)
  const scoreSurfaceOffsetYPx = Math.max(0, (displayScoreHeight - scaledRenderedScoreHeight) / 2)
  const renderQualityScale = useMemo(() => {
    const maxBackingStoreDim = 32760
    const devicePixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1
    const targetQualityX = Math.max(1, devicePixelRatio, Math.abs(scoreScaleX))
    const targetQualityY = Math.max(1, devicePixelRatio, Math.abs(scoreScaleY))
    const maxQualityX = Math.max(1, maxBackingStoreDim / Math.max(1, scoreWidth))
    const maxQualityY = Math.max(1, maxBackingStoreDim / Math.max(1, scoreHeight))
    return {
      x: Math.max(1, Math.min(targetQualityX, maxQualityX)),
      y: Math.max(1, Math.min(targetQualityY, maxQualityY)),
    }
  }, [scoreScaleX, scoreScaleY, scoreWidth, scoreHeight])
  const systemsPerPage = 1
  const pageCount = 1
  const safeCurrentPage = 0
  const visibleSystemRange = useMemo(() => ({ start: 0, end: 0 }), [])
  const horizontalRenderWindow = useMemo(() => {
    const frames = horizontalMeasureFramesByPair
    const renderWindowStartX = horizontalRenderOffsetX
    const renderWindowEndX = Math.min(totalScoreWidth, horizontalRenderOffsetX + scoreWidth)
    if (frames.length === 0) {
      return {
        startPairIndex: 0,
        endPairIndexExclusive: 0,
        startX: renderWindowStartX,
        endX: renderWindowEndX,
      }
    }
    // The surface range already includes left/right buffer via horizontalRenderOffsetX
    // and horizontalRenderSurfaceWidth, so use it directly for pair filtering.
    const bufferedStartX = renderWindowStartX
    const bufferedEndX = renderWindowEndX

    let startPairIndex = 0
    while (
      startPairIndex < frames.length &&
      frames[startPairIndex].measureX + frames[startPairIndex].measureWidth < bufferedStartX
    ) {
      startPairIndex += 1
    }

    let endPairIndexExclusive = startPairIndex
    while (endPairIndexExclusive < frames.length && frames[endPairIndexExclusive].measureX <= bufferedEndX) {
      endPairIndexExclusive += 1
    }

    startPairIndex = Math.max(0, startPairIndex - HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES)
    endPairIndexExclusive = Math.min(frames.length, endPairIndexExclusive + HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES)
    if (endPairIndexExclusive <= startPairIndex) {
      startPairIndex = Math.max(0, Math.min(frames.length - 1, startPairIndex))
      endPairIndexExclusive = Math.min(frames.length, startPairIndex + 1)
    }

    const firstFrame = frames[startPairIndex]
    const lastFrame = frames[endPairIndexExclusive - 1]
    const startX = Math.max(0, (firstFrame?.measureX ?? 0) - 120)
    const endX = Math.min(totalScoreWidth, (lastFrame ? lastFrame.measureX + lastFrame.measureWidth : totalScoreWidth) + 120)
    return { startPairIndex, endPairIndexExclusive, startX, endX }
  }, [
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    scoreWidth,
    totalScoreWidth,
  ])
  const layoutStabilityKey = useMemo(() => {
    const systemRangeKey = systemRanges.map((range) => `${range.startPairIndex}-${range.endPairIndexExclusive}`).join(',')
    const spacingKey = [
      timeAxisSpacingConfig.baseMinGap32Px,
      timeAxisSpacingConfig.leadingBarlineGapPx,
      timeAxisSpacingConfig.secondChordSafeGapPx,
      timeAxisSpacingConfig.durationGapRatios.thirtySecond,
      timeAxisSpacingConfig.durationGapRatios.sixteenth,
      timeAxisSpacingConfig.durationGapRatios.eighth,
      timeAxisSpacingConfig.durationGapRatios.quarter,
      timeAxisSpacingConfig.durationGapRatios.half,
      timeAxisSpacingConfig.durationGapRatios.whole,
      spacingLayoutMode,
    ].join(',')
    return `${scoreWidth}|${scoreHeight}|${pageHorizontalPaddingPx}|${systemRangeKey}|${spacingKey}`
  }, [
    scoreWidth,
    scoreHeight,
    pageHorizontalPaddingPx,
    systemRanges,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.leadingBarlineGapPx,
    timeAxisSpacingConfig.secondChordSafeGapPx,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.half,
    timeAxisSpacingConfig.durationGapRatios.whole,
    spacingLayoutMode,
  ])
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

  useEffect(() => {
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) {
      setHorizontalViewportXRange({ startX: 0, endX: totalScoreWidth })
      return
    }

    const updateViewport = () => {
      const nextStartX = Math.max(0, scrollHost.scrollLeft / scoreScaleX)
      const nextEndX = Math.max(nextStartX + 1, (scrollHost.scrollLeft + scrollHost.clientWidth) / scoreScaleX)
      setHorizontalViewportXRange((current) => {
        if (Math.abs(current.startX - nextStartX) < 0.5 && Math.abs(current.endX - nextEndX) < 0.5) {
          return current
        }
        return { startX: nextStartX, endX: nextEndX }
      })
    }

    updateViewport()
    scrollHost.addEventListener('scroll', updateViewport, { passive: true })
    window.addEventListener('resize', updateViewport)

    return () => {
      scrollHost.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
    }
  }, [scoreScaleX, totalScoreWidth, displayScoreWidth])

  useImportedRefsSync({
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
  })

  useRhythmLinkedBassSync({
    notes,
    isRhythmLinked,
    setBassNotes,
  })

  useScoreRenderEffect({
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
  })

  useSynthLifecycle({
    synthRef,
  })

  useRendererCleanup({
    dragRafRef,
    dragPendingRef,
    rendererRef,
    rendererSizeRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
  })

  useEffect(() => {
    return () => {
      widthProbeRendererRef.current = null
    }
  }, [])

  useEffect(() => {
    if (horizontalMeasureWidthCacheRef.current.size === 0) return
    horizontalMeasureWidthCacheRef.current.clear()
  }, [
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.leadingBarlineGapPx,
    timeAxisSpacingConfig.secondChordSafeGapPx,
    timeAxisSpacingConfig.interOnsetPaddingPx,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.half,
    timeAxisSpacingConfig.durationGapRatios.whole,
  ])
  const {
    clearDragOverlay,
    onSurfacePointerMove,
    endDrag,
    beginDrag,
  } = useDragHandlers({
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
  })
  clearDragOverlayRef.current = clearDragOverlay

  const {
    playScore,
    importMusicXmlText,
    importMusicXmlFromTextarea,
    openMusicXmlFilePicker,
    onMusicXmlFileChange,
    loadSampleMusicXml,
    loadWholeNoteDemo,
    loadHalfNoteDemo,
    exportMusicXmlFile,
    resetScore,
    applyRhythmPreset,
  } = useEditorHandlers({
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
  })
  const {
    importMusicXmlTextWithCollapseReset,
    importMusicXmlFromTextareaWithCollapseReset,
    onMusicXmlFileChangeWithCollapseReset,
    loadSampleMusicXmlWithCollapseReset,
    loadWholeNoteDemoWithCollapseReset,
    loadHalfNoteDemoWithCollapseReset,
    resetScoreWithCollapseReset,
    applyRhythmPresetWithCollapseReset,
  } = useEditorActionWrappers({
    stopActivePlaybackSession,
    requestPlaybackCursorReset,
    clearActiveChordSelection,
    setActiveBuiltInDemo,
    setFullMeasureRestCollapseScopeKeys,
    importMusicXmlText,
    importMusicXmlFromTextarea,
    onMusicXmlFileChange,
    loadSampleMusicXml,
    loadWholeNoteDemo,
    loadHalfNoteDemo,
    resetScore,
    applyRhythmPreset,
  })

  useEffect(() => {
    return () => {
      if (stopPlayTimerRef.current !== null) {
        window.clearTimeout(stopPlayTimerRef.current)
        stopPlayTimerRef.current = null
      }
      playbackPointTimerIdsRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      playbackPointTimerIdsRef.current = []
      playbackSessionIdRef.current += 1
      const stoppableSynth = synthRef.current as (Tone.PolySynth | Tone.Sampler | { releaseAll?: (time?: number) => void }) | null
      if (stoppableSynth && typeof stoppableSynth.releaseAll === 'function') {
        try {
          stoppableSynth.releaseAll()
        } catch {
          // Ignore best-effort cleanup failures on disposed Tone voices.
        }
      }
    }
  }, [])

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


