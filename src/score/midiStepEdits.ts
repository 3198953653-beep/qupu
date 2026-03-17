import { normalizeMeasurePairAt } from './accidentals'
import { DURATION_TICKS } from './constants'
import { findSelectionLocationInPairs } from './keyboardEdits'
import {
  decomposeNoteSpanAllowDot,
  decomposeRestSpanNoDot,
  getMeasureTicksByTimeSignature,
  isXOver4TimeSignature,
} from './rhythmRegroup'
import {
  createImportedNoteId,
  createNoteId,
  splitTicksToDurations,
} from './scoreOps'
import type {
  ImportedNoteLocation,
  MeasurePair,
  NoteDuration,
  Pitch,
  ScoreNote,
  Selection,
  StaffKind,
  TimeSignature,
} from './types'

export type MidiStepInputMode = 'replace-anchor' | 'insert-after-anchor'

export type MidiStepInputFailureReason =
  | 'selection-not-found'
  | 'invalid-anchor-duration'
  | 'unsupported-grouping'
  | 'insufficient-ticks'

export type MidiStepInputResult = {
  nextPairs: MeasurePair[]
  nextSelection: Selection
  changedPairIndices: number[]
  appendedMeasureCount: number
}

export type MidiStepInputAttempt = {
  result: MidiStepInputResult | null
  error: MidiStepInputFailureReason | null
}

const REST_ANCHOR_PITCH: Record<StaffKind, Pitch> = {
  treble: 'b/4',
  bass: 'd/3',
}

type MeasureSpan = {
  pairIndex: number
  startTick: number
  endTick: number
  measureTicks: number
  timeSignature: TimeSignature
}

type MeasureRewriteResult = {
  notes: ScoreNote[] | null
  error: MidiStepInputFailureReason | null
}

function resolveStaffNotes(pair: MeasurePair, staff: StaffKind): ScoreNote[] {
  return staff === 'treble' ? pair.treble : pair.bass
}

function getNoteTicks(note: ScoreNote): number {
  return DURATION_TICKS[note.duration]
}

function getTotalTicksForDurations(durations: NoteDuration[]): number {
  return durations.reduce((sum, duration) => sum + (DURATION_TICKS[duration] ?? 0), 0)
}

function isValidDurationDecomposition(durations: NoteDuration[] | null, expectedTicks: number): durations is NoteDuration[] {
  if (!durations) return false
  return getTotalTicksForDurations(durations) === expectedTicks
}

function getNoteStartTickAtIndex(notes: ScoreNote[], noteIndex: number): number {
  let cursor = 0
  for (let index = 0; index < noteIndex; index += 1) {
    cursor += getNoteTicks(notes[index])
  }
  return cursor
}

function buildGeneratedNoteId(staff: StaffKind, importedMode: boolean): string {
  return importedMode ? createImportedNoteId(staff) : createNoteId()
}

function resolvePairTimeSignature(pairIndex: number, timeSignaturesByMeasure?: TimeSignature[] | null): TimeSignature {
  if (!timeSignaturesByMeasure || timeSignaturesByMeasure.length === 0) {
    return { beats: 4, beatType: 4 }
  }
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = timeSignaturesByMeasure[index]
    if (
      value &&
      Number.isFinite(value.beats) &&
      value.beats > 0 &&
      Number.isFinite(value.beatType) &&
      value.beatType > 0
    ) {
      return {
        beats: Math.max(1, Math.round(value.beats)),
        beatType: Math.max(1, Math.round(value.beatType)),
      }
    }
  }
  return { beats: 4, beatType: 4 }
}

function resolvePairKeyFifths(pairIndex: number, keyFifthsByMeasure?: number[] | null): number {
  if (!keyFifthsByMeasure || keyFifthsByMeasure.length === 0) return 0
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyFifthsByMeasure[index]
    if (Number.isFinite(value)) return Math.trunc(value)
  }
  return 0
}

