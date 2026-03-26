import { toDisplayDuration } from './layout/demand'
import { toDisplayPitch } from './pitchUtils'
import type { ScoreNote } from './types'

const INSPECTOR_SEQUENCE_PREVIEW_LIMIT = 64
const CHORD_MARKER_UI_SCALE_PERCENT_MIN = 60
const CHORD_MARKER_UI_SCALE_PERCENT_MAX = 240
const CHORD_MARKER_PADDING_PX_MIN = 0
const CHORD_MARKER_PADDING_PX_MAX = 24

export const DEFAULT_PAGE_HORIZONTAL_PADDING_PX = 86
export const DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT = 134
export const DEFAULT_CHORD_MARKER_PADDING_PX = 6

export type ChordMarkerStyleMetrics = {
  buttonHeightPx: number
  fontSizePx: number
  paddingInlinePx: number
  paddingBlockPx: number
  borderRadiusPx: number
  inlineTopPx: number
  inlineHeightPx: number
  stripHeightPx: number
  labelLeftInsetPx: number
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function toSequencePreview(notes: ScoreNote[]): string {
  if (notes.length <= INSPECTOR_SEQUENCE_PREVIEW_LIMIT) {
    return notes
      .map((note) => (note.isRest ? `Rest(${toDisplayDuration(note.duration)})` : toDisplayPitch(note.pitch)))
      .join('  |  ')
  }
  const preview = notes
    .slice(0, INSPECTOR_SEQUENCE_PREVIEW_LIMIT)
    .map((note) => (note.isRest ? `Rest(${toDisplayDuration(note.duration)})` : toDisplayPitch(note.pitch)))
    .join('  |  ')
  return `${preview}  |  ...（还剩 ${notes.length - INSPECTOR_SEQUENCE_PREVIEW_LIMIT} 个）`
}

export function getAutoScoreScale(measureCount: number): number {
  if (measureCount >= 180) return 0.62
  if (measureCount >= 140) return 0.68
  if (measureCount >= 110) return 0.74
  if (measureCount >= 80) return 0.8
  if (measureCount >= 56) return 0.86
  if (measureCount >= 36) return 0.92
  return 1
}

export function clampScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(55, Math.min(300, Math.round(value)))
}

export function clampCanvasHeightPercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(70, Math.min(260, Math.round(value)))
}

export function clampChordMarkerUiScalePercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT
  return Math.max(
    CHORD_MARKER_UI_SCALE_PERCENT_MIN,
    Math.min(CHORD_MARKER_UI_SCALE_PERCENT_MAX, Math.round(value)),
  )
}

export function clampChordMarkerPaddingPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CHORD_MARKER_PADDING_PX
  return Math.round(clampNumber(value, CHORD_MARKER_PADDING_PX_MIN, CHORD_MARKER_PADDING_PX_MAX) * 2) / 2
}

function roundChordMarkerPx(value: number): number {
  return Math.round(value * 10) / 10
}

export function getChordMarkerBaseStyleMetrics(
  scalePercent: number,
  uniformPaddingPx: number,
): ChordMarkerStyleMetrics {
  const safeScalePercent = clampChordMarkerUiScalePercent(scalePercent)
  const safePaddingPx = clampChordMarkerPaddingPx(uniformPaddingPx)
  const scale = safeScalePercent / 100
  const fontSizePx = roundChordMarkerPx(Math.max(8, 10 * scale))
  const paddingInlinePx = safePaddingPx
  const paddingBlockPx = safePaddingPx
  const buttonHeightPx = roundChordMarkerPx(fontSizePx + paddingBlockPx * 2)
  const borderRadiusPx = roundChordMarkerPx(Math.max(5, 7 * scale))
  const inlineTopPx = 22
  const inlineHeightPx = roundChordMarkerPx(Math.max(24, buttonHeightPx + 2))
  const stripHeightPx = roundChordMarkerPx(Math.max(46, inlineTopPx + inlineHeightPx))
  return {
    buttonHeightPx,
    fontSizePx,
    paddingInlinePx,
    paddingBlockPx,
    borderRadiusPx,
    inlineTopPx,
    inlineHeightPx,
    stripHeightPx,
    labelLeftInsetPx: paddingInlinePx,
  }
}

export function applyChordMarkerVisualZoom(
  baseMetrics: ChordMarkerStyleMetrics,
  zoomScale: number,
): ChordMarkerStyleMetrics {
  const safeZoomScale = Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1
  const buttonHeightPx = roundChordMarkerPx(baseMetrics.buttonHeightPx * safeZoomScale)
  const fontSizePx = roundChordMarkerPx(baseMetrics.fontSizePx * safeZoomScale)
  const paddingInlinePx = roundChordMarkerPx(baseMetrics.paddingInlinePx * safeZoomScale)
  const paddingBlockPx = roundChordMarkerPx(baseMetrics.paddingBlockPx * safeZoomScale)
  const borderRadiusPx = roundChordMarkerPx(baseMetrics.borderRadiusPx * safeZoomScale)
  const inlineTopPx = baseMetrics.inlineTopPx
  const inlineHeightPx = roundChordMarkerPx(baseMetrics.inlineHeightPx * safeZoomScale)
  const baseBottomGapPx = Math.max(0, baseMetrics.stripHeightPx - (baseMetrics.inlineTopPx + baseMetrics.inlineHeightPx))
  const stripHeightPx = roundChordMarkerPx(
    inlineTopPx + inlineHeightPx + baseBottomGapPx * safeZoomScale,
  )
  return {
    buttonHeightPx,
    fontSizePx,
    paddingInlinePx,
    paddingBlockPx,
    borderRadiusPx,
    inlineTopPx,
    inlineHeightPx,
    stripHeightPx,
    labelLeftInsetPx: roundChordMarkerPx(baseMetrics.labelLeftInsetPx * safeZoomScale),
  }
}

export function clampDurationGapRatio(value: number): number {
  const clamped = clampNumber(value, 0.5, 4)
  return Number(clamped.toFixed(2))
}

export function clampBaseMinGap32Px(value: number): number {
  const clamped = clampNumber(value, 0, 12)
  return Number(clamped.toFixed(2))
}

export function clampLeadingBarlineGapPx(value: number): number {
  const clamped = clampNumber(value, 0, 80)
  return Number(clamped.toFixed(2))
}

export function clampSecondChordSafeGapPx(value: number): number {
  const clamped = clampNumber(value, 0, 12)
  return Number(clamped.toFixed(2))
}

export function clampPageHorizontalPaddingPx(value: number): number {
  return Math.round(clampNumber(value, 8, 120))
}
