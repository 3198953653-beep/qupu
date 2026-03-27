import { handleFloatValue, type ScoreSpacingControlsProps } from './shared'

type ScoreSpacingGlobalGapSectionProps = Pick<
  ScoreSpacingControlsProps,
  | 'chordMarkerUiScalePercent'
  | 'chordMarkerPaddingPx'
  | 'baseMinGap32Px'
  | 'leadingBarlineGapPx'
  | 'secondChordSafeGapPx'
  | 'onChordMarkerUiScalePercentChange'
  | 'onChordMarkerPaddingPxChange'
  | 'onBaseMinGap32PxChange'
  | 'onLeadingBarlineGapPxChange'
  | 'onSecondChordSafeGapPxChange'
>

export function ScoreSpacingGlobalGapSection(props: ScoreSpacingGlobalGapSectionProps) {
  const {
    chordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    baseMinGap32Px,
    leadingBarlineGapPx,
    secondChordSafeGapPx,
    onChordMarkerUiScalePercentChange,
    onChordMarkerPaddingPxChange,
    onBaseMinGap32PxChange,
    onLeadingBarlineGapPxChange,
    onSecondChordSafeGapPxChange,
  } = props

  return (
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
  )
}