function resolveKeyFifthsSeries(pairCount: number, keyFifthsByMeasure?: number[] | null): number[] {
  if (pairCount <= 0) return []
  const series: number[] = []
  for (let index = 0; index < pairCount; index += 1) {
    series.push(resolvePairKeyFifths(index, keyFifthsByMeasure))
  }
  return series
}

function cloneScoreNote(note: ScoreNote): ScoreNote {
  return {
    ...note,
    chordPitches: note.chordPitches ? note.chordPitches.slice() : undefined,
    chordAccidentals: note.chordAccidentals ? note.chordAccidentals.slice() : undefined,
    chordTieStarts: note.chordTieStarts ? note.chordTieStarts.slice() : undefined,
    chordTieStops: note.chordTieStops ? note.chordTieStops.slice() : undefined,
    chordTieFrozenIncomingPitches: note.chordTieFrozenIncomingPitches
      ? note.chordTieFrozenIncomingPitches.slice()
      : undefined,
    chordTieFrozenIncomingFromNoteIds: note.chordTieFrozenIncomingFromNoteIds
      ? note.chordTieFrozenIncomingFromNoteIds.slice()
      : undefined,
    chordTieFrozenIncomingFromKeyIndices: note.chordTieFrozenIncomingFromKeyIndices
      ? note.chordTieFrozenIncomingFromKeyIndices.slice()
      : undefined,
  }
}

function cloneMeasurePairs(pairs: MeasurePair[]): MeasurePair[] {
  return pairs.map((pair) => ({
    treble: pair.treble.map(cloneScoreNote),
    bass: pair.bass.map(cloneScoreNote),
  }))
}

function clearIncomingTieFields(note: ScoreNote): ScoreNote {
  const hasIncomingTie =
    note.tieStop !== undefined ||
    note.chordTieStops !== undefined ||
    note.tieFrozenIncomingPitch !== undefined ||
    note.tieFrozenIncomingFromNoteId !== undefined ||
    note.tieFrozenIncomingFromKeyIndex !== undefined ||
    note.chordTieFrozenIncomingPitches !== undefined ||
    note.chordTieFrozenIncomingFromNoteIds !== undefined ||
    note.chordTieFrozenIncomingFromKeyIndices !== undefined
  if (!hasIncomingTie) return note
  const next: ScoreNote = { ...note }
  delete next.tieStop
  delete next.chordTieStops
  delete next.tieFrozenIncomingPitch
  delete next.tieFrozenIncomingFromNoteId
  delete next.tieFrozenIncomingFromKeyIndex
  delete next.chordTieFrozenIncomingPitches
  delete next.chordTieFrozenIncomingFromNoteIds
  delete next.chordTieFrozenIncomingFromKeyIndices
  return next
}

function clearOutgoingTieFields(note: ScoreNote): ScoreNote {
  const hasOutgoingTie = note.tieStart !== undefined || note.chordTieStarts !== undefined
  if (!hasOutgoingTie) return note
  const next: ScoreNote = { ...note }
  delete next.tieStart
  delete next.chordTieStarts
  return next
}

function clearAllTieFields(note: ScoreNote): ScoreNote {
  return clearIncomingTieFields(clearOutgoingTieFields(note))
}

function clearAccidentalDisplay(note: ScoreNote): ScoreNote {
  const next: ScoreNote = { ...note }
  delete next.accidental
  delete next.chordAccidentals
  return next
}

function cloneNoteForDurationFragment(params: {
  note: ScoreNote
  duration: NoteDuration
  staff: StaffKind
  id: string
}): ScoreNote {
  const { note, duration, staff, id } = params
  if (note.isRest) {
    return clearAllTieFields({
      id,
      pitch: note.pitch || REST_ANCHOR_PITCH[staff],
      duration,
      isRest: true,
    })
  }
  return clearAllTieFields(
    clearAccidentalDisplay({
      ...note,
      id,
      duration,
      accidental: undefined,
      chordAccidentals: undefined,
    }),
  )
}

