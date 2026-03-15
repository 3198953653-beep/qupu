import type { NoteHeadLayout, NoteLayout } from '../types'

export type HitNote = {
  layout: NoteLayout
  head: NoteHeadLayout
}

type HitGridCandidate = {
  layout: NoteLayout
  head: NoteHeadLayout
}

export type HitGridIndex = {
  cellSize: number
  cells: Map<string, HitGridCandidate[]>
}

const HIT_INDEX_CELL_SIZE = 40
const DEFAULT_HIT_RADIUS_X = 5.5
const DEFAULT_HIT_RADIUS_Y = 4.2
const HIT_TOLERANCE_PX = 2

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

export function buildHitGridIndex(layouts: NoteLayout[], cellSize = HIT_INDEX_CELL_SIZE): HitGridIndex {
  const safeCellSize = Math.max(16, Math.floor(cellSize))
  const cells = new Map<string, HitGridCandidate[]>()
  layouts.forEach((layout) => {
    layout.noteHeads.forEach((head) => {
      const geometry = resolveHeadHitGeometry(head)
      const minCellX = Math.floor((geometry.minX - HIT_TOLERANCE_PX) / safeCellSize)
      const maxCellX = Math.floor((geometry.maxX + HIT_TOLERANCE_PX) / safeCellSize)
      const minCellY = Math.floor((geometry.minY - HIT_TOLERANCE_PX) / safeCellSize)
      const maxCellY = Math.floor((geometry.maxY + HIT_TOLERANCE_PX) / safeCellSize)
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
          const key = toHitCellKey(cellX, cellY)
          const list = cells.get(key)
          if (list) {
            list.push({ layout, head })
            continue
          }
          cells.set(key, [{ layout, head }])
        }
      }
    })
  })
  return { cellSize: safeCellSize, cells }
}

export function getHitNote(
  x: number,
  y: number,
  layouts: NoteLayout[],
  radius = 24,
  hitIndex: HitGridIndex | null = null,
): HitNote | null {
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

  let winnerLayout: NoteLayout | null = null
  let winnerHead: NoteHeadLayout | null = null
  let winnerNormalizedDistance = Number.POSITIVE_INFINITY

  const scanCandidate = (layout: NoteLayout, head: NoteHeadLayout) => {
    const geometry = resolveHeadHitGeometry(head)
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
    if (normalizedDistance < winnerNormalizedDistance) {
      winnerLayout = layout
      winnerHead = head
      winnerNormalizedDistance = normalizedDistance
    }
  }

  if (candidates.length > 0) {
    for (const candidate of candidates) {
      scanCandidate(candidate.layout, candidate.head)
      if (winnerNormalizedDistance === 0) break
    }
  } else {
    for (const layout of layouts) {
      for (const head of layout.noteHeads) {
        scanCandidate(layout, head)
        if (winnerNormalizedDistance === 0) break
      }
      if (winnerNormalizedDistance === 0) break
    }
  }

  if (!winnerLayout || !winnerHead) return null
  return { layout: winnerLayout, head: winnerHead }
}
