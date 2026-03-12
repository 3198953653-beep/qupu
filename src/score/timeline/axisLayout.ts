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
  startPadPx: number
  endPadPx: number
}

const BASE_GAP_UNIT_PX = 3.5

function mapTickGapToWeight(deltaTicks: number, config: PublicAxisSpacingConfig): number {
  const base32GapPx = Math.max(0, config.baseMinGap32Px)
  const base32Ratio = Math.max(0.0001, config.durationGapRatios.thirtySecond)
  const safeTicks = Math.max(1, deltaTicks)
  const weightPerTick = (base32GapPx * base32Ratio * BASE_GAP_UNIT_PX) / 2
  return safeTicks * weightPerTick
}

export function getPublicTimelineAnchorTicks(
  publicTimeline: PublicMergedTimeline,
  domainStartTick?: number | null,
  domainEndTick?: number | null,
): number[] {
  const hasDomainStart = typeof domainStartTick === 'number' && Number.isFinite(domainStartTick)
  const hasDomainEnd = typeof domainEndTick === 'number' && Number.isFinite(domainEndTick)
  const anchorSet = new Set<number>()
  publicTimeline.points.forEach((point) => {
    if (hasDomainStart && point.tick < (domainStartTick as number)) return
    if (hasDomainEnd && point.tick > (domainEndTick as number)) return
    if (
      point.isBeatBoundary ||
      point.trebleStartsHere ||
      point.bassStartsHere
    ) {
      anchorSet.add(point.tick)
    }
  })
  return [...anchorSet].filter((tick) => Number.isFinite(tick)).sort((left, right) => left - right)
}

