import type { PointerEvent, RefObject } from 'react'
import { SelectionInspector } from './SelectionInspector'

export function ScoreBoard(props: {
  scoreScrollRef: RefObject<HTMLDivElement | null>
  displayScoreWidth: number
  displayScoreHeight: number
  scoreSurfaceLogicalWidthPx: number
  scoreSurfaceLogicalHeightPx: number
  scoreScaleX: number
  scoreScaleY: number
  scoreSurfaceOffsetXPx: number
  scoreSurfaceOffsetYPx: number
  measureRulerTicks: Array<{
    key: string
    xPx: number
    label: string
  }>
  selectedMeasureHighlightRectPx?: { x: number; y: number; width: number; height: number } | null
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
}) {
  const {
    scoreScrollRef,
    displayScoreWidth,
    displayScoreHeight,
    scoreSurfaceLogicalWidthPx,
    scoreSurfaceLogicalHeightPx,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    measureRulerTicks,
    selectedMeasureHighlightRectPx = null,
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
  } = props

  return (
    <section className="board">
      <div className="score-scroll horizontal-view" ref={scoreScrollRef} tabIndex={0}>
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
              width: `${scoreSurfaceLogicalWidthPx}px`,
              height: `${scoreSurfaceLogicalHeightPx}px`,
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
              width: `${scoreSurfaceLogicalWidthPx}px`,
              height: `${scoreSurfaceLogicalHeightPx}px`,
              transform: `scale(${scoreScaleX}, ${scoreScaleY})`,
              transformOrigin: 'left top',
            }}
          />
          {selectedMeasureHighlightRectPx && (
            <div
              className="score-measure-highlight"
              style={{
                left: `${selectedMeasureHighlightRectPx.x}px`,
                top: `${selectedMeasureHighlightRectPx.y}px`,
                width: `${selectedMeasureHighlightRectPx.width}px`,
                height: `${selectedMeasureHighlightRectPx.height}px`,
              }}
              aria-hidden="true"
            />
          )}
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
      />
    </section>
  )
}
