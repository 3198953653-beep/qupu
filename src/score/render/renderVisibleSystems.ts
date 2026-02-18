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
  getMeasureLayoutDemand,
  type SystemMeasureRange,
} from '../layout/demand'
import { getLayoutNoteKey } from '../layout/renderPosition'
import { buildMeasureOverlayRect } from '../layout/viewport'
import { clamp } from '../math'
import { drawMeasureToContext } from './drawMeasure'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type { MeasureLayout, MeasurePair, NoteLayout, ScoreNote, Selection, StaffKind, TimeSignature } from '../types'

const MEASURE_RIGHT_EDGE_GUARD_PX = 0
const OVERFLOW_RECOVERY_PADDING_PX = 0
const OVERFLOW_ANALYSIS_MAX_PASSES = 6

type FrozenMeasureSpacing = {
  staticNoteXById: Map<string, number>
  staticAccidentalRightXById: Map<string, Map<number, number>>
}

function getPitchAccidentalToken(pitch: string): string | null {
  const [note] = pitch.split('/')
  const accidental = note.slice(1)
  return accidental.length > 0 ? accidental : null
}

function getVisibleAccidentalKeySetFromNote(note: ScoreNote): Set<number> {
  const keys = new Set<number>()
  const rootAccidental = note.accidental !== undefined ? note.accidental : getPitchAccidentalToken(note.pitch)
  if (rootAccidental) keys.add(0)

  note.chordPitches?.forEach((chordPitch, chordIndex) => {
    const chordAccidental =
      note.chordAccidentals?.[chordIndex] !== undefined
        ? note.chordAccidentals[chordIndex]
        : getPitchAccidentalToken(chordPitch)
    if (chordAccidental) keys.add(chordIndex + 1)
  })

  return keys
}

function getVisibleAccidentalKeySetFromLayout(layout: NoteLayout): Set<number> {
  const keys = new Set<number>()
  Object.keys(layout.accidentalRightXByKeyIndex).forEach((rawKeyIndex) => {
    const keyIndex = Number(rawKeyIndex)
    const rightX = layout.accidentalRightXByKeyIndex[keyIndex]
    if (!Number.isFinite(keyIndex) || !Number.isFinite(rightX)) return
    keys.add(keyIndex)
  })
  return keys
}

function hasAccidentalPresenceDelta(note: ScoreNote, previousLayout: NoteLayout): boolean {
  const currentVisibleKeys = getVisibleAccidentalKeySetFromNote(note)
  const previousVisibleKeys = getVisibleAccidentalKeySetFromLayout(previousLayout)
  if (currentVisibleKeys.size !== previousVisibleKeys.size) return true
  for (const keyIndex of currentVisibleKeys) {
    if (!previousVisibleKeys.has(keyIndex)) return true
  }
  return false
}

function tryBuildFrozenMeasureSpacing(params: {
  pairIndex: number
  measure: MeasurePair
  previousNoteLayoutsByPair: Map<number, NoteLayout[]> | null | undefined
}): FrozenMeasureSpacing | null {
  const { pairIndex, measure, previousNoteLayoutsByPair } = params
  const previousLayouts = previousNoteLayoutsByPair?.get(pairIndex)
  if (!previousLayouts || previousLayouts.length === 0) return null

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

      // Freeze only when accidental visibility did not change (add/remove).
      // Accidental type changes (# -> n) are allowed and considered no-presence-change.
      // Matching uses noteId+keyIndex, so dragged-note pitch moves won't break pairing.
      if (hasAccidentalPresenceDelta(note, previousLayout)) return false

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

function distributeByFloats(floatWidths: number[], targetTotal: number): number[] {
  const widths = floatWidths.map((value) => Math.floor(value))
  let remainder = targetTotal - widths.reduce((sum, width) => sum + width, 0)
  const byFraction = floatWidths
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction)

  for (let i = 0; i < byFraction.length && remainder > 0; i += 1) {
    widths[byFraction[i].index] += 1
    remainder -= 1
  }

  return widths
}

