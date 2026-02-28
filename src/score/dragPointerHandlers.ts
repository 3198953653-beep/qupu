import type { Dispatch, MutableRefObject, PointerEvent, SetStateAction } from 'react'
import { getHitNote } from './layout/hitTest'
import type { HitGridIndex } from './layout/hitTest'
import { buildDragStateForHit, getDragMovePitch } from './dragInteractions'
import { buildSelectionGroupMoveTargets } from './selectionGroupTargets'
import { buildSelectionsInTimelineRange } from './selectionTimelineRange'
import { getTieFrozenIncoming } from './tieFrozen'
import type {
  DragDebugSnapshot,
  DragState,
  ImportedNoteLocation,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Pitch,
  ScoreNote,
  Selection,
} from './types'

type StateSetter<T> = Dispatch<SetStateAction<T>>
export type SelectionPointerMode = 'replace' | 'append' | 'range'

function upsertSelection(
  selection: Selection,
): (current: Selection) => Selection {
  return (current) => {
    if (
      current.noteId === selection.noteId &&
      current.staff === selection.staff &&
      current.keyIndex === selection.keyIndex
    ) {
      return current
    }
    return selection
  }
}

function upsertNullableSelection(
  selection: Selection,
): (current: Selection | null) => Selection {
  return (current) => {
    if (
      current &&
      current.noteId === selection.noteId &&
      current.staff === selection.staff &&
      current.keyIndex === selection.keyIndex
    ) {
      return current
    }
    return selection
  }
}

function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}

function appendUniqueSelection(current: Selection[], next: Selection): Selection[] {
  if (current.some((entry) => isSameSelection(entry, next))) return current
  return [...current, next]
}

function findLayoutForTarget(params: {
  noteLayouts: NoteLayout[]
  target: { noteId: string; staff: Selection['staff']; pairIndex: number; noteIndex: number }
}): NoteLayout | null {
  const { noteLayouts, target } = params
  const exact = noteLayouts.find(
    (layout) =>
      layout.id === target.noteId &&
      layout.staff === target.staff &&
      layout.pairIndex === target.pairIndex &&
      layout.noteIndex === target.noteIndex,
  )
  if (exact) return exact
  return (
    noteLayouts.find((layout) => layout.id === target.noteId && layout.staff === target.staff) ??
    null
  )
}

function resolveHeadAnchor(params: {
  layout: NoteLayout | null
  keyIndex: number
  pitchHint?: Pitch | null
}): { x: number; y: number } | null {
  const { layout, keyIndex, pitchHint = null } = params
  if (!layout) return null
  const head =
    layout.noteHeads.find((item) => item.keyIndex === keyIndex) ??
    (pitchHint ? layout.noteHeads.find((item) => item.pitch === pitchHint) : undefined) ??
    layout.noteHeads[0]
  if (!head) return null
  return {
    x: head.x + 6,
    y: head.y,
  }
}

