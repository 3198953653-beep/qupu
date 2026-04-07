import { useCallback, useRef, useState, type MutableRefObject } from 'react'
import { DURATION_TICKS, STEP_TO_SEMITONE } from '../constants'
import {
  enumerateAccompanimentNoteCandidates,
  type AccompanimentNoteCandidate,
} from '../accompanimentNoteCandidates'
import { getMeasureTicksFromTimeSignature } from '../chordRuler'
import { findSelectionLocationInPairs } from '../keyboardEdits'
import { resolvePairKeyFifths, resolvePairTimeSignature } from '../measureRestUtils'
import { buildPlaybackTimeline, type PlaybackTimelineEvent } from '../playbackTimeline'
import { buildStaffOnsetTicks } from '../selectionTimelineRange'
import { getStepOctaveAlterFromPitch } from '../pitchMath'
import { queryAccompanimentOptionRows } from '../rhythmTemplateDb'
import {
  buildSegmentChordEvents,
  buildSegmentRhythmTemplateApplication,
  normalizeChordForSearch,
  parseTimelineSegmentScopeKey,
} from '../segmentRhythmTemplateEngine'
import type {
  ImportedNoteLocation,
  MeasurePair,
  PedalSpan,
  SegmentRhythmTemplateBinding,
  Selection,
  TimeSignature,
} from '../types'

const BASS_RANGE_MIN_MIDI = 35 // B1
const BASS_RANGE_MAX_MIDI = 67 // G4

type ResolvedTarget = {
  selection: Selection
  pairIndex: number
  noteIndex: number
  measureNumber: number
  onsetTick: number
  chordName: string
  chordStartTick: number
  chordEndTick: number
  keyFifths: number
  scopeKey: string
  eventIndex: number
  binding: SegmentRhythmTemplateBinding
}

type AppliedSegmentResult = {
  nextPairs: MeasurePair[]
  nextTemplDetails: SegmentRhythmTemplateBinding['templDetails']
  collapseScopesToAdd: Array<{ pairIndex: number; staff: 'bass' }>
}

export type AccompanimentRenderMeasure = {
  candidateKey: string
  measureNumber: number
  pairIndex: number
  measurePair: MeasurePair
  playbackMeasurePair: MeasurePair
  timeSignature: TimeSignature
  playbackTimelineEvents: PlaybackTimelineEvent[]
  playbackMeasureTicks: number
  previewPedalSpans: PedalSpan[]
  keyFifths: number
  targetHighlightRange: {
    staff: 'bass'
    startTick: number
    endTick: number
  } | null
}

function pitchToMidi(pitch: string): number | null {
  const { step, octave, alter } = getStepOctaveAlterFromPitch(pitch)
  const semitone = STEP_TO_SEMITONE[step]
  if (semitone === undefined || !Number.isFinite(octave) || !Number.isFinite(alter)) return null
  return Math.max(0, Math.min(127, Math.round((octave + 1) * 12 + semitone + alter)))
}

function resolveSelectionForPair(params: {
  pairs: MeasurePair[]
  pairIndex: number
  sourceSelection: Selection
}): Selection {
  const { pairs, pairIndex, sourceSelection } = params
  const pair = pairs[pairIndex]
  const note = pair?.bass[0] ?? pair?.treble[0]
  if (!note) return sourceSelection
  return {
    noteId: note.id,
    staff: pair?.bass[0] ? 'bass' : 'treble',
    keyIndex: 0,
  }
}

