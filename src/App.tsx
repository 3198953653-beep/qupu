import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import './App.css'
import {
  A4_PAGE_HEIGHT,
  A4_PAGE_WIDTH,
  DURATION_TICKS,
  INITIAL_NOTES,
  PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
  PREVIEW_START_THRESHOLD_PX,
  SCORE_TOP_PADDING,
  SYSTEM_HEIGHT,
  TICKS_PER_BEAT,
} from './score/constants'
import {
  toDisplayDuration,
} from './score/layout/demand'
import { getLayoutNoteKey } from './score/layout/renderPosition'
import {
  DEFAULT_TIME_AXIS_SPACING_CONFIG,
  getMeasureUniformTimelineWeightSpan,
  getUniformTickSpacingPadding,
} from './score/layout/timeAxisSpacing'
import { useDragHandlers } from './score/dragHandlers'
import { useEditorHandlers } from './score/editorHandlers'
import { buildMusicXmlExportPayload } from './score/musicXmlActions'
import {
  useImportedRefsSync,
  useRendererCleanup,
  useRhythmLinkedBassSync,
  useScoreRenderEffect,
  useSynthLifecycle,
} from './score/hooks/useScoreEffects'
import { ScoreControls } from './score/components/ScoreControls'
import { ScoreBoard } from './score/components/ScoreBoard'
import {
  createPianoPitches,
  toDisplayPitch,
} from './score/pitchUtils'
import {
  buildBassMockNotes,
  buildMeasurePairs,
  flattenBassFromPairs,
  flattenTrebleFromPairs,
} from './score/scoreOps'
import { appendIntervalKey, deleteSelectedKey } from './score/keyboardEdits'
import type { HitGridIndex } from './score/layout/hitTest'
import type {
  DragDebugSnapshot,
  DragState,
  ImportFeedback,
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  Pitch,
  RhythmPresetId,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
  TimeSignature,
} from './score/types'

const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const INSPECTOR_SEQUENCE_PREVIEW_LIMIT = 64
const MANUAL_SCALE_BASELINE = 0.91
const DEFAULT_PAGE_HORIZONTAL_PADDING_PX = 86
const ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG = false
const HORIZONTAL_VIEW_MEASURE_WIDTH_PX = 220
const HORIZONTAL_VIEW_SYSTEM_START_DECORATION_PX = 96
const HORIZONTAL_VIEW_INLINE_DECORATION_PX = 24
const HORIZONTAL_VIEW_MIN_MEASURE_WIDTH_PX = 1
const HORIZONTAL_VIEW_HEIGHT_PX = SCORE_TOP_PADDING * 2 + SYSTEM_HEIGHT + 26
const MAX_CANVAS_RENDER_DIM_PX = 32760
const HORIZONTAL_RENDER_BUFFER_PX = 1200
const HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES = 1
const HORIZONTAL_OVERFLOW_RECOVERY_PAD_PX = 2
const HORIZONTAL_OVERFLOW_RECOVERY_EPS_PX = 0.5
const HORIZONTAL_OVERFLOW_GLOBAL_SCALE_EPS = 0.001
const ENABLE_HORIZONTAL_OVERFLOW_AUTO_GROW = true
const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }
const OSMD_PREVIEW_ZOOM_DEBOUNCE_MS = 120
const DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX = 9
const DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX = 23
const DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX = 10
const DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX = 10
const OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX = DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX
const OSMD_PREVIEW_SPARSE_SYSTEM_COUNT = 4
const OSMD_PREVIEW_MIN_SYSTEM_GAP_PX = 1
const OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT = 2
const OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS = 0.01
const OSMD_PREVIEW_REPAGINATION_MAX_ATTEMPTS = 12
const OSMD_PREVIEW_REPAGINATION_MIN_STEP_PX = 2
const OSMD_PREVIEW_REPAGINATION_MAX_STEP_PX = 64
const OSMD_PREVIEW_MARGIN_APPLY_DEBOUNCE_MS = 90
const OSMD_PREVIEW_FAST_STAGE_MEASURE_LIMIT = 12
const PDF_CJK_FONT_FAMILY = 'NotoSansSC'
const PDF_CJK_FONT_FILE_NAME = 'NotoSansSC-Regular.ttf'
const PDF_CJK_FONT_URL = new URL('./assets/fonts/NotoSansSC-Regular.ttf', import.meta.url).href

const PITCHES: Pitch[] = createPianoPitches()
const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)
let cachedPdfCjkFontBinary: string | null = null
let cachedPdfCjkFontLoadPromise: Promise<string> | null = null

function toSequencePreview(notes: ScoreNote[]): string {
  if (notes.length <= INSPECTOR_SEQUENCE_PREVIEW_LIMIT) {
    return notes
      .map((note) => (note.isRest ? `Rest(${toDisplayDuration(note.duration)})` : toDisplayPitch(note.pitch)))
      .join('  |  ')
  }
  const preview = notes
    .slice(0, INSPECTOR_SEQUENCE_PREVIEW_LIMIT)
    .map((note) => (note.isRest ? `Rest(${toDisplayDuration(note.duration)})` : toDisplayPitch(note.pitch)))
    .join('  |  ')
  return `${preview}  |  ...（还剩 ${notes.length - INSPECTOR_SEQUENCE_PREVIEW_LIMIT} 个）`
}

function getAutoScoreScale(measureCount: number): number {
  if (measureCount >= 180) return 0.62
  if (measureCount >= 140) return 0.68
  if (measureCount >= 110) return 0.74
  if (measureCount >= 80) return 0.8
  if (measureCount >= 56) return 0.86
  if (measureCount >= 36) return 0.92
  return 1
}

function clampScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(55, Math.min(130, Math.round(value)))
}

function clampCanvasHeightPercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(70, Math.min(260, Math.round(value)))
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function clampDurationGapRatio(value: number): number {
  const clamped = clampNumber(value, 0.5, 4)
  return Number(clamped.toFixed(2))
}

function clampBaseMinGap32Px(value: number): number {
  const clamped = clampNumber(value, 0, 12)
  return Number(clamped.toFixed(2))
}

function clampMaxBarlineEdgeGapPx(value: number): number {
  const clamped = clampNumber(value, 0, 40)
  return Number(clamped.toFixed(2))
}

function clampMinBarlineEdgeGapPx(value: number): number {
  const clamped = clampNumber(value, 0, 40)
  return Number(clamped.toFixed(2))
}

function clampPageHorizontalPaddingPx(value: number): number {
  return Math.round(clampNumber(value, 8, 120))
}

function clampOsmdPreviewZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(35, Math.min(160, Math.round(value)))
}

function clampOsmdPreviewPaperScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(50, Math.min(180, Math.round(value)))
}

function clampOsmdPreviewHorizontalMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX
  return Math.max(0, Math.min(120, Math.round(value)))
}

function clampOsmdPreviewTopMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX
  return Math.max(0, Math.min(180, Math.round(value)))
}

function clampOsmdPreviewBottomMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX
  return Math.max(0, Math.min(180, Math.round(value)))
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('[contenteditable="true"]'))
}

function hasTimeSignatureChanged(current: TimeSignature, previous: TimeSignature): boolean {
  return current.beats !== previous.beats || current.beatType !== previous.beatType
}

function getNoteLayoutRightEdge(layout: NoteLayout): number {
  if (Number.isFinite(layout.spacingRightX)) return layout.spacingRightX
  if (Number.isFinite(layout.rightX)) return layout.rightX
  return layout.x
}

function collectOsmdPreviewPages(container: HTMLElement): HTMLElement[] {
  const directChildren = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
  const directPages = directChildren.filter((child) => {
    const tag = child.tagName.toLowerCase()
    if (tag === 'svg' || tag === 'canvas') return true
    if (tag !== 'div') return false
    return Boolean(child.querySelector('svg, canvas'))
  })
  if (directPages.length > 0) return directPages
  return Array.from(container.querySelectorAll('svg, canvas')).filter((child): child is HTMLElement => child instanceof HTMLElement)
}

function resolveOsmdPreviewPageSvgElement(pageElement: HTMLElement): SVGSVGElement | null {
  if (pageElement instanceof SVGSVGElement) return pageElement
  const nested = pageElement.querySelector('svg')
  return nested instanceof SVGSVGElement ? nested : null
}

function parseSvgLengthValue(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function getSvgRenderSize(svgElement: SVGSVGElement): { width: number; height: number } {
  const widthAttr = parseSvgLengthValue(svgElement.getAttribute('width'))
  const heightAttr = parseSvgLengthValue(svgElement.getAttribute('height'))
  if (widthAttr && heightAttr) {
    return { width: widthAttr, height: heightAttr }
  }
  const viewBox = svgElement.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.trim().split(/\s+/).map(Number)
    if (
      parts.length === 4 &&
      Number.isFinite(parts[2]) &&
      Number.isFinite(parts[3]) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return { width: parts[2], height: parts[3] }
    }
  }
  return { width: A4_PAGE_WIDTH, height: A4_PAGE_HEIGHT }
}

function getSvgCoordinateSize(svgElement: SVGSVGElement): { width: number; height: number } {
  const viewBox = svgElement.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.trim().split(/\s+/).map(Number)
    if (
      parts.length === 4 &&
      Number.isFinite(parts[2]) &&
      Number.isFinite(parts[3]) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return { width: parts[2], height: parts[3] }
    }
  }
  return getSvgRenderSize(svgElement)
}

function cloneOsmdPreviewSvgForPdf(svgElement: SVGSVGElement): { svg: SVGSVGElement; width: number; height: number } {
  const svgClone = svgElement.cloneNode(true) as SVGSVGElement
  if (!svgClone.getAttribute('xmlns')) {
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }
  if (!svgClone.getAttribute('xmlns:xlink')) {
    svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }
  const { width, height } = getSvgRenderSize(svgClone)
  if (!svgClone.getAttribute('width')) {
    svgClone.setAttribute('width', String(width))
  }
  if (!svgClone.getAttribute('height')) {
    svgClone.setAttribute('height', String(height))
  }
  return {
    svg: svgClone,
    width,
    height,
  }
}

function arrayBufferToBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let result = ''
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(bytes.length, start + chunkSize)
    const chunk = bytes.subarray(start, end)
    result += String.fromCharCode(...chunk)
  }
  return result
}

