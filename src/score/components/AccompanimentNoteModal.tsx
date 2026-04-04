import { useEffect } from 'react'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type { SpacingLayoutMode } from '../types'
import { AccompanimentNoteNotationStrip } from './AccompanimentNoteNotationStrip'
import type { AccompanimentRenderMeasure } from '../hooks/useAccompanimentNoteDialogController'

export function AccompanimentNoteModal(props: {
  isOpen: boolean
  target: {
    measureNumber: number
    chordName: string
    keyFifths: number
  } | null
  renderMeasures: AccompanimentRenderMeasure[]
  candidateMeasureMap: Map<number, string>
  selectedCandidateKey: string | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  errorMessage: string | null
  onClose: () => void
  onPreviewCandidate: (candidateKey: string) => void
  onApplyCandidate: (candidateKey: string) => void
}) {
  const {
    isOpen,
    target,
    renderMeasures,
    candidateMeasureMap,
    selectedCandidateKey,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    grandStaffLayoutMetrics,
    errorMessage,
    onClose,
    onPreviewCandidate,
    onApplyCandidate,
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

  if (!isOpen || !target) return null

  return (
    <div className="smart-chord-modal" onMouseDown={onClose}>
      <div
        className="smart-chord-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="伴奏音符选择"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="smart-chord-modal-header">
          <div>
            <h3>伴奏音符候选</h3>
            <p>单击候选可试听并临时预览，双击候选写入低音谱。</p>
          </div>
          <button type="button" className="smart-chord-modal-close" onClick={onClose} aria-label="关闭伴奏音符窗口">
            关闭
          </button>
        </header>

        <section className="smart-chord-summary">
          <div className="smart-chord-summary-row">
            <span className="smart-chord-summary-label">位置</span>
            <strong>第 {target.measureNumber} 小节</strong>
          </div>
          <div className="smart-chord-summary-row">
            <span className="smart-chord-summary-label">和弦</span>
            <strong>{target.chordName}</strong>
          </div>
        </section>

        {errorMessage && (
          <section className="smart-chord-empty-state">{errorMessage}</section>
        )}

        {!errorMessage && renderMeasures.length > 0 && (
          <section className="smart-chord-candidate-section">
            <div className="smart-chord-option-header">
              <h4>候选列表</h4>
              <span>每个小节对应一个候选：单击预览，双击应用</span>
            </div>
            <AccompanimentNoteNotationStrip
              measures={renderMeasures}
              selectedCandidateKey={selectedCandidateKey}
              timeAxisSpacingConfig={timeAxisSpacingConfig}
              spacingLayoutMode={spacingLayoutMode}
              grandStaffLayoutMetrics={grandStaffLayoutMetrics}
              onPreviewByMeasure={(measureNumber) => {
                const candidateKey = candidateMeasureMap.get(measureNumber)
                if (!candidateKey) return
                onPreviewCandidate(candidateKey)
              }}
              onApplyByMeasure={(measureNumber) => {
                const candidateKey = candidateMeasureMap.get(measureNumber)
                if (!candidateKey) return
                onApplyCandidate(candidateKey)
              }}
            />
          </section>
        )}
      </div>
    </div>
  )
}
