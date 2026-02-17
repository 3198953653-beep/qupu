import { BarlineType, Renderer, Stave } from 'vexflow'
import {
  SCORE_PAGE_PADDING_X,
  SCORE_TOP_PADDING,
  STAFF_X,
  SYSTEM_BASS_OFFSET_Y,
  SYSTEM_GAP_Y,
  SYSTEM_HEIGHT,
  SYSTEM_TREBLE_OFFSET_Y,
} from '../constants'
import { getKeySignatureSpecFromFifths } from '../accidentals'
import {
  allocateMeasureWidthsByDemand,
  estimateAdaptiveMeasureWidth,
  getMeasureLayoutDemand,
  type SystemMeasureRange,
} from '../layout/demand'
import { getLayoutNoteKey } from '../layout/renderPosition'
import { buildMeasureOverlayRect } from '../layout/viewport'
import { clamp } from '../math'
import { drawMeasureToContext } from './drawMeasure'
import type { MeasureLayout, MeasurePair, NoteLayout, Selection, TimeSignature } from '../types'

const MEASURE_RIGHT_EDGE_GUARD_PX = 3
const OVERFLOW_RECOVERY_PADDING_PX = 8
const OVERFLOW_ANALYSIS_MAX_PASSES = 2

export function renderVisibleSystems(params: {
  context: ReturnType<Renderer['getContext']>
  measurePairs: MeasurePair[]
  scoreWidth: number
  scoreHeight: number
  systemRanges: SystemMeasureRange[]
  visibleSystemRange: { start: number; end: number }
  renderOriginSystemIndex?: number
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  activeSelection: Selection | null
  draggingSelection: Selection | null
}): {
  nextLayouts: NoteLayout[]
  nextLayoutsByPair: Map<number, NoteLayout[]>
  nextLayoutsByKey: Map<string, NoteLayout>
  nextMeasureLayouts: Map<number, MeasureLayout>
} {
  const {
    context,
    measurePairs,
    scoreWidth,
    scoreHeight,
    systemRanges,
    visibleSystemRange,
    renderOriginSystemIndex = 0,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    activeSelection,
    draggingSelection,
  } = params

  const nextLayouts: NoteLayout[] = []
  const nextLayoutsByPair = new Map<number, NoteLayout[]>()
  const nextLayoutsByKey = new Map<string, NoteLayout>()
  const nextMeasureLayouts = new Map<number, MeasureLayout>()
  if (systemRanges.length === 0) {
    context.clearRect(0, 0, scoreWidth, scoreHeight)
    return {
      nextLayouts,
      nextLayoutsByPair,
      nextLayoutsByKey,
      nextMeasureLayouts,
    }
  }
  const maxSystemIndex = systemRanges.length - 1
  const startSystem = clamp(visibleSystemRange.start, 0, maxSystemIndex)
  const endSystem = clamp(visibleSystemRange.end, startSystem, maxSystemIndex)
  context.clearRect(0, 0, scoreWidth, scoreHeight)

  for (let systemIndex = startSystem; systemIndex <= endSystem; systemIndex += 1) {
    const range = systemRanges[systemIndex]
    if (!range) continue
    const start = range.startPairIndex
    const endExclusive = Math.max(start, range.endPairIndexExclusive)
    const systemMeasures = measurePairs.slice(start, endExclusive)
    if (systemMeasures.length === 0) continue

    const systemTop = SCORE_TOP_PADDING + (systemIndex - renderOriginSystemIndex) * (SYSTEM_HEIGHT + SYSTEM_GAP_Y)
    const trebleY = systemTop + SYSTEM_TREBLE_OFFSET_Y
    const bassY = systemTop + SYSTEM_BASS_OFFSET_Y
    const systemUsableWidth = scoreWidth - SCORE_PAGE_PADDING_X * 2

    const systemMeta = systemMeasures.map((measure, indexInSystem) => {
      const pairIndex = start + indexInSystem
      const isSystemStart = indexInSystem === 0
      const timeSignature =
        measureTimeSignaturesFromImport?.[pairIndex] ??
        measureTimeSignaturesFromImport?.[pairIndex - 1] ?? {
          beats: 4,
          beatType: 4,
        }
      const previousTimeSignature =
        pairIndex > 0
          ? measureTimeSignaturesFromImport?.[pairIndex - 1] ??
            measureTimeSignaturesFromImport?.[pairIndex - 2] ?? {
              beats: 4,
              beatType: 4,
            }
          : timeSignature
      const showTimeSignature =
        pairIndex === 0 ||
        timeSignature.beats !== previousTimeSignature.beats ||
        timeSignature.beatType !== previousTimeSignature.beatType
      const hasNextMeasure = pairIndex + 1 < measurePairs.length
      const nextTimeSignature =
        hasNextMeasure
          ? measureTimeSignaturesFromImport?.[pairIndex + 1] ??
            measureTimeSignaturesFromImport?.[pairIndex] ??
            timeSignature
          : timeSignature
      const isSystemEnd = indexInSystem === systemMeasures.length - 1
      const showEndTimeSignature =
        hasNextMeasure &&
        isSystemEnd &&
        (nextTimeSignature.beats !== timeSignature.beats || nextTimeSignature.beatType !== timeSignature.beatType)
      const keyFifths = measureKeyFifthsFromImport?.[pairIndex] ?? measureKeyFifthsFromImport?.[pairIndex - 1] ?? 0
      const previousKeyFifths = pairIndex > 0 ? (measureKeyFifthsFromImport?.[pairIndex - 1] ?? 0) : keyFifths
      const showKeySignature = isSystemStart || keyFifths !== previousKeyFifths
      const includeMeasureStartDecorations = !isSystemStart && (showKeySignature || showTimeSignature)
      return {
        pairIndex,
        measure,
        isSystemStart,
        keyFifths,
        showKeySignature,
        timeSignature,
        showTimeSignature,
        nextTimeSignature,
        showEndTimeSignature,
        includeMeasureStartDecorations,
      }
    })
    const measureDemands = systemMeta.map((entry) =>
      getMeasureLayoutDemand(
        entry.measure,
        entry.showKeySignature,
        entry.showTimeSignature,
        entry.showEndTimeSignature,
      ),
    )
    const minimumMeasureWidths = measureDemands.map((demand) =>
      Math.min(systemUsableWidth, estimateAdaptiveMeasureWidth(demand)),
    )
    const buildMeasureProbe = (entry: (typeof systemMeta)[number], measureX: number, measureWidth: number) => {
      const noteStartProbe = new Stave(measureX, trebleY, measureWidth)
      if (entry.isSystemStart) {
        noteStartProbe.addClef('treble')
        if (entry.showKeySignature) {
          noteStartProbe.addKeySignature(getKeySignatureSpecFromFifths(entry.keyFifths))
        }
        if (entry.showTimeSignature) {
          noteStartProbe.addTimeSignature(`${entry.timeSignature.beats}/${entry.timeSignature.beatType}`)
        }
      } else {
        noteStartProbe.setBegBarType(BarlineType.NONE)
        if (entry.showKeySignature) {
          noteStartProbe.addKeySignature(getKeySignatureSpecFromFifths(entry.keyFifths))
        }
        if (entry.showTimeSignature) {
          noteStartProbe.addTimeSignature(`${entry.timeSignature.beats}/${entry.timeSignature.beatType}`)
        }
      }
      const noteStartX = noteStartProbe.getNoteStartX()
      const formatWidth = Math.max(80, noteStartProbe.getNoteEndX() - noteStartX - 8)
      return { noteStartX, formatWidth }
    }

    const analyzeOverflowMinimumWidths = (
      candidateWidths: number[],
      currentMinimums: number[],
    ): { nextMinimums: number[]; hasIncrease: boolean } => {
      const nextMinimums = [...currentMinimums]
      let hasIncrease = false
      let analysisCursorX = STAFF_X

      systemMeta.forEach((entry, indexInSystem) => {
        const measureWidth = candidateWidths[indexInSystem] ?? Math.floor(systemUsableWidth / systemMeasures.length)
        const measureX = analysisCursorX
        analysisCursorX += measureWidth
        const { formatWidth } = buildMeasureProbe(entry, measureX, measureWidth)
        const measureNoteLayouts = drawMeasureToContext({
          context,
          measure: entry.measure,
          pairIndex: entry.pairIndex,
          measureX,
          measureWidth,
          trebleY,
          bassY,
          isSystemStart: entry.isSystemStart,
          keyFifths: entry.keyFifths,
          showKeySignature: entry.showKeySignature,
          timeSignature: entry.timeSignature,
          showTimeSignature: entry.showTimeSignature,
          endTimeSignature: entry.nextTimeSignature,
          showEndTimeSignature: entry.showEndTimeSignature,
          activeSelection: null,
          draggingSelection: null,
          collectLayouts: true,
          skipPainting: true,
          formatWidthOverride: formatWidth,
        })

        let maxHeadX = Number.NEGATIVE_INFINITY
        for (const layout of measureNoteLayouts) {
          if (layout.rightX > maxHeadX) maxHeadX = layout.rightX
        }
        if (!Number.isFinite(maxHeadX)) return
        const rightBoundary = measureX + measureWidth - MEASURE_RIGHT_EDGE_GUARD_PX
        const overflow = maxHeadX - rightBoundary
        if (overflow <= 0) return
        const requiredWidth = Math.ceil(measureWidth + overflow + OVERFLOW_RECOVERY_PADDING_PX)
        if (requiredWidth <= nextMinimums[indexInSystem]) return
        nextMinimums[indexInSystem] = requiredWidth
        hasIncrease = true
      })

      return { nextMinimums, hasIncrease }
    }

    let enforcedMinimumWidths = [...minimumMeasureWidths]
    let measureWidths = allocateMeasureWidthsByDemand(measureDemands, systemUsableWidth, enforcedMinimumWidths)

    for (let pass = 0; pass < OVERFLOW_ANALYSIS_MAX_PASSES; pass += 1) {
      const { nextMinimums, hasIncrease } = analyzeOverflowMinimumWidths(measureWidths, enforcedMinimumWidths)
      if (!hasIncrease) break
      enforcedMinimumWidths = nextMinimums
      measureWidths = allocateMeasureWidthsByDemand(measureDemands, systemUsableWidth, enforcedMinimumWidths)
    }

    let measureCursorX = STAFF_X
    systemMeta.forEach((entry, indexInSystem) => {
      const measureWidth = measureWidths[indexInSystem] ?? Math.floor(systemUsableWidth / systemMeasures.length)
      const measureX = measureCursorX
      measureCursorX += measureWidth
      const { noteStartX, formatWidth } = buildMeasureProbe(entry, measureX, measureWidth)
      const measureNoteLayouts = drawMeasureToContext({
        context,
        measure: entry.measure,
        pairIndex: entry.pairIndex,
        measureX,
        measureWidth,
        trebleY,
        bassY,
        isSystemStart: entry.isSystemStart,
        keyFifths: entry.keyFifths,
        showKeySignature: entry.showKeySignature,
        timeSignature: entry.timeSignature,
        showTimeSignature: entry.showTimeSignature,
        endTimeSignature: entry.nextTimeSignature,
        showEndTimeSignature: entry.showEndTimeSignature,
        activeSelection,
        draggingSelection,
        formatWidthOverride: formatWidth,
      })

      nextLayouts.push(...measureNoteLayouts)
      const pairLayouts = nextLayoutsByPair.get(entry.pairIndex)
      if (pairLayouts) {
        pairLayouts.push(...measureNoteLayouts)
      } else {
        nextLayoutsByPair.set(entry.pairIndex, [...measureNoteLayouts])
      }
      measureNoteLayouts.forEach((layout) => {
        nextLayoutsByKey.set(getLayoutNoteKey(layout.staff, layout.id), layout)
      })

      let minNoteX = Number.POSITIVE_INFINITY
      let maxNoteX = Number.NEGATIVE_INFINITY
      for (const layout of measureNoteLayouts) {
        if (layout.x < minNoteX) minNoteX = layout.x
        if (layout.rightX > maxNoteX) maxNoteX = layout.rightX
      }
      const overlayRect = buildMeasureOverlayRect(
        minNoteX,
        maxNoteX,
        noteStartX,
        measureX,
        measureWidth,
        systemTop,
        scoreWidth,
        scoreHeight,
        entry.isSystemStart,
        entry.includeMeasureStartDecorations,
      )
      nextMeasureLayouts.set(entry.pairIndex, {
        pairIndex: entry.pairIndex,
        measureX,
        measureWidth,
        trebleY,
        bassY,
        systemTop,
        isSystemStart: entry.isSystemStart,
        keyFifths: entry.keyFifths,
        showKeySignature: entry.showKeySignature,
        timeSignature: entry.timeSignature,
        showTimeSignature: entry.showTimeSignature,
        endTimeSignature: entry.nextTimeSignature,
        showEndTimeSignature: entry.showEndTimeSignature,
        includeMeasureStartDecorations: entry.includeMeasureStartDecorations,
        noteStartX,
        formatWidth,
        overlayRect,
      })
    })
  }

  return {
    nextLayouts,
    nextLayoutsByPair,
    nextLayoutsByKey,
    nextMeasureLayouts,
  }
}
