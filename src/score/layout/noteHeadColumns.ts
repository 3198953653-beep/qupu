import { Stem, type StaveNote } from 'vexflow'

const DEFAULT_NOTE_HEAD_WIDTH_PX = 9
const MAX_RENDERED_NOTE_HEAD_WIDTH_PX = DEFAULT_NOTE_HEAD_WIDTH_PX * 2.5
const MAX_NOTE_HEAD_COLUMN_OFFSET_PX = DEFAULT_NOTE_HEAD_WIDTH_PX * 5
const NOTE_HEAD_COLUMN_COMPARE_EPSILON_PX = 0.01
const NOTEHEAD_BOUNDS_MIN_WIDTH_PX = 4
const NOTEHEAD_BOUNDS_MAX_WIDTH_PX = 10
const NOTEHEAD_BBOX_TO_ABSOLUTE_TOLERANCE_PX = 4
const NOTEHEAD_DISPLACED_ABSOLUTE_TO_LEFT_OFFSET_PX = 1

export type RenderedNoteHeadBBoxLike = {
  getX?: () => number
  getW?: () => number
}

export type RenderedNoteHeadLike = {
  getAbsoluteX?: () => number
  getBoundingBox?: () => RenderedNoteHeadBBoxLike | null
  getWidth?: () => number
  isDisplaced?: () => boolean
  preFormatted?: boolean
}

export type RenderedNoteHeadColumnMetrics = {
  resolvedAnchorX: number
  hasMultipleColumns: boolean
  leftColumnReservePx: number
  rightColumnReservePx: number
  minHeadX: number
  maxHeadX: number
}

export type RenderedNoteHeadBounds = {
  leftX: number
  rightX: number
  width: number
  usedFallback: boolean
}

function getRenderedNoteHeadBoundsWidth(noteHead: RenderedNoteHeadLike | null | undefined): number {
  const rawWidth = noteHead?.getWidth?.()
  if (typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0) {
    return Math.min(NOTEHEAD_BOUNDS_MAX_WIDTH_PX, Math.max(NOTEHEAD_BOUNDS_MIN_WIDTH_PX, rawWidth))
  }
  return Math.min(
    NOTEHEAD_BOUNDS_MAX_WIDTH_PX,
    Math.max(NOTEHEAD_BOUNDS_MIN_WIDTH_PX, getRenderedNoteHeadWidth(noteHead)),
  )
}

export function getRenderedNoteHeadWidth(noteHead: RenderedNoteHeadLike | null | undefined): number {
  const bboxWidth = noteHead?.getBoundingBox?.()?.getW?.()
  if (typeof bboxWidth === 'number' && Number.isFinite(bboxWidth) && bboxWidth > 0) {
    return Math.min(MAX_RENDERED_NOTE_HEAD_WIDTH_PX, bboxWidth)
  }
  const rawWidth = noteHead?.getWidth?.()
  if (typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0) {
    return Math.min(MAX_RENDERED_NOTE_HEAD_WIDTH_PX, rawWidth)
  }
  return DEFAULT_NOTE_HEAD_WIDTH_PX
}

export function getRenderedNoteHeadAbsoluteX(params: {
  noteHead: RenderedNoteHeadLike | null | undefined
  anchorX: number
  stemDirection: number
}): number | null {
  const { noteHead, anchorX, stemDirection } = params
  const isDisplaced = noteHead?.isDisplaced?.() === true
  const absoluteX = noteHead?.getAbsoluteX?.()
  if (
    typeof absoluteX === 'number' &&
    Number.isFinite(absoluteX) &&
    Math.abs(absoluteX - anchorX) <= MAX_NOTE_HEAD_COLUMN_OFFSET_PX
  ) {
    return absoluteX
  }
  const bboxX = noteHead?.getBoundingBox?.()?.getX?.()
  if (
    typeof bboxX === 'number' &&
    Number.isFinite(bboxX) &&
    Math.abs(bboxX - anchorX) <= MAX_NOTE_HEAD_COLUMN_OFFSET_PX
  ) {
    return bboxX
  }
  if (!isDisplaced) {
    return anchorX
  }

  const isPreFormatted = noteHead?.preFormatted === true
  const headWidth = getRenderedNoteHeadWidth(noteHead)
  const displacementPx = isDisplaced ? (headWidth - Stem.WIDTH / 2) * stemDirection : 0
  const displacementMultiplier = isPreFormatted ? 1 : 2
  return anchorX + displacementPx * displacementMultiplier
}

