import { useMemo, type MutableRefObject } from 'react'
import { Renderer } from 'vexflow'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import type { ChordRulerEntry } from '../chordRuler'
import { getGrandStaffLayoutMetrics, type GrandStaffLayoutMetrics } from '../grandStaffLayout'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type { ChordMarkerStyleMetrics } from '../scorePresentation'
import { useHorizontalMeasureFrameLayout } from './useHorizontalMeasureFrameLayout'
import type { MeasureFrameContentGeometry, RenderQualityScale } from './horizontalScoreLayoutShared'
import { useHorizontalViewportLayout } from './useHorizontalViewportLayout'
import { useScoreMeasureTimelineData } from './useScoreMeasureTimelineData'
import type {
  MeasureFrame,
  MeasurePair,
  PlaybackPoint,
  ScoreNote,
  SpacingLayoutMode,
  TimeSignature,
} from '../types'

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
  staffInterGapPx: number
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
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
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
    staffInterGapPx,
    pageHorizontalPaddingPx,
    chordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    timeAxisSpacingConfig,
    horizontalViewportXRange,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
    horizontalRenderOffsetXRef,
  } = params

  const timelineData = useScoreMeasureTimelineData({
    notes,
    bassNotes,
    measurePairsFromImport,
    importedChordRulerEntriesByPairFromImport,
    measureTimeSignaturesFromImport,
  })
  const grandStaffLayoutMetrics = useMemo(
    () => getGrandStaffLayoutMetrics(staffInterGapPx),
    [staffInterGapPx],
  )

  const measureFrameLayout = useHorizontalMeasureFrameLayout({
    measurePairs: timelineData.measurePairs,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair: timelineData.supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
    grandStaffLayoutMetrics,
    pageHorizontalPaddingPx,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
  })

  const viewportLayout = useHorizontalViewportLayout({
    measurePairsLength: timelineData.measurePairs.length,
    pageHorizontalPaddingPx,
    autoScaleEnabled,
    manualScalePercent,
    canvasHeightPercent,
    grandStaffLayoutMetrics,
    chordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    horizontalEstimatedMeasureWidthTotal: measureFrameLayout.horizontalEstimatedMeasureWidthTotal,
    horizontalMeasureFramesByPair: measureFrameLayout.horizontalMeasureFramesByPair,
    timeAxisSpacingConfig,
    horizontalViewportXRange,
    horizontalRenderOffsetXRef,
  })

  return {
    ...timelineData,
    ...viewportLayout,
    grandStaffLayoutMetrics,
    horizontalMeasureFramesByPair: measureFrameLayout.horizontalMeasureFramesByPair,
    getMeasureFrameContentGeometry: measureFrameLayout.getMeasureFrameContentGeometry,
  }
}
