import type { Dispatch, MutableRefObject, PointerEvent, SetStateAction } from 'react'
import { clampStaffInterGapPx } from './grandStaffLayout'
import { getHitTarget } from './layout/hitTest'
import type { HitGridIndex } from './layout/hitTest'
import { buildDragStateForHit, getDragMovePitch } from './dragInteractions'
import { resolveCurrentNoteForHit } from './dragStart'
import { buildSelectionGroupMoveTargets, buildSelectionPreviewLeadTarget } from './selectionGroupTargets'
import { buildSelectionsInTimelineRange } from './selectionTimelineRange'
import { getTieFrozenIncoming } from './tieFrozen'
import { cloneTieSelection } from './tieSelection'
import type { ScoreNotePreviewMode } from './notePreview'
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
  TieSelection,
} from './types'

type StateSetter<T> = Dispatch<SetStateAction<T>>
export type SelectionPointerMode = 'replace' | 'append' | 'range'
export type BlankPointerPayload = { pairIndex: number | null; staff: Selection['staff'] | null }
export type BlankStaffGapDragSession = {
  pointerId: number
  startClientY: number
  startStaffInterGapPx: number
  pairIndex: number
  staff: Selection['staff']
  dragStarted: boolean
}
const REPLACE_TAP_SELECTION_THRESHOLD_MS = 180

function resolveBlankStaffGapDragValue(
  session: BlankStaffGapDragSession,
  clientY: number,
): number {
  return clampStaffInterGapPx(session.startStaffInterGapPx + (clientY - session.startClientY))
}

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

function resolveBlankMeasureHit(params: {
  x: number
  y: number
  measureLayouts: Map<number, MeasureLayout>
}): BlankPointerPayload {
  const { x, y, measureLayouts } = params
  if (measureLayouts.size === 0) return { pairIndex: null, staff: null }
  let winnerPairIndex: number | null = null
  let winnerStaff: Selection['staff'] | null = null
  let winnerDistance = Number.POSITIVE_INFINITY
  for (const [pairIndex, layout] of measureLayouts.entries()) {
    if (!Number.isFinite(layout.measureX) || !Number.isFinite(layout.measureWidth)) continue
    const measureLeft = layout.measureX
    const measureRight = layout.measureX + layout.measureWidth
    if (x < measureLeft || x > measureRight) continue
    const trebleTopRaw = Number.isFinite(layout.trebleLineTopY) ? layout.trebleLineTopY : layout.trebleY
    const trebleBottomRaw = Number.isFinite(layout.trebleLineBottomY) ? layout.trebleLineBottomY : layout.trebleY + 40
    const bassTopRaw = Number.isFinite(layout.bassLineTopY) ? layout.bassLineTopY : layout.bassY
    const bassBottomRaw = Number.isFinite(layout.bassLineBottomY) ? layout.bassLineBottomY : layout.bassY + 40
    if (
      !Number.isFinite(trebleTopRaw) ||
      !Number.isFinite(trebleBottomRaw) ||
      !Number.isFinite(bassTopRaw) ||
      !Number.isFinite(bassBottomRaw)
    ) {
      continue
    }
    const trebleTop = Math.min(trebleTopRaw, trebleBottomRaw)
    const trebleBottom = Math.max(trebleTopRaw, trebleBottomRaw)
    const bassTop = Math.min(bassTopRaw, bassBottomRaw)
    const bassBottom = Math.max(bassTopRaw, bassBottomRaw)
    // Strict 0px tolerance: only inside the five staff lines area.
    const staff: Selection['staff'] | null =
      y >= trebleTop && y <= trebleBottom
        ? 'treble'
        : y >= bassTop && y <= bassBottom
          ? 'bass'
          : null
    if (!staff) continue
    const distanceToCenter = Math.abs(x - (measureLeft + layout.measureWidth / 2))
    if (
      distanceToCenter < winnerDistance ||
      (distanceToCenter === winnerDistance && (winnerPairIndex === null || pairIndex < winnerPairIndex))
    ) {
      winnerDistance = distanceToCenter
      winnerPairIndex = pairIndex
      winnerStaff = staff
    }
  }
  if (winnerPairIndex === null || winnerStaff === null) {
    return { pairIndex: null, staff: null }
  }
  return { pairIndex: winnerPairIndex, staff: winnerStaff }
}

