import { startTransition, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import MusicXmlImportWorker from './musicXmlImport.worker?worker'
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
      handleWorkerFatalError('MusicXML worker message decoding failed.')
    }
    worker.onerror = () => {
      handleWorkerFatalError('MusicXML worker failed.')
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
    const run = () => {
      try {
        resolve(parseMusicXml(xmlText))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Failed to import MusicXML.'))
      }
    }

    if (typeof window === 'undefined') {
      run()
      return
    }

    const requestIdle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number })
      .requestIdleCallback
    if (typeof requestIdle === 'function') {
      requestIdle(run, { timeout: 250 })
      return
    }
    window.setTimeout(run, 16)
  })
}

function isWorkerDomParserUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('domparser is unavailable in worker') || message.includes('domparser is not defined')
}

function parseMusicXmlInWorker(xmlText: string): Promise<ImportResult> {
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
  return `Imported ${imported.measurePairs.length} measures: treble ${imported.trebleNotes.length} notes, bass ${imported.bassNotes.length} notes.`
}

type UserInteractionTracker = {
  isIdle: (idleMs: number) => boolean
  dispose: () => void
}

function createUserInteractionTracker(): UserInteractionTracker {
  if (typeof window === 'undefined') {
    return {
      isIdle: () => true,
      dispose: () => {},
    }
  }

  let lastInputAt = performance.now()
  const markInput = () => {
    lastInputAt = performance.now()
  }
  const eventNames: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']
  eventNames.forEach((name) => {
    window.addEventListener(name, markInput, { passive: true })
  })

  return {
    isIdle: (idleMs: number) => performance.now() - lastInputAt >= idleMs,
    dispose: () => {
      eventNames.forEach((name) => {
        window.removeEventListener(name, markInput)
      })
    },
  }
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
  previewMeasureLimit?: number
  isRequestLatest?: () => boolean
  canApplyBackgroundResult?: () => boolean
}): void {
  const {
    xmlText,
    setIsRhythmLinked,
    applyImportedScore,
    setImportFeedback,
    previewMeasureLimit: rawPreviewMeasureLimit,
    isRequestLatest,
    canApplyBackgroundResult,
  } = params
  const content = xmlText.trim()
  if (!content) {
    setImportFeedback({ kind: 'error', message: 'Paste MusicXML text first, then import.' })
    return
  }
  const previewMeasureLimit =
    typeof rawPreviewMeasureLimit === 'number' && Number.isFinite(rawPreviewMeasureLimit) && rawPreviewMeasureLimit > 0
      ? Math.max(1, Math.trunc(rawPreviewMeasureLimit))
      : 0
  const requestIsLatest = isRequestLatest ?? (() => true)
  const canApplyResult = canApplyBackgroundResult ?? (() => true)
  const interactionTracker = createUserInteractionTracker()
  const releaseInteractionTracker = () => {
    interactionTracker.dispose()
  }
  const canRunBackgroundApply = () => canApplyResult() && interactionTracker.isIdle(500)
  const setLoadingFeedback = (message: string, progress: number) => {
    if (!requestIsLatest()) return
    setImportFeedback({ kind: 'loading', message, progress: Math.max(0, Math.min(100, Math.round(progress))) })
  }

  try {
    const estimatedMeasureCount = estimateMeasureCount(content)
    setLoadingFeedback('Preparing import...', 6)
    const usePreviewImport = previewMeasureLimit > 0 && estimatedMeasureCount > previewMeasureLimit

    if (!usePreviewImport) {
      setLoadingFeedback('Parsing score...', 35)
      const imported = parseMusicXml(content)
      if (!requestIsLatest()) {
        releaseInteractionTracker()
        return
      }
      setIsRhythmLinked(false)
      applyImportedScore(imported)
      setImportFeedback({
        kind: 'success',
        message: buildImportSuccessMessage(imported),
        progress: 100,
      })
      releaseInteractionTracker()
      return
    }

    setLoadingFeedback(`Rendering first page (${Math.min(previewMeasureLimit, estimatedMeasureCount)} measures)...`, 20)
    const previewImported = parseMusicXml(content, { measureLimit: previewMeasureLimit })
    if (!requestIsLatest()) {
      releaseInteractionTracker()
      return
    }
    flushSync(() => {
      setIsRhythmLinked(false)
      applyImportedScore(previewImported)
      setImportFeedback({
        kind: 'loading',
        message: `Loaded first ${previewImported.measurePairs.length} measures (of ${estimatedMeasureCount}). Loading remaining measures...`,
        progress: 42,
      })
    })

    const applyFullImportedWhenReady = (fullImported: ImportResult) => {
      if (!requestIsLatest()) {
        releaseInteractionTracker()
        return
      }
      if (!canRunBackgroundApply()) {
        window.setTimeout(() => applyFullImportedWhenReady(fullImported), 32)
        return
      }
      setLoadingFeedback('Applying complete score...', 88)
      startTransition(() => {
        setIsRhythmLinked(false)
        applyImportedScore(fullImported)
        setImportFeedback({
          kind: 'success',
          message: buildImportSuccessMessage(fullImported),
          progress: 100,
        })
      })
      releaseInteractionTracker()
    }

    const runFullImport = () => {
      if (!requestIsLatest()) {
        releaseInteractionTracker()
        return
      }
      if (!canRunBackgroundApply()) {
        window.setTimeout(runFullImport, 32)
        return
      }
      setLoadingFeedback('Loading full score in background...', 56)
      void parseMusicXmlInWorker(content)
        .then((fullImported) => {
          setLoadingFeedback('Background parse complete.', 80)
          applyFullImportedWhenReady(fullImported)
        })
        .catch((error) => {
          if (!requestIsLatest()) {
            releaseInteractionTracker()
            return
          }
          const message = error instanceof Error ? error.message : 'Failed to import MusicXML.'
          setImportFeedback({ kind: 'error', message: `Partial import loaded, but full import failed: ${message}` })
          releaseInteractionTracker()
        })
    }

    scheduleAfterNextPaint(runFullImport)
  } catch (error) {
    if (!requestIsLatest()) {
      releaseInteractionTracker()
      return
    }
    const message = error instanceof Error ? error.message : 'Failed to import MusicXML.'
    setImportFeedback({ kind: 'error', message })
    releaseInteractionTracker()
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
