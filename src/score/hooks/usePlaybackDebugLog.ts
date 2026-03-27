import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { PlaybackPoint } from '../types'
import {
  getPlaybackPointKey,
  type PlayheadDebugLogRow,
  type PlayheadViewportGeometry,
} from './playbackControllerShared'

export function usePlaybackDebugLog(params: {
  playbackCursorPoint: PlaybackPoint | null
  playheadStatus: 'idle' | 'playing'
  playheadGeometryRevision: string | number
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  measurePlayheadViewportGeometry: () => PlayheadViewportGeometry | null
}) {
  const {
    playbackCursorPoint,
    playheadStatus,
    playheadGeometryRevision,
    scoreScrollRef,
    measurePlayheadViewportGeometry,
  } = params

  const [playheadDebugLogRows, setPlayheadDebugLogRows] = useState<PlayheadDebugLogRow[]>([])

  const playheadDebugLogRowsRef = useRef<PlayheadDebugLogRow[]>([])
  const playheadDebugSequenceRef = useRef(0)
  const playheadDebugLastSnapshotKeyRef = useRef<string | null>(null)
  const playheadDebugLastIdlePointKeyRef = useRef<string | null>(null)
  const playheadDebugMeasureRafRef = useRef<number | null>(null)
  const playheadDebugScrollRafRef = useRef<number | null>(null)
  const latestPlayheadDebugSnapshotRef = useRef<PlayheadDebugLogRow | null>(null)

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
    playheadDebugLogText,
    playheadDebugLogRowsRef,
    latestPlayheadDebugSnapshotRef,
    playheadDebugSequenceRef,
    measurePlayheadDebugLogRow,
  }
}
