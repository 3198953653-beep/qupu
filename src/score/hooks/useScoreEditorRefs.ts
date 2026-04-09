import { useRef } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import type { MeasureTimelineBundle } from '../timeline/types'
import type { HitGridIndex } from '../layout/hitTest'
import type {
  ActivePedalSelection,
  DragDebugSnapshot,
  DragState,
  ImportFeedback,
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  PedalSpan,
  Pitch,
  Selection,
  TimeSignature,
} from '../types'

export function useScoreEditorRefs(params: {
  importFeedback: ImportFeedback
  activeSelection: Selection
  activePedalSelection: ActivePedalSelection | null
  pedalSpans: PedalSpan[]
  selectedSelections: Selection[]
  fullMeasureRestCollapseScopeKeys: string[]
  isSelectionVisible: boolean
  draggingSelection: Selection | null
}) {
  const {
    importFeedback,
    activeSelection,
    activePedalSelection,
    pedalSpans,
    selectedSelections,
    fullMeasureRestCollapseScopeKeys,
    isSelectionVisible,
    draggingSelection,
  } = params

  const scoreRef = useRef<HTMLCanvasElement | null>(null)
  const scoreOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const scoreScrollRef = useRef<HTMLDivElement | null>(null)
  const scoreStageRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | Tone.Sampler | null>(null)

  const noteLayoutsRef = useRef<NoteLayout[]>([])
  const noteLayoutsByPairRef = useRef<Map<number, NoteLayout[]>>(new Map())
  const noteLayoutByKeyRef = useRef<Map<string, NoteLayout>>(new Map())
  const horizontalRenderOffsetXRef = useRef(0)
  const hitGridRef = useRef<HitGridIndex | null>(null)
  const measureLayoutsRef = useRef<Map<number, MeasureLayout>>(new Map())
  const measureTimelineBundlesRef = useRef<Map<number, MeasureTimelineBundle>>(new Map())
  const measurePairsRef = useRef<MeasurePair[]>([])
  const dragDebugFramesRef = useRef<DragDebugSnapshot[]>([])
  const dragRef = useRef<DragState | null>(null)
  const dragPreviewFrameRef = useRef(0)
  const dragRafRef = useRef<number | null>(null)
  const dragPendingRef = useRef<{ drag: DragState; pitch: Pitch } | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const widthProbeRendererRef = useRef<Renderer | null>(null)
  const horizontalMeasureWidthCacheRef = useRef<Map<string, number>>(new Map())
  const overlayRendererRef = useRef<Renderer | null>(null)
  const overlayRendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const overlayLastRectRef = useRef<MeasureLayout['overlayRect'] | null>(null)
  const stopPlayTimerRef = useRef<number | null>(null)
  const playbackPointTimerIdsRef = useRef<number[]>([])
  const playbackSessionIdRef = useRef(0)
  const measurePairsFromImportRef = useRef<MeasurePair[] | null>(null)
  const measureKeyFifthsFromImportRef = useRef<number[] | null>(null)
  const measureKeyModesFromImportRef = useRef<string[] | null>(null)
  const measureDivisionsFromImportRef = useRef<number[] | null>(null)
  const measureTimeSignaturesFromImportRef = useRef<TimeSignature[] | null>(null)
  const musicXmlMetadataFromImportRef = useRef<MusicXmlMetadata | null>(null)
  const importedNoteLookupRef = useRef<Map<string, ImportedNoteLocation>>(new Map())
  const importFeedbackRef = useRef<ImportFeedback>(importFeedback)
  const activeSelectionRef = useRef<Selection>(activeSelection)
  const activePedalSelectionRef = useRef<ActivePedalSelection | null>(activePedalSelection)
  const pedalSpansRef = useRef<PedalSpan[]>(pedalSpans)
  const selectedSelectionsRef = useRef<Selection[]>(selectedSelections)
  const fullMeasureRestCollapseScopeKeysRef = useRef<string[]>(fullMeasureRestCollapseScopeKeys)
  const isSelectionVisibleRef = useRef<boolean>(isSelectionVisible)
  const draggingSelectionRef = useRef<Selection | null>(draggingSelection)
  const clearDragOverlayRef = useRef<() => void>(() => {})
  const layoutReflowHintRef = useRef<LayoutReflowHint | null>(null)
  const midiStepChainRef = useRef(false)
  const midiStepLastSelectionRef = useRef<Selection | null>(null)
  const isOsmdPreviewOpenRef = useRef(false)
  const isAnyPreviewOpenRef = useRef(false)

  return {
    scoreRef,
    scoreOverlayRef,
    scoreScrollRef,
    scoreStageRef,
    fileInputRef,
    synthRef,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    hitGridRef,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    measurePairsRef,
    dragDebugFramesRef,
    dragRef,
    dragPreviewFrameRef,
    dragRafRef,
    dragPendingRef,
    rendererRef,
    rendererSizeRef,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    measurePairsFromImportRef,
    measureKeyFifthsFromImportRef,
    measureKeyModesFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    importFeedbackRef,
    activeSelectionRef,
    activePedalSelectionRef,
    pedalSpansRef,
    selectedSelectionsRef,
    fullMeasureRestCollapseScopeKeysRef,
    isSelectionVisibleRef,
    draggingSelectionRef,
    clearDragOverlayRef,
    layoutReflowHintRef,
    midiStepChainRef,
    midiStepLastSelectionRef,
    isOsmdPreviewOpenRef,
    isAnyPreviewOpenRef,
  }
}
