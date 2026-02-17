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
import type { DragState, ImportedNoteLocation, MeasureLayout, MeasurePair, Pitch, ScoreNote, Selection } from './types'

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
  | { normalizedPairs: MeasurePair[]; fromImported: true }
  | { normalizedPairs: MeasurePair[]; trebleNotes: ScoreNote[]; bassNotes: ScoreNote[]; fromImported: false } {
  const { drag, pitch, importedPairs, importedNoteLookup, currentPairs, importedKeyFifths } = params

  if (importedPairs) {
    const location = importedNoteLookup.get(drag.noteId)
    const updated = location
      ? updateMeasurePairPitchAt(importedPairs, location, pitch, drag.keyIndex)
      : updateMeasurePairsPitch(importedPairs, drag.noteId, pitch, drag.keyIndex)
    const normalizeIndex = location?.pairIndex ?? drag.pairIndex
    const normalizedPairs = normalizeMeasurePairAt(updated, normalizeIndex, importedKeyFifths)
    return {
      normalizedPairs,
      fromImported: true,
    }
  }

  const updated = updateMeasurePairsPitch(currentPairs, drag.noteId, pitch, drag.keyIndex)
  const normalizedPairs = normalizeMeasurePairAt(updated, drag.pairIndex, null)
  return {
    normalizedPairs,
    trebleNotes: flattenTrebleFromPairs(normalizedPairs),
    bassNotes: flattenBassFromPairs(normalizedPairs),
    fromImported: false,
  }
}
