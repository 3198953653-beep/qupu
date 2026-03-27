import {
  DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX,
  OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX,
  OSMD_PREVIEW_MIN_SYSTEM_GAP_PX,
  OSMD_PREVIEW_REPAGINATION_MAX_ATTEMPTS,
  OSMD_PREVIEW_REPAGINATION_MAX_STEP_PX,
  OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT,
  OSMD_PREVIEW_REPAGINATION_MIN_STEP_PX,
  OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS,
  OSMD_PREVIEW_SPARSE_SYSTEM_COUNT,
  clampNumber,
  clampOsmdPreviewBottomMarginPx,
  clampOsmdPreviewHorizontalMarginPx,
  clampOsmdPreviewTopMarginPx,
  type OsmdPreviewBoundingBox,
  type OsmdPreviewInstance,
  type OsmdPreviewMusicSystem,
  type OsmdPreviewPage,
  type OsmdPreviewRebalanceStats,
} from './osmdPreviewUtils'

type OsmdPreviewSystemFrame = {
  system: OsmdPreviewMusicSystem
  y: number
  height: number
}

function collectOsmdPreviewSystemFrames(page: OsmdPreviewPage): OsmdPreviewSystemFrame[] {
  const systems = page.MusicSystems ?? []
  return systems
    .map((system) => {
      const box = system.PositionAndShape
      const y = box?.RelativePosition?.y
      const height = box?.Size?.height
      if (
        typeof y !== 'number' ||
        !Number.isFinite(y) ||
        typeof height !== 'number' ||
        !Number.isFinite(height)
      ) {
        return null
      }
      return {
        system,
        y,
        height: Math.max(0, height),
      }
    })
    .filter((frame): frame is OsmdPreviewSystemFrame => frame !== null)
    .sort((left, right) => left.y - right.y)
}

function setOsmdPreviewSystemY(system: OsmdPreviewMusicSystem, nextY: number): boolean {
  const box = system.PositionAndShape
  const position = box?.RelativePosition
  if (!position || !Number.isFinite(position.y) || !Number.isFinite(nextY)) return false
  const delta = nextY - position.y
  if (Math.abs(delta) < 0.01) return false
  position.y = nextY
  const absolute = box?.AbsolutePosition
  if (absolute && Number.isFinite(absolute.y)) {
    absolute.y += delta
  }
  const shiftAbsoluteTreeY = (target: OsmdPreviewBoundingBox | undefined): void => {
    if (!target?.ChildElements || target.ChildElements.length === 0) return
    target.ChildElements.forEach((child) => {
      const childAbsolute = child.AbsolutePosition
      if (childAbsolute && Number.isFinite(childAbsolute.y)) {
        childAbsolute.y += delta
      }
      shiftAbsoluteTreeY(child)
    })
  }
  shiftAbsoluteTreeY(box)
  return true
}

