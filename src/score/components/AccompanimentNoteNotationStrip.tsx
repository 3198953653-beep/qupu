import { useLayoutEffect, useRef, useState } from 'react'
import { Renderer } from 'vexflow'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import { resolveEffectiveBoundary } from '../layout/effectiveBoundary'
import { solveHorizontalMeasureWidths } from '../layout/horizontalMeasureWidthSolver'
import {
  type AppliedTimeAxisSpacingMetrics,
  attachMeasureTimelineAxisLayout,
  buildMeasureTimelineBundle,
  resolvePublicAxisLayoutForConsumption,
  type TimeAxisSpacingConfig,
} from '../layout/timeAxisSpacing'
import { resolveActualStartDecorationWidths, resolveStartDecorationDisplayMetas } from '../layout/startDecorationReserve'
import { drawPedalSpans } from '../render/drawPedalSpans'
import { drawMeasureToContext } from '../render/drawMeasure'
import type { AccompanimentRenderMeasure } from '../hooks/useAccompanimentNoteDialogController'
import type { MeasureLayout, NoteLayout, PedalSpan, PlaybackCursorRect, SpacingLayoutMode } from '../types'
import type { MeasureTimelineBundle } from '../timeline/types'

type MeasureSlotLayout = {
  measureNumber: number
  candidateKey: string
  leftPx: number
  widthPx: number
}

type StaffLineBounds = {
  trebleLineTopY: number
  trebleLineBottomY: number
  bassLineTopY: number
  bassLineBottomY: number
}

type MeasurePlaybackGeometry = {
  measureNumber: number
  candidateKey: string
  playheadRect: PlaybackCursorRect
  highlightRect: PlaybackCursorRect
  measureTicks: number
  tickXs: Array<{ tick: number; x: number }>
}

const STRIP_PADDING_X_PX = 18
const BARLINE_GAP_PX = 3
const BARLINE_THIN_WIDTH_PX = 1
const BARLINE_THICK_WIDTH_PX = 3

function consumeInteractionEvent(event: {
  preventDefault: () => void
  stopPropagation: () => void
}): void {
  event.preventDefault()
  event.stopPropagation()
}

function getRenderHeightPx(grandStaffLayoutMetrics: GrandStaffLayoutMetrics): number {
  return Math.max(220, Math.ceil(grandStaffLayoutMetrics.systemHeightPx + 20))
}

function getViewportHeightPx(grandStaffLayoutMetrics: GrandStaffLayoutMetrics): number {
  return Math.max(260, Math.ceil(grandStaffLayoutMetrics.systemHeightPx + 44))
}

function drawCandidateEndSeparator(params: {
  context: ReturnType<Renderer['getContext']>
  x: number
  topY: number
  bottomY: number
}): void {
  const { context, x, topY, bottomY } = params
  const context2D = (context as unknown as { context2D?: CanvasRenderingContext2D }).context2D
  if (!context2D) return

  const safeTopY = Math.min(topY, bottomY)
  const safeBottomY = Math.max(topY, bottomY)
  context2D.save()
  context2D.strokeStyle = '#2f2f2f'
  context2D.lineCap = 'butt'

  context2D.lineWidth = BARLINE_THIN_WIDTH_PX
  context2D.beginPath()
  context2D.moveTo(x - BARLINE_GAP_PX, safeTopY)
  context2D.lineTo(x - BARLINE_GAP_PX, safeBottomY)
  context2D.stroke()

  context2D.lineWidth = BARLINE_THICK_WIDTH_PX
  context2D.beginPath()
  context2D.moveTo(x, safeTopY)
  context2D.lineTo(x, safeBottomY)
  context2D.stroke()

  context2D.restore()
}

