import { useEffect } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import type { SystemMeasureRange } from '../layout/demand'
import { buildHitGridIndex } from '../layout/hitTest'
import { getVisibleSystemRange } from '../layout/viewport'
import { renderVisibleSystems } from '../render/renderVisibleSystems'
import { syncBassNotesToTreble } from '../scoreOps'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { HitGridIndex } from '../layout/hitTest'
import type {
  DragState,
  MeasureLayout,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  Pitch,
  ScoreNote,
  Selection,
  TimeSignature,
} from '../types'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useImportedRefsSync(params: {
  measurePairsFromImport: MeasurePair[] | null
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  measureKeyFifthsFromImport: number[] | null
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureDivisionsFromImport: number[] | null
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImport: TimeSignature[] | null
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  musicXmlMetadataFromImport: MusicXmlMetadata | null
  musicXmlMetadataFromImportRef: MutableRefObject<MusicXmlMetadata | null>
  measurePairs: MeasurePair[]
  measurePairsRef: MutableRefObject<MeasurePair[]>
}): void {
  const {
    measurePairsFromImport,
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImport,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    measurePairs,
    measurePairsRef,
  } = params

  useEffect(() => {
    measurePairsFromImportRef.current = measurePairsFromImport
  }, [measurePairsFromImport, measurePairsFromImportRef])

  useEffect(() => {
    measureKeyFifthsFromImportRef.current = measureKeyFifthsFromImport
  }, [measureKeyFifthsFromImport, measureKeyFifthsFromImportRef])

  useEffect(() => {
    measureDivisionsFromImportRef.current = measureDivisionsFromImport
  }, [measureDivisionsFromImport, measureDivisionsFromImportRef])

  useEffect(() => {
    measureTimeSignaturesFromImportRef.current = measureTimeSignaturesFromImport
  }, [measureTimeSignaturesFromImport, measureTimeSignaturesFromImportRef])

  useEffect(() => {
    musicXmlMetadataFromImportRef.current = musicXmlMetadataFromImport
  }, [musicXmlMetadataFromImport, musicXmlMetadataFromImportRef])

  useEffect(() => {
    measurePairsRef.current = measurePairs
  }, [measurePairs, measurePairsRef])
}

export function useRhythmLinkedBassSync(params: {
  notes: ScoreNote[]
  isRhythmLinked: boolean
  setBassNotes: StateSetter<ScoreNote[]>
}): void {
  const { notes, isRhythmLinked, setBassNotes } = params
  useEffect(() => {
    if (!isRhythmLinked) return

    setBassNotes((currentBass) => {
      const sameShape =
        currentBass.length === notes.length &&
        currentBass.every((bassNote, index) => bassNote.duration === notes[index]?.duration)
      if (sameShape) return currentBass
      return syncBassNotesToTreble(notes, currentBass)
    })
  }, [notes, isRhythmLinked, setBassNotes])
}

export function useVisibleSystemRangeTracking(params: {
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  systemCount: number
  setVisibleSystemRange: StateSetter<{ start: number; end: number }>
}): void {
  const { scoreScrollRef, systemCount, setVisibleSystemRange } = params
  useEffect(() => {
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) return

    let rafId: number | null = null

    const updateVisibleRange = () => {
      const next = getVisibleSystemRange(scrollHost.scrollTop, scrollHost.clientHeight, systemCount)
      setVisibleSystemRange((current) => {
        if (current.start === next.start && current.end === next.end) return current
        return next
      })
    }

    const scheduleVisibleRangeUpdate = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        updateVisibleRange()
      })
    }

    updateVisibleRange()
    scrollHost.addEventListener('scroll', scheduleVisibleRangeUpdate, { passive: true })
    window.addEventListener('resize', scheduleVisibleRangeUpdate)

    return () => {
      scrollHost.removeEventListener('scroll', scheduleVisibleRangeUpdate)
      window.removeEventListener('resize', scheduleVisibleRangeUpdate)
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [scoreScrollRef, systemCount, setVisibleSystemRange])
}

