import { buildTieSelection } from '../tieSelection'
import type { TieEndpoint, TieLayout } from '../types'

const TIE_HIT_OFFSET_Y = 3
const MIN_TIE_HIT_RADIUS_Y = 3.8
const ENDPOINT_INSET_RATIO = 0.22
const ENDPOINT_INSET_MIN = 6
const ENDPOINT_INSET_MAX = 14
const MIN_TIE_HIT_BAND_WIDTH = 6

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function buildTieLayout(params: {
  startX: number
  startY: number
  endX: number
  endY: number
  direction: number
  endpoints: TieEndpoint[]
}): TieLayout {
  const { startX, startY, endX, endY, direction, endpoints } = params
  const selection = buildTieSelection(endpoints)
  const leftX = Math.min(startX, endX)
  const rightX = Math.max(startX, endX)
  const segmentLength = Math.max(0, rightX - leftX)
  const endpointInset = clamp(segmentLength * ENDPOINT_INSET_RATIO, ENDPOINT_INSET_MIN, ENDPOINT_INSET_MAX)
  let effectiveLeftX = leftX + endpointInset
  let effectiveRightX = rightX - endpointInset
  if (effectiveRightX <= effectiveLeftX) {
    const centerX = (leftX + rightX) / 2
    const halfBand = Math.min(segmentLength / 2, MIN_TIE_HIT_BAND_WIDTH / 2)
    effectiveLeftX = centerX - halfBand
    effectiveRightX = centerX + halfBand
  }
  const effectiveBandWidth = Math.max(0, effectiveRightX - effectiveLeftX)
  const centerX = (effectiveLeftX + effectiveRightX) / 2
  const centerY = (startY + endY) / 2 + (direction >= 0 ? TIE_HIT_OFFSET_Y : -TIE_HIT_OFFSET_Y)
  const radiusX = Math.max(1, effectiveBandWidth / 2)
  const radiusY = Math.max(MIN_TIE_HIT_RADIUS_Y, Math.abs(endY - startY) / 2 + 3.5)
  return {
    ...selection,
    startX,
    startY,
    endX,
    endY,
    direction,
    hitCenterX: centerX,
    hitCenterY: centerY,
    hitRadiusX: radiusX,
    hitRadiusY: radiusY,
    hitMinX: centerX - radiusX,
    hitMaxX: centerX + radiusX,
    hitMinY: centerY - radiusY,
    hitMaxY: centerY + radiusY,
  }
}
