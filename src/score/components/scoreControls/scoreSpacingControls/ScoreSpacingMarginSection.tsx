import { handleFloatValue, type ScoreSpacingControlsProps } from './shared'

type ScoreSpacingMarginSectionProps = Pick<
  ScoreSpacingControlsProps,
  'pageHorizontalPaddingPx' | 'onPageHorizontalPaddingPxChange'
>

export function ScoreSpacingMarginSection(props: ScoreSpacingMarginSectionProps) {
  const { pageHorizontalPaddingPx, onPageHorizontalPaddingPxChange } = props

  return (
    <div className="page-margin-grid">
      <label htmlFor="page-margin-x-range">左右边距</label>
      <input
        id="page-margin-x-range"
        type="range"
        min={8}
        max={120}
        step={1}
        value={pageHorizontalPaddingPx}
        onInput={(event) =>
          handleFloatValue((event.target as HTMLInputElement).value, onPageHorizontalPaddingPxChange)
        }
        onChange={(event) => handleFloatValue(event.target.value, onPageHorizontalPaddingPxChange)}
      />
      <input
        type="number"
        min={8}
        max={120}
        step={1}
        value={pageHorizontalPaddingPx}
        onInput={(event) =>
          handleFloatValue((event.target as HTMLInputElement).value, onPageHorizontalPaddingPxChange)
        }
        onChange={(event) => handleFloatValue(event.target.value, onPageHorizontalPaddingPxChange)}
      />
    </div>
  )
}
