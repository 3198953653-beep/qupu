import { usePlaybackCursorLayout } from './usePlaybackCursorLayout'
import { useScoreRuntimeDebugController } from './useScoreRuntimeDebugController'

type RuntimeDebugControllerBaseParams = Omit<
  Parameters<typeof useScoreRuntimeDebugController>[0],
  'playbackCursorState'
>

export function useScorePlaybackDebugController(params: {
  playbackCursorLayout: Parameters<typeof usePlaybackCursorLayout>[0]
  runtimeDebugController: RuntimeDebugControllerBaseParams
}) {
  const { playbackCursorLayout, runtimeDebugController } = params

  const { playheadRectPx, playbackCursorState } = usePlaybackCursorLayout(playbackCursorLayout)

  const { onBeginDragWithFirstMeasureDebug, onEndDragWithFirstMeasureDebug } =
    useScoreRuntimeDebugController({
      ...runtimeDebugController,
      playbackCursorState,
    })

  return {
    playheadRectPx,
    playbackCursorState,
    onBeginDragWithFirstMeasureDebug,
    onEndDragWithFirstMeasureDebug,
  }
}
