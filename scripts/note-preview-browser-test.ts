import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { SAMPLE_MUSIC_XML } from '../src/score/constants'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type NotePreviewEvent = {
  sequence: number
  atMs: number
  noteId: string
  keyIndex: number
  mode: 'click' | 'drag'
  pitch: string
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
const DEFAULT_DRAG_DELTA_CLIENT_Y = -42

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
      // retry
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
    return (
      !!api &&
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.importMusicXmlText === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.setAutoScaleEnabled === 'function' &&
      typeof api.setManualScalePercent === 'function' &&
      typeof api.getNotePreviewEvents === 'function' &&
      typeof api.clearNotePreviewEvents === 'function'
    )
  })
}

async function setScoreScale(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        setAutoScaleEnabled: (enabled: boolean) => void
        setManualScalePercent: (value: number) => void
      }
    }).__scoreDebug
    api.setAutoScaleEnabled(false)
    api.setManualScalePercent(100)
  })
  await page.waitForTimeout(120)
}

async function importMusicXmlViaDebugApi(page: Page, xmlText: string): Promise<void> {
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

async function collectMergedDump(page: Page): Promise<MeasureDumpRow[]> {
  const dump = await dumpAllMeasureCoordinates(page)
  return Array.from({ length: dump.totalMeasureCount }, (_, pairIndex) => {
    return dump.rows.find((row) => row.pairIndex === pairIndex) ?? { pairIndex, rendered: false, notes: [] }
  })
}

function pickPlayableTarget(params: {
  rows: MeasureDumpRow[]
  pairIndex: number
  staff: 'treble' | 'bass'
}): { note: DumpNoteRow; head: DumpNoteHead } {
  const { rows, pairIndex, staff } = params
  const row = rows.find((item) => item.pairIndex === pairIndex)
  if (!row?.rendered) {
    throw new Error(`Measure pair ${pairIndex} is not rendered.`)
  }

  const candidates = row.notes
    .filter((note) => note.staff === staff && note.noteHeads.length > 0)
    .sort((left, right) => {
      if (left.noteIndex !== right.noteIndex) return left.noteIndex - right.noteIndex
      return left.x - right.x
    })
  const note = candidates[0]
  if (!note) {
    throw new Error(`No playable ${staff} note found in pair ${pairIndex}.`)
  }
  const head = note.noteHeads.find((item) => item.keyIndex === 0) ?? note.noteHeads[0]
  if (!head) {
    throw new Error(`No note head found for ${note.noteId}.`)
  }
  return { note, head }
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

async function clearNotePreviewEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { clearNotePreviewEvents: () => void } }).__scoreDebug
    api.clearNotePreviewEvents()
  })
}

async function getNotePreviewEvents(page: Page): Promise<NotePreviewEvent[]> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getNotePreviewEvents: () => NotePreviewEvent[] } }).__scoreDebug
    return api.getNotePreviewEvents()
  })
}

function findNotePitch(rows: MeasureDumpRow[], noteId: string): string | null {
  for (const row of rows) {
    const note = row.notes.find((entry) => entry.noteId === noteId)
    if (note) return note.pitch
  }
  return null
}

async function runClickPreview(params: {
  page: Page
  note: DumpNoteRow
  head: DumpNoteHead
}): Promise<NotePreviewEvent[]> {
  const { page, head } = params
  await clearNotePreviewEvents(page)
  const clientPoint = await toClientPoint(page, head.x, head.y)
  await page.mouse.move(clientPoint.x, clientPoint.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(140)
  return getNotePreviewEvents(page)
}

async function runDragPreview(params: {
  page: Page
  note: DumpNoteRow
  head: DumpNoteHead
  dragDeltaClientY: number
  moveSteps: number
}): Promise<{ events: NotePreviewEvent[]; pitchAfter: string | null }> {
  const { page, note, head, dragDeltaClientY, moveSteps } = params
  await clearNotePreviewEvents(page)
  const start = await toClientPoint(page, head.x, head.y)
  const end = { x: start.x, y: start.y + dragDeltaClientY }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: moveSteps })
  await page.mouse.up()
  await page.waitForTimeout(180)
  const events = await getNotePreviewEvents(page)
  const rowsAfter = await collectMergedDump(page)
  return {
    events,
    pitchAfter: findNotePitch(rowsAfter, note.noteId),
  }
}

