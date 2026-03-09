import type { MutableRefObject } from 'react'
import { getLayoutNoteKey } from '../layout/renderPosition'
import { drawMeasureToContext } from './drawMeasure'
import { drawCrossMeasureTies } from './drawCrossMeasureTies'
import { buildDragPreviewOverrides, type DragPreviewFrozenBoundaryCurve, type DragPreviewNoteOverride } from './dragPreviewOverrides'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type { MeasureTimelineBundle } from '../timeline/types'
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

type VisibleOverlayRange = {
  pairIndices: number[]
  startPairIndex: number
  endPairIndexExclusive: number
  clipped: boolean
}

const OVERLAY_BOUNDARY_GUTTER_PX = 2

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

  const firstPairIndex = pairIndices[0]
  const lastPairIndex = pairIndices[pairIndices.length - 1]
  const firstMeasureLayout = firstPairIndex !== undefined ? measureLayouts.get(firstPairIndex) : null
  const lastMeasureLayout = lastPairIndex !== undefined ? measureLayouts.get(lastPairIndex) : null
  const rangeStartX = firstMeasureLayout
    ? firstMeasureLayout.measureX - OVERLAY_BOUNDARY_GUTTER_PX
    : minX
  const rangeEndX = lastMeasureLayout
    ? lastMeasureLayout.measureX + lastMeasureLayout.measureWidth + OVERLAY_BOUNDARY_GUTTER_PX
    : maxRight
  const clampedMinX = Math.max(minX, rangeStartX)
  const clampedMaxRight = Math.min(maxRight, rangeEndX)

  return {
    x: clampedMinX,
    y: minY,
    width: Math.max(1, clampedMaxRight - clampedMinX),
    height: Math.max(1, maxBottom - minY),
  }
}