function resolvePlayheadX(params: {
  geometry: MeasurePlaybackGeometry
  playbackTick: number
}): number {
  const { geometry, playbackTick } = params
  const tickXs = geometry.tickXs
  if (tickXs.length === 0) return geometry.playheadRect.x
  const clampedTick = Math.max(0, Math.min(geometry.measureTicks, playbackTick))
  if (clampedTick <= tickXs[0]!.tick) return tickXs[0]!.x

  for (let index = 1; index < tickXs.length; index += 1) {
    const left = tickXs[index - 1]!
    const right = tickXs[index]!
    if (clampedTick <= right.tick) {
      const span = Math.max(1, right.tick - left.tick)
      const ratio = Math.max(0, Math.min(1, (clampedTick - left.tick) / span))
      return left.x + (right.x - left.x) * ratio
    }
  }

  return tickXs[tickXs.length - 1]!.x
}

export function AccompanimentNoteNotationStrip(props: {
  measures: AccompanimentRenderMeasure[]
  selectedCandidateKey: string | null
  playingMeasureNumber: number | null
  playbackTick: number | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  onPreviewByMeasure: (measureNumber: number) => void
  onApplyByMeasure: (measureNumber: number) => void
}) {
  const {
    measures,
    selectedCandidateKey,
    playingMeasureNumber,
    playbackTick,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    grandStaffLayoutMetrics,
    onPreviewByMeasure,
    onApplyByMeasure,
  } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [slots, setSlots] = useState<MeasureSlotLayout[]>([])
  const [playbackGeometries, setPlaybackGeometries] = useState<MeasurePlaybackGeometry[]>([])
  const renderHeightPx = getRenderHeightPx(grandStaffLayoutMetrics)
  const viewportHeightPx = getViewportHeightPx(grandStaffLayoutMetrics)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    if (measures.length === 0) {
      const context = canvas.getContext('2d')
      if (context) context.clearRect(0, 0, canvas.width, canvas.height)
      setSlots([])
      setPlaybackGeometries([])
      return undefined
    }

    const renderer = new Renderer(canvas, Renderer.Backends.CANVAS)
    renderer.resize(1, renderHeightPx)
    const context = renderer.getContext()
    context.clearRect(0, 0, canvas.width, renderHeightPx)

    const measurePairs = measures.map((entry) => entry.measurePair)
    const keyFifthsByPair = measures.map((entry) => entry.keyFifths)
    const timeSignaturesByPair = measures.map((entry) => entry.timeSignature)
    const contentWidths = solveHorizontalMeasureWidths({
      context,
      measurePairs,
      measureKeyFifthsByPair: keyFifthsByPair,
      measureTimeSignaturesByPair: timeSignaturesByPair,
      spacingConfig: timeAxisSpacingConfig,
      grandStaffLayoutMetrics,
    })
    const displayMetas = resolveStartDecorationDisplayMetas({
      measureCount: measures.length,
      keyFifthsByPair,
      timeSignaturesByPair,
    })
    const { actualStartDecorationWidthPxByPair } = resolveActualStartDecorationWidths({
      metas: displayMetas,
      grandStaffLayoutMetrics,
    })

    let cursorX = STRIP_PADDING_X_PX
    const measureFrames = measures.map((_, index) => {
      const contentWidth = Number.isFinite(contentWidths[index]) ? Math.max(1, contentWidths[index] as number) : 1
      const startDecorationWidth = Math.max(
        0,
        Number.isFinite(actualStartDecorationWidthPxByPair[index])
          ? (actualStartDecorationWidthPxByPair[index] as number)
          : 0,
      )
      const frame = {
        measureX: cursorX,
        measureWidth: Math.max(1, Math.ceil(contentWidth + startDecorationWidth)),
      }
      cursorX += frame.measureWidth
      return frame
    })
    const totalWidth = Math.max(1, Math.ceil(cursorX + STRIP_PADDING_X_PX))

    if (canvas.width !== totalWidth || canvas.height !== renderHeightPx) {
      renderer.resize(totalWidth, renderHeightPx)
      context.clearRect(0, 0, totalWidth, renderHeightPx)
    }

    const systemTopY = Math.round((renderHeightPx - grandStaffLayoutMetrics.systemHeightPx) / 2)
    const trebleY = systemTopY + grandStaffLayoutMetrics.trebleOffsetY
    const bassY = systemTopY + grandStaffLayoutMetrics.bassOffsetY

    const staffBoundsByMeasure: Array<StaffLineBounds | null> = measures.map(() => null)
    const nextPlaybackGeometries: MeasurePlaybackGeometry[] = []
    const nextMeasureLayouts = new Map<number, MeasureLayout>()
    const nextMeasureTimelineBundles = new Map<number, MeasureTimelineBundle>()
    const nextNoteLayoutsByPair = new Map<number, NoteLayout[]>()
    const aggregatedPreviewPedalSpans: PedalSpan[] = []

    measures.forEach((measure, index) => {
      const frame = measureFrames[index]
      if (!frame) return
      const localPairIndex = index
      const highlightSelections = measure.highlightSelections
      const activeSelection = highlightSelections[0] ?? null
      const activeSelections = highlightSelections.length > 0 ? highlightSelections : null
      const effectiveBoundary = resolveEffectiveBoundary({
        measureX: frame.measureX,
        measureWidth: frame.measureWidth,
        noteStartX: frame.measureX,
        noteEndX: frame.measureX + frame.measureWidth,
        showStartDecorations: true,
        showEndDecorations: false,
      })
      const timelineBundle = attachMeasureTimelineAxisLayout({
        bundle: buildMeasureTimelineBundle({
          measure: measure.measurePair,
          measureIndex: localPairIndex,
          timeSignature: measure.timeSignature,
          spacingConfig: timeAxisSpacingConfig,
          timelineMode: 'merged',
          supplementalSpacingTicks: null,
        }),
        effectiveBoundaryStartX: effectiveBoundary.effectiveStartX,
        effectiveBoundaryEndX: effectiveBoundary.effectiveEndX,
        widthPx: frame.measureWidth,
        spacingConfig: timeAxisSpacingConfig,
      })
      nextMeasureTimelineBundles.set(localPairIndex, timelineBundle)
      const publicAxisLayout = resolvePublicAxisLayoutForConsumption(timelineBundle)
      let spacingMetrics: AppliedTimeAxisSpacingMetrics | null = null
      const noteLayouts = drawMeasureToContext({
        context,
        measure: measure.measurePair,
        pairIndex: localPairIndex,
        measureX: frame.measureX,
        measureWidth: frame.measureWidth,
        trebleY,
        bassY,
        isSystemStart: index === 0,
        keyFifths: measure.keyFifths,
        showKeySignature: index === 0 && measure.keyFifths !== 0,
        timeSignature: measure.timeSignature,
        showTimeSignature: index === 0,
        activeSelection,
        draggingSelection: null,
        activeSelections,
        draggingSelections: null,
        collectLayouts: true,
        showMeasureNumberLabel: false,
        timeAxisSpacingConfig,
        spacingLayoutMode,
        timelineBundle,
        publicAxisLayout,
        spacingAnchorTicks: timelineBundle.spacingAnchorTicks,
        forceLeadingConnector: index > 0,
        onSpacingMetrics: (metrics) => {
          spacingMetrics = metrics
        },
        onStaffLineBounds: (bounds) => {
          staffBoundsByMeasure[index] = bounds
        },
      })
      nextNoteLayoutsByPair.set(localPairIndex, noteLayouts)

      const bounds = staffBoundsByMeasure[index]
      const tickXs = publicAxisLayout
        ? [...publicAxisLayout.tickToX.entries()]
            .map(([tick, x]) => ({ tick, x }))
            .sort((left, right) => left.tick - right.tick)
        : [
            { tick: 0, x: frame.measureX },
            { tick: Math.max(1, timelineBundle.measureTicks), x: frame.measureX + frame.measureWidth },
          ]
      const topY = bounds?.trebleLineTopY ?? trebleY
      const bottomY = bounds?.bassLineBottomY ?? (bassY + grandStaffLayoutMetrics.staffLineSpanPx)
      const currentSpacingMetrics = spacingMetrics as AppliedTimeAxisSpacingMetrics | null
      nextMeasureLayouts.set(localPairIndex, {
        pairIndex: localPairIndex,
        measureX: frame.measureX,
        measureWidth: frame.measureWidth,
        contentMeasureWidth: frame.measureWidth,
        renderedMeasureWidth: frame.measureWidth,
        trebleY,
        bassY,
        trebleLineTopY: bounds?.trebleLineTopY ?? trebleY,
        trebleLineBottomY: bounds?.trebleLineBottomY ?? (trebleY + grandStaffLayoutMetrics.staffLineSpanPx),
        bassLineTopY: bounds?.bassLineTopY ?? bassY,
        bassLineBottomY: bounds?.bassLineBottomY ?? (bassY + grandStaffLayoutMetrics.staffLineSpanPx),
        systemTop: systemTopY,
        isSystemStart: index === 0,
        keyFifths: measure.keyFifths,
        showKeySignature: index === 0 && measure.keyFifths !== 0,
        timeSignature: measure.timeSignature,
        showTimeSignature: index === 0,
        endTimeSignature: null,
        showEndTimeSignature: false,
        includeMeasureStartDecorations: true,
        noteStartX: effectiveBoundary.effectiveStartX,
        noteEndX: effectiveBoundary.effectiveEndX,
        formatWidth: frame.measureWidth,
        sharedStartDecorationReservePx: actualStartDecorationWidthPxByPair[index] ?? 0,
        actualStartDecorationWidthPx: actualStartDecorationWidthPxByPair[index] ?? 0,
        effectiveBoundaryStartX: effectiveBoundary.effectiveStartX,
        effectiveBoundaryEndX: effectiveBoundary.effectiveEndX,
        effectiveLeftGapPx: 0,
        effectiveRightGapPx: 0,
        leadingGapPx: currentSpacingMetrics?.leadingGapPx,
        trailingTailTicks: currentSpacingMetrics?.trailingTailTicks,
        trailingGapPx: currentSpacingMetrics?.trailingGapPx,
        spacingOccupiedLeftX: currentSpacingMetrics?.spacingOccupiedLeftX,
        spacingOccupiedRightX: currentSpacingMetrics?.spacingOccupiedRightX,
        spacingAnchorGapFirstToLastPx: currentSpacingMetrics?.spacingAnchorGapFirstToLastPx,
        spacingOnsetReserves: currentSpacingMetrics?.spacingOnsetReserves,
        spacingSegments: currentSpacingMetrics?.spacingSegments,
        overlayRect: {
          x: frame.measureX,
          y: topY,
          width: frame.measureWidth,
          height: Math.max(1, bottomY - topY),
        },
      })
      measure.previewPedalSpans.forEach((span) => {
        aggregatedPreviewPedalSpans.push({
          ...span,
          startPairIndex: localPairIndex,
          endPairIndex: localPairIndex,
        })
      })
      nextPlaybackGeometries.push({
        measureNumber: measure.measureNumber,
        candidateKey: measure.candidateKey,
        playheadRect: {
          x: frame.measureX,
          y: topY,
          width: 2,
          height: Math.max(1, bottomY - topY),
        },
        highlightRect: {
          x: frame.measureX,
          y: Math.max(0, topY - 6),
          width: frame.measureWidth,
          height: Math.max(1, bottomY - topY + 12),
        },
        measureTicks: Math.max(1, timelineBundle.measureTicks),
        tickXs,
      })
    })

    const context2D = (context as unknown as { context2D?: CanvasRenderingContext2D }).context2D
    drawPedalSpans({
      context2D,
      measurePairs,
      pedalSpans: aggregatedPreviewPedalSpans,
      measureLayouts: nextMeasureLayouts,
      measureTimelineBundles: nextMeasureTimelineBundles,
      noteLayoutsByPair: nextNoteLayoutsByPair,
      chordRulerEntriesByPair: null,
    })

    for (let index = 0; index < measureFrames.length - 1; index += 1) {
      const frame = measureFrames[index]
      if (!frame) continue
      const bounds = staffBoundsByMeasure[index]
      const separatorTopY = bounds?.trebleLineTopY ?? trebleY
      const separatorBottomY = bounds?.bassLineBottomY ?? (bassY + grandStaffLayoutMetrics.staffLineSpanPx)
      drawCandidateEndSeparator({
        context,
        x: frame.measureX + frame.measureWidth,
        topY: separatorTopY,
        bottomY: separatorBottomY,
      })
    }

    setSlots(
      measures.map((measure, index) => {
        const frame = measureFrames[index]
        return {
          measureNumber: measure.measureNumber,
          candidateKey: measure.candidateKey,
          leftPx: frame?.measureX ?? STRIP_PADDING_X_PX,
          widthPx: Math.max(1, frame?.measureWidth ?? 1),
        }
      }),
    )
    setPlaybackGeometries(nextPlaybackGeometries)

    return undefined
  }, [
    grandStaffLayoutMetrics,
    measures,
    renderHeightPx,
    spacingLayoutMode,
    timeAxisSpacingConfig,
  ])

  return (
    <div className="smart-chord-notation-strip">
      <div className="smart-chord-notation-scroll">
        <div className="smart-chord-notation-stage-wrap" style={{ height: `${viewportHeightPx}px` }}>
          <div className="smart-chord-notation-stage">
            <canvas ref={canvasRef} className="smart-chord-notation-svg" />
            {playbackGeometries.map((geometry) => {
              const isSelected = selectedCandidateKey === geometry.candidateKey
              if (!isSelected) return null
              return (
                <div
                  key={`highlight-${geometry.candidateKey}`}
                  className="accompaniment-preview-highlight"
                  style={{
                    left: `${geometry.highlightRect.x}px`,
                    top: `${geometry.highlightRect.y}px`,
                    width: `${geometry.highlightRect.width}px`,
                    height: `${geometry.highlightRect.height}px`,
                  }}
                  aria-hidden="true"
                />
              )
            })}
            {playbackGeometries.map((geometry) => {
              if (playingMeasureNumber !== geometry.measureNumber || playbackTick === null) return null
              const playheadX = resolvePlayheadX({
                geometry,
                playbackTick,
              })
              return (
                <div
                  key={`playhead-${geometry.candidateKey}`}
                  className="score-playhead is-playing"
                  style={{
                    left: `${playheadX}px`,
                    top: `${geometry.playheadRect.y}px`,
                    width: `${geometry.playheadRect.width}px`,
                    height: `${geometry.playheadRect.height}px`,
                  }}
                  aria-hidden="true"
                />
              )
            })}
            <div className="smart-chord-notation-hit-layer">
              {slots.map((slot) => (
                <button
                  key={slot.candidateKey}
                  type="button"
                  className={`smart-chord-notation-slot${selectedCandidateKey === slot.candidateKey ? ' is-active' : ''}`}
                  style={{
                    left: `${slot.leftPx}px`,
                    width: `${slot.widthPx}px`,
                    top: '0px',
                    height: `${renderHeightPx}px`,
                  }}
                  onPointerDown={(event) => {
                    consumeInteractionEvent(event)
                  }}
                  onMouseDown={(event) => {
                    consumeInteractionEvent(event)
                  }}
                  onClick={(event) => {
                    consumeInteractionEvent(event)
                    onPreviewByMeasure(slot.measureNumber)
                  }}
                  onDoubleClick={(event) => {
                    consumeInteractionEvent(event)
                    onApplyByMeasure(slot.measureNumber)
                  }}
                  title={`候选 ${slot.measureNumber}`}
                  aria-label={`候选小节 ${slot.measureNumber}`}
                  aria-pressed={selectedCandidateKey === slot.candidateKey}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
