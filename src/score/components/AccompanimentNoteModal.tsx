import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getGrandStaffLayoutMetrics, type GrandStaffLayoutMetrics } from '../grandStaffLayout'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type { SpacingLayoutMode } from '../types'
import { AccompanimentNoteNotationStrip } from './AccompanimentNoteNotationStrip'
import type { AccompanimentRenderMeasure } from '../hooks/useAccompanimentNoteDialogController'
import type { AccompanimentPreviewPlaybackController } from '../hooks/useAccompanimentPreviewPlaybackController'

export function AccompanimentNoteModal(props: {
  isOpen: boolean
  target: {
    measureNumber: number
    chordName: string
    keyFifths: number
  } | null
  previewCandidates: AccompanimentRenderMeasure[]
  candidateMeasureMap: Map<number, string>
  selectedCandidateKey: string | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  accompanimentPreviewPlayback: AccompanimentPreviewPlaybackController
  errorMessage: string | null
  onClose: () => void
  onPreviewCandidate: (candidateKey: string) => Promise<void> | void
  onApplyCandidate: (candidateKey: string) => void
}) {
  const {
    isOpen,
    target,
    previewCandidates,
    candidateMeasureMap,
    selectedCandidateKey,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    grandStaffLayoutMetrics,
    accompanimentPreviewPlayback,
    errorMessage,
    onClose,
    onPreviewCandidate,
    onApplyCandidate,
  } = props
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  const previewGrandStaffLayoutMetrics = useMemo(
    () => getGrandStaffLayoutMetrics(grandStaffLayoutMetrics.staffInterGapPx, { includePedalLane: false }),
    [grandStaffLayoutMetrics.staffInterGapPx],
  )
  const {
    activeCandidateKey,
    playingMeasureNumber,
    playbackTick,
    playCachedTimeline,
    stopPlayback,
  } = accompanimentPreviewPlayback
  const resolvedSelectedCandidateKey = activeCandidateKey ?? selectedCandidateKey

  const stopLocalPreview = useCallback(() => {
    stopPlayback('close-or-reset-preview')
  }, [stopPlayback])

  const handlePreviewByMeasure = useCallback((measureNumber: number) => {
    const candidateKey = candidateMeasureMap.get(measureNumber)
    if (!candidateKey) return
    const measure = previewCandidates.find((entry) => entry.measureNumber === measureNumber)
    if (!measure) {
      stopPlayback('preview-measure-missing')
      return
    }

    if (import.meta.env.DEV) {
      console.info('[handlePreviewByMeasure:start]', { candidateKey, measureNumber })
    }

    void playCachedTimeline({
      candidateKey,
      measureNumber: measure.measureNumber,
      playbackTimelineEvents: measure.playbackTimelineEvents,
      playbackMeasureTicks: measure.playbackMeasureTicks,
    }).then((didStartPlayback) => {
      if (!didStartPlayback) {
        stopPlayback('play-start-failed')
        return
      }
      if (import.meta.env.DEV) {
        console.info('[handlePreviewByMeasure:play-started]', { candidateKey, measureNumber })
        console.info('[preview-candidate:apply-start]', { candidateKey, measureNumber })
      }
      void Promise.resolve(onPreviewCandidate(candidateKey))
        .finally(() => {
          if (import.meta.env.DEV) {
            console.info('[preview-candidate:apply-complete]', { candidateKey, measureNumber })
          }
        })
    })
  }, [
    candidateMeasureMap,
    onPreviewCandidate,
    playCachedTimeline,
    previewCandidates,
    stopPlayback,
  ])

  const handleApplyByMeasure = useCallback((measureNumber: number) => {
    const candidateKey = candidateMeasureMap.get(measureNumber)
    if (!candidateKey) return
    stopPlayback('apply-candidate')
    onApplyCandidate(candidateKey)
  }, [candidateMeasureMap, onApplyCandidate, stopPlayback])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      stopLocalPreview()
      onCloseRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (import.meta.env.DEV) {
        console.info('[modal-effect-cleanup]', { reason: 'keydown-effect-cleanup' })
      }
    }
  }, [isOpen, stopLocalPreview])

  useEffect(() => {
    if (isOpen) return
    if (import.meta.env.DEV) {
      console.info('[modal-effect-cleanup]', { reason: 'isOpen-change' })
    }
    stopPlayback('isOpen-change')
  }, [isOpen, stopPlayback])

  useEffect(() => {
    if (!isOpen) return
    if (selectedCandidateKey !== null) return
    stopPlayback('selected-candidate-reset')
  }, [isOpen, selectedCandidateKey, stopPlayback])

  if (!isOpen || !target) return null

  return (
    <div className="smart-chord-modal" onMouseDown={() => {
      stopLocalPreview()
      onClose()
    }}>
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
          <button
            type="button"
            className="smart-chord-modal-close"
            onClick={() => {
              stopLocalPreview()
              onClose()
            }}
            aria-label="关闭伴奏音符窗口"
          >
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

        {!errorMessage && previewCandidates.length > 0 && (
          <section className="smart-chord-candidate-section">
            <div className="smart-chord-option-header">
              <h4>候选列表</h4>
              <span>每个小节对应一个候选：单击预览，双击应用</span>
            </div>
            <AccompanimentNoteNotationStrip
              measures={previewCandidates}
              selectedCandidateKey={resolvedSelectedCandidateKey}
              playingMeasureNumber={playingMeasureNumber}
              playbackTick={playbackTick}
              timeAxisSpacingConfig={timeAxisSpacingConfig}
              spacingLayoutMode={spacingLayoutMode}
              grandStaffLayoutMetrics={previewGrandStaffLayoutMetrics}
              onPreviewByMeasure={handlePreviewByMeasure}
              onApplyByMeasure={handleApplyByMeasure}
            />
          </section>
        )}
      </div>
    </div>
  )
}
