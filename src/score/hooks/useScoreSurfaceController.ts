import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { Renderer } from 'vexflow'
import { useDragHandlers } from '../dragHandlers'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import {
  useImportedRefsSync,
  useRendererCleanup,
  useRhythmLinkedBassSync,
  useScoreRenderEffect,
  useSynthLifecycle,
} from './useScoreEffects'

type ViewportXRange = {
  startX: number
  endX: number
}

export function useScoreSurfaceController(params: {
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  setHorizontalViewportXRange: Dispatch<SetStateAction<ViewportXRange>>
  scoreScaleX: number
  totalScoreWidth: number
  displayScoreWidth: number
  widthProbeRendererRef: MutableRefObject<Renderer | null>
  horizontalMeasureWidthCacheRef: MutableRefObject<Map<string, number>>
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  clearDragOverlayRef: MutableRefObject<() => void>
  importedRefsSync: Parameters<typeof useImportedRefsSync>[0]
  rhythmLinkedBassSync: Parameters<typeof useRhythmLinkedBassSync>[0]
  scoreRender: Parameters<typeof useScoreRenderEffect>[0]
  synthLifecycle: Parameters<typeof useSynthLifecycle>[0]
  rendererCleanup: Parameters<typeof useRendererCleanup>[0]
  dragHandlers: Parameters<typeof useDragHandlers>[0]
}): Pick<ReturnType<typeof useDragHandlers>, 'clearDragOverlay' | 'onSurfacePointerMove' | 'endDrag' | 'beginDrag'> {
  const {
    scoreScrollRef,
    setHorizontalViewportXRange,
    scoreScaleX,
    totalScoreWidth,
    displayScoreWidth,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
    timeAxisSpacingConfig,
    clearDragOverlayRef,
    importedRefsSync,
    rhythmLinkedBassSync,
    scoreRender,
    synthLifecycle,
    rendererCleanup,
    dragHandlers,
  } = params

  useEffect(() => {
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) {
      setHorizontalViewportXRange({ startX: 0, endX: totalScoreWidth })
      return
    }

    const updateViewport = () => {
      const nextStartX = Math.max(0, scrollHost.scrollLeft / scoreScaleX)
      const nextEndX = Math.max(nextStartX + 1, (scrollHost.scrollLeft + scrollHost.clientWidth) / scoreScaleX)
      setHorizontalViewportXRange((current) => {
        if (Math.abs(current.startX - nextStartX) < 0.5 && Math.abs(current.endX - nextEndX) < 0.5) {
          return current
        }
        return { startX: nextStartX, endX: nextEndX }
      })
    }

    updateViewport()
    scrollHost.addEventListener('scroll', updateViewport, { passive: true })
    window.addEventListener('resize', updateViewport)

    return () => {
      scrollHost.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
    }
  }, [displayScoreWidth, scoreScaleX, scoreScrollRef, setHorizontalViewportXRange, totalScoreWidth])

  useImportedRefsSync(importedRefsSync)
  useRhythmLinkedBassSync(rhythmLinkedBassSync)
  useScoreRenderEffect(scoreRender)
  useSynthLifecycle(synthLifecycle)
  useRendererCleanup(rendererCleanup)

  useEffect(() => {
    return () => {
      widthProbeRendererRef.current = null
    }
  }, [widthProbeRendererRef])

  useEffect(() => {
    if (horizontalMeasureWidthCacheRef.current.size === 0) return
    horizontalMeasureWidthCacheRef.current.clear()
  }, [
    horizontalMeasureWidthCacheRef,
    timeAxisSpacingConfig.minMeasureWidthPx,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.leadingBarlineGapPx,
    timeAxisSpacingConfig.secondChordSafeGapPx,
    timeAxisSpacingConfig.interOnsetPaddingPx,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.half,
    timeAxisSpacingConfig.durationGapRatios.whole,
  ])

  const { clearDragOverlay, onSurfacePointerMove, endDrag, beginDrag } = useDragHandlers(dragHandlers)

  useEffect(() => {
    clearDragOverlayRef.current = clearDragOverlay
  }, [clearDragOverlay, clearDragOverlayRef])

  return {
    clearDragOverlay,
    onSurfacePointerMove,
    endDrag,
    beginDrag,
  }
}
