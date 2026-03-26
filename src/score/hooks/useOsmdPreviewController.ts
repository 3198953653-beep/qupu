import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from 'react'
import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH, DURATION_TICKS, TICKS_PER_BEAT } from '../constants'
import { findSelectionLocationInPairs } from '../keyboardEdits'
import { getLayoutNoteKey } from '../layout/renderPosition'
import { buildMusicXmlExportPayload } from '../musicXmlActions'
import { getStepOctaveAlterFromPitch } from '../pitchMath'
import type {
  ImportedNoteLocation,
  MeasureFrame,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  Pitch,
  Selection,
  TimeSignature,
} from '../types'

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
const PDF_CJK_FONT_URL = new URL('../../assets/fonts/NotoSansSC-Regular.ttf', import.meta.url).href

type StateSetter<T> = Dispatch<SetStateAction<T>>

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
}
type OsmdPreviewEngravingRules = {
  PageHeight?: number
  PageTopMargin?: number
  PageBottomMargin?: number
  PageLeftMargin?: number
  PageRightMargin?: number
}
type OsmdPreviewDrawer = {
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
type OsmdPreviewSystemFrame = {
  system: OsmdPreviewMusicSystem
  y: number
  height: number
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

type MeasureStaffOnsetEntry = {
  noteIndex: number
  onsetTicks: number
  maxKeyIndex: number
}

type WebMidiPdfLike = {
  existsFileInVFS: (fileName: string) => boolean
  addFileToVFS: (fileName: string, binary: string) => void
  getFontList: () => Record<string, string[]>
  addFont: (
    fileName: string,
    familyName: string,
    fontStyle: string,
    fontWeight: string,
    encoding?: string,
  ) => void
}

let cachedPdfCjkFontBinary: string | null = null
let cachedPdfCjkFontLoadPromise: Promise<string> | null = null

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
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

function escapeCssId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id)
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}

function getSelectionKey(selection: Selection): string {
  return `${selection.staff}|${selection.noteId}|${selection.keyIndex}`
}

function buildMeasureStaffOnsetEntries(notes: MeasurePair['treble']): MeasureStaffOnsetEntry[] {
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
  return bestDelta <= 1 ? best : null
}

