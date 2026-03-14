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
  ScoreNote,
  Selection,
  StaffKind,
  TimeSignature,
} from './types'

export type PaletteDurationEditAction =
  | { type: 'duration'; targetDuration: NoteDuration }
  | { type: 'toggle-dot'; targetDuration: NoteDuration | null }
  | { type: 'note-to-rest' }

export type DurationEditFailureReason =
  | 'no-selection'
  | 'multi-note-block'
  | 'selection-not-found'
  | 'insufficient-ticks'
  | 'unsupported-dot'
  | 'unsupported-grouping'

export type DurationEditResult = {
  nextPairs: MeasurePair[]
  nextSelection: Selection
  nextSelections: Selection[]
  changedPairIndex: number
  changeKind: 'duration' | 'dot' | 'rest'
}

type DurationEditAttempt = {
  result: DurationEditResult | null
  error: DurationEditFailureReason | null
}

type EditableSelectionTarget = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
  note: ScoreNote
  selection: Selection
  selections: Selection[]
}

const REST_ANCHOR_PITCH: Record<StaffKind, string> = {
  treble: 'b/4',
  bass: 'd/3',
}

function dedupeSelections(selections: Selection[]): Selection[] {
  const seen = new Set<string>()
  const next: Selection[] = []
  selections.forEach((selection) => {
    const key = `${selection.staff}:${selection.noteId}:${selection.keyIndex}`
    if (seen.has(key)) return
    seen.add(key)
    next.push(selection)
  })
  return next
}

function resolvePairKeyFifths(pairIndex: number, keyFifthsByMeasure?: number[] | null): number {
  if (!keyFifthsByMeasure || keyFifthsByMeasure.length === 0) return 0
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyFifthsByMeasure[index]
    if (Number.isFinite(value)) return Math.trunc(value)
  }
  return 0
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
      return { beats: Math.round(value.beats), beatType: Math.round(value.beatType) }
    }
  }
  return { beats: 4, beatType: 4 }
}

function getNoteStartTickAtIndex(notes: ScoreNote[], noteIndex: number): number {
  let cursor = 0
  for (let index = 0; index < noteIndex; index += 1) {
    cursor += getNoteTicks(notes[index])
  }
  return cursor
}

function clearIncomingTieFields(note: ScoreNote): ScoreNote {
  const nextNote: ScoreNote = { ...note }
  delete nextNote.tieStop
  delete nextNote.chordTieStops
  delete nextNote.tieFrozenIncomingPitch
  delete nextNote.tieFrozenIncomingFromNoteId
  delete nextNote.tieFrozenIncomingFromKeyIndex
  delete nextNote.chordTieFrozenIncomingPitches
  delete nextNote.chordTieFrozenIncomingFromNoteIds
  delete nextNote.chordTieFrozenIncomingFromKeyIndices
  return nextNote
}

function clearOutgoingTieFields(note: ScoreNote): ScoreNote {
  const nextNote: ScoreNote = { ...note }
  delete nextNote.tieStart
  delete nextNote.chordTieStarts
  return nextNote
}

function clearAllTieFields(note: ScoreNote): ScoreNote {
  return clearIncomingTieFields(clearOutgoingTieFields(note))
}

