import {
  SCORE_TOP_PADDING,
  SYSTEM_GAP_Y,
  SYSTEM_HEIGHT,
} from '../constants'
import type { MeasureLayout } from '../types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function getVisibleSystemRange(
  scrollTop: number,
  viewportHeight: number,
  systemCount: number,
): { start: number; end: number } {
  if (systemCount <= 1) return { start: 0, end: 0 }

  const systemStride = SYSTEM_HEIGHT + SYSTEM_GAP_Y
  const startOffset = Math.max(0, scrollTop - SCORE_TOP_PADDING)
  const endOffset = Math.max(0, scrollTop + viewportHeight - SCORE_TOP_PADDING)
  const bufferSystems = systemCount > 12 ? 0 : 1

  const start = clamp(Math.floor(startOffset / systemStride) - bufferSystems, 0, systemCount - 1)
  const end = clamp(Math.ceil(endOffset / systemStride) + bufferSystems, 0, systemCount - 1)
  return { start, end }
}

export function buildMeasureOverlayRect(
  noteMinX: number,
  noteMaxX: number,
  noteStartX: number,
  measureX: number,
  measureWidth: number,
  systemTop: number,
  scoreWidth: number,
  scoreHeight: number,
  isSystemStart: boolean,
  includeMeasureStartDecorations: boolean,
): MeasureLayout['overlayRect'] {
  const leftPad = 56
  const rightPad = 42
  const topPad = 42
  const bottomPad = 72
  const systemStartDecorationGuard = 2
  const interMeasureBarlineGuard = 2
  const noteLeft = Number.isFinite(noteMinX) ? noteMinX : noteStartX
  const noteRight = Number.isFinite(noteMaxX) ? noteMaxX : measureX + measureWidth - 12
  const measureRight = measureX + measureWidth
  let leftEdge = Math.floor(noteLeft - leftPad)
  if (isSystemStart) {
    const minSafeLeft = Math.floor(noteStartX + systemStartDecorationGuard)
    leftEdge = Math.max(leftEdge, minSafeLeft)
  } else {
    const minSafeLeft = Math.floor(measureX + interMeasureBarlineGuard)
    leftEdge = includeMeasureStartDecorations ? minSafeLeft : Math.max(leftEdge, minSafeLeft)
  }
  const x = clamp(leftEdge, 0, scoreWidth)
  const right = clamp(Math.ceil(noteRight + rightPad), x, Math.min(scoreWidth, measureRight))
  const y = clamp(systemTop - topPad, 0, scoreHeight)
  const maxWidth = scoreWidth - x
  const maxHeight = scoreHeight - y
  const width = clamp(right - x, 0, maxWidth)
  const height = clamp(SYSTEM_HEIGHT + topPad + bottomPad, 0, maxHeight)
  return { x, y, width, height }
}
