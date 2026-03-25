import { Accidental, StaveNote } from 'vexflow'
import type { StaffKind } from '../types'

export function getLayoutNoteKey(staff: StaffKind, noteId: string): string {
  return `${staff}|${noteId}`
}

export function getRenderedNoteVisualX(note: StaveNote): number {
  return note.getNoteHeadBeginX()
}

export function getRenderedNoteAnchorX(note: StaveNote): number {
  const x = note.getX()
  if (Number.isFinite(x)) return x
  const absoluteX = note.getAbsoluteX()
  const xShift = note.getXShift()
  const fallbackX = absoluteX + xShift
  return Number.isFinite(fallbackX) ? fallbackX : getRenderedNoteVisualX(note)
}

export function finiteOrNull(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function deltaOrNull(preview: number | null, baseline: number | null): number | null {
  if (preview === null || baseline === null) return null
  return preview - baseline
}

export function roundNumber(value: number, digits = 3): number {
  const base = 10 ** digits
  return Math.round(value * base) / base
}

export function getAccidentalVisualX(note: StaveNote, modifier: Accidental, renderedIndex: number): number | null {
  const absoluteX = (modifier as unknown as { getAbsoluteX?: () => number }).getAbsoluteX?.()
  if (typeof absoluteX === 'number' && Number.isFinite(absoluteX)) return absoluteX
  const start = note.getModifierStartXY(1, renderedIndex)
  const startX = start?.x
  if (!Number.isFinite(startX)) return null
  // Mirror VexFlow Accidental.draw(): x = start.x - width (+ xShift at render time).
  const width = modifier.getWidth()
  const fallbackX = startX - width + modifier.getXShift()
  return Number.isFinite(fallbackX) ? fallbackX : null
}

export function getAccidentalRightXByRenderedIndex(note: StaveNote): Map<number, number> {
  const positions = new Map<number, number>()
  note.getModifiersByType(Accidental.CATEGORY).forEach((modifier) => {
    const renderedIndex = modifier.getIndex()
    if (renderedIndex === undefined) return
    const rightX = getAccidentalVisualX(note, modifier as Accidental, renderedIndex)
    if (rightX === null) return
    positions.set(renderedIndex, rightX)
  })
  return positions
}

export function addModifierXShift(modifier: Accidental, delta: number): void {
  const raw = modifier as unknown as { xShift?: number }
  const current = typeof raw.xShift === 'number' ? raw.xShift : modifier.getXShift()
  raw.xShift = current + delta
}
