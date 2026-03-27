import { useCallback, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import type { RhythmPresetId, TimelineSegmentOverlayMode } from '../types'

export function useEditorActionWrappers(params: {
  stopActivePlaybackSession: () => void
  requestPlaybackCursorReset: () => void
  clearActiveChordSelection: () => void
  setActiveBuiltInDemo: Dispatch<SetStateAction<'none' | 'whole-note' | 'half-note'>>
  setTimelineSegmentOverlayMode: Dispatch<SetStateAction<TimelineSegmentOverlayMode>>
  setFullMeasureRestCollapseScopeKeys: Dispatch<SetStateAction<string[]>>
  importMusicXmlText: (xmlText: string) => void
  importMusicXmlFromTextarea: () => void
  onMusicXmlFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  loadSampleMusicXml: () => void
  loadWholeNoteDemo: () => void
  loadHalfNoteDemo: () => void
  resetScore: () => void
  runAiDraft: () => void
  applyRhythmPreset: (presetId: RhythmPresetId) => void
}): {
  clearFullMeasureRestCollapseScopes: () => void
  importMusicXmlTextWithCollapseReset: (xmlText: string) => void
  importMusicXmlFromTextareaWithCollapseReset: () => void
  onMusicXmlFileChangeWithCollapseReset: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  loadSampleMusicXmlWithCollapseReset: () => void
  loadWholeNoteDemoWithCollapseReset: () => void
  loadHalfNoteDemoWithCollapseReset: () => void
  resetScoreWithCollapseReset: () => void
  runAiDraftWithCollapseReset: () => void
  applyRhythmPresetWithCollapseReset: (presetId: RhythmPresetId) => void
} {
  const {
    stopActivePlaybackSession,
    requestPlaybackCursorReset,
    clearActiveChordSelection,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    setFullMeasureRestCollapseScopeKeys,
    importMusicXmlText,
    importMusicXmlFromTextarea,
    onMusicXmlFileChange,
    loadSampleMusicXml,
    loadWholeNoteDemo,
    loadHalfNoteDemo,
    resetScore,
    runAiDraft,
    applyRhythmPreset,
  } = params

  const clearFullMeasureRestCollapseScopes = useCallback(() => {
    setFullMeasureRestCollapseScopeKeys([])
  }, [setFullMeasureRestCollapseScopeKeys])

  const importMusicXmlTextWithCollapseReset = useCallback((xmlText: string) => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setTimelineSegmentOverlayMode('none')
    importMusicXmlText(xmlText)
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    importMusicXmlText,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const importMusicXmlFromTextareaWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setTimelineSegmentOverlayMode('none')
    importMusicXmlFromTextarea()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    importMusicXmlFromTextarea,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const onMusicXmlFileChangeWithCollapseReset = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setTimelineSegmentOverlayMode('none')
    await onMusicXmlFileChange(event)
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    onMusicXmlFileChange,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const loadSampleMusicXmlWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setTimelineSegmentOverlayMode('none')
    loadSampleMusicXml()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    loadSampleMusicXml,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const loadWholeNoteDemoWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('whole-note')
    setTimelineSegmentOverlayMode('none')
    loadWholeNoteDemo()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    loadWholeNoteDemo,
    requestPlaybackCursorReset,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const loadHalfNoteDemoWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('half-note')
    setTimelineSegmentOverlayMode('none')
    loadHalfNoteDemo()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    loadHalfNoteDemo,
    requestPlaybackCursorReset,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const resetScoreWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setTimelineSegmentOverlayMode('default-two-measure-demo')
    resetScore()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    requestPlaybackCursorReset,
    resetScore,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const runAiDraftWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setTimelineSegmentOverlayMode('none')
    runAiDraft()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    requestPlaybackCursorReset,
    runAiDraft,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const applyRhythmPresetWithCollapseReset = useCallback((presetId: RhythmPresetId) => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setTimelineSegmentOverlayMode('none')
    applyRhythmPreset(presetId)
  }, [
    applyRhythmPreset,
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    requestPlaybackCursorReset,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  return {
    clearFullMeasureRestCollapseScopes,
    importMusicXmlTextWithCollapseReset,
    importMusicXmlFromTextareaWithCollapseReset,
    onMusicXmlFileChangeWithCollapseReset,
    loadSampleMusicXmlWithCollapseReset,
    loadWholeNoteDemoWithCollapseReset,
    loadHalfNoteDemoWithCollapseReset,
    resetScoreWithCollapseReset,
    runAiDraftWithCollapseReset,
    applyRhythmPresetWithCollapseReset,
  }
}
