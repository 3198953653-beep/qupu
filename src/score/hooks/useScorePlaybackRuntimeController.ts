import { useRef } from 'react'
import type { PlaybackCursorRect } from '../types'
import { usePlaybackController } from './usePlaybackController'
import { useScorePlaybackDebugController } from './useScorePlaybackDebugController'

export function useScorePlaybackRuntimeController(params: {
  playbackController: Omit<Parameters<typeof usePlaybackController>[0], 'getPlayheadRectPx'>
  playbackDebug: {
    playbackCursorLayout: Omit<
      Parameters<typeof useScorePlaybackDebugController>[0]['playbackCursorLayout'],
      'playbackCursorPoint' | 'playbackCursorColor'
    >
    runtimeDebugController: Omit<
      Parameters<typeof useScorePlaybackDebugController>[0]['runtimeDebugController'],
      | 'playbackCursorEventsRef'
      | 'playbackSessionId'
      | 'playheadStatus'
      | 'playheadDebugLogRowsRef'
      | 'playheadDebugSequenceRef'
      | 'latestPlayheadDebugSnapshotRef'
      | 'measurePlayheadDebugLogRow'
    >
  }
}) {
  const { playbackController, playbackDebug } = params
  const playheadRectRef = useRef<PlaybackCursorRect | null>(null)

  const playback = usePlaybackController({
    ...playbackController,
    getPlayheadRectPx: () => playheadRectRef.current,
  })

  const debug = useScorePlaybackDebugController({
    playbackCursorLayout: {
      ...playbackDebug.playbackCursorLayout,
      playbackCursorPoint: playback.playbackCursorPoint,
      playbackCursorColor: playback.playbackCursorColor,
    },
    runtimeDebugController: {
      ...playbackDebug.runtimeDebugController,
      playbackCursorEventsRef: playback.playbackCursorEventsRef,
      playbackSessionId: playback.playbackSessionId,
      playheadStatus: playback.playheadStatus,
      playheadDebugLogRowsRef: playback.playheadDebugLogRowsRef,
      playheadDebugSequenceRef: playback.playheadDebugSequenceRef,
      latestPlayheadDebugSnapshotRef: playback.latestPlayheadDebugSnapshotRef,
      measurePlayheadDebugLogRow: playback.measurePlayheadDebugLogRow,
    },
  })

  playheadRectRef.current = debug.playheadRectPx

  return {
    ...playback,
    ...debug,
  }
}