export function handleBeginDragPointer(params: {
  event: PointerEvent<HTMLCanvasElement>
  surface: HTMLCanvasElement | null
  noteLayouts: NoteLayout[]
  hitGrid: HitGridIndex | null
  dragPreviewFrameRef: MutableRefObject<number>
  dragDebugFramesRef: MutableRefObject<DragDebugSnapshot[]>
  clearDragOverlay: () => void
  importedPairs: MeasurePair[] | null
  importedNoteLookup: Map<string, ImportedNoteLocation>
  trebleNoteById: Map<string, ScoreNote>
  bassNoteById: Map<string, ScoreNote>
  currentMeasurePairs: MeasurePair[]
  measureLayouts: Map<number, MeasureLayout>
  importedKeyFifths: number[] | null
  pitches: Pitch[]
  dragRef: MutableRefObject<DragState | null>
  currentSelections: Selection[]
  setActiveSelection: StateSetter<Selection>
  setDraggingSelection: StateSetter<Selection | null>
  onSelectionPointerDown?: (
    selection: Selection,
    nextSelections: Selection[],
    mode: SelectionPointerMode,
  ) => void
  onBlankPointerDown?: () => void
  onSelectionActivated?: () => void
  hitRadius?: number
}): void {
  const {
    event,
    surface,
    noteLayouts,
    hitGrid,
    dragPreviewFrameRef,
    dragDebugFramesRef,
    clearDragOverlay,
    importedPairs,
    importedNoteLookup,
    trebleNoteById,
    bassNoteById,
    currentMeasurePairs,
    measureLayouts,
    importedKeyFifths,
    pitches,
    dragRef,
    currentSelections,
    setActiveSelection,
    setDraggingSelection,
    onSelectionPointerDown,
    onBlankPointerDown,
    onSelectionActivated,
    hitRadius = 30,
  } = params

  if (!surface) return

  const rect = surface.getBoundingClientRect()
  // Use CSS layout size instead of backing-store size to avoid DPR-induced hit-test drift.
  const logicalWidth = surface.clientWidth || surface.width
  const logicalHeight = surface.clientHeight || surface.height
  const clientToScoreScaleX = rect.width > 0 ? logicalWidth / rect.width : 1
  const clientToScoreScaleY = rect.height > 0 ? logicalHeight / rect.height : 1
  const x = (event.clientX - rect.left) * clientToScoreScaleX
  const y = (event.clientY - rect.top) * clientToScoreScaleY
  const logicalHitRadius = hitRadius * clientToScoreScaleX
  const hit = getHitNote(x, y, noteLayouts, logicalHitRadius, hitGrid)
  if (!hit) {
    onBlankPointerDown?.()
    return
  }
  const hitHead = hit.head

  event.preventDefault()
  dragPreviewFrameRef.current = 0
  dragDebugFramesRef.current = []
  clearDragOverlay()

  const { dragState, selection } = buildDragStateForHit({
    hit,
    pointerId: event.pointerId,
    surfaceTop: rect.top,
    surfaceClientToScoreScaleY: clientToScoreScaleY,
    startClientY: event.clientY,
    localPointerY: y,
    importedPairs,
    importedNoteLookup,
    trebleNoteById,
    bassNoteById,
    currentMeasurePairs,
    measureLayouts,
    importedKeyFifths,
    pitches,
  })

  dragRef.current = dragState
  const selectionMode: SelectionPointerMode = event.shiftKey ? 'range' : event.ctrlKey ? 'append' : 'replace'
  const alreadySelected = currentSelections.some((entry) => isSameSelection(entry, selection))
  const effectiveSelections =
    selectionMode === 'range'
      ? (() => {
          const anchors = appendUniqueSelection(currentSelections, selection)
          const rangeSelections = buildSelectionsInTimelineRange({
            anchors,
            measurePairs: importedPairs ?? currentMeasurePairs,
            importedNoteLookup,
          })
          return rangeSelections.length > 0 ? rangeSelections : [selection]
        })()
      : selectionMode === 'append'
        ? appendUniqueSelection(currentSelections, selection)
        : (alreadySelected && currentSelections.length > 0 ? currentSelections : [selection])
  dragState.groupMoveTargets = buildSelectionGroupMoveTargets({
    effectiveSelections,
    primarySelection: selection,
    measurePairs: importedPairs ?? currentMeasurePairs,
    importedNoteLookup,
    measureLayouts,
    importedKeyFifths,
  })
  const sourceTarget =
    dragState.linkedTieTargets?.find(
      (target) =>
        target.noteId === selection.noteId &&
        target.staff === selection.staff &&
        target.keyIndex === selection.keyIndex,
    ) ??
    dragState.linkedTieTargets?.[0] ??
    null
  const previousTarget = dragState.previousTieTarget ?? null
  if (sourceTarget && previousTarget) {
    const sourcePair = (importedPairs ?? currentMeasurePairs)[sourceTarget.pairIndex]
    const sourceStaffNotes = sourceTarget.staff === 'treble' ? sourcePair?.treble : sourcePair?.bass
    const sourceStaffNote = sourceStaffNotes?.[sourceTarget.noteIndex]
    const sourceFrozenIncoming =
      sourceStaffNote && sourceStaffNote.id === sourceTarget.noteId
        ? getTieFrozenIncoming(sourceStaffNote, sourceTarget.keyIndex)
        : null
    const previousLayout = findLayoutForTarget({
      noteLayouts,
      target: {
        noteId: previousTarget.noteId,
        staff: previousTarget.staff,
        pairIndex: previousTarget.pairIndex,
        noteIndex: previousTarget.noteIndex,
      },
    })
    const previousAnchor = resolveHeadAnchor({
      layout: previousLayout,
      keyIndex: previousTarget.keyIndex,
      pitchHint: previousTarget.pitch,
    })
    const sourceLayout = findLayoutForTarget({
      noteLayouts,
      target: {
        noteId: sourceTarget.noteId,
        staff: sourceTarget.staff,
        pairIndex: sourceTarget.pairIndex,
        noteIndex: sourceTarget.noteIndex,
      },
    })
    const fallbackSourceAnchor = resolveHeadAnchor({
      layout: sourceLayout,
      keyIndex: sourceTarget.keyIndex,
      pitchHint: sourceTarget.pitch,
    })
    const sourceAnchor =
      selection.noteId === sourceTarget.noteId &&
      selection.staff === sourceTarget.staff &&
      selection.keyIndex === sourceTarget.keyIndex
        ? {
            x: hitHead.x + 6,
            y:
              previousAnchor &&
              sourceFrozenIncoming?.fromNoteId === previousTarget.noteId &&
              (typeof sourceFrozenIncoming.fromKeyIndex === 'number'
                ? sourceFrozenIncoming.fromKeyIndex
                : 0) === previousTarget.keyIndex
                ? previousAnchor.y
                : hitHead.y,
          }
        : fallbackSourceAnchor
    if (previousAnchor && sourceAnchor) {
      dragState.previewFrozenBoundary = {
        fromTarget: previousTarget,
        toTarget: sourceTarget,
        startX: previousAnchor.x,
        startY: previousAnchor.y,
        endX: sourceAnchor.x,
        endY: sourceAnchor.y,
        frozenPitch: sourceTarget.pitch,
      }
    } else {
      dragState.previewFrozenBoundary = null
    }
  } else {
    dragState.previewFrozenBoundary = null
  }
  onSelectionPointerDown?.(selection, effectiveSelections, selectionMode)
  setActiveSelection(upsertSelection(selection))
  setDraggingSelection(upsertNullableSelection(selection))
  onSelectionActivated?.()
  event.currentTarget.setPointerCapture(event.pointerId)
}

