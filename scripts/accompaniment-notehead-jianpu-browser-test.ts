import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type MeasureDump = {
  totalMeasureCount: number
  rows: Array<{
    pairIndex: number
    rendered: boolean
    notes: Array<{
      staff: 'treble' | 'bass'
      noteId: string
      noteIndex: number
      noteHeads: Array<{
        keyIndex: number
        pitch: string | null
        x: number
        y: number
      }>
    }>
  }>
}

type CanvasSnapshot = {
  width: number
  height: number
  checksum: number
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4177
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_XML_PATH = String.raw`C:\Users\76743\Desktop\月亮代表我的心.musicxml`
const DEFAULT_TEMPLATE_NAME = '全是16分音符'
const DEBUG_OUTPUT_DIR = path.resolve('debug')

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
    const fallbackTimer = setTimeout(() => finish(), 5000)
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
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.setShowNoteHeadJianpuEnabled === 'function' &&
      typeof api.getShowNoteHeadJianpuEnabled === 'function'
    )
  })
}

async function waitForImportSuccess(page: Page): Promise<void> {
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

  const feedback = await page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
    return api.getImportFeedback()
  })
  if (feedback.kind !== 'success') {
    throw new Error(`MusicXML import failed: ${feedback.message}`)
  }
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump } }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

async function toClientPoint(page: Page, logicalX: number, logicalY: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas.score-surface') as HTMLCanvasElement | null
    if (!canvas) throw new Error('Canvas .score-surface not found.')
    const rect = canvas.getBoundingClientRect()
    const widthBase = canvas.width > 0 ? canvas.width : rect.width || 1
    const heightBase = canvas.height > 0 ? canvas.height : rect.height || 1
    const scaleX = rect.width / widthBase
    const scaleY = rect.height / heightBase
    return {
      x: rect.left + x * scaleX,
      y: rect.top + y * scaleY,
    }
  }, { x: logicalX, y: logicalY })
}

function pickFirstPlayableBassNote(dump: MeasureDump, pairIndex: number): { x: number; y: number } {
  const row = dump.rows.find((entry) => entry.pairIndex === pairIndex)
  if (!row?.rendered) {
    throw new Error(`Measure pair ${pairIndex} is not rendered.`)
  }
  const note = row.notes
    .filter((entry) => entry.staff === 'bass' && entry.noteHeads.length > 0)
    .sort((left, right) => left.noteIndex - right.noteIndex)[0]
  if (!note) {
    throw new Error(`No playable bass note found in measure pair ${pairIndex}.`)
  }
  const head = note.noteHeads.find((entry) => entry.keyIndex === 0) ?? note.noteHeads[0]
  if (!head) {
    throw new Error(`No note head found for note ${note.noteId}.`)
  }
  return { x: head.x, y: head.y }
}

async function openRhythmTemplateModal(page: Page): Promise<void> {
  const firstSegmentButton = page.locator('.segment-ruler-block').first()
  await firstSegmentButton.waitFor({ state: 'visible', timeout: 20_000 })
  await firstSegmentButton.dblclick()
  await page.getByRole('dialog', { name: '加载律动模板' }).waitFor({ state: 'visible', timeout: 20_000 })
}

async function applyRhythmTemplate(page: Page, templateName: string): Promise<void> {
  const templateRows = page.locator('.rhythm-template-row')
  await templateRows.first().waitFor({ state: 'visible', timeout: 20_000 })
  const row = templateRows.filter({ hasText: templateName }).first()
  if ((await row.count()) === 0) {
    throw new Error(`Unable to find rhythm template "${templateName}".`)
  }
  await row.dblclick()
  await page.getByRole('dialog', { name: '加载律动模板' }).waitFor({ state: 'hidden', timeout: 30_000 })
}

async function openAccompanimentModal(page: Page): Promise<void> {
  const dump = await dumpAllMeasureCoordinates(page)
  const bassHead = pickFirstPlayableBassNote(dump, 0)
  const point = await toClientPoint(page, bassHead.x, bassHead.y)
  await page.mouse.click(point.x, point.y, { clickCount: 2, delay: 60 })
  await page.getByRole('dialog', { name: '伴奏音符选择' }).waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('.accompaniment-note-modal-card canvas.smart-chord-notation-svg') as
        | HTMLCanvasElement
        | null
      return !!canvas && canvas.width > 0 && canvas.height > 0
    },
    { timeout: 20_000 },
  )
}

async function setShowNoteHeadJianpuEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((nextEnabled) => {
    const api = (window as unknown as {
      __scoreDebug: {
        setShowNoteHeadJianpuEnabled: (enabled: boolean) => void
      }
    }).__scoreDebug
    api.setShowNoteHeadJianpuEnabled(nextEnabled)
  }, enabled)
  await page.waitForFunction(
    (expected) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getShowNoteHeadJianpuEnabled: () => boolean
        }
      }).__scoreDebug
      return api.getShowNoteHeadJianpuEnabled() === expected
    },
    enabled,
    { timeout: 20_000 },
  )
  await page.waitForTimeout(180)
}

async function captureModalCanvasSnapshot(page: Page): Promise<CanvasSnapshot> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.accompaniment-note-modal-card canvas.smart-chord-notation-svg') as
      | HTMLCanvasElement
      | null
    if (!canvas) {
      throw new Error('Accompaniment modal canvas not found.')
    }
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('Accompaniment modal canvas context not available.')
    }
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    let checksum = 0
    for (let index = 0; index < imageData.data.length; index += 16) {
      checksum = (checksum + imageData.data[index]! * (index + 1)) % 2147483647
    }
    return {
      width: canvas.width,
      height: canvas.height,
      checksum,
    }
  })
}

async function captureDebugArtifacts(page: Page, name: string): Promise<void> {
  await mkdir(DEBUG_OUTPUT_DIR, { recursive: true })
  await page.screenshot({
    path: path.join(DEBUG_OUTPUT_DIR, name),
    fullPage: true,
  })
}

async function run(): Promise<void> {
  const xmlPath = process.argv[2] ?? DEFAULT_XML_PATH
  const templateName = process.argv[3] ?? DEFAULT_TEMPLATE_NAME
  const xmlText = await readFile(xmlPath, 'utf8')
  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  try {
    await waitForServer(DEV_URL, 30_000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await waitForDebugApi(page)

    const importInput = page.locator('input.xml-file-input').first()
    await importInput.setInputFiles({
      name: path.basename(xmlPath),
      mimeType: 'application/vnd.recordare.musicxml+xml',
      buffer: Buffer.from(xmlText, 'utf8'),
    })
    await waitForImportSuccess(page)

    await openRhythmTemplateModal(page)
    await applyRhythmTemplate(page, templateName)
    await openAccompanimentModal(page)

    await setShowNoteHeadJianpuEnabled(page, false)
    const offSnapshot = await captureModalCanvasSnapshot(page)

    await setShowNoteHeadJianpuEnabled(page, true)
    const onSnapshot = await captureModalCanvasSnapshot(page)

    await setShowNoteHeadJianpuEnabled(page, false)
    const offAgainSnapshot = await captureModalCanvasSnapshot(page)

    if (offSnapshot.width !== onSnapshot.width || offSnapshot.height !== onSnapshot.height) {
      throw new Error('Modal canvas dimensions changed unexpectedly when toggling notehead jianpu.')
    }
    if (offSnapshot.checksum === onSnapshot.checksum) {
      throw new Error('Expected accompaniment modal canvas to change when notehead jianpu is enabled.')
    }
    if (offSnapshot.checksum !== offAgainSnapshot.checksum) {
      throw new Error('Expected accompaniment modal canvas to return to the original state after disabling notehead jianpu.')
    }

    await mkdir(DEBUG_OUTPUT_DIR, { recursive: true })
    await writeFile(
      path.join(DEBUG_OUTPUT_DIR, 'accompaniment-notehead-jianpu-browser-report.json'),
      JSON.stringify(
        {
          xmlPath,
          templateName,
          offSnapshot,
          onSnapshot,
          offAgainSnapshot,
        },
        null,
        2,
      ),
      'utf8',
    )
    await captureDebugArtifacts(page, 'accompaniment-notehead-jianpu-browser.png')
    console.log('Accompaniment notehead jianpu browser test passed.')
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
