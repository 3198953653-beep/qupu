import { useEffect } from 'react'
import {
  MAX_PLAYBACK_VOLUME_PERCENT,
  MIN_PLAYBACK_VOLUME_PERCENT,
  PLAYBACK_VOLUME_STEP,
  clampPlaybackVolumePercent,
} from '../playbackVolume'

type PlaybackVolumeModalProps = {
  isOpen: boolean
  trebleVolumePercent: number
  bassVolumePercent: number
  onTrebleVolumePercentChange: (nextValue: number) => void
  onBassVolumePercentChange: (nextValue: number) => void
  onReset: () => void
  onClose: () => void
}

function parseVolumeInput(rawValue: string): number {
  const parsed = Number(rawValue)
  return clampPlaybackVolumePercent(parsed)
}

export function PlaybackVolumeModal(props: PlaybackVolumeModalProps) {
  const {
    isOpen,
    trebleVolumePercent,
    bassVolumePercent,
    onTrebleVolumePercentChange,
    onBassVolumePercentChange,
    onReset,
    onClose,
  } = props

  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="playback-volume-modal" onMouseDown={onClose}>
      <div
        className="playback-volume-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="播放音量调节"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="playback-volume-modal-header">
          <div>
            <h3>音量调节</h3>
            <p>只影响整谱播放。修改后从下一次播放开始生效，不会实时重混当前播放中的 session。</p>
          </div>
          <button
            type="button"
            className="playback-volume-modal-close"
            onClick={onClose}
            aria-label="关闭音量调节窗口"
          >
            关闭
          </button>
        </header>

        <section className="playback-volume-modal-body">
          <div className="playback-volume-grid">
            <label htmlFor="playback-treble-volume-range">上谱表音量</label>
            <input
              id="playback-treble-volume-range"
              aria-label="上谱表音量滑块"
              type="range"
              min={MIN_PLAYBACK_VOLUME_PERCENT}
              max={MAX_PLAYBACK_VOLUME_PERCENT}
              step={PLAYBACK_VOLUME_STEP}
              value={trebleVolumePercent}
              onChange={(event) => onTrebleVolumePercentChange(parseVolumeInput(event.target.value))}
            />
            <input
              aria-label="上谱表音量数值"
              type="number"
              min={MIN_PLAYBACK_VOLUME_PERCENT}
              max={MAX_PLAYBACK_VOLUME_PERCENT}
              step={PLAYBACK_VOLUME_STEP}
              value={trebleVolumePercent}
              onChange={(event) => onTrebleVolumePercentChange(parseVolumeInput(event.target.value))}
            />

            <label htmlFor="playback-bass-volume-range">下谱表音量</label>
            <input
              id="playback-bass-volume-range"
              aria-label="下谱表音量滑块"
              type="range"
              min={MIN_PLAYBACK_VOLUME_PERCENT}
              max={MAX_PLAYBACK_VOLUME_PERCENT}
              step={PLAYBACK_VOLUME_STEP}
              value={bassVolumePercent}
              onChange={(event) => onBassVolumePercentChange(parseVolumeInput(event.target.value))}
            />
            <input
              aria-label="下谱表音量数值"
              type="number"
              min={MIN_PLAYBACK_VOLUME_PERCENT}
              max={MAX_PLAYBACK_VOLUME_PERCENT}
              step={PLAYBACK_VOLUME_STEP}
              value={bassVolumePercent}
              onChange={(event) => onBassVolumePercentChange(parseVolumeInput(event.target.value))}
            />
          </div>
        </section>

        <footer className="playback-volume-modal-footer">
          <p>默认值是 100 / 100，会在当前 staff 基础播放力度上做倍率调整。</p>
          <button type="button" className="playback-volume-reset-button" onClick={onReset}>
            恢复默认
          </button>
        </footer>
      </div>
    </div>
  )
}
