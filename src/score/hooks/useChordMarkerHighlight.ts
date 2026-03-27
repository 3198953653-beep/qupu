import { useCallback, useMemo, type MutableRefObject } from 'react'
import { buildStaffOnsetTicks } from '../selectionTimelineRange'
import type { MeasureFrame, MeasureLayout, MeasurePair, NoteLayout } from '../types'
import type { ActiveChordSelection, ActiveTimelineSegmentHighlight, MeasureSelectionScope } from './chordMarkerTypes'

function resolveStaffLineBounds(measureLayout: MeasureLayout, staff: 'treble' | 'bass') {
  const lineTopRaw =
    staff === 'treble'
      ? (Number.isFinite(measureLayout.trebleLineTopY) ? measureLayout.trebleLineTopY : measureLayout.trebleY)
      : (Number.isFinite(measureLayout.bassLineTopY) ? measureLayout.bassLineTopY : measureLayout.bassY)
  const lineBottomRaw =
    staff === 'treble'
      ? (Number.isFinite(measureLayout.trebleLineBottomY) ? measureLayout.trebleLineBottomY : measureLayout.trebleY + 40)
      : (Number.isFinite(measureLayout.bassLineBottomY) ? measureLayout.bassLineBottomY : measureLayout.bassY + 40)
  return {
    lineTop: Math.min(lineTopRaw, lineBottomRaw),
    lineBottom: Math.max(lineTopRaw, lineBottomRaw),
  }
}

function resolveCombinedStaffLineBounds(measureLayout: MeasureLayout) {
  const trebleBounds = resolveStaffLineBounds(measureLayout, 'treble')
  const bassBounds = resolveStaffLineBounds(measureLayout, 'bass')
  return {
    lineTop: Math.min(trebleBounds.lineTop, bassBounds.lineTop),
    lineBottom: Math.max(trebleBounds.lineBottom, bassBounds.lineBottom),
  }
}

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

    const layoutByStaffNoteIndex = new Map<string, NoteLayout>()
    pairLayouts.forEach((layout) => {
      layoutByStaffNoteIndex.set(`${layout.staff}:${layout.noteIndex}`, layout)
    })

    let minLeftX = Number.POSITIVE_INFINITY
    let maxRightX = Number.NEGATIVE_INFINITY
    const acceptBounds = (left: number, right: number) => {
      if (!Number.isFinite(left) || !Number.isFinite(right)) return
      if (right <= left) return
      minLeftX = Math.min(minLeftX, left)
      maxRightX = Math.max(maxRightX, right)
    }

    ;(['treble', 'bass'] as const).forEach((staff) => {
      const staffNotes = staff === 'treble' ? pair.treble : pair.bass
      const onsetTicksByNoteIndex = buildStaffOnsetTicks(staffNotes)
      staffNotes.forEach((_, noteIndex) => {
        const onsetTick = onsetTicksByNoteIndex[noteIndex]
        if (!Number.isFinite(onsetTick)) return
        if (onsetTick < safeStartTick || onsetTick >= safeEndTick) return

        const layout = layoutByStaffNoteIndex.get(`${staff}:${noteIndex}`) ?? null
        if (!layout) return

        const leftCandidates: number[] = []
        if (Number.isFinite(layout.x)) leftCandidates.push(layout.x)
        layout.noteHeads.forEach((head) => {
          if (Number.isFinite(head.hitMinX)) {
            leftCandidates.push(head.hitMinX as number)
          } else if (Number.isFinite(head.x)) {
            leftCandidates.push(head.x)
          }
        })
        layout.accidentalLayouts.forEach((accidental) => {
          if (Number.isFinite(accidental.hitMinX)) {
            leftCandidates.push(accidental.hitMinX as number)
            return
          }
          if (!Number.isFinite(accidental.x)) return
          if (Number.isFinite(accidental.hitRadiusX)) {
            leftCandidates.push(accidental.x - (accidental.hitRadiusX as number))
            return
          }
          leftCandidates.push(accidental.x - 4)
        })

        const rightCandidates: number[] = []
        layout.noteHeads.forEach((head) => {
          if (Number.isFinite(head.hitMaxX)) {
            rightCandidates.push(head.hitMaxX as number)
            return
          }
          if (Number.isFinite(head.x)) {
            rightCandidates.push(head.x + 9)
          }
        })
        if (Number.isFinite(layout.spacingRightX)) {
          rightCandidates.push(layout.spacingRightX)
        }
        if (rightCandidates.length === 0 && Number.isFinite(layout.x)) {
          rightCandidates.push(layout.x + 9)
        }
        if (rightCandidates.length === 0 && Number.isFinite(layout.rightX)) {
          rightCandidates.push(layout.rightX)
        }

        const noteLeft = leftCandidates.length > 0 ? Math.min(...leftCandidates) : Number.POSITIVE_INFINITY
        const noteRight = rightCandidates.length > 0 ? Math.max(...rightCandidates) : Number.NEGATIVE_INFINITY
        acceptBounds(noteLeft, noteRight)
      })
    })

    if (!Number.isFinite(minLeftX) || !Number.isFinite(maxRightX)) return null
    if (maxRightX <= minLeftX) return null
    return {
      leftXRaw: minLeftX,
      rightXRaw: maxRightX,
    }
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
    const x =
      frame !== null
        ? frame.measureX * scoreScaleX + stageBorderPx
        : scoreSurfaceOffsetXPx + measureLayout.measureX * scoreScaleX + stageBorderPx
    const { lineTop, lineBottom } = resolveStaffLineBounds(measureLayout, selectedMeasureScope.staff)
    const y = scoreSurfaceOffsetYPx + lineTop * scoreScaleY + stageBorderPx
    const width =
      frame !== null
        ? frame.measureWidth * scoreScaleX
        : measureLayout.measureWidth * scoreScaleX
    const height = (lineBottom - lineTop) * scoreScaleY
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
