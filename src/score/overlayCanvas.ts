import { Renderer } from 'vexflow'
import type { MutableRefObject } from 'react'
import type { MeasureLayout } from './types'

export function clearOverlayCanvas(
  overlay: HTMLCanvasElement | null,
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>,
): void {
  if (!overlay) return
  const overlay2d = overlay.getContext('2d')
  if (!overlay2d) return
  overlay2d.clearRect(0, 0, overlay.width, overlay.height)
  overlay.style.display = 'none'
  overlayLastRectRef.current = null
}

export function ensureOverlayCanvasForRect(params: {
  overlay: HTMLCanvasElement | null
  rect: MeasureLayout['overlayRect']
  overlayRendererRef: MutableRefObject<Renderer | null>
  overlayRendererSizeRef: MutableRefObject<{ width: number; height: number }>
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
}): { x: number; y: number; width: number; height: number } | null {
  const { overlay, rect, overlayRendererRef, overlayRendererSizeRef, overlayLastRectRef } = params
  if (!overlay) return null

  const nextWidth = Math.max(1, Math.ceil(rect.width))
  const nextHeight = Math.max(1, Math.ceil(rect.height))
  const nextLeft = Math.floor(rect.x)
  const nextTop = Math.floor(rect.y)

  if (overlay.width !== nextWidth || overlay.height !== nextHeight) {
    overlay.width = nextWidth
    overlay.height = nextHeight
    overlayRendererRef.current = null
    overlayRendererSizeRef.current = { width: 0, height: 0 }
  }

  overlay.style.left = `${nextLeft}px`
  overlay.style.top = `${nextTop}px`
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
}): ReturnType<Renderer['getContext']> | null {
  const { overlay, overlayRendererRef, overlayRendererSizeRef, backend } = params
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

  return renderer.getContext()
}
