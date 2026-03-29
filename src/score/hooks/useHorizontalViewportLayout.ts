import { useMemo, type MutableRefObject } from 'react'
import type { MeasureFrame } from '../types'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import {
  applyChordMarkerVisualZoom,
  clampCanvasHeightPercent,
  clampChordMarkerPaddingPx,
  clampChordMarkerUiScalePercent,
  clampScalePercent,
  getAutoScoreScale,
  getChordMarkerBaseStyleMetrics,
} from '../scorePresentation'
import { A4_PAGE_WIDTH } from '../constants'
import {
  HORIZONTAL_RENDER_BUFFER_PX,
  HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES,
  getHorizontalViewHeightPx,
  MANUAL_SCALE_BASELINE,
  MAX_CANVAS_RENDER_DIM_PX,
  type HorizontalRenderWindow,
  type HorizontalSystemRange,
  type RenderQualityScale,
} from './horizontalScoreLayoutShared'

export function useHorizontalViewportLayout(params: {
  measurePairsLength: number
  pageHorizontalPaddingPx: number
  autoScaleEnabled: boolean
  manualScalePercent: number
  canvasHeightPercent: number
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  chordMarkerUiScalePercent: number
  chordMarkerPaddingPx: number
  horizontalEstimatedMeasureWidthTotal: number
  horizontalMeasureFramesByPair: MeasureFrame[]
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  horizontalViewportXRange: { startX: number; endX: number }
  horizontalRenderOffsetXRef: MutableRefObject<number>
}) {
  const {
    measurePairsLength,
    pageHorizontalPaddingPx,
    autoScaleEnabled,
    manualScalePercent,
    canvasHeightPercent,
    grandStaffLayoutMetrics,
    chordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    horizontalEstimatedMeasureWidthTotal,
    horizontalMeasureFramesByPair,
    timeAxisSpacingConfig,
    horizontalViewportXRange,
    horizontalRenderOffsetXRef,
  } = params

  const spacingLayoutMode = 'custom' as const
  const safeChordMarkerUiScalePercent = clampChordMarkerUiScalePercent(chordMarkerUiScalePercent)
  const safeChordMarkerPaddingPx = clampChordMarkerPaddingPx(chordMarkerPaddingPx)
  const chordMarkerBaseStyleMetrics = useMemo(
    () => getChordMarkerBaseStyleMetrics(safeChordMarkerUiScalePercent, safeChordMarkerPaddingPx),
    [safeChordMarkerPaddingPx, safeChordMarkerUiScalePercent],
  )

  const autoScoreScale = useMemo(() => getAutoScoreScale(measurePairsLength), [measurePairsLength])
  const safeManualScalePercent = clampScalePercent(manualScalePercent)
  const safeCanvasHeightPercent = clampCanvasHeightPercent(canvasHeightPercent)
  const relativeScale = autoScaleEnabled ? autoScoreScale : safeManualScalePercent / 100
  const horizontalDisplayScale = relativeScale * MANUAL_SCALE_BASELINE
  const displayScoreWidth = useMemo(() => {
    const totalMeasureWidth = horizontalEstimatedMeasureWidthTotal
    const baseWidth = Math.max(A4_PAGE_WIDTH, pageHorizontalPaddingPx * 2 + totalMeasureWidth)
    return Math.max(A4_PAGE_WIDTH, Math.round(baseWidth * horizontalDisplayScale))
  }, [horizontalDisplayScale, horizontalEstimatedMeasureWidthTotal, pageHorizontalPaddingPx])

  const baseScoreScale = relativeScale * MANUAL_SCALE_BASELINE
  const horizontalViewHeightPx = getHorizontalViewHeightPx(grandStaffLayoutMetrics.systemHeightPx)
  const minScaleForCanvasHeight = horizontalViewHeightPx / MAX_CANVAS_RENDER_DIM_PX
  const scoreScaleX = baseScoreScale
  const scoreScaleY = Math.max(baseScoreScale, minScaleForCanvasHeight)
  const chordMarkerStyleMetrics = useMemo(
    () => applyChordMarkerVisualZoom(chordMarkerBaseStyleMetrics, baseScoreScale),
    [baseScoreScale, chordMarkerBaseStyleMetrics],
  )
  const canvasHeightScale = safeCanvasHeightPercent / 100
  const viewportHeightScaleByZoom = Math.max(0.1, scoreScaleY / MANUAL_SCALE_BASELINE)
  const scoreScale = scoreScaleX
  const autoScalePercent = Math.round(baseScoreScale * 100)
  const totalScoreWidth = Math.max(1, Math.round(displayScoreWidth / scoreScaleX))

  const horizontalViewportWidthInScore = Math.max(1, horizontalViewportXRange.endX - horizontalViewportXRange.startX)
  const horizontalRenderSurfaceWidth = useMemo(() => {
    const desiredWidth = Math.ceil(horizontalViewportWidthInScore + HORIZONTAL_RENDER_BUFFER_PX * 2)
    const targetWidth = Math.max(1200, desiredWidth)
    return Math.max(1, Math.min(totalScoreWidth, Math.min(MAX_CANVAS_RENDER_DIM_PX, targetWidth)))
  }, [horizontalViewportWidthInScore, totalScoreWidth])

  const horizontalRenderOffsetX = useMemo(() => {
    const desiredOffset = Math.max(0, Math.floor(horizontalViewportXRange.startX - HORIZONTAL_RENDER_BUFFER_PX))
    const maxOffset = Math.max(0, totalScoreWidth - horizontalRenderSurfaceWidth)
    return Math.max(0, Math.min(maxOffset, desiredOffset))
  }, [horizontalRenderSurfaceWidth, horizontalViewportXRange.startX, totalScoreWidth])
  horizontalRenderOffsetXRef.current = horizontalRenderOffsetX

  const scoreWidth = horizontalRenderSurfaceWidth
  const systemRanges = useMemo<HorizontalSystemRange[]>(
    () => [{ startPairIndex: 0, endPairIndexExclusive: measurePairsLength }],
    [measurePairsLength],
  )
  const scaledScoreContentHeight = Math.max(1, horizontalViewHeightPx * viewportHeightScaleByZoom)
  const displayScoreHeight = Math.max(1, Math.round(scaledScoreContentHeight * canvasHeightScale))
  const scoreHeight = Math.max(1, Math.round(scaledScoreContentHeight / scoreScaleY))
  const scoreSurfaceOffsetXPx = horizontalRenderOffsetX * scoreScaleX
  const scaledRenderedScoreHeight = Math.max(1, scoreHeight * scoreScaleY)
  const scoreSurfaceOffsetYPx = Math.max(0, (displayScoreHeight - scaledRenderedScoreHeight) / 2)

  const renderQualityScale = useMemo<RenderQualityScale>(() => {
    const devicePixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1
    const targetQualityX = Math.max(1, devicePixelRatio, Math.abs(scoreScaleX))
    const targetQualityY = Math.max(1, devicePixelRatio, Math.abs(scoreScaleY))
    const maxQualityX = Math.max(1, MAX_CANVAS_RENDER_DIM_PX / Math.max(1, scoreWidth))
    const maxQualityY = Math.max(1, MAX_CANVAS_RENDER_DIM_PX / Math.max(1, scoreHeight))
    return {
      x: Math.max(1, Math.min(targetQualityX, maxQualityX)),
      y: Math.max(1, Math.min(targetQualityY, maxQualityY)),
    }
  }, [scoreHeight, scoreScaleX, scoreScaleY, scoreWidth])

  const systemsPerPage = 1
  const pageCount = 1
  const safeCurrentPage = 0
  const visibleSystemRange = useMemo(() => ({ start: 0, end: 0 }), [])

  const horizontalRenderWindow = useMemo<HorizontalRenderWindow>(() => {
    const frames = horizontalMeasureFramesByPair
    const renderWindowStartX = horizontalRenderOffsetX
    const renderWindowEndX = Math.min(totalScoreWidth, horizontalRenderOffsetX + scoreWidth)
    if (frames.length === 0) {
      return {
        startPairIndex: 0,
        endPairIndexExclusive: 0,
        startX: renderWindowStartX,
        endX: renderWindowEndX,
      }
    }

    let startPairIndex = 0
    while (
      startPairIndex < frames.length &&
      frames[startPairIndex].measureX + frames[startPairIndex].measureWidth < renderWindowStartX
    ) {
      startPairIndex += 1
    }

    let endPairIndexExclusive = startPairIndex
    while (endPairIndexExclusive < frames.length && frames[endPairIndexExclusive].measureX <= renderWindowEndX) {
      endPairIndexExclusive += 1
    }

    startPairIndex = Math.max(0, startPairIndex - HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES)
    endPairIndexExclusive = Math.min(frames.length, endPairIndexExclusive + HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES)
    if (endPairIndexExclusive <= startPairIndex) {
      startPairIndex = Math.max(0, Math.min(frames.length - 1, startPairIndex))
      endPairIndexExclusive = Math.min(frames.length, startPairIndex + 1)
    }

    const firstFrame = frames[startPairIndex]
    const lastFrame = frames[endPairIndexExclusive - 1]
    const startX = Math.max(0, (firstFrame?.measureX ?? 0) - 120)
    const endX = Math.min(
      totalScoreWidth,
      (lastFrame ? lastFrame.measureX + lastFrame.measureWidth : totalScoreWidth) + 120,
    )
    return { startPairIndex, endPairIndexExclusive, startX, endX }
  }, [
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    scoreWidth,
    totalScoreWidth,
  ])

  const layoutStabilityKey = useMemo(() => {
    const systemRangeKey = systemRanges
      .map((range) => `${range.startPairIndex}-${range.endPairIndexExclusive}`)
      .join(',')
    const spacingKey = [
      timeAxisSpacingConfig.baseMinGap32Px,
      timeAxisSpacingConfig.leadingBarlineGapPx,
      timeAxisSpacingConfig.secondChordSafeGapPx,
      timeAxisSpacingConfig.durationGapRatios.thirtySecond,
      timeAxisSpacingConfig.durationGapRatios.sixteenth,
      timeAxisSpacingConfig.durationGapRatios.eighth,
      timeAxisSpacingConfig.durationGapRatios.quarter,
      timeAxisSpacingConfig.durationGapRatios.half,
      timeAxisSpacingConfig.durationGapRatios.whole,
      grandStaffLayoutMetrics.staffInterGapPx,
      spacingLayoutMode,
    ].join(',')
    return `${scoreWidth}|${scoreHeight}|${pageHorizontalPaddingPx}|${systemRangeKey}|${spacingKey}`
  }, [
    pageHorizontalPaddingPx,
    scoreHeight,
    scoreWidth,
    spacingLayoutMode,
    systemRanges,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.half,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.whole,
    grandStaffLayoutMetrics.staffInterGapPx,
    timeAxisSpacingConfig.leadingBarlineGapPx,
    timeAxisSpacingConfig.secondChordSafeGapPx,
  ])

  return {
    spacingLayoutMode,
    safeChordMarkerUiScalePercent,
    safeChordMarkerPaddingPx,
    safeManualScalePercent,
    safeCanvasHeightPercent,
    chordMarkerBaseStyleMetrics,
    chordMarkerStyleMetrics,
    autoScalePercent,
    baseScoreScale,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    displayScoreWidth,
    displayScoreHeight,
    scoreWidth,
    scoreHeight,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    totalScoreWidth,
    systemRanges,
    renderQualityScale,
    systemsPerPage,
    pageCount,
    safeCurrentPage,
    visibleSystemRange,
    horizontalRenderOffsetX,
    horizontalRenderWindow,
    layoutStabilityKey,
  }
}
