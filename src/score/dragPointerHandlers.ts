import type { Dispatch, MutableRefObject, PointerEvent, SetStateAction } from 'react'
import { buildAccidentalStateBeforeNote } from './accidentals'
import { resolveKeyFifthsForPair } from './dragStart'
import { getHitNote } from './layout/hitTest'
import type { HitGridIndex } from './layout/hitTest'
import { buildDragStateForHit, getDragMovePitch } from './dragInteractions'
import { resolveConnectedTieTargets } from './tieChain'
import type {
  DragDebugSnapshot,
  DragTieTarget,
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

function getSelectedPitch(note: ScoreNote | undefined, keyIndex: number): Pitch | null {
  if (!note || note.isRest) return null
  if (keyIndex <= 0) return note.pitch
  return note.chordPitches?.[keyIndex - 1] ?? null
}

function resolveSelectionLocationInPairs(
  pairs: MeasurePair[],
  selection: Selection,
  importedNoteLookup: Map<string, ImportedNoteLocation>,
): { pairIndex: number; noteIndex: number; staff: Selection['staff'] } | null {
  const imported = importedNoteLookup.get(selection.noteId)
  if (imported) {
    const pair = pairs[imported.pairIndex]
    const note = imported.staff === 'treble' ? pair?.treble[imported.noteIndex] : pair?.bass[imported.noteIndex]
    if (note?.id === selection.noteId) {
      return { pairIndex: imported.pairIndex, noteIndex: imported.noteIndex, staff: imported.staff }
    }
  }

  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    const pair = pairs[pairIndex]
    const notes = selection.staff === 'treble' ? pair.treble : pair.bass
    const noteIndex = notes.findIndex((note) => note.id === selection.noteId)
    if (noteIndex >= 0) {
      return { pairIndex, noteIndex, staff: selection.staff }
    }
  }
  return null
}

function buildSelectionGroupMoveTargets(params: {
  effectiveSelections: Selection[]
  primarySelection: Selection
  measurePairs: MeasurePair[]
  importedNoteLookup: Map<string, ImportedNoteLocation>
  measureLayouts: Map<number, MeasureLayout>
  importedKeyFifths: number[] | null
}): DragTieTarget[] {
  const {
    effectiveSelections,
    primarySelection,
    measurePairs,
    importedNoteLookup,
    measureLayouts,
    importedKeyFifths,
  } = params
  if (effectiveSelections.length <= 1) return []

  const targets: DragTieTarget[] = []
  const seen = new Set<string>()
  const makeTargetKey = (target: DragTieTarget): string =>
    `${target.staff}:${target.pairIndex}:${target.noteIndex}:${target.noteId}:${target.keyIndex}`

  effectiveSelections.forEach((selection) => {
    if (isSameSelection(selection, primarySelection)) return
    const location = resolveSelectionLocationInPairs(measurePairs, selection, importedNoteLookup)
    if (!location) return
    const pair = measurePairs[location.pairIndex]
    const notes = location.staff === 'treble' ? pair?.treble : pair?.bass
    const note = notes?.[location.noteIndex]
    const pitch = getSelectedPitch(note, selection.keyIndex)
    if (!note || !pitch) return

    const tieTargets = resolveConnectedTieTargets({
      measurePairs,
      pairIndex: location.pairIndex,
      noteIndex: location.noteIndex,
      keyIndex: selection.keyIndex,
      staff: selection.staff,
      pitchHint: pitch,
    })
    const normalizedTargets = tieTargets.length > 0
      ? tieTargets
      : [{
          pairIndex: location.pairIndex,
          noteIndex: location.noteIndex,
          staff: selection.staff,
          noteId: selection.noteId,
          keyIndex: selection.keyIndex,
          pitch,
        }]
    normalizedTargets.forEach((target) => {
      const key = makeTargetKey(target)
      if (seen.has(key)) return
      const targetPair = measurePairs[target.pairIndex]
      const targetStaffNotes = target.staff === 'treble' ? targetPair?.treble : targetPair?.bass
      const targetNote = targetStaffNotes?.[target.noteIndex]
      const contextKeyFifths = resolveKeyFifthsForPair({
        pairIndex: target.pairIndex,
        measureLayouts,
        importedKeyFifths,
      })
      const contextAccidentalStateBeforeNote =
        targetStaffNotes && targetNote?.id === target.noteId
          ? buildAccidentalStateBeforeNote(targetStaffNotes, target.noteIndex, contextKeyFifths)
          : new Map<string, number>()
      seen.add(key)
      targets.push({
        ...target,
        contextKeyFifths,
        contextAccidentalStateBeforeNote,
      })
    })
  })

  return targets
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
  onSelectionPointerDown?: (selection: Selection, append: boolean) => void
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
  const appendSelection = Boolean(event.shiftKey)
  const alreadySelected = currentSelections.some((entry) => isSameSelection(entry, selection))
  const effectiveSelections = appendSelection
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
  onSelectionPointerDown?.(selection, appendSelection)
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
