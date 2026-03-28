import { TICKS_PER_BEAT } from './constants'
import type { NoteDuration, TimeSignature } from './types'

type TickSpan = {
  startTick: number
  endTick: number
}

const NO_DOT_DURATION_ENTRIES: Array<{ ticks: number; duration: NoteDuration }> = [
  { ticks: 64, duration: 'w' },
  { ticks: 32, duration: 'h' },
  { ticks: 16, duration: 'q' },
  { ticks: 8, duration: '8' },
  { ticks: 4, duration: '16' },
  { ticks: 2, duration: '32' },
]

const NOTE_DURATION_ENTRIES: Array<{ ticks: number; duration: NoteDuration }> = [
  { ticks: 64, duration: 'w' },
  { ticks: 48, duration: 'hd' },
  { ticks: 32, duration: 'h' },
  { ticks: 24, duration: 'qd' },
  { ticks: 16, duration: 'q' },
  { ticks: 12, duration: '8d' },
  { ticks: 8, duration: '8' },
  { ticks: 6, duration: '16d' },
  { ticks: 4, duration: '16' },
  { ticks: 3, duration: '32d' },
  { ticks: 2, duration: '32' },
]

function getBeatTicks(timeSignature: TimeSignature): number {
  const beatType = Number.isFinite(timeSignature.beatType) && timeSignature.beatType > 0 ? timeSignature.beatType : 4
  const rawBeatTicks = TICKS_PER_BEAT * (4 / beatType)
  if (!Number.isFinite(rawBeatTicks) || rawBeatTicks <= 0) return TICKS_PER_BEAT
  return Math.max(1, Math.round(rawBeatTicks))
}

export function isXOver4TimeSignature(timeSignature: TimeSignature): boolean {
  const beats = Number.isFinite(timeSignature.beats) ? Math.max(1, Math.round(timeSignature.beats)) : 4
  const beatType = Number.isFinite(timeSignature.beatType) ? Math.max(1, Math.round(timeSignature.beatType)) : 4
  return beats > 0 && beatType === 4
}

export function getMeasureTicksByTimeSignature(timeSignature: TimeSignature): number {
  const beats = Number.isFinite(timeSignature.beats) ? Math.max(1, Math.round(timeSignature.beats)) : 4
  return beats * getBeatTicks(timeSignature)
}

export function buildBeatBoundaries(measureTicks: number, beatTicks: number): number[] {
  const safeMeasureTicks = Math.max(1, Math.round(measureTicks))
  const safeBeatTicks = Math.max(1, Math.round(beatTicks))
  const boundaries = new Set<number>([0, safeMeasureTicks])
  for (let tick = safeBeatTicks; tick < safeMeasureTicks; tick += safeBeatTicks) {
    boundaries.add(tick)
  }
  return [...boundaries].sort((left, right) => left - right)
}

export function splitSpanByBeat(params: {
  startTick: number
  endTick: number
  beatTicks: number
  measureTicks: number
}): TickSpan[] {
  const { startTick, endTick, beatTicks, measureTicks } = params
  const safeMeasureTicks = Math.max(1, Math.round(measureTicks))
  const safeBeatTicks = Math.max(1, Math.round(beatTicks))
  const start = Math.max(0, Math.min(safeMeasureTicks, Math.round(startTick)))
  const end = Math.max(0, Math.min(safeMeasureTicks, Math.round(endTick)))
  if (end <= start) return []

  const spans: TickSpan[] = []
  let cursor = start
  while (cursor < end) {
    const boundary = Math.min(end, (Math.floor(cursor / safeBeatTicks) + 1) * safeBeatTicks)
    spans.push({ startTick: cursor, endTick: boundary })
    cursor = boundary
  }
  return spans
}

function decomposeNoDotSegmentTicksRightAligned(segmentTicks: number, beatTicks: number): NoteDuration[] | null {
  let remaining = Math.round(segmentTicks)
  const safeBeatTicks = Math.max(1, Math.round(beatTicks))
  if (remaining < 0) return null
  if (remaining === 0) return []

  const reversed: NoteDuration[] = []
  while (remaining > 0) {
    const entry = NO_DOT_DURATION_ENTRIES.find(
      (item) => item.ticks <= remaining && item.ticks <= safeBeatTicks,
    )
    if (!entry) return null
    reversed.push(entry.duration)
    remaining -= entry.ticks
  }
  return reversed.reverse()
}

