import { useLayoutEffect, type MutableRefObject } from 'react'
import { Renderer } from 'vexflow'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import { buildHitGridIndex, type HitGridIndex } from '../layout/hitTest'
import type { SystemMeasureRange } from '../layout/demand'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import { renderVisibleSystems } from '../render/renderVisibleSystems'
import type { MeasureTimelineBundle } from '../timeline/types'
import type {
  DragState,
  LayoutReflowHint,
  MeasureFrame,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Selection,
  SpacingLayoutMode,
  TimeSignature,
} from '../types'

export function useScoreRenderEffect(params: {
  scoreRef: MutableRefObject<HTMLCanvasElement | null>
  rendererRef: MutableRefObject<Renderer | null>
  rendererSizeRef: MutableRefObject<{ width: number; height: number }>
  scoreWidth: number
  scoreHeight: number
  measurePairs: MeasurePair[]
  systemRanges: SystemMeasureRange[]
  visibleSystemRange: { start: number; end: number }
  renderOriginSystemIndex: number
  visiblePairRange?: { startPairIndex: number; endPairIndexExclusive: number } | null
  clearViewportXRange?: { startX: number; endX: number } | null
  measureFramesByPair?: MeasureFrame[] | null
  renderOffsetX?: number
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  supplementalSpacingTicksByPair?: number[][] | null
  activeSelection?: Selection | null
  activeAccidentalSelection?: Selection | null
  activeTieSegmentKey?: string | null
  draggingSelection?: Selection | null
  activeSelections?: Selection[] | null
  draggingSelections?: Selection[] | null
  selectedMeasureScope?: { pairIndex: number; staff: 'treble' | 'bass' } | null
  fullMeasureRestCollapseScopeKeys?: string[]
  layoutReflowHintRef?: MutableRefObject<LayoutReflowHint | null>
  layoutStabilityKey?: string
  noteLayoutsRef: MutableRefObject<NoteLayout[]>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  noteLayoutByKeyRef: MutableRefObject<Map<string, NoteLayout>>
  hitGridRef: MutableRefObject<HitGridIndex | null>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  measureTimelineBundlesRef: MutableRefObject<Map<number, MeasureTimelineBundle>>
  backend: number
  pagePaddingX?: number
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
  showInScoreMeasureNumbers?: boolean
  showNoteHeadJianpuEnabled?: boolean
  renderScaleX?: number
  renderScaleY?: number
  renderQualityScaleX?: number
  renderQualityScaleY?: number
  dragPreview?: DragState | null
  onAfterRender?: () => void
}): void {
  const {
    scoreRef,
    rendererRef,
    rendererSizeRef,
    scoreWidth,
    scoreHeight,
    measurePairs,
    systemRanges,
    visibleSystemRange,
    renderOriginSystemIndex,
    visiblePairRange = null,
    clearViewportXRange = null,
    measureFramesByPair = null,
    renderOffsetX = 0,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair = null,
    activeSelection = null,
    activeAccidentalSelection = null,
    activeTieSegmentKey = null,
    draggingSelection = null,
    activeSelections = null,
    draggingSelections = null,
    selectedMeasureScope = null,
    fullMeasureRestCollapseScopeKeys = [],
    layoutReflowHintRef,
    layoutStabilityKey,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    backend,
    pagePaddingX,
    grandStaffLayoutMetrics,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
    showInScoreMeasureNumbers = false,
    showNoteHeadJianpuEnabled = false,
    renderScaleX = 1,
    renderScaleY = 1,
    renderQualityScaleX: forcedRenderQualityScaleX,
    renderQualityScaleY: forcedRenderQualityScaleY,
    dragPreview = null,
    onAfterRender,
  } = params

  useLayoutEffect(() => {
    const root = scoreRef.current
    if (!root) return

    const maxBackingStoreDim = 32760
    const devicePixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1
    const targetQualityX = Math.max(1, devicePixelRatio, Math.abs(renderScaleX))
    const targetQualityY = Math.max(1, devicePixelRatio, Math.abs(renderScaleY))
    const maxQualityX = Math.max(1, maxBackingStoreDim / Math.max(1, scoreWidth))
    const maxQualityY = Math.max(1, maxBackingStoreDim / Math.max(1, scoreHeight))
    const renderQualityScaleX =
      Number.isFinite(forcedRenderQualityScaleX) && (forcedRenderQualityScaleX ?? 0) > 0
        ? Math.max(1, Math.min(forcedRenderQualityScaleX as number, maxQualityX))
        : Math.max(1, Math.min(targetQualityX, maxQualityX))
    const renderQualityScaleY =
      Number.isFinite(forcedRenderQualityScaleY) && (forcedRenderQualityScaleY ?? 0) > 0
        ? Math.max(1, Math.min(forcedRenderQualityScaleY as number, maxQualityY))
        : Math.max(1, Math.min(targetQualityY, maxQualityY))
    const backingWidth = Math.max(1, Math.round(scoreWidth * renderQualityScaleX))
    const backingHeight = Math.max(1, Math.round(scoreHeight * renderQualityScaleY))

    let renderer = rendererRef.current
    if (!renderer) {
      renderer = new Renderer(root, backend)
      rendererRef.current = renderer
    }
    const currentSize = rendererSizeRef.current
    if (currentSize.width !== backingWidth || currentSize.height !== backingHeight) {
      renderer.resize(backingWidth, backingHeight)
      rendererSizeRef.current = { width: backingWidth, height: backingHeight }
    }
    root.style.width = `${scoreWidth}px`
    root.style.height = `${scoreHeight}px`
    const context = renderer.getContext()
    const actualBackingWidth = root.width > 0 ? root.width : backingWidth
    const actualBackingHeight = root.height > 0 ? root.height : backingHeight
    const scaleX = scoreWidth > 0 ? actualBackingWidth / scoreWidth : 1
    const scaleY = scoreHeight > 0 ? actualBackingHeight / scoreHeight : 1
    const rawContext2D = root.getContext('2d')
    if (rawContext2D) {
      rawContext2D.setTransform(scaleX, 0, 0, scaleY, 0, 0)
    }
    const context2D = (context as unknown as { context2D?: CanvasRenderingContext2D }).context2D
    if (context2D && context2D !== rawContext2D) {
      context2D.setTransform(scaleX, 0, 0, scaleY, 0, 0)
    }
    const previousNoteLayoutsByPair = noteLayoutsByPairRef.current
    const previousMeasureLayouts = measureLayoutsRef.current
    const layoutReflowHint = layoutReflowHintRef?.current ?? null

    const { nextLayouts, nextLayoutsByPair, nextLayoutsByKey, nextMeasureLayouts, nextTimelineBundlesByPair } =
      renderVisibleSystems({
        context,
        measurePairs,
        scoreWidth,
        scoreHeight,
        systemRanges,
        visibleSystemRange,
        renderOriginSystemIndex,
        visiblePairRange,
        clearViewportXRange,
        measureFramesByPair,
        renderOffsetX,
        measureKeyFifthsFromImport,
        measureTimeSignaturesFromImport,
        supplementalSpacingTicksByPair,
        activeSelection,
        activeAccidentalSelection,
        activeTieSegmentKey,
        draggingSelection,
        activeSelections,
        draggingSelections,
        selectedMeasureScope,
        fullMeasureRestCollapseScopeKeys,
        layoutReflowHint,
        layoutStabilityKey,
        previousNoteLayoutsByPair,
        previousMeasureLayouts,
        allowSelectionFreezeWhenNotDragging: false,
        pagePaddingX,
        grandStaffLayoutMetrics,
        timeAxisSpacingConfig,
        spacingLayoutMode,
        showInScoreMeasureNumbers,
        showNoteHeadJianpu: showNoteHeadJianpuEnabled,
        dragPreview,
      })
    noteLayoutsRef.current = nextLayouts
    noteLayoutsByPairRef.current = nextLayoutsByPair
    noteLayoutByKeyRef.current = nextLayoutsByKey
    hitGridRef.current = buildHitGridIndex(nextLayouts)
    measureLayoutsRef.current = nextMeasureLayouts
    measureTimelineBundlesRef.current = nextTimelineBundlesByPair
    onAfterRender?.()
  }, [
    scoreRef,
    rendererRef,
    rendererSizeRef,
    scoreWidth,
    scoreHeight,
    measurePairs,
    systemRanges,
    visibleSystemRange,
    renderOriginSystemIndex,
    visiblePairRange,
    clearViewportXRange,
    measureFramesByPair,
    renderOffsetX,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair,
    activeSelection,
    activeAccidentalSelection,
    activeTieSegmentKey,
    draggingSelection,
    activeSelections,
    draggingSelections,
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
    backend,
    pagePaddingX,
    grandStaffLayoutMetrics,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    showInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    renderScaleX,
    renderScaleY,
    forcedRenderQualityScaleX,
    forcedRenderQualityScaleY,
    dragPreview,
    onAfterRender,
  ])
}
