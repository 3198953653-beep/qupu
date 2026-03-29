import { getMeasureTicksFromTimeSignature, type ChordRulerEntry } from '../chordRuler'
import {
  collectMeasureTickRangeLayoutCoverage,
  getMeasureTickRangeLayoutBounds,
} from '../chordRangeNoteCoverage'
import { PEDAL_MIN_VISUAL_GAP_PX, sortPedalSpans } from '../pedalUtils'
import type { MeasureTimelineBundle } from '../timeline/types'
import type { MeasureLayout, MeasurePair, NoteLayout, PedalSpan } from '../types'

const PEDAL_BASELINE_OFFSET_PX = 18
const PEDAL_BRACKET_HOOK_HEIGHT_PX = 10
const PEDAL_TEXT_MARGIN_RIGHT_PX = 6
const PEDAL_MIN_DRAW_WIDTH_PX = 4
const PEDAL_COLOR = '#111111'
const PEDAL_TEXT_FONT = 'italic 13px "Times New Roman", Georgia, serif'
const PEDAL_TEXT_LABEL = 'Ped'
const PEDAL_RELEASE_LABEL = '*'

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
  baseStartX: number
  baseEndX: number
  startX: number
  endX: number
  occupiedStartX: number
  occupiedEndX: number
  baseBaselineY: number
  baselineY: number
  laneIndex: number
  requiredStartX: number | null
  requiredEndX: number | null
}

type SpanCoverageRange = {
  startPairIndex: number
  startTickInclusive: number
  endPairIndex: number
  endTickExclusive: number
}

type SpanCoverageBounds = {
  leftXRaw: number
  rightXRaw: number
  coverageEndX: number
}

