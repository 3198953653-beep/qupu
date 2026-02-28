import { getStaffStepDelta, resolveGroupedTargetPitch } from '../dragPitchTransform'
import type { DragState, DragTieTarget, Pitch, StaffKind } from '../types'

export type DragPreviewNoteOverride = {
  noteId: string
  staff: StaffKind
  pitch: Pitch
  keyIndex: number
}

export type DragPreviewFrozenBoundaryCurve = {
  fromPairIndex: number
  fromStaff: StaffKind
  fromNoteId: string
  fromKeyIndex: number
  toPairIndex: number
  toStaff: StaffKind
  toNoteId: string
  toKeyIndex: number
  startX: number
  startY: number
  endX: number
  endY: number
  frozenPitch: Pitch
}

export function getDragPreviewTargetKey(params: {
  pairIndex: number
  staff: StaffKind
  noteId: string
  keyIndex: number
}): string {
  const { pairIndex, staff, noteId, keyIndex } = params
  return `${staff}:${pairIndex}:${noteId}:${keyIndex}`
}

function toTargetKey(target: Pick<DragTieTarget, 'pairIndex' | 'staff' | 'noteId' | 'keyIndex'>): string {
  return getDragPreviewTargetKey({
    pairIndex: target.pairIndex,
    staff: target.staff,
    noteId: target.noteId,
    keyIndex: target.keyIndex,
  })
}

function appendPreviewOverride(params: {
  previewNotesByPair: Map<number, DragPreviewNoteOverride[]>
  previewPitchByTargetKey: Map<string, Pitch>
  override: DragPreviewNoteOverride
  pairIndex: number
}): void {
  const { previewNotesByPair, previewPitchByTargetKey, override, pairIndex } = params
  const targetKey = getDragPreviewTargetKey({
    pairIndex,
    staff: override.staff,
    noteId: override.noteId,
    keyIndex: override.keyIndex,
  })
  previewPitchByTargetKey.set(targetKey, override.pitch)
  const pairOverrides = previewNotesByPair.get(pairIndex)
  if (!pairOverrides) {
    previewNotesByPair.set(pairIndex, [override])
    return
  }
  const existingIndex = pairOverrides.findIndex(
    (entry) =>
      entry.noteId === override.noteId &&
      entry.staff === override.staff &&
      entry.keyIndex === override.keyIndex,
  )
  if (existingIndex < 0) {
    pairOverrides.push(override)
    return
  }
  pairOverrides[existingIndex] = override
}

function isFiniteCoordinate(value: number): boolean {
  return Number.isFinite(value)
}

export function buildDragPreviewOverrides(params: {
  drag: DragState | null | undefined
}): {
  previewNotesByPair: Map<number, DragPreviewNoteOverride[]>
  previewPitchByTargetKey: Map<string, Pitch>
  previewFrozenBoundaryCurve: DragPreviewFrozenBoundaryCurve | null
  suppressedTieStartKeys: Set<string>
  suppressedTieStopKeys: Set<string>
} {
  const { drag } = params
  const previewNotesByPair = new Map<number, DragPreviewNoteOverride[]>()
  const previewPitchByTargetKey = new Map<string, Pitch>()
  const suppressedTieStartKeys = new Set<string>()
  const suppressedTieStopKeys = new Set<string>()
  if (!drag || !drag.previewStarted) {
    return {
      previewNotesByPair,
      previewPitchByTargetKey,
      previewFrozenBoundaryCurve: null,
      suppressedTieStartKeys,
      suppressedTieStopKeys,
    }
  }

  const linkedTargets =
    drag.linkedTieTargets && drag.linkedTieTargets.length > 0
      ? drag.linkedTieTargets
      : [
          {
            pairIndex: drag.pairIndex,
            noteIndex: drag.noteIndex,
            staff: drag.staff,
            noteId: drag.noteId,
            keyIndex: drag.keyIndex,
            pitch: drag.pitch,
          },
        ]

  const linkedTargetKeys = new Set<string>()
  linkedTargets.forEach((target) => {
    linkedTargetKeys.add(toTargetKey(target))
    appendPreviewOverride({
      previewNotesByPair,
      previewPitchByTargetKey,
      pairIndex: target.pairIndex,
      override: {
        noteId: target.noteId,
        staff: target.staff,
        pitch: drag.pitch,
        keyIndex: target.keyIndex,
      },
    })
  })

  if (drag.groupMoveTargets && drag.groupMoveTargets.length > 0) {
    const staffStepDelta = getStaffStepDelta(drag.originPitch ?? drag.pitch, drag.pitch)
    drag.groupMoveTargets.forEach((target) => {
      const targetKey = toTargetKey(target)
      if (linkedTargetKeys.has(targetKey)) return
      const overridePitch = resolveGroupedTargetPitch(target, staffStepDelta)
      if (!overridePitch) return
      appendPreviewOverride({
        previewNotesByPair,
        previewPitchByTargetKey,
        pairIndex: target.pairIndex,
        override: {
          noteId: target.noteId,
          staff: target.staff,
          pitch: overridePitch,
          keyIndex: target.keyIndex,
        },
      })
    })
  }

  const sourceTarget =
    linkedTargets.find(
      (target) =>
        target.noteId === drag.noteId &&
        target.staff === drag.staff &&
        target.keyIndex === drag.keyIndex,
    ) ??
    linkedTargets[0] ??
    null
  const previousTarget = drag.previousTieTarget ?? null
  const snapshot = drag.previewFrozenBoundary ?? null
  const shouldFreezeBoundary =
    Boolean(previousTarget) &&
    Boolean(sourceTarget) &&
    previousTarget!.pitch !== drag.pitch
  if (shouldFreezeBoundary && previousTarget && sourceTarget) {
    suppressedTieStartKeys.add(toTargetKey(previousTarget))
    suppressedTieStopKeys.add(toTargetKey(sourceTarget))
  }
  const previewFrozenBoundaryCurve =
    shouldFreezeBoundary &&
    snapshot &&
    isFiniteCoordinate(snapshot.startX) &&
    isFiniteCoordinate(snapshot.startY) &&
    isFiniteCoordinate(snapshot.endX) &&
    isFiniteCoordinate(snapshot.endY)
      ? {
          fromPairIndex: snapshot.fromTarget.pairIndex,
          fromStaff: snapshot.fromTarget.staff,
          fromNoteId: snapshot.fromTarget.noteId,
          fromKeyIndex: snapshot.fromTarget.keyIndex,
          toPairIndex: snapshot.toTarget.pairIndex,
          toStaff: snapshot.toTarget.staff,
          toNoteId: snapshot.toTarget.noteId,
          toKeyIndex: snapshot.toTarget.keyIndex,
          startX: snapshot.startX,
          startY: snapshot.startY,
          endX: snapshot.endX,
          endY: snapshot.endY,
          frozenPitch: snapshot.frozenPitch,
        }
      : null

  return {
    previewNotesByPair,
    previewPitchByTargetKey,
    previewFrozenBoundaryCurve,
    suppressedTieStartKeys,
    suppressedTieStopKeys,
  }
}
