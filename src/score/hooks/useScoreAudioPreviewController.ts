import { useCallback, useRef, type MutableRefObject } from 'react'
import { findSelectionLocationInPairs } from '../keyboardEdits'
import { previewScoreNote, resolveScoreNotePreviewPitch, type PlaybackSynth, type ScoreNotePreviewMode } from '../notePreview'
import type { ImportedNoteLocation, MeasurePair, Pitch, ScoreNote, Selection } from '../types'

export type NotePreviewDebugEvent = {
  sequence: number
  atMs: number
  noteId: string
  keyIndex: number
  mode: ScoreNotePreviewMode
  pitch: Pitch
}

export function useScoreAudioPreviewController(params: {
  synthRef: MutableRefObject<PlaybackSynth | null>
}): {
  notePreviewEventsRef: MutableRefObject<NotePreviewDebugEvent[]>
  handlePreviewScoreNote: (params: {
    note: ScoreNote
    keyIndex: number
    mode: ScoreNotePreviewMode
    targetPitch?: Pitch | null
  }) => void
  playAccidentalEditPreview: (params: {
    pairs: MeasurePair[]
    previewSelection: Selection | null
    previewPitch: Pitch | null
    importedNoteLookup?: Map<string, ImportedNoteLocation> | null
  }) => void
} {
  const { synthRef } = params
  const notePreviewEventsRef = useRef<NotePreviewDebugEvent[]>([])
  const notePreviewSequenceRef = useRef(0)

  const handlePreviewScoreNote = useCallback((previewParams: {
    note: ScoreNote
    keyIndex: number
    mode: ScoreNotePreviewMode
    targetPitch?: Pitch | null
  }) => {
    const { note, keyIndex, mode, targetPitch = null } = previewParams
    const resolvedPitch = resolveScoreNotePreviewPitch({
      note,
      keyIndex,
      targetPitch,
    })
    if (!resolvedPitch) return

    notePreviewSequenceRef.current += 1
    notePreviewEventsRef.current.push({
      sequence: notePreviewSequenceRef.current,
      atMs: Date.now(),
      noteId: note.id,
      keyIndex,
      mode,
      pitch: resolvedPitch,
    })
    if (notePreviewEventsRef.current.length > 240) {
      notePreviewEventsRef.current.splice(0, notePreviewEventsRef.current.length - 240)
    }

    void previewScoreNote({
      synth: synthRef.current,
      note,
      keyIndex,
      mode,
      targetPitch,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[audio] 音符试听失败：${message}`)
    })
  }, [synthRef])

  const playAccidentalEditPreview = useCallback((previewParams: {
    pairs: MeasurePair[]
    previewSelection: Selection | null
    previewPitch: Pitch | null
    importedNoteLookup?: Map<string, ImportedNoteLocation> | null
  }) => {
    const {
      pairs,
      previewSelection,
      previewPitch,
      importedNoteLookup = null,
    } = previewParams
    if (!previewSelection || !previewPitch) return

    const selectionLocation = findSelectionLocationInPairs({
      pairs,
      selection: previewSelection,
      importedNoteLookup,
    })
    if (!selectionLocation) return

    const sourcePair = pairs[selectionLocation.pairIndex]
    if (!sourcePair) return

    const staffNotes = selectionLocation.staff === 'treble' ? sourcePair.treble : sourcePair.bass
    const sourceNote = staffNotes[selectionLocation.noteIndex]
    if (!sourceNote || sourceNote.id !== previewSelection.noteId || sourceNote.isRest) return

    handlePreviewScoreNote({
      note: sourceNote,
      keyIndex: previewSelection.keyIndex,
      mode: 'click',
      targetPitch: previewPitch,
    })
  }, [handlePreviewScoreNote])

  return {
    notePreviewEventsRef,
    handlePreviewScoreNote,
    playAccidentalEditPreview,
  }
}
