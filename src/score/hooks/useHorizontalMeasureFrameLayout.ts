import { useCallback, useMemo, type MutableRefObject } from 'react'
import { Renderer } from 'vexflow'
import { resolveActualStartDecorationWidths, resolveStartDecorationDisplayMetas } from '../layout/startDecorationReserve'
import { solveHorizontalMeasureWidths } from '../layout/horizontalMeasureWidthSolver'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type { MeasureFrame, MeasurePair, TimeSignature } from '../types'
import {
  HORIZONTAL_VIEW_MEASURE_WIDTH_PX,
  SCORE_RENDER_BACKEND,
} from './horizontalScoreLayoutShared'
import type { MeasureFrameContentGeometry } from './horizontalScoreLayoutShared'

export function useHorizontalMeasureFrameLayout(params: {
  measurePairs: MeasurePair[]
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  supplementalSpacingTicksByPair: number[][] | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  pageHorizontalPaddingPx: number
  widthProbeRendererRef: MutableRefObject<Renderer | null>
  horizontalMeasureWidthCacheRef: MutableRefObject<Map<string, number>>
}) {
  const {
    measurePairs,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
    pageHorizontalPaddingPx,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
  } = params

  const getWidthProbeContext = useCallback((): ReturnType<Renderer['getContext']> | null => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null
    const probeWidth = 2048
    const probeHeight = 768
    const existing = widthProbeRendererRef.current
    if (existing) {
      existing.resize(probeWidth, probeHeight)
      return existing.getContext()
    }
    const canvas = document.createElement('canvas')
    const renderer = new Renderer(canvas, SCORE_RENDER_BACKEND)
    renderer.resize(probeWidth, probeHeight)
    widthProbeRendererRef.current = renderer
    return renderer.getContext()
  }, [widthProbeRendererRef])

  const horizontalMeasureStartDecorationWidths = useMemo(() => {
    if (measurePairs.length === 0) return []
    const displayMetas = resolveStartDecorationDisplayMetas({
      measureCount: measurePairs.length,
      keyFifthsByPair: measureKeyFifthsFromImport,
      timeSignaturesByPair: measureTimeSignaturesFromImport,
    })
    return resolveActualStartDecorationWidths({
      metas: displayMetas,
    }).actualStartDecorationWidthPxByPair
  }, [measureKeyFifthsFromImport, measurePairs.length, measureTimeSignaturesFromImport])

  const horizontalContentMeasureWidths = useMemo(() => {
    if (measurePairs.length === 0) return []
    const probeContext = getWidthProbeContext()
    if (!probeContext) {
      return measurePairs.map(() => HORIZONTAL_VIEW_MEASURE_WIDTH_PX)
    }
    const solverMaxIterations =
      measurePairs.length > 120 ? 8 : measurePairs.length > 48 ? 16 : 60
    const eagerProbeMeasureLimit =
      measurePairs.length > 120 ? 16 : measurePairs.length > 60 ? 24 : Number.POSITIVE_INFINITY
    return solveHorizontalMeasureWidths({
      context: probeContext,
      measurePairs,
      measureKeyFifthsByPair: measureKeyFifthsFromImport,
      measureTimeSignaturesByPair: measureTimeSignaturesFromImport,
      supplementalSpacingTicksByPair,
      spacingConfig: timeAxisSpacingConfig,
      maxIterations: solverMaxIterations,
      eagerProbeMeasureLimit,
      widthCache: horizontalMeasureWidthCacheRef.current,
    })
  }, [
    getWidthProbeContext,
    horizontalMeasureWidthCacheRef,
    measureKeyFifthsFromImport,
    measurePairs,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
  ])

  const horizontalRenderedMeasureWidths = useMemo(
    () =>
      horizontalContentMeasureWidths.map((contentMeasureWidth, pairIndex) =>
        Math.max(1, contentMeasureWidth + (horizontalMeasureStartDecorationWidths[pairIndex] ?? 0)),
      ),
    [horizontalContentMeasureWidths, horizontalMeasureStartDecorationWidths],
  )

  const horizontalEstimatedMeasureWidthTotal = useMemo(() => {
    if (horizontalRenderedMeasureWidths.length === 0) return HORIZONTAL_VIEW_MEASURE_WIDTH_PX
    const total = horizontalRenderedMeasureWidths.reduce((sum, width) => sum + width, 0)
    return Math.max(HORIZONTAL_VIEW_MEASURE_WIDTH_PX, total)
  }, [horizontalRenderedMeasureWidths])

  const horizontalMeasureFramesByPair = useMemo(() => {
    if (horizontalRenderedMeasureWidths.length === 0) return [] as MeasureFrame[]
    let cursorX = pageHorizontalPaddingPx
    return horizontalRenderedMeasureWidths.map((measureWidth, pairIndex) => {
      const contentMeasureWidth = horizontalContentMeasureWidths[pairIndex] ?? Math.max(1, measureWidth)
      const actualStartDecorationWidthPx = horizontalMeasureStartDecorationWidths[pairIndex] ?? 0
      const frame: MeasureFrame = {
        measureX: cursorX,
        measureWidth,
        contentMeasureWidth,
        renderedMeasureWidth: measureWidth,
        actualStartDecorationWidthPx,
      }
      cursorX += measureWidth
      return frame
    })
  }, [
    horizontalContentMeasureWidths,
    horizontalMeasureStartDecorationWidths,
    horizontalRenderedMeasureWidths,
    pageHorizontalPaddingPx,
  ])

  const getMeasureFrameContentGeometry = useCallback((frame: MeasureFrame | null | undefined) => {
    if (!frame) return null
    const actualStartDecorationWidthPx =
      typeof frame.actualStartDecorationWidthPx === 'number' && Number.isFinite(frame.actualStartDecorationWidthPx)
        ? Math.max(0, frame.actualStartDecorationWidthPx)
        : 0
    const contentMeasureWidth =
      typeof frame.contentMeasureWidth === 'number' && Number.isFinite(frame.contentMeasureWidth)
        ? Math.max(1, frame.contentMeasureWidth)
        : Math.max(1, frame.measureWidth - actualStartDecorationWidthPx)
    return {
      contentStartX: frame.measureX + actualStartDecorationWidthPx,
      contentMeasureWidth,
    } satisfies MeasureFrameContentGeometry
  }, [])

  return {
    horizontalEstimatedMeasureWidthTotal,
    horizontalMeasureFramesByPair,
    getMeasureFrameContentGeometry,
  }
}
