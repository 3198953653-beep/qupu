import { useCallback, useMemo, type MutableRefObject } from 'react'
import {
  collectMeasureTickRangeLayoutCoverage,
  getMeasureTickRangeLayoutBounds,
} from '../chordRangeNoteCoverage'
import {
  buildMeasureSurfaceHighlightRect,
  resolveCombinedStaffLineBounds,
} from '../highlightRect'
import type { MeasureFrame, MeasureLayout, MeasurePair, NoteLayout } from '../types'
import type { ActiveChordSelection, ActiveTimelineSegmentHighlight, MeasureSelectionScope } from './chordMarkerTypes'

export function useChordMarkerHighlight(params: {
  activeChordSelection: ActiveChordSelection | null
  activeTimelineSegmentHighlight: ActiveTimelineSegmentHighlight | null
  selectedMeasureScope: MeasureSelectionScope | null
  measurePairsRef: MutableRefObject<MeasurePair[]>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  horizontalMeasureFramesByPair: MeasureFrame[]
  scoreScaleX: number
  scoreScaleY: number
  scoreSurfaceOffsetXPx: number
  scoreSurfaceOffsetYPx: number
  stageBorderPx: number
  chordHighlightPadXPx: number
  chordHighlightPadYPx: number
  layoutStabilityKey: string
  chordMarkerLayoutRevision: number
}) {
  const {
    activeChordSelection,
    activeTimelineSegmentHighlight,
    selectedMeasureScope,
    measurePairsRef,
    noteLayoutsByPairRef,
    measureLayoutsRef,
    horizontalMeasureFramesByPair,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    stageBorderPx,
    chordHighlightPadXPx,
    chordHighlightPadYPx,
    layoutStabilityKey,
    chordMarkerLayoutRevision,
  } = params

  const resolveChordHighlightContentBounds = useCallback((highlightParams: {
    pairIndex: number
    startTick: number
    endTick: number
  }): { leftXRaw: number; rightXRaw: number } | null => {
    const safeStartTick = Math.max(0, Math.round(highlightParams.startTick))
    const safeEndTick = Math.max(safeStartTick, Math.round(highlightParams.endTick))
    if (safeEndTick <= safeStartTick) return null

    const pair = measurePairsRef.current[highlightParams.pairIndex]
    if (!pair) return null
    const pairLayouts = noteLayoutsByPairRef.current.get(highlightParams.pairIndex) ?? []
    if (pairLayouts.length === 0) return null
    const coverage = collectMeasureTickRangeLayoutCoverage({
      pair,
      pairLayouts,
      startTickInclusive: safeStartTick,
      endTickExclusive: safeEndTick,
      includeRests: true,
    })
    return getMeasureTickRangeLayoutBounds(coverage, 'selection')
  }, [measurePairsRef, noteLayoutsByPairRef])

  return useMemo(() => {
    void layoutStabilityKey
    void chordMarkerLayoutRevision
    const measurePadX = 6
    const measurePadY = 4

    if (activeChordSelection !== null) {
      const measureLayout = measureLayoutsRef.current.get(activeChordSelection.pairIndex) ?? null
      if (!measureLayout) return null
      const contentBounds = resolveChordHighlightContentBounds({
        pairIndex: activeChordSelection.pairIndex,
        startTick: activeChordSelection.startTick,
        endTick: activeChordSelection.endTick,
      })
      if (!contentBounds) return null

      const { lineTop, lineBottom } = resolveCombinedStaffLineBounds(measureLayout)
      const x = scoreSurfaceOffsetXPx + contentBounds.leftXRaw * scoreScaleX + stageBorderPx
      const y = scoreSurfaceOffsetYPx + lineTop * scoreScaleY + stageBorderPx
      const width = (contentBounds.rightXRaw - contentBounds.leftXRaw) * scoreScaleX
      const height = (lineBottom - lineTop) * scoreScaleY
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null
      }
      if (width <= 0 || height <= 0) return null
      return {
        x: x - chordHighlightPadXPx,
        y: y - chordHighlightPadYPx,
        width: width + chordHighlightPadXPx * 2,
        height: height + chordHighlightPadYPx * 2,
      }
    }

    if (activeTimelineSegmentHighlight !== null) {
      const startFrame = horizontalMeasureFramesByPair[activeTimelineSegmentHighlight.startPairIndex] ?? null
      const endFrame = horizontalMeasureFramesByPair[activeTimelineSegmentHighlight.endPairIndexInclusive] ?? null
      if (!startFrame || !endFrame) return null

      let minLineTop = Number.POSITIVE_INFINITY
      let maxLineBottom = Number.NEGATIVE_INFINITY

      for (
        let pairIndex = activeTimelineSegmentHighlight.startPairIndex;
        pairIndex <= activeTimelineSegmentHighlight.endPairIndexInclusive;
        pairIndex += 1
      ) {
        const measureLayout = measureLayoutsRef.current.get(pairIndex) ?? null
        if (!measureLayout) continue
        const { lineTop, lineBottom } = resolveCombinedStaffLineBounds(measureLayout)
        minLineTop = Math.min(minLineTop, lineTop)
        maxLineBottom = Math.max(maxLineBottom, lineBottom)
      }

      if (!Number.isFinite(minLineTop) || !Number.isFinite(maxLineBottom) || maxLineBottom <= minLineTop) {
        return null
      }

      const x = startFrame.measureX * scoreScaleX + stageBorderPx
      const y = scoreSurfaceOffsetYPx + minLineTop * scoreScaleY + stageBorderPx
      const width = (endFrame.measureX + endFrame.measureWidth - startFrame.measureX) * scoreScaleX
      const height = (maxLineBottom - minLineTop) * scoreScaleY
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null
      }
      if (width <= 0 || height <= 0) return null
      return {
        x: x - measurePadX,
        y: y - measurePadY,
        width: width + measurePadX * 2,
        height: height + measurePadY * 2,
      }
    }

    if (selectedMeasureScope === null) return null
    const measureLayout = measureLayoutsRef.current.get(selectedMeasureScope.pairIndex) ?? null
    if (!measureLayout) return null
    const frame = horizontalMeasureFramesByPair[selectedMeasureScope.pairIndex] ?? null
    return buildMeasureSurfaceHighlightRect({
      measureLayout,
      frame,
      staff: selectedMeasureScope.staff,
      scaleX: scoreScaleX,
      scaleY: scoreScaleY,
      offsetX: frame !== null ? stageBorderPx : scoreSurfaceOffsetXPx + stageBorderPx,
      offsetY: scoreSurfaceOffsetYPx + stageBorderPx,
      padX: measurePadX,
      padY: measurePadY,
      preferFrameX: frame !== null,
      preferFrameWidth: frame !== null,
    })
  }, [
    activeChordSelection,
    activeTimelineSegmentHighlight,
    chordHighlightPadXPx,
    chordHighlightPadYPx,
    chordMarkerLayoutRevision,
    horizontalMeasureFramesByPair,
    layoutStabilityKey,
    measureLayoutsRef,
    resolveChordHighlightContentBounds,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    selectedMeasureScope,
    stageBorderPx,
  ])
}
