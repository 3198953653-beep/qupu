import { DURATION_LABEL, DURATION_LAYOUT_WEIGHT } from '../constants'
import type { MeasurePair, NoteDuration, NoteDurationBase, ScoreNote, TimeSignature } from '../types'

const MEASURE_KEY_SIGNATURE_DEMAND = 2.2
const MEASURE_TIME_SIGNATURE_DEMAND = 2.4
const MEASURE_END_TIME_SIGNATURE_DEMAND = 1.6
const MEASURE_SYSTEM_START_CLEF_DEMAND = 3.5

const ADAPTIVE_MEASURE_BASE_WIDTH_PX = 34
const ADAPTIVE_DEMAND_TO_WIDTH_FACTOR = 6.4
const ADAPTIVE_MEASURE_MIN_WIDTH_PX = 92
const ADAPTIVE_MEASURE_SAFETY_PX = 10
const ADAPTIVE_SYSTEM_OCCUPANCY_TARGET = 0.9
const ADAPTIVE_SYSTEM_OCCUPANCY_MIN = 0.62
const ADAPTIVE_SYSTEM_REBALANCE_PASSES = 16

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

function getPitchAccidentalToken(pitch: string): string | null {
  const [note] = pitch.split('/')
  const accidental = note.slice(1)
  return accidental.length > 0 ? accidental : null
}

export function getNoteLayoutDemand(note: ScoreNote): number {
  const durationWeight = DURATION_LAYOUT_WEIGHT[note.duration] ?? 1
  const chordSize = 1 + (note.chordPitches?.length ?? 0)
  const rootAccidental = note.accidental !== undefined ? note.accidental : getPitchAccidentalToken(note.pitch)
  let chordAccidentalCount = 0
  note.chordPitches?.forEach((chordPitch, index) => {
    const chordAccidental =
      note.chordAccidentals?.[index] !== undefined
        ? note.chordAccidentals[index]
        : getPitchAccidentalToken(chordPitch)
    if (chordAccidental) chordAccidentalCount += 1
  })
  const accidentalCount = (rootAccidental ? 1 : 0) + chordAccidentalCount
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
  isSystemStart: boolean,
  showKeySignature: boolean,
  showTimeSignature: boolean,
  showEndTimeSignature: boolean,
): number {
  const systemStartDecoration = isSystemStart ? MEASURE_SYSTEM_START_CLEF_DEMAND : 0
  const beginDecorations =
    systemStartDecoration +
    (showKeySignature ? MEASURE_KEY_SIGNATURE_DEMAND : 0) +
    (showTimeSignature ? MEASURE_TIME_SIGNATURE_DEMAND : 0)
  const endDecoration = showEndTimeSignature ? MEASURE_END_TIME_SIGNATURE_DEMAND : 0
  return Math.max(1, noteDemand + beginDecorations + endDecoration)
}

