import type { ChangeEvent, RefObject } from 'react'
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
  onSpacingMinGapBeatsChange: (nextValue: number) => void
  onSpacingGapGammaChange: (nextValue: number) => void
  onSpacingBaseWeightChange: (nextValue: number) => void
  onSpacingLeftEdgePaddingPxChange: (nextValue: number) => void
  onSpacingRightEdgePaddingPxChange: (nextValue: number) => void
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
    onSpacingMinGapBeatsChange,
    onSpacingGapGammaChange,
    onSpacingBaseWeightChange,
    onSpacingLeftEdgePaddingPxChange,
    onSpacingRightEdgePaddingPxChange,
    onResetSpacingConfig,
  } = props

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
          <button type="button" className="spacing-reset-btn" onClick={onResetSpacingConfig}>
            Reset
          </button>
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
