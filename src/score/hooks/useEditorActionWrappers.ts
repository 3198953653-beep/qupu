import { useCallback, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import type {
  PedalSpan,
  RhythmPresetId,
  ScoreSourceKind,
  SegmentRhythmTemplateBinding,
  TimelineSegmentOverlayMode,
} from '../types'

export function useEditorActionWrappers(params: {
  stopActivePlaybackSession: () => void
  requestPlaybackCursorReset: () => void
  clearActiveChordSelection: () => void
  clearActivePedalSelection: () => void
  setActiveBuiltInDemo: Dispatch<SetStateAction<'none' | 'whole-note' | 'half-note'>>
  setTimelineSegmentOverlayMode: Dispatch<SetStateAction<TimelineSegmentOverlayMode>>
  setScoreSourceKind: Dispatch<SetStateAction<ScoreSourceKind>>
  setSegmentRhythmTemplateBindings: Dispatch<SetStateAction<Record<string, SegmentRhythmTemplateBinding>>>
  setPedalSpans: Dispatch<SetStateAction<PedalSpan[]>>
  setFullMeasureRestCollapseScopeKeys: Dispatch<SetStateAction<string[]>>
  setPendingImportedScoreSourceKind: (kind: Extract<ScoreSourceKind, 'musicxml-file' | 'musicxml-text'> | null) => void
  importMusicXmlText: (xmlText: string) => void
  onMusicXmlFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  loadWholeNoteDemo: () => void
  loadHalfNoteDemo: () => void
  resetScore: () => void
  runAiDraft: () => void
  applyRhythmPreset: (presetId: RhythmPresetId) => void
}): {
  clearFullMeasureRestCollapseScopes: () => void
  importMusicXmlTextWithCollapseReset: (xmlText: string) => void
  onMusicXmlFileChangeWithCollapseReset: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
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
    clearActivePedalSelection,
    setActiveBuiltInDemo,
    setTimelineSegmentOverlayMode,
    setScoreSourceKind,
    setSegmentRhythmTemplateBindings,
    setPedalSpans,
    setFullMeasureRestCollapseScopeKeys,
    setPendingImportedScoreSourceKind,
    importMusicXmlText,
    onMusicXmlFileChange,
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

  const clearPedalSpans = useCallback(() => {
    setPedalSpans([])
  }, [setPedalSpans])

  const importMusicXmlTextWithCollapseReset = useCallback((xmlText: string) => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    clearActivePedalSelection()
    setActiveBuiltInDemo('none')
    setPendingImportedScoreSourceKind('musicxml-text')
    importMusicXmlText(xmlText)
  }, [
    clearActiveChordSelection,
    clearActivePedalSelection,
    clearFullMeasureRestCollapseScopes,
    importMusicXmlText,
    setPendingImportedScoreSourceKind,
    setActiveBuiltInDemo,
    stopActivePlaybackSession,
  ])

  const onMusicXmlFileChangeWithCollapseReset = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    clearActivePedalSelection()
    setActiveBuiltInDemo('none')
    setPendingImportedScoreSourceKind('musicxml-file')
    await onMusicXmlFileChange(event)
  }, [
    clearActiveChordSelection,
    clearActivePedalSelection,
    clearFullMeasureRestCollapseScopes,
    onMusicXmlFileChange,
    setPendingImportedScoreSourceKind,
    setActiveBuiltInDemo,
    stopActivePlaybackSession,
  ])

  const loadWholeNoteDemoWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    clearActivePedalSelection()
    clearSegmentRhythmTemplateBindings()
    clearPedalSpans()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('whole-note')
    setScoreSourceKind('built-in-demo')
    setTimelineSegmentOverlayMode('curated-two-measure')
    loadWholeNoteDemo()
  }, [
    clearActiveChordSelection,
    clearActivePedalSelection,
    clearFullMeasureRestCollapseScopes,
    clearPedalSpans,
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
    clearActivePedalSelection()
    clearSegmentRhythmTemplateBindings()
    clearPedalSpans()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('half-note')
    setScoreSourceKind('built-in-demo')
    setTimelineSegmentOverlayMode('curated-two-measure')
    loadHalfNoteDemo()
  }, [
    clearActiveChordSelection,
    clearActivePedalSelection,
    clearFullMeasureRestCollapseScopes,
    clearPedalSpans,
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
    clearActivePedalSelection()
    clearSegmentRhythmTemplateBindings()
    clearPedalSpans()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('none')
    setScoreSourceKind('reset-default')
    setTimelineSegmentOverlayMode('curated-two-measure')
    resetScore()
  }, [
    clearActiveChordSelection,
    clearActivePedalSelection,
    clearFullMeasureRestCollapseScopes,
    clearPedalSpans,
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
    clearActivePedalSelection()
    clearSegmentRhythmTemplateBindings()
    clearPedalSpans()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('none')
    setScoreSourceKind('ai-draft')
    setTimelineSegmentOverlayMode('none')
    runAiDraft()
  }, [
    clearActiveChordSelection,
    clearActivePedalSelection,
    clearFullMeasureRestCollapseScopes,
    clearPedalSpans,
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
    clearActivePedalSelection()
    clearSegmentRhythmTemplateBindings()
    clearPedalSpans()
    setPendingImportedScoreSourceKind(null)
    setActiveBuiltInDemo('none')
    setScoreSourceKind('rhythm-preset')
    setTimelineSegmentOverlayMode('curated-two-measure')
    applyRhythmPreset(presetId)
  }, [
    applyRhythmPreset,
    clearActiveChordSelection,
    clearActivePedalSelection,
    clearFullMeasureRestCollapseScopes,
    clearPedalSpans,
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
    onMusicXmlFileChangeWithCollapseReset,
    loadWholeNoteDemoWithCollapseReset,
    loadHalfNoteDemoWithCollapseReset,
    resetScoreWithCollapseReset,
    runAiDraftWithCollapseReset,
    applyRhythmPresetWithCollapseReset,
  }
}
