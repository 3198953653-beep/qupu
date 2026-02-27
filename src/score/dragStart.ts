import type { HitNote } from './layout/hitTest'
import type {
  DragState,
  ImportedNoteLocation,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Pitch,
  ScoreNote,
} from './types'

export function resolveCurrentNoteForHit(params: {
  hitLayout: NoteLayout
  importedPairs: MeasurePair[] | null
  importedNoteLookup: Map<string, ImportedNoteLocation>
  trebleNoteById: Map<string, ScoreNote>
  bassNoteById: Map<string, ScoreNote>
}): ScoreNote | undefined {
  const { hitLayout, importedPairs, importedNoteLookup, trebleNoteById, bassNoteById } = params
  let current: ScoreNote | undefined
  if (importedPairs) {
    const located = importedNoteLookup.get(hitLayout.id)
    if (located) {
      const pair = importedPairs[located.pairIndex]
      current = (located.staff === 'treble' ? pair?.treble : pair?.bass)?.[located.noteIndex]
    }
    if (!current) {
      const pair = importedPairs[hitLayout.pairIndex]
      current = (hitLayout.staff === 'treble' ? pair?.treble : pair?.bass)?.[hitLayout.noteIndex]
    }
  }
  if (!current) {
    current = hitLayout.staff === 'treble' ? trebleNoteById.get(hitLayout.id) : bassNoteById.get(hitLayout.id)
  }
  return current
}

export function resolveMeasureStaffNotesForHit(params: {
  hitLayout: NoteLayout
  importedPairs: MeasurePair[] | null
  currentMeasurePairs: MeasurePair[]
}): ScoreNote[] {
  const { hitLayout, importedPairs, currentMeasurePairs } = params
  const measurePair = (importedPairs ?? currentMeasurePairs)[hitLayout.pairIndex]
  return hitLayout.staff === 'treble' ? (measurePair?.treble ?? []) : (measurePair?.bass ?? [])
}

export function resolveKeyFifthsForPair(params: {
  pairIndex: number
  measureLayouts: Map<number, MeasureLayout>
  importedKeyFifths: number[] | null
}): number {
  const { pairIndex, measureLayouts, importedKeyFifths } = params
  return (
    measureLayouts.get(pairIndex)?.keyFifths ??
    importedKeyFifths?.[pairIndex] ??
    importedKeyFifths?.[pairIndex - 1] ??
    0
  )
}

export function createDragStateFromHit(params: {
  hit: HitNote
  pointerId: number
  surfaceTop: number
  surfaceClientToScoreScaleY: number
  startClientY: number
  pitch: Pitch
  grabOffsetY: number
  keyFifths: number
  accidentalStateBeforeNote: Map<string, number>
}): DragState {
  const {
    hit,
    pointerId,
    surfaceTop,
    surfaceClientToScoreScaleY,
    startClientY,
    pitch,
    grabOffsetY,
    keyFifths,
    accidentalStateBeforeNote,
  } = params
  return {
    noteId: hit.layout.id,
    staff: hit.layout.staff,
    keyIndex: hit.head.keyIndex,
    pairIndex: hit.layout.pairIndex,
    noteIndex: hit.layout.noteIndex,
    pointerId,
    surfaceTop,
    surfaceClientToScoreScaleY,
    startClientY,
    originPitch: pitch,
    pitch,
    previewStarted: false,
    grabOffsetY,
    pitchYMap: hit.layout.pitchYMap,
    keyFifths,
    accidentalStateBeforeNote,
    layoutCacheReady: false,
    staticNoteXById: new Map(),
    previewAccidentalRightXById: new Map(),
    debugStaticByNoteKey: new Map(),
  }
}
