import type { ChangeEvent, Dispatch, MutableRefObject, SetStateAction } from 'react'
import * as Tone from 'tone'
import { createAiVariation } from './ai'
import {
  DEFAULT_DEMO_MEASURE_COUNT,
  DURATION_BEATS,
  DURATION_TONE,
  QUARTER_NOTE_SECONDS,
  RHYTHM_PRESETS,
  SAMPLE_MUSIC_XML,
} from './constants'
import { clearImportedSourceState } from './importSourceState'
import { buildMusicXmlExportPayload } from './musicXmlActions'
import { toTonePitch } from './pitchUtils'
import { buildBassMockNotes, buildNotesFromPattern } from './scoreOps'
import type {
  ImportFeedback,
  MeasurePair,
  MusicXmlMetadata,
  Pitch,
  RhythmPresetId,
  ScoreNote,
  Selection,
  TimeSignature,
} from './types'

type StateSetter<T> = Dispatch<SetStateAction<T>>
const MUSIC_XML_TEXTAREA_MAX_CHARS = 2000

function formatMusicXmlTextareaPreview(xmlText: string): string {
  if (xmlText.length <= MUSIC_XML_TEXTAREA_MAX_CHARS) return xmlText
  return `<!-- 已从文件加载较大的乐谱文本（${xmlText.length.toLocaleString()} 字符）。
为保证性能，预览已隐藏。
如需编辑完整文本，请重新打开源文件。 -->`
}

export async function playScoreAction(params: {
  synth: Tone.PolySynth | Tone.Sampler | null
  notes: ScoreNote[]
  bassNotes: ScoreNote[]
  stopPlayTimerRef: MutableRefObject<number | null>
  setIsPlaying: StateSetter<boolean>
}): Promise<void> {
  const { synth, notes, bassNotes, stopPlayTimerRef, setIsPlaying } = params
  if (!synth) return

  await Tone.start()
  if (synth instanceof Tone.Sampler && !synth.loaded) {
    await Tone.loaded()
  }
  setIsPlaying(true)

  const start = Tone.now() + 0.05
  let cursor = start
  notes.forEach((note, index) => {
    const bassNote = bassNotes[index]
    synth.triggerAttackRelease(toTonePitch(note.pitch), DURATION_TONE[note.duration], cursor)
    if (bassNote) {
      synth.triggerAttackRelease(toTonePitch(bassNote.pitch), DURATION_TONE[bassNote.duration], cursor, 0.72)
    }
    cursor += DURATION_BEATS[note.duration] * QUARTER_NOTE_SECONDS
  })

  if (stopPlayTimerRef.current !== null) {
    window.clearTimeout(stopPlayTimerRef.current)
  }

  stopPlayTimerRef.current = window.setTimeout(() => {
    setIsPlaying(false)
    stopPlayTimerRef.current = null
  }, Math.max(200, (cursor - start) * 1000 + 200))
}

export async function handleMusicXmlFileChange(params: {
  event: ChangeEvent<HTMLInputElement>
  setMusicXmlInput: StateSetter<string>
  importMusicXmlText: (xmlText: string) => void
  setImportFeedback: StateSetter<ImportFeedback>
}): Promise<void> {
  const { event, setMusicXmlInput, importMusicXmlText, setImportFeedback } = params
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const xmlText = await file.text()
    setMusicXmlInput(formatMusicXmlTextareaPreview(xmlText))
    importMusicXmlText(xmlText)
  } catch {
    setImportFeedback({ kind: 'error', message: '无法读取所选文件。' })
  } finally {
    event.currentTarget.value = ''
  }
}

export function loadSampleMusicXmlAction(params: {
  setMusicXmlInput: StateSetter<string>
  importMusicXmlText: (xmlText: string) => void
}): void {
  const { setMusicXmlInput, importMusicXmlText } = params
  setMusicXmlInput(SAMPLE_MUSIC_XML)
  importMusicXmlText(SAMPLE_MUSIC_XML)
}

