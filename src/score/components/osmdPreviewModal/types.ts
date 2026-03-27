import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'

export type OsmdPreviewModalProps = {
  isOpen: boolean
  isExportingPdf: boolean
  statusText: string
  error: string
  pageIndex: number
  pageCount: number
  showPageNumbers: boolean
  zoomDraftPercent: number
  safePaperScalePercent: number
  safeHorizontalMarginPx: number
  safeFirstPageTopMarginPx: number
  safeTopMarginPx: number
  safeBottomMarginPx: number
  paperScale: number
  paperWidthPx: number
  paperHeightPx: number
  containerRef: RefObject<HTMLDivElement | null>
  closeOsmdPreview: () => void
  exportOsmdPreviewPdf: () => void
  goToPrevOsmdPreviewPage: () => void
  goToNextOsmdPreviewPage: () => void
  commitOsmdPreviewZoomPercent: (nextPercent: number) => void
  scheduleOsmdPreviewZoomPercentCommit: (nextPercent: number) => void
  onOsmdPreviewPaperScalePercentChange: (nextPercent: number) => void
  onOsmdPreviewHorizontalMarginPxChange: (nextPx: number) => void
  onOsmdPreviewFirstPageTopMarginPxChange: (nextPx: number) => void
  onOsmdPreviewTopMarginPxChange: (nextPx: number) => void
  onOsmdPreviewBottomMarginPxChange: (nextPx: number) => void
  onOsmdPreviewShowPageNumbersChange: (enabled: boolean) => void
  onOsmdPreviewSurfaceClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onOsmdPreviewSurfaceDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void
}
