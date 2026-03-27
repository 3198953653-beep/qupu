import { clampScalePercent } from '../scorePresentation'
import type { ChordRulerMarkerMeta, ActiveChordSelection } from './useChordMarkerController'
import type { NotePreviewDebugEvent } from './useScoreAudioPreviewController'
import type { PlaybackCursorDebugEvent, PlayheadDebugLogRow } from './usePlaybackController'
import type { OsmdPreviewInstance, OsmdPreviewRebalanceStats, OsmdPreviewSelectionTarget } from './useOsmdPreviewController'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import type {
  DragDebugSnapshot,
  DragState,
  MeasureLayout,
  MeasurePair,
  PlaybackCursorState,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
} from '../types'
import type { MutableRefObject } from 'react'

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
  activeChordSelection: ActiveChordSelection | null
  selectedMeasureHighlightRectPx: { x: number; y: number; width: number; height: number } | null
  chordRulerMarkerMetaByKey: Map<string, ChordRulerMarkerMeta>
  playbackTimelineEvents: PlaybackTimelineEvent[]
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
  const {
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
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewInstanceRef,
    dragDebugFramesRef,
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
    activeChordSelection,
    selectedMeasureHighlightRectPx,
    chordRulerMarkerMetaByKey,
    playbackTimelineEvents,
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
  } = params

  return {
    importMusicXmlText: (xmlText: string) => {
      importMusicXmlTextWithCollapseReset(xmlText)
    },
    playScore: () => {
      void playScore()
    },
    getImportFeedback: () => importFeedbackRef.current,
    getScaleConfig: () => ({
      autoScaleEnabled,
      manualScalePercent: safeManualScalePercent,
      baseScoreScale,
      scoreScale,
      scoreScaleX,
      scoreScaleY,
      isHorizontalView: true,
      spacingLayoutMode,
    }),
    setAutoScaleEnabled: (nextEnabled: boolean) => {
      setAutoScaleEnabled(Boolean(nextEnabled))
    },
    getShowNoteHeadJianpuEnabled: () => showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled: (nextEnabled: boolean) => {
      setShowNoteHeadJianpuEnabled(Boolean(nextEnabled))
    },
    setManualScalePercent: (nextPercent: number) => {
      setManualScalePercent(clampScalePercent(nextPercent))
    },
    dumpAllMeasureCoordinates: () => dumpAllMeasureCoordinateReport(),
    getOsmdPreviewSystemMetrics: () => dumpOsmdPreviewSystemMetrics(),
    getOsmdPreviewRebalanceStats: () => osmdPreviewLastRebalanceStatsRef.current,
    getOsmdPreviewInstance: () => osmdPreviewInstanceRef.current,
    getDragPreviewFrames: () =>
      dragDebugFramesRef.current.map((frame) => ({
        ...frame,
        rows: frame.rows.map((row) => ({ ...row })),
      })),
    getNotePreviewEvents: () => notePreviewEventsRef.current.map((event) => ({ ...event })),
    clearNotePreviewEvents: () => {
      notePreviewEventsRef.current = []
    },
    getPlaybackCursorState: () => ({
      ...playbackCursorState,
      point: playbackCursorState.point ? { ...playbackCursorState.point } : null,
      rectPx: playbackCursorState.rectPx ? { ...playbackCursorState.rectPx } : null,
      status: playheadStatus,
      sessionId: playbackSessionId,
    }),
    getPlaybackCursorEvents: () => playbackCursorEventsRef.current.map((event) => ({
      ...event,
      point: event.point ? { ...event.point } : null,
    })),
    clearPlaybackCursorEvents: () => {
      playbackCursorEventsRef.current = []
    },
    getPlayheadDebugLogRows: () => playheadDebugLogRowsRef.current.map((row) => ({ ...row })),
    getPlayheadDebugViewportSnapshot: () =>
      measurePlayheadDebugLogRow(
        latestPlayheadDebugSnapshotRef.current?.seq ?? playheadDebugSequenceRef.current,
      ) ??
      (latestPlayheadDebugSnapshotRef.current ? { ...latestPlayheadDebugSnapshotRef.current } : null),
    applyChordSelectionRange: (pairIndex: number, startTick: number, endTick: number) => ({
      selectedCount: applyChordSelectionRange({
        pairIndex,
        startTick,
        endTick,
        markerKey: null,
      }).length,
    }),
    getSelectedSelections: () =>
      selectedSelectionsRef.current.map((selection) => {
        const matchedEntry = (() => {
          for (let pairIndex = 0; pairIndex < measurePairsRef.current.length; pairIndex += 1) {
            const pair = measurePairsRef.current[pairIndex]
            if (!pair) continue
            const staffNotes = selection.staff === 'treble' ? pair.treble : pair.bass
            const noteIndex = staffNotes.findIndex((note) => note.id === selection.noteId)
            if (noteIndex < 0) continue
            return {
              pairIndex,
              noteIndex,
              note: staffNotes[noteIndex] ?? null,
            }
          }
          return {
            pairIndex: null,
            noteIndex: null,
            note: null as ScoreNote | null,
          }
        })()
        return {
          ...selection,
          pairIndex: matchedEntry.pairIndex,
          noteIndex: matchedEntry.noteIndex,
          pitch: matchedEntry.note?.pitch ?? null,
          duration: matchedEntry.note?.duration ?? null,
          isRest: matchedEntry.note?.isRest === true,
        }
      }),
    getActiveChordSelection: () => (activeChordSelection ? { ...activeChordSelection } : null),
    getSelectedMeasureHighlightRect: () =>
      selectedMeasureHighlightRectPx ? { ...selectedMeasureHighlightRectPx } : null,
    getChordRulerMarkers: () =>
      [...chordRulerMarkerMetaByKey.values()].map((marker) => ({
        key: marker.key,
        pairIndex: marker.pairIndex,
        beatIndex: marker.beatIndex,
        label: marker.displayLabel,
        sourceLabel: marker.sourceLabel,
        displayLabel: marker.displayLabel,
        startTick: marker.startTick,
        endTick: marker.endTick,
        positionText: marker.positionText,
        anchorGlobalX: marker.anchorGlobalX,
        anchorXPx: marker.anchorXPx,
        xPx: marker.xPx,
        anchorSource: marker.anchorSource,
        keyFifths: marker.keyFifths,
        keyMode: marker.keyMode,
      })),
    getPlaybackTimelinePoints: () =>
      playbackTimelineEvents.map((event) => ({
        pairIndex: event.pairIndex,
        onsetTick: event.onsetTick,
        atSeconds: event.atSeconds,
        targetCount: event.targets.length,
      })),
    getDragSessionState: () => {
      const drag = dragRef.current
      if (!drag) return null
      return {
        noteId: drag.noteId,
        staff: drag.staff,
        keyIndex: drag.keyIndex,
        pairIndex: drag.pairIndex,
        noteIndex: drag.noteIndex,
        pitch: drag.pitch,
        previewStarted: drag.previewStarted,
        groupPreviewLeadTarget: drag.groupPreviewLeadTarget ? { ...drag.groupPreviewLeadTarget } : null,
        linkedTieTargets: drag.linkedTieTargets?.map((target) => ({ ...target })) ?? [],
        previousTieTarget: drag.previousTieTarget ? { ...drag.previousTieTarget } : null,
        previewFrozenBoundary: drag.previewFrozenBoundary
          ? {
              fromTarget: { ...drag.previewFrozenBoundary.fromTarget },
              toTarget: { ...drag.previewFrozenBoundary.toTarget },
              startX: drag.previewFrozenBoundary.startX,
              startY: drag.previewFrozenBoundary.startY,
              endX: drag.previewFrozenBoundary.endX,
              endY: drag.previewFrozenBoundary.endY,
              frozenPitch: drag.previewFrozenBoundary.frozenPitch,
            }
          : null,
      }
    },
    getTieStateSnapshot: () =>
      measurePairsRef.current.map((pair, pairIndex) => {
        const mapNote = (note: ScoreNote, noteIndex: number) => ({
          noteIndex,
          noteId: note.id,
          pitch: note.pitch,
          tieStart: Boolean(note.tieStart),
          tieStop: Boolean(note.tieStop),
          tieFrozenIncomingPitch: note.tieFrozenIncomingPitch ?? null,
          tieFrozenIncomingFromNoteId: note.tieFrozenIncomingFromNoteId ?? null,
          tieFrozenIncomingFromKeyIndex:
            typeof note.tieFrozenIncomingFromKeyIndex === 'number' && Number.isFinite(note.tieFrozenIncomingFromKeyIndex)
              ? Math.max(0, Math.trunc(note.tieFrozenIncomingFromKeyIndex))
              : null,
        })
        return {
          pairIndex,
          treble: pair.treble.map(mapNote),
          bass: pair.bass.map(mapNote),
        }
      }),
    getOverlayDebugInfo: () => {
      const overlay = scoreOverlayRef.current
      const surface = scoreRef.current
      if (!overlay || !surface) return null
      const overlayClientRect = overlay.getBoundingClientRect()
      const surfaceClientRect = surface.getBoundingClientRect()
      return {
        scoreScale,
        overlayRectInScore: overlayLastRectRef.current
          ? { ...overlayLastRectRef.current }
          : null,
        overlayElement: {
          width: overlay.width,
          height: overlay.height,
          styleLeft: overlay.style.left,
          styleTop: overlay.style.top,
          styleWidth: overlay.style.width,
          styleHeight: overlay.style.height,
          display: overlay.style.display,
        },
        overlayClientRect: {
          left: overlayClientRect.left,
          top: overlayClientRect.top,
          width: overlayClientRect.width,
          height: overlayClientRect.height,
        },
        surfaceElement: {
          width: surface.width,
          height: surface.height,
        },
        surfaceClientRect: {
          left: surfaceClientRect.left,
          top: surfaceClientRect.top,
          width: surfaceClientRect.width,
          height: surfaceClientRect.height,
        },
      }
    },
    getPaging: () => ({
      currentPage: safeCurrentPage,
      pageCount,
      systemsPerPage,
      visibleSystemRange: { ...visibleSystemRange },
    }),
    getActiveSelection: () => ({ ...activeSelection }),
    getOsmdPreviewSelectedSelectionKey: () => osmdPreviewSelectedSelectionKeyRef.current,
    getOsmdPreviewNoteTargets: () =>
      [...osmdPreviewNoteLookupBySelectionRef.current.values()].map((target) => ({
        pairIndex: target.pairIndex,
        measureNumber: target.measureNumber,
        onsetTicks: target.onsetTicks,
        domIds: [...target.domIds],
        selection: { ...target.selection },
      })),
  }
}
