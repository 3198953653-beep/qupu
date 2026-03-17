import type { AccidentalLayout, NoteHeadLayout, NoteLayout, TieLayout } from '../types'

export type HitNote = {
  layout: NoteLayout
  head: NoteHeadLayout
}

export type HitAccidental = {
  layout: NoteLayout
  accidental: AccidentalLayout
}

export type HitTie = {
  layout: NoteLayout
  tie: TieLayout
}

export type HitTarget =
  | {
      kind: 'noteHead'
      layout: NoteLayout
      head: NoteHeadLayout
    }
  | {
      kind: 'accidental'
      layout: NoteLayout
      accidental: AccidentalLayout
    }
  | {
      kind: 'tie'
      layout: NoteLayout
      tie: TieLayout
    }

type HitGridCandidate = {
  kind: 'noteHead' | 'accidental' | 'tie'
  layout: NoteLayout
  head?: NoteHeadLayout
  accidental?: AccidentalLayout
  tie?: TieLayout
}

export type HitGridIndex = {
  cellSize: number
  cells: Map<string, HitGridCandidate[]>
}

const HIT_INDEX_CELL_SIZE = 40
const DEFAULT_HIT_RADIUS_X = 5.5
const DEFAULT_HIT_RADIUS_Y = 4.2
const DEFAULT_ACCIDENTAL_HIT_RADIUS_X = 5
const DEFAULT_ACCIDENTAL_HIT_RADIUS_Y = 7
const HIT_TOLERANCE_PX = 2
const TIE_CURVE_TOLERANCE_PX = 1.0
const TIE_SHORT_TIE_CUTOFF = 10
const TIE_CP1 = 8
const TIE_CP2 = 12
const TIE_CP1_SHORT = 2
const TIE_CP2_SHORT = 8
const TIE_Y_SHIFT = 7
const TIE_MIN_SAMPLE_COUNT = 14
const TIE_MAX_SAMPLE_COUNT = 40
const TIE_SAMPLING_STEP_PX = 3

type TieCurvePoint = {
  x: number
  y: number
}

type TieCenterSample = TieCurvePoint & {
  halfThickness: number
}

