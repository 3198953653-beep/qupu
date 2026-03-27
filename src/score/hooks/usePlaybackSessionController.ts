import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { stopPlaybackAction } from '../editorActions'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import type { PlaybackSynth } from '../notePreview'
import type { PlaybackPoint } from '../types'
import type { PlaybackCursorDebugEvent } from './playbackControllerShared'

export function usePlaybackSessionController(params: {
  synthRef: MutableRefObject<PlaybackSynth | null>
  stopPlayTimerRef: MutableRefObject<number | null>
  playbackPointTimerIdsRef: MutableRefObject<number[]>
  playbackSessionIdRef: MutableRefObject<number>
  setIsPlaying: Dispatch<SetStateAction<boolean>>
  firstPlaybackPoint: PlaybackPoint | null
}) {
  const {
    synthRef,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    setIsPlaying,
    firstPlaybackPoint,
  } = params

  const [playbackCursorPoint, setPlaybackCursorPoint] = useState<PlaybackPoint | null>(null)
  const [playbackCursorColor, setPlaybackCursorColor] = useState<'red' | 'yellow'>('red')
  const [playbackSessionId, setPlaybackSessionId] = useState(0)
  const [playbackCursorResetVersion, setPlaybackCursorResetVersion] = useState(1)

  const playbackCursorEventsRef = useRef<PlaybackCursorDebugEvent[]>([])
  const playbackCursorSequenceRef = useRef(0)
  const lastAppliedPlaybackCursorResetVersionRef = useRef(0)

  const requestPlaybackCursorReset = useCallback(() => {
    setPlaybackCursorResetVersion((current) => current + 1)
  }, [])

  useEffect(() => {
    if (lastAppliedPlaybackCursorResetVersionRef.current === playbackCursorResetVersion) return
    lastAppliedPlaybackCursorResetVersionRef.current = playbackCursorResetVersion
    setPlaybackCursorPoint(firstPlaybackPoint)
    setPlaybackCursorColor('red')
  }, [firstPlaybackPoint, playbackCursorResetVersion])

  const appendPlaybackCursorDebugEvent = useCallback((params: {
    kind: PlaybackCursorDebugEvent['kind']
    sessionId: number
    point: PlaybackPoint | null
    status: PlaybackCursorDebugEvent['status']
  }) => {
    const { kind, sessionId, point, status } = params
    playbackCursorSequenceRef.current += 1
    playbackCursorEventsRef.current.push({
      sequence: playbackCursorSequenceRef.current,
      sessionId,
      atMs: Date.now(),
      kind,
      point: point ? { ...point } : null,
      status,
    })
    if (playbackCursorEventsRef.current.length > 240) {
      playbackCursorEventsRef.current.splice(0, playbackCursorEventsRef.current.length - 240)
    }
  }, [])

  const stopActivePlaybackSession = useCallback(() => {
    stopPlaybackAction({
      synthRef,
      stopPlayTimerRef,
      playbackPointTimerIdsRef,
      playbackSessionIdRef,
      setIsPlaying,
    })
    const nextSessionId = playbackSessionIdRef.current
    setPlaybackSessionId(nextSessionId)
    setPlaybackCursorColor('red')
  }, [playbackPointTimerIdsRef, playbackSessionIdRef, setIsPlaying, stopPlayTimerRef, synthRef])

  const handlePlaybackStart = useCallback((params: {
    sessionId: number
    firstEvent: PlaybackTimelineEvent | null
  }) => {
    const { sessionId, firstEvent } = params
    setPlaybackSessionId(sessionId)
    setPlaybackCursorColor('yellow')
    if (firstEvent) {
      setPlaybackCursorPoint(firstEvent.point)
    }
    appendPlaybackCursorDebugEvent({
      kind: 'start',
      sessionId,
      point: firstEvent?.point ?? null,
      status: 'playing',
    })
  }, [appendPlaybackCursorDebugEvent])

  const handlePlaybackPoint = useCallback((params: {
    sessionId: number
    event: PlaybackTimelineEvent
  }) => {
    const { sessionId, event } = params
    setPlaybackSessionId(sessionId)
    setPlaybackCursorPoint(event.point)
    setPlaybackCursorColor('yellow')
    appendPlaybackCursorDebugEvent({
      kind: 'point',
      sessionId,
      point: event.point,
      status: 'playing',
    })
  }, [appendPlaybackCursorDebugEvent])

  const handlePlaybackComplete = useCallback((params: {
    sessionId: number
    lastEvent: PlaybackTimelineEvent | null
  }) => {
    const { sessionId, lastEvent } = params
    setPlaybackSessionId(sessionId)
    if (lastEvent) {
      setPlaybackCursorPoint(lastEvent.point)
    }
    setPlaybackCursorColor('red')
    appendPlaybackCursorDebugEvent({
      kind: 'complete',
      sessionId,
      point: lastEvent?.point ?? null,
      status: 'idle',
    })
  }, [appendPlaybackCursorDebugEvent])

  const playheadStatus: 'idle' | 'playing' = playbackCursorColor === 'yellow' ? 'playing' : 'idle'

  return {
    playbackCursorPoint,
    playbackCursorColor,
    playbackSessionId,
    playheadStatus,
    playbackCursorEventsRef,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
    handlePlaybackStart,
    handlePlaybackPoint,
    handlePlaybackComplete,
  }
}
