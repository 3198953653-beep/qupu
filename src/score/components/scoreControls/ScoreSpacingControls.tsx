import { useState } from 'react'
import type { ScoreControlsProps } from './types'

type ScoreSpacingControlsProps = Pick<
  ScoreControlsProps,
  | 'pageHorizontalPaddingPx'
  | 'chordMarkerUiScalePercent'
  | 'chordMarkerPaddingPx'
  | 'baseMinGap32Px'
  | 'leadingBarlineGapPx'
  | 'secondChordSafeGapPx'
  | 'durationGapRatio32'
  | 'durationGapRatio16'
  | 'durationGapRatio8'
  | 'durationGapRatio4'
  | 'durationGapRatio2'
  | 'durationGapRatioWhole'
  | 'onPageHorizontalPaddingPxChange'
  | 'onChordMarkerUiScalePercentChange'
  | 'onChordMarkerPaddingPxChange'
  | 'onBaseMinGap32PxChange'
  | 'onLeadingBarlineGapPxChange'
  | 'onSecondChordSafeGapPxChange'
  | 'onDurationGapRatio32Change'
  | 'onDurationGapRatio16Change'
  | 'onDurationGapRatio8Change'
  | 'onDurationGapRatio4Change'
  | 'onDurationGapRatio2Change'
  | 'onDurationGapRatioWholeChange'
  | 'onResetSpacingConfig'
>

