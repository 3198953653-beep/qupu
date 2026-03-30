import type { MutableRefObject } from 'react'
import type { ChordRulerEntry } from '../chordRuler'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
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
import type { ActiveChordSelection, ChordRulerMarkerMeta } from './useChordMarkerController'
import type { NotePreviewDebugEvent } from './useScoreAudioPreviewController'
import type { PlaybackCursorDebugEvent, PlayheadDebugLogRow } from './usePlaybackController'
import type { OsmdPreviewInstance, OsmdPreviewRebalanceStats, OsmdPreviewSelectionTarget } from './useOsmdPreviewController'
import { buildRuntimeDebugCanvasApi } from './buildRuntimeDebugCanvasApi'
import { buildRuntimeDebugImportAndScaleApi } from './buildRuntimeDebugImportAndScaleApi'
import { buildRuntimeDebugPlaybackApi } from './buildRuntimeDebugPlaybackApi'
import { buildRuntimeDebugSelectionApi } from './buildRuntimeDebugSelectionApi'

export function buildScoreRuntimeDebugApi(params: {
  importMusicXmlTextWithCollapseReset: (xmlText: string) => void
  playScore: () => Promise<void> | void
  importFeedbackRef: MutableRefObject<{ kind: string; message: string }>
  autoScaleEnabled: boolean
  safeManualScalePercent: number
  baseScoreScale: number
  scoreScale: number
  scoreScaleX: number
  scoreScaleY: number
  spacingLayoutMode: SpacingLayoutMode
  setAutoScaleEnabled: (enabled: boolean) => void
  showNoteHeadJianpuEnabled: boolean
  setShowNoteHeadJianpuEnabled: (enabled: boolean) => void
  setManualScalePercent: (nextPercent: number) => void
  dumpAllMeasureCoordinateReport: () => unknown
  dumpOsmdPreviewSystemMetrics: () => unknown
  osmdPreviewLastRebalanceStatsRef: MutableRefObject<OsmdPreviewRebalanceStats | null>
  osmdPreviewInstanceRef: MutableRefObject<OsmdPreviewInstance | null>
  dragDebugFramesRef: MutableRefObject<DragDebugSnapshot[]>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  measureTimelineBundlesRef: MutableRefObject<Map<number, MeasureTimelineBundle>>
  notePreviewEventsRef: MutableRefObject<NotePreviewDebugEvent[]>
  playbackCursorState: PlaybackCursorState
  playheadStatus: 'idle' | 'playing'
  playbackSessionId: number
  playbackCursorEventsRef: MutableRefObject<PlaybackCursorDebugEvent[]>
  playheadDebugLogRowsRef: MutableRefObject<PlayheadDebugLogRow[]>
  measurePlayheadDebugLogRow: (sequence: number) => PlayheadDebugLogRow | null
  latestPlayheadDebugSnapshotRef: MutableRefObject<PlayheadDebugLogRow | null>
  playheadDebugSequenceRef: MutableRefObject<number>
  applyChordSelectionRange: (params: {
    pairIndex: number
    startTick: number
    endTick: number
    markerKey?: string | null
  }) => Selection[]
  selectedSelectionsRef: MutableRefObject<Selection[]>
  measurePairsRef: MutableRefObject<MeasurePair[]>
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  pedalSpans: PedalSpan[]
  activePedalSelection: ActivePedalSelection | null
  activeChordSelection: ActiveChordSelection | null
  selectedMeasureHighlightRectPx: { x: number; y: number; width: number; height: number } | null
  chordRulerMarkerMetaByKey: Map<string, ChordRulerMarkerMeta>
  playbackTimelineEvents: PlaybackTimelineEvent[]
  playbackTrebleVolumePercent: number
  playbackBassVolumePercent: number
  dragRef: MutableRefObject<DragState | null>
  scoreOverlayRef: MutableRefObject<HTMLCanvasElement | null>
  scoreRef: MutableRefObject<HTMLCanvasElement | null>
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
  safeCurrentPage: number
  pageCount: number
  systemsPerPage: number
  visibleSystemRange: { start: number; end: number }
  activeSelection: Selection
  osmdPreviewSelectedSelectionKeyRef: MutableRefObject<string | null>
  osmdPreviewNoteLookupBySelectionRef: MutableRefObject<Map<string, OsmdPreviewSelectionTarget>>
}) {
  return {
    ...buildRuntimeDebugImportAndScaleApi({
      importMusicXmlTextWithCollapseReset: params.importMusicXmlTextWithCollapseReset,
      playScore: params.playScore,
      importFeedbackRef: params.importFeedbackRef,
      autoScaleEnabled: params.autoScaleEnabled,
      safeManualScalePercent: params.safeManualScalePercent,
      baseScoreScale: params.baseScoreScale,
      scoreScale: params.scoreScale,
      scoreScaleX: params.scoreScaleX,
      scoreScaleY: params.scoreScaleY,
      spacingLayoutMode: params.spacingLayoutMode,
      setAutoScaleEnabled: params.setAutoScaleEnabled,
      showNoteHeadJianpuEnabled: params.showNoteHeadJianpuEnabled,
      setShowNoteHeadJianpuEnabled: params.setShowNoteHeadJianpuEnabled,
      setManualScalePercent: params.setManualScalePercent,
    }),
    ...buildRuntimeDebugCanvasApi({
      dumpAllMeasureCoordinateReport: params.dumpAllMeasureCoordinateReport,
      dumpOsmdPreviewSystemMetrics: params.dumpOsmdPreviewSystemMetrics,
      osmdPreviewLastRebalanceStatsRef: params.osmdPreviewLastRebalanceStatsRef,
      osmdPreviewInstanceRef: params.osmdPreviewInstanceRef,
      dragDebugFramesRef: params.dragDebugFramesRef,
      dragRef: params.dragRef,
      measureLayoutsRef: params.measureLayoutsRef,
      noteLayoutsByPairRef: params.noteLayoutsByPairRef,
      measureTimelineBundlesRef: params.measureTimelineBundlesRef,
      measurePairsRef: params.measurePairsRef,
      chordRulerEntriesByPair: params.chordRulerEntriesByPair,
      pedalSpans: params.pedalSpans,
      activePedalSelection: params.activePedalSelection,
      scoreOverlayRef: params.scoreOverlayRef,
      scoreRef: params.scoreRef,
      overlayLastRectRef: params.overlayLastRectRef,
      scoreScale: params.scoreScale,
      safeCurrentPage: params.safeCurrentPage,
      pageCount: params.pageCount,
      systemsPerPage: params.systemsPerPage,
      visibleSystemRange: params.visibleSystemRange,
    }),
    ...buildRuntimeDebugPlaybackApi({
      notePreviewEventsRef: params.notePreviewEventsRef,
      playbackCursorState: params.playbackCursorState,
      playheadStatus: params.playheadStatus,
      playbackSessionId: params.playbackSessionId,
      playbackCursorEventsRef: params.playbackCursorEventsRef,
      playheadDebugLogRowsRef: params.playheadDebugLogRowsRef,
      measurePlayheadDebugLogRow: params.measurePlayheadDebugLogRow,
      latestPlayheadDebugSnapshotRef: params.latestPlayheadDebugSnapshotRef,
      playheadDebugSequenceRef: params.playheadDebugSequenceRef,
      playbackTimelineEvents: params.playbackTimelineEvents,
      playbackTrebleVolumePercent: params.playbackTrebleVolumePercent,
      playbackBassVolumePercent: params.playbackBassVolumePercent,
    }),
    ...buildRuntimeDebugSelectionApi({
      applyChordSelectionRange: params.applyChordSelectionRange,
      selectedSelectionsRef: params.selectedSelectionsRef,
      measurePairsRef: params.measurePairsRef,
      activeChordSelection: params.activeChordSelection,
      selectedMeasureHighlightRectPx: params.selectedMeasureHighlightRectPx,
      chordRulerMarkerMetaByKey: params.chordRulerMarkerMetaByKey,
      activeSelection: params.activeSelection,
      activePedalSelection: params.activePedalSelection,
      osmdPreviewSelectedSelectionKeyRef: params.osmdPreviewSelectedSelectionKeyRef,
      osmdPreviewNoteLookupBySelectionRef: params.osmdPreviewNoteLookupBySelectionRef,
    }),
  }
}
