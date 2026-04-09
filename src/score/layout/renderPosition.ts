import { Accidental, Dot, StaveNote } from 'vexflow'
import {
  getRenderedNoteHeadBoundsExact,
  type RenderedNoteHeadLike,
} from './noteHeadColumns'
import type { StaffKind } from '../types'

const DEFAULT_DOT_WIDTH_PX = 4
const DOT_NORMALIZE_EPSILON_PX = 0.001

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

export function getRenderedNoteHeadBounds(note: StaveNote): { leftX: number; rightX: number } | null {
  const noteHeads = (note.noteHeads ?? []) as RenderedNoteHeadLike[]
  const anchorX = getRenderedNoteVisualX(note)
  const stemDirection = note.getStemDirection()
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY

  noteHeads.forEach((noteHead) => {
    const bounds = getRenderedNoteHeadBoundsExact({
      noteHead,
      anchorX,
      stemDirection,
    })
    if (!bounds) return
    minX = Math.min(minX, bounds.leftX)
    maxX = Math.max(maxX, bounds.rightX)
  })

  if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX >= minX) {
    return {
      leftX: minX,
      rightX: maxX,
    }
  }

  const headBeginX = note.getNoteHeadBeginX()
  const headEndX = note.getNoteHeadEndX()
  if (Number.isFinite(headBeginX) && Number.isFinite(headEndX) && headEndX >= headBeginX) {
    return {
      leftX: headBeginX,
      rightX: headEndX,
    }
  }

  return null
}

export function getRenderedNoteDotBounds(note: StaveNote): { leftX: number; rightX: number } | null {
  const dots = Dot.getDots(note)
  if (dots.length === 0) return null

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY

  dots.forEach((modifier) => {
    const dot = modifier as Dot
    const renderedIndex = dot.getIndex()
    if (typeof renderedIndex !== 'number' || !Number.isFinite(renderedIndex)) return

    let leftX = Number.NaN
    try {
      const start = note.getModifierStartXY(dot.getPosition(), renderedIndex, { forceFlagRight: true })
      const startX = start?.x
      if (Number.isFinite(startX)) {
        leftX = startX + dot.getXShift()
      }
    } catch {
      leftX = Number.NaN
    }

    const bbox = dot.getBoundingBox?.() ?? null
    const bboxLeftX = bbox?.getX?.()
    const bboxWidth = bbox?.getW?.()
    const widthRaw = dot.getWidth?.()
    const width =
      typeof widthRaw === 'number' && Number.isFinite(widthRaw) && widthRaw > 0
        ? widthRaw
        : typeof bboxWidth === 'number' && Number.isFinite(bboxWidth) && bboxWidth > 0
          ? bboxWidth
          : DEFAULT_DOT_WIDTH_PX

    if (!Number.isFinite(leftX) && typeof bboxLeftX === 'number' && Number.isFinite(bboxLeftX)) {
      leftX = bboxLeftX
    }
    if (!Number.isFinite(leftX)) return

    minX = Math.min(minX, leftX)
    maxX = Math.max(maxX, leftX + width)
  })

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX < minX) return null
  return {
    leftX: minX,
    rightX: maxX,
  }
}

export function normalizeRenderedNoteDotPlacement(
  note: StaveNote,
  minNoteheadGapPx = 4,
): {
  appliedDeltaX: number
  headRightX: number | null
  dotLeftX: number | null
  dotRightX: number | null
} {
  if (note.isRest()) {
    const dotBounds = getRenderedNoteDotBounds(note)
    return {
      appliedDeltaX: 0,
      headRightX: null,
      dotLeftX: dotBounds?.leftX ?? null,
      dotRightX: dotBounds?.rightX ?? null,
    }
  }

  const headBounds = getRenderedNoteHeadBounds(note)
  const dotBounds = getRenderedNoteDotBounds(note)
  if (!headBounds || !dotBounds) {
    return {
      appliedDeltaX: 0,
      headRightX: headBounds?.rightX ?? null,
      dotLeftX: dotBounds?.leftX ?? null,
      dotRightX: dotBounds?.rightX ?? null,
    }
  }

  const rightmostHeadRightX = headBounds.rightX
  const desiredDotLeftX = rightmostHeadRightX + Math.max(0, minNoteheadGapPx)
  const deltaX = desiredDotLeftX - dotBounds.leftX
  if (Math.abs(deltaX) < DOT_NORMALIZE_EPSILON_PX) {
    return {
      appliedDeltaX: 0,
      headRightX: headBounds.rightX,
      dotLeftX: dotBounds.leftX,
      dotRightX: dotBounds.rightX,
    }
  }

  Dot.getDots(note).forEach((modifier) => {
    const dot = modifier as Dot
    dot.setXShift(dot.getXShift() + deltaX)
  })
  const adjustedDotBounds = getRenderedNoteDotBounds(note)
  return {
    appliedDeltaX: deltaX,
    headRightX: headBounds.rightX,
    dotLeftX: adjustedDotBounds?.leftX ?? dotBounds.leftX + deltaX,
    dotRightX: adjustedDotBounds?.rightX ?? dotBounds.rightX + deltaX,
  }
}

export function getRenderedNoteGlyphBounds(note: StaveNote): { leftX: number; rightX: number } | null {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY

  const headBounds = getRenderedNoteHeadBounds(note)
  if (headBounds) {
    minX = Math.min(minX, headBounds.leftX)
    maxX = Math.max(maxX, headBounds.rightX)
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

  const dotBounds = getRenderedNoteDotBounds(note)
  if (dotBounds) {
    minX = Math.min(minX, dotBounds.leftX)
    maxX = Math.max(maxX, dotBounds.rightX)
  }

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
  const start = note.getModifierStartXY(1, renderedIndex)
  const startX = start?.x
  if (Number.isFinite(startX)) {
    // Mirror VexFlow Accidental.draw(): x = start.x - width (+ xShift at render time).
    const width = modifier.getWidth()
    const fallbackX = startX - width + modifier.getXShift()
    if (Number.isFinite(fallbackX)) return fallbackX
  }

  const absoluteX = (modifier as unknown as { getAbsoluteX?: () => number }).getAbsoluteX?.()
  if (typeof absoluteX === 'number' && Number.isFinite(absoluteX) && Math.abs(absoluteX) > 0.0001) return absoluteX

  // Mirror VexFlow Accidental.draw(): x = start.x - width (+ xShift at render time).
  return null
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
