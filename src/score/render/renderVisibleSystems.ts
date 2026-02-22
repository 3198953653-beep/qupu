import { BarlineType, Renderer, Stave } from 'vexflow'
import {
  DURATION_TICKS,
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
  DEFAULT_TIME_AXIS_SPACING_CONFIG,
  getMeasureUniformTimelineWeightSpan,
  getUniformTickSpacingPadding,
  type TimeAxisSpacingConfig,
} from '../layout/timeAxisSpacing'
import type {
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
  StaffKind,
  TimeSignature,
} from '../types'

const OVERFLOW_ANALYSIS_MAX_PASSES = 6
const OVERFLOW_RECOVERY_PAD_PX = 2
const EDGE_REBALANCE_MAX_PASSES = 5
const EDGE_TARGET_GAP_RATIO = 0.82
const EDGE_TARGET_GAP_MAX_PX = 48
const EDGE_TRANSFER_DAMPING = 0.75
const EDGE_REBALANCE_EPSILON_PX = 0.5
const EDGE_SYSTEM_START_PRIORITY = 1.65
const MIN_TIMELINE_WEIGHT = 0.0001
const MIN_TIMELINE_WEIGHT_FRACTION = 0.35

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

type StableMeasureFrame = {
  measureX: number
  measureWidth: number
  noteStartX: number
  noteEndX: number
  formatWidth: number
}

