import type { MutableRefObject } from 'react'
import { clampScalePercent } from '../scorePresentation'
import type { SpacingLayoutMode } from '../types'

export function buildRuntimeDebugImportAndScaleApi(params: {
  importMusicXmlTextWithCollapseReset: (xmlText: string) => void
  playScore: () => Promise<void> | void
  importFeedbackRef: MutableRefObject<{ kind: string; message: string }>
  autoScaleEnabled: boolean
  safeManualScalePercent: number
  baseScoreScale: number
  scoreScale: number
  scoreScaleX: number
  scoreScaleY: number
  spacingLayoutMode: SpacingLayoutMode
  setAutoScaleEnabled: (enabled: boolean) => void
  showNoteHeadJianpuEnabled: boolean
  setShowNoteHeadJianpuEnabled: (enabled: boolean) => void
  setManualScalePercent: (nextPercent: number) => void
}) {
  const {
    importMusicXmlTextWithCollapseReset,
    playScore,
    importFeedbackRef,
    autoScaleEnabled,
    safeManualScalePercent,
    baseScoreScale,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    spacingLayoutMode,
    setAutoScaleEnabled,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
    setManualScalePercent,
  } = params

  return {
    importMusicXmlText: (xmlText: string) => {
      importMusicXmlTextWithCollapseReset(xmlText)
    },
    playScore: () => {
      void playScore()
    },
    getImportFeedback: () => importFeedbackRef.current,
    getScaleConfig: () => ({
      autoScaleEnabled,
      manualScalePercent: safeManualScalePercent,
      baseScoreScale,
      scoreScale,
      scoreScaleX,
      scoreScaleY,
      isHorizontalView: true,
      spacingLayoutMode,
    }),
    setAutoScaleEnabled: (nextEnabled: boolean) => {
      setAutoScaleEnabled(Boolean(nextEnabled))
    },
    getShowNoteHeadJianpuEnabled: () => showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled: (nextEnabled: boolean) => {
      setShowNoteHeadJianpuEnabled(Boolean(nextEnabled))
    },
    setManualScalePercent: (nextPercent: number) => {
      setManualScalePercent(clampScalePercent(nextPercent))
    },
  }
}
