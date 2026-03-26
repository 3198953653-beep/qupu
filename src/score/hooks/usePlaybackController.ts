import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { stopPlaybackAction } from '../editorActions'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import type { PlaybackSynth } from '../notePreview'
import type { PlaybackCursorRect, PlaybackPoint } from '../types'

export type PlaybackCursorDebugEvent = {
  sequence: number
  sessionId: number
  atMs: number
  kind: 'start' | 'point' | 'complete'
  point: PlaybackPoint | null
  status: 'idle' | 'playing'
}

export type PlayheadDebugLogRow = {
  seq: number
  playheadX: number | null
  containerLeftX: number
  containerRightX: number
  distanceToRightEdge: number | null
}

export function getPlaybackPointKey(point: PlaybackPoint): string {
  return `${point.pairIndex}:${point.onsetTick}`
}

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
    synthRef,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    setIsPlaying,
    firstPlaybackPoint,
    scoreScrollRef,
    getPlayheadRectPx,
    playheadGeometryRevision,
    playheadFollowEnabled,
  } = params

  const [playbackCursorPoint, setPlaybackCursorPoint] = useState<PlaybackPoint | null>(null)
  const [playbackCursorColor, setPlaybackCursorColor] = useState<'red' | 'yellow'>('red')
  const [playbackSessionId, setPlaybackSessionId] = useState(0)
  const [playbackCursorResetVersion, setPlaybackCursorResetVersion] = useState(1)
  const [playheadDebugLogRows, setPlayheadDebugLogRows] = useState<PlayheadDebugLogRow[]>([])

  const playbackCursorEventsRef = useRef<PlaybackCursorDebugEvent[]>([])
  const playbackCursorSequenceRef = useRef(0)
  const playheadDebugLogRowsRef = useRef<PlayheadDebugLogRow[]>([])
  const playheadDebugSequenceRef = useRef(0)
  const playheadDebugLastSnapshotKeyRef = useRef<string | null>(null)
  const playheadDebugLastIdlePointKeyRef = useRef<string | null>(null)
  const playheadDebugMeasureRafRef = useRef<number | null>(null)
  const playheadDebugScrollRafRef = useRef<number | null>(null)
  const latestPlayheadDebugSnapshotRef = useRef<PlayheadDebugLogRow | null>(null)
  const lastAppliedPlaybackCursorResetVersionRef = useRef(0)
  const playheadElementRef = useRef<HTMLDivElement | null>(null)

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

  const measurePlayheadViewportGeometry = useCallback(() => {
    const scrollHost = scoreScrollRef.current
    const playheadElement = playheadElementRef.current
    if (!scrollHost || !playheadElement) return null

    const scrollHostRect = scrollHost.getBoundingClientRect()
    const playheadRect = playheadElement.getBoundingClientRect()
    return {
      scrollLeft: scrollHost.scrollLeft,
      scrollTop: scrollHost.scrollTop,
      clientWidth: scrollHost.clientWidth,
      clientHeight: scrollHost.clientHeight,
      maxScrollLeft: Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth),
      maxScrollTop: Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight),
      viewportLeft: playheadRect.left - scrollHostRect.left,
      viewportRight: playheadRect.right - scrollHostRect.left,
      viewportTop: playheadRect.top - scrollHostRect.top,
      viewportBottom: playheadRect.bottom - scrollHostRect.top,
    }
  }, [scoreScrollRef])

  useEffect(() => {
    const playheadRectPx = getPlayheadRectPx()
    if (playheadStatus !== 'playing' || !playheadRectPx || !playheadFollowEnabled) return

    const scrollHost = scoreScrollRef.current
    const geometry = measurePlayheadViewportGeometry()
    if (!scrollHost || !geometry) return

    const PLAYHEAD_HORIZONTAL_SCROLL_TRIGGER_MARGIN_PX = 24
    const PLAYHEAD_HORIZONTAL_SCROLL_LEFT_ANCHOR_PX = 72
    const PLAYHEAD_VIEWPORT_MARGIN_Y_PX = 24

    let nextScrollLeft = geometry.scrollLeft
    let nextScrollTop = geometry.scrollTop

    if (geometry.viewportLeft < 0) {
      nextScrollLeft = Math.max(
        0,
        Math.min(
          geometry.maxScrollLeft,
          geometry.scrollLeft + geometry.viewportLeft - PLAYHEAD_HORIZONTAL_SCROLL_LEFT_ANCHOR_PX,
        ),
      )
    } else if (geometry.clientWidth - geometry.viewportRight <= PLAYHEAD_HORIZONTAL_SCROLL_TRIGGER_MARGIN_PX) {
      const targetScrollLeft = Math.max(
        0,
        geometry.scrollLeft + geometry.viewportLeft - PLAYHEAD_HORIZONTAL_SCROLL_LEFT_ANCHOR_PX,
      )
      nextScrollLeft = targetScrollLeft <= geometry.maxScrollLeft ? targetScrollLeft : geometry.maxScrollLeft
    }

    if (geometry.viewportTop - PLAYHEAD_VIEWPORT_MARGIN_Y_PX < 0) {
      nextScrollTop = Math.max(0, geometry.scrollTop + geometry.viewportTop - PLAYHEAD_VIEWPORT_MARGIN_Y_PX)
    } else if (geometry.viewportBottom + PLAYHEAD_VIEWPORT_MARGIN_Y_PX > geometry.clientHeight) {
      nextScrollTop = Math.max(
        0,
        geometry.scrollTop + geometry.viewportBottom + PLAYHEAD_VIEWPORT_MARGIN_Y_PX - geometry.clientHeight,
      )
    }

    nextScrollLeft = Math.max(0, Math.min(geometry.maxScrollLeft, nextScrollLeft))
    nextScrollTop = Math.max(0, Math.min(geometry.maxScrollTop, nextScrollTop))

    if (Math.abs(nextScrollLeft - geometry.scrollLeft) < 0.5 && Math.abs(nextScrollTop - geometry.scrollTop) < 0.5) {
      return
    }
    scrollHost.scrollTo({
      left: nextScrollLeft,
      top: nextScrollTop,
      behavior: 'auto',
    })
  }, [
    getPlayheadRectPx,
    measurePlayheadViewportGeometry,
    playheadFollowEnabled,
    playheadGeometryRevision,
    playheadStatus,
    playbackSessionId,
    scoreScrollRef,
  ])

  const measurePlayheadDebugLogRow = useCallback((sequence: number): PlayheadDebugLogRow | null => {
    const geometry = measurePlayheadViewportGeometry()
    if (!geometry) return null

    const roundCoord = (value: number): number => Number(value.toFixed(1))
    const containerLeftX = 0
    const containerRightX = roundCoord(geometry.clientWidth)
    const playheadX = roundCoord(geometry.viewportLeft)
    const distanceToRightEdge = roundCoord(containerRightX - playheadX)
    return {
      seq: sequence,
      playheadX,
      containerLeftX,
      containerRightX,
      distanceToRightEdge,
    }
  }, [measurePlayheadViewportGeometry])

  const appendPlayheadDebugLogRow = useCallback(() => {
    const nextRow = measurePlayheadDebugLogRow(playheadDebugSequenceRef.current + 1)
    if (!nextRow) return
    const snapshotKey = JSON.stringify({
      playheadX: nextRow.playheadX,
      containerLeftX: nextRow.containerLeftX,
      containerRightX: nextRow.containerRightX,
      distanceToRightEdge: nextRow.distanceToRightEdge,
    })
    if (playheadDebugLastSnapshotKeyRef.current === snapshotKey) return

    playheadDebugSequenceRef.current += 1
    nextRow.seq = playheadDebugSequenceRef.current
    playheadDebugLastSnapshotKeyRef.current = snapshotKey
    latestPlayheadDebugSnapshotRef.current = nextRow
    setPlayheadDebugLogRows((current) => {
      const nextRows = [...current, nextRow]
      if (nextRows.length > 200) {
        nextRows.splice(0, nextRows.length - 200)
      }
      playheadDebugLogRowsRef.current = nextRows
      return nextRows
    })
  }, [measurePlayheadDebugLogRow])

  const schedulePlayheadDebugLogRow = useCallback(() => {
    if (playheadDebugMeasureRafRef.current !== null) {
      window.cancelAnimationFrame(playheadDebugMeasureRafRef.current)
      playheadDebugMeasureRafRef.current = null
    }
    playheadDebugMeasureRafRef.current = window.requestAnimationFrame(() => {
      playheadDebugMeasureRafRef.current = window.requestAnimationFrame(() => {
        playheadDebugMeasureRafRef.current = null
        appendPlayheadDebugLogRow()
      })
    })
  }, [appendPlayheadDebugLogRow])

  const playheadDebugLogText = useMemo(() => {
    if (playheadDebugLogRows.length === 0) {
      return '等待播放线位置数据...'
    }
    return playheadDebugLogRows
      .map((row) => {
        return [
          `播放线X：${row.playheadX === null ? '暂无' : row.playheadX.toFixed(1)}`,
          `容器左边缘X：${row.containerLeftX.toFixed(1)}`,
          `容器右边缘X：${row.containerRightX.toFixed(1)}`,
          `距右边缘：${row.distanceToRightEdge === null ? '暂无' : row.distanceToRightEdge.toFixed(1)}`,
        ].join(' ｜ ')
      })
      .join('\n')
  }, [playheadDebugLogRows])

  useEffect(() => {
    const currentPointKey = playbackCursorPoint ? getPlaybackPointKey(playbackCursorPoint) : null
    const shouldRefreshIdleLog =
      playheadDebugLogRowsRef.current.length === 0 || playheadDebugLastIdlePointKeyRef.current !== currentPointKey
    if (playheadStatus !== 'playing' && !shouldRefreshIdleLog) {
      return
    }
    schedulePlayheadDebugLogRow()
    playheadDebugLastIdlePointKeyRef.current = currentPointKey
  }, [playbackCursorPoint, playheadGeometryRevision, playheadStatus, schedulePlayheadDebugLogRow])

  useEffect(() => {
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) return

    const handleScroll = () => {
      if (playheadStatus !== 'playing') return
      if (playheadDebugScrollRafRef.current !== null) return
      playheadDebugScrollRafRef.current = window.requestAnimationFrame(() => {
        playheadDebugScrollRafRef.current = null
        schedulePlayheadDebugLogRow()
      })
    }

    scrollHost.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollHost.removeEventListener('scroll', handleScroll)
      if (playheadDebugScrollRafRef.current !== null) {
        window.cancelAnimationFrame(playheadDebugScrollRafRef.current)
        playheadDebugScrollRafRef.current = null
      }
      if (playheadDebugMeasureRafRef.current !== null) {
        window.cancelAnimationFrame(playheadDebugMeasureRafRef.current)
        playheadDebugMeasureRafRef.current = null
      }
    }
  }, [playheadStatus, schedulePlayheadDebugLogRow, scoreScrollRef])

  return {
    playbackCursorPoint,
    playbackCursorColor,
    playbackSessionId,
    playheadStatus,
    playheadElementRef,
    playheadDebugLogText,
    playbackCursorEventsRef,
    playheadDebugLogRowsRef,
    latestPlayheadDebugSnapshotRef,
    playheadDebugSequenceRef,
    measurePlayheadDebugLogRow,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
    handlePlaybackStart,
    handlePlaybackPoint,
    handlePlaybackComplete,
  }
}
