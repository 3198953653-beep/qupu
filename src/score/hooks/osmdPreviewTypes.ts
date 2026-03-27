import type { Selection } from '../types'

export type OsmdPreviewPoint = { x: number; y: number }
export type OsmdPreviewSize = { width: number; height: number }
export type OsmdPreviewBoundingBox = {
  RelativePosition?: OsmdPreviewPoint
  AbsolutePosition?: OsmdPreviewPoint
  Size?: OsmdPreviewSize
  ChildElements?: OsmdPreviewBoundingBox[]
}
export type OsmdPreviewMusicSystem = {
  PositionAndShape?: OsmdPreviewBoundingBox
}
export type OsmdPreviewPage = {
  MusicSystems?: OsmdPreviewMusicSystem[]
  PositionAndShape?: OsmdPreviewBoundingBox
}
export type OsmdPreviewGraphicalSheet = {
  MusicPages?: OsmdPreviewPage[]
}
export type OsmdPreviewEngravingRules = {
  PageHeight?: number
  PageTopMargin?: number
  PageBottomMargin?: number
  PageLeftMargin?: number
  PageRightMargin?: number
}
export type OsmdPreviewDrawer = {
  drawSheet?: (sheet?: OsmdPreviewGraphicalSheet) => void
}
export type OsmdPreviewInstance = {
  Zoom: number
  GraphicSheet?: OsmdPreviewGraphicalSheet
  EngravingRules?: OsmdPreviewEngravingRules
  Drawer?: OsmdPreviewDrawer
  load: (xml: string) => Promise<void>
  render: () => void
}
export type OsmdPreviewRebalanceStats = {
  executed: boolean
  pageCount: number
  mutatedCount: number
  targetFirstTop: number
  targetFollowingTop: number
  targetBottom: number
  layoutBottom: number
  minSystemGap: number
  repaginationAttempts: number
  requiresRepagination: boolean
  pageSummaries: Array<{
    pageIndex: number
    frameCount: number
    mutated: number
    mode: 'sparse' | 'distributed'
    firstYBefore: number | null
    firstYAfter: number | null
    gapCount: number
    minGapShortfall: number
    bottomGapAfter: number | null
  }>
}
export type OsmdPreviewSelectionTarget = {
  pairIndex: number
  measureNumber: number
  onsetTicks: number
  domIds: string[]
  selection: Selection
}
