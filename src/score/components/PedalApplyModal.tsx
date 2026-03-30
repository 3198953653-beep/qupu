import { useEffect } from 'react'
import type { PedalApplyScope, PedalLayoutMode, PedalStyle } from '../types'

export function PedalApplyModal(props: {
  isOpen: boolean
  selectedScope: PedalApplyScope
  selectedLayoutMode: PedalLayoutMode
  scopeOptions: Array<{
    scope: PedalApplyScope
    label: string
    disabled: boolean
  }>
  layoutModeOptions: Array<{
    mode: PedalLayoutMode
    label: string
  }>
  scopeSummary: string
  chordCountInScope: number
  hasExistingSpansInScope: boolean
  styleOptions: Array<{
    style: PedalStyle
    label: string
  }>
  onClose: () => void
  onSelectScope: (scope: PedalApplyScope) => void
  onSelectLayoutMode: (mode: PedalLayoutMode) => void
  onApplyStyle: (style: PedalStyle) => void
}) {
  const {
    isOpen,
    selectedScope,
    selectedLayoutMode,
    scopeOptions,
    layoutModeOptions,
    scopeSummary,
    chordCountInScope,
    hasExistingSpansInScope,
    styleOptions,
    onClose,
    onSelectScope,
    onSelectLayoutMode,
    onApplyStyle,
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
    <div className="pedal-apply-modal" onMouseDown={onClose}>
      <div
        className="pedal-apply-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="添加踏板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pedal-apply-modal-header">
          <div>
            <h3>添加踏板</h3>
            <p>点击一种样式后会立刻按当前和弦时间轴生成踏板，并放在低音谱表下方。</p>
          </div>
          <button
            type="button"
            className="pedal-apply-modal-close"
            onClick={onClose}
            aria-label="关闭添加踏板窗口"
          >
            关闭
          </button>
        </header>

        <section className="pedal-apply-summary">
          <div className="pedal-apply-summary-card">
            <span>目标范围</span>
            <strong>{scopeSummary}</strong>
          </div>
          <div className="pedal-apply-summary-card">
            <span>命中和弦</span>
            <strong>{chordCountInScope}</strong>
          </div>
          <div className="pedal-apply-summary-card">
            <span>覆盖提示</span>
            <strong>{hasExistingSpansInScope ? '当前范围已有踏板' : '当前范围暂无踏板'}</strong>
          </div>
        </section>

        <section className="pedal-apply-scope-section">
          <div className="pedal-apply-section-header">
            <h4>应用范围</h4>
            <span>跟随你当前选中的和弦或段落</span>
          </div>
          <div className="pedal-apply-scope-grid">
            {scopeOptions.map((option) => (
              <button
                key={option.scope}
                type="button"
                className={`pedal-apply-scope-chip${selectedScope === option.scope ? ' is-active' : ''}`}
                disabled={option.disabled}
                onClick={() => onSelectScope(option.scope)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="pedal-apply-layout-section">
          <div className="pedal-apply-section-header">
            <h4>水平线模式</h4>
            <span>灵活按每段避让，统一按同系统初始共线</span>
          </div>
          <div className="pedal-apply-layout-grid">
            {layoutModeOptions.map((option) => (
              <button
                key={option.mode}
                type="button"
                className={`pedal-apply-layout-chip${selectedLayoutMode === option.mode ? ' is-active' : ''}`}
                onClick={() => onSelectLayoutMode(option.mode)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="pedal-apply-style-section">
          <div className="pedal-apply-section-header">
            <h4>踏板样式</h4>
            <span>点击样式后立即套用</span>
          </div>

          {chordCountInScope > 0 ? (
            <div className="pedal-apply-style-grid">
              {styleOptions.map((option) => (
                <button
                  key={option.style}
                  type="button"
                  className="pedal-apply-style-card"
                  onClick={() => onApplyStyle(option.style)}
                >
                  <div className="pedal-apply-style-card-header">
                    <strong>{option.label}</strong>
                  </div>
                  <div className={`pedal-style-preview pedal-style-preview-${option.style}`} aria-hidden="true">
                    {option.style !== 'bracket' && <span className="pedal-style-preview-ped">Ped</span>}
                    {(option.style === 'bracket' || option.style === 'mixed') && (
                      <span className="pedal-style-preview-line" />
                    )}
                    {option.style === 'text' && <span className="pedal-style-preview-release">*</span>}
                    {(option.style === 'bracket' || option.style === 'mixed') && (
                      <span className="pedal-style-preview-hook" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="pedal-apply-empty-state">
              当前范围里没有可用和弦时间轴，暂时不能生成踏板。请先选中带和弦的段落或和弦，或改为整首。
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
