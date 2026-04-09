import { useCallback, useEffect, useState } from 'react'
import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH } from '../constants'
import {
  DEFAULT_NATIVE_PREVIEW_BOTTOM_MARGIN_PX,
  DEFAULT_NATIVE_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX,
  DEFAULT_NATIVE_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX,
  DEFAULT_NATIVE_PREVIEW_HORIZONTAL_MARGIN_PX,
  DEFAULT_NATIVE_PREVIEW_MIN_EIGHTH_GAP_PX,
  DEFAULT_NATIVE_PREVIEW_MIN_GRAND_STAFF_GAP_PX,
  DEFAULT_NATIVE_PREVIEW_PAPER_SCALE_PERCENT,
  DEFAULT_NATIVE_PREVIEW_SHOW_PAGE_NUMBERS,
} from './nativePreviewConstants'
import {
  clampNativePreviewBottomMarginPx,
  clampNativePreviewHorizontalMarginPx,
  clampNativePreviewMinEighthGapPx,
  clampNativePreviewMinGrandStaffGapPx,
  clampNativePreviewPaperScalePercent,
  clampNativePreviewTopMarginPx,
} from './nativePreviewUtils'

export function useNativePreviewSettings() {
  const [isNativePreviewOpen, setIsNativePreviewOpen] = useState(false)
  const [nativePreviewError, setNativePreviewError] = useState('')
  const [nativePreviewPageIndex, setNativePreviewPageIndex] = useState(0)
  const [nativePreviewPageCount, setNativePreviewPageCount] = useState(1)
  const [nativePreviewShowPageNumbers, setNativePreviewShowPageNumbers] = useState(
    DEFAULT_NATIVE_PREVIEW_SHOW_PAGE_NUMBERS,
  )
  const [nativePreviewPaperScalePercent, setNativePreviewPaperScalePercent] = useState(
    DEFAULT_NATIVE_PREVIEW_PAPER_SCALE_PERCENT,
  )
  const [nativePreviewHorizontalMarginPx, setNativePreviewHorizontalMarginPx] = useState(
    DEFAULT_NATIVE_PREVIEW_HORIZONTAL_MARGIN_PX,
  )
  const [nativePreviewFirstPageTopMarginPx, setNativePreviewFirstPageTopMarginPx] = useState(
    DEFAULT_NATIVE_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX,
  )
  const [nativePreviewTopMarginPx, setNativePreviewTopMarginPx] = useState(
    DEFAULT_NATIVE_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX,
  )
  const [nativePreviewBottomMarginPx, setNativePreviewBottomMarginPx] = useState(
    DEFAULT_NATIVE_PREVIEW_BOTTOM_MARGIN_PX,
  )
  const [nativePreviewMinEighthGapPx, setNativePreviewMinEighthGapPx] = useState(
    DEFAULT_NATIVE_PREVIEW_MIN_EIGHTH_GAP_PX,
  )
  const [nativePreviewMinGrandStaffGapPx, setNativePreviewMinGrandStaffGapPx] = useState(
    DEFAULT_NATIVE_PREVIEW_MIN_GRAND_STAFF_GAP_PX,
  )

  const goToPrevNativePreviewPage = useCallback(() => {
    setNativePreviewPageIndex((current) => Math.max(0, current - 1))
  }, [])

  const goToNextNativePreviewPage = useCallback(() => {
    setNativePreviewPageIndex((current) => Math.min(Math.max(0, nativePreviewPageCount - 1), current + 1))
  }, [nativePreviewPageCount])

  const onNativePreviewPaperScalePercentChange = useCallback((nextValue: number) => {
    setNativePreviewPaperScalePercent(clampNativePreviewPaperScalePercent(nextValue))
  }, [])

  const onNativePreviewHorizontalMarginPxChange = useCallback((nextValue: number) => {
    setNativePreviewHorizontalMarginPx(clampNativePreviewHorizontalMarginPx(nextValue))
  }, [])

  const onNativePreviewFirstPageTopMarginPxChange = useCallback((nextValue: number) => {
    setNativePreviewFirstPageTopMarginPx(clampNativePreviewTopMarginPx(nextValue))
  }, [])

  const onNativePreviewTopMarginPxChange = useCallback((nextValue: number) => {
    setNativePreviewTopMarginPx(clampNativePreviewTopMarginPx(nextValue))
  }, [])

  const onNativePreviewBottomMarginPxChange = useCallback((nextValue: number) => {
    setNativePreviewBottomMarginPx(clampNativePreviewBottomMarginPx(nextValue))
  }, [])

  const onNativePreviewMinEighthGapPxChange = useCallback((nextValue: number) => {
    setNativePreviewMinEighthGapPx(clampNativePreviewMinEighthGapPx(nextValue))
  }, [])

  const onNativePreviewMinGrandStaffGapPxChange = useCallback((nextValue: number) => {
    setNativePreviewMinGrandStaffGapPx(clampNativePreviewMinGrandStaffGapPx(nextValue))
  }, [])

  const onNativePreviewShowPageNumbersChange = useCallback((nextVisible: boolean) => {
    setNativePreviewShowPageNumbers(Boolean(nextVisible))
  }, [])

  useEffect(() => {
    setNativePreviewPageIndex((current) => Math.max(0, Math.min(current, Math.max(0, nativePreviewPageCount - 1))))
  }, [nativePreviewPageCount])

  const safeNativePreviewPaperScalePercent = clampNativePreviewPaperScalePercent(nativePreviewPaperScalePercent)
  const safeNativePreviewHorizontalMarginPx = clampNativePreviewHorizontalMarginPx(nativePreviewHorizontalMarginPx)
  const safeNativePreviewFirstPageTopMarginPx = clampNativePreviewTopMarginPx(nativePreviewFirstPageTopMarginPx)
  const safeNativePreviewTopMarginPx = clampNativePreviewTopMarginPx(nativePreviewTopMarginPx)
  const safeNativePreviewBottomMarginPx = clampNativePreviewBottomMarginPx(nativePreviewBottomMarginPx)
  const safeNativePreviewMinEighthGapPx = clampNativePreviewMinEighthGapPx(nativePreviewMinEighthGapPx)
  const safeNativePreviewMinGrandStaffGapPx = clampNativePreviewMinGrandStaffGapPx(
    nativePreviewMinGrandStaffGapPx,
  )
  const nativePreviewPaperScale = safeNativePreviewPaperScalePercent / 100
  const nativePreviewPaperWidthPx = A4_PAGE_WIDTH * nativePreviewPaperScale
  const nativePreviewPaperHeightPx = A4_PAGE_HEIGHT * nativePreviewPaperScale

  return {
    isNativePreviewOpen,
    setIsNativePreviewOpen,
    nativePreviewError,
    setNativePreviewError,
    nativePreviewPageIndex,
    setNativePreviewPageIndex,
    nativePreviewPageCount,
    setNativePreviewPageCount,
    nativePreviewShowPageNumbers,
    nativePreviewPaperScalePercent,
    nativePreviewHorizontalMarginPx,
    nativePreviewFirstPageTopMarginPx,
    nativePreviewTopMarginPx,
    nativePreviewBottomMarginPx,
    nativePreviewMinEighthGapPx,
    nativePreviewMinGrandStaffGapPx,
    goToPrevNativePreviewPage,
    goToNextNativePreviewPage,
    onNativePreviewPaperScalePercentChange,
    onNativePreviewHorizontalMarginPxChange,
    onNativePreviewFirstPageTopMarginPxChange,
    onNativePreviewTopMarginPxChange,
    onNativePreviewBottomMarginPxChange,
    onNativePreviewMinEighthGapPxChange,
    onNativePreviewMinGrandStaffGapPxChange,
    onNativePreviewShowPageNumbersChange,
    safeNativePreviewPaperScalePercent,
    safeNativePreviewHorizontalMarginPx,
    safeNativePreviewFirstPageTopMarginPx,
    safeNativePreviewTopMarginPx,
    safeNativePreviewBottomMarginPx,
    safeNativePreviewMinEighthGapPx,
    safeNativePreviewMinGrandStaffGapPx,
    nativePreviewPaperScale,
    nativePreviewPaperWidthPx,
    nativePreviewPaperHeightPx,
  }
}
