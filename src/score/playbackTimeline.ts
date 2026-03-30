import { DURATION_TICKS, QUARTER_NOTE_SECONDS, TICKS_PER_BEAT } from './constants'
import { resolvePairTimeSignature } from './measureRestUtils'
import type { MeasurePair, PedalSpan, PlaybackPoint, Pitch, StaffKind, TimeSignature } from './types'

export type PlaybackTarget = {
  pairIndex: number
  staff: StaffKind
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: Pitch
  baseDurationTicks: number
  playbackDurationTicks: number
  durationSeconds: number
  releaseAbsoluteTick: number
  pedalExtended: boolean
}

export type PlaybackTimelineEvent = {
  point: PlaybackPoint
  pairIndex: number
  onsetTick: number
  absoluteTick: number
  atSeconds: number
  measureTicks: number
  latestReleaseAbsoluteTick: number
  latestReleaseAtSeconds: number
  trebleTargets: PlaybackTarget[]
  bassTargets: PlaybackTarget[]
  targets: PlaybackTarget[]
}

type AbsolutePedalSpan = {
  startAbsoluteTick: number
  endAbsoluteTick: number
}

function getMeasureTicksFromTimeSignature(timeSignature: TimeSignature): number {
  const beats = Number.isFinite(timeSignature.beats) ? Math.max(1, Math.round(timeSignature.beats)) : 4
  const beatType = Number.isFinite(timeSignature.beatType) ? Math.max(1, Math.round(timeSignature.beatType)) : 4
  const beatTicks = TICKS_PER_BEAT * (4 / beatType)
  if (!Number.isFinite(beatTicks) || beatTicks <= 0) {
    return TICKS_PER_BEAT * beats
  }
  return Math.max(1, Math.round(beats * beatTicks))
}

function getSafeDurationTicks(durationTicks: number | undefined): number {
  return typeof durationTicks === 'number' && Number.isFinite(durationTicks) && durationTicks > 0
    ? durationTicks
    : TICKS_PER_BEAT
}

function buildAbsoluteMeasureStarts(params: {
  measurePairs: MeasurePair[]
  timeSignaturesByMeasure: TimeSignature[] | null
}): {
  measureStartAbsoluteTicks: number[]
  measureTicksByPair: number[]
} {
  const { measurePairs, timeSignaturesByMeasure } = params
  const measureStartAbsoluteTicks: number[] = []
  const measureTicksByPair: number[] = []
  let absoluteTickCursor = 0

  measurePairs.forEach((_, pairIndex) => {
    measureStartAbsoluteTicks[pairIndex] = absoluteTickCursor
    const measureTicks = getMeasureTicksFromTimeSignature(
      resolvePairTimeSignature(pairIndex, timeSignaturesByMeasure),
    )
    measureTicksByPair[pairIndex] = measureTicks
    absoluteTickCursor += measureTicks
  })

  return {
    measureStartAbsoluteTicks,
    measureTicksByPair,
  }
}

function buildAbsolutePedalSpans(params: {
  pedalSpans: PedalSpan[]
  measureStartAbsoluteTicks: number[]
  measureTicksByPair: number[]
}): AbsolutePedalSpan[] {
  const { pedalSpans, measureStartAbsoluteTicks, measureTicksByPair } = params
  return pedalSpans.flatMap((span) => {
    const startMeasureAbsoluteTick = measureStartAbsoluteTicks[span.startPairIndex]
    const endMeasureAbsoluteTick = measureStartAbsoluteTicks[span.endPairIndex]
    const startMeasureTicks = measureTicksByPair[span.startPairIndex]
    const endMeasureTicks = measureTicksByPair[span.endPairIndex]
    if (
      !Number.isFinite(startMeasureAbsoluteTick) ||
      !Number.isFinite(endMeasureAbsoluteTick) ||
      !Number.isFinite(startMeasureTicks) ||
      !Number.isFinite(endMeasureTicks)
    ) {
      return []
    }

    const startTick = Math.max(0, Math.min(Math.round(span.startTick), Math.round(startMeasureTicks)))
    const endTick = Math.max(
      span.startPairIndex === span.endPairIndex ? startTick + 1 : 0,
      Math.min(Math.round(span.endTick), Math.round(endMeasureTicks)),
    )
    const startAbsoluteTick = (startMeasureAbsoluteTick as number) + startTick
    const endAbsoluteTick = (endMeasureAbsoluteTick as number) + endTick
    if (!Number.isFinite(startAbsoluteTick) || !Number.isFinite(endAbsoluteTick) || endAbsoluteTick <= startAbsoluteTick) {
      return []
    }

    return [{
      startAbsoluteTick,
      endAbsoluteTick,
    }]
  })
}

function resolvePlaybackReleaseAbsoluteTick(params: {
  onsetAbsoluteTick: number
  baseEndAbsoluteTick: number
  absolutePedalSpans: AbsolutePedalSpan[]
}): number {
  const { onsetAbsoluteTick, baseEndAbsoluteTick, absolutePedalSpans } = params
  let releaseAbsoluteTick = baseEndAbsoluteTick
  absolutePedalSpans.forEach((span) => {
    if (onsetAbsoluteTick < span.startAbsoluteTick || onsetAbsoluteTick >= span.endAbsoluteTick) return
    if (span.endAbsoluteTick > releaseAbsoluteTick) {
      releaseAbsoluteTick = span.endAbsoluteTick
    }
  })
  return releaseAbsoluteTick
}