export function handleBeginDragPointer(params: {
  event: PointerEvent<HTMLCanvasElement>
  surface: HTMLCanvasElement | null
  scoreScaleX: number
  scoreScaleY: number
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
  blankStaffGapDragRef: MutableRefObject<BlankStaffGapDragSession | null>
  staffInterGapPx: number
  currentSelections: Selection[]
  setActiveSelection: StateSetter<Selection>
  setDraggingSelection: StateSetter<Selection | null>
  onSelectionPointerDown?: (
    selection: Selection,
    nextSelections: Selection[],
    mode: SelectionPointerMode,
  ) => void
  onAccidentalPointerDown?: (selection: Selection) => void
  onTiePointerDown?: (selection: TieSelection) => void
  onBlankPointerDown?: (payload: BlankPointerPayload) => void
  onSelectionActivated?: () => void
  onPreviewScoreNote?: (params: {
    note: ScoreNote
    keyIndex: number
    mode: ScoreNotePreviewMode
    targetPitch?: Pitch | null
  }) => void
}): void {
  const {
    event,
    surface,
    scoreScaleX,
    scoreScaleY,
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
    blankStaffGapDragRef,
    staffInterGapPx,
    currentSelections,
    setActiveSelection,
    setDraggingSelection,
    onSelectionPointerDown,
    onAccidentalPointerDown,
    onTiePointerDown,
    onBlankPointerDown,
    onSelectionActivated,
    onPreviewScoreNote,
  } = params

  if (!surface) return

  const rect = surface.getBoundingClientRect()
  const fallbackScaleX = Number.isFinite(scoreScaleX) && scoreScaleX > 0 ? scoreScaleX : 1
  const fallbackScaleY = Number.isFinite(scoreScaleY) && scoreScaleY > 0 ? scoreScaleY : 1
  const styleWidth = Number.parseFloat(surface.style.width)
  const styleHeight = Number.parseFloat(surface.style.height)
  const inferredLogicalWidthFromRect = rect.width > 0 ? rect.width / fallbackScaleX : NaN
  const inferredLogicalHeightFromRect = rect.height > 0 ? rect.height / fallbackScaleY : NaN
  // Prefer declared CSS logical size and stable scale-state mapping.
  // Avoid clientWidth/backing-store coupling, which can drift under fractional DPI/zoom.
  const logicalWidth =
    (Number.isFinite(styleWidth) && styleWidth > 0 ? styleWidth : NaN) ||
    (Number.isFinite(inferredLogicalWidthFromRect) && inferredLogicalWidthFromRect > 0
      ? inferredLogicalWidthFromRect
      : NaN) ||
    (surface.clientWidth > 0 ? surface.clientWidth : 1)
  const logicalHeight =
    (Number.isFinite(styleHeight) && styleHeight > 0 ? styleHeight : NaN) ||
    (Number.isFinite(inferredLogicalHeightFromRect) && inferredLogicalHeightFromRect > 0
      ? inferredLogicalHeightFromRect
      : NaN) ||
    (surface.clientHeight > 0 ? surface.clientHeight : 1)
  const rawContext2D = surface.getContext('2d')
  const transform = rawContext2D?.getTransform()
  const transformScaleX = transform?.a
  const transformScaleY = transform?.d
  const backingWidth = surface.width
  const backingHeight = surface.height
  // Self-calibrated mapping:
  // logical-per-client = backing / (ctxTransform * clientRect)
  // This keeps hit-test stable even if a browser/GPU path temporarily renders
  // with an unexpected backing-to-CSS ratio.
  const calibratedClientToScoreScaleX =
    Number.isFinite(backingWidth) &&
    backingWidth > 0 &&
    Number.isFinite(transformScaleX) &&
    (transformScaleX as number) > 0 &&
    rect.width > 0
      ? backingWidth / ((transformScaleX as number) * rect.width)
      : NaN
  const calibratedClientToScoreScaleY =
    Number.isFinite(backingHeight) &&
    backingHeight > 0 &&
    Number.isFinite(transformScaleY) &&
    (transformScaleY as number) > 0 &&
    rect.height > 0
      ? backingHeight / ((transformScaleY as number) * rect.height)
      : NaN
  const clientToScoreScaleX = Number.isFinite(calibratedClientToScoreScaleX) && calibratedClientToScoreScaleX > 0
    ? calibratedClientToScoreScaleX
    : rect.width > 0
      ? logicalWidth / rect.width
      : 1 / fallbackScaleX
  const clientToScoreScaleY = Number.isFinite(calibratedClientToScoreScaleY) && calibratedClientToScoreScaleY > 0
    ? calibratedClientToScoreScaleY
    : rect.height > 0
      ? logicalHeight / rect.height
      : 1 / fallbackScaleY
  const x = (event.clientX - rect.left) * clientToScoreScaleX
  const y = (event.clientY - rect.top) * clientToScoreScaleY
  const hitTarget = getHitTarget(x, y, noteLayouts, 0, hitGrid)
  if (!hitTarget) {
    const blankHit = resolveBlankMeasureHit({ x, y, measureLayouts })
    onBlankPointerDown?.(blankHit)
    if (blankHit.pairIndex !== null && blankHit.staff !== null) {
      event.preventDefault()
      setDraggingSelection(null)
      blankStaffGapDragRef.current = {
        pointerId: event.pointerId,
        startClientY: event.clientY,
        startStaffInterGapPx: staffInterGapPx,
        pairIndex: blankHit.pairIndex,
        staff: blankHit.staff,
        dragStarted: false,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    return
  }

  if (hitTarget.kind === 'accidental') {
    event.preventDefault()
    const selection: Selection = {
      noteId: hitTarget.layout.id,
      staff: hitTarget.layout.staff,
      keyIndex: hitTarget.accidental.keyIndex,
    }
    setDraggingSelection(null)
    onAccidentalPointerDown?.(selection)
    return
  }

  if (hitTarget.kind === 'tie') {
    event.preventDefault()
    setDraggingSelection(null)
    onTiePointerDown?.(cloneTieSelection(hitTarget.tie))
    return
  }

  const hit = { layout: hitTarget.layout, head: hitTarget.head }
  const hitHead = hitTarget.head
  const currentHitNote = resolveCurrentNoteForHit({
    hitLayout: hit.layout,
    importedPairs,
    importedNoteLookup,
    trebleNoteById,
    bassNoteById,
  })

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
  const shouldDeferReplaceSelection =
    selectionMode === 'replace' &&
    currentSelections.length > 1 &&
    currentSelections.some((entry) => isSameSelection(entry, selection))
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
        : shouldDeferReplaceSelection
          ? currentSelections
          : [selection]
  if (shouldDeferReplaceSelection) {
    dragState.startedWithReplaceDeferred = true
    dragState.startTimestampMs = event.timeStamp
    dragState.startSelection = selection
  } else {
    dragState.startedWithReplaceDeferred = false
    dragState.startTimestampMs = event.timeStamp
    dragState.startSelection = selection
  }
  dragState.selectionMode = selectionMode
  dragState.groupMoveTargets = buildSelectionGroupMoveTargets({
    effectiveSelections,
    primarySelection: selection,
    measurePairs: importedPairs ?? currentMeasurePairs,
    importedNoteLookup,
    measureLayouts,
    importedKeyFifths,
  })
  dragState.groupPreviewLeadTarget = buildSelectionPreviewLeadTarget({
    effectiveSelections,
    primarySelection: selection,
    noteLayouts,
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
  if (currentHitNote) {
    onPreviewScoreNote?.({
      note: currentHitNote,
      keyIndex: hitHead.keyIndex,
      mode: 'click',
    })
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
  blankStaffGapDragRef: MutableRefObject<BlankStaffGapDragSession | null>
  previewStartThresholdPx: number
  pitches: Pitch[]
  setStaffInterGapPx: StateSetter<number>
  drawDragMeasurePreview: (drag: DragState) => void
  scheduleDragCommit: (drag: DragState, pitch: Pitch) => void
}): void {
  const {
    event,
    dragRef,
    blankStaffGapDragRef,
    previewStartThresholdPx,
    pitches,
    setStaffInterGapPx,
    drawDragMeasurePreview,
    scheduleDragCommit,
  } = params
  const blankStaffGapDrag = blankStaffGapDragRef.current
  if (blankStaffGapDrag && event.pointerId === blankStaffGapDrag.pointerId) {
    const deltaY = event.clientY - blankStaffGapDrag.startClientY
    if (!blankStaffGapDrag.dragStarted && Math.abs(deltaY) < previewStartThresholdPx) {
      return
    }
    event.preventDefault()
    if (!blankStaffGapDrag.dragStarted) {
      blankStaffGapDragRef.current = {
        ...blankStaffGapDrag,
        dragStarted: true,
      }
    }
    setStaffInterGapPx(resolveBlankStaffGapDragValue(blankStaffGapDrag, event.clientY))
    return
  }

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
  blankStaffGapDragRef: MutableRefObject<BlankStaffGapDragSession | null>
  dragRafRef: MutableRefObject<number | null>
  dragPendingRef: MutableRefObject<{ drag: DragState; pitch: Pitch } | null>
  commitDragPitchToScore: (drag: DragState, pitch: Pitch) => void
  previewStartThresholdPx: number
  setStaffInterGapPx: StateSetter<number>
  dragPreviewFrameRef: MutableRefObject<number>
  clearDragOverlay: () => void
  setActiveSelection: StateSetter<Selection>
  setDraggingSelection: StateSetter<Selection | null>
  onSelectionActivated?: () => void
  onSelectionTapRelease?: (selection: Selection) => void
  onPreviewPendingDragPitch?: (drag: DragState, pitch: Pitch) => void
}): void {
  const {
    event,
    dragRef,
    blankStaffGapDragRef,
    dragRafRef,
    dragPendingRef,
    commitDragPitchToScore,
    previewStartThresholdPx,
    setStaffInterGapPx,
    dragPreviewFrameRef,
    clearDragOverlay,
    setActiveSelection,
    setDraggingSelection,
    onSelectionActivated,
    onSelectionTapRelease,
    onPreviewPendingDragPitch,
  } = params

  const blankStaffGapDrag = blankStaffGapDragRef.current
  if (blankStaffGapDrag && event.pointerId === blankStaffGapDrag.pointerId) {
    const deltaY = event.clientY - blankStaffGapDrag.startClientY
    if (blankStaffGapDrag.dragStarted || Math.abs(deltaY) >= previewStartThresholdPx) {
      setStaffInterGapPx(resolveBlankStaffGapDragValue(blankStaffGapDrag, event.clientY))
    }
    blankStaffGapDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    return
  }

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
    if (pending.pitch !== drag.pitch) {
      onPreviewPendingDragPitch?.(pending.drag, pending.pitch)
    }
    finalPitch = pending.pitch
  }
  // Restore selected-note highlight immediately on release, then commit pitch.
  setActiveSelection(upsertSelection({
    noteId: drag.noteId,
    staff: drag.staff,
    keyIndex: drag.keyIndex,
  }))
  const dragSelection: Selection = drag.startSelection ?? {
    noteId: drag.noteId,
    staff: drag.staff,
    keyIndex: drag.keyIndex,
  }
  const pressDurationMs = event.timeStamp - (drag.startTimestampMs ?? event.timeStamp)
  const shouldTriggerReplaceTapRelease =
    drag.selectionMode === 'replace' &&
    drag.previewStarted !== true &&
    pressDurationMs <= REPLACE_TAP_SELECTION_THRESHOLD_MS
  if (shouldTriggerReplaceTapRelease) {
    onSelectionTapRelease?.(dragSelection)
  }
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