function decomposeNoteSegmentTicksGreedy(segmentTicks: number, beatTicks: number): NoteDuration[] | null {
  let remaining = Math.round(segmentTicks)
  const safeBeatTicks = Math.max(1, Math.round(beatTicks))
  if (remaining < 0) return null
  if (remaining === 0) return []

  const result: NoteDuration[] = []
  while (remaining > 0) {
    const entry = NOTE_DURATION_ENTRIES.find(
      (item) => item.ticks <= remaining && item.ticks <= safeBeatTicks,
    )
    if (!entry) return null
    result.push(entry.duration)
    remaining -= entry.ticks
  }
  return result
}

export function mergeFullBeatRestsByEvenPairs(params: {
  runStartBeatIndex: number
  runLengthBeats: number
}): NoteDuration[] {
  let cursor = Math.max(0, Math.round(params.runStartBeatIndex))
  let remaining = Math.max(0, Math.round(params.runLengthBeats))
  const result: NoteDuration[] = []

  if (remaining > 0 && cursor % 2 === 1) {
    result.push('q')
    cursor += 1
    remaining -= 1
  }

  while (remaining > 0) {
    if (remaining >= 4 && cursor % 4 === 0) {
      result.push('w')
      cursor += 4
      remaining -= 4
      continue
    }
    if (remaining >= 2 && cursor % 2 === 0) {
      result.push('h')
      cursor += 2
      remaining -= 2
      continue
    }
    result.push('q')
    cursor += 1
    remaining -= 1
  }

  return result
}

export function decomposeRestSpanNoDot(params: {
  startTick: number
  endTick: number
  measureTicks: number
  timeSignature: TimeSignature
}): NoteDuration[] | null {
  const { startTick, endTick, measureTicks, timeSignature } = params
  const beatTicks = getBeatTicks(timeSignature)
  const spans = splitSpanByBeat({
    startTick,
    endTick,
    beatTicks,
    measureTicks,
  })
  const result: NoteDuration[] = []

  let index = 0
  while (index < spans.length) {
    const span = spans[index]
    const spanTicks = span.endTick - span.startTick
    const isFullBeat = spanTicks === beatTicks && span.startTick % beatTicks === 0
    if (!isFullBeat) {
      const segmentDurations = decomposeNoDotSegmentTicksRightAligned(spanTicks, beatTicks)
      if (!segmentDurations) return null
      result.push(...segmentDurations)
      index += 1
      continue
    }

    let runEndIndex = index + 1
    while (runEndIndex < spans.length) {
      const next = spans[runEndIndex]
      const nextTicks = next.endTick - next.startTick
      if (nextTicks !== beatTicks) break
      if (next.startTick % beatTicks !== 0) break
      if (next.startTick !== spans[runEndIndex - 1].endTick) break
      runEndIndex += 1
    }

    const runLengthBeats = runEndIndex - index
    const runStartBeatIndex = Math.floor(span.startTick / beatTicks)
    result.push(
      ...mergeFullBeatRestsByEvenPairs({
        runStartBeatIndex,
        runLengthBeats,
      }),
    )
    index = runEndIndex
  }

  return result
}

export function decomposeNoteSpanAllowDot(params: {
  startTick: number
  endTick: number
  measureTicks: number
  timeSignature: TimeSignature
}): NoteDuration[] | null {
  const { startTick, endTick, measureTicks, timeSignature } = params
  const beatTicks = getBeatTicks(timeSignature)
  const spans = splitSpanByBeat({
    startTick,
    endTick,
    beatTicks,
    measureTicks,
  })

  const result: NoteDuration[] = []
  for (const span of spans) {
    const spanTicks = span.endTick - span.startTick
    const segmentDurations = decomposeNoteSegmentTicksGreedy(spanTicks, beatTicks)
    if (!segmentDurations) return null
    result.push(...segmentDurations)
  }
  return result
}
