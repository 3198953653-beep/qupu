import { getMeasureTicksFromTimeSignature } from '../chordRuler'
import { PEDAL_MIN_VISUAL_GAP_PX, sortPedalSpans } from '../pedalUtils'
import type { MeasureTimelineBundle } from '../timeline/types'
import type { MeasureLayout, PedalSpan } from '../types'

const PEDAL_BASELINE_OFFSET_PX = 18
const PEDAL_BRACKET_HOOK_HEIGHT_PX = 10
const PEDAL_TEXT_MARGIN_RIGHT_PX = 6
const PEDAL_MIN_DRAW_WIDTH_PX = 4
const PEDAL_COLOR = '#111111'
const PEDAL_TEXT_FONT = 'italic 13px "Times New Roman", Georgia, serif'

function getMeasureContentBounds(measureLayout: MeasureLayout): {
  startX: number
  endX: number
  measureTicks: number
} {
  return {
    startX:
      measureLayout.effectiveBoundaryStartX ??
      measureLayout.noteStartX ??
      measureLayout.measureX,
    endX:
      measureLayout.effectiveBoundaryEndX ??
      measureLayout.noteEndX ??
      (measureLayout.measureX + measureLayout.measureWidth),
    measureTicks: getMeasureTicksFromTimeSignature(measureLayout.timeSignature),
  }
}

function resolveTickX(params: {
  tick: number
  measureLayout: MeasureLayout
  timelineBundle: MeasureTimelineBundle | null | undefined
}): number | null {
  const { tick, measureLayout, timelineBundle } = params
  const { startX, endX, measureTicks } = getMeasureContentBounds(measureLayout)
  const safeTick = Math.max(0, Math.min(measureTicks, Math.round(tick)))
  const axisLayout = timelineBundle?.publicAxisLayout ?? null
  const orderedTicks = axisLayout?.orderedTicks ?? []
  const tickToX = axisLayout?.tickToX ?? null

  if (tickToX?.has(safeTick)) {
    const directX = tickToX.get(safeTick)
    if (typeof directX === 'number' && Number.isFinite(directX)) return directX
  }

  if (orderedTicks.length > 0 && tickToX) {
    const firstTick = orderedTicks[0]
    const lastTick = orderedTicks[orderedTicks.length - 1]
    const firstX = tickToX.get(firstTick)
    const lastX = tickToX.get(lastTick)

    if (safeTick <= firstTick && Number.isFinite(firstX)) {
      if (firstTick <= 0) return firstX ?? startX
      const blend = Math.max(0, Math.min(1, safeTick / Math.max(1, firstTick)))
      return startX + ((firstX as number) - startX) * blend
    }

    if (safeTick >= lastTick && Number.isFinite(lastX)) {
      const remainingTicks = Math.max(1, measureTicks - lastTick)
      const blend = Math.max(0, Math.min(1, (safeTick - lastTick) / remainingTicks))
      return (lastX as number) + (endX - (lastX as number)) * blend
    }

    for (let index = 0; index < orderedTicks.length - 1; index += 1) {
      const leftTick = orderedTicks[index]
      const rightTick = orderedTicks[index + 1]
      if (safeTick < leftTick || safeTick > rightTick) continue
      const leftX = tickToX.get(leftTick)
      const rightX = tickToX.get(rightTick)
      if (!Number.isFinite(leftX) || !Number.isFinite(rightX)) break
      if (rightTick <= leftTick) return leftX as number
      const blend = (safeTick - leftTick) / (rightTick - leftTick)
      return (leftX as number) + ((rightX as number) - (leftX as number)) * blend
    }
  }

  if (!Number.isFinite(startX) || !Number.isFinite(endX)) return null
  return startX + (endX - startX) * (safeTick / Math.max(1, measureTicks))
}

