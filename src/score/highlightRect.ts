import type { MeasureLayout, NoteLayout, StaffKind } from './types'

export type HighlightRectPx = {
  x: number
  y: number
  width: number
  height: number
}

type MeasureFrameLike = {
  measureX: number
  measureWidth: number
}

export function resolveStaffLineBounds(measureLayout: MeasureLayout, staff: StaffKind) {
  const lineTopRaw =
    staff === 'treble'
      ? (Number.isFinite(measureLayout.trebleLineTopY) ? measureLayout.trebleLineTopY : measureLayout.trebleY)
      : (Number.isFinite(measureLayout.bassLineTopY) ? measureLayout.bassLineTopY : measureLayout.bassY)
  const lineBottomRaw =
    staff === 'treble'
      ? (Number.isFinite(measureLayout.trebleLineBottomY)
          ? measureLayout.trebleLineBottomY
          : measureLayout.trebleY + 40)
      : (Number.isFinite(measureLayout.bassLineBottomY)
          ? measureLayout.bassLineBottomY
          : measureLayout.bassY + 40)
  return {
    lineTop: Math.min(lineTopRaw, lineBottomRaw),
    lineBottom: Math.max(lineTopRaw, lineBottomRaw),
  }
}

export function resolveCombinedStaffLineBounds(measureLayout: MeasureLayout) {
  const trebleBounds = resolveStaffLineBounds(measureLayout, 'treble')
  const bassBounds = resolveStaffLineBounds(measureLayout, 'bass')
  return {
    lineTop: Math.min(trebleBounds.lineTop, bassBounds.lineTop),
    lineBottom: Math.max(trebleBounds.lineBottom, bassBounds.lineBottom),
  }
}

function collectSelectedNoteLayoutLeftCandidates(layout: NoteLayout): number[] {
  const candidates: number[] = []
  layout.accidentalLayouts.forEach((accidental) => {
    if (Number.isFinite(accidental.visualLeftXExact)) {
      candidates.push(accidental.visualLeftXExact as number)
      return
    }
    if (Number.isFinite(accidental.hitMinX)) {
      candidates.push(accidental.hitMinX as number)
      return
    }
    if (Number.isFinite(accidental.x) && Number.isFinite(accidental.hitRadiusX)) {
      candidates.push(accidental.x - (accidental.hitRadiusX as number))
      return
    }
    if (Number.isFinite(accidental.x)) {
      candidates.push(accidental.x - 4)
    }
  })
  if (Number.isFinite(layout.visualLeftX)) candidates.push(layout.visualLeftX)
  layout.noteHeads.forEach((head) => {
    if (Number.isFinite(head.hitMinX)) {
      candidates.push(head.hitMinX as number)
      return
    }
    if (Number.isFinite(head.x)) {
      candidates.push(head.x)
    }
  })
  if (candidates.length === 0 && Number.isFinite(layout.x)) {
    candidates.push(layout.x)
  }
  return candidates
}

function collectSelectedNoteLayoutRightCandidates(layout: NoteLayout): number[] {
  const candidates: number[] = []
  // Tight selection frames should track the selected note's own glyph edge,
  // not beam-expanded or spacing-expanded layout bounds.
  if (Number.isFinite(layout.visualRightX)) candidates.push(layout.visualRightX)
  layout.noteHeads.forEach((head) => {
    if (Number.isFinite(head.hitMaxX)) {
      candidates.push(head.hitMaxX as number)
      return
    }
    if (Number.isFinite(head.x)) {
      candidates.push(head.x + 9)
    }
  })
  if (candidates.length === 0 && Number.isFinite(layout.x)) {
    candidates.push(layout.x + 9)
  }
  return candidates
}

function resolveNoteLayoutHorizontalBounds(layout: NoteLayout): { leftXRaw: number; rightXRaw: number } | null {
  const leftCandidates = collectSelectedNoteLayoutLeftCandidates(layout)
  const rightCandidates = collectSelectedNoteLayoutRightCandidates(layout)
  const leftXRaw = leftCandidates.length > 0 ? Math.min(...leftCandidates) : Number.POSITIVE_INFINITY
  const rightXRaw = rightCandidates.length > 0 ? Math.max(...rightCandidates) : Number.NEGATIVE_INFINITY
  if (!Number.isFinite(leftXRaw) || !Number.isFinite(rightXRaw) || rightXRaw <= leftXRaw) {
    return null
  }
  return {
    leftXRaw,
    rightXRaw,
  }
}

