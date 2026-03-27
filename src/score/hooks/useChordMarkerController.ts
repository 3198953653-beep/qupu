import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { ChordRulerEntry } from '../chordRuler'
import { buildSelectionSetSignature, buildSelectionsForMeasureRange } from '../selectionMeasureRange'
import type { MeasureTimelineBundle } from '../timeline/types'
import type {
  MeasureFrame,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Selection,
  TimeSignature,
  TimelineSegmentOverlayMode,
} from '../types'
import { buildTimelineSegmentBlocks } from './buildTimelineSegmentBlocks'
import {
  buildChordRulerMarkerGeometrySnapshot,
  buildChordRulerMarkerMetaByKey,
  buildMeasureRulerTicks,
} from './chordMarkerGeometry'
export type { ActiveChordSelection, ChordRulerMarker, ChordRulerMarkerMeta, TimelineSegmentBlock } from './chordMarkerTypes'
import type { MeasureFrameContentGeometry, MeasureSelectionScope } from './chordMarkerTypes'
import { useChordMarkerHighlight } from './useChordMarkerHighlight'
import { useChordMarkerSelection } from './useChordMarkerSelection'

export function useChordMarkerController(params: {
  measurePairs: MeasurePair[]
  measurePairsRef: MutableRefObject<MeasurePair[]>
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  horizontalMeasureFramesByPair: MeasureFrame[]
  measureTimeSignaturesFromImport: TimeSignature[] | null
  measureKeyFifthsFromImport: number[] | null
  measureKeyModesFromImport: string[] | null
  horizontalRenderOffsetX: number
  horizontalRenderOffsetXRef: MutableRefObject<number>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  measureTimelineBundlesRef: MutableRefObject<Map<number, MeasureTimelineBundle>>
  scoreScaleX: number
  scoreScaleY: number
  scoreSurfaceOffsetXPx: number
  scoreSurfaceOffsetYPx: number
  selectedMeasureScope: MeasureSelectionScope | null
  activeSelection: Selection
  selectedSelections: Selection[]
  isSelectionVisible: boolean
  timelineSegmentOverlayMode: TimelineSegmentOverlayMode
  showChordDegreeEnabled: boolean
  chordMarkerLabelLeftInsetPx: number
  stageBorderPx: number
  chordHighlightPadXPx: number
  chordHighlightPadYPx: number
  layoutStabilityKey: string
  getMeasureFrameContentGeometry: (frame: MeasureFrame | null | undefined) => MeasureFrameContentGeometry | null
  setIsSelectionVisible: (visible: boolean) => void
  setSelectedSelections: (selections: Selection[]) => void
  setActiveSelection: (selection: Selection) => void
  clearActiveAccidentalSelection: () => void
  clearActiveTieSelection: () => void
  clearSelectedMeasureScope: () => void
  clearDraggingSelection: () => void
  resetMidiStepChain: () => void
}) {
  const {
    measurePairs,
    measurePairsRef,
    chordRulerEntriesByPair,
    horizontalMeasureFramesByPair,
    measureTimeSignaturesFromImport,
    measureKeyFifthsFromImport,
    measureKeyModesFromImport,
    horizontalRenderOffsetX,
    horizontalRenderOffsetXRef,
    noteLayoutsByPairRef,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    selectedMeasureScope,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    timelineSegmentOverlayMode,
    showChordDegreeEnabled,
    chordMarkerLabelLeftInsetPx,
    stageBorderPx,
    chordHighlightPadXPx,
    chordHighlightPadYPx,
    layoutStabilityKey,
    getMeasureFrameContentGeometry,
    setIsSelectionVisible,
    setSelectedSelections,
    setActiveSelection,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    clearDraggingSelection,
    resetMidiStepChain,
  } = params

  const [chordMarkerLayoutRevision, setChordMarkerLayoutRevision] = useState(0)
  const [chordRulerMarkerGeometryByKey, setChordRulerMarkerGeometryByKey] = useState(new Map())
  const chordMarkerLayoutRequestRef = useRef(0)
  const chordMarkerLayoutAppliedRef = useRef(0)

  useLayoutEffect(() => {
    chordMarkerLayoutRequestRef.current += 1
  }, [
    chordRulerEntriesByPair,
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    layoutStabilityKey,
    measurePairs,
    measureTimeSignaturesFromImport,
    scoreScaleX,
  ])

  const buildChordGeometrySnapshot = useCallback(() => buildChordRulerMarkerGeometrySnapshot({
    measurePairs,
    chordRulerEntriesByPair,
    horizontalMeasureFramesByPair,
    measureTimeSignaturesFromImport,
    measureKeyFifthsFromImport,
    measureKeyModesFromImport,
    horizontalRenderOffsetXRef,
    noteLayoutsByPairRef,
    measureTimelineBundlesRef,
    getMeasureFrameContentGeometry,
  }), [
    chordRulerEntriesByPair,
    getMeasureFrameContentGeometry,
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetXRef,
    measureKeyFifthsFromImport,
    measureKeyModesFromImport,
    measurePairs,
    measureTimeSignaturesFromImport,
    measureTimelineBundlesRef,
    noteLayoutsByPairRef,
  ])

  const onAfterScoreRender = useCallback(() => {
    const request = chordMarkerLayoutRequestRef.current
    if (request <= chordMarkerLayoutAppliedRef.current) return
    chordMarkerLayoutAppliedRef.current = request
    setChordRulerMarkerGeometryByKey(buildChordGeometrySnapshot())
    setChordMarkerLayoutRevision((current) => (current === request ? current : request))
  }, [buildChordGeometrySnapshot])

  const measureRulerTicks = useMemo(() => buildMeasureRulerTicks({
    horizontalMeasureFramesByPair,
    scoreScaleX,
    stageBorderPx,
  }), [horizontalMeasureFramesByPair, scoreScaleX, stageBorderPx])

  const currentSelectionSignature = useMemo(() => {
    if (!isSelectionVisible) return ''
    return buildSelectionSetSignature([...selectedSelections, activeSelection])
  }, [activeSelection, isSelectionVisible, selectedSelections])

  const chordRulerMarkerMetaByKey = useMemo(() => buildChordRulerMarkerMetaByKey({
    chordRulerMarkerGeometryByKey,
    showChordDegreeEnabled,
    chordMarkerLabelLeftInsetPx,
    scoreScaleX,
    stageBorderPx,
  }), [
    chordMarkerLabelLeftInsetPx,
    chordRulerMarkerGeometryByKey,
    scoreScaleX,
    showChordDegreeEnabled,
    stageBorderPx,
  ])

  const {
    activeChordSelection,
    clearActiveChordSelection,
    applyChordSelectionRange,
    onChordRulerMarkerClick,
  } = useChordMarkerSelection({
    measurePairsRef,
    chordRulerMarkerMetaByKey,
    setIsSelectionVisible,
    setSelectedSelections,
    setActiveSelection,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    clearDraggingSelection,
    resetMidiStepChain,
  })

  const selectedMeasureHighlightRectPx = useChordMarkerHighlight({
    activeChordSelection,
    selectedMeasureScope,
    measurePairsRef,
    noteLayoutsByPairRef,
    measureLayoutsRef,
    horizontalMeasureFramesByPair,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    stageBorderPx,
    chordHighlightPadXPx,
    chordHighlightPadYPx,
    layoutStabilityKey,
    chordMarkerLayoutRevision,
  })

  const chordRulerMarkers = useMemo(() => {
    if (chordRulerMarkerMetaByKey.size === 0) return []
    return [...chordRulerMarkerMetaByKey.values()].map((marker) => ({
      key: marker.key,
      xPx: marker.xPx,
      sourceLabel: marker.sourceLabel,
      displayLabel: marker.displayLabel,
      isActive: activeChordSelection?.markerKey === marker.key,
      pairIndex: marker.pairIndex,
      positionText: marker.positionText,
      beatIndex: marker.beatIndex,
    }))
  }, [activeChordSelection, chordRulerMarkerMetaByKey])

  const timelineSegmentBlocks = useMemo(() => buildTimelineSegmentBlocks({
    measurePairs,
    horizontalMeasureFramesByPair,
    scoreScaleX,
    stageBorderPx,
    timelineSegmentOverlayMode,
    activeSelectionSignature: currentSelectionSignature,
  }), [
    currentSelectionSignature,
    horizontalMeasureFramesByPair,
    measurePairs,
    scoreScaleX,
    stageBorderPx,
    timelineSegmentOverlayMode,
  ])

  const onTimelineSegmentClick = useCallback((segmentKey: string) => {
    const segment = timelineSegmentBlocks.find((entry) => entry.key === segmentKey)
    if (!segment) return

    const nextSelections = buildSelectionsForMeasureRange({
      measurePairs: measurePairsRef.current,
      startPairIndex: segment.startPairIndex,
      endPairIndexInclusive: segment.endPairIndexInclusive,
    })

    resetMidiStepChain()
    clearActiveAccidentalSelection()
    clearActiveTieSelection()
    clearSelectedMeasureScope()
    clearDraggingSelection()
    clearActiveChordSelection()
    if (nextSelections.length > 0) {
      setIsSelectionVisible(true)
      setSelectedSelections(nextSelections)
      setActiveSelection(nextSelections[0])
      return
    }
    setIsSelectionVisible(false)
    setSelectedSelections([])
  }, [
    clearActiveAccidentalSelection,
    clearActiveChordSelection,
    clearActiveTieSelection,
    clearDraggingSelection,
    clearSelectedMeasureScope,
    measurePairsRef,
    resetMidiStepChain,
    setActiveSelection,
    setIsSelectionVisible,
    setSelectedSelections,
    timelineSegmentBlocks,
  ])

  return {
    chordMarkerLayoutRevision,
    activeChordSelection,
    clearActiveChordSelection,
    onAfterScoreRender,
    measureRulerTicks,
    chordRulerMarkerMetaByKey,
    chordRulerMarkers,
    timelineSegmentBlocks,
    applyChordSelectionRange,
    onChordRulerMarkerClick,
    onTimelineSegmentClick,
    selectedMeasureHighlightRectPx,
  }
}
