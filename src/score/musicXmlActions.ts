import { startTransition, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import MusicXmlImportWorker from './musicXmlImport.worker?worker'
import { collectFullMeasureRestCollapseScopeKeys } from './fullMeasureRestCollapse'
import { buildMusicXmlFromMeasurePairs, parseMusicXml } from './musicXml'
import type { ChordRulerEntry } from './chordRuler'
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
type WorkerParseRequest = {
  id: number
  xmlText: string
}
type WorkerParseResponse =
  | {
      id: number
      ok: true
      result: ImportResult
    }
  | {
      id: number
      ok: false
      error: string
    }

let musicXmlImportWorker: Worker | null = null
let musicXmlImportWorkerBroken = false
let musicXmlImportWorkerRequestSeq = 0
const musicXmlImportWorkerPending = new Map<number, { resolve: (result: ImportResult) => void; reject: (error: Error) => void }>()

function handleWorkerFatalError(message: string): void {
  musicXmlImportWorkerBroken = true
  const worker = musicXmlImportWorker
  musicXmlImportWorker = null
  if (worker) {
    worker.terminate()
  }
  musicXmlImportWorkerPending.forEach(({ reject }) => reject(new Error(message)))
  musicXmlImportWorkerPending.clear()
}

function ensureMusicXmlImportWorker(): Worker | null {
  if (musicXmlImportWorkerBroken || typeof Worker === 'undefined') {
    return null
  }
  if (musicXmlImportWorker) {
    return musicXmlImportWorker
  }

  try {
    const worker = new MusicXmlImportWorker()
    worker.onmessage = (event: MessageEvent<WorkerParseResponse>) => {
      const payload = event.data
      const pending = musicXmlImportWorkerPending.get(payload.id)
      if (!pending) return
      musicXmlImportWorkerPending.delete(payload.id)
      if (payload.ok) {
        pending.resolve(payload.result)
      } else {
        pending.reject(new Error(payload.error))
      }
    }
    worker.onmessageerror = () => {
      handleWorkerFatalError('乐谱后台线程消息解析失败。')
    }
    worker.onerror = () => {
      handleWorkerFatalError('乐谱后台线程执行失败。')
    }
    musicXmlImportWorker = worker
    return worker
  } catch {
    musicXmlImportWorkerBroken = true
    return null
  }
}

function disableMusicXmlImportWorker(): void {
  musicXmlImportWorkerBroken = true
  const worker = musicXmlImportWorker
  musicXmlImportWorker = null
  if (worker) {
    worker.terminate()
  }
}

function parseMusicXmlOnMainThreadAsync(xmlText: string): Promise<ImportResult> {
  return new Promise<ImportResult>((resolve, reject) => {
    window.setTimeout(() => {
      try {
        resolve(parseMusicXml(xmlText))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('导入乐谱失败。'))
      }
    }, 0)
  })
}

function isWorkerDomParserUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('domparser is unavailable in worker') || message.includes('domparser is not defined')
}

function parseMusicXmlInWorker(xmlText: string): Promise<ImportResult> {
  // Speed-first mode: prefer native main-thread DOMParser when available.
  // In many environments this is much faster than worker + JS polyfill parser.
  if (typeof DOMParser !== 'undefined') {
    return parseMusicXmlOnMainThreadAsync(xmlText)
  }

  const worker = ensureMusicXmlImportWorker()
  if (!worker) {
    return parseMusicXmlOnMainThreadAsync(xmlText)
  }

  const id = ++musicXmlImportWorkerRequestSeq
  return new Promise<ImportResult>((resolve, reject) => {
    musicXmlImportWorkerPending.set(id, { resolve, reject })
    const message: WorkerParseRequest = { id, xmlText }
    worker.postMessage(message)
  }).catch((error: unknown) => {
    if (!isWorkerDomParserUnavailableError(error)) {
      throw error
    }
    disableMusicXmlImportWorker()
    return parseMusicXmlOnMainThreadAsync(xmlText)
  })
}

