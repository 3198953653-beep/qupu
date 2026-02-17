import { DURATION_LABEL, DURATION_LAYOUT_WEIGHT } from '../constants'
import type { MeasurePair, NoteDuration, NoteDurationBase, ScoreNote, TimeSignature } from '../types'

const MEASURE_KEY_SIGNATURE_DEMAND = 2.2
const MEASURE_TIME_SIGNATURE_DEMAND = 2.4
const MEASURE_END_TIME_SIGNATURE_DEMAND = 1.6

const ADAPTIVE_MEASURE_BASE_WIDTH_PX = 34
const ADAPTIVE_DEMAND_TO_WIDTH_FACTOR = 6.4
const ADAPTIVE_MEASURE_MIN_WIDTH_PX = 92

const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }

export type SystemMeasureRange = {
  startPairIndex: number
  endPairIndexExclusive: number
}

export type MeasureRequiredWidthContext = {
  pairIndex: number
  measure: MeasurePair
  isSystemStart: boolean
  keyFifths: number
  showKeySignature: boolean
  timeSignature: TimeSignature
  showTimeSignature: boolean
  nextTimeSignature: TimeSignature
  showEndTimeSignature: boolean
}

export function toDisplayDuration(duration: NoteDuration): string {
  return DURATION_LABEL[duration]
}

export function toVexDuration(duration: NoteDuration): NoteDurationBase {
  return duration.replace(/d+$/, '') as NoteDurationBase
}

export function getDurationDots(duration: NoteDuration): number {
  const dots = duration.match(/d/g)
  return dots ? dots.length : 0
}

export function countVisibleAccidentals(accidentals?: Array<string | null>): number {
  if (!accidentals || accidentals.length === 0) return 0
  let count = 0
  accidentals.forEach((value) => {
    if (value) count += 1
  })
  return count
}

export function getNoteLayoutDemand(note: ScoreNote): number {
  const durationWeight = DURATION_LAYOUT_WEIGHT[note.duration] ?? 1
  const chordSize = 1 + (note.chordPitches?.length ?? 0)
  const accidentalCount = (note.accidental ? 1 : 0) + countVisibleAccidentals(note.chordAccidentals)
  const chordSpreadBonus = chordSize > 1 ? (chordSize - 1) * 0.35 : 0
  return durationWeight * chordSize + accidentalCount * 0.85 + chordSpreadBonus
}

export function getStaffLayoutDemand(notes: ScoreNote[]): number {
  if (notes.length === 0) return 1
  return notes.reduce((sum, note) => sum + getNoteLayoutDemand(note), 0)
}

export function getMeasureNoteLayoutDemand(measure: MeasurePair): number {
  return getStaffLayoutDemand(measure.treble) + getStaffLayoutDemand(measure.bass)
}

export function getMeasureLayoutDemandFromNoteDemand(
  noteDemand: number,
  showKeySignature: boolean,
  showTimeSignature: boolean,
  showEndTimeSignature: boolean,
): number {
  const beginDecorations =
    (showKeySignature ? MEASURE_KEY_SIGNATURE_DEMAND : 0) +
    (showTimeSignature ? MEASURE_TIME_SIGNATURE_DEMAND : 0)
  const endDecoration = showEndTimeSignature ? MEASURE_END_TIME_SIGNATURE_DEMAND : 0
  return Math.max(1, noteDemand + beginDecorations + endDecoration)
}

export function getMeasureLayoutDemand(
  measure: MeasurePair,
  showKeySignature: boolean,
  showTimeSignature: boolean,
  showEndTimeSignature: boolean,
): number {
  const noteDemand = getMeasureNoteLayoutDemand(measure)
  return getMeasureLayoutDemandFromNoteDemand(noteDemand, showKeySignature, showTimeSignature, showEndTimeSignature)
}

function hasTimeSignatureChanged(current: TimeSignature, previous: TimeSignature): boolean {
  return current.beats !== previous.beats || current.beatType !== previous.beatType
}

function getResolvedArrayValue<T>(values: T[] | null, index: number, fallback: T): T {
  if (!values || values.length === 0) return fallback
  const direct = values[index]
  if (direct !== undefined) return direct
  if (index > 0) return getResolvedArrayValue(values, index - 1, fallback)
  return fallback
}

export function estimateAdaptiveMeasureWidth(layoutDemand: number): number {
  const scaled = Math.round(ADAPTIVE_MEASURE_BASE_WIDTH_PX + layoutDemand * ADAPTIVE_DEMAND_TO_WIDTH_FACTOR)
  return Math.max(ADAPTIVE_MEASURE_MIN_WIDTH_PX, scaled)
}

