import type { AccidentalLayout, NoteHeadLayout, NoteLayout } from '../types'

export type HitNote = {
  layout: NoteLayout
  head: NoteHeadLayout
}

export type HitAccidental = {
  layout: NoteLayout
  accidental: AccidentalLayout
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

type HitGridCandidate = {
  kind: 'noteHead' | 'accidental'
  layout: NoteLayout
  head?: NoteHeadLayout
  accidental?: AccidentalLayout
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

export function buildHitGridIndex(layouts: NoteLayout[], cellSize = HIT_INDEX_CELL_SIZE): HitGridIndex {
  const safeCellSize = Math.max(16, Math.floor(cellSize))
  const cells = new Map<string, HitGridCandidate[]>()
  layouts.forEach((layout) => {
    const pushCandidate = (candidate: HitGridCandidate, geometry: ResolvedHitGeometry) => {
      const minCellX = Math.floor((geometry.minX - HIT_TOLERANCE_PX) / safeCellSize)
      const maxCellX = Math.floor((geometry.maxX + HIT_TOLERANCE_PX) / safeCellSize)
      const minCellY = Math.floor((geometry.minY - HIT_TOLERANCE_PX) / safeCellSize)
      const maxCellY = Math.floor((geometry.maxY + HIT_TOLERANCE_PX) / safeCellSize)
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
      pushCandidate({ kind: 'noteHead', layout, head }, geometry)
    })

    layout.accidentalLayouts.forEach((accidental) => {
      const geometry = resolveAccidentalHitGeometry(accidental)
      pushCandidate({ kind: 'accidental', layout, accidental }, geometry)
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
  let winnerNoteLayout: NoteLayout | null = null
  let winnerNoteHead: NoteHeadLayout | null = null
  let winnerNoteNormalizedDistance = Number.POSITIVE_INFINITY

  const scanCandidate = (candidate: HitGridCandidate) => {
    const geometry =
      candidate.kind === 'accidental'
        ? resolveAccidentalHitGeometry(candidate.accidental as AccidentalLayout)
        : resolveHeadHitGeometry(candidate.head as NoteHeadLayout)
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

    if (candidate.kind === 'accidental') {
      if (normalizedDistance < winnerAccidentalNormalizedDistance) {
        winnerAccidentalLayout = candidate.layout
        winnerAccidental = candidate.accidental ?? null
        winnerAccidentalNormalizedDistance = normalizedDistance
      }
      return
    }

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
      if (winnerAccidental && winnerNoteNormalizedDistance === 0) break
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