export function getRenderedNoteHeadBoundsExact(params: {
  noteHead: RenderedNoteHeadLike | null | undefined
  anchorX: number
  stemDirection: number
}): RenderedNoteHeadBounds | null {
  const { noteHead, anchorX, stemDirection } = params
  if (!noteHead || !Number.isFinite(anchorX)) return null

  const resolvedHeadLeftX = getRenderedNoteHeadAbsoluteX({
    noteHead,
    anchorX,
    stemDirection,
  })
  const resolvedWidth = getRenderedNoteHeadBoundsWidth(noteHead)

  const bbox = noteHead.getBoundingBox?.() ?? null
  const bboxLeftX = bbox?.getX?.()
  const bboxWidthRaw = bbox?.getW?.()
  const bboxWidth =
    typeof bboxWidthRaw === 'number' && Number.isFinite(bboxWidthRaw)
      ? Math.min(NOTEHEAD_BOUNDS_MAX_WIDTH_PX, Math.max(NOTEHEAD_BOUNDS_MIN_WIDTH_PX, bboxWidthRaw))
      : null
  const bboxLooksSane =
    typeof bboxLeftX === 'number' &&
    Number.isFinite(bboxLeftX) &&
    typeof bboxWidth === 'number' &&
    Number.isFinite(bboxWidth) &&
    bboxWidth > 0 &&
    Math.abs(bboxLeftX - anchorX) <= MAX_NOTE_HEAD_COLUMN_OFFSET_PX + MAX_RENDERED_NOTE_HEAD_WIDTH_PX
  const bboxMatchesResolvedHead =
    bboxLooksSane &&
    typeof resolvedHeadLeftX === 'number' &&
    Number.isFinite(resolvedHeadLeftX) &&
    Math.abs(bboxLeftX - resolvedHeadLeftX) <= NOTEHEAD_BBOX_TO_ABSOLUTE_TOLERANCE_PX
  if (bboxMatchesResolvedHead) {
    return {
      leftX: bboxLeftX,
      rightX: bboxLeftX + bboxWidth,
      width: bboxWidth,
      usedFallback: false,
    }
  }

  if (typeof resolvedHeadLeftX !== 'number' || !Number.isFinite(resolvedHeadLeftX)) {
    if (!bboxLooksSane) return null
    return {
      leftX: bboxLeftX,
      rightX: bboxLeftX + bboxWidth,
      width: bboxWidth,
      usedFallback: true,
    }
  }

  const rawAbsoluteX = noteHead.getAbsoluteX?.()
  const hasReadyAbsoluteX =
    typeof rawAbsoluteX === 'number' && Number.isFinite(rawAbsoluteX) && Math.abs(rawAbsoluteX) > 0.0001
  const absoluteDeltaFromBase = resolvedHeadLeftX - anchorX
  const shouldApplyDisplacedFallback =
    Math.abs(absoluteDeltaFromBase) >= resolvedWidth + NOTEHEAD_DISPLACED_ABSOLUTE_TO_LEFT_OFFSET_PX
  const adjustedDisplacedLeftX =
    shouldApplyDisplacedFallback
      ? resolvedHeadLeftX + (anchorX - resolvedHeadLeftX) / 2
      : null
  const leftX =
    typeof adjustedDisplacedLeftX === 'number' &&
    Number.isFinite(adjustedDisplacedLeftX) &&
    Math.abs(adjustedDisplacedLeftX - anchorX) <=
      MAX_NOTE_HEAD_COLUMN_OFFSET_PX + NOTEHEAD_BOUNDS_MAX_WIDTH_PX
      ? adjustedDisplacedLeftX
      : resolvedHeadLeftX
  const usedFallback = !hasReadyAbsoluteX || leftX !== resolvedHeadLeftX

  return {
    leftX,
    rightX: leftX + resolvedWidth,
    width: resolvedWidth,
    usedFallback,
  }
}

