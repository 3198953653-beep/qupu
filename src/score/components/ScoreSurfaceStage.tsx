import type { ReactNode, RefObject } from 'react'
import type { HighlightRectPx } from '../highlightRect'

function joinClassNames(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(' ')
}

export function ScoreSurfaceStage(props: {
  displayWidth: number
  displayHeight: number
  children: ReactNode
  scrollRef?: RefObject<HTMLDivElement | null>
  stageRef?: RefObject<HTMLDivElement | null>
  playheadRef?: RefObject<HTMLDivElement | null>
  selectedMeasureHighlightRectPx?: HighlightRectPx | null
  playheadRectPx?: HighlightRectPx | null
  playheadStatus?: 'idle' | 'playing'
  scrollClassName?: string
  stageClassName?: string
  scrollTabIndex?: number
  includeScrollWrapper?: boolean
}) {
  const {
    displayWidth,
    displayHeight,
    children,
    scrollRef,
    stageRef,
    playheadRef,
    selectedMeasureHighlightRectPx = null,
    playheadRectPx = null,
    playheadStatus = 'idle',
    scrollClassName,
    stageClassName,
    scrollTabIndex,
    includeScrollWrapper = true,
  } = props

  const stage = (
    <div
      className={joinClassNames('score-stage horizontal-view', stageClassName)}
      ref={stageRef}
      style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
    >
      {children}
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
  )

  if (!includeScrollWrapper) return stage

  return (
    <div
      className={joinClassNames('score-scroll horizontal-view', scrollClassName)}
      ref={scrollRef}
      tabIndex={scrollTabIndex}
    >
      {stage}
    </div>
  )
}
