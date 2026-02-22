import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  SYSTEM_GAP_Y,
  SYSTEM_HEIGHT,
  TICKS_PER_BEAT,
} from './score/constants'
import {
  buildAdaptiveSystemRanges,
  estimateAdaptiveMeasureWidth,
  getMeasureLayoutDemandFromNoteDemand,
  getMeasureNoteLayoutDemand,
  toDisplayDuration,
} from './score/layout/demand'
import { DEFAULT_TIME_AXIS_SPACING_CONFIG } from './score/layout/timeAxisSpacing'
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
} from './score/scoreOps'
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
const MANUAL_SCALE_BASELINE = 0.7
const DEFAULT_PAGE_HORIZONTAL_PADDING_PX = 86
const ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG = false
const HORIZONTAL_VIEW_MEASURE_WIDTH_PX = 220
const HORIZONTAL_VIEW_MEASURE_WIDTH_GAIN = 1.4
const HORIZONTAL_VIEW_MEASURE_EXTRA_SAFETY_PX = 72
const HORIZONTAL_VIEW_ACCIDENTAL_WIDTH_PX = 12
const HORIZONTAL_VIEW_MAX_ACCIDENTAL_BONUS_PX = 96
const HORIZONTAL_VIEW_HEIGHT_PX = SCORE_TOP_PADDING * 2 + SYSTEM_HEIGHT + 24
const MAX_CANVAS_RENDER_DIM_PX = 32760
const HORIZONTAL_RENDER_BUFFER_PX = 1200
const HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES = 1
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
const PDF_CJK_FONT_FAMILY = 'NotoSansSC'
const PDF_CJK_FONT_FILE_NAME = 'NotoSansSC-Regular.ttf'
const PDF_CJK_FONT_URL = new URL('./assets/fonts/NotoSansSC-Regular.ttf', import.meta.url).href

const PITCHES: Pitch[] = createPianoPitches()
const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)
let cachedPdfCjkFontBinary: string | null = null
let cachedPdfCjkFontLoadPromise: Promise<string> | null = null