function sanitizeMusicXmlForOsmdPreview(xmlText: string, measurePairs: MeasurePair[]): string {
  const source = xmlText.trim()
  if (!source) return xmlText
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(source, 'application/xml')
    const parseError = doc.querySelector('parsererror')
    if (parseError) return xmlText

    const partElement = doc.getElementsByTagName('part')[0]
    if (!partElement) return xmlText

    const toNoteKey = (noteId: string, keyIndex: number): string => `${noteId}:${keyIndex}`
    const getDirectChildElements = (parent: Element, tagName: string): Element[] =>
      Array.from(parent.children).filter((child): child is Element => child.tagName === tagName)
    const getStaffNumber = (noteElement: Element): number => {
      const staffElement = getDirectChildElements(noteElement, 'staff')[0]
      if (!staffElement) return 1
      const value = Number.parseInt(staffElement.textContent ?? '1', 10)
      if (!Number.isFinite(value)) return 1
      return value
    }

    const noteElementByKey = new Map<string, Element>()
    const measureElements = Array.from(partElement.getElementsByTagName('measure'))
    const measureCount = Math.min(measureElements.length, measurePairs.length)
    for (let pairIndex = 0; pairIndex < measureCount; pairIndex += 1) {
      const pair = measurePairs[pairIndex]
      const measureElement = measureElements[pairIndex]
      if (!pair || !measureElement) continue
      const measureNotes = getDirectChildElements(measureElement, 'note')
      const trebleElements = measureNotes.filter((noteElement) => getStaffNumber(noteElement) === 1)
      const bassElements = measureNotes.filter((noteElement) => getStaffNumber(noteElement) === 2)

      const assignStaffElements = (staffNotes: MeasurePair['treble'], staffElements: Element[]) => {
        let cursor = 0
        staffNotes.forEach((staffNote) => {
          const keyCount = 1 + (staffNote.chordPitches?.length ?? 0)
          for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
            const noteElement = staffElements[cursor]
            cursor += 1
            if (!noteElement) return
            noteElementByKey.set(toNoteKey(staffNote.id, keyIndex), noteElement)
          }
        })
      }

      assignStaffElements(pair.treble, trebleElements)
      assignStaffElements(pair.bass, bassElements)
    }

    const setPitchOnNoteElement = (noteElement: Element, pitch: Pitch): void => {
      getDirectChildElements(noteElement, 'rest').forEach((restElement) => {
        noteElement.removeChild(restElement)
      })
      let pitchElement = getDirectChildElements(noteElement, 'pitch')[0]
      if (!pitchElement) {
        pitchElement = doc.createElement('pitch')
        const firstElementChild = noteElement.firstElementChild
        if (firstElementChild) {
          noteElement.insertBefore(pitchElement, firstElementChild.nextSibling)
        } else {
          noteElement.appendChild(pitchElement)
        }
      }
      while (pitchElement.firstChild) {
        pitchElement.removeChild(pitchElement.firstChild)
      }
      const { step, alter, octave } = getStepOctaveAlterFromPitch(pitch)
      const stepElement = doc.createElement('step')
      stepElement.textContent = step
      pitchElement.appendChild(stepElement)
      if (alter !== 0) {
        const alterElement = doc.createElement('alter')
        alterElement.textContent = String(alter)
        pitchElement.appendChild(alterElement)
      }
      const octaveElement = doc.createElement('octave')
      octaveElement.textContent = String(octave)
      pitchElement.appendChild(octaveElement)
    }

    measurePairs.forEach((pair) => {
      ;(['treble', 'bass'] as const).forEach((staff) => {
        const staffNotes = staff === 'treble' ? pair.treble : pair.bass
        staffNotes.forEach((staffNote) => {
          if (staffNote.isRest) return
          const rootElement = noteElementByKey.get(toNoteKey(staffNote.id, 0))
          if (rootElement) {
            setPitchOnNoteElement(rootElement, staffNote.pitch)
          }
          staffNote.chordPitches?.forEach((pitch, chordIndex) => {
            const chordElement = noteElementByKey.get(toNoteKey(staffNote.id, chordIndex + 1))
            if (chordElement) {
              setPitchOnNoteElement(chordElement, pitch)
            }
          })
        })
      })
    })

    return new XMLSerializer().serializeToString(doc)
  } catch {
    return xmlText
  }
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

function ensurePdfCjkFontRegistered(pdf: WebMidiPdfLike): void {
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
    const y = Math.max(28, A4_PAGE_HEIGHT - 18)
    const text = existing instanceof SVGTextElement ? existing : document.createElementNS(svgNamespace, 'text')
    text.setAttribute('class', 'osmd-preview-page-number-overlay')
    text.setAttribute('x', x.toFixed(1))
    text.setAttribute('y', y.toFixed(1))
    text.setAttribute('font-size', '12')
    text.setAttribute('font-family', 'Times New Roman, serif')
    text.setAttribute('text-anchor', isEvenPage ? 'start' : 'end')
    text.textContent = String(pageNumber)
    if (!(existing instanceof SVGTextElement)) {
      svg.appendChild(text)
    }
  })
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
    const heights = frames.map((frame) => frame.height)
    const sourceGaps = frames.slice(0, -1).map((frame, index) => {
      const next = frames[index + 1]
      return Math.max(0, next.y - (frame.y + heights[index]))
    })
    const sourceGapSum = sourceGaps.reduce((sum, gap) => sum + gap, 0)
    const targetTop = pageIndex === 0 ? safeFirstPageTopMarginPx : safeFollowingPageTopMarginPx
    const gapCount = sourceGaps.length
    const minGapTotal = gapCount * OSMD_PREVIEW_MIN_SYSTEM_GAP_PX
    const heightSum = heights.reduce((sum, height) => sum + height, 0)
    const maxFeasibleTop = Math.max(0, normalizedPageHeightUnits - safeBottomMarginPx - (heightSum + minGapTotal))
    const appliedTop = Math.min(targetTop, maxFeasibleTop)
    const availableSpan = Math.max(0, normalizedPageHeightUnits - appliedTop - safeBottomMarginPx)
    const minRequiredSpan = heightSum + minGapTotal
    const topShortfall = Math.max(0, targetTop - appliedTop)
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
    let pageMutated = 0
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

    const lastFrame = frames[frames.length - 1]
    const lastFrameY = lastFrame.system.PositionAndShape?.RelativePosition?.y
    const bottomGapAfter =
      typeof lastFrameY === 'number' && Number.isFinite(lastFrameY)
        ? Number((normalizedPageHeightUnits - (lastFrameY + lastFrame.height)).toFixed(3))
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
      drawSheet?: (sheet?: OsmdPreviewGraphicalSheet) => void
    }
    if (Array.isArray(drawer.Backends) && drawer.Backends.length > 0) {
      drawer.Backends.forEach((backend) => backend.clear?.())
    } else if (drawer.backend?.clear) {
      drawer.backend.clear()
    } else if (drawer.clear) {
      drawer.clear()
    }
    drawer.drawSheet?.(sheet)
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

