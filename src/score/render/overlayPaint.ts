import { Renderer } from 'vexflow'
import { drawMeasureToContext } from './drawMeasure'
import type { DrawMeasureParams } from './drawMeasure'

export function paintOverlayMeasure(params: {
  overlayContext: ReturnType<Renderer['getContext']>
  overlayFrame: { x: number; y: number; width: number; height: number }
  drawParams: Omit<DrawMeasureParams, 'context'>
}): void {
  const { overlayContext, overlayFrame, drawParams } = params
  const overlayContext2D = (overlayContext as unknown as { context2D?: CanvasRenderingContext2D }).context2D
  if (!overlayContext2D) return

  overlayContext.clearRect(0, 0, overlayFrame.width, overlayFrame.height)
  overlayContext.save()
  overlayContext.setFillStyle('#ffffff')
  overlayContext.fillRect(0, 0, overlayFrame.width, overlayFrame.height)
  overlayContext.restore()
  overlayContext.save()
  overlayContext2D.translate(-overlayFrame.x, -overlayFrame.y)
  overlayContext.setFillStyle('#000000')
  overlayContext.setStrokeStyle('#000000')

  drawMeasureToContext({
    context: overlayContext,
    ...drawParams,
  })
  overlayContext.restore()
}
