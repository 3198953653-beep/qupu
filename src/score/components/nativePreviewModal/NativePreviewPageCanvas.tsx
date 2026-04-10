import { useLayoutEffect, useRef } from 'react'
import { Renderer } from 'vexflow'
import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH } from '../../constants'
import type { NativePreviewModalProps } from './types'
import { renderVisibleSystems } from '../../render/renderVisibleSystems'

type NativePreviewPageCanvasProps = Pick<
  NativePreviewModalProps,
  | 'currentPage'
  | 'measurePairs'
  | 'pedalSpans'
  | 'chordRulerEntriesByPair'
  | 'measureKeyFifthsFromImport'
  | 'measureTimeSignaturesFromImport'
  | 'supplementalSpacingTicksByPair'
  | 'timeAxisSpacingConfig'
  | 'grandStaffLayoutMetrics'
  | 'showInScoreMeasureNumbers'
  | 'showNoteHeadJianpuEnabled'
  | 'onNativePreviewPageRenderedDiagnostics'
>

export function NativePreviewPageCanvas(props: NativePreviewPageCanvasProps) {
  const {
    currentPage,
    measurePairs,
    pedalSpans,
    chordRulerEntriesByPair,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
    grandStaffLayoutMetrics,
    showInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    onNativePreviewPageRenderedDiagnostics,
  } = props

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rendererSizeRef = useRef({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const devicePixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1
    const backingWidth = Math.max(1, Math.round(A4_PAGE_WIDTH * devicePixelRatio))
    const backingHeight = Math.max(1, Math.round(A4_PAGE_HEIGHT * devicePixelRatio))

    let renderer = rendererRef.current
    if (!renderer) {
      renderer = new Renderer(canvas, Renderer.Backends.CANVAS)
      rendererRef.current = renderer
    }
    const currentSize = rendererSizeRef.current
    if (currentSize.width !== backingWidth || currentSize.height !== backingHeight) {
      renderer.resize(backingWidth, backingHeight)
      rendererSizeRef.current = { width: backingWidth, height: backingHeight }
    }
    canvas.style.width = `${A4_PAGE_WIDTH}px`
    canvas.style.height = `${A4_PAGE_HEIGHT}px`

    const rawContext = canvas.getContext('2d')
    const notationScale =
      currentPage && Number.isFinite(currentPage.notationScale) && currentPage.notationScale > 0
        ? currentPage.notationScale
        : 1
    if (rawContext) {
      rawContext.setTransform(devicePixelRatio * notationScale, 0, 0, devicePixelRatio * notationScale, 0, 0)
    }
    const context = renderer.getContext()
    const context2D = (context as unknown as { context2D?: CanvasRenderingContext2D }).context2D
    if (context2D && context2D !== rawContext) {
      context2D.setTransform(devicePixelRatio * notationScale, 0, 0, devicePixelRatio * notationScale, 0, 0)
    }

    const pageWidthNotationPx = notationScale > 0 ? A4_PAGE_WIDTH / notationScale : A4_PAGE_WIDTH
    const pageHeightNotationPx = notationScale > 0 ? A4_PAGE_HEIGHT / notationScale : A4_PAGE_HEIGHT
    const renderResult = renderVisibleSystems({
      context,
      measurePairs,
      pedalSpans,
      chordRulerEntriesByPair,
      scoreWidth: pageWidthNotationPx,
      scoreHeight: pageHeightNotationPx,
      systemRanges: currentPage?.systemRanges ?? [],
      visibleSystemRange: currentPage && currentPage.systemRanges.length > 0
        ? { start: 0, end: currentPage.systemRanges.length - 1 }
        : { start: 0, end: 0 },
      renderOriginSystemIndex: 0,
      visiblePairRange: null,
      clearViewportXRange: null,
      measureFramesByPair: currentPage?.measureFramesByPair ?? [],
      renderOffsetX: 0,
      measureKeyFifthsFromImport,
      measureTimeSignaturesFromImport,
      supplementalSpacingTicksByPair,
      activeSelection: null,
      activeAccidentalSelection: null,
      activePedalSelection: null,
      activeTieSegmentKey: null,
      draggingSelection: null,
      activeSelections: null,
      draggingSelections: null,
      activeChordSelection: null,
      activeTimelineSegmentHighlight: null,
      selectedMeasureScope: null,
      selectionFrameIntent: 'default',
      isSelectionVisible: false,
      fullMeasureRestCollapseScopeKeys: [],
      previousNoteLayoutsByPair: null,
      previousMeasureLayouts: null,
      allowSelectionFreezeWhenNotDragging: false,
      pagePaddingX: 0,
      grandStaffLayoutMetrics,
      timeAxisSpacingConfig,
      spacingLayoutMode: 'custom',
      showInScoreMeasureNumbers,
      showNoteHeadJianpu: showNoteHeadJianpuEnabled,
      dragPreview: null,
      systemTopOverridesPx: currentPage?.systemTopPxBySystemIndex ?? null,
    })
    if (currentPage) {
      onNativePreviewPageRenderedDiagnostics(currentPage.pageIndex, renderResult.nextMeasureLayouts)
    }
  }, [
    chordRulerEntriesByPair,
    currentPage,
    grandStaffLayoutMetrics,
    measureKeyFifthsFromImport,
    measurePairs,
    measureTimeSignaturesFromImport,
    pedalSpans,
    showInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
    onNativePreviewPageRenderedDiagnostics,
  ])

  return <canvas ref={canvasRef} className="native-preview-page-canvas" />
}
