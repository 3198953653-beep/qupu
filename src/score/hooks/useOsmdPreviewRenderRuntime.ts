import { useCallback, useEffect } from 'react'
import {
  DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX,
  OSMD_PREVIEW_FAST_STAGE_MEASURE_LIMIT,
  OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX,
  OSMD_PREVIEW_MARGIN_APPLY_DEBOUNCE_MS,
  applyOsmdPreviewPageNumbers,
  applyOsmdPreviewPageVisibility,
  buildFastOsmdPreviewXml,
  buildOsmdPreviewSystemMetrics,
  clampOsmdPreviewBottomMarginPx,
  clampOsmdPreviewZoomPercent,
  collectOsmdPreviewPages,
  type OsmdPreviewInstance,
} from './osmdPreviewUtils'
import {
  applyOsmdPreviewHorizontalMargins,
  applyOsmdPreviewVerticalMargins,
  renderAndRebalanceOsmdPreview,
} from './osmdPreviewRebalance'
import { useOsmdPreviewNavigation } from './useOsmdPreviewNavigation'
import { useOsmdPreviewSettings } from './useOsmdPreviewSettings'

export function useOsmdPreviewRenderRuntime(params: {
  settings: ReturnType<typeof useOsmdPreviewSettings>
  navigation: Pick<
    ReturnType<typeof useOsmdPreviewNavigation>,
    'rebuildOsmdPreviewNoteLookup' | 'resetOsmdPreviewNavigationState'
  >
}) {
  const { settings, navigation } = params
  const {
    rebuildOsmdPreviewNoteLookup,
    resetOsmdPreviewNavigationState,
  } = navigation

  const syncRenderedPages = useCallback((osmd: OsmdPreviewInstance, pageIndex: number) => {
    const container = settings.osmdPreviewContainerRef.current
    if (!container) return
    const renderedPages = collectOsmdPreviewPages(container)
    settings.osmdPreviewPagesRef.current = renderedPages
    applyOsmdPreviewPageNumbers(renderedPages, settings.osmdPreviewShowPageNumbersRef.current)
    const graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
    const nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
    settings.setOsmdPreviewPageCount(nextPageCount)
    applyOsmdPreviewPageVisibility(renderedPages, pageIndex)
    rebuildOsmdPreviewNoteLookup()
  }, [
    rebuildOsmdPreviewNoteLookup,
    settings.osmdPreviewContainerRef,
    settings.osmdPreviewPagesRef,
    settings.osmdPreviewShowPageNumbersRef,
    settings.setOsmdPreviewPageCount,
  ])

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
        const previewInstance = osmd as unknown as OsmdPreviewInstance
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
        syncRenderedPages(previewInstance, 0)
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
        syncRenderedPages(previewInstance, 0)
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
      resetOsmdPreviewNavigationState()
    }
  }, [
    resetOsmdPreviewNavigationState,
    settings.isOsmdPreviewOpen,
    settings.osmdPreviewBottomMarginPxRef,
    settings.osmdPreviewContainerRef,
    settings.osmdPreviewFirstPageTopMarginPxRef,
    settings.osmdPreviewHorizontalMarginPxRef,
    settings.osmdPreviewInstanceRef,
    settings.osmdPreviewLastRebalanceStatsRef,
    settings.osmdPreviewPagesRef,
    settings.osmdPreviewTopMarginPxRef,
    settings.osmdPreviewXml,
    settings.osmdPreviewZoomPercent,
    settings.setOsmdPreviewError,
    settings.setOsmdPreviewStatusText,
    syncRenderedPages,
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
    syncRenderedPages(osmd, settings.osmdPreviewPageIndexRef.current)
  }, [
    settings.isOsmdPreviewOpen,
    settings.osmdPreviewBottomMarginPxRef,
    settings.osmdPreviewFirstPageTopMarginPxRef,
    settings.osmdPreviewHorizontalMarginPxRef,
    settings.osmdPreviewInstanceRef,
    settings.osmdPreviewLastRebalanceStatsRef,
    settings.osmdPreviewPageIndexRef,
    settings.osmdPreviewTopMarginPxRef,
    settings.osmdPreviewZoomPercent,
    syncRenderedPages,
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
      settings.osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
        osmd,
        settings.osmdPreviewHorizontalMarginPx,
        settings.osmdPreviewFirstPageTopMarginPx,
        settings.osmdPreviewTopMarginPx,
        settings.osmdPreviewBottomMarginPx,
      )
      syncRenderedPages(osmd, settings.osmdPreviewPageIndexRef.current)
    }, OSMD_PREVIEW_MARGIN_APPLY_DEBOUNCE_MS)
    return () => {
      if (settings.osmdPreviewMarginApplyTimerRef.current !== null) {
        window.clearTimeout(settings.osmdPreviewMarginApplyTimerRef.current)
        settings.osmdPreviewMarginApplyTimerRef.current = null
      }
    }
  }, [
    settings.isOsmdPreviewOpen,
    settings.osmdPreviewBottomMarginPx,
    settings.osmdPreviewFirstPageTopMarginPx,
    settings.osmdPreviewHorizontalMarginPx,
    settings.osmdPreviewInstanceRef,
    settings.osmdPreviewLastRebalanceStatsRef,
    settings.osmdPreviewMarginApplyTimerRef,
    settings.osmdPreviewPageIndexRef,
    settings.osmdPreviewTopMarginPx,
    syncRenderedPages,
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
    dumpOsmdPreviewSystemMetrics,
  }
}
