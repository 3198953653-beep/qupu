import type { PointerEvent, RefObject } from 'react'
import { SelectionInspector } from './SelectionInspector'

export function ScoreBoard(props: {
  scoreScrollRef: RefObject<HTMLDivElement | null>
  displayScoreWidth: number
  displayScoreHeight: number
  scoreScale: number
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
}) {
  const {
    scoreScrollRef,
    displayScoreWidth,
    displayScoreHeight,
    scoreScale,
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
  } = props

  return (
    <section className="board">
      <div className="page-nav">
        <button type="button" onClick={() => onGoToPage(0)} disabled={currentPage <= 0}>
          First
        </button>
        <button type="button" onClick={onPrevPage} disabled={currentPage <= 0}>
          Prev
        </button>
        <p className="page-label">
          Page <strong>{currentPage + 1}</strong> / {pageCount}
        </p>
        <button type="button" onClick={onNextPage} disabled={currentPage >= pageCount - 1}>
          Next
        </button>
        <button type="button" onClick={() => onGoToPage(pageCount - 1)} disabled={currentPage >= pageCount - 1}>
          Last
        </button>
      </div>
      <div className="score-scroll" ref={scoreScrollRef}>
        <div className="score-stage" style={{ width: `${displayScoreWidth}px`, height: `${displayScoreHeight}px` }}>
          <canvas
            className={`score-surface ${draggingSelection ? 'is-dragging' : ''}`}
            ref={scoreRef}
            style={{ transform: `scale(${scoreScale})`, transformOrigin: 'left top' }}
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
            style={{ transform: `scale(${scoreScale})`, transformOrigin: 'left top' }}
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
      />
    </section>
  )
}
