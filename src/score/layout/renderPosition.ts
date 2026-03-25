import { Accidental, StaveNote } from 'vexflow'
import type { StaffKind } from '../types'

export function getLayoutNoteKey(staff: StaffKind, noteId: string): string {
  return `${staff}|${noteId}`
}

export function getRenderedNoteVisualX(note: StaveNote): number {
  return note.getNoteHeadBeginX()
}

export function getRenderedNoteGlobalAnchorX(note: StaveNote): number {
  const absoluteX = note.getAbsoluteX()
  const xShift = note.getXShift()
  const shiftedAbsoluteX = absoluteX + xShift
  if (Number.isFinite(shiftedAbsoluteX)) return shiftedAbsoluteX
  const x = note.getX()
  if (Number.isFinite(x)) return x
  return getRenderedNoteVisualX(note)
}

export function getRenderedNoteAnchorX(note: StaveNote): number {
  const x = note.getX()
  if (Number.isFinite(x)) return x
  const absoluteX = note.getAbsoluteX()
  const xShift = note.getXShift()
  const fallbackX = absoluteX + xShift
  return Number.isFinite(fallbackX) ? fallbackX : getRenderedNoteVisualX(note)
}

export function getRenderedNoteGlyphBounds(note: StaveNote): { leftX: number; rightX: number } | null {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY

  const headBeginX = note.getNoteHeadBeginX()
  const headEndX = note.getNoteHeadEndX()
  if (Number.isFinite(headBeginX) && Number.isFinite(headEndX) && headEndX >= headBeginX) {
    minX = Math.min(minX, headBeginX)
    maxX = Math.max(maxX, headEndX)
  }

  if (note.hasStem()) {
    const stemX = note.getStemX()
    if (Number.isFinite(stemX)) {
      minX = Math.min(minX, stemX - 1)
      maxX = Math.max(maxX, stemX + 1)
    }
    if (note.hasFlag()) {
      const rawFlagWidth = (note as unknown as { flag?: { getWidth?: () => number } }).flag?.getWidth?.()
      const flagWidth = Number.isFinite(rawFlagWidth) ? (rawFlagWidth as number) : null
      if (flagWidth !== null && Number.isFinite(stemX)) {
        if (note.getStemDirection() === 1) {
          maxX = Math.max(maxX, stemX + flagWidth)
        } else {
          minX = Math.min(minX, stemX - flagWidth)
        }
      }
    }
  }

  note.getModifiersByType(Accidental.CATEGORY).forEach((modifier) => {
    const accidental = modifier as Accidental
    const renderedIndex = accidental.getIndex()
    if (typeof renderedIndex !== 'number' || !Number.isFinite(renderedIndex)) return
    const accidentalX = getAccidentalVisualX(note, accidental, renderedIndex)
    const accidentalWidth = accidental.getWidth()
    if (typeof accidentalX !== 'number' || !Number.isFinite(accidentalX)) return
    minX = Math.min(minX, accidentalX)
    maxX = Math.max(maxX, accidentalX + (Number.isFinite(accidentalWidth) ? accidentalWidth : 0))
  })

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null
  return {
    leftX: minX,
    rightX: maxX,
  }
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
