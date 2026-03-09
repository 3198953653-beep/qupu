import { BarlineType, Renderer, Stave } from 'vexflow'
import {
  SCORE_PAGE_PADDING_X,
  SCORE_TOP_PADDING,
  SYSTEM_BASS_OFFSET_Y,
  DURATION_TICKS,
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
import { drawCrossMeasureTies } from './drawCrossMeasureTies'
import { buildDragPreviewOverrides } from './dragPreviewOverrides'
import {
  DEFAULT_TIME_AXIS_SPACING_CONFIG,
  attachMeasureTimelineAxisLayout,
  buildMeasureTimelineBundle,
  getMeasureUniformTimelineWeightSpan,
  getUniformTickSpacingPadding,
  type TimeAxisSpacingConfig,
} from '../layout/timeAxisSpacing'
import { resolveEffectiveBoundary } from '../layout/effectiveBoundary'
import type { MeasureTimelineBundle } from '../timeline/types'
import type {
  DragState,
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

const OVERFLOW_ANALYSIS_MAX_PASSES = 16
const OVERFLOW_RECOVERY_PAD_PX = 2
const EDGE_EXCESS_SHRINK_MAX_STEP_PX = 48
const MIN_TIMELINE_WEIGHT = 0.0001
const MIN_FORMAT_WIDTH_PX = 8

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

function getLayoutOnsetAnchorXs(layouts: NoteLayout[], measure: MeasurePair): number[] {
  const onsetByNoteKey = new Map<string, number>()
  let trebleTicks = 0
  measure.treble.forEach((note, noteIndex) => {
    onsetByNoteKey.set(`treble:${noteIndex}`, trebleTicks)
    trebleTicks += DURATION_TICKS[note.duration] ?? 16
  })
  let bassTicks = 0
  measure.bass.forEach((note, noteIndex) => {
    onsetByNoteKey.set(`bass:${noteIndex}`, bassTicks)
    bassTicks += DURATION_TICKS[note.duration] ?? 16
  })

  const onsetXMap = new Map<number, number>()
  layouts.forEach((layout) => {
    const onsetTicks = onsetByNoteKey.get(`${layout.staff}:${layout.noteIndex}`)
    if (onsetTicks === undefined || !Number.isFinite(layout.x)) return
    const current = onsetXMap.get(onsetTicks)
    onsetXMap.set(onsetTicks, current === undefined ? layout.x : Math.min(current, layout.x))
  })

  return [...onsetXMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1])
}

function getMeasureEdgeExcessPx(params: {
  layouts: NoteLayout[]
  measure: MeasurePair
  leftBoundaryX: number
  rightBoundaryX: number
  maxBarlineEdgeGapPx: number
}): number {
  const {
    layouts,
    measure,
    leftBoundaryX,
    rightBoundaryX,
    maxBarlineEdgeGapPx,
  } = params
  if (!Number.isFinite(maxBarlineEdgeGapPx)) return 0
  if (!Number.isFinite(leftBoundaryX) || !Number.isFinite(rightBoundaryX) || leftBoundaryX >= rightBoundaryX) return 0
  const maxGap = Math.max(0, maxBarlineEdgeGapPx)
  const onsetAnchors = getLayoutOnsetAnchorXs(layouts, measure)
  if (onsetAnchors.length === 0) return 0
  const firstX = onsetAnchors[0]
  const lastX = onsetAnchors[onsetAnchors.length - 1]
  if (!Number.isFinite(firstX) || !Number.isFinite(lastX)) return 0
  const leftGap = firstX - leftBoundaryX
  const rightGap = rightBoundaryX - lastX
  if (!Number.isFinite(leftGap) || !Number.isFinite(rightGap)) return 0
  const leftExcess = Math.max(0, leftGap - maxGap)
  const rightExcess = Math.max(0, rightGap - maxGap)
  return leftExcess + rightExcess
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
  activeSelections?: Selection[] | null
  draggingSelections?: Selection[] | null
  previousNoteLayoutsByPair?: Map<number, NoteLayout[]> | null
  previousMeasureLayouts?: Map<number, MeasureLayout> | null
  allowSelectionFreezeWhenNotDragging?: boolean
  layoutReflowHint?: LayoutReflowHint | null
  layoutStabilityKey?: string
  pagePaddingX?: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
  dragPreview?: DragState | null
}): {
  nextLayouts: NoteLayout[]
  nextLayoutsByPair: Map<number, NoteLayout[]>
  nextLayoutsByKey: Map<string, NoteLayout>
  nextMeasureLayouts: Map<number, MeasureLayout>
  nextTimelineBundlesByPair: Map<number, MeasureTimelineBundle>
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
    activeSelections = null,
    draggingSelections = null,
    previousNoteLayoutsByPair = null,
    previousMeasureLayouts = null,
    allowSelectionFreezeWhenNotDragging = true,
    layoutReflowHint = null,
    layoutStabilityKey = '',
    pagePaddingX = SCORE_PAGE_PADDING_X,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
    dragPreview = null,
  } = params
  const spacingConfig = timeAxisSpacingConfig ?? DEFAULT_TIME_AXIS_SPACING_CONFIG
  const {
    previewNotesByPair: dragPreviewOverridesByPair,
    previewPitchByTargetKey: dragPreviewPitchByTargetKey,
    previewFrozenBoundaryCurve: dragPreviewFrozenBoundaryCurve,
    suppressedTieStartKeys: dragPreviewSuppressedTieStartKeys,
    suppressedTieStopKeys: dragPreviewSuppressedTieStopKeys,
  } = buildDragPreviewOverrides({ drag: dragPreview })

  const nextLayouts: NoteLayout[] = []
  const nextLayoutsByPair = new Map<number, NoteLayout[]>()
  const nextLayoutsByKey = new Map<string, NoteLayout>()
  const nextMeasureLayouts = new Map<number, MeasureLayout>()
  const nextTimelineBundlesByPair = new Map<number, MeasureTimelineBundle>()
  if (systemRanges.length === 0) {
    context.clearRect(0, 0, scoreWidth, scoreHeight)
    return {
      nextLayouts,
      nextLayoutsByPair,
      nextLayoutsByKey,
      nextMeasureLayouts,
      nextTimelineBundlesByPair,
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
    const systemTimelineBundles = new Map<number, MeasureTimelineBundle>()
    systemMeta.forEach((entry) => {
      systemTimelineBundles.set(
        entry.pairIndex,
        buildMeasureTimelineBundle({
          measure: entry.measure,
          measureIndex: entry.pairIndex,
          timeSignature: entry.timeSignature,
          spacingConfig,
          timelineMode: 'dual',
        }),
      )
    })

    const drawCrossMeasureTiesForSystem = () => {
      const startPairIndex = systemMeta[0]?.pairIndex ?? 0
      const endPairIndexExclusive = (systemMeta[systemMeta.length - 1]?.pairIndex ?? startPairIndex - 1) + 1
      drawCrossMeasureTies({
        context,
        measurePairs,
        noteLayoutsByPair: nextLayoutsByPair,
        measureLayouts: nextMeasureLayouts,
        startPairIndex,
        endPairIndexExclusive,
        previewPitchByTargetKey: dragPreviewPitchByTargetKey,
        previewFrozenBoundaryCurve: dragPreviewFrozenBoundaryCurve,
        suppressedTieStartKeys: dragPreviewSuppressedTieStartKeys,
        suppressedTieStopKeys: dragPreviewSuppressedTieStopKeys,
        allowBoundaryPartialTies: !(dragPreview && dragPreview.previewStarted),
      })
    }
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
      const rawNoteStartOffset = noteStartProbe.getNoteStartX()
      const rawNoteEndOffset = noteStartProbe.getNoteEndX()
      const noteStartOffset = entry.preferMeasureStartBarlineAxis ? 0 : rawNoteStartOffset
      const noteEndOffset = rawNoteEndOffset
      const formatWidth = Math.max(MIN_FORMAT_WIDTH_PX, noteEndOffset - noteStartOffset - 8)
      const geometry = { noteStartOffset, noteEndOffset, formatWidth }
      probeGeometryCache.set(cacheKey, geometry)
      return geometry
    }
    const buildMeasureProbe = (entry: (typeof systemMeta)[number], measureX: number, measureWidth: number) => {
      const geometry = getMeasureProbeGeometry(entry, measureWidth)
      const measureEndX = measureX + measureWidth
      const noteStartX = measureX + geometry.noteStartOffset
      const noteEndX = measureX + geometry.noteEndOffset
      return {
        noteStartX,
        noteEndX,
        spacingLeftLimitX: entry.preferMeasureStartBarlineAxis ? measureX : noteStartX,
        spacingRightLimitX: entry.preferMeasureEndBarlineAxis ? measureEndX : noteEndX,
        formatWidth: geometry.formatWidth,
      }
    }
    const attachTimelineBundleForMeasure = (params: {
      pairIndex: number
      effectiveBoundaryStartX: number
      effectiveBoundaryEndX: number
      widthPx: number
    }) => {
      const baseBundle = systemTimelineBundles.get(params.pairIndex)
      if (!baseBundle) return
      nextTimelineBundlesByPair.set(
        params.pairIndex,
        attachMeasureTimelineAxisLayout({
          bundle: baseBundle,
          effectiveBoundaryStartX: params.effectiveBoundaryStartX,
          effectiveBoundaryEndX: params.effectiveBoundaryEndX,
          widthPx: params.widthPx,
          spacingConfig,
        }),
      )
    }
    const buildTimelineBundleForRender = (params: {
      entry: (typeof systemMeta)[number]
      measureX: number
      measureWidth: number
      noteStartX: number
      noteEndX: number
    }): MeasureTimelineBundle | null => {
      const { entry, measureX, measureWidth, noteStartX, noteEndX } = params
      const baseBundle = systemTimelineBundles.get(entry.pairIndex)
      if (!baseBundle) return null
      const effectiveBoundary = resolveEffectiveBoundary({
        measureX,
        measureWidth,
        noteStartX,
        noteEndX,
        showStartDecorations: !entry.preferMeasureStartBarlineAxis,
        showEndDecorations: !entry.preferMeasureEndBarlineAxis,
      })
      const timelineBundle = attachMeasureTimelineAxisLayout({
        bundle: baseBundle,
        effectiveBoundaryStartX: effectiveBoundary.effectiveStartX,
        effectiveBoundaryEndX: effectiveBoundary.effectiveEndX,
        widthPx: measureWidth,
        spacingConfig,
      })
      nextTimelineBundlesByPair.set(entry.pairIndex, timelineBundle)
      return timelineBundle
    }
    const resolveEffectiveLayoutMetrics = (params: {
      measureX: number
      measureWidth: number
      noteStartX: number
      noteEndX: number
      showStartDecorations: boolean
      showEndDecorations: boolean
      spacingMetrics:
        | {
            effectiveBoundaryStartX: number
            effectiveBoundaryEndX: number
            effectiveLeftGapPx: number
            effectiveRightGapPx: number
          }
        | null
        | undefined
    }) => {
      const {
        measureX,
        measureWidth,
        noteStartX,
        noteEndX,
        showStartDecorations,
        showEndDecorations,
        spacingMetrics,
      } = params
      if (
        spacingMetrics &&
        Number.isFinite(spacingMetrics.effectiveBoundaryStartX) &&
        Number.isFinite(spacingMetrics.effectiveBoundaryEndX) &&
        Number.isFinite(spacingMetrics.effectiveLeftGapPx) &&
        Number.isFinite(spacingMetrics.effectiveRightGapPx)
      ) {
        return spacingMetrics
      }
      const fallbackBoundary = resolveEffectiveBoundary({
        measureX,
        measureWidth,
        noteStartX,
        noteEndX,
        showStartDecorations,
        showEndDecorations,
      })
      return {
        effectiveBoundaryStartX: fallbackBoundary.effectiveStartX,
        effectiveBoundaryEndX: fallbackBoundary.effectiveEndX,
        effectiveLeftGapPx: Number.NaN,
        effectiveRightGapPx: Number.NaN,
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
        const previewNotes = dragPreviewOverridesByPair.get(entry.pairIndex) ?? null
        const hasAnyPreviewInPair = Boolean(previewNotes && previewNotes.length > 0)
        const isPrimaryDragPreviewPair =
          dragPreview !== null &&
          dragPreview.previewStarted &&
          dragPreview.pairIndex === entry.pairIndex
        const previewAccidentalStateBeforeNote = hasAnyPreviewInPair
          ? (dragPreview?.accidentalStateBeforeNote ?? null)
          : null
        const previewStaticNoteXById = isPrimaryDragPreviewPair ? dragPreview.staticNoteXById : null
        const previewStaticAccidentalRightXById = isPrimaryDragPreviewPair
          ? dragPreview.previewAccidentalRightXById
          : null
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
            attachTimelineBundleForMeasure({
              pairIndex: entry.pairIndex,
              effectiveBoundaryStartX:
                previousMeasureLayout.effectiveBoundaryStartX ?? previousMeasureLayout.measureX,
              effectiveBoundaryEndX:
                previousMeasureLayout.effectiveBoundaryEndX ??
                previousMeasureLayout.measureX + previousMeasureLayout.measureWidth,
              widthPx: previousMeasureLayout.measureWidth,
            })
            return
          }
        }

        const frame = measureFramesByPair[entry.pairIndex]
        if (!frame) return
        const measureX = frame.measureX - renderOffsetX
        const measureWidth = Math.max(1, frame.measureWidth)
        const { noteStartX, noteEndX, formatWidth } = buildMeasureProbe(entry, measureX, measureWidth)
        const timelineBundle = buildTimelineBundleForRender({
          entry,
          measureX,
          measureWidth,
          noteStartX,
          noteEndX,
        })
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

        let spacingMetrics:
          | {
              effectiveBoundaryStartX: number
              effectiveBoundaryEndX: number
              effectiveLeftGapPx: number
              effectiveRightGapPx: number
            }
          | null = null
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
          activeSelections,
          draggingSelections,
          formatWidthOverride: formatWidth,
          timeAxisSpacingConfig: spacingConfig,
          spacingLayoutMode,
          publicAxisLayout: timelineBundle?.publicAxisLayout ?? null,
          staticNoteXById: previewStaticNoteXById ?? translatedFrozenSpacing?.staticNoteXById ?? null,
          staticAccidentalRightXById:
            previewStaticAccidentalRightXById ?? translatedFrozenSpacing?.staticAccidentalRightXById ?? null,
          previewNotes,
          previewAccidentalStateBeforeNote,
          previewFrozenBoundaryCurve: dragPreviewFrozenBoundaryCurve,
          suppressedTieStartKeys: dragPreviewSuppressedTieStartKeys,
          suppressedTieStopKeys: dragPreviewSuppressedTieStopKeys,
          preferMeasureEndBarlineAxis: entry.preferMeasureEndBarlineAxis,
          preferMeasureBarlineAxis: entry.preferMeasureStartBarlineAxis,
          onSpacingMetrics: (metrics) => {
            spacingMetrics = metrics
          },
          renderBoundaryPartialTies: false,
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
        const effectiveLayoutMetrics = resolveEffectiveLayoutMetrics({
          measureX,
          measureWidth,
          noteStartX,
          noteEndX,
          showStartDecorations: !entry.preferMeasureStartBarlineAxis,
          showEndDecorations: !entry.preferMeasureEndBarlineAxis,
          spacingMetrics,
        })
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
          effectiveBoundaryStartX: effectiveLayoutMetrics.effectiveBoundaryStartX,
          effectiveBoundaryEndX: effectiveLayoutMetrics.effectiveBoundaryEndX,
          effectiveLeftGapPx: effectiveLayoutMetrics.effectiveLeftGapPx,
          effectiveRightGapPx: effectiveLayoutMetrics.effectiveRightGapPx,
          overlayRect,
        })
        attachTimelineBundleForMeasure({
          pairIndex: entry.pairIndex,
          effectiveBoundaryStartX: effectiveLayoutMetrics.effectiveBoundaryStartX,
          effectiveBoundaryEndX: effectiveLayoutMetrics.effectiveBoundaryEndX,
          widthPx: measureWidth,
        })
      })
      drawCrossMeasureTiesForSystem()
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
        const previewNotes = dragPreviewOverridesByPair.get(entry.pairIndex) ?? null
        const hasAnyPreviewInPair = Boolean(previewNotes && previewNotes.length > 0)
        const isPrimaryDragPreviewPair =
          dragPreview !== null &&
          dragPreview.previewStarted &&
          dragPreview.pairIndex === entry.pairIndex
        const previewAccidentalStateBeforeNote = hasAnyPreviewInPair
          ? (dragPreview?.accidentalStateBeforeNote ?? null)
          : null
        const previewStaticNoteXById = isPrimaryDragPreviewPair ? dragPreview.staticNoteXById : null
        const previewStaticAccidentalRightXById = isPrimaryDragPreviewPair
          ? dragPreview.previewAccidentalRightXById
          : null
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
            attachTimelineBundleForMeasure({
              pairIndex: entry.pairIndex,
              effectiveBoundaryStartX:
                previousMeasureLayout.effectiveBoundaryStartX ?? previousMeasureLayout.measureX,
              effectiveBoundaryEndX:
                previousMeasureLayout.effectiveBoundaryEndX ??
                previousMeasureLayout.measureX + previousMeasureLayout.measureWidth,
              widthPx: previousMeasureLayout.measureWidth,
            })
            return
          }
        }

        const stableFrame = stableSystemFrames[indexInSystem]
        const measureX = stableFrame.measureX
        const measureWidth = stableFrame.measureWidth
        const noteStartX = stableFrame.noteStartX
        const noteEndX = stableFrame.noteEndX
        const formatWidth = stableFrame.formatWidth
        const timelineBundle = buildTimelineBundleForRender({
          entry,
          measureX,
          measureWidth,
          noteStartX,
          noteEndX,
        })
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
        let spacingMetrics:
          | {
              effectiveBoundaryStartX: number
              effectiveBoundaryEndX: number
              effectiveLeftGapPx: number
              effectiveRightGapPx: number
            }
          | null = null
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
          activeSelections,
          draggingSelections,
          formatWidthOverride: formatWidth,
          timeAxisSpacingConfig: spacingConfig,
          spacingLayoutMode,
          publicAxisLayout: timelineBundle?.publicAxisLayout ?? null,
          staticNoteXById: previewStaticNoteXById ?? translatedFrozenSpacing?.staticNoteXById ?? null,
          staticAccidentalRightXById:
            previewStaticAccidentalRightXById ?? translatedFrozenSpacing?.staticAccidentalRightXById ?? null,
          previewNotes,
          previewAccidentalStateBeforeNote,
          previewFrozenBoundaryCurve: dragPreviewFrozenBoundaryCurve,
          suppressedTieStartKeys: dragPreviewSuppressedTieStartKeys,
          suppressedTieStopKeys: dragPreviewSuppressedTieStopKeys,
          preferMeasureEndBarlineAxis: entry.preferMeasureEndBarlineAxis,
          preferMeasureBarlineAxis: entry.preferMeasureStartBarlineAxis,
          onSpacingMetrics: (metrics) => {
            spacingMetrics = metrics
          },
          renderBoundaryPartialTies: false,
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
        const effectiveLayoutMetrics = resolveEffectiveLayoutMetrics({
          measureX,
          measureWidth,
          noteStartX,
          noteEndX,
          showStartDecorations: !entry.preferMeasureStartBarlineAxis,
          showEndDecorations: !entry.preferMeasureEndBarlineAxis,
          spacingMetrics,
        })
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
          effectiveBoundaryStartX: effectiveLayoutMetrics.effectiveBoundaryStartX,
          effectiveBoundaryEndX: effectiveLayoutMetrics.effectiveBoundaryEndX,
          effectiveLeftGapPx: effectiveLayoutMetrics.effectiveLeftGapPx,
          effectiveRightGapPx: effectiveLayoutMetrics.effectiveRightGapPx,
          overlayRect,
        })
        attachTimelineBundleForMeasure({
          pairIndex: entry.pairIndex,
          effectiveBoundaryStartX: effectiveLayoutMetrics.effectiveBoundaryStartX,
          effectiveBoundaryEndX: effectiveLayoutMetrics.effectiveBoundaryEndX,
          widthPx: measureWidth,
        })
      })
      drawCrossMeasureTiesForSystem()
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
        systemTimelineBundles.get(entry.pairIndex) ?? null,
      ),
    )
    const uniformTickPadding = getUniformTickSpacingPadding(spacingConfig)
    const adaptiveTimelineWeights = measureTimelineWeightsBySystem.map((weight) =>
      Math.max(MIN_TIMELINE_WEIGHT, weight),
    )
    const fixedWidthBonuses = new Array<number>(systemMeta.length).fill(0)
    const measureProbeWidthSeed = Math.max(140, Math.floor(systemUsableWidth / Math.max(1, systemMeta.length)))

    const getResolvedFixedWidth = (
      entry: (typeof systemMeta)[number],
      indexInSystem: number,
      measureWidth: number,
    ): number => {
      const safeMeasureWidth = Math.max(1, Number(measureWidth.toFixed(3)))
      const geometry = getMeasureProbeGeometry(entry, safeMeasureWidth)
      const axisBoundaryStart = entry.preferMeasureStartBarlineAxis ? 0 : geometry.noteStartOffset
      const axisBoundaryEnd = entry.preferMeasureEndBarlineAxis ? safeMeasureWidth : geometry.noteEndOffset
      const axisSpan = Math.max(
        1,
        axisBoundaryEnd -
          axisBoundaryStart -
          uniformTickPadding.startPadPx -
          uniformTickPadding.endPadPx,
      )
      const intrinsicFixed = Math.max(1, safeMeasureWidth - axisSpan)
      return Math.max(1, intrinsicFixed + (fixedWidthBonuses[indexInSystem] ?? 0))
    }

    const solveMeasureWidths = (): number[] => {
      const safeWeights = adaptiveTimelineWeights.map((weight) => Math.max(MIN_TIMELINE_WEIGHT, weight))
      const safeTotalTimelineWeight = Math.max(
        MIN_TIMELINE_WEIGHT,
        safeWeights.reduce((sum, weight) => sum + weight, 0),
      )
      let widths = systemMeta.map(() => measureProbeWidthSeed)
      for (let pass = 0; pass < 8; pass += 1) {
        const fixed = systemMeta.map((entry, indexInSystem) =>
          getResolvedFixedWidth(entry, indexInSystem, widths[indexInSystem] ?? measureProbeWidthSeed),
        )
        const fixedTotal = fixed.reduce((sum, width) => sum + width, 0)
        const nextWidths =
          fixedTotal >= systemUsableWidth
            ? fixed.map((width) => (systemUsableWidth * width) / Math.max(1, fixedTotal))
            : (() => {
              const flexWidth = systemUsableWidth - fixedTotal
              return fixed.map(
                (fixedWidth, index) =>
                  fixedWidth + (flexWidth * (safeWeights[index] ?? MIN_TIMELINE_WEIGHT)) / safeTotalTimelineWeight,
              )
            })()
        const maxDelta = nextWidths.reduce(
          (max, width, index) => Math.max(max, Math.abs(width - (widths[index] ?? 0))),
          0,
        )
        widths = nextWidths
        if (maxDelta < 0.25) break
      }
      return widths
    }

    type MeasureProbeStats = {
      overflowPx: number | null
      edgeExcessPx: number
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
      const { spacingLeftLimitX, spacingRightLimitX, formatWidth } = buildMeasureProbe(
        entry,
        probeMeasureX,
        safeMeasureWidth,
      )
      const timelineBundle = buildTimelineBundleForRender({
        entry,
        measureX: probeMeasureX,
        measureWidth: safeMeasureWidth,
        noteStartX: spacingLeftLimitX,
        noteEndX: spacingRightLimitX,
      })
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
        activeSelections: null,
        draggingSelections: null,
        collectLayouts: true,
        skipPainting: true,
        formatWidthOverride: formatWidth,
        timeAxisSpacingConfig: spacingConfig,
        spacingLayoutMode,
        publicAxisLayout: timelineBundle?.publicAxisLayout ?? null,
        // Width probing must be fully deterministic by score content only.
        // Do not feed previous-frame frozen spacing into the probe solver.
        staticNoteXById: null,
        staticAccidentalRightXById: null,
        // Probe with the same layout path used by final render so spacingRightX
        // and barline fit are computed from identical geometry.
        layoutDetail: 'full',
        preferMeasureEndBarlineAxis: entry.preferMeasureEndBarlineAxis,
        preferMeasureBarlineAxis: entry.preferMeasureStartBarlineAxis,
        // Probe with the same edge-cap path as final render so residual edge
        // excess can feed width recovery.
        enableEdgeGapCap: true,
      })
      const spacingRightEdge = getMeasureSpacingRightEdge(measureNoteLayouts)
      if (!Number.isFinite(spacingRightEdge)) {
        const stats: MeasureProbeStats = { overflowPx: null, edgeExcessPx: 0 }
        measureProbeStatsCache.set(cacheKey, stats)
        return stats
      }
      const stats: MeasureProbeStats = {
        overflowPx: spacingRightEdge - spacingRightLimitX,
        edgeExcessPx: getMeasureEdgeExcessPx({
          layouts: measureNoteLayouts,
          measure: entry.measure,
          leftBoundaryX: spacingLeftLimitX,
          rightBoundaryX: spacingRightLimitX,
          maxBarlineEdgeGapPx: spacingConfig.maxBarlineEdgeGapPx,
        }),
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
          const edgeExcess = stats.edgeExcessPx
          let nextBonus = 0
          if (overflow !== null && overflow > 0.001) {
            nextBonus += overflow + OVERFLOW_RECOVERY_PAD_PX
          }
          if (edgeExcess > 0.001) {
            nextBonus -= Math.min(edgeExcess, EDGE_EXCESS_SHRINK_MAX_STEP_PX)
          }
          if (Math.abs(nextBonus) <= 0.001) return
          fixedWidthBonuses[indexInSystem] = (fixedWidthBonuses[indexInSystem] ?? 0) + nextBonus
          changed = true
        })
        if (!changed) break
        measureWidths = solveMeasureWidths()
      }
    }

    let measureWidths = solveMeasureWidths()
    runOverflowRecovery()

    let measureCursorX = pagePaddingX
    systemMeta.forEach((entry, indexInSystem) => {
      const previewNotes = dragPreviewOverridesByPair.get(entry.pairIndex) ?? null
      const hasAnyPreviewInPair = Boolean(previewNotes && previewNotes.length > 0)
      const isPrimaryDragPreviewPair =
        dragPreview !== null &&
        dragPreview.previewStarted &&
        dragPreview.pairIndex === entry.pairIndex
      const previewAccidentalStateBeforeNote = hasAnyPreviewInPair
        ? (dragPreview?.accidentalStateBeforeNote ?? null)
        : null
      const previewStaticNoteXById = isPrimaryDragPreviewPair ? dragPreview.staticNoteXById : null
      const previewStaticAccidentalRightXById = isPrimaryDragPreviewPair
        ? dragPreview.previewAccidentalRightXById
        : null
      const measureWidth = measureWidths[indexInSystem] ?? Math.floor(systemUsableWidth / Math.max(1, systemMeta.length))
      const measureX = measureCursorX
      measureCursorX += measureWidth
      const { noteStartX, noteEndX, formatWidth } = buildMeasureProbe(entry, measureX, measureWidth)
      const timelineBundle = buildTimelineBundleForRender({
        entry,
        measureX,
        measureWidth,
        noteStartX,
        noteEndX,
      })
      const frozenSpacing = frozenSpacingByPairIndex.get(entry.pairIndex) ?? null
      const translatedFrozenSpacing =
        frozenSpacing !== null ? translateFrozenSpacingToMeasureX(frozenSpacing, measureX) : null
      let spacingMetrics:
        | {
            effectiveBoundaryStartX: number
            effectiveBoundaryEndX: number
            effectiveLeftGapPx: number
            effectiveRightGapPx: number
          }
        | null = null
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
        activeSelections,
        draggingSelections,
        formatWidthOverride: formatWidth,
        timeAxisSpacingConfig: spacingConfig,
        spacingLayoutMode,
        publicAxisLayout: timelineBundle?.publicAxisLayout ?? null,
        staticNoteXById: previewStaticNoteXById ?? translatedFrozenSpacing?.staticNoteXById ?? null,
        staticAccidentalRightXById:
          previewStaticAccidentalRightXById ?? translatedFrozenSpacing?.staticAccidentalRightXById ?? null,
        previewNotes,
        previewAccidentalStateBeforeNote,
        previewFrozenBoundaryCurve: dragPreviewFrozenBoundaryCurve,
        suppressedTieStartKeys: dragPreviewSuppressedTieStartKeys,
        suppressedTieStopKeys: dragPreviewSuppressedTieStopKeys,
        preferMeasureEndBarlineAxis: entry.preferMeasureEndBarlineAxis,
        preferMeasureBarlineAxis: entry.preferMeasureStartBarlineAxis,
        onSpacingMetrics: (metrics) => {
          spacingMetrics = metrics
        },
        renderBoundaryPartialTies: false,
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
      const effectiveLayoutMetrics = resolveEffectiveLayoutMetrics({
        measureX,
        measureWidth,
        noteStartX,
        noteEndX,
        showStartDecorations: !entry.preferMeasureStartBarlineAxis,
        showEndDecorations: !entry.preferMeasureEndBarlineAxis,
        spacingMetrics,
      })
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
        effectiveBoundaryStartX: effectiveLayoutMetrics.effectiveBoundaryStartX,
        effectiveBoundaryEndX: effectiveLayoutMetrics.effectiveBoundaryEndX,
        effectiveLeftGapPx: effectiveLayoutMetrics.effectiveLeftGapPx,
        effectiveRightGapPx: effectiveLayoutMetrics.effectiveRightGapPx,
        overlayRect,
      })
      attachTimelineBundleForMeasure({
        pairIndex: entry.pairIndex,
        effectiveBoundaryStartX: effectiveLayoutMetrics.effectiveBoundaryStartX,
        effectiveBoundaryEndX: effectiveLayoutMetrics.effectiveBoundaryEndX,
        widthPx: measureWidth,
      })
    })
    drawCrossMeasureTiesForSystem()
  }

  return {
    nextLayouts,
    nextLayoutsByPair,
    nextLayoutsByKey,
    nextMeasureLayouts,
    nextTimelineBundlesByPair,
  }
}
