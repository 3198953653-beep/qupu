import type { MutableRefObject } from 'react'
import { getLayoutNoteKey } from '../layout/renderPosition'
import { drawMeasureToContext } from './drawMeasure'
import { drawCrossMeasureTies } from './drawCrossMeasureTies'
import { resolveTieRedrawRange } from './tieRedrawRange'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type {
  DragDebugStaticRecord,
  DragDebugSnapshot,
  DragState,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Pitch,
  Selection,
  SpacingLayoutMode,
  StaffKind,
} from '../types'

type OverlayFrame = { x: number; y: number; width: number; height: number }

type VisibleTieOverlayRange = {
  pairIndices: number[]
  startPairIndex: number
  endPairIndexExclusive: number
  clipped: boolean
}

function buildOverlayRectForPairRange(
  pairIndices: number[],
  measureLayouts: Map<number, MeasureLayout>,
): MeasureLayout['overlayRect'] | null {
  if (pairIndices.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxRight = Number.NEGATIVE_INFINITY
  let maxBottom = Number.NEGATIVE_INFINITY

  pairIndices.forEach((pairIndex) => {
    const layout = measureLayouts.get(pairIndex)
    if (!layout) return
    const rect = layout.overlayRect
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxRight = Math.max(maxRight, rect.x + rect.width)
    maxBottom = Math.max(maxBottom, rect.y + rect.height)
  })

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
    return null
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxRight - minX),
    height: Math.max(1, maxBottom - minY),
  }
}

function resolveVisibleTieOverlayRange(params: {
  measurePairs: MeasurePair[]
  measureLayouts: Map<number, MeasureLayout>
  anchorPairIndex: number
  staff: StaffKind
  noteIndex: number
  keyIndex: number
}): VisibleTieOverlayRange {
  const {
    measurePairs,
    measureLayouts,
    anchorPairIndex,
    staff,
    noteIndex,
    keyIndex,
  } = params

  const tieRange = resolveTieRedrawRange({
    measurePairs,
    pairIndex: anchorPairIndex,
    staff,
    noteIndex,
    keyIndex,
  })
  if (tieRange.pairIndices.length === 0) {
    return {
      pairIndices: [],
      startPairIndex: anchorPairIndex,
      endPairIndexExclusive: anchorPairIndex + 1,
      clipped: false,
    }
  }

  if (tieRange.pairIndices.every((pairIndex) => measureLayouts.has(pairIndex))) {
    return {
      pairIndices: tieRange.pairIndices,
      startPairIndex: tieRange.startPairIndex,
      endPairIndexExclusive: tieRange.endPairIndexExclusive,
      clipped: false,
    }
  }

  if (!measureLayouts.has(anchorPairIndex)) {
    return {
      pairIndices: [],
      startPairIndex: anchorPairIndex,
      endPairIndexExclusive: anchorPairIndex + 1,
      clipped: true,
    }
  }

  let startPairIndex = anchorPairIndex
  let endPairIndexExclusive = anchorPairIndex + 1

  while (
    startPairIndex - 1 >= tieRange.startPairIndex &&
    measureLayouts.has(startPairIndex - 1)
  ) {
    startPairIndex -= 1
  }
  while (
    endPairIndexExclusive < tieRange.endPairIndexExclusive &&
    measureLayouts.has(endPairIndexExclusive)
  ) {
    endPairIndexExclusive += 1
  }

  const pairIndices: number[] = []
  for (let pairIndex = startPairIndex; pairIndex < endPairIndexExclusive; pairIndex += 1) {
    if (!measureLayouts.has(pairIndex)) break
    pairIndices.push(pairIndex)
  }
  if (pairIndices.length === 0) {
    return {
      pairIndices: [anchorPairIndex],
      startPairIndex: anchorPairIndex,
      endPairIndexExclusive: anchorPairIndex + 1,
      clipped: true,
    }
  }

  return {
    pairIndices,
    startPairIndex: pairIndices[0] ?? anchorPairIndex,
    endPairIndexExclusive: (pairIndices[pairIndices.length - 1] ?? anchorPairIndex) + 1,
    clipped:
      (pairIndices[0] ?? anchorPairIndex) > tieRange.startPairIndex ||
      ((pairIndices[pairIndices.length - 1] ?? anchorPairIndex) + 1) < tieRange.endPairIndexExclusive,
  }
}