function buildStaffPlaybackTargets(params: {
  pairIndex: number
  absoluteMeasureStartTick: number
  staff: StaffKind
  notes: MeasurePair['treble']
  absolutePedalSpans: AbsolutePedalSpan[]
}): Map<number, PlaybackTarget[]> {
  const { pairIndex, absoluteMeasureStartTick, staff, notes, absolutePedalSpans } = params
  const targetsByTick = new Map<number, PlaybackTarget[]>()
  let cursorTick = 0
  notes.forEach((note, noteIndex) => {
    const durationTicks = getSafeDurationTicks(DURATION_TICKS[note.duration])
    if (!note.isRest) {
      const pitches = [note.pitch, ...(note.chordPitches ?? [])]
      const onsetAbsoluteTick = absoluteMeasureStartTick + cursorTick
      const baseEndAbsoluteTick = onsetAbsoluteTick + durationTicks
      const releaseAbsoluteTick = resolvePlaybackReleaseAbsoluteTick({
        onsetAbsoluteTick,
        baseEndAbsoluteTick,
        absolutePedalSpans,
      })
      const playbackDurationTicks = Math.max(1, releaseAbsoluteTick - onsetAbsoluteTick)
      const durationSeconds = (playbackDurationTicks / TICKS_PER_BEAT) * QUARTER_NOTE_SECONDS
      const pedalExtended = releaseAbsoluteTick > baseEndAbsoluteTick
      pitches.forEach((pitch, keyIndex) => {
        const bucket = targetsByTick.get(cursorTick) ?? []
        bucket.push({
          pairIndex,
          staff,
          noteId: note.id,
          noteIndex,
          keyIndex,
          pitch,
          baseDurationTicks: durationTicks,
          playbackDurationTicks,
          durationSeconds,
          releaseAbsoluteTick,
          pedalExtended,
        })
        targetsByTick.set(cursorTick, bucket)
      })
    }

    cursorTick += durationTicks
  })

  return targetsByTick
}

export function buildPlaybackTimeline(params: {
  measurePairs: MeasurePair[]
  timeSignaturesByMeasure?: TimeSignature[] | null
  pedalSpans?: PedalSpan[] | null
}): PlaybackTimelineEvent[] {
  const { measurePairs, timeSignaturesByMeasure = null, pedalSpans = null } = params
  const events: PlaybackTimelineEvent[] = []
  const { measureStartAbsoluteTicks, measureTicksByPair } = buildAbsoluteMeasureStarts({
    measurePairs,
    timeSignaturesByMeasure,
  })
  const absolutePedalSpans = buildAbsolutePedalSpans({
    pedalSpans: pedalSpans ?? [],
    measureStartAbsoluteTicks,
    measureTicksByPair,
  })

  measurePairs.forEach((pair, pairIndex) => {
    const measureTicks = measureTicksByPair[pairIndex] ?? getMeasureTicksFromTimeSignature(
      resolvePairTimeSignature(pairIndex, timeSignaturesByMeasure),
    )
    const absoluteMeasureStartTick = measureStartAbsoluteTicks[pairIndex] ?? 0
    const trebleTargetsByTick = buildStaffPlaybackTargets({
      pairIndex,
      absoluteMeasureStartTick,
      staff: 'treble',
      notes: pair.treble,
      absolutePedalSpans,
    })
    const bassTargetsByTick = buildStaffPlaybackTargets({
      pairIndex,
      absoluteMeasureStartTick,
      staff: 'bass',
      notes: pair.bass,
      absolutePedalSpans,
    })
    const onsetTicks = [...new Set([...trebleTargetsByTick.keys(), ...bassTargetsByTick.keys()])].sort((left, right) => left - right)

    onsetTicks.forEach((onsetTick) => {
      const trebleTargets = trebleTargetsByTick.get(onsetTick) ?? []
      const bassTargets = bassTargetsByTick.get(onsetTick) ?? []
      const targets = [...trebleTargets, ...bassTargets]
      if (targets.length === 0) return

      const absoluteTick = absoluteMeasureStartTick + onsetTick
      const latestReleaseAbsoluteTick = targets.reduce(
        (maxReleaseTick, target) => Math.max(maxReleaseTick, target.releaseAbsoluteTick),
        absoluteTick,
      )
      events.push({
        point: { pairIndex, onsetTick },
        pairIndex,
        onsetTick,
        absoluteTick,
        atSeconds: (absoluteTick / TICKS_PER_BEAT) * QUARTER_NOTE_SECONDS,
        measureTicks,
        latestReleaseAbsoluteTick,
        latestReleaseAtSeconds: (latestReleaseAbsoluteTick / TICKS_PER_BEAT) * QUARTER_NOTE_SECONDS,
        trebleTargets,
        bassTargets,
        targets,
      })
    })
  })

  return events
}
