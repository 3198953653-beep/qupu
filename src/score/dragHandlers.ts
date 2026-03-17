import { startTransition } from 'react'
import type { Dispatch, MutableRefObject, PointerEvent, SetStateAction } from 'react'
import { commitDragPitchToScoreData } from './dragInteractions'
import {
  handleBeginDragPointer,
  handleEndDragPointer,
  handleSurfacePointerMove,
} from './dragPointerHandlers'
import type { SelectionPointerMode } from './dragPointerHandlers'
import type { BlankPointerPayload } from './dragPointerHandlers'
import {
  clearDragOverlayCanvas,
  drawSelectionOverlay,
  getDragDebugReportText,
  ensureDragLayoutCache,
} from './dragPreviewController'
import { flushPendingDragFrame, scheduleDragCommitFrame } from './dragScheduler'
import { flattenBassFromPairs, flattenTrebleFromPairs } from './scoreOps'
import type { TimeAxisSpacingConfig } from './layout/timeAxisSpacing'
import type { MeasureTimelineBundle } from './timeline/types'
import type { Renderer } from 'vexflow'
import type { HitGridIndex } from './layout/hitTest'
import type {
  DragDebugSnapshot,
  DragState,
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Pitch,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
  TieSelection,
} from './types'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useDragHandlers(params: {
  scoreRef: MutableRefObject<HTMLCanvasElement | null>
  scoreOverlayRef: MutableRefObject<HTMLCanvasElement | null>
  noteLayoutsRef: MutableRefObject<NoteLayout[]>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  noteLayoutByKeyRef: MutableRefObject<Map<string, NoteLayout>>
  hitGridRef: MutableRefObject<HitGridIndex | null>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  measureTimelineBundlesRef: MutableRefObject<Map<number, MeasureTimelineBundle>>
  measurePairsRef: MutableRefObject<MeasurePair[]>
  dragDebugFramesRef: MutableRefObject<DragDebugSnapshot[]>
  dragRef: MutableRefObject<DragState | null>
  dragPreviewFrameRef: MutableRefObject<number>
  dragRafRef: MutableRefObject<number | null>
  dragPendingRef: MutableRefObject<{ drag: DragState; pitch: Pitch } | null>
  overlayRendererRef: MutableRefObject<Renderer | null>
  overlayRendererSizeRef: MutableRefObject<{ width: number; height: number }>
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
  setDragDebugReport: StateSetter<string>
  setLayoutReflowHint: (hint: LayoutReflowHint | null) => void
  setMeasurePairsFromImport: StateSetter<MeasurePair[] | null>
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setDragPreviewState: StateSetter<DragState | null>
  setActiveSelection: StateSetter<Selection>
  setDraggingSelection: StateSetter<Selection | null>
  currentSelections: Selection[]
  onSelectionPointerDown?: (
    selection: Selection,
    nextSelections: Selection[],
    mode: SelectionPointerMode,
  ) => void
  onAccidentalPointerDown?: (selection: Selection) => void
  onTiePointerDown?: (selection: TieSelection) => void
  onBeforeApplyScoreChange?: (sourcePairs: MeasurePair[]) => void
  onBlankPointerDown?: (payload: BlankPointerPayload) => void
  onSelectionActivated?: () => void
  onSelectionTapRelease?: (selection: Selection) => void
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  trebleNoteById: Map<string, ScoreNote>
  bassNoteById: Map<string, ScoreNote>
  pitches: Pitch[]
  previewDefaultAccidentalOffsetPx: number
  previewStartThresholdPx: number
  backend: number
  scoreScaleX: number
  scoreScaleY: number
  renderQualityScaleX?: number
  renderQualityScaleY?: number
  viewportXRange?: { startX: number; endX: number } | null
  renderOffsetX?: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
}): {
  clearDragOverlay: () => void
  dumpDragDebugReport: () => void
  clearDragDebugReport: () => void
  drawSelectionMeasureOverlay: (selection: Selection) => void
  drawDragMeasurePreview: (drag: DragState) => void
  applyDragPreview: (drag: DragState, pitch: Pitch) => void
  commitDragPitchToScore: (drag: DragState, pitch: Pitch) => void
  flushPendingDrag: () => void
  scheduleDragCommit: (drag: DragState, pitch: Pitch) => void
  onSurfacePointerMove: (event: PointerEvent<HTMLCanvasElement>) => void
  endDrag: (event: PointerEvent<HTMLCanvasElement>) => void
  beginDrag: (event: PointerEvent<HTMLCanvasElement>) => void
} {
  const {
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
    setLayoutReflowHint,
    setMeasurePairsFromImport,
    setNotes,
    setBassNotes,
    setDragPreviewState,
    setActiveSelection,
    setDraggingSelection,
    currentSelections,
    onSelectionPointerDown,
    onAccidentalPointerDown,
    onTiePointerDown,
    onBeforeApplyScoreChange,
    onBlankPointerDown,
    onSelectionActivated,
    onSelectionTapRelease,
    measurePairsFromImportRef,
    importedNoteLookupRef,
    measureKeyFifthsFromImportRef,
    trebleNoteById,
    bassNoteById,
    pitches,
    previewDefaultAccidentalOffsetPx,
    previewStartThresholdPx,
    backend,
    scoreScaleX,
    scoreScaleY,
    renderQualityScaleX = 1,
    renderQualityScaleY = 1,
    viewportXRange = null,
    renderOffsetX = 0,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
  } = params

  const clearDragOverlay = () => {
    setDragPreviewState(null)
    clearDragOverlayCanvas({
      overlay: scoreOverlayRef.current,
      overlayLastRectRef,
    })
  }

  const dumpDragDebugReport = () => {
    setDragDebugReport(getDragDebugReportText(dragDebugFramesRef.current))
  }

  const clearDragDebugReport = () => {
    dragDebugFramesRef.current = []
    setDragDebugReport('')
  }

  const drawSelectionMeasureOverlay = (selection: Selection) => {
    drawSelectionOverlay({
      selection,
      noteLayoutByKey: noteLayoutByKeyRef.current,
      measureLayouts: measureLayoutsRef.current,
      measurePairs: measurePairsRef.current,
      overlayRuntime: {
        overlay: scoreOverlayRef.current,
        surface: scoreRef.current,
        overlayRendererRef,
        overlayRendererSizeRef,
        overlayLastRectRef,
        backend,
        scoreScaleX,
        scoreScaleY,
        renderQualityScaleX,
        renderQualityScaleY,
        viewportXRange,
        renderOffsetX,
        timeAxisSpacingConfig,
        spacingLayoutMode,
        measureTimelineBundles: measureTimelineBundlesRef.current,
      },
    })
  }

  const drawDragMeasurePreview = (drag: DragState) => {
    // Use main-canvas visible-window repaint during drag preview to avoid
    // overlay/main transform drift and keep geometry in a single render path.
    const cachedDrag = ensureDragLayoutCache({
      drag,
      noteLayoutsByPair: noteLayoutsByPairRef.current,
      previewDefaultAccidentalOffsetPx,
      dragRef,
    })
    dragPreviewFrameRef.current += 1
    setDragPreviewState(cachedDrag)
    // Keep existing debug report path available; frames are captured by overlay mode only.
    if (dragDebugFramesRef.current.length > 360) {
      dragDebugFramesRef.current.splice(0, dragDebugFramesRef.current.length - 360)
    }
  }

  const applyDragPreview = (drag: DragState, pitch: Pitch) => {
    if (pitch === drag.pitch) return
    const nextDrag = { ...drag, pitch }
    dragRef.current = nextDrag
    drawDragMeasurePreview(nextDrag)
  }

  const commitDragPitchToScore = (drag: DragState, pitch: Pitch) => {
    const sourceImportedPairs = measurePairsFromImportRef.current
    const sourceCurrentPairs = measurePairsRef.current
    const result = commitDragPitchToScoreData({
      drag,
      pitch,
      importedPairs: sourceImportedPairs,
      importedNoteLookup: importedNoteLookupRef.current,
      currentPairs: sourceCurrentPairs,
      importedKeyFifths: measureKeyFifthsFromImportRef.current,
    })
    if (result.layoutReflowHint.scoreContentChanged) {
      setLayoutReflowHint(result.layoutReflowHint)
    } else {
      setLayoutReflowHint(null)
    }
    if (result.fromImported) {
      if (result.normalizedPairs !== sourceImportedPairs) {
        onBeforeApplyScoreChange?.(sourceImportedPairs ?? [])
      }
      measurePairsFromImportRef.current = result.normalizedPairs
      setMeasurePairsFromImport(result.normalizedPairs)
      // Keep drag release responsive on large imported scores: sync flat note lists at low priority.
      startTransition(() => {
        setNotes(flattenTrebleFromPairs(result.normalizedPairs))
        setBassNotes(flattenBassFromPairs(result.normalizedPairs))
      })
      return
    }
    if (result.normalizedPairs !== sourceCurrentPairs) {
      onBeforeApplyScoreChange?.(sourceCurrentPairs)
    }
    setNotes(result.trebleNotes)
    setBassNotes(result.bassNotes)
  }

  const flushPendingDrag = () => {
    flushPendingDragFrame({
      dragRafRef,
      dragPendingRef,
      applyDragPreview,
    })
  }

  const scheduleDragCommit = (drag: DragState, pitch: Pitch) => {
    if (pitch === drag.pitch) return
    scheduleDragCommitFrame({
      drag,
      pitch,
      dragRafRef,
      dragPendingRef,
      flushPendingDrag,
    })
  }

  const onSurfacePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    handleSurfacePointerMove({
      event,
      dragRef,
      previewStartThresholdPx,
      pitches,
      drawDragMeasurePreview,
      scheduleDragCommit,
    })
  }

  const endDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    handleEndDragPointer({
      event,
      dragRef,
      dragRafRef,
      dragPendingRef,
      commitDragPitchToScore,
      dragPreviewFrameRef,
      clearDragOverlay,
      setActiveSelection,
      setDraggingSelection,
      onSelectionActivated,
      onSelectionTapRelease,
    })
  }

  const beginDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    handleBeginDragPointer({
      event,
      surface: scoreRef.current,
      scoreScaleX,
      scoreScaleY,
      noteLayouts: noteLayoutsRef.current,
      hitGrid: hitGridRef.current,
      dragPreviewFrameRef,
      dragDebugFramesRef,
      clearDragOverlay,
      importedPairs: measurePairsFromImportRef.current,
      importedNoteLookup: importedNoteLookupRef.current,
      trebleNoteById,
      bassNoteById,
      currentMeasurePairs: measurePairsRef.current,
      measureLayouts: measureLayoutsRef.current,
      importedKeyFifths: measureKeyFifthsFromImportRef.current,
      pitches,
      dragRef,
      currentSelections,
      setActiveSelection,
      setDraggingSelection,
      onSelectionPointerDown,
      onAccidentalPointerDown,
      onTiePointerDown,
      onBlankPointerDown,
      onSelectionActivated,
    })
  }

  return {
    clearDragOverlay,
    dumpDragDebugReport,
    clearDragDebugReport,
    drawSelectionMeasureOverlay,
    drawDragMeasurePreview,
    applyDragPreview,
    commitDragPitchToScore,
    flushPendingDrag,
    scheduleDragCommit,
    onSurfacePointerMove,
    endDrag,
    beginDrag,
  }
}
