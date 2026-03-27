import {
  getSvgRenderSize,
  resolveOsmdPreviewPageSvgElement,
} from './osmdPreviewUtils'

const PDF_CJK_FONT_FAMILY = 'NotoSansSC'
const PDF_CJK_FONT_FILE_NAME = 'NotoSansSC-Regular.ttf'
const PDF_CJK_FONT_URL = new URL('../../assets/fonts/NotoSansSC-Regular.ttf', import.meta.url).href

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

export async function exportOsmdPreviewPagesToPdf(params: {
  pageElements: HTMLElement[]
  rawFileName: string
  onProgress?: (message: string) => void
}): Promise<number> {
  const { pageElements, rawFileName, onProgress } = params
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
    onProgress?.(`正在导出PDF... ${Math.min(totalCount, exportedCount + 1)} / ${totalCount}`)
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

  const safeFileName = (rawFileName.trim() || 'score-preview').replace(/[\\/:*?"<>|]+/g, '_')
  pdf.save(`${safeFileName}.pdf`)
  return exportedCount
}
