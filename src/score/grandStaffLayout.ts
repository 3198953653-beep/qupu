import type { PedalSpan } from './types'

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
export const PEDAL_LANE_EXTRA_HEIGHT_PX = 26
export const PEDAL_LANE_ROW_STEP_PX = 16

export type GrandStaffLayoutMetrics = {
  trebleOffsetY: number
  bassOffsetY: number
  systemHeightPx: number
  staffLineSpanPx: number
  staffInterGapPx: number
  pedalLaneExtraHeightPx: number
  pedalLaneCount: number
  hasPedalLane: boolean
}

export function clampStaffInterGapPx(value: number): number {
  return Math.round(clampNumber(value, STAFF_INTER_GAP_PX_MIN, STAFF_INTER_GAP_PX_MAX))
}

export function estimatePedalLaneCount(pedalSpans: readonly PedalSpan[]): number {
  if (pedalSpans.length === 0) return 0
  const overlapCountByPair = new Map<number, number>()
  pedalSpans.forEach((span) => {
    const startPairIndex = Number.isFinite(span.startPairIndex) ? Math.max(0, Math.trunc(span.startPairIndex)) : 0
    const endPairIndex = Number.isFinite(span.endPairIndex)
      ? Math.max(startPairIndex, Math.trunc(span.endPairIndex))
      : startPairIndex
    for (let pairIndex = startPairIndex; pairIndex <= endPairIndex; pairIndex += 1) {
      overlapCountByPair.set(pairIndex, (overlapCountByPair.get(pairIndex) ?? 0) + 1)
    }
  })
  return Math.max(0, ...overlapCountByPair.values())
}

export function getPedalLaneExtraHeightPx(pedalLaneCount: number): number {
  const safePedalLaneCount = Number.isFinite(pedalLaneCount) ? Math.max(0, Math.round(pedalLaneCount)) : 0
  if (safePedalLaneCount <= 0) return 0
  return PEDAL_LANE_EXTRA_HEIGHT_PX + Math.max(0, safePedalLaneCount - 1) * PEDAL_LANE_ROW_STEP_PX
}

export function getGrandStaffLayoutMetrics(
  staffInterGapPx: number,
  options?: { includePedalLane?: boolean; pedalLaneCount?: number },
): GrandStaffLayoutMetrics {
  const safeStaffInterGapPx = clampStaffInterGapPx(staffInterGapPx)
  const includePedalLane = options?.includePedalLane === true
  const pedalLaneCount = Number.isFinite(options?.pedalLaneCount)
    ? Math.max(0, Math.round(options?.pedalLaneCount ?? 0))
    : includePedalLane
      ? 1
      : 0
  const trebleOffsetY = GRAND_STAFF_TREBLE_OFFSET_Y
  const bassOffsetY = trebleOffsetY + STAFF_LINE_SPAN_PX + safeStaffInterGapPx
  const pedalLaneExtraHeightPx = getPedalLaneExtraHeightPx(pedalLaneCount)
  const systemHeightPx = bassOffsetY + STAFF_LINE_SPAN_PX + GRAND_STAFF_BOTTOM_PADDING_PX + pedalLaneExtraHeightPx
  return {
    trebleOffsetY,
    bassOffsetY,
    systemHeightPx,
    staffLineSpanPx: STAFF_LINE_SPAN_PX,
    staffInterGapPx: safeStaffInterGapPx,
    pedalLaneExtraHeightPx,
    pedalLaneCount,
    hasPedalLane: pedalLaneCount > 0,
  }
}
