import { useCallback, useMemo, type MutableRefObject } from 'react'
import type { ChordRulerEntry } from '../chordRuler'
import { buildMeasureCoordinateDebugReport } from '../scoreDebugReports'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import { useScoreDebugApi } from './useScoreDebugApi'
import { buildScoreRuntimeDebugApi } from './buildScoreRuntimeDebugApi'
import type { NotePreviewDebugEvent } from './useScoreAudioPreviewController'
import type { PlaybackCursorDebugEvent, PlayheadDebugLogRow } from './usePlaybackController'
import type { ChordRulerMarkerMeta, ActiveChordSelection } from './useChordMarkerController'
import type { OsmdPreviewInstance, OsmdPreviewRebalanceStats, OsmdPreviewSelectionTarget } from './useOsmdPreviewController'
import { useFirstMeasureDragDebug, type BeginOrEndDrag } from './useFirstMeasureDragDebug'
import type { MeasureTimelineBundle } from '../timeline/types'
import type {
  ActivePedalSelection,
  DragDebugSnapshot,
  DragState,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  PlaybackCursorState,
  PedalSpan,
  Selection,
  SpacingLayoutMode,
} from '../types'

export function useScoreRuntimeDebugController(params: {
  enabled: boolean
  beginDrag: BeginOrEndDrag
  endDrag: BeginOrEndDrag
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  measureTimelineBundlesRef: MutableRefObject<Map<number, MeasureTimelineBundle>>
  measurePairsRef: MutableRefObject<MeasurePair[]>
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  pedalSpans: PedalSpan[]
  activePedalSelection: ActivePedalSelection | null
  dragDebugFramesRef: MutableRefObject<DragDebugSnapshot[]>
  dragRef: MutableRefObject<DragState | null>
  scoreOverlayRef: MutableRefObject<HTMLCanvasElement | null>
  scoreRef: MutableRefObject<HTMLCanvasElement | null>
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
  importFeedbackRef: MutableRefObject<{ kind: string; message: string }>
  notePreviewEventsRef: MutableRefObject<NotePreviewDebugEvent[]>
  playbackCursorState: PlaybackCursorState
  playbackCursorEventsRef: MutableRefObject<PlaybackCursorDebugEvent[]>
  playbackSessionId: number
  playheadStatus: 'idle' | 'playing'
  playheadDebugLogRowsRef: MutableRefObject<PlayheadDebugLogRow[]>
  playheadDebugSequenceRef: MutableRefObject<number>
  latestPlayheadDebugSnapshotRef: MutableRefObject<PlayheadDebugLogRow | null>
  measurePlayheadDebugLogRow: (sequence: number) => PlayheadDebugLogRow | null
  applyChordSelectionRange: (params: {
    pairIndex: number
    startTick: number
    endTick: number
    markerKey?: string | null
  }) => Selection[]
  selectedSelectionsRef: MutableRefObject<Selection[]>
  activeChordSelection: ActiveChordSelection | null
  selectedMeasureHighlightRectPx: { x: number; y: number; width: number; height: number } | null
  chordRulerMarkerMetaByKey: Map<string, ChordRulerMarkerMeta>
  playbackTimelineEvents: PlaybackTimelineEvent[]
  playbackTrebleVolumePercent: number
  playbackBassVolumePercent: number
  safeCurrentPage: number
  pageCount: number
  systemsPerPage: number
  visibleSystemRange: { start: number; end: number }
  activeSelection: Selection
  osmdPreviewSelectedSelectionKeyRef: MutableRefObject<string | null>
  osmdPreviewNoteLookupBySelectionRef: MutableRefObject<Map<string, OsmdPreviewSelectionTarget>>
  importMusicXmlTextWithCollapseReset: (xmlText: string) => void
  playScore: () => Promise<void> | void
  autoScaleEnabled: boolean
  setAutoScaleEnabled: (enabled: boolean) => void
  showNoteHeadJianpuEnabled: boolean
  setShowNoteHeadJianpuEnabled: (enabled: boolean) => void
  safeManualScalePercent: number
  setManualScalePercent: (nextPercent: number) => void
  baseScoreScale: number
  scoreScale: number
  scoreScaleX: number
  scoreScaleY: number
  spacingLayoutMode: SpacingLayoutMode
  dumpOsmdPreviewSystemMetrics: () => unknown
  dumpNativePreviewLayoutDiagnostics: () => unknown
  osmdPreviewLastRebalanceStatsRef: MutableRefObject<OsmdPreviewRebalanceStats | null>
  osmdPreviewInstanceRef: MutableRefObject<OsmdPreviewInstance | null>
}): {
  onBeginDragWithFirstMeasureDebug: BeginOrEndDrag
  onEndDragWithFirstMeasureDebug: BeginOrEndDrag
} {
  const {
    enabled,
    beginDrag,
    endDrag,
    scoreScrollRef,
    measureLayoutsRef,
    noteLayoutsByPairRef,
    measureTimelineBundlesRef,
    measurePairsRef,
    chordRulerEntriesByPair,
    pedalSpans,
    activePedalSelection,
    dragDebugFramesRef,
    dragRef,
    scoreOverlayRef,
    scoreRef,
    overlayLastRectRef,
    importFeedbackRef,
    notePreviewEventsRef,
    playbackCursorState,
    playbackCursorEventsRef,
    playbackSessionId,
    playheadStatus,
    playheadDebugLogRowsRef,
    playheadDebugSequenceRef,
    latestPlayheadDebugSnapshotRef,
    measurePlayheadDebugLogRow,
    applyChordSelectionRange,
    selectedSelectionsRef,
    activeChordSelection,
    selectedMeasureHighlightRectPx,
    chordRulerMarkerMetaByKey,
    playbackTimelineEvents,
    playbackTrebleVolumePercent,
    playbackBassVolumePercent,
    safeCurrentPage,
    pageCount,
    systemsPerPage,
    visibleSystemRange,
    activeSelection,
    osmdPreviewSelectedSelectionKeyRef,
    osmdPreviewNoteLookupBySelectionRef,
    importMusicXmlTextWithCollapseReset,
    playScore,
    autoScaleEnabled,
    setAutoScaleEnabled,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
    safeManualScalePercent,
    setManualScalePercent,
    baseScoreScale,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    spacingLayoutMode,
    dumpOsmdPreviewSystemMetrics,
    dumpNativePreviewLayoutDiagnostics,
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewInstanceRef,
  } = params

  const { onBeginDragWithFirstMeasureDebug, onEndDragWithFirstMeasureDebug } = useFirstMeasureDragDebug({
    beginDrag,
    endDrag,
    scoreScrollRef,
    measureLayoutsRef,
    noteLayoutsByPairRef,
    measurePairsRef,
    dragDebugFramesRef,
    dragRef,
  })

  const dumpAllMeasureCoordinateReport = useCallback(() => buildMeasureCoordinateDebugReport({
    measureLayouts: measureLayoutsRef.current,
    noteLayoutsByPair: noteLayoutsByPairRef.current,
    measureTimelineBundles: measureTimelineBundlesRef.current,
    measurePairs: measurePairsRef.current,
    visibleSystemRange,
  }), [measureLayoutsRef, measurePairsRef, measureTimelineBundlesRef, noteLayoutsByPairRef, visibleSystemRange])

  const debugApi = useMemo(() => buildScoreRuntimeDebugApi({
    importMusicXmlTextWithCollapseReset,
    playScore,
    importFeedbackRef,
    autoScaleEnabled,
    safeManualScalePercent,
    baseScoreScale,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    spacingLayoutMode,
    setAutoScaleEnabled,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
    setManualScalePercent,
    dumpAllMeasureCoordinateReport,
    dumpOsmdPreviewSystemMetrics,
    dumpNativePreviewLayoutDiagnostics,
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewInstanceRef,
    dragDebugFramesRef,
    measureLayoutsRef,
    noteLayoutsByPairRef,
    measureTimelineBundlesRef,
    notePreviewEventsRef,
    playbackCursorState,
    playheadStatus,
    playbackSessionId,
    playbackCursorEventsRef,
    playheadDebugLogRowsRef,
    measurePlayheadDebugLogRow,
    latestPlayheadDebugSnapshotRef,
    playheadDebugSequenceRef,
    applyChordSelectionRange,
    selectedSelectionsRef,
    measurePairsRef,
    chordRulerEntriesByPair,
    pedalSpans,
    activePedalSelection,
    activeChordSelection,
    selectedMeasureHighlightRectPx,
    chordRulerMarkerMetaByKey,
    playbackTimelineEvents,
    playbackTrebleVolumePercent,
    playbackBassVolumePercent,
    dragRef,
    scoreOverlayRef,
    scoreRef,
    overlayLastRectRef,
    safeCurrentPage,
    pageCount,
    systemsPerPage,
    visibleSystemRange,
    activeSelection,
    osmdPreviewSelectedSelectionKeyRef,
    osmdPreviewNoteLookupBySelectionRef,
  }), [
    activeChordSelection,
    activeSelection,
    applyChordSelectionRange,
    autoScaleEnabled,
    baseScoreScale,
    chordRulerMarkerMetaByKey,
    dragDebugFramesRef,
    dragRef,
    dumpAllMeasureCoordinateReport,
    dumpNativePreviewLayoutDiagnostics,
    dumpOsmdPreviewSystemMetrics,
    importFeedbackRef,
    importMusicXmlTextWithCollapseReset,
    latestPlayheadDebugSnapshotRef,
    measureLayoutsRef,
    measurePairsRef,
    measureTimelineBundlesRef,
    noteLayoutsByPairRef,
    chordRulerEntriesByPair,
    pedalSpans,
    activePedalSelection,
    measurePlayheadDebugLogRow,
    notePreviewEventsRef,
    osmdPreviewInstanceRef,
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewNoteLookupBySelectionRef,
    osmdPreviewSelectedSelectionKeyRef,
    overlayLastRectRef,
    pageCount,
    playbackCursorEventsRef,
    playbackCursorState,
    playbackSessionId,
    playbackTimelineEvents,
    playbackTrebleVolumePercent,
    playbackBassVolumePercent,
    playScore,
    playheadDebugLogRowsRef,
    playheadDebugSequenceRef,
    playheadStatus,
    safeCurrentPage,
    safeManualScalePercent,
    scoreOverlayRef,
    scoreRef,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    selectedMeasureHighlightRectPx,
    selectedSelectionsRef,
    setAutoScaleEnabled,
    setManualScalePercent,
    setShowNoteHeadJianpuEnabled,
    showNoteHeadJianpuEnabled,
    spacingLayoutMode,
    systemsPerPage,
    visibleSystemRange,
  ])

  useScoreDebugApi({
    enabled,
    debugApi,
  })

  return {
    onBeginDragWithFirstMeasureDebug,
    onEndDragWithFirstMeasureDebug,
  }
}
