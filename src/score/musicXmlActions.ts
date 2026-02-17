import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { buildMusicXmlFromMeasurePairs, parseMusicXml } from './musicXml'
import { buildImportedNoteLookup } from './scoreOps'
import type {
  DragState,
  ImportFeedback,
  ImportResult,
  ImportedNoteLocation,
  MeasurePair,
  MusicXmlMetadata,
  ScoreNote,
  Selection,
  TimeSignature,
} from './types'

type StateSetter<T> = Dispatch<SetStateAction<T>>

function sanitizeFileName(name: string): string {
  const withoutReservedChars = name.replace(/[<>:"/\\|?*]/g, '_')
  let sanitized = ''
  for (const char of withoutReservedChars) {
    sanitized += char.charCodeAt(0) < 32 ? '_' : char
  }
  return sanitized || 'score'
}

export function applyImportedScoreState(params: {
  result: ImportResult
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setMeasurePairsFromImport: StateSetter<MeasurePair[] | null>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  setMeasureKeyFifthsFromImport: StateSetter<number[] | null>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  setMeasureDivisionsFromImport: StateSetter<number[] | null>
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  setMeasureTimeSignaturesFromImport: StateSetter<TimeSignature[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  setMusicXmlMetadataFromImport: StateSetter<MusicXmlMetadata | null>
  musicXmlMetadataFromImportRef: MutableRefObject<MusicXmlMetadata | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  dragRef: MutableRefObject<DragState | null>
  clearDragOverlay: () => void
  setDraggingSelection: StateSetter<Selection | null>
  setActiveSelection: StateSetter<Selection>
}): void {
  const {
    result,
    setNotes,
    setBassNotes,
    setMeasurePairsFromImport,
    measurePairsFromImportRef,
    setMeasureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    setMeasureDivisionsFromImport,
    measureDivisionsFromImportRef,
    setMeasureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    setMusicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    dragRef,
    clearDragOverlay,
    setDraggingSelection,
    setActiveSelection,
  } = params

  setNotes(result.trebleNotes)
  setBassNotes(result.bassNotes)
  setMeasurePairsFromImport(result.measurePairs)
  measurePairsFromImportRef.current = result.measurePairs
  setMeasureKeyFifthsFromImport(result.measureKeyFifths)
  measureKeyFifthsFromImportRef.current = result.measureKeyFifths
  setMeasureDivisionsFromImport(result.measureDivisions)
  measureDivisionsFromImportRef.current = result.measureDivisions
  setMeasureTimeSignaturesFromImport(result.measureTimeSignatures)
  measureTimeSignaturesFromImportRef.current = result.measureTimeSignatures
  setMusicXmlMetadataFromImport(result.metadata)
  musicXmlMetadataFromImportRef.current = result.metadata
  importedNoteLookupRef.current = buildImportedNoteLookup(result.measurePairs)
  dragRef.current = null
  clearDragOverlay()
  setDraggingSelection(null)

  if (result.trebleNotes[0]) {
    setActiveSelection({ noteId: result.trebleNotes[0].id, staff: 'treble', keyIndex: 0 })
    return
  }
  if (result.bassNotes[0]) {
    setActiveSelection({ noteId: result.bassNotes[0].id, staff: 'bass', keyIndex: 0 })
  }
}

export function importMusicXmlTextAndApply(params: {
  xmlText: string
  setIsRhythmLinked: StateSetter<boolean>
  applyImportedScore: (result: ImportResult) => void
  setImportFeedback: StateSetter<ImportFeedback>
}): void {
  const { xmlText, setIsRhythmLinked, applyImportedScore, setImportFeedback } = params
  const content = xmlText.trim()
  if (!content) {
    setImportFeedback({ kind: 'error', message: 'Paste MusicXML text first, then import.' })
    return
  }

  try {
    const imported = parseMusicXml(content)
    setIsRhythmLinked(false)
    applyImportedScore(imported)
    setImportFeedback({
      kind: 'success',
      message: `Imported ${imported.measurePairs.length} measures: treble ${imported.trebleNotes.length} notes, bass ${imported.bassNotes.length} notes.`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import MusicXML.'
    setImportFeedback({ kind: 'error', message })
  }
}

export function buildMusicXmlExportPayload(params: {
  measurePairs: MeasurePair[]
  keyFifthsByMeasure: number[] | null
  divisionsByMeasure: number[] | null
  timeSignaturesByMeasure: TimeSignature[] | null
  metadata: MusicXmlMetadata | null
}): { xmlText: string; safeName: string } {
  const { measurePairs, keyFifthsByMeasure, divisionsByMeasure, timeSignaturesByMeasure, metadata } = params
  const xmlText = buildMusicXmlFromMeasurePairs({
    measurePairs,
    keyFifthsByMeasure,
    divisionsByMeasure,
    timeSignaturesByMeasure,
    metadata,
  })

  const title = metadata?.workTitle?.trim() || 'score'
  const safeName = sanitizeFileName(title)
  return { xmlText, safeName }
}
