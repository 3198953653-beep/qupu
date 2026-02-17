import type { DragDebugSnapshot } from './types'

function roundNumber(value: number, digits = 3): number {
  const base = 10 ** digits
  return Math.round(value * base) / base
}

export function buildDragDebugReport(frames: DragDebugSnapshot[]): string | null {
  if (frames.length === 0) return null

  const maxAbsNoteDelta = Math.max(
    0,
    ...frames.flatMap((frame) =>
      frame.rows.map((row) => Math.abs(row.noteXDelta ?? 0)),
    ),
  )
  const maxAbsHeadDelta = Math.max(
    0,
    ...frames.flatMap((frame) =>
      frame.rows.map((row) => Math.abs(row.headXDelta ?? 0)),
    ),
  )
  const maxAbsAccidentalDelta = Math.max(
    0,
    ...frames.flatMap((frame) =>
      frame.rows.map((row) => Math.abs(row.accidentalRightXDelta ?? 0)),
    ),
  )
  const allRows = frames.flatMap((frame) => frame.rows)
  const accidentalLockReasonCount = allRows.reduce<Record<string, number>>((acc, row) => {
    const key = row.accidentalLockReason
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const accidentalLockAppliedCount = allRows.filter((row) => row.accidentalLockApplied).length
  const accidentalModifierRows = allRows.filter((row) => row.hasAccidentalModifier).length
  const unstableAccidentalRows = allRows
    .filter((row) => Math.abs(row.accidentalRightXDelta ?? 0) > 0.5)
    .map((row) => ({
      frame: row.frame,
      staff: row.staff,
      noteId: row.noteId,
      keyIndex: row.keyIndex,
      accidentalRightXStatic: row.accidentalRightXStatic === null ? null : roundNumber(row.accidentalRightXStatic),
      accidentalRightXPreview:
        row.accidentalRightXPreview === null ? null : roundNumber(row.accidentalRightXPreview),
      accidentalRightXDelta: row.accidentalRightXDelta === null ? null : roundNumber(row.accidentalRightXDelta),
      accidentalTargetRightX:
        row.accidentalTargetRightX === null ? null : roundNumber(row.accidentalTargetRightX),
      accidentalLockApplied: row.accidentalLockApplied,
      accidentalLockReason: row.accidentalLockReason,
    }))

  const report = {
    generatedAt: new Date().toISOString(),
    frameCount: frames.length,
    pairIndex: frames[0]?.pairIndex ?? null,
    draggedNote: frames[0] ? { staff: frames[0].draggedStaff, noteId: frames[0].draggedNoteId } : null,
    maxAbsDelta: {
      noteX: roundNumber(maxAbsNoteDelta),
      headX: roundNumber(maxAbsHeadDelta),
      accidentalRightX: roundNumber(maxAbsAccidentalDelta),
    },
    summary: {
      rowCount: allRows.length,
      accidentalModifierRows,
      accidentalLockAppliedCount,
      accidentalLockReasonCount,
      unstableAccidentalRowsCount: unstableAccidentalRows.length,
      unstableAccidentalRows,
    },
    frames: frames.map((frame) => ({
      frame: frame.frame,
      pairIndex: frame.pairIndex,
      draggedNoteId: frame.draggedNoteId,
      draggedStaff: frame.draggedStaff,
      rows: frame.rows.map((row) => ({
        ...row,
        noteXStatic: row.noteXStatic === null ? null : roundNumber(row.noteXStatic),
        noteXPreview: row.noteXPreview === null ? null : roundNumber(row.noteXPreview),
        noteXDelta: row.noteXDelta === null ? null : roundNumber(row.noteXDelta),
        headXStatic: row.headXStatic === null ? null : roundNumber(row.headXStatic),
        headXPreview: row.headXPreview === null ? null : roundNumber(row.headXPreview),
        headXDelta: row.headXDelta === null ? null : roundNumber(row.headXDelta),
        accidentalRightXStatic:
          row.accidentalRightXStatic === null ? null : roundNumber(row.accidentalRightXStatic),
        accidentalRightXPreview:
          row.accidentalRightXPreview === null ? null : roundNumber(row.accidentalRightXPreview),
        accidentalRightXDelta:
          row.accidentalRightXDelta === null ? null : roundNumber(row.accidentalRightXDelta),
        accidentalTargetRightX:
          row.accidentalTargetRightX === null ? null : roundNumber(row.accidentalTargetRightX),
      })),
    })),
  }
  return JSON.stringify(report, null, 2)
}
