import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { RHYTHM_PRESETS } from '../constants'
import type { ImportFeedback, RhythmPresetId } from '../types'
import type { NotationPaletteSelection } from '../notationPaletteConfig'
import { NotationPalette } from './NotationPalette'

export function ScoreControls(props: {
  isPlaying: boolean
  onPlayScore: () => void
  onReset: () => void
  onOpenMusicXmlFilePicker: () => void
  onLoadSampleMusicXml: () => void
  onExportMusicXmlFile: () => void
  onOpenOsmdPreview: () => void
  onOpenBeamGroupingTool: () => void
  isNotationPaletteOpen: boolean
  onToggleNotationPalette: () => void
  onCloseNotationPalette: () => void
  notationPaletteSelection: NotationPaletteSelection
  notationPaletteLastAction: string
  onNotationPaletteSelectionChange: (next: NotationPaletteSelection, actionLabel: string) => void
  onOpenDirectOsmdFilePicker: () => void
  onImportMusicXmlFromTextarea: () => void
  midiSupported: boolean
  midiPermissionState: 'idle' | 'granted' | 'denied' | 'unsupported' | 'error'
  midiInputOptions: Array<{ id: string; name: string }>
  selectedMidiInputId: string
  onSelectedMidiInputIdChange: (id: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  osmdDirectFileInputRef: RefObject<HTMLInputElement | null>
  onMusicXmlFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onOsmdDirectFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  importFeedback: ImportFeedback
  rhythmPreset: RhythmPresetId
  onApplyRhythmPreset: (presetId: RhythmPresetId) => void
  autoScaleEnabled: boolean
  autoScalePercent: number
  onToggleAutoScale: () => void
  manualScalePercent: number
  onManualScalePercentChange: (nextPercent: number) => void
  canvasHeightPercent: number
  onCanvasHeightPercentChange: (nextPercent: number) => void
  pageHorizontalPaddingPx: number
  baseMinGap32Px: number
  minBarlineEdgeGapPx: number
  maxBarlineEdgeGapPx: number
  durationGapRatio32: number
  durationGapRatio16: number
  durationGapRatio8: number
  durationGapRatio4: number
  durationGapRatio2: number
  onPageHorizontalPaddingPxChange: (nextValue: number) => void
  onBaseMinGap32PxChange: (nextValue: number) => void
  onMinBarlineEdgeGapPxChange: (nextValue: number) => void
  onMaxBarlineEdgeGapPxChange: (nextValue: number) => void
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
    onReset,
    onOpenMusicXmlFilePicker,
    onLoadSampleMusicXml,
    onExportMusicXmlFile,
    onOpenOsmdPreview,
    onOpenBeamGroupingTool,
    isNotationPaletteOpen,
    onToggleNotationPalette,
    onCloseNotationPalette,
    notationPaletteSelection,
    notationPaletteLastAction,
    onNotationPaletteSelectionChange,
    onOpenDirectOsmdFilePicker,
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
    rhythmPreset,
    onApplyRhythmPreset,
    autoScaleEnabled,
    autoScalePercent,
    onToggleAutoScale,
    manualScalePercent,
    onManualScalePercentChange,
    canvasHeightPercent,
    onCanvasHeightPercentChange,
    pageHorizontalPaddingPx,
    baseMinGap32Px,
    minBarlineEdgeGapPx,
    maxBarlineEdgeGapPx,
    durationGapRatio32,
    durationGapRatio16,
    durationGapRatio8,
    durationGapRatio4,
    durationGapRatio2,
    onPageHorizontalPaddingPxChange,
    onBaseMinGap32PxChange,
    onMinBarlineEdgeGapPxChange,
    onMaxBarlineEdgeGapPxChange,
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
  const notationPaletteAnchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isNotationPaletteOpen) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      const anchor = notationPaletteAnchorRef.current
      if (!anchor) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchor.contains(target)) return
      onCloseNotationPalette()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onCloseNotationPalette()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isNotationPaletteOpen, onCloseNotationPalette])

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
          {isPlaying ? '播放中...' : '播放小节'}
        </button>
        <button type="button" onClick={onReset}>重置</button>
        <button type="button" onClick={onToggleAutoScale}>
          {autoScaleEnabled ? `自动缩放：开（${autoScalePercent}%）` : '自动缩放：关'}
        </button>
      </section>

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
          onChange={(event) => onCanvasHeightPercentChange(Number(event.target.value))}
        />
        <input
          className="scale-percent-input"
          type="number"
          min={70}
          max={260}
          step={1}
          value={canvasHeightPercent}
          onInput={(event) => onCanvasHeightPercentChange(Number((event.target as HTMLInputElement).value))}
          onChange={(event) => onCanvasHeightPercentChange(Number(event.target.value))}
        />
        <span className="scale-percent-label">%</span>
      </section>

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

            <label htmlFor="barline-edge-max-gap">小节边缘最大间距</label>
            <input
              id="barline-edge-max-gap"
              type="range"
              min={0}
              max={40}
              step={0.1}
              value={maxBarlineEdgeGapPx}
              onInput={(event) =>
                handleFloatValue((event.target as HTMLInputElement).value, onMaxBarlineEdgeGapPxChange)
              }
              onChange={(event) => handleFloatValue(event.target.value, onMaxBarlineEdgeGapPxChange)}
            />
            <input
              type="number"
              min={0}
              max={40}
              step={0.1}
              value={maxBarlineEdgeGapPx}
              onInput={(event) =>
                handleFloatValue((event.target as HTMLInputElement).value, onMaxBarlineEdgeGapPxChange)
              }
              onChange={(event) => handleFloatValue(event.target.value, onMaxBarlineEdgeGapPxChange)}
            />

            <label htmlFor="barline-edge-min-gap">小节边缘最小间距</label>
            <input
              id="barline-edge-min-gap"
              type="range"
              min={0}
              max={40}
              step={0.1}
              value={minBarlineEdgeGapPx}
              onInput={(event) =>
                handleFloatValue((event.target as HTMLInputElement).value, onMinBarlineEdgeGapPxChange)
              }
              onChange={(event) => handleFloatValue(event.target.value, onMinBarlineEdgeGapPxChange)}
            />
            <input
              type="number"
              min={0}
              max={40}
              step={0.1}
              value={minBarlineEdgeGapPx}
              onInput={(event) =>
                handleFloatValue((event.target as HTMLInputElement).value, onMinBarlineEdgeGapPxChange)
              }
              onChange={(event) => handleFloatValue(event.target.value, onMinBarlineEdgeGapPxChange)}
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
          </div>
        )}
      </section>

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