function toSequencePreview(notes: ScoreNote[]): string {
  if (notes.length <= INSPECTOR_SEQUENCE_PREVIEW_LIMIT) {
    return notes.map((note) => toDisplayPitch(note.pitch)).join('  |  ')
  }
  const preview = notes.slice(0, INSPECTOR_SEQUENCE_PREVIEW_LIMIT).map((note) => toDisplayPitch(note.pitch)).join('  |  ')
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

function hasTimeSignatureChanged(current: TimeSignature, previous: TimeSignature): boolean {
  return current.beats !== previous.beats || current.beatType !== previous.beatType
}

function countAccidentalsForNote(note: ScoreNote): number {
  const chordAccidentals = note.chordAccidentals ?? []
  const chordCount = chordAccidentals.reduce((sum, accidental) => (accidental ? sum + 1 : sum), 0)
  return (note.accidental ? 1 : 0) + chordCount
}

function countAccidentalsForMeasure(measure: MeasurePair): number {
  const trebleCount = measure.treble.reduce((sum, note) => sum + countAccidentalsForNote(note), 0)
  const bassCount = measure.bass.reduce((sum, note) => sum + countAccidentalsForNote(note), 0)
  return trebleCount + bassCount
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
  const [currentPage, setCurrentPage] = useState(0)
  const [dragDebugReport, setDragDebugReport] = useState<string>('')
  const [measureEdgeDebugReport, setMeasureEdgeDebugReport] = useState<string>('')
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false)
  const [manualScalePercent, setManualScalePercent] = useState(100)
  const [isHorizontalView, setIsHorizontalView] = useState(false)
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
  const spacingLayoutMode: SpacingLayoutMode = isHorizontalView ? 'legacy' : 'custom'
  const horizontalRawMeasureWidths = useMemo(() => {
    if (!isHorizontalView) return []
    if (measurePairs.length === 0) return []

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
      const noteDemand = getMeasureNoteLayoutDemand(measure, {
        baseMinGap32Px: timeAxisSpacingConfig.baseMinGap32Px,
        durationGapRatios: timeAxisSpacingConfig.durationGapRatios,
      })
      const layoutDemand = getMeasureLayoutDemandFromNoteDemand(
        noteDemand,
        isSystemStart,
        showKeySignature,
        showTimeSignature,
        false,
      )
      const adaptiveWidth = estimateAdaptiveMeasureWidth(layoutDemand)
      const accidentalWidthBonus = Math.min(
        HORIZONTAL_VIEW_MAX_ACCIDENTAL_BONUS_PX,
        countAccidentalsForMeasure(measure) * HORIZONTAL_VIEW_ACCIDENTAL_WIDTH_PX,
      )
      const estimatedWidth = Math.max(
        HORIZONTAL_VIEW_MEASURE_WIDTH_PX,
        Math.round(
          adaptiveWidth * HORIZONTAL_VIEW_MEASURE_WIDTH_GAIN +
            HORIZONTAL_VIEW_MEASURE_EXTRA_SAFETY_PX +
            accidentalWidthBonus,
        ),
      )
      widths.push(estimatedWidth)
      previousKeyFifths = keyFifths
      previousTimeSignature = timeSignature
    }

    return widths
  }, [
    isHorizontalView,
    measurePairs,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.durationGapRatios,
  ])
  const horizontalEstimatedMeasureWidthTotal = useMemo(() => {
    if (!isHorizontalView) return 0
    if (horizontalRawMeasureWidths.length === 0) return HORIZONTAL_VIEW_MEASURE_WIDTH_PX
    const total = horizontalRawMeasureWidths.reduce((sum, width) => sum + width, 0)
    return Math.max(HORIZONTAL_VIEW_MEASURE_WIDTH_PX, total)
  }, [isHorizontalView, horizontalRawMeasureWidths])
  const autoScoreScale = useMemo(() => getAutoScoreScale(measurePairs.length), [measurePairs.length])
  const safeManualScalePercent = clampScalePercent(manualScalePercent)
  const relativeScale = autoScaleEnabled ? autoScoreScale : safeManualScalePercent / 100
  const horizontalDisplayScale = relativeScale * MANUAL_SCALE_BASELINE
  const provisionalDisplayScoreHeight = isHorizontalView ? HORIZONTAL_VIEW_HEIGHT_PX : A4_PAGE_HEIGHT
  const displayScoreWidth = useMemo(() => {
    if (!isHorizontalView) return A4_PAGE_WIDTH
    const totalMeasureWidth = horizontalEstimatedMeasureWidthTotal
    const baseWidth = Math.max(A4_PAGE_WIDTH, pageHorizontalPaddingPx * 2 + totalMeasureWidth)
    // Keep horizontal display width in the same scale space as canvas transform.
    // Otherwise scroll-space and render-space drift apart and can leave blank tails.
    return Math.max(A4_PAGE_WIDTH, Math.round(baseWidth * horizontalDisplayScale))
  }, [isHorizontalView, horizontalEstimatedMeasureWidthTotal, pageHorizontalPaddingPx, horizontalDisplayScale])
  const baseScoreScale = relativeScale * MANUAL_SCALE_BASELINE
  const minScaleForCanvasHeight = provisionalDisplayScoreHeight / MAX_CANVAS_RENDER_DIM_PX
  const scoreScaleX = baseScoreScale
  const scoreScaleY = Math.max(baseScoreScale, minScaleForCanvasHeight)
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
    if (!isHorizontalView) return null
    if (horizontalRawMeasureWidths.length === 0) return [] as Array<{ measureX: number; measureWidth: number }>
    let cursorX = pageHorizontalPaddingPx
    return horizontalRawMeasureWidths.map((measureWidth) => {
      const frame = { measureX: cursorX, measureWidth }
      cursorX += measureWidth
      return frame
    })
  }, [isHorizontalView, horizontalRawMeasureWidths, pageHorizontalPaddingPx])
  const horizontalViewportWidthInScore = Math.max(1, horizontalViewportXRange.endX - horizontalViewportXRange.startX)
  const horizontalRenderSurfaceWidth = useMemo(() => {
    if (!isHorizontalView) return totalScoreWidth
    const desiredWidth = Math.ceil(horizontalViewportWidthInScore + HORIZONTAL_RENDER_BUFFER_PX * 2)
    const targetWidth = Math.max(1200, desiredWidth)
    return Math.max(1, Math.min(totalScoreWidth, Math.min(MAX_CANVAS_RENDER_DIM_PX, targetWidth)))
  }, [isHorizontalView, totalScoreWidth, horizontalViewportWidthInScore])
  const horizontalRenderOffsetX = useMemo(() => {
    if (!isHorizontalView) return 0
    const desiredOffset = Math.max(0, Math.floor(horizontalViewportXRange.startX - HORIZONTAL_RENDER_BUFFER_PX))
    const maxOffset = Math.max(0, totalScoreWidth - horizontalRenderSurfaceWidth)
    return Math.max(0, Math.min(maxOffset, desiredOffset))
  }, [
    isHorizontalView,
    horizontalViewportXRange.startX,
    totalScoreWidth,
    horizontalRenderSurfaceWidth,
  ])
  const scoreWidth = isHorizontalView ? horizontalRenderSurfaceWidth : totalScoreWidth
  const logicalSystemUsableWidth = Math.max(1, totalScoreWidth - pageHorizontalPaddingPx * 2)
  const systemRanges = useMemo(
    () => {
      if (isHorizontalView) {
        return [{ startPairIndex: 0, endPairIndexExclusive: measurePairs.length }]
      }
      return buildAdaptiveSystemRanges({
        measurePairs,
        systemUsableWidth: logicalSystemUsableWidth,
        measureKeyFifthsFromImport,
        measureTimeSignaturesFromImport,
        timeAxisSpacingConfig,
      })
    },
    [
      measurePairs,
      logicalSystemUsableWidth,
      isHorizontalView,
      pageHorizontalPaddingPx,
      measureKeyFifthsFromImport,
      measureTimeSignaturesFromImport,
      timeAxisSpacingConfig,
    ],
  )
  const systemCount = Math.max(1, systemRanges.length)
  const displayScoreHeight = useMemo(() => {
    if (isHorizontalView) return HORIZONTAL_VIEW_HEIGHT_PX
    return A4_PAGE_HEIGHT
  }, [isHorizontalView])
  const scoreHeight = Math.max(1, Math.round(displayScoreHeight / scoreScaleY))
  const systemsPerPage = Math.max(
    1,
    isHorizontalView
      ? 1
      : Math.floor((displayScoreHeight - SCORE_TOP_PADDING * 2 + SYSTEM_GAP_Y) / ((SYSTEM_HEIGHT + SYSTEM_GAP_Y) * scoreScale)),
  )
  const pageCount = Math.max(1, Math.ceil(systemCount / systemsPerPage))
  const safeCurrentPage = Math.min(currentPage, pageCount - 1)
  const visibleSystemRange = useMemo(() => {
    if (isHorizontalView) return { start: 0, end: 0 }
    const start = Math.min(systemCount - 1, safeCurrentPage * systemsPerPage)
    const end = Math.min(systemCount - 1, start + systemsPerPage - 1)
    return { start, end }
  }, [isHorizontalView, safeCurrentPage, systemCount, systemsPerPage])
  const horizontalRenderWindow = useMemo(() => {
    if (!isHorizontalView) return null
    const frames = horizontalMeasureFramesByPair ?? []
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
    isHorizontalView,
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    scoreWidth,
    totalScoreWidth,
  ])
  const layoutStabilityKey = useMemo(() => {
    const systemRangeKey = systemRanges.map((range) => `${range.startPairIndex}-${range.endPairIndexExclusive}`).join(',')
    const spacingKey = [
      timeAxisSpacingConfig.minGapBeats,
      timeAxisSpacingConfig.gapGamma,
      timeAxisSpacingConfig.gapBaseWeight,
      timeAxisSpacingConfig.leftEdgePaddingPx,
      timeAxisSpacingConfig.rightEdgePaddingPx,
      timeAxisSpacingConfig.interOnsetPaddingPx,
      timeAxisSpacingConfig.baseMinGap32Px,
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
    timeAxisSpacingConfig.minGapBeats,
    timeAxisSpacingConfig.gapGamma,
    timeAxisSpacingConfig.gapBaseWeight,
    timeAxisSpacingConfig.leftEdgePaddingPx,
    timeAxisSpacingConfig.rightEdgePaddingPx,
    timeAxisSpacingConfig.interOnsetPaddingPx,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.half,
    spacingLayoutMode,
  ])

  useEffect(() => {
    if (!isHorizontalView) return
    setCurrentPage(0)
  }, [isHorizontalView])

  useEffect(() => {
    if (!isHorizontalView) {
      setHorizontalViewportXRange({ startX: 0, endX: totalScoreWidth })
      return
    }
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) {
      setHorizontalViewportXRange({ startX: 0, endX: totalScoreWidth })
      return
    }

    let rafId: number | null = null
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

    const scheduleViewportUpdate = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        updateViewport()
      })
    }

    updateViewport()
    scrollHost.addEventListener('scroll', scheduleViewportUpdate, { passive: true })
    window.addEventListener('resize', scheduleViewportUpdate)

    return () => {
      scrollHost.removeEventListener('scroll', scheduleViewportUpdate)
      window.removeEventListener('resize', scheduleViewportUpdate)
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [isHorizontalView, scoreScaleX, totalScoreWidth, displayScoreWidth])

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
    visiblePairRange:
      isHorizontalView && horizontalRenderWindow
        ? {
          startPairIndex: horizontalRenderWindow.startPairIndex,
          endPairIndexExclusive: horizontalRenderWindow.endPairIndexExclusive,
        }
        : null,
    clearViewportXRange: null,
    measureFramesByPair: isHorizontalView ? horizontalMeasureFramesByPair : null,
    renderOffsetX: isHorizontalView ? horizontalRenderOffsetX : 0,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    activeSelection: null,
    draggingSelection: null,
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
  })

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
    runAiDraft,
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

  const activePool = activeSelection.staff === 'treble' ? notes : bassNotes
  const activePoolById = activeSelection.staff === 'treble' ? trebleNoteById : bassNoteById
  const activePoolIndexById = activeSelection.staff === 'treble' ? trebleNoteIndexById : bassNoteIndexById
  const currentSelection = activePoolById.get(activeSelection.noteId) ?? activePool[0] ?? notes[0]
  const currentSelectionPosition = (activePoolIndexById.get(currentSelection.id) ?? 0) + 1
  const currentSelectionPitch =
    activeSelection.keyIndex > 0
      ? currentSelection.chordPitches?.[activeSelection.keyIndex - 1] ?? currentSelection.pitch
      : currentSelection.pitch
  const trebleSequenceText = useMemo(() => toSequencePreview(notes), [notes])
  const bassSequenceText = useMemo(() => toSequencePreview(bassNotes), [bassNotes])
  const isImportLoading = importFeedback.kind === 'loading'
  const importProgressPercent =
    typeof importFeedback.progress === 'number' ? Math.max(0, Math.min(100, importFeedback.progress)) : null
  useEffect(() => {
    importFeedbackRef.current = importFeedback
  }, [importFeedback])
  const goToPrevPage = () => setCurrentPage((page) => Math.max(0, Math.min(page, pageCount - 1) - 1))
  const goToNextPage = () => setCurrentPage((page) => Math.min(pageCount - 1, Math.max(0, page) + 1))
  const goToPage = useCallback(
    (pageIndex: number) => setCurrentPage(Math.max(0, Math.min(pageCount - 1, pageIndex))),
    [pageCount],
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
  }, [])
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
        await osmd.load(osmdPreviewXml)
        if (canceled) return
        const previewInstance = osmd as unknown as OsmdPreviewInstance
        osmd.Zoom = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent) / 100
        osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
          previewInstance,
          osmdPreviewHorizontalMarginPxRef.current,
          osmdPreviewFirstPageTopMarginPxRef.current,
          osmdPreviewTopMarginPxRef.current,
          osmdPreviewBottomMarginPxRef.current,
        )
        if (canceled) return
        osmdPreviewInstanceRef.current = previewInstance
        const renderedPages = collectOsmdPreviewPages(container)
        osmdPreviewPagesRef.current = renderedPages
        applyOsmdPreviewPageNumbers(renderedPages, osmdPreviewShowPageNumbersRef.current)
        const graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
        const nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
        setOsmdPreviewPageCount(nextPageCount)
        applyOsmdPreviewPageVisibility(renderedPages, 0)
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
    }
  }, [isOsmdPreviewOpen, osmdPreviewXml])

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
  }, [isOsmdPreviewOpen, osmdPreviewZoomPercent])

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

  const scoreSurfaceOffsetXPx = isHorizontalView ? horizontalRenderOffsetX * scoreScaleX : 0
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
        isHorizontalView,
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
      goToPage: (pageIndex: number) => {
        goToPage(pageIndex)
      },
    }
    ;(window as unknown as { __scoreDebug?: typeof debugApi }).__scoreDebug = debugApi
    return () => {
      delete (window as unknown as { __scoreDebug?: typeof debugApi }).__scoreDebug
    }
  }, [
    importMusicXmlText,
    dumpAllMeasureCoordinateReport,
    dumpOsmdPreviewSystemMetrics,
    goToPage,
    pageCount,
    safeCurrentPage,
    safeManualScalePercent,
    autoScaleEnabled,
    baseScoreScale,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    isHorizontalView,
    spacingLayoutMode,
    dragDebugFramesRef,
    dragRef,
    scoreOverlayRef,
    scoreRef,
    overlayLastRectRef,
    osmdPreviewLastRebalanceStatsRef,
    systemsPerPage,
    visibleSystemRange,
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
        onRunAiDraft={runAiDraft}
        onReset={resetScore}
        isHorizontalView={isHorizontalView}
        onToggleHorizontalView={() => setIsHorizontalView((current) => !current)}
        autoScaleEnabled={autoScaleEnabled}
        autoScalePercent={autoScalePercent}
        onToggleAutoScale={() => setAutoScaleEnabled((enabled) => !enabled)}
        manualScalePercent={safeManualScalePercent}
        onManualScalePercentChange={(nextPercent) => setManualScalePercent(clampScalePercent(nextPercent))}
        spacingGapGamma={timeAxisSpacingConfig.gapGamma}
        spacingBaseWeight={timeAxisSpacingConfig.gapBaseWeight}
        spacingMinGapBeats={timeAxisSpacingConfig.minGapBeats}
        spacingLeftEdgePaddingPx={timeAxisSpacingConfig.leftEdgePaddingPx}
        spacingRightEdgePaddingPx={timeAxisSpacingConfig.rightEdgePaddingPx}
        pageHorizontalPaddingPx={pageHorizontalPaddingPx}
        baseMinGap32Px={timeAxisSpacingConfig.baseMinGap32Px}
        durationGapRatio32={timeAxisSpacingConfig.durationGapRatios.thirtySecond}
        durationGapRatio16={timeAxisSpacingConfig.durationGapRatios.sixteenth}
        durationGapRatio8={timeAxisSpacingConfig.durationGapRatios.eighth}
        durationGapRatio4={timeAxisSpacingConfig.durationGapRatios.quarter}
        durationGapRatio2={timeAxisSpacingConfig.durationGapRatios.half}
        onSpacingMinGapBeatsChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            minGapBeats: clampNumber(nextValue, 0.01, 0.25),
          }))
        }
        onSpacingGapGammaChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            gapGamma: clampNumber(nextValue, 0.55, 1),
          }))
        }
        onSpacingBaseWeightChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            gapBaseWeight: clampNumber(nextValue, 0.1, 1.2),
          }))
        }
        onSpacingLeftEdgePaddingPxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            leftEdgePaddingPx: Math.round(clampNumber(nextValue, 0, 24)),
          }))
        }
        onSpacingRightEdgePaddingPxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            rightEdgePaddingPx: Math.round(clampNumber(nextValue, 0, 24)),
          }))
        }
        onPageHorizontalPaddingPxChange={(nextValue) =>
          setPageHorizontalPaddingPx(clampPageHorizontalPaddingPx(nextValue))
        }
        onBaseMinGap32PxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            baseMinGap32Px: clampBaseMinGap32Px(nextValue),
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
          setPageHorizontalPaddingPx(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
        }}
        onOpenMusicXmlFilePicker={openMusicXmlFilePicker}
        onLoadSampleMusicXml={loadSampleMusicXml}
        onExportMusicXmlFile={exportMusicXmlFile}
        onOpenOsmdPreview={openOsmdPreview}
        onImportMusicXmlFromTextarea={importMusicXmlFromTextarea}
        fileInputRef={fileInputRef}
        onMusicXmlFileChange={onMusicXmlFileChange}
        musicXmlInput={musicXmlInput}
        onMusicXmlInputChange={setMusicXmlInput}
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
        isHorizontalView={isHorizontalView}
        currentPage={safeCurrentPage}
        pageCount={pageCount}
        onPrevPage={goToPrevPage}
        onNextPage={goToNextPage}
        onGoToPage={goToPage}
        draggingSelection={draggingSelection}
        scoreRef={scoreRef}
        scoreOverlayRef={scoreOverlayRef}
        onBeginDrag={onBeginDragWithFirstMeasureDebug}
        onSurfacePointerMove={onSurfacePointerMove}
        onEndDrag={onEndDragWithFirstMeasureDebug}
        selectedStaffLabel={activeSelection.staff === 'treble' ? '高音谱表' : '低音谱表'}
        selectedPitchLabel={toDisplayPitch(currentSelectionPitch)}
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
