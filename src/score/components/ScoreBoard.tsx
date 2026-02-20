import type { PointerEvent, RefObject } from 'react'
import { SelectionInspector } from './SelectionInspector'

export function ScoreBoard(props: {
  scoreScrollRef: RefObject<HTMLDivElement | null>
  displayScoreWidth: number
  displayScoreHeight: number
  scoreScaleX: number
  scoreScaleY: number
  scoreSurfaceOffsetXPx: number
  isHorizontalView: boolean
  currentPage: number
  pageCount: number
  onPrevPage: () => void
  onNextPage: () => void
  onGoToPage: (pageIndex: number) => void
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
    isHorizontalView,
    currentPage,
    pageCount,
    onPrevPage,
    onNextPage,
    onGoToPage,
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
      {!isHorizontalView && (
        <div className="page-nav">
          <button type="button" onClick={() => onGoToPage(0)} disabled={currentPage <= 0}>
            首页
          </button>
          <button type="button" onClick={onPrevPage} disabled={currentPage <= 0}>
            上一页
          </button>
          <p className="page-label">
            第 <strong>{currentPage + 1}</strong> / {pageCount} 页
          </p>
          <button type="button" onClick={onNextPage} disabled={currentPage >= pageCount - 1}>
            下一页
          </button>
          <button type="button" onClick={() => onGoToPage(pageCount - 1)} disabled={currentPage >= pageCount - 1}>
            末页
          </button>
        </div>
      )}
      <div className={`score-scroll ${isHorizontalView ? 'horizontal-view' : ''}`} ref={scoreScrollRef}>
        <div className={`score-stage ${isHorizontalView ? 'horizontal-view' : ''}`} style={{ width: `${displayScoreWidth}px`, height: `${displayScoreHeight}px` }}>
          <canvas
            className={`score-surface ${draggingSelection ? 'is-dragging' : ''}`}
            ref={scoreRef}
            style={{
              left: `${scoreSurfaceOffsetXPx}px`,
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
