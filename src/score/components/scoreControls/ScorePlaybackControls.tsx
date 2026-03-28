import type { PropsWithChildren } from 'react'
import { RHYTHM_PRESETS } from '../../constants'
import type { ScoreControlsProps } from './types'

type ScorePlaybackControlsProps = PropsWithChildren<Pick<
  ScoreControlsProps,
  | 'isPlaying'
  | 'onPlayScore'
  | 'onStopScore'
  | 'onReset'
  | 'playheadFollowEnabled'
  | 'onTogglePlayheadFollow'
  | 'showChordDegreeEnabled'
  | 'onToggleChordDegreeDisplay'
  | 'showChordMarkerBackgroundEnabled'
  | 'onToggleChordMarkerBackgroundDisplay'
  | 'showInScoreMeasureNumbers'
  | 'onToggleInScoreMeasureNumbers'
  | 'showNoteHeadJianpuEnabled'
  | 'onToggleNoteHeadJianpuDisplay'
  | 'autoScaleEnabled'
  | 'autoScalePercent'
  | 'onToggleAutoScale'
  | 'activeBuiltInDemo'
  | 'onLoadWholeNoteDemo'
  | 'onLoadHalfNoteDemo'
  | 'rhythmPreset'
  | 'onApplyRhythmPreset'
>>

export function ScorePlaybackControls(props: ScorePlaybackControlsProps) {
  const {
    isPlaying,
    onPlayScore,
    onStopScore,
    onReset,
    playheadFollowEnabled,
    onTogglePlayheadFollow,
    showChordDegreeEnabled,
    onToggleChordDegreeDisplay,
    showChordMarkerBackgroundEnabled,
    onToggleChordMarkerBackgroundDisplay,
    showInScoreMeasureNumbers,
    onToggleInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    onToggleNoteHeadJianpuDisplay,
    autoScaleEnabled,
    autoScalePercent,
    onToggleAutoScale,
    activeBuiltInDemo,
    onLoadWholeNoteDemo,
    onLoadHalfNoteDemo,
    rhythmPreset,
    onApplyRhythmPreset,
    children,
  } = props

  return (
    <>
      <section className="control-row">
        <button type="button" onClick={onPlayScore} disabled={isPlaying}>
          {isPlaying ? '播放中...' : '播放小节'}
        </button>
        <button type="button" onClick={onStopScore} disabled={!isPlaying}>停止</button>
        <button type="button" onClick={onReset}>重置</button>
        <button type="button" onClick={onTogglePlayheadFollow}>
          {playheadFollowEnabled ? '播放线跟踪：开' : '播放线跟踪：关'}
        </button>
        <button type="button" onClick={onToggleChordDegreeDisplay}>
          {showChordDegreeEnabled ? '和弦级数：开' : '和弦级数：关'}
        </button>
        <button type="button" onClick={onToggleChordMarkerBackgroundDisplay}>
          {showChordMarkerBackgroundEnabled ? '和弦背景：开' : '和弦背景：关'}
        </button>
        <button type="button" onClick={onToggleInScoreMeasureNumbers}>
          {showInScoreMeasureNumbers ? '谱面序号：开' : '谱面序号：关'}
        </button>
        <button type="button" onClick={onToggleNoteHeadJianpuDisplay}>
          {showNoteHeadJianpuEnabled ? '符头简谱：开' : '符头简谱：关'}
        </button>
        <button type="button" onClick={onToggleAutoScale}>
          {autoScaleEnabled ? `自动缩放：开（${autoScalePercent}%）` : '自动缩放：关'}
        </button>
      </section>

      {children}

      <section className="rhythm-row">
        <button
          type="button"
          className={`rhythm-btn ${activeBuiltInDemo === 'whole-note' ? 'active' : ''}`}
          onClick={onLoadWholeNoteDemo}
        >
          加载全音符示例
        </button>
        <button
          type="button"
          className={`rhythm-btn ${activeBuiltInDemo === 'half-note' ? 'active' : ''}`}
          onClick={onLoadHalfNoteDemo}
        >
          加载二分音符示例
        </button>
        {RHYTHM_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`rhythm-btn ${activeBuiltInDemo === 'none' && rhythmPreset === preset.id ? 'active' : ''}`}
            onClick={() => onApplyRhythmPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </section>
    </>
  )
}
