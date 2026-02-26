import { Renderer } from 'vexflow'
import type { MutableRefObject } from 'react'
import type { MeasureLayout } from './types'

function getElementTransformScale(element: HTMLElement): { x: number; y: number } | null {
  const transform = window.getComputedStyle(element).transform
  if (!transform || transform === 'none') return null

  const matrix3dMatch = transform.match(/^matrix3d\((.+)\)$/)
  if (matrix3dMatch) {
    const parts = matrix3dMatch[1]?.split(',').map((item) => Number(item.trim())) ?? []
    if (parts.length === 16 && Number.isFinite(parts[0]) && Number.isFinite(parts[5])) {
      return { x: parts[0], y: parts[5] }
    }
    return null
  }

  const matrixMatch = transform.match(/^matrix\((.+)\)$/)
  if (matrixMatch) {
    const parts = matrixMatch[1]?.split(',').map((item) => Number(item.trim())) ?? []
    if (parts.length === 6 && Number.isFinite(parts[0]) && Number.isFinite(parts[3])) {
      return { x: parts[0], y: parts[3] }
    }
    return null
  }

  return null
}

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
  scoreScale?: number
  renderQualityScaleX?: number
  renderQualityScaleY?: number
}): { x: number; y: number; width: number; height: number } | null {
  const {
    overlay,
    surface = null,
    rect,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
    scoreScale = 1,
    renderQualityScaleX = 1,
    renderQualityScaleY = 1,
  } = params
  if (!overlay) return null

  const nextWidth = Math.max(1, Math.ceil(rect.width))
  const nextHeight = Math.max(1, Math.ceil(rect.height))
  const nextLeft = Number.isFinite(rect.x) ? rect.x : 0
  const nextTop = Number.isFinite(rect.y) ? rect.y : 0
  const fallbackScale = Number.isFinite(scoreScale) && scoreScale > 0 ? scoreScale : 1
  let effectiveScaleX = fallbackScale
  let effectiveScaleY = fallbackScale
  if (surface) {
    const transformScale = getElementTransformScale(surface)
    if (transformScale) {
      if (Number.isFinite(transformScale.x) && transformScale.x > 0) {
        effectiveScaleX = transformScale.x
      }
      if (Number.isFinite(transformScale.y) && transformScale.y > 0) {
        effectiveScaleY = transformScale.y
      }
    }
  }
  const devicePixelRatio =
    Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const targetQualityScaleX = Math.max(1, devicePixelRatio, renderQualityScaleX, effectiveScaleX)
  const targetQualityScaleY = Math.max(1, devicePixelRatio, renderQualityScaleY, effectiveScaleY)
  const maxBackingStoreDim = 32760
  const maxQualityScaleX = Math.max(1, maxBackingStoreDim / Math.max(1, nextWidth))
  const maxQualityScaleY = Math.max(1, maxBackingStoreDim / Math.max(1, nextHeight))
  const backingQualityScaleX = Math.max(1, Math.min(targetQualityScaleX, maxQualityScaleX))
  const backingQualityScaleY = Math.max(1, Math.min(targetQualityScaleY, maxQualityScaleY))
  const nextBackingWidth = Math.max(1, Math.round(nextWidth * backingQualityScaleX))
  const nextBackingHeight = Math.max(1, Math.round(nextHeight * backingQualityScaleY))
  const displayLeft = nextLeft * effectiveScaleX
  const displayTop = nextTop * effectiveScaleY
  const surfaceOffsetLeft = surface ? surface.offsetLeft : 0
  const surfaceOffsetTop = surface ? surface.offsetTop : 0

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
  overlayLastRectRef.current = rect

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
  const { overlay, overlayRendererRef, overlayRendererSizeRef, backend, logicalWidth, logicalHeight } = params
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
    const scaleX = logicalWidth > 0 ? overlayWidth / logicalWidth : 1
    const scaleY = logicalHeight > 0 ? overlayHeight / logicalHeight : 1
    context2D.setTransform(scaleX, 0, 0, scaleY, 0, 0)
  }
  return context
}
