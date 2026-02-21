import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

type Combo = {
  label: string
  firstTop: number
  followingTop: number
  bottom: number
}

type PageEval = {
  pageIndex: number
  systemCount: number
  pageHeight: number | null
  pageHeightRaw: number | null
  firstY: number | null
  expectedTop: number
  deltaTop: number | null
  topOk: boolean
  bottomGap: number | null
  bottomGapRaw: number | null
  expectedBottom: number
  deltaBottom: number | null
  bottomOk: boolean
}

type Snapshot = {
  label: string
  sliders: {
    firstTop: number
    followingTop: number
    bottom: number
  }
  pageCount: number
  requiresRepagination: boolean
  repaginationAttempts: number
  pageShortfalls: Array<{
    pageIndex: number
    frameCount: number
    minGapShortfall: number
  }>
  pages: PageEval[]
  allPagesMatchTarget: boolean
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const EPS = 0.01
const DEFAULT_XML_PATH = 'C:\\Users\\76743\\Desktop\\3456.musicxml'
const OUTPUT_PATH = path.resolve('debug', 'osmd-margin-combined-check-3456.json')

const COMBOS: Combo[] = [
  { label: 'baseline', firstTop: 10, followingTop: 10, bottom: 10 },
  { label: 'combo-1', firstTop: 20, followingTop: 20, bottom: 15 },
  { label: 'combo-2', firstTop: 15, followingTop: 25, bottom: 18 },
  { label: 'combo-3', firstTop: 25, followingTop: 15, bottom: 20 },
  { label: 'combo-4', firstTop: 30, followingTop: 30, bottom: 20 },
  { label: 'combo-5', firstTop: 35, followingTop: 40, bottom: 22 },
  { label: 'combo-6', firstTop: 45, followingTop: 50, bottom: 25 },
  { label: 'combo-7', firstTop: 0, followingTop: 30, bottom: 0 },
  { label: 'combo-8', firstTop: 50, followingTop: 10, bottom: 30 },
]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // retry
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

function startDevServer(): ChildProcess {
  return spawn(`npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT} --strictPort`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: process.env,
  })
}

function stopDevServer(server: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (server.exitCode !== null || server.killed) {
      resolve()
      return
    }
    if (process.platform === 'win32' && server.pid) {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      setTimeout(() => resolve(), 1500)
      return
    }
    server.once('exit', () => resolve())
    server.kill('SIGTERM')
    setTimeout(() => resolve(), 2000)
  })
}

