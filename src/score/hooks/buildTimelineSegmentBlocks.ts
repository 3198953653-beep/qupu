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
  importedTimelineSegmentStartPairIndexes: number[] | null
  activeSelectionSignature: string
}): TimelineSegmentBlock[] {
  const {
    measurePairs,
    horizontalMeasureFramesByPair,
    scoreScaleX,
    stageBorderPx,
    timelineSegmentOverlayMode,
    importedTimelineSegmentStartPairIndexes,
    activeSelectionSignature,
  } = params

  if (measurePairs.length === 0 || horizontalMeasureFramesByPair.length === 0) return []

  const segmentBlocks: TimelineSegmentBlock[] = []
  const maxPairIndex = Math.min(measurePairs.length, horizontalMeasureFramesByPair.length) - 1
  if (maxPairIndex < 0) return []

  const segmentRanges: Array<{ startPairIndex: number; endPairIndexInclusive: number }> = []
  if (timelineSegmentOverlayMode === 'curated-two-measure') {
    for (let startPairIndex = 0; startPairIndex <= maxPairIndex; startPairIndex += DEFAULT_TWO_MEASURE_SEGMENT_SIZE) {
      segmentRanges.push({
        startPairIndex,
        endPairIndexInclusive: Math.min(maxPairIndex, startPairIndex + DEFAULT_TWO_MEASURE_SEGMENT_SIZE - 1),
      })
    }
  } else if (timelineSegmentOverlayMode === 'imported-last-part') {
    const normalizedStarts = [...new Set(importedTimelineSegmentStartPairIndexes ?? [])]
      .map((value) => Math.trunc(value))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= maxPairIndex)
      .sort((left, right) => left - right)

    if (normalizedStarts.length === 0) return []
    for (let startIndex = 0; startIndex < normalizedStarts.length; startIndex += 1) {
      const startPairIndex = normalizedStarts[startIndex]
      const nextStartPairIndex = normalizedStarts[startIndex + 1]
      segmentRanges.push({
        startPairIndex,
        endPairIndexInclusive:
          nextStartPairIndex === undefined ? maxPairIndex : Math.min(maxPairIndex, nextStartPairIndex - 1),
      })
    }
  } else {
    return []
  }

  for (const range of segmentRanges) {
    const { startPairIndex, endPairIndexInclusive } = range
    if (endPairIndexInclusive < startPairIndex) continue
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
      scopeKey: `${startPairIndex}:${endPairIndexInclusive}`,
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
