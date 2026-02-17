import { useRef, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  applyRhythmPresetAction,
  exportMusicXmlFileAction,
  handleMusicXmlFileChange,
  loadSampleMusicXmlAction,
  playScoreAction,
  resetScoreAction,
  runAiDraftAction,
} from './editorActions'
import { applyImportedScoreState, importMusicXmlTextAndApply } from './musicXmlActions'
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
  synthRef: MutableRefObject<import('tone').PolySynth | null>
  notes: ScoreNote[]
  bassNotes: ScoreNote[]
  stopPlayTimerRef: MutableRefObject<number | null>
  setIsPlaying: StateSetter<boolean>

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
  progressiveImportMeasureLimit?: number

  measurePairs: MeasurePair[]
  setRhythmPreset: StateSetter<RhythmPresetId>
  pitches: Pitch[]
  initialTrebleNotes: ScoreNote[]
  initialBassNotes: ScoreNote[]
}): {
  playScore: () => Promise<void>
  applyImportedScore: (result: ImportResult) => void
  importMusicXmlText: (xmlText: string) => void
  importMusicXmlFromTextarea: () => void
  openMusicXmlFilePicker: () => void
  onMusicXmlFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  loadSampleMusicXml: () => void
  exportMusicXmlFile: () => void
  resetScore: () => void
  runAiDraft: () => void
  applyRhythmPreset: (presetId: RhythmPresetId) => void
} {
  const {
    synthRef,
    notes,
    bassNotes,
    stopPlayTimerRef,
    setIsPlaying,
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
    progressiveImportMeasureLimit,
    measurePairs,
    setRhythmPreset,
    pitches,
    initialTrebleNotes,
    initialBassNotes,
  } = params
  const importRequestIdRef = useRef(0)

  const playScore = async () => {
    await playScoreAction({
      synth: synthRef.current,
      notes,
      bassNotes,
      stopPlayTimerRef,
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
  }

  const importMusicXmlText = (xmlText: string) => {
    const requestId = importRequestIdRef.current + 1
    importRequestIdRef.current = requestId
    importMusicXmlTextAndApply({
      xmlText,
      setIsRhythmLinked,
      applyImportedScore,
      setImportFeedback,
      previewMeasureLimit: progressiveImportMeasureLimit,
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
      setIsRhythmLinked,
      setNotes,
      setActiveSelection,
      setRhythmPreset,
    })
  }

  return {
    playScore,
    applyImportedScore,
    importMusicXmlText,
    importMusicXmlFromTextarea,
    openMusicXmlFilePicker,
    onMusicXmlFileChange,
    loadSampleMusicXml,
    exportMusicXmlFile,
    resetScore,
    runAiDraft,
    applyRhythmPreset,
  }
}
