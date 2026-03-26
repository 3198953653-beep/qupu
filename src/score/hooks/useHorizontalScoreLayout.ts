import { useCallback, useMemo, type MutableRefObject } from 'react'
import { Renderer } from 'vexflow'
import { A4_PAGE_WIDTH, SCORE_TOP_PADDING, SYSTEM_HEIGHT } from '../constants'
import { buildPlaybackTimeline, type PlaybackTimelineEvent } from '../playbackTimeline'
import { buildChordRulerEntries, type ChordRulerEntry } from '../chordRuler'
import { solveHorizontalMeasureWidths } from '../layout/horizontalMeasureWidthSolver'
import { resolveActualStartDecorationWidths, resolveStartDecorationDisplayMetas } from '../layout/startDecorationReserve'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import {
  applyChordMarkerVisualZoom,
  clampCanvasHeightPercent,
  clampChordMarkerPaddingPx,
  clampChordMarkerUiScalePercent,
  clampScalePercent,
  getAutoScoreScale,
  getChordMarkerBaseStyleMetrics,
  type ChordMarkerStyleMetrics,
} from '../scorePresentation'
import { buildMeasurePairs } from '../scoreOps'
import { resolvePairTimeSignature } from '../measureRestUtils'
import { getPlaybackPointKey } from './usePlaybackController'
import type {
  MeasureFrame,
  MeasurePair,
  PlaybackPoint,
  ScoreNote,
  SpacingLayoutMode,
  TimeSignature,
} from '../types'

const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const MANUAL_SCALE_BASELINE = 1
const HORIZONTAL_VIEW_MEASURE_WIDTH_PX = 220
const HORIZONTAL_VIEW_HEIGHT_PX = SCORE_TOP_PADDING * 2 + SYSTEM_HEIGHT + 26
const MAX_CANVAS_RENDER_DIM_PX = 32760
const HORIZONTAL_RENDER_BUFFER_PX = 400
const HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES = 1

export type MeasureFrameContentGeometry = {
  contentStartX: number
  contentMeasureWidth: number
}

type RenderQualityScale = {
  x: number
  y: number
}

function buildNoteIndexByIdMap(notes: ScoreNote[]): Map<string, number> {
  const byId = new Map<string, number>()
  notes.forEach((note, index) => byId.set(note.id, index))
  return byId
}

