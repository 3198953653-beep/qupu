import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { buildMeasureCoordinateDebugReport, buildFirstMeasureDiffReport, captureFirstMeasureSnapshot, type FirstMeasureDragContext, type FirstMeasureSnapshot } from '../scoreDebugReports'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import { useScoreDebugApi } from './useScoreDebugApi'
import { clampScalePercent } from '../scorePresentation'
import type { NotePreviewDebugEvent } from './useScoreAudioPreviewController'
import type { PlaybackCursorDebugEvent, PlayheadDebugLogRow } from './usePlaybackController'
import type { ChordRulerMarkerMeta, ActiveChordSelection } from './useChordMarkerController'
import type { OsmdPreviewInstance, OsmdPreviewRebalanceStats, OsmdPreviewSelectionTarget } from './useOsmdPreviewController'
import type { MeasureTimelineBundle } from '../timeline/types'
import type {
  DragDebugSnapshot,
  DragState,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  PlaybackCursorState,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
} from '../types'

const ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG = false

type BeginOrEndDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => void

export function useScoreRuntimeDebugController(params: {
  enabled: boolean
  beginDrag: BeginOrEndDrag
  endDrag: BeginOrEndDrag
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  measureTimelineBundlesRef: MutableRefObject<Map<number, MeasureTimelineBundle>>
  measurePairsRef: MutableRefObject<MeasurePair[]>
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
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewInstanceRef,
  } = params

  const firstMeasureBaselineRef = useRef<FirstMeasureSnapshot | null>(null)
  const firstMeasureDragContextRef = useRef<FirstMeasureDragContext | null>(null)
  const firstMeasureDebugRafRef = useRef<number | null>(null)

  const onBeginDragWithFirstMeasureDebug = useCallback<BeginOrEndDrag>((event) => {
    scoreScrollRef.current?.focus()
    beginDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    const drag = dragRef.current
    if (!drag) return
    firstMeasureDragContextRef.current = {
      noteId: drag.noteId,
      staff: drag.staff,
      keyIndex: drag.keyIndex,
      pairIndex: drag.pairIndex,
    }
    firstMeasureBaselineRef.current = captureFirstMeasureSnapshot({
      stage: 'before-drag',
      measurePairs: measurePairsRef.current,
      noteLayoutsByPair: noteLayoutsByPairRef.current,
      measureLayouts: measureLayoutsRef.current,
    })
  }, [beginDrag, dragRef, measureLayoutsRef, measurePairsRef, noteLayoutsByPairRef, scoreScrollRef])

  const onEndDragWithFirstMeasureDebug = useCallback<BeginOrEndDrag>((event) => {
    const dragging = dragRef.current
    endDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    if (!dragging) return
    const beforeSnapshot = firstMeasureBaselineRef.current
    if (!beforeSnapshot) return
    if (firstMeasureDebugRafRef.current !== null) {
      window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      firstMeasureDebugRafRef.current = null
    }
    firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
      firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
        const afterSnapshot = captureFirstMeasureSnapshot({
          stage: 'after-drag-release',
          measurePairs: measurePairsRef.current,
          noteLayoutsByPair: noteLayoutsByPairRef.current,
          measureLayouts: measureLayoutsRef.current,
        })
        if (afterSnapshot) {
          const report = buildFirstMeasureDiffReport({
            beforeSnapshot,
            afterSnapshot,
            dragContext: firstMeasureDragContextRef.current,
            dragPreviewFrameCount: dragDebugFramesRef.current.length,
          })
          console.log(report)
        }
        firstMeasureBaselineRef.current = null
        firstMeasureDragContextRef.current = null
        firstMeasureDebugRafRef.current = null
      })
    })
  }, [dragDebugFramesRef, dragRef, endDrag, measureLayoutsRef, measurePairsRef, noteLayoutsByPairRef])

  const dumpAllMeasureCoordinateReport = useCallback(() => buildMeasureCoordinateDebugReport({
    measureLayouts: measureLayoutsRef.current,
    noteLayoutsByPair: noteLayoutsByPairRef.current,
    measureTimelineBundles: measureTimelineBundlesRef.current,
    measurePairs: measurePairsRef.current,
    visibleSystemRange,
  }), [measureLayoutsRef, measurePairsRef, measureTimelineBundlesRef, noteLayoutsByPairRef, visibleSystemRange])

  useEffect(() => {
    return () => {
      if (firstMeasureDebugRafRef.current !== null) {
        window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      }
    }
  }, [])

  const debugApi = useMemo(() => ({
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
    dumpOsmdPreviewSystemMetrics,
    importFeedbackRef,
    importMusicXmlTextWithCollapseReset,
    latestPlayheadDebugSnapshotRef,
    measurePairsRef,
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
