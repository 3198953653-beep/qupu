function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export const GRAND_STAFF_TREBLE_OFFSET_Y = 22
export const STAFF_LINE_SPAN_PX = 40
export const GRAND_STAFF_BOTTOM_PADDING_PX = 60
export const DEFAULT_STAFF_INTER_GAP_PX = 46
export const STAFF_INTER_GAP_PX_MIN = 24
export const STAFF_INTER_GAP_PX_MAX = 140

export type GrandStaffLayoutMetrics = {
  trebleOffsetY: number
  bassOffsetY: number
  systemHeightPx: number
  staffLineSpanPx: number
  staffInterGapPx: number
}

export function clampStaffInterGapPx(value: number): number {
  return Math.round(clampNumber(value, STAFF_INTER_GAP_PX_MIN, STAFF_INTER_GAP_PX_MAX))
}

export function getGrandStaffLayoutMetrics(staffInterGapPx: number): GrandStaffLayoutMetrics {
  const safeStaffInterGapPx = clampStaffInterGapPx(staffInterGapPx)
  const trebleOffsetY = GRAND_STAFF_TREBLE_OFFSET_Y
  const bassOffsetY = trebleOffsetY + STAFF_LINE_SPAN_PX + safeStaffInterGapPx
  const systemHeightPx = bassOffsetY + STAFF_LINE_SPAN_PX + GRAND_STAFF_BOTTOM_PADDING_PX
  return {
    trebleOffsetY,
    bassOffsetY,
    systemHeightPx,
    staffLineSpanPx: STAFF_LINE_SPAN_PX,
    staffInterGapPx: safeStaffInterGapPx,
  }
}