async function setRangeValue(
  page: import('playwright').Page,
  id: string,
  value: number,
): Promise<void> {
  await page.evaluate(({ targetId, targetValue }) => {
    const input = document.getElementById(targetId) as HTMLInputElement | null
    if (!input) throw new Error(`Missing input: ${targetId}`)
    input.value = String(targetValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, { targetId: id, targetValue: value })
  await page.waitForTimeout(380)
}

async function setAllRanges(
  page: import('playwright').Page,
  combo: Combo,
): Promise<void> {
  await setRangeValue(page, 'osmd-preview-first-top-margin-range', combo.firstTop)
  await setRangeValue(page, 'osmd-preview-top-margin-range', combo.followingTop)
  await setRangeValue(page, 'osmd-preview-bottom-margin-range', combo.bottom)
  await page.waitForTimeout(550)
}

async function collectSnapshot(
  page: import('playwright').Page,
  combo: Combo,
): Promise<Snapshot> {
  return page.evaluate(({ combo, eps }) => {
    const api = (window as unknown as {
      __scoreDebug?: {
        getOsmdPreviewSystemMetrics?: () => {
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
        getOsmdPreviewRebalanceStats?: () => {
          requiresRepagination?: boolean
          repaginationAttempts?: number
          pageSummaries?: Array<{
            pageIndex: number
            frameCount: number
            minGapShortfall: number
          }>
        } | null
      }
    }).__scoreDebug

    const metrics = api?.getOsmdPreviewSystemMetrics?.() ?? { pageCount: 0, pages: [] }
    const stats = api?.getOsmdPreviewRebalanceStats?.() ?? null

    const pages: PageEval[] = metrics.pages.map((p, pageIndex) => {
      const firstY = Array.isArray(p.systemY) && p.systemY.length > 0 ? p.systemY[0] : null
      const expectedTop = pageIndex === 0 ? combo.firstTop : combo.followingTop
      const deltaTop = typeof firstY === 'number' ? Number((firstY - expectedTop).toFixed(3)) : null
      const topOk = deltaTop !== null && Math.abs(deltaTop) <= eps
      const bottomGap = typeof p.bottomGap === 'number' ? p.bottomGap : null
      const deltaBottom = bottomGap !== null ? Number((bottomGap - combo.bottom).toFixed(3)) : null
      const bottomOk = deltaBottom !== null && Math.abs(deltaBottom) <= eps
      return {
        pageIndex,
        systemCount: p.systemCount ?? 0,
        pageHeight: p.pageHeight ?? null,
        pageHeightRaw: p.pageHeightRaw ?? null,
        firstY,
        expectedTop,
        deltaTop,
        topOk,
        bottomGap,
        bottomGapRaw: p.bottomGapRaw ?? null,
        expectedBottom: combo.bottom,
        deltaBottom,
        bottomOk,
      }
    })

    const allPagesMatchTarget = pages
      .filter((p) => p.systemCount > 0)
      .every((p) => p.topOk && p.bottomOk)

    return {
      label: combo.label,
      sliders: {
        firstTop: combo.firstTop,
        followingTop: combo.followingTop,
        bottom: combo.bottom,
      },
      pageCount: metrics.pageCount ?? pages.length,
      requiresRepagination: Boolean(stats?.requiresRepagination),
      repaginationAttempts: Number(stats?.repaginationAttempts ?? 0),
      pageShortfalls: Array.isArray(stats?.pageSummaries)
        ? stats!.pageSummaries!.map((s) => ({
            pageIndex: Number(s.pageIndex ?? 0),
            frameCount: Number(s.frameCount ?? 0),
            minGapShortfall: Number(s.minGapShortfall ?? 0),
          }))
        : [],
      pages,
      allPagesMatchTarget,
    }
  }, { combo, eps: EPS })
}

async function main(): Promise<void> {
  const xmlPath = process.argv[2] ?? DEFAULT_XML_PATH
  const xmlText = await readFile(xmlPath, 'utf8')
  const server = startDevServer()
  let browser: import('playwright').Browser | null = null
  try {
    await waitForServer(DEV_URL, 45_000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1900, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })

    await page.waitForFunction(() => {
      const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
      return !!api && typeof api.importMusicXmlText === 'function' && typeof api.getImportFeedback === 'function'
    })

    await page.evaluate((xml) => {
      ;(window as unknown as { __scoreDebug: { importMusicXmlText: (value: string) => void } }).__scoreDebug
        .importMusicXmlText(xml)
    }, xmlText)

    await page.waitForFunction(() => {
      const api = (window as unknown as {
        __scoreDebug?: { getImportFeedback: () => { kind: string } }
      }).__scoreDebug
      const feedback = api?.getImportFeedback?.()
      return feedback?.kind === 'success' || feedback?.kind === 'error'
    }, { timeout: 120_000 })

    await page.locator('button', { hasText: 'OSMD' }).first().click()
    await page.waitForSelector('.osmd-preview-modal', { state: 'visible' })
    await page.waitForFunction(() => {
      const surface = document.querySelector('.osmd-preview-surface')
      return !!surface && surface.querySelectorAll('svg, canvas').length > 0
    })
    await page.waitForTimeout(350)

    const snapshots: Snapshot[] = []
    for (const combo of COMBOS) {
      await setAllRanges(page, combo)
      snapshots.push(await collectSnapshot(page, combo))
    }

    const result = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      eps: EPS,
      combos: COMBOS,
      snapshots,
    }
    await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    console.log(`Saved: ${OUTPUT_PATH}`)
  } finally {
    if (browser) await browser.close()
    await stopDevServer(server)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
