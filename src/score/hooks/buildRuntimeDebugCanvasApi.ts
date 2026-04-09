import type { MutableRefObject } from 'react'
import type { ChordRulerEntry } from '../chordRuler'
import { buildPedalRenderPlan } from '../render/drawPedalSpans'
import type { MeasureTimelineBundle } from '../timeline/types'
import type {
  ActivePedalSelection,
  DragDebugSnapshot,
  DragState,
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  PedalSpan,
  ScoreNote,
} from '../types'
import type { OsmdPreviewInstance, OsmdPreviewRebalanceStats } from './useOsmdPreviewController'

export function buildRuntimeDebugCanvasApi(params: {
  dumpAllMeasureCoordinateReport: () => unknown
  dumpOsmdPreviewSystemMetrics: () => unknown
  dumpNativePreviewLayoutDiagnostics: () => unknown
  osmdPreviewLastRebalanceStatsRef: MutableRefObject<OsmdPreviewRebalanceStats | null>
  osmdPreviewInstanceRef: MutableRefObject<OsmdPreviewInstance | null>
  dragDebugFramesRef: MutableRefObject<DragDebugSnapshot[]>
  dragRef: MutableRefObject<DragState | null>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  measureTimelineBundlesRef: MutableRefObject<Map<number, MeasureTimelineBundle>>
  measurePairsRef: MutableRefObject<MeasurePair[]>
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  pedalSpans: PedalSpan[]
  activePedalSelection: ActivePedalSelection | null
  scoreOverlayRef: MutableRefObject<HTMLCanvasElement | null>
  scoreRef: MutableRefObject<HTMLCanvasElement | null>
  overlayLastRectRef: MutableRefObject<MeasureLayout['overlayRect'] | null>
  scoreScale: number
  safeCurrentPage: number
  pageCount: number
  systemsPerPage: number
  visibleSystemRange: { start: number; end: number }
}) {
  const {
    dumpAllMeasureCoordinateReport,
    dumpOsmdPreviewSystemMetrics,
    dumpNativePreviewLayoutDiagnostics,
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewInstanceRef,
    dragDebugFramesRef,
    dragRef,
    measureLayoutsRef,
    noteLayoutsByPairRef,
    measureTimelineBundlesRef,
    measurePairsRef,
    chordRulerEntriesByPair,
    pedalSpans,
    activePedalSelection,
    scoreOverlayRef,
    scoreRef,
    overlayLastRectRef,
    scoreScale,
    safeCurrentPage,
    pageCount,
    systemsPerPage,
    visibleSystemRange,
  } = params

  return {
    dumpAllMeasureCoordinates: () => dumpAllMeasureCoordinateReport(),
    getOsmdPreviewSystemMetrics: () => dumpOsmdPreviewSystemMetrics(),
    dumpNativePreviewLayoutDiagnostics: () => dumpNativePreviewLayoutDiagnostics(),
    getOsmdPreviewRebalanceStats: () => osmdPreviewLastRebalanceStatsRef.current,
    getOsmdPreviewInstance: () => osmdPreviewInstanceRef.current,
    getPedalRenderPlan: () => {
      const canvasContext = scoreRef.current?.getContext('2d') ?? null
      return buildPedalRenderPlan({
        context2D: canvasContext,
        measurePairs: measurePairsRef.current,
        pedalSpans,
        activePedalSelection,
        chordRulerEntriesByPair,
        measureLayouts: measureLayoutsRef.current,
        measureTimelineBundles: measureTimelineBundlesRef.current,
        noteLayoutsByPair: noteLayoutsByPairRef.current,
      }).map((entry) => ({
        span: { ...entry.span },
        layoutMode: entry.layoutMode,
        systemKey: entry.systemKey,
        baseStartX: entry.baseStartX,
        baseEndX: entry.baseEndX,
        startX: entry.startX,
        endX: entry.endX,
        occupiedStartX: entry.occupiedStartX,
        occupiedEndX: entry.occupiedEndX,
        baseBaselineY: entry.baseBaselineY,
        maxBaselineY: entry.maxBaselineY,
        autoBaselineY: entry.autoBaselineY,
        manualBaselineOffsetPx: entry.manualBaselineOffsetPx,
        resolvedBaselineY: entry.resolvedBaselineY,
        baselineY: entry.baselineY,
        pedalTopY: entry.pedalTopY,
        collisionBottomY: entry.collisionBottomY,
        requiredBaselineY: entry.requiredBaselineY,
        laneIndex: entry.laneIndex,
        requiredStartX: entry.requiredStartX,
        requiredEndX: entry.requiredEndX,
        hitLeftX: entry.hitLeftX,
        hitRightX: entry.hitRightX,
        hitTopY: entry.hitTopY,
        hitBottomY: entry.hitBottomY,
        isActive: entry.isActive,
      }))
    },
    getDragPreviewFrames: () =>
      dragDebugFramesRef.current.map((frame) => ({
        ...frame,
        rows: frame.rows.map((row) => ({ ...row })),
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
  }
}