export function buildAdaptiveSystemRanges(params: {
  measurePairs: MeasurePair[]
  systemUsableWidth: number
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  getRequiredMeasureWidth?: ((context: MeasureRequiredWidthContext) => number) | null
}): SystemMeasureRange[] {
  const {
    measurePairs,
    systemUsableWidth,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    getRequiredMeasureWidth = null,
  } = params

  if (measurePairs.length === 0) return []

  const safeSystemUsableWidth = Math.max(1, Math.floor(systemUsableWidth))
  const noteDemands = measurePairs.map((measure) => getMeasureNoteLayoutDemand(measure))
  const resolvedKeyFifths = new Array<number>(measurePairs.length).fill(0)
  const resolvedTimeSignatures = new Array<TimeSignature>(measurePairs.length).fill(DEFAULT_TIME_SIGNATURE)

  for (let index = 0; index < measurePairs.length; index += 1) {
    const previousKey = index > 0 ? resolvedKeyFifths[index - 1] : 0
    const previousTime = index > 0 ? resolvedTimeSignatures[index - 1] : DEFAULT_TIME_SIGNATURE
    resolvedKeyFifths[index] = getResolvedArrayValue(measureKeyFifthsFromImport, index, previousKey)
    resolvedTimeSignatures[index] = getResolvedArrayValue(measureTimeSignaturesFromImport, index, previousTime)
  }

  const keyChangeFlags = resolvedKeyFifths.map((keyFifths, index) => {
    if (index === 0) return false
    return keyFifths !== resolvedKeyFifths[index - 1]
  })
  const timeChangeFlags = resolvedTimeSignatures.map((timeSignature, index) => {
    if (index === 0) return true
    return hasTimeSignatureChanged(timeSignature, resolvedTimeSignatures[index - 1])
  })

  const ranges: SystemMeasureRange[] = []
  let startPairIndex = 0

  while (startPairIndex < measurePairs.length) {
    let endPairIndexExclusive = startPairIndex
    let usedWidth = 0

    while (endPairIndexExclusive < measurePairs.length) {
      const pairIndex = endPairIndexExclusive
      const isSystemStart = pairIndex === startPairIndex
      const showKeySignature = isSystemStart || keyChangeFlags[pairIndex]
      const showTimeSignature = timeChangeFlags[pairIndex]
      const showPotentialEndTimeSignature =
        pairIndex + 1 < measurePairs.length &&
        hasTimeSignatureChanged(resolvedTimeSignatures[pairIndex + 1], resolvedTimeSignatures[pairIndex])
      const nextTimeSignature =
        pairIndex + 1 < measurePairs.length
          ? resolvedTimeSignatures[pairIndex + 1]
          : resolvedTimeSignatures[pairIndex]
      const requiredWidthByEstimator = getRequiredMeasureWidth?.({
        pairIndex,
        measure: measurePairs[pairIndex],
        isSystemStart,
        keyFifths: resolvedKeyFifths[pairIndex],
        showKeySignature,
        timeSignature: resolvedTimeSignatures[pairIndex],
        showTimeSignature,
        nextTimeSignature,
        showEndTimeSignature: showPotentialEndTimeSignature,
      })
      const demandWidth =
        requiredWidthByEstimator && Number.isFinite(requiredWidthByEstimator)
          ? requiredWidthByEstimator
          : estimateAdaptiveMeasureWidth(
              getMeasureLayoutDemandFromNoteDemand(
                noteDemands[pairIndex],
                showKeySignature,
                showTimeSignature,
                showPotentialEndTimeSignature,
              ),
            )
      const requiredWidth = Math.min(safeSystemUsableWidth, Math.max(1, Math.ceil(demandWidth)))
      const wouldOverflow = pairIndex > startPairIndex && usedWidth + requiredWidth > safeSystemUsableWidth
      if (wouldOverflow) break
      usedWidth += requiredWidth
      endPairIndexExclusive += 1
    }

    if (endPairIndexExclusive === startPairIndex) {
      endPairIndexExclusive = startPairIndex + 1
    }

    ranges.push({ startPairIndex, endPairIndexExclusive })
    startPairIndex = endPairIndexExclusive
  }

  return ranges
}

function distributeWidthsByFloats(floatWidths: number[], targetTotal: number): number[] {
  const widths = floatWidths.map((value) => Math.floor(value))
  let remainder = targetTotal - widths.reduce((sum, width) => sum + width, 0)
  const rankByFraction = floatWidths
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)

  for (let i = 0; i < rankByFraction.length && remainder > 0; i += 1) {
    widths[rankByFraction[i].index] += 1
    remainder -= 1
  }

  return widths
}

export function allocateMeasureWidthsByDemand(
  demands: number[],
  totalWidth: number,
  minimumWidths?: number[] | null,
): number[] {
  if (demands.length === 0) return []
  if (demands.length === 1) return [Math.floor(totalWidth)]

  const safeTotal = Math.max(demands.length, Math.floor(totalWidth))
  const measureCount = demands.length
  const minimumByMeasure =
    minimumWidths && minimumWidths.length > 0
      ? demands.map((_, index) => {
          const raw = minimumWidths[index]
          if (!Number.isFinite(raw)) return 1
          return Math.max(1, Math.min(safeTotal, Math.floor(raw)))
        })
      : (() => {
          const idealMinWidth = Math.floor(safeTotal / measureCount)
          const minWidth = Math.max(80, Math.min(180, Math.floor(idealMinWidth * 0.45)))
          return new Array<number>(measureCount).fill(minWidth)
        })()

  const minimumTotal = minimumByMeasure.reduce((sum, width) => sum + width, 0)
  if (minimumTotal >= safeTotal) {
    const scaled = minimumByMeasure.map((width) => (safeTotal * width) / minimumTotal)
    return distributeWidthsByFloats(scaled, safeTotal)
  }

  const flex = safeTotal - minimumTotal
  const demandSum = demands.reduce((sum, demand) => sum + Math.max(0.0001, demand), 0)
  const floatWidths = demands.map(
    (demand, index) => minimumByMeasure[index] + (flex * Math.max(0.0001, demand)) / demandSum,
  )
  const widths = distributeWidthsByFloats(floatWidths, safeTotal)

  return widths
}
