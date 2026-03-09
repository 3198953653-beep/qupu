import type { PublicAxisLayout, PublicMergedTimeline } from './types'

export type PublicAxisDurationGapRatioConfig = {
  thirtySecond: number
  sixteenth: number
  eighth: number
  quarter: number
  half: number
}

export type PublicAxisSpacingConfig = {
  baseMinGap32Px: number
  durationGapRatios: PublicAxisDurationGapRatioConfig
}

const BASE_GAP_UNIT_PX = 3.5

function getDurationGapRatioByDeltaTicks(deltaTicks: number, ratios: PublicAxisDurationGapRatioConfig): number {
  const anchors: Array<{ ticks: number; ratio: number }> = [
    { ticks: 2, ratio: ratios.thirtySecond },
    { ticks: 4, ratio: ratios.sixteenth },
    { ticks: 8, ratio: ratios.eighth },
    { ticks: 16, ratio: ratios.quarter },
    { ticks: 32, ratio: ratios.half },
  ]
  const safeTicks = Math.max(1, deltaTicks)
  if (safeTicks <= anchors[0].ticks) return anchors[0].ratio
  if (safeTicks >= anchors[anchors.length - 1].ticks) return anchors[anchors.length - 1].ratio
  for (let index = 1; index < anchors.length; index += 1) {
    const left = anchors[index - 1]
    const right = anchors[index]
    if (safeTicks === right.ticks) return right.ratio
    if (safeTicks < right.ticks) {
      const leftLog = Math.log2(left.ticks)
      const rightLog = Math.log2(right.ticks)
      const tickLog = Math.log2(safeTicks)
      const blend = (tickLog - leftLog) / Math.max(0.0001, rightLog - leftLog)
      return left.ratio + (right.ratio - left.ratio) * blend
    }
  }
  return anchors[anchors.length - 1].ratio
}

function mapTickGapToWeight(deltaTicks: number, config: PublicAxisSpacingConfig): number {
  const ratio = Math.max(0.0001, getDurationGapRatioByDeltaTicks(deltaTicks, config.durationGapRatios))
  const base32GapPx = Math.max(0, config.baseMinGap32Px)
  return base32GapPx * ratio * BASE_GAP_UNIT_PX
}

export function buildPublicAxisLayout(params: {
  measureIndex: number
  measureTicks: number
  publicTimeline: PublicMergedTimeline
  spacingConfig: PublicAxisSpacingConfig
  effectiveBoundaryStartX: number
  effectiveBoundaryEndX: number
}): PublicAxisLayout {
  const { measureIndex, measureTicks, publicTimeline, spacingConfig, effectiveBoundaryStartX, effectiveBoundaryEndX } = params
  const orderedTicks = [...new Set(publicTimeline.points.map((point) => point.tick))]
    .filter((tick) => Number.isFinite(tick))
    .sort((left, right) => left - right)
  const tickToX = new Map<number, number>()
  const widthPx = Math.max(0, effectiveBoundaryEndX - effectiveBoundaryStartX)
  if (orderedTicks.length === 0) {
    return {
      measureIndex,
      measureTicks,
      tickToX,
      orderedTicks,
      effectiveBoundaryStartX,
      effectiveBoundaryEndX,
      effectiveLeftGapPx: 0,
      effectiveRightGapPx: 0,
      widthPx,
    }
  }

  const cumulativeWeightByTick = new Map<number, number>()
  cumulativeWeightByTick.set(orderedTicks[0], 0)
  let totalWeight = 0
  for (let index = 1; index < orderedTicks.length; index += 1) {
    const deltaTicks = Math.max(1, orderedTicks[index] - orderedTicks[index - 1])
    totalWeight += mapTickGapToWeight(deltaTicks, spacingConfig)
    cumulativeWeightByTick.set(orderedTicks[index], totalWeight)
  }

  if (totalWeight <= 0.0001) {
    orderedTicks.forEach((tick) => tickToX.set(tick, effectiveBoundaryStartX))
  } else {
    orderedTicks.forEach((tick) => {
      const weight = cumulativeWeightByTick.get(tick) ?? 0
      const x = effectiveBoundaryStartX + (weight / totalWeight) * widthPx
      tickToX.set(tick, x)
    })
  }

  const firstContentTick =
    publicTimeline.points.find((point) => point.trebleStartsHere || point.bassStartsHere)?.tick ?? orderedTicks[0]
  const lastContentTick =
    [...publicTimeline.points]
      .reverse()
      .find((point) => point.trebleStartsHere || point.bassStartsHere || point.trebleEndsHere || point.bassEndsHere)?.tick ??
    orderedTicks[orderedTicks.length - 1]

  const firstX = tickToX.get(firstContentTick) ?? effectiveBoundaryStartX
  const lastX = tickToX.get(lastContentTick) ?? effectiveBoundaryEndX

  return {
    measureIndex,
    measureTicks,
    tickToX,
    orderedTicks,
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
    effectiveLeftGapPx: firstX - effectiveBoundaryStartX,
    effectiveRightGapPx: effectiveBoundaryEndX - lastX,
    widthPx,
  }
}
