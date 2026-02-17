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

function toHitCellKey(cellX: number, cellY: number): string {
  return `${cellX}|${cellY}`
}

export function buildHitGridIndex(layouts: NoteLayout[], cellSize = HIT_INDEX_CELL_SIZE): HitGridIndex {
  const safeCellSize = Math.max(16, Math.floor(cellSize))
  const cells = new Map<string, HitGridCandidate[]>()
  layouts.forEach((layout) => {
    layout.noteHeads.forEach((head) => {
      const cellX = Math.floor(head.x / safeCellSize)
      const cellY = Math.floor(head.y / safeCellSize)
      const key = toHitCellKey(cellX, cellY)
      const list = cells.get(key)
      if (list) {
        list.push({ layout, head })
        return
      }
      cells.set(key, [{ layout, head }])
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
    const minCellX = Math.floor((x - radius) / hitIndex.cellSize)
    const maxCellX = Math.floor((x + radius) / hitIndex.cellSize)
    const minCellY = Math.floor((y - radius) / hitIndex.cellSize)
    const maxCellY = Math.floor((y + radius) / hitIndex.cellSize)
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
  const radiusSq = radius * radius
  let winnerDistanceSq = Number.POSITIVE_INFINITY

  const scanCandidate = (layout: NoteLayout, head: NoteHeadLayout) => {
    const dx = head.x - x
    if (dx < -radius || dx > radius) return
    const dy = head.y - y
    if (dy < -radius || dy > radius) return

    const distanceSq = dx * dx + dy * dy
    if (distanceSq < winnerDistanceSq) {
      winnerLayout = layout
      winnerHead = head
      winnerDistanceSq = distanceSq
    }
  }

  if (candidates.length > 0) {
    for (const candidate of candidates) {
      scanCandidate(candidate.layout, candidate.head)
      if (winnerDistanceSq === 0) break
    }
  } else {
    for (const layout of layouts) {
      for (const head of layout.noteHeads) {
        scanCandidate(layout, head)
        if (winnerDistanceSq === 0) break
      }
      if (winnerDistanceSq === 0) break
    }
  }

  if (!winnerLayout || !winnerHead || winnerDistanceSq > radiusSq) return null
  return { layout: winnerLayout, head: winnerHead }
}