function findResolvedTarget(params: {
  selection: Selection
  measurePairs: MeasurePair[]
  importedNoteLookup: Map<string, ImportedNoteLocation>
  chordRulerEntriesByPair: import('../chordRuler').ChordRulerEntry[][] | null
  measureTimeSignaturesByMeasure: TimeSignature[] | null
  measureKeyFifthsByMeasure: number[] | null
  segmentRhythmTemplateBindings: Record<string, SegmentRhythmTemplateBinding>
}): ResolvedTarget | null {
  const {
    selection,
    measurePairs,
    importedNoteLookup,
    chordRulerEntriesByPair,
    measureTimeSignaturesByMeasure,
    measureKeyFifthsByMeasure,
    segmentRhythmTemplateBindings,
  } = params
  if (selection.staff !== 'bass') return null
  const normalizedSelection: Selection = {
    noteId: selection.noteId,
    staff: 'bass',
    keyIndex: 0,
  }
  const location = findSelectionLocationInPairs({
    pairs: measurePairs,
    selection: normalizedSelection,
    importedNoteLookup,
  })
  if (!location || location.staff !== 'bass') return null
  const pair = measurePairs[location.pairIndex]
  const note = pair?.bass[location.noteIndex]
  if (!note || note.isRest) return null

  const onsetTick = buildStaffOnsetTicks(pair.bass)[location.noteIndex]
  if (!Number.isFinite(onsetTick)) return null

  const chordEntry = (chordRulerEntriesByPair?.[location.pairIndex] ?? []).find(
    (entry) => entry.label && entry.label !== 'Rest' && onsetTick >= entry.startTick && onsetTick < entry.endTick,
  )
  if (!chordEntry) return null

  const candidateBindings = Object.entries(segmentRhythmTemplateBindings)
    .map(([scopeKey, binding]) => ({ scopeKey, binding, scope: parseTimelineSegmentScopeKey(scopeKey) }))
    .filter(
      (entry): entry is { scopeKey: string; binding: SegmentRhythmTemplateBinding; scope: { startPairIndex: number; endPairIndexInclusive: number } } =>
        entry.scope !== null &&
        location.pairIndex >= entry.scope.startPairIndex &&
        location.pairIndex <= entry.scope.endPairIndexInclusive,
    )
    .sort((left, right) => {
      const leftSpan = left.scope.endPairIndexInclusive - left.scope.startPairIndex
      const rightSpan = right.scope.endPairIndexInclusive - right.scope.startPairIndex
      return leftSpan - rightSpan
    })

  for (const candidate of candidateBindings) {
    const events = buildSegmentChordEvents({
      scope: candidate.scope,
      chordRulerEntriesByPair,
      measureTimeSignaturesByMeasure,
    })
    const eventIndex = events.findIndex(
      (event) =>
        event.pairIndex === location.pairIndex &&
        onsetTick >= event.startTick &&
        onsetTick < event.endTick,
    )
    if (eventIndex < 0) continue
    if (eventIndex >= candidate.binding.templDetails.length) continue
    return {
      selection: normalizedSelection,
      pairIndex: location.pairIndex,
      noteIndex: location.noteIndex,
      measureNumber: location.pairIndex + 1,
      onsetTick,
      chordName: chordEntry.label,
      chordStartTick: chordEntry.startTick,
      chordEndTick: chordEntry.endTick,
      keyFifths: resolvePairKeyFifths(location.pairIndex, measureKeyFifthsByMeasure),
      scopeKey: candidate.scopeKey,
      eventIndex,
      binding: candidate.binding,
    }
  }

  return null
}

function resolveTrebleOverlapUpperMidi(params: {
  pair: MeasurePair
  startTick: number
  endTick: number
}): number {
  const { pair, startTick, endTick } = params
  const onsetTicks = buildStaffOnsetTicks(pair.treble)
  let maxMidi: number | null = null

  pair.treble.forEach((note, noteIndex) => {
    if (note.isRest) return
    const onsetTick = onsetTicks[noteIndex]
    const durationTicks = DURATION_TICKS[note.duration] ?? 0
    const noteEndTick = onsetTick + Math.max(1, durationTicks)
    const overlaps = onsetTick < endTick && noteEndTick > startTick
    if (!overlaps) return
    const pitches = [note.pitch, ...(note.chordPitches ?? [])]
    pitches.forEach((pitch) => {
      const midi = pitchToMidi(pitch)
      if (midi === null) return
      maxMidi = maxMidi === null ? midi : Math.max(maxMidi, midi)
    })
  })

  if (maxMidi === null) return BASS_RANGE_MAX_MIDI
  return Math.min(BASS_RANGE_MAX_MIDI, maxMidi)
}

function buildTargetHighlightRange(params: {
  startTick: number
  endTick: number
}): { staff: 'bass'; startTick: number; endTick: number } | null {
  const safeStartTick = Math.max(0, Math.round(params.startTick))
  const safeEndTick = Math.max(safeStartTick, Math.round(params.endTick))
  if (safeEndTick <= safeStartTick) return null
  return {
    staff: 'bass',
    startTick: safeStartTick,
    endTick: safeEndTick,
  }
}