export function getMeasureLayoutDemand(
  measure: MeasurePair,
  isSystemStart: boolean,
  showKeySignature: boolean,
  showTimeSignature: boolean,
  showEndTimeSignature: boolean,
): number {
  const noteDemand = getMeasureNoteLayoutDemand(measure)
  return getMeasureLayoutDemandFromNoteDemand(
    noteDemand,
    isSystemStart,
    showKeySignature,
    showTimeSignature,
    showEndTimeSignature,
  )
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
  const scaled = Math.round(
    ADAPTIVE_MEASURE_BASE_WIDTH_PX + ADAPTIVE_MEASURE_SAFETY_PX + layoutDemand * ADAPTIVE_DEMAND_TO_WIDTH_FACTOR,
  )
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

  const getRequiredWidthForMeasure = (pairIndex: number, isSystemStart: boolean, isSystemEnd: boolean): number => {
    const showKeySignature = isSystemStart || keyChangeFlags[pairIndex]
    const showTimeSignature = timeChangeFlags[pairIndex]
    const hasNextMeasure = pairIndex + 1 < measurePairs.length
    const showEndTimeSignature =
      isSystemEnd &&
      hasNextMeasure &&
      hasTimeSignatureChanged(resolvedTimeSignatures[pairIndex + 1], resolvedTimeSignatures[pairIndex])
    const nextTimeSignature =
      hasNextMeasure
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
      showEndTimeSignature,
    })
    const demandWidth =
      requiredWidthByEstimator && Number.isFinite(requiredWidthByEstimator)
        ? requiredWidthByEstimator
        : estimateAdaptiveMeasureWidth(
          getMeasureLayoutDemandFromNoteDemand(
            noteDemands[pairIndex],
            isSystemStart,
            showKeySignature,
            showTimeSignature,
            showEndTimeSignature,
          ),
          )
    return Math.min(safeSystemUsableWidth, Math.max(1, Math.ceil(demandWidth)))
  }

  const ranges: SystemMeasureRange[] = []
  let startPairIndex = 0

  while (startPairIndex < measurePairs.length) {
    let endPairIndexExclusive = startPairIndex
    let usedWidth = 0

    while (endPairIndexExclusive < measurePairs.length) {
      const pairIndex = endPairIndexExclusive
      const requiredWidth = getRequiredWidthForMeasure(pairIndex, pairIndex === startPairIndex, true)
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

  if (ranges.length <= 1) return ranges

  type MutableRange = {
    startPairIndex: number
    endPairIndexExclusive: number
  }

  const mutableRanges: MutableRange[] = ranges.map((range) => ({ ...range }))

  const getSystemUsedWidth = (start: number, endExclusive: number): number => {
    let usedWidth = 0
    for (let pairIndex = start; pairIndex < endExclusive; pairIndex += 1) {
      const isSystemStart = pairIndex === start
      const isSystemEnd = pairIndex === endExclusive - 1
      usedWidth += getRequiredWidthForMeasure(pairIndex, isSystemStart, isSystemEnd)
    }
    return usedWidth
  }

  const getSystemPenalty = (start: number, endExclusive: number): number => {
    const measureCount = endExclusive - start
    if (measureCount <= 0) return Number.POSITIVE_INFINITY
    const occupancy = getSystemUsedWidth(start, endExclusive) / safeSystemUsableWidth
    let penalty = Math.abs(occupancy - ADAPTIVE_SYSTEM_OCCUPANCY_TARGET)
    if (occupancy > 1) {
      penalty += (occupancy - 1) * 10
    }
    if (occupancy < ADAPTIVE_SYSTEM_OCCUPANCY_MIN) {
      penalty += (ADAPTIVE_SYSTEM_OCCUPANCY_MIN - occupancy) * 2
    }
    if (measureCount === 1) {
      penalty += 0.15
    }
    return penalty
  }

  const evaluateAdjacentPenalty = (leftStart: number, boundary: number, rightEndExclusive: number): number => {
    if (boundary <= leftStart || boundary >= rightEndExclusive) return Number.POSITIVE_INFINITY
    const leftUsed = getSystemUsedWidth(leftStart, boundary)
    const rightUsed = getSystemUsedWidth(boundary, rightEndExclusive)
    const leftOcc = leftUsed / safeSystemUsableWidth
    const rightOcc = rightUsed / safeSystemUsableWidth
    if (leftOcc > 1 || rightOcc > 1) return Number.POSITIVE_INFINITY
    const occupancyGapPenalty = Math.abs(leftOcc - rightOcc) * 0.6
    return getSystemPenalty(leftStart, boundary) + getSystemPenalty(boundary, rightEndExclusive) + occupancyGapPenalty
  }

  const maxPasses = Math.max(1, Math.min(ADAPTIVE_SYSTEM_REBALANCE_PASSES, measurePairs.length))
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false

    for (let index = 0; index < mutableRanges.length - 1; index += 1) {
      const leftRange = mutableRanges[index]
      const rightRange = mutableRanges[index + 1]
      const leftStart = leftRange.startPairIndex
      const rightEndExclusive = rightRange.endPairIndexExclusive
      const currentBoundary = leftRange.endPairIndexExclusive

      const candidateBoundaries = [currentBoundary]
      if (currentBoundary - leftStart > 1) {
        candidateBoundaries.push(currentBoundary - 1)
      }
      if (rightEndExclusive - currentBoundary > 1) {
        candidateBoundaries.push(currentBoundary + 1)
      }

      let bestBoundary = currentBoundary
      let bestPenalty = evaluateAdjacentPenalty(leftStart, currentBoundary, rightEndExclusive)
      candidateBoundaries.forEach((candidateBoundary) => {
        if (candidateBoundary === currentBoundary) return
        const penalty = evaluateAdjacentPenalty(leftStart, candidateBoundary, rightEndExclusive)
        if (penalty + 0.01 < bestPenalty) {
          bestPenalty = penalty
          bestBoundary = candidateBoundary
        }
      })

      if (bestBoundary !== currentBoundary) {
        leftRange.endPairIndexExclusive = bestBoundary
        rightRange.startPairIndex = bestBoundary
        changed = true
      }
    }

    if (!changed) break
  }

  return mutableRanges
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
