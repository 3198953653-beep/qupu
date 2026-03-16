import { buildAccidentalStateBeforeNote, getEffectivePitchForStaffPosition, normalizeMeasurePairAt } from './accidentals'
import { findSelectionLocationInPairs } from './keyboardEdits'
import { toTargetAlterFromPaletteAccidental, type NotationPaletteAccidental } from './notationPaletteConfig'
import { getStepOctaveAlterFromPitch, toPitchFromStepAlter } from './pitchMath'
import { updateScoreNotePitchAtKey } from './scoreOps'
import { resolveFullTieTargets } from './tieChain'
import type {
  ImportedNoteLocation,
  MeasurePair,
  Pitch,
  ScoreNote,
  Selection,
  StaffKind,
} from './types'

export type AccidentalEditFailureReason =
  | 'no-selection'
  | 'selection-not-found'
  | 'no-editable-note'
  | 'no-op'
  | 'conflict'

export type AccidentalEditResult = {
  nextPairs: MeasurePair[]
  nextSelection: Selection
  nextSelections: Selection[]
  changedPairIndices: number[]
}

export type EditableAccidentalTarget = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
  noteId: string
  keyIndex: number
  note: ScoreNote
  selection: Selection
}

export type ExpandedPitchTarget = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
  noteId: string
  keyIndex: number
  targetPitch: Pitch
}

type SourcePitchTarget = EditableAccidentalTarget & {
  sourcePitch: Pitch
  targetPitch: Pitch
}