export function buildSelectedNoteLayoutsHighlightRect(params: {
  selectedNoteLayouts: NoteLayout[]
  measureLayoutsByPair: Map<number, MeasureLayout>
  scaleX?: number
  scaleY?: number
  offsetX?: number
  offsetY?: number
  padX?: number
  padY?: number
}): HighlightRectPx | null {
  const {
    selectedNoteLayouts,
    measureLayoutsByPair,
    scaleX = 1,
    scaleY = 1,
    offsetX = 0,
    offsetY = 0,
    padX = 6,
    padY = 4,
  } = params

  if (selectedNoteLayouts.length === 0) return null

  let minLeftX = Number.POSITIVE_INFINITY
  let maxRightX = Number.NEGATIVE_INFINITY
  let minLineTop = Number.POSITIVE_INFINITY
  let maxLineBottom = Number.NEGATIVE_INFINITY
  const selectedStaffs = new Set<StaffKind>()
  const selectedPairIndexes = new Set<number>()

  selectedNoteLayouts.forEach((layout) => {
    const horizontalBounds = resolveNoteLayoutHorizontalBounds(layout)
    if (!horizontalBounds) return
    minLeftX = Math.min(minLeftX, horizontalBounds.leftXRaw)
    maxRightX = Math.max(maxRightX, horizontalBounds.rightXRaw)
    selectedStaffs.add(layout.staff)
    selectedPairIndexes.add(layout.pairIndex)
  })

  if (!Number.isFinite(minLeftX) || !Number.isFinite(maxRightX) || maxRightX <= minLeftX) {
    return null
  }
  if (selectedPairIndexes.size === 0 || selectedStaffs.size === 0) return null

  const useCombinedStaffBounds = selectedStaffs.size > 1
  const singleStaff = useCombinedStaffBounds ? null : (selectedStaffs.values().next().value ?? null)

  selectedPairIndexes.forEach((pairIndex) => {
    const measureLayout = measureLayoutsByPair.get(pairIndex) ?? null
    if (!measureLayout) return
    const { lineTop, lineBottom } = useCombinedStaffBounds
      ? resolveCombinedStaffLineBounds(measureLayout)
      : resolveStaffLineBounds(measureLayout, singleStaff ?? 'treble')
    minLineTop = Math.min(minLineTop, lineTop)
    maxLineBottom = Math.max(maxLineBottom, lineBottom)
  })

  if (!Number.isFinite(minLineTop) || !Number.isFinite(maxLineBottom) || maxLineBottom <= minLineTop) {
    return null
  }

  const x = offsetX + minLeftX * scaleX
  const y = offsetY + minLineTop * scaleY
  const width = (maxRightX - minLeftX) * scaleX
  const height = (maxLineBottom - minLineTop) * scaleY

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }
  if (width <= 0 || height <= 0) return null

  return {
    x: x - padX,
    y: y - padY,
    width: width + padX * 2,
    height: height + padY * 2,
  }
}

export function buildMeasureSurfaceHighlightRect(params: {
  measureLayout: MeasureLayout
  frame?: MeasureFrameLike | null
  staff?: StaffKind | null
  useCombinedStaffBounds?: boolean
  scaleX?: number
  scaleY?: number
  offsetX?: number
  offsetY?: number
  padX?: number
  padY?: number
  preferFrameX?: boolean
  preferFrameWidth?: boolean
}): HighlightRectPx | null {
  const {
    measureLayout,
    frame = null,
    staff = null,
    useCombinedStaffBounds = false,
    scaleX = 1,
    scaleY = 1,
    offsetX = 0,
    offsetY = 0,
    padX = 6,
    padY = 4,
    preferFrameX = frame !== null,
    preferFrameWidth = frame !== null,
  } = params

  const { lineTop, lineBottom } = useCombinedStaffBounds
    ? resolveCombinedStaffLineBounds(measureLayout)
    : resolveStaffLineBounds(measureLayout, staff ?? 'treble')

  const measureXRaw = preferFrameX && frame ? frame.measureX : measureLayout.measureX
  const measureWidthRaw = preferFrameWidth && frame ? frame.measureWidth : measureLayout.measureWidth
  const x = offsetX + measureXRaw * scaleX
  const y = offsetY + lineTop * scaleY
  const width = measureWidthRaw * scaleX
  const height = (lineBottom - lineTop) * scaleY

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }
  if (width <= 0 || height <= 0) return null

  return {
    x: x - padX,
    y: y - padY,
    width: width + padX * 2,
    height: height + padY * 2,
  }
}
