import { DURATION_LABEL, DURATION_LAYOUT_WEIGHT } from '../constants'
import type { MeasurePair, NoteDuration, NoteDurationBase, ScoreNote } from '../types'

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

export function getMeasureLayoutDemand(
  measure: MeasurePair,
  showKeySignature: boolean,
  showTimeSignature: boolean,
  showEndTimeSignature: boolean,
): number {
  const noteDemand = getStaffLayoutDemand(measure.treble) + getStaffLayoutDemand(measure.bass)
  const beginDecorations = (showKeySignature ? 2.2 : 0) + (showTimeSignature ? 2.4 : 0)
  const endDecoration = showEndTimeSignature ? 1.6 : 0
  return Math.max(1, noteDemand + beginDecorations + endDecoration)
}

export function allocateMeasureWidthsByDemand(demands: number[], totalWidth: number): number[] {
  if (demands.length === 0) return []
  if (demands.length === 1) return [Math.floor(totalWidth)]

  const safeTotal = Math.max(demands.length, Math.floor(totalWidth))
  const measureCount = demands.length
  const idealMinWidth = Math.floor(safeTotal / measureCount)
  const minWidth = Math.max(80, Math.min(180, Math.floor(idealMinWidth * 0.45)))
  const minTotal = minWidth * measureCount
  if (safeTotal <= minTotal) {
    const even = Math.floor(safeTotal / measureCount)
    const result = new Array<number>(measureCount).fill(even)
    let remainder = safeTotal - even * measureCount
    for (let i = 0; i < result.length && remainder > 0; i += 1) {
      result[i] += 1
      remainder -= 1
    }
    return result
  }

  const flex = safeTotal - minTotal
  const demandSum = demands.reduce((sum, demand) => sum + Math.max(0.0001, demand), 0)
  const floatWidths = demands.map((demand) => minWidth + (flex * Math.max(0.0001, demand)) / demandSum)
  const widths = floatWidths.map((value) => Math.floor(value))
  let remainder = safeTotal - widths.reduce((sum, width) => sum + width, 0)

  const rankByFraction = floatWidths
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)

  for (let i = 0; i < rankByFraction.length && remainder > 0; i += 1) {
    widths[rankByFraction[i].index] += 1
    remainder -= 1
  }

  return widths
}