async function main() {
  const outputPath = process.argv[2] ?? path.resolve('debug', 'note-preview-browser-report.json')
  const devServer = startDevServer()
  devServer.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('Local:') || text.includes('ready in')) {
      process.stdout.write(text)
    }
  })
  devServer.stderr?.on('data', (chunk) => process.stderr.write(chunk.toString()))

  try {
    await waitForServer(DEV_URL, 45_000)
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)
    await setScoreScale(page)

    const demoRows = await collectMergedDump(page)
    const demoTarget = pickPlayableTarget({ rows: demoRows, pairIndex: 0, staff: 'treble' })
    const demoClickEvents = await runClickPreview({
      page,
      note: demoTarget.note,
      head: demoTarget.head,
    })
    if (!demoClickEvents.some((event) => event.mode === 'click')) {
      throw new Error('Demo click preview did not produce a click event.')
    }

    await importMusicXmlViaDebugApi(page, SAMPLE_MUSIC_XML)
    await setScoreScale(page)

    const importedRows = await collectMergedDump(page)
    const importedTarget = pickPlayableTarget({ rows: importedRows, pairIndex: 0, staff: 'treble' })
    const smoothDrag = await runDragPreview({
      page,
      note: importedTarget.note,
      head: importedTarget.head,
      dragDeltaClientY: DEFAULT_DRAG_DELTA_CLIENT_Y,
      moveSteps: 10,
    })
    if (!smoothDrag.events.some((event) => event.mode === 'drag')) {
      throw new Error('Imported smooth drag did not produce any drag preview event.')
    }

    await importMusicXmlViaDebugApi(page, SAMPLE_MUSIC_XML)
    await setScoreScale(page)
    const importedRowsForFastDrag = await collectMergedDump(page)
    const fastDragTarget = pickPlayableTarget({ rows: importedRowsForFastDrag, pairIndex: 0, staff: 'treble' })
    const fastDrag = await runDragPreview({
      page,
      note: fastDragTarget.note,
      head: fastDragTarget.head,
      dragDeltaClientY: DEFAULT_DRAG_DELTA_CLIENT_Y,
      moveSteps: 1,
    })
    const fastDragEvents = fastDrag.events.filter((event) => event.mode === 'drag')
    const lastFastDragPitch = fastDragEvents[fastDragEvents.length - 1]?.pitch ?? null
    if (!lastFastDragPitch) {
      throw new Error('Imported fast drag did not produce a drag preview event.')
    }
    if (fastDrag.pitchAfter !== lastFastDragPitch) {
      throw new Error(
        `Fast drag final pitch mismatch: preview=${lastFastDragPitch ?? 'null'} committed=${fastDrag.pitchAfter ?? 'null'}`,
      )
    }

    const report = {
      generatedAt: new Date().toISOString(),
      demo: {
        targetNoteId: demoTarget.note.noteId,
        pitchBefore: demoTarget.note.pitch,
        clickEvents: demoClickEvents,
      },
      imported: {
        targetNoteId: importedTarget.note.noteId,
        pitchBefore: importedTarget.note.pitch,
        smoothDragEvents: smoothDrag.events,
        smoothDragPitchAfter: smoothDrag.pitchAfter,
        fastDragEvents: fastDrag.events,
        fastDragPitchAfter: fastDrag.pitchAfter,
      },
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')

    console.log(`Generated: ${outputPath}`)
    console.log(`Demo click events: ${demoClickEvents.length}`)
    console.log(`Imported smooth drag events: ${smoothDrag.events.length}`)
    console.log(`Imported fast drag events: ${fastDrag.events.length}`)

    await browser.close()
  } finally {
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
