import { Renderer } from 'vexflow'
import type { MutableRefObject } from 'react'
import type { MeasureLayout } from './types'

export function clearOverlayCanvas(
  overlay: HTMLCanvasElement | null,
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>,
): void {
  if (!overlay) return
  overlay.style.display = 'none'
  overlayLastRectRef.current = null
  const overlay2d = overlay.getContext('2d')
  if (!overlay2d) return
  overlay2d.clearRect(0, 0, overlay.width, overlay.height)
}

export function ensureOverlayCanvasForRect(params: {
  overlay: HTMLCanvasElement | null
  surface?: HTMLCanvasElement | null
  rect: MeasureLayout['overlayRect']
  overlayRendererRef: MutableRefObject<Renderer | null>
  overlayRendererSizeRef: MutableRefObject<{ width: number; height: number }>
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
  scoreScaleX?: number
  scoreScaleY?: number
  renderQualityScaleX?: number
  renderQualityScaleY?: number
  lockToExistingFrame?: boolean
}): { x: number; y: number; width: number; height: number } | null {
  const {
    overlay,
    surface = null,
    rect,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
    scoreScaleX = 1,
    scoreScaleY = 1,
    renderQualityScaleX = 1,
    renderQualityScaleY = 1,
    lockToExistingFrame = false,
  } = params
  if (!overlay) return null

  let nextLeft = Number.isFinite(rect.x) ? rect.x : 0
  let nextTop = Number.isFinite(rect.y) ? rect.y : 0
  let nextWidth = Math.max(1, Number.isFinite(rect.width) ? rect.width : 1)
  let nextHeight = Math.max(1, Number.isFinite(rect.height) ? rect.height : 1)
  const previousRect = overlayLastRectRef.current
  if (lockToExistingFrame && previousRect) {
    const prevLeft = previousRect.x
    const prevTop = previousRect.y
    const prevRight = previousRect.x + previousRect.width
    const prevBottom = previousRect.y + previousRect.height
    const nextRight = nextLeft + nextWidth
    const nextBottom = nextTop + nextHeight
    nextLeft = Math.min(prevLeft, nextLeft)
    nextTop = Math.min(prevTop, nextTop)
    nextWidth = Math.max(prevRight, nextRight) - nextLeft
    nextHeight = Math.max(prevBottom, nextBottom) - nextTop
  }
  nextWidth = Math.max(1, Math.ceil(nextWidth))
  nextHeight = Math.max(1, Math.ceil(nextHeight))
  const effectiveScaleX = Number.isFinite(scoreScaleX) && scoreScaleX > 0 ? scoreScaleX : 1
  const effectiveScaleY = Number.isFinite(scoreScaleY) && scoreScaleY > 0 ? scoreScaleY : 1
  const devicePixelRatio =
    Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const targetQualityScaleX =
    Number.isFinite(renderQualityScaleX) && renderQualityScaleX > 0
      ? renderQualityScaleX
      : Math.max(1, devicePixelRatio, effectiveScaleX)
  const targetQualityScaleY =
    Number.isFinite(renderQualityScaleY) && renderQualityScaleY > 0
      ? renderQualityScaleY
      : Math.max(1, devicePixelRatio, effectiveScaleY)
  const maxBackingStoreDim = 32760
  const maxQualityScaleX = Math.max(1, maxBackingStoreDim / Math.max(1, nextWidth))
  const maxQualityScaleY = Math.max(1, maxBackingStoreDim / Math.max(1, nextHeight))
  const backingQualityScaleX = Math.max(1, Math.min(targetQualityScaleX, maxQualityScaleX))
  const backingQualityScaleY = Math.max(1, Math.min(targetQualityScaleY, maxQualityScaleY))
  const nextBackingWidth = Math.max(1, Math.round(nextWidth * backingQualityScaleX))
  const nextBackingHeight = Math.max(1, Math.round(nextHeight * backingQualityScaleY))
  const displayLeft = nextLeft * effectiveScaleX
  const displayTop = nextTop * effectiveScaleY
  const surfaceStyleLeft = surface ? Number.parseFloat(surface.style.left || '0') : 0
  const surfaceStyleTop = surface ? Number.parseFloat(surface.style.top || '0') : 0
  const surfaceOffsetLeft =
    Number.isFinite(surfaceStyleLeft) && surfaceStyleLeft !== 0
      ? surfaceStyleLeft
      : surface
        ? surface.offsetLeft
        : 0
  const surfaceOffsetTop =
    Number.isFinite(surfaceStyleTop) && surfaceStyleTop !== 0
      ? surfaceStyleTop
      : surface
        ? surface.offsetTop
        : 0

  if (overlay.width !== nextBackingWidth || overlay.height !== nextBackingHeight) {
    overlay.width = nextBackingWidth
    overlay.height = nextBackingHeight
    overlayRendererRef.current = null
    overlayRendererSizeRef.current = { width: 0, height: 0 }
  }

  overlay.style.left = `${surfaceOffsetLeft + displayLeft}px`
  overlay.style.top = `${surfaceOffsetTop + displayTop}px`
  overlay.style.width = `${nextWidth}px`
  overlay.style.height = `${nextHeight}px`
  overlay.style.display = 'block'
  overlayLastRectRef.current = {
    x: nextLeft,
    y: nextTop,
    width: nextWidth,
    height: nextHeight,
  }

  return { x: nextLeft, y: nextTop, width: nextWidth, height: nextHeight }
}

export function getOverlayRendererContext(params: {
  overlay: HTMLCanvasElement | null
  overlayRendererRef: MutableRefObject<Renderer | null>
  overlayRendererSizeRef: MutableRefObject<{ width: number; height: number }>
  backend: number
  logicalWidth: number
  logicalHeight: number
}): ReturnType<Renderer['getContext']> | null {
  const {
    overlay,
    overlayRendererRef,
    overlayRendererSizeRef,
    backend,
    logicalWidth,
    logicalHeight,
  } = params
  if (!overlay) return null

  let renderer = overlayRendererRef.current
  if (!renderer) {
    renderer = new Renderer(overlay, backend)
    overlayRendererRef.current = renderer
  }
  const currentSize = overlayRendererSizeRef.current
  const overlayWidth = overlay.width || 1
  const overlayHeight = overlay.height || 1
  if (currentSize.width !== overlayWidth || currentSize.height !== overlayHeight) {
    renderer.resize(overlayWidth, overlayHeight)
    overlayRendererSizeRef.current = { width: overlayWidth, height: overlayHeight }
  }
  // Keep overlay element sized in logical score units; backing store may be supersampled.
  overlay.style.width = `${logicalWidth}px`
  overlay.style.height = `${logicalHeight}px`

  const context = renderer.getContext()
  const context2D = (context as unknown as { context2D?: CanvasRenderingContext2D }).context2D
  if (context2D) {
    // Same mapping rule as main canvas: real backing/store ratio.
    // This avoids subtle drift from nominal quality factor rounding.
    const scaleX = logicalWidth > 0 ? overlayWidth / logicalWidth : 1
    const scaleY = logicalHeight > 0 ? overlayHeight / logicalHeight : 1
    context2D.setTransform(scaleX, 0, 0, scaleY, 0, 0)
  }
  return context
}
