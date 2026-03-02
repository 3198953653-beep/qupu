import { useEffect, useLayoutEffect } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import type { SystemMeasureRange } from '../layout/demand'
import { buildHitGridIndex } from '../layout/hitTest'
import { getVisibleSystemRange } from '../layout/viewport'
import { renderVisibleSystems } from '../render/renderVisibleSystems'
import { syncBassNotesToTreble } from '../scoreOps'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { HitGridIndex } from '../layout/hitTest'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type {
  DragState,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  Pitch,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
  TimeSignature,
} from '../types'

type StateSetter<T> = Dispatch<SetStateAction<T>>
type PlaybackSynth = Tone.PolySynth | Tone.Sampler

const PIANO_SAMPLE_URLS: Record<string, string> = {
  A0: 'A0.mp3',
  C1: 'C1.mp3',
  'D#1': 'Ds1.mp3',
  'F#1': 'Fs1.mp3',
  A1: 'A1.mp3',
  C2: 'C2.mp3',
  'D#2': 'Ds2.mp3',
  'F#2': 'Fs2.mp3',
  A2: 'A2.mp3',
  C3: 'C3.mp3',
  'D#3': 'Ds3.mp3',
  'F#3': 'Fs3.mp3',
  A3: 'A3.mp3',
  C4: 'C4.mp3',
  'D#4': 'Ds4.mp3',
  'F#4': 'Fs4.mp3',
  A4: 'A4.mp3',
  C5: 'C5.mp3',
  'D#5': 'Ds5.mp3',
  'F#5': 'Fs5.mp3',
  A5: 'A5.mp3',
  C6: 'C6.mp3',
  'D#6': 'Ds6.mp3',
  'F#6': 'Fs6.mp3',
  A6: 'A6.mp3',
  C7: 'C7.mp3',
  'D#7': 'Ds7.mp3',
  'F#7': 'Fs7.mp3',
  A7: 'A7.mp3',
  C8: 'C8.mp3',
}