function applyInternalFragmentTies(fragments: ScoreNote[], sourceNote: ScoreNote): ScoreNote[] {
  if (fragments.length <= 1 || sourceNote.isRest) return fragments
  const chordCount = sourceNote.chordPitches?.length ?? 0
  return fragments.map((fragment, index) => {
    const next = { ...fragment }
    if (index > 0) {
      next.tieStop = true
      if (chordCount > 0) {
        next.chordTieStops = new Array(chordCount).fill(true)
      }
    }
    if (index < fragments.length - 1) {
      next.tieStart = true
      if (chordCount > 0) {
        next.chordTieStarts = new Array(chordCount).fill(true)
      }
    }
    return next
  })
}

function resolveRegroupedDurationsForSpan(params: {
  startTick: number
  endTick: number
  measureTicks: number
  timeSignature: TimeSignature
  isRest: boolean
}): NoteDuration[] | null {
  const { startTick, endTick, measureTicks, timeSignature, isRest } = params
  const ticks = Math.max(0, Math.round(endTick - startTick))
  if (ticks === 0) return []

  if (!isXOver4TimeSignature(timeSignature)) {
    const fallback = splitTicksToDurations(ticks)
    return isValidDurationDecomposition(fallback, ticks) ? fallback : null
  }

  const regrouped = isRest
    ? decomposeRestSpanNoDot({
        startTick,
        endTick,
        measureTicks,
        timeSignature,
      })
    : decomposeNoteSpanAllowDot({
        startTick,
        endTick,
        measureTicks,
        timeSignature,
      })
  return isValidDurationDecomposition(regrouped, ticks) ? regrouped : null
}

function buildFragmentsFromSourceSlice(params: {
  note: ScoreNote
  startTick: number
  endTick: number
  measureTicks: number
  timeSignature: TimeSignature
  staff: StaffKind
  importedMode: boolean
}): ScoreNote[] | null {
  const {
    note,
    startTick,
    endTick,
    measureTicks,
    timeSignature,
    staff,
    importedMode,
  } = params
  const durations = resolveRegroupedDurationsForSpan({
    startTick,
    endTick,
    measureTicks,
    timeSignature,
    isRest: Boolean(note.isRest),
  })
  if (!durations) return null
  const fragments = durations.map((duration) =>
    cloneNoteForDurationFragment({
      note,
      duration,
      staff,
      id: buildGeneratedNoteId(staff, importedMode),
    }),
  )
  return applyInternalFragmentTies(fragments, note)
}

function withClearedIncomingTieOnFirst(notes: ScoreNote[]): ScoreNote[] {
  if (notes.length === 0) return notes
  const next = notes.slice()
  next[0] = clearIncomingTieFields(next[0])
  return next
}

function rewriteStaffNotesForSpan(params: {
  sourceNotes: ScoreNote[]
  spanStartTick: number
  spanEndTick: number
  insertedNotes: ScoreNote[]
  staff: StaffKind
  importedMode: boolean
  measureTicks: number
  timeSignature: TimeSignature
}): MeasureRewriteResult {
  const {
    sourceNotes,
    spanStartTick,
    spanEndTick,
    insertedNotes,
    staff,
    importedMode,
    measureTicks,
    timeSignature,
  } = params

  const before: ScoreNote[] = []
  const after: ScoreNote[] = []
  let cursor = 0

  for (const note of sourceNotes) {
    const noteTicks = getNoteTicks(note)
    if (!Number.isFinite(noteTicks) || noteTicks <= 0) continue

    const noteStart = cursor
    const noteEnd = noteStart + noteTicks
    cursor = noteEnd

    if (noteEnd <= spanStartTick) {
      before.push(note)
      continue
    }

    if (noteStart >= spanEndTick) {
      after.push(note)
      continue
    }

    if (noteStart < spanStartTick) {
      const prefixFragments = buildFragmentsFromSourceSlice({
        note,
        startTick: noteStart,
        endTick: spanStartTick,
        measureTicks,
        timeSignature,
        staff,
        importedMode,
      })
      if (!prefixFragments) {
        return {
          notes: null,
          error: 'unsupported-grouping',
        }
      }
      before.push(...prefixFragments)
    }

    if (noteEnd > spanEndTick) {
      const suffixFragments = buildFragmentsFromSourceSlice({
        note,
        startTick: spanEndTick,
        endTick: noteEnd,
        measureTicks,
        timeSignature,
        staff,
        importedMode,
      })
      if (!suffixFragments) {
        return {
          notes: null,
          error: 'unsupported-grouping',
        }
      }
      after.push(...suffixFragments)
    }
  }

  const normalizedAfter = insertedNotes.length > 0 ? withClearedIncomingTieOnFirst(after) : after
  return {
    notes: [...before, ...insertedNotes, ...normalizedAfter],
    error: null,
  }
}

