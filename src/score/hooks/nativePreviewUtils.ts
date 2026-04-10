import {
  DEFAULT_NATIVE_PREVIEW_BOTTOM_MARGIN_PX,
  DEFAULT_NATIVE_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX,
  DEFAULT_NATIVE_PREVIEW_HORIZONTAL_MARGIN_PX,
  DEFAULT_NATIVE_PREVIEW_MIN_EIGHTH_GAP_PX,
  DEFAULT_NATIVE_PREVIEW_MIN_GRAND_STAFF_GAP_PX,
  DEFAULT_NATIVE_PREVIEW_PAPER_SCALE_PERCENT,
  DEFAULT_NATIVE_PREVIEW_ZOOM_PERCENT,
  NATIVE_PREVIEW_MAX_ZOOM_PERCENT,
  NATIVE_PREVIEW_MIN_ZOOM_PERCENT,
} from './nativePreviewConstants'

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function clampNativePreviewPaperScalePercent(value: number): number {
  return clampNumber(value, 50, 180)
}

export function clampNativePreviewZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NATIVE_PREVIEW_ZOOM_PERCENT
  return clampNumber(value, NATIVE_PREVIEW_MIN_ZOOM_PERCENT, NATIVE_PREVIEW_MAX_ZOOM_PERCENT)
}

export function clampNativePreviewHorizontalMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NATIVE_PREVIEW_HORIZONTAL_MARGIN_PX
  return clampNumber(value, 0, 120)
}

export function clampNativePreviewTopMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NATIVE_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX
  return clampNumber(value, 0, 180)
}

export function clampNativePreviewBottomMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NATIVE_PREVIEW_BOTTOM_MARGIN_PX
  return clampNumber(value, 0, 180)
}

export function clampNativePreviewMinEighthGapPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NATIVE_PREVIEW_MIN_EIGHTH_GAP_PX
  return clampNumber(value, 14, 36)
}

export function clampNativePreviewMinGrandStaffGapPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NATIVE_PREVIEW_MIN_GRAND_STAFF_GAP_PX
  return clampNumber(value, 24, 96)
}

export function getSafeNativePreviewPaperScale(value: number): number {
  return clampNativePreviewPaperScalePercent(value) / 100
}

export function getDefaultNativePreviewPaperScalePercent(): number {
  return DEFAULT_NATIVE_PREVIEW_PAPER_SCALE_PERCENT
}