const PIANO_SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'

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
  visiblePairRange?: { startPairIndex: number; endPairIndexExclusive: number } | null
  clearViewportXRange?: { startX: number; endX: number } | null
  measureFramesByPair?: Array<{ measureX: number; measureWidth: number }> | null
  renderOffsetX?: number
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  activeSelection?: Selection | null
  draggingSelection?: Selection | null
  activeSelections?: Selection[] | null
  draggingSelections?: Selection[] | null
  layoutReflowHintRef?: MutableRefObject<LayoutReflowHint | null>
  layoutStabilityKey?: string
  noteLayoutsRef: MutableRefObject<NoteLayout[]>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  noteLayoutByKeyRef: MutableRefObject<Map<string, NoteLayout>>
  hitGridRef: MutableRefObject<HitGridIndex | null>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  backend: number
  pagePaddingX?: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
  renderScaleX?: number
  renderScaleY?: number
  renderQualityScaleX?: number
  renderQualityScaleY?: number
  dragPreview?: DragState | null
  onAfterRender?: () => void
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
    visiblePairRange = null,
    clearViewportXRange = null,
    measureFramesByPair = null,
    renderOffsetX = 0,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    activeSelection = null,
    draggingSelection = null,
    activeSelections = null,
    draggingSelections = null,
    layoutReflowHintRef,
    layoutStabilityKey,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    backend,
    pagePaddingX,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
    renderScaleX = 1,
    renderScaleY = 1,
    renderQualityScaleX: forcedRenderQualityScaleX,
    renderQualityScaleY: forcedRenderQualityScaleY,
    dragPreview = null,
    onAfterRender,
  } = params
  useLayoutEffect(() => {
    const root = scoreRef.current
    if (!root) return

    const maxBackingStoreDim = 32760
    const devicePixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1
    const targetQualityX = Math.max(1, devicePixelRatio, Math.abs(renderScaleX))
    const targetQualityY = Math.max(1, devicePixelRatio, Math.abs(renderScaleY))
    const maxQualityX = Math.max(1, maxBackingStoreDim / Math.max(1, scoreWidth))
    const maxQualityY = Math.max(1, maxBackingStoreDim / Math.max(1, scoreHeight))
    const renderQualityScaleX =
      Number.isFinite(forcedRenderQualityScaleX) && (forcedRenderQualityScaleX ?? 0) > 0
        ? Math.max(1, Math.min(forcedRenderQualityScaleX as number, maxQualityX))
        : Math.max(1, Math.min(targetQualityX, maxQualityX))
    const renderQualityScaleY =
      Number.isFinite(forcedRenderQualityScaleY) && (forcedRenderQualityScaleY ?? 0) > 0
        ? Math.max(1, Math.min(forcedRenderQualityScaleY as number, maxQualityY))
        : Math.max(1, Math.min(targetQualityY, maxQualityY))
    const backingWidth = Math.max(1, Math.round(scoreWidth * renderQualityScaleX))
    const backingHeight = Math.max(1, Math.round(scoreHeight * renderQualityScaleY))

    let renderer = rendererRef.current
    if (!renderer) {
      renderer = new Renderer(root, backend)
      rendererRef.current = renderer
    }
    const currentSize = rendererSizeRef.current
    if (currentSize.width !== backingWidth || currentSize.height !== backingHeight) {
      renderer.resize(backingWidth, backingHeight)
      rendererSizeRef.current = { width: backingWidth, height: backingHeight }
    }
    // Renderer.resize updates CSS size to backing-store size; keep visual size in logical score units.
    root.style.width = `${scoreWidth}px`
    root.style.height = `${scoreHeight}px`
    const context = renderer.getContext()
    const context2D = (context as unknown as { context2D?: CanvasRenderingContext2D }).context2D
    if (context2D) {
      // Keep logical score-space to CSS pixels strictly 1:1 after browser scaling.
      // Use actual backing/store ratio instead of nominal quality factor to avoid
      // sub-pixel drift between main canvas and overlay canvas.
      const scaleX = scoreWidth > 0 ? backingWidth / scoreWidth : 1
      const scaleY = scoreHeight > 0 ? backingHeight / scoreHeight : 1
      context2D.setTransform(scaleX, 0, 0, scaleY, 0, 0)
    }
    const previousNoteLayoutsByPair = noteLayoutsByPairRef.current
    const previousMeasureLayouts = measureLayoutsRef.current
    const layoutReflowHint = layoutReflowHintRef?.current ?? null

    const { nextLayouts, nextLayoutsByPair, nextLayoutsByKey, nextMeasureLayouts } = renderVisibleSystems({
      context,
      measurePairs,
      scoreWidth,
      scoreHeight,
      systemRanges,
      visibleSystemRange,
      renderOriginSystemIndex,
      visiblePairRange,
      clearViewportXRange,
      measureFramesByPair,
      renderOffsetX,
      measureKeyFifthsFromImport,
      measureTimeSignaturesFromImport,
      activeSelection,
      draggingSelection,
      activeSelections,
      draggingSelections,
      layoutReflowHint,
      layoutStabilityKey,
      previousNoteLayoutsByPair,
      previousMeasureLayouts,
      allowSelectionFreezeWhenNotDragging: false,
      pagePaddingX,
      timeAxisSpacingConfig,
      spacingLayoutMode,
      dragPreview,
    })
    noteLayoutsRef.current = nextLayouts
    noteLayoutsByPairRef.current = nextLayoutsByPair
    noteLayoutByKeyRef.current = nextLayoutsByKey
    hitGridRef.current = buildHitGridIndex(nextLayouts)
    measureLayoutsRef.current = nextMeasureLayouts
    onAfterRender?.()
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
    visiblePairRange,
    clearViewportXRange,
    measureFramesByPair,
    renderOffsetX,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    activeSelection,
    draggingSelection,
    activeSelections,
    draggingSelections,
    layoutReflowHintRef,
    layoutStabilityKey,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    backend,
    pagePaddingX,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    renderScaleX,
    renderScaleY,
    forcedRenderQualityScaleX,
    forcedRenderQualityScaleY,
    dragPreview,
    onAfterRender,
  ])
}

export function useSynthLifecycle(params: {
  synthRef: MutableRefObject<PlaybackSynth | null>
}): void {
  const { synthRef } = params
  useEffect(() => {
    const fallbackSynth = new Tone.PolySynth(Tone.Synth).toDestination()
    const sampler = new Tone.Sampler({
      urls: PIANO_SAMPLE_URLS,
      baseUrl: PIANO_SAMPLE_BASE_URL,
      release: 1.8,
    }).toDestination()
    synthRef.current = sampler
    let isDisposed = false
    let isFallbackDisposed = false
    void Tone.loaded()
      .then(() => {
        if (isDisposed) return
        if (synthRef.current !== sampler) return
        console.info('[audio] 高质量钢琴音源已加载（Salamander Sampler）。')
        fallbackSynth.dispose()
        isFallbackDisposed = true
      })
      .catch((error: unknown) => {
        if (isDisposed) return
        sampler.dispose()
        synthRef.current = fallbackSynth
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[audio] 钢琴采样加载失败，已回退到默认合成器：${message}`)
      })
    return () => {
      isDisposed = true
      const currentSynth = synthRef.current
      currentSynth?.dispose()
      if (!isFallbackDisposed && currentSynth !== fallbackSynth) {
        fallbackSynth.dispose()
      }
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
