import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH } from '../constants'
import { NativePreviewPageCanvas } from './nativePreviewModal/NativePreviewPageCanvas'
import type { NativePreviewModalProps } from './nativePreviewModal/types'

function getPrimaryCreatorLabel(metadata: NativePreviewModalProps['metadata']): string {
  const creator = metadata?.creators.find((entry) => entry.text?.trim())
  return creator?.text?.trim() ?? ''
}

export function NativePreviewModal(props: NativePreviewModalProps) {
  const {
    isOpen,
    error,
    statusText,
    pageIndex,
    pageCount,
    showPageNumbers,
    zoomDraftPercent,
    safeZoomPercent,
    safePaperScalePercent,
    safeHorizontalMarginPx,
    safeFirstPageTopMarginPx,
    safeTopMarginPx,
    safeBottomMarginPx,
    safeMinEighthGapPx,
    safeMinGrandStaffGapPx,
    paperScale,
    paperWidthPx,
    paperHeightPx,
    currentPage,
    metadata,
    measurePairs,
    pedalSpans,
    chordRulerEntriesByPair,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
    grandStaffLayoutMetrics,
    showInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    onNativePreviewPageRenderedDiagnostics,
    closeNativePreview,
    goToPrevNativePreviewPage,
    goToNextNativePreviewPage,
    commitNativePreviewZoomPercent,
    scheduleNativePreviewZoomPercentCommit,
    onNativePreviewPaperScalePercentChange,
    onNativePreviewHorizontalMarginPxChange,
    onNativePreviewFirstPageTopMarginPxChange,
    onNativePreviewTopMarginPxChange,
    onNativePreviewBottomMarginPxChange,
    onNativePreviewMinEighthGapPxChange,
    onNativePreviewMinGrandStaffGapPxChange,
    onNativePreviewShowPageNumbersChange,
  } = props

  if (!isOpen) return null

  const workTitle = metadata?.workTitle?.trim() ?? ''
  const creatorLabel = getPrimaryCreatorLabel(metadata)
  const showTitleBlock = currentPage?.pageIndex === 0 && Boolean(workTitle || creatorLabel)

  return (
    <div
      className="osmd-preview-modal native-preview-modal"
      role="dialog"
      aria-modal="true"
      aria-label="五线谱预览"
      onClick={closeNativePreview}
    >
      <div className="osmd-preview-card native-preview-card" onClick={(event) => event.stopPropagation()}>
        <div className="osmd-preview-header native-preview-header">
          <h3>五线谱预览</h3>
          <div className="osmd-preview-header-actions">
            <button type="button" onClick={closeNativePreview}>关闭</button>
          </div>
        </div>

        <div className="osmd-preview-side native-preview-side">
          <div className="osmd-preview-pagination">
            <button type="button" onClick={goToPrevNativePreviewPage} disabled={pageIndex <= 0}>
              上一页
            </button>
            <span>{`${Math.min(pageCount, pageIndex + 1)} / ${pageCount}`}</span>
            <button
              type="button"
              onClick={goToNextNativePreviewPage}
              disabled={pageIndex >= pageCount - 1}
            >
              下一页
            </button>
          </div>

          <div className="osmd-preview-toggle">
            <label htmlFor="native-preview-page-number-toggle">页码</label>
            <input
              id="native-preview-page-number-toggle"
              type="checkbox"
              checked={showPageNumbers}
              onChange={(event) => onNativePreviewShowPageNumbersChange(event.target.checked)}
            />
            <span>{showPageNumbers ? '显示' : '隐藏'}</span>
          </div>

          <div className="osmd-preview-zoom">
            <label htmlFor="native-preview-zoom-range">音符缩放</label>
            <input
              id="native-preview-zoom-range"
              type="range"
              min={35}
              max={160}
              step={1}
              value={zoomDraftPercent}
              onInput={(event) =>
                scheduleNativePreviewZoomPercentCommit(Number((event.target as HTMLInputElement).value))
              }
              onPointerUp={(event) =>
                commitNativePreviewZoomPercent(Number((event.target as HTMLInputElement).value))
              }
              onKeyUp={(event) => {
                if (event.key !== 'Enter') return
                commitNativePreviewZoomPercent(Number((event.target as HTMLInputElement).value))
              }}
            />
            <input
              type="number"
              min={35}
              max={160}
              step={1}
              value={safeZoomPercent}
              onInput={(event) =>
                scheduleNativePreviewZoomPercentCommit(Number((event.target as HTMLInputElement).value))
              }
              onBlur={(event) =>
                commitNativePreviewZoomPercent(Number((event.target as HTMLInputElement).value))
              }
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                commitNativePreviewZoomPercent(Number((event.target as HTMLInputElement).value))
              }}
            />
            <span>%</span>
          </div>

          <div className="osmd-preview-zoom">
            <label htmlFor="native-preview-paper-scale-range">纸张缩放</label>
            <input
              id="native-preview-paper-scale-range"
              type="range"
              min={50}
              max={180}
              step={1}
              value={safePaperScalePercent}
              onInput={(event) =>
                onNativePreviewPaperScalePercentChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewPaperScalePercentChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={50}
              max={180}
              step={1}
              value={safePaperScalePercent}
              onInput={(event) =>
                onNativePreviewPaperScalePercentChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewPaperScalePercentChange(Number(event.target.value))}
            />
            <span>%</span>
          </div>

          <div className="osmd-preview-zoom">
            <label htmlFor="native-preview-horizontal-margin-range">左右边距</label>
            <input
              id="native-preview-horizontal-margin-range"
              type="range"
              min={0}
              max={120}
              step={1}
              value={safeHorizontalMarginPx}
              onInput={(event) =>
                onNativePreviewHorizontalMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewHorizontalMarginPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={0}
              max={120}
              step={1}
              value={safeHorizontalMarginPx}
              onInput={(event) =>
                onNativePreviewHorizontalMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewHorizontalMarginPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>

          <div className="osmd-preview-zoom">
            <label htmlFor="native-preview-first-top-margin-range">首页顶部</label>
            <input
              id="native-preview-first-top-margin-range"
              type="range"
              min={0}
              max={180}
              step={1}
              value={safeFirstPageTopMarginPx}
              onInput={(event) =>
                onNativePreviewFirstPageTopMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewFirstPageTopMarginPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={0}
              max={180}
              step={1}
              value={safeFirstPageTopMarginPx}
              onInput={(event) =>
                onNativePreviewFirstPageTopMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewFirstPageTopMarginPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>

          <div className="osmd-preview-zoom">
            <label htmlFor="native-preview-top-margin-range">后续页顶部</label>
            <input
              id="native-preview-top-margin-range"
              type="range"
              min={0}
              max={180}
              step={1}
              value={safeTopMarginPx}
              onInput={(event) =>
                onNativePreviewTopMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewTopMarginPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={0}
              max={180}
              step={1}
              value={safeTopMarginPx}
              onInput={(event) =>
                onNativePreviewTopMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewTopMarginPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>

          <div className="osmd-preview-zoom">
            <label htmlFor="native-preview-bottom-margin-range">底部边距</label>
            <input
              id="native-preview-bottom-margin-range"
              type="range"
              min={0}
              max={180}
              step={1}
              value={safeBottomMarginPx}
              onInput={(event) =>
                onNativePreviewBottomMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewBottomMarginPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={0}
              max={180}
              step={1}
              value={safeBottomMarginPx}
              onInput={(event) =>
                onNativePreviewBottomMarginPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewBottomMarginPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>

          <div className="osmd-preview-zoom">
            <label htmlFor="native-preview-min-eighth-gap-range">最小八分间距</label>
            <input
              id="native-preview-min-eighth-gap-range"
              type="range"
              min={14}
              max={36}
              step={1}
              value={safeMinEighthGapPx}
              onInput={(event) =>
                onNativePreviewMinEighthGapPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewMinEighthGapPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={14}
              max={36}
              step={1}
              value={safeMinEighthGapPx}
              onInput={(event) =>
                onNativePreviewMinEighthGapPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewMinEighthGapPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>

          <div className="osmd-preview-zoom">
            <label htmlFor="native-preview-min-grand-staff-gap-range">最小大谱表间距</label>
            <input
              id="native-preview-min-grand-staff-gap-range"
              type="range"
              min={24}
              max={96}
              step={1}
              value={safeMinGrandStaffGapPx}
              onInput={(event) =>
                onNativePreviewMinGrandStaffGapPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewMinGrandStaffGapPxChange(Number(event.target.value))}
            />
            <input
              type="number"
              min={24}
              max={96}
              step={1}
              value={safeMinGrandStaffGapPx}
              onInput={(event) =>
                onNativePreviewMinGrandStaffGapPxChange(Number((event.target as HTMLInputElement).value))
              }
              onChange={(event) => onNativePreviewMinGrandStaffGapPxChange(Number(event.target.value))}
            />
            <span>px</span>
          </div>

          {statusText && <p className="osmd-preview-status">{statusText}</p>}
          {error && <p className="osmd-preview-error">{error}</p>}
        </div>

        <div className="osmd-preview-body osmd-preview-main-body native-preview-main-body">
          <div
            className="osmd-preview-paper-frame native-preview-paper-frame"
            style={{
              width: `${paperWidthPx}px`,
              height: `${paperHeightPx}px`,
            }}
          >
            <div
              className="native-preview-surface"
              style={{
                width: `${A4_PAGE_WIDTH}px`,
                height: `${A4_PAGE_HEIGHT}px`,
                transform: `scale(${paperScale})`,
              }}
            >
              <NativePreviewPageCanvas
                currentPage={currentPage}
                measurePairs={measurePairs}
                pedalSpans={pedalSpans}
                chordRulerEntriesByPair={chordRulerEntriesByPair}
                measureKeyFifthsFromImport={measureKeyFifthsFromImport}
                measureTimeSignaturesFromImport={measureTimeSignaturesFromImport}
                supplementalSpacingTicksByPair={supplementalSpacingTicksByPair}
                timeAxisSpacingConfig={timeAxisSpacingConfig}
                grandStaffLayoutMetrics={grandStaffLayoutMetrics}
                showInScoreMeasureNumbers={showInScoreMeasureNumbers}
                showNoteHeadJianpuEnabled={showNoteHeadJianpuEnabled}
                onNativePreviewPageRenderedDiagnostics={onNativePreviewPageRenderedDiagnostics}
              />
              {showTitleBlock && (
                <div className="native-preview-title-block">
                  {workTitle && <div className="native-preview-title">{workTitle}</div>}
                  {creatorLabel && <div className="native-preview-subtitle">{creatorLabel}</div>}
                </div>
              )}
              {showPageNumbers && (
                <div className="native-preview-page-number">{`${Math.min(pageCount, pageIndex + 1)}`}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
