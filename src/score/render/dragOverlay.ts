import type { MutableRefObject } from 'react'
import { getLayoutNoteKey } from '../layout/renderPosition'
import { paintOverlayMeasure } from './overlayPaint'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type {
  DragDebugSnapshot,
  DragState,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Selection,
  SpacingLayoutMode,
} from '../types'

export function drawSelectionMeasureOverlay(params: {
  selection: Selection
  noteLayoutByKey: Map<string, NoteLayout>
  measureLayouts: Map<number, MeasureLayout>
  measurePairs: MeasurePair[]
  ensureOverlayCanvasForRect: (rect: MeasureLayout['overlayRect']) => { x: number; y: number; width: number; height: number } | null
  getOverlayContext: () => ReturnType<import('vexflow').Renderer['getContext']> | null
  clearDragOverlay: () => void
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
}): void {
  const {
    selection,
    noteLayoutByKey,
    measureLayouts,
    measurePairs,
    ensureOverlayCanvasForRect,
    getOverlayContext,
    clearDragOverlay,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
  } = params

  const selectedKey = getLayoutNoteKey(selection.staff, selection.noteId)
  const selectedLayout = noteLayoutByKey.get(selectedKey)
  if (!selectedLayout) {
    clearDragOverlay()
    return
  }

  const measureLayout = measureLayouts.get(selectedLayout.pairIndex)
  const measure = measurePairs[selectedLayout.pairIndex]
  if (!measureLayout || !measure) {
    clearDragOverlay()
    return
  }

  const selectionShowKeySignature = !measureLayout.isSystemStart && measureLayout.showKeySignature
  const selectionShowTimeSignature = !measureLayout.isSystemStart && measureLayout.showTimeSignature
  const overlayFrame = ensureOverlayCanvasForRect(measureLayout.overlayRect)
  if (!overlayFrame) return

  const overlayContext = getOverlayContext()
  if (!overlayContext) return

  paintOverlayMeasure({
    overlayContext,
    overlayFrame,
    drawParams: {
      measure,
      pairIndex: measureLayout.pairIndex,
      measureX: measureLayout.measureX,
      measureWidth: measureLayout.measureWidth,
      trebleY: measureLayout.trebleY,
      bassY: measureLayout.bassY,
      isSystemStart: measureLayout.isSystemStart,
      keyFifths: measureLayout.keyFifths,
      showKeySignature: selectionShowKeySignature,
      timeSignature: measureLayout.timeSignature,
      showTimeSignature: selectionShowTimeSignature,
      endTimeSignature: measureLayout.endTimeSignature,
      showEndTimeSignature: measureLayout.showEndTimeSignature,
      activeSelection: selection,
      draggingSelection: null,
      collectLayouts: false,
      suppressSystemDecorations: true,
      noteStartXOverride: measureLayout.noteStartX,
      formatWidthOverride: measureLayout.formatWidth,
      timeAxisSpacingConfig,
      spacingLayoutMode,
    },
  })
}

export function drawDragMeasurePreview(params: {
  drag: DragState
  ensureDragLayoutCache: (drag: DragState) => DragState
  dragPreviewFrameRef: MutableRefObject<number>
  measureLayouts: Map<number, MeasureLayout>
  measurePairs: MeasurePair[]
  ensureOverlayCanvasForRect: (rect: MeasureLayout['overlayRect']) => { x: number; y: number; width: number; height: number } | null
  getOverlayContext: () => ReturnType<import('vexflow').Renderer['getContext']> | null
  dragDebugFramesRef: MutableRefObject<DragDebugSnapshot[]>
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
}): void {
  const {
    drag,
    ensureDragLayoutCache,
    dragPreviewFrameRef,
    measureLayouts,
    measurePairs,
    ensureOverlayCanvasForRect,
    getOverlayContext,
    dragDebugFramesRef,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
  } = params

  const dragWithLayout = ensureDragLayoutCache(drag)
  dragPreviewFrameRef.current += 1
  const measureLayout = measureLayouts.get(dragWithLayout.pairIndex)
  const measure = measurePairs[dragWithLayout.pairIndex]
  if (!measureLayout || !measure) return
  const previewShowKeySignature = !measureLayout.isSystemStart && measureLayout.showKeySignature
  const previewShowTimeSignature = !measureLayout.isSystemStart && measureLayout.showTimeSignature

  const overlayFrame = ensureOverlayCanvasForRect(measureLayout.overlayRect)
  if (!overlayFrame) return

  const overlayContext = getOverlayContext()
  if (!overlayContext) return

  paintOverlayMeasure({
    overlayContext,
    overlayFrame,
    drawParams: {
      measure,
      pairIndex: measureLayout.pairIndex,
      measureX: measureLayout.measureX,
      measureWidth: measureLayout.measureWidth,
      trebleY: measureLayout.trebleY,
      bassY: measureLayout.bassY,
      isSystemStart: measureLayout.isSystemStart,
      keyFifths: measureLayout.keyFifths,
      showKeySignature: previewShowKeySignature,
      timeSignature: measureLayout.timeSignature,
      showTimeSignature: previewShowTimeSignature,
      endTimeSignature: measureLayout.endTimeSignature,
      showEndTimeSignature: measureLayout.showEndTimeSignature,
      activeSelection: null,
      draggingSelection: null,
      previewNote: {
        noteId: dragWithLayout.noteId,
        staff: dragWithLayout.staff,
        pitch: dragWithLayout.pitch,
        keyIndex: dragWithLayout.keyIndex,
      },
      previewAccidentalStateBeforeNote: dragWithLayout.accidentalStateBeforeNote,
      collectLayouts: false,
      suppressSystemDecorations: true,
      noteStartXOverride: measureLayout.noteStartX,
      freezePreviewAccidentalLayout: false,
      formatWidthOverride: measureLayout.formatWidth,
      timeAxisSpacingConfig,
      spacingLayoutMode,
      staticNoteXById: dragWithLayout.staticNoteXById,
      staticAccidentalRightXById: dragWithLayout.previewAccidentalRightXById,
      debugCapture: {
        frame: dragPreviewFrameRef.current,
        draggedNoteId: dragWithLayout.noteId,
        draggedStaff: dragWithLayout.staff,
        staticByNoteKey: dragWithLayout.debugStaticByNoteKey,
        pushSnapshot: (snapshot) => {
          const list = dragDebugFramesRef.current
          list.push(snapshot)
          if (list.length > 360) {
            list.splice(0, list.length - 360)
          }
        },
      },
    },
  })
}