function beginOverlayPaint(
  overlayContext: ReturnType<import('vexflow').Renderer['getContext']>,
  overlayFrame: OverlayFrame,
): boolean {
  const overlayContext2D = (overlayContext as unknown as { context2D?: CanvasRenderingContext2D }).context2D
  if (!overlayContext2D) return false

  overlayContext.clearRect(0, 0, overlayFrame.width, overlayFrame.height)
  overlayContext.save()
  overlayContext.setFillStyle('#ffffff')
  overlayContext.fillRect(0, 0, overlayFrame.width, overlayFrame.height)
  overlayContext.restore()
  overlayContext.save()
  overlayContext2D.translate(-overlayFrame.x, -overlayFrame.y)
  overlayContext.setFillStyle('#000000')
  overlayContext.setStrokeStyle('#000000')
  return true
}

function drawOverlayRange(params: {
  pairIndices: number[]
  clipped: boolean
  measureLayouts: Map<number, MeasureLayout>
  measurePairs: MeasurePair[]
  ensureOverlayCanvasForRect: (rect: MeasureLayout['overlayRect']) => OverlayFrame | null
  getOverlayContext: () => ReturnType<import('vexflow').Renderer['getContext']> | null
  clearDragOverlay: () => void
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
  activeSelection: Selection | null
  getPreviewForPair?: (
    pairIndex: number,
  ) => {
    previewNote?: { noteId: string; staff: StaffKind; pitch: Pitch; keyIndex: number } | null
    previewAccidentalStateBeforeNote?: Map<string, number> | null
    staticNoteXById?: Map<string, number> | null
    staticAccidentalRightXById?: Map<string, Map<number, number>> | null
    debugCapture?: {
      frame: number
      draggedNoteId: string
      draggedStaff: StaffKind
      staticByNoteKey: Map<string, DragDebugStaticRecord>
      pushSnapshot: (snapshot: DragDebugSnapshot) => void
    } | null
  }
}): void {
  const {
    pairIndices,
    clipped,
    measureLayouts,
    measurePairs,
    ensureOverlayCanvasForRect,
    getOverlayContext,
    clearDragOverlay,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
    activeSelection,
    getPreviewForPair,
  } = params
  if (pairIndices.length === 0) {
    clearDragOverlay()
    return
  }

  const overlayRect = buildOverlayRectForPairRange(pairIndices, measureLayouts)
  if (!overlayRect) {
    clearDragOverlay()
    return
  }
  const overlayFrame = ensureOverlayCanvasForRect(overlayRect)
  if (!overlayFrame) return

  const overlayContext = getOverlayContext()
  if (!overlayContext) return
  if (!beginOverlayPaint(overlayContext, overlayFrame)) return

  const overlayLayoutsByPair = new Map<number, NoteLayout[]>()
  pairIndices.forEach((pairIndex) => {
    const measureLayout = measureLayouts.get(pairIndex)
    const measure = measurePairs[pairIndex]
    if (!measureLayout || !measure) return

    const showKeySignature = !measureLayout.isSystemStart && measureLayout.showKeySignature
    const showTimeSignature = !measureLayout.isSystemStart && measureLayout.showTimeSignature
    const preview = getPreviewForPair?.(pairIndex)

    const measureNoteLayouts = drawMeasureToContext({
      context: overlayContext,
      measure,
      pairIndex: measureLayout.pairIndex,
      measureX: measureLayout.measureX,
      measureWidth: measureLayout.measureWidth,
      trebleY: measureLayout.trebleY,
      bassY: measureLayout.bassY,
      isSystemStart: measureLayout.isSystemStart,
      keyFifths: measureLayout.keyFifths,
      showKeySignature,
      timeSignature: measureLayout.timeSignature,
      showTimeSignature,
      endTimeSignature: measureLayout.endTimeSignature,
      showEndTimeSignature: measureLayout.showEndTimeSignature,
      activeSelection,
      draggingSelection: null,
      collectLayouts: true,
      suppressSystemDecorations: true,
      noteStartXOverride: measureLayout.noteStartX,
      formatWidthOverride: measureLayout.formatWidth,
      timeAxisSpacingConfig,
      spacingLayoutMode,
      renderBoundaryPartialTies: false,
      previewNote: preview?.previewNote ?? null,
      previewAccidentalStateBeforeNote: preview?.previewAccidentalStateBeforeNote ?? null,
      staticNoteXById: preview?.staticNoteXById ?? null,
      staticAccidentalRightXById: preview?.staticAccidentalRightXById ?? null,
      debugCapture:
        preview?.debugCapture
          ? {
              frame: preview.debugCapture.frame,
              draggedNoteId: preview.debugCapture.draggedNoteId,
              draggedStaff: preview.debugCapture.draggedStaff,
              staticByNoteKey: preview.debugCapture.staticByNoteKey,
              pushSnapshot: preview.debugCapture.pushSnapshot,
            }
          : null,
    })
    overlayLayoutsByPair.set(pairIndex, measureNoteLayouts)
  })

  drawCrossMeasureTies({
    context: overlayContext,
    measurePairs,
    noteLayoutsByPair: overlayLayoutsByPair,
    measureLayouts,
    startPairIndex: pairIndices[0] ?? 0,
    endPairIndexExclusive: (pairIndices[pairIndices.length - 1] ?? 0) + 1,
    allowBoundaryPartialTies: clipped,
  })

  overlayContext.restore()
}

