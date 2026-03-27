import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH } from '../../constants'
import type { OsmdPreviewModalProps } from './types'

type OsmdPreviewSurfaceSectionProps = Pick<
  OsmdPreviewModalProps,
  | 'paperWidthPx'
  | 'paperHeightPx'
  | 'paperScale'
  | 'containerRef'
  | 'onOsmdPreviewSurfaceClick'
  | 'onOsmdPreviewSurfaceDoubleClick'
>

export function OsmdPreviewSurfaceSection(props: OsmdPreviewSurfaceSectionProps) {
  const {
    paperWidthPx,
    paperHeightPx,
    paperScale,
    containerRef,
    onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick,
  } = props

  return (
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
  )
}