export function exportMusicXmlFileAction(params: {
  measurePairs: MeasurePair[]
  keyFifthsByMeasure: number[] | null
  divisionsByMeasure: number[] | null
  timeSignaturesByMeasure: TimeSignature[] | null
  metadata: MusicXmlMetadata | null
  setImportFeedback: StateSetter<ImportFeedback>
}): void {
  const {
    measurePairs,
    keyFifthsByMeasure,
    divisionsByMeasure,
    timeSignaturesByMeasure,
    metadata,
    setImportFeedback,
  } = params
  const { xmlText, safeName } = buildMusicXmlExportPayload({
    measurePairs,
    keyFifthsByMeasure,
    divisionsByMeasure,
    timeSignaturesByMeasure,
    metadata,
  })
  const blob = new Blob([xmlText], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeName}.musicxml`
  link.click()
  URL.revokeObjectURL(url)

  setImportFeedback({
    kind: 'success',
    message: `已导出 ${measurePairs.length} 个小节到 ${safeName}.musicxml`,
  })
}

export function resetScoreAction(params: {
  initialTrebleNotes: ScoreNote[]
  initialBassNotes: ScoreNote[]
  clearImportedSourceParams: Parameters<typeof clearImportedSourceState>[0]
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setActiveSelection: StateSetter<Selection>
  setRhythmPreset: StateSetter<RhythmPresetId>
  setImportFeedback: StateSetter<ImportFeedback>
  setIsRhythmLinked: StateSetter<boolean>
}): void {
  const {
    initialTrebleNotes,
    initialBassNotes,
    clearImportedSourceParams,
    setNotes,
    setBassNotes,
    setActiveSelection,
    setRhythmPreset,
    setImportFeedback,
    setIsRhythmLinked,
  } = params
  setNotes(initialTrebleNotes)
  setBassNotes(initialBassNotes)
  clearImportedSourceState(clearImportedSourceParams)
  if (initialTrebleNotes[0]) {
    setActiveSelection({ noteId: initialTrebleNotes[0].id, staff: 'treble', keyIndex: 0 })
  }
  setRhythmPreset('quarter')
  setImportFeedback({ kind: 'idle', message: '' })
  setIsRhythmLinked(false)
}

export function runAiDraftAction(params: {
  clearImportedSourceParams: Parameters<typeof clearImportedSourceState>[0]
  setNotes: StateSetter<ScoreNote[]>
  pitches: Pitch[]
}): void {
  const { clearImportedSourceParams, setNotes, pitches } = params
  clearImportedSourceState(clearImportedSourceParams)
  setNotes((current) => createAiVariation(current, pitches))
}

export function applyRhythmPresetAction(params: {
  presetId: RhythmPresetId
  clearImportedSourceParams: Parameters<typeof clearImportedSourceState>[0]
  sourceNotes: ScoreNote[]
  setIsRhythmLinked: StateSetter<boolean>
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setActiveSelection: StateSetter<Selection>
  setRhythmPreset: StateSetter<RhythmPresetId>
  measureRepeatCount?: number
}): void {
  const {
    presetId,
    clearImportedSourceParams,
    sourceNotes,
    setIsRhythmLinked,
    setNotes,
    setBassNotes,
    setActiveSelection,
    setRhythmPreset,
    measureRepeatCount = DEFAULT_DEMO_MEASURE_COUNT,
  } = params

  const preset = RHYTHM_PRESETS.find((item) => item.id === presetId)
  if (!preset) return

  setIsRhythmLinked(false)
  clearImportedSourceState(clearImportedSourceParams)

  const safeRepeatCount = Number.isFinite(measureRepeatCount) ? Math.max(1, Math.round(measureRepeatCount)) : 1
  const expandedPattern = Array.from({ length: safeRepeatCount }, () => preset.pattern).flat()
  const nextTreble = buildNotesFromPattern(expandedPattern, sourceNotes)
  const nextBass = buildBassMockNotes(nextTreble)
  const nextActive = nextTreble[0]?.id ?? ''
  setNotes(nextTreble)
  setBassNotes(nextBass)
  if (nextActive) {
    setActiveSelection({ noteId: nextActive, staff: 'treble', keyIndex: 0 })
  }
  setRhythmPreset(presetId)
}
