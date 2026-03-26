import { useMemo, type MutableRefObject } from 'react'
import {
  SCORE_TOP_PADDING,
  SYSTEM_BASS_OFFSET_Y,
  SYSTEM_TREBLE_OFFSET_Y,
} from '../constants'
import type { MeasureTimelineBundle } from '../timeline/types'
import type {
  MeasureFrame,
  MeasureLayout,
  NoteLayout,
  PlaybackCursorRect,
  PlaybackCursorState,
  PlaybackPoint,
} from '../types'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import { getPlaybackPointKey } from './usePlaybackController'

const SCORE_STAGE_BORDER_PX = 1
const PLAYHEAD_OFFSET_PX = 2
const PLAYHEAD_WIDTH_PX = 2
const PLAYHEAD_VERTICAL_MARGIN_PX = 15

type MeasureFrameContentGeometry = {
  contentStartX: number
  contentMeasureWidth: number
}

export function usePlaybackCursorLayout(params: {
  playbackCursorPoint: PlaybackPoint | null
  playbackCursorColor: 'red' | 'yellow'
  playbackTimelineEventByPointKey: Map<string, PlaybackTimelineEvent>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  measureTimelineBundlesRef: MutableRefObject<Map<number, MeasureTimelineBundle>>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  horizontalMeasureFramesByPair: MeasureFrame[]
  getMeasureFrameContentGeometry: (frame: MeasureFrame | null | undefined) => MeasureFrameContentGeometry | null
  horizontalRenderOffsetX: number
  layoutStabilityKey: string
  chordMarkerLayoutRevision: number
  scoreScaleX: number
  scoreScaleY: number
  scoreSurfaceOffsetYPx: number
}): {
  playheadRectPx: PlaybackCursorRect | null
  playbackCursorState: PlaybackCursorState
} {
  const {
    playbackCursorPoint,
    playbackCursorColor,
    playbackTimelineEventByPointKey,
    noteLayoutsByPairRef,
    measureTimelineBundlesRef,
    measureLayoutsRef,
    horizontalMeasureFramesByPair,
    getMeasureFrameContentGeometry,
    horizontalRenderOffsetX,
    layoutStabilityKey,
    chordMarkerLayoutRevision,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetYPx,
  } = params

  const playheadRectPx = useMemo<PlaybackCursorRect | null>(() => {
    void layoutStabilityKey
    void chordMarkerLayoutRevision
    if (!playbackCursorPoint) return null
    const playbackEvent = playbackTimelineEventByPointKey.get(getPlaybackPointKey(playbackCursorPoint)) ?? null
    if (!playbackEvent) return null

    const pairLayouts = noteLayoutsByPairRef.current.get(playbackCursorPoint.pairIndex) ?? []
    const layoutByStaffNoteIndex = new Map<string, NoteLayout>()
    pairLayouts.forEach((layout) => {
      layoutByStaffNoteIndex.set(`${layout.staff}:${layout.noteIndex}`, layout)
    })

    let bestHeadCandidate:
      | {
          globalX: number
          staffPriority: number
          noteIndex: number
          keyIndex: number
        }
      | null = null

    for (const target of playbackEvent.targets) {
      const layout = layoutByStaffNoteIndex.get(`${target.staff}:${target.noteIndex}`) ?? null
      if (!layout) continue
      const head = layout.noteHeads.find((item) => item.keyIndex === target.keyIndex) ?? null
      if (!head) continue
      const localLeftX = Number.isFinite(head.hitMinX) ? (head.hitMinX as number) : head.x
      if (!Number.isFinite(localLeftX)) continue
      const candidate = {
        globalX: localLeftX + horizontalRenderOffsetX,
        staffPriority: target.staff === 'treble' ? 0 : 1,
        noteIndex: target.noteIndex,
        keyIndex: target.keyIndex,
      }
      if (
        bestHeadCandidate === null ||
        candidate.globalX < bestHeadCandidate.globalX - 0.001 ||
        (Math.abs(candidate.globalX - bestHeadCandidate.globalX) <= 0.001 &&
          (candidate.staffPriority < bestHeadCandidate.staffPriority ||
            (candidate.staffPriority === bestHeadCandidate.staffPriority &&
              (candidate.noteIndex < bestHeadCandidate.noteIndex ||
                (candidate.noteIndex === bestHeadCandidate.noteIndex && candidate.keyIndex < bestHeadCandidate.keyIndex)))))
      ) {
        bestHeadCandidate = candidate
      }
    }

    let globalHeadLeftX: number | null = bestHeadCandidate?.globalX ?? null
    if (globalHeadLeftX === null) {
      const timelineBundle = measureTimelineBundlesRef.current.get(playbackCursorPoint.pairIndex) ?? null
      const axisX = timelineBundle?.publicAxisLayout?.tickToX.get(playbackCursorPoint.onsetTick)
      if (typeof axisX === 'number' && Number.isFinite(axisX)) {
        globalHeadLeftX = axisX + horizontalRenderOffsetX
      }
    }
    if (globalHeadLeftX === null) {
      const frame = horizontalMeasureFramesByPair[playbackCursorPoint.pairIndex] ?? null
      const frameContentGeometry = getMeasureFrameContentGeometry(frame)
      if (frame && frameContentGeometry) {
        globalHeadLeftX =
          frameContentGeometry.contentStartX +
          frameContentGeometry.contentMeasureWidth *
            (playbackCursorPoint.onsetTick / Math.max(1, playbackEvent.measureTicks))
      }
    }
    if (globalHeadLeftX === null || !Number.isFinite(globalHeadLeftX)) return null

    const measureLayout =
      measureLayoutsRef.current.get(playbackCursorPoint.pairIndex) ??
      [...measureLayoutsRef.current.values()][0] ??
      null
    const trebleTopRaw =
      measureLayout !== null && Number.isFinite(measureLayout.trebleLineTopY)
        ? measureLayout.trebleLineTopY
        : SCORE_TOP_PADDING + SYSTEM_TREBLE_OFFSET_Y
    const trebleBottomRaw =
      measureLayout !== null && Number.isFinite(measureLayout.trebleLineBottomY)
        ? measureLayout.trebleLineBottomY
        : SCORE_TOP_PADDING + SYSTEM_TREBLE_OFFSET_Y + 40
    const bassTopRaw =
      measureLayout !== null && Number.isFinite(measureLayout.bassLineTopY)
        ? measureLayout.bassLineTopY
        : SCORE_TOP_PADDING + SYSTEM_BASS_OFFSET_Y
    const bassBottomRaw =
      measureLayout !== null && Number.isFinite(measureLayout.bassLineBottomY)
        ? measureLayout.bassLineBottomY
        : SCORE_TOP_PADDING + SYSTEM_BASS_OFFSET_Y + 40
    const lineTopRaw = Math.min(trebleTopRaw, trebleBottomRaw, bassTopRaw, bassBottomRaw)
    const lineBottomRaw = Math.max(trebleTopRaw, trebleBottomRaw, bassTopRaw, bassBottomRaw)
    const x = globalHeadLeftX * scoreScaleX + SCORE_STAGE_BORDER_PX - PLAYHEAD_OFFSET_PX
    const y = scoreSurfaceOffsetYPx + lineTopRaw * scoreScaleY + SCORE_STAGE_BORDER_PX - PLAYHEAD_VERTICAL_MARGIN_PX
    const bottomY =
      scoreSurfaceOffsetYPx + lineBottomRaw * scoreScaleY + SCORE_STAGE_BORDER_PX + PLAYHEAD_VERTICAL_MARGIN_PX
    const height = bottomY - y
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(height)) return null
    if (height <= 0) return null
    return {
      x,
      y,
      width: PLAYHEAD_WIDTH_PX,
      height,
    }
  }, [
    chordMarkerLayoutRevision,
    getMeasureFrameContentGeometry,
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    layoutStabilityKey,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    noteLayoutsByPairRef,
    playbackCursorPoint,
    playbackTimelineEventByPointKey,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetYPx,
  ])

  const playbackCursorState = useMemo<PlaybackCursorState>(() => ({
    point: playbackCursorPoint ? { ...playbackCursorPoint } : null,
    color: playbackCursorColor,
    rectPx: playheadRectPx ? { ...playheadRectPx } : null,
  }), [playbackCursorColor, playbackCursorPoint, playheadRectPx])

  return {
    playheadRectPx,
    playbackCursorState,
  }
}
