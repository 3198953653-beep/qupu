import { startTransition } from 'react'
import type { Dispatch, MutableRefObject, PointerEvent, SetStateAction } from 'react'
import { commitDragPitchToScoreData } from './dragInteractions'
import {
  handleBeginDragPointer,
  handleEndDragPointer,
  handleSurfacePointerMove,
} from './dragPointerHandlers'
import {
  clearDragOverlayCanvas,
  drawDragPreviewOverlay,
  drawSelectionOverlay,
  getDragDebugReportText,
} from './dragPreviewController'
import { flushPendingDragFrame, scheduleDragCommitFrame } from './dragScheduler'
import { flattenBassFromPairs, flattenTrebleFromPairs } from './scoreOps'
import type { TimeAxisSpacingConfig } from './layout/timeAxisSpacing'
import type { Renderer } from 'vexflow'
import type { HitGridIndex } from './layout/hitTest'
import type {
  DragDebugSnapshot,
  DragState,
  ImportedNoteLocation,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Pitch,
  ScoreNote,
  Selection,
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
  setMeasurePairsFromImport: StateSetter<MeasurePair[] | null>
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setActiveSelection: StateSetter<Selection>
  setDraggingSelection: StateSetter<Selection | null>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  trebleNoteById: Map<string, ScoreNote>
  bassNoteById: Map<string, ScoreNote>
  pitches: Pitch[]
  previewDefaultAccidentalOffsetPx: number
  previewStartThresholdPx: number
  backend: number
  scoreScale: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
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
    pitches,
    previewDefaultAccidentalOffsetPx,
    previewStartThresholdPx,
    backend,
    scoreScale,
    timeAxisSpacingConfig,
  } = params

  const clearDragOverlay = () => {
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
        scoreScale,
        timeAxisSpacingConfig,
      },
    })
  }

  const drawDragMeasurePreview = (drag: DragState) => {
    drawDragPreviewOverlay({
      drag,
      noteLayoutsByPair: noteLayoutsByPairRef.current,
      dragRef,
      previewDefaultAccidentalOffsetPx,
      dragPreviewFrameRef,
      measureLayouts: measureLayoutsRef.current,
      measurePairs: measurePairsRef.current,
      overlayRuntime: {
        overlay: scoreOverlayRef.current,
        surface: scoreRef.current,
        overlayRendererRef,
        overlayRendererSizeRef,
        overlayLastRectRef,
        backend,
        scoreScale,
        timeAxisSpacingConfig,
      },
      dragDebugFramesRef,
    })
  }

  const applyDragPreview = (drag: DragState, pitch: Pitch) => {
    if (pitch === drag.pitch) return
    const nextDrag = { ...drag, pitch }
    dragRef.current = nextDrag
    drawDragMeasurePreview(nextDrag)
  }

  const commitDragPitchToScore = (drag: DragState, pitch: Pitch) => {
    const result = commitDragPitchToScoreData({
      drag,
      pitch,
      importedPairs: measurePairsFromImportRef.current,
      importedNoteLookup: importedNoteLookupRef.current,
      currentPairs: measurePairsRef.current,
      importedKeyFifths: measureKeyFifthsFromImportRef.current,
    })
    if (result.fromImported) {
      measurePairsFromImportRef.current = result.normalizedPairs
      setMeasurePairsFromImport(result.normalizedPairs)
      // Keep drag release responsive on large imported scores: sync flat note lists at low priority.
      startTransition(() => {
        setNotes(flattenTrebleFromPairs(result.normalizedPairs))
        setBassNotes(flattenBassFromPairs(result.normalizedPairs))
      })
      return
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
      setDraggingSelection,
    })
  }

  const beginDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    handleBeginDragPointer({
      event,
      surface: scoreRef.current,
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
      setActiveSelection,
      setDraggingSelection,
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
