import type { MeasureLayout, StaffKind } from './types'

export type HighlightRectPx = {
  x: number
  y: number
  width: number
  height: number
}

type MeasureFrameLike = {
  measureX: number
  measureWidth: number
}

export function resolveStaffLineBounds(measureLayout: MeasureLayout, staff: StaffKind) {
  const lineTopRaw =
    staff === 'treble'
      ? (Number.isFinite(measureLayout.trebleLineTopY) ? measureLayout.trebleLineTopY : measureLayout.trebleY)
      : (Number.isFinite(measureLayout.bassLineTopY) ? measureLayout.bassLineTopY : measureLayout.bassY)
  const lineBottomRaw =
    staff === 'treble'
      ? (Number.isFinite(measureLayout.trebleLineBottomY)
          ? measureLayout.trebleLineBottomY
          : measureLayout.trebleY + 40)
      : (Number.isFinite(measureLayout.bassLineBottomY)
          ? measureLayout.bassLineBottomY
          : measureLayout.bassY + 40)
  return {
    lineTop: Math.min(lineTopRaw, lineBottomRaw),
    lineBottom: Math.max(lineTopRaw, lineBottomRaw),
  }
}

export function resolveCombinedStaffLineBounds(measureLayout: MeasureLayout) {
  const trebleBounds = resolveStaffLineBounds(measureLayout, 'treble')
  const bassBounds = resolveStaffLineBounds(measureLayout, 'bass')
  return {
    lineTop: Math.min(trebleBounds.lineTop, bassBounds.lineTop),
    lineBottom: Math.max(trebleBounds.lineBottom, bassBounds.lineBottom),
  }
}

export function buildMeasureSurfaceHighlightRect(params: {
  measureLayout: MeasureLayout
  frame?: MeasureFrameLike | null
  staff?: StaffKind | null
  useCombinedStaffBounds?: boolean
  scaleX?: number
  scaleY?: number
  offsetX?: number
  offsetY?: number
  padX?: number
  padY?: number
  preferFrameX?: boolean
  preferFrameWidth?: boolean
}): HighlightRectPx | null {
  const {
    measureLayout,
    frame = null,
    staff = null,
    useCombinedStaffBounds = false,
    scaleX = 1,
    scaleY = 1,
    offsetX = 0,
    offsetY = 0,
    padX = 6,
    padY = 4,
    preferFrameX = frame !== null,
    preferFrameWidth = frame !== null,
  } = params

  const { lineTop, lineBottom } = useCombinedStaffBounds
    ? resolveCombinedStaffLineBounds(measureLayout)
    : resolveStaffLineBounds(measureLayout, staff ?? 'treble')

  const measureXRaw = preferFrameX && frame ? frame.measureX : measureLayout.measureX
  const measureWidthRaw = preferFrameWidth && frame ? frame.measureWidth : measureLayout.measureWidth
  const x = offsetX + measureXRaw * scaleX
  const y = offsetY + lineTop * scaleY
  const width = measureWidthRaw * scaleX
  const height = (lineBottom - lineTop) * scaleY

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }
  if (width <= 0 || height <= 0) return null

  return {
    x: x - padX,
    y: y - padY,
    width: width + padX * 2,
    height: height + padY * 2,
  }
}
