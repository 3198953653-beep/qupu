import type { ChangeEvent } from 'react'
import type { ScoreControlsProps } from './types'

type ScoreDisplayControlsProps = Pick<
  ScoreControlsProps,
  | 'autoScaleEnabled'
  | 'manualScalePercent'
  | 'onManualScalePercentChange'
  | 'canvasHeightPercent'
  | 'onCanvasHeightPercentChange'
>

export function ScoreDisplayControls(props: ScoreDisplayControlsProps) {
  const {
    autoScaleEnabled,
    manualScalePercent,
    onManualScalePercentChange,
    canvasHeightPercent,
    onCanvasHeightPercentChange,
  } = props

  const handleScaleValue = (rawValue: string) => {
    onManualScalePercentChange(Number(rawValue))
  }

  const handleCanvasHeightChange = (event: ChangeEvent<HTMLInputElement>) => {
    onCanvasHeightPercentChange(Number(event.target.value))
  }

  return (
    <>
      <section className="scale-row">
        <label htmlFor="manual-scale-range">手动缩放</label>
        <input
          id="manual-scale-range"
          type="range"
          min={55}
          max={300}
          step={1}
          value={manualScalePercent}
          disabled={autoScaleEnabled}
          onInput={(event) => handleScaleValue((event.target as HTMLInputElement).value)}
          onChange={(event) => handleScaleValue(event.target.value)}
        />
        <input
          className="scale-percent-input"
          type="number"
          min={55}
          max={300}
          step={1}
          value={manualScalePercent}
          disabled={autoScaleEnabled}
          onInput={(event) => handleScaleValue((event.target as HTMLInputElement).value)}
          onChange={(event) => handleScaleValue(event.target.value)}
        />
        <span className="scale-percent-label">%</span>
      </section>

      <section className="scale-row">
        <label htmlFor="canvas-height-range">画布高度</label>
        <input
          id="canvas-height-range"
          type="range"
          min={70}
          max={260}
          step={1}
          value={canvasHeightPercent}
          onInput={(event) => onCanvasHeightPercentChange(Number((event.target as HTMLInputElement).value))}
          onChange={handleCanvasHeightChange}
        />
        <input
          className="scale-percent-input"
          type="number"
          min={70}
          max={260}
          step={1}
          value={canvasHeightPercent}
          onInput={(event) => onCanvasHeightPercentChange(Number((event.target as HTMLInputElement).value))}
          onChange={handleCanvasHeightChange}
        />
        <span className="scale-percent-label">%</span>
      </section>
    </>
  )
}
