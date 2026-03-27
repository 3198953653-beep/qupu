import { DURATION_TICKS } from '../constants'
import type { MeasurePair, Selection } from '../types'
import {
  DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX,
  DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX,
  DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX,
} from './osmdPreviewConstants'

export type MeasureStaffOnsetEntry = {
  noteIndex: number
  onsetTicks: number
  maxKeyIndex: number
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function clampOsmdPreviewZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(35, Math.min(160, Math.round(value)))
}

export function clampOsmdPreviewPaperScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(50, Math.min(180, Math.round(value)))
}

export function clampOsmdPreviewHorizontalMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX
  return Math.max(0, Math.min(120, Math.round(value)))
}

export function clampOsmdPreviewTopMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX
  return Math.max(0, Math.min(180, Math.round(value)))
}

export function clampOsmdPreviewBottomMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX
  return Math.max(0, Math.min(180, Math.round(value)))
}

export function escapeCssId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id)
  }
  return id.replace(/([ !\"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}

export function getSelectionKey(selection: Selection): string {
  return `${selection.staff}|${selection.noteId}|${selection.keyIndex}`
}

export function buildMeasureStaffOnsetEntries(notes: MeasurePair['treble']): MeasureStaffOnsetEntry[] {
  const entries: MeasureStaffOnsetEntry[] = []
  let cursorTicks = 0
  notes.forEach((note, noteIndex) => {
    const maxKeyIndex = note.chordPitches?.length ?? 0
    entries.push({
      noteIndex,
      onsetTicks: cursorTicks,
      maxKeyIndex,
    })
    cursorTicks += DURATION_TICKS[note.duration] ?? 0
  })
  return entries
}

export function findMeasureStaffOnsetEntry(
  entries: MeasureStaffOnsetEntry[],
  onsetTicks: number,
): MeasureStaffOnsetEntry | null {
  if (entries.length === 0) return null
  let best: MeasureStaffOnsetEntry | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    const delta = Math.abs(entry.onsetTicks - onsetTicks)
    if (delta < bestDelta) {
      bestDelta = delta
      best = entry
    }
    if (delta === 0) break
  }
  if (!best) return null
  return bestDelta <= 1 ? best : null
}
