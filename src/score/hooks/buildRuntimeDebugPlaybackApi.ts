import type { MutableRefObject } from 'react'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import type { PlaybackCursorState } from '../types'
import type { PlaybackCursorDebugEvent, PlayheadDebugLogRow } from './usePlaybackController'
import type { NotePreviewDebugEvent } from './useScoreAudioPreviewController'

export function buildRuntimeDebugPlaybackApi(params: {
  notePreviewEventsRef: MutableRefObject<NotePreviewDebugEvent[]>
  playbackCursorState: PlaybackCursorState
  playheadStatus: 'idle' | 'playing'
  playbackSessionId: number
  playbackCursorEventsRef: MutableRefObject<PlaybackCursorDebugEvent[]>
  playheadDebugLogRowsRef: MutableRefObject<PlayheadDebugLogRow[]>
  measurePlayheadDebugLogRow: (sequence: number) => PlayheadDebugLogRow | null
  latestPlayheadDebugSnapshotRef: MutableRefObject<PlayheadDebugLogRow | null>
  playheadDebugSequenceRef: MutableRefObject<number>
  playbackTimelineEvents: PlaybackTimelineEvent[]
}) {
  const {
    notePreviewEventsRef,
    playbackCursorState,
    playheadStatus,
    playbackSessionId,
    playbackCursorEventsRef,
    playheadDebugLogRowsRef,
    measurePlayheadDebugLogRow,
    latestPlayheadDebugSnapshotRef,
    playheadDebugSequenceRef,
    playbackTimelineEvents,
  } = params

  return {
    getNotePreviewEvents: () => notePreviewEventsRef.current.map((event) => ({ ...event })),
    clearNotePreviewEvents: () => {
      notePreviewEventsRef.current = []
    },
    getPlaybackCursorState: () => ({
      ...playbackCursorState,
      point: playbackCursorState.point ? { ...playbackCursorState.point } : null,
      rectPx: playbackCursorState.rectPx ? { ...playbackCursorState.rectPx } : null,
      status: playheadStatus,
      sessionId: playbackSessionId,
    }),
    getPlaybackCursorEvents: () => playbackCursorEventsRef.current.map((event) => ({
      ...event,
      point: event.point ? { ...event.point } : null,
    })),
    clearPlaybackCursorEvents: () => {
      playbackCursorEventsRef.current = []
    },
    getPlayheadDebugLogRows: () => playheadDebugLogRowsRef.current.map((row) => ({ ...row })),
    getPlayheadDebugViewportSnapshot: () =>
      measurePlayheadDebugLogRow(
        latestPlayheadDebugSnapshotRef.current?.seq ?? playheadDebugSequenceRef.current,
      ) ??
      (latestPlayheadDebugSnapshotRef.current ? { ...latestPlayheadDebugSnapshotRef.current } : null),
    getPlaybackTimelinePoints: () =>
      playbackTimelineEvents.map((event) => ({
        pairIndex: event.pairIndex,
        onsetTick: event.onsetTick,
        atSeconds: event.atSeconds,
        targetCount: event.targets.length,
      })),
  }
}
