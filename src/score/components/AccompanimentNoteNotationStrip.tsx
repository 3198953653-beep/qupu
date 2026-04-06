import { useLayoutEffect, useRef, useState } from 'react'
import { Renderer } from 'vexflow'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import { solveHorizontalMeasureWidths } from '../layout/horizontalMeasureWidthSolver'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import { resolveActualStartDecorationWidths, resolveStartDecorationDisplayMetas } from '../layout/startDecorationReserve'
import { drawMeasureToContext } from '../render/drawMeasure'
import type { AccompanimentRenderMeasure } from '../hooks/useAccompanimentNoteDialogController'
import type { SpacingLayoutMode } from '../types'

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

const STRIP_PADDING_X_PX = 18
const BARLINE_GAP_PX = 3
const BARLINE_THIN_WIDTH_PX = 1
const BARLINE_THICK_WIDTH_PX = 3

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

export function AccompanimentNoteNotationStrip(props: {
  measures: AccompanimentRenderMeasure[]
  selectedCandidateKey: string | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  onPreviewByMeasure: (measureNumber: number) => void
  onApplyByMeasure: (measureNumber: number) => void
}) {
  const {
    measures,
    selectedCandidateKey,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    grandStaffLayoutMetrics,
    onPreviewByMeasure,
    onApplyByMeasure,
  } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [slots, setSlots] = useState<MeasureSlotLayout[]>([])
  const renderHeightPx = getRenderHeightPx(grandStaffLayoutMetrics)
  const viewportHeightPx = getViewportHeightPx(grandStaffLayoutMetrics)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    if (measures.length === 0) {
      const context = canvas.getContext('2d')
      if (context) context.clearRect(0, 0, canvas.width, canvas.height)
      setSlots([])
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

    measures.forEach((measure, index) => {
      const frame = measureFrames[index]
      if (!frame) return
      const highlightSelections = measure.highlightSelections
      const activeSelection = highlightSelections[0] ?? null
      const activeSelections = highlightSelections.length > 0 ? highlightSelections : null
      drawMeasureToContext({
        context,
        measure: measure.measurePair,
        pairIndex: measure.pairIndex,
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
        collectLayouts: false,
        showMeasureNumberLabel: false,
        timeAxisSpacingConfig,
        spacingLayoutMode,
        forceLeadingConnector: index > 0,
        onStaffLineBounds: (bounds) => {
          staffBoundsByMeasure[index] = bounds
        },
      })
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
                  onClick={() => onPreviewByMeasure(slot.measureNumber)}
                  onDoubleClick={() => onApplyByMeasure(slot.measureNumber)}
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