export function useHorizontalScoreLayout(params: {
  notes: ScoreNote[]
  bassNotes: ScoreNote[]
  measurePairsFromImport: MeasurePair[] | null
  importedChordRulerEntriesByPairFromImport: ChordRulerEntry[][] | null
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  autoScaleEnabled: boolean
  manualScalePercent: number
  canvasHeightPercent: number
  pageHorizontalPaddingPx: number
  chordMarkerUiScalePercent: number
  chordMarkerPaddingPx: number
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  horizontalViewportXRange: { startX: number; endX: number }
  widthProbeRendererRef: MutableRefObject<Renderer | null>
  horizontalMeasureWidthCacheRef: MutableRefObject<Map<string, number>>
  horizontalRenderOffsetXRef: MutableRefObject<number>
}): {
  measurePairs: MeasurePair[]
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  supplementalSpacingTicksByPair: number[][] | null
  playbackTimelineEvents: PlaybackTimelineEvent[]
  playbackTimelineEventByPointKey: Map<string, PlaybackTimelineEvent>
  firstPlaybackPoint: PlaybackPoint | null
  spacingLayoutMode: SpacingLayoutMode
  safeChordMarkerUiScalePercent: number
  safeChordMarkerPaddingPx: number
  safeManualScalePercent: number
  safeCanvasHeightPercent: number
  chordMarkerBaseStyleMetrics: ChordMarkerStyleMetrics
  chordMarkerStyleMetrics: ChordMarkerStyleMetrics
  autoScalePercent: number
  baseScoreScale: number
  scoreScale: number
  scoreScaleX: number
  scoreScaleY: number
  displayScoreWidth: number
  displayScoreHeight: number
  scoreWidth: number
  scoreHeight: number
  scoreSurfaceOffsetXPx: number
  scoreSurfaceOffsetYPx: number
  totalScoreWidth: number
  trebleNoteById: Map<string, ScoreNote>
  bassNoteById: Map<string, ScoreNote>
  trebleNoteIndexById: Map<string, number>
  bassNoteIndexById: Map<string, number>
  horizontalMeasureFramesByPair: MeasureFrame[]
  getMeasureFrameContentGeometry: (frame: MeasureFrame | null | undefined) => MeasureFrameContentGeometry | null
  systemRanges: Array<{ startPairIndex: number; endPairIndexExclusive: number }>
  renderQualityScale: RenderQualityScale
  systemsPerPage: number
  pageCount: number
  safeCurrentPage: number
  visibleSystemRange: { start: number; end: number }
  horizontalRenderOffsetX: number
  horizontalRenderWindow: {
    startPairIndex: number
    endPairIndexExclusive: number
    startX: number
    endX: number
  }
  layoutStabilityKey: string
} {
  const {
    notes,
    bassNotes,
    measurePairsFromImport,
    importedChordRulerEntriesByPairFromImport,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    autoScaleEnabled,
    manualScalePercent,
    canvasHeightPercent,
    pageHorizontalPaddingPx,
    chordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    timeAxisSpacingConfig,
    horizontalViewportXRange,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
    horizontalRenderOffsetXRef,
  } = params

  const measurePairs = useMemo(
    () => measurePairsFromImport ?? buildMeasurePairs(notes, bassNotes),
    [bassNotes, measurePairsFromImport, notes],
  )

  const chordRulerEntriesByPair = useMemo(() => {
    if (measurePairsFromImport !== null) {
      if (!importedChordRulerEntriesByPairFromImport) return null
      return measurePairs.map((_, pairIndex) => importedChordRulerEntriesByPairFromImport[pairIndex] ?? [])
    }
    return measurePairs.map((_, pairIndex) =>
      buildChordRulerEntries({
        pairIndex,
        timeSignature: resolvePairTimeSignature(pairIndex, measureTimeSignaturesFromImport),
      }),
    )
  }, [
    importedChordRulerEntriesByPairFromImport,
    measurePairs,
    measurePairsFromImport,
    measureTimeSignaturesFromImport,
  ])

  const supplementalSpacingTicksByPair = useMemo(
    () =>
      chordRulerEntriesByPair
        ? chordRulerEntriesByPair.map((entries) => entries.map((entry) => entry.startTick))
        : null,
    [chordRulerEntriesByPair],
  )

  const playbackTimelineEvents = useMemo(
    () =>
      buildPlaybackTimeline({
        measurePairs,
        timeSignaturesByMeasure: measureTimeSignaturesFromImport,
      }),
    [measurePairs, measureTimeSignaturesFromImport],
  )

  const playbackTimelineEventByPointKey = useMemo(
    () =>
      new Map<string, PlaybackTimelineEvent>(
        playbackTimelineEvents.map((event) => [getPlaybackPointKey(event.point), event] as const),
      ),
    [playbackTimelineEvents],
  )

  const firstPlaybackPoint = playbackTimelineEvents[0]?.point ?? null
  const spacingLayoutMode: SpacingLayoutMode = 'custom'
  const safeChordMarkerUiScalePercent = clampChordMarkerUiScalePercent(chordMarkerUiScalePercent)
  const safeChordMarkerPaddingPx = clampChordMarkerPaddingPx(chordMarkerPaddingPx)
  const chordMarkerBaseStyleMetrics = useMemo(
    () => getChordMarkerBaseStyleMetrics(safeChordMarkerUiScalePercent, safeChordMarkerPaddingPx),
    [safeChordMarkerPaddingPx, safeChordMarkerUiScalePercent],
  )

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

  const autoScoreScale = useMemo(() => getAutoScoreScale(measurePairs.length), [measurePairs.length])
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
  const minScaleForCanvasHeight = HORIZONTAL_VIEW_HEIGHT_PX / MAX_CANVAS_RENDER_DIM_PX
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
  const trebleNoteById = useMemo(() => new Map(notes.map((note) => [note.id, note] as const)), [notes])
  const bassNoteById = useMemo(() => new Map(bassNotes.map((note) => [note.id, note] as const)), [bassNotes])
  const trebleNoteIndexById = useMemo(() => buildNoteIndexByIdMap(notes), [notes])
  const bassNoteIndexById = useMemo(() => buildNoteIndexByIdMap(bassNotes), [bassNotes])

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
    }
  }, [])

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
  const systemRanges = useMemo(() => [{ startPairIndex: 0, endPairIndexExclusive: measurePairs.length }], [measurePairs.length])
  const scaledScoreContentHeight = Math.max(1, HORIZONTAL_VIEW_HEIGHT_PX * viewportHeightScaleByZoom)
  const displayScoreHeight = Math.max(1, Math.round(scaledScoreContentHeight * canvasHeightScale))
  const scoreHeight = Math.max(1, Math.round(scaledScoreContentHeight / scoreScaleY))
  const scoreSurfaceOffsetXPx = horizontalRenderOffsetX * scoreScaleX
  const scaledRenderedScoreHeight = Math.max(1, scoreHeight * scoreScaleY)
  const scoreSurfaceOffsetYPx = Math.max(0, (displayScoreHeight - scaledRenderedScoreHeight) / 2)

  const renderQualityScale = useMemo(() => {
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

  const horizontalRenderWindow = useMemo(() => {
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

    const bufferedStartX = renderWindowStartX
    const bufferedEndX = renderWindowEndX

    let startPairIndex = 0
    while (
      startPairIndex < frames.length &&
      frames[startPairIndex].measureX + frames[startPairIndex].measureWidth < bufferedStartX
    ) {
      startPairIndex += 1
    }

    let endPairIndexExclusive = startPairIndex
    while (endPairIndexExclusive < frames.length && frames[endPairIndexExclusive].measureX <= bufferedEndX) {
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
    const endX = Math.min(totalScoreWidth, (lastFrame ? lastFrame.measureX + lastFrame.measureWidth : totalScoreWidth) + 120)
    return { startPairIndex, endPairIndexExclusive, startX, endX }
  }, [
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    scoreWidth,
    totalScoreWidth,
  ])

  const layoutStabilityKey = useMemo(() => {
    const systemRangeKey = systemRanges.map((range) => `${range.startPairIndex}-${range.endPairIndexExclusive}`).join(',')
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
    timeAxisSpacingConfig.leadingBarlineGapPx,
    timeAxisSpacingConfig.secondChordSafeGapPx,
  ])

  return {
    measurePairs,
    chordRulerEntriesByPair,
    supplementalSpacingTicksByPair,
    playbackTimelineEvents,
    playbackTimelineEventByPointKey,
    firstPlaybackPoint,
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
    trebleNoteById,
    bassNoteById,
    trebleNoteIndexById,
    bassNoteIndexById,
    horizontalMeasureFramesByPair,
    getMeasureFrameContentGeometry,
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