function applyOsmdPreviewHorizontalMargins(osmd: OsmdPreviewInstance, horizontalMarginPx: number): void {
  const rules = osmd.EngravingRules
  if (!rules) return
  const safeMarginPx = clampOsmdPreviewHorizontalMarginPx(horizontalMarginPx)
  rules.PageLeftMargin = safeMarginPx
  rules.PageRightMargin = safeMarginPx
}

function applyOsmdPreviewVerticalMargins(osmd: OsmdPreviewInstance, topMarginPx: number, bottomMarginPx: number): void {
  const rules = osmd.EngravingRules
  if (!rules) return
  rules.PageTopMargin = clampOsmdPreviewTopMarginPx(topMarginPx)
  rules.PageBottomMargin = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
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

export function useOsmdPreviewController(params: {
  measurePairs: MeasurePair[]
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  musicXmlMetadataFromImportRef: MutableRefObject<MusicXmlMetadata | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  horizontalMeasureFramesByPair: MeasureFrame[]
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  noteLayoutByKeyRef: MutableRefObject<Map<string, NoteLayout>>
  horizontalRenderOffsetXRef: MutableRefObject<number>
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  scoreScaleX: number
  setIsSelectionVisible: StateSetter<boolean>
  setActiveSelection: StateSetter<Selection>
  setSelectedSelections: StateSetter<Selection[]>
  setDraggingSelection: StateSetter<Selection | null>
  setSelectedMeasureScope: StateSetter<{ pairIndex: number; staff: Selection['staff'] } | null>
  clearActiveChordSelection: () => void
  resetMidiStepChain: () => void
}): {
  isOsmdPreviewOpen: boolean
  isOsmdPreviewExportingPdf: boolean
  osmdPreviewStatusText: string
  osmdPreviewError: string
  osmdPreviewPageIndex: number
  osmdPreviewPageCount: number
  osmdPreviewShowPageNumbers: boolean
  osmdPreviewZoomDraftPercent: number
  safeOsmdPreviewPaperScalePercent: number
  safeOsmdPreviewHorizontalMarginPx: number
  safeOsmdPreviewFirstPageTopMarginPx: number
  safeOsmdPreviewTopMarginPx: number
  safeOsmdPreviewBottomMarginPx: number
  osmdPreviewPaperScale: number
  osmdPreviewPaperWidthPx: number
  osmdPreviewPaperHeightPx: number
  osmdPreviewContainerRef: MutableRefObject<HTMLDivElement | null>
  osmdDirectFileInputRef: MutableRefObject<HTMLInputElement | null>
  osmdPreviewInstanceRef: MutableRefObject<OsmdPreviewInstance | null>
  osmdPreviewLastRebalanceStatsRef: MutableRefObject<OsmdPreviewRebalanceStats | null>
  osmdPreviewNoteLookupBySelectionRef: MutableRefObject<Map<string, OsmdPreviewSelectionTarget>>
  osmdPreviewSelectedSelectionKeyRef: MutableRefObject<string | null>
  closeOsmdPreview: () => void
  openOsmdPreview: () => void
  openDirectOsmdFilePicker: () => void
  onOsmdDirectFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  exportOsmdPreviewPdf: () => Promise<void>
  goToPrevOsmdPreviewPage: () => void
  goToNextOsmdPreviewPage: () => void
  commitOsmdPreviewZoomPercent: (nextValue: number) => void
  scheduleOsmdPreviewZoomPercentCommit: (nextValue: number) => void
  onOsmdPreviewPaperScalePercentChange: (nextValue: number) => void
  onOsmdPreviewHorizontalMarginPxChange: (nextValue: number) => void
  onOsmdPreviewFirstPageTopMarginPxChange: (nextValue: number) => void
  onOsmdPreviewTopMarginPxChange: (nextValue: number) => void
  onOsmdPreviewBottomMarginPxChange: (nextValue: number) => void
  onOsmdPreviewShowPageNumbersChange: (nextVisible: boolean) => void
  onOsmdPreviewSurfaceClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onOsmdPreviewSurfaceDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  dumpOsmdPreviewSystemMetrics: () => {
    hasPreview: boolean
    pageCount: number
    pages: Array<{
      pageIndex: number
      pageHeight: number | null
      pageHeightRaw: number | null
      bottomGap: number | null
      bottomGapRaw: number | null
      systemCount: number
      systemY: number[]
      systemHeights: number[]
    }>
  }
} {
  const {
    measurePairs,
    measurePairsRef,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    horizontalMeasureFramesByPair,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    scoreScrollRef,
    scoreScaleX,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setDraggingSelection,
    setSelectedMeasureScope,
    clearActiveChordSelection,
    resetMidiStepChain,
  } = params

  const [isOsmdPreviewOpen, setIsOsmdPreviewOpen] = useState(false)
  const [osmdPreviewSourceMode, setOsmdPreviewSourceMode] = useState<'editor' | 'direct-file'>('editor')
  const [osmdPreviewXml, setOsmdPreviewXml] = useState('')
  const [osmdPreviewStatusText, setOsmdPreviewStatusText] = useState('')
  const [osmdPreviewError, setOsmdPreviewError] = useState('')
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

  const osmdPreviewContainerRef = useRef<HTMLDivElement | null>(null)
  const osmdDirectFileInputRef = useRef<HTMLInputElement | null>(null)
  const osmdPreviewPagesRef = useRef<HTMLElement[]>([])
  const osmdPreviewInstanceRef = useRef<OsmdPreviewInstance | null>(null)
  const osmdPreviewNoteLookupByDomIdRef = useRef<Map<string, OsmdPreviewSelectionTarget>>(new Map())
  const osmdPreviewNoteLookupBySelectionRef = useRef<Map<string, OsmdPreviewSelectionTarget>>(new Map())
  const osmdPreviewSelectedSelectionKeyRef = useRef<string | null>(null)
  const osmdPreviewHorizontalMarginPxRef = useRef(DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX)
  const osmdPreviewFirstPageTopMarginPxRef = useRef(DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX)
  const osmdPreviewTopMarginPxRef = useRef(DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX)
  const osmdPreviewBottomMarginPxRef = useRef(DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX)
  const osmdPreviewShowPageNumbersRef = useRef(true)
  const osmdPreviewPageIndexRef = useRef(0)
  const osmdPreviewLastRebalanceStatsRef = useRef<OsmdPreviewRebalanceStats | null>(null)
  const osmdPreviewZoomCommitTimerRef = useRef<number | null>(null)
  const osmdPreviewMarginApplyTimerRef = useRef<number | null>(null)

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

  const closeOsmdPreview = useCallback(() => {
    if (osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
      osmdPreviewZoomCommitTimerRef.current = null
    }
    setIsOsmdPreviewOpen(false)
    setOsmdPreviewStatusText('')
    setOsmdPreviewError('')
    setOsmdPreviewSourceMode('editor')
    setOsmdPreviewPageIndex(0)
    setOsmdPreviewPageCount(1)
    osmdPreviewPagesRef.current = []
    osmdPreviewInstanceRef.current = null
    clearOsmdPreviewNoteHighlight()
    osmdPreviewNoteLookupByDomIdRef.current.clear()
    osmdPreviewNoteLookupBySelectionRef.current.clear()
    osmdPreviewSelectedSelectionKeyRef.current = null
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
                          measureListIndex?: number
                          MeasureListIndex?: number
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
    if (osmdPreviewSourceMode !== 'editor') {
      osmdPreviewNoteLookupByDomIdRef.current = lookupByDomId
      osmdPreviewNoteLookupBySelectionRef.current = lookupBySelection
      clearOsmdPreviewNoteHighlight()
      return
    }
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
                  const isRest =
                    sourceNote.isRestFlag === true ||
                    (typeof sourceNote.isRest === 'function' && sourceNote.isRest())
                  if (isRest) continue

                  const sourceMeasure = sourceNote.sourceMeasure
                  const graphicalMeasureAny = graphicalMeasure as {
                    parentSourceMeasure?: {
                      measureListIndex?: number
                      MeasureListIndex?: number
                      measureNumber?: number
                      MeasureNumber?: number
                    }
                    ParentSourceMeasure?: {
                      measureListIndex?: number
                      MeasureListIndex?: number
                      measureNumber?: number
                      MeasureNumber?: number
                    }
                    measureNumber?: number
                    MeasureNumber?: number
                  }
                  const parentSourceMeasure = graphicalMeasureAny.parentSourceMeasure ?? graphicalMeasureAny.ParentSourceMeasure
                  const measureListIndexRaw =
                    sourceMeasure?.measureListIndex ??
                    sourceMeasure?.MeasureListIndex ??
                    parentSourceMeasure?.measureListIndex ??
                    parentSourceMeasure?.MeasureListIndex
                  const measureNumberRaw =
                    sourceMeasure?.measureNumber ??
                    sourceMeasure?.MeasureNumber ??
                    parentSourceMeasure?.measureNumber ??
                    parentSourceMeasure?.MeasureNumber ??
                    graphicalMeasureAny.measureNumber ??
                    graphicalMeasureAny.MeasureNumber
                  const pairIndex =
                    typeof measureListIndexRaw === 'number' && Number.isFinite(measureListIndexRaw)
                      ? Math.max(0, Math.round(measureListIndexRaw))
                      : typeof measureNumberRaw === 'number' && Number.isFinite(measureNumberRaw)
                        ? Math.max(0, Math.round(measureNumberRaw) - 1)
                        : -1
                  if (pairIndex < 0) continue
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
  }, [applyOsmdPreviewNoteHighlight, clearOsmdPreviewNoteHighlight, measurePairs, osmdPreviewSourceMode])

  const resolveOsmdPreviewTargetFromEvent = useCallback((eventTarget: EventTarget | null): OsmdPreviewSelectionTarget | null => {
    const container = osmdPreviewContainerRef.current
    if (!container || !(eventTarget instanceof Element)) return null
    let current: Element | null = eventTarget
    while (current && current !== container) {
      const id = (current as HTMLElement).id
      if (id) {
        const lookup = osmdPreviewNoteLookupByDomIdRef.current
        const target = lookup.get(id) ?? (id.startsWith('vf-') ? lookup.get(id.slice(3)) : lookup.get(`vf-${id}`))
        if (target) return target
      }
      current = current.parentElement
    }
    return null
  }, [])

  const jumpFromOsmdPreviewToEditor = useCallback((target: OsmdPreviewSelectionTarget) => {
    const { selection, pairIndex } = target
    resetMidiStepChain()
    setIsSelectionVisible(true)
    setActiveSelection(selection)
    setSelectedSelections([selection])
    setDraggingSelection(null)
    setSelectedMeasureScope(null)
    clearActiveChordSelection()
    closeOsmdPreview()

    const scrollHost = scoreScrollRef.current
    if (!scrollHost) return
    const resolvedLocation = findSelectionLocationInPairs({
      pairs: measurePairsRef.current,
      selection,
      importedNoteLookup: importedNoteLookupRef.current,
    })
    const resolvedPairIndex = resolvedLocation?.pairIndex ?? pairIndex
    const getCoarseScrollLeft = (): number | null => {
      const frame = horizontalMeasureFramesByPair[resolvedPairIndex]
      if (!frame) return null
      const frameCenterX = frame.measureX + frame.measureWidth * 0.5
      return Math.max(0, frameCenterX * scoreScaleX - scrollHost.clientWidth * 0.5)
    }
    const getPreciseScrollLeft = (): number | null => {
      const pairLayouts = noteLayoutsByPairRef.current.get(resolvedPairIndex) ?? []
      const noteLayout =
        pairLayouts.find((layout) => layout.id === selection.noteId && layout.staff === selection.staff) ??
        noteLayoutByKeyRef.current.get(getLayoutNoteKey(selection.staff, selection.noteId))
      if (!noteLayout) return null
      const targetHeadX = noteLayout.noteHeads.find((head) => head.keyIndex === selection.keyIndex)?.x ?? noteLayout.x
      const targetHeadGlobalX = horizontalRenderOffsetXRef.current + targetHeadX
      return Math.max(0, targetHeadGlobalX * scoreScaleX - scrollHost.clientWidth * 0.5)
    }

    const MAX_ATTEMPTS = 48
    let attempts = 0
    const runJumpLoop = () => {
      attempts += 1
      const coarseScrollLeft = getCoarseScrollLeft()
      if (coarseScrollLeft !== null) {
        scrollHost.scrollLeft = coarseScrollLeft
      }
      const preciseScrollLeft = getPreciseScrollLeft()
      if (preciseScrollLeft !== null) {
        scrollHost.scrollLeft = preciseScrollLeft
        return
      }
      if (attempts < MAX_ATTEMPTS) {
        window.requestAnimationFrame(runJumpLoop)
      } else {
        console.warn(
          `[osmd-jump] 无法精确定位目标音符，已停在目标小节附近。selection=${selection.staff}:${selection.noteId}[${selection.keyIndex}] pair=${resolvedPairIndex}`,
        )
      }
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(runJumpLoop)
    })
  }, [
    clearActiveChordSelection,
    closeOsmdPreview,
    horizontalMeasureFramesByPair,
    importedNoteLookupRef,
    measurePairsRef,
    noteLayoutByKeyRef,
    noteLayoutsByPairRef,
    resetMidiStepChain,
    scoreScaleX,
    scoreScrollRef,
    setActiveSelection,
    setDraggingSelection,
    setIsSelectionVisible,
    setSelectedMeasureScope,
    setSelectedSelections,
    horizontalRenderOffsetXRef,
  ])

  const onOsmdPreviewSurfaceClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (osmdPreviewSourceMode !== 'editor') return
    const target = resolveOsmdPreviewTargetFromEvent(event.target)
    if (!target) {
      osmdPreviewSelectedSelectionKeyRef.current = null
      clearOsmdPreviewNoteHighlight()
      return
    }
    osmdPreviewSelectedSelectionKeyRef.current = getSelectionKey(target.selection)
    applyOsmdPreviewNoteHighlight(target)
  }, [applyOsmdPreviewNoteHighlight, clearOsmdPreviewNoteHighlight, osmdPreviewSourceMode, resolveOsmdPreviewTargetFromEvent])

  const onOsmdPreviewSurfaceDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (osmdPreviewSourceMode !== 'editor') return
    const target = resolveOsmdPreviewTargetFromEvent(event.target)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    osmdPreviewSelectedSelectionKeyRef.current = getSelectionKey(target.selection)
    applyOsmdPreviewNoteHighlight(target)
    jumpFromOsmdPreviewToEditor(target)
  }, [applyOsmdPreviewNoteHighlight, jumpFromOsmdPreviewToEditor, osmdPreviewSourceMode, resolveOsmdPreviewTargetFromEvent])

  const openOsmdPreviewWithXml = useCallback((previewXmlText: string, sourceMode: 'editor' | 'direct-file') => {
    setOsmdPreviewSourceMode(sourceMode)
    setOsmdPreviewXml(previewXmlText)
    setOsmdPreviewStatusText('正在生成OSMD预览...')
    setOsmdPreviewError('')
    setOsmdPreviewPageIndex(0)
    setOsmdPreviewPageCount(1)
    setIsOsmdPreviewOpen(true)
  }, [])

  const openOsmdPreview = useCallback(() => {
    const { xmlText } = buildMusicXmlExportPayload({
      measurePairs,
      keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
      divisionsByMeasure: measureDivisionsFromImportRef.current,
      timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
      metadata: musicXmlMetadataFromImportRef.current,
    })
    const previewXmlText = sanitizeMusicXmlForOsmdPreview(xmlText, measurePairs)
    openOsmdPreviewWithXml(previewXmlText, 'editor')
  }, [measureDivisionsFromImportRef, measureKeyFifthsFromImportRef, measurePairs, measureTimeSignaturesFromImportRef, musicXmlMetadataFromImportRef, openOsmdPreviewWithXml])

  const openDirectOsmdFilePicker = useCallback(() => {
    const input = osmdDirectFileInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }, [])

  const onOsmdDirectFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const selectedFile = input.files?.[0]
    input.value = ''
    if (!selectedFile) return
    try {
      setOsmdPreviewError('')
      setOsmdPreviewStatusText('正在读取MusicXML文件...')
      const xmlText = await selectedFile.text()
      if (!xmlText.trim()) {
        setOsmdPreviewStatusText('')
        setOsmdPreviewError('所选文件为空，无法预览。')
        return
      }
      openOsmdPreviewWithXml(xmlText, 'direct-file')
    } catch (error) {
      setOsmdPreviewStatusText('')
      const message = error instanceof Error ? error.message : '读取MusicXML文件失败。'
      setOsmdPreviewError(message)
    }
  }, [openOsmdPreviewWithXml])

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
          ensurePdfCjkFontRegistered(pdf as unknown as WebMidiPdfLike)
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
        setOsmdPreviewStatusText((current) => (current.startsWith('PDF导出完成') ? '' : current))
      }, 2200)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF导出失败。'
      setOsmdPreviewError(message)
    } finally {
      setIsOsmdPreviewExportingPdf(false)
    }
  }, [isOsmdPreviewExportingPdf, musicXmlMetadataFromImportRef])

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
    osmdPreviewPageIndexRef.current = osmdPreviewPageIndex
  }, [osmdPreviewPageIndex])

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
        const fastStageXml = buildFastOsmdPreviewXml(osmdPreviewXml, OSMD_PREVIEW_FAST_STAGE_MEASURE_LIMIT)
        const useFastStageXml = fastStageXml !== osmdPreviewXml

        await osmd.load(useFastStageXml ? fastStageXml : osmdPreviewXml)
        if (canceled) return
        const previewInstance = osmd as unknown as OsmdPreviewInstance
        osmd.Zoom = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent) / 100
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
  }, [isOsmdPreviewOpen, osmdPreviewXml, osmdPreviewZoomPercent, rebuildOsmdPreviewNoteLookup])

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
    applyOsmdPreviewPageVisibility(renderedPages, osmdPreviewPageIndexRef.current)
    rebuildOsmdPreviewNoteLookup()
  }, [isOsmdPreviewOpen, osmdPreviewZoomPercent, rebuildOsmdPreviewNoteLookup])

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
      applyOsmdPreviewPageVisibility(renderedPages, osmdPreviewPageIndexRef.current)
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
    osmdPreviewBottomMarginPx,
    osmdPreviewFirstPageTopMarginPx,
    osmdPreviewHorizontalMarginPx,
    osmdPreviewTopMarginPx,
    rebuildOsmdPreviewNoteLookup,
  ])

  useEffect(() => {
    applyOsmdPreviewPageVisibility(osmdPreviewPagesRef.current, osmdPreviewPageIndex)
  }, [osmdPreviewPageCount, osmdPreviewPageIndex])
  useEffect(() => {
    applyOsmdPreviewPageNumbers(osmdPreviewPagesRef.current, osmdPreviewShowPageNumbers)
  }, [osmdPreviewPageCount, osmdPreviewShowPageNumbers])

  const dumpOsmdPreviewSystemMetrics = useCallback(() => {
    const osmd = osmdPreviewInstanceRef.current
    if (!osmd) {
      return {
        hasPreview: false,
        pageCount: 0,
        pages: [],
      }
    }
    const pages = osmd.GraphicSheet?.MusicPages ?? []
    const rulePageHeight = osmd.EngravingRules?.PageHeight
    const hasRulePageHeight = typeof rulePageHeight === 'number' && Number.isFinite(rulePageHeight) && rulePageHeight > 0
    const referencePageHeight = pages.reduce((maxHeight, page) => {
      const candidate = page.PositionAndShape?.Size?.height
      if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
        return maxHeight
      }
      return Math.max(maxHeight, candidate)
    }, 0)
    const normalizedPageHeight =
      hasRulePageHeight ? rulePageHeight : referencePageHeight > 0 ? referencePageHeight : null
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
              ? Number((normalizedPageHeight - lastSystemBottom).toFixed(3))
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

  const safeOsmdPreviewPaperScalePercent = clampOsmdPreviewPaperScalePercent(osmdPreviewPaperScalePercent)
  const safeOsmdPreviewHorizontalMarginPx = clampOsmdPreviewHorizontalMarginPx(osmdPreviewHorizontalMarginPx)
  const safeOsmdPreviewFirstPageTopMarginPx = clampOsmdPreviewTopMarginPx(osmdPreviewFirstPageTopMarginPx)
  const safeOsmdPreviewTopMarginPx = clampOsmdPreviewTopMarginPx(osmdPreviewTopMarginPx)
  const safeOsmdPreviewBottomMarginPx = clampOsmdPreviewBottomMarginPx(osmdPreviewBottomMarginPx)
  const osmdPreviewPaperScale = safeOsmdPreviewPaperScalePercent / 100
  const osmdPreviewPaperWidthPx = A4_PAGE_WIDTH * osmdPreviewPaperScale
  const osmdPreviewPaperHeightPx = A4_PAGE_HEIGHT * osmdPreviewPaperScale

  return {
    isOsmdPreviewOpen,
    isOsmdPreviewExportingPdf,
    osmdPreviewStatusText,
    osmdPreviewError,
    osmdPreviewPageIndex,
    osmdPreviewPageCount,
    osmdPreviewShowPageNumbers,
    osmdPreviewZoomDraftPercent,
    safeOsmdPreviewPaperScalePercent,
    safeOsmdPreviewHorizontalMarginPx,
    safeOsmdPreviewFirstPageTopMarginPx,
    safeOsmdPreviewTopMarginPx,
    safeOsmdPreviewBottomMarginPx,
    osmdPreviewPaperScale,
    osmdPreviewPaperWidthPx,
    osmdPreviewPaperHeightPx,
    osmdPreviewContainerRef,
    osmdDirectFileInputRef,
    osmdPreviewInstanceRef,
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewNoteLookupBySelectionRef,
    osmdPreviewSelectedSelectionKeyRef,
    closeOsmdPreview,
    openOsmdPreview,
    openDirectOsmdFilePicker,
    onOsmdDirectFileChange,
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
    dumpOsmdPreviewSystemMetrics,
  }
}
