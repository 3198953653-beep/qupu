import type { Selection } from '../types'

export type ChordRulerMarker = {
  key: string
  xPx: number
  sourceLabel: string
  displayLabel: string
  isActive: boolean
  pairIndex: number
  positionText: string
  beatIndex?: number | null
}

export type TimelineSegmentBlock = {
  key: string
  scopeKey: string
  segmentNumber: number
  startPairIndex: number
  endPairIndexInclusive: number
  leftPx: number
  widthPx: number
  variant: 'odd' | 'even'
  measureStartNumber: number
  measureEndNumber: number
  isActive: boolean
}

export type ChordRulerMarkerAnchorSource = 'note-head' | 'spacing-tick' | 'axis' | 'frame'

export type ChordRulerMarkerGeometry = {
  key: string
  pairIndex: number
  sourceLabel: string
  startTick: number
  endTick: number
  positionText: string
  beatIndex?: number | null
  anchorSource: ChordRulerMarkerAnchorSource
  anchorGlobalX: number
  keyFifths: number
  keyMode: 'major' | 'minor'
}

export type ChordRulerMarkerMeta = {
  key: string
  pairIndex: number
  sourceLabel: string
  displayLabel: string
  startTick: number
  endTick: number
  positionText: string
  beatIndex?: number | null
  anchorGlobalX: number
  anchorXPx: number
  xPx: number
  anchorSource: ChordRulerMarkerAnchorSource
  keyFifths: number
  keyMode: 'major' | 'minor'
}

export type ActiveChordSelection = {
  markerKey: string | null
  pairIndex: number
  startTick: number
  endTick: number
}

export type ActiveTimelineSegmentHighlight = {
  key: string
  startPairIndex: number
  endPairIndexInclusive: number
}

export type MeasureFrameContentGeometry = {
  contentStartX: number
  contentMeasureWidth: number
}

export type MeasureSelectionScope = {
  pairIndex: number
  staff: Selection['staff']
}
