import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import './App.css'
import {
  A4_PAGE_HEIGHT,
  A4_PAGE_WIDTH,
  DURATION_TICKS,
  INITIAL_NOTES,
  PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
  PREVIEW_START_THRESHOLD_PX,
  SCORE_TOP_PADDING,
  SYSTEM_GAP_Y,
  SYSTEM_HEIGHT,
  TICKS_PER_BEAT,
} from './score/constants'
import { buildAdaptiveSystemRanges, toDisplayDuration } from './score/layout/demand'
import { DEFAULT_TIME_AXIS_SPACING_CONFIG } from './score/layout/timeAxisSpacing'
import { useDragHandlers } from './score/dragHandlers'
import { useEditorHandlers } from './score/editorHandlers'
import {
  useImportedRefsSync,
  useRendererCleanup,
  useRhythmLinkedBassSync,
  useScoreRenderEffect,
  useSynthLifecycle,
} from './score/hooks/useScoreEffects'
import { ScoreControls } from './score/components/ScoreControls'
import { ScoreBoard } from './score/components/ScoreBoard'
import {
  createPianoPitches,
  toDisplayPitch,
} from './score/pitchUtils'
import {
  buildBassMockNotes,
  buildMeasurePairs,
} from './score/scoreOps'
import type { HitGridIndex } from './score/layout/hitTest'
import type {
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
  SpacingLayoutMode,
  TimeSignature,
} from './score/types'

const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const INSPECTOR_SEQUENCE_PREVIEW_LIMIT = 64
const MANUAL_SCALE_BASELINE = 0.7
const DEFAULT_PAGE_HORIZONTAL_PADDING_PX = 86
const ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG = false
const HORIZONTAL_VIEW_MEASURE_WIDTH_PX = 220
const HORIZONTAL_VIEW_HEIGHT_PX = SCORE_TOP_PADDING * 2 + SYSTEM_HEIGHT + 24

const PITCHES: Pitch[] = createPianoPitches()
const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)

function toSequencePreview(notes: ScoreNote[]): string {
  if (notes.length <= INSPECTOR_SEQUENCE_PREVIEW_LIMIT) {
    return notes.map((note) => toDisplayPitch(note.pitch)).join('  |  ')
  }
  const preview = notes.slice(0, INSPECTOR_SEQUENCE_PREVIEW_LIMIT).map((note) => toDisplayPitch(note.pitch)).join('  |  ')
  return `${preview}  |  ...（还剩 ${notes.length - INSPECTOR_SEQUENCE_PREVIEW_LIMIT} 个）`
}

function getAutoScoreScale(measureCount: number): number {
  if (measureCount >= 180) return 0.62
  if (measureCount >= 140) return 0.68
  if (measureCount >= 110) return 0.74
  if (measureCount >= 80) return 0.8
  if (measureCount >= 56) return 0.86
  if (measureCount >= 36) return 0.92
  return 1
}

function clampScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(55, Math.min(130, Math.round(value)))
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function clampDurationGapRatio(value: number): number {
  const clamped = clampNumber(value, 0.5, 4)
  return Number(clamped.toFixed(2))
}

function clampBaseMinGap32Px(value: number): number {
  const clamped = clampNumber(value, 0, 12)
  return Number(clamped.toFixed(2))
}

function clampPageHorizontalPaddingPx(value: number): number {
  return Math.round(clampNumber(value, 8, 120))
}

type FirstMeasureNoteDebugRow = {
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: Pitch
  noteX: number | null
  noteRightX: number | null
  spacingRightX: number | null
  headX: number | null
  headY: number | null
  pitchY: number | null
}

type FirstMeasureSnapshot = {
  stage: string
  pairIndex: number
  generatedAt: string
  measureX: number | null
  measureWidth: number | null
  measureEndBarX: number | null
  noteStartX: number | null
  noteEndX: number | null
  rows: FirstMeasureNoteDebugRow[]
}

