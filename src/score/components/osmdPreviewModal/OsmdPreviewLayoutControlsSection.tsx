import type { OsmdPreviewModalProps } from './types'

type OsmdPreviewLayoutControlsSectionProps = Pick<
  OsmdPreviewModalProps,
  | 'showPageNumbers'
  | 'zoomDraftPercent'
  | 'safePaperScalePercent'
  | 'safeHorizontalMarginPx'
  | 'safeFirstPageTopMarginPx'
  | 'safeTopMarginPx'
  | 'safeBottomMarginPx'
  | 'statusText'
  | 'error'
  | 'commitOsmdPreviewZoomPercent'
  | 'scheduleOsmdPreviewZoomPercentCommit'
  | 'onOsmdPreviewPaperScalePercentChange'
  | 'onOsmdPreviewHorizontalMarginPxChange'
  | 'onOsmdPreviewFirstPageTopMarginPxChange'
  | 'onOsmdPreviewTopMarginPxChange'
  | 'onOsmdPreviewBottomMarginPxChange'
  | 'onOsmdPreviewShowPageNumbersChange'
>

export function OsmdPreviewLayoutControlsSection(props: OsmdPreviewLayoutControlsSectionProps) {
  const {
    showPageNumbers,
    zoomDraftPercent,
    safePaperScalePercent,
    safeHorizontalMarginPx,
    safeFirstPageTopMarginPx,
    safeTopMarginPx,
    safeBottomMarginPx,
    statusText,
    error,
    commitOsmdPreviewZoomPercent,
    scheduleOsmdPreviewZoomPercentCommit,
    onOsmdPreviewPaperScalePercentChange,
    onOsmdPreviewHorizontalMarginPxChange,
    onOsmdPreviewFirstPageTopMarginPxChange,
    onOsmdPreviewTopMarginPxChange,
    onOsmdPreviewBottomMarginPxChange,
    onOsmdPreviewShowPageNumbersChange,
  } = props

  return (
    <>
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
    </>
  )
}
