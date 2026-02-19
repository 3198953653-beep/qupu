import {
  buildAccidentalStateBeforeNote,
  getEffectivePitchForStaffPosition,
  isSameStaffPositionPitch,
  normalizeMeasurePairAt,
} from './accidentals'
import { createDragStateFromHit, resolveCurrentNoteForHit, resolveKeyFifthsForPair, resolveMeasureStaffNotesForHit } from './dragStart'
import { getNearestPitchByY } from './pitchUtils'
import { flattenBassFromPairs, flattenTrebleFromPairs, updateMeasurePairPitchAt, updateMeasurePairsPitch } from './scoreOps'
import type { HitNote } from './layout/hitTest'
import type { DragState, ImportedNoteLocation, LayoutReflowHint, MeasureLayout, MeasurePair, Pitch, ScoreNote, Selection } from './types'

function normalizeAccidentalSymbol(accidental: string | null | undefined): string {
  return accidental ?? ''
}

function buildStaffAccidentalLayoutSignature(notes: ScoreNote[]): string {
  return notes
    .map((note, noteIndex) => {
      const root = normalizeAccidentalSymbol(note.accidental)
      const chord = note.chordPitches?.map((_, chordIndex) => normalizeAccidentalSymbol(note.chordAccidentals?.[chordIndex])).join(',') ?? ''
      return `${noteIndex}:${root}|${chord}`
    })
    .join(';')
}

function hasMeasureAccidentalLayoutChanged(beforePair: MeasurePair | undefined, afterPair: MeasurePair | undefined): boolean {
  if (!beforePair || !afterPair) return true
  const beforeTreble = buildStaffAccidentalLayoutSignature(beforePair.treble)
  const afterTreble = buildStaffAccidentalLayoutSignature(afterPair.treble)
  if (beforeTreble !== afterTreble) return true
  const beforeBass = buildStaffAccidentalLayoutSignature(beforePair.bass)
  const afterBass = buildStaffAccidentalLayoutSignature(afterPair.bass)
  return beforeBass !== afterBass
}

function buildLayoutReflowHint(params: {
  pairIndex: number
  sourcePairs: MeasurePair[]
  normalizedPairs: MeasurePair[]
}): LayoutReflowHint {
  const { pairIndex, sourcePairs, normalizedPairs } = params
  const accidentalLayoutChanged = hasMeasureAccidentalLayoutChanged(sourcePairs[pairIndex], normalizedPairs[pairIndex])
  return {
    pairIndex,
    scoreContentChanged: normalizedPairs !== sourcePairs,
    accidentalLayoutChanged,
    shouldReflow: accidentalLayoutChanged,
  }
}

export function buildDragStateForHit(params: {
  hit: HitNote
  pointerId: number
  surfaceTop: number
  surfaceClientToScoreScaleY: number
  startClientY: number
  localPointerY: number
  importedPairs: MeasurePair[] | null
  importedNoteLookup: Map<string, ImportedNoteLocation>
  trebleNoteById: Map<string, ScoreNote>
  bassNoteById: Map<string, ScoreNote>
  currentMeasurePairs: MeasurePair[]
  measureLayouts: Map<number, MeasureLayout>
  importedKeyFifths: number[] | null
  pitches: Pitch[]
}): { dragState: DragState; selection: Selection } {
  const {
    hit,
    pointerId,
    surfaceTop,
    surfaceClientToScoreScaleY,
    startClientY,
    localPointerY,
    importedPairs,
    importedNoteLookup,
    trebleNoteById,
    bassNoteById,
    currentMeasurePairs,
    measureLayouts,
    importedKeyFifths,
    pitches,
  } = params
  const hitNote = hit.layout
  const hitHead = hit.head

  const current = resolveCurrentNoteForHit({
    hitLayout: hitNote,
    importedPairs,
    importedNoteLookup,
    trebleNoteById,
    bassNoteById,
  })
  const measureStaffNotes = resolveMeasureStaffNotesForHit({
    hitLayout: hitNote,
    importedPairs,
    currentMeasurePairs,
  })
  const keyFifths = resolveKeyFifthsForPair({
    pairIndex: hitNote.pairIndex,
    measureLayouts,
    importedKeyFifths,
  })
  const accidentalStateBeforeNote = buildAccidentalStateBeforeNote(measureStaffNotes, hitNote.noteIndex, keyFifths)
  const noteCenterY = hitHead.y
  const grabOffsetY = localPointerY - noteCenterY
  const hitKeyIndex = hitHead.keyIndex
  const currentPitch = current && hitKeyIndex > 0 ? current.chordPitches?.[hitKeyIndex - 1] ?? current.pitch : current?.pitch
  const pitch = currentPitch ?? hitHead.pitch ?? getNearestPitchByY(noteCenterY, hitNote.pitchYMap, pitches)

  const dragState: DragState = createDragStateFromHit({
    hit,
    pointerId,
    surfaceTop,
    surfaceClientToScoreScaleY,
    startClientY,
    pitch,
    grabOffsetY,
    keyFifths,
    accidentalStateBeforeNote,
  })

  return {
    dragState,
    selection: { noteId: hitNote.id, staff: hitNote.staff, keyIndex: hitKeyIndex },
  }
}