function buildInsertedNotesForSpan(params: {
  span: MeasureSpan
  pitch: Pitch
  staff: StaffKind
  importedMode: boolean
}): ScoreNote[] | null {
  const { span, pitch, staff, importedMode } = params
  const durations = resolveRegroupedDurationsForSpan({
    startTick: span.startTick,
    endTick: span.endTick,
    measureTicks: span.measureTicks,
    timeSignature: span.timeSignature,
    isRest: false,
  })
  if (!durations) return null
  return durations.map((duration) => ({
    id: buildGeneratedNoteId(staff, importedMode),
    pitch,
    duration,
    isRest: false,
  }))
}

function buildMeasureRests(params: {
  staff: StaffKind
  importedMode: boolean
  timeSignature: TimeSignature
}): ScoreNote[] | null {
  const { staff, importedMode, timeSignature } = params
  const measureTicks = getMeasureTicksByTimeSignature(timeSignature)
  const durations = resolveRegroupedDurationsForSpan({
    startTick: 0,
    endTick: measureTicks,
    measureTicks,
    timeSignature,
    isRest: true,
  })
  if (!durations) return null
  return durations.map((duration) => ({
    id: buildGeneratedNoteId(staff, importedMode),
    pitch: REST_ANCHOR_PITCH[staff],
    duration,
    isRest: true,
  }))
}

function clearMeasureFirstIncomingTie(params: {
  pairs: MeasurePair[]
  pairIndex: number
  staff: StaffKind
  changedPairIndices: Set<number>
}): void {
  const { pairs, pairIndex, staff, changedPairIndices } = params
  const pair = pairs[pairIndex]
  if (!pair) return
  const sourceNotes = resolveStaffNotes(pair, staff)
  if (sourceNotes.length === 0) return
  const firstNote = sourceNotes[0]
  const cleaned = clearIncomingTieFields(firstNote)
  if (cleaned === firstNote) return

  const nextNotes = sourceNotes.slice()
  nextNotes[0] = cleaned
  pairs[pairIndex] =
    staff === 'treble'
      ? { treble: nextNotes, bass: pair.bass }
      : { treble: pair.treble, bass: nextNotes }
  changedPairIndices.add(pairIndex)
}

function markInsertedTieFlags(insertedSequence: ScoreNote[]): void {
  if (insertedSequence.length <= 1) {
    if (insertedSequence[0]) {
      const only = insertedSequence[0]
      delete only.tieStart
      delete only.tieStop
      delete only.chordTieStarts
      delete only.chordTieStops
    }
    return
  }

  insertedSequence.forEach((note, index) => {
    delete note.chordTieStarts
    delete note.chordTieStops
    if (index > 0) {
      note.tieStop = true
    } else {
      delete note.tieStop
    }
    if (index < insertedSequence.length - 1) {
      note.tieStart = true
    } else {
      delete note.tieStart
    }
  })
}

