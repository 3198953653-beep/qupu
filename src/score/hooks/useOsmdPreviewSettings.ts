import { useCallback, useEffect, useRef, useState } from 'react'
import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH } from '../constants'
import {
  DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX,
  DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX,
  DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX,
  DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX,
  OSMD_PREVIEW_ZOOM_DEBOUNCE_MS,
  clampOsmdPreviewBottomMarginPx,
  clampOsmdPreviewHorizontalMarginPx,
  clampOsmdPreviewPaperScalePercent,
  clampOsmdPreviewTopMarginPx,
  clampOsmdPreviewZoomPercent,
  type OsmdPreviewInstance,
  type OsmdPreviewRebalanceStats,
} from './osmdPreviewUtils'

export function useOsmdPreviewSettings() {
  const [isOsmdPreviewOpen, setIsOsmdPreviewOpen] = useState(false)
  const [osmdPreviewSourceMode, setOsmdPreviewSourceMode] = useState<'editor' | 'direct-file'>('editor')
  const [osmdPreviewXml, setOsmdPreviewXml] = useState('')
  const [osmdPreviewStatusText, setOsmdPreviewStatusText] = useState('')
  const [osmdPreviewError, setOsmdPreviewError] = useState('')
  const [isOsmdPreviewExportingPdf, setIsOsmdPreviewExportingPdf] = useState(false)
  const [osmdPreviewPageIndex, setOsmdPreviewPageIndex] = useState(0)
  const [osmdPreviewPageCount, setOsmdPreviewPageCount] = useState(1)
  const [osmdPreviewShowPageNumbers, setOsmdPreviewShowPageNumbers] = useState(true)
  const [osmdPreviewZoomPercent, setOsmdPreviewZoomPercent] = useState(66)
  const [osmdPreviewZoomDraftPercent, setOsmdPreviewZoomDraftPercent] = useState(66)
  const [osmdPreviewPaperScalePercent, setOsmdPreviewPaperScalePercent] = useState(100)
  const [osmdPreviewHorizontalMarginPx, setOsmdPreviewHorizontalMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX,
  )
  const [osmdPreviewFirstPageTopMarginPx, setOsmdPreviewFirstPageTopMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX,
  )
  const [osmdPreviewTopMarginPx, setOsmdPreviewTopMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX,
  )
  const [osmdPreviewBottomMarginPx, setOsmdPreviewBottomMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX,
  )

  const osmdPreviewContainerRef = useRef<HTMLDivElement | null>(null)
  const osmdDirectFileInputRef = useRef<HTMLInputElement | null>(null)
  const osmdPreviewPagesRef = useRef<HTMLElement[]>([])
  const osmdPreviewInstanceRef = useRef<OsmdPreviewInstance | null>(null)
  const osmdPreviewHorizontalMarginPxRef = useRef(DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX)
  const osmdPreviewFirstPageTopMarginPxRef = useRef(DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX)
  const osmdPreviewTopMarginPxRef = useRef(DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX)
  const osmdPreviewBottomMarginPxRef = useRef(DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX)
  const osmdPreviewShowPageNumbersRef = useRef(true)
  const osmdPreviewPageIndexRef = useRef(0)
  const osmdPreviewLastRebalanceStatsRef = useRef<OsmdPreviewRebalanceStats | null>(null)
  const osmdPreviewZoomCommitTimerRef = useRef<number | null>(null)
  const osmdPreviewMarginApplyTimerRef = useRef<number | null>(null)

  const goToPrevOsmdPreviewPage = useCallback(() => {
    setOsmdPreviewPageIndex((current) => Math.max(0, current - 1))
  }, [])

  const goToNextOsmdPreviewPage = useCallback(() => {
    setOsmdPreviewPageIndex((current) => Math.min(Math.max(0, osmdPreviewPageCount - 1), current + 1))
  }, [osmdPreviewPageCount])

  const commitOsmdPreviewZoomPercent = useCallback((nextValue: number) => {
    const clamped = clampOsmdPreviewZoomPercent(nextValue)
    if (osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
      osmdPreviewZoomCommitTimerRef.current = null
    }
    setOsmdPreviewZoomDraftPercent(clamped)
    setOsmdPreviewZoomPercent((current) => (current === clamped ? current : clamped))
  }, [])

  const scheduleOsmdPreviewZoomPercentCommit = useCallback((nextValue: number) => {
    const clamped = clampOsmdPreviewZoomPercent(nextValue)
    setOsmdPreviewZoomDraftPercent(clamped)
    if (osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
    }
    osmdPreviewZoomCommitTimerRef.current = window.setTimeout(() => {
      osmdPreviewZoomCommitTimerRef.current = null
      setOsmdPreviewZoomPercent((current) => (current === clamped ? current : clamped))
    }, OSMD_PREVIEW_ZOOM_DEBOUNCE_MS)
  }, [])

  const onOsmdPreviewPaperScalePercentChange = useCallback((nextValue: number) => {
    setOsmdPreviewPaperScalePercent(clampOsmdPreviewPaperScalePercent(nextValue))
  }, [])
  const onOsmdPreviewHorizontalMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewHorizontalMarginPx(clampOsmdPreviewHorizontalMarginPx(nextValue))
  }, [])
  const onOsmdPreviewFirstPageTopMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewFirstPageTopMarginPx(clampOsmdPreviewTopMarginPx(nextValue))
  }, [])
  const onOsmdPreviewTopMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewTopMarginPx(clampOsmdPreviewTopMarginPx(nextValue))
  }, [])
  const onOsmdPreviewBottomMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewBottomMarginPx(clampOsmdPreviewBottomMarginPx(nextValue))
  }, [])
  const onOsmdPreviewShowPageNumbersChange = useCallback((nextVisible: boolean) => {
    setOsmdPreviewShowPageNumbers(Boolean(nextVisible))
  }, [])

  useEffect(() => {
    setOsmdPreviewZoomDraftPercent((current) => {
      const clamped = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent)
      return current === clamped ? current : clamped
    })
  }, [osmdPreviewZoomPercent])

  useEffect(() => {
    osmdPreviewHorizontalMarginPxRef.current = clampOsmdPreviewHorizontalMarginPx(osmdPreviewHorizontalMarginPx)
  }, [osmdPreviewHorizontalMarginPx])
  useEffect(() => {
    osmdPreviewFirstPageTopMarginPxRef.current = clampOsmdPreviewTopMarginPx(osmdPreviewFirstPageTopMarginPx)
  }, [osmdPreviewFirstPageTopMarginPx])
  useEffect(() => {
    osmdPreviewTopMarginPxRef.current = clampOsmdPreviewTopMarginPx(osmdPreviewTopMarginPx)
  }, [osmdPreviewTopMarginPx])
  useEffect(() => {
    osmdPreviewBottomMarginPxRef.current = clampOsmdPreviewBottomMarginPx(osmdPreviewBottomMarginPx)
  }, [osmdPreviewBottomMarginPx])
  useEffect(() => {
    osmdPreviewShowPageNumbersRef.current = osmdPreviewShowPageNumbers
  }, [osmdPreviewShowPageNumbers])
  useEffect(() => {
    osmdPreviewPageIndexRef.current = osmdPreviewPageIndex
  }, [osmdPreviewPageIndex])

  useEffect(() => {
    return () => {
      if (osmdPreviewZoomCommitTimerRef.current !== null) {
        window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
        osmdPreviewZoomCommitTimerRef.current = null
      }
      if (osmdPreviewMarginApplyTimerRef.current !== null) {
        window.clearTimeout(osmdPreviewMarginApplyTimerRef.current)
        osmdPreviewMarginApplyTimerRef.current = null
      }
    }
  }, [])

  const safeOsmdPreviewPaperScalePercent = clampOsmdPreviewPaperScalePercent(osmdPreviewPaperScalePercent)
  const safeOsmdPreviewHorizontalMarginPx = clampOsmdPreviewHorizontalMarginPx(osmdPreviewHorizontalMarginPx)
  const safeOsmdPreviewFirstPageTopMarginPx = clampOsmdPreviewTopMarginPx(osmdPreviewFirstPageTopMarginPx)
  const safeOsmdPreviewTopMarginPx = clampOsmdPreviewTopMarginPx(osmdPreviewTopMarginPx)
  const safeOsmdPreviewBottomMarginPx = clampOsmdPreviewBottomMarginPx(osmdPreviewBottomMarginPx)
  const osmdPreviewPaperScale = safeOsmdPreviewPaperScalePercent / 100
  const osmdPreviewPaperWidthPx = A4_PAGE_WIDTH * osmdPreviewPaperScale
  const osmdPreviewPaperHeightPx = A4_PAGE_HEIGHT * osmdPreviewPaperScale

  return {
    isOsmdPreviewOpen,
    setIsOsmdPreviewOpen,
    osmdPreviewSourceMode,
    setOsmdPreviewSourceMode,
    osmdPreviewXml,
    setOsmdPreviewXml,
    osmdPreviewStatusText,
    setOsmdPreviewStatusText,
    osmdPreviewError,
    setOsmdPreviewError,
    isOsmdPreviewExportingPdf,
    setIsOsmdPreviewExportingPdf,
    osmdPreviewPageIndex,
    setOsmdPreviewPageIndex,
    osmdPreviewPageCount,
    setOsmdPreviewPageCount,
    osmdPreviewShowPageNumbers,
    osmdPreviewZoomPercent,
    osmdPreviewZoomDraftPercent,
    osmdPreviewPaperScalePercent,
    osmdPreviewHorizontalMarginPx,
    osmdPreviewFirstPageTopMarginPx,
    osmdPreviewTopMarginPx,
    osmdPreviewBottomMarginPx,
    osmdPreviewContainerRef,
    osmdDirectFileInputRef,
    osmdPreviewPagesRef,
    osmdPreviewInstanceRef,
    osmdPreviewHorizontalMarginPxRef,
    osmdPreviewFirstPageTopMarginPxRef,
    osmdPreviewTopMarginPxRef,
    osmdPreviewBottomMarginPxRef,
    osmdPreviewShowPageNumbersRef,
    osmdPreviewPageIndexRef,
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewZoomCommitTimerRef,
    osmdPreviewMarginApplyTimerRef,
    goToPrevOsmdPreviewPage,
    goToNextOsmdPreviewPage,
    commitOsmdPreviewZoomPercent,
    scheduleOsmdPreviewZoomPercentCommit,
    onOsmdPreviewPaperScalePercentChange,
    onOsmdPreviewHorizontalMarginPxChange,
    onOsmdPreviewFirstPageTopMarginPxChange,
    onOsmdPreviewTopMarginPxChange,
    onOsmdPreviewBottomMarginPxChange,
    onOsmdPreviewShowPageNumbersChange,
    safeOsmdPreviewPaperScalePercent,
    safeOsmdPreviewHorizontalMarginPx,
    safeOsmdPreviewFirstPageTopMarginPx,
    safeOsmdPreviewTopMarginPx,
    safeOsmdPreviewBottomMarginPx,
    osmdPreviewPaperScale,
    osmdPreviewPaperWidthPx,
    osmdPreviewPaperHeightPx,
  }
}
