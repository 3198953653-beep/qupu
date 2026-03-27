import { useEffect, type MutableRefObject } from 'react'
import * as Tone from 'tone'
import { useEditorHandlers } from '../editorHandlers'
import { useEditorActionWrappers } from './useEditorActionWrappers'

type EditorActionWrapperBaseParams = Omit<
  Parameters<typeof useEditorActionWrappers>[0],
  | 'importMusicXmlText'
  | 'importMusicXmlFromTextarea'
  | 'onMusicXmlFileChange'
  | 'loadSampleMusicXml'
  | 'loadWholeNoteDemo'
  | 'loadHalfNoteDemo'
  | 'resetScore'
  | 'runAiDraft'
  | 'applyRhythmPreset'
>

export function useScoreDocumentActionsController(params: {
  editorHandlers: Parameters<typeof useEditorHandlers>[0]
  editorActionWrappersBase: EditorActionWrapperBaseParams
  stopPlayTimerRef: MutableRefObject<number | null>
  playbackPointTimerIdsRef: MutableRefObject<number[]>
  playbackSessionIdRef: MutableRefObject<number>
  synthRef: MutableRefObject<Tone.PolySynth | Tone.Sampler | null>
}): ReturnType<typeof useEditorHandlers> & ReturnType<typeof useEditorActionWrappers> {
  const {
    editorHandlers,
    editorActionWrappersBase,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    synthRef,
  } = params

  const handlers = useEditorHandlers(editorHandlers)

  const wrappers = useEditorActionWrappers({
    ...editorActionWrappersBase,
    importMusicXmlText: handlers.importMusicXmlText,
    importMusicXmlFromTextarea: handlers.importMusicXmlFromTextarea,
    onMusicXmlFileChange: handlers.onMusicXmlFileChange,
    loadSampleMusicXml: handlers.loadSampleMusicXml,
    loadWholeNoteDemo: handlers.loadWholeNoteDemo,
    loadHalfNoteDemo: handlers.loadHalfNoteDemo,
    resetScore: handlers.resetScore,
    runAiDraft: handlers.runAiDraft,
    applyRhythmPreset: handlers.applyRhythmPreset,
  })

  useEffect(() => {
    const synth = synthRef.current
    return () => {
      if (stopPlayTimerRef.current !== null) {
        window.clearTimeout(stopPlayTimerRef.current)
        stopPlayTimerRef.current = null
      }
      playbackPointTimerIdsRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      playbackPointTimerIdsRef.current = []
      playbackSessionIdRef.current += 1
      const stoppableSynth = synth as (Tone.PolySynth | Tone.Sampler | { releaseAll?: (time?: number) => void }) | null
      if (stoppableSynth && typeof stoppableSynth.releaseAll === 'function') {
        try {
          stoppableSynth.releaseAll()
        } catch {
          // Ignore best-effort cleanup failures on disposed Tone voices.
        }
      }
    }
  }, [playbackPointTimerIdsRef, playbackSessionIdRef, stopPlayTimerRef, synthRef])

  return {
    ...handlers,
    ...wrappers,
  }
}