function resolveVisibleViewportOverlayRange(params: {
  measurePairCount: number
  measureLayouts: Map<number, MeasureLayout>
  viewportXRange?: { startX: number; endX: number } | null
  renderOffsetX: number
  anchorPairIndex: number
}): VisibleOverlayRange {
  const {
    measurePairCount,
    measureLayouts,
    viewportXRange = null,
    renderOffsetX,
    anchorPairIndex,
  } = params

  const sortedRenderedPairIndices = [...measureLayouts.keys()].sort((left, right) => left - right)
  if (sortedRenderedPairIndices.length === 0) {
    return {
      pairIndices: [],
      startPairIndex: anchorPairIndex,
      endPairIndexExclusive: anchorPairIndex + 1,
      clipped: false,
    }
  }

  let candidatePairIndices = sortedRenderedPairIndices
  if (
    viewportXRange &&
    Number.isFinite(viewportXRange.startX) &&
    Number.isFinite(viewportXRange.endX)
  ) {
    const viewportStartX = Math.min(viewportXRange.startX, viewportXRange.endX)
    const viewportEndX = Math.max(viewportXRange.startX, viewportXRange.endX)
    candidatePairIndices = sortedRenderedPairIndices.filter((pairIndex) => {
      const layout = measureLayouts.get(pairIndex)
      if (!layout) return false
      const globalMeasureStartX = layout.measureX + renderOffsetX
      const globalMeasureEndX = globalMeasureStartX + layout.measureWidth
      return globalMeasureEndX >= viewportStartX && globalMeasureStartX <= viewportEndX
    })
  }

  if (candidatePairIndices.length === 0) {
    if (measureLayouts.has(anchorPairIndex)) {
      candidatePairIndices = [anchorPairIndex]
    } else {
      candidatePairIndices = [sortedRenderedPairIndices[0]]
    }
  }

  const candidateSet = new Set(candidatePairIndices)
  const anchorPairInRange = candidateSet.has(anchorPairIndex)
  let rangeAnchorPairIndex = anchorPairInRange ? anchorPairIndex : candidatePairIndices[0]
  if (!Number.isInteger(rangeAnchorPairIndex) || rangeAnchorPairIndex === undefined) {
    rangeAnchorPairIndex = sortedRenderedPairIndices[0]
  }
  let startPairIndex = rangeAnchorPairIndex
  let endPairIndexExclusive = rangeAnchorPairIndex + 1
  while (candidateSet.has(startPairIndex - 1)) {
    startPairIndex -= 1
  }
  while (candidateSet.has(endPairIndexExclusive)) {
    endPairIndexExclusive += 1
  }

  const pairIndices: number[] = []
  for (let pairIndex = startPairIndex; pairIndex < endPairIndexExclusive; pairIndex += 1) {
    if (candidateSet.has(pairIndex)) pairIndices.push(pairIndex)
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
      (pairIndices[0] ?? anchorPairIndex) > 0 ||
      ((pairIndices[pairIndices.length - 1] ?? anchorPairIndex) + 1) < measurePairCount,
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
  measureLayouts: Map<number, MeasureLayout>
  measurePairs: MeasurePair[]
  measureTimelineBundles?: Map<number, MeasureTimelineBundle> | null
  ensureOverlayCanvasForRect: (rect: MeasureLayout['overlayRect']) => OverlayFrame | null
  getOverlayContext: () => ReturnType<import('vexflow').Renderer['getContext']> | null
  clearDragOverlay: () => void
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
  activeSelection: Selection | null
  previewPitchByTargetKey?: Map<string, Pitch> | null
  previewFrozenBoundaryCurve?: DragPreviewFrozenBoundaryCurve | null
  suppressedTieStartKeys?: Set<string> | null
  suppressedTieStopKeys?: Set<string> | null
  getPreviewForPair?: (
    pairIndex: number,
  ) => {
    previewNotes?: DragPreviewNoteOverride[] | null
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
    measureLayouts,
    measurePairs,
    measureTimelineBundles = null,
    ensureOverlayCanvasForRect,
    getOverlayContext,
    clearDragOverlay,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
    activeSelection,
    previewPitchByTargetKey = null,
    previewFrozenBoundaryCurve = null,
    suppressedTieStartKeys = null,
    suppressedTieStopKeys = null,
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
  pairIndices.forEach((pairIndex, pairOffset) => {
    const measureLayout = measureLayouts.get(pairIndex)
    const measure = measurePairs[pairIndex]
    if (!measureLayout || !measure) return

    const showKeySignature = !measureLayout.isSystemStart && measureLayout.showKeySignature
    const showTimeSignature = !measureLayout.isSystemStart && measureLayout.showTimeSignature
    const preview = getPreviewForPair?.(pairIndex)
    const timelineBundle = measureTimelineBundles?.get(pairIndex) ?? null

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
      publicAxisLayout: timelineBundle?.publicAxisLayout ?? null,
      renderBoundaryPartialTies: false,
      forceLeadingConnector: pairOffset === 0,
      previewNotes: preview?.previewNotes ?? null,
      previewAccidentalStateBeforeNote: preview?.previewAccidentalStateBeforeNote ?? null,
      previewFrozenBoundaryCurve,
      suppressedTieStartKeys,
      suppressedTieStopKeys,
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
    previewPitchByTargetKey,
    previewFrozenBoundaryCurve,
    suppressedTieStartKeys,
    suppressedTieStopKeys,
    allowBoundaryPartialTies: false,
  })

  overlayContext.restore()
}

export function drawSelectionMeasureOverlay(params: {
  selection: Selection
  noteLayoutByKey: Map<string, NoteLayout>
  measureLayouts: Map<number, MeasureLayout>
  measurePairs: MeasurePair[]
  measureTimelineBundles?: Map<number, MeasureTimelineBundle> | null
  viewportXRange?: { startX: number; endX: number } | null
  renderOffsetX?: number
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
    measureTimelineBundles = null,
    viewportXRange = null,
    renderOffsetX = 0,
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

  const visibleRange = resolveVisibleViewportOverlayRange({
    measurePairCount: measurePairs.length,
    measureLayouts,
    viewportXRange,
    renderOffsetX,
    anchorPairIndex: selectedLayout.pairIndex,
  })

  drawOverlayRange({
    pairIndices: visibleRange.pairIndices,
    measureLayouts,
    measurePairs,
    measureTimelineBundles,
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
  measureTimelineBundles?: Map<number, MeasureTimelineBundle> | null
  viewportXRange?: { startX: number; endX: number } | null
  renderOffsetX?: number
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
    measureTimelineBundles = null,
    viewportXRange = null,
    renderOffsetX = 0,
    ensureOverlayCanvasForRect,
    getOverlayContext,
    clearDragOverlay,
    dragDebugFramesRef,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
  } = params

  const dragWithLayout = ensureDragLayoutCache(drag)
  dragPreviewFrameRef.current += 1
  const {
    previewNotesByPair,
    previewPitchByTargetKey,
    previewFrozenBoundaryCurve,
    suppressedTieStartKeys,
    suppressedTieStopKeys,
  } = buildDragPreviewOverrides({ drag: dragWithLayout })
  const visibleRange = resolveVisibleViewportOverlayRange({
    measurePairCount: measurePairs.length,
    measureLayouts,
    viewportXRange,
    renderOffsetX,
    anchorPairIndex: dragWithLayout.pairIndex,
  })

  drawOverlayRange({
    pairIndices: visibleRange.pairIndices,
    measureLayouts,
    measurePairs,
    measureTimelineBundles,
    ensureOverlayCanvasForRect,
    getOverlayContext,
    clearDragOverlay,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    activeSelection: null,
    previewPitchByTargetKey,
    previewFrozenBoundaryCurve,
    suppressedTieStartKeys,
    suppressedTieStopKeys,
    getPreviewForPair: (pairIndex) => {
      const previewNotes = previewNotesByPair.get(pairIndex) ?? null
      if (!previewNotes) return {}
      const isPrimaryDragPreviewPair = pairIndex === dragWithLayout.pairIndex
      return {
        previewNotes,
        previewAccidentalStateBeforeNote: dragWithLayout.accidentalStateBeforeNote,
        staticNoteXById: isPrimaryDragPreviewPair ? dragWithLayout.staticNoteXById : null,
        staticAccidentalRightXById: isPrimaryDragPreviewPair ? dragWithLayout.previewAccidentalRightXById : null,
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
