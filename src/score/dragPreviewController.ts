import type { MutableRefObject } from 'react'
import type { Renderer } from 'vexflow'
import {
  buildDragDebugStaticByNoteKey,
  buildPreviewAccidentalRightXFromStatic,
  buildStaticNoteXById,
} from './dragCache'
import { buildDragDebugReport } from './dragDebugReport'
import {
  clearOverlayCanvas,
  ensureOverlayCanvasForRect as ensureOverlayCanvasForRectHelper,
  getOverlayRendererContext,
} from './overlayCanvas'
import {
  drawDragMeasurePreview as drawDragMeasurePreviewHelper,
  drawSelectionMeasureOverlay as drawSelectionMeasureOverlayHelper,
} from './render/dragOverlay'
import type { TimeAxisSpacingConfig } from './layout/timeAxisSpacing'
import type {
  DragDebugSnapshot,
  DragState,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Selection,
} from './types'

const EMPTY_DRAG_REPORT_MESSAGE = 'No drag preview frames captured yet. Drag a note first, then click this button again.'

type OverlayRuntime = {
  overlay: HTMLCanvasElement | null
  overlayRendererRef: MutableRefObject<Renderer | null>
  overlayRendererSizeRef: MutableRefObject<{ width: number; height: number }>
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
  backend: number
  scoreScale: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
}

function buildOverlayAccessors(runtime: OverlayRuntime) {
  return {
    clear: () => {
      clearOverlayCanvas(runtime.overlay, runtime.overlayLastRectRef)
    },
    ensureRect: (rect: MeasureLayout['overlayRect']) =>
      ensureOverlayCanvasForRectHelper({
        overlay: runtime.overlay,
        rect,
        overlayRendererRef: runtime.overlayRendererRef,
        overlayRendererSizeRef: runtime.overlayRendererSizeRef,
        overlayLastRectRef: runtime.overlayLastRectRef,
        scoreScale: runtime.scoreScale,
      }),
    getContext: () =>
      getOverlayRendererContext({
        overlay: runtime.overlay,
        overlayRendererRef: runtime.overlayRendererRef,
        overlayRendererSizeRef: runtime.overlayRendererSizeRef,
        backend: runtime.backend,
      }),
  }
}

export function clearDragOverlayCanvas(params: {
  overlay: HTMLCanvasElement | null
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
}): void {
  clearOverlayCanvas(params.overlay, params.overlayLastRectRef)
}

export function getDragDebugReportText(frames: DragDebugSnapshot[]): string {
  return buildDragDebugReport(frames) ?? EMPTY_DRAG_REPORT_MESSAGE
}

export function ensureDragLayoutCache(params: {
  drag: DragState
  noteLayoutsByPair: Map<number, NoteLayout[]>
  previewDefaultAccidentalOffsetPx: number
  dragRef: MutableRefObject<DragState | null>
}): DragState {
  const { drag, noteLayoutsByPair, previewDefaultAccidentalOffsetPx, dragRef } = params
  if (drag.layoutCacheReady) return drag

  const debugStaticByNoteKey = buildDragDebugStaticByNoteKey(noteLayoutsByPair, drag.pairIndex)
  const nextDrag = {
    ...drag,
    layoutCacheReady: true,
    staticNoteXById: buildStaticNoteXById(noteLayoutsByPair, drag.pairIndex),
    debugStaticByNoteKey,
    previewAccidentalRightXById: buildPreviewAccidentalRightXFromStatic(
      debugStaticByNoteKey,
      previewDefaultAccidentalOffsetPx,
    ),
  }
  if (dragRef.current?.pointerId === drag.pointerId) {
    dragRef.current = nextDrag
  }
  return nextDrag
}

export function drawSelectionOverlay(params: {
  selection: Selection
  noteLayoutByKey: Map<string, NoteLayout>
  measureLayouts: Map<number, MeasureLayout>
  measurePairs: MeasurePair[]
  overlayRuntime: OverlayRuntime
}): void {
  const { selection, noteLayoutByKey, measureLayouts, measurePairs, overlayRuntime } = params
  const overlay = buildOverlayAccessors(overlayRuntime)
  drawSelectionMeasureOverlayHelper({
    selection,
    noteLayoutByKey,
    measureLayouts,
    measurePairs,
    ensureOverlayCanvasForRect: overlay.ensureRect,
    getOverlayContext: overlay.getContext,
    clearDragOverlay: overlay.clear,
    timeAxisSpacingConfig: overlayRuntime.timeAxisSpacingConfig,
  })
}

export function drawDragPreviewOverlay(params: {
  drag: DragState
  noteLayoutsByPair: Map<number, NoteLayout[]>
  dragRef: MutableRefObject<DragState | null>
  previewDefaultAccidentalOffsetPx: number
  dragPreviewFrameRef: MutableRefObject<number>
  measureLayouts: Map<number, MeasureLayout>
  measurePairs: MeasurePair[]
  overlayRuntime: OverlayRuntime
  dragDebugFramesRef: MutableRefObject<DragDebugSnapshot[]>
}): void {
  const {
    drag,
    noteLayoutsByPair,
    dragRef,
    previewDefaultAccidentalOffsetPx,
    dragPreviewFrameRef,
    measureLayouts,
    measurePairs,
    overlayRuntime,
    dragDebugFramesRef,
  } = params
  const overlay = buildOverlayAccessors(overlayRuntime)

  drawDragMeasurePreviewHelper({
    drag,
    ensureDragLayoutCache: (currentDrag) =>
      ensureDragLayoutCache({
        drag: currentDrag,
        noteLayoutsByPair,
        previewDefaultAccidentalOffsetPx,
        dragRef,
      }),
    dragPreviewFrameRef,
    measureLayouts,
    measurePairs,
    ensureOverlayCanvasForRect: overlay.ensureRect,
    getOverlayContext: overlay.getContext,
    dragDebugFramesRef,
    timeAxisSpacingConfig: overlayRuntime.timeAxisSpacingConfig,
  })
}
