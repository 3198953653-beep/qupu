import { OsmdPreviewLayoutControlsSection } from './osmdPreviewModal/OsmdPreviewLayoutControlsSection'
import { OsmdPreviewPaginationSection } from './osmdPreviewModal/OsmdPreviewPaginationSection'
import { OsmdPreviewSurfaceSection } from './osmdPreviewModal/OsmdPreviewSurfaceSection'
import { OsmdPreviewToolbarSection } from './osmdPreviewModal/OsmdPreviewToolbarSection'
import type { OsmdPreviewModalProps } from './osmdPreviewModal/types'

export function OsmdPreviewModal(props: OsmdPreviewModalProps) {
  const {
    isOpen,
    isExportingPdf,
    statusText,
    error,
    pageIndex,
    pageCount,
    showPageNumbers,
    zoomDraftPercent,
    safePaperScalePercent,
    safeHorizontalMarginPx,
    safeFirstPageTopMarginPx,
    safeTopMarginPx,
    safeBottomMarginPx,
    paperScale,
    paperWidthPx,
    paperHeightPx,
    containerRef,
    closeOsmdPreview,
    exportOsmdPreviewPdf,
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
    onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick,
  } = props

  if (!isOpen) return null

  return (
    <div className="osmd-preview-modal" role="dialog" aria-modal="true" aria-label="OSMD预览" onClick={closeOsmdPreview}>
      <div className="osmd-preview-card" onClick={(event) => event.stopPropagation()}>
        <OsmdPreviewToolbarSection
          isExportingPdf={isExportingPdf}
          exportOsmdPreviewPdf={exportOsmdPreviewPdf}
          closeOsmdPreview={closeOsmdPreview}
        />
        <div className="osmd-preview-side">
          <OsmdPreviewPaginationSection
            pageIndex={pageIndex}
            pageCount={pageCount}
            goToPrevOsmdPreviewPage={goToPrevOsmdPreviewPage}
            goToNextOsmdPreviewPage={goToNextOsmdPreviewPage}
          />
          <OsmdPreviewLayoutControlsSection
            showPageNumbers={showPageNumbers}
            zoomDraftPercent={zoomDraftPercent}
            safePaperScalePercent={safePaperScalePercent}
            safeHorizontalMarginPx={safeHorizontalMarginPx}
            safeFirstPageTopMarginPx={safeFirstPageTopMarginPx}
            safeTopMarginPx={safeTopMarginPx}
            safeBottomMarginPx={safeBottomMarginPx}
            statusText={statusText}
            error={error}
            commitOsmdPreviewZoomPercent={commitOsmdPreviewZoomPercent}
            scheduleOsmdPreviewZoomPercentCommit={scheduleOsmdPreviewZoomPercentCommit}
            onOsmdPreviewPaperScalePercentChange={onOsmdPreviewPaperScalePercentChange}
            onOsmdPreviewHorizontalMarginPxChange={onOsmdPreviewHorizontalMarginPxChange}
            onOsmdPreviewFirstPageTopMarginPxChange={onOsmdPreviewFirstPageTopMarginPxChange}
            onOsmdPreviewTopMarginPxChange={onOsmdPreviewTopMarginPxChange}
            onOsmdPreviewBottomMarginPxChange={onOsmdPreviewBottomMarginPxChange}
            onOsmdPreviewShowPageNumbersChange={onOsmdPreviewShowPageNumbersChange}
          />
        </div>
        <OsmdPreviewSurfaceSection
          paperWidthPx={paperWidthPx}
          paperHeightPx={paperHeightPx}
          paperScale={paperScale}
          containerRef={containerRef}
          onOsmdPreviewSurfaceClick={onOsmdPreviewSurfaceClick}
          onOsmdPreviewSurfaceDoubleClick={onOsmdPreviewSurfaceDoubleClick}
        />
      </div>
    </div>
  )
}
