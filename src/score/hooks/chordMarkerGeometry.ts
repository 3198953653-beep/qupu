import { buildStaffOnsetTicks } from '../selectionTimelineRange'
import { chordNameToDegree, normalizeKeyMode } from '../chordDegree'
import { getMeasureTicksFromTimeSignature, type ChordRulerEntry } from '../chordRuler'
import { resolvePairTimeSignature } from '../measureRestUtils'
import type { MeasureTimelineBundle } from '../timeline/types'
import type { MeasureFrame, MeasurePair, NoteLayout, TimeSignature } from '../types'
import type {
  ChordRulerMarkerGeometry,
  ChordRulerMarkerMeta,
  MeasureFrameContentGeometry,
} from './chordMarkerTypes'
import type { MutableRefObject } from 'react'

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

export function buildChordRulerMarkerGeometrySnapshot(params: {
  measurePairs: MeasurePair[]
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  horizontalMeasureFramesByPair: MeasureFrame[]
  measureTimeSignaturesFromImport: TimeSignature[] | null
  measureKeyFifthsFromImport: number[] | null
  measureKeyModesFromImport: string[] | null
  horizontalRenderOffsetXRef: MutableRefObject<number>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  measureTimelineBundlesRef: MutableRefObject<Map<number, MeasureTimelineBundle>>
  getMeasureFrameContentGeometry: (frame: MeasureFrame | null | undefined) => MeasureFrameContentGeometry | null
}): Map<string, ChordRulerMarkerGeometry> {
  const {
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
  } = params

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

      let anchorSource: ChordRulerMarkerGeometry['anchorSource'] = 'frame'
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
}

export function buildChordRulerMarkerMetaByKey(params: {
  chordRulerMarkerGeometryByKey: Map<string, ChordRulerMarkerGeometry>
  showChordDegreeEnabled: boolean
  chordMarkerLabelLeftInsetPx: number
  scoreScaleX: number
  stageBorderPx: number
}): Map<string, ChordRulerMarkerMeta> {
  const {
    chordRulerMarkerGeometryByKey,
    showChordDegreeEnabled,
    chordMarkerLabelLeftInsetPx,
    scoreScaleX,
    stageBorderPx,
  } = params

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
}

export function buildMeasureRulerTicks(params: {
  horizontalMeasureFramesByPair: MeasureFrame[]
  scoreScaleX: number
  stageBorderPx: number
}) {
  const { horizontalMeasureFramesByPair, scoreScaleX, stageBorderPx } = params
  if (horizontalMeasureFramesByPair.length === 0) return [] as Array<{ key: string; xPx: number; label: string }>
  return horizontalMeasureFramesByPair.map((frame, index) => ({
    key: `measure-ruler-${index + 1}`,
    xPx: frame.measureX * scoreScaleX + stageBorderPx,
    label: `${index + 1}`,
  }))
}
