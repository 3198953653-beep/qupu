import type { OsmdPreviewModalProps } from './types'

type OsmdPreviewPaginationSectionProps = Pick<
  OsmdPreviewModalProps,
  'pageIndex' | 'pageCount' | 'goToPrevOsmdPreviewPage' | 'goToNextOsmdPreviewPage'
>

export function OsmdPreviewPaginationSection(props: OsmdPreviewPaginationSectionProps) {
  const { pageIndex, pageCount, goToPrevOsmdPreviewPage, goToNextOsmdPreviewPage } = props

  return (
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
  )
}
