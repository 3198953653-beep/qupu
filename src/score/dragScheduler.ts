import type { MutableRefObject } from 'react'
import type { DragState, Pitch } from './types'

export function flushPendingDragFrame(params: {
  dragRafRef: MutableRefObject<number | null>
  dragPendingRef: MutableRefObject<{ drag: DragState; pitch: Pitch } | null>
  applyDragPreview: (drag: DragState, pitch: Pitch) => void
}): void {
  const { dragRafRef, dragPendingRef, applyDragPreview } = params
  dragRafRef.current = null
  const pending = dragPendingRef.current
  if (!pending) return
  dragPendingRef.current = null
  applyDragPreview(pending.drag, pending.pitch)
}

export function scheduleDragCommitFrame(params: {
  drag: DragState
  pitch: Pitch
  dragRafRef: MutableRefObject<number | null>
  dragPendingRef: MutableRefObject<{ drag: DragState; pitch: Pitch } | null>
  flushPendingDrag: () => void
}): void {
  const { drag, pitch, dragRafRef, dragPendingRef, flushPendingDrag } = params
  dragPendingRef.current = { drag, pitch }
  if (dragRafRef.current !== null) return
  dragRafRef.current = window.requestAnimationFrame(flushPendingDrag)
}
