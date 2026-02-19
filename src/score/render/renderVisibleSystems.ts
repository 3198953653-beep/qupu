import { BarlineType, Renderer, Stave } from 'vexflow'
import {
  SCORE_PAGE_PADDING_X,
  SCORE_TOP_PADDING,
  SYSTEM_BASS_OFFSET_Y,
  SYSTEM_GAP_Y,
  SYSTEM_HEIGHT,
  SYSTEM_TREBLE_OFFSET_Y,
  TICKS_PER_BEAT,
} from '../constants'
import { getKeySignatureSpecFromFifths } from '../accidentals'
import { type SystemMeasureRange } from '../layout/demand'
import { getLayoutNoteKey } from '../layout/renderPosition'
import { buildMeasureOverlayRect } from '../layout/viewport'
import { clamp } from '../math'
import { drawMeasureToContext } from './drawMeasure'
import {
  getMeasureUniformTimelineWeightSpan,
  getUniformTickSpacingPadding,
  type TimeAxisSpacingConfig,
} from '../layout/timeAxisSpacing'
import type { MeasureLayout, MeasurePair, NoteLayout, ScoreNote, Selection, StaffKind, TimeSignature } from '../types'

const OVERFLOW_ANALYSIS_MAX_PASSES = 6
const OVERFLOW_RECOVERY_PAD_PX = 2

type FrozenMeasureSpacing = {
  baselineMeasureX: number
  staticNoteXById: Map<string, number>
  staticAccidentalRightXById: Map<string, Map<number, number>>
}

function tryBuildFrozenMeasureSpacing(params: {
  pairIndex: number
  measure: MeasurePair
  previousNoteLayoutsByPair: Map<number, NoteLayout[]> | null | undefined
  previousMeasureLayouts: Map<number, MeasureLayout> | null | undefined
}): FrozenMeasureSpacing | null {
  const { pairIndex, measure, previousNoteLayoutsByPair, previousMeasureLayouts } = params
  const previousLayouts = previousNoteLayoutsByPair?.get(pairIndex)
  if (!previousLayouts || previousLayouts.length === 0) return null
  const previousMeasureLayout = previousMeasureLayouts?.get(pairIndex)
  if (!previousMeasureLayout) return null

  const previousByNoteKey = new Map<string, NoteLayout>()
  previousLayouts.forEach((layout) => {
    previousByNoteKey.set(getLayoutNoteKey(layout.staff, layout.id), layout)
  })

  const staticNoteXById = new Map<string, number>()
  const staticAccidentalRightXById = new Map<string, Map<number, number>>()

  const collectStaff = (staff: StaffKind, notes: ScoreNote[]): boolean => {
    for (const note of notes) {
      const noteKey = getLayoutNoteKey(staff, note.id)
      const previousLayout = previousByNoteKey.get(noteKey)
      if (!previousLayout) return false

      staticNoteXById.set(noteKey, previousLayout.x)
      const previousAccidentalMap = new Map<number, number>()
      Object.keys(previousLayout.accidentalRightXByKeyIndex).forEach((rawKeyIndex) => {
        const keyIndex = Number(rawKeyIndex)
        const rightX = previousLayout.accidentalRightXByKeyIndex[keyIndex]
        if (Number.isFinite(keyIndex) && Number.isFinite(rightX)) {
          previousAccidentalMap.set(keyIndex, rightX)
        }
      })
      if (previousAccidentalMap.size > 0) {
        staticAccidentalRightXById.set(noteKey, previousAccidentalMap)
      }
    }
    return true
  }

  if (!collectStaff('treble', measure.treble)) return null
  if (!collectStaff('bass', measure.bass)) return null

  const expectedCount = measure.treble.length + measure.bass.length
  if (staticNoteXById.size !== expectedCount) return null

  return {
    baselineMeasureX: previousMeasureLayout.measureX,
    staticNoteXById,
    staticAccidentalRightXById,
  }
}