function clearAccidentalDisplay(note: ScoreNote): ScoreNote {
  const nextNote: ScoreNote = { ...note }
  delete nextNote.accidental
  delete nextNote.chordAccidentals
  return nextNote
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

function buildRestNotesFromDurations(durations: NoteDuration[], staff: StaffKind, importedMode: boolean): ScoreNote[] {
  if (durations.length === 0) return []
  return durations.map((duration) =>
    clearAllTieFields({
      id: buildGeneratedNoteId(staff, importedMode),
      pitch: REST_ANCHOR_PITCH[staff],
      duration,
      isRest: true,
    }),
  )
}

function applyInternalFragmentTies(fragments: ScoreNote[], sourceNote: ScoreNote): ScoreNote[] {
  if (fragments.length <= 1 || sourceNote.isRest) return fragments
  const chordCount = sourceNote.chordPitches?.length ?? 0
  return fragments.map((note, index) => {
    const next = { ...note }
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

function splitRemainingNoteIntoFragments(params: {
  note: ScoreNote
  durations: NoteDuration[]
  staff: StaffKind
  importedMode: boolean
}): ScoreNote[] {
  const { note, durations, staff, importedMode } = params
  if (durations.length === 0) return []
  const fragments = durations.map((duration, index) =>
    cloneNoteForDurationFragment({
      note,
      duration,
      staff,
      id: index === 0 ? note.id : buildGeneratedNoteId(staff, importedMode),
    }),
  )
  return applyInternalFragmentTies(fragments, note)
}

function resolveRegroupedRestDurations(params: {
  startTick: number
  endTick: number
  measureTicks: number
  timeSignature: TimeSignature
}): NoteDuration[] | null {
  const { startTick, endTick, measureTicks, timeSignature } = params
  const restTicks = Math.max(0, Math.round(endTick - startTick))
  if (restTicks === 0) return []
  if (!isXOver4TimeSignature(timeSignature)) {
    const fallback = splitTicksToDurations(restTicks)
    return isValidDurationDecomposition(fallback, restTicks) ? fallback : null
  }
  const regrouped = decomposeRestSpanNoDot({
    startTick,
    endTick,
    measureTicks,
    timeSignature,
  })
  return isValidDurationDecomposition(regrouped, restTicks) ? regrouped : null
}

function resolveRegroupedBoundaryNoteDurations(params: {
  startTick: number
  endTick: number
  measureTicks: number
  timeSignature: TimeSignature
}): NoteDuration[] | null {
  const { startTick, endTick, measureTicks, timeSignature } = params
  const ticks = Math.max(0, Math.round(endTick - startTick))
  if (ticks === 0) return []
  if (!isXOver4TimeSignature(timeSignature)) {
    const fallback = splitTicksToDurations(ticks)
    return isValidDurationDecomposition(fallback, ticks) ? fallback : null
  }
  const regrouped = decomposeNoteSpanAllowDot({
    startTick,
    endTick,
    measureTicks,
    timeSignature,
  })
  return isValidDurationDecomposition(regrouped, ticks) ? regrouped : null
}

function withClearedIncomingTieOnFirst(notes: ScoreNote[]): ScoreNote[] {
  if (notes.length === 0) return notes
  const next = notes.slice()
  next[0] = clearIncomingTieFields(next[0])
  return next
}

export function resolveEditableSelectionTarget(params: {
  pairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  isSelectionVisible: boolean
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}): { target: EditableSelectionTarget | null; error: DurationEditFailureReason | null } {
  const {
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup = null,
  } = params

  if (!isSelectionVisible) {
    return { target: null, error: 'no-selection' }
  }

  const effectiveSelections = dedupeSelections([...selectedSelections, activeSelection])
  if (effectiveSelections.length === 0) {
    return { target: null, error: 'no-selection' }
  }

  const resolvedSelections = effectiveSelections
    .map((selection) => {
      const location = findSelectionLocationInPairs({
        pairs,
        selection,
        importedNoteLookup,
      })
      if (!location) return null
      const pair = pairs[location.pairIndex]
      const note = pair ? resolveStaffNotes(pair, location.staff)[location.noteIndex] : null
      if (!note || note.id !== selection.noteId) return null
      return { selection, location, note }
    })
    .filter(
      (entry): entry is { selection: Selection; location: { pairIndex: number; noteIndex: number; staff: StaffKind }; note: ScoreNote } =>
        entry !== null,
    )

  if (resolvedSelections.length === 0) {
    return { target: null, error: 'selection-not-found' }
  }

  const blockKeys = new Set(resolvedSelections.map((entry) => `${entry.selection.staff}:${entry.selection.noteId}`))
  if (blockKeys.size > 1) {
    return { target: null, error: 'multi-note-block' }
  }

  const activeEntry =
    resolvedSelections.find(
      (entry) => entry.selection.noteId === activeSelection.noteId && entry.selection.staff === activeSelection.staff,
    ) ?? resolvedSelections[0]

  return {
    target: {
      pairIndex: activeEntry.location.pairIndex,
      noteIndex: activeEntry.location.noteIndex,
      staff: activeEntry.location.staff,
      note: activeEntry.note,
      selection: activeEntry.selection,
      selections: resolvedSelections.map((entry) => entry.selection),
    },
    error: null,
  }
}

function rewriteMeasureStaffNotesWithDurationChange(params: {
  notes: ScoreNote[]
  noteIndex: number
  targetDuration: NoteDuration
  staff: StaffKind
  importedMode: boolean
  timeSignature: TimeSignature
}): { notes: ScoreNote[] | null; error: DurationEditFailureReason | null } {
  const { notes, noteIndex, targetDuration, staff, importedMode, timeSignature } = params
  const sourceNote = notes[noteIndex]
  if (!sourceNote) return { notes: null, error: 'selection-not-found' }

  const currentTicks = getNoteTicks(sourceNote)
  const targetTicks = DURATION_TICKS[targetDuration]
  const measureTicks = getMeasureTicksByTimeSignature(timeSignature)
  const sourceStartTick = getNoteStartTickAtIndex(notes, noteIndex)
  const sourceEndTick = sourceStartTick + currentTicks
  if (currentTicks === targetTicks && sourceNote.duration === targetDuration) {
    return { notes, error: null }
  }

  const beforeNotes = notes.slice(0, noteIndex)
  const afterNotes = notes.slice(noteIndex + 1)

  const nextTarget =
    sourceNote.isRest
      ? clearAllTieFields({ ...sourceNote, duration: targetDuration })
      : clearOutgoingTieFields({ ...sourceNote, duration: targetDuration })

  if (targetTicks < currentTicks) {
    const restStartTick = sourceStartTick + targetTicks
    const restEndTick = sourceEndTick
    const restDurations = resolveRegroupedRestDurations({
      startTick: restStartTick,
      endTick: restEndTick,
      measureTicks,
      timeSignature,
    })
    if (!restDurations) {
      return { notes: null, error: 'unsupported-grouping' }
    }
    const restNotes = buildRestNotesFromDurations(restDurations, staff, importedMode)
    return {
      notes: [...beforeNotes, nextTarget, ...restNotes, ...withClearedIncomingTieOnFirst(afterNotes)],
      error: null,
    }
  }

  let needTicks = targetTicks - currentTicks
  let scanIndex = noteIndex + 1
  let boundaryFragments: ScoreNote[] = []
  let cursorTick = sourceEndTick

  while (scanIndex < notes.length && needTicks > 0) {
    const currentNote = notes[scanIndex]
    const noteTicks = getNoteTicks(currentNote)
    if (noteTicks <= needTicks) {
      needTicks -= noteTicks
      cursorTick += noteTicks
      scanIndex += 1
      continue
    }

    const boundaryStartTick = cursorTick
    const boundaryEndTick = boundaryStartTick + noteTicks
    const remainingStartTick = boundaryStartTick + needTicks
    const regroupedDurations = currentNote.isRest
      ? resolveRegroupedRestDurations({
          startTick: remainingStartTick,
          endTick: boundaryEndTick,
          measureTicks,
          timeSignature,
        })
      : resolveRegroupedBoundaryNoteDurations({
          startTick: remainingStartTick,
          endTick: boundaryEndTick,
          measureTicks,
          timeSignature,
        })
    if (!regroupedDurations) {
      return { notes: null, error: 'unsupported-grouping' }
    }

    boundaryFragments = splitRemainingNoteIntoFragments({
      note: currentNote,
      durations: regroupedDurations,
      staff,
      importedMode,
    })
    needTicks = 0
    scanIndex += 1
    break
  }

  if (needTicks > 0) {
    return { notes: null, error: 'insufficient-ticks' }
  }

  const untouchedTail = withClearedIncomingTieOnFirst(notes.slice(scanIndex))
  return {
    notes: [...beforeNotes, nextTarget, ...boundaryFragments, ...untouchedTail],
    error: null,
  }
}

function replacePairStaffNotes(
  pairs: MeasurePair[],
  pairIndex: number,
  staff: StaffKind,
  nextStaffNotes: ScoreNote[],
): MeasurePair[] {
  const pair = pairs[pairIndex]
  if (!pair) return pairs
  const nextPairs = pairs.slice()
  nextPairs[pairIndex] =
    staff === 'treble'
      ? { treble: nextStaffNotes, bass: pair.bass }
      : { treble: pair.treble, bass: nextStaffNotes }
  return nextPairs
}

function changeNoteBlockDurationWithinMeasure(params: {
  pairs: MeasurePair[]
  target: EditableSelectionTarget
  targetDuration: NoteDuration
  keyFifthsByMeasure?: number[] | null
  timeSignaturesByMeasure?: TimeSignature[] | null
  importedMode: boolean
  changeKind: 'duration' | 'dot'
}): DurationEditAttempt {
  const {
    pairs,
    target,
    targetDuration,
    keyFifthsByMeasure = null,
    timeSignaturesByMeasure = null,
    importedMode,
    changeKind,
  } = params
  const pair = pairs[target.pairIndex]
  if (!pair) return { result: null, error: 'selection-not-found' }
  const sourceStaffNotes = resolveStaffNotes(pair, target.staff)
  const timeSignature = resolvePairTimeSignature(target.pairIndex, timeSignaturesByMeasure)
  const rewriteResult = rewriteMeasureStaffNotesWithDurationChange({
    notes: sourceStaffNotes,
    noteIndex: target.noteIndex,
    targetDuration,
    staff: target.staff,
    importedMode,
    timeSignature,
  })
  if (!rewriteResult.notes || rewriteResult.error) {
    return { result: null, error: rewriteResult.error }
  }

  if (rewriteResult.notes === sourceStaffNotes) {
    return { result: null, error: null }
  }

  const nextPairs = normalizeMeasurePairAt(
    replacePairStaffNotes(pairs, target.pairIndex, target.staff, rewriteResult.notes),
    target.pairIndex,
    keyFifthsByMeasure
      ? keyFifthsByMeasure.map((_, index) => resolvePairKeyFifths(index, keyFifthsByMeasure))
      : null,
  )

  return {
    result: {
      nextPairs,
      nextSelection: {
        noteId: target.note.id,
        staff: target.staff,
        keyIndex: target.selection.keyIndex,
      },
      nextSelections: target.selections.map((selection) => ({
        ...selection,
      })),
      changedPairIndex: target.pairIndex,
      changeKind,
    },
    error: null,
  }
}

function toggleSelectedNoteBlockDot(params: {
  pairs: MeasurePair[]
  target: EditableSelectionTarget
  targetDuration: NoteDuration | null
  keyFifthsByMeasure?: number[] | null
  timeSignaturesByMeasure?: TimeSignature[] | null
  importedMode: boolean
}): DurationEditAttempt {
  const { targetDuration } = params
  if (!targetDuration) {
    return { result: null, error: 'unsupported-dot' }
  }
  return changeNoteBlockDurationWithinMeasure({
    ...params,
    targetDuration,
    changeKind: 'dot',
  })
}

function convertSelectedNoteBlockToRest(params: {
  pairs: MeasurePair[]
  target: EditableSelectionTarget
  keyFifthsByMeasure?: number[] | null
}): DurationEditAttempt {
  const { pairs, target, keyFifthsByMeasure = null } = params
  const pair = pairs[target.pairIndex]
  if (!pair) return { result: null, error: 'selection-not-found' }
  if (target.note.isRest) return { result: null, error: null }

  const sourceStaffNotes = resolveStaffNotes(pair, target.staff)
  const nextTarget = clearAllTieFields({
    id: target.note.id,
    pitch: target.note.pitch,
    duration: target.note.duration,
    isRest: true,
  })
  const nextAfterNotes = withClearedIncomingTieOnFirst(sourceStaffNotes.slice(target.noteIndex + 1))
  const nextStaffNotes = [
    ...sourceStaffNotes.slice(0, target.noteIndex),
    nextTarget,
    ...nextAfterNotes,
  ]
  const nextPairs = normalizeMeasurePairAt(
    replacePairStaffNotes(pairs, target.pairIndex, target.staff, nextStaffNotes),
    target.pairIndex,
    keyFifthsByMeasure
      ? keyFifthsByMeasure.map((_, index) => resolvePairKeyFifths(index, keyFifthsByMeasure))
      : null,
  )

  return {
    result: {
      nextPairs,
      nextSelection: {
        noteId: target.note.id,
        staff: target.staff,
        keyIndex: 0,
      },
      nextSelections: [
        {
          noteId: target.note.id,
          staff: target.staff,
          keyIndex: 0,
        },
      ],
      changedPairIndex: target.pairIndex,
      changeKind: 'rest',
    },
    error: null,
  }
}

export function applyPaletteDurationEdit(params: {
  pairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  isSelectionVisible: boolean
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
  keyFifthsByMeasure?: number[] | null
  timeSignaturesByMeasure?: TimeSignature[] | null
  action: PaletteDurationEditAction
  importedMode: boolean
}): DurationEditAttempt {
  const {
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup = null,
    keyFifthsByMeasure = null,
    timeSignaturesByMeasure = null,
    action,
    importedMode,
  } = params

  const { target, error } = resolveEditableSelectionTarget({
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup,
  })
  if (!target || error) {
    return { result: null, error }
  }

  switch (action.type) {
    case 'duration':
      return changeNoteBlockDurationWithinMeasure({
        pairs,
        target,
        targetDuration: action.targetDuration,
        keyFifthsByMeasure,
        timeSignaturesByMeasure,
        importedMode,
        changeKind: 'duration',
      })
    case 'toggle-dot':
      return toggleSelectedNoteBlockDot({
        pairs,
        target,
        targetDuration: action.targetDuration,
        keyFifthsByMeasure,
        timeSignaturesByMeasure,
        importedMode,
      })
    case 'note-to-rest':
      return convertSelectedNoteBlockToRest({
        pairs,
        target,
        keyFifthsByMeasure,
      })
    default:
      return { result: null, error: null }
  }
}
