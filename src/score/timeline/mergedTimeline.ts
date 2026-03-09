import { TICKS_PER_BEAT } from '../constants'
import type { TimeSignature } from '../types'
import type { PublicMergedTimeline, PublicTimelinePoint, StaffTimeline } from './types'

function getBeatTicks(timeSignature: TimeSignature): number {
  const beatType = Math.max(1, timeSignature.beatType)
  const rawBeatTicks = TICKS_PER_BEAT * (4 / beatType)
  if (Number.isFinite(rawBeatTicks) && rawBeatTicks > 0) {
    return Math.max(1, Math.round(rawBeatTicks))
  }
  return TICKS_PER_BEAT
}

function buildBeatBoundaryTicks(measureTicks: number, timeSignature: TimeSignature): number[] {
  const beatTicks = getBeatTicks(timeSignature)
  const safeMeasureTicks = Math.max(1, measureTicks)
  const ticks: number[] = [0]
  for (let tick = beatTicks; tick < safeMeasureTicks; tick += beatTicks) {
    ticks.push(tick)
  }
  ticks.push(safeMeasureTicks)
  return [...new Set(ticks)].sort((left, right) => left - right)
}

export function mergeStaffTimelines(params: {
  measureIndex: number
  measureTicks: number
  timeSignature: TimeSignature
  trebleTimeline: StaffTimeline
  bassTimeline: StaffTimeline
}): PublicMergedTimeline {
  const { measureIndex, measureTicks, timeSignature, trebleTimeline, bassTimeline } = params
  const safeMeasureTicks = Math.max(1, measureTicks)
  const tickSet = new Set<number>([0, safeMeasureTicks])
  const beatBoundarySet = new Set<number>(buildBeatBoundaryTicks(safeMeasureTicks, timeSignature))
  beatBoundarySet.forEach((tick) => tickSet.add(tick))
  trebleTimeline.events.forEach((event) => {
    tickSet.add(event.startTick)
    tickSet.add(event.endTick)
  })
  bassTimeline.events.forEach((event) => {
    tickSet.add(event.startTick)
    tickSet.add(event.endTick)
  })

  const trebleStarts = new Set<number>(trebleTimeline.startTicks)
  const trebleEnds = new Set<number>(trebleTimeline.endTicks)
  const bassStarts = new Set<number>(bassTimeline.startTicks)
  const bassEnds = new Set<number>(bassTimeline.endTicks)

  const points = [...tickSet]
    .filter((tick) => Number.isFinite(tick))
    .sort((left, right) => left - right)
    .map<PublicTimelinePoint>((tick) => ({
      tick,
      isMeasureStart: tick === 0,
      isMeasureEnd: tick === safeMeasureTicks,
      isBeatBoundary: beatBoundarySet.has(tick),
      trebleStartsHere: trebleStarts.has(tick),
      bassStartsHere: bassStarts.has(tick),
      trebleEndsHere: trebleEnds.has(tick),
      bassEndsHere: bassEnds.has(tick),
    }))

  return {
    measureIndex,
    measureTicks: safeMeasureTicks,
    points,
  }
}
