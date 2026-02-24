import type { PointerEvent, RefObject } from 'react'
import { SelectionInspector } from './SelectionInspector'

export function ScoreBoard(props: {
  scoreScrollRef: RefObject<HTMLDivElement | null>
  displayScoreWidth: number
  displayScoreHeight: number
  scoreScaleX: number
  scoreScaleY: number
  scoreSurfaceOffsetXPx: number
  scoreSurfaceOffsetYPx: number
  measureRulerTicks: Array<{
    key: string
    xPx: number
    label: string
  }>
  draggingSelection: { noteId: string; staff: 'treble' | 'bass'; keyIndex: number } | null
  scoreRef: RefObject<HTMLCanvasElement | null>
  scoreOverlayRef: RefObject<HTMLCanvasElement | null>
  onBeginDrag: (event: PointerEvent<HTMLCanvasElement>) => void
  onSurfacePointerMove: (event: PointerEvent<HTMLCanvasElement>) => void
  onEndDrag: (event: PointerEvent<HTMLCanvasElement>) => void
  selectedStaffLabel: string
  selectedPitchLabel: string
  selectedDurationLabel: string
  selectedPosition: number
  selectedPoolSize: number
  trebleSequenceText: string
  bassSequenceText: string
  dragDebugReport: string
  onDumpDragLog: () => void
  onClearDragLog: () => void
  measureEdgeDebugReport: string
  onDumpMeasureEdgeLog: () => void
  onClearMeasureEdgeLog: () => void
}) {
  const {
    scoreScrollRef,
    displayScoreWidth,
    displayScoreHeight,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    measureRulerTicks,
    draggingSelection,
    scoreRef,
    scoreOverlayRef,
    onBeginDrag,
    onSurfacePointerMove,
    onEndDrag,
    selectedStaffLabel,
    selectedPitchLabel,
    selectedDurationLabel,
    selectedPosition,
    selectedPoolSize,
    trebleSequenceText,
    bassSequenceText,
    dragDebugReport,
    onDumpDragLog,
    onClearDragLog,
    measureEdgeDebugReport,
    onDumpMeasureEdgeLog,
    onClearMeasureEdgeLog,
  } = props

  return (
    <section className="board">
      <div className="score-scroll horizontal-view" ref={scoreScrollRef}>
        <div className="score-ruler-strip" style={{ width: `${displayScoreWidth}px` }} aria-hidden="true">
          <div className="measure-ruler-inline">
            {measureRulerTicks.map((tick) => (
              <div className="measure-ruler-tick" key={tick.key} style={{ left: `${tick.xPx}px` }}>
                <span className="measure-ruler-label">{tick.label}</span>
                <span className="measure-ruler-mark" />
              </div>
            ))}
          </div>
        </div>
        <div className="score-stage horizontal-view" style={{ width: `${displayScoreWidth}px`, height: `${displayScoreHeight}px` }}>
          <canvas
            className={`score-surface ${draggingSelection ? 'is-dragging' : ''}`}
            ref={scoreRef}
            style={{
              left: `${scoreSurfaceOffsetXPx}px`,
              top: `${scoreSurfaceOffsetYPx}px`,
              transform: `scale(${scoreScaleX}, ${scoreScaleY})`,
              transformOrigin: 'left top',
            }}
            onPointerDown={onBeginDrag}
            onPointerMove={onSurfacePointerMove}
            onPointerUp={onEndDrag}
            onPointerCancel={onEndDrag}
          />
          <canvas
            className="score-overlay"
            ref={scoreOverlayRef}
            width={1}
            height={1}
            style={{
              left: `${scoreSurfaceOffsetXPx}px`,
              top: `${scoreSurfaceOffsetYPx}px`,
              transform: `scale(${scoreScaleX}, ${scoreScaleY})`,
              transformOrigin: 'left top',
            }}
          />
        </div>
      </div>

      <SelectionInspector
        selectedStaffLabel={selectedStaffLabel}
        selectedPitchLabel={selectedPitchLabel}
        selectedDurationLabel={selectedDurationLabel}
        selectedPosition={selectedPosition}
        selectedPoolSize={selectedPoolSize}
        trebleSequenceText={trebleSequenceText}
        bassSequenceText={bassSequenceText}
        dragDebugReport={dragDebugReport}
        onDumpDragLog={onDumpDragLog}
        onClearDragLog={onClearDragLog}
        measureEdgeDebugReport={measureEdgeDebugReport}
        onDumpMeasureEdgeLog={onDumpMeasureEdgeLog}
        onClearMeasureEdgeLog={onClearMeasureEdgeLog}
      />
    </section>
  )
}
