import { handleFloatValue, type ScoreSpacingControlsProps } from './shared'

type ScoreSpacingDurationRatioSectionProps = Pick<
  ScoreSpacingControlsProps,
  | 'durationGapRatio32'
  | 'durationGapRatio16'
  | 'durationGapRatio8'
  | 'durationGapRatio4'
  | 'durationGapRatio2'
  | 'durationGapRatioWhole'
  | 'onDurationGapRatio32Change'
  | 'onDurationGapRatio16Change'
  | 'onDurationGapRatio8Change'
  | 'onDurationGapRatio4Change'
  | 'onDurationGapRatio2Change'
  | 'onDurationGapRatioWholeChange'
>

export function ScoreSpacingDurationRatioSection(props: ScoreSpacingDurationRatioSectionProps) {
  const {
    durationGapRatio32,
    durationGapRatio16,
    durationGapRatio8,
    durationGapRatio4,
    durationGapRatio2,
    durationGapRatioWhole,
    onDurationGapRatio32Change,
    onDurationGapRatio16Change,
    onDurationGapRatio8Change,
    onDurationGapRatio4Change,
    onDurationGapRatio2Change,
    onDurationGapRatioWholeChange,
  } = props

  return (
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
  )
}