function isReplaceAnchorNoOp(params: {
  mode: MidiStepInputMode
  anchorSelection: Selection
  anchorNote: ScoreNote
  targetPitch: Pitch
}): boolean {
  const { mode, anchorSelection, anchorNote, targetPitch } = params
  if (mode !== 'replace-anchor') return false
  if (anchorNote.isRest) return false
  if (anchorSelection.keyIndex !== 0) return false
  if ((anchorNote.chordPitches?.length ?? 0) > 0) return false
  return anchorNote.pitch === targetPitch
}

export function applyMidiStepInput(params: {
  pairs: MeasurePair[]
  anchorSelection: Selection
  mode: MidiStepInputMode
  targetPitch: Pitch
  importedMode: boolean
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
  keyFifthsByMeasure?: number[] | null
  timeSignaturesByMeasure?: TimeSignature[] | null
  allowAutoAppendMeasure?: boolean
}): MidiStepInputAttempt {
  const {
    pairs,
    anchorSelection,
    mode,
    targetPitch,
    importedMode,
    importedNoteLookup = null,
    keyFifthsByMeasure = null,
    timeSignaturesByMeasure = null,
    allowAutoAppendMeasure = true,
  } = params

  const anchorLocation = findSelectionLocationInPairs({
    pairs,
    selection: anchorSelection,
    importedNoteLookup,
  })
  if (!anchorLocation) {
    return { result: null, error: 'selection-not-found' }
  }

  const anchorPair = pairs[anchorLocation.pairIndex]
  if (!anchorPair) {
    return { result: null, error: 'selection-not-found' }
  }

  const anchorStaff = anchorSelection.staff
  const anchorStaffNotes = resolveStaffNotes(anchorPair, anchorStaff)
  const anchorNote = anchorStaffNotes[anchorLocation.noteIndex]
  if (!anchorNote || anchorNote.id !== anchorSelection.noteId) {
    return { result: null, error: 'selection-not-found' }
  }

  const anchorTicks = DURATION_TICKS[anchorNote.duration]
  if (!Number.isFinite(anchorTicks) || anchorTicks <= 0) {
    return { result: null, error: 'invalid-anchor-duration' }
  }

  if (
    isReplaceAnchorNoOp({
      mode,
      anchorSelection,
      anchorNote,
      targetPitch,
    })
  ) {
    return {
      result: {
        nextPairs: pairs,
        nextSelection: {
          noteId: anchorSelection.noteId,
          staff: anchorSelection.staff,
          keyIndex: 0,
        },
        changedPairIndices: [],
        appendedMeasureCount: 0,
      },
      error: null,
    }
  }

  const anchorStartTick = getNoteStartTickAtIndex(anchorStaffNotes, anchorLocation.noteIndex)
  const anchorEndTick = anchorStartTick + anchorTicks
  let spanPairIndex = anchorLocation.pairIndex
  let spanStartTick = mode === 'insert-after-anchor' ? anchorEndTick : anchorStartTick

  const nextPairs = cloneMeasurePairs(pairs)
  const changedPairIndices = new Set<number>()
  const spans: MeasureSpan[] = []
  let appendedMeasureCount = 0
  let remainingTicks = anchorTicks

  while (remainingTicks > 0) {
    while (spanPairIndex >= nextPairs.length) {
      if (!allowAutoAppendMeasure) {
        return { result: null, error: 'insufficient-ticks' }
      }
      const appendIndex = nextPairs.length
      const appendTimeSignature = resolvePairTimeSignature(appendIndex, timeSignaturesByMeasure)
      const trebleRests = buildMeasureRests({
        staff: 'treble',
        importedMode,
        timeSignature: appendTimeSignature,
      })
      const bassRests = buildMeasureRests({
        staff: 'bass',
        importedMode,
        timeSignature: appendTimeSignature,
      })
      if (!trebleRests || !bassRests) {
        return { result: null, error: 'unsupported-grouping' }
      }
      nextPairs.push({
        treble: trebleRests,
        bass: bassRests,
      })
      appendedMeasureCount += 1
      changedPairIndices.add(appendIndex)
    }

    const timeSignature = resolvePairTimeSignature(spanPairIndex, timeSignaturesByMeasure)
    const measureTicks = getMeasureTicksByTimeSignature(timeSignature)
    if (spanStartTick >= measureTicks) {
      spanPairIndex += 1
      spanStartTick = 0
      continue
    }

    const availableTicks = Math.max(0, measureTicks - spanStartTick)
    if (availableTicks <= 0) {
      spanPairIndex += 1
      spanStartTick = 0
      continue
    }

    const consumeTicks = Math.min(remainingTicks, availableTicks)
    spans.push({
      pairIndex: spanPairIndex,
      startTick: spanStartTick,
      endTick: spanStartTick + consumeTicks,
      measureTicks,
      timeSignature,
    })
    remainingTicks -= consumeTicks
    spanPairIndex += 1
    spanStartTick = 0
  }

  if (spans.length === 0) {
    return { result: null, error: 'insufficient-ticks' }
  }

  const insertedByPair = new Map<number, ScoreNote[]>()
  const insertedSequence: ScoreNote[] = []

  for (const span of spans) {
    const insertedNotes = buildInsertedNotesForSpan({
      span,
      pitch: targetPitch,
      staff: anchorStaff,
      importedMode,
    })
    if (!insertedNotes) {
      return { result: null, error: 'unsupported-grouping' }
    }
    insertedByPair.set(span.pairIndex, insertedNotes)
    insertedSequence.push(...insertedNotes)
  }

  if (insertedSequence.length === 0) {
    return { result: null, error: 'unsupported-grouping' }
  }

  markInsertedTieFlags(insertedSequence)

  for (const span of spans) {
    const pair = nextPairs[span.pairIndex]
    if (!pair) {
      return { result: null, error: 'selection-not-found' }
    }

    const sourceStaffNotes = resolveStaffNotes(pair, anchorStaff)
    const insertedNotes = insertedByPair.get(span.pairIndex) ?? []
    const rewritten = rewriteStaffNotesForSpan({
      sourceNotes: sourceStaffNotes,
      spanStartTick: span.startTick,
      spanEndTick: span.endTick,
      insertedNotes,
      staff: anchorStaff,
      importedMode,
      measureTicks: span.measureTicks,
      timeSignature: span.timeSignature,
    })

    if (!rewritten.notes || rewritten.error) {
      return {
        result: null,
        error: rewritten.error ?? 'unsupported-grouping',
      }
    }

    nextPairs[span.pairIndex] =
      anchorStaff === 'treble'
        ? { treble: rewritten.notes, bass: pair.bass }
        : { treble: pair.treble, bass: rewritten.notes }
    changedPairIndices.add(span.pairIndex)
  }

  const lastSpan = spans[spans.length - 1]
  if (lastSpan.endTick >= lastSpan.measureTicks) {
    clearMeasureFirstIncomingTie({
      pairs: nextPairs,
      pairIndex: lastSpan.pairIndex + 1,
      staff: anchorStaff,
      changedPairIndices,
    })
  }

  let normalizedPairs = nextPairs
  const sortedChangedPairIndices = [...changedPairIndices].sort((left, right) => left - right)
  if (sortedChangedPairIndices.length > 0) {
    const keyFifthsSeries = resolveKeyFifthsSeries(nextPairs.length, keyFifthsByMeasure)
    for (const pairIndex of sortedChangedPairIndices) {
      normalizedPairs = normalizeMeasurePairAt(normalizedPairs, pairIndex, keyFifthsSeries)
    }
  }

  const nextSelection: Selection = {
    noteId: insertedSequence[0].id,
    staff: anchorStaff,
    keyIndex: 0,
  }

  return {
    result: {
      nextPairs: normalizedPairs,
      nextSelection,
      changedPairIndices: sortedChangedPairIndices,
      appendedMeasureCount,
    },
    error: null,
  }
}