export function rebalanceOsmdPreviewVerticalSystems(
  osmd: OsmdPreviewInstance,
  firstPageTopMarginPx: number,
  followingPageTopMarginPx: number,
  bottomMarginPx: number,
  layoutBottomMarginPx = bottomMarginPx,
  repaginationAttempts = 0,
): OsmdPreviewRebalanceStats {
  const sheet = osmd.GraphicSheet
  const pages = sheet?.MusicPages ?? []
  const safeFirstPageTopMarginPx = clampOsmdPreviewTopMarginPx(firstPageTopMarginPx)
  const safeFollowingPageTopMarginPx = clampOsmdPreviewTopMarginPx(followingPageTopMarginPx)
  const safeBottomMarginPx = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
  const safeLayoutBottomMarginPx = clampOsmdPreviewBottomMarginPx(layoutBottomMarginPx)
  if (!sheet || pages.length === 0) {
    return {
      executed: false,
      pageCount: pages.length,
      mutatedCount: 0,
      targetFirstTop: safeFirstPageTopMarginPx,
      targetFollowingTop: safeFollowingPageTopMarginPx,
      targetBottom: safeBottomMarginPx,
      layoutBottom: safeLayoutBottomMarginPx,
      minSystemGap: OSMD_PREVIEW_MIN_SYSTEM_GAP_PX,
      repaginationAttempts,
      requiresRepagination: false,
      pageSummaries: [],
    }
  }

  let hasMutated = false
  let mutatedCount = 0
  let requiresRepagination = false
  const rulePageHeight = osmd.EngravingRules?.PageHeight
  const hasRulePageHeight = typeof rulePageHeight === 'number' && Number.isFinite(rulePageHeight) && rulePageHeight > 0
  const referencePageHeightUnits = pages.reduce((maxHeight, page) => {
    const candidate = page.PositionAndShape?.Size?.height
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
      return maxHeight
    }
    return Math.max(maxHeight, candidate)
  }, 0)
  const normalizedPageHeightUnits = hasRulePageHeight
    ? rulePageHeight
    : referencePageHeightUnits > 0
      ? referencePageHeightUnits
      : 0
  const pageSummaries: OsmdPreviewRebalanceStats['pageSummaries'] = []

  pages.forEach((page, pageIndex) => {
    const frames = collectOsmdPreviewSystemFrames(page)
    if (frames.length === 0) {
      pageSummaries.push({
        pageIndex,
        frameCount: 0,
        mutated: 0,
        mode: 'distributed',
        firstYBefore: null,
        firstYAfter: null,
        gapCount: 0,
        minGapShortfall: 0,
        bottomGapAfter: null,
      })
      return
    }

    const firstYBefore = frames[0].y
    const heights = frames.map((frame) => frame.height)
    const sourceGaps = frames.slice(0, -1).map((frame, index) => {
      const next = frames[index + 1]
      return Math.max(0, next.y - (frame.y + heights[index]))
    })
    const sourceGapSum = sourceGaps.reduce((sum, gap) => sum + gap, 0)
    const targetTop = pageIndex === 0 ? safeFirstPageTopMarginPx : safeFollowingPageTopMarginPx
    const gapCount = sourceGaps.length
    const minGapTotal = gapCount * OSMD_PREVIEW_MIN_SYSTEM_GAP_PX
    const heightSum = heights.reduce((sum, height) => sum + height, 0)
    const maxFeasibleTop = Math.max(0, normalizedPageHeightUnits - safeBottomMarginPx - (heightSum + minGapTotal))
    const appliedTop = Math.min(targetTop, maxFeasibleTop)
    const availableSpan = Math.max(0, normalizedPageHeightUnits - appliedTop - safeBottomMarginPx)
    const minRequiredSpan = heightSum + minGapTotal
    const topShortfall = Math.max(0, targetTop - appliedTop)
    const contentShortfall = Math.max(0, minRequiredSpan - availableSpan)
    const minGapShortfall = topShortfall + contentShortfall
    const extraGapSpan = Math.max(0, availableSpan - minRequiredSpan)
    const targetGaps =
      gapCount === 0
        ? []
        : sourceGapSum > 1e-6
          ? sourceGaps.map((gap) => OSMD_PREVIEW_MIN_SYSTEM_GAP_PX + (gap / sourceGapSum) * extraGapSpan)
          : sourceGaps.map(() => OSMD_PREVIEW_MIN_SYSTEM_GAP_PX + extraGapSpan / gapCount)
    if (
      minGapShortfall > OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS &&
      frames.length >= OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT
    ) {
      requiresRepagination = true
    }

    let cursorY = appliedTop
    let pageMutated = 0
    frames.forEach((frame, index) => {
      if (setOsmdPreviewSystemY(frame.system, cursorY)) {
        hasMutated = true
        mutatedCount += 1
        pageMutated += 1
      }
      cursorY += heights[index]
      if (index < targetGaps.length) {
        cursorY += targetGaps[index]
      }
    })

    const lastFrame = frames[frames.length - 1]
    const lastFrameY = lastFrame.system.PositionAndShape?.RelativePosition?.y
    const bottomGapAfter =
      typeof lastFrameY === 'number' && Number.isFinite(lastFrameY)
        ? Number((normalizedPageHeightUnits - (lastFrameY + lastFrame.height)).toFixed(3))
        : null
    pageSummaries.push({
      pageIndex,
      frameCount: frames.length,
      mutated: pageMutated,
      mode: frames.length <= OSMD_PREVIEW_SPARSE_SYSTEM_COUNT ? 'sparse' : 'distributed',
      firstYBefore,
      firstYAfter: frames[0].system.PositionAndShape?.RelativePosition?.y ?? null,
      gapCount,
      minGapShortfall: Number(minGapShortfall.toFixed(3)),
      bottomGapAfter,
    })
  })

  if (hasMutated) {
    const drawer = osmd.Drawer as unknown as {
      clear?: () => void
      backend?: { clear?: () => void }
      Backends?: Array<{ clear?: () => void }>
      drawSheet?: (sheet?: unknown) => void
    }
    if (Array.isArray(drawer.Backends) && drawer.Backends.length > 0) {
      drawer.Backends.forEach((backend) => backend.clear?.())
    } else if (drawer.backend?.clear) {
      drawer.backend.clear()
    } else if (drawer.clear) {
      drawer.clear()
    }
    drawer.drawSheet?.(sheet)
  }

  return {
    executed: true,
    pageCount: pages.length,
    mutatedCount,
    targetFirstTop: safeFirstPageTopMarginPx,
    targetFollowingTop: safeFollowingPageTopMarginPx,
    targetBottom: safeBottomMarginPx,
    layoutBottom: safeLayoutBottomMarginPx,
    minSystemGap: OSMD_PREVIEW_MIN_SYSTEM_GAP_PX,
    repaginationAttempts,
    requiresRepagination,
    pageSummaries,
  }
}

