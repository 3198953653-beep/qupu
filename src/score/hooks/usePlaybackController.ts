import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import type { PlaybackSynth } from '../notePreview'
import type { PlaybackCursorRect, PlaybackPoint } from '../types'
import {
  readPlayheadViewportGeometry,
  type PlaybackCursorDebugEvent,
  type PlayheadDebugLogRow,
} from './playbackControllerShared'
import { usePlaybackDebugLog } from './usePlaybackDebugLog'
import { usePlaybackSessionController } from './usePlaybackSessionController'
import { usePlayheadFollowScroll } from './usePlayheadFollowScroll'
export {
  getPlaybackPointKey,
  type PlaybackCursorDebugEvent,
  type PlayheadDebugLogRow,
} from './playbackControllerShared'

export function usePlaybackController(params: {
  synthRef: MutableRefObject<PlaybackSynth | null>
  stopPlayTimerRef: MutableRefObject<number | null>
  playbackPointTimerIdsRef: MutableRefObject<number[]>
  playbackSessionIdRef: MutableRefObject<number>
  setIsPlaying: Dispatch<SetStateAction<boolean>>
  firstPlaybackPoint: PlaybackPoint | null
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  getPlayheadRectPx: () => PlaybackCursorRect | null
  playheadGeometryRevision: string | number
  playheadFollowEnabled: boolean
}): {
  playbackCursorPoint: PlaybackPoint | null
  playbackCursorColor: 'red' | 'yellow'
  playbackSessionId: number
  playheadStatus: 'idle' | 'playing'
  playheadElementRef: MutableRefObject<HTMLDivElement | null>
  playheadDebugLogText: string
  playbackCursorEventsRef: MutableRefObject<PlaybackCursorDebugEvent[]>
  playheadDebugLogRowsRef: MutableRefObject<PlayheadDebugLogRow[]>
  latestPlayheadDebugSnapshotRef: MutableRefObject<PlayheadDebugLogRow | null>
  playheadDebugSequenceRef: MutableRefObject<number>
  measurePlayheadDebugLogRow: (sequence: number) => PlayheadDebugLogRow | null
  requestPlaybackCursorReset: () => void
  stopActivePlaybackSession: () => void
  handlePlaybackStart: (params: { sessionId: number; firstEvent: PlaybackTimelineEvent | null }) => void
  handlePlaybackPoint: (params: { sessionId: number; event: PlaybackTimelineEvent }) => void
  handlePlaybackComplete: (params: { sessionId: number; lastEvent: PlaybackTimelineEvent | null }) => void
} {
  const {
    scoreScrollRef,
    getPlayheadRectPx,
    playheadGeometryRevision,
    playheadFollowEnabled,
    ...sessionController
  } = params

  const playheadElementRef = useRef<HTMLDivElement | null>(null)
  const session = usePlaybackSessionController(sessionController)

  const measurePlayheadViewportGeometry = useCallback(() => {
    return readPlayheadViewportGeometry({
      scoreScrollRef,
      playheadElementRef,
    })
  }, [scoreScrollRef])

  usePlayheadFollowScroll({
    scoreScrollRef,
    getPlayheadRectPx,
    measurePlayheadViewportGeometry,
    playheadGeometryRevision,
    playheadFollowEnabled,
    playheadStatus: session.playheadStatus,
    playbackSessionId: session.playbackSessionId,
  })
  const debugLog = usePlaybackDebugLog({
    playbackCursorPoint: session.playbackCursorPoint,
    playheadStatus: session.playheadStatus,
    playheadGeometryRevision,
    scoreScrollRef,
    measurePlayheadViewportGeometry,
  })

  return {
    playbackCursorPoint: session.playbackCursorPoint,
    playbackCursorColor: session.playbackCursorColor,
    playbackSessionId: session.playbackSessionId,
    playheadStatus: session.playheadStatus,
    playheadElementRef,
    playheadDebugLogText: debugLog.playheadDebugLogText,
    playbackCursorEventsRef: session.playbackCursorEventsRef,
    playheadDebugLogRowsRef: debugLog.playheadDebugLogRowsRef,
    latestPlayheadDebugSnapshotRef: debugLog.latestPlayheadDebugSnapshotRef,
    playheadDebugSequenceRef: debugLog.playheadDebugSequenceRef,
    measurePlayheadDebugLogRow: debugLog.measurePlayheadDebugLogRow,
    requestPlaybackCursorReset: session.requestPlaybackCursorReset,
    stopActivePlaybackSession: session.stopActivePlaybackSession,
    handlePlaybackStart: session.handlePlaybackStart,
    handlePlaybackPoint: session.handlePlaybackPoint,
    handlePlaybackComplete: session.handlePlaybackComplete,
  }
}