export function ScoreSpacingControls(props: ScoreSpacingControlsProps) {
  const {
    pageHorizontalPaddingPx,
    chordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    baseMinGap32Px,
    leadingBarlineGapPx,
    secondChordSafeGapPx,
    durationGapRatio32,
    durationGapRatio16,
    durationGapRatio8,
    durationGapRatio4,
    durationGapRatio2,
    durationGapRatioWhole,
    onPageHorizontalPaddingPxChange,
    onChordMarkerUiScalePercentChange,
    onChordMarkerPaddingPxChange,
    onBaseMinGap32PxChange,
    onLeadingBarlineGapPxChange,
    onSecondChordSafeGapPxChange,
    onDurationGapRatio32Change,
    onDurationGapRatio16Change,
    onDurationGapRatio8Change,
    onDurationGapRatio4Change,
    onDurationGapRatio2Change,
    onDurationGapRatioWholeChange,
    onResetSpacingConfig,
  } = props

  const [showGlobalGapPanel, setShowGlobalGapPanel] = useState(false)
  const [showDurationRatioPanel, setShowDurationRatioPanel] = useState(false)
  const [showPageMarginPanel, setShowPageMarginPanel] = useState(false)

  const handleFloatValue = (rawValue: string, onChange: (nextValue: number) => void) => {
    onChange(Number(rawValue))
  }

  return (
    <section className="spacing-panel">
      <div className="spacing-header">
        <h3>间距调节</h3>
        <div className="spacing-header-actions">
          <button
            type="button"
            className={`spacing-toggle-btn ${showGlobalGapPanel ? 'active' : ''}`}
            onClick={() => setShowGlobalGapPanel((current) => !current)}
          >间距大小</button>
          <button
            type="button"
            className={`spacing-toggle-btn ${showDurationRatioPanel ? 'active' : ''}`}
            onClick={() => setShowDurationRatioPanel((current) => !current)}
          >时值比例</button>
          <button
            type="button"
            className={`spacing-toggle-btn ${showPageMarginPanel ? 'active' : ''}`}
            onClick={() => setShowPageMarginPanel((current) => !current)}
          >
            边界距离
          </button>
          <button type="button" className="spacing-reset-btn" onClick={onResetSpacingConfig}>重置</button>
        </div>
      </div>
      {showGlobalGapPanel && (
        <div className="duration-base-grid">
          <label htmlFor="chord-marker-ui-scale-range">和弦标记大小</label>
          <input
            id="chord-marker-ui-scale-range"
            type="range"
            min={60}
            max={240}
            step={1}
            value={chordMarkerUiScalePercent}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onChordMarkerUiScalePercentChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onChordMarkerUiScalePercentChange)}
          />
          <input
            id="chord-marker-ui-scale-input"
            type="number"
            min={60}
            max={240}
            step={1}
            value={chordMarkerUiScalePercent}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onChordMarkerUiScalePercentChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onChordMarkerUiScalePercentChange)}
          />

          <label htmlFor="chord-marker-padding-range">和弦标记内边距</label>
          <input
            id="chord-marker-padding-range"
            type="range"
            min={0}
            max={24}
            step={0.5}
            value={chordMarkerPaddingPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onChordMarkerPaddingPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onChordMarkerPaddingPxChange)}
          />
          <input
            id="chord-marker-padding-input"
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={chordMarkerPaddingPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onChordMarkerPaddingPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onChordMarkerPaddingPxChange)}
          />

          <label htmlFor="duration-base-gap-32">全局间距大小</label>
          <input
            id="duration-base-gap-32"
            type="range"
            min={0}
            max={12}
            step={0.1}
            value={baseMinGap32Px}
            onInput={(event) => handleFloatValue((event.target as HTMLInputElement).value, onBaseMinGap32PxChange)}
            onChange={(event) => handleFloatValue(event.target.value, onBaseMinGap32PxChange)}
          />
          <input
            type="number"
            min={0}
            max={12}
            step={0.1}
            value={baseMinGap32Px}
            onInput={(event) => handleFloatValue((event.target as HTMLInputElement).value, onBaseMinGap32PxChange)}
            onChange={(event) => handleFloatValue(event.target.value, onBaseMinGap32PxChange)}
          />

          <label htmlFor="leading-barline-gap-range">首音距小节线</label>
          <input
            id="leading-barline-gap-range"
            type="range"
            min={0}
            max={80}
            step={0.1}
            value={leadingBarlineGapPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onLeadingBarlineGapPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onLeadingBarlineGapPxChange)}
          />
          <input
            type="number"
            min={0}
            max={80}
            step={0.1}
            value={leadingBarlineGapPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onLeadingBarlineGapPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onLeadingBarlineGapPxChange)}
          />

          <label htmlFor="second-chord-safe-gap-range">二度和弦安全距</label>
          <input
            id="second-chord-safe-gap-range"
            type="range"
            min={0}
            max={12}
            step={0.1}
            value={secondChordSafeGapPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onSecondChordSafeGapPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onSecondChordSafeGapPxChange)}
          />
          <input
            id="second-chord-safe-gap-input"
            type="number"
            min={0}
            max={12}
            step={0.1}
            value={secondChordSafeGapPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onSecondChordSafeGapPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onSecondChordSafeGapPxChange)}
          />
        </div>
      )}

      {showPageMarginPanel && (
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
      )}

      {showDurationRatioPanel && (
        <div className="duration-ratio-grid">
          <label htmlFor="duration-ratio-32">32 分音符比例</label>
          <input
            id="duration-ratio-32"
            type="range"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio32}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio32Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio32Change)}
          />
          <input
            type="number"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio32}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio32Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio32Change)}
          />

          <label htmlFor="duration-ratio-16">16 分音符比例</label>
          <input
            id="duration-ratio-16"
            type="range"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio16}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio16Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio16Change)}
          />
          <input
            type="number"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio16}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio16Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio16Change)}
          />

          <label htmlFor="duration-ratio-8">8 分音符比例</label>
          <input
            id="duration-ratio-8"
            type="range"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio8}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio8Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio8Change)}
          />
          <input
            type="number"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio8}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio8Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio8Change)}
          />

          <label htmlFor="duration-ratio-4">4 分音符比例</label>
          <input
            id="duration-ratio-4"
            type="range"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio4}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio4Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio4Change)}
          />
          <input
            type="number"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio4}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio4Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio4Change)}
          />

          <label htmlFor="duration-ratio-2">2 分音符比例</label>
          <input
            id="duration-ratio-2"
            type="range"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio2}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio2Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio2Change)}
          />
          <input
            type="number"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatio2}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatio2Change)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatio2Change)}
          />

          <label htmlFor="duration-ratio-1">全音符比例</label>
          <input
            id="duration-ratio-1"
            type="range"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatioWhole}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatioWholeChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatioWholeChange)}
          />
          <input
            type="number"
            min={0.5}
            max={4}
            step={0.01}
            value={durationGapRatioWhole}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onDurationGapRatioWholeChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onDurationGapRatioWholeChange)}
          />
        </div>
      )}
    </section>
  )
}
