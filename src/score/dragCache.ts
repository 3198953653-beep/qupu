import { getLayoutNoteKey } from './layout/renderPosition'
import type { DragDebugStaticRecord, NoteLayout } from './types'

export function buildStaticNoteXById(noteLayoutsByPair: Map<number, NoteLayout[]>, pairIndex: number): Map<string, number> {
  const byId = new Map<string, number>()
  const pairLayouts = noteLayoutsByPair.get(pairIndex) ?? []
  pairLayouts.forEach((layout) => {
    const layoutKey = getLayoutNoteKey(layout.staff, layout.id)
    byId.set(layoutKey, layout.x)
  })
  return byId
}

export function buildDragDebugStaticByNoteKey(
  noteLayoutsByPair: Map<number, NoteLayout[]>,
  pairIndex: number,
): Map<string, DragDebugStaticRecord> {
  const byNoteKey = new Map<string, DragDebugStaticRecord>()
  const pairLayouts = noteLayoutsByPair.get(pairIndex) ?? []
  pairLayouts.forEach((layout) => {
    const noteKey = getLayoutNoteKey(layout.staff, layout.id)
    const headXByKeyIndex = new Map<number, number>()
    const headYByKeyIndex = new Map<number, number>()
    layout.noteHeads.forEach((head) => {
      if (!Number.isFinite(head.keyIndex) || !Number.isFinite(head.x)) return
      headXByKeyIndex.set(head.keyIndex, head.x)
      if (Number.isFinite(head.y)) {
        headYByKeyIndex.set(head.keyIndex, head.y)
      }
    })
    const accidentalRightXByKeyIndex = new Map<number, number>()
    Object.entries(layout.accidentalRightXByKeyIndex).forEach(([keyIndexText, rightX]) => {
      const keyIndex = Number(keyIndexText)
      if (!Number.isFinite(keyIndex) || !Number.isFinite(rightX)) return
      accidentalRightXByKeyIndex.set(keyIndex, rightX)
    })
    byNoteKey.set(noteKey, {
      staff: layout.staff,
      noteId: layout.id,
      noteIndex: layout.noteIndex,
      noteX: layout.x,
      headXByKeyIndex,
      headYByKeyIndex,
      accidentalRightXByKeyIndex,
    })
  })
  return byNoteKey
}

export function buildPreviewAccidentalRightXFromStatic(
  staticByNoteKey: Map<string, DragDebugStaticRecord>,
  defaultAccidentalOffsetPx: number,
): Map<string, Map<number, number>> {
  const byId = new Map<string, Map<number, number>>()
  staticByNoteKey.forEach((record, noteKey) => {
    const byKeyIndex = new Map<number, number>()
    record.headXByKeyIndex.forEach((headX, keyIndex) => {
      if (!Number.isFinite(headX)) return
      byKeyIndex.set(keyIndex, headX + defaultAccidentalOffsetPx)
    })
    record.accidentalRightXByKeyIndex.forEach((rightX, keyIndex) => {
      if (!Number.isFinite(rightX)) return
      byKeyIndex.set(keyIndex, rightX)
    })
    if (byKeyIndex.size === 0) return
    byId.set(noteKey, byKeyIndex)
  })
  return byId
}
