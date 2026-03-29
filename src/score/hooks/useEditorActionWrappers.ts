import { useCallback, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import type {
  RhythmPresetId,
  ScoreSourceKind,
  SegmentRhythmTemplateBinding,
  TimelineSegmentOverlayMode,
} from '../types'

export function useEditorActionWrappers(params: {
  stopActivePlaybackSession: () => void
  requestPlaybackCursorReset: () => void
  clearActiveChordSelection: () => void
  setActiveBuiltInDemo: Dispatch<SetStateAction<'none' | 'whole-note' | 'half-note'>>
  setTimelineSegmentOverlayMode: Dispatch<SetStateAction<TimelineSegmentOverlayMode>>
  setScoreSourceKind: Dispatch<SetStateAction<ScoreSourceKind>>
  setSegmentRhythmTemplateBindings: Dispatch<SetStateAction<Record<string, SegmentRhythmTemplateBinding>>>
  setFullMeasureRestCollapseScopeKeys: Dispatch<SetStateAction<string[]>>
  setPendingImportedScoreSourceKind: (kind: Extract<ScoreSourceKind, 'musicxml-file' | 'musicxml-text' | 'sample-musicxml'> | null) => void
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
    setScoreSourceKind,
    setSegmentRhythmTemplateBindings,
    setFullMeasureRestCollapseScopeKeys,
    setPendingImportedScoreSourceKind,
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

  const clearSegmentRhythmTemplateBindings = useCallback(() => {
    setSegmentRhythmTemplateBindings({})
  }, [setSegmentRhythmTemplateBindings])

  const importMusicXmlTextWithCollapseReset = useCallback((xmlText: string) => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setPendingImportedScoreSourceKind('musicxml-text')
    importMusicXmlText(xmlText)
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    importMusicXmlText,
    setPendingImportedScoreSourceKind,
    setActiveBuiltInDemo,
    stopActivePlaybackSession,
  ])

  const importMusicXmlFromTextareaWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setPendingImportedScoreSourceKind('musicxml-text')
    importMusicXmlFromTextarea()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    importMusicXmlFromTextarea,
    setPendingImportedScoreSourceKind,
    setActiveBuiltInDemo,
    stopActivePlaybackSession,
  ])

  const onMusicXmlFileChangeWithCollapseReset = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setPendingImportedScoreSourceKind('musicxml-file')
    await onMusicXmlFileChange(event)
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    onMusicXmlFileChange,
    setPendingImportedScoreSourceKind,
    setActiveBuiltInDemo,
    stopActivePlaybackSession,
  ])

  const loadSampleMusicXmlWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    setPendingImportedScoreSourceKind('sample-musicxml')
    loadSampleMusicXml()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    loadSampleMusicXml,
    setPendingImportedScoreSourceKind,
    setActiveBuiltInDemo,
    stopActivePlaybackSession,
  ])

  const loadWholeNoteDemoWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    clearSegmentRhythmTemplateBindings()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('whole-note')
    setScoreSourceKind('built-in-demo')
    setTimelineSegmentOverlayMode('curated-two-measure')
    loadWholeNoteDemo()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    clearSegmentRhythmTemplateBindings,
    loadWholeNoteDemo,
    requestPlaybackCursorReset,
    setActiveBuiltInDemo,
    setPendingImportedScoreSourceKind,
    setScoreSourceKind,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const loadHalfNoteDemoWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    clearSegmentRhythmTemplateBindings()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('half-note')
    setScoreSourceKind('built-in-demo')
    setTimelineSegmentOverlayMode('curated-two-measure')
    loadHalfNoteDemo()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    clearSegmentRhythmTemplateBindings,
    loadHalfNoteDemo,
    requestPlaybackCursorReset,
    setActiveBuiltInDemo,
    setPendingImportedScoreSourceKind,
    setScoreSourceKind,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const resetScoreWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    clearSegmentRhythmTemplateBindings()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('none')
    setScoreSourceKind('reset-default')
    setTimelineSegmentOverlayMode('curated-two-measure')
    resetScore()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    clearSegmentRhythmTemplateBindings,
    requestPlaybackCursorReset,
    resetScore,
    setActiveBuiltInDemo,
    setPendingImportedScoreSourceKind,
    setScoreSourceKind,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const runAiDraftWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    clearSegmentRhythmTemplateBindings()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('none')
    setScoreSourceKind('ai-draft')
    setTimelineSegmentOverlayMode('none')
    runAiDraft()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    clearSegmentRhythmTemplateBindings,
    requestPlaybackCursorReset,
    runAiDraft,
    setActiveBuiltInDemo,
    setPendingImportedScoreSourceKind,
    setScoreSourceKind,
    setTimelineSegmentOverlayMode,
    stopActivePlaybackSession,
  ])

  const applyRhythmPresetWithCollapseReset = useCallback((presetId: RhythmPresetId) => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    clearSegmentRhythmTemplateBindings()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('none')
    setScoreSourceKind('rhythm-preset')
    setTimelineSegmentOverlayMode('curated-two-measure')
    applyRhythmPreset(presetId)
  }, [
    applyRhythmPreset,
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    clearSegmentRhythmTemplateBindings,
    requestPlaybackCursorReset,
    setActiveBuiltInDemo,
    setPendingImportedScoreSourceKind,
    setScoreSourceKind,
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
