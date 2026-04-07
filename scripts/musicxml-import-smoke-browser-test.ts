import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4174
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_XML_PATH = String.raw`C:\Users\76743\Desktop\月亮代表我的心.musicxml`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startDevServer(): ChildProcess {
  const command = `npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT} --strictPort`
  return spawn(command, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: true,
  })
}

async function stopDevServer(server: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (server.exitCode !== null || server.killed) {
      resolve()
      return
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(fallbackTimer)
      resolve()
    }
    const fallbackTimer = setTimeout(() => {
      finish()
    }, 5000)
    server.once('exit', () => finish())
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

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await Promise.race([
        fetch(url, { method: 'GET', cache: 'no-store' }),
        sleep(1500).then(() => null),
      ])
      if (response && 'ok' in response && response.ok) return
    } catch {
      // retry
    }
    await sleep(350)
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
    return (
      !!api &&
      typeof api.importMusicXmlText === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.dumpAllMeasureCoordinates === 'function'
    )
  })
}

async function importMusicXmlViaDebugApi(page: Page, xmlText: string): Promise<ImportFeedback> {
  await page.evaluate((xml) => {
    const api =
      (window as unknown as { __scoreDebug: { importMusicXmlText: (text: string) => void } }).__scoreDebug
    api.importMusicXmlText(xml)
  }, xmlText)

  await page.waitForFunction(
    () => {
      const api =
        (window as unknown as { __scoreDebug?: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
      if (!api || typeof api.getImportFeedback !== 'function') return false
      const feedback = api.getImportFeedback()
      return feedback.kind !== 'idle' && feedback.kind !== 'loading'
    },
    { timeout: 120_000 },
  )

  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
    return api.getImportFeedback()
  })
}

async function run(): Promise<void> {
  const xmlPath = process.argv[2] ?? DEFAULT_XML_PATH
  const xmlText = await readFile(xmlPath, 'utf8')
  const server = startDevServer()
  let browser = null

  try {
    await waitForServer(DEV_URL, 30_000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => {
      pageErrors.push(String(error?.stack || error))
    })

    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await waitForDebugApi(page)

    const feedback = await importMusicXmlViaDebugApi(page, xmlText)
    if (feedback.kind !== 'success') {
      throw new Error(`MusicXML import failed: ${feedback.message}`)
    }
    if (pageErrors.length > 0) {
      throw new Error(`Page errors detected during MusicXML import:\n${pageErrors.join('\n\n')}`)
    }

    const dumpSummary = await page.evaluate(() => {
      const api =
        (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => { rows: Array<{ rendered: boolean }> } } }).__scoreDebug
      const dump = api.dumpAllMeasureCoordinates()
      return {
        totalRows: dump.rows.length,
        renderedRows: dump.rows.filter((row) => row.rendered).length,
      }
    })
    if (dumpSummary.totalRows <= 0 || dumpSummary.renderedRows <= 0) {
      throw new Error(
        `MusicXML import succeeded but rendered score dump is empty: totalRows=${dumpSummary.totalRows} renderedRows=${dumpSummary.renderedRows}`,
      )
    }

    console.log(`MusicXML import smoke test passed. totalRows=${dumpSummary.totalRows} renderedRows=${dumpSummary.renderedRows}`)
  } finally {
    if (browser) {
      await browser.close()
    }
    await stopDevServer(server)
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
