import { useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import './App.css'
import {
  A4_PAGE_HEIGHT,
  A4_PAGE_WIDTH,
  INITIAL_NOTES,
  SCORE_PAGE_PADDING_X,
  PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
  PREVIEW_START_THRESHOLD_PX,
  SCORE_TOP_PADDING,
  SYSTEM_GAP_Y,
  SYSTEM_HEIGHT,
} from './score/constants'
import { buildAdaptiveSystemRanges, toDisplayDuration } from './score/layout/demand'
import { estimateRequiredMeasureWidth } from './score/layout/requiredWidth'
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
  MeasureLayout,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  Pitch,
  RhythmPresetId,
  ScoreNote,
  Selection,
  TimeSignature,
} from './score/types'

const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const INSPECTOR_SEQUENCE_PREVIEW_LIMIT = 64

const PITCHES: Pitch[] = createPianoPitches()
const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)

function toSequencePreview(notes: ScoreNote[]): string {
  if (notes.length <= INSPECTOR_SEQUENCE_PREVIEW_LIMIT) {
    return notes.map((note) => toDisplayPitch(note.pitch)).join('  |  ')
  }
  const preview = notes.slice(0, INSPECTOR_SEQUENCE_PREVIEW_LIMIT).map((note) => toDisplayPitch(note.pitch)).join('  |  ')
  return `${preview}  |  ... (+${notes.length - INSPECTOR_SEQUENCE_PREVIEW_LIMIT} more)`
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
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false)
  const [manualScalePercent, setManualScalePercent] = useState(100)

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
  const measurePairs = useMemo(
    () => measurePairsFromImport ?? buildMeasurePairs(notes, bassNotes),
    [measurePairsFromImport, notes, bassNotes],
  )
  const displayScoreWidth = A4_PAGE_WIDTH
  const displayScoreHeight = A4_PAGE_HEIGHT
  const autoScoreScale = useMemo(() => getAutoScoreScale(measurePairs.length), [measurePairs.length])
  const safeManualScalePercent = clampScalePercent(manualScalePercent)
  const scoreScale = autoScaleEnabled ? autoScoreScale : safeManualScalePercent / 100
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
  const systemUsableWidth = scoreWidth - SCORE_PAGE_PADDING_X * 2
  const systemRanges = useMemo(
    () => {
      const requiredWidthCache = new Map<string, number>()
      return buildAdaptiveSystemRanges({
        measurePairs,
        systemUsableWidth,
        measureKeyFifthsFromImport,
        measureTimeSignaturesFromImport,
        getRequiredMeasureWidth: (context) => {
          const cacheKey = [
            context.pairIndex,
            context.isSystemStart ? 1 : 0,
            context.showKeySignature ? 1 : 0,
            context.showTimeSignature ? 1 : 0,
            context.showEndTimeSignature ? 1 : 0,
            context.keyFifths,
            context.timeSignature.beats,
            context.timeSignature.beatType,
            context.nextTimeSignature.beats,
            context.nextTimeSignature.beatType,
          ].join('|')
          const cached = requiredWidthCache.get(cacheKey)
          if (cached !== undefined) return cached
          const width = estimateRequiredMeasureWidth(context)
          requiredWidthCache.set(cacheKey, width)
          return width
        },
      })
    },
    [measurePairs, systemUsableWidth, measureKeyFifthsFromImport, measureTimeSignaturesFromImport],
  )
  const systemCount = Math.max(1, systemRanges.length)
  const systemsPerPage = Math.max(
    1,
    Math.floor((displayScoreHeight - SCORE_TOP_PADDING * 2 + SYSTEM_GAP_Y) / ((SYSTEM_HEIGHT + SYSTEM_GAP_Y) * scoreScale)),
  )
  const pageCount = Math.max(1, Math.ceil(systemCount / systemsPerPage))
  const safeCurrentPage = Math.min(currentPage, pageCount - 1)
  const visibleSystemRange = useMemo(() => {
    const start = Math.min(systemCount - 1, safeCurrentPage * systemsPerPage)
    const end = Math.min(systemCount - 1, start + systemsPerPage - 1)
    return { start, end }
  }, [safeCurrentPage, systemCount, systemsPerPage])

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
    draggingSelection,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    backend: SCORE_RENDER_BACKEND,
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
  })

  const {
    playScore,
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
  const goToPrevPage = () => setCurrentPage((page) => Math.max(0, Math.min(page, pageCount - 1) - 1))
  const goToNextPage = () => setCurrentPage((page) => Math.min(pageCount - 1, Math.max(0, page) + 1))
  const goToPage = (pageIndex: number) => setCurrentPage(Math.max(0, Math.min(pageCount - 1, pageIndex)))

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Interactive Music Score MVP</p>
        <h1>Real-time Staff Preview + Drag Editing</h1>
        <p className="subtitle">
          A4-style score page with line wrapping across all measures. You can import MusicXML and drag notes in treble or bass.
        </p>
      </section>

      <ScoreControls
        isPlaying={isPlaying}
        onPlayScore={playScore}
        onRunAiDraft={runAiDraft}
        onReset={resetScore}
        autoScaleEnabled={autoScaleEnabled}
        autoScalePercent={autoScalePercent}
        onToggleAutoScale={() => setAutoScaleEnabled((enabled) => !enabled)}
        manualScalePercent={safeManualScalePercent}
        onManualScalePercentChange={(nextPercent) => setManualScalePercent(clampScalePercent(nextPercent))}
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
        currentPage={safeCurrentPage}
        pageCount={pageCount}
        onPrevPage={goToPrevPage}
        onNextPage={goToNextPage}
        onGoToPage={goToPage}
        draggingSelection={draggingSelection}
        scoreRef={scoreRef}
        scoreOverlayRef={scoreOverlayRef}
        onBeginDrag={beginDrag}
        onSurfacePointerMove={onSurfacePointerMove}
        onEndDrag={endDrag}
        selectedStaffLabel={activeSelection.staff === 'treble' ? 'Treble' : 'Bass'}
        selectedPitchLabel={toDisplayPitch(currentSelectionPitch)}
        selectedDurationLabel={toDisplayDuration(currentSelection.duration)}
        selectedPosition={currentSelectionPosition}
        selectedPoolSize={activePool.length}
        trebleSequenceText={trebleSequenceText}
        bassSequenceText={bassSequenceText}
        dragDebugReport={dragDebugReport}
        onDumpDragLog={dumpDragDebugReport}
        onClearDragLog={clearDragDebugReport}
      />

      {isImportLoading && (
        <div className="import-modal" role="status" aria-live="polite" aria-label="Import in progress">
          <div className="import-modal-card">
            <h3>Loading Score</h3>
            <p>{importFeedback.message}</p>
            <div className="import-modal-track">
              <div
                className="import-modal-bar"
                style={{ width: `${importProgressPercent === null ? 45 : Math.max(4, importProgressPercent)}%` }}
              />
            </div>
            <p className="import-modal-percent">
              {importProgressPercent === null ? 'Working...' : `${importProgressPercent}%`}
            </p>
          </div>
        </div>
      )}
    </main>
  )
}

export default App





