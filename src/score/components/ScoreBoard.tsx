import { useEffect, useRef, type CSSProperties, type PointerEvent, type RefObject } from 'react'
import { SelectionInspector } from './SelectionInspector'

export function ScoreBoard(props: {
  scoreScrollRef: RefObject<HTMLDivElement | null>
  scoreStageRef: RefObject<HTMLDivElement | null>
  playheadRef: RefObject<HTMLDivElement | null>
  displayScoreWidth: number
  displayScoreHeight: number
  chordMarkerStyleMetrics: {
    buttonHeightPx: number
    fontSizePx: number
    paddingInlinePx: number
    paddingBlockPx: number
    borderRadiusPx: number
    inlineTopPx: number
    inlineHeightPx: number
    stripHeightPx: number
  }
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
  chordRulerMarkers: Array<{
    key: string
    xPx: number
    sourceLabel: string
    displayLabel: string
    isActive: boolean
    pairIndex: number
    positionText: string
    beatIndex?: number | null
  }>
  onChordRulerMarkerClick: (markerKey: string) => void
  playheadRectPx?: { x: number; y: number; width: number; height: number } | null
  playheadStatus: 'idle' | 'playing'
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
  playheadDebugLogText: string
}) {
  const {
    scoreScrollRef,
    scoreStageRef,
    playheadRef,
    displayScoreWidth,
    displayScoreHeight,
    chordMarkerStyleMetrics,
    scoreSurfaceLogicalWidthPx,
    scoreSurfaceLogicalHeightPx,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    measureRulerTicks,
    chordRulerMarkers,
    onChordRulerMarkerClick,
    playheadRectPx = null,
    playheadStatus,
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
    playheadDebugLogText,
  } = props
  const playheadDebugLogRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const logElement = playheadDebugLogRef.current
    if (!logElement) return
    logElement.scrollTop = logElement.scrollHeight
  }, [playheadDebugLogText])

  const rulerStripStyle: CSSProperties = {
    width: `${displayScoreWidth}px`,
    ['--chord-ruler-strip-height' as string]: `${chordMarkerStyleMetrics.stripHeightPx}px`,
    ['--chord-ruler-inline-top' as string]: `${chordMarkerStyleMetrics.inlineTopPx}px`,
    ['--chord-ruler-inline-height' as string]: `${chordMarkerStyleMetrics.inlineHeightPx}px`,
    ['--chord-ruler-marker-height' as string]: `${chordMarkerStyleMetrics.buttonHeightPx}px`,
    ['--chord-ruler-marker-padding-inline' as string]: `${chordMarkerStyleMetrics.paddingInlinePx}px`,
    ['--chord-ruler-marker-padding-block' as string]: `${chordMarkerStyleMetrics.paddingBlockPx}px`,
    ['--chord-ruler-marker-radius' as string]: `${chordMarkerStyleMetrics.borderRadiusPx}px`,
    ['--chord-ruler-label-font-size' as string]: `${chordMarkerStyleMetrics.fontSizePx}px`,
  }

  return (
    <section className="board">
      <div className="score-scroll horizontal-view" ref={scoreScrollRef} tabIndex={0}>
        <div className="score-ruler-strip" style={rulerStripStyle}>
          <div className="measure-ruler-inline" aria-hidden="true">
            {measureRulerTicks.map((tick) => (
              <div className="measure-ruler-tick" key={tick.key} style={{ left: `${tick.xPx}px` }}>
                <span className="measure-ruler-label">{tick.label}</span>
                <span className="measure-ruler-mark" />
              </div>
            ))}
          </div>
          <div className="chord-ruler-inline">
            {chordRulerMarkers.map((marker) => (
              <button
                type="button"
                className={`chord-ruler-marker${marker.isActive ? ' is-active' : ''}`}
                key={marker.key}
                style={{ left: `${marker.xPx}px` }}
                onClick={() => onChordRulerMarkerClick(marker.key)}
                aria-label={`第${marker.pairIndex + 1}小节${marker.positionText}和弦 ${marker.displayLabel}`}
              >
                <span className="chord-ruler-label">{marker.displayLabel}</span>
              </button>
            ))}
          </div>
        </div>
        <div
          className="score-stage horizontal-view"
          ref={scoreStageRef}
          style={{ width: `${displayScoreWidth}px`, height: `${displayScoreHeight}px` }}
        >
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
          {playheadRectPx && (
            <div
              ref={playheadRef}
              className={`score-playhead${playheadStatus === 'playing' ? ' is-playing' : ''}`}
              style={{
                left: `${playheadRectPx.x}px`,
                top: `${playheadRectPx.y}px`,
                width: `${playheadRectPx.width}px`,
                height: `${playheadRectPx.height}px`,
              }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      <section className="playhead-debug-panel">
        <h2>播放线位置日志</h2>
        <textarea
          ref={playheadDebugLogRef}
          className="debug-log"
          readOnly
          value={playheadDebugLogText}
          spellCheck={false}
          aria-label="播放线位置日志"
        />
      </section>

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
