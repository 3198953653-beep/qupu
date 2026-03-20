import { useRef, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  applyRhythmPresetAction,
  exportMusicXmlFileAction,
  handleMusicXmlFileChange,
  loadHalfNoteDemoAction,
  loadSampleMusicXmlAction,
  loadWholeNoteDemoAction,
  playScoreAction,
  resetScoreAction,
  runAiDraftAction,
  stopPlaybackAction,
} from './editorActions'
import { DEFAULT_DEMO_MEASURE_COUNT } from './constants'
import { applyImportedScoreState, importMusicXmlTextAndApply } from './musicXmlActions'
import type { PlaybackTimelineEvent } from './playbackTimeline'
import type {
  DragState,
  ImportFeedback,
  ImportResult,
  ImportedNoteLocation,
  MeasurePair,
  MusicXmlMetadata,
  Pitch,
  RhythmPresetId,
  ScoreNote,
  Selection,
  TimeSignature,
} from './types'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useEditorHandlers(params: {
  synthRef: MutableRefObject<import('tone').PolySynth | import('tone').Sampler | null>
  notes: ScoreNote[]
  playbackTimelineEvents: PlaybackTimelineEvent[]
  stopPlayTimerRef: MutableRefObject<number | null>
  playbackPointTimerIdsRef: MutableRefObject<number[]>
  playbackSessionIdRef: MutableRefObject<number>
  setIsPlaying: StateSetter<boolean>
  onPlaybackStart?: (params: { sessionId: number; firstEvent: PlaybackTimelineEvent | null }) => void
  onPlaybackPoint?: (params: { sessionId: number; event: PlaybackTimelineEvent }) => void
  onPlaybackComplete?: (params: { sessionId: number; lastEvent: PlaybackTimelineEvent | null }) => void
  onImportedScoreApplied?: () => void

  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setMeasurePairsFromImport: StateSetter<MeasurePair[] | null>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  setMeasureKeyFifthsFromImport: StateSetter<number[] | null>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  setMeasureDivisionsFromImport: StateSetter<number[] | null>
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  setMeasureTimeSignaturesFromImport: StateSetter<TimeSignature[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  setMusicXmlMetadataFromImport: StateSetter<MusicXmlMetadata | null>
  musicXmlMetadataFromImportRef: MutableRefObject<MusicXmlMetadata | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  dragRef: MutableRefObject<DragState | null>
  clearDragOverlay: () => void
  setDraggingSelection: StateSetter<Selection | null>
  setActiveSelection: StateSetter<Selection>
  setIsRhythmLinked: StateSetter<boolean>
  setImportFeedback: StateSetter<ImportFeedback>

  musicXmlInput: string
  setMusicXmlInput: StateSetter<string>
  fileInputRef: MutableRefObject<HTMLInputElement | null>

  measurePairs: MeasurePair[]
  setRhythmPreset: StateSetter<RhythmPresetId>
  pitches: Pitch[]
  initialTrebleNotes: ScoreNote[]
  initialBassNotes: ScoreNote[]
}): {
  playScore: () => Promise<void>
  stopPlayback: () => void
  applyImportedScore: (result: ImportResult) => void
  importMusicXmlText: (xmlText: string) => void
  importMusicXmlFromTextarea: () => void
  openMusicXmlFilePicker: () => void
  onMusicXmlFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  loadSampleMusicXml: () => void
  loadWholeNoteDemo: () => void
  loadHalfNoteDemo: () => void
  exportMusicXmlFile: () => void
  resetScore: () => void
  runAiDraft: () => void
  applyRhythmPreset: (presetId: RhythmPresetId) => void
} {
  const {
    synthRef,
    notes,
    playbackTimelineEvents,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    setIsPlaying,
    onPlaybackStart,
    onPlaybackPoint,
    onPlaybackComplete,
    onImportedScoreApplied,
    setNotes,
    setBassNotes,
    setMeasurePairsFromImport,
    measurePairsFromImportRef,
    setMeasureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    setMeasureDivisionsFromImport,
    measureDivisionsFromImportRef,
    setMeasureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    setMusicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    dragRef,
    clearDragOverlay,
    setDraggingSelection,
    setActiveSelection,
    setIsRhythmLinked,
    setImportFeedback,
    musicXmlInput,
    setMusicXmlInput,
    fileInputRef,
    measurePairs,
    setRhythmPreset,
    pitches,
    initialTrebleNotes,
    initialBassNotes,
  } = params
  const importRequestIdRef = useRef(0)

  const playScore = async () => {
    await playScoreAction({
      synthRef,
      playbackTimelineEvents,
      stopPlayTimerRef,
      playbackPointTimerIdsRef,
      playbackSessionIdRef,
      setIsPlaying,
      onPlaybackStart,
      onPlaybackPoint,
      onPlaybackComplete,
    })
  }

  const stopPlayback = () => {
    stopPlaybackAction({
      synthRef,
      stopPlayTimerRef,
      playbackPointTimerIdsRef,
      playbackSessionIdRef,
      setIsPlaying,
    })
  }

  const applyImportedScore = (result: ImportResult) => {
    applyImportedScoreState({
      result,
      setNotes,
      setBassNotes,
      setMeasurePairsFromImport,
      measurePairsFromImportRef,
      setMeasureKeyFifthsFromImport,
      measureKeyFifthsFromImportRef,
      setMeasureDivisionsFromImport,
      measureDivisionsFromImportRef,
      setMeasureTimeSignaturesFromImport,
      measureTimeSignaturesFromImportRef,
      setMusicXmlMetadataFromImport,
      musicXmlMetadataFromImportRef,
      importedNoteLookupRef,
      dragRef,
      clearDragOverlay,
      setDraggingSelection,
      setActiveSelection,
    })
    onImportedScoreApplied?.()
  }

  const importMusicXmlText = (xmlText: string) => {
    const requestId = importRequestIdRef.current + 1
    importRequestIdRef.current = requestId
    importMusicXmlTextAndApply({
      xmlText,
      setIsRhythmLinked,
      applyImportedScore,
      setImportFeedback,
      isRequestLatest: () => importRequestIdRef.current === requestId,
    })
  }

  const importMusicXmlFromTextarea = () => {
    importMusicXmlText(musicXmlInput)
  }

  const openMusicXmlFilePicker = () => {
    fileInputRef.current?.click()
  }

  const onMusicXmlFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleMusicXmlFileChange({
      event,
      setMusicXmlInput,
      importMusicXmlText,
      setImportFeedback,
    })
  }

  const loadSampleMusicXml = () => {
    loadSampleMusicXmlAction({
      setMusicXmlInput,
      importMusicXmlText,
    })
  }

  const exportMusicXmlFile = () => {
    exportMusicXmlFileAction({
      measurePairs,
      keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
      divisionsByMeasure: measureDivisionsFromImportRef.current,
      timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
      metadata: musicXmlMetadataFromImportRef.current,
      setImportFeedback,
    })
  }

  const clearImportedSourceBase = {
    setMeasurePairsFromImport,
    measurePairsFromImportRef,
    setMeasureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    setMeasureDivisionsFromImport,
    measureDivisionsFromImportRef,
    setMeasureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    setMusicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    dragRef,
    clearDragOverlay,
  }

  const invalidatePendingImport = () => {
    importRequestIdRef.current += 1
  }

  const loadWholeNoteDemo = () => {
    invalidatePendingImport()
    loadWholeNoteDemoAction({
      clearImportedSourceParams: {
        ...clearImportedSourceBase,
        setDraggingSelection,
      },
      setNotes,
      setBassNotes,
      setActiveSelection,
      setRhythmPreset,
      setImportFeedback,
      setIsRhythmLinked,
      measureRepeatCount: DEFAULT_DEMO_MEASURE_COUNT,
    })
  }

  const loadHalfNoteDemo = () => {
    invalidatePendingImport()
    loadHalfNoteDemoAction({
      clearImportedSourceParams: {
        ...clearImportedSourceBase,
        setDraggingSelection,
      },
      setNotes,
      setBassNotes,
      setActiveSelection,
      setRhythmPreset,
      setImportFeedback,
      setIsRhythmLinked,
      measureRepeatCount: DEFAULT_DEMO_MEASURE_COUNT,
    })
  }

  const resetScore = () => {
    invalidatePendingImport()
    resetScoreAction({
      initialTrebleNotes,
      initialBassNotes,
      clearImportedSourceParams: {
        ...clearImportedSourceBase,
        setDraggingSelection,
      },
      setNotes,
      setBassNotes,
      setActiveSelection,
      setRhythmPreset,
      setImportFeedback,
      setIsRhythmLinked,
    })
  }

  const runAiDraft = () => {
    invalidatePendingImport()
    runAiDraftAction({
      clearImportedSourceParams: clearImportedSourceBase,
      setNotes,
      pitches,
    })
  }

  const applyRhythmPreset = (presetId: RhythmPresetId) => {
    invalidatePendingImport()
    applyRhythmPresetAction({
      presetId,
      clearImportedSourceParams: clearImportedSourceBase,
      sourceNotes: notes,
      setIsRhythmLinked,
      setNotes,
      setBassNotes,
      setActiveSelection,
      setRhythmPreset,
      measureRepeatCount: DEFAULT_DEMO_MEASURE_COUNT,
    })
  }

  return {
    playScore,
    stopPlayback,
    applyImportedScore,
    importMusicXmlText,
    importMusicXmlFromTextarea,
    openMusicXmlFilePicker,
    onMusicXmlFileChange,
    loadSampleMusicXml,
    loadWholeNoteDemo,
    loadHalfNoteDemo,
    exportMusicXmlFile,
    resetScore,
    runAiDraft,
    applyRhythmPreset,
  }
}
