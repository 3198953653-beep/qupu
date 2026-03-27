import { A4_PAGE_HEIGHT, A4_PAGE_WIDTH } from '../constants'

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