type TieCurveProfile = {
  polygon: TieCurvePoint[]
  centerline: TieCenterSample[]
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const tieCurveProfileCache = new WeakMap<TieLayout, TieCurveProfile>()

function toHitCellKey(cellX: number, cellY: number): string {
  return `${cellX}|${cellY}`
}

type ResolvedHitGeometry = {
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function finiteOrFallback(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function evaluateQuadraticPoint(params: {
  startX: number
  startY: number
  controlX: number
  controlY: number
  endX: number
  endY: number
  t: number
}): TieCurvePoint {
  const { startX, startY, controlX, controlY, endX, endY, t } = params
  const safeT = clamp(t, 0, 1)
  const oneMinusT = 1 - safeT
  return {
    x: oneMinusT * oneMinusT * startX + 2 * oneMinusT * safeT * controlX + safeT * safeT * endX,
    y: oneMinusT * oneMinusT * startY + 2 * oneMinusT * safeT * controlY + safeT * safeT * endY,
  }
}

function resolveHeadHitGeometry(head: NoteHeadLayout): ResolvedHitGeometry {
  const centerX = finiteOrFallback(head.hitCenterX, head.x + 6)
  const centerY = finiteOrFallback(head.hitCenterY, head.y)
  const radiusX = Math.max(1, finiteOrFallback(head.hitRadiusX, DEFAULT_HIT_RADIUS_X))
  const radiusY = Math.max(1, finiteOrFallback(head.hitRadiusY, DEFAULT_HIT_RADIUS_Y))
  const rawMinX = finiteOrFallback(head.hitMinX, centerX - radiusX)
  const rawMaxX = finiteOrFallback(head.hitMaxX, centerX + radiusX)
  const rawMinY = finiteOrFallback(head.hitMinY, centerY - radiusY)
  const rawMaxY = finiteOrFallback(head.hitMaxY, centerY + radiusY)
  const minX = Math.min(rawMinX, rawMaxX)
  const maxX = Math.max(rawMinX, rawMaxX)
  const minY = Math.min(rawMinY, rawMaxY)
  const maxY = Math.max(rawMinY, rawMaxY)
  return {
    centerX,
    centerY,
    radiusX,
    radiusY,
    minX,
    maxX,
    minY,
    maxY,
  }
}

function resolveAccidentalHitGeometry(accidental: AccidentalLayout): ResolvedHitGeometry {
  const centerX = finiteOrFallback(accidental.hitCenterX, accidental.x)
  const centerY = finiteOrFallback(accidental.hitCenterY, accidental.y)
  const radiusX = Math.max(1, finiteOrFallback(accidental.hitRadiusX, DEFAULT_ACCIDENTAL_HIT_RADIUS_X))
  const radiusY = Math.max(1, finiteOrFallback(accidental.hitRadiusY, DEFAULT_ACCIDENTAL_HIT_RADIUS_Y))
  const rawMinX = finiteOrFallback(accidental.hitMinX, centerX - radiusX)
  const rawMaxX = finiteOrFallback(accidental.hitMaxX, centerX + radiusX)
  const rawMinY = finiteOrFallback(accidental.hitMinY, centerY - radiusY)
  const rawMaxY = finiteOrFallback(accidental.hitMaxY, centerY + radiusY)
  const minX = Math.min(rawMinX, rawMaxX)
  const maxX = Math.max(rawMinX, rawMaxX)
  const minY = Math.min(rawMinY, rawMaxY)
  const maxY = Math.max(rawMinY, rawMaxY)
  return {
    centerX,
    centerY,
    radiusX,
    radiusY,
    minX,
    maxX,
    minY,
    maxY,
  }
}

function buildTieCurveProfile(tie: TieLayout): TieCurveProfile {
  const direction = tie.direction === 0 ? 1 : tie.direction
  const safeStartX = Math.min(tie.startX, tie.endX - 0.5)
  const safeEndX = Math.max(tie.endX, tie.startX + 0.5)
  const spanX = Math.abs(safeEndX - safeStartX)
  const useShortCurve = spanX < TIE_SHORT_TIE_CUTOFF
  const cp1 = useShortCurve ? TIE_CP1_SHORT : TIE_CP1
  const cp2 = useShortCurve ? TIE_CP2_SHORT : TIE_CP2
  const firstY = tie.startY + TIE_Y_SHIFT * direction
  const lastY = tie.endY + TIE_Y_SHIFT * direction
  const cpX = (safeStartX + safeEndX) / 2
  const averageY = (firstY + lastY) / 2
  const topCPY = averageY + cp1 * direction
  const bottomCPY = averageY + cp2 * direction
  const sampleCount = clamp(
    Math.ceil(spanX / TIE_SAMPLING_STEP_PX),
    TIE_MIN_SAMPLE_COUNT,
    TIE_MAX_SAMPLE_COUNT,
  )

  const top: TieCurvePoint[] = []
  const bottom: TieCurvePoint[] = []
  const centerline: TieCenterSample[] = []
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount
    const topPoint = evaluateQuadraticPoint({
      startX: safeStartX,
      startY: firstY,
      controlX: cpX,
      controlY: topCPY,
      endX: safeEndX,
      endY: lastY,
      t,
    })
    const bottomPoint = evaluateQuadraticPoint({
      startX: safeStartX,
      startY: firstY,
      controlX: cpX,
      controlY: bottomCPY,
      endX: safeEndX,
      endY: lastY,
      t,
    })
    const centerPoint: TieCenterSample = {
      x: (topPoint.x + bottomPoint.x) / 2,
      y: (topPoint.y + bottomPoint.y) / 2,
      halfThickness: Math.hypot(topPoint.x - bottomPoint.x, topPoint.y - bottomPoint.y) / 2,
    }
    top.push(topPoint)
    bottom.push(bottomPoint)
    centerline.push(centerPoint)

    minX = Math.min(minX, topPoint.x, bottomPoint.x)
    maxX = Math.max(maxX, topPoint.x, bottomPoint.x)
    minY = Math.min(minY, topPoint.y, bottomPoint.y)
    maxY = Math.max(maxY, topPoint.y, bottomPoint.y)
  }

  const polygon = [...top, ...bottom.slice().reverse()]
  return {
    polygon,
    centerline,
    minX,
    maxX,
    minY,
    maxY,
  }
}

function getTieCurveProfile(tie: TieLayout): TieCurveProfile {
  const cached = tieCurveProfileCache.get(tie)
  if (cached) return cached
  const profile = buildTieCurveProfile(tie)
  tieCurveProfileCache.set(tie, profile)
  return profile
}

function isPointInPolygon(x: number, y: number, polygon: TieCurvePoint[]): boolean {
  if (polygon.length < 3) return false
  let isInside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i]
    const previous = polygon[j]
    const crossesY = (current.y > y) !== (previous.y > y)
    if (!crossesY) continue
    const denominator = previous.y - current.y
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-9) continue
    const xOnEdge = ((previous.x - current.x) * (y - current.y)) / denominator + current.x
    if (x < xOnEdge) isInside = !isInside
  }
  return isInside
}