export function getRenderedNoteHeadColumnMetrics(
  vexNote: StaveNote,
  anchorX: number,
): RenderedNoteHeadColumnMetrics {
  const noteHeads = (vexNote.noteHeads ?? []) as RenderedNoteHeadLike[]
  const stemDirection = vexNote.getStemDirection()
  if (noteHeads.length === 0) {
    return {
      resolvedAnchorX: anchorX,
      hasMultipleColumns: false,
      leftColumnReservePx: 0,
      rightColumnReservePx: 0,
      minHeadX: anchorX,
      maxHeadX: anchorX,
    }
  }

  const acceptedHeads: Array<{ x: number; isDisplaced: boolean }> = []

  noteHeads.forEach((noteHead) => {
    const headX = getRenderedNoteHeadAbsoluteX({
      noteHead,
      anchorX,
      stemDirection,
    })
    if (typeof headX !== 'number' || !Number.isFinite(headX)) return
    if (Math.abs(headX - anchorX) > MAX_NOTE_HEAD_COLUMN_OFFSET_PX) return
    acceptedHeads.push({
      x: headX,
      isDisplaced: noteHead?.isDisplaced?.() === true,
    })
  })

  if (acceptedHeads.length === 0) {
    return {
      resolvedAnchorX: anchorX,
      hasMultipleColumns: false,
      leftColumnReservePx: 0,
      rightColumnReservePx: 0,
      minHeadX: anchorX,
      maxHeadX: anchorX,
    }
  }

  const columnBuckets = acceptedHeads.reduce<
    Array<{
      x: number
      totalCount: number
      nonDisplacedCount: number
    }>
  >((buckets, head) => {
    const existingBucket = buckets.find((entry) => Math.abs(entry.x - head.x) <= NOTE_HEAD_COLUMN_COMPARE_EPSILON_PX)
    if (existingBucket) {
      existingBucket.totalCount += 1
      if (!head.isDisplaced) {
        existingBucket.nonDisplacedCount += 1
      }
      return buckets
    }
    return [
      ...buckets,
      {
        x: head.x,
        totalCount: 1,
        nonDisplacedCount: head.isDisplaced ? 0 : 1,
      },
    ]
  }, [])
  columnBuckets.sort((left, right) => left.x - right.x)

  const primaryColumn =
    columnBuckets.slice().sort((left, right) => {
      if (right.totalCount !== left.totalCount) {
        return right.totalCount - left.totalCount
      }
      if (right.nonDisplacedCount !== left.nonDisplacedCount) {
        return right.nonDisplacedCount - left.nonDisplacedCount
      }
      const leftDistance = Math.abs(left.x - anchorX)
      const rightDistance = Math.abs(right.x - anchorX)
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance
      }
      return left.x - right.x
    })[0] ?? null

  const resolvedAnchorX = primaryColumn?.x ?? anchorX
  const minHeadX = acceptedHeads.reduce((minValue, head) => Math.min(minValue, head.x), Number.POSITIVE_INFINITY)
  const maxHeadX = acceptedHeads.reduce((maxValue, head) => Math.max(maxValue, head.x), Number.NEGATIVE_INFINITY)
  const hasMultipleColumns = columnBuckets.length > 1
  return {
    resolvedAnchorX,
    hasMultipleColumns,
    leftColumnReservePx: hasMultipleColumns ? Math.max(0, resolvedAnchorX - minHeadX) : 0,
    rightColumnReservePx: hasMultipleColumns ? Math.max(0, maxHeadX - resolvedAnchorX) : 0,
    minHeadX,
    maxHeadX,
  }
}