async function loadPdfCjkFontBinary(): Promise<string> {
  if (cachedPdfCjkFontBinary) return cachedPdfCjkFontBinary
  if (cachedPdfCjkFontLoadPromise) return cachedPdfCjkFontLoadPromise
  cachedPdfCjkFontLoadPromise = (async () => {
    const response = await fetch(PDF_CJK_FONT_URL)
    if (!response.ok) {
      throw new Error(`中文字体加载失败: HTTP ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    const binary = arrayBufferToBinaryString(buffer)
    cachedPdfCjkFontBinary = binary
    return binary
  })()
  try {
    return await cachedPdfCjkFontLoadPromise
  } finally {
    cachedPdfCjkFontLoadPromise = null
  }
}

function ensurePdfCjkFontRegistered(pdf: any): void {
  if (!pdf.existsFileInVFS(PDF_CJK_FONT_FILE_NAME)) {
    if (!cachedPdfCjkFontBinary) {
      throw new Error('中文字体未加载完成。')
    }
    pdf.addFileToVFS(PDF_CJK_FONT_FILE_NAME, cachedPdfCjkFontBinary)
  }
  const fontList = pdf.getFontList()
  const existingStyles = fontList[PDF_CJK_FONT_FAMILY] ?? []
  if (!existingStyles.includes('normal')) {
    pdf.addFont(PDF_CJK_FONT_FILE_NAME, PDF_CJK_FONT_FAMILY, 'normal', 'normal', 'Identity-H')
  }
}

function overrideInlineFontFamily(styleText: string | null, familyName: string): string {
  const sanitized = (styleText ?? '').replace(/font-family\s*:[^;]+;?/gi, '').trim()
  const suffix = sanitized.length > 0 ? (sanitized.endsWith(';') ? '' : ';') : ''
  return `${sanitized}${suffix}font-family:'${familyName}';`
}

function svgContainsCjkText(svgElement: SVGSVGElement): boolean {
  const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff]/
  const textNodes = svgElement.querySelectorAll('text, tspan')
  for (const node of textNodes) {
    const value = node.textContent ?? ''
    if (cjkPattern.test(value)) return true
  }
  return false
}

function applyPdfCjkFontToSvgText(svgElement: SVGSVGElement): void {
  const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff]/
  const textNodes = svgElement.querySelectorAll('text, tspan')
  textNodes.forEach((node) => {
    const value = node.textContent ?? ''
    if (!cjkPattern.test(value)) return
    node.setAttribute('font-family', PDF_CJK_FONT_FAMILY)
    node.setAttribute('style', overrideInlineFontFamily(node.getAttribute('style'), PDF_CJK_FONT_FAMILY))
  })
}

function applyOsmdPreviewPageVisibility(pages: HTMLElement[], pageIndex: number): void {
  if (pages.length <= 1) return
  const safeIndex = Math.max(0, Math.min(pages.length - 1, pageIndex))
  pages.forEach((page, index) => {
    page.style.display = index === safeIndex ? '' : 'none'
  })
}

function applyOsmdPreviewPageNumbers(pages: HTMLElement[], visible: boolean): void {
  pages.forEach((page, index) => {
    const svg = resolveOsmdPreviewPageSvgElement(page)
    if (!svg) return
    const pageNumber = index + 1
    const existing = svg.querySelector('.osmd-preview-page-number-overlay')
    if (!visible || pageNumber <= 1) {
      existing?.remove()
      return
    }
    const svgNamespace = 'http://www.w3.org/2000/svg'
    const { width } = getSvgCoordinateSize(svg)
    const isEvenPage = pageNumber % 2 === 0
    const marginX = Math.max(36, width * 0.03)
    const x = isEvenPage ? marginX : Math.max(marginX, width - marginX)
    const y = 18
    const label = existing instanceof SVGTextElement
      ? existing
      : document.createElementNS(svgNamespace, 'text')
    label.setAttribute('class', 'osmd-preview-page-number-overlay')
    label.setAttribute('text-anchor', isEvenPage ? 'start' : 'end')
    label.setAttribute('dominant-baseline', 'hanging')
    label.setAttribute('font-size', '30')
    label.setAttribute('font-weight', '600')
    label.setAttribute('fill', '#000000')
    label.setAttribute('x', x.toFixed(3))
    label.setAttribute('y', y.toFixed(3))
    label.textContent = String(pageNumber)
    if (!(existing instanceof SVGTextElement)) {
      svg.appendChild(label)
    }
  })
}

type OsmdPreviewPoint = { x: number; y: number }
type OsmdPreviewSize = { width: number; height: number }
type OsmdPreviewBoundingBox = {
  RelativePosition?: OsmdPreviewPoint
  AbsolutePosition?: OsmdPreviewPoint
  Size?: OsmdPreviewSize
  ChildElements?: OsmdPreviewBoundingBox[]
}
type OsmdPreviewMusicSystem = {
  PositionAndShape?: OsmdPreviewBoundingBox
}
type OsmdPreviewPage = {
  MusicSystems?: OsmdPreviewMusicSystem[]
  PositionAndShape?: OsmdPreviewBoundingBox
}
type OsmdPreviewGraphicalSheet = {
  MusicPages?: OsmdPreviewPage[]
  reCalculate?: () => void
}
type OsmdPreviewEngravingRules = {
  PageLeftMargin: number
  PageRightMargin: number
  PageTopMargin: number
  PageBottomMargin: number
  PageHeight?: number
}
type OsmdPreviewDrawer = {
  drawSheet: (graphicalSheet: unknown) => void
}
type OsmdPreviewInstance = {
  Zoom: number
  render: () => void
  GraphicSheet?: OsmdPreviewGraphicalSheet
  Drawer?: OsmdPreviewDrawer
  EngravingRules?: OsmdPreviewEngravingRules
}

type OsmdPreviewSystemFrame = {
  system: OsmdPreviewMusicSystem
  y: number
  height: number
}

type OsmdPreviewRebalanceStats = {
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

type OsmdPreviewSelectionTarget = {
  pairIndex: number
  selection: Selection
  domIds: string[]
  measureNumber: number
  onsetTicks: number
}

type MeasureStaffOnsetEntry = {
  noteIndex: number
  onsetTicks: number
  maxKeyIndex: number
}

function escapeCssId(id: string): string {
  if (typeof (window as unknown as { CSS?: { escape?: (value: string) => string } }).CSS?.escape === 'function') {
    return (window as unknown as { CSS: { escape: (value: string) => string } }).CSS.escape(id)
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}

function getSelectionKey(selection: Selection): string {
  return `${selection.staff}|${selection.noteId}|${selection.keyIndex}`
}

function buildMeasureStaffOnsetEntries(notes: ScoreNote[]): MeasureStaffOnsetEntry[] {
  const entries: MeasureStaffOnsetEntry[] = []
  let cursorTicks = 0
  notes.forEach((note, noteIndex) => {
    const maxKeyIndex = note.chordPitches?.length ?? 0
    entries.push({
      noteIndex,
      onsetTicks: cursorTicks,
      maxKeyIndex,
    })
    cursorTicks += DURATION_TICKS[note.duration] ?? 0
  })
  return entries
}

function findMeasureStaffOnsetEntry(
  entries: MeasureStaffOnsetEntry[],
  onsetTicks: number,
): MeasureStaffOnsetEntry | null {
  if (entries.length === 0) return null
  let best: MeasureStaffOnsetEntry | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    const delta = Math.abs(entry.onsetTicks - onsetTicks)
    if (delta < bestDelta) {
      bestDelta = delta
      best = entry
    }
    if (delta === 0) break
  }
  if (!best) return null
  // OSMD timestamp and custom tick conversion can have small float->int drift.
  return bestDelta <= 1 ? best : null
}

function collectOsmdPreviewSystemFrames(page: OsmdPreviewPage): OsmdPreviewSystemFrame[] {
  const systems = page.MusicSystems ?? []
  return systems
    .map((system) => {
      const box = system.PositionAndShape
      const y = box?.RelativePosition?.y
      const height = box?.Size?.height
      if (
        typeof y !== 'number' ||
        !Number.isFinite(y) ||
        typeof height !== 'number' ||
        !Number.isFinite(height)
      ) {
        return null
      }
      return {
        system,
        y,
        height: Math.max(0, height),
      }
    })
    .filter((frame): frame is OsmdPreviewSystemFrame => frame !== null)
    .sort((left, right) => left.y - right.y)
}

function setOsmdPreviewSystemY(system: OsmdPreviewMusicSystem, nextY: number): boolean {
  const box = system.PositionAndShape
  const position = box?.RelativePosition
  if (!position || !Number.isFinite(position.y) || !Number.isFinite(nextY)) return false
  const delta = nextY - position.y
  if (Math.abs(delta) < 0.01) return false
  position.y = nextY
  const absolute = box?.AbsolutePosition
  if (absolute && Number.isFinite(absolute.y)) {
    absolute.y += delta
  }
  const shiftAbsoluteTreeY = (target: OsmdPreviewBoundingBox | undefined): void => {
    if (!target || !target.ChildElements || target.ChildElements.length === 0) return
    target.ChildElements.forEach((child) => {
      const childAbsolute = child.AbsolutePosition
      if (childAbsolute && Number.isFinite(childAbsolute.y)) {
        childAbsolute.y += delta
      }
      shiftAbsoluteTreeY(child)
    })
  }
  shiftAbsoluteTreeY(box)
  return true
}

function rebalanceOsmdPreviewVerticalSystems(
  osmd: OsmdPreviewInstance,
  firstPageTopMarginPx: number,
  followingPageTopMarginPx: number,
  bottomMarginPx: number,
  layoutBottomMarginPx = bottomMarginPx,
  repaginationAttempts = 0,
): OsmdPreviewRebalanceStats {
  const sheet = osmd.GraphicSheet
  const pages = sheet?.MusicPages ?? []
  const safeFirstPageTopMarginPx = clampOsmdPreviewTopMarginPx(firstPageTopMarginPx)
  const safeFollowingPageTopMarginPx = clampOsmdPreviewTopMarginPx(followingPageTopMarginPx)
  const safeBottomMarginPx = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
  const safeLayoutBottomMarginPx = clampOsmdPreviewBottomMarginPx(layoutBottomMarginPx)
  if (!sheet || pages.length === 0) {
    return {
      executed: false,
      pageCount: pages.length,
      mutatedCount: 0,
      targetFirstTop: safeFirstPageTopMarginPx,
      targetFollowingTop: safeFollowingPageTopMarginPx,
      targetBottom: safeBottomMarginPx,
      layoutBottom: safeLayoutBottomMarginPx,
      minSystemGap: OSMD_PREVIEW_MIN_SYSTEM_GAP_PX,
      repaginationAttempts,
      requiresRepagination: false,
      pageSummaries: [],
    }
  }

  let hasMutated = false
  let mutatedCount = 0
  let requiresRepagination = false
  const rulePageHeight = osmd.EngravingRules?.PageHeight
  const hasRulePageHeight = typeof rulePageHeight === 'number' && Number.isFinite(rulePageHeight) && rulePageHeight > 0
  const referencePageHeightUnits = pages.reduce((maxHeight, page) => {
    const candidate = page.PositionAndShape?.Size?.height
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
      return maxHeight
    }
    return Math.max(maxHeight, candidate)
  }, 0)
  const normalizedPageHeightUnits = hasRulePageHeight
    ? rulePageHeight
    : referencePageHeightUnits > 0
      ? referencePageHeightUnits
      : A4_PAGE_HEIGHT
  const pageSummaries: OsmdPreviewRebalanceStats['pageSummaries'] = []
  pages.forEach((page, pageIndex) => {
    const frames = collectOsmdPreviewSystemFrames(page)
    if (frames.length === 0) {
      pageSummaries.push({
        pageIndex,
        frameCount: 0,
        mutated: 0,
        mode: 'distributed',
        firstYBefore: null,
        firstYAfter: null,
        gapCount: 0,
        minGapShortfall: 0,
        bottomGapAfter: null,
      })
      return
    }
    const firstYBefore = frames[0].y
    const pageHeightUnits = normalizedPageHeightUnits

    let pageMutated = 0

    const heights = frames.map((frame) => frame.height)
    const sourceGaps = frames.slice(0, -1).map((frame, index) => {
      const next = frames[index + 1]
      const gap = next.y - (frame.y + heights[index])
      return Math.max(0, gap)
    })
    const sourceGapSum = sourceGaps.reduce((sum, gap) => sum + gap, 0)
    const targetTop = pageIndex === 0 ? safeFirstPageTopMarginPx : safeFollowingPageTopMarginPx
    const gapCount = sourceGaps.length
    const minGapTotal = gapCount * OSMD_PREVIEW_MIN_SYSTEM_GAP_PX
    const heightSum = heights.reduce((sum, height) => sum + height, 0)
    const targetBottom = safeBottomMarginPx
    const minRequiredSpan = heightSum + minGapTotal
    const maxFeasibleTop = Math.max(0, pageHeightUnits - targetBottom - minRequiredSpan)
    const appliedTop = Math.min(targetTop, maxFeasibleTop)
    const topShortfall = Math.max(0, targetTop - appliedTop)
    const availableSpan = Math.max(0, pageHeightUnits - appliedTop - targetBottom)
    const contentShortfall = Math.max(0, minRequiredSpan - availableSpan)
    const minGapShortfall = topShortfall + contentShortfall
    const extraGapSpan = Math.max(0, availableSpan - minRequiredSpan)
    const targetGaps =
      gapCount === 0
        ? []
        : sourceGapSum > 1e-6
          ? sourceGaps.map((gap) => OSMD_PREVIEW_MIN_SYSTEM_GAP_PX + (gap / sourceGapSum) * extraGapSpan)
          : sourceGaps.map(() => OSMD_PREVIEW_MIN_SYSTEM_GAP_PX + extraGapSpan / gapCount)
    if (
      minGapShortfall > OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS &&
      frames.length >= OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT
    ) {
      requiresRepagination = true
    }

    let cursorY = appliedTop
    frames.forEach((frame, index) => {
      if (setOsmdPreviewSystemY(frame.system, cursorY)) {
        hasMutated = true
        mutatedCount += 1
        pageMutated += 1
      }
      cursorY += heights[index]
      if (index < targetGaps.length) {
        cursorY += targetGaps[index]
      }
    })
    const lastFrameAfter = frames[frames.length - 1]
    const lastFrameAfterY = lastFrameAfter.system.PositionAndShape?.RelativePosition?.y
    const bottomGapAfter =
      typeof lastFrameAfterY === 'number' && Number.isFinite(lastFrameAfterY)
        ? Number((pageHeightUnits - (lastFrameAfterY + lastFrameAfter.height)).toFixed(3))
        : null
    pageSummaries.push({
      pageIndex,
      frameCount: frames.length,
      mutated: pageMutated,
      mode: frames.length <= OSMD_PREVIEW_SPARSE_SYSTEM_COUNT ? 'sparse' : 'distributed',
      firstYBefore,
      firstYAfter: frames[0].system.PositionAndShape?.RelativePosition?.y ?? null,
      gapCount,
      minGapShortfall: Number(minGapShortfall.toFixed(3)),
      bottomGapAfter,
    })
  })

  if (hasMutated) {
    const drawer = osmd.Drawer as unknown as {
      clear?: () => void
      backend?: { clear?: () => void }
      Backends?: Array<{ clear?: () => void }>
    }
    if (Array.isArray(drawer.Backends) && drawer.Backends.length > 0) {
      drawer.Backends.forEach((backend) => backend.clear?.())
    } else if (drawer.backend?.clear) {
      drawer.backend.clear()
    } else if (drawer.clear) {
      drawer.clear()
    }
    osmd.Drawer?.drawSheet(sheet)
  }
  return {
    executed: true,
    pageCount: pages.length,
    mutatedCount,
    targetFirstTop: safeFirstPageTopMarginPx,
    targetFollowingTop: safeFollowingPageTopMarginPx,
    targetBottom: safeBottomMarginPx,
    layoutBottom: safeLayoutBottomMarginPx,
    minSystemGap: OSMD_PREVIEW_MIN_SYSTEM_GAP_PX,
    repaginationAttempts,
    requiresRepagination,
    pageSummaries,
  }
}

function renderAndRebalanceOsmdPreview(
  osmd: OsmdPreviewInstance,
  horizontalMarginPx: number,
  firstPageTopMarginPx: number,
  followingPageTopMarginPx: number,
  bottomMarginPx: number,
): OsmdPreviewRebalanceStats {
  const safeHorizontalMarginPx = clampOsmdPreviewHorizontalMarginPx(horizontalMarginPx)
  const safeBottomMarginPx = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
  applyOsmdPreviewHorizontalMargins(osmd, safeHorizontalMarginPx)

  const baseLayoutBottomPx = clampOsmdPreviewBottomMarginPx(
    Math.min(safeBottomMarginPx, DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX),
  )
  let layoutBottomPx = baseLayoutBottomPx
  let attempt = 0
  while (true) {
    applyOsmdPreviewVerticalMargins(osmd, OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX, layoutBottomPx)
    osmd.render()
    const stats = rebalanceOsmdPreviewVerticalSystems(
      osmd,
      firstPageTopMarginPx,
      followingPageTopMarginPx,
      safeBottomMarginPx,
      layoutBottomPx,
      attempt,
    )
    const maxShortfall = stats.pageSummaries.reduce(
      (maxValue, summary) =>
        summary.frameCount >= OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT
          ? Math.max(maxValue, summary.minGapShortfall)
          : maxValue,
      0,
    )
    if (!stats.requiresRepagination || maxShortfall <= OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS) {
      return stats
    }
    if (attempt >= OSMD_PREVIEW_REPAGINATION_MAX_ATTEMPTS || layoutBottomPx >= 180) {
      return stats
    }
    const step = clampNumber(
      Math.ceil(maxShortfall),
      OSMD_PREVIEW_REPAGINATION_MIN_STEP_PX,
      OSMD_PREVIEW_REPAGINATION_MAX_STEP_PX,
    )
    const nextLayoutBottomPx = clampOsmdPreviewBottomMarginPx(layoutBottomPx + step)
    if (nextLayoutBottomPx <= layoutBottomPx) {
      return stats
    }
    layoutBottomPx = nextLayoutBottomPx
    attempt += 1
  }
}

function applyOsmdPreviewHorizontalMargins(
  osmd: OsmdPreviewInstance,
  horizontalMarginPx: number,
): void {
  const rules = osmd.EngravingRules
  if (!rules) return
  const safeMarginPx = clampOsmdPreviewHorizontalMarginPx(horizontalMarginPx)
  rules.PageLeftMargin = safeMarginPx
  rules.PageRightMargin = safeMarginPx
}

function applyOsmdPreviewVerticalMargins(
  osmd: OsmdPreviewInstance,
  topMarginPx: number,
  bottomMarginPx: number,
): void {
  const rules = osmd.EngravingRules
  if (!rules) return
  rules.PageTopMargin = clampOsmdPreviewTopMarginPx(topMarginPx)
  rules.PageBottomMargin = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
}

function buildFastOsmdPreviewXml(xmlText: string, measureLimit: number): string {
  const safeLimit = Math.max(1, Math.floor(measureLimit))
  if (!Number.isFinite(safeLimit)) return xmlText
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, 'application/xml')
    if (doc.querySelector('parsererror')) return xmlText
    const partNodes = Array.from(doc.querySelectorAll('score-partwise > part, score-timewise > part'))
    if (partNodes.length === 0) return xmlText
    let hasTrimmedMeasures = false
    partNodes.forEach((partNode) => {
      const measureNodes = Array.from(partNode.children).filter((node) => node.tagName.toLowerCase() === 'measure')
      for (let index = safeLimit; index < measureNodes.length; index += 1) {
        measureNodes[index].remove()
        hasTrimmedMeasures = true
      }
    })
    if (!hasTrimmedMeasures) return xmlText
    return new XMLSerializer().serializeToString(doc)
  } catch {
    return xmlText
  }
}

type FirstMeasureNoteDebugRow = {
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: Pitch
  noteX: number | null
  noteRightX: number | null
  spacingRightX: number | null
  headX: number | null
  headY: number | null
  pitchY: number | null
}

type FirstMeasureSnapshot = {
  stage: string
  pairIndex: number
  generatedAt: string
  measureX: number | null
  measureWidth: number | null
  measureEndBarX: number | null
  noteStartX: number | null
  noteEndX: number | null
  rows: FirstMeasureNoteDebugRow[]
}

function App() {
  const [notes, setNotes] = useState<ScoreNote[]>(INITIAL_NOTES)
  const [bassNotes, setBassNotes] = useState<ScoreNote[]>(INITIAL_BASS_NOTES)
  const [rhythmPreset, setRhythmPreset] = useState<RhythmPresetId>('quarter')
  const [activeSelection, setActiveSelection] = useState<Selection>({ noteId: INITIAL_NOTES[0].id, staff: 'treble', keyIndex: 0 })
  const [draggingSelection, setDraggingSelection] = useState<Selection | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [musicXmlInput, setMusicXmlInput] = useState<string>('')
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>({ kind: 'idle', message: '' })
  const [isRhythmLinked, setIsRhythmLinked] = useState(true)
  const [measurePairsFromImport, setMeasurePairsFromImport] = useState<MeasurePair[] | null>(null)
  const [measureKeyFifthsFromImport, setMeasureKeyFifthsFromImport] = useState<number[] | null>(null)
  const [measureDivisionsFromImport, setMeasureDivisionsFromImport] = useState<number[] | null>(null)
  const [measureTimeSignaturesFromImport, setMeasureTimeSignaturesFromImport] = useState<TimeSignature[] | null>(null)
  const [musicXmlMetadataFromImport, setMusicXmlMetadataFromImport] = useState<MusicXmlMetadata | null>(null)
  const [dragDebugReport, setDragDebugReport] = useState<string>('')
  const [measureEdgeDebugReport, setMeasureEdgeDebugReport] = useState<string>('')
  const [layoutRenderVersion, setLayoutRenderVersion] = useState(0)
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false)
  const [manualScalePercent, setManualScalePercent] = useState(100)
  const [canvasHeightPercent, setCanvasHeightPercent] = useState(100)
  const [pageHorizontalPaddingPx, setPageHorizontalPaddingPx] = useState(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
  const [timeAxisSpacingConfig, setTimeAxisSpacingConfig] = useState(DEFAULT_TIME_AXIS_SPACING_CONFIG)
  const [isOsmdPreviewOpen, setIsOsmdPreviewOpen] = useState(false)
  const [osmdPreviewXml, setOsmdPreviewXml] = useState<string>('')
  const [osmdPreviewStatusText, setOsmdPreviewStatusText] = useState<string>('')
  const [osmdPreviewError, setOsmdPreviewError] = useState<string>('')
  const [isOsmdPreviewExportingPdf, setIsOsmdPreviewExportingPdf] = useState(false)
  const [osmdPreviewPageIndex, setOsmdPreviewPageIndex] = useState(0)
  const [osmdPreviewPageCount, setOsmdPreviewPageCount] = useState(1)
  const [osmdPreviewShowPageNumbers, setOsmdPreviewShowPageNumbers] = useState(true)
  const [osmdPreviewZoomPercent, setOsmdPreviewZoomPercent] = useState(66)
  const [osmdPreviewZoomDraftPercent, setOsmdPreviewZoomDraftPercent] = useState(66)
  const [osmdPreviewPaperScalePercent, setOsmdPreviewPaperScalePercent] = useState(100)
  const [osmdPreviewHorizontalMarginPx, setOsmdPreviewHorizontalMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX,
  )
  const [osmdPreviewFirstPageTopMarginPx, setOsmdPreviewFirstPageTopMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX,
  )
  const [osmdPreviewTopMarginPx, setOsmdPreviewTopMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX,
  )
  const [osmdPreviewBottomMarginPx, setOsmdPreviewBottomMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX,
  )
  const [horizontalMeasureWidthOverrides, setHorizontalMeasureWidthOverrides] = useState<Record<number, number>>({})
  const [horizontalViewportXRange, setHorizontalViewportXRange] = useState<{ startX: number; endX: number }>({
    startX: 0,
    endX: A4_PAGE_WIDTH,
  })

  const scoreRef = useRef<HTMLCanvasElement | null>(null)
  const scoreOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const scoreScrollRef = useRef<HTMLDivElement | null>(null)
  const osmdPreviewContainerRef = useRef<HTMLDivElement | null>(null)
  const osmdPreviewPagesRef = useRef<HTMLElement[]>([])
  const osmdPreviewInstanceRef = useRef<OsmdPreviewInstance | null>(null)
  const osmdPreviewNoteLookupByDomIdRef = useRef<Map<string, OsmdPreviewSelectionTarget>>(new Map())
  const osmdPreviewNoteLookupBySelectionRef = useRef<Map<string, OsmdPreviewSelectionTarget>>(new Map())
  const osmdPreviewSelectedSelectionKeyRef = useRef<string | null>(null)
  const osmdPreviewHorizontalMarginPxRef = useRef<number>(DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX)
  const osmdPreviewFirstPageTopMarginPxRef = useRef<number>(DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX)
  const osmdPreviewTopMarginPxRef = useRef<number>(DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX)
  const osmdPreviewBottomMarginPxRef = useRef<number>(DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX)
  const osmdPreviewShowPageNumbersRef = useRef<boolean>(true)
  const osmdPreviewLastRebalanceStatsRef = useRef<OsmdPreviewRebalanceStats | null>(null)
  const osmdPreviewZoomCommitTimerRef = useRef<number | null>(null)
  const osmdPreviewMarginApplyTimerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | null>(null)

  const noteLayoutsRef = useRef<NoteLayout[]>([])
  const noteLayoutsByPairRef = useRef<Map<number, NoteLayout[]>>(new Map())
  const noteLayoutByKeyRef = useRef<Map<string, NoteLayout>>(new Map())
  const hitGridRef = useRef<HitGridIndex | null>(null)
  const measureLayoutsRef = useRef<Map<number, MeasureLayout>>(new Map())
  const rulerLayoutSignatureRef = useRef('')
  const measurePairsRef = useRef<MeasurePair[]>([])
  const dragDebugFramesRef = useRef<DragDebugSnapshot[]>([])
  const dragRef = useRef<DragState | null>(null)
  const dragPreviewFrameRef = useRef(0)
  const dragRafRef = useRef<number | null>(null)
  const dragPendingRef = useRef<{ drag: DragState; pitch: Pitch } | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const overlayRendererRef = useRef<Renderer | null>(null)
  const overlayRendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const overlayLastRectRef = useRef<MeasureLayout['overlayRect'] | null>(null)
  const stopPlayTimerRef = useRef<number | null>(null)
  const measurePairsFromImportRef = useRef<MeasurePair[] | null>(null)
  const measureKeyFifthsFromImportRef = useRef<number[] | null>(null)
  const measureDivisionsFromImportRef = useRef<number[] | null>(null)
  const measureTimeSignaturesFromImportRef = useRef<TimeSignature[] | null>(null)
  const musicXmlMetadataFromImportRef = useRef<MusicXmlMetadata | null>(null)
  const importedNoteLookupRef = useRef<Map<string, ImportedNoteLocation>>(new Map())
  const firstMeasureBaselineRef = useRef<FirstMeasureSnapshot | null>(null)
  const firstMeasureDragContextRef = useRef<{
    noteId: string
    staff: Selection['staff']
    keyIndex: number
    pairIndex: number
  } | null>(null)
  const firstMeasureDebugRafRef = useRef<number | null>(null)
  const importFeedbackRef = useRef<ImportFeedback>(importFeedback)
  const layoutReflowHintRef = useRef<LayoutReflowHint | null>(null)
  const measurePairs = useMemo(
    () => measurePairsFromImport ?? buildMeasurePairs(notes, bassNotes),
    [measurePairsFromImport, notes, bassNotes],
  )
  const spacingLayoutMode: SpacingLayoutMode = 'custom'
  const horizontalRawMeasureWidths = useMemo(() => {
    if (measurePairs.length === 0) return []

    const uniformPadding = getUniformTickSpacingPadding(timeAxisSpacingConfig)
    const maxBarlineEdgeGapPx = Math.max(0, timeAxisSpacingConfig.maxBarlineEdgeGapPx)
    const sharedAxisPaddingPx = Math.max(
      0,
      Math.min(Math.max(0, uniformPadding.startPadPx), maxBarlineEdgeGapPx) +
        Math.min(Math.max(0, uniformPadding.endPadPx), maxBarlineEdgeGapPx),
    )
    // Width model for horizontal view:
    // 1) timeline span comes from global gap + duration ratios
    // 2) edge-cap slider contributes explicit per-measure edge budget
    // This keeps edge-cap meaningful (changes measure width) while timeline
    // spacing remains controlled by duration/global sliders.
    const edgeGapBudgetPx = maxBarlineEdgeGapPx * 2
    const widths: number[] = []
    let previousKeyFifths = 0
    let previousTimeSignature = DEFAULT_TIME_SIGNATURE

    for (let pairIndex = 0; pairIndex < measurePairs.length; pairIndex += 1) {
      const measure = measurePairs[pairIndex]
      const keyFifths = measureKeyFifthsFromImport?.[pairIndex] ?? previousKeyFifths
      const timeSignature = measureTimeSignaturesFromImport?.[pairIndex] ?? previousTimeSignature
      const isSystemStart = pairIndex === 0
      const showKeySignature = isSystemStart || keyFifths !== previousKeyFifths
      const showTimeSignature = pairIndex === 0 || hasTimeSignatureChanged(timeSignature, previousTimeSignature)
      const measureTicks = Math.max(
        1,
        Math.round(timeSignature.beats * TICKS_PER_BEAT * (4 / timeSignature.beatType)),
      )
      const weightSpan = getMeasureUniformTimelineWeightSpan(measure, measureTicks, timeAxisSpacingConfig)
      const decorationFixedPx = isSystemStart
        ? HORIZONTAL_VIEW_SYSTEM_START_DECORATION_PX
        : (showKeySignature || showTimeSignature ? HORIZONTAL_VIEW_INLINE_DECORATION_PX : 0)
      const estimatedWidth = Math.max(
        HORIZONTAL_VIEW_MIN_MEASURE_WIDTH_PX,
        Number(
          (
            sharedAxisPaddingPx +
            edgeGapBudgetPx +
            decorationFixedPx +
            weightSpan
          ).toFixed(3),
        ),
      )
      widths.push(estimatedWidth)
      previousKeyFifths = keyFifths
      previousTimeSignature = timeSignature
    }

    return widths
  }, [
    measurePairs,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    timeAxisSpacingConfig.leftEdgePaddingPx,
    timeAxisSpacingConfig.rightEdgePaddingPx,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.maxBarlineEdgeGapPx,
    timeAxisSpacingConfig.durationGapRatios,
    timeAxisSpacingConfig.minGapBeats,
    timeAxisSpacingConfig.gapGamma,
    timeAxisSpacingConfig.gapBaseWeight,
  ])
  const horizontalMeasureWidths = useMemo(() => {
    if (horizontalRawMeasureWidths.length === 0) return []
    return horizontalRawMeasureWidths.map((baseWidth, pairIndex) => {
      const overrideWidth = horizontalMeasureWidthOverrides[pairIndex]
      if (!Number.isFinite(overrideWidth)) return baseWidth
      return Math.max(baseWidth, overrideWidth)
    })
  }, [horizontalRawMeasureWidths, horizontalMeasureWidthOverrides])
  const horizontalEstimatedMeasureWidthTotal = useMemo(() => {
    if (horizontalMeasureWidths.length === 0) return HORIZONTAL_VIEW_MEASURE_WIDTH_PX
    const total = horizontalMeasureWidths.reduce((sum, width) => sum + width, 0)
    return Math.max(HORIZONTAL_VIEW_MEASURE_WIDTH_PX, total)
  }, [horizontalMeasureWidths])
  const autoScoreScale = useMemo(() => getAutoScoreScale(measurePairs.length), [measurePairs.length])
  const safeManualScalePercent = clampScalePercent(manualScalePercent)
  const safeCanvasHeightPercent = clampCanvasHeightPercent(canvasHeightPercent)
  const relativeScale = autoScaleEnabled ? autoScoreScale : safeManualScalePercent / 100
  const horizontalDisplayScale = relativeScale * MANUAL_SCALE_BASELINE
  const provisionalDisplayScoreHeight = HORIZONTAL_VIEW_HEIGHT_PX
  const displayScoreWidth = useMemo(() => {
    const totalMeasureWidth = horizontalEstimatedMeasureWidthTotal
    const baseWidth = Math.max(A4_PAGE_WIDTH, pageHorizontalPaddingPx * 2 + totalMeasureWidth)
    // Keep horizontal display width in the same scale space as canvas transform.
    // Otherwise scroll-space and render-space drift apart and can leave blank tails.
    return Math.max(A4_PAGE_WIDTH, Math.round(baseWidth * horizontalDisplayScale))
  }, [horizontalEstimatedMeasureWidthTotal, pageHorizontalPaddingPx, horizontalDisplayScale])
  const baseScoreScale = relativeScale * MANUAL_SCALE_BASELINE
  const minScaleForCanvasHeight = provisionalDisplayScoreHeight / MAX_CANVAS_RENDER_DIM_PX
  const scoreScaleX = baseScoreScale
  const scoreScaleY = Math.max(baseScoreScale, minScaleForCanvasHeight)
  const canvasHeightScale = safeCanvasHeightPercent / 100
  const viewportHeightScaleByZoom = Math.max(0.1, scoreScaleY / MANUAL_SCALE_BASELINE)
  const scoreScale = scoreScaleX
  const autoScalePercent = Math.round(baseScoreScale * 100)
  const totalScoreWidth = Math.max(1, Math.round(displayScoreWidth / scoreScaleX))
  const trebleNoteById = useMemo(() => new Map(notes.map((note) => [note.id, note] as const)), [notes])
  const bassNoteById = useMemo(() => new Map(bassNotes.map((note) => [note.id, note] as const)), [bassNotes])
  const trebleNoteIndexById = useMemo(() => {
    const byId = new Map<string, number>()
    notes.forEach((note, index) => byId.set(note.id, index))
    return byId
  }, [notes])
  const bassNoteIndexById = useMemo(() => {
    const byId = new Map<string, number>()
    bassNotes.forEach((note, index) => byId.set(note.id, index))
    return byId
  }, [bassNotes])
  const horizontalMeasureFramesByPair = useMemo(() => {
    if (horizontalMeasureWidths.length === 0) return [] as Array<{ measureX: number; measureWidth: number }>
    let cursorX = pageHorizontalPaddingPx
    return horizontalMeasureWidths.map((measureWidth) => {
      const frame = { measureX: cursorX, measureWidth }
      cursorX += measureWidth
      return frame
    })
  }, [horizontalMeasureWidths, pageHorizontalPaddingPx])
  const horizontalViewportWidthInScore = Math.max(1, horizontalViewportXRange.endX - horizontalViewportXRange.startX)
  const horizontalRenderSurfaceWidth = useMemo(() => {
    const desiredWidth = Math.ceil(horizontalViewportWidthInScore + HORIZONTAL_RENDER_BUFFER_PX * 2)
    const targetWidth = Math.max(1200, desiredWidth)
    return Math.max(1, Math.min(totalScoreWidth, Math.min(MAX_CANVAS_RENDER_DIM_PX, targetWidth)))
  }, [totalScoreWidth, horizontalViewportWidthInScore])
  const horizontalRenderOffsetX = useMemo(() => {
    const desiredOffset = Math.max(0, Math.floor(horizontalViewportXRange.startX))
    const maxOffset = Math.max(0, totalScoreWidth - horizontalRenderSurfaceWidth)
    return Math.max(0, Math.min(maxOffset, desiredOffset))
  }, [horizontalViewportXRange.startX, totalScoreWidth, horizontalRenderSurfaceWidth])
  const scoreWidth = horizontalRenderSurfaceWidth
  const systemRanges = useMemo(() => [{ startPairIndex: 0, endPairIndexExclusive: measurePairs.length }], [measurePairs.length])
  const scaledScoreContentHeight = Math.max(1, HORIZONTAL_VIEW_HEIGHT_PX * viewportHeightScaleByZoom)
  const displayScoreHeight = Math.max(1, Math.round(scaledScoreContentHeight * canvasHeightScale))
  const scoreHeight = Math.max(1, Math.round(scaledScoreContentHeight / scoreScaleY))
  const systemsPerPage = 1
  const pageCount = 1
  const safeCurrentPage = 0
  const visibleSystemRange = useMemo(() => ({ start: 0, end: 0 }), [])
  const horizontalRenderWindow = useMemo(() => {
    const frames = horizontalMeasureFramesByPair
    const renderWindowStartX = horizontalRenderOffsetX
    const renderWindowEndX = Math.min(totalScoreWidth, horizontalRenderOffsetX + scoreWidth)
    if (frames.length === 0) {
      return {
        startPairIndex: 0,
        endPairIndexExclusive: 0,
        startX: renderWindowStartX,
        endX: renderWindowEndX,
      }
    }
    const bufferedStartX = Math.max(0, renderWindowStartX - HORIZONTAL_RENDER_BUFFER_PX)
    const bufferedEndX = Math.min(totalScoreWidth, renderWindowEndX + HORIZONTAL_RENDER_BUFFER_PX)

    let startPairIndex = 0
    while (
      startPairIndex < frames.length &&
      frames[startPairIndex].measureX + frames[startPairIndex].measureWidth < bufferedStartX
    ) {
      startPairIndex += 1
    }

    let endPairIndexExclusive = startPairIndex
    while (endPairIndexExclusive < frames.length && frames[endPairIndexExclusive].measureX <= bufferedEndX) {
      endPairIndexExclusive += 1
    }

    startPairIndex = Math.max(0, startPairIndex - HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES)
    endPairIndexExclusive = Math.min(frames.length, endPairIndexExclusive + HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES)
    if (endPairIndexExclusive <= startPairIndex) {
      startPairIndex = Math.max(0, Math.min(frames.length - 1, startPairIndex))
      endPairIndexExclusive = Math.min(frames.length, startPairIndex + 1)
    }

    const firstFrame = frames[startPairIndex]
    const lastFrame = frames[endPairIndexExclusive - 1]
    const startX = Math.max(0, (firstFrame?.measureX ?? 0) - 120)
    const endX = Math.min(totalScoreWidth, (lastFrame ? lastFrame.measureX + lastFrame.measureWidth : totalScoreWidth) + 120)
    return { startPairIndex, endPairIndexExclusive, startX, endX }
  }, [
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    scoreWidth,
    totalScoreWidth,
  ])
  const layoutStabilityKey = useMemo(() => {
    const systemRangeKey = systemRanges.map((range) => `${range.startPairIndex}-${range.endPairIndexExclusive}`).join(',')
    const spacingKey = [
      timeAxisSpacingConfig.baseMinGap32Px,
      timeAxisSpacingConfig.minBarlineEdgeGapPx,
      timeAxisSpacingConfig.maxBarlineEdgeGapPx,
      timeAxisSpacingConfig.durationGapRatios.thirtySecond,
      timeAxisSpacingConfig.durationGapRatios.sixteenth,
      timeAxisSpacingConfig.durationGapRatios.eighth,
      timeAxisSpacingConfig.durationGapRatios.quarter,
      timeAxisSpacingConfig.durationGapRatios.half,
      spacingLayoutMode,
    ].join(',')
    return `${scoreWidth}|${scoreHeight}|${pageHorizontalPaddingPx}|${systemRangeKey}|${spacingKey}`
  }, [
    scoreWidth,
    scoreHeight,
    pageHorizontalPaddingPx,
    systemRanges,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.minBarlineEdgeGapPx,
    timeAxisSpacingConfig.maxBarlineEdgeGapPx,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.half,
    spacingLayoutMode,
  ])

  const handleScoreRendered = useCallback(() => {
    const layouts = measureLayoutsRef.current
    if (!layouts || layouts.size === 0) return
    const entries = [...layouts.entries()].sort((left, right) => left[0] - right[0])
    const signature = entries
      .map(([pairIndex, layout]) => `${pairIndex}:${layout.measureX.toFixed(3)}`)
      .join('|')
    if (signature === rulerLayoutSignatureRef.current) return
    rulerLayoutSignatureRef.current = signature
    setLayoutRenderVersion((current) => current + 1)
  }, [])

  useEffect(() => {
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) {
      setHorizontalViewportXRange({ startX: 0, endX: totalScoreWidth })
      return
    }

    const updateViewport = () => {
      const nextStartX = Math.max(0, scrollHost.scrollLeft / scoreScaleX)
      const nextEndX = Math.max(nextStartX + 1, (scrollHost.scrollLeft + scrollHost.clientWidth) / scoreScaleX)
      setHorizontalViewportXRange((current) => {
        if (Math.abs(current.startX - nextStartX) < 0.5 && Math.abs(current.endX - nextEndX) < 0.5) {
          return current
        }
        return { startX: nextStartX, endX: nextEndX }
      })
    }

    updateViewport()
    scrollHost.addEventListener('scroll', updateViewport, { passive: true })
    window.addEventListener('resize', updateViewport)

    return () => {
      scrollHost.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
    }
  }, [scoreScaleX, totalScoreWidth, displayScoreWidth])

  useEffect(() => {
    setHorizontalMeasureWidthOverrides((current) => {
      if (Object.keys(current).length === 0) return current
      return {}
    })
  }, [
    measurePairs.length,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.minBarlineEdgeGapPx,
    timeAxisSpacingConfig.maxBarlineEdgeGapPx,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.half,
  ])

  useEffect(() => {
    setHorizontalMeasureWidthOverrides((current) => {
      const currentKeys = Object.keys(current)
      if (currentKeys.length === 0) return current
      let changed = false
      const next: Record<number, number> = {}
      currentKeys.forEach((key) => {
        const pairIndex = Number(key)
        const width = current[pairIndex]
        const baseWidth = horizontalRawMeasureWidths[pairIndex]
        if (
          Number.isInteger(pairIndex) &&
          pairIndex >= 0 &&
          pairIndex < horizontalRawMeasureWidths.length &&
          Number.isFinite(width) &&
          Number.isFinite(baseWidth) &&
          width > baseWidth + HORIZONTAL_OVERFLOW_GLOBAL_SCALE_EPS
        ) {
          next[pairIndex] = width
        } else {
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [horizontalRawMeasureWidths])

  useImportedRefsSync({
    measurePairsFromImport,
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImport,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    measurePairs,
    measurePairsRef,
  })

  useRhythmLinkedBassSync({
    notes,
    isRhythmLinked,
    setBassNotes,
  })

  useScoreRenderEffect({
    scoreRef,
    rendererRef,
    rendererSizeRef,
    scoreWidth,
    scoreHeight,
    measurePairs,
    systemRanges,
    visibleSystemRange,
    renderOriginSystemIndex: visibleSystemRange.start,
    visiblePairRange: {
      startPairIndex: horizontalRenderWindow.startPairIndex,
      endPairIndexExclusive: horizontalRenderWindow.endPairIndexExclusive,
    },
    clearViewportXRange: null,
    measureFramesByPair: horizontalMeasureFramesByPair,
    renderOffsetX: horizontalRenderOffsetX,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    activeSelection,
    draggingSelection,
    layoutReflowHintRef,
    layoutStabilityKey,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    backend: SCORE_RENDER_BACKEND,
    pagePaddingX: pageHorizontalPaddingPx,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    onAfterRender: handleScoreRendered,
  })

  useEffect(() => {
    if (!ENABLE_HORIZONTAL_OVERFLOW_AUTO_GROW) return
    if (draggingSelection) return
    if (horizontalMeasureWidths.length === 0) return

    const measureLayouts = measureLayoutsRef.current
    const noteLayoutsByPair = noteLayoutsByPairRef.current
    if (measureLayouts.size === 0 || noteLayoutsByPair.size === 0) return
    const maxBarlineEdgeGapPx = Math.max(0, timeAxisSpacingConfig.maxBarlineEdgeGapPx)
    const minBarlineEdgeGapCandidatePx = Math.max(0, timeAxisSpacingConfig.minBarlineEdgeGapPx)
    const effectiveMinBarlineEdgeGapPx =
      minBarlineEdgeGapCandidatePx <= maxBarlineEdgeGapPx ? minBarlineEdgeGapCandidatePx : maxBarlineEdgeGapPx

    setHorizontalMeasureWidthOverrides((current) => {
      let changed = false
      const next: Record<number, number> = { ...current }

      measureLayouts.forEach((measureLayout, pairIndex) => {
        const pairLayouts = noteLayoutsByPair.get(pairIndex)
        if (!pairLayouts || pairLayouts.length === 0) return

        let maxLayoutRightX = Number.NEGATIVE_INFINITY
        pairLayouts.forEach((layout) => {
          maxLayoutRightX = Math.max(maxLayoutRightX, getNoteLayoutRightEdge(layout))
        })
        if (!Number.isFinite(maxLayoutRightX)) return

        const measureEndBarX = measureLayout.measureX + measureLayout.measureWidth
        const rightLimitX = measureLayout.showEndTimeSignature
          ? (Number.isFinite(measureLayout.noteEndX) ? measureLayout.noteEndX : measureEndBarX)
          : measureEndBarX
        const overflow = maxLayoutRightX - rightLimitX
        const overflowPx =
          Number.isFinite(overflow) && overflow > HORIZONTAL_OVERFLOW_RECOVERY_EPS_PX
            ? overflow
            : 0
        const rightGapToBoundaryPx = rightLimitX - maxLayoutRightX
        const minGapDeficitPx =
          effectiveMinBarlineEdgeGapPx > 0 && Number.isFinite(rightGapToBoundaryPx)
            ? Math.max(0, effectiveMinBarlineEdgeGapPx - rightGapToBoundaryPx)
            : 0
        if (overflowPx <= HORIZONTAL_OVERFLOW_RECOVERY_EPS_PX && minGapDeficitPx <= HORIZONTAL_OVERFLOW_RECOVERY_EPS_PX) {
          return
        }

        const baseWidth = horizontalRawMeasureWidths[pairIndex] ?? measureLayout.measureWidth
        const currentEffectiveWidth = Math.max(
          baseWidth,
          horizontalMeasureWidths[pairIndex] ?? baseWidth,
          current[pairIndex] ?? Number.NEGATIVE_INFINITY,
        )
        if (!Number.isFinite(currentEffectiveWidth) || currentEffectiveWidth <= 0) return
        const overflowRecoveryPadPx =
          overflowPx <= HORIZONTAL_OVERFLOW_RECOVERY_EPS_PX || maxBarlineEdgeGapPx <= 0
            ? 0
            : HORIZONTAL_OVERFLOW_RECOVERY_PAD_PX
        const desiredWidth =
          Math.ceil((currentEffectiveWidth + overflowPx + overflowRecoveryPadPx + minGapDeficitPx) * 1000) / 1000
        const existingOverride = next[pairIndex]
        const nextWidth = Number.isFinite(existingOverride) ? Math.max(existingOverride, desiredWidth) : desiredWidth
        if (Math.abs(nextWidth - (existingOverride ?? Number.NEGATIVE_INFINITY)) > HORIZONTAL_OVERFLOW_GLOBAL_SCALE_EPS) {
          next[pairIndex] = nextWidth
          changed = true
        }
      })

      return changed ? next : current
    })
  }, [
    draggingSelection,
    horizontalMeasureWidths,
    horizontalRawMeasureWidths,
    horizontalRenderWindow.startPairIndex,
    horizontalRenderWindow.endPairIndexExclusive,
    timeAxisSpacingConfig.minBarlineEdgeGapPx,
    timeAxisSpacingConfig.maxBarlineEdgeGapPx,
    notes,
    bassNotes,
  ])

  useSynthLifecycle({
    synthRef,
  })

  useRendererCleanup({
    dragRafRef,
    dragPendingRef,
    rendererRef,
    rendererSizeRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
  })

  const {
    clearDragOverlay,
    dumpDragDebugReport,
    clearDragDebugReport,
    onSurfacePointerMove,
    endDrag,
    beginDrag,
  } = useDragHandlers({
    scoreRef,
    scoreOverlayRef,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    measurePairsRef,
    dragDebugFramesRef,
    dragRef,
    dragPreviewFrameRef,
    dragRafRef,
    dragPendingRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
    setDragDebugReport,
    setLayoutReflowHint: (hint) => {
      const decoratedHint = hint ? { ...hint, layoutStabilityKey } : null
      layoutReflowHintRef.current = decoratedHint
    },
    setMeasurePairsFromImport,
    setNotes,
    setBassNotes,
    setActiveSelection,
    setDraggingSelection,
    measurePairsFromImportRef,
    importedNoteLookupRef,
    measureKeyFifthsFromImportRef,
    trebleNoteById,
    bassNoteById,
    pitches: PITCHES,
    previewDefaultAccidentalOffsetPx: PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
    previewStartThresholdPx: PREVIEW_START_THRESHOLD_PX,
    backend: SCORE_RENDER_BACKEND,
    scoreScale: scoreScaleY,
    timeAxisSpacingConfig,
    spacingLayoutMode,
  })

  const {
    playScore,
    importMusicXmlText,
    importMusicXmlFromTextarea,
    openMusicXmlFilePicker,
    onMusicXmlFileChange,
    loadSampleMusicXml,
    exportMusicXmlFile,
    resetScore,
    applyRhythmPreset,
  } = useEditorHandlers({
    synthRef,
    notes,
    bassNotes,
    stopPlayTimerRef,
    setIsPlaying,
    setNotes,
    setBassNotes,
    setMeasurePairsFromImport,
    measurePairsFromImportRef,
    setMeasureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    setMeasureDivisionsFromImport,
    measureDivisionsFromImportRef,
    setMeasureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    setMusicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    dragRef,
    clearDragOverlay,
    setDraggingSelection,
    setActiveSelection,
    setIsRhythmLinked,
    setImportFeedback,
    musicXmlInput,
    setMusicXmlInput,
    fileInputRef,
    measurePairs,
    setRhythmPreset,
    pitches: PITCHES,
    initialTrebleNotes: INITIAL_NOTES,
    initialBassNotes: INITIAL_BASS_NOTES,
  })

  useEffect(() => {
    const hasActiveTreble = notes.some((note) => note.id === activeSelection.noteId)
    const hasActiveBass = bassNotes.some((note) => note.id === activeSelection.noteId)

    if (activeSelection.staff === 'treble') {
      if (hasActiveTreble) return
      if (notes[0]) {
        setActiveSelection({ noteId: notes[0].id, staff: 'treble', keyIndex: 0 })
        return
      }
      if (bassNotes[0]) {
        setActiveSelection({ noteId: bassNotes[0].id, staff: 'bass', keyIndex: 0 })
      }
      return
    }

    if (hasActiveBass) return
    if (bassNotes[0]) {
      setActiveSelection({ noteId: bassNotes[0].id, staff: 'bass', keyIndex: 0 })
      return
    }
    if (notes[0]) {
      setActiveSelection({ noteId: notes[0].id, staff: 'treble', keyIndex: 0 })
    }
  }, [activeSelection, notes, bassNotes])

  const activePool = activeSelection.staff === 'treble' ? notes : bassNotes
  const activePoolById = activeSelection.staff === 'treble' ? trebleNoteById : bassNoteById
  const activePoolIndexById = activeSelection.staff === 'treble' ? trebleNoteIndexById : bassNoteIndexById
  const currentSelection = activePoolById.get(activeSelection.noteId) ?? activePool[0] ?? notes[0]
  const currentSelectionPosition = (activePoolIndexById.get(currentSelection.id) ?? 0) + 1
  const currentSelectionPitch =
    activeSelection.keyIndex > 0
      ? currentSelection.chordPitches?.[activeSelection.keyIndex - 1] ?? currentSelection.pitch
      : currentSelection.pitch
  const currentSelectionPitchLabel = currentSelection.isRest ? '休止符' : toDisplayPitch(currentSelectionPitch)
  const trebleSequenceText = useMemo(() => toSequencePreview(notes), [notes])
  const bassSequenceText = useMemo(() => toSequencePreview(bassNotes), [bassNotes])
  const isImportLoading = importFeedback.kind === 'loading'
  const importProgressPercent =
    typeof importFeedback.progress === 'number' ? Math.max(0, Math.min(100, importFeedback.progress)) : null
  useEffect(() => {
    importFeedbackRef.current = importFeedback
  }, [importFeedback])

  const applyKeyboardEditResult = useCallback(
    (nextPairs: MeasurePair[], nextSelection: Selection) => {
      if (measurePairsFromImportRef.current) {
        measurePairsFromImportRef.current = nextPairs
        setMeasurePairsFromImport(nextPairs)
      }
      setNotes(flattenTrebleFromPairs(nextPairs))
      setBassNotes(flattenBassFromPairs(nextPairs))
      setActiveSelection(nextSelection)
    },
    [setBassNotes, setMeasurePairsFromImport, setNotes, setActiveSelection],
  )
  const closeOsmdPreview = useCallback(() => {
    if (osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
      osmdPreviewZoomCommitTimerRef.current = null
    }
    setIsOsmdPreviewOpen(false)
    setOsmdPreviewStatusText('')
    setOsmdPreviewError('')
    setOsmdPreviewPageIndex(0)
    setOsmdPreviewPageCount(1)
    osmdPreviewPagesRef.current = []
    osmdPreviewInstanceRef.current = null
    const container = osmdPreviewContainerRef.current
    if (container) {
      container.querySelectorAll('.osmd-preview-note-selected').forEach((node) => {
        node.classList.remove('osmd-preview-note-selected')
      })
    }
    osmdPreviewNoteLookupByDomIdRef.current.clear()
    osmdPreviewNoteLookupBySelectionRef.current.clear()
    osmdPreviewSelectedSelectionKeyRef.current = null
  }, [])

  const clearOsmdPreviewNoteHighlight = useCallback(() => {
    const container = osmdPreviewContainerRef.current
    if (!container) return
    container.querySelectorAll('.osmd-preview-note-selected').forEach((node) => {
      node.classList.remove('osmd-preview-note-selected')
    })
  }, [])

  const applyOsmdPreviewNoteHighlight = useCallback((target: OsmdPreviewSelectionTarget | null) => {
    clearOsmdPreviewNoteHighlight()
    if (!target) return
    const container = osmdPreviewContainerRef.current
    if (!container) return
    for (const domId of target.domIds) {
      const targetNode = container.querySelector(`#${escapeCssId(domId)}`)
      if (!targetNode) continue
      targetNode.classList.add('osmd-preview-note-selected')
      return
    }
  }, [clearOsmdPreviewNoteHighlight])

  const rebuildOsmdPreviewNoteLookup = useCallback(() => {
    const osmd = osmdPreviewInstanceRef.current as unknown as {
      GraphicSheet?: {
        MusicPages?: Array<{
          MusicSystems?: Array<{
            StaffLines?: Array<{
              Measures?: Array<{
                measureNumber?: number
                MeasureNumber?: number
                staffEntries?: Array<{
                  graphicalVoiceEntries?: Array<{
                    notes?: Array<{
                      getSVGId?: () => string
                      sourceNote?: {
                        isRestFlag?: boolean
                        isRest?: () => boolean
                        sourceMeasure?: {
                          measureNumber?: number
                          MeasureNumber?: number
                        }
                        parentStaffEntry?: {
                          parentStaff?: {
                            idInMusicSheet?: number
                          }
                        }
                        voiceEntry?: {
                          timestamp?: {
                            realValue?: number
                            numerator?: number
                            denominator?: number
                          }
                          notes?: Array<unknown>
                        }
                      }
                    }>
                  }>
                }>
              }>
            }>
          }>
        }>
      }
    } | null
    const lookupByDomId = new Map<string, OsmdPreviewSelectionTarget>()
    const lookupBySelection = new Map<string, OsmdPreviewSelectionTarget>()
    if (!osmd?.GraphicSheet?.MusicPages?.length) {
      osmdPreviewNoteLookupByDomIdRef.current = lookupByDomId
      osmdPreviewNoteLookupBySelectionRef.current = lookupBySelection
      return
    }

    const onsetCache = new Map<string, MeasureStaffOnsetEntry[]>()
    const getOnsetEntries = (pairIndex: number, staff: 'treble' | 'bass'): MeasureStaffOnsetEntry[] => {
      const cacheKey = `${pairIndex}|${staff}`
      const cached = onsetCache.get(cacheKey)
      if (cached) return cached
      const pair = measurePairs[pairIndex]
      if (!pair) {
        onsetCache.set(cacheKey, [])
        return []
      }
      const notes = staff === 'treble' ? pair.treble : pair.bass
      const entries = buildMeasureStaffOnsetEntries(notes)
      onsetCache.set(cacheKey, entries)
      return entries
    }

    for (const page of osmd.GraphicSheet.MusicPages) {
      const systems = page?.MusicSystems ?? []
      for (const system of systems) {
        const staffLines = system?.StaffLines ?? []
        for (let staffLineIndex = 0; staffLineIndex < staffLines.length; staffLineIndex += 1) {
          const staffLine = staffLines[staffLineIndex]
          const graphicalMeasures = staffLine?.Measures ?? []
          for (const graphicalMeasure of graphicalMeasures) {
            const staffEntries = graphicalMeasure?.staffEntries ?? []
            for (const graphicalStaffEntry of staffEntries) {
              const graphicalVoiceEntries = graphicalStaffEntry?.graphicalVoiceEntries ?? []
              for (const graphicalVoiceEntry of graphicalVoiceEntries) {
                const graphicalNotes = graphicalVoiceEntry?.notes ?? []
                for (const graphicalNote of graphicalNotes) {
                  const sourceNote = graphicalNote?.sourceNote
                  if (!sourceNote) continue
                  const isRest = sourceNote.isRestFlag === true || (typeof sourceNote.isRest === 'function' && sourceNote.isRest())
                  if (isRest) continue

                  const sourceMeasure = sourceNote.sourceMeasure
                  const measureNumberRaw =
                    sourceMeasure?.measureNumber ??
                    sourceMeasure?.MeasureNumber ??
                    graphicalMeasure?.measureNumber ??
                    graphicalMeasure?.MeasureNumber
                  if (typeof measureNumberRaw !== 'number' || !Number.isFinite(measureNumberRaw)) continue
                  const pairIndex = Math.max(0, Math.round(measureNumberRaw) - 1)
                  const pair = measurePairs[pairIndex]
                  if (!pair) continue

                  const staffId =
                    sourceNote.parentStaffEntry?.parentStaff?.idInMusicSheet ??
                    (staffLineIndex % 2)
                  const staff: 'treble' | 'bass' = Number(staffId) === 1 ? 'bass' : 'treble'
                  const staffNotes = staff === 'treble' ? pair.treble : pair.bass
                  if (staffNotes.length === 0) continue

                  const timestamp = sourceNote.voiceEntry?.timestamp
                  const realValue =
                    (typeof timestamp?.realValue === 'number' && Number.isFinite(timestamp.realValue)
                      ? timestamp.realValue
                      : null) ??
                    (typeof timestamp?.numerator === 'number' &&
                    Number.isFinite(timestamp.numerator) &&
                    typeof timestamp?.denominator === 'number' &&
                    Number.isFinite(timestamp.denominator) &&
                    timestamp.denominator > 0
                      ? timestamp.numerator / timestamp.denominator
                      : null)
                  if (typeof realValue !== 'number' || !Number.isFinite(realValue)) continue
                  const onsetTicks = Math.round(realValue * TICKS_PER_BEAT * 4)

                  const onsetEntries = getOnsetEntries(pairIndex, staff)
                  const onsetEntry = findMeasureStaffOnsetEntry(onsetEntries, onsetTicks)
                  if (!onsetEntry) continue
                  const note = staffNotes[onsetEntry.noteIndex]
                  if (!note) continue

                  const voiceNotes = sourceNote.voiceEntry?.notes
                  const chordIndex = Array.isArray(voiceNotes)
                    ? Math.max(0, voiceNotes.findIndex((candidate) => candidate === sourceNote))
                    : 0
                  const keyIndex = Math.max(0, Math.min(chordIndex, onsetEntry.maxKeyIndex))
                  const selection: Selection = { noteId: note.id, staff, keyIndex }

                  const rawId = typeof graphicalNote.getSVGId === 'function' ? graphicalNote.getSVGId() : ''
                  if (!rawId) continue
                  const domIds = rawId.startsWith('vf-') ? [rawId, rawId.slice(3)] : [rawId, `vf-${rawId}`]
                  const uniqueDomIds = [...new Set(domIds.filter((value) => value.length > 0))]
                  if (uniqueDomIds.length === 0) continue

                  const target: OsmdPreviewSelectionTarget = {
                    pairIndex,
                    selection,
                    domIds: uniqueDomIds,
                    measureNumber: pairIndex + 1,
                    onsetTicks,
                  }
                  const selectionKey = getSelectionKey(selection)
                  if (!lookupBySelection.has(selectionKey)) {
                    lookupBySelection.set(selectionKey, target)
                  }
                  uniqueDomIds.forEach((domId) => {
                    if (!lookupByDomId.has(domId)) {
                      lookupByDomId.set(domId, target)
                    }
                  })
                }
              }
            }
          }
        }
      }
    }

    osmdPreviewNoteLookupByDomIdRef.current = lookupByDomId
    osmdPreviewNoteLookupBySelectionRef.current = lookupBySelection
    const selectedKey = osmdPreviewSelectedSelectionKeyRef.current
    if (!selectedKey) {
      clearOsmdPreviewNoteHighlight()
      return
    }
    applyOsmdPreviewNoteHighlight(lookupBySelection.get(selectedKey) ?? null)
  }, [applyOsmdPreviewNoteHighlight, clearOsmdPreviewNoteHighlight, measurePairs])

  const resolveOsmdPreviewTargetFromEvent = useCallback((eventTarget: EventTarget | null): OsmdPreviewSelectionTarget | null => {
    const container = osmdPreviewContainerRef.current
    if (!container || !(eventTarget instanceof Element)) return null
    let current: Element | null = eventTarget
    while (current && current !== container) {
      const id = (current as HTMLElement).id
      if (id) {
        const lookup = osmdPreviewNoteLookupByDomIdRef.current
        const target =
          lookup.get(id) ??
          (id.startsWith('vf-') ? lookup.get(id.slice(3)) : lookup.get(`vf-${id}`))
        if (target) return target
      }
      current = current.parentElement
    }
    return null
  }, [])

  const jumpFromOsmdPreviewToEditor = useCallback((target: OsmdPreviewSelectionTarget) => {
    const { selection, pairIndex } = target
    setActiveSelection(selection)
    setDraggingSelection(null)
    closeOsmdPreview()

    const scrollHost = scoreScrollRef.current
    if (!scrollHost) return
    const frame = horizontalMeasureFramesByPair[pairIndex]
    if (frame) {
      const frameCenterX = frame.measureX + frame.measureWidth * 0.5
      const coarseScrollLeft = Math.max(0, frameCenterX * scoreScaleX - scrollHost.clientWidth * 0.5)
      scrollHost.scrollLeft = coarseScrollLeft
    }

    let attempts = 0
    const maxAttempts = 20
    const alignSelection = () => {
      attempts += 1
      const noteLayout = noteLayoutByKeyRef.current.get(getLayoutNoteKey(selection.staff, selection.noteId))
      if (noteLayout) {
        const targetHeadX = noteLayout.noteHeads.find((head) => head.keyIndex === selection.keyIndex)?.x ?? noteLayout.x
        const targetScrollLeft = Math.max(0, targetHeadX * scoreScaleX - scrollHost.clientWidth * 0.45)
        scrollHost.scrollLeft = targetScrollLeft
        return
      }
      if (attempts < maxAttempts) {
        window.requestAnimationFrame(alignSelection)
      }
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(alignSelection)
    })
  }, [closeOsmdPreview, horizontalMeasureFramesByPair, scoreScaleX])

  const onOsmdPreviewSurfaceClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = resolveOsmdPreviewTargetFromEvent(event.target)
    if (!target) {
      osmdPreviewSelectedSelectionKeyRef.current = null
      clearOsmdPreviewNoteHighlight()
      return
    }
    osmdPreviewSelectedSelectionKeyRef.current = getSelectionKey(target.selection)
    applyOsmdPreviewNoteHighlight(target)
  }, [applyOsmdPreviewNoteHighlight, clearOsmdPreviewNoteHighlight, resolveOsmdPreviewTargetFromEvent])

  const onOsmdPreviewSurfaceDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = resolveOsmdPreviewTargetFromEvent(event.target)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    osmdPreviewSelectedSelectionKeyRef.current = getSelectionKey(target.selection)
    applyOsmdPreviewNoteHighlight(target)
    jumpFromOsmdPreviewToEditor(target)
  }, [applyOsmdPreviewNoteHighlight, jumpFromOsmdPreviewToEditor, resolveOsmdPreviewTargetFromEvent])

  const openOsmdPreview = useCallback(() => {
    const { xmlText } = buildMusicXmlExportPayload({
      measurePairs,
      keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
      divisionsByMeasure: measureDivisionsFromImportRef.current,
      timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
      metadata: musicXmlMetadataFromImportRef.current,
    })
    setOsmdPreviewXml(xmlText)
    setOsmdPreviewStatusText('正在生成OSMD预览...')
    setOsmdPreviewError('')
    setOsmdPreviewPageIndex(0)
    setOsmdPreviewPageCount(1)
    setIsOsmdPreviewOpen(true)
  }, [measurePairs])
  const exportOsmdPreviewPdf = useCallback(async () => {
    if (isOsmdPreviewExportingPdf) return
    const container = osmdPreviewContainerRef.current
    if (!container) {
      setOsmdPreviewError('当前没有可导出的预览内容。')
      return
    }
    const pageElements = collectOsmdPreviewPages(container)
    if (pageElements.length === 0) {
      setOsmdPreviewError('当前没有可导出的预览页面。')
      return
    }

    setIsOsmdPreviewExportingPdf(true)
    setOsmdPreviewError('')
    try {
      const { jsPDF } = await import('jspdf')
      type Svg2PdfFn = (
        element: SVGElement,
        pdf: unknown,
        options?: { x?: number; y?: number; width?: number; height?: number },
      ) => Promise<void> | void
      const svg2pdfModule = await import('svg2pdf.js')
      const svg2pdfMaybe = svg2pdfModule as unknown as {
        svg2pdf?: Svg2PdfFn
        default?: Svg2PdfFn
      }
      const svg2pdf = svg2pdfMaybe.svg2pdf ?? svg2pdfMaybe.default
      if (typeof svg2pdf !== 'function') {
        throw new Error('未找到SVG转PDF模块。')
      }
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
        compress: true,
      })
      let exportedCount = 0
      const totalCount = pageElements.length
      for (let pageIndex = 0; pageIndex < pageElements.length; pageIndex += 1) {
        const svgElement = resolveOsmdPreviewPageSvgElement(pageElements[pageIndex])
        if (!svgElement) continue
        setOsmdPreviewStatusText(`正在导出PDF... ${Math.min(totalCount, exportedCount + 1)} / ${totalCount}`)
        const { svg: svgForPdf, width, height } = cloneOsmdPreviewSvgForPdf(svgElement)
        if (svgContainsCjkText(svgForPdf)) {
          if (!cachedPdfCjkFontBinary) {
            await loadPdfCjkFontBinary()
          }
          ensurePdfCjkFontRegistered(pdf)
          applyPdfCjkFontToSvgText(svgForPdf)
        }
        if (exportedCount > 0) {
          pdf.addPage('a4', 'portrait')
        }
        const pdfWidth = pdf.internal.pageSize.getWidth()
        const pdfHeight = pdf.internal.pageSize.getHeight()
        const sourceAspect = width / Math.max(1e-6, height)
        const pdfAspect = pdfWidth / Math.max(1e-6, pdfHeight)
        let drawWidth = pdfWidth
        let drawHeight = pdfHeight
        let drawX = 0
        let drawY = 0
        if (sourceAspect > pdfAspect) {
          drawHeight = pdfWidth / sourceAspect
          drawY = (pdfHeight - drawHeight) / 2
        } else {
          drawWidth = pdfHeight * sourceAspect
          drawX = (pdfWidth - drawWidth) / 2
        }
        pdf.setFillColor(255, 255, 255)
        pdf.rect(0, 0, pdfWidth, pdfHeight, 'F')
        await svg2pdf(svgForPdf, pdf, {
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
        })
        exportedCount += 1
      }

      if (exportedCount <= 0) {
        throw new Error('预览中未找到可导出的SVG页面。')
      }
      const rawFileName = (musicXmlMetadataFromImportRef.current?.workTitle ?? 'score-preview').trim() || 'score-preview'
      const safeFileName = rawFileName.replace(/[\\/:*?"<>|]+/g, '_')
      pdf.save(`${safeFileName}.pdf`)
      setOsmdPreviewStatusText(`PDF导出完成，共 ${exportedCount} 页。`)
      window.setTimeout(() => {
        setOsmdPreviewStatusText((current) =>
          current.startsWith('PDF导出完成') ? '' : current,
        )
      }, 2200)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF导出失败。'
      setOsmdPreviewError(message)
    } finally {
      setIsOsmdPreviewExportingPdf(false)
    }
  }, [isOsmdPreviewExportingPdf])
  const goToPrevOsmdPreviewPage = useCallback(() => {
    setOsmdPreviewPageIndex((current) => Math.max(0, current - 1))
  }, [])
  const goToNextOsmdPreviewPage = useCallback(() => {
    setOsmdPreviewPageIndex((current) => Math.min(Math.max(0, osmdPreviewPageCount - 1), current + 1))
  }, [osmdPreviewPageCount])
  const commitOsmdPreviewZoomPercent = useCallback((nextValue: number) => {
    const clamped = clampOsmdPreviewZoomPercent(nextValue)
    if (osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
      osmdPreviewZoomCommitTimerRef.current = null
    }
    setOsmdPreviewZoomDraftPercent(clamped)
    setOsmdPreviewZoomPercent((current) => (current === clamped ? current : clamped))
  }, [])
  const scheduleOsmdPreviewZoomPercentCommit = useCallback((nextValue: number) => {
    const clamped = clampOsmdPreviewZoomPercent(nextValue)
    setOsmdPreviewZoomDraftPercent(clamped)
    if (osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
    }
    osmdPreviewZoomCommitTimerRef.current = window.setTimeout(() => {
      osmdPreviewZoomCommitTimerRef.current = null
      setOsmdPreviewZoomPercent((current) => (current === clamped ? current : clamped))
    }, OSMD_PREVIEW_ZOOM_DEBOUNCE_MS)
  }, [])
  const onOsmdPreviewPaperScalePercentChange = useCallback((nextValue: number) => {
    setOsmdPreviewPaperScalePercent(clampOsmdPreviewPaperScalePercent(nextValue))
  }, [])
  const onOsmdPreviewHorizontalMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewHorizontalMarginPx(clampOsmdPreviewHorizontalMarginPx(nextValue))
  }, [])
  const onOsmdPreviewFirstPageTopMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewFirstPageTopMarginPx(clampOsmdPreviewTopMarginPx(nextValue))
  }, [])
  const onOsmdPreviewTopMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewTopMarginPx(clampOsmdPreviewTopMarginPx(nextValue))
  }, [])
  const onOsmdPreviewBottomMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewBottomMarginPx(clampOsmdPreviewBottomMarginPx(nextValue))
  }, [])
  const onOsmdPreviewShowPageNumbersChange = useCallback((nextVisible: boolean) => {
    setOsmdPreviewShowPageNumbers(Boolean(nextVisible))
  }, [])

  useEffect(() => {
    setOsmdPreviewZoomDraftPercent((current) => {
      const clamped = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent)
      return current === clamped ? current : clamped
    })
  }, [osmdPreviewZoomPercent])

  useEffect(() => {
    osmdPreviewHorizontalMarginPxRef.current = clampOsmdPreviewHorizontalMarginPx(osmdPreviewHorizontalMarginPx)
  }, [osmdPreviewHorizontalMarginPx])

  useEffect(() => {
    osmdPreviewFirstPageTopMarginPxRef.current = clampOsmdPreviewTopMarginPx(osmdPreviewFirstPageTopMarginPx)
  }, [osmdPreviewFirstPageTopMarginPx])

  useEffect(() => {
    osmdPreviewTopMarginPxRef.current = clampOsmdPreviewTopMarginPx(osmdPreviewTopMarginPx)
  }, [osmdPreviewTopMarginPx])

  useEffect(() => {
    osmdPreviewBottomMarginPxRef.current = clampOsmdPreviewBottomMarginPx(osmdPreviewBottomMarginPx)
  }, [osmdPreviewBottomMarginPx])

  useEffect(() => {
    osmdPreviewShowPageNumbersRef.current = osmdPreviewShowPageNumbers
  }, [osmdPreviewShowPageNumbers])

  useEffect(() => {
    return () => {
      if (osmdPreviewZoomCommitTimerRef.current !== null) {
        window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
        osmdPreviewZoomCommitTimerRef.current = null
      }
      if (osmdPreviewMarginApplyTimerRef.current !== null) {
        window.clearTimeout(osmdPreviewMarginApplyTimerRef.current)
        osmdPreviewMarginApplyTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOsmdPreviewOpen) return
      if (dragRef.current || draggingSelection) return
      if (isTextInputTarget(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const scrollHost = scoreScrollRef.current
      if (!scrollHost) return
      const activeElement = document.activeElement
      if (!(activeElement instanceof HTMLElement)) return
      if (!(activeElement === scrollHost || scrollHost.contains(activeElement))) return

      if (event.key === 'Delete') {
        const result = deleteSelectedKey({
          pairs: measurePairs,
          selection: activeSelection,
          keyFifthsByMeasure: measureKeyFifthsFromImport,
          importedNoteLookup: importedNoteLookupRef.current,
        })
        if (!result) return
        event.preventDefault()
        applyKeyboardEditResult(result.nextPairs, result.nextSelection)
        return
      }

      const digitMatch = /^Digit([2-8])$/.exec(event.code)
      if (!digitMatch) return
      const intervalDegree = Number(digitMatch[1])
      if (!Number.isFinite(intervalDegree)) return
      const result = appendIntervalKey({
        pairs: measurePairs,
        selection: activeSelection,
        intervalDegree,
        direction: event.shiftKey ? 'down' : 'up',
        keyFifthsByMeasure: measureKeyFifthsFromImport,
        importedNoteLookup: importedNoteLookupRef.current,
      })
      if (!result) return
      event.preventDefault()
      applyKeyboardEditResult(result.nextPairs, result.nextSelection)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    isOsmdPreviewOpen,
    draggingSelection,
    measurePairs,
    activeSelection,
    measureKeyFifthsFromImport,
    applyKeyboardEditResult,
  ])

  useEffect(() => {
    if (!isOsmdPreviewOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeOsmdPreview()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeOsmdPreview, isOsmdPreviewOpen])

  useEffect(() => {
    if (!isOsmdPreviewOpen) return
    if (!osmdPreviewXml.trim()) {
      setOsmdPreviewError('没有可预览的MusicXML数据。')
      setOsmdPreviewStatusText('')
      return
    }

    let canceled = false

    const renderPreview = async () => {
      try {
        const container = osmdPreviewContainerRef.current
        if (!container) return
        setOsmdPreviewError('')
        setOsmdPreviewStatusText('正在生成OSMD预览...')
        container.innerHTML = ''

        const osmdModule = await import('opensheetmusicdisplay')
        if (canceled) return

        const osmd = new osmdModule.OpenSheetMusicDisplay(container, {
          autoResize: false,
          backend: 'svg',
          drawTitle: true,
          pageFormat: 'A4_P',
          drawMeasureNumbers: true,
          drawMeasureNumbersOnlyAtSystemStart: true,
          useXMLMeasureNumbers: true,
        })
        const fastStageXml = buildFastOsmdPreviewXml(osmdPreviewXml, OSMD_PREVIEW_FAST_STAGE_MEASURE_LIMIT)
        const useFastStageXml = fastStageXml !== osmdPreviewXml

        await osmd.load(useFastStageXml ? fastStageXml : osmdPreviewXml)
        if (canceled) return
        const previewInstance = osmd as unknown as OsmdPreviewInstance
        osmd.Zoom = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent) / 100
        // Stage 1: render once and show page 1 as early as possible.
        applyOsmdPreviewHorizontalMargins(previewInstance, osmdPreviewHorizontalMarginPxRef.current)
        applyOsmdPreviewVerticalMargins(
          previewInstance,
          OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX,
          clampOsmdPreviewBottomMarginPx(
            Math.min(osmdPreviewBottomMarginPxRef.current, DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX),
          ),
        )
        previewInstance.render()
        if (canceled) return
        osmdPreviewInstanceRef.current = previewInstance
        let renderedPages = collectOsmdPreviewPages(container)
        osmdPreviewPagesRef.current = renderedPages
        applyOsmdPreviewPageNumbers(renderedPages, osmdPreviewShowPageNumbersRef.current)
        let graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
        let nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
        setOsmdPreviewPageCount(nextPageCount)
        applyOsmdPreviewPageVisibility(renderedPages, 0)
        rebuildOsmdPreviewNoteLookup()
        setOsmdPreviewStatusText(
          useFastStageXml ? '已显示第一页，正在后台加载完整曲谱...' : '已显示第一页，正在优化后续分页...',
        )

        // Give browser a paint chance before heavy re-balance.
        await new Promise<void>((resolve) => {
          if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            resolve()
            return
          }
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve())
          })
        })
        if (canceled) return

        if (useFastStageXml) {
          setOsmdPreviewStatusText('正在加载完整曲谱并优化分页...')
          await osmd.load(osmdPreviewXml)
          if (canceled) return
          osmd.Zoom = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent) / 100
        }

        // Stage 2: full re-balance for all pages.
        osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
          previewInstance,
          osmdPreviewHorizontalMarginPxRef.current,
          osmdPreviewFirstPageTopMarginPxRef.current,
          osmdPreviewTopMarginPxRef.current,
          osmdPreviewBottomMarginPxRef.current,
        )
        if (canceled) return
        renderedPages = collectOsmdPreviewPages(container)
        osmdPreviewPagesRef.current = renderedPages
        applyOsmdPreviewPageNumbers(renderedPages, osmdPreviewShowPageNumbersRef.current)
        graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
        nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
        setOsmdPreviewPageCount(nextPageCount)
        applyOsmdPreviewPageVisibility(renderedPages, 0)
        rebuildOsmdPreviewNoteLookup()
        setOsmdPreviewStatusText('')
      } catch (error) {
        if (canceled) return
        setOsmdPreviewStatusText('')
        const message = error instanceof Error ? error.message : 'OSMD预览渲染失败。'
        setOsmdPreviewError(message)
      }
    }

    void renderPreview()

    return () => {
      canceled = true
      osmdPreviewInstanceRef.current = null
      osmdPreviewPagesRef.current = []
      const container = osmdPreviewContainerRef.current
      if (container) {
        container.innerHTML = ''
      }
      osmdPreviewNoteLookupByDomIdRef.current.clear()
      osmdPreviewNoteLookupBySelectionRef.current.clear()
      osmdPreviewSelectedSelectionKeyRef.current = null
    }
  }, [isOsmdPreviewOpen, osmdPreviewXml, rebuildOsmdPreviewNoteLookup])

  useEffect(() => {
    setOsmdPreviewPageIndex((current) => Math.max(0, Math.min(current, osmdPreviewPageCount - 1)))
  }, [osmdPreviewPageCount])

  useEffect(() => {
    if (!isOsmdPreviewOpen) return
    const osmd = osmdPreviewInstanceRef.current
    if (!osmd) return
    const nextZoom = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent) / 100
    if (Math.abs(osmd.Zoom - nextZoom) < 1e-6) return
    osmd.Zoom = nextZoom
    osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
      osmd,
      osmdPreviewHorizontalMarginPxRef.current,
      osmdPreviewFirstPageTopMarginPxRef.current,
      osmdPreviewTopMarginPxRef.current,
      osmdPreviewBottomMarginPxRef.current,
    )
    const container = osmdPreviewContainerRef.current
    if (!container) return
    const renderedPages = collectOsmdPreviewPages(container)
    osmdPreviewPagesRef.current = renderedPages
    applyOsmdPreviewPageNumbers(renderedPages, osmdPreviewShowPageNumbersRef.current)
    const graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
    const nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
    setOsmdPreviewPageCount(nextPageCount)
    applyOsmdPreviewPageVisibility(renderedPages, osmdPreviewPageIndex)
    rebuildOsmdPreviewNoteLookup()
  }, [isOsmdPreviewOpen, osmdPreviewPageIndex, osmdPreviewZoomPercent, rebuildOsmdPreviewNoteLookup])

  useEffect(() => {
    if (!isOsmdPreviewOpen) return
    const osmd = osmdPreviewInstanceRef.current
    if (!osmd) return
    if (osmdPreviewMarginApplyTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewMarginApplyTimerRef.current)
      osmdPreviewMarginApplyTimerRef.current = null
    }
    osmdPreviewMarginApplyTimerRef.current = window.setTimeout(() => {
      osmdPreviewMarginApplyTimerRef.current = null
      const container = osmdPreviewContainerRef.current
      osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
        osmd,
        osmdPreviewHorizontalMarginPx,
        osmdPreviewFirstPageTopMarginPx,
        osmdPreviewTopMarginPx,
        osmdPreviewBottomMarginPx,
      )
      if (!container) return
      const renderedPages = collectOsmdPreviewPages(container)
      osmdPreviewPagesRef.current = renderedPages
      applyOsmdPreviewPageNumbers(renderedPages, osmdPreviewShowPageNumbersRef.current)
      const graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
      const nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
      setOsmdPreviewPageCount(nextPageCount)
      applyOsmdPreviewPageVisibility(renderedPages, osmdPreviewPageIndex)
      rebuildOsmdPreviewNoteLookup()
    }, OSMD_PREVIEW_MARGIN_APPLY_DEBOUNCE_MS)
    return () => {
      if (osmdPreviewMarginApplyTimerRef.current !== null) {
        window.clearTimeout(osmdPreviewMarginApplyTimerRef.current)
        osmdPreviewMarginApplyTimerRef.current = null
      }
    }
  }, [
    isOsmdPreviewOpen,
    osmdPreviewHorizontalMarginPx,
    osmdPreviewFirstPageTopMarginPx,
    osmdPreviewTopMarginPx,
    osmdPreviewBottomMarginPx,
    osmdPreviewPageIndex,
    rebuildOsmdPreviewNoteLookup,
  ])

  useEffect(() => {
    applyOsmdPreviewPageVisibility(osmdPreviewPagesRef.current, osmdPreviewPageIndex)
  }, [osmdPreviewPageIndex, osmdPreviewPageCount])

  useEffect(() => {
    applyOsmdPreviewPageNumbers(osmdPreviewPagesRef.current, osmdPreviewShowPageNumbers)
  }, [osmdPreviewShowPageNumbers, osmdPreviewPageCount])

  const safeOsmdPreviewPaperScalePercent = clampOsmdPreviewPaperScalePercent(osmdPreviewPaperScalePercent)
  const safeOsmdPreviewHorizontalMarginPx = clampOsmdPreviewHorizontalMarginPx(osmdPreviewHorizontalMarginPx)
  const safeOsmdPreviewFirstPageTopMarginPx = clampOsmdPreviewTopMarginPx(osmdPreviewFirstPageTopMarginPx)
  const safeOsmdPreviewTopMarginPx = clampOsmdPreviewTopMarginPx(osmdPreviewTopMarginPx)
  const safeOsmdPreviewBottomMarginPx = clampOsmdPreviewBottomMarginPx(osmdPreviewBottomMarginPx)
  const osmdPreviewPaperScale = safeOsmdPreviewPaperScalePercent / 100
  const osmdPreviewPaperWidthPx = A4_PAGE_WIDTH * osmdPreviewPaperScale
  const osmdPreviewPaperHeightPx = A4_PAGE_HEIGHT * osmdPreviewPaperScale

  const scoreSurfaceOffsetXPx = horizontalRenderOffsetX * scoreScaleX
  const scaledRenderedScoreHeight = Math.max(1, scoreHeight * scoreScaleY)
  const scoreSurfaceOffsetYPx = Math.max(0, (displayScoreHeight - scaledRenderedScoreHeight) / 2)
  const measureRulerTicks = useMemo(() => {
    if (horizontalMeasureFramesByPair.length === 0) return [] as Array<{ key: string; xPx: number; label: string }>
    const renderedLayouts = measureLayoutsRef.current
    let fallbackShift = 0
    let hasFallbackShift = false
    if (renderedLayouts.size > 0) {
      for (const [pairIndex, layout] of renderedLayouts.entries()) {
        const frame = horizontalMeasureFramesByPair[pairIndex]
        if (!frame) continue
        const renderedScoreX = layout.measureX + horizontalRenderOffsetX
        fallbackShift = renderedScoreX - frame.measureX
        hasFallbackShift = true
        break
      }
    }

    return horizontalMeasureFramesByPair.map((frame, index) => {
      const layout = renderedLayouts.get(index)
      const scoreX = layout
        ? layout.measureX + horizontalRenderOffsetX
        : frame.measureX + (hasFallbackShift ? fallbackShift : 0)
      return {
        key: `measure-ruler-${index + 1}`,
        xPx: scoreX * scoreScaleX,
        label: `${index + 1}`,
      }
    })
  }, [
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    scoreScaleX,
    layoutStabilityKey,
    visibleSystemRange,
    layoutRenderVersion,
  ])
  const formatDebugCoord = (value: number | null | undefined): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'null'
    return value.toFixed(3)
  }
  const finiteOrNull = (value: number | null | undefined): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return value
  }
  const getPitchForKeyIndex = (note: ScoreNote, keyIndex: number): Pitch => {
    if (keyIndex <= 0) return note.pitch
    return note.chordPitches?.[keyIndex - 1] ?? note.pitch
  }
  const captureFirstMeasureSnapshot = (stage: string): FirstMeasureSnapshot | null => {
    const pairIndex = 0
    const measure = measurePairsRef.current[pairIndex]
    if (!measure) return null
    const layouts = noteLayoutsByPairRef.current.get(pairIndex) ?? []
    const layoutByNoteKey = new Map<string, NoteLayout>()
    layouts.forEach((layout) => {
      layoutByNoteKey.set(`${layout.staff}:${layout.id}`, layout)
    })
    const measureLayout = measureLayoutsRef.current.get(pairIndex) ?? null
    const rows: FirstMeasureNoteDebugRow[] = []
    const pushRows = (staff: 'treble' | 'bass', notes: ScoreNote[]) => {
      notes.forEach((note, noteIndex) => {
        const layout = layoutByNoteKey.get(`${staff}:${note.id}`)
        const keyCount = 1 + (note.chordPitches?.length ?? 0)
        for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
          const pitch = getPitchForKeyIndex(note, keyIndex)
          const head = layout?.noteHeads.find((item) => item.keyIndex === keyIndex)
          rows.push({
            staff,
            noteId: note.id,
            noteIndex,
            keyIndex,
            pitch,
            noteX: finiteOrNull(layout?.x),
            noteRightX: finiteOrNull(layout?.rightX),
            spacingRightX: finiteOrNull(layout?.spacingRightX),
            headX: finiteOrNull(head?.x),
            headY: finiteOrNull(head?.y),
            pitchY: finiteOrNull(layout?.pitchYMap[pitch]),
          })
        }
      })
    }
    pushRows('treble', measure.treble)
    pushRows('bass', measure.bass)
    return {
      stage,
      pairIndex,
      generatedAt: new Date().toISOString(),
      measureX: finiteOrNull(measureLayout?.measureX),
      measureWidth: finiteOrNull(measureLayout?.measureWidth),
      measureEndBarX: finiteOrNull(
        measureLayout ? measureLayout.measureX + measureLayout.measureWidth : null,
      ),
      noteStartX: finiteOrNull(measureLayout?.noteStartX),
      noteEndX: finiteOrNull(measureLayout?.noteEndX),
      rows,
    }
  }
  const buildFirstMeasureDiffReport = (
    beforeSnapshot: FirstMeasureSnapshot,
    afterSnapshot: FirstMeasureSnapshot,
  ): string => {
    const afterByRowKey = new Map<string, FirstMeasureNoteDebugRow>()
    afterSnapshot.rows.forEach((row) => {
      afterByRowKey.set(`${row.staff}:${row.noteId}:${row.keyIndex}`, row)
    })
    const lines: string[] = [
      `generatedAt: ${new Date().toISOString()}`,
      `debugTarget: first-measure(pair=0)`,
      `dragged: ${
        firstMeasureDragContextRef.current
          ? `${firstMeasureDragContextRef.current.staff}:${firstMeasureDragContextRef.current.noteId}[key=${firstMeasureDragContextRef.current.keyIndex}] pair=${firstMeasureDragContextRef.current.pairIndex}`
          : 'unknown'
      }`,
      `dragPreviewFrameCount: ${dragDebugFramesRef.current.length}`,
      `baselineStage: ${beforeSnapshot.stage} at ${beforeSnapshot.generatedAt}`,
      `releaseStage: ${afterSnapshot.stage} at ${afterSnapshot.generatedAt}`,
      `baseline measureX=${formatDebugCoord(beforeSnapshot.measureX)} measureWidth=${formatDebugCoord(beforeSnapshot.measureWidth)} measureEndBarX=${formatDebugCoord(beforeSnapshot.measureEndBarX)} noteStartX=${formatDebugCoord(beforeSnapshot.noteStartX)} noteEndX=${formatDebugCoord(beforeSnapshot.noteEndX)}`,
      `release  measureX=${formatDebugCoord(afterSnapshot.measureX)} measureWidth=${formatDebugCoord(afterSnapshot.measureWidth)} measureEndBarX=${formatDebugCoord(afterSnapshot.measureEndBarX)} noteStartX=${formatDebugCoord(afterSnapshot.noteStartX)} noteEndX=${formatDebugCoord(afterSnapshot.noteEndX)}`,
      '',
      'rows (before -> after | delta):',
    ]
    beforeSnapshot.rows.forEach((beforeRow) => {
      const rowKey = `${beforeRow.staff}:${beforeRow.noteId}:${beforeRow.keyIndex}`
      const afterRow = afterByRowKey.get(rowKey)
      const delta = (afterValue: number | null, beforeValue: number | null): string => {
        if (typeof afterValue !== 'number' || typeof beforeValue !== 'number') return 'null'
        return (afterValue - beforeValue).toFixed(3)
      }
      lines.push(
        [
          `- ${beforeRow.staff} note=${beforeRow.noteId} idx=${beforeRow.noteIndex} key=${beforeRow.keyIndex} pitch=${beforeRow.pitch}:`,
          `noteX ${formatDebugCoord(beforeRow.noteX)} -> ${formatDebugCoord(afterRow?.noteX)} (d=${delta(afterRow?.noteX ?? null, beforeRow.noteX)})`,
          `headX ${formatDebugCoord(beforeRow.headX)} -> ${formatDebugCoord(afterRow?.headX)} (d=${delta(afterRow?.headX ?? null, beforeRow.headX)})`,
          `headY ${formatDebugCoord(beforeRow.headY)} -> ${formatDebugCoord(afterRow?.headY)} (d=${delta(afterRow?.headY ?? null, beforeRow.headY)})`,
          `pitchY ${formatDebugCoord(beforeRow.pitchY)} -> ${formatDebugCoord(afterRow?.pitchY)} (d=${delta(afterRow?.pitchY ?? null, beforeRow.pitchY)})`,
          `rightX ${formatDebugCoord(beforeRow.noteRightX)} -> ${formatDebugCoord(afterRow?.noteRightX)} (d=${delta(afterRow?.noteRightX ?? null, beforeRow.noteRightX)})`,
          `spacingRightX ${formatDebugCoord(beforeRow.spacingRightX)} -> ${formatDebugCoord(afterRow?.spacingRightX)} (d=${delta(afterRow?.spacingRightX ?? null, beforeRow.spacingRightX)})`,
        ].join(' '),
      )
    })
    return lines.join('\n')
  }
  const onBeginDragWithFirstMeasureDebug: typeof beginDrag = (event) => {
    scoreScrollRef.current?.focus()
    beginDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    const drag = dragRef.current
    if (!drag) return
    firstMeasureDragContextRef.current = {
      noteId: drag.noteId,
      staff: drag.staff,
      keyIndex: drag.keyIndex,
      pairIndex: drag.pairIndex,
    }
    firstMeasureBaselineRef.current = captureFirstMeasureSnapshot('before-drag')
  }
  const onEndDragWithFirstMeasureDebug: typeof endDrag = (event) => {
    const dragging = dragRef.current
    endDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    if (!dragging) return
    const beforeSnapshot = firstMeasureBaselineRef.current
    if (!beforeSnapshot) return
    if (firstMeasureDebugRafRef.current !== null) {
      window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      firstMeasureDebugRafRef.current = null
    }
    firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
      firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
        const afterSnapshot = captureFirstMeasureSnapshot('after-drag-release')
        if (afterSnapshot) {
          const report = buildFirstMeasureDiffReport(beforeSnapshot, afterSnapshot)
          setMeasureEdgeDebugReport(report)
          console.log(report)
        }
        firstMeasureBaselineRef.current = null
        firstMeasureDragContextRef.current = null
        firstMeasureDebugRafRef.current = null
      })
    })
  }
  const dumpMeasureEdgeDebugReport = () => {
    const measureLayouts = measureLayoutsRef.current
    const noteLayoutsByPair = noteLayoutsByPairRef.current
    const totalMeasureCount = measurePairsRef.current.length
    const renderedPairIndices = [...measureLayouts.keys()].sort((left, right) => left - right)
    const notRenderedCount = Math.max(0, totalMeasureCount - renderedPairIndices.length)
    const lines: string[] = [
      `generatedAt: ${new Date().toISOString()}`,
      `totalMeasureCount: ${totalMeasureCount}`,
      `renderedMeasureCount: ${renderedPairIndices.length}`,
      `notRenderedMeasureCount: ${notRenderedCount}`,
      `visibleSystemRange: ${visibleSystemRange.start}..${visibleSystemRange.end}`,
      '',
      'rows:',
    ]

    let overflowCount = 0
    renderedPairIndices.forEach((pairIndex) => {
      const measureLayout = measureLayouts.get(pairIndex)
      if (!measureLayout) return

      const pairLayouts = noteLayoutsByPair.get(pairIndex) ?? []
      const measureEndBarX = measureLayout.measureX + measureLayout.measureWidth
      const noteRightLimitX = Number.isFinite(measureLayout.noteEndX) ? measureLayout.noteEndX : measureEndBarX
      const guardEndX = noteRightLimitX

      if (pairLayouts.length === 0) {
        lines.push(
          `- pair ${pairIndex}: no-note-layout measureEndBarX=${formatDebugCoord(measureEndBarX)} noteRightLimitX=${formatDebugCoord(noteRightLimitX)}`,
        )
        return
      }

      let rightMostHeadX = Number.NEGATIVE_INFINITY
      pairLayouts.forEach((layout) => {
        if (layout.x > rightMostHeadX) rightMostHeadX = layout.x
      })

      const tailTolerancePx = 0.5
      const tailCandidates = pairLayouts.filter((layout) => layout.x >= rightMostHeadX - tailTolerancePx)
      const lastHeadLayout =
        tailCandidates.reduce<NoteLayout | null>((best, layout) => {
          if (!best || layout.x > best.x) return layout
          return best
        }, null) ?? null
      const lastHeadRightX =
        lastHeadLayout && lastHeadLayout.noteHeads.length > 0
          ? lastHeadLayout.noteHeads.reduce((maxX, head) => Math.max(maxX, head.x + 9), Number.NEGATIVE_INFINITY)
          : Number.NaN
      const lastVisualLayout =
        tailCandidates.reduce<NoteLayout | null>((best, layout) => {
          if (!best || layout.rightX > best.rightX) return layout
          return best
        }, null) ?? null

      const headDelta = lastHeadRightX - noteRightLimitX
      const visualDelta = (lastVisualLayout?.rightX ?? Number.NaN) - noteRightLimitX
      const spacingDelta = (lastVisualLayout?.spacingRightX ?? Number.NaN) - noteRightLimitX
      const barlineHeadDelta = lastHeadRightX - measureEndBarX
      const guardDelta = (lastVisualLayout?.rightX ?? Number.NaN) - guardEndX
      const hasVisualOverflow = Number.isFinite(visualDelta) && visualDelta > 0
      if (hasVisualOverflow) overflowCount += 1

      lines.push(
        [
          `- pair ${pairIndex}:`,
          `lastHead=${lastHeadLayout ? `${lastHeadLayout.staff}:${lastHeadLayout.id}` : 'n/a'}`,
          `lastVisual=${lastVisualLayout ? `${lastVisualLayout.staff}:${lastVisualLayout.id}` : 'n/a'}`,
          `lastHeadX=${formatDebugCoord(lastHeadLayout?.x)}`,
          `lastHeadRightX=${formatDebugCoord(lastHeadRightX)}`,
          `lastVisualRightX=${formatDebugCoord(lastVisualLayout?.rightX)}`,
          `lastSpacingRightX=${formatDebugCoord(lastVisualLayout?.spacingRightX)}`,
          `measureEndBarX=${formatDebugCoord(measureEndBarX)}`,
          `noteRightLimitX=${formatDebugCoord(noteRightLimitX)}`,
          `headDelta=${formatDebugCoord(headDelta)}`,
          `barlineHeadDelta=${formatDebugCoord(barlineHeadDelta)}`,
          `visualDelta=${formatDebugCoord(visualDelta)}`,
          `spacingDelta=${formatDebugCoord(spacingDelta)}`,
          `guardDelta=${formatDebugCoord(guardDelta)}`,
          `overflow=${hasVisualOverflow ? 'YES' : 'NO'}`,
        ].join(' '),
      )
    })

    lines.splice(4, 0, `renderedOverflowCount(visualDelta>0): ${overflowCount}`)
    const report = lines.join('\n')
    setMeasureEdgeDebugReport(report)
    console.log(report)
  }
  const clearMeasureEdgeDebugReport = () => {
    setMeasureEdgeDebugReport('')
  }

  const dumpAllMeasureCoordinateReport = useCallback(() => {
    const measureLayouts = measureLayoutsRef.current
    const noteLayoutsByPair = noteLayoutsByPairRef.current
    const pairs = measurePairsRef.current
    const toRoundedNumber = (value: number | null | undefined, digits: number): number | null => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      return Number(value.toFixed(digits))
    }
    const buildOnsetTicksByNoteIndex = (staffNotes: ScoreNote[]): number[] => {
      const onsetTicks: number[] = []
      let cursor = 0
      staffNotes.forEach((note) => {
        onsetTicks.push(cursor)
        const ticks = DURATION_TICKS[note.duration]
        const safeTicks = Number.isFinite(ticks) ? Math.max(1, ticks) : TICKS_PER_BEAT
        cursor += safeTicks
      })
      return onsetTicks
    }
    const rows = pairs.map((pair, pairIndex) => {
      const measureLayout = measureLayouts.get(pairIndex) ?? null
      const pairLayouts = noteLayoutsByPair.get(pairIndex) ?? []
      const trebleOnsetTicksByIndex = buildOnsetTicksByNoteIndex(pair.treble)
      const bassOnsetTicksByIndex = buildOnsetTicksByNoteIndex(pair.bass)
      const axisPointBuckets = new Map<
        number,
        { xTotal: number; xCount: number; trebleNoteCount: number; bassNoteCount: number }
      >()
      pairLayouts.forEach((layout) => {
        const onsetTicks =
          layout.staff === 'treble'
            ? (trebleOnsetTicksByIndex[layout.noteIndex] ?? null)
            : (bassOnsetTicksByIndex[layout.noteIndex] ?? null)
        if (typeof onsetTicks !== 'number' || !Number.isFinite(onsetTicks)) return
        const bucket = axisPointBuckets.get(onsetTicks) ?? {
          xTotal: 0,
          xCount: 0,
          trebleNoteCount: 0,
          bassNoteCount: 0,
        }
        if (Number.isFinite(layout.x)) {
          bucket.xTotal += layout.x
          bucket.xCount += 1
        }
        if (layout.staff === 'treble') {
          bucket.trebleNoteCount += 1
        } else {
          bucket.bassNoteCount += 1
        }
        axisPointBuckets.set(onsetTicks, bucket)
      })
      const orderedOnsets = [...axisPointBuckets.keys()].sort((left, right) => left - right)
      const timeAxisPointIndexByOnset = new Map<number, number>()
      const timeAxisPointXByOnset = new Map<number, number | null>()
      const timeAxisPoints = orderedOnsets.map((onsetTicks, pointIndex) => {
        const bucket = axisPointBuckets.get(onsetTicks)
        const averagedX =
          bucket && bucket.xCount > 0 ? toRoundedNumber(bucket.xTotal / bucket.xCount, 3) : null
        timeAxisPointIndexByOnset.set(onsetTicks, pointIndex)
        timeAxisPointXByOnset.set(onsetTicks, averagedX)
        const trebleNoteCount = bucket?.trebleNoteCount ?? 0
        const bassNoteCount = bucket?.bassNoteCount ?? 0
        return {
          pointIndex,
          onsetTicksInMeasure: onsetTicks,
          onsetBeatsInMeasure: toRoundedNumber(onsetTicks / TICKS_PER_BEAT, 4),
          x: averagedX,
          noteCount: trebleNoteCount + bassNoteCount,
          trebleNoteCount,
          bassNoteCount,
        }
      })
      const layoutRows = pairLayouts
        .slice()
        .sort((left, right) => {
          if (left.staff !== right.staff) return left.staff.localeCompare(right.staff)
          if (left.noteIndex !== right.noteIndex) return left.noteIndex - right.noteIndex
          return left.x - right.x
        })
        .map((layout) => {
          const sourceNote = layout.staff === 'treble' ? pair.treble[layout.noteIndex] : pair.bass[layout.noteIndex]
          const onsetTicksInMeasure =
            sourceNote && layout.staff === 'treble'
              ? (trebleOnsetTicksByIndex[layout.noteIndex] ?? null)
              : sourceNote
                ? (bassOnsetTicksByIndex[layout.noteIndex] ?? null)
                : null
          return {
            staff: layout.staff,
            noteId: layout.id,
            noteIndex: layout.noteIndex,
            pitch: sourceNote?.pitch ?? null,
            duration: sourceNote?.duration ?? null,
            durationTicksInMeasure:
              sourceNote && Number.isFinite(DURATION_TICKS[sourceNote.duration])
                ? DURATION_TICKS[sourceNote.duration]
                : null,
            onsetTicksInMeasure:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? onsetTicksInMeasure
                : null,
            onsetBeatsInMeasure:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? toRoundedNumber(onsetTicksInMeasure / TICKS_PER_BEAT, 4)
                : null,
            timeAxisPointIndex:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? (timeAxisPointIndexByOnset.get(onsetTicksInMeasure) ?? null)
                : null,
            timeAxisPointX:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? (timeAxisPointXByOnset.get(onsetTicksInMeasure) ?? null)
                : null,
            x: layout.x,
            rightX: layout.rightX,
            spacingRightX: layout.spacingRightX,
            noteHeads: layout.noteHeads.map((head) => ({
              keyIndex: head.keyIndex,
              pitch: head.pitch,
              x: head.x,
              y: head.y,
            })),
            accidentalCoords: Object.entries(layout.accidentalRightXByKeyIndex)
              .map(([rawKeyIndex, rightX]) => ({
                keyIndex: Number(rawKeyIndex),
                rightX,
              }))
              .filter((entry) => Number.isFinite(entry.keyIndex) && Number.isFinite(entry.rightX))
              .sort((left, right) => left.keyIndex - right.keyIndex),
          }
        })

      const maxVisualRightX =
        layoutRows.length > 0 ? layoutRows.reduce((maxX, row) => Math.max(maxX, row.rightX), Number.NEGATIVE_INFINITY) : null
      const maxSpacingRightX =
        layoutRows.length > 0
          ? layoutRows.reduce((maxX, row) => Math.max(maxX, row.spacingRightX), Number.NEGATIVE_INFINITY)
          : null

      return {
        pairIndex,
        rendered: measureLayout !== null,
        measureX: measureLayout?.measureX ?? null,
        measureWidth: measureLayout?.measureWidth ?? null,
        systemTop: measureLayout?.systemTop ?? null,
        trebleY: measureLayout?.trebleY ?? null,
        bassY: measureLayout?.bassY ?? null,
        measureStartBarX: measureLayout?.measureX ?? null,
        measureEndBarX: measureLayout ? measureLayout.measureX + measureLayout.measureWidth : null,
        noteStartX: measureLayout?.noteStartX ?? null,
        noteEndX: measureLayout?.noteEndX ?? null,
        timeAxisTicksPerBeat: TICKS_PER_BEAT,
        timeAxisPoints,
        maxVisualRightX,
        maxSpacingRightX,
        overflowVsNoteEndX:
          measureLayout && typeof maxSpacingRightX === 'number'
            ? Number((maxSpacingRightX - measureLayout.noteEndX).toFixed(3))
            : null,
        overflowVsMeasureEndBarX:
          measureLayout && typeof maxSpacingRightX === 'number'
            ? Number((maxSpacingRightX - (measureLayout.measureX + measureLayout.measureWidth)).toFixed(3))
            : null,
        notes: layoutRows,
      }
    })

    return {
      generatedAt: new Date().toISOString(),
      totalMeasureCount: pairs.length,
      renderedMeasureCount: rows.filter((row) => row.rendered).length,
      visibleSystemRange: { ...visibleSystemRange },
      rows,
    }
  }, [visibleSystemRange])

  const dumpOsmdPreviewSystemMetrics = useCallback(() => {
    const osmd = osmdPreviewInstanceRef.current
    if (!osmd) {
      return {
        hasPreview: false,
        pageCount: 0,
        pages: [] as Array<{
          pageIndex: number
          pageHeight: number | null
          pageHeightRaw: number | null
          bottomGap: number | null
          bottomGapRaw: number | null
          systemCount: number
          systemY: number[]
          systemHeights: number[]
        }>,
      }
    }
    const pages = osmd.GraphicSheet?.MusicPages ?? []
    const rulePageHeight = osmd.EngravingRules?.PageHeight
    const hasRulePageHeight =
      typeof rulePageHeight === 'number' && Number.isFinite(rulePageHeight) && rulePageHeight > 0
    const referencePageHeight = pages.reduce((maxHeight, page) => {
      const candidate = page.PositionAndShape?.Size?.height
      if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
        return maxHeight
      }
      return Math.max(maxHeight, candidate)
    }, 0)
    const normalizedPageHeight = hasRulePageHeight
      ? rulePageHeight
      : referencePageHeight > 0
        ? referencePageHeight
        : null
    return {
      hasPreview: true,
      pageCount: pages.length,
      pages: pages.map((page, pageIndex) => {
        const systems = page.MusicSystems ?? []
        const rawPageHeight =
          typeof page.PositionAndShape?.Size?.height === 'number' && Number.isFinite(page.PositionAndShape.Size.height)
            ? Number(page.PositionAndShape.Size.height.toFixed(3))
            : null
        const lastSystemBottom =
          systems.length > 0
            ? (systems[systems.length - 1].PositionAndShape?.RelativePosition?.y ?? 0) +
              (systems[systems.length - 1].PositionAndShape?.Size?.height ?? 0)
            : null
        return {
          pageIndex,
          pageHeight: normalizedPageHeight !== null ? Number(normalizedPageHeight.toFixed(3)) : rawPageHeight,
          pageHeightRaw: rawPageHeight,
          bottomGap:
            normalizedPageHeight !== null && typeof lastSystemBottom === 'number' && Number.isFinite(lastSystemBottom)
              ? Number(
                  (
                    normalizedPageHeight -
                    lastSystemBottom
                  ).toFixed(3),
                )
              : null,
          bottomGapRaw:
            rawPageHeight !== null && typeof lastSystemBottom === 'number' && Number.isFinite(lastSystemBottom)
              ? Number((rawPageHeight - lastSystemBottom).toFixed(3))
              : null,
          systemCount: systems.length,
          systemY: systems.map((system) => {
            const y = system.PositionAndShape?.RelativePosition?.y
            return typeof y === 'number' && Number.isFinite(y) ? Number(y.toFixed(3)) : NaN
          }),
          systemHeights: systems.map((system) => {
            const h = system.PositionAndShape?.Size?.height
            return typeof h === 'number' && Number.isFinite(h) ? Number(h.toFixed(3)) : NaN
          }),
        }
      }),
    }
  }, [])

  useEffect(() => {
    return () => {
      if (firstMeasureDebugRafRef.current !== null) {
        window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const debugApi = {
      importMusicXmlText: (xmlText: string) => {
        importMusicXmlText(xmlText)
      },
      getImportFeedback: () => importFeedbackRef.current,
      getScaleConfig: () => ({
        autoScaleEnabled,
        manualScalePercent: safeManualScalePercent,
        baseScoreScale,
        scoreScale,
        scoreScaleX,
        scoreScaleY,
        isHorizontalView: true,
        spacingLayoutMode,
      }),
      setAutoScaleEnabled: (enabled: boolean) => {
        setAutoScaleEnabled(Boolean(enabled))
      },
      setManualScalePercent: (nextPercent: number) => {
        setManualScalePercent(clampScalePercent(nextPercent))
      },
      dumpAllMeasureCoordinates: () => dumpAllMeasureCoordinateReport(),
      getOsmdPreviewSystemMetrics: () => dumpOsmdPreviewSystemMetrics(),
      getOsmdPreviewRebalanceStats: () => osmdPreviewLastRebalanceStatsRef.current,
      getOsmdPreviewInstance: () => osmdPreviewInstanceRef.current,
      getDragPreviewFrames: () =>
        dragDebugFramesRef.current.map((frame) => ({
          ...frame,
          rows: frame.rows.map((row) => ({ ...row })),
        })),
      getDragSessionState: () => {
        const drag = dragRef.current
        if (!drag) return null
        return {
          noteId: drag.noteId,
          staff: drag.staff,
          keyIndex: drag.keyIndex,
          pairIndex: drag.pairIndex,
          noteIndex: drag.noteIndex,
          pitch: drag.pitch,
          previewStarted: drag.previewStarted,
        }
      },
      getOverlayDebugInfo: () => {
        const overlay = scoreOverlayRef.current
        const surface = scoreRef.current
        if (!overlay || !surface) return null
        const overlayClientRect = overlay.getBoundingClientRect()
        const surfaceClientRect = surface.getBoundingClientRect()
        return {
          scoreScale,
          overlayRectInScore: overlayLastRectRef.current
            ? { ...overlayLastRectRef.current }
            : null,
          overlayElement: {
            width: overlay.width,
            height: overlay.height,
            styleLeft: overlay.style.left,
            styleTop: overlay.style.top,
            styleWidth: overlay.style.width,
            styleHeight: overlay.style.height,
            display: overlay.style.display,
          },
          overlayClientRect: {
            left: overlayClientRect.left,
            top: overlayClientRect.top,
            width: overlayClientRect.width,
            height: overlayClientRect.height,
          },
          surfaceElement: {
            width: surface.width,
            height: surface.height,
          },
          surfaceClientRect: {
            left: surfaceClientRect.left,
            top: surfaceClientRect.top,
            width: surfaceClientRect.width,
            height: surfaceClientRect.height,
          },
        }
      },
      getPaging: () => ({
        currentPage: safeCurrentPage,
        pageCount,
        systemsPerPage,
        visibleSystemRange: { ...visibleSystemRange },
      }),
      getActiveSelection: () => ({ ...activeSelection }),
      getOsmdPreviewSelectedSelectionKey: () => osmdPreviewSelectedSelectionKeyRef.current,
      getOsmdPreviewNoteTargets: () =>
        [...osmdPreviewNoteLookupBySelectionRef.current.values()].map((target) => ({
          pairIndex: target.pairIndex,
          measureNumber: target.measureNumber,
          onsetTicks: target.onsetTicks,
          domIds: [...target.domIds],
          selection: { ...target.selection },
        })),
    }
    ;(window as unknown as { __scoreDebug?: typeof debugApi }).__scoreDebug = debugApi
    return () => {
      delete (window as unknown as { __scoreDebug?: typeof debugApi }).__scoreDebug
    }
  }, [
    importMusicXmlText,
    dumpAllMeasureCoordinateReport,
    dumpOsmdPreviewSystemMetrics,
    pageCount,
    safeCurrentPage,
    safeManualScalePercent,
    autoScaleEnabled,
    baseScoreScale,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    spacingLayoutMode,
    dragDebugFramesRef,
    dragRef,
    scoreOverlayRef,
    scoreRef,
    overlayLastRectRef,
    osmdPreviewLastRebalanceStatsRef,
    systemsPerPage,
    visibleSystemRange,
    activeSelection,
  ])

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">交互式乐谱原型版</p>
        <h1>实时五线谱预览 + 拖拽编辑</h1>
        <p className="subtitle">
          A4 样式乐谱页面，自动跨小节换行。可导入乐谱文件，并在高音/低音谱表中拖拽音符。
        </p>
      </section>

      <ScoreControls
        isPlaying={isPlaying}
        onPlayScore={playScore}
        onReset={resetScore}
        autoScaleEnabled={autoScaleEnabled}
        autoScalePercent={autoScalePercent}
        onToggleAutoScale={() => setAutoScaleEnabled((enabled) => !enabled)}
        manualScalePercent={safeManualScalePercent}
        onManualScalePercentChange={(nextPercent) => setManualScalePercent(clampScalePercent(nextPercent))}
        canvasHeightPercent={safeCanvasHeightPercent}
        onCanvasHeightPercentChange={(nextPercent) => setCanvasHeightPercent(clampCanvasHeightPercent(nextPercent))}
        pageHorizontalPaddingPx={pageHorizontalPaddingPx}
        baseMinGap32Px={timeAxisSpacingConfig.baseMinGap32Px}
        minBarlineEdgeGapPx={timeAxisSpacingConfig.minBarlineEdgeGapPx}
        maxBarlineEdgeGapPx={timeAxisSpacingConfig.maxBarlineEdgeGapPx}
        durationGapRatio32={timeAxisSpacingConfig.durationGapRatios.thirtySecond}
        durationGapRatio16={timeAxisSpacingConfig.durationGapRatios.sixteenth}
        durationGapRatio8={timeAxisSpacingConfig.durationGapRatios.eighth}
        durationGapRatio4={timeAxisSpacingConfig.durationGapRatios.quarter}
        durationGapRatio2={timeAxisSpacingConfig.durationGapRatios.half}
        onPageHorizontalPaddingPxChange={(nextValue) =>
          setPageHorizontalPaddingPx(clampPageHorizontalPaddingPx(nextValue))
        }
        onBaseMinGap32PxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            baseMinGap32Px: clampBaseMinGap32Px(nextValue),
          }))
        }
        onMaxBarlineEdgeGapPxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            maxBarlineEdgeGapPx: clampMaxBarlineEdgeGapPx(nextValue),
          }))
        }
        onMinBarlineEdgeGapPxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            minBarlineEdgeGapPx: clampMinBarlineEdgeGapPx(nextValue),
          }))
        }
        onDurationGapRatio32Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              thirtySecond: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio16Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              sixteenth: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio8Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              eighth: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio4Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              quarter: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio2Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              half: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onResetSpacingConfig={() => {
          setTimeAxisSpacingConfig({
            ...DEFAULT_TIME_AXIS_SPACING_CONFIG,
            durationGapRatios: { ...DEFAULT_TIME_AXIS_SPACING_CONFIG.durationGapRatios },
          })
          setHorizontalMeasureWidthOverrides({})
          setPageHorizontalPaddingPx(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
        }}
        onOpenMusicXmlFilePicker={openMusicXmlFilePicker}
        onLoadSampleMusicXml={loadSampleMusicXml}
        onExportMusicXmlFile={exportMusicXmlFile}
        onOpenOsmdPreview={openOsmdPreview}
        onImportMusicXmlFromTextarea={importMusicXmlFromTextarea}
        fileInputRef={fileInputRef}
        onMusicXmlFileChange={onMusicXmlFileChange}
        importFeedback={importFeedback}
        rhythmPreset={rhythmPreset}
        onApplyRhythmPreset={applyRhythmPreset}
      />

      <ScoreBoard
        scoreScrollRef={scoreScrollRef}
        displayScoreWidth={displayScoreWidth}
        displayScoreHeight={displayScoreHeight}
        scoreScaleX={scoreScaleX}
        scoreScaleY={scoreScaleY}
        scoreSurfaceOffsetXPx={scoreSurfaceOffsetXPx}
        scoreSurfaceOffsetYPx={scoreSurfaceOffsetYPx}
        measureRulerTicks={measureRulerTicks}
        draggingSelection={draggingSelection}
        scoreRef={scoreRef}
        scoreOverlayRef={scoreOverlayRef}
        onBeginDrag={onBeginDragWithFirstMeasureDebug}
        onSurfacePointerMove={onSurfacePointerMove}
        onEndDrag={onEndDragWithFirstMeasureDebug}
        selectedStaffLabel={activeSelection.staff === 'treble' ? '高音谱表' : '低音谱表'}
        selectedPitchLabel={currentSelectionPitchLabel}
        selectedDurationLabel={toDisplayDuration(currentSelection.duration)}
        selectedPosition={currentSelectionPosition}
        selectedPoolSize={activePool.length}
        trebleSequenceText={trebleSequenceText}
        bassSequenceText={bassSequenceText}
        dragDebugReport={dragDebugReport}
        onDumpDragLog={dumpDragDebugReport}
        onClearDragLog={clearDragDebugReport}
        measureEdgeDebugReport={measureEdgeDebugReport}
        onDumpMeasureEdgeLog={dumpMeasureEdgeDebugReport}
        onClearMeasureEdgeLog={clearMeasureEdgeDebugReport}
      />

      {isImportLoading && (
        <div className="import-modal" role="status" aria-live="polite" aria-label="导入进行中">
          <div className="import-modal-card">
            <h3>正在加载乐谱</h3>
            <p>{importFeedback.message}</p>
            <div className="import-modal-track">
              <div
                className="import-modal-bar"
                style={{ width: `${importProgressPercent === null ? 45 : Math.max(4, importProgressPercent)}%` }}
              />
            </div>
            <p className="import-modal-percent">
              {importProgressPercent === null ? '处理中...' : `${importProgressPercent}%`}
            </p>
          </div>
        </div>
      )}

      {isOsmdPreviewOpen && (
        <div className="osmd-preview-modal" role="dialog" aria-modal="true" aria-label="OSMD预览" onClick={closeOsmdPreview}>
          <div className="osmd-preview-card" onClick={(event) => event.stopPropagation()}>
            <div className="osmd-preview-header">
              <h3>OSMD预览</h3>
              <div className="osmd-preview-header-actions">
                <button
                  type="button"
                  onClick={exportOsmdPreviewPdf}
                  disabled={isOsmdPreviewExportingPdf}
                >
                  {isOsmdPreviewExportingPdf ? '导出中...' : '导出PDF'}
                </button>
                <button type="button" onClick={closeOsmdPreview} disabled={isOsmdPreviewExportingPdf}>关闭</button>
              </div>
            </div>
            <div className="osmd-preview-side">
              <div className="osmd-preview-pagination">
                <button type="button" onClick={goToPrevOsmdPreviewPage} disabled={osmdPreviewPageIndex <= 0}>
                  上一页
                </button>
                <span>{`${Math.min(osmdPreviewPageCount, osmdPreviewPageIndex + 1)} / ${osmdPreviewPageCount}`}</span>
                <button
                  type="button"
                  onClick={goToNextOsmdPreviewPage}
                  disabled={osmdPreviewPageIndex >= osmdPreviewPageCount - 1}
                >
                  下一页
                </button>
              </div>
              <div className="osmd-preview-toggle">
                <label htmlFor="osmd-preview-page-number-toggle">页码</label>
                <input
                  id="osmd-preview-page-number-toggle"
                  type="checkbox"
                  checked={osmdPreviewShowPageNumbers}
                  onChange={(event) => onOsmdPreviewShowPageNumbersChange(event.target.checked)}
                />
                <span>{osmdPreviewShowPageNumbers ? '显示' : '隐藏'}</span>
              </div>
            <div className="osmd-preview-zoom">
              <label htmlFor="osmd-preview-zoom-range">音符缩放</label>
              <input
                id="osmd-preview-zoom-range"
                type="range"
                min={35}
                max={160}
                step={1}
                value={osmdPreviewZoomDraftPercent}
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
                value={osmdPreviewZoomDraftPercent}
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
                value={safeOsmdPreviewPaperScalePercent}
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
                value={safeOsmdPreviewPaperScalePercent}
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
                value={safeOsmdPreviewHorizontalMarginPx}
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
                value={safeOsmdPreviewHorizontalMarginPx}
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
                value={safeOsmdPreviewFirstPageTopMarginPx}
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
                value={safeOsmdPreviewFirstPageTopMarginPx}
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
                value={safeOsmdPreviewTopMarginPx}
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
                value={safeOsmdPreviewTopMarginPx}
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
                  value={safeOsmdPreviewBottomMarginPx}
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
                  value={safeOsmdPreviewBottomMarginPx}
                  onInput={(event) =>
                    onOsmdPreviewBottomMarginPxChange(Number((event.target as HTMLInputElement).value))
                  }
                  onChange={(event) => onOsmdPreviewBottomMarginPxChange(Number(event.target.value))}
                />
                <span>px</span>
              </div>
              {osmdPreviewStatusText && <p className="osmd-preview-status">{osmdPreviewStatusText}</p>}
              {osmdPreviewError && <p className="osmd-preview-error">{osmdPreviewError}</p>}
            </div>
            <div className="osmd-preview-body osmd-preview-main-body">
              <div
                className="osmd-preview-paper-frame"
                style={{
                  width: `${osmdPreviewPaperWidthPx}px`,
                  height: `${osmdPreviewPaperHeightPx}px`,
                }}
              >
                <div
                  ref={osmdPreviewContainerRef}
                  className="osmd-preview-surface"
                  onClick={onOsmdPreviewSurfaceClick}
                  onDoubleClick={onOsmdPreviewSurfaceDoubleClick}
                  style={{
                    width: `${A4_PAGE_WIDTH}px`,
                    height: `${A4_PAGE_HEIGHT}px`,
                    transform: `scale(${osmdPreviewPaperScale})`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App