function normalizeTick(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function resolveSpanCoverageRange(params: {
  span: PedalSpan
  chordRulerEntriesByPair: ChordRulerEntry[][] | null | undefined
}): SpanCoverageRange {
  const { span, chordRulerEntriesByPair } = params
  const startTickInclusive = normalizeTick(span.startTick)
  const endTickExclusive = Math.max(startTickInclusive + 1, normalizeTick(span.endTick))
  if (span.startPairIndex !== span.endPairIndex) {
    return {
      startPairIndex: span.startPairIndex,
      startTickInclusive,
      endPairIndex: span.endPairIndex,
      endTickExclusive,
    }
  }
  const matchingEntry = chordRulerEntriesByPair?.[span.startPairIndex]?.find((entry) =>
    normalizeTick(entry.startTick) === startTickInclusive && normalizeTick(entry.endTick) >= endTickExclusive,
  ) ?? null
  if (!matchingEntry) {
    return {
      startPairIndex: span.startPairIndex,
      startTickInclusive,
      endPairIndex: span.endPairIndex,
      endTickExclusive,
    }
  }
  return {
    startPairIndex: span.startPairIndex,
    startTickInclusive,
    endPairIndex: span.startPairIndex,
    endTickExclusive: Math.max(startTickInclusive + 1, normalizeTick(matchingEntry.endTick)),
  }
}

function collectSpanOnsetReserveBounds(params: {
  coverageRange: SpanCoverageRange
  measureLayouts: Map<number, MeasureLayout>
}): SpanCoverageBounds | null {
  const { coverageRange, measureLayouts } = params
  let minLeftX = Number.POSITIVE_INFINITY
  let maxRightX = Number.NEGATIVE_INFINITY
  let lastCoveragePairIndex = Number.NEGATIVE_INFINITY
  let lastCoverageOnsetTick = Number.NEGATIVE_INFINITY
  let lastCoverageRightX = Number.NEGATIVE_INFINITY

  for (let pairIndex = coverageRange.startPairIndex; pairIndex <= coverageRange.endPairIndex; pairIndex += 1) {
    const measureLayout = measureLayouts.get(pairIndex)
    const onsetReserves = measureLayout?.spacingOnsetReserves ?? []
    onsetReserves.forEach((reserve) => {
      const onsetTicks = normalizeTick(reserve.onsetTicks)
      const startTickInclusive = pairIndex === coverageRange.startPairIndex ? coverageRange.startTickInclusive : 0
      const endTickExclusive = pairIndex === coverageRange.endPairIndex
        ? coverageRange.endTickExclusive
        : Number.MAX_SAFE_INTEGER
      if (onsetTicks < startTickInclusive || onsetTicks >= endTickExclusive) return
      if (
        !Number.isFinite(reserve.finalX) ||
        !Number.isFinite(reserve.leftOccupiedInsetPx) ||
        !Number.isFinite(reserve.rightOccupiedTailPx)
      ) {
        return
      }
      if (reserve.leftOccupiedInsetPx <= 0 && reserve.rightOccupiedTailPx <= 0) return
      const leftX = reserve.finalX - reserve.leftOccupiedInsetPx
      const rightX = reserve.finalX + reserve.rightOccupiedTailPx
      if (!Number.isFinite(leftX) || !Number.isFinite(rightX) || rightX <= leftX) return
      minLeftX = Math.min(minLeftX, leftX)
      maxRightX = Math.max(maxRightX, rightX)
      if (
        pairIndex > lastCoveragePairIndex ||
        (pairIndex === lastCoveragePairIndex && onsetTicks > lastCoverageOnsetTick) ||
        (pairIndex === lastCoveragePairIndex && onsetTicks === lastCoverageOnsetTick && rightX > lastCoverageRightX)
      ) {
        lastCoveragePairIndex = pairIndex
        lastCoverageOnsetTick = onsetTicks
        lastCoverageRightX = rightX
      }
    })
  }

  if (
    !Number.isFinite(minLeftX) ||
    !Number.isFinite(maxRightX) ||
    maxRightX <= minLeftX ||
    !Number.isFinite(lastCoverageRightX)
  ) {
    return null
  }
  return {
    leftXRaw: minLeftX,
    rightXRaw: maxRightX,
    coverageEndX: lastCoverageRightX,
  }
}

function collectSpanCoverageBounds(params: {
  coverageRange: SpanCoverageRange
  measurePairs: MeasurePair[]
  noteLayoutsByPair: Map<number, NoteLayout[]>
}): SpanCoverageBounds | null {
  const { coverageRange, measurePairs, noteLayoutsByPair } = params
  const coverage: ReturnType<typeof collectMeasureTickRangeLayoutCoverage> = []
  for (let pairIndex = coverageRange.startPairIndex; pairIndex <= coverageRange.endPairIndex; pairIndex += 1) {
    const pair = measurePairs[pairIndex]
    const pairLayouts = noteLayoutsByPair.get(pairIndex) ?? []
    if (!pair || pairLayouts.length === 0) continue
    coverage.push(...collectMeasureTickRangeLayoutCoverage({
      pair,
      pairLayouts,
      startTickInclusive: pairIndex === coverageRange.startPairIndex ? coverageRange.startTickInclusive : 0,
      endTickExclusive: pairIndex === coverageRange.endPairIndex
        ? coverageRange.endTickExclusive
        : Number.MAX_SAFE_INTEGER,
      includeRests: false,
    }))
  }
  const bounds = getMeasureTickRangeLayoutBounds(coverage, 'visual')
  if (!bounds) return null
  return {
    leftXRaw: bounds.leftXRaw,
    rightXRaw: bounds.rightXRaw,
    coverageEndX: bounds.rightXRaw,
  }
}

function getPedalOccupiedEndX(params: {
  span: PedalSpan
  endX: number
  releaseWidthPx: number
}): number {
  const { span, endX, releaseWidthPx } = params
  if (span.style === 'text') {
    return endX + releaseWidthPx / 2
  }
  return endX
}

export function buildPedalRenderPlan(params: {
  context2D: CanvasRenderingContext2D | null | undefined
  measurePairs: MeasurePair[]
  pedalSpans: PedalSpan[]
  chordRulerEntriesByPair?: ChordRulerEntry[][] | null
  measureLayouts: Map<number, MeasureLayout>
  measureTimelineBundles: Map<number, MeasureTimelineBundle>
  noteLayoutsByPair: Map<number, NoteLayout[]>
}): VisualPedalSpan[] {
  const {
    context2D,
    measurePairs,
    pedalSpans,
    chordRulerEntriesByPair = null,
    measureLayouts,
    measureTimelineBundles,
    noteLayoutsByPair,
  } = params
  if (!context2D || pedalSpans.length === 0 || measureLayouts.size === 0) return []

  context2D.save()
  context2D.font = PEDAL_TEXT_FONT
  const releaseWidthPx = Math.max(4, context2D.measureText(PEDAL_RELEASE_LABEL).width)
  context2D.restore()

  const baseEntries: VisualPedalSpan[] = sortPedalSpans(pedalSpans).flatMap((span) => {
    const startMeasureLayout = measureLayouts.get(span.startPairIndex)
    const endMeasureLayout = measureLayouts.get(span.endPairIndex)
    if (!startMeasureLayout || !endMeasureLayout) return []
    const coverageRange = resolveSpanCoverageRange({
      span,
      chordRulerEntriesByPair,
    })

    const baseStartX = resolveTickX({
      tick: span.startTick,
      measureLayout: startMeasureLayout,
      timelineBundle: measureTimelineBundles.get(span.startPairIndex),
    })
    const baseEndX = resolveTickX({
      tick: span.endTick,
      measureLayout: endMeasureLayout,
      timelineBundle: measureTimelineBundles.get(span.endPairIndex),
    })
    if (!Number.isFinite(baseStartX) || !Number.isFinite(baseEndX)) return []

    const coverageBounds =
      collectSpanOnsetReserveBounds({
        coverageRange,
        measureLayouts,
      }) ??
      collectSpanCoverageBounds({
        coverageRange,
        measurePairs,
        noteLayoutsByPair,
      })
    const startX = baseStartX as number
    const requiredStartX = startX
    const requiredEndX = coverageBounds?.coverageEndX ?? coverageBounds?.rightXRaw ?? null
    const endX = Math.max(
      baseEndX as number,
      startX + PEDAL_MIN_DRAW_WIDTH_PX,
      Number.isFinite(requiredEndX) ? (requiredEndX as number) : Number.NEGATIVE_INFINITY,
    )
    const baseBaselineY = (Number.isFinite(startMeasureLayout.bassLineBottomY)
      ? startMeasureLayout.bassLineBottomY
      : startMeasureLayout.bassY + 40) + PEDAL_BASELINE_OFFSET_PX
    if (!Number.isFinite(baseBaselineY)) return []

    return [{
      span,
      baseStartX: baseStartX as number,
      baseEndX: baseEndX as number,
      startX,
      endX,
      occupiedStartX: startX,
      occupiedEndX: getPedalOccupiedEndX({ span, endX, releaseWidthPx }),
      baseBaselineY,
      baselineY: baseBaselineY,
      laneIndex: 0,
      requiredStartX,
      requiredEndX,
    }]
  })

  return baseEntries.map((entry, index) => {
    const nextEntry = baseEntries[index + 1] ?? null
    let endX = entry.endX
    if (nextEntry && Math.abs(nextEntry.baseBaselineY - entry.baseBaselineY) < 0.001) {
      const nextStartLimitX = nextEntry.startX - PEDAL_MIN_VISUAL_GAP_PX
      const minimumEndX = Math.max(
        entry.startX + PEDAL_MIN_DRAW_WIDTH_PX,
        Number.isFinite(entry.requiredEndX) ? (entry.requiredEndX as number) : Number.NEGATIVE_INFINITY,
      )
      if (endX > nextStartLimitX && nextStartLimitX >= minimumEndX) {
        endX = nextStartLimitX
      }
    }

    return {
      ...entry,
      endX,
      occupiedEndX: getPedalOccupiedEndX({
        span: entry.span,
        endX,
        releaseWidthPx,
      }),
      baselineY: entry.baseBaselineY,
      laneIndex: 0,
    }
  })
}

export function drawPedalSpans(params: {
  context2D: CanvasRenderingContext2D | null | undefined
  measurePairs: MeasurePair[]
  pedalSpans: PedalSpan[]
  chordRulerEntriesByPair?: ChordRulerEntry[][] | null
  measureLayouts: Map<number, MeasureLayout>
  measureTimelineBundles: Map<number, MeasureTimelineBundle>
  noteLayoutsByPair: Map<number, NoteLayout[]>
}): void {
  const {
    context2D,
    measurePairs,
    pedalSpans,
    chordRulerEntriesByPair = null,
    measureLayouts,
    measureTimelineBundles,
    noteLayoutsByPair,
  } = params
  const visualSpans = buildPedalRenderPlan({
    context2D,
    measurePairs,
    pedalSpans,
    chordRulerEntriesByPair,
    measureLayouts,
    measureTimelineBundles,
    noteLayoutsByPair,
  })

  if (visualSpans.length === 0) return
  if (!context2D) return

  context2D.save()
  context2D.strokeStyle = PEDAL_COLOR
  context2D.fillStyle = PEDAL_COLOR
  context2D.lineWidth = 1.2
  context2D.lineJoin = 'round'
  context2D.lineCap = 'round'
  context2D.font = PEDAL_TEXT_FONT
  context2D.textBaseline = 'alphabetic'

  visualSpans.forEach((entry) => {
    const startX = entry.startX
    const endX = Math.max(entry.endX, startX + PEDAL_MIN_DRAW_WIDTH_PX)
    if (!Number.isFinite(startX) || !Number.isFinite(endX)) return

    if (entry.span.style === 'text') {
      context2D.textAlign = 'left'
      context2D.fillText(PEDAL_TEXT_LABEL, startX, entry.baselineY)
      context2D.textAlign = 'center'
      context2D.fillText(PEDAL_RELEASE_LABEL, endX, entry.baselineY)
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
    context2D.fillText(PEDAL_TEXT_LABEL, startX, entry.baselineY)
    const pedWidth = context2D.measureText(PEDAL_TEXT_LABEL).width
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
