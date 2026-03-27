import type { OsmdPreviewModalProps } from './types'

type OsmdPreviewToolbarSectionProps = Pick<
  OsmdPreviewModalProps,
  'isExportingPdf' | 'exportOsmdPreviewPdf' | 'closeOsmdPreview'
>

export function OsmdPreviewToolbarSection(props: OsmdPreviewToolbarSectionProps) {
  const { isExportingPdf, exportOsmdPreviewPdf, closeOsmdPreview } = props

  return (
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
  )
}