function translateFrozenSpacingToMeasureX(
  frozen: FrozenMeasureSpacing,
  targetMeasureX: number,
): { staticNoteXById: Map<string, number>; staticAccidentalRightXById: Map<string, Map<number, number>> } {
  const delta = targetMeasureX - frozen.baselineMeasureX
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) {
    return {
      staticNoteXById: frozen.staticNoteXById,
      staticAccidentalRightXById: frozen.staticAccidentalRightXById,
    }
  }

  const staticNoteXById = new Map<string, number>()
  frozen.staticNoteXById.forEach((x, noteKey) => {
    staticNoteXById.set(noteKey, x + delta)
  })

  const staticAccidentalRightXById = new Map<string, Map<number, number>>()
  frozen.staticAccidentalRightXById.forEach((byKeyIndex, noteKey) => {
    const shiftedByKeyIndex = new Map<number, number>()
    byKeyIndex.forEach((rightX, keyIndex) => {
      shiftedByKeyIndex.set(keyIndex, rightX + delta)
    })
    staticAccidentalRightXById.set(noteKey, shiftedByKeyIndex)
  })

  return { staticNoteXById, staticAccidentalRightXById }
}

function findPairIndexForSelection(
  selection: Selection | null,
  previousNoteLayoutsByPair: Map<number, NoteLayout[]> | null | undefined,
): number | null {
  if (!selection || !previousNoteLayoutsByPair || previousNoteLayoutsByPair.size === 0) return null
  for (const [pairIndex, layouts] of previousNoteLayoutsByPair.entries()) {
    for (const layout of layouts) {
      if (layout.staff === selection.staff && layout.id === selection.noteId) {
        return pairIndex
      }
    }
  }
  return null
}

function getLayoutSpacingRightX(layout: NoteLayout): number {
  if (Number.isFinite(layout.spacingRightX)) {
    return layout.spacingRightX
  }
  return Number.isFinite(layout.rightX) ? layout.rightX : layout.x
}

