import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  overflowVsNoteEndX: number | null
  overflowVsMeasureEndBarX: number | null
}

type MeasureDump = {
  generatedAt: string
  totalMeasureCount: number
  renderedMeasureCount: number
  visibleSystemRange: { start: number; end: number }
  rows: MeasureDumpRow[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' })
      if (response.ok) return
    } catch {
      // wait and retry
    }
    await sleep(350)
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

function startDevServer(): ChildProcess {
  const command = `npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT} --strictPort`
  return spawn(command, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: true,
  })
}

function stopDevServer(server: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (server.exitCode !== null || server.killed) {
      resolve()
      return
    }
    server.once('exit', () => resolve())
    if (process.platform === 'win32' && server.pid) {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    }
    server.kill('SIGTERM')
    setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL')
    }, 2500)
  })
}

async function main() {
  const xmlPath = process.argv[2] ?? 'C:\\Users\\76743\\Desktop\\1234.musicxml'
  const outputPath = process.argv[3] ?? path.resolve('debug', 'measure-coordinate-report.browser.json')
  const xmlText = await readFile(xmlPath, 'utf8')

  const devServer = startDevServer()
  devServer.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('Local:') || text.includes('ready in')) {
      process.stdout.write(text)
    }
  })
  devServer.stderr?.on('data', (chunk) => {
    process.stderr.write(chunk.toString())
  })

  let browserClosed = false
  try {
    await waitForServer(DEV_URL, 45_000)
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } })

    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => {
      const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
      return !!api && typeof api.importMusicXmlText === 'function'
    })

    await page.evaluate((xml) => {
      const api = (window as unknown as { __scoreDebug: { importMusicXmlText: (text: string) => void } }).__scoreDebug
      api.importMusicXmlText(xml)
    }, xmlText)

    await page.waitForFunction(() => {
      const api =
        (window as unknown as { __scoreDebug?: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
      if (!api || typeof api.getImportFeedback !== 'function') return false
      const feedback = api.getImportFeedback()
      return feedback.kind !== 'idle' && feedback.kind !== 'loading'
    }, { timeout: 120_000 })

    const feedback = await page.evaluate(() => {
      const api =
        (window as unknown as { __scoreDebug: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
      return api.getImportFeedback()
    })
    if (feedback.kind !== 'success') {
      throw new Error(`MusicXML import failed: ${feedback.message}`)
    }

    const paging = await page.evaluate(() => {
      const api =
        (window as unknown as {
          __scoreDebug: { getPaging: () => { currentPage: number; pageCount: number } }
        }).__scoreDebug
      return api.getPaging()
    })

    const renderedByPair = new Map<number, MeasureDumpRow>()
    let latestDump: MeasureDump | null = null

    for (let pageIndex = 0; pageIndex < paging.pageCount; pageIndex += 1) {
      await page.evaluate((targetPage) => {
        const api =
          (window as unknown as { __scoreDebug: { goToPage: (page: number) => void } }).__scoreDebug
        api.goToPage(targetPage)
      }, pageIndex)
      await page.waitForFunction((targetPage) => {
        const api =
          (window as unknown as {
            __scoreDebug: { getPaging: () => { currentPage: number } }
          }).__scoreDebug
        return api.getPaging().currentPage === targetPage
      }, pageIndex)
      await page.waitForTimeout(80)
      const dump = await page.evaluate(() => {
        const api =
          (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump } }).__scoreDebug
        return api.dumpAllMeasureCoordinates()
      })
      latestDump = dump
      dump.rows.forEach((row) => {
        if (row.rendered) renderedByPair.set(row.pairIndex, row)
      })
    }

    if (!latestDump) throw new Error('No layout dump produced.')

    const mergedRows = Array.from({ length: latestDump.totalMeasureCount }, (_, pairIndex) => {
      return (
        renderedByPair.get(pairIndex) ?? {
          pairIndex,
          rendered: false,
          overflowVsNoteEndX: null,
          overflowVsMeasureEndBarX: null,
        }
      )
    })

    const overflowRows = mergedRows.filter((row) => typeof row.overflowVsNoteEndX === 'number' && row.overflowVsNoteEndX > 0)
    const report = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      pageCount: paging.pageCount,
      totalMeasureCount: latestDump.totalMeasureCount,
      renderedMeasureCount: mergedRows.filter((row) => row.rendered).length,
      overflowMeasureCount: overflowRows.length,
      overflowPairs: overflowRows.map((row) => ({
        pairIndex: row.pairIndex,
        overflowVsNoteEndX: row.overflowVsNoteEndX,
        overflowVsMeasureEndBarX: row.overflowVsMeasureEndBarX,
      })),
      rows: mergedRows,
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')

    console.log(`Generated: ${outputPath}`)
    console.log(`Measures rendered: ${report.renderedMeasureCount}/${report.totalMeasureCount}`)
    console.log(`Overflow measures: ${report.overflowMeasureCount}`)

    await browser.close()
    browserClosed = true
  } finally {
    await stopDevServer(devServer)
    if (!browserClosed) {
      // no-op: browser might not have been created
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
