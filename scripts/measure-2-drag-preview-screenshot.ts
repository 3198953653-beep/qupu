import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type DumpNoteHead = {
  keyIndex: number
  pitch: string | null
  x: number
  y: number
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  pitch: string | null
  x: number
  noteHeads: DumpNoteHead[]
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  notes: DumpNoteRow[]
}

type MeasureDump = {
  totalMeasureCount: number
  rows: MeasureDumpRow[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const TARGET_PAIR_INDEX = 1

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
      // ignore
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

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
    return !!api && typeof api.importMusicXmlText === 'function'
  })
}

async function importXml(page: Page, xmlText: string): Promise<void> {
  await page.evaluate((xml) => {
    const api = (window as unknown as { __scoreDebug: { importMusicXmlText: (text: string) => void } }).__scoreDebug
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
}

async function dump(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump } }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

function pickTargetHead(row: MeasureDumpRow): { noteId: string; x: number; y: number } {
  const note = row.notes
    .filter((item) => item.staff === 'treble' && item.noteHeads.length > 0)
    .sort((a, b) => a.noteIndex - b.noteIndex)[0]
  if (!note) throw new Error(`No treble note head in pair ${TARGET_PAIR_INDEX}`)
  const head = note.noteHeads.find((item) => item.keyIndex === 0) ?? note.noteHeads[0]
  return { noteId: note.noteId, x: head.x, y: head.y }
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
    return { x: rect.left + x * scaleX, y: rect.top + y * scaleY }
  }, { x: logicalX, y: logicalY })
}

async function main() {
  const xmlPath = process.argv[2] ?? 'C:\\Users\\76743\\Desktop\\1234.musicxml'
  const outPath = process.argv[3] ?? path.resolve('debug', 'measure-2-drag-preview.png')
  const dragDeltaClientYRaw = process.argv[4]
  const dragDeltaClientY = dragDeltaClientYRaw !== undefined ? Number(dragDeltaClientYRaw) : -42
  if (!Number.isFinite(dragDeltaClientY)) {
    throw new Error(`Invalid drag delta: ${dragDeltaClientYRaw}`)
  }
  const xmlText = await readFile(xmlPath, 'utf8')

  const devServer = startDevServer()
  devServer.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('Local:') || text.includes('ready in')) process.stdout.write(text)
  })
  devServer.stderr?.on('data', (chunk) => process.stderr.write(chunk.toString()))

  try {
    await waitForServer(DEV_URL, 45_000)
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)
    await importXml(page, xmlText)
    await page.waitForTimeout(120)

    const snapshot = await dump(page)
    const secondMeasure = snapshot.rows.find((row) => row.pairIndex === TARGET_PAIR_INDEX)
    if (!secondMeasure || !secondMeasure.rendered) {
      throw new Error(`Pair ${TARGET_PAIR_INDEX} not rendered`)
    }
    const target = pickTargetHead(secondMeasure)
    const start = await toClientPoint(page, target.x, target.y)
    const end = { x: start.x, y: start.y + dragDeltaClientY }

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.waitForTimeout(180)

    await mkdir(path.dirname(outPath), { recursive: true })
    await page.screenshot({ path: outPath, fullPage: false })
    console.log(`Generated: ${outPath}`)
    await page.mouse.up()
    await browser.close()
  } finally {
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