export function useScoreRenderEffect(params: {
  scoreRef: MutableRefObject<HTMLCanvasElement | null>
  rendererRef: MutableRefObject<Renderer | null>
  rendererSizeRef: MutableRefObject<{ width: number; height: number }>
  scoreWidth: number
  scoreHeight: number
  measurePairs: MeasurePair[]
  systemRanges: SystemMeasureRange[]
  visibleSystemRange: { start: number; end: number }
  renderOriginSystemIndex: number
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  activeSelection: Selection | null
  draggingSelection: Selection | null
  noteLayoutsRef: MutableRefObject<NoteLayout[]>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  noteLayoutByKeyRef: MutableRefObject<Map<string, NoteLayout>>
  hitGridRef: MutableRefObject<HitGridIndex | null>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  backend: number
}): void {
  const {
    scoreRef,
    rendererRef,
    rendererSizeRef,
    scoreWidth,
    scoreHeight,
    measurePairs,
    systemRanges,
    visibleSystemRange,
    renderOriginSystemIndex,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    activeSelection,
    draggingSelection,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    backend,
  } = params

  useEffect(() => {
    const root = scoreRef.current
    if (!root) return

    let renderer = rendererRef.current
    if (!renderer) {
      renderer = new Renderer(root, backend)
      rendererRef.current = renderer
    }
    const currentSize = rendererSizeRef.current
    if (currentSize.width !== scoreWidth || currentSize.height !== scoreHeight) {
      renderer.resize(scoreWidth, scoreHeight)
      rendererSizeRef.current = { width: scoreWidth, height: scoreHeight }
    }
    const context = renderer.getContext()
    const previousNoteLayoutsByPair = noteLayoutsByPairRef.current
    const { nextLayouts, nextLayoutsByPair, nextLayoutsByKey, nextMeasureLayouts } = renderVisibleSystems({
      context,
      measurePairs,
      scoreWidth,
      scoreHeight,
      systemRanges,
      visibleSystemRange,
      renderOriginSystemIndex,
      measureKeyFifthsFromImport,
      measureTimeSignaturesFromImport,
      activeSelection,
      draggingSelection,
      previousNoteLayoutsByPair,
    })

    noteLayoutsRef.current = nextLayouts
    noteLayoutsByPairRef.current = nextLayoutsByPair
    noteLayoutByKeyRef.current = nextLayoutsByKey
    hitGridRef.current = buildHitGridIndex(nextLayouts)
    measureLayoutsRef.current = nextMeasureLayouts
  }, [
    scoreRef,
    rendererRef,
    rendererSizeRef,
    scoreWidth,
    scoreHeight,
    measurePairs,
    systemRanges,
    visibleSystemRange,
    renderOriginSystemIndex,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    activeSelection,
    draggingSelection,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    backend,
  ])
}

export function useSynthLifecycle(params: {
  synthRef: MutableRefObject<Tone.PolySynth | null>
}): void {
  const { synthRef } = params
  useEffect(() => {
    synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination()
    return () => {
      synthRef.current?.dispose()
    }
  }, [synthRef])
}

export function useRendererCleanup(params: {
  dragRafRef: MutableRefObject<number | null>
  dragPendingRef: MutableRefObject<{ drag: DragState; pitch: Pitch } | null>
  rendererRef: MutableRefObject<Renderer | null>
  rendererSizeRef: MutableRefObject<{ width: number; height: number }>
  overlayRendererRef: MutableRefObject<Renderer | null>
  overlayRendererSizeRef: MutableRefObject<{ width: number; height: number }>
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
}): void {
  const {
    dragRafRef,
    dragPendingRef,
    rendererRef,
    rendererSizeRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
  } = params

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current)
      }
      dragRafRef.current = null
      dragPendingRef.current = null
      rendererRef.current = null
      rendererSizeRef.current = { width: 0, height: 0 }
      overlayRendererRef.current = null
      overlayRendererSizeRef.current = { width: 0, height: 0 }
      overlayLastRectRef.current = null
    }
  }, [
    dragRafRef,
    dragPendingRef,
    rendererRef,
    rendererSizeRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
  ])
}

export function useSelectionOverlayEffect(params: {
  activeSelection: Selection
  draggingSelection: Selection | null
  drawSelectionMeasureOverlay: (selection: Selection) => void
  measurePairs: MeasurePair[]
  visibleSystemRange: { start: number; end: number }
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
}): void {
  const {
    activeSelection,
    draggingSelection,
    drawSelectionMeasureOverlay,
    measurePairs,
    visibleSystemRange,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
  } = params

  useEffect(() => {
    if (draggingSelection) return
    drawSelectionMeasureOverlay(activeSelection)
  }, [
    activeSelection,
    draggingSelection,
    drawSelectionMeasureOverlay,
    measurePairs,
    visibleSystemRange,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
  ])
}
