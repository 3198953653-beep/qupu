import type { StaffKind } from '../types'

export type StaffTimelineEvent = {
  noteId: string
  noteIndex: number
  startTick: number
  endTick: number
  durationTicks: number
  isRest: boolean
}

export type StaffTimeline = {
  measureIndex: number
  staff: StaffKind
  measureTicks: number
  events: StaffTimelineEvent[]
  startTicks: number[]
  endTicks: number[]
  firstStartTick: number | null
  lastEndTick: number | null
}

export type PublicTimelinePoint = {
  tick: number
  isMeasureStart: boolean
  isMeasureEnd: boolean
  isBeatBoundary: boolean
  trebleStartsHere: boolean
  bassStartsHere: boolean
  trebleEndsHere: boolean
  bassEndsHere: boolean
}

export type PublicMergedTimeline = {
  measureIndex: number
  measureTicks: number
  points: PublicTimelinePoint[]
}

export type PublicAxisLayout = {
  measureIndex: number
  measureTicks: number
  tickToX: Map<number, number>
  orderedTicks: number[]
  anchorTicks: number[]
  totalAnchorWeight: number
  timelineScale: number
  effectiveBoundaryStartX: number
  effectiveBoundaryEndX: number
  effectiveLeftGapPx: number
  effectiveRightGapPx: number
  widthPx: number
}

export type TimelineDiffSummary = {
  legacyTickCount: number
  mergedTickCount: number
  overlapTickCount: number
  legacyOnlyTicks: number[]
  mergedOnlyTicks: number[]
}

export type MeasureTimelineBundle = {
  measureIndex: number
  measureTicks: number
  legacyOnsets: number[]
  spacingAnchorTicks: number[]
  spacingTickToX: Map<number, number>
  trebleTimeline: StaffTimeline
  bassTimeline: StaffTimeline
  publicTimeline: PublicMergedTimeline
  publicAxisLayout: PublicAxisLayout | null
  timelineDiffSummary: TimelineDiffSummary
  timelineMode: 'legacy' | 'dual' | 'merged'
}
