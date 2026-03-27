import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { buildMusicXmlExportPayload } from '../musicXmlActions'
import type {
  ImportedNoteLocation,
  MeasureFrame,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  Selection,
  TimeSignature,
} from '../types'
import { exportOsmdPreviewPagesToPdf } from './osmdPreviewPdf'
import {
  applyOsmdPreviewHorizontalMargins,
  applyOsmdPreviewVerticalMargins,
  renderAndRebalanceOsmdPreview,
} from './osmdPreviewRebalance'
import { useOsmdPreviewNavigation } from './useOsmdPreviewNavigation'
import { useOsmdPreviewSettings } from './useOsmdPreviewSettings'
import {
  DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX,
  OSMD_PREVIEW_FAST_STAGE_MEASURE_LIMIT,
  OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX,
  OSMD_PREVIEW_MARGIN_APPLY_DEBOUNCE_MS,
  buildFastOsmdPreviewXml,
  buildOsmdPreviewSystemMetrics,
  clampOsmdPreviewBottomMarginPx,
  clampOsmdPreviewZoomPercent,
  collectOsmdPreviewPages,
  applyOsmdPreviewPageNumbers,
  applyOsmdPreviewPageVisibility,
  sanitizeMusicXmlForOsmdPreview,
} from './osmdPreviewUtils'