function App() {
  const [notes, setNotes] = useState<ScoreNote[]>(INITIAL_NOTES)
  const [bassNotes, setBassNotes] = useState<ScoreNote[]>(INITIAL_BASS_NOTES)
  const [rhythmPreset, setRhythmPreset] = useState<RhythmPresetId>('quarter')
  const [activeSelection, setActiveSelection] = useState<Selection>({ noteId: INITIAL_NOTES[0].id, staff: 'treble', keyIndex: 0 })
  const [draggingSelection, setDraggingSelection] = useState<Selection | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [musicXmlInput, setMusicXmlInput] = useState<string>('')
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>({ kind: 'idle', message: '' })
  const [isRhythmLinked, setIsRhythmLinked] = useState(true)
  const [measurePairsFromImport, setMeasurePairsFromImport] = useState<MeasurePair[] | null>(null)
  const [measureKeyFifthsFromImport, setMeasureKeyFifthsFromImport] = useState<number[] | null>(null)
  const [measureDivisionsFromImport, setMeasureDivisionsFromImport] = useState<number[] | null>(null)
  const [measureTimeSignaturesFromImport, setMeasureTimeSignaturesFromImport] = useState<TimeSignature[] | null>(null)
  const [musicXmlMetadataFromImport, setMusicXmlMetadataFromImport] = useState<MusicXmlMetadata | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [dragDebugReport, setDragDebugReport] = useState<string>('')
  const [measureEdgeDebugReport, setMeasureEdgeDebugReport] = useState<string>('')
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false)
  const [manualScalePercent, setManualScalePercent] = useState(100)
  const [isHorizontalView, setIsHorizontalView] = useState(false)
  const [pageHorizontalPaddingPx, setPageHorizontalPaddingPx] = useState(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
  const [timeAxisSpacingConfig, setTimeAxisSpacingConfig] = useState(DEFAULT_TIME_AXIS_SPACING_CONFIG)

  const scoreRef = useRef<HTMLCanvasElement | null>(null)
  const scoreOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const scoreScrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | null>(null)

  const noteLayoutsRef = useRef<NoteLayout[]>([])
  const noteLayoutsByPairRef = useRef<Map<number, NoteLayout[]>>(new Map())
  const noteLayoutByKeyRef = useRef<Map<string, NoteLayout>>(new Map())
  const hitGridRef = useRef<HitGridIndex | null>(null)
  const measureLayoutsRef = useRef<Map<number, MeasureLayout>>(new Map())
  const measurePairsRef = useRef<MeasurePair[]>([])
  const dragDebugFramesRef = useRef<DragDebugSnapshot[]>([])
  const dragRef = useRef<DragState | null>(null)
  const dragPreviewFrameRef = useRef(0)
  const dragRafRef = useRef<number | null>(null)
  const dragPendingRef = useRef<{ drag: DragState; pitch: Pitch } | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const overlayRendererRef = useRef<Renderer | null>(null)
  const overlayRendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const overlayLastRectRef = useRef<MeasureLayout['overlayRect'] | null>(null)
  const stopPlayTimerRef = useRef<number | null>(null)
  const measurePairsFromImportRef = useRef<MeasurePair[] | null>(null)
  const measureKeyFifthsFromImportRef = useRef<number[] | null>(null)
  const measureDivisionsFromImportRef = useRef<number[] | null>(null)
  const measureTimeSignaturesFromImportRef = useRef<TimeSignature[] | null>(null)
  const musicXmlMetadataFromImportRef = useRef<MusicXmlMetadata | null>(null)
  const importedNoteLookupRef = useRef<Map<string, ImportedNoteLocation>>(new Map())
  const firstMeasureBaselineRef = useRef<FirstMeasureSnapshot | null>(null)
  const firstMeasureDragContextRef = useRef<{
    noteId: string
    staff: Selection['staff']
    keyIndex: number
    pairIndex: number
  } | null>(null)
  const firstMeasureDebugRafRef = useRef<number | null>(null)
  const importFeedbackRef = useRef<ImportFeedback>(importFeedback)
  const layoutReflowHintRef = useRef<LayoutReflowHint | null>(null)
  const measurePairs = useMemo(
    () => measurePairsFromImport ?? buildMeasurePairs(notes, bassNotes),
    [measurePairsFromImport, notes, bassNotes],
  )
  const spacingLayoutMode: SpacingLayoutMode = isHorizontalView ? 'legacy' : 'custom'
  const displayScoreWidth = useMemo(() => {
    if (!isHorizontalView) return A4_PAGE_WIDTH
    const totalMeasureWidth = Math.max(1, measurePairs.length) * HORIZONTAL_VIEW_MEASURE_WIDTH_PX
    return Math.max(A4_PAGE_WIDTH, pageHorizontalPaddingPx * 2 + totalMeasureWidth)
  }, [isHorizontalView, measurePairs.length, pageHorizontalPaddingPx])
  const displayScoreHeight = isHorizontalView ? HORIZONTAL_VIEW_HEIGHT_PX : A4_PAGE_HEIGHT
  const autoScoreScale = useMemo(() => getAutoScoreScale(measurePairs.length), [measurePairs.length])
  const safeManualScalePercent = clampScalePercent(manualScalePercent)
  const relativeScale = autoScaleEnabled ? autoScoreScale : safeManualScalePercent / 100
  const scoreScale = relativeScale * MANUAL_SCALE_BASELINE
  const autoScalePercent = Math.round(scoreScale * 100)
  const scoreWidth = Math.max(1, Math.round(displayScoreWidth / scoreScale))
  const scoreHeight = Math.max(1, Math.round(displayScoreHeight / scoreScale))
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
  const systemUsableWidth = Math.max(1, scoreWidth - pageHorizontalPaddingPx * 2)
  const systemRanges = useMemo(
    () => {
      if (isHorizontalView) {
        return [{ startPairIndex: 0, endPairIndexExclusive: measurePairs.length }]
      }
      return buildAdaptiveSystemRanges({
        measurePairs,
        systemUsableWidth,
        measureKeyFifthsFromImport,
        measureTimeSignaturesFromImport,
        timeAxisSpacingConfig,
      })
    },
    [
      measurePairs,
      systemUsableWidth,
      isHorizontalView,
      pageHorizontalPaddingPx,
      measureKeyFifthsFromImport,
      measureTimeSignaturesFromImport,
      timeAxisSpacingConfig,
    ],
  )
  const systemCount = Math.max(1, systemRanges.length)
  const systemsPerPage = Math.max(
    1,
    isHorizontalView
      ? systemCount
      : Math.floor((displayScoreHeight - SCORE_TOP_PADDING * 2 + SYSTEM_GAP_Y) / ((SYSTEM_HEIGHT + SYSTEM_GAP_Y) * scoreScale)),
  )
  const pageCount = Math.max(1, Math.ceil(systemCount / systemsPerPage))
  const safeCurrentPage = Math.min(currentPage, pageCount - 1)
  const visibleSystemRange = useMemo(() => {
    const start = Math.min(systemCount - 1, safeCurrentPage * systemsPerPage)
    const end = Math.min(systemCount - 1, start + systemsPerPage - 1)
    return { start, end }
  }, [safeCurrentPage, systemCount, systemsPerPage])
  const layoutStabilityKey = useMemo(() => {
    const systemRangeKey = systemRanges.map((range) => `${range.startPairIndex}-${range.endPairIndexExclusive}`).join(',')
    const spacingKey = [
      timeAxisSpacingConfig.minGapBeats,
      timeAxisSpacingConfig.gapGamma,
      timeAxisSpacingConfig.gapBaseWeight,
      timeAxisSpacingConfig.leftEdgePaddingPx,
      timeAxisSpacingConfig.rightEdgePaddingPx,
      timeAxisSpacingConfig.interOnsetPaddingPx,
      timeAxisSpacingConfig.baseMinGap32Px,
      timeAxisSpacingConfig.durationGapRatios.thirtySecond,
      timeAxisSpacingConfig.durationGapRatios.sixteenth,
      timeAxisSpacingConfig.durationGapRatios.eighth,
      timeAxisSpacingConfig.durationGapRatios.quarter,
      timeAxisSpacingConfig.durationGapRatios.half,
      spacingLayoutMode,
    ].join(',')
    return `${scoreWidth}|${scoreHeight}|${pageHorizontalPaddingPx}|${systemRangeKey}|${spacingKey}`
  }, [
    scoreWidth,
    scoreHeight,
    pageHorizontalPaddingPx,
    systemRanges,
    timeAxisSpacingConfig.minGapBeats,
    timeAxisSpacingConfig.gapGamma,
    timeAxisSpacingConfig.gapBaseWeight,
    timeAxisSpacingConfig.leftEdgePaddingPx,
    timeAxisSpacingConfig.rightEdgePaddingPx,
    timeAxisSpacingConfig.interOnsetPaddingPx,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.half,
    spacingLayoutMode,
  ])

  useEffect(() => {
    if (!isHorizontalView) return
    setCurrentPage(0)
  }, [isHorizontalView])

  useImportedRefsSync({
    measurePairsFromImport,
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
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
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    activeSelection,
    draggingSelection: null,
    layoutReflowHintRef,
    layoutStabilityKey,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    backend: SCORE_RENDER_BACKEND,
    pagePaddingX: pageHorizontalPaddingPx,
    timeAxisSpacingConfig,
    spacingLayoutMode,
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

  const {
    clearDragOverlay,
    dumpDragDebugReport,
    clearDragDebugReport,
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
    setActiveSelection,
    setDraggingSelection,
    measurePairsFromImportRef,
    importedNoteLookupRef,
    measureKeyFifthsFromImportRef,
    trebleNoteById,
    bassNoteById,
    pitches: PITCHES,
    previewDefaultAccidentalOffsetPx: PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
    previewStartThresholdPx: PREVIEW_START_THRESHOLD_PX,
    backend: SCORE_RENDER_BACKEND,
    scoreScale,
    timeAxisSpacingConfig,
    spacingLayoutMode,
  })

  const {
    playScore,
    importMusicXmlText,
    importMusicXmlFromTextarea,
    openMusicXmlFilePicker,
    onMusicXmlFileChange,
    loadSampleMusicXml,
    exportMusicXmlFile,
    resetScore,
    runAiDraft,
    applyRhythmPreset,
  } = useEditorHandlers({
    synthRef,
    notes,
    bassNotes,
    stopPlayTimerRef,
    setIsPlaying,
    setNotes,
    setBassNotes,
    setMeasurePairsFromImport,
    measurePairsFromImportRef,
    setMeasureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    setMeasureDivisionsFromImport,
    measureDivisionsFromImportRef,
    setMeasureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    setMusicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
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

  const activePool = activeSelection.staff === 'treble' ? notes : bassNotes
  const activePoolById = activeSelection.staff === 'treble' ? trebleNoteById : bassNoteById
  const activePoolIndexById = activeSelection.staff === 'treble' ? trebleNoteIndexById : bassNoteIndexById
  const currentSelection = activePoolById.get(activeSelection.noteId) ?? activePool[0] ?? notes[0]
  const currentSelectionPosition = (activePoolIndexById.get(currentSelection.id) ?? 0) + 1
  const currentSelectionPitch =
    activeSelection.keyIndex > 0
      ? currentSelection.chordPitches?.[activeSelection.keyIndex - 1] ?? currentSelection.pitch
      : currentSelection.pitch
  const trebleSequenceText = useMemo(() => toSequencePreview(notes), [notes])
  const bassSequenceText = useMemo(() => toSequencePreview(bassNotes), [bassNotes])
  const isImportLoading = importFeedback.kind === 'loading'
  const importProgressPercent =
    typeof importFeedback.progress === 'number' ? Math.max(0, Math.min(100, importFeedback.progress)) : null
  useEffect(() => {
    importFeedbackRef.current = importFeedback
  }, [importFeedback])
  const goToPrevPage = () => setCurrentPage((page) => Math.max(0, Math.min(page, pageCount - 1) - 1))
  const goToNextPage = () => setCurrentPage((page) => Math.min(pageCount - 1, Math.max(0, page) + 1))
  const goToPage = useCallback(
    (pageIndex: number) => setCurrentPage(Math.max(0, Math.min(pageCount - 1, pageIndex))),
    [pageCount],
  )
  const formatDebugCoord = (value: number | null | undefined): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'null'
    return value.toFixed(3)
  }
  const finiteOrNull = (value: number | null | undefined): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return value
  }
  const getPitchForKeyIndex = (note: ScoreNote, keyIndex: number): Pitch => {
    if (keyIndex <= 0) return note.pitch
    return note.chordPitches?.[keyIndex - 1] ?? note.pitch
  }
  const captureFirstMeasureSnapshot = (stage: string): FirstMeasureSnapshot | null => {
    const pairIndex = 0
    const measure = measurePairsRef.current[pairIndex]
    if (!measure) return null
    const layouts = noteLayoutsByPairRef.current.get(pairIndex) ?? []
    const layoutByNoteKey = new Map<string, NoteLayout>()
    layouts.forEach((layout) => {
      layoutByNoteKey.set(`${layout.staff}:${layout.id}`, layout)
    })
    const measureLayout = measureLayoutsRef.current.get(pairIndex) ?? null
    const rows: FirstMeasureNoteDebugRow[] = []
    const pushRows = (staff: 'treble' | 'bass', notes: ScoreNote[]) => {
      notes.forEach((note, noteIndex) => {
        const layout = layoutByNoteKey.get(`${staff}:${note.id}`)
        const keyCount = 1 + (note.chordPitches?.length ?? 0)
        for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
          const pitch = getPitchForKeyIndex(note, keyIndex)
          const head = layout?.noteHeads.find((item) => item.keyIndex === keyIndex)
          rows.push({
            staff,
            noteId: note.id,
            noteIndex,
            keyIndex,
            pitch,
            noteX: finiteOrNull(layout?.x),
            noteRightX: finiteOrNull(layout?.rightX),
            spacingRightX: finiteOrNull(layout?.spacingRightX),
            headX: finiteOrNull(head?.x),
            headY: finiteOrNull(head?.y),
            pitchY: finiteOrNull(layout?.pitchYMap[pitch]),
          })
        }
      })
    }
    pushRows('treble', measure.treble)
    pushRows('bass', measure.bass)
    return {
      stage,
      pairIndex,
      generatedAt: new Date().toISOString(),
      measureX: finiteOrNull(measureLayout?.measureX),
      measureWidth: finiteOrNull(measureLayout?.measureWidth),
      measureEndBarX: finiteOrNull(
        measureLayout ? measureLayout.measureX + measureLayout.measureWidth : null,
      ),
      noteStartX: finiteOrNull(measureLayout?.noteStartX),
      noteEndX: finiteOrNull(measureLayout?.noteEndX),
      rows,
    }
  }
  const buildFirstMeasureDiffReport = (
    beforeSnapshot: FirstMeasureSnapshot,
    afterSnapshot: FirstMeasureSnapshot,
  ): string => {
    const afterByRowKey = new Map<string, FirstMeasureNoteDebugRow>()
    afterSnapshot.rows.forEach((row) => {
      afterByRowKey.set(`${row.staff}:${row.noteId}:${row.keyIndex}`, row)
    })
    const lines: string[] = [
      `generatedAt: ${new Date().toISOString()}`,
      `debugTarget: first-measure(pair=0)`,
      `dragged: ${
        firstMeasureDragContextRef.current
          ? `${firstMeasureDragContextRef.current.staff}:${firstMeasureDragContextRef.current.noteId}[key=${firstMeasureDragContextRef.current.keyIndex}] pair=${firstMeasureDragContextRef.current.pairIndex}`
          : 'unknown'
      }`,
      `dragPreviewFrameCount: ${dragDebugFramesRef.current.length}`,
      `baselineStage: ${beforeSnapshot.stage} at ${beforeSnapshot.generatedAt}`,
      `releaseStage: ${afterSnapshot.stage} at ${afterSnapshot.generatedAt}`,
      `baseline measureX=${formatDebugCoord(beforeSnapshot.measureX)} measureWidth=${formatDebugCoord(beforeSnapshot.measureWidth)} measureEndBarX=${formatDebugCoord(beforeSnapshot.measureEndBarX)} noteStartX=${formatDebugCoord(beforeSnapshot.noteStartX)} noteEndX=${formatDebugCoord(beforeSnapshot.noteEndX)}`,
      `release  measureX=${formatDebugCoord(afterSnapshot.measureX)} measureWidth=${formatDebugCoord(afterSnapshot.measureWidth)} measureEndBarX=${formatDebugCoord(afterSnapshot.measureEndBarX)} noteStartX=${formatDebugCoord(afterSnapshot.noteStartX)} noteEndX=${formatDebugCoord(afterSnapshot.noteEndX)}`,
      '',
      'rows (before -> after | delta):',
    ]
    beforeSnapshot.rows.forEach((beforeRow) => {
      const rowKey = `${beforeRow.staff}:${beforeRow.noteId}:${beforeRow.keyIndex}`
      const afterRow = afterByRowKey.get(rowKey)
      const delta = (afterValue: number | null, beforeValue: number | null): string => {
        if (typeof afterValue !== 'number' || typeof beforeValue !== 'number') return 'null'
        return (afterValue - beforeValue).toFixed(3)
      }
      lines.push(
        [
          `- ${beforeRow.staff} note=${beforeRow.noteId} idx=${beforeRow.noteIndex} key=${beforeRow.keyIndex} pitch=${beforeRow.pitch}:`,
          `noteX ${formatDebugCoord(beforeRow.noteX)} -> ${formatDebugCoord(afterRow?.noteX)} (d=${delta(afterRow?.noteX ?? null, beforeRow.noteX)})`,
          `headX ${formatDebugCoord(beforeRow.headX)} -> ${formatDebugCoord(afterRow?.headX)} (d=${delta(afterRow?.headX ?? null, beforeRow.headX)})`,
          `headY ${formatDebugCoord(beforeRow.headY)} -> ${formatDebugCoord(afterRow?.headY)} (d=${delta(afterRow?.headY ?? null, beforeRow.headY)})`,
          `pitchY ${formatDebugCoord(beforeRow.pitchY)} -> ${formatDebugCoord(afterRow?.pitchY)} (d=${delta(afterRow?.pitchY ?? null, beforeRow.pitchY)})`,
          `rightX ${formatDebugCoord(beforeRow.noteRightX)} -> ${formatDebugCoord(afterRow?.noteRightX)} (d=${delta(afterRow?.noteRightX ?? null, beforeRow.noteRightX)})`,
          `spacingRightX ${formatDebugCoord(beforeRow.spacingRightX)} -> ${formatDebugCoord(afterRow?.spacingRightX)} (d=${delta(afterRow?.spacingRightX ?? null, beforeRow.spacingRightX)})`,
        ].join(' '),
      )
    })
    return lines.join('\n')
  }
  const onBeginDragWithFirstMeasureDebug: typeof beginDrag = (event) => {
    beginDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    const drag = dragRef.current
    if (!drag) return
    firstMeasureDragContextRef.current = {
      noteId: drag.noteId,
      staff: drag.staff,
      keyIndex: drag.keyIndex,
      pairIndex: drag.pairIndex,
    }
    firstMeasureBaselineRef.current = captureFirstMeasureSnapshot('before-drag')
  }
  const onEndDragWithFirstMeasureDebug: typeof endDrag = (event) => {
    const dragging = dragRef.current
    endDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    if (!dragging) return
    const beforeSnapshot = firstMeasureBaselineRef.current
    if (!beforeSnapshot) return
    if (firstMeasureDebugRafRef.current !== null) {
      window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      firstMeasureDebugRafRef.current = null
    }
    firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
      firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
        const afterSnapshot = captureFirstMeasureSnapshot('after-drag-release')
        if (afterSnapshot) {
          const report = buildFirstMeasureDiffReport(beforeSnapshot, afterSnapshot)
          setMeasureEdgeDebugReport(report)
          console.log(report)
        }
        firstMeasureBaselineRef.current = null
        firstMeasureDragContextRef.current = null
        firstMeasureDebugRafRef.current = null
      })
    })
  }
  const dumpMeasureEdgeDebugReport = () => {
    const measureLayouts = measureLayoutsRef.current
    const noteLayoutsByPair = noteLayoutsByPairRef.current
    const totalMeasureCount = measurePairsRef.current.length
    const renderedPairIndices = [...measureLayouts.keys()].sort((left, right) => left - right)
    const notRenderedCount = Math.max(0, totalMeasureCount - renderedPairIndices.length)
    const lines: string[] = [
      `generatedAt: ${new Date().toISOString()}`,
      `totalMeasureCount: ${totalMeasureCount}`,
      `renderedMeasureCount: ${renderedPairIndices.length}`,
      `notRenderedMeasureCount: ${notRenderedCount}`,
      `visibleSystemRange: ${visibleSystemRange.start}..${visibleSystemRange.end}`,
      '',
      'rows:',
    ]

    let overflowCount = 0
    renderedPairIndices.forEach((pairIndex) => {
      const measureLayout = measureLayouts.get(pairIndex)
      if (!measureLayout) return

      const pairLayouts = noteLayoutsByPair.get(pairIndex) ?? []
      const measureEndBarX = measureLayout.measureX + measureLayout.measureWidth
      const noteRightLimitX = Number.isFinite(measureLayout.noteEndX) ? measureLayout.noteEndX : measureEndBarX
      const guardEndX = noteRightLimitX

      if (pairLayouts.length === 0) {
        lines.push(
          `- pair ${pairIndex}: no-note-layout measureEndBarX=${formatDebugCoord(measureEndBarX)} noteRightLimitX=${formatDebugCoord(noteRightLimitX)}`,
        )
        return
      }

      let rightMostHeadX = Number.NEGATIVE_INFINITY
      pairLayouts.forEach((layout) => {
        if (layout.x > rightMostHeadX) rightMostHeadX = layout.x
      })

      const tailTolerancePx = 0.5
      const tailCandidates = pairLayouts.filter((layout) => layout.x >= rightMostHeadX - tailTolerancePx)
      const lastHeadLayout =
        tailCandidates.reduce<NoteLayout | null>((best, layout) => {
          if (!best || layout.x > best.x) return layout
          return best
        }, null) ?? null
      const lastHeadRightX =
        lastHeadLayout && lastHeadLayout.noteHeads.length > 0
          ? lastHeadLayout.noteHeads.reduce((maxX, head) => Math.max(maxX, head.x + 9), Number.NEGATIVE_INFINITY)
          : Number.NaN
      const lastVisualLayout =
        tailCandidates.reduce<NoteLayout | null>((best, layout) => {
          if (!best || layout.rightX > best.rightX) return layout
          return best
        }, null) ?? null

      const headDelta = lastHeadRightX - noteRightLimitX
      const visualDelta = (lastVisualLayout?.rightX ?? Number.NaN) - noteRightLimitX
      const spacingDelta = (lastVisualLayout?.spacingRightX ?? Number.NaN) - noteRightLimitX
      const barlineHeadDelta = lastHeadRightX - measureEndBarX
      const guardDelta = (lastVisualLayout?.rightX ?? Number.NaN) - guardEndX
      const hasVisualOverflow = Number.isFinite(visualDelta) && visualDelta > 0
      if (hasVisualOverflow) overflowCount += 1

      lines.push(
        [
          `- pair ${pairIndex}:`,
          `lastHead=${lastHeadLayout ? `${lastHeadLayout.staff}:${lastHeadLayout.id}` : 'n/a'}`,
          `lastVisual=${lastVisualLayout ? `${lastVisualLayout.staff}:${lastVisualLayout.id}` : 'n/a'}`,
          `lastHeadX=${formatDebugCoord(lastHeadLayout?.x)}`,
          `lastHeadRightX=${formatDebugCoord(lastHeadRightX)}`,
          `lastVisualRightX=${formatDebugCoord(lastVisualLayout?.rightX)}`,
          `lastSpacingRightX=${formatDebugCoord(lastVisualLayout?.spacingRightX)}`,
          `measureEndBarX=${formatDebugCoord(measureEndBarX)}`,
          `noteRightLimitX=${formatDebugCoord(noteRightLimitX)}`,
          `headDelta=${formatDebugCoord(headDelta)}`,
          `barlineHeadDelta=${formatDebugCoord(barlineHeadDelta)}`,
          `visualDelta=${formatDebugCoord(visualDelta)}`,
          `spacingDelta=${formatDebugCoord(spacingDelta)}`,
          `guardDelta=${formatDebugCoord(guardDelta)}`,
          `overflow=${hasVisualOverflow ? 'YES' : 'NO'}`,
        ].join(' '),
      )
    })

    lines.splice(4, 0, `renderedOverflowCount(visualDelta>0): ${overflowCount}`)
    const report = lines.join('\n')
    setMeasureEdgeDebugReport(report)
    console.log(report)
  }
  const clearMeasureEdgeDebugReport = () => {
    setMeasureEdgeDebugReport('')
  }

  const dumpAllMeasureCoordinateReport = useCallback(() => {
    const measureLayouts = measureLayoutsRef.current
    const noteLayoutsByPair = noteLayoutsByPairRef.current
    const pairs = measurePairsRef.current
    const toRoundedNumber = (value: number | null | undefined, digits: number): number | null => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      return Number(value.toFixed(digits))
    }
    const buildOnsetTicksByNoteIndex = (staffNotes: ScoreNote[]): number[] => {
      const onsetTicks: number[] = []
      let cursor = 0
      staffNotes.forEach((note) => {
        onsetTicks.push(cursor)
        const ticks = DURATION_TICKS[note.duration]
        const safeTicks = Number.isFinite(ticks) ? Math.max(1, ticks) : TICKS_PER_BEAT
        cursor += safeTicks
      })
      return onsetTicks
    }
    const rows = pairs.map((pair, pairIndex) => {
      const measureLayout = measureLayouts.get(pairIndex) ?? null
      const pairLayouts = noteLayoutsByPair.get(pairIndex) ?? []
      const trebleOnsetTicksByIndex = buildOnsetTicksByNoteIndex(pair.treble)
      const bassOnsetTicksByIndex = buildOnsetTicksByNoteIndex(pair.bass)
      const axisPointBuckets = new Map<
        number,
        { xTotal: number; xCount: number; trebleNoteCount: number; bassNoteCount: number }
      >()
      pairLayouts.forEach((layout) => {
        const onsetTicks =
          layout.staff === 'treble'
            ? (trebleOnsetTicksByIndex[layout.noteIndex] ?? null)
            : (bassOnsetTicksByIndex[layout.noteIndex] ?? null)
        if (typeof onsetTicks !== 'number' || !Number.isFinite(onsetTicks)) return
        const bucket = axisPointBuckets.get(onsetTicks) ?? {
          xTotal: 0,
          xCount: 0,
          trebleNoteCount: 0,
          bassNoteCount: 0,
        }
        if (Number.isFinite(layout.x)) {
          bucket.xTotal += layout.x
          bucket.xCount += 1
        }
        if (layout.staff === 'treble') {
          bucket.trebleNoteCount += 1
        } else {
          bucket.bassNoteCount += 1
        }
        axisPointBuckets.set(onsetTicks, bucket)
      })
      const orderedOnsets = [...axisPointBuckets.keys()].sort((left, right) => left - right)
      const timeAxisPointIndexByOnset = new Map<number, number>()
      const timeAxisPointXByOnset = new Map<number, number | null>()
      const timeAxisPoints = orderedOnsets.map((onsetTicks, pointIndex) => {
        const bucket = axisPointBuckets.get(onsetTicks)
        const averagedX =
          bucket && bucket.xCount > 0 ? toRoundedNumber(bucket.xTotal / bucket.xCount, 3) : null
        timeAxisPointIndexByOnset.set(onsetTicks, pointIndex)
        timeAxisPointXByOnset.set(onsetTicks, averagedX)
        const trebleNoteCount = bucket?.trebleNoteCount ?? 0
        const bassNoteCount = bucket?.bassNoteCount ?? 0
        return {
          pointIndex,
          onsetTicksInMeasure: onsetTicks,
          onsetBeatsInMeasure: toRoundedNumber(onsetTicks / TICKS_PER_BEAT, 4),
          x: averagedX,
          noteCount: trebleNoteCount + bassNoteCount,
          trebleNoteCount,
          bassNoteCount,
        }
      })
      const layoutRows = pairLayouts
        .slice()
        .sort((left, right) => {
          if (left.staff !== right.staff) return left.staff.localeCompare(right.staff)
          if (left.noteIndex !== right.noteIndex) return left.noteIndex - right.noteIndex
          return left.x - right.x
        })
        .map((layout) => {
          const sourceNote = layout.staff === 'treble' ? pair.treble[layout.noteIndex] : pair.bass[layout.noteIndex]
          const onsetTicksInMeasure =
            sourceNote && layout.staff === 'treble'
              ? (trebleOnsetTicksByIndex[layout.noteIndex] ?? null)
              : sourceNote
                ? (bassOnsetTicksByIndex[layout.noteIndex] ?? null)
                : null
          return {
            staff: layout.staff,
            noteId: layout.id,
            noteIndex: layout.noteIndex,
            pitch: sourceNote?.pitch ?? null,
            duration: sourceNote?.duration ?? null,
            durationTicksInMeasure:
              sourceNote && Number.isFinite(DURATION_TICKS[sourceNote.duration])
                ? DURATION_TICKS[sourceNote.duration]
                : null,
            onsetTicksInMeasure:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? onsetTicksInMeasure
                : null,
            onsetBeatsInMeasure:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? toRoundedNumber(onsetTicksInMeasure / TICKS_PER_BEAT, 4)
                : null,
            timeAxisPointIndex:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? (timeAxisPointIndexByOnset.get(onsetTicksInMeasure) ?? null)
                : null,
            timeAxisPointX:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? (timeAxisPointXByOnset.get(onsetTicksInMeasure) ?? null)
                : null,
            x: layout.x,
            rightX: layout.rightX,
            spacingRightX: layout.spacingRightX,
            noteHeads: layout.noteHeads.map((head) => ({
              keyIndex: head.keyIndex,
              pitch: head.pitch,
              x: head.x,
              y: head.y,
            })),
            accidentalCoords: Object.entries(layout.accidentalRightXByKeyIndex)
              .map(([rawKeyIndex, rightX]) => ({
                keyIndex: Number(rawKeyIndex),
                rightX,
              }))
              .filter((entry) => Number.isFinite(entry.keyIndex) && Number.isFinite(entry.rightX))
              .sort((left, right) => left.keyIndex - right.keyIndex),
          }
        })

      const maxVisualRightX =
        layoutRows.length > 0 ? layoutRows.reduce((maxX, row) => Math.max(maxX, row.rightX), Number.NEGATIVE_INFINITY) : null
      const maxSpacingRightX =
        layoutRows.length > 0
          ? layoutRows.reduce((maxX, row) => Math.max(maxX, row.spacingRightX), Number.NEGATIVE_INFINITY)
          : null

      return {
        pairIndex,
        rendered: measureLayout !== null,
        measureX: measureLayout?.measureX ?? null,
        measureWidth: measureLayout?.measureWidth ?? null,
        systemTop: measureLayout?.systemTop ?? null,
        trebleY: measureLayout?.trebleY ?? null,
        bassY: measureLayout?.bassY ?? null,
        measureStartBarX: measureLayout?.measureX ?? null,
        measureEndBarX: measureLayout ? measureLayout.measureX + measureLayout.measureWidth : null,
        noteStartX: measureLayout?.noteStartX ?? null,
        noteEndX: measureLayout?.noteEndX ?? null,
        timeAxisTicksPerBeat: TICKS_PER_BEAT,
        timeAxisPoints,
        maxVisualRightX,
        maxSpacingRightX,
        overflowVsNoteEndX:
          measureLayout && typeof maxSpacingRightX === 'number'
            ? Number((maxSpacingRightX - measureLayout.noteEndX).toFixed(3))
            : null,
        overflowVsMeasureEndBarX:
          measureLayout && typeof maxSpacingRightX === 'number'
            ? Number((maxSpacingRightX - (measureLayout.measureX + measureLayout.measureWidth)).toFixed(3))
            : null,
        notes: layoutRows,
      }
    })

    return {
      generatedAt: new Date().toISOString(),
      totalMeasureCount: pairs.length,
      renderedMeasureCount: rows.filter((row) => row.rendered).length,
      visibleSystemRange: { ...visibleSystemRange },
      rows,
    }
  }, [visibleSystemRange])

  useEffect(() => {
    return () => {
      if (firstMeasureDebugRafRef.current !== null) {
        window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const debugApi = {
      importMusicXmlText: (xmlText: string) => {
        importMusicXmlText(xmlText)
      },
      getImportFeedback: () => importFeedbackRef.current,
      getScaleConfig: () => ({
        autoScaleEnabled,
        manualScalePercent: safeManualScalePercent,
        scoreScale,
        isHorizontalView,
        spacingLayoutMode,
      }),
      setAutoScaleEnabled: (enabled: boolean) => {
        setAutoScaleEnabled(Boolean(enabled))
      },
      setManualScalePercent: (nextPercent: number) => {
        setManualScalePercent(clampScalePercent(nextPercent))
      },
      dumpAllMeasureCoordinates: () => dumpAllMeasureCoordinateReport(),
      getDragPreviewFrames: () =>
        dragDebugFramesRef.current.map((frame) => ({
          ...frame,
          rows: frame.rows.map((row) => ({ ...row })),
        })),
      getDragSessionState: () => {
        const drag = dragRef.current
        if (!drag) return null
        return {
          noteId: drag.noteId,
          staff: drag.staff,
          keyIndex: drag.keyIndex,
          pairIndex: drag.pairIndex,
          noteIndex: drag.noteIndex,
          pitch: drag.pitch,
          previewStarted: drag.previewStarted,
        }
      },
      getOverlayDebugInfo: () => {
        const overlay = scoreOverlayRef.current
        const surface = scoreRef.current
        if (!overlay || !surface) return null
        const overlayClientRect = overlay.getBoundingClientRect()
        const surfaceClientRect = surface.getBoundingClientRect()
        return {
          scoreScale,
          overlayRectInScore: overlayLastRectRef.current
            ? { ...overlayLastRectRef.current }
            : null,
          overlayElement: {
            width: overlay.width,
            height: overlay.height,
            styleLeft: overlay.style.left,
            styleTop: overlay.style.top,
            styleWidth: overlay.style.width,
            styleHeight: overlay.style.height,
            display: overlay.style.display,
          },
          overlayClientRect: {
            left: overlayClientRect.left,
            top: overlayClientRect.top,
            width: overlayClientRect.width,
            height: overlayClientRect.height,
          },
          surfaceElement: {
            width: surface.width,
            height: surface.height,
          },
          surfaceClientRect: {
            left: surfaceClientRect.left,
            top: surfaceClientRect.top,
            width: surfaceClientRect.width,
            height: surfaceClientRect.height,
          },
        }
      },
      getPaging: () => ({
        currentPage: safeCurrentPage,
        pageCount,
        systemsPerPage,
        visibleSystemRange: { ...visibleSystemRange },
      }),
      goToPage: (pageIndex: number) => {
        goToPage(pageIndex)
      },
    }
    ;(window as unknown as { __scoreDebug?: typeof debugApi }).__scoreDebug = debugApi
    return () => {
      delete (window as unknown as { __scoreDebug?: typeof debugApi }).__scoreDebug
    }
  }, [
    importMusicXmlText,
    dumpAllMeasureCoordinateReport,
    goToPage,
    pageCount,
    safeCurrentPage,
    safeManualScalePercent,
    autoScaleEnabled,
    scoreScale,
    isHorizontalView,
    spacingLayoutMode,
    dragDebugFramesRef,
    dragRef,
    scoreOverlayRef,
    scoreRef,
    overlayLastRectRef,
    systemsPerPage,
    visibleSystemRange,
  ])

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">交互式乐谱原型版</p>
        <h1>实时五线谱预览 + 拖拽编辑</h1>
        <p className="subtitle">
          A4 样式乐谱页面，自动跨小节换行。可导入乐谱文件，并在高音/低音谱表中拖拽音符。
        </p>
      </section>

      <ScoreControls
        isPlaying={isPlaying}
        onPlayScore={playScore}
        onRunAiDraft={runAiDraft}
        onReset={resetScore}
        isHorizontalView={isHorizontalView}
        onToggleHorizontalView={() => setIsHorizontalView((current) => !current)}
        autoScaleEnabled={autoScaleEnabled}
        autoScalePercent={autoScalePercent}
        onToggleAutoScale={() => setAutoScaleEnabled((enabled) => !enabled)}
        manualScalePercent={safeManualScalePercent}
        onManualScalePercentChange={(nextPercent) => setManualScalePercent(clampScalePercent(nextPercent))}
        spacingGapGamma={timeAxisSpacingConfig.gapGamma}
        spacingBaseWeight={timeAxisSpacingConfig.gapBaseWeight}
        spacingMinGapBeats={timeAxisSpacingConfig.minGapBeats}
        spacingLeftEdgePaddingPx={timeAxisSpacingConfig.leftEdgePaddingPx}
        spacingRightEdgePaddingPx={timeAxisSpacingConfig.rightEdgePaddingPx}
        pageHorizontalPaddingPx={pageHorizontalPaddingPx}
        baseMinGap32Px={timeAxisSpacingConfig.baseMinGap32Px}
        durationGapRatio32={timeAxisSpacingConfig.durationGapRatios.thirtySecond}
        durationGapRatio16={timeAxisSpacingConfig.durationGapRatios.sixteenth}
        durationGapRatio8={timeAxisSpacingConfig.durationGapRatios.eighth}
        durationGapRatio4={timeAxisSpacingConfig.durationGapRatios.quarter}
        durationGapRatio2={timeAxisSpacingConfig.durationGapRatios.half}
        onSpacingMinGapBeatsChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            minGapBeats: clampNumber(nextValue, 0.01, 0.25),
          }))
        }
        onSpacingGapGammaChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            gapGamma: clampNumber(nextValue, 0.55, 1),
          }))
        }
        onSpacingBaseWeightChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            gapBaseWeight: clampNumber(nextValue, 0.1, 1.2),
          }))
        }
        onSpacingLeftEdgePaddingPxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            leftEdgePaddingPx: Math.round(clampNumber(nextValue, 0, 24)),
          }))
        }
        onSpacingRightEdgePaddingPxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            rightEdgePaddingPx: Math.round(clampNumber(nextValue, 0, 24)),
          }))
        }
        onPageHorizontalPaddingPxChange={(nextValue) =>
          setPageHorizontalPaddingPx(clampPageHorizontalPaddingPx(nextValue))
        }
        onBaseMinGap32PxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            baseMinGap32Px: clampBaseMinGap32Px(nextValue),
          }))
        }
        onDurationGapRatio32Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              thirtySecond: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio16Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              sixteenth: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio8Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              eighth: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio4Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              quarter: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio2Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              half: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onResetSpacingConfig={() => {
          setTimeAxisSpacingConfig({
            ...DEFAULT_TIME_AXIS_SPACING_CONFIG,
            durationGapRatios: { ...DEFAULT_TIME_AXIS_SPACING_CONFIG.durationGapRatios },
          })
          setPageHorizontalPaddingPx(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
        }}
        onOpenMusicXmlFilePicker={openMusicXmlFilePicker}
        onLoadSampleMusicXml={loadSampleMusicXml}
        onExportMusicXmlFile={exportMusicXmlFile}
        onImportMusicXmlFromTextarea={importMusicXmlFromTextarea}
        fileInputRef={fileInputRef}
        onMusicXmlFileChange={onMusicXmlFileChange}
        musicXmlInput={musicXmlInput}
        onMusicXmlInputChange={setMusicXmlInput}
        importFeedback={importFeedback}
        rhythmPreset={rhythmPreset}
        onApplyRhythmPreset={applyRhythmPreset}
      />

      <ScoreBoard
        scoreScrollRef={scoreScrollRef}
        displayScoreWidth={displayScoreWidth}
        displayScoreHeight={displayScoreHeight}
        scoreScale={scoreScale}
        isHorizontalView={isHorizontalView}
        currentPage={safeCurrentPage}
        pageCount={pageCount}
        onPrevPage={goToPrevPage}
        onNextPage={goToNextPage}
        onGoToPage={goToPage}
        draggingSelection={draggingSelection}
        scoreRef={scoreRef}
        scoreOverlayRef={scoreOverlayRef}
        onBeginDrag={onBeginDragWithFirstMeasureDebug}
        onSurfacePointerMove={onSurfacePointerMove}
        onEndDrag={onEndDragWithFirstMeasureDebug}
        selectedStaffLabel={activeSelection.staff === 'treble' ? '高音谱表' : '低音谱表'}
        selectedPitchLabel={toDisplayPitch(currentSelectionPitch)}
        selectedDurationLabel={toDisplayDuration(currentSelection.duration)}
        selectedPosition={currentSelectionPosition}
        selectedPoolSize={activePool.length}
        trebleSequenceText={trebleSequenceText}
        bassSequenceText={bassSequenceText}
        dragDebugReport={dragDebugReport}
        onDumpDragLog={dumpDragDebugReport}
        onClearDragLog={clearDragDebugReport}
        measureEdgeDebugReport={measureEdgeDebugReport}
        onDumpMeasureEdgeLog={dumpMeasureEdgeDebugReport}
        onClearMeasureEdgeLog={clearMeasureEdgeDebugReport}
      />

      {isImportLoading && (
        <div className="import-modal" role="status" aria-live="polite" aria-label="导入进行中">
          <div className="import-modal-card">
            <h3>正在加载乐谱</h3>
            <p>{importFeedback.message}</p>
            <div className="import-modal-track">
              <div
                className="import-modal-bar"
                style={{ width: `${importProgressPercent === null ? 45 : Math.max(4, importProgressPercent)}%` }}
              />
            </div>
            <p className="import-modal-percent">
              {importProgressPercent === null ? '处理中...' : `${importProgressPercent}%`}
            </p>
          </div>
        </div>
      )}
    </main>
  )
}

export default App





