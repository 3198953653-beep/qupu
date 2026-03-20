import { TICKS_PER_BEAT } from './constants'
import type { TimeSignature } from './types'

export type ChordRulerEntry = {
  label: string
  startTick: number
  endTick: number
  positionText: string
  beatIndex?: number | null
}

export function getBeatTicksByTimeSignature(timeSignature: TimeSignature): number {
  const beatType = Math.max(1, Number.isFinite(timeSignature.beatType) ? Math.round(timeSignature.beatType) : 4)
  const rawBeatTicks = TICKS_PER_BEAT * (4 / beatType)
  if (!Number.isFinite(rawBeatTicks) || rawBeatTicks <= 0) return TICKS_PER_BEAT
  return Math.max(1, Math.round(rawBeatTicks))
}

export function getMeasureTicksFromTimeSignature(timeSignature: TimeSignature): number {
  const beatTicks = getBeatTicksByTimeSignature(timeSignature)
  const beats = Number.isFinite(timeSignature.beats) ? Math.max(1, Math.round(timeSignature.beats)) : 4
  return Math.max(1, Math.round(beats * beatTicks))
}

function formatBeatNumber(value: number): string {
  const roundedValue = Math.round(value * 100) / 100
  if (Math.abs(roundedValue - Math.round(roundedValue)) <= 0.001) {
    return String(Math.round(roundedValue))
  }
  const singleDecimal = Math.round(roundedValue * 10) / 10
  if (Math.abs(singleDecimal - roundedValue) <= 0.001) {
    return singleDecimal.toFixed(1).replace(/\.0$/, '')
  }
  return roundedValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function getChordRulerBeatIndex(params: {
  startTick: number
  timeSignature: TimeSignature
}): number | null {
  const { startTick, timeSignature } = params
  const beatTicks = getBeatTicksByTimeSignature(timeSignature)
  const beatPosition = Math.max(0, startTick) / Math.max(1, beatTicks) + 1
  const roundedBeatPosition = Math.round(beatPosition)
  if (Math.abs(beatPosition - roundedBeatPosition) > 0.001) {
    return null
  }
  return Math.max(1, roundedBeatPosition)
}

export function formatChordRulerPositionText(params: {
  startTick: number
  timeSignature: TimeSignature
}): string {
  const { startTick, timeSignature } = params
  const beatTicks = getBeatTicksByTimeSignature(timeSignature)
  const beatPosition = Math.max(0, startTick) / Math.max(1, beatTicks) + 1
  return `第${formatBeatNumber(beatPosition)}拍`
}

export function buildChordRulerEntries(params: {
  pairIndex: number
  timeSignature: TimeSignature
}): ChordRulerEntry[] {
  const { pairIndex, timeSignature } = params
  const beatTicks = getBeatTicksByTimeSignature(timeSignature)
  const measureTicks = getMeasureTicksFromTimeSignature(timeSignature)
  const isOddMeasure = (pairIndex + 1) % 2 === 1

  const entries: ChordRulerEntry[] = [
    {
      beatIndex: 1,
      label: isOddMeasure ? 'C' : 'F',
      startTick: 0,
      endTick: Math.min(measureTicks, beatTicks * 2),
      positionText: formatChordRulerPositionText({ startTick: 0, timeSignature }),
    },
    {
      beatIndex: 3,
      label: isOddMeasure ? 'Am' : 'G',
      startTick: Math.max(0, Math.min(measureTicks, Math.round(beatTicks * 2))),
      endTick: Math.max(0, Math.min(measureTicks, Math.round(beatTicks * 4))),
      positionText: formatChordRulerPositionText({
        startTick: Math.max(0, Math.min(measureTicks, Math.round(beatTicks * 2))),
        timeSignature,
      }),
    },
  ]

  return entries.filter((entry) => entry.endTick > entry.startTick)
}