function sanitizeFileName(name: string): string {
  const withoutReservedChars = name.replace(/[<>:"/\\|?*]/g, '_')
  let sanitized = ''
  for (const char of withoutReservedChars) {
    sanitized += char.charCodeAt(0) < 32 ? '_' : char
  }
  return sanitized || 'score'
}

function estimateMeasureCount(xmlText: string): number {
  const matches = xmlText.match(/<measure\b/gi)
  return matches ? matches.length : 0
}

function buildImportSuccessMessage(imported: ImportResult): string {
  return `导入成功：${imported.measurePairs.length} 个小节，高音 ${imported.trebleNotes.length} 个音符，低音 ${imported.bassNotes.length} 个音符。`
}

function scheduleAfterNextPaint(task: () => void): void {
  if (typeof window === 'undefined') {
    task()
    return
  }
  const raf = window.requestAnimationFrame?.bind(window)
  if (!raf) {
    window.setTimeout(task, 16)
    return
  }
  raf(() => {
    raf(() => {
      task()
    })
  })
}

export function applyImportedScoreState(params: {
  result: ImportResult
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
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
  setImportedChordRulerEntriesByPairFromImport: StateSetter<ChordRulerEntry[][] | null>
  setImportedTimelineSegmentStartPairIndexesFromImport: StateSetter<number[] | null>
  setFullMeasureRestCollapseScopeKeys: StateSetter<string[]>
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
    setFullMeasureRestCollapseScopeKeys,
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
  setMeasureKeyModesFromImport(result.measureKeyModes)
  measureKeyModesFromImportRef.current = result.measureKeyModes
  setMeasureDivisionsFromImport(result.measureDivisions)
  measureDivisionsFromImportRef.current = result.measureDivisions
  setMeasureTimeSignaturesFromImport(result.measureTimeSignatures)
  measureTimeSignaturesFromImportRef.current = result.measureTimeSignatures
  setMusicXmlMetadataFromImport(result.metadata)
  musicXmlMetadataFromImportRef.current = result.metadata
  setImportedChordRulerEntriesByPairFromImport(result.importedChordRulerEntriesByPair ?? null)
  setImportedTimelineSegmentStartPairIndexesFromImport(result.importedTimelineSegmentStartPairIndexes ?? null)
  setFullMeasureRestCollapseScopeKeys(
    collectFullMeasureRestCollapseScopeKeys({
      measurePairs: result.measurePairs,
      timeSignaturesByMeasure: result.measureTimeSignatures,
    }),
  )
  importedNoteLookupRef.current = result.importedNoteLookup ?? buildImportedNoteLookup(result.measurePairs)
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
  isRequestLatest?: () => boolean
}): void {
  const {
    xmlText,
    setIsRhythmLinked,
    applyImportedScore,
    setImportFeedback,
    isRequestLatest,
  } = params
  const content = xmlText.trim()
  if (!content) {
    setImportFeedback({ kind: 'error', message: '请先粘贴乐谱文本，再执行导入。' })
    return
  }
  const requestIsLatest = isRequestLatest ?? (() => true)
  const setLoadingFeedback = (message: string, progress: number) => {
    if (!requestIsLatest()) return
    setImportFeedback({ kind: 'loading', message, progress: Math.max(0, Math.min(100, Math.round(progress))) })
  }

  try {
    const estimatedMeasureCount = estimateMeasureCount(content)
    flushSync(() => {
      setImportFeedback({
        kind: 'loading',
        message: `正在加载 ${estimatedMeasureCount > 0 ? `${estimatedMeasureCount} 个小节` : '乐谱'}...`,
        progress: 10,
      })
    })

    const runFullImport = () => {
      if (!requestIsLatest()) return
      setLoadingFeedback('正在解析完整乐谱...', 45)
      const parseStartAt = typeof performance !== 'undefined' ? performance.now() : 0
      void parseMusicXmlInWorker(content)
        .then((imported) => {
          if (!requestIsLatest()) return
          const parseDurationMs = typeof performance !== 'undefined' ? performance.now() - parseStartAt : 0
          setLoadingFeedback('正在应用乐谱...', 88)
          const applyStartAt = typeof performance !== 'undefined' ? performance.now() : 0
          startTransition(() => {
            setIsRhythmLinked(false)
            applyImportedScore(imported)
            setImportFeedback({
              kind: 'success',
              message: buildImportSuccessMessage(imported),
              progress: 100,
            })
          })
          if (typeof window !== 'undefined' && typeof performance !== 'undefined') {
            window.requestAnimationFrame(() => {
              const applyToPaintMs = performance.now() - applyStartAt
              console.info(
                `[import] parse=${parseDurationMs.toFixed(1)}ms, apply+paint=${applyToPaintMs.toFixed(1)}ms, measures=${imported.measurePairs.length}`,
              )
            })
          }
        })
        .catch((error) => {
          if (!requestIsLatest()) return
          const message = error instanceof Error ? error.message : '导入乐谱失败。'
          setImportFeedback({ kind: 'error', message })
        })
    }

    scheduleAfterNextPaint(runFullImport)
  } catch (error) {
    if (!requestIsLatest()) return
    const message = error instanceof Error ? error.message : '导入乐谱失败。'
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