type AccidentalEditAttempt = {
  result: AccidentalEditResult | null
  error: AccidentalEditFailureReason | null
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

function getPitchAtKeyIndex(note: ScoreNote, keyIndex: number): Pitch | null {
  if (note.isRest) return null
  if (keyIndex <= 0) return note.pitch ?? null
  return note.chordPitches?.[keyIndex - 1] ?? null
}

function getTargetKey(target: {
  pairIndex: number
  staff: StaffKind
  noteId: string
  keyIndex: number
}): string {
  return `${target.staff}:${target.pairIndex}:${target.noteId}:${target.keyIndex}`
}

export function resolveEditableAccidentalSelections(params: {
  pairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  isSelectionVisible: boolean
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}): { targets: EditableAccidentalTarget[]; error: AccidentalEditFailureReason | null } {
  const {
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup = null,
  } = params

  if (!isSelectionVisible) {
    return { targets: [], error: 'no-selection' }
  }

  const effectiveSelections = dedupeSelections([...selectedSelections, activeSelection])
  if (effectiveSelections.length === 0) {
    return { targets: [], error: 'no-selection' }
  }

  const targets: EditableAccidentalTarget[] = []
  effectiveSelections.forEach((selection) => {
    const location = findSelectionLocationInPairs({
      pairs,
      selection,
      importedNoteLookup,
    })
    if (!location) return
    const pair = pairs[location.pairIndex]
    const note = pair ? resolveStaffNotes(pair, location.staff)[location.noteIndex] : null
    if (!note || note.id !== selection.noteId) return
    targets.push({
      pairIndex: location.pairIndex,
      noteIndex: location.noteIndex,
      staff: location.staff,
      noteId: selection.noteId,
      keyIndex: selection.keyIndex,
      note,
      selection,
    })
  })

  if (targets.length === 0) {
    return { targets: [], error: 'selection-not-found' }
  }

  return { targets, error: null }
}

export function expandTargetsWithFullTieChain(params: {
  pairs: MeasurePair[]
  sources: SourcePitchTarget[]
}): ExpandedPitchTarget[] {
  const { pairs, sources } = params
  const mergedByKey = new Map<string, ExpandedPitchTarget>()

  sources.forEach((source) => {
    const chainTargets = resolveFullTieTargets({
      measurePairs: pairs,
      pairIndex: source.pairIndex,
      noteIndex: source.noteIndex,
      keyIndex: source.keyIndex,
      staff: source.staff,
      pitchHint: source.sourcePitch,
    })
    const effectiveTargets =
      chainTargets.length > 0
        ? chainTargets
        : [
            {
              pairIndex: source.pairIndex,
              noteIndex: source.noteIndex,
              staff: source.staff,
              noteId: source.noteId,
              keyIndex: source.keyIndex,
              pitch: source.sourcePitch,
            },
          ]

    effectiveTargets.forEach((target) => {
      const expandedTarget: ExpandedPitchTarget = {
        pairIndex: target.pairIndex,
        noteIndex: target.noteIndex,
        staff: target.staff,
        noteId: target.noteId,
        keyIndex: target.keyIndex,
        targetPitch: source.targetPitch,
      }
      mergedByKey.set(getTargetKey(expandedTarget), expandedTarget)
    })
  })

  return [...mergedByKey.values()]
}

export function applyPitchTargetsAndNormalize(params: {
  pairs: MeasurePair[]
  expandedTargets: ExpandedPitchTarget[]
  keyFifthsByMeasure?: number[] | null
}): { nextPairs: MeasurePair[]; changedPairIndices: number[] } {
  const { pairs, expandedTargets, keyFifthsByMeasure = null } = params
  let nextPairs = pairs
  const changedPairIndices = new Set<number>()

  expandedTargets.forEach((target) => {
    const pair = nextPairs[target.pairIndex]
    if (!pair) return

    const sourceStaffNotes = resolveStaffNotes(pair, target.staff)
    let noteIndex = target.noteIndex
    let sourceNote = sourceStaffNotes[noteIndex]
    if (!sourceNote || sourceNote.id !== target.noteId) {
      noteIndex = sourceStaffNotes.findIndex((note) => note.id === target.noteId)
      if (noteIndex < 0) return
      sourceNote = sourceStaffNotes[noteIndex]
    }
    if (sourceNote.isRest) return

    const sourcePitch = getPitchAtKeyIndex(sourceNote, target.keyIndex)
    if (!sourcePitch || sourcePitch === target.targetPitch) return

    const nextNote = updateScoreNotePitchAtKey(sourceNote, target.targetPitch, target.keyIndex)
    if (nextNote === sourceNote) return

    const nextStaffNotes = sourceStaffNotes.slice()
    nextStaffNotes[noteIndex] = nextNote
    const nextPair =
      target.staff === 'treble'
        ? { treble: nextStaffNotes, bass: pair.bass }
        : { treble: pair.treble, bass: nextStaffNotes }

    const clonedPairs = nextPairs.slice()
    clonedPairs[target.pairIndex] = nextPair
    nextPairs = clonedPairs
    changedPairIndices.add(target.pairIndex)
  })

  if (changedPairIndices.size === 0) {
    return { nextPairs, changedPairIndices: [] }
  }

  const keyFifthsList = keyFifthsByMeasure
    ? keyFifthsByMeasure.map((_, pairIndex) => resolvePairKeyFifths(pairIndex, keyFifthsByMeasure))
    : null

  const changedPairIndexList = [...changedPairIndices].sort((left, right) => left - right)
  changedPairIndexList.forEach((pairIndex) => {
    nextPairs = normalizeMeasurePairAt(nextPairs, pairIndex, keyFifthsList)
  })
  return { nextPairs, changedPairIndices: changedPairIndexList }
}

export function applyPaletteAccidentalEdit(params: {
  pairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  isSelectionVisible: boolean
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
  keyFifthsByMeasure?: number[] | null
  accidentalId: Exclude<NotationPaletteAccidental, null>
}): AccidentalEditAttempt {
  const {
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup = null,
    keyFifthsByMeasure = null,
    accidentalId,
  } = params

  const resolved = resolveEditableAccidentalSelections({
    pairs,
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    importedNoteLookup,
  })
  if (resolved.error) {
    return { result: null, error: resolved.error }
  }

  const targetAlter = toTargetAlterFromPaletteAccidental(accidentalId)
  const sourceTargets: SourcePitchTarget[] = []
  let hasEditableNote = false

  resolved.targets.forEach((target) => {
    if (target.note.isRest) return
    const sourcePitch = getPitchAtKeyIndex(target.note, target.keyIndex)
    if (!sourcePitch) return

    hasEditableNote = true
    const sourcePitchParts = getStepOctaveAlterFromPitch(sourcePitch)
    const targetPitch = toPitchFromStepAlter(sourcePitchParts.step, targetAlter, sourcePitchParts.octave)
    sourceTargets.push({
      ...target,
      sourcePitch,
      targetPitch,
    })
  })

  if (!hasEditableNote) {
    return { result: null, error: 'no-editable-note' }
  }

  const expandedTargets = expandTargetsWithFullTieChain({
    pairs,
    sources: sourceTargets,
  })
  if (expandedTargets.length === 0) {
    return { result: null, error: 'no-op' }
  }

  const applied = applyPitchTargetsAndNormalize({
    pairs,
    expandedTargets,
    keyFifthsByMeasure,
  })
  if (applied.changedPairIndices.length === 0) {
    return { result: null, error: 'no-op' }
  }

  return {
    result: {
      nextPairs: applied.nextPairs,
      nextSelection: { ...activeSelection },
      nextSelections: dedupeSelections([...selectedSelections, activeSelection]),
      changedPairIndices: applied.changedPairIndices,
    },
    error: null,
  }
}

export function applyDeleteAccidentalSelection(params: {
  pairs: MeasurePair[]
  selection: Selection
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
  keyFifthsByMeasure?: number[] | null
}): AccidentalEditAttempt {
  const {
    pairs,
    selection,
    importedNoteLookup = null,
    keyFifthsByMeasure = null,
  } = params

  const location = findSelectionLocationInPairs({
    pairs,
    selection,
    importedNoteLookup,
  })
  if (!location) {
    return { result: null, error: 'selection-not-found' }
  }

  const pair = pairs[location.pairIndex]
  if (!pair) {
    return { result: null, error: 'selection-not-found' }
  }

  const staffNotes = resolveStaffNotes(pair, location.staff)
  const note = staffNotes[location.noteIndex]
  if (!note || note.id !== selection.noteId) {
    return { result: null, error: 'selection-not-found' }
  }
  if (note.isRest) {
    return { result: null, error: 'no-editable-note' }
  }

  const sourcePitch = getPitchAtKeyIndex(note, selection.keyIndex)
  if (!sourcePitch) {
    return { result: null, error: 'selection-not-found' }
  }

  const renderedAccidental =
    selection.keyIndex <= 0
      ? note.accidental ?? null
      : note.chordAccidentals?.[selection.keyIndex - 1] ?? null
  if (renderedAccidental === null) {
    return { result: null, error: 'no-op' }
  }

  const keyFifths = resolvePairKeyFifths(location.pairIndex, keyFifthsByMeasure)
  const accidentalStateBeforeNote = buildAccidentalStateBeforeNote(staffNotes, location.noteIndex, keyFifths)
  const pitchParts = getStepOctaveAlterFromPitch(sourcePitch)
  const naturalStaffPositionPitch = toPitchFromStepAlter(pitchParts.step, 0, pitchParts.octave)
  const targetPitch = getEffectivePitchForStaffPosition(
    naturalStaffPositionPitch,
    keyFifths,
    accidentalStateBeforeNote,
  )

  const expandedTargets = expandTargetsWithFullTieChain({
    pairs,
    sources: [
      {
        pairIndex: location.pairIndex,
        noteIndex: location.noteIndex,
        staff: location.staff,
        noteId: selection.noteId,
        keyIndex: selection.keyIndex,
        note,
        selection,
        sourcePitch,
        targetPitch,
      },
    ],
  })
  if (expandedTargets.length === 0) {
    return { result: null, error: 'no-op' }
  }

  const applied = applyPitchTargetsAndNormalize({
    pairs,
    expandedTargets,
    keyFifthsByMeasure,
  })
  if (applied.changedPairIndices.length === 0) {
    return { result: null, error: 'no-op' }
  }

  return {
    result: {
      nextPairs: applied.nextPairs,
      nextSelection: { ...selection },
      nextSelections: [{ ...selection }],
      changedPairIndices: applied.changedPairIndices,
    },
    error: null,
  }
}
