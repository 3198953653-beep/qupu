import type { MutableRefObject } from 'react'
import type { PlaybackPoint } from '../types'

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

export type PlayheadViewportGeometry = {
  scrollLeft: number
  scrollTop: number
  clientWidth: number
  clientHeight: number
  maxScrollLeft: number
  maxScrollTop: number
  viewportLeft: number
  viewportRight: number
  viewportTop: number
  viewportBottom: number
}

export function getPlaybackPointKey(point: PlaybackPoint): string {
  return `${point.pairIndex}:${point.onsetTick}`
}

export function readPlayheadViewportGeometry(params: {
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  playheadElementRef: MutableRefObject<HTMLDivElement | null>
}): PlayheadViewportGeometry | null {
  const { scoreScrollRef, playheadElementRef } = params
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
}
