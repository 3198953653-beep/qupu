import { useEffect } from 'react'
import type { RhythmTemplateRow } from '../rhythmTemplateDb'
import type { TimelineSegmentScope } from '../segmentRhythmTemplateEngine'

export function RhythmTemplateLoadModal(props: {
  isOpen: boolean
  scope: TimelineSegmentScope | null
  durationCombo: string | null
  isLoading: boolean
  isApplying: boolean
  errorMessage: string | null
  difficultyOptions: string[]
  styleOptions: string[]
  filteredTemplateRows: RhythmTemplateRow[]
  selectedDifficulty: string | null
  selectedStyles: string[]
  selectedTemplateId: string | null
  onClose: () => void
  onSelectDifficulty: (difficulty: string | null) => void
  onToggleStyle: (style: string) => void
  onSelectTemplate: (templateId: string) => void
  onApplyTemplate: () => void
  onTemplateDoubleClick: (templateId: string) => void
}) {
  const {
    isOpen,
    scope,
    durationCombo,
    isLoading,
    isApplying,
    errorMessage,
    difficultyOptions,
    styleOptions,
    filteredTemplateRows,
    selectedDifficulty,
    selectedStyles,
    selectedTemplateId,
    onClose,
    onSelectDifficulty,
    onToggleStyle,
    onSelectTemplate,
    onApplyTemplate,
    onTemplateDoubleClick,
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

  if (!isOpen || !scope) return null

  const segmentLabel = `第 ${scope.startPairIndex + 1}-${scope.endPairIndexInclusive + 1} 小节`
  const hasTemplates = filteredTemplateRows.length > 0
  const showEmptyState = !isLoading && !errorMessage && !hasTemplates

  return (
    <div className="rhythm-template-modal" onMouseDown={onClose}>
      <div
        className="rhythm-template-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="加载律动模板"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="rhythm-template-modal-header">
          <div>
            <h3>加载律动</h3>
            <p>双击段落后可直接为当前段落重生成低音谱表。单击模板选中，双击模板立即套用。</p>
          </div>
          <button
            type="button"
            className="rhythm-template-modal-close"
            onClick={onClose}
            aria-label="关闭加载律动窗口"
          >
            关闭
          </button>
        </header>

        <section className="rhythm-template-modal-summary">
          <div className="rhythm-template-summary-card">
            <span>段落范围</span>
            <strong>{segmentLabel}</strong>
          </div>
          <div className="rhythm-template-summary-card">
            <span>时值组合</span>
            <strong>{durationCombo ?? '不可用'}</strong>
          </div>
          <div className="rhythm-template-summary-card">
            <span>应用范围</span>
            <strong>仅替换当前段 bass staff</strong>
          </div>
        </section>

        <div className="rhythm-template-modal-layout">
          <section className="rhythm-template-filter-panel">
            <div className="rhythm-template-panel-title">
              <h4>难度</h4>
              <span>单选</span>
            </div>
            <div className="rhythm-template-chip-list">
              <button
                type="button"
                className={`rhythm-template-chip${selectedDifficulty === null ? ' is-active' : ''}`}
                onClick={() => onSelectDifficulty(null)}
              >
                全部
              </button>
              {difficultyOptions.map((difficulty) => (
                <button
                  key={difficulty}
                  type="button"
                  className={`rhythm-template-chip${selectedDifficulty === difficulty ? ' is-active' : ''}`}
                  onClick={() => onSelectDifficulty(difficulty)}
                >
                  {difficulty}
                </button>
              ))}
            </div>
          </section>

          <section className="rhythm-template-filter-panel">
            <div className="rhythm-template-panel-title">
              <h4>风格</h4>
              <span>多选</span>
            </div>
            <div className="rhythm-template-chip-list">
              {styleOptions.length > 0 ? styleOptions.map((style) => (
                <button
                  key={style}
                  type="button"
                  className={`rhythm-template-chip${selectedStyles.includes(style) ? ' is-active' : ''}`}
                  onClick={() => onToggleStyle(style)}
                >
                  {style}
                </button>
              )) : (
                <div className="rhythm-template-inline-empty">当前模板集合没有可用风格标签。</div>
              )}
            </div>
          </section>

          <section className="rhythm-template-template-panel">
            <div className="rhythm-template-panel-title">
              <h4>模板列表</h4>
              <span>{isLoading ? '正在查询数据库...' : `命中 ${filteredTemplateRows.length} 个模板`}</span>
            </div>

            {errorMessage && (
              <div className="rhythm-template-empty-state is-error">{errorMessage}</div>
            )}

            {!errorMessage && isLoading && (
              <div className="rhythm-template-empty-state">正在加载律动模板，请稍候...</div>
            )}

            {showEmptyState && (
              <div className="rhythm-template-empty-state">
                当前和弦时值组合没有匹配模板。后续你往数据库补充同一 `duration_combo` 后，这里会自动命中。
              </div>
            )}

            {!errorMessage && !isLoading && hasTemplates && (
              <div className="rhythm-template-list" role="listbox" aria-label="律动模板列表">
                {filteredTemplateRows.map((row) => {
                  const isActive = row.id === selectedTemplateId
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`rhythm-template-row${isActive ? ' is-active' : ''}`}
                      onClick={() => onSelectTemplate(row.id)}
                      onDoubleClick={() => onTemplateDoubleClick(row.id)}
                      aria-pressed={isActive}
                    >
                      <div className="rhythm-template-row-main">
                        <strong>{row.name}</strong>
                        <span>{row.durationCombo ?? '未标注 duration_combo'}</span>
                      </div>
                      <div className="rhythm-template-row-meta">
                        <span>{row.difficultyTags.join(' / ') || '无难度标签'}</span>
                        <span>{row.styleTags.join('、') || '无风格标签'}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <footer className="rhythm-template-modal-footer">
          <p>确认后会立即重生成当前段低音谱表，treble 和段外小节保持不变。</p>
          <button
            type="button"
            className="rhythm-template-apply-button"
            disabled={Boolean(errorMessage) || isLoading || isApplying || !selectedTemplateId}
            onClick={onApplyTemplate}
          >
            {isApplying ? '正在套用...' : '确认套用'}
          </button>
        </footer>
      </div>
    </div>
  )
}