function getPointToSegmentDistance(params: {
  x: number
  y: number
  start: TieCurvePoint
  end: TieCurvePoint
}): number {
  const { x, y, start, end } = params
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared <= 1e-9) {
    return Math.hypot(x - start.x, y - start.y)
  }
  const projection = ((x - start.x) * deltaX + (y - start.y) * deltaY) / lengthSquared
  const t = clamp(projection, 0, 1)
  const nearestX = start.x + deltaX * t
  const nearestY = start.y + deltaY * t
  return Math.hypot(x - nearestX, y - nearestY)
}

function getPointToPolygonBoundaryDistance(x: number, y: number, polygon: TieCurvePoint[]): number {
  if (polygon.length < 2) return Number.POSITIVE_INFINITY
  let winner = Number.POSITIVE_INFINITY
  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length
    const distance = getPointToSegmentDistance({
      x,
      y,
      start: polygon[index],
      end: polygon[nextIndex],
    })
    if (distance < winner) {
      winner = distance
    }
  }
  return winner
}

function getPointToCenterlineDistance(params: {
  x: number
  y: number
  centerline: TieCenterSample[]
}): { distance: number; halfThickness: number } {
  const { x, y, centerline } = params
  if (centerline.length === 0) {
    return { distance: Number.POSITIVE_INFINITY, halfThickness: 0 }
  }
  if (centerline.length === 1) {
    return {
      distance: Math.hypot(x - centerline[0].x, y - centerline[0].y),
      halfThickness: centerline[0].halfThickness,
    }
  }

  let winnerDistance = Number.POSITIVE_INFINITY
  let winnerHalfThickness = centerline[0].halfThickness
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const start = centerline[index]
    const end = centerline[index + 1]
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    const t = lengthSquared <= 1e-9
      ? 0
      : clamp(((x - start.x) * deltaX + (y - start.y) * deltaY) / lengthSquared, 0, 1)
    const nearestX = start.x + deltaX * t
    const nearestY = start.y + deltaY * t
    const distance = Math.hypot(x - nearestX, y - nearestY)
    if (distance < winnerDistance) {
      winnerDistance = distance
      winnerHalfThickness = start.halfThickness + (end.halfThickness - start.halfThickness) * t
    }
  }
  return {
    distance: winnerDistance,
    halfThickness: winnerHalfThickness,
  }
}

export function buildHitGridIndex(layouts: NoteLayout[], cellSize = HIT_INDEX_CELL_SIZE): HitGridIndex {
  const safeCellSize = Math.max(16, Math.floor(cellSize))
  const cells = new Map<string, HitGridCandidate[]>()
  layouts.forEach((layout) => {
    const pushCandidate = (
      candidate: HitGridCandidate,
      bounds: { minX: number; maxX: number; minY: number; maxY: number },
      tolerancePx: number,
    ) => {
      const minCellX = Math.floor((bounds.minX - tolerancePx) / safeCellSize)
      const maxCellX = Math.floor((bounds.maxX + tolerancePx) / safeCellSize)
      const minCellY = Math.floor((bounds.minY - tolerancePx) / safeCellSize)
      const maxCellY = Math.floor((bounds.maxY + tolerancePx) / safeCellSize)
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
          const key = toHitCellKey(cellX, cellY)
          const list = cells.get(key)
          if (list) {
            list.push(candidate)
            continue
          }
          cells.set(key, [candidate])
        }
      }
    }

    layout.noteHeads.forEach((head) => {
      const geometry = resolveHeadHitGeometry(head)
      pushCandidate({ kind: 'noteHead', layout, head }, geometry, HIT_TOLERANCE_PX)
    })

    layout.accidentalLayouts.forEach((accidental) => {
      const geometry = resolveAccidentalHitGeometry(accidental)
      pushCandidate({ kind: 'accidental', layout, accidental }, geometry, HIT_TOLERANCE_PX)
    })

    const allTies = [...(layout.inMeasureTieLayouts ?? []), ...(layout.crossMeasureTieLayouts ?? [])]
    allTies.forEach((tie) => {
      const profile = getTieCurveProfile(tie)
      pushCandidate(
        { kind: 'tie', layout, tie },
        {
          minX: profile.minX,
          maxX: profile.maxX,
          minY: profile.minY,
          maxY: profile.maxY,
        },
        TIE_CURVE_TOLERANCE_PX,
      )
    })
  })
  return { cellSize: safeCellSize, cells }
}

