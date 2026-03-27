import { useEffect, type MutableRefObject } from 'react'
import { Renderer } from 'vexflow'
import type { MeasureLayout, Pitch, DragState } from '../types'

export function useRendererCleanup(params: {
  dragRafRef: MutableRefObject<number | null>
  dragPendingRef: MutableRefObject<{ drag: DragState; pitch: Pitch } | null>
  rendererRef: MutableRefObject<Renderer | null>
  rendererSizeRef: MutableRefObject<{ width: number; height: number }>
  overlayRendererRef: MutableRefObject<Renderer | null>
  overlayRendererSizeRef: MutableRefObject<{ width: number; height: number }>
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
}): void {
  const {
    dragRafRef,
    dragPendingRef,
    rendererRef,
    rendererSizeRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
  } = params

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current)
      }
      dragRafRef.current = null
      dragPendingRef.current = null
      rendererRef.current = null
      rendererSizeRef.current = { width: 0, height: 0 }
      overlayRendererRef.current = null
      overlayRendererSizeRef.current = { width: 0, height: 0 }
      overlayLastRectRef.current = null
    }
  }, [
    dragRafRef,
    dragPendingRef,
    rendererRef,
    rendererSizeRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
  ])
}
