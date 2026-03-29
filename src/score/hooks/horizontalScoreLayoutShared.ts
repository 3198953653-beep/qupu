import { Renderer } from 'vexflow'
import { SCORE_TOP_PADDING, SYSTEM_HEIGHT } from '../constants'

export const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
export const MANUAL_SCALE_BASELINE = 1
export const HORIZONTAL_VIEW_MEASURE_WIDTH_PX = 220
export function getHorizontalViewHeightPx(systemHeightPx: number = SYSTEM_HEIGHT): number {
  return SCORE_TOP_PADDING * 2 + Math.max(1, systemHeightPx) + 26
}
export const HORIZONTAL_VIEW_HEIGHT_PX = getHorizontalViewHeightPx()
export const MAX_CANVAS_RENDER_DIM_PX = 32760
export const HORIZONTAL_RENDER_BUFFER_PX = 400
export const HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES = 1

export type MeasureFrameContentGeometry = {
  contentStartX: number
  contentMeasureWidth: number
}

export type RenderQualityScale = {
  x: number
  y: number
}

export type HorizontalSystemRange = {
  startPairIndex: number
  endPairIndexExclusive: number
}

export type HorizontalRenderWindow = {
  startPairIndex: number
  endPairIndexExclusive: number
  startX: number
  endX: number
}
