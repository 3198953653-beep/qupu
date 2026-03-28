import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ChordRulerEntry } from './chordRuler'
import type { DragState, ImportedNoteLocation, MeasurePair, MusicXmlMetadata, Selection, TimeSignature } from './types'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function clearImportedSourceState(params: {
  setMeasurePairsFromImport: StateSetter<MeasurePair[] | null>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  setMeasureKeyFifthsFromImport: StateSetter<number[] | null>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  setMeasureKeyModesFromImport: StateSetter<string[] | null>
  measureKeyModesFromImportRef: MutableRefObject<string[] | null>
  setMeasureDivisionsFromImport: StateSetter<number[] | null>
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  setMeasureTimeSignaturesFromImport: StateSetter<TimeSignature[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  setMusicXmlMetadataFromImport: StateSetter<MusicXmlMetadata | null>
  musicXmlMetadataFromImportRef: MutableRefObject<MusicXmlMetadata | null>
  setImportedChordRulerEntriesByPairFromImport?: StateSetter<ChordRulerEntry[][] | null>
  setImportedTimelineSegmentStartPairIndexesFromImport?: StateSetter<number[] | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  dragRef: MutableRefObject<DragState | null>
  clearDragOverlay: () => void
  setDraggingSelection?: StateSetter<Selection | null>
}): void {
  const {
    setMeasurePairsFromImport,
    measurePairsFromImportRef,
    setMeasureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    setMeasureKeyModesFromImport,
    measureKeyModesFromImportRef,
    setMeasureDivisionsFromImport,
    measureDivisionsFromImportRef,
    setMeasureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    setMusicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    setImportedChordRulerEntriesByPairFromImport,
    setImportedTimelineSegmentStartPairIndexesFromImport,
    importedNoteLookupRef,
    dragRef,
    clearDragOverlay,
    setDraggingSelection,
  } = params

  setMeasurePairsFromImport(null)
  measurePairsFromImportRef.current = null
  setMeasureKeyFifthsFromImport(null)
  measureKeyFifthsFromImportRef.current = null
  setMeasureKeyModesFromImport(null)
  measureKeyModesFromImportRef.current = null
  setMeasureDivisionsFromImport(null)
  measureDivisionsFromImportRef.current = null
  setMeasureTimeSignaturesFromImport(null)
  measureTimeSignaturesFromImportRef.current = null
  setMusicXmlMetadataFromImport(null)
  musicXmlMetadataFromImportRef.current = null
  setImportedChordRulerEntriesByPairFromImport?.(null)
  setImportedTimelineSegmentStartPairIndexesFromImport?.(null)
  importedNoteLookupRef.current.clear()
  dragRef.current = null
  clearDragOverlay()
  setDraggingSelection?.(null)
}
