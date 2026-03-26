import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH } from '../constants'

export function OsmdPreviewModal(props: {
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
}) {
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
        <div className="osmd-preview-header">
          <h3>OSMD预览</h3>
          <div className="osmd-preview-header-actions">
            <button
              type="button"
              onClick={exportOsmdPreviewPdf}
              disabled={isExportingPdf}
            >
              {isExportingPdf ? '导出中...' : '导出PDF'}
            </button>
            <button type="button" onClick={closeOsmdPreview} disabled={isExportingPdf}>关闭</button>
          </div>
        </div>
        <div className="osmd-preview-side">
          <div className="osmd-preview-pagination">
            <button type="button" onClick={goToPrevOsmdPreviewPage} disabled={pageIndex <= 0}>
              上一页
            </button>
            <span>{`${Math.min(pageCount, pageIndex + 1)} / ${pageCount}`}</span>
            <button
              type="button"
              onClick={goToNextOsmdPreviewPage}
              disabled={pageIndex >= pageCount - 1}
            >
              下一页
            </button>
          </div>
          <div className="osmd-preview-toggle">
            <label htmlFor="osmd-preview-page-number-toggle">页码</label>
            <input
              id="osmd-preview-page-number-toggle"
              type="checkbox"
              checked={showPageNumbers}
              onChange={(event) => onOsmdPreviewShowPageNumbersChange(event.target.checked)}
            />
            <span>{showPageNumbers ? '显示' : '隐藏'}</span>
          </div>
          <div className="osmd-preview-zoom">
            <label htmlFor="osmd-preview-zoom-range">音符缩放</label>
            <input
              id="osmd-preview-zoom-range"
              type="range"
              min={35}
              max={160}
              step={1}
              value={zoomDraftPercent}
              onInput={(event) =>
                scheduleOsmdPreviewZoomPercentCommit(Number((event.target as HTMLInputElement).value))
              }
              onPointerUp={(event) => commitOsmdPreviewZoomPercent(Number((event.target as HTMLInputElement).value))}
              onKeyUp={(event) => {
                if (event.key !== 'Enter') return
                commitOsmdPreviewZoomPercent(Number((event.target as HTMLInputElement).value))
              }}
            />
            <input
              type="number"
              min={35}
              max={160}
              step={1}
              value={zoomDraftPercent}
              onInput={(event) =>
                scheduleOsmdPreviewZoomPercentCommit(Number((event.target as HTMLInputElement).value))
              }
              onBlur={(event) => commitOsmdPreviewZoomPercent(Number((event.target as HTMLInputElement).value))}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                commitOsmdPreviewZoomPercent(Number((event.target as HTMLInputElement).value))
              }}
            />
            <span>%</span>
          </div>
          <div className="osmd-preview-zoom">
            <label htmlFor="osmd-preview-paper-scale-range">纸张缩放</label>
            <input
              id="osmd-preview-paper-scale-range"
              type="range"
              min={50}
              max={180}
              step={1}
              value={safePaperScalePercent}
              onInput={(event) =>
                onOsmdPreviewPaperScalePercentChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewPaperScalePercentChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={50}
              max={180}
              step={1}
              value={safePaperScalePercent}
              onInput={(event) =>
                onOsmdPreviewPaperScalePercentChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewPaperScalePercentChange(Number(event.target.value))}
            />
            <span>%</span>
          </div>
          <div className="osmd-preview-zoom">
            <label htmlFor="osmd-preview-horizontal-margin-range">左右边距</label>
            <input
              id="osmd-preview-horizontal-margin-range"
              type="range"
              min={0}
              max={120}
              step={1}
              value={safeHorizontalMarginPx}
              onInput={(event) =>
                onOsmdPreviewHorizontalMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewHorizontalMarginPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={0}
              max={120}
              step={1}
              value={safeHorizontalMarginPx}
              onInput={(event) =>
                onOsmdPreviewHorizontalMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewHorizontalMarginPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>
          <div className="osmd-preview-zoom">
            <label htmlFor="osmd-preview-first-top-margin-range">首页顶部</label>
            <input
              id="osmd-preview-first-top-margin-range"
              type="range"
              min={0}
              max={180}
              step={1}
              value={safeFirstPageTopMarginPx}
              onInput={(event) =>
                onOsmdPreviewFirstPageTopMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewFirstPageTopMarginPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={0}
              max={180}
              step={1}
              value={safeFirstPageTopMarginPx}
              onInput={(event) =>
                onOsmdPreviewFirstPageTopMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewFirstPageTopMarginPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>
          <div className="osmd-preview-zoom">
            <label htmlFor="osmd-preview-top-margin-range">后续页顶部</label>
            <input
              id="osmd-preview-top-margin-range"
              type="range"
              min={0}
              max={180}
              step={1}
              value={safeTopMarginPx}
              onInput={(event) =>
                onOsmdPreviewTopMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewTopMarginPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={0}
              max={180}
              step={1}
              value={safeTopMarginPx}
              onInput={(event) =>
                onOsmdPreviewTopMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewTopMarginPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>
          <div className="osmd-preview-zoom">
            <label htmlFor="osmd-preview-bottom-margin-range">底部边距</label>
            <input
              id="osmd-preview-bottom-margin-range"
              type="range"
              min={0}
              max={180}
              step={1}
              value={safeBottomMarginPx}
              onInput={(event) =>
                onOsmdPreviewBottomMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewBottomMarginPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={0}
              max={180}
              step={1}
              value={safeBottomMarginPx}
              onInput={(event) =>
                onOsmdPreviewBottomMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onOsmdPreviewBottomMarginPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>
          {statusText && <p className="osmd-preview-status">{statusText}</p>}
          {error && <p className="osmd-preview-error">{error}</p>}
        </div>
        <div className="osmd-preview-body osmd-preview-main-body">
          <div
            className="osmd-preview-paper-frame"
            style={{
              width: `${paperWidthPx}px`,
              height: `${paperHeightPx}px`,
            }}
          >
            <div
              ref={containerRef}
              className="osmd-preview-surface"
              onClick={onOsmdPreviewSurfaceClick}
              onDoubleClick={onOsmdPreviewSurfaceDoubleClick}
              style={{
                width: `${A4_PAGE_WIDTH}px`,
                height: `${A4_PAGE_HEIGHT}px`,
                transform: `scale(${paperScale})`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