function getMeasureSpacingRightEdge(layouts: NoteLayout[]): number {
  if (layouts.length === 0) return Number.NEGATIVE_INFINITY
  let maxSpacingRightX = Number.NEGATIVE_INFINITY
  for (const layout of layouts) {
    const spacingRightX = getLayoutSpacingRightX(layout)
    if (spacingRightX > maxSpacingRightX) maxSpacingRightX = spacingRightX
  }
  return maxSpacingRightX
}

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
  previousNoteLayoutsByPair?: Map<number, NoteLayout[]> | null
  previousMeasureLayouts?: Map<number, MeasureLayout> | null
  allowSelectionFreezeWhenNotDragging?: boolean
  pagePaddingX?: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
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
    previousNoteLayoutsByPair = null,
    previousMeasureLayouts = null,
    allowSelectionFreezeWhenNotDragging = true,
    pagePaddingX = SCORE_PAGE_PADDING_X,
    timeAxisSpacingConfig,
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
    const systemUsableWidth = Math.max(1, scoreWidth - pagePaddingX * 2)

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
      const preferMeasureStartBarlineAxis = !isSystemStart && !showKeySignature && !showTimeSignature
      const preferMeasureEndBarlineAxis = !showEndTimeSignature
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
        preferMeasureStartBarlineAxis,
        preferMeasureEndBarlineAxis,
      }
    })
    // Apply spacing freeze while dragging; optionally allow post-release freeze
    // when geometry is unchanged (caller controls this flag).
    const freezeSelection =
      draggingSelection ?? (allowSelectionFreezeWhenNotDragging ? activeSelection : null)
    const frozenPairIndex = findPairIndexForSelection(freezeSelection, previousNoteLayoutsByPair)
    const frozenSpacingByPairIndex = new Map<number, FrozenMeasureSpacing>()
    systemMeta.forEach((entry) => {
      if (entry.pairIndex !== frozenPairIndex) return
      const frozen = tryBuildFrozenMeasureSpacing({
        pairIndex: entry.pairIndex,
        measure: entry.measure,
        previousNoteLayoutsByPair,
        previousMeasureLayouts,
      })
      if (frozen) {
        frozenSpacingByPairIndex.set(entry.pairIndex, frozen)
      }
    })
    const measureTicksBySystem = systemMeta.map((entry) =>
      Math.max(1, Math.round(entry.timeSignature.beats * TICKS_PER_BEAT * (4 / entry.timeSignature.beatType))),
    )
    const measureTimelineWeightsBySystem = systemMeta.map((entry, indexInSystem) =>
      getMeasureUniformTimelineWeightSpan(
        entry.measure,
        measureTicksBySystem[indexInSystem] ?? 1,
        timeAxisSpacingConfig,
      ),
    )
    const probeGeometryCache = new Map<string, { noteStartOffset: number; noteEndOffset: number; formatWidth: number }>()
    const getMeasureProbeGeometry = (entry: (typeof systemMeta)[number], measureWidth: number) => {
      const safeWidth = Math.max(1, Number(measureWidth.toFixed(3)))
      const cacheKey = `${entry.pairIndex}|${safeWidth.toFixed(3)}`
      const cached = probeGeometryCache.get(cacheKey)
      if (cached) return cached

      const noteStartProbe = new Stave(0, trebleY, safeWidth)
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
      if (entry.showEndTimeSignature) {
        noteStartProbe.setEndTimeSignature(`${entry.nextTimeSignature.beats}/${entry.nextTimeSignature.beatType}`)
      }
      const noteStartOffset = noteStartProbe.getNoteStartX()
      const noteEndOffset = noteStartProbe.getNoteEndX()
      const formatWidth = Math.max(80, noteEndOffset - noteStartOffset - 8)
      const geometry = { noteStartOffset, noteEndOffset, formatWidth }
      probeGeometryCache.set(cacheKey, geometry)
      return geometry
    }

    const buildMeasureProbe = (entry: (typeof systemMeta)[number], measureX: number, measureWidth: number) => {
      const geometry = getMeasureProbeGeometry(entry, measureWidth)
      const measureEndX = measureX + measureWidth
      const noteEndX = measureX + geometry.noteEndOffset
      return {
        noteStartX: measureX + geometry.noteStartOffset,
        noteEndX,
        spacingRightLimitX: entry.preferMeasureEndBarlineAxis ? measureEndX : noteEndX,
        formatWidth: geometry.formatWidth,
      }
    }
    const probeWidth = Math.max(140, Math.floor(systemUsableWidth / Math.max(1, systemMeasures.length)))
    const uniformTickPadding = getUniformTickSpacingPadding(timeAxisSpacingConfig)
    let fixedWidths = systemMeta.map((entry) => {
      const geometry = getMeasureProbeGeometry(entry, probeWidth)
      const leftDecorationWidth = Math.max(0, geometry.noteStartOffset)
      const rightDecorationWidth = Math.max(0, probeWidth - geometry.noteEndOffset)
      const leftAxisInset =
        (entry.preferMeasureStartBarlineAxis ? 0 : leftDecorationWidth) + uniformTickPadding.startPadPx
      const rightAxisInset = entry.preferMeasureEndBarlineAxis
        ? uniformTickPadding.endPadPx
        : rightDecorationWidth + 8 + uniformTickPadding.endPadPx
      // Keep fixed cost aligned with drawMeasure's axis start/end behavior.
      return Math.max(
        1,
        leftAxisInset + rightAxisInset,
      )
    })
    const totalTimelineWeight = measureTimelineWeightsBySystem.reduce((sum, weight) => sum + weight, 0)
    const safeTotalTimelineWeight = Math.max(0.0001, totalTimelineWeight)

    const buildMeasureWidthsFromFixed = (fixed: number[]): number[] => {
      const fixedTotal = fixed.reduce((sum, width) => sum + width, 0)
      if (fixedTotal >= systemUsableWidth) {
        return fixed.map((width) => (systemUsableWidth * width) / Math.max(1, fixedTotal))
      }
      const flexWidth = systemUsableWidth - fixedTotal
      return fixed.map(
        (fixedWidth, index) =>
          fixedWidth + (flexWidth * (measureTimelineWeightsBySystem[index] ?? 0.0001)) / safeTotalTimelineWeight,
      )
    }

    const spacingProbeDeltaCache = new Map<string, number | null>()
    const getMeasureSpacingDelta = (entry: (typeof systemMeta)[number], measureWidth: number): number | null => {
      const safeMeasureWidth = Math.max(1, Number(measureWidth.toFixed(3)))
      const cacheKey = `${entry.pairIndex}|${safeMeasureWidth.toFixed(3)}`
      if (spacingProbeDeltaCache.has(cacheKey)) {
        return spacingProbeDeltaCache.get(cacheKey) ?? null
      }
      const probeMeasureX = pagePaddingX
      const { spacingRightLimitX, formatWidth } = buildMeasureProbe(entry, probeMeasureX, safeMeasureWidth)
      const frozenSpacing = frozenSpacingByPairIndex.get(entry.pairIndex) ?? null
      const translatedFrozenSpacing =
        frozenSpacing !== null ? translateFrozenSpacingToMeasureX(frozenSpacing, probeMeasureX) : null
      const measureNoteLayouts = drawMeasureToContext({
        context,
        measure: entry.measure,
        pairIndex: entry.pairIndex,
        measureX: probeMeasureX,
        measureWidth: safeMeasureWidth,
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
        timeAxisSpacingConfig,
        staticNoteXById: translatedFrozenSpacing?.staticNoteXById ?? null,
        staticAccidentalRightXById: translatedFrozenSpacing?.staticAccidentalRightXById ?? null,
        // Probe with the same layout path used by final render so spacingRightX
        // and barline fit are computed from identical geometry.
        layoutDetail: 'full',
        preferMeasureEndBarlineAxis: entry.preferMeasureEndBarlineAxis,
        preferMeasureBarlineAxis: entry.preferMeasureStartBarlineAxis,
      })
      const spacingRightEdge = getMeasureSpacingRightEdge(measureNoteLayouts)
      if (!Number.isFinite(spacingRightEdge)) {
        spacingProbeDeltaCache.set(cacheKey, null)
        return null
      }
      const delta = spacingRightEdge - spacingRightLimitX
      spacingProbeDeltaCache.set(cacheKey, delta)
      return delta
    }

    let measureWidths = buildMeasureWidthsFromFixed(fixedWidths)
    for (let pass = 0; pass < OVERFLOW_ANALYSIS_MAX_PASSES; pass += 1) {
      let changed = false
      systemMeta.forEach((entry, indexInSystem) => {
        const overflow = getMeasureSpacingDelta(entry, measureWidths[indexInSystem] ?? 1)
        if (overflow === null || overflow <= 0.001) return
        fixedWidths[indexInSystem] = fixedWidths[indexInSystem] + overflow + OVERFLOW_RECOVERY_PAD_PX
        changed = true
      })
      if (!changed) break
      measureWidths = buildMeasureWidthsFromFixed(fixedWidths)
    }

    let measureCursorX = pagePaddingX
    systemMeta.forEach((entry, indexInSystem) => {
      const measureWidth = measureWidths[indexInSystem] ?? Math.floor(systemUsableWidth / systemMeasures.length)
      const measureX = measureCursorX
      measureCursorX += measureWidth
      const { noteStartX, noteEndX, formatWidth } = buildMeasureProbe(entry, measureX, measureWidth)
      const frozenSpacing = frozenSpacingByPairIndex.get(entry.pairIndex) ?? null
      const translatedFrozenSpacing =
        frozenSpacing !== null ? translateFrozenSpacingToMeasureX(frozenSpacing, measureX) : null
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
        timeAxisSpacingConfig,
        staticNoteXById: translatedFrozenSpacing?.staticNoteXById ?? null,
        staticAccidentalRightXById: translatedFrozenSpacing?.staticAccidentalRightXById ?? null,
        preferMeasureEndBarlineAxis: entry.preferMeasureEndBarlineAxis,
        preferMeasureBarlineAxis: entry.preferMeasureStartBarlineAxis,
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
        noteEndX,
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
