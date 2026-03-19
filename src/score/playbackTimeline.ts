import { DURATION_TICKS, DURATION_TONE, QUARTER_NOTE_SECONDS, TICKS_PER_BEAT } from './constants'
import { resolvePairTimeSignature } from './measureRestUtils'
import type { MeasurePair, PlaybackPoint, Pitch, StaffKind, TimeSignature } from './types'

type PlaybackTarget = {
  pairIndex: number
  staff: StaffKind
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: Pitch
  durationTone: string
}

export type PlaybackTimelineEvent = {
  point: PlaybackPoint
  pairIndex: number
  onsetTick: number
  absoluteTick: number
  atSeconds: number
  measureTicks: number
  trebleTargets: PlaybackTarget[]
  bassTargets: PlaybackTarget[]
  targets: PlaybackTarget[]
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

function buildStaffPlaybackTargets(params: {
  pairIndex: number
  staff: StaffKind
  notes: MeasurePair['treble']
}): Map<number, PlaybackTarget[]> {
  const { pairIndex, staff, notes } = params
  const targetsByTick = new Map<number, PlaybackTarget[]>()
  let cursorTick = 0
  notes.forEach((note, noteIndex) => {
    if (!note.isRest) {
      const pitches = [note.pitch, ...(note.chordPitches ?? [])]
      pitches.forEach((pitch, keyIndex) => {
        const bucket = targetsByTick.get(cursorTick) ?? []
        bucket.push({
          pairIndex,
          staff,
          noteId: note.id,
          noteIndex,
          keyIndex,
          pitch,
          durationTone: DURATION_TONE[note.duration],
        })
        targetsByTick.set(cursorTick, bucket)
      })
    }

    const durationTicks = DURATION_TICKS[note.duration]
    const safeDurationTicks = Number.isFinite(durationTicks) && durationTicks > 0 ? durationTicks : TICKS_PER_BEAT
    cursorTick += safeDurationTicks
  })

  return targetsByTick
}

export function buildPlaybackTimeline(params: {
  measurePairs: MeasurePair[]
  timeSignaturesByMeasure?: TimeSignature[] | null
}): PlaybackTimelineEvent[] {
  const { measurePairs, timeSignaturesByMeasure = null } = params
  const events: PlaybackTimelineEvent[] = []
  let absoluteTickCursor = 0

  measurePairs.forEach((pair, pairIndex) => {
    const timeSignature = resolvePairTimeSignature(pairIndex, timeSignaturesByMeasure)
    const measureTicks = getMeasureTicksFromTimeSignature(timeSignature)
    const trebleTargetsByTick = buildStaffPlaybackTargets({
      pairIndex,
      staff: 'treble',
      notes: pair.treble,
    })
    const bassTargetsByTick = buildStaffPlaybackTargets({
      pairIndex,
      staff: 'bass',
      notes: pair.bass,
    })
    const onsetTicks = [...new Set([...trebleTargetsByTick.keys(), ...bassTargetsByTick.keys()])].sort((left, right) => left - right)

    onsetTicks.forEach((onsetTick) => {
      const trebleTargets = trebleTargetsByTick.get(onsetTick) ?? []
      const bassTargets = bassTargetsByTick.get(onsetTick) ?? []
      const targets = [...trebleTargets, ...bassTargets]
      if (targets.length === 0) return

      const absoluteTick = absoluteTickCursor + onsetTick
      events.push({
        point: { pairIndex, onsetTick },
        pairIndex,
        onsetTick,
        absoluteTick,
        atSeconds: (absoluteTick / TICKS_PER_BEAT) * QUARTER_NOTE_SECONDS,
        measureTicks,
        trebleTargets,
        bassTargets,
        targets,
      })
    })

    absoluteTickCursor += measureTicks
  })

  return events
}
