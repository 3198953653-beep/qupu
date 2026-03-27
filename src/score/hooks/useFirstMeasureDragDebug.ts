import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import {
  buildFirstMeasureDiffReport,
  captureFirstMeasureSnapshot,
  type FirstMeasureDragContext,
  type FirstMeasureSnapshot,
} from '../scoreDebugReports'
import type { DragDebugSnapshot, DragState, MeasureLayout, MeasurePair, NoteLayout } from '../types'

const ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG = false

export type BeginOrEndDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => void

export function useFirstMeasureDragDebug(params: {
  beginDrag: BeginOrEndDrag
  endDrag: BeginOrEndDrag
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  measurePairsRef: MutableRefObject<MeasurePair[]>
  dragDebugFramesRef: MutableRefObject<DragDebugSnapshot[]>
  dragRef: MutableRefObject<DragState | null>
}) {
  const {
    beginDrag,
    endDrag,
    scoreScrollRef,
    measureLayoutsRef,
    noteLayoutsByPairRef,
    measurePairsRef,
    dragDebugFramesRef,
    dragRef,
  } = params

  const firstMeasureBaselineRef = useRef<FirstMeasureSnapshot | null>(null)
  const firstMeasureDragContextRef = useRef<FirstMeasureDragContext | null>(null)
  const firstMeasureDebugRafRef = useRef<number | null>(null)

  const onBeginDragWithFirstMeasureDebug = useCallback<BeginOrEndDrag>((event) => {
    scoreScrollRef.current?.focus()
    beginDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    const drag = dragRef.current
    if (!drag) return
    firstMeasureDragContextRef.current = {
      noteId: drag.noteId,
      staff: drag.staff,
      keyIndex: drag.keyIndex,
      pairIndex: drag.pairIndex,
    }
    firstMeasureBaselineRef.current = captureFirstMeasureSnapshot({
      stage: 'before-drag',
      measurePairs: measurePairsRef.current,
      noteLayoutsByPair: noteLayoutsByPairRef.current,
      measureLayouts: measureLayoutsRef.current,
    })
  }, [beginDrag, dragRef, measureLayoutsRef, measurePairsRef, noteLayoutsByPairRef, scoreScrollRef])

  const onEndDragWithFirstMeasureDebug = useCallback<BeginOrEndDrag>((event) => {
    const dragging = dragRef.current
    endDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    if (!dragging) return
    const beforeSnapshot = firstMeasureBaselineRef.current
    if (!beforeSnapshot) return
    if (firstMeasureDebugRafRef.current !== null) {
      window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      firstMeasureDebugRafRef.current = null
    }
    firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
      firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
        const afterSnapshot = captureFirstMeasureSnapshot({
          stage: 'after-drag-release',
          measurePairs: measurePairsRef.current,
          noteLayoutsByPair: noteLayoutsByPairRef.current,
          measureLayouts: measureLayoutsRef.current,
        })
        if (afterSnapshot) {
          const report = buildFirstMeasureDiffReport({
            beforeSnapshot,
            afterSnapshot,
            dragContext: firstMeasureDragContextRef.current,
            dragPreviewFrameCount: dragDebugFramesRef.current.length,
          })
          console.log(report)
        }
        firstMeasureBaselineRef.current = null
        firstMeasureDragContextRef.current = null
        firstMeasureDebugRafRef.current = null
      })
    })
  }, [dragDebugFramesRef, dragRef, endDrag, measureLayoutsRef, measurePairsRef, noteLayoutsByPairRef])

  useEffect(() => {
    return () => {
      if (firstMeasureDebugRafRef.current !== null) {
        window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      }
    }
  }, [])

  return {
    onBeginDragWithFirstMeasureDebug,
    onEndDragWithFirstMeasureDebug,
  }
}
