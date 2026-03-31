import type { ChangeEvent, Dispatch, MutableRefObject, SetStateAction } from 'react'
import { createAiVariation } from './ai'
import {
  DEFAULT_DEMO_MEASURE_COUNT,
  RHYTHM_PRESETS,
} from './constants'
import { clearImportedSourceState } from './importSourceState'
import { buildMusicXmlExportPayload } from './musicXmlActions'
import { ensureToneStarted, type PlaybackSynth } from './notePreview'
import type { PlaybackTimelineEvent } from './playbackTimeline'
import { toTonePitch } from './pitchUtils'
import { resolvePlaybackVelocityForStaff } from './playbackVolume'
import { buildBassMockNotes, buildHalfNoteDemoNotes, buildNotesFromPattern, buildWholeNoteDemoNotes } from './scoreOps'
import type {
  ImportFeedback,
  MeasurePair,
  MusicXmlMetadata,
  PedalSpan,
  Pitch,
  RhythmPresetId,
  ScoreNote,
  Selection,
  TimeSignature,
} from './types'

type StateSetter<T> = Dispatch<SetStateAction<T>>
const MUSIC_XML_TEXTAREA_MAX_CHARS = 2000

function clearPlaybackTimeouts(params: {
  stopPlayTimerRef: MutableRefObject<number | null>
  playbackPointTimerIdsRef: MutableRefObject<number[]>
}): void {
  const { stopPlayTimerRef, playbackPointTimerIdsRef } = params
  if (stopPlayTimerRef.current !== null) {
    window.clearTimeout(stopPlayTimerRef.current)
    stopPlayTimerRef.current = null
  }
  playbackPointTimerIdsRef.current.forEach((timerId) => {
    window.clearTimeout(timerId)
  })
  playbackPointTimerIdsRef.current = []
}

function formatMusicXmlTextareaPreview(xmlText: string): string {
  if (xmlText.length <= MUSIC_XML_TEXTAREA_MAX_CHARS) return xmlText
  return `<!-- 已从文件加载较大的乐谱文本（${xmlText.length.toLocaleString()} 字符）。
为保证性能，预览已隐藏。
如需编辑完整文本，请重新打开源文件。 -->`
}

export async function playScoreAction(params: {
  synthRef: MutableRefObject<PlaybackSynth | null>
  playbackTimelineEvents: PlaybackTimelineEvent[]
  playbackTrebleVolumePercent: number
  playbackBassVolumePercent: number
  stopPlayTimerRef: MutableRefObject<number | null>
  playbackPointTimerIdsRef: MutableRefObject<number[]>
  playbackSessionIdRef: MutableRefObject<number>
  setIsPlaying: StateSetter<boolean>
  onPlaybackStart?: (params: { sessionId: number; firstEvent: PlaybackTimelineEvent | null }) => void
  onPlaybackPoint?: (params: { sessionId: number; event: PlaybackTimelineEvent }) => void
  onPlaybackComplete?: (params: { sessionId: number; lastEvent: PlaybackTimelineEvent | null }) => void
}): Promise<void> {
  const {
    synthRef,
    playbackTimelineEvents,
    playbackTrebleVolumePercent,
    playbackBassVolumePercent,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    setIsPlaying,
    onPlaybackStart,
    onPlaybackPoint,
    onPlaybackComplete,
  } = params
  if (!synthRef.current) return
  if (playbackTimelineEvents.length === 0) {
    setIsPlaying(false)
    return
  }

  await ensureToneStarted()
  clearPlaybackTimeouts({
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
  })

  const sessionId = playbackSessionIdRef.current + 1
  playbackSessionIdRef.current = sessionId
  setIsPlaying(true)
  const firstEvent = playbackTimelineEvents[0] ?? null
  const lastEvent = playbackTimelineEvents[playbackTimelineEvents.length - 1] ?? null

  const runPlaybackEvent = (event: PlaybackTimelineEvent) => {
    if (playbackSessionIdRef.current !== sessionId) return
    const synth = synthRef.current
    if (!synth) return
    event.targets.forEach((target) => {
      const { resolvedVelocity } = resolvePlaybackVelocityForStaff({
        staff: target.staff,
        volumePercent: target.staff === 'treble'
          ? playbackTrebleVolumePercent
          : playbackBassVolumePercent,
      })
      synth.triggerAttackRelease(
        toTonePitch(target.pitch),
        target.durationSeconds,
        undefined,
        resolvedVelocity,
      )
    })
    onPlaybackPoint?.({
      sessionId,
      event,
    })
  }

  onPlaybackStart?.({
    sessionId,
    firstEvent,
  })

  playbackTimelineEvents.forEach((event) => {
    const timeoutMs = Math.max(0, Math.round(event.atSeconds * 1000))
    if (timeoutMs === 0) {
      runPlaybackEvent(event)
      return
    }
    const timerId = window.setTimeout(() => {
      runPlaybackEvent(event)
    }, timeoutMs)
    playbackPointTimerIdsRef.current.push(timerId)
  })

  const latestReleaseAtSeconds = playbackTimelineEvents.reduce(
    (maxReleaseAtSeconds, event) => Math.max(maxReleaseAtSeconds, event.latestReleaseAtSeconds),
    lastEvent?.atSeconds ?? 0,
  )
  const completionDelayMs = Math.max(200, Math.round(latestReleaseAtSeconds * 1000) + 220)
  stopPlayTimerRef.current = window.setTimeout(() => {
    if (playbackSessionIdRef.current !== sessionId) return
    setIsPlaying(false)
    stopPlayTimerRef.current = null
    playbackPointTimerIdsRef.current = []
    onPlaybackComplete?.({
      sessionId,
      lastEvent,
    })
  }, completionDelayMs)
}

