import { DURATION_TICKS, TICKS_PER_BEAT } from '../constants'
import type { ScoreNote, StaffKind } from '../types'
import type { StaffTimeline, StaffTimelineEvent } from './types'

function getSafeDurationTicks(note: ScoreNote): number {
  const ticks = DURATION_TICKS[note.duration]
  if (Number.isFinite(ticks) && ticks > 0) {
    return Math.round(ticks)
  }
  return TICKS_PER_BEAT
}

export function buildStaffTimeline(
  notes: ScoreNote[],
  staff: StaffKind,
  measureIndex: number,
  measureTicks: number,
): StaffTimeline {
  const events: StaffTimelineEvent[] = []
  const startTicks: number[] = []
  const endTicks: number[] = []
  let cursorTicks = 0

  notes.forEach((note, noteIndex) => {
    const durationTicks = getSafeDurationTicks(note)
    const startTick = cursorTicks
    const endTick = startTick + durationTicks
    events.push({
      noteId: note.id,
      noteIndex,
      startTick,
      endTick,
      durationTicks,
      isRest: note.isRest === true,
    })
    startTicks.push(startTick)
    endTicks.push(endTick)
    cursorTicks = endTick
  })

  return {
    measureIndex,
    staff,
    measureTicks: Math.max(1, measureTicks),
    events,
    startTicks,
    endTicks,
    firstStartTick: events.length > 0 ? events[0].startTick : null,
    lastEndTick: events.length > 0 ? events[events.length - 1].endTick : null,
  }
}
