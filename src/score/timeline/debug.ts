import type { PublicAxisLayout, PublicMergedTimeline, TimelineDiffSummary } from './types'

export function compareLegacyAndMergedTimeline(params: {
  legacyOnsets: number[]
  publicTimeline: PublicMergedTimeline
  publicAxisLayout?: PublicAxisLayout | null
}): TimelineDiffSummary {
  void params.publicAxisLayout
  const legacyTicks = [...new Set(params.legacyOnsets.filter((tick) => Number.isFinite(tick)))].sort(
    (left, right) => left - right,
  )
  const mergedTicks = [...new Set(params.publicTimeline.points.map((point) => point.tick))]
    .filter((tick) => Number.isFinite(tick))
    .sort((left, right) => left - right)
  const legacySet = new Set<number>(legacyTicks)
  const mergedSet = new Set<number>(mergedTicks)
  return {
    legacyTickCount: legacyTicks.length,
    mergedTickCount: mergedTicks.length,
    overlapTickCount: legacyTicks.filter((tick) => mergedSet.has(tick)).length,
    legacyOnlyTicks: legacyTicks.filter((tick) => !mergedSet.has(tick)),
    mergedOnlyTicks: mergedTicks.filter((tick) => !legacySet.has(tick)),
  }
}
