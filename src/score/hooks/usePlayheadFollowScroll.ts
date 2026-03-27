import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { PlaybackCursorRect } from '../types'
import type { PlayheadViewportGeometry } from './playbackControllerShared'

export function usePlayheadFollowScroll(params: {
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  getPlayheadRectPx: () => PlaybackCursorRect | null
  measurePlayheadViewportGeometry: () => PlayheadViewportGeometry | null
  playheadGeometryRevision: string | number
  playheadFollowEnabled: boolean
  playheadStatus: 'idle' | 'playing'
  playbackSessionId: number
}) {
  const {
    scoreScrollRef,
    getPlayheadRectPx,
    measurePlayheadViewportGeometry,
    playheadGeometryRevision,
    playheadFollowEnabled,
    playheadStatus,
    playbackSessionId,
  } = params

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
}