export function buildPublicAxisLayout(params: {
  measureIndex: number
  measureTicks: number
  publicTimeline: PublicMergedTimeline
  spacingConfig: PublicAxisSpacingConfig
  effectiveBoundaryStartX: number
  effectiveBoundaryEndX: number
  timelineScaleOverride?: number | null
}): PublicAxisLayout {
  const {
    measureIndex,
    measureTicks,
    publicTimeline,
    spacingConfig,
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
    timelineScaleOverride = null,
  } = params
  const orderedTicks = [...new Set(publicTimeline.points.map((point) => point.tick))]
    .filter((tick) => Number.isFinite(tick))
    .sort((left, right) => left - right)
  const noteStartTicks = publicTimeline.points
    .filter((point) => point.trebleStartsHere || point.bassStartsHere)
    .map((point) => point.tick)
    .filter((tick) => Number.isFinite(tick))
    .sort((left, right) => left - right)
  const firstContentTick = noteStartTicks[0] ?? orderedTicks[0]
  const lastContentTick = noteStartTicks[noteStartTicks.length - 1] ?? orderedTicks[orderedTicks.length - 1]
  const anchorTicks = getPublicTimelineAnchorTicks(publicTimeline, firstContentTick, lastContentTick)
  const tickToX = new Map<number, number>()
  const widthPx = Math.max(0, effectiveBoundaryEndX - effectiveBoundaryStartX)
  const contentStartX = Math.min(
    effectiveBoundaryEndX,
    effectiveBoundaryStartX + Math.max(0, spacingConfig.startPadPx),
  )
  const contentEndX = Math.max(
    contentStartX,
    effectiveBoundaryEndX - Math.max(0, spacingConfig.endPadPx),
  )
  const contentWidthPx = Math.max(0, contentEndX - contentStartX)
  if (orderedTicks.length === 0) {
    return {
      measureIndex,
      measureTicks,
      tickToX,
      orderedTicks,
      anchorTicks,
      totalAnchorWeight: 0,
      timelineScale: 0,
      effectiveBoundaryStartX,
      effectiveBoundaryEndX,
      effectiveLeftGapPx: 0,
      effectiveRightGapPx: 0,
      widthPx,
    }
  }

  const safeAnchorTicks = anchorTicks.length > 0 ? anchorTicks : [firstContentTick, lastContentTick]
  const cumulativeWeightByAnchorTick = new Map<number, number>()
  cumulativeWeightByAnchorTick.set(safeAnchorTicks[0], 0)
  let totalWeight = 0
  for (let index = 1; index < safeAnchorTicks.length; index += 1) {
    const deltaTicks = Math.max(1, safeAnchorTicks[index] - safeAnchorTicks[index - 1])
    totalWeight += mapTickGapToWeight(deltaTicks, spacingConfig)
    cumulativeWeightByAnchorTick.set(safeAnchorTicks[index], totalWeight)
  }

  const anchorXByTick = new Map<number, number>()
  const resolvedTimelineScale =
    totalWeight <= 0.0001 || safeAnchorTicks.length <= 1
      ? 0
      : typeof timelineScaleOverride === 'number' && Number.isFinite(timelineScaleOverride)
        ? Math.max(0, timelineScaleOverride)
        : Math.min(1, contentWidthPx / Math.max(0.0001, totalWeight))
  if (resolvedTimelineScale <= 0 || totalWeight <= 0.0001 || safeAnchorTicks.length <= 1) {
    safeAnchorTicks.forEach((tick) => anchorXByTick.set(tick, contentStartX))
    orderedTicks.forEach((tick) => tickToX.set(tick, contentStartX))
  } else {
    safeAnchorTicks.forEach((tick) => {
      const weight = cumulativeWeightByAnchorTick.get(tick) ?? 0
      const x = contentStartX + weight * resolvedTimelineScale
      anchorXByTick.set(tick, x)
    })
    let anchorIndex = 0
    orderedTicks.forEach((tick) => {
      const directAnchorX = anchorXByTick.get(tick)
      if (typeof directAnchorX === 'number' && Number.isFinite(directAnchorX)) {
        tickToX.set(tick, directAnchorX)
        return
      }
      if (tick <= safeAnchorTicks[0]) {
        tickToX.set(tick, anchorXByTick.get(safeAnchorTicks[0]) ?? contentStartX)
        return
      }
      if (tick >= safeAnchorTicks[safeAnchorTicks.length - 1]) {
        tickToX.set(tick, anchorXByTick.get(safeAnchorTicks[safeAnchorTicks.length - 1]) ?? contentEndX)
        return
      }
      while (anchorIndex + 1 < safeAnchorTicks.length && safeAnchorTicks[anchorIndex + 1] < tick) {
        anchorIndex += 1
      }
      const leftAnchorTick = safeAnchorTicks[Math.max(0, anchorIndex)]
      const rightAnchorTick = safeAnchorTicks[Math.min(safeAnchorTicks.length - 1, anchorIndex + 1)]
      const leftAnchorX = anchorXByTick.get(leftAnchorTick) ?? effectiveBoundaryStartX
      const rightAnchorX = anchorXByTick.get(rightAnchorTick) ?? effectiveBoundaryEndX
      if (rightAnchorTick <= leftAnchorTick) {
        tickToX.set(tick, leftAnchorX)
        return
      }
      const blend = (tick - leftAnchorTick) / Math.max(0.0001, rightAnchorTick - leftAnchorTick)
      tickToX.set(tick, leftAnchorX + (rightAnchorX - leftAnchorX) * blend)
    })
  }

  const firstX = tickToX.get(firstContentTick) ?? effectiveBoundaryStartX
  const lastX = tickToX.get(lastContentTick) ?? effectiveBoundaryEndX

  return {
    measureIndex,
    measureTicks,
    tickToX,
    orderedTicks,
    anchorTicks: safeAnchorTicks,
    totalAnchorWeight: totalWeight,
    timelineScale: resolvedTimelineScale,
    effectiveBoundaryStartX,
    effectiveBoundaryEndX,
    effectiveLeftGapPx: firstX - effectiveBoundaryStartX,
    effectiveRightGapPx: effectiveBoundaryEndX - lastX,
    widthPx,
  }
}
