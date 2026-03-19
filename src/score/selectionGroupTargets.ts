import { buildAccidentalStateBeforeNote } from './accidentals'
import { resolveKeyFifthsForPair } from './dragStart'
import { resolveForwardTieTargets } from './tieChain'
import type {
  DragTieTarget,
  ImportedNoteLocation,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Pitch,
  ScoreNote,
  Selection,
} from './types'

function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}

function getSelectedPitch(note: ScoreNote | undefined, keyIndex: number): Pitch | null {
  if (!note || note.isRest) return null
  if (keyIndex <= 0) return note.pitch
  return note.chordPitches?.[keyIndex - 1] ?? null
}

function resolveSelectionLocationInPairs(
  pairs: MeasurePair[],
  selection: Selection,
  importedNoteLookup: Map<string, ImportedNoteLocation>,
): { pairIndex: number; noteIndex: number; staff: Selection['staff'] } | null {
  const imported = importedNoteLookup.get(selection.noteId)
  if (imported) {
    const pair = pairs[imported.pairIndex]
    const note = imported.staff === 'treble' ? pair?.treble[imported.noteIndex] : pair?.bass[imported.noteIndex]
    if (note?.id === selection.noteId) {
      return { pairIndex: imported.pairIndex, noteIndex: imported.noteIndex, staff: imported.staff }
    }
  }

  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    const pair = pairs[pairIndex]
    const notes = selection.staff === 'treble' ? pair.treble : pair.bass
    const noteIndex = notes.findIndex((note) => note.id === selection.noteId)
    if (noteIndex >= 0) {
      return { pairIndex, noteIndex, staff: selection.staff }
    }
  }
  return null
}

function buildPreviewTargetForSelection(params: {
  selection: Selection
  measurePairs: MeasurePair[]
  importedNoteLookup: Map<string, ImportedNoteLocation>
  measureLayouts: Map<number, MeasureLayout>
  importedKeyFifths: number[] | null
}): DragTieTarget | null {
  const {
    selection,
    measurePairs,
    importedNoteLookup,
    measureLayouts,
    importedKeyFifths,
  } = params
  const location = resolveSelectionLocationInPairs(measurePairs, selection, importedNoteLookup)
  if (!location) return null
  const pair = measurePairs[location.pairIndex]
  const notes = location.staff === 'treble' ? pair?.treble : pair?.bass
  const note = notes?.[location.noteIndex]
  const pitch = getSelectedPitch(note, selection.keyIndex)
  if (!note || !pitch) return null

  const contextKeyFifths = resolveKeyFifthsForPair({
    pairIndex: location.pairIndex,
    measureLayouts,
    importedKeyFifths,
  })
  const contextAccidentalStateBeforeNote =
    notes && note.id === selection.noteId
      ? buildAccidentalStateBeforeNote(notes, location.noteIndex, contextKeyFifths)
      : new Map<string, number>()

  return {
    pairIndex: location.pairIndex,
    noteIndex: location.noteIndex,
    staff: selection.staff,
    noteId: note.id,
    keyIndex: selection.keyIndex,
    pitch,
    contextKeyFifths,
    contextAccidentalStateBeforeNote,
  }
}

function resolveSelectionHeadX(params: {
  selection: Selection
  target: DragTieTarget
  noteLayouts: NoteLayout[]
}): number {
  const { selection, target, noteLayouts } = params
  const layout =
    noteLayouts.find(
      (item) =>
        item.id === target.noteId &&
        item.staff === target.staff &&
        item.pairIndex === target.pairIndex &&
        item.noteIndex === target.noteIndex,
    ) ??
    noteLayouts.find((item) => item.id === selection.noteId && item.staff === selection.staff) ??
    null
  if (!layout) return Number.POSITIVE_INFINITY
  const head =
    layout.noteHeads.find((item) => item.keyIndex === selection.keyIndex) ??
    layout.noteHeads[0] ??
    null
  return head?.x ?? layout.x
}