export function getHitTarget(
  x: number,
  y: number,
  layouts: NoteLayout[],
  radius = 24,
  hitIndex: HitGridIndex | null = null,
): HitTarget | null {
  if (layouts.length === 0) return null

  const candidates: HitGridCandidate[] = []
  if (hitIndex && hitIndex.cells.size > 0) {
    const querySpan = Math.max(1, Math.ceil(Math.max(0, radius) / hitIndex.cellSize))
    const baseCellX = Math.floor(x / hitIndex.cellSize)
    const baseCellY = Math.floor(y / hitIndex.cellSize)
    const minCellX = baseCellX - querySpan
    const maxCellX = baseCellX + querySpan
    const minCellY = baseCellY - querySpan
    const maxCellY = baseCellY + querySpan
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const list = hitIndex.cells.get(toHitCellKey(cellX, cellY))
        if (!list) continue
        candidates.push(...list)
      }
    }
  }

  let winnerAccidentalLayout: NoteLayout | null = null
  let winnerAccidental: AccidentalLayout | null = null
  let winnerAccidentalNormalizedDistance = Number.POSITIVE_INFINITY
  let winnerTieLayout: NoteLayout | null = null
  let winnerTie: TieLayout | null = null
  let winnerTieScore = Number.POSITIVE_INFINITY
  let winnerNoteLayout: NoteLayout | null = null
  let winnerNoteHead: NoteHeadLayout | null = null
  let winnerNoteNormalizedDistance = Number.POSITIVE_INFINITY

  const scanCandidate = (candidate: HitGridCandidate) => {
    if (candidate.kind === 'accidental') {
      const geometry = resolveAccidentalHitGeometry(candidate.accidental as AccidentalLayout)
      const expandedRadiusX = geometry.radiusX + HIT_TOLERANCE_PX
      const expandedRadiusY = geometry.radiusY + HIT_TOLERANCE_PX
      if (
        x < geometry.centerX - expandedRadiusX ||
        x > geometry.centerX + expandedRadiusX ||
        y < geometry.centerY - expandedRadiusY ||
        y > geometry.centerY + expandedRadiusY
      ) {
        return
      }
      const normalizedX = (x - geometry.centerX) / expandedRadiusX
      const normalizedY = (y - geometry.centerY) / expandedRadiusY
      const normalizedDistance = normalizedX * normalizedX + normalizedY * normalizedY
      if (normalizedDistance > 1) return
      if (normalizedDistance < winnerAccidentalNormalizedDistance) {
        winnerAccidentalLayout = candidate.layout
        winnerAccidental = candidate.accidental ?? null
        winnerAccidentalNormalizedDistance = normalizedDistance
      }
      return
    }

    if (candidate.kind === 'tie') {
      const tie = candidate.tie as TieLayout
      const profile = getTieCurveProfile(tie)
      if (
        x < profile.minX - TIE_CURVE_TOLERANCE_PX ||
        x > profile.maxX + TIE_CURVE_TOLERANCE_PX ||
        y < profile.minY - TIE_CURVE_TOLERANCE_PX ||
        y > profile.maxY + TIE_CURVE_TOLERANCE_PX
      ) {
        return
      }
      const isInsidePolygon = isPointInPolygon(x, y, profile.polygon)
      let edgeDistance = 0
      if (!isInsidePolygon) {
        edgeDistance = getPointToPolygonBoundaryDistance(x, y, profile.polygon)
        if (edgeDistance > TIE_CURVE_TOLERANCE_PX) return
      }
      const centerlineDistance = getPointToCenterlineDistance({
        x,
        y,
        centerline: profile.centerline,
      })
      const allowedDistance = Math.max(1, centerlineDistance.halfThickness + TIE_CURVE_TOLERANCE_PX)
      const tieScore = isInsidePolygon
        ? (centerlineDistance.distance / allowedDistance) ** 2
        : 1 + (edgeDistance / TIE_CURVE_TOLERANCE_PX) ** 2
      if (tieScore < winnerTieScore) {
        winnerTieLayout = candidate.layout
        winnerTie = tie
        winnerTieScore = tieScore
      }
      return
    }

    const geometry = resolveHeadHitGeometry(candidate.head as NoteHeadLayout)
    const expandedRadiusX = geometry.radiusX + HIT_TOLERANCE_PX
    const expandedRadiusY = geometry.radiusY + HIT_TOLERANCE_PX
    if (
      x < geometry.centerX - expandedRadiusX ||
      x > geometry.centerX + expandedRadiusX ||
      y < geometry.centerY - expandedRadiusY ||
      y > geometry.centerY + expandedRadiusY
    ) {
      return
    }
    const normalizedX = (x - geometry.centerX) / expandedRadiusX
    const normalizedY = (y - geometry.centerY) / expandedRadiusY
    const normalizedDistance = normalizedX * normalizedX + normalizedY * normalizedY
    if (normalizedDistance > 1) return

    if (normalizedDistance < winnerNoteNormalizedDistance) {
      winnerNoteLayout = candidate.layout
      winnerNoteHead = candidate.head ?? null
      winnerNoteNormalizedDistance = normalizedDistance
    }
  }

  if (candidates.length > 0) {
    for (const candidate of candidates) {
      scanCandidate(candidate)
      if (winnerAccidentalNormalizedDistance === 0) break
      if (winnerTieScore === 0 && winnerNoteNormalizedDistance === 0) break
    }
  } else {
    for (const layout of layouts) {
      for (const head of layout.noteHeads) {
        scanCandidate({ kind: 'noteHead', layout, head })
        if (winnerNoteNormalizedDistance === 0) break
      }
      for (const accidental of layout.accidentalLayouts) {
        scanCandidate({ kind: 'accidental', layout, accidental })
        if (winnerAccidentalNormalizedDistance === 0) break
      }
      const allTies = [...(layout.inMeasureTieLayouts ?? []), ...(layout.crossMeasureTieLayouts ?? [])]
      for (const tie of allTies) {
        scanCandidate({ kind: 'tie', layout, tie })
        if (winnerTieScore === 0) break
      }
      if (winnerAccidentalNormalizedDistance === 0) break
    }
  }

  if (winnerAccidentalLayout && winnerAccidental) {
    return {
      kind: 'accidental',
      layout: winnerAccidentalLayout,
      accidental: winnerAccidental,
    }
  }
  if (winnerTieLayout && winnerTie && winnerNoteLayout && winnerNoteHead) {
    if (winnerTieScore < winnerNoteNormalizedDistance) {
      return {
        kind: 'tie',
        layout: winnerTieLayout,
        tie: winnerTie,
      }
    }
    return {
      kind: 'noteHead',
      layout: winnerNoteLayout,
      head: winnerNoteHead,
    }
  }
  if (winnerTieLayout && winnerTie) {
    return {
      kind: 'tie',
      layout: winnerTieLayout,
      tie: winnerTie,
    }
  }
  if (winnerNoteLayout && winnerNoteHead) {
    return {
      kind: 'noteHead',
      layout: winnerNoteLayout,
      head: winnerNoteHead,
    }
  }
  return null
}

export function getHitNote(
  x: number,
  y: number,
  layouts: NoteLayout[],
  radius = 24,
  hitIndex: HitGridIndex | null = null,
): HitNote | null {
  const target = getHitTarget(x, y, layouts, radius, hitIndex)
  if (!target || target.kind !== 'noteHead') return null
  return { layout: target.layout, head: target.head }
}