function collectStableSystemMeasureFrames(
  systemMeta: Array<{ pairIndex: number }>,
  previousMeasureLayouts: Map<number, MeasureLayout> | null | undefined,
): StableMeasureFrame[] | null {
  if (!previousMeasureLayouts) return null
  const frames: StableMeasureFrame[] = []
  for (const entry of systemMeta) {
    const previousLayout = previousMeasureLayouts.get(entry.pairIndex)
    if (!previousLayout) return null
    frames.push({
      measureX: previousLayout.measureX,
      measureWidth: previousLayout.measureWidth,
      noteStartX: previousLayout.noteStartX,
      noteEndX: previousLayout.noteEndX,
      formatWidth: previousLayout.formatWidth,
    })
  }
  return frames
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

function getNoteDurationTicks(note: ScoreNote): number {
  const ticks = DURATION_TICKS[note.duration]
  if (!Number.isFinite(ticks)) return TICKS_PER_BEAT
  return Math.max(1, Math.round(ticks))
}

function buildStaffOnsetTicks(notes: ScoreNote[]): number[] {
  const onsetTicks: number[] = []
  let cursorTicks = 0
  notes.forEach((note) => {
    onsetTicks.push(cursorTicks)
    cursorTicks += getNoteDurationTicks(note)
  })
  return onsetTicks
}

export function renderVisibleSystems(params: {
  context: ReturnType<Renderer['getContext']>
  measurePairs: MeasurePair[]
  scoreWidth: number
  scoreHeight: number
  systemRanges: SystemMeasureRange[]
  visibleSystemRange: { start: number; end: number }
  renderOriginSystemIndex?: number
  visiblePairRange?: { startPairIndex: number; endPairIndexExclusive: number } | null
  clearViewportXRange?: { startX: number; endX: number } | null
  measureFramesByPair?: Array<{ measureX: number; measureWidth: number }> | null
  renderOffsetX?: number
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  activeSelection: Selection | null
  draggingSelection: Selection | null
  previousNoteLayoutsByPair?: Map<number, NoteLayout[]> | null
  previousMeasureLayouts?: Map<number, MeasureLayout> | null
  allowSelectionFreezeWhenNotDragging?: boolean
  layoutReflowHint?: LayoutReflowHint | null
  layoutStabilityKey?: string
  pagePaddingX?: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
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
    visiblePairRange = null,
    clearViewportXRange = null,
    measureFramesByPair = null,
    renderOffsetX = 0,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    activeSelection,
    draggingSelection,
    previousNoteLayoutsByPair = null,
    previousMeasureLayouts = null,
    allowSelectionFreezeWhenNotDragging = true,
    layoutReflowHint = null,
    layoutStabilityKey = '',
    pagePaddingX = SCORE_PAGE_PADDING_X,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
  } = params
  const spacingConfig = timeAxisSpacingConfig ?? DEFAULT_TIME_AXIS_SPACING_CONFIG

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
  const hintPairIndex = layoutReflowHint?.pairIndex ?? null
  const hintPairVisibleInCurrentWindow =
    hintPairIndex !== null
      ? (() => {
        if (
          visiblePairRange &&
          (hintPairIndex < visiblePairRange.startPairIndex ||
            hintPairIndex >= visiblePairRange.endPairIndexExclusive)
        ) {
          return false
        }
        for (let systemIndex = startSystem; systemIndex <= endSystem; systemIndex += 1) {
          const range = systemRanges[systemIndex]
          if (!range) continue
          if (hintPairIndex >= range.startPairIndex && hintPairIndex < range.endPairIndexExclusive) {
            return true
          }
        }
        return false
      })()
      : false
  // Horizontal virtual-window incremental paint can leave stale fragments
  // when drag-commit re-renders interleave with viewport/window updates.
  // Keep commit path deterministic: repaint the full visible window.
  const enableIncrementalPaint = false
  const shouldUseIncrementalPaint =
    enableIncrementalPaint &&
    layoutReflowHint !== null &&
    layoutReflowHint.layoutStabilityKey === layoutStabilityKey &&
    !layoutReflowHint.shouldReflow &&
    hintPairIndex !== null &&
    hintPairVisibleInCurrentWindow &&
    // Vertical view must repaint the visible page in one pass to avoid
    // stale or partially cleared canvas artifacts after drag commit.
    measureFramesByPair !== null &&
    previousNoteLayoutsByPair !== null &&
    previousMeasureLayouts !== null
  let didClearCanvas = false
  const clearRenderSurface = () => {
    if (clearViewportXRange) {
      const x = Math.max(0, Math.floor(clearViewportXRange.startX))
      const right = Math.min(scoreWidth, Math.ceil(clearViewportXRange.endX))
      const width = Math.max(0, right - x)
      if (width > 0) {
        context.clearRect(x, 0, width, scoreHeight)
      }
    } else {
      context.clearRect(0, 0, scoreWidth, scoreHeight)
    }
    didClearCanvas = true
  }
  if (!shouldUseIncrementalPaint) {
    clearRenderSurface()
  }

  for (let systemIndex = startSystem; systemIndex <= endSystem; systemIndex += 1) {
    const range = systemRanges[systemIndex]
    if (!range) continue
    const systemStartPairIndex = range.startPairIndex
    const systemEndPairIndexExclusive = Math.max(systemStartPairIndex, range.endPairIndexExclusive)
    if (systemEndPairIndexExclusive <= systemStartPairIndex) continue

    const renderStartPairIndex = visiblePairRange
      ? Math.max(systemStartPairIndex, visiblePairRange.startPairIndex)
      : systemStartPairIndex
    const renderEndPairIndexExclusive = visiblePairRange
      ? Math.min(systemEndPairIndexExclusive, visiblePairRange.endPairIndexExclusive)
      : systemEndPairIndexExclusive
    if (renderEndPairIndexExclusive <= renderStartPairIndex) continue

    const systemTop = SCORE_TOP_PADDING + (systemIndex - renderOriginSystemIndex) * (SYSTEM_HEIGHT + SYSTEM_GAP_Y)
    const trebleY = systemTop + SYSTEM_TREBLE_OFFSET_Y
    const bassY = systemTop + SYSTEM_BASS_OFFSET_Y
    const systemUsableWidth = Math.max(1, scoreWidth - pagePaddingX * 2)

    const systemMeta: Array<{
      pairIndex: number
      measure: MeasurePair
      isSystemStart: boolean
      keyFifths: number
      showKeySignature: boolean
      timeSignature: TimeSignature
      showTimeSignature: boolean
      nextTimeSignature: TimeSignature
      showEndTimeSignature: boolean
      includeMeasureStartDecorations: boolean
      preferMeasureStartBarlineAxis: boolean
      preferMeasureEndBarlineAxis: boolean
    }> = []
    for (let pairIndex = renderStartPairIndex; pairIndex < renderEndPairIndexExclusive; pairIndex += 1) {
      const measure = measurePairs[pairIndex]
      if (!measure) continue
      const isSystemStart = pairIndex === systemStartPairIndex
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
      const isSystemEnd = pairIndex === systemEndPairIndexExclusive - 1
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
      systemMeta.push({
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
      })
    }
    if (systemMeta.length === 0) continue
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

    const shouldSkipSystemReflow =
      layoutReflowHint !== null &&
      layoutReflowHint.layoutStabilityKey === layoutStabilityKey &&
      !layoutReflowHint.shouldReflow &&
      systemMeta.some((entry) => entry.pairIndex === layoutReflowHint.pairIndex)
    const incrementalPairIndex = shouldUseIncrementalPaint ? hintPairIndex : null
    if (measureFramesByPair !== null) {
      systemMeta.forEach((entry) => {
        if (incrementalPairIndex !== null && entry.pairIndex !== incrementalPairIndex) {
          const previousLayouts = previousNoteLayoutsByPair?.get(entry.pairIndex)
          const previousMeasureLayout = previousMeasureLayouts?.get(entry.pairIndex)
          if (previousLayouts && previousMeasureLayout) {
            nextLayouts.push(...previousLayouts)
            nextLayoutsByPair.set(entry.pairIndex, previousLayouts)
            previousLayouts.forEach((layout) => {
              nextLayoutsByKey.set(getLayoutNoteKey(layout.staff, layout.id), layout)
            })
            nextMeasureLayouts.set(entry.pairIndex, previousMeasureLayout)
            return
          }
        }

        const frame = measureFramesByPair[entry.pairIndex]
        if (!frame) return
        const measureX = frame.measureX - renderOffsetX
        const measureWidth = Math.max(1, frame.measureWidth)
        const { noteStartX, noteEndX, formatWidth } = buildMeasureProbe(entry, measureX, measureWidth)
        const frozenSpacing = frozenSpacingByPairIndex.get(entry.pairIndex) ?? null
        const translatedFrozenSpacing =
          frozenSpacing !== null ? translateFrozenSpacingToMeasureX(frozenSpacing, measureX) : null
        if (incrementalPairIndex !== null) {
          const previousMeasureLayout = previousMeasureLayouts?.get(entry.pairIndex)
          const clearRect = previousMeasureLayout?.overlayRect
          if (clearRect) {
            context.save()
            context.clearRect(clearRect.x, clearRect.y, clearRect.width, clearRect.height)
            context.setFillStyle('#ffffff')
            context.fillRect(clearRect.x, clearRect.y, clearRect.width, clearRect.height)
            context.restore()
          }
        }

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
          timeAxisSpacingConfig: spacingConfig,
          spacingLayoutMode,
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
      continue
    }
    const stableSystemFrames = shouldSkipSystemReflow
      ? collectStableSystemMeasureFrames(systemMeta, previousMeasureLayouts)
      : null
    if (!stableSystemFrames && !didClearCanvas) {
      clearRenderSurface()
    }
    if (stableSystemFrames) {
      systemMeta.forEach((entry, indexInSystem) => {
        if (incrementalPairIndex !== null && entry.pairIndex !== incrementalPairIndex) {
          const previousLayouts = previousNoteLayoutsByPair?.get(entry.pairIndex)
          const previousMeasureLayout = previousMeasureLayouts?.get(entry.pairIndex)
          if (previousLayouts && previousMeasureLayout) {
            nextLayouts.push(...previousLayouts)
            nextLayoutsByPair.set(entry.pairIndex, previousLayouts)
            previousLayouts.forEach((layout) => {
              nextLayoutsByKey.set(getLayoutNoteKey(layout.staff, layout.id), layout)
            })
            nextMeasureLayouts.set(entry.pairIndex, previousMeasureLayout)
            return
          }
        }

        const stableFrame = stableSystemFrames[indexInSystem]
        const measureX = stableFrame.measureX
        const measureWidth = stableFrame.measureWidth
        const noteStartX = stableFrame.noteStartX
        const noteEndX = stableFrame.noteEndX
        const formatWidth = stableFrame.formatWidth
        const frozenSpacing = tryBuildFrozenMeasureSpacing({
          pairIndex: entry.pairIndex,
          measure: entry.measure,
          previousNoteLayoutsByPair,
          previousMeasureLayouts,
        })
        const translatedFrozenSpacing =
          frozenSpacing !== null ? translateFrozenSpacingToMeasureX(frozenSpacing, measureX) : null
        if (incrementalPairIndex !== null) {
          const previousMeasureLayout = previousMeasureLayouts?.get(entry.pairIndex)
          const clearRect = previousMeasureLayout?.overlayRect
          if (clearRect) {
            context.save()
            context.clearRect(clearRect.x, clearRect.y, clearRect.width, clearRect.height)
            context.setFillStyle('#ffffff')
            context.fillRect(clearRect.x, clearRect.y, clearRect.width, clearRect.height)
            context.restore()
          }
        }
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
          timeAxisSpacingConfig: spacingConfig,
          spacingLayoutMode,
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
      continue
    }
    const measureTicksBySystem = systemMeta.map((entry) =>
      Math.max(1, Math.round(entry.timeSignature.beats * TICKS_PER_BEAT * (4 / entry.timeSignature.beatType))),
    )
    const measureTimelineWeightsBySystem = systemMeta.map((entry, indexInSystem) =>
      getMeasureUniformTimelineWeightSpan(
        entry.measure,
        measureTicksBySystem[indexInSystem] ?? 1,
        spacingConfig,
      ),
    )
    const probeWidth = Math.max(140, Math.floor(systemUsableWidth / Math.max(1, systemMeta.length)))
    const uniformTickPadding = getUniformTickSpacingPadding(spacingConfig)
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
    const onsetTicksByPairIndex = new Map<number, { treble: number[]; bass: number[] }>()
    systemMeta.forEach((entry) => {
      onsetTicksByPairIndex.set(entry.pairIndex, {
        treble: buildStaffOnsetTicks(entry.measure.treble),
        bass: buildStaffOnsetTicks(entry.measure.bass),
      })
    })

    let adaptiveTimelineWeights = measureTimelineWeightsBySystem.map((weight) =>
      Math.max(MIN_TIMELINE_WEIGHT, weight),
    )
    const timelineWeightFloors = measureTimelineWeightsBySystem.map((weight) =>
      Math.max(MIN_TIMELINE_WEIGHT, weight * MIN_TIMELINE_WEIGHT_FRACTION),
    )

    const buildMeasureWidthsFromFixed = (fixed: number[], weights: number[]): number[] => {
      const fixedTotal = fixed.reduce((sum, width) => sum + width, 0)
      const safeWeights = weights.map((weight) => Math.max(MIN_TIMELINE_WEIGHT, weight))
      const safeTotalTimelineWeight = Math.max(
        MIN_TIMELINE_WEIGHT,
        safeWeights.reduce((sum, weight) => sum + weight, 0),
      )
      if (fixedTotal >= systemUsableWidth) {
        return fixed.map((width) => (systemUsableWidth * width) / Math.max(1, fixedTotal))
      }
      const flexWidth = systemUsableWidth - fixedTotal
      return fixed.map(
        (fixedWidth, index) =>
          fixedWidth + (flexWidth * (safeWeights[index] ?? MIN_TIMELINE_WEIGHT)) / safeTotalTimelineWeight,
      )
    }

    const getMeasureLastInternalGapPx = (
      entry: (typeof systemMeta)[number],
      measureNoteLayouts: NoteLayout[],
    ): number | null => {
      if (measureNoteLayouts.length < 2) return null
      const onsetTicks = onsetTicksByPairIndex.get(entry.pairIndex)
      if (!onsetTicks) return null
      const onsetBuckets = new Map<number, { xTotal: number; xCount: number }>()
      measureNoteLayouts.forEach((layout) => {
        const onset =
          layout.staff === 'treble'
            ? onsetTicks.treble[layout.noteIndex]
            : onsetTicks.bass[layout.noteIndex]
        if (!Number.isFinite(onset) || !Number.isFinite(layout.x)) return
        const bucket = onsetBuckets.get(onset) ?? { xTotal: 0, xCount: 0 }
        bucket.xTotal += layout.x
        bucket.xCount += 1
        onsetBuckets.set(onset, bucket)
      })
      const orderedOnsetXs = [...onsetBuckets.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([, bucket]) => (bucket.xCount > 0 ? bucket.xTotal / bucket.xCount : Number.NaN))
        .filter((x) => Number.isFinite(x))
      if (orderedOnsetXs.length < 2) return null
      const lastGap = orderedOnsetXs[orderedOnsetXs.length - 1] - orderedOnsetXs[orderedOnsetXs.length - 2]
      return Number.isFinite(lastGap) && lastGap > 0.001 ? lastGap : null
    }

    type MeasureProbeStats = {
      overflowPx: number | null
      rightGapPx: number | null
      lastInternalGapPx: number | null
    }

    const measureProbeStatsCache = new Map<string, MeasureProbeStats>()
    const getMeasureProbeStats = (
      entry: (typeof systemMeta)[number],
      measureWidth: number,
    ): MeasureProbeStats => {
      const safeMeasureWidth = Math.max(1, Number(measureWidth.toFixed(3)))
      const cacheKey = `${entry.pairIndex}|${safeMeasureWidth.toFixed(3)}`
      const cached = measureProbeStatsCache.get(cacheKey)
      if (cached) {
        return cached
      }
      const probeMeasureX = pagePaddingX
      const { spacingRightLimitX, formatWidth } = buildMeasureProbe(entry, probeMeasureX, safeMeasureWidth)
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
        timeAxisSpacingConfig: spacingConfig,
        spacingLayoutMode,
        // Width probing must be fully deterministic by score content only.
        // Do not feed previous-frame frozen spacing into the probe solver.
        staticNoteXById: null,
        staticAccidentalRightXById: null,
        // Probe with the same layout path used by final render so spacingRightX
        // and barline fit are computed from identical geometry.
        layoutDetail: 'full',
        preferMeasureEndBarlineAxis: entry.preferMeasureEndBarlineAxis,
        preferMeasureBarlineAxis: entry.preferMeasureStartBarlineAxis,
      })
      const spacingRightEdge = getMeasureSpacingRightEdge(measureNoteLayouts)
      if (!Number.isFinite(spacingRightEdge)) {
        const stats: MeasureProbeStats = { overflowPx: null, rightGapPx: null, lastInternalGapPx: null }
        measureProbeStatsCache.set(cacheKey, stats)
        return stats
      }
      const stats: MeasureProbeStats = {
        overflowPx: spacingRightEdge - spacingRightLimitX,
        rightGapPx: spacingRightLimitX - spacingRightEdge,
        lastInternalGapPx: getMeasureLastInternalGapPx(entry, measureNoteLayouts),
      }
      measureProbeStatsCache.set(cacheKey, stats)
      return stats
    }

    const runOverflowRecovery = (): void => {
      for (let pass = 0; pass < OVERFLOW_ANALYSIS_MAX_PASSES; pass += 1) {
        let changed = false
        systemMeta.forEach((entry, indexInSystem) => {
          const stats = getMeasureProbeStats(entry, measureWidths[indexInSystem] ?? 1)
          const overflow = stats.overflowPx
          if (overflow === null || overflow <= 0.001) return
          fixedWidths[indexInSystem] = fixedWidths[indexInSystem] + overflow + OVERFLOW_RECOVERY_PAD_PX
          changed = true
        })
        if (!changed) break
        measureWidths = buildMeasureWidthsFromFixed(fixedWidths, adaptiveTimelineWeights)
      }
    }

    let measureWidths = buildMeasureWidthsFromFixed(fixedWidths, adaptiveTimelineWeights)
    runOverflowRecovery()

    for (let pass = 0; pass < EDGE_REBALANCE_MAX_PASSES; pass += 1) {
      const deficits = new Array<number>(systemMeta.length).fill(0)
      const surpluses = new Array<number>(systemMeta.length).fill(0)
      let totalDeficit = 0
      let totalSurplus = 0
      let maxDeficit = 0

      systemMeta.forEach((entry, indexInSystem) => {
        const stats = getMeasureProbeStats(entry, measureWidths[indexInSystem] ?? 1)
        const rightGapPx = stats.rightGapPx
        if (rightGapPx === null || !Number.isFinite(rightGapPx)) return
        const baseTargetGap =
          stats.lastInternalGapPx !== null && Number.isFinite(stats.lastInternalGapPx)
            ? stats.lastInternalGapPx * EDGE_TARGET_GAP_RATIO
            : spacingConfig.rightEdgePaddingPx
        const targetRightGap = Math.max(
          spacingConfig.rightEdgePaddingPx,
          Math.min(EDGE_TARGET_GAP_MAX_PX, baseTargetGap),
        )
        const priority = entry.isSystemStart ? EDGE_SYSTEM_START_PRIORITY : 1
        const deficit = Math.max(0, targetRightGap - rightGapPx) * priority
        const surplus = Math.max(0, rightGapPx - targetRightGap)
        deficits[indexInSystem] = deficit
        surpluses[indexInSystem] = surplus
        totalDeficit += deficit
        totalSurplus += surplus
        maxDeficit = Math.max(maxDeficit, deficit)
      })

      if (
        maxDeficit <= EDGE_REBALANCE_EPSILON_PX ||
        totalDeficit <= 0.001 ||
        totalSurplus <= 0.001
      ) {
        break
      }

      const fixedTotal = fixedWidths.reduce((sum, width) => sum + width, 0)
      const flexWidth = Math.max(0, systemUsableWidth - fixedTotal)
      if (flexWidth <= 0.001) break
      const safeWeights = adaptiveTimelineWeights.map((weight) => Math.max(MIN_TIMELINE_WEIGHT, weight))
      const safeWeightTotal = Math.max(
        MIN_TIMELINE_WEIGHT,
        safeWeights.reduce((sum, weight) => sum + weight, 0),
      )
      const pxPerWeight = flexWidth / safeWeightTotal
      if (!Number.isFinite(pxPerWeight) || pxPerWeight <= 0.0001) break

      const transferablePx = Math.min(totalDeficit, totalSurplus) * EDGE_TRANSFER_DAMPING
      const weightMass = transferablePx / pxPerWeight
      if (!Number.isFinite(weightMass) || weightMass <= 0.0001) break

      let changed = false
      const safeDeficitTotal = Math.max(0.0001, totalDeficit)
      const safeSurplusTotal = Math.max(0.0001, totalSurplus)
      for (let indexInSystem = 0; indexInSystem < systemMeta.length; indexInSystem += 1) {
        const addWeight = weightMass * (deficits[indexInSystem] / safeDeficitTotal)
        const removeWeight = weightMass * (surpluses[indexInSystem] / safeSurplusTotal)
        const currentWeight = safeWeights[indexInSystem] ?? MIN_TIMELINE_WEIGHT
        const minWeightFloor = timelineWeightFloors[indexInSystem] ?? MIN_TIMELINE_WEIGHT
        const nextWeight = Math.max(minWeightFloor, currentWeight + addWeight - removeWeight)
        if (Math.abs(nextWeight - currentWeight) > 0.0001) changed = true
        adaptiveTimelineWeights[indexInSystem] = nextWeight
      }
      if (!changed) break

      measureWidths = buildMeasureWidthsFromFixed(fixedWidths, adaptiveTimelineWeights)
      runOverflowRecovery()
    }

    let measureCursorX = pagePaddingX
    systemMeta.forEach((entry, indexInSystem) => {
      const measureWidth = measureWidths[indexInSystem] ?? Math.floor(systemUsableWidth / Math.max(1, systemMeta.length))
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
        timeAxisSpacingConfig: spacingConfig,
        spacingLayoutMode,
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