export function stopPlaybackAction(params: {
  synthRef: MutableRefObject<PlaybackSynth | null>
  stopPlayTimerRef: MutableRefObject<number | null>
  playbackPointTimerIdsRef: MutableRefObject<number[]>
  playbackSessionIdRef: MutableRefObject<number>
  setIsPlaying: StateSetter<boolean>
}): void {
  const {
    synthRef,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    setIsPlaying,
  } = params
  clearPlaybackTimeouts({
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
  })
  playbackSessionIdRef.current += 1
  setIsPlaying(false)
  const stoppableSynth = synthRef.current as (PlaybackSynth & { releaseAll?: (time?: number) => void }) | null
  if (stoppableSynth && typeof stoppableSynth.releaseAll === 'function') {
    try {
      stoppableSynth.releaseAll()
    } catch {
      // Some Tone voices can already be disposed/released; ignore best-effort stop failures.
    }
  }
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

export function loadWholeNoteDemoAction(params: {
  clearImportedSourceParams: Parameters<typeof clearImportedSourceState>[0]
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setActiveSelection: StateSetter<Selection>
  setRhythmPreset: StateSetter<RhythmPresetId>
  setImportFeedback: StateSetter<ImportFeedback>
  setIsRhythmLinked: StateSetter<boolean>
  measureRepeatCount?: number
}): void {
  const {
    clearImportedSourceParams,
    setNotes,
    setBassNotes,
    setActiveSelection,
    setRhythmPreset,
    setImportFeedback,
    setIsRhythmLinked,
    measureRepeatCount = DEFAULT_DEMO_MEASURE_COUNT,
  } = params
  const { trebleNotes, bassNotes } = buildWholeNoteDemoNotes(measureRepeatCount)
  setNotes(trebleNotes)
  setBassNotes(bassNotes)
  clearImportedSourceState(clearImportedSourceParams)
  if (trebleNotes[0]) {
    setActiveSelection({ noteId: trebleNotes[0].id, staff: 'treble', keyIndex: 0 })
  }
  setRhythmPreset('quarter')
  setImportFeedback({ kind: 'idle', message: '' })
  setIsRhythmLinked(false)
}

export function loadHalfNoteDemoAction(params: {
  clearImportedSourceParams: Parameters<typeof clearImportedSourceState>[0]
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setActiveSelection: StateSetter<Selection>
  setRhythmPreset: StateSetter<RhythmPresetId>
  setImportFeedback: StateSetter<ImportFeedback>
  setIsRhythmLinked: StateSetter<boolean>
  measureRepeatCount?: number
}): void {
  const {
    clearImportedSourceParams,
    setNotes,
    setBassNotes,
    setActiveSelection,
    setRhythmPreset,
    setImportFeedback,
    setIsRhythmLinked,
    measureRepeatCount = DEFAULT_DEMO_MEASURE_COUNT,
  } = params
  const { trebleNotes, bassNotes } = buildHalfNoteDemoNotes(measureRepeatCount)
  setNotes(trebleNotes)
  setBassNotes(bassNotes)
  clearImportedSourceState(clearImportedSourceParams)
  if (trebleNotes[0]) {
    setActiveSelection({ noteId: trebleNotes[0].id, staff: 'treble', keyIndex: 0 })
  }
  setRhythmPreset('quarter')
  setImportFeedback({ kind: 'idle', message: '' })
  setIsRhythmLinked(false)
}

export function exportMusicXmlFileAction(params: {
  measurePairs: MeasurePair[]
  pedalSpans: PedalSpan[]
  keyFifthsByMeasure: number[] | null
  divisionsByMeasure: number[] | null
  timeSignaturesByMeasure: TimeSignature[] | null
  metadata: MusicXmlMetadata | null
  setImportFeedback: StateSetter<ImportFeedback>
}): void {
  const {
    measurePairs,
    pedalSpans,
    keyFifthsByMeasure,
    divisionsByMeasure,
    timeSignaturesByMeasure,
    metadata,
    setImportFeedback,
  } = params
  const { xmlText, safeName } = buildMusicXmlExportPayload({
    measurePairs,
    pedalSpans,
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