export function drawSelectionMeasureOverlay(params: {
  selection: Selection
  noteLayoutByKey: Map<string, NoteLayout>
  measureLayouts: Map<number, MeasureLayout>
  measurePairs: MeasurePair[]
  ensureOverlayCanvasForRect: (rect: MeasureLayout['overlayRect']) => OverlayFrame | null
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

  const visibleRange = resolveVisibleTieOverlayRange({
    measurePairs,
    measureLayouts,
    anchorPairIndex: selectedLayout.pairIndex,
    staff: selection.staff,
    noteIndex: selectedLayout.noteIndex,
    keyIndex: selection.keyIndex,
  })

  drawOverlayRange({
    pairIndices: visibleRange.pairIndices,
    clipped: visibleRange.clipped,
    measureLayouts,
    measurePairs,
    ensureOverlayCanvasForRect,
    getOverlayContext,
    clearDragOverlay,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    activeSelection: selection,
  })
}

export function drawDragMeasurePreview(params: {
  drag: DragState
  ensureDragLayoutCache: (drag: DragState) => DragState
  dragPreviewFrameRef: MutableRefObject<number>
  measureLayouts: Map<number, MeasureLayout>
  measurePairs: MeasurePair[]
  ensureOverlayCanvasForRect: (rect: MeasureLayout['overlayRect']) => OverlayFrame | null
  getOverlayContext: () => ReturnType<import('vexflow').Renderer['getContext']> | null
  clearDragOverlay: () => void
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
    clearDragOverlay,
    dragDebugFramesRef,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
  } = params

  const dragWithLayout = ensureDragLayoutCache(drag)
  dragPreviewFrameRef.current += 1
  const visibleRange = resolveVisibleTieOverlayRange({
    measurePairs,
    measureLayouts,
    anchorPairIndex: dragWithLayout.pairIndex,
    staff: dragWithLayout.staff,
    noteIndex: dragWithLayout.noteIndex,
    keyIndex: dragWithLayout.keyIndex,
  })

  drawOverlayRange({
    pairIndices: visibleRange.pairIndices,
    clipped: visibleRange.clipped,
    measureLayouts,
    measurePairs,
    ensureOverlayCanvasForRect,
    getOverlayContext,
    clearDragOverlay,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    activeSelection: null,
    getPreviewForPair: (pairIndex) => {
      if (pairIndex !== dragWithLayout.pairIndex) return {}
      return {
        previewNote: {
          noteId: dragWithLayout.noteId,
          staff: dragWithLayout.staff,
          pitch: dragWithLayout.pitch,
          keyIndex: dragWithLayout.keyIndex,
        },
        previewAccidentalStateBeforeNote: dragWithLayout.accidentalStateBeforeNote,
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
      }
    },
  })
}
