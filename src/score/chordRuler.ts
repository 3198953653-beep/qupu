import { TICKS_PER_BEAT } from './constants'
import type { TimeSignature } from './types'

export type ChordRulerEntry = {
  beatIndex: 1 | 3
  label: string
  startTick: number
  endTick: number
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
    },
    {
      beatIndex: 3,
      label: isOddMeasure ? 'Am' : 'G',
      startTick: Math.max(0, Math.min(measureTicks, Math.round(beatTicks * 2))),
      endTick: Math.max(0, Math.min(measureTicks, Math.round(beatTicks * 4))),
    },
  ]

  return entries.filter((entry) => entry.endTick > entry.startTick)
}