export function buildSelectionPreviewLeadTarget(params: {
  effectiveSelections: Selection[]
  primarySelection: Selection
  noteLayouts: NoteLayout[]
  measurePairs: MeasurePair[]
  importedNoteLookup: Map<string, ImportedNoteLocation>
  measureLayouts: Map<number, MeasureLayout>
  importedKeyFifths: number[] | null
}): DragTieTarget | null {
  const {
    effectiveSelections,
    primarySelection,
    noteLayouts,
    measurePairs,
    importedNoteLookup,
    measureLayouts,
    importedKeyFifths,
  } = params

  const candidates = effectiveSelections
    .map((selection) => {
      const target = buildPreviewTargetForSelection({
        selection,
        measurePairs,
        importedNoteLookup,
        measureLayouts,
        importedKeyFifths,
      })
      if (!target) return null
      return {
        selection,
        target,
        headX: resolveSelectionHeadX({ selection, target, noteLayouts }),
      }
    })
    .filter((candidate): candidate is { selection: Selection; target: DragTieTarget; headX: number } => candidate !== null)

  const fallbackTarget = buildPreviewTargetForSelection({
    selection: primarySelection,
    measurePairs,
    importedNoteLookup,
    measureLayouts,
    importedKeyFifths,
  })
  if (candidates.length === 0) return fallbackTarget

  candidates.sort((left, right) => {
    if (left.headX !== right.headX) return left.headX - right.headX
    if (left.selection.staff !== right.selection.staff) {
      return left.selection.staff === 'treble' ? -1 : 1
    }
    if (left.target.pairIndex !== right.target.pairIndex) return left.target.pairIndex - right.target.pairIndex
    if (left.target.noteIndex !== right.target.noteIndex) return left.target.noteIndex - right.target.noteIndex
    if (left.selection.keyIndex !== right.selection.keyIndex) return left.selection.keyIndex - right.selection.keyIndex
    return left.selection.noteId.localeCompare(right.selection.noteId)
  })

  return candidates[0]?.target ?? fallbackTarget
}

export function buildSelectionGroupMoveTargets(params: {
  effectiveSelections: Selection[]
  primarySelection: Selection
  measurePairs: MeasurePair[]
  importedNoteLookup: Map<string, ImportedNoteLocation>
  measureLayouts: Map<number, MeasureLayout>
  importedKeyFifths: number[] | null
}): DragTieTarget[] {
  const {
    effectiveSelections,
    primarySelection,
    measurePairs,
    importedNoteLookup,
    measureLayouts,
    importedKeyFifths,
  } = params
  if (effectiveSelections.length <= 1) return []

  const targets: DragTieTarget[] = []
  const seen = new Set<string>()
  const makeTargetKey = (target: DragTieTarget): string =>
    `${target.staff}:${target.pairIndex}:${target.noteIndex}:${target.noteId}:${target.keyIndex}`

  effectiveSelections.forEach((selection) => {
    if (isSameSelection(selection, primarySelection)) return
    const location = resolveSelectionLocationInPairs(measurePairs, selection, importedNoteLookup)
    if (!location) return
    const pair = measurePairs[location.pairIndex]
    const notes = location.staff === 'treble' ? pair?.treble : pair?.bass
    const note = notes?.[location.noteIndex]
    const pitch = getSelectedPitch(note, selection.keyIndex)
    if (!note || !pitch) return

    const tieTargets = resolveForwardTieTargets({
      measurePairs,
      pairIndex: location.pairIndex,
      noteIndex: location.noteIndex,
      keyIndex: selection.keyIndex,
      staff: selection.staff,
      pitchHint: pitch,
    })
    const normalizedTargets = tieTargets.length > 0
      ? tieTargets
      : [{
          pairIndex: location.pairIndex,
          noteIndex: location.noteIndex,
          staff: selection.staff,
          noteId: selection.noteId,
          keyIndex: selection.keyIndex,
          pitch,
        }]

    normalizedTargets.forEach((target) => {
      const key = makeTargetKey(target)
      if (seen.has(key)) return
      const targetPair = measurePairs[target.pairIndex]
      const targetStaffNotes = target.staff === 'treble' ? targetPair?.treble : targetPair?.bass
      const targetNote = targetStaffNotes?.[target.noteIndex]
      const contextKeyFifths = resolveKeyFifthsForPair({
        pairIndex: target.pairIndex,
        measureLayouts,
        importedKeyFifths,
      })
      const contextAccidentalStateBeforeNote =
        targetStaffNotes && targetNote?.id === target.noteId
          ? buildAccidentalStateBeforeNote(targetStaffNotes, target.noteIndex, contextKeyFifths)
          : new Map<string, number>()
      seen.add(key)
      targets.push({
        ...target,
        contextKeyFifths,
        contextAccidentalStateBeforeNote,
      })
    })
  })

  return targets
}
