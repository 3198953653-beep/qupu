import { useCallback, useEffect, useMemo, type MutableRefObject } from 'react'
import { Renderer } from 'vexflow'
import type { ChordRulerEntry } from '../chordRuler'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import { buildNativePreviewLayout, type NativePreviewPageLayout } from '../layout/nativePreviewLayout'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import type { MeasurePair, MusicXmlMetadata, PedalSpan, TimeSignature } from '../types'
import { SCORE_RENDER_BACKEND } from './horizontalScoreLayoutShared'
import { useNativePreviewSettings } from './useNativePreviewSettings'

export function useNativePreviewController(params: {
  measurePairs: MeasurePair[]
  pedalSpans: PedalSpan[]
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
  musicXmlMetadataFromImport: MusicXmlMetadata | null
  supplementalSpacingTicksByPair: number[][] | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  showInScoreMeasureNumbers: boolean
  showNoteHeadJianpuEnabled: boolean
  widthProbeRendererRef: MutableRefObject<Renderer | null>
}): {
  isNativePreviewOpen: boolean
  nativePreviewError: string
  nativePreviewStatusText: string
  nativePreviewPageIndex: number
  nativePreviewPageCount: number
  nativePreviewShowPageNumbers: boolean
  safeNativePreviewPaperScalePercent: number
  safeNativePreviewHorizontalMarginPx: number
  safeNativePreviewFirstPageTopMarginPx: number
  safeNativePreviewTopMarginPx: number
  safeNativePreviewBottomMarginPx: number
  safeNativePreviewMinEighthGapPx: number
  safeNativePreviewMinGrandStaffGapPx: number
  nativePreviewPaperScale: number
  nativePreviewPaperWidthPx: number
  nativePreviewPaperHeightPx: number
  nativePreviewCurrentPage: NativePreviewPageLayout | null
  nativePreviewMetadata: MusicXmlMetadata | null
  nativePreviewPedalSpans: PedalSpan[]
  nativePreviewChordRulerEntriesByPair: ChordRulerEntry[][] | null
  nativePreviewMeasurePairs: MeasurePair[]
  nativePreviewMeasureKeyFifthsFromImport: number[] | null
  nativePreviewMeasureTimeSignaturesFromImport: TimeSignature[] | null
  nativePreviewSupplementalSpacingTicksByPair: number[][] | null
  nativePreviewTimeAxisSpacingConfig: TimeAxisSpacingConfig
  nativePreviewGrandStaffLayoutMetrics: GrandStaffLayoutMetrics
  nativePreviewShowInScoreMeasureNumbers: boolean
  nativePreviewShowNoteHeadJianpuEnabled: boolean
  openNativePreview: () => void
  closeNativePreview: () => void
  goToPrevNativePreviewPage: () => void
  goToNextNativePreviewPage: () => void
  onNativePreviewPaperScalePercentChange: (nextValue: number) => void
  onNativePreviewHorizontalMarginPxChange: (nextValue: number) => void
  onNativePreviewFirstPageTopMarginPxChange: (nextValue: number) => void
  onNativePreviewTopMarginPxChange: (nextValue: number) => void
  onNativePreviewBottomMarginPxChange: (nextValue: number) => void
  onNativePreviewMinEighthGapPxChange: (nextValue: number) => void
  onNativePreviewMinGrandStaffGapPxChange: (nextValue: number) => void
  onNativePreviewShowPageNumbersChange: (enabled: boolean) => void
  dumpNativePreviewLayoutDiagnostics: () => unknown
} {
  const {
    measurePairs,
    pedalSpans,
    chordRulerEntriesByPair,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    musicXmlMetadataFromImport,
    supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
    grandStaffLayoutMetrics,
    showInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    widthProbeRendererRef,
  } = params

  const settings = useNativePreviewSettings()

  const getWidthProbeContext = useCallback((): ReturnType<Renderer['getContext']> | null => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null
    const probeWidth = 2048
    const probeHeight = 768
    const existing = widthProbeRendererRef.current
    if (existing) {
      existing.resize(probeWidth, probeHeight)
      return existing.getContext()
    }
    const canvas = document.createElement('canvas')
    const renderer = new Renderer(canvas, SCORE_RENDER_BACKEND)
    renderer.resize(probeWidth, probeHeight)
    widthProbeRendererRef.current = renderer
    return renderer.getContext()
  }, [widthProbeRendererRef])

  const nativePreviewLayout = useMemo(() => {
    if (!settings.isNativePreviewOpen) {
      return { pages: [] as NativePreviewPageLayout[], error: '' }
    }
    const context = getWidthProbeContext()
    if (!context) {
      return { pages: [] as NativePreviewPageLayout[], error: '当前环境无法创建预览测量画布。' }
    }
    try {
      return {
        pages: buildNativePreviewLayout({
          context,
          measurePairs,
          measureKeyFifthsFromImport,
          measureTimeSignaturesFromImport,
          supplementalSpacingTicksByPair,
          spacingConfig: timeAxisSpacingConfig,
          grandStaffLayoutMetrics,
          horizontalMarginPx: settings.safeNativePreviewHorizontalMarginPx,
          firstPageTopMarginPx: settings.safeNativePreviewFirstPageTopMarginPx,
          topMarginPx: settings.safeNativePreviewTopMarginPx,
          bottomMarginPx: settings.safeNativePreviewBottomMarginPx,
          minEighthGapPx: settings.safeNativePreviewMinEighthGapPx,
          minGrandStaffGapPx: settings.safeNativePreviewMinGrandStaffGapPx,
          showNoteHeadJianpu: showNoteHeadJianpuEnabled,
        }).pages,
        error: '',
      }
    } catch (error) {
      return {
        pages: [] as NativePreviewPageLayout[],
        error: error instanceof Error ? error.message : '五线谱预览布局失败。',
      }
    }
  }, [
    getWidthProbeContext,
    grandStaffLayoutMetrics,
    measureKeyFifthsFromImport,
    measurePairs,
    measureTimeSignaturesFromImport,
    settings.isNativePreviewOpen,
    settings.safeNativePreviewBottomMarginPx,
    settings.safeNativePreviewFirstPageTopMarginPx,
    settings.safeNativePreviewHorizontalMarginPx,
    settings.safeNativePreviewMinEighthGapPx,
    settings.safeNativePreviewMinGrandStaffGapPx,
    settings.safeNativePreviewTopMarginPx,
    showNoteHeadJianpuEnabled,
    supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
  ])

  useEffect(() => {
    settings.setNativePreviewError(nativePreviewLayout.error)
  }, [nativePreviewLayout.error, settings.setNativePreviewError])

  useEffect(() => {
    settings.setNativePreviewPageCount(Math.max(1, nativePreviewLayout.pages.length))
  }, [nativePreviewLayout.pages.length, settings.setNativePreviewPageCount])

  const nativePreviewCurrentPage = nativePreviewLayout.pages[settings.nativePreviewPageIndex] ?? null
  const nativePreviewStatusText = useMemo(() => {
    if (!settings.isNativePreviewOpen) return ''
    if (nativePreviewLayout.error) return ''
    if (!nativePreviewCurrentPage) return measurePairs.length === 0 ? '当前谱面为空。' : '正在生成预览页。'
    const systemCount = nativePreviewCurrentPage.systemLayouts.length
    const minEquivalentGapPx =
      Number.isFinite(nativePreviewCurrentPage.minEquivalentEighthGapPx) &&
      nativePreviewCurrentPage.minEquivalentEighthGapPx > 0
        ? nativePreviewCurrentPage.minEquivalentEighthGapPx.toFixed(1)
        : '0.0'
    return `当前页 ${systemCount} 行，大谱表间距 ${nativePreviewCurrentPage.actualSystemGapPx.toFixed(1)}px，最小等效八分间距 ${minEquivalentGapPx}px`
  }, [
    measurePairs.length,
    nativePreviewCurrentPage,
    nativePreviewLayout.error,
    settings.isNativePreviewOpen,
  ])

  const openNativePreview = useCallback(() => {
    settings.setNativePreviewError('')
    settings.setIsNativePreviewOpen(true)
  }, [settings.setIsNativePreviewOpen, settings.setNativePreviewError])

  const closeNativePreview = useCallback(() => {
    settings.setIsNativePreviewOpen(false)
  }, [settings.setIsNativePreviewOpen])

  const dumpNativePreviewLayoutDiagnostics = useCallback(() => {
    return nativePreviewLayout.pages.map((page) => ({
      pageIndex: page.pageIndex,
      pageNumber: page.pageNumber,
      actualSystemGapPx: page.actualSystemGapPx,
      minEquivalentEighthGapPx: page.minEquivalentEighthGapPx,
      systemRanges: page.systemRanges.map((range) => ({ ...range })),
      systems: page.systemLayouts.map((system) => ({
        range: { ...system.range },
        equivalentEighthGapPx: system.equivalentEighthGapPx,
        elasticScale: system.elasticScale,
        usableWidthPx: system.usableWidthPx,
        fixedWidthTotalPx: system.fixedWidthTotalPx,
        elasticWidthTotalPx: system.elasticWidthTotalPx,
        totalWidthPx: system.totalWidthPx,
        measures: system.measures.map((measure) => ({ ...measure })),
      })),
    }))
  }, [nativePreviewLayout.pages])

  return {
    isNativePreviewOpen: settings.isNativePreviewOpen,
    nativePreviewError: settings.nativePreviewError,
    nativePreviewStatusText,
    nativePreviewPageIndex: settings.nativePreviewPageIndex,
    nativePreviewPageCount: Math.max(1, nativePreviewLayout.pages.length),
    nativePreviewShowPageNumbers: settings.nativePreviewShowPageNumbers,
    safeNativePreviewPaperScalePercent: settings.safeNativePreviewPaperScalePercent,
    safeNativePreviewHorizontalMarginPx: settings.safeNativePreviewHorizontalMarginPx,
    safeNativePreviewFirstPageTopMarginPx: settings.safeNativePreviewFirstPageTopMarginPx,
    safeNativePreviewTopMarginPx: settings.safeNativePreviewTopMarginPx,
    safeNativePreviewBottomMarginPx: settings.safeNativePreviewBottomMarginPx,
    safeNativePreviewMinEighthGapPx: settings.safeNativePreviewMinEighthGapPx,
    safeNativePreviewMinGrandStaffGapPx: settings.safeNativePreviewMinGrandStaffGapPx,
    nativePreviewPaperScale: settings.nativePreviewPaperScale,
    nativePreviewPaperWidthPx: settings.nativePreviewPaperWidthPx,
    nativePreviewPaperHeightPx: settings.nativePreviewPaperHeightPx,
    nativePreviewCurrentPage,
    nativePreviewMetadata: musicXmlMetadataFromImport,
    nativePreviewPedalSpans: pedalSpans,
    nativePreviewChordRulerEntriesByPair: chordRulerEntriesByPair,
    nativePreviewMeasurePairs: measurePairs,
    nativePreviewMeasureKeyFifthsFromImport: measureKeyFifthsFromImport,
    nativePreviewMeasureTimeSignaturesFromImport: measureTimeSignaturesFromImport,
    nativePreviewSupplementalSpacingTicksByPair: supplementalSpacingTicksByPair,
    nativePreviewTimeAxisSpacingConfig: timeAxisSpacingConfig,
    nativePreviewGrandStaffLayoutMetrics: grandStaffLayoutMetrics,
    nativePreviewShowInScoreMeasureNumbers: showInScoreMeasureNumbers,
    nativePreviewShowNoteHeadJianpuEnabled: showNoteHeadJianpuEnabled,
    openNativePreview,
    closeNativePreview,
    goToPrevNativePreviewPage: settings.goToPrevNativePreviewPage,
    goToNextNativePreviewPage: settings.goToNextNativePreviewPage,
    onNativePreviewPaperScalePercentChange: settings.onNativePreviewPaperScalePercentChange,
    onNativePreviewHorizontalMarginPxChange: settings.onNativePreviewHorizontalMarginPxChange,
    onNativePreviewFirstPageTopMarginPxChange: settings.onNativePreviewFirstPageTopMarginPxChange,
    onNativePreviewTopMarginPxChange: settings.onNativePreviewTopMarginPxChange,
    onNativePreviewBottomMarginPxChange: settings.onNativePreviewBottomMarginPxChange,
    onNativePreviewMinEighthGapPxChange: settings.onNativePreviewMinEighthGapPxChange,
    onNativePreviewMinGrandStaffGapPxChange: settings.onNativePreviewMinGrandStaffGapPxChange,
    onNativePreviewShowPageNumbersChange: settings.onNativePreviewShowPageNumbersChange,
    dumpNativePreviewLayoutDiagnostics,
  }
}
