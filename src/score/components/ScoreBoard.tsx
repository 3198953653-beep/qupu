import { useEffect, useRef, type CSSProperties, type PointerEvent, type RefObject } from 'react'
import { SelectionInspector } from './SelectionInspector'
import { ScoreSurfaceStage } from './ScoreSurfaceStage'

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
  timelineSegmentBlocks: Array<{
    key: string
    scopeKey: string
    segmentNumber: number
    startPairIndex: number
    endPairIndexInclusive: number
    leftPx: number
    widthPx: number
    variant: 'odd' | 'even'
    measureStartNumber: number
    measureEndNumber: number
    isActive: boolean
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
  showChordMarkerBackgroundEnabled: boolean
  onTimelineSegmentClick: (segmentKey: string) => void
  onTimelineSegmentDoubleClick: (scopeKey: string) => void
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
    timelineSegmentBlocks,
    chordRulerMarkers,
    showChordMarkerBackgroundEnabled,
    onTimelineSegmentClick,
    onTimelineSegmentDoubleClick,
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
  const firstTimelineSegment = timelineSegmentBlocks[0] ?? null
  const lastTimelineSegment = timelineSegmentBlocks[timelineSegmentBlocks.length - 1] ?? null
  const rulerEdgeMaskBleedPx = 1
  const clampRulerMaskLeftPx = (rawLeftPx: number) => Math.max(0, Math.min(displayScoreWidth, rawLeftPx))
  const clampRulerMaskWidthPx = (rawWidthPx: number) =>
    Math.max(0, Math.min(displayScoreWidth, rawWidthPx))
  const leadingEdgeMaskStyle: CSSProperties | null = firstTimelineSegment
    ? {
        left: '0px',
        width: `${clampRulerMaskWidthPx(firstTimelineSegment.leftPx + rulerEdgeMaskBleedPx)}px`,
      }
    : null
  const trailingEdgeMaskStyle: CSSProperties | null = lastTimelineSegment
    ? {
        left: `${clampRulerMaskLeftPx(
          lastTimelineSegment.leftPx + lastTimelineSegment.widthPx - rulerEdgeMaskBleedPx,
        )}px`,
        width: `${clampRulerMaskWidthPx(
          displayScoreWidth - (lastTimelineSegment.leftPx + lastTimelineSegment.widthPx - rulerEdgeMaskBleedPx),
        )}px`,
      }
    : null

  return (
    <section className="board">
      <div className="score-scroll horizontal-view" ref={scoreScrollRef} tabIndex={0}>
        <div className="score-ruler-strip" style={rulerStripStyle}>
          <div className="segment-ruler-inline" aria-label="时间轴段落">
            {timelineSegmentBlocks.map((segment) => (
              <button
                type="button"
                className={`segment-ruler-block segment-ruler-block-${segment.variant}${segment.isActive ? ' is-active' : ''}`}
                key={segment.key}
                style={{
                  left: `${segment.leftPx}px`,
                  width: `${segment.widthPx}px`,
                }}
                onClick={() => onTimelineSegmentClick(segment.key)}
                onDoubleClick={() => onTimelineSegmentDoubleClick(segment.scopeKey)}
                title={`第 ${segment.segmentNumber} 段（第 ${segment.measureStartNumber}-${segment.measureEndNumber} 小节）`}
                aria-label={`第 ${segment.segmentNumber} 段，第 ${segment.measureStartNumber} 到第 ${segment.measureEndNumber} 小节`}
                aria-pressed={segment.isActive}
              />
            ))}
          </div>
          <div className="measure-ruler-inline" aria-hidden="true">
            {measureRulerTicks.map((tick) => (
              <div className="measure-ruler-tick" key={tick.key} style={{ left: `${tick.xPx}px` }}>
                <span className="measure-ruler-label">{tick.label}</span>
                <span className="measure-ruler-mark" />
              </div>
            ))}
          </div>
          {leadingEdgeMaskStyle && (
            <div className="segment-ruler-edge-mask segment-ruler-edge-mask-leading" style={leadingEdgeMaskStyle} />
          )}
          {trailingEdgeMaskStyle && (
            <div className="segment-ruler-edge-mask segment-ruler-edge-mask-trailing" style={trailingEdgeMaskStyle} />
          )}
          <div className={`chord-ruler-inline${showChordMarkerBackgroundEnabled ? '' : ' is-text-only'}`}>
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
        <ScoreSurfaceStage
          stageRef={scoreStageRef}
          playheadRef={playheadRef}
          displayWidth={displayScoreWidth}
          displayHeight={displayScoreHeight}
          selectedMeasureHighlightRectPx={selectedMeasureHighlightRectPx}
          playheadRectPx={playheadRectPx}
          playheadStatus={playheadStatus}
          includeScrollWrapper={false}
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
        </ScoreSurfaceStage>
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