export function applyOsmdPreviewHorizontalMargins(osmd: OsmdPreviewInstance, horizontalMarginPx: number): void {
  const rules = osmd.EngravingRules
  if (!rules) return
  const safeMarginPx = clampOsmdPreviewHorizontalMarginPx(horizontalMarginPx)
  rules.PageLeftMargin = safeMarginPx
  rules.PageRightMargin = safeMarginPx
}

export function applyOsmdPreviewVerticalMargins(osmd: OsmdPreviewInstance, topMarginPx: number, bottomMarginPx: number): void {
  const rules = osmd.EngravingRules
  if (!rules) return
  rules.PageTopMargin = clampOsmdPreviewTopMarginPx(topMarginPx)
  rules.PageBottomMargin = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
}

export function renderAndRebalanceOsmdPreview(
  osmd: OsmdPreviewInstance,
  horizontalMarginPx: number,
  firstPageTopMarginPx: number,
  followingPageTopMarginPx: number,
  bottomMarginPx: number,
): OsmdPreviewRebalanceStats {
  const safeHorizontalMarginPx = clampOsmdPreviewHorizontalMarginPx(horizontalMarginPx)
  const safeBottomMarginPx = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
  applyOsmdPreviewHorizontalMargins(osmd, safeHorizontalMarginPx)

  const baseLayoutBottomPx = clampOsmdPreviewBottomMarginPx(
    Math.min(safeBottomMarginPx, DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX),
  )
  let layoutBottomPx = baseLayoutBottomPx
  let attempt = 0
  while (true) {
    applyOsmdPreviewVerticalMargins(osmd, OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX, layoutBottomPx)
    osmd.render()
    const stats = rebalanceOsmdPreviewVerticalSystems(
      osmd,
      firstPageTopMarginPx,
      followingPageTopMarginPx,
      safeBottomMarginPx,
      layoutBottomPx,
      attempt,
    )
    const maxShortfall = stats.pageSummaries.reduce(
      (maxValue, summary) =>
        summary.frameCount >= OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT
          ? Math.max(maxValue, summary.minGapShortfall)
          : maxValue,
      0,
    )
    if (!stats.requiresRepagination || maxShortfall <= OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS) {
      return stats
    }
    if (attempt >= OSMD_PREVIEW_REPAGINATION_MAX_ATTEMPTS || layoutBottomPx >= 180) {
      return stats
    }
    const step = clampNumber(
      Math.ceil(maxShortfall),
      OSMD_PREVIEW_REPAGINATION_MIN_STEP_PX,
      OSMD_PREVIEW_REPAGINATION_MAX_STEP_PX,
    )
    const nextLayoutBottomPx = clampOsmdPreviewBottomMarginPx(layoutBottomPx + step)
    if (nextLayoutBottomPx <= layoutBottomPx) {
      return stats
    }
    layoutBottomPx = nextLayoutBottomPx
    attempt += 1
  }
}
