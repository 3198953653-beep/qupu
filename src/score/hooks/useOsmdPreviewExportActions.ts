import { useCallback, type MutableRefObject } from 'react'
import type { MusicXmlMetadata } from '../types'
import { exportOsmdPreviewPagesToPdf } from './osmdPreviewPdf'
import { collectOsmdPreviewPages } from './osmdPreviewUtils'
import { useOsmdPreviewSettings } from './useOsmdPreviewSettings'

export function useOsmdPreviewExportActions(params: {
  musicXmlMetadataFromImportRef: MutableRefObject<MusicXmlMetadata | null>
  settings: ReturnType<typeof useOsmdPreviewSettings>
}) {
  const { musicXmlMetadataFromImportRef, settings } = params

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

  return {
    exportOsmdPreviewPdf,
  }
}
