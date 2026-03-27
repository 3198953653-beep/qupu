import { useCallback, useEffect, type ChangeEvent, type MutableRefObject } from 'react'
import { buildMusicXmlExportPayload } from '../musicXmlActions'
import type { MeasurePair } from '../types'
import { sanitizeMusicXmlForOsmdPreview } from './osmdPreviewUtils'
import { useOsmdPreviewNavigation } from './useOsmdPreviewNavigation'
import { useOsmdPreviewSettings } from './useOsmdPreviewSettings'

export function useOsmdPreviewLifecycle(params: {
  measurePairs: MeasurePair[]
  measureKeyFifthsFromImportRef: Parameters<typeof buildMusicXmlExportPayload>[0]['keyFifthsByMeasure'] extends infer T
    ? MutableRefObject<T>
    : never
  measureDivisionsFromImportRef: Parameters<typeof buildMusicXmlExportPayload>[0]['divisionsByMeasure'] extends infer T
    ? MutableRefObject<T>
    : never
  measureTimeSignaturesFromImportRef: Parameters<typeof buildMusicXmlExportPayload>[0]['timeSignaturesByMeasure'] extends infer T
    ? MutableRefObject<T>
    : never
  musicXmlMetadataFromImportRef: Parameters<typeof buildMusicXmlExportPayload>[0]['metadata'] extends infer T
    ? MutableRefObject<T>
    : never
  settings: ReturnType<typeof useOsmdPreviewSettings>
  navigation: Pick<ReturnType<typeof useOsmdPreviewNavigation>, 'resetOsmdPreviewNavigationState'>
  closeOsmdPreviewRef: MutableRefObject<(() => void) | null>
}) {
  const {
    measurePairs,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImportRef,
    settings,
    navigation,
    closeOsmdPreviewRef,
  } = params
  const { resetOsmdPreviewNavigationState } = navigation

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
    resetOsmdPreviewNavigationState()
  }, [
    resetOsmdPreviewNavigationState,
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

  return {
    closeOsmdPreview,
    openOsmdPreview,
    openDirectOsmdFilePicker,
    onOsmdDirectFileChange,
  }
}
