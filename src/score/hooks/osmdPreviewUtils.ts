import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH, DURATION_TICKS } from '../constants'
import { getStepOctaveAlterFromPitch } from '../pitchMath'
import type { MeasurePair, Pitch, Selection } from '../types'

export const OSMD_PREVIEW_ZOOM_DEBOUNCE_MS = 120
export const DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX = 9
export const DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX = 23
export const DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX = 10
export const DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX = 10
export const OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX = DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX
export const OSMD_PREVIEW_SPARSE_SYSTEM_COUNT = 4
export const OSMD_PREVIEW_MIN_SYSTEM_GAP_PX = 1
export const OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT = 2
export const OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS = 0.01
export const OSMD_PREVIEW_REPAGINATION_MAX_ATTEMPTS = 12
export const OSMD_PREVIEW_REPAGINATION_MIN_STEP_PX = 2
export const OSMD_PREVIEW_REPAGINATION_MAX_STEP_PX = 64
export const OSMD_PREVIEW_MARGIN_APPLY_DEBOUNCE_MS = 90
export const OSMD_PREVIEW_FAST_STAGE_MEASURE_LIMIT = 12

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

export type MeasureStaffOnsetEntry = {
  noteIndex: number
  onsetTicks: number
  maxKeyIndex: number
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function clampOsmdPreviewZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(35, Math.min(160, Math.round(value)))
}

export function clampOsmdPreviewPaperScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(50, Math.min(180, Math.round(value)))
}

export function clampOsmdPreviewHorizontalMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX
  return Math.max(0, Math.min(120, Math.round(value)))
}

export function clampOsmdPreviewTopMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX
  return Math.max(0, Math.min(180, Math.round(value)))
}

export function clampOsmdPreviewBottomMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX
  return Math.max(0, Math.min(180, Math.round(value)))
}

export function escapeCssId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id)
  }
  return id.replace(/([ !\"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}

export function getSelectionKey(selection: Selection): string {
  return `${selection.staff}|${selection.noteId}|${selection.keyIndex}`
}

export function buildMeasureStaffOnsetEntries(notes: MeasurePair['treble']): MeasureStaffOnsetEntry[] {
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

export function findMeasureStaffOnsetEntry(
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

export function sanitizeMusicXmlForOsmdPreview(xmlText: string, measurePairs: MeasurePair[]): string {
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

export function collectOsmdPreviewPages(container: HTMLElement): HTMLElement[] {
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

export function resolveOsmdPreviewPageSvgElement(pageElement: HTMLElement): SVGSVGElement | null {
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

export function getSvgRenderSize(svgElement: SVGSVGElement): { width: number; height: number } {
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

export function getSvgCoordinateSize(svgElement: SVGSVGElement): { width: number; height: number } {
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

export function applyOsmdPreviewPageVisibility(pages: HTMLElement[], pageIndex: number): void {
  if (pages.length <= 1) return
  const safeIndex = Math.max(0, Math.min(pages.length - 1, pageIndex))
  pages.forEach((page, index) => {
    page.style.display = index === safeIndex ? '' : 'none'
  })
}

export function applyOsmdPreviewPageNumbers(pages: HTMLElement[], visible: boolean): void {
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

export function buildFastOsmdPreviewXml(xmlText: string, measureLimit: number): string {
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

export function buildOsmdPreviewSystemMetrics(osmd: OsmdPreviewInstance | null): {
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
} {
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
}
