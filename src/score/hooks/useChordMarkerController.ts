import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { buildStaffOnsetTicks } from '../selectionTimelineRange'
import { getMeasureTicksFromTimeSignature, type ChordRulerEntry } from '../chordRuler'
import { chordNameToDegree } from '../chordDegree'
import { normalizeKeyMode } from '../chordDegree'
import { resolvePairTimeSignature } from '../measureRestUtils'
import type { MeasureTimelineBundle } from '../timeline/types'
import type { MeasureFrame, MeasureLayout, MeasurePair, NoteLayout, Selection, TimeSignature } from '../types'

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

type ChordRulerMarkerAnchorSource = 'note-head' | 'spacing-tick' | 'axis' | 'frame'

type ChordRulerMarkerGeometry = {
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

type MeasureFrameContentGeometry = {
  contentStartX: number
  contentMeasureWidth: number
}

type MeasureSelectionScope = {
  pairIndex: number
  staff: Selection['staff']
}

function resolvePairKeyMode(pairIndex: number, keyModesByMeasure?: string[] | null): 'major' | 'minor' {
  if (!keyModesByMeasure || keyModesByMeasure.length === 0) return 'major'
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyModesByMeasure[index]
    if (typeof value === 'string' && value.trim().length > 0) {
      return normalizeKeyMode(value)
    }
  }
  return 'major'
}

