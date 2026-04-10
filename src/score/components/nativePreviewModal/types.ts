import type { ChordRulerEntry } from '../../chordRuler'
import type { GrandStaffLayoutMetrics } from '../../grandStaffLayout'
import type { NativePreviewPageLayout } from '../../layout/nativePreviewLayout'
import type { TimeAxisSpacingConfig } from '../../layout/timeAxisSpacing'
import type { MeasureLayout, MeasurePair, MusicXmlMetadata, PedalSpan, TimeSignature } from '../../types'

export type NativePreviewModalProps = {
  isOpen: boolean
  error: string
  statusText: string
  pageIndex: number
  pageCount: number
  showPageNumbers: boolean
  zoomDraftPercent: number
  safeZoomPercent: number
  safePaperScalePercent: number
  safeHorizontalMarginPx: number
  safeFirstPageTopMarginPx: number
  safeTopMarginPx: number
  safeBottomMarginPx: number
  safeMinEighthGapPx: number
  safeMinGrandStaffGapPx: number
  paperScale: number
  paperWidthPx: number
  paperHeightPx: number
  currentPage: NativePreviewPageLayout | null
  metadata: MusicXmlMetadata | null
  measurePairs: MeasurePair[]
  pedalSpans: PedalSpan[]
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  supplementalSpacingTicksByPair: number[][] | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  showInScoreMeasureNumbers: boolean
  showNoteHeadJianpuEnabled: boolean
  onNativePreviewPageRenderedDiagnostics: (pageIndex: number, measureLayouts: Map<number, MeasureLayout>) => void
  closeNativePreview: () => void
  goToPrevNativePreviewPage: () => void
  goToNextNativePreviewPage: () => void
  commitNativePreviewZoomPercent: (nextValue: number) => void
  scheduleNativePreviewZoomPercentCommit: (nextValue: number) => void
  onNativePreviewPaperScalePercentChange: (nextValue: number) => void
  onNativePreviewHorizontalMarginPxChange: (nextValue: number) => void
  onNativePreviewFirstPageTopMarginPxChange: (nextValue: number) => void
  onNativePreviewTopMarginPxChange: (nextValue: number) => void
  onNativePreviewBottomMarginPxChange: (nextValue: number) => void
  onNativePreviewMinEighthGapPxChange: (nextValue: number) => void
  onNativePreviewMinGrandStaffGapPxChange: (nextValue: number) => void
  onNativePreviewShowPageNumbersChange: (enabled: boolean) => void
}