function normalizeMinimumWidthsToSystem(minimumWidths: number[], totalWidth: number): number[] {
  const safeTotal = Math.max(minimumWidths.length, Math.floor(totalWidth))
  const sanitized = minimumWidths.map((width) => {
    if (!Number.isFinite(width)) return 1
    return Math.max(1, Math.floor(width))
  })
  const minimumTotal = sanitized.reduce((sum, width) => sum + width, 0)
  if (minimumTotal <= safeTotal) return sanitized
  const scaled = sanitized.map((width) => (safeTotal * width) / minimumTotal)
  return distributeByFloats(scaled, safeTotal)
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
  allowSelectionFreezeWhenNotDragging?: boolean
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
    allowSelectionFreezeWhenNotDragging = true,
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
      })
      if (frozen) {
        frozenSpacingByPairIndex.set(entry.pairIndex, frozen)
      }
    })
    const measureDemands = systemMeta.map((entry) =>
      getMeasureLayoutDemand(
        entry.measure,
        entry.isSystemStart,
        entry.showKeySignature,
        entry.showTimeSignature,
        entry.showEndTimeSignature,
      ),
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
      if (entry.showEndTimeSignature) {
        noteStartProbe.setEndTimeSignature(`${entry.nextTimeSignature.beats}/${entry.nextTimeSignature.beatType}`)
      }
      const noteStartX = noteStartProbe.getNoteStartX()
      const noteEndX = noteStartProbe.getNoteEndX()
      const formatWidth = Math.max(80, noteEndX - noteStartX - 8)
      return { noteStartX, noteEndX, formatWidth }
    }
    const spacingProbeDeltaCache = new Map<string, number | null>()
    const getMeasureSpacingDelta = (entry: (typeof systemMeta)[number], measureWidth: number): number | null => {
      const safeMeasureWidth = Math.max(1, Math.floor(measureWidth))
      const cacheKey = `${entry.pairIndex}|${safeMeasureWidth}`
      if (spacingProbeDeltaCache.has(cacheKey)) {
        return spacingProbeDeltaCache.get(cacheKey) ?? null
      }

      const probeMeasureX = STAFF_X
      const { noteEndX, formatWidth } = buildMeasureProbe(entry, probeMeasureX, safeMeasureWidth)
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
        layoutDetail: 'spacing-only',
      })

      const spacingRightEdge = getMeasureSpacingRightEdge(measureNoteLayouts)
      if (!Number.isFinite(spacingRightEdge)) {
        spacingProbeDeltaCache.set(cacheKey, null)
        return null
      }
      const rightBoundary = noteEndX - MEASURE_RIGHT_EDGE_GUARD_PX
      const delta = spacingRightEdge - rightBoundary
      spacingProbeDeltaCache.set(cacheKey, delta)
      return delta
    }

    const analyzeOverflowMinimumWidths = (
      candidateWidths: number[],
      currentMinimums: number[],
    ): { nextMinimums: number[]; hasIncrease: boolean } => {
      const nextMinimums = [...currentMinimums]
      let hasIncrease = false

      systemMeta.forEach((entry, indexInSystem) => {
        const measureWidth = Math.max(
          1,
          Math.floor(candidateWidths[indexInSystem] ?? Math.floor(systemUsableWidth / systemMeasures.length)),
        )
        if (frozenSpacingByPairIndex.has(entry.pairIndex)) return
        const overflow = getMeasureSpacingDelta(entry, measureWidth)
        if (overflow === null) return
        if (overflow <= 0) return
        const requiredWidth = Math.ceil(measureWidth + overflow + OVERFLOW_RECOVERY_PADDING_PX)
        if (requiredWidth <= nextMinimums[indexInSystem]) return
        nextMinimums[indexInSystem] = requiredWidth
        hasIncrease = true
      })

      return { nextMinimums, hasIncrease }
    }

    const rebalanceMeasureWidthsBySpacing = (
      candidateWidths: number[],
      currentMinimums: number[],
    ): { nextWidths: number[]; hasChange: boolean } => {
      const nextWidths = [...candidateWidths]
      const computeDeltas = (widths: number[]): number[] => {
        const deltas = new Array<number>(systemMeta.length).fill(0)

        systemMeta.forEach((entry, indexInSystem) => {
          const measureWidth = Math.max(
            1,
            Math.floor(widths[indexInSystem] ?? Math.floor(systemUsableWidth / systemMeasures.length)),
          )
          if (frozenSpacingByPairIndex.has(entry.pairIndex)) {
            deltas[indexInSystem] = 0
            return
          }
          const delta = getMeasureSpacingDelta(entry, measureWidth)
          if (delta === null) {
            deltas[indexInSystem] = 0
            return
          }
          deltas[indexInSystem] = delta
        })

        return deltas
      }

      let hasChange = false
      const maxIterations = Math.max(8, systemMeta.length * 3)
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const deltas = computeDeltas(nextWidths)
        let receiverIndex = -1
        let receiverDelta = 0
        for (let index = 0; index < deltas.length; index += 1) {
          const delta = deltas[index]
          if (delta > receiverDelta) {
            receiverDelta = delta
            receiverIndex = index
          }
        }
        if (receiverIndex < 0 || receiverDelta <= 0) break
        const need = Math.ceil(receiverDelta + OVERFLOW_RECOVERY_PADDING_PX)
        if (need <= 0) break

        let donorIndex = -1
        let donorAvailable = 0
        for (let index = 0; index < deltas.length; index += 1) {
          if (index === receiverIndex) continue
          const delta = deltas[index]
          if (!(delta < -OVERFLOW_RECOVERY_PADDING_PX)) continue
          const spare = Math.max(0, Math.floor(-delta - OVERFLOW_RECOVERY_PADDING_PX))
          if (spare <= 0) continue
          const minimum = Math.max(1, Math.floor(currentMinimums[index] ?? 1))
          const reducible = Math.max(0, (nextWidths[index] ?? 0) - minimum)
          const available = Math.min(spare, reducible)
          if (available > donorAvailable) {
            donorAvailable = available
            donorIndex = index
          }
        }

        if (donorIndex < 0 || donorAvailable <= 0) break
        const transfer = Math.min(need, donorAvailable)
        if (transfer <= 0) break
        nextWidths[receiverIndex] = (nextWidths[receiverIndex] ?? 0) + transfer
        nextWidths[donorIndex] = Math.max(1, (nextWidths[donorIndex] ?? 0) - transfer)
        hasChange = true
      }

      return { nextWidths, hasChange }
    }

    const probeWidth = Math.max(140, Math.floor(systemUsableWidth / Math.max(1, systemMeasures.length)))
    const baseMinimumWidths = systemMeta.map((entry) => {
      const { noteStartX } = buildMeasureProbe(entry, STAFF_X, probeWidth)
      const decorationWidth = Math.max(0, noteStartX - STAFF_X)
      // Keep only structural left decoration space in the base minimum.
      // Real per-measure note width is raised by overflow analysis below.
      return Math.max(1, Math.ceil(decorationWidth + 24))
    })

    let enforcedMinimumWidths = normalizeMinimumWidthsToSystem(baseMinimumWidths, systemUsableWidth)
    let measureWidths = allocateMeasureWidthsByDemand(measureDemands, systemUsableWidth, enforcedMinimumWidths)

    for (let pass = 0; pass < OVERFLOW_ANALYSIS_MAX_PASSES; pass += 1) {
      const { nextMinimums, hasIncrease } = analyzeOverflowMinimumWidths(measureWidths, enforcedMinimumWidths)
      if (!hasIncrease) break
      enforcedMinimumWidths = normalizeMinimumWidthsToSystem(nextMinimums, systemUsableWidth)
      measureWidths = allocateMeasureWidthsByDemand(measureDemands, systemUsableWidth, enforcedMinimumWidths)
    }

    for (let pass = 0; pass < OVERFLOW_ANALYSIS_MAX_PASSES; pass += 1) {
      const { nextWidths, hasChange } = rebalanceMeasureWidthsBySpacing(measureWidths, enforcedMinimumWidths)
      if (!hasChange) break
      measureWidths = nextWidths
    }

    let measureCursorX = STAFF_X
    systemMeta.forEach((entry, indexInSystem) => {
      const measureWidth = measureWidths[indexInSystem] ?? Math.floor(systemUsableWidth / systemMeasures.length)
      const measureX = measureCursorX
      measureCursorX += measureWidth
      const { noteStartX, noteEndX, formatWidth } = buildMeasureProbe(entry, measureX, measureWidth)
      const frozenSpacing = frozenSpacingByPairIndex.get(entry.pairIndex) ?? null
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
        staticNoteXById: frozenSpacing?.staticNoteXById ?? null,
        staticAccidentalRightXById: frozenSpacing?.staticAccidentalRightXById ?? null,
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