export function handleSurfacePointerMove(params: {
  event: PointerEvent<HTMLCanvasElement>
  dragRef: MutableRefObject<DragState | null>
  previewStartThresholdPx: number
  pitches: Pitch[]
  drawDragMeasurePreview: (drag: DragState) => void
  scheduleDragCommit: (drag: DragState, pitch: Pitch) => void
}): void {
  const { event, dragRef, previewStartThresholdPx, pitches, drawDragMeasurePreview, scheduleDragCommit } = params
  const drag = dragRef.current
  if (!drag || event.pointerId !== drag.pointerId) return

  if (!drag.previewStarted && Math.abs(event.clientY - drag.startClientY) < previewStartThresholdPx) {
    return
  }

  const dragForPreview = drag.previewStarted ? drag : { ...drag, previewStarted: true }
  if (!drag.previewStarted) {
    dragRef.current = dragForPreview
    drawDragMeasurePreview(dragForPreview)
  }

  const pitch = getDragMovePitch({
    drag: dragForPreview,
    clientY: event.clientY,
    pitches,
  })
  if (pitch === dragForPreview.pitch) return
  scheduleDragCommit(dragForPreview, pitch)
}

export function handleEndDragPointer(params: {
  event: PointerEvent<HTMLCanvasElement>
  dragRef: MutableRefObject<DragState | null>
  dragRafRef: MutableRefObject<number | null>
  dragPendingRef: MutableRefObject<{ drag: DragState; pitch: Pitch } | null>
  commitDragPitchToScore: (drag: DragState, pitch: Pitch) => void
  dragPreviewFrameRef: MutableRefObject<number>
  clearDragOverlay: () => void
  setActiveSelection: StateSetter<Selection>
  setDraggingSelection: StateSetter<Selection | null>
  onSelectionActivated?: () => void
}): void {
  const {
    event,
    dragRef,
    dragRafRef,
    dragPendingRef,
    commitDragPitchToScore,
    dragPreviewFrameRef,
    clearDragOverlay,
    setActiveSelection,
    setDraggingSelection,
    onSelectionActivated,
  } = params

  const drag = dragRef.current
  if (!drag || event.pointerId !== drag.pointerId) return

  if (dragRafRef.current !== null) {
    window.cancelAnimationFrame(dragRafRef.current)
    dragRafRef.current = null
  }
  const pending = dragPendingRef.current
  dragPendingRef.current = null
  let finalPitch = drag.pitch
  if (pending && pending.drag.pointerId === drag.pointerId) {
    finalPitch = pending.pitch
  }
  // Restore selected-note highlight immediately on release, then commit pitch.
  setActiveSelection(upsertSelection({
    noteId: drag.noteId,
    staff: drag.staff,
    keyIndex: drag.keyIndex,
  }))
  onSelectionActivated?.()
  setDraggingSelection(null)
  clearDragOverlay()
  commitDragPitchToScore(drag, finalPitch)
  dragRef.current = null
  dragPreviewFrameRef.current = 0
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
}
