import type { OsmdPreviewInstance } from './osmdPreviewTypes'

export function buildOsmdPreviewSystemMetrics(osmd: OsmdPreviewInstance | null): {
  hasPreview: boolean
  pageCount: number
  pages: Array<{
    pageIndex: number
    pageHeight: number | null
    pageHeightRaw: number | null
    bottomGap: number | null
    bottomGapRaw: number | null
    systemCount: number
    systemY: number[]
    systemHeights: number[]
  }>
} {
  if (!osmd) {
    return {
      hasPreview: false,
      pageCount: 0,
      pages: [],
    }
  }
  const pages = osmd.GraphicSheet?.MusicPages ?? []
  const rulePageHeight = osmd.EngravingRules?.PageHeight
  const hasRulePageHeight = typeof rulePageHeight === 'number' && Number.isFinite(rulePageHeight) && rulePageHeight > 0
  const referencePageHeight = pages.reduce((maxHeight, page) => {
    const candidate = page.PositionAndShape?.Size?.height
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
      return maxHeight
    }
    return Math.max(maxHeight, candidate)
  }, 0)
  const normalizedPageHeight =
    hasRulePageHeight ? rulePageHeight : referencePageHeight > 0 ? referencePageHeight : null
  return {
    hasPreview: true,
    pageCount: pages.length,
    pages: pages.map((page, pageIndex) => {
      const systems = page.MusicSystems ?? []
      const rawPageHeight =
        typeof page.PositionAndShape?.Size?.height === 'number' && Number.isFinite(page.PositionAndShape.Size.height)
          ? Number(page.PositionAndShape.Size.height.toFixed(3))
          : null
      const lastSystemBottom =
        systems.length > 0
          ? (systems[systems.length - 1].PositionAndShape?.RelativePosition?.y ?? 0) +
            (systems[systems.length - 1].PositionAndShape?.Size?.height ?? 0)
          : null
      return {
        pageIndex,
        pageHeight: normalizedPageHeight !== null ? Number(normalizedPageHeight.toFixed(3)) : rawPageHeight,
        pageHeightRaw: rawPageHeight,
        bottomGap:
          normalizedPageHeight !== null && typeof lastSystemBottom === 'number' && Number.isFinite(lastSystemBottom)
            ? Number((normalizedPageHeight - lastSystemBottom).toFixed(3))
            : null,
        bottomGapRaw:
          rawPageHeight !== null && typeof lastSystemBottom === 'number' && Number.isFinite(lastSystemBottom)
            ? Number((rawPageHeight - lastSystemBottom).toFixed(3))
            : null,
        systemCount: systems.length,
        systemY: systems.map((system) => {
          const y = system.PositionAndShape?.RelativePosition?.y
          return typeof y === 'number' && Number.isFinite(y) ? Number(y.toFixed(3)) : NaN
        }),
        systemHeights: systems.map((system) => {
          const h = system.PositionAndShape?.Size?.height
          return typeof h === 'number' && Number.isFinite(h) ? Number(h.toFixed(3)) : NaN
        }),
      }
    }),
  }
}
