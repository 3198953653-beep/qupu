import { useEffect, useState } from 'react'
import type {
  SmartChordToneCandidate,
  SmartChordToneCountOption,
  SmartChordToneFilterOption,
  SmartChordToneOctaveOption,
} from '../smartChordToneCandidates'
import type { SmartChordToneDialogTarget } from '../hooks/useSmartChordToneDialogController'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type { SpacingLayoutMode } from '../types'
import { SmartChordToneNotationStrip } from './SmartChordToneNotationStrip'

const OCTAVE_OPTIONS: Array<{ key: SmartChordToneOctaveOption; label: string }> = [
  { key: 'high', label: '高八度' },
  { key: 'low', label: '低八度' },
]

const COUNT_OPTIONS: Array<{ key: SmartChordToneCountOption; label: string }> = [
  { key: 'double', label: '双音' },
  { key: 'triple', label: '三音' },
  { key: 'quad', label: '四音' },
  { key: 'quad_plus', label: '四音以上' },
]

const FILTER_OPTIONS: Array<{ key: SmartChordToneFilterOption; label: string }> = [
  { key: 'no_2nd', label: '禁 2 度' },
  { key: 'no_single_2nd', label: '禁单个 2 度' },
  { key: 'no_single_7th', label: '禁单个 7 度' },
  { key: 'no_root_for_7th_9th', label: '7/9 和弦不加根音' },
]

export function SmartChordToneModal(props: {
  isOpen: boolean
  target: SmartChordToneDialogTarget | null
  octaveOption: SmartChordToneOctaveOption | null
  chordCountOption: SmartChordToneCountOption | null
  filterOptions: SmartChordToneFilterOption[]
  candidates: SmartChordToneCandidate[]
  selectedCandidateKey: string | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  onClose: () => void
  onToggleOctaveOption: (option: SmartChordToneOctaveOption) => void
  onToggleChordCountOption: (option: SmartChordToneCountOption) => void
  onToggleFilterOption: (option: SmartChordToneFilterOption) => void
  onPreviewCandidate: (candidateKey: string) => void
  onApplyCandidate: (candidateKey: string) => void
}) {
  const {
    isOpen,
    target,
    octaveOption,
    chordCountOption,
    filterOptions,
    candidates,
    selectedCandidateKey,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    grandStaffLayoutMetrics,
    onClose,
    onToggleOctaveOption,
    onToggleChordCountOption,
    onToggleFilterOption,
    onPreviewCandidate,
    onApplyCandidate,
  } = props
  const [isMetaPanelExpanded, setIsMetaPanelExpanded] = useState(false)

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

  useEffect(() => {
    if (!isOpen) return
    setIsMetaPanelExpanded(false)
  }, [isOpen])

  if (!isOpen || !target) return null

  const hasChordContext = Boolean(target.chordSourceLabel)
  const hasCandidates = candidates.length > 0
  const metaPanelId = 'smart-chord-meta-panel'

  return (
    <div className="smart-chord-modal" onMouseDown={onClose}>
      <div
        className="smart-chord-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="智能和弦音编辑"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="smart-chord-modal-header">
          <div>
            <h3>智能和弦音</h3>
            <p>单击候选试听，双击候选立即写入当前旋律音。</p>
          </div>
          <button type="button" className="smart-chord-modal-close" onClick={onClose} aria-label="关闭智能和弦音窗口">
            关闭
          </button>
        </header>

        {!hasChordContext && (
          <section className="smart-chord-summary">
            <div className="smart-chord-summary-row">
              <span className="smart-chord-summary-label">旋律音</span>
              <strong>{target.melodyPitchLabel}</strong>
            </div>
            <div className="smart-chord-summary-row">
              <span className="smart-chord-summary-label">位置</span>
              <strong>第 {target.measureNumber} 小节</strong>
            </div>
            <div className="smart-chord-summary-row">
              <span className="smart-chord-summary-label">和弦标记</span>
              <strong>{target.chordSourceLabel ?? '当前音符没有和弦标记'}</strong>
            </div>
          </section>
        )}

        {hasChordContext ? (
          <>
            <button
              type="button"
              className={`smart-chord-disclosure-toggle${isMetaPanelExpanded ? ' is-expanded' : ''}`}
              aria-expanded={isMetaPanelExpanded}
              aria-controls={metaPanelId}
              onClick={() => setIsMetaPanelExpanded((current) => !current)}
            >
              {isMetaPanelExpanded ? '收起筛选与信息' : '展开筛选与信息'}
            </button>

            <div
              id={metaPanelId}
              className="smart-chord-meta-panel"
              hidden={!isMetaPanelExpanded}
            >
              <section className="smart-chord-summary">
                <div className="smart-chord-summary-row">
                  <span className="smart-chord-summary-label">旋律音</span>
                  <strong>{target.melodyPitchLabel}</strong>
                </div>
                <div className="smart-chord-summary-row">
                  <span className="smart-chord-summary-label">位置</span>
                  <strong>第 {target.measureNumber} 小节</strong>
                </div>
                <div className="smart-chord-summary-row">
                  <span className="smart-chord-summary-label">和弦标记</span>
                  <strong>{target.chordSourceLabel ?? '当前音符没有和弦标记'}</strong>
                </div>
              </section>

              <section className="smart-chord-option-section">
                <div className="smart-chord-option-header">
                  <h4>八度</h4>
                  <span>再次点击可取消</span>
                </div>
                <div className="smart-chord-option-grid">
                  {OCTAVE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`smart-chord-option-button${octaveOption === option.key ? ' is-active' : ''}`}
                      onClick={() => onToggleOctaveOption(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="smart-chord-option-section">
                <div className="smart-chord-option-header">
                  <h4>和弦音数量</h4>
                  <span>double = 旋律 + 1 个附加音</span>
                </div>
                <div className="smart-chord-option-grid">
                  {COUNT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`smart-chord-option-button${chordCountOption === option.key ? ' is-active' : ''}`}
                      onClick={() => onToggleChordCountOption(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="smart-chord-option-section">
                <div className="smart-chord-option-header">
                  <h4>过滤</h4>
                  <span>多选，可组合</span>
                </div>
                <div className="smart-chord-option-grid">
                  {FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`smart-chord-option-button${filterOptions.includes(option.key) ? ' is-active' : ''}`}
                      onClick={() => onToggleFilterOption(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <section className="smart-chord-candidate-section">
              <div className="smart-chord-option-header">
                <h4>候选和弦音</h4>
                <span>同一条五线谱内预览全部候选，单击试听，双击写入</span>
              </div>

              {hasCandidates ? (
                <>
                  <SmartChordToneNotationStrip
                    target={target}
                    candidates={candidates}
                    selectedCandidateKey={selectedCandidateKey}
                    timeAxisSpacingConfig={timeAxisSpacingConfig}
                    spacingLayoutMode={spacingLayoutMode}
                    grandStaffLayoutMetrics={grandStaffLayoutMetrics}
                    onPreviewCandidate={onPreviewCandidate}
                    onApplyCandidate={onApplyCandidate}
                  />
                </>
              ) : (
                <div className="smart-chord-empty-state">
                  当前选项下没有可用候选，你可以调整八度、数量或过滤条件后再试。
                </div>
              )}
              <p className="smart-chord-candidate-note">
                每个候选位点显示的是完整结果和弦；真正写入时只会替换该旋律音的附加和弦音，不会改动旋律主音。
              </p>
            </section>
          </>
        ) : (
          <section className="smart-chord-empty-state is-large">
            当前音符没有和弦标记，无法生成智能候选。
          </section>
        )}
      </div>
    </div>
  )
}