function drawBracketShape(params: {
  context2D: CanvasRenderingContext2D
  startX: number
  endX: number
  baselineY: number
  drawStartHook: boolean
  drawEndHook: boolean
}): void {
  const { context2D, startX, endX, baselineY, drawStartHook, drawEndHook } = params
  context2D.beginPath()
  if (drawStartHook) {
    context2D.moveTo(startX, baselineY - PEDAL_BRACKET_HOOK_HEIGHT_PX)
    context2D.lineTo(startX, baselineY)
  } else {
    context2D.moveTo(startX, baselineY)
  }
  context2D.lineTo(endX, baselineY)
  if (drawEndHook) {
    context2D.lineTo(endX, baselineY - PEDAL_BRACKET_HOOK_HEIGHT_PX)
  }
  context2D.stroke()
}

type VisualPedalSpan = {
  span: PedalSpan
  startX: number
  endX: number
  baselineY: number
}

export function drawPedalSpans(params: {
  context2D: CanvasRenderingContext2D | null | undefined
  pedalSpans: PedalSpan[]
  measureLayouts: Map<number, MeasureLayout>
  measureTimelineBundles: Map<number, MeasureTimelineBundle>
}): void {
  const { context2D, pedalSpans, measureLayouts, measureTimelineBundles } = params
  if (!context2D || pedalSpans.length === 0 || measureLayouts.size === 0) return

  const visualSpans: VisualPedalSpan[] = sortPedalSpans(pedalSpans).flatMap((span) => {
    const startMeasureLayout = measureLayouts.get(span.startPairIndex)
    const endMeasureLayout = measureLayouts.get(span.endPairIndex)
    if (!startMeasureLayout || !endMeasureLayout) return []
    const startX = resolveTickX({
      tick: span.startTick,
      measureLayout: startMeasureLayout,
      timelineBundle: measureTimelineBundles.get(span.startPairIndex),
    })
    const endX = resolveTickX({
      tick: span.endTick,
      measureLayout: endMeasureLayout,
      timelineBundle: measureTimelineBundles.get(span.endPairIndex),
    })
    if (!Number.isFinite(startX) || !Number.isFinite(endX)) return []
    const baselineY = (Number.isFinite(startMeasureLayout.bassLineBottomY)
      ? startMeasureLayout.bassLineBottomY
      : startMeasureLayout.bassY + 40) + PEDAL_BASELINE_OFFSET_PX
    if (!Number.isFinite(baselineY)) return []
    return [{
      span,
      startX: startX as number,
      endX: endX as number,
      baselineY,
    }]
  })

  if (visualSpans.length === 0) return

  context2D.save()
  context2D.strokeStyle = PEDAL_COLOR
  context2D.fillStyle = PEDAL_COLOR
  context2D.lineWidth = 1.2
  context2D.lineJoin = 'round'
  context2D.lineCap = 'round'
  context2D.font = PEDAL_TEXT_FONT
  context2D.textBaseline = 'alphabetic'

  visualSpans.forEach((entry, index) => {
    const nextEntry = visualSpans[index + 1] ?? null
    let startX = entry.startX
    let endX = entry.endX
    if (nextEntry && Number.isFinite(nextEntry.startX)) {
      endX = Math.min(endX, nextEntry.startX - PEDAL_MIN_VISUAL_GAP_PX)
    }
    if (!Number.isFinite(startX) || !Number.isFinite(endX)) return
    if (endX <= startX + PEDAL_MIN_DRAW_WIDTH_PX) {
      endX = startX + PEDAL_MIN_DRAW_WIDTH_PX
    }

    if (entry.span.style === 'text') {
      context2D.textAlign = 'left'
      context2D.fillText('Ped', startX, entry.baselineY)
      context2D.textAlign = 'center'
      context2D.fillText('*', endX, entry.baselineY)
      return
    }

    if (entry.span.style === 'bracket') {
      drawBracketShape({
        context2D,
        startX,
        endX,
        baselineY: entry.baselineY,
        drawStartHook: true,
        drawEndHook: true,
      })
      return
    }

    context2D.textAlign = 'left'
    context2D.fillText('Ped', startX, entry.baselineY)
    const pedWidth = context2D.measureText('Ped').width
    const lineStartX = Math.min(endX, startX + pedWidth + PEDAL_TEXT_MARGIN_RIGHT_PX)
    drawBracketShape({
      context2D,
      startX: lineStartX,
      endX,
      baselineY: entry.baselineY,
      drawStartHook: false,
      drawEndHook: true,
    })
  })

  context2D.restore()
}