function buildPreviewPedalSpansForMeasure(params: {
  pedalSpans: PedalSpan[]
  pairIndex: number
  timeSignature: TimeSignature
}): PedalSpan[] {
  const { pedalSpans, pairIndex, timeSignature } = params
  const measureTicks = Math.max(1, getMeasureTicksFromTimeSignature(timeSignature))

  return pedalSpans.flatMap((span) => {
    if (span.endPairIndex < pairIndex || span.startPairIndex > pairIndex) return []

    const startTick = span.startPairIndex < pairIndex
      ? 0
      : Math.max(0, Math.min(measureTicks, Math.round(span.startTick)))
    const endTick = span.endPairIndex > pairIndex
      ? measureTicks
      : Math.max(0, Math.min(measureTicks, Math.round(span.endTick)))
    const clampedEndTick = Math.max(startTick + 1, endTick)
    if (clampedEndTick <= startTick) return []

    return [{
      ...span,
      startPairIndex: 0,
      endPairIndex: 0,
      startTick,
      endTick: clampedEndTick,
    }]
  })
}

export function useAccompanimentNoteDialogController(params: {
  measurePairsRef: MutableRefObject<MeasurePair[]>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  chordRulerEntriesByPair: import('../chordRuler').ChordRulerEntry[][] | null
  measureTimeSignaturesByMeasure: TimeSignature[] | null
  measureKeyFifthsByMeasure: number[] | null
  pedalSpans: PedalSpan[]
  segmentRhythmTemplateBindings: Record<string, SegmentRhythmTemplateBinding>
  setSegmentRhythmTemplateBindings: (
    next:
      | Record<string, SegmentRhythmTemplateBinding>
      | ((current: Record<string, SegmentRhythmTemplateBinding>) => Record<string, SegmentRhythmTemplateBinding>),
  ) => void
  applyKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections?: Selection[],
    source?: 'default' | 'midi-step',
    options?: { collapseScopesToAdd?: Array<{ pairIndex: number; staff: 'treble' | 'bass' }> },
  ) => void
  applyTemporaryKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections?: Selection[],
    options?: { collapseScopesToAdd?: Array<{ pairIndex: number; staff: 'treble' | 'bass' }> },
  ) => void
}) {
  const {
    measurePairsRef,
    importedNoteLookupRef,
    chordRulerEntriesByPair,
    measureTimeSignaturesByMeasure,
    measureKeyFifthsByMeasure,
    pedalSpans,
    segmentRhythmTemplateBindings,
    setSegmentRhythmTemplateBindings,
    applyKeyboardEditResult,
    applyTemporaryKeyboardEditResult,
  } = params

  const [isOpen, setIsOpen] = useState(false)
  const [target, setTarget] = useState<ResolvedTarget | null>(null)
  const [candidates, setCandidates] = useState<AccompanimentNoteCandidate[]>([])
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null)
  const [previewCandidates, setPreviewCandidates] = useState<AccompanimentRenderMeasure[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const baselinePairsRef = useRef<MeasurePair[] | null>(null)
  const baselineSelectionRef = useRef<Selection | null>(null)
  const baselinePairIndexRef = useRef<number>(0)
  const previewStateRef = useRef<{ candidateKey: string; applied: AppliedSegmentResult } | null>(null)

  const closeDialog = useCallback((skipRestore = false) => {
    if (!skipRestore && previewStateRef.current && baselinePairsRef.current && baselineSelectionRef.current) {
      const restoredSelection = resolveSelectionForPair({
        pairs: baselinePairsRef.current,
        pairIndex: baselinePairIndexRef.current,
        sourceSelection: baselineSelectionRef.current,
      })
      applyTemporaryKeyboardEditResult(
        baselinePairsRef.current,
        restoredSelection,
        [restoredSelection],
      )
    }
    setIsOpen(false)
    setTarget(null)
    setCandidates([])
    setSelectedCandidateKey(null)
    setPreviewCandidates([])
    previewStateRef.current = null
    baselinePairsRef.current = null
    baselineSelectionRef.current = null
    baselinePairIndexRef.current = 0
  }, [applyTemporaryKeyboardEditResult])

  const buildAppliedResult = useCallback(async (resolvedTarget: ResolvedTarget, candidate: AccompanimentNoteCandidate) => {
    const scope = parseTimelineSegmentScopeKey(resolvedTarget.scopeKey)
    if (!scope) throw new Error('当前段落范围无效，请先重新加载律动模板。')

    const nextTemplDetails = resolvedTarget.binding.templDetails.map((detail, index) =>
      index === resolvedTarget.eventIndex
        ? {
            ...detail,
            notes: candidate.notes,
            rawNotes: candidate.rawNotes,
            sourceChordType: candidate.sourceChordType,
          }
        : detail,
    )

    const applied = await buildSegmentRhythmTemplateApplication({
      measurePairs: baselinePairsRef.current ?? measurePairsRef.current,
      scope,
      chordRulerEntriesByPair,
      measureTimeSignaturesByMeasure,
      measureKeyFifthsByMeasure: null,
      patternData: resolvedTarget.binding.patternData,
      seedTemplDetails: nextTemplDetails,
    })
    return {
      nextPairs: applied.nextPairs,
      nextTemplDetails: applied.templDetails,
      collapseScopesToAdd: applied.collapseScopesToAdd,
    } satisfies AppliedSegmentResult
  }, [chordRulerEntriesByPair, measurePairsRef, measureTimeSignaturesByMeasure])

  const previewCandidate = useCallback(async (candidateKey: string) => {
    if (!target) return
    const candidate = candidates.find((entry) => entry.key === candidateKey)
    if (!candidate) return

    const activePreview = previewStateRef.current
    let applied: AppliedSegmentResult
    if (activePreview?.candidateKey === candidateKey) {
      applied = activePreview.applied
    } else {
      applied = await buildAppliedResult(target, candidate)
      previewStateRef.current = { candidateKey, applied }
    }

    const nextSelection = resolveSelectionForPair({
      pairs: applied.nextPairs,
      pairIndex: target.pairIndex,
      sourceSelection: target.selection,
    })
    applyTemporaryKeyboardEditResult(
      applied.nextPairs,
      nextSelection,
      [nextSelection],
      { collapseScopesToAdd: applied.collapseScopesToAdd },
    )
    setSelectedCandidateKey(candidateKey)

  }, [
    applyTemporaryKeyboardEditResult,
    buildAppliedResult,
    candidates,
    target,
  ])

  const applyCandidate = useCallback(async (candidateKey: string) => {
    if (!target) return
    const candidate = candidates.find((entry) => entry.key === candidateKey)
    if (!candidate) return

    const applied =
      previewStateRef.current?.candidateKey === candidateKey
        ? previewStateRef.current.applied
        : await buildAppliedResult(target, candidate)

    if (baselinePairsRef.current && baselineSelectionRef.current) {
      const restoredSelection = resolveSelectionForPair({
        pairs: baselinePairsRef.current,
        pairIndex: target.pairIndex,
        sourceSelection: baselineSelectionRef.current,
      })
      applyTemporaryKeyboardEditResult(
        baselinePairsRef.current,
        restoredSelection,
        [restoredSelection],
      )
    }

    const nextSelection = resolveSelectionForPair({
      pairs: applied.nextPairs,
      pairIndex: target.pairIndex,
      sourceSelection: target.selection,
    })
    applyKeyboardEditResult(
      applied.nextPairs,
      nextSelection,
      [nextSelection],
      'default',
      { collapseScopesToAdd: applied.collapseScopesToAdd },
    )

    setSegmentRhythmTemplateBindings((current) => {
      const existing = current[target.scopeKey]
      if (!existing) return current
      return {
        ...current,
        [target.scopeKey]: {
          ...existing,
          templDetails: applied.nextTemplDetails,
        },
      }
    })

    closeDialog(true)
  }, [
    applyKeyboardEditResult,
    applyTemporaryKeyboardEditResult,
    buildAppliedResult,
    candidates,
    closeDialog,
    setSegmentRhythmTemplateBindings,
    target,
  ])

  const openAccompanimentDialogForSelection = useCallback(async (selection: Selection) => {
    setErrorMessage(null)
    const resolvedTarget = findResolvedTarget({
      selection,
      measurePairs: measurePairsRef.current,
      importedNoteLookup: importedNoteLookupRef.current,
      chordRulerEntriesByPair,
      measureTimeSignaturesByMeasure,
      measureKeyFifthsByMeasure,
      segmentRhythmTemplateBindings,
    })

    if (!resolvedTarget) {
      window.alert('请先为当前段落加载律动模板，再选择伴奏音符。')
      return
    }

    const detail = resolvedTarget.binding.templDetails[resolvedTarget.eventIndex]
    const rhythm = String(detail?.rhythm ?? '').trim()
    const noteCount = rhythm
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0).length
    if (noteCount <= 0) {
      window.alert('当前和弦没有可用律动数据，请先重新加载律动模板。')
      return
    }

    const optionRows = await queryAccompanimentOptionRows({
      chordFamily: normalizeChordForSearch(resolvedTarget.chordName),
      noteCount,
      direction: null,
      structure: null,
      limit: 20,
    })
    if (optionRows.length === 0) {
      window.alert('没有找到匹配的伴奏音符候选。')
      return
    }

    const pair = measurePairsRef.current[resolvedTarget.pairIndex]
    const dynamicUpperMidi = pair
      ? resolveTrebleOverlapUpperMidi({
          pair,
          startTick: resolvedTarget.chordStartTick,
          endTick: resolvedTarget.chordEndTick,
        })
      : BASS_RANGE_MAX_MIDI

    const nextCandidates = enumerateAccompanimentNoteCandidates({
      options: optionRows,
      targetChordName: resolvedTarget.chordName,
      lowerMidi: BASS_RANGE_MIN_MIDI,
      upperMidi: dynamicUpperMidi,
      limit: 20,
    })

    if (nextCandidates.length === 0) {
      window.alert('候选在当前音域限制下不可用，请先调整模板或和弦。')
      return
    }

    baselinePairsRef.current = measurePairsRef.current
    baselineSelectionRef.current = resolvedTarget.selection
    baselinePairIndexRef.current = resolvedTarget.pairIndex
    previewStateRef.current = null
    setTarget(resolvedTarget)
    setCandidates(nextCandidates)
    setSelectedCandidateKey(null)

    const previewMeasures = await Promise.all(
      nextCandidates.map(async (candidate, index) => {
        const applied = await buildAppliedResult(resolvedTarget, candidate)
        const candidatePair =
          applied.nextPairs[resolvedTarget.pairIndex] ??
          measurePairsRef.current[resolvedTarget.pairIndex] ??
          { treble: [], bass: [] }
        const timeSignature = resolvePairTimeSignature(resolvedTarget.pairIndex, measureTimeSignaturesByMeasure)
        const previewPedalSpans = buildPreviewPedalSpansForMeasure({
          pedalSpans,
          pairIndex: resolvedTarget.pairIndex,
          timeSignature,
        })
        const playbackTimelineEvents = buildPlaybackTimeline({
          measurePairs: [candidatePair],
          timeSignaturesByMeasure: [timeSignature],
          pedalSpans: previewPedalSpans,
        })
        return {
          measureNumber: index + 1,
          candidateKey: candidate.key,
          pairIndex: resolvedTarget.pairIndex,
          measurePair: candidatePair,
          playbackMeasurePair: candidatePair,
          timeSignature,
          playbackTimelineEvents,
          playbackMeasureTicks: Math.max(
            1,
            playbackTimelineEvents[0]?.measureTicks ?? getMeasureTicksFromTimeSignature(timeSignature),
          ),
          previewPedalSpans,
          keyFifths: resolvedTarget.keyFifths,
          targetHighlightRange: buildTargetHighlightRange({
            startTick: resolvedTarget.chordStartTick,
            endTick: resolvedTarget.chordEndTick,
          }),
        } satisfies AccompanimentRenderMeasure
      }),
    )

    setPreviewCandidates(previewMeasures)
    setIsOpen(true)
    setErrorMessage(null)
  }, [
    buildAppliedResult,
    chordRulerEntriesByPair,
    importedNoteLookupRef,
    measurePairsRef,
    measureTimeSignaturesByMeasure,
    measureKeyFifthsByMeasure,
    pedalSpans,
    segmentRhythmTemplateBindings,
  ])

  return {
    openAccompanimentDialogForSelection,
    accompanimentNoteDialog: {
      isOpen,
      target,
      candidates,
      selectedCandidateKey,
      previewCandidates,
      candidateMeasureMap: new Map(previewCandidates.map((entry) => [entry.measureNumber, entry.candidateKey])),
      errorMessage,
      closeDialog,
      previewCandidate,
      applyCandidate,
    },
  }
}