export function getDragMovePitch(params: { drag: DragState; clientY: number; pitches: Pitch[] }): Pitch {
  const { drag, clientY, pitches } = params
  const y = (clientY - drag.surfaceTop) * drag.surfaceClientToScoreScaleY
  const targetY = y - drag.grabOffsetY
  const staffPositionPitch = getNearestPitchByY(targetY, drag.pitchYMap, pitches, drag.pitch)
  if (isSameStaffPositionPitch(staffPositionPitch, drag.pitch)) {
    return drag.pitch
  }
  return getEffectivePitchForStaffPosition(staffPositionPitch, drag.keyFifths, drag.accidentalStateBeforeNote)
}

export function commitDragPitchToScoreData(params: {
  drag: DragState
  pitch: Pitch
  importedPairs: MeasurePair[] | null
  importedNoteLookup: Map<string, ImportedNoteLocation>
  currentPairs: MeasurePair[]
  importedKeyFifths: number[] | null
}):
  | { normalizedPairs: MeasurePair[]; fromImported: true; layoutReflowHint: LayoutReflowHint }
  | { normalizedPairs: MeasurePair[]; trebleNotes: ScoreNote[]; bassNotes: ScoreNote[]; fromImported: false; layoutReflowHint: LayoutReflowHint } {
  const { drag, pitch, importedPairs, importedNoteLookup, currentPairs, importedKeyFifths } = params

  if (importedPairs) {
    const sourcePairs = importedPairs
    const location = importedNoteLookup.get(drag.noteId)
    const updated = location
      ? updateMeasurePairPitchAt(sourcePairs, location, pitch, drag.keyIndex)
      : updateMeasurePairsPitch(sourcePairs, drag.noteId, pitch, drag.keyIndex)
    const normalizeIndex = location?.pairIndex ?? drag.pairIndex
    const normalizedPairs = normalizeMeasurePairAt(updated, normalizeIndex, importedKeyFifths)
    return {
      normalizedPairs,
      fromImported: true,
      layoutReflowHint: buildLayoutReflowHint({
        pairIndex: normalizeIndex,
        sourcePairs,
        normalizedPairs,
      }),
    }
  }

  const sourcePairs = currentPairs
  const updated = updateMeasurePairsPitch(sourcePairs, drag.noteId, pitch, drag.keyIndex)
  const normalizedPairs = normalizeMeasurePairAt(updated, drag.pairIndex, null)
  return {
    normalizedPairs,
    trebleNotes: flattenTrebleFromPairs(normalizedPairs),
    bassNotes: flattenBassFromPairs(normalizedPairs),
    fromImported: false,
    layoutReflowHint: buildLayoutReflowHint({
      pairIndex: drag.pairIndex,
      sourcePairs,
      normalizedPairs,
    }),
  }
}