export type {
  OsmdPreviewInstance,
  OsmdPreviewRebalanceStats,
  OsmdPreviewSelectionTarget,
} from './osmdPreviewUtils'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useOsmdPreviewController(params: {
  measurePairs: MeasurePair[]
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  musicXmlMetadataFromImportRef: MutableRefObject<MusicXmlMetadata | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  horizontalMeasureFramesByPair: MeasureFrame[]
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  noteLayoutByKeyRef: MutableRefObject<Map<string, NoteLayout>>
  horizontalRenderOffsetXRef: MutableRefObject<number>
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  scoreScaleX: number
  setIsSelectionVisible: StateSetter<boolean>
  setActiveSelection: StateSetter<Selection>
  setSelectedSelections: StateSetter<Selection[]>
  setDraggingSelection: StateSetter<Selection | null>
  setSelectedMeasureScope: StateSetter<{ pairIndex: number; staff: Selection['staff'] } | null>
  clearActiveChordSelection: () => void
  resetMidiStepChain: () => void
}): {
  isOsmdPreviewOpen: boolean
  isOsmdPreviewExportingPdf: boolean
  osmdPreviewStatusText: string
  osmdPreviewError: string
  osmdPreviewPageIndex: number
  osmdPreviewPageCount: number
  osmdPreviewShowPageNumbers: boolean
  osmdPreviewZoomDraftPercent: number
  safeOsmdPreviewPaperScalePercent: number
  safeOsmdPreviewHorizontalMarginPx: number
  safeOsmdPreviewFirstPageTopMarginPx: number
  safeOsmdPreviewTopMarginPx: number
  safeOsmdPreviewBottomMarginPx: number
  osmdPreviewPaperScale: number
  osmdPreviewPaperWidthPx: number
  osmdPreviewPaperHeightPx: number
  osmdPreviewContainerRef: MutableRefObject<HTMLDivElement | null>
  osmdDirectFileInputRef: MutableRefObject<HTMLInputElement | null>
  osmdPreviewInstanceRef: ReturnType<typeof useOsmdPreviewSettings>['osmdPreviewInstanceRef']
  osmdPreviewLastRebalanceStatsRef: ReturnType<typeof useOsmdPreviewSettings>['osmdPreviewLastRebalanceStatsRef']
  osmdPreviewNoteLookupBySelectionRef: ReturnType<typeof useOsmdPreviewNavigation>['osmdPreviewNoteLookupBySelectionRef']
  osmdPreviewSelectedSelectionKeyRef: ReturnType<typeof useOsmdPreviewNavigation>['osmdPreviewSelectedSelectionKeyRef']
  closeOsmdPreview: () => void
  openOsmdPreview: () => void
  openDirectOsmdFilePicker: () => void
  onOsmdDirectFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  exportOsmdPreviewPdf: () => Promise<void>
  goToPrevOsmdPreviewPage: () => void
  goToNextOsmdPreviewPage: () => void
  commitOsmdPreviewZoomPercent: (nextValue: number) => void
  scheduleOsmdPreviewZoomPercentCommit: (nextValue: number) => void
  onOsmdPreviewPaperScalePercentChange: (nextValue: number) => void
  onOsmdPreviewHorizontalMarginPxChange: (nextValue: number) => void
  onOsmdPreviewFirstPageTopMarginPxChange: (nextValue: number) => void
  onOsmdPreviewTopMarginPxChange: (nextValue: number) => void
  onOsmdPreviewBottomMarginPxChange: (nextValue: number) => void
  onOsmdPreviewShowPageNumbersChange: (nextVisible: boolean) => void
  onOsmdPreviewSurfaceClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onOsmdPreviewSurfaceDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  dumpOsmdPreviewSystemMetrics: () => ReturnType<typeof buildOsmdPreviewSystemMetrics>
} {
  const {
    measurePairs,
    measurePairsRef,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    horizontalMeasureFramesByPair,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    scoreScrollRef,
    scoreScaleX,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setDraggingSelection,
    setSelectedMeasureScope,
    clearActiveChordSelection,
    resetMidiStepChain,
  } = params

  const settings = useOsmdPreviewSettings()
  const closeOsmdPreviewRef = useRef<(() => void) | null>(null)
  const navigation = useOsmdPreviewNavigation({
    measurePairs,
    measurePairsRef,
    importedNoteLookupRef,
    horizontalMeasureFramesByPair,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    scoreScrollRef,
    scoreScaleX,
    osmdPreviewSourceMode: settings.osmdPreviewSourceMode,
    osmdPreviewContainerRef: settings.osmdPreviewContainerRef,
    osmdPreviewInstanceRef: settings.osmdPreviewInstanceRef,
    closeOsmdPreviewRef,
    resetMidiStepChain,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setDraggingSelection,
    setSelectedMeasureScope,
    clearActiveChordSelection,
  })

  const closeOsmdPreview = useCallback(() => {
    if (settings.osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(settings.osmdPreviewZoomCommitTimerRef.current)
      settings.osmdPreviewZoomCommitTimerRef.current = null
    }
    settings.setIsOsmdPreviewOpen(false)
    settings.setOsmdPreviewStatusText('')
    settings.setOsmdPreviewError('')
    settings.setOsmdPreviewSourceMode('editor')
    settings.setOsmdPreviewPageIndex(0)
    settings.setOsmdPreviewPageCount(1)
    settings.osmdPreviewPagesRef.current = []
    settings.osmdPreviewInstanceRef.current = null
    navigation.resetOsmdPreviewNavigationState()
  }, [
    navigation.resetOsmdPreviewNavigationState,
    settings.osmdPreviewInstanceRef,
    settings.osmdPreviewPagesRef,
    settings.osmdPreviewZoomCommitTimerRef,
    settings.setIsOsmdPreviewOpen,
    settings.setOsmdPreviewError,
    settings.setOsmdPreviewPageCount,
    settings.setOsmdPreviewPageIndex,
    settings.setOsmdPreviewSourceMode,
    settings.setOsmdPreviewStatusText,
  ])

  closeOsmdPreviewRef.current = closeOsmdPreview

  const openOsmdPreviewWithXml = useCallback((previewXmlText: string, sourceMode: 'editor' | 'direct-file') => {
    settings.setOsmdPreviewSourceMode(sourceMode)
    settings.setOsmdPreviewXml(previewXmlText)
    settings.setOsmdPreviewStatusText('正在生成OSMD预览...')
    settings.setOsmdPreviewError('')
    settings.setOsmdPreviewPageIndex(0)
    settings.setOsmdPreviewPageCount(1)
    settings.setIsOsmdPreviewOpen(true)
  }, [
    settings.setIsOsmdPreviewOpen,
    settings.setOsmdPreviewError,
    settings.setOsmdPreviewPageCount,
    settings.setOsmdPreviewPageIndex,
    settings.setOsmdPreviewSourceMode,
    settings.setOsmdPreviewStatusText,
    settings.setOsmdPreviewXml,
  ])

  const openOsmdPreview = useCallback(() => {
    const { xmlText } = buildMusicXmlExportPayload({
      measurePairs,
      keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
      divisionsByMeasure: measureDivisionsFromImportRef.current,
      timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
      metadata: musicXmlMetadataFromImportRef.current,
    })
    const previewXmlText = sanitizeMusicXmlForOsmdPreview(xmlText, measurePairs)
    openOsmdPreviewWithXml(previewXmlText, 'editor')
  }, [
    measureDivisionsFromImportRef,
    measureKeyFifthsFromImportRef,
    measurePairs,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImportRef,
    openOsmdPreviewWithXml,
  ])

  const openDirectOsmdFilePicker = useCallback(() => {
    const input = settings.osmdDirectFileInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }, [settings.osmdDirectFileInputRef])

  const onOsmdDirectFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const selectedFile = input.files?.[0]
    input.value = ''
    if (!selectedFile) return
    try {
      settings.setOsmdPreviewError('')
      settings.setOsmdPreviewStatusText('正在读取MusicXML文件...')
      const xmlText = await selectedFile.text()
      if (!xmlText.trim()) {
        settings.setOsmdPreviewStatusText('')
        settings.setOsmdPreviewError('所选文件为空，无法预览。')
        return
      }
      openOsmdPreviewWithXml(xmlText, 'direct-file')
    } catch (error) {
      settings.setOsmdPreviewStatusText('')
      const message = error instanceof Error ? error.message : '读取MusicXML文件失败。'
      settings.setOsmdPreviewError(message)
    }
  }, [
    openOsmdPreviewWithXml,
    settings.setOsmdPreviewError,
    settings.setOsmdPreviewStatusText,
  ])

  const exportOsmdPreviewPdf = useCallback(async () => {
    if (settings.isOsmdPreviewExportingPdf) return
    const container = settings.osmdPreviewContainerRef.current
    if (!container) {
      settings.setOsmdPreviewError('当前没有可导出的预览内容。')
      return
    }
    const pageElements = collectOsmdPreviewPages(container)
    if (pageElements.length === 0) {
      settings.setOsmdPreviewError('当前没有可导出的预览页面。')
      return
    }

    settings.setIsOsmdPreviewExportingPdf(true)
    settings.setOsmdPreviewError('')
    try {
      const exportedCount = await exportOsmdPreviewPagesToPdf({
        pageElements,
        rawFileName: (musicXmlMetadataFromImportRef.current?.workTitle ?? 'score-preview').trim() || 'score-preview',
        onProgress: settings.setOsmdPreviewStatusText,
      })
      settings.setOsmdPreviewStatusText(`PDF导出完成，共 ${exportedCount} 页。`)
      window.setTimeout(() => {
        settings.setOsmdPreviewStatusText((current) => (current.startsWith('PDF导出完成') ? '' : current))
      }, 2200)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF导出失败。'
      settings.setOsmdPreviewError(message)
    } finally {
      settings.setIsOsmdPreviewExportingPdf(false)
    }
  }, [
    musicXmlMetadataFromImportRef,
    settings.isOsmdPreviewExportingPdf,
    settings.osmdPreviewContainerRef,
    settings.setIsOsmdPreviewExportingPdf,
    settings.setOsmdPreviewError,
    settings.setOsmdPreviewStatusText,
  ])

  useEffect(() => {
    if (!settings.isOsmdPreviewOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeOsmdPreview()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeOsmdPreview, settings.isOsmdPreviewOpen])

  useEffect(() => {
    if (!settings.isOsmdPreviewOpen) return
    if (!settings.osmdPreviewXml.trim()) {
      settings.setOsmdPreviewError('没有可预览的MusicXML数据。')
      settings.setOsmdPreviewStatusText('')
      return
    }
    let canceled = false
    const renderPreview = async () => {
      try {
        const container = settings.osmdPreviewContainerRef.current
        if (!container) return
        settings.setOsmdPreviewError('')
        settings.setOsmdPreviewStatusText('正在生成OSMD预览...')
        container.innerHTML = ''
        const osmdModule = await import('opensheetmusicdisplay')
        if (canceled) return
        const osmd = new osmdModule.OpenSheetMusicDisplay(container, {
          autoResize: false,
          backend: 'svg',
          drawTitle: true,
          pageFormat: 'A4_P',
          drawMeasureNumbers: true,
          drawMeasureNumbersOnlyAtSystemStart: true,
          useXMLMeasureNumbers: true,
        })
        const fastStageXml = buildFastOsmdPreviewXml(settings.osmdPreviewXml, OSMD_PREVIEW_FAST_STAGE_MEASURE_LIMIT)
        const useFastStageXml = fastStageXml !== settings.osmdPreviewXml

        await osmd.load(useFastStageXml ? fastStageXml : settings.osmdPreviewXml)
        if (canceled) return
        const previewInstance = osmd as unknown as import('./osmdPreviewUtils').OsmdPreviewInstance
        osmd.Zoom = clampOsmdPreviewZoomPercent(settings.osmdPreviewZoomPercent) / 100
        applyOsmdPreviewHorizontalMargins(previewInstance, settings.osmdPreviewHorizontalMarginPxRef.current)
        applyOsmdPreviewVerticalMargins(
          previewInstance,
          OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX,
          clampOsmdPreviewBottomMarginPx(
            Math.min(
              settings.osmdPreviewBottomMarginPxRef.current,
              DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX,
            ),
          ),
        )
        previewInstance.render()
        if (canceled) return
        settings.osmdPreviewInstanceRef.current = previewInstance
        let renderedPages = collectOsmdPreviewPages(container)
        settings.osmdPreviewPagesRef.current = renderedPages
        applyOsmdPreviewPageNumbers(renderedPages, settings.osmdPreviewShowPageNumbersRef.current)
        let graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
        let nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
        settings.setOsmdPreviewPageCount(nextPageCount)
        applyOsmdPreviewPageVisibility(renderedPages, 0)
        navigation.rebuildOsmdPreviewNoteLookup()
        settings.setOsmdPreviewStatusText(
          useFastStageXml ? '已显示第一页，正在后台加载完整曲谱...' : '已显示第一页，正在优化后续分页...',
        )
        await new Promise<void>((resolve) => {
          if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            resolve()
            return
          }
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve())
          })
        })
        if (canceled) return

        if (useFastStageXml) {
          settings.setOsmdPreviewStatusText('正在加载完整曲谱并优化分页...')
          await osmd.load(settings.osmdPreviewXml)
          if (canceled) return
          osmd.Zoom = clampOsmdPreviewZoomPercent(settings.osmdPreviewZoomPercent) / 100
        }

        settings.osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
          previewInstance,
          settings.osmdPreviewHorizontalMarginPxRef.current,
          settings.osmdPreviewFirstPageTopMarginPxRef.current,
          settings.osmdPreviewTopMarginPxRef.current,
          settings.osmdPreviewBottomMarginPxRef.current,
        )
        if (canceled) return
        renderedPages = collectOsmdPreviewPages(container)
        settings.osmdPreviewPagesRef.current = renderedPages
        applyOsmdPreviewPageNumbers(renderedPages, settings.osmdPreviewShowPageNumbersRef.current)
        graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
        nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
        settings.setOsmdPreviewPageCount(nextPageCount)
        applyOsmdPreviewPageVisibility(renderedPages, 0)
        navigation.rebuildOsmdPreviewNoteLookup()
        settings.setOsmdPreviewStatusText('')
      } catch (error) {
        if (canceled) return
        settings.setOsmdPreviewStatusText('')
        const message = error instanceof Error ? error.message : 'OSMD预览渲染失败。'
        settings.setOsmdPreviewError(message)
      }
    }
    void renderPreview()
    return () => {
      canceled = true
      settings.osmdPreviewInstanceRef.current = null
      settings.osmdPreviewPagesRef.current = []
      const container = settings.osmdPreviewContainerRef.current
      if (container) {
        container.innerHTML = ''
      }
      navigation.resetOsmdPreviewNavigationState()
    }
  }, [
    navigation.rebuildOsmdPreviewNoteLookup,
    navigation.resetOsmdPreviewNavigationState,
    settings.isOsmdPreviewOpen,
    settings.osmdPreviewBottomMarginPxRef,
    settings.osmdPreviewContainerRef,
    settings.osmdPreviewInstanceRef,
    settings.osmdPreviewLastRebalanceStatsRef,
    settings.osmdPreviewPagesRef,
    settings.osmdPreviewShowPageNumbersRef,
    settings.osmdPreviewTopMarginPxRef,
    settings.osmdPreviewFirstPageTopMarginPxRef,
    settings.osmdPreviewHorizontalMarginPxRef,
    settings.osmdPreviewXml,
    settings.osmdPreviewZoomPercent,
    settings.setOsmdPreviewError,
    settings.setOsmdPreviewPageCount,
    settings.setOsmdPreviewStatusText,
  ])

  useEffect(() => {
    settings.setOsmdPreviewPageIndex((current) => Math.max(0, Math.min(current, settings.osmdPreviewPageCount - 1)))
  }, [settings.osmdPreviewPageCount, settings.setOsmdPreviewPageIndex])

  useEffect(() => {
    if (!settings.isOsmdPreviewOpen) return
    const osmd = settings.osmdPreviewInstanceRef.current
    if (!osmd) return
    const nextZoom = clampOsmdPreviewZoomPercent(settings.osmdPreviewZoomPercent) / 100
    if (Math.abs(osmd.Zoom - nextZoom) < 1e-6) return
    osmd.Zoom = nextZoom
    settings.osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
      osmd,
      settings.osmdPreviewHorizontalMarginPxRef.current,
      settings.osmdPreviewFirstPageTopMarginPxRef.current,
      settings.osmdPreviewTopMarginPxRef.current,
      settings.osmdPreviewBottomMarginPxRef.current,
    )
    const container = settings.osmdPreviewContainerRef.current
    if (!container) return
    const renderedPages = collectOsmdPreviewPages(container)
    settings.osmdPreviewPagesRef.current = renderedPages
    applyOsmdPreviewPageNumbers(renderedPages, settings.osmdPreviewShowPageNumbersRef.current)
    const graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
    const nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
    settings.setOsmdPreviewPageCount(nextPageCount)
    applyOsmdPreviewPageVisibility(renderedPages, settings.osmdPreviewPageIndexRef.current)
    navigation.rebuildOsmdPreviewNoteLookup()
  }, [
    navigation,
    settings.isOsmdPreviewOpen,
    settings.osmdPreviewBottomMarginPxRef,
    settings.osmdPreviewFirstPageTopMarginPxRef,
    settings.osmdPreviewHorizontalMarginPxRef,
    settings.osmdPreviewInstanceRef,
    settings.osmdPreviewPageIndexRef,
    settings.osmdPreviewShowPageNumbersRef,
    settings.osmdPreviewTopMarginPxRef,
    settings.osmdPreviewZoomPercent,
    settings.osmdPreviewContainerRef,
    settings.osmdPreviewPagesRef,
    settings.osmdPreviewLastRebalanceStatsRef,
    settings.setOsmdPreviewPageCount,
  ])

  useEffect(() => {
    if (!settings.isOsmdPreviewOpen) return
    const osmd = settings.osmdPreviewInstanceRef.current
    if (!osmd) return
    if (settings.osmdPreviewMarginApplyTimerRef.current !== null) {
      window.clearTimeout(settings.osmdPreviewMarginApplyTimerRef.current)
      settings.osmdPreviewMarginApplyTimerRef.current = null
    }
    settings.osmdPreviewMarginApplyTimerRef.current = window.setTimeout(() => {
      settings.osmdPreviewMarginApplyTimerRef.current = null
      const container = settings.osmdPreviewContainerRef.current
      settings.osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
        osmd,
        settings.osmdPreviewHorizontalMarginPx,
        settings.osmdPreviewFirstPageTopMarginPx,
        settings.osmdPreviewTopMarginPx,
        settings.osmdPreviewBottomMarginPx,
      )
      if (!container) return
      const renderedPages = collectOsmdPreviewPages(container)
      settings.osmdPreviewPagesRef.current = renderedPages
      applyOsmdPreviewPageNumbers(renderedPages, settings.osmdPreviewShowPageNumbersRef.current)
      const graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
      const nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
      settings.setOsmdPreviewPageCount(nextPageCount)
      applyOsmdPreviewPageVisibility(renderedPages, settings.osmdPreviewPageIndexRef.current)
      navigation.rebuildOsmdPreviewNoteLookup()
    }, OSMD_PREVIEW_MARGIN_APPLY_DEBOUNCE_MS)
    return () => {
      if (settings.osmdPreviewMarginApplyTimerRef.current !== null) {
        window.clearTimeout(settings.osmdPreviewMarginApplyTimerRef.current)
        settings.osmdPreviewMarginApplyTimerRef.current = null
      }
    }
  }, [
    navigation,
    settings.isOsmdPreviewOpen,
    settings.osmdPreviewBottomMarginPx,
    settings.osmdPreviewFirstPageTopMarginPx,
    settings.osmdPreviewHorizontalMarginPx,
    settings.osmdPreviewTopMarginPx,
    settings.osmdPreviewContainerRef,
    settings.osmdPreviewInstanceRef,
    settings.osmdPreviewLastRebalanceStatsRef,
    settings.osmdPreviewMarginApplyTimerRef,
    settings.osmdPreviewPageIndexRef,
    settings.osmdPreviewPagesRef,
    settings.osmdPreviewShowPageNumbersRef,
    settings.setOsmdPreviewPageCount,
  ])

  useEffect(() => {
    applyOsmdPreviewPageVisibility(settings.osmdPreviewPagesRef.current, settings.osmdPreviewPageIndex)
  }, [settings.osmdPreviewPageCount, settings.osmdPreviewPageIndex, settings.osmdPreviewPagesRef])

  useEffect(() => {
    applyOsmdPreviewPageNumbers(settings.osmdPreviewPagesRef.current, settings.osmdPreviewShowPageNumbers)
  }, [settings.osmdPreviewPageCount, settings.osmdPreviewPagesRef, settings.osmdPreviewShowPageNumbers])

  const dumpOsmdPreviewSystemMetrics = useCallback(() => {
    return buildOsmdPreviewSystemMetrics(settings.osmdPreviewInstanceRef.current)
  }, [settings.osmdPreviewInstanceRef])

  return {
    isOsmdPreviewOpen: settings.isOsmdPreviewOpen,
    isOsmdPreviewExportingPdf: settings.isOsmdPreviewExportingPdf,
    osmdPreviewStatusText: settings.osmdPreviewStatusText,
    osmdPreviewError: settings.osmdPreviewError,
    osmdPreviewPageIndex: settings.osmdPreviewPageIndex,
    osmdPreviewPageCount: settings.osmdPreviewPageCount,
    osmdPreviewShowPageNumbers: settings.osmdPreviewShowPageNumbers,
    osmdPreviewZoomDraftPercent: settings.osmdPreviewZoomDraftPercent,
    safeOsmdPreviewPaperScalePercent: settings.safeOsmdPreviewPaperScalePercent,
    safeOsmdPreviewHorizontalMarginPx: settings.safeOsmdPreviewHorizontalMarginPx,
    safeOsmdPreviewFirstPageTopMarginPx: settings.safeOsmdPreviewFirstPageTopMarginPx,
    safeOsmdPreviewTopMarginPx: settings.safeOsmdPreviewTopMarginPx,
    safeOsmdPreviewBottomMarginPx: settings.safeOsmdPreviewBottomMarginPx,
    osmdPreviewPaperScale: settings.osmdPreviewPaperScale,
    osmdPreviewPaperWidthPx: settings.osmdPreviewPaperWidthPx,
    osmdPreviewPaperHeightPx: settings.osmdPreviewPaperHeightPx,
    osmdPreviewContainerRef: settings.osmdPreviewContainerRef,
    osmdDirectFileInputRef: settings.osmdDirectFileInputRef,
    osmdPreviewInstanceRef: settings.osmdPreviewInstanceRef,
    osmdPreviewLastRebalanceStatsRef: settings.osmdPreviewLastRebalanceStatsRef,
    osmdPreviewNoteLookupBySelectionRef: navigation.osmdPreviewNoteLookupBySelectionRef,
    osmdPreviewSelectedSelectionKeyRef: navigation.osmdPreviewSelectedSelectionKeyRef,
    closeOsmdPreview,
    openOsmdPreview,
    openDirectOsmdFilePicker,
    onOsmdDirectFileChange,
    exportOsmdPreviewPdf,
    goToPrevOsmdPreviewPage: settings.goToPrevOsmdPreviewPage,
    goToNextOsmdPreviewPage: settings.goToNextOsmdPreviewPage,
    commitOsmdPreviewZoomPercent: settings.commitOsmdPreviewZoomPercent,
    scheduleOsmdPreviewZoomPercentCommit: settings.scheduleOsmdPreviewZoomPercentCommit,
    onOsmdPreviewPaperScalePercentChange: settings.onOsmdPreviewPaperScalePercentChange,
    onOsmdPreviewHorizontalMarginPxChange: settings.onOsmdPreviewHorizontalMarginPxChange,
    onOsmdPreviewFirstPageTopMarginPxChange: settings.onOsmdPreviewFirstPageTopMarginPxChange,
    onOsmdPreviewTopMarginPxChange: settings.onOsmdPreviewTopMarginPxChange,
    onOsmdPreviewBottomMarginPxChange: settings.onOsmdPreviewBottomMarginPxChange,
    onOsmdPreviewShowPageNumbersChange: settings.onOsmdPreviewShowPageNumbersChange,
    onOsmdPreviewSurfaceClick: navigation.onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick: navigation.onOsmdPreviewSurfaceDoubleClick,
    dumpOsmdPreviewSystemMetrics,
  }
}
