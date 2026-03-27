import { buildSelectionSetSignature, buildSelectionsForMeasureRange } from '../selectionMeasureRange'
import type { MeasureFrame, MeasurePair, TimelineSegmentOverlayMode } from '../types'
import type { TimelineSegmentBlock } from './chordMarkerTypes'

const DEFAULT_TWO_MEASURE_SEGMENT_SIZE = 2

export function buildTimelineSegmentBlocks(params: {
  measurePairs: MeasurePair[]
  horizontalMeasureFramesByPair: MeasureFrame[]
  scoreScaleX: number
  stageBorderPx: number
  timelineSegmentOverlayMode: TimelineSegmentOverlayMode
  activeSelectionSignature: string
}): TimelineSegmentBlock[] {
  const {
    measurePairs,
    horizontalMeasureFramesByPair,
    scoreScaleX,
    stageBorderPx,
    timelineSegmentOverlayMode,
    activeSelectionSignature,
  } = params

  if (timelineSegmentOverlayMode !== 'default-two-measure-demo') return []
  if (measurePairs.length === 0 || horizontalMeasureFramesByPair.length === 0) return []

  const segmentBlocks: TimelineSegmentBlock[] = []
  for (
    let startPairIndex = 0;
    startPairIndex < measurePairs.length && startPairIndex < horizontalMeasureFramesByPair.length;
    startPairIndex += DEFAULT_TWO_MEASURE_SEGMENT_SIZE
  ) {
    const endPairIndexInclusive = Math.min(
      measurePairs.length - 1,
      horizontalMeasureFramesByPair.length - 1,
      startPairIndex + DEFAULT_TWO_MEASURE_SEGMENT_SIZE - 1,
    )
    const startFrame = horizontalMeasureFramesByPair[startPairIndex]
    const endFrame = horizontalMeasureFramesByPair[endPairIndexInclusive]
    if (!startFrame || !endFrame) continue

    const leftPx = startFrame.measureX * scoreScaleX + stageBorderPx
    const rightPx = (endFrame.measureX + endFrame.measureWidth) * scoreScaleX + stageBorderPx
    if (!Number.isFinite(leftPx) || !Number.isFinite(rightPx) || rightPx <= leftPx) continue

    const selections = buildSelectionsForMeasureRange({
      measurePairs,
      startPairIndex,
      endPairIndexInclusive,
    })
    const selectionSignature = buildSelectionSetSignature(selections)
    const segmentNumber = segmentBlocks.length + 1
    segmentBlocks.push({
      key: `timeline-segment-${startPairIndex}-${endPairIndexInclusive}`,
      segmentNumber,
      startPairIndex,
      endPairIndexInclusive,
      leftPx,
      widthPx: rightPx - leftPx,
      variant: segmentNumber % 2 === 0 ? 'even' : 'odd',
      measureStartNumber: startPairIndex + 1,
      measureEndNumber: endPairIndexInclusive + 1,
      isActive: selectionSignature.length > 0 && selectionSignature === activeSelectionSignature,
    })
  }

  return segmentBlocks
}
