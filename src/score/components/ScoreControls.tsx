import { useState, type ChangeEvent, type RefObject } from 'react'
import { RHYTHM_PRESETS } from '../constants'
import type { ImportFeedback, RhythmPresetId } from '../types'

export function ScoreControls(props: {
  isPlaying: boolean
  onPlayScore: () => void
  onRunAiDraft: () => void
  onReset: () => void
  onOpenMusicXmlFilePicker: () => void
  onLoadSampleMusicXml: () => void
  onExportMusicXmlFile: () => void
  onImportMusicXmlFromTextarea: () => void
  fileInputRef: RefObject<HTMLInputElement | null>
  onMusicXmlFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  musicXmlInput: string
  onMusicXmlInputChange: (nextValue: string) => void
  importFeedback: ImportFeedback
  rhythmPreset: RhythmPresetId
  onApplyRhythmPreset: (presetId: RhythmPresetId) => void
  autoScaleEnabled: boolean
  autoScalePercent: number
  onToggleAutoScale: () => void
  manualScalePercent: number
  onManualScalePercentChange: (nextPercent: number) => void
  spacingGapGamma: number
  spacingBaseWeight: number
  spacingMinGapBeats: number
  spacingLeftEdgePaddingPx: number
  spacingRightEdgePaddingPx: number
  pageHorizontalPaddingPx: number
  baseMinGap32Px: number
  durationGapRatio32: number
  durationGapRatio16: number
  durationGapRatio8: number
  durationGapRatio4: number
  durationGapRatio2: number
  onSpacingMinGapBeatsChange: (nextValue: number) => void
  onSpacingGapGammaChange: (nextValue: number) => void
  onSpacingBaseWeightChange: (nextValue: number) => void
  onSpacingLeftEdgePaddingPxChange: (nextValue: number) => void
  onSpacingRightEdgePaddingPxChange: (nextValue: number) => void
  onPageHorizontalPaddingPxChange: (nextValue: number) => void
  onBaseMinGap32PxChange: (nextValue: number) => void
  onDurationGapRatio32Change: (nextValue: number) => void
  onDurationGapRatio16Change: (nextValue: number) => void
  onDurationGapRatio8Change: (nextValue: number) => void
  onDurationGapRatio4Change: (nextValue: number) => void
  onDurationGapRatio2Change: (nextValue: number) => void
  onResetSpacingConfig: () => void
}) {
  const {
    isPlaying,
    onPlayScore,
    onRunAiDraft,
    onReset,
    onOpenMusicXmlFilePicker,
    onLoadSampleMusicXml,
    onExportMusicXmlFile,
    onImportMusicXmlFromTextarea,
    fileInputRef,
    onMusicXmlFileChange,
    musicXmlInput,
    onMusicXmlInputChange,
    importFeedback,
    rhythmPreset,
    onApplyRhythmPreset,
    autoScaleEnabled,
    autoScalePercent,
    onToggleAutoScale,
    manualScalePercent,
    onManualScalePercentChange,
    spacingGapGamma,
    spacingBaseWeight,
    spacingMinGapBeats,
    spacingLeftEdgePaddingPx,
    spacingRightEdgePaddingPx,
    pageHorizontalPaddingPx,
    baseMinGap32Px,
    durationGapRatio32,
    durationGapRatio16,
    durationGapRatio8,
    durationGapRatio4,
    durationGapRatio2,
    onSpacingMinGapBeatsChange,
    onSpacingGapGammaChange,
    onSpacingBaseWeightChange,
    onSpacingLeftEdgePaddingPxChange,
    onSpacingRightEdgePaddingPxChange,
    onPageHorizontalPaddingPxChange,
    onBaseMinGap32PxChange,
    onDurationGapRatio32Change,
    onDurationGapRatio16Change,
    onDurationGapRatio8Change,
    onDurationGapRatio4Change,
    onDurationGapRatio2Change,
    onResetSpacingConfig,
  } = props

  const [showGlobalGapPanel, setShowGlobalGapPanel] = useState(false)
  const [showDurationRatioPanel, setShowDurationRatioPanel] = useState(false)
  const [showPageMarginPanel, setShowPageMarginPanel] = useState(false)

  const handleScaleValue = (rawValue: string) => {
    const next = Number(rawValue)
    onManualScalePercentChange(next)
  }

  const handleFloatValue = (rawValue: string, onChange: (nextValue: number) => void) => {
    const next = Number(rawValue)
    onChange(next)
  }

  return (
    <>
      <section className="control-row">
        <button type="button" onClick={onPlayScore} disabled={isPlaying}>
          {isPlaying ? 'Playing...' : 'Play Measure'}
        </button>
        <button type="button" onClick={onRunAiDraft}>
          AI Draft
        </button>
        <button type="button" onClick={onReset}>
          Reset
        </button>
        <button type="button" onClick={onToggleAutoScale}>
          {autoScaleEnabled ? `Auto Scale On (${autoScalePercent}%)` : 'Auto Scale Off'}
        </button>
      </section>

      <section className="scale-row">
        <label htmlFor="manual-scale-range">Manual Zoom</label>
        <input
          id="manual-scale-range"
          type="range"
          min={55}
          max={130}
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
          max={130}
          step={1}
          value={manualScalePercent}
          disabled={autoScaleEnabled}
          onInput={(event) => handleScaleValue((event.target as HTMLInputElement).value)}
          onChange={(event) => handleScaleValue(event.target.value)}
        />
        <span className="scale-percent-label">%</span>
      </section>

      <section className="spacing-panel">
        <div className="spacing-header">
          <h3>Spacing Tuning</h3>
          <div className="spacing-header-actions">
            <button
              type="button"
              className={`spacing-toggle-btn ${showGlobalGapPanel ? 'active' : ''}`}
              onClick={() => setShowGlobalGapPanel((current) => !current)}
            >
              Gap Size
            </button>
            <button
              type="button"
              className={`spacing-toggle-btn ${showDurationRatioPanel ? 'active' : ''}`}
              onClick={() => setShowDurationRatioPanel((current) => !current)}
            >
              Duration Ratios
            </button>
            <button
              type="button"
              className={`spacing-toggle-btn ${showPageMarginPanel ? 'active' : ''}`}
              onClick={() => setShowPageMarginPanel((current) => !current)}
            >
              边界距离
            </button>
            <button type="button" className="spacing-reset-btn" onClick={onResetSpacingConfig}>
              Reset
            </button>
          </div>
        </div>
        <div className="spacing-grid">
          <label htmlFor="spacing-min-gap-range">Min Gap (beats)</label>
          <input
            id="spacing-min-gap-range"
            type="range"
            min={0.01}
            max={0.25}
            step={0.005}
            value={spacingMinGapBeats}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onSpacingMinGapBeatsChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onSpacingMinGapBeatsChange)}
          />
          <input
            type="number"
            min={0.01}
            max={0.25}
            step={0.005}
            value={spacingMinGapBeats}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onSpacingMinGapBeatsChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onSpacingMinGapBeatsChange)}
          />

          <label htmlFor="spacing-gamma-range">Gap Gamma</label>
          <input
            id="spacing-gamma-range"
            type="range"
            min={0.55}
            max={1}
            step={0.01}
            value={spacingGapGamma}
            onInput={(event) => handleFloatValue((event.target as HTMLInputElement).value, onSpacingGapGammaChange)}
            onChange={(event) => handleFloatValue(event.target.value, onSpacingGapGammaChange)}
          />
          <input
            type="number"
            min={0.55}
            max={1}
            step={0.01}
            value={spacingGapGamma}
            onInput={(event) => handleFloatValue((event.target as HTMLInputElement).value, onSpacingGapGammaChange)}
            onChange={(event) => handleFloatValue(event.target.value, onSpacingGapGammaChange)}
          />

          <label htmlFor="spacing-base-range">Gap Base</label>
          <input
            id="spacing-base-range"
            type="range"
            min={0.1}
            max={1.2}
            step={0.01}
            value={spacingBaseWeight}
            onInput={(event) => handleFloatValue((event.target as HTMLInputElement).value, onSpacingBaseWeightChange)}
            onChange={(event) => handleFloatValue(event.target.value, onSpacingBaseWeightChange)}
          />
          <input
            type="number"
            min={0.1}
            max={1.2}
            step={0.01}
            value={spacingBaseWeight}
            onInput={(event) => handleFloatValue((event.target as HTMLInputElement).value, onSpacingBaseWeightChange)}
            onChange={(event) => handleFloatValue(event.target.value, onSpacingBaseWeightChange)}
          />

          <label htmlFor="spacing-left-pad-range">Left Edge Pad</label>
          <input
            id="spacing-left-pad-range"
            type="range"
            min={0}
            max={24}
            step={1}
            value={spacingLeftEdgePaddingPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onSpacingLeftEdgePaddingPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onSpacingLeftEdgePaddingPxChange)}
          />
          <input
            type="number"
            min={0}
            max={24}
            step={1}
            value={spacingLeftEdgePaddingPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onSpacingLeftEdgePaddingPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onSpacingLeftEdgePaddingPxChange)}
          />

          <label htmlFor="spacing-right-pad-range">Right Edge Pad</label>
          <input
            id="spacing-right-pad-range"
            type="range"
            min={0}
            max={24}
            step={1}
            value={spacingRightEdgePaddingPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onSpacingRightEdgePaddingPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onSpacingRightEdgePaddingPxChange)}
          />
          <input
            type="number"
            min={0}
            max={24}
            step={1}
            value={spacingRightEdgePaddingPx}
            onInput={(event) =>
              handleFloatValue((event.target as HTMLInputElement).value, onSpacingRightEdgePaddingPxChange)
            }
            onChange={(event) => handleFloatValue(event.target.value, onSpacingRightEdgePaddingPxChange)}
          />
        </div>

        {showGlobalGapPanel && (
          <div className="duration-base-grid">
            <label htmlFor="duration-base-gap-32">Global Gap Size</label>
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
            <label htmlFor="duration-ratio-32">32nd Ratio</label>
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

            <label htmlFor="duration-ratio-16">16th Ratio</label>
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

            <label htmlFor="duration-ratio-8">8th Ratio</label>
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

            <label htmlFor="duration-ratio-4">Quarter Ratio</label>
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

            <label htmlFor="duration-ratio-2">Half Ratio</label>
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
          </div>
        )}
      </section>

      <section className="import-panel">
        <div className="import-actions">
          <button type="button" onClick={onOpenMusicXmlFilePicker}>
            Load MusicXML File
          </button>
          <button type="button" onClick={onLoadSampleMusicXml}>
            Load Sample XML
          </button>
          <button type="button" onClick={onExportMusicXmlFile}>
            Export MusicXML
          </button>
          <button type="button" onClick={onImportMusicXmlFromTextarea}>
            Import XML Text
          </button>
        </div>

        <input
          ref={fileInputRef}
          className="xml-file-input"
          type="file"
          accept=".musicxml,.xml,text/xml,application/xml"
          onChange={onMusicXmlFileChange}
        />

        <textarea
          className="xml-input"
          value={musicXmlInput}
          onChange={(event) => onMusicXmlInputChange(event.target.value)}
          placeholder="Paste MusicXML text here, then click Import XML Text."
          spellCheck={false}
        />

        {importFeedback.kind === 'loading' && (
          <div className="import-progress">
            <div className="import-progress-header">
              <span>{importFeedback.message}</span>
              <strong>{typeof importFeedback.progress === 'number' ? `${importFeedback.progress}%` : ''}</strong>
            </div>
            <div className="import-progress-track">
              <div
                className="import-progress-bar"
                style={{
                  width: `${typeof importFeedback.progress === 'number' ? Math.max(4, Math.min(100, importFeedback.progress)) : 40}%`,
                }}
              />
            </div>
          </div>
        )}
        {importFeedback.kind !== 'idle' && importFeedback.kind !== 'loading' && (
          <p className={`import-feedback ${importFeedback.kind}`}>{importFeedback.message}</p>
        )}
      </section>

      <section className="rhythm-row">
        {RHYTHM_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`rhythm-btn ${rhythmPreset === preset.id ? 'active' : ''}`}
            onClick={() => onApplyRhythmPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </section>
    </>
  )
}
