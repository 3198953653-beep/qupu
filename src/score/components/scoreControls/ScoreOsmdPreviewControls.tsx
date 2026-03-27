import { useRef } from 'react'
import { NotationPalette } from '../NotationPalette'
import type { ScoreControlsProps } from './types'

type ScoreOsmdPreviewControlsProps = Pick<
  ScoreControlsProps,
  | 'onOpenMusicXmlFilePicker'
  | 'onOpenDirectOsmdFilePicker'
  | 'onLoadSampleMusicXml'
  | 'onExportMusicXmlFile'
  | 'onOpenOsmdPreview'
  | 'onOpenBeamGroupingTool'
  | 'isNotationPaletteOpen'
  | 'onToggleNotationPalette'
  | 'onCloseNotationPalette'
  | 'notationPaletteSelection'
  | 'notationPaletteLastAction'
  | 'notationPaletteActiveItemIdsOverride'
  | 'notationPaletteSummaryOverride'
  | 'onNotationPaletteSelectionChange'
  | 'onImportMusicXmlFromTextarea'
  | 'midiSupported'
  | 'midiPermissionState'
  | 'midiInputOptions'
  | 'selectedMidiInputId'
  | 'onSelectedMidiInputIdChange'
  | 'fileInputRef'
  | 'osmdDirectFileInputRef'
  | 'onMusicXmlFileChange'
  | 'onOsmdDirectFileChange'
  | 'importFeedback'
>

export function ScoreOsmdPreviewControls(props: ScoreOsmdPreviewControlsProps) {
  const {
    onOpenMusicXmlFilePicker,
    onOpenDirectOsmdFilePicker,
    onLoadSampleMusicXml,
    onExportMusicXmlFile,
    onOpenOsmdPreview,
    onOpenBeamGroupingTool,
    isNotationPaletteOpen,
    onToggleNotationPalette,
    onCloseNotationPalette,
    notationPaletteSelection,
    notationPaletteLastAction,
    notationPaletteActiveItemIdsOverride = null,
    notationPaletteSummaryOverride = null,
    onNotationPaletteSelectionChange,
    onImportMusicXmlFromTextarea,
    midiSupported,
    midiPermissionState,
    midiInputOptions,
    selectedMidiInputId,
    onSelectedMidiInputIdChange,
    fileInputRef,
    osmdDirectFileInputRef,
    onMusicXmlFileChange,
    onOsmdDirectFileChange,
    importFeedback,
  } = props

  const notationPaletteAnchorRef = useRef<HTMLDivElement | null>(null)

  return (
    <section className="import-panel">
      <div className="import-actions">
        <button type="button" onClick={onOpenMusicXmlFilePicker}>加载乐谱文件</button>
        <button type="button" onClick={onOpenDirectOsmdFilePicker}>直接预览文件</button>
        <button type="button" onClick={onLoadSampleMusicXml}>加载示例乐谱</button>
        <button type="button" onClick={onExportMusicXmlFile}>导出乐谱文件</button>
        <button type="button" onClick={onOpenOsmdPreview}>OSMD预览</button>
        <button type="button" onClick={onOpenBeamGroupingTool}>音值组合</button>
        <div ref={notationPaletteAnchorRef} className="notation-palette-anchor">
          <button
            type="button"
            className={isNotationPaletteOpen ? 'notation-palette-trigger is-active' : 'notation-palette-trigger'}
            onClick={onToggleNotationPalette}
          >
            记谱工具
          </button>
          <NotationPalette
            open={isNotationPaletteOpen}
            selection={notationPaletteSelection}
            lastActionLabel={notationPaletteLastAction}
            anchorRef={notationPaletteAnchorRef}
            onClose={onCloseNotationPalette}
            activeItemIdsOverride={notationPaletteActiveItemIdsOverride}
            summaryOverride={notationPaletteSummaryOverride}
            onSelectionChange={onNotationPaletteSelectionChange}
          />
        </div>
        <button type="button" onClick={onImportMusicXmlFromTextarea}>导入文本</button>
      </div>

      <div className="midi-input-row">
        <label htmlFor="midi-input-select">MIDI输入</label>
        <select
          id="midi-input-select"
          value={selectedMidiInputId}
          onChange={(event) => onSelectedMidiInputIdChange(event.target.value)}
          disabled={!midiSupported || midiPermissionState === 'denied' || midiPermissionState === 'error'}
        >
          <option value="">关闭</option>
          {midiInputOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {midiPermissionState === 'idle' && <span className="midi-input-state">正在检测MIDI...</span>}
        {midiPermissionState === 'unsupported' && <span className="midi-input-state">浏览器未启用Web MIDI</span>}
        {midiPermissionState === 'denied' && <span className="midi-input-state">MIDI权限被拒绝</span>}
        {midiPermissionState === 'error' && <span className="midi-input-state">MIDI初始化失败</span>}
        {midiPermissionState === 'granted' && midiInputOptions.length === 0 && (
          <span className="midi-input-state">未检测到MIDI输入设备</span>
        )}
      </div>

      <input
        ref={fileInputRef}
        className="xml-file-input"
        type="file"
        accept=".musicxml,.xml,text/xml,application/xml"
        onChange={onMusicXmlFileChange}
      />
      <input
        ref={osmdDirectFileInputRef}
        className="xml-file-input"
        type="file"
        accept=".musicxml,.xml,text/xml,application/xml"
        onChange={onOsmdDirectFileChange}
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
  )
}