function buildSelectionsForMeasureTickRange(
  pair: MeasurePair,
  startTickInclusive: number,
  endTickExclusive: number,
): Selection[] {
  const safeStartTick = Math.max(0, Math.round(startTickInclusive))
  const safeEndTick = Math.max(safeStartTick, Math.round(endTickExclusive))
  if (safeEndTick <= safeStartTick) return []
  const selections: Selection[] = []
  ;(['treble', 'bass'] as const).forEach((staff) => {
    const notes = staff === 'treble' ? pair.treble : pair.bass
    const onsetTicksByNoteIndex = buildStaffOnsetTicks(notes)
    notes.forEach((note, noteIndex) => {
      const onsetTick = onsetTicksByNoteIndex[noteIndex]
      if (!Number.isFinite(onsetTick)) return
      if (onsetTick < safeStartTick || onsetTick >= safeEndTick) return
      const maxKeyIndex = note.chordPitches?.length ?? 0
      for (let keyIndex = 0; keyIndex <= maxKeyIndex; keyIndex += 1) {
        selections.push({
          noteId: note.id,
          staff,
          keyIndex,
        })
      }
    })
  })
  return selections
}

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
}): {
  chordMarkerLayoutRevision: number
  activeChordSelection: ActiveChordSelection | null
  clearActiveChordSelection: () => void
  onAfterScoreRender: () => void
  measureRulerTicks: Array<{ key: string; xPx: number; label: string }>
  chordRulerMarkerMetaByKey: Map<string, ChordRulerMarkerMeta>
  chordRulerMarkers: ChordRulerMarker[]
  applyChordSelectionRange: (params: {
    pairIndex: number
    startTick: number
    endTick: number
    markerKey?: string | null
  }) => Selection[]
  onChordRulerMarkerClick: (markerKey: string) => void
  selectedMeasureHighlightRectPx: { x: number; y: number; width: number; height: number } | null
} {
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

  const [activeChordSelection, setActiveChordSelection] = useState<ActiveChordSelection | null>(null)
  const [chordMarkerLayoutRevision, setChordMarkerLayoutRevision] = useState(0)
  const [chordRulerMarkerGeometryByKey, setChordRulerMarkerGeometryByKey] =
    useState<Map<string, ChordRulerMarkerGeometry>>(new Map())
  const chordMarkerLayoutRequestRef = useRef(0)
  const chordMarkerLayoutAppliedRef = useRef(0)

  const clearActiveChordSelection = useCallback(() => {
    setActiveChordSelection(null)
  }, [])

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

  const buildChordRulerMarkerGeometrySnapshot = useCallback(() => {
    const appliedRenderOffsetX = horizontalRenderOffsetXRef.current
    const markers = new Map<string, ChordRulerMarkerGeometry>()

    const resolveTickHeadGlobalX = (entryParams: {
      pairIndex: number
      startTick: number
    }): number | null => {
      const { pairIndex, startTick } = entryParams
      const pair = measurePairs[pairIndex]
      if (!pair) return null
      const pairLayouts = noteLayoutsByPairRef.current.get(pairIndex) ?? []
      if (pairLayouts.length === 0) return null

      const trebleOnsetTicksByIndex = buildStaffOnsetTicks(pair.treble)
      const bassOnsetTicksByIndex = buildStaffOnsetTicks(pair.bass)
      let bestCandidate: { headGlobalX: number; staffPriority: number; noteIndex: number } | null = null

      for (const layout of pairLayouts) {
        const sourceNote = layout.staff === 'treble' ? pair.treble[layout.noteIndex] : pair.bass[layout.noteIndex]
        if (!sourceNote || sourceNote.isRest) continue
        const onsetTicksByIndex = layout.staff === 'treble' ? trebleOnsetTicksByIndex : bassOnsetTicksByIndex
        const onsetTick = onsetTicksByIndex[layout.noteIndex]
        if (onsetTick !== startTick) continue
        const rootHead = layout.noteHeads.find((head) => head.keyIndex === 0) ?? layout.noteHeads[0] ?? null
        if (!rootHead) continue
        const localHeadLeftX = Number.isFinite(rootHead.hitMinX) ? (rootHead.hitMinX as number) : rootHead.x
        if (!Number.isFinite(localHeadLeftX)) continue
        const candidate = {
          headGlobalX: localHeadLeftX + appliedRenderOffsetX,
          staffPriority: layout.staff === 'treble' ? 0 : 1,
          noteIndex: layout.noteIndex,
        }
        if (
          bestCandidate === null ||
          candidate.headGlobalX < bestCandidate.headGlobalX - 0.001 ||
          (Math.abs(candidate.headGlobalX - bestCandidate.headGlobalX) <= 0.001 &&
            (candidate.staffPriority < bestCandidate.staffPriority ||
              (candidate.staffPriority === bestCandidate.staffPriority && candidate.noteIndex < bestCandidate.noteIndex)))
        ) {
          bestCandidate = candidate
        }
      }

      return bestCandidate?.headGlobalX ?? null
    }

    horizontalMeasureFramesByPair.forEach((frame, pairIndex) => {
      const timelineBundle = measureTimelineBundlesRef.current.get(pairIndex) ?? null
      const timeSignature = resolvePairTimeSignature(pairIndex, measureTimeSignaturesFromImport)
      const measureTicks = Math.max(1, timelineBundle?.measureTicks ?? getMeasureTicksFromTimeSignature(timeSignature))
      const chordEntries = chordRulerEntriesByPair?.[pairIndex] ?? []
      chordEntries.forEach((entry, entryIndex) => {
        const safeStartTick = Math.max(0, Math.min(measureTicks, Math.round(entry.startTick)))
        const safeEndTick = Math.max(safeStartTick, Math.min(measureTicks, Math.round(entry.endTick)))
        if (safeEndTick <= safeStartTick) return

        const frameContentGeometry = getMeasureFrameContentGeometry(frame)
        if (!frameContentGeometry) return

        let anchorSource: ChordRulerMarkerAnchorSource = 'frame'
        let anchorGlobalX =
          frameContentGeometry.contentStartX +
          frameContentGeometry.contentMeasureWidth * (safeStartTick / Math.max(1, measureTicks))

        const tickHeadGlobalX = resolveTickHeadGlobalX({
          pairIndex,
          startTick: safeStartTick,
        })
        if (typeof tickHeadGlobalX === 'number' && Number.isFinite(tickHeadGlobalX)) {
          anchorGlobalX = tickHeadGlobalX
          anchorSource = 'note-head'
        } else {
          const spacingTickX = timelineBundle?.spacingTickToX.get(safeStartTick)
          if (typeof spacingTickX === 'number' && Number.isFinite(spacingTickX)) {
            anchorGlobalX = spacingTickX + appliedRenderOffsetX
            anchorSource = 'spacing-tick'
          } else {
            const axisX = timelineBundle?.publicAxisLayout?.tickToX.get(safeStartTick)
            if (typeof axisX === 'number' && Number.isFinite(axisX)) {
              anchorGlobalX = axisX + appliedRenderOffsetX
              anchorSource = 'axis'
            }
          }
        }

        if (!Number.isFinite(anchorGlobalX)) return
        const key = `${pairIndex}:${safeStartTick}:${safeEndTick}:${entryIndex}:${entry.label}`
        const keyFifths = Number.isFinite(measureKeyFifthsFromImport?.[pairIndex])
          ? Math.trunc(measureKeyFifthsFromImport?.[pairIndex] ?? 0)
          : 0
        markers.set(key, {
          key,
          pairIndex,
          sourceLabel: entry.label,
          startTick: safeStartTick,
          endTick: safeEndTick,
          positionText: entry.positionText,
          beatIndex: entry.beatIndex,
          anchorSource,
          anchorGlobalX,
          keyFifths,
          keyMode: resolvePairKeyMode(pairIndex, measureKeyModesFromImport),
        })
      })
    })

    return markers
  }, [
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
    setChordRulerMarkerGeometryByKey(buildChordRulerMarkerGeometrySnapshot())
    setChordMarkerLayoutRevision((current) => (current === request ? current : request))
  }, [buildChordRulerMarkerGeometrySnapshot])

  const measureRulerTicks = useMemo(() => {
    if (horizontalMeasureFramesByPair.length === 0) return [] as Array<{ key: string; xPx: number; label: string }>
    return horizontalMeasureFramesByPair.map((frame, index) => ({
      key: `measure-ruler-${index + 1}`,
      xPx: frame.measureX * scoreScaleX + stageBorderPx,
      label: `${index + 1}`,
    }))
  }, [horizontalMeasureFramesByPair, scoreScaleX, stageBorderPx])

  const chordRulerMarkerMetaByKey = useMemo(() => {
    const markers = new Map<string, ChordRulerMarkerMeta>()
    chordRulerMarkerGeometryByKey.forEach((geometry, key) => {
      const displayLabel = showChordDegreeEnabled
        ? chordNameToDegree(geometry.sourceLabel, geometry.keyFifths, geometry.keyMode)
        : geometry.sourceLabel
      const textAnchorXPx = geometry.anchorGlobalX * scoreScaleX + stageBorderPx
      const buttonLeftXPx = textAnchorXPx - chordMarkerLabelLeftInsetPx
      if (!Number.isFinite(buttonLeftXPx)) return
      markers.set(key, {
        key: geometry.key,
        pairIndex: geometry.pairIndex,
        beatIndex: geometry.beatIndex,
        sourceLabel: geometry.sourceLabel,
        displayLabel,
        startTick: geometry.startTick,
        endTick: geometry.endTick,
        positionText: geometry.positionText,
        anchorGlobalX: geometry.anchorGlobalX,
        anchorXPx: textAnchorXPx,
        xPx: buttonLeftXPx,
        anchorSource: geometry.anchorSource,
        keyFifths: geometry.keyFifths,
        keyMode: geometry.keyMode,
      })
    })
    return markers
  }, [chordMarkerLabelLeftInsetPx, chordRulerMarkerGeometryByKey, scoreScaleX, showChordDegreeEnabled, stageBorderPx])

  useEffect(() => {
    if (!activeChordSelection) return
    if (activeChordSelection.markerKey === null) return
    if (chordRulerMarkerMetaByKey.has(activeChordSelection.markerKey)) return
    setActiveChordSelection(null)
  }, [activeChordSelection, chordRulerMarkerMetaByKey])

  const chordRulerMarkers = useMemo(() => {
    if (chordRulerMarkerMetaByKey.size === 0) return [] as ChordRulerMarker[]
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

  const applyChordSelectionRange = useCallback((selectionParams: {
    pairIndex: number
    startTick: number
    endTick: number
    markerKey?: string | null
  }): Selection[] => {
    const targetPair = measurePairsRef.current[selectionParams.pairIndex]
    if (!targetPair) return []
    const nextSelections = buildSelectionsForMeasureTickRange(
      targetPair,
      selectionParams.startTick,
      selectionParams.endTick,
    )
    resetMidiStepChain()
    clearActiveAccidentalSelection()
    clearActiveTieSelection()
    clearSelectedMeasureScope()
    clearDraggingSelection()
    if (nextSelections.length > 0) {
      setIsSelectionVisible(true)
      setSelectedSelections(nextSelections)
      setActiveSelection(nextSelections[0])
    } else {
      setIsSelectionVisible(false)
      setSelectedSelections([])
    }
    setActiveChordSelection({
      markerKey: selectionParams.markerKey ?? null,
      pairIndex: selectionParams.pairIndex,
      startTick: selectionParams.startTick,
      endTick: selectionParams.endTick,
    })
    return nextSelections
  }, [
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearDraggingSelection,
    clearSelectedMeasureScope,
    measurePairsRef,
    resetMidiStepChain,
    setActiveSelection,
    setIsSelectionVisible,
    setSelectedSelections,
  ])

  const onChordRulerMarkerClick = useCallback((markerKey: string) => {
    const marker = chordRulerMarkerMetaByKey.get(markerKey)
    if (!marker) return
    applyChordSelectionRange({
      pairIndex: marker.pairIndex,
      startTick: marker.startTick,
      endTick: marker.endTick,
      markerKey: marker.key,
    })
  }, [applyChordSelectionRange, chordRulerMarkerMetaByKey])

  const resolveChordHighlightContentBounds = useCallback((highlightParams: {
    pairIndex: number
    startTick: number
    endTick: number
  }): { leftXRaw: number; rightXRaw: number } | null => {
    const safeStartTick = Math.max(0, Math.round(highlightParams.startTick))
    const safeEndTick = Math.max(safeStartTick, Math.round(highlightParams.endTick))
    if (safeEndTick <= safeStartTick) return null

    const pair = measurePairsRef.current[highlightParams.pairIndex]
    if (!pair) return null
    const pairLayouts = noteLayoutsByPairRef.current.get(highlightParams.pairIndex) ?? []
    if (pairLayouts.length === 0) return null

    const layoutByStaffNoteIndex = new Map<string, NoteLayout>()
    pairLayouts.forEach((layout) => {
      layoutByStaffNoteIndex.set(`${layout.staff}:${layout.noteIndex}`, layout)
    })

    let minLeftX = Number.POSITIVE_INFINITY
    let maxRightX = Number.NEGATIVE_INFINITY
    const acceptBounds = (left: number, right: number) => {
      if (!Number.isFinite(left) || !Number.isFinite(right)) return
      if (right <= left) return
      minLeftX = Math.min(minLeftX, left)
      maxRightX = Math.max(maxRightX, right)
    }

    ;(['treble', 'bass'] as const).forEach((staff) => {
      const staffNotes = staff === 'treble' ? pair.treble : pair.bass
      const onsetTicksByNoteIndex = buildStaffOnsetTicks(staffNotes)
      staffNotes.forEach((_, noteIndex) => {
        const onsetTick = onsetTicksByNoteIndex[noteIndex]
        if (!Number.isFinite(onsetTick)) return
        if (onsetTick < safeStartTick || onsetTick >= safeEndTick) return

        const layout = layoutByStaffNoteIndex.get(`${staff}:${noteIndex}`) ?? null
        if (!layout) return

        const leftCandidates: number[] = []
        if (Number.isFinite(layout.x)) leftCandidates.push(layout.x)
        layout.noteHeads.forEach((head) => {
          if (Number.isFinite(head.hitMinX)) {
            leftCandidates.push(head.hitMinX as number)
          } else if (Number.isFinite(head.x)) {
            leftCandidates.push(head.x)
          }
        })
        layout.accidentalLayouts.forEach((accidental) => {
          if (Number.isFinite(accidental.hitMinX)) {
            leftCandidates.push(accidental.hitMinX as number)
            return
          }
          if (!Number.isFinite(accidental.x)) return
          if (Number.isFinite(accidental.hitRadiusX)) {
            leftCandidates.push(accidental.x - (accidental.hitRadiusX as number))
            return
          }
          leftCandidates.push(accidental.x - 4)
        })

        const rightCandidates: number[] = []
        layout.noteHeads.forEach((head) => {
          if (Number.isFinite(head.hitMaxX)) {
            rightCandidates.push(head.hitMaxX as number)
            return
          }
          if (Number.isFinite(head.x)) {
            rightCandidates.push(head.x + 9)
          }
        })
        if (Number.isFinite(layout.spacingRightX)) {
          rightCandidates.push(layout.spacingRightX)
        }
        if (rightCandidates.length === 0 && Number.isFinite(layout.x)) {
          rightCandidates.push(layout.x + 9)
        }
        if (rightCandidates.length === 0 && Number.isFinite(layout.rightX)) {
          rightCandidates.push(layout.rightX)
        }

        const noteLeft = leftCandidates.length > 0 ? Math.min(...leftCandidates) : Number.POSITIVE_INFINITY
        const noteRight = rightCandidates.length > 0 ? Math.max(...rightCandidates) : Number.NEGATIVE_INFINITY
        acceptBounds(noteLeft, noteRight)
      })
    })

    if (!Number.isFinite(minLeftX) || !Number.isFinite(maxRightX)) return null
    if (maxRightX <= minLeftX) return null
    return {
      leftXRaw: minLeftX,
      rightXRaw: maxRightX,
    }
  }, [measurePairsRef, noteLayoutsByPairRef])

  const selectedMeasureHighlightRectPx = useMemo(() => {
    void layoutStabilityKey
    void chordMarkerLayoutRevision
    const measurePadX = 6
    const measurePadY = 4

    if (activeChordSelection !== null) {
      const measureLayout = measureLayoutsRef.current.get(activeChordSelection.pairIndex) ?? null
      if (!measureLayout) return null
      const contentBounds = resolveChordHighlightContentBounds({
        pairIndex: activeChordSelection.pairIndex,
        startTick: activeChordSelection.startTick,
        endTick: activeChordSelection.endTick,
      })
      if (!contentBounds) return null

      const trebleTopRaw = Number.isFinite(measureLayout.trebleLineTopY) ? measureLayout.trebleLineTopY : measureLayout.trebleY
      const trebleBottomRaw =
        Number.isFinite(measureLayout.trebleLineBottomY) ? measureLayout.trebleLineBottomY : measureLayout.trebleY + 40
      const bassTopRaw = Number.isFinite(measureLayout.bassLineTopY) ? measureLayout.bassLineTopY : measureLayout.bassY
      const bassBottomRaw =
        Number.isFinite(measureLayout.bassLineBottomY) ? measureLayout.bassLineBottomY : measureLayout.bassY + 40
      const trebleTop = Math.min(trebleTopRaw, trebleBottomRaw)
      const trebleBottom = Math.max(trebleTopRaw, trebleBottomRaw)
      const bassTop = Math.min(bassTopRaw, bassBottomRaw)
      const bassBottom = Math.max(bassTopRaw, bassBottomRaw)
      const lineTop = Math.min(trebleTop, bassTop)
      const lineBottom = Math.max(trebleBottom, bassBottom)
      const x = scoreSurfaceOffsetXPx + contentBounds.leftXRaw * scoreScaleX + stageBorderPx
      const y = scoreSurfaceOffsetYPx + lineTop * scoreScaleY + stageBorderPx
      const width = (contentBounds.rightXRaw - contentBounds.leftXRaw) * scoreScaleX
      const height = (lineBottom - lineTop) * scoreScaleY
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null
      }
      if (width <= 0 || height <= 0) return null
      return {
        x: x - chordHighlightPadXPx,
        y: y - chordHighlightPadYPx,
        width: width + chordHighlightPadXPx * 2,
        height: height + chordHighlightPadYPx * 2,
      }
    }

    if (selectedMeasureScope === null) return null
    const measureLayout = measureLayoutsRef.current.get(selectedMeasureScope.pairIndex) ?? null
    if (!measureLayout) return null
    const frame = horizontalMeasureFramesByPair[selectedMeasureScope.pairIndex] ?? null
    const x =
      frame !== null
        ? frame.measureX * scoreScaleX + stageBorderPx
        : scoreSurfaceOffsetXPx + measureLayout.measureX * scoreScaleX + stageBorderPx
    const lineTopRaw =
      selectedMeasureScope.staff === 'treble'
        ? (Number.isFinite(measureLayout.trebleLineTopY) ? measureLayout.trebleLineTopY : measureLayout.trebleY)
        : (Number.isFinite(measureLayout.bassLineTopY) ? measureLayout.bassLineTopY : measureLayout.bassY)
    const lineBottomRaw =
      selectedMeasureScope.staff === 'treble'
        ? (Number.isFinite(measureLayout.trebleLineBottomY) ? measureLayout.trebleLineBottomY : measureLayout.trebleY + 40)
        : (Number.isFinite(measureLayout.bassLineBottomY) ? measureLayout.bassLineBottomY : measureLayout.bassY + 40)
    const lineTop = Math.min(lineTopRaw, lineBottomRaw)
    const lineBottom = Math.max(lineTopRaw, lineBottomRaw)
    const y = scoreSurfaceOffsetYPx + lineTop * scoreScaleY + stageBorderPx
    const width =
      frame !== null
        ? frame.measureWidth * scoreScaleX
        : measureLayout.measureWidth * scoreScaleX
    const height = (lineBottom - lineTop) * scoreScaleY
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
      return null
    }
    if (width <= 0 || height <= 0) return null
    return {
      x: x - measurePadX,
      y: y - measurePadY,
      width: width + measurePadX * 2,
      height: height + measurePadY * 2,
    }
  }, [
    activeChordSelection,
    chordHighlightPadXPx,
    chordHighlightPadYPx,
    chordMarkerLayoutRevision,
    horizontalMeasureFramesByPair,
    layoutStabilityKey,
    measureLayoutsRef,
    resolveChordHighlightContentBounds,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    selectedMeasureScope,
    stageBorderPx,
  ])

  return {
    chordMarkerLayoutRevision,
    activeChordSelection,
    clearActiveChordSelection,
    onAfterScoreRender,
    measureRulerTicks,
    chordRulerMarkerMetaByKey,
    chordRulerMarkers,
    applyChordSelectionRange,
    onChordRulerMarkerClick,
    selectedMeasureHighlightRectPx,
  }
}
