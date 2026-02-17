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
  } = props

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

        {importFeedback.kind !== 'idle' && <p className={`import-feedback ${importFeedback.kind}`}>{importFeedback.message}</p>}
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
