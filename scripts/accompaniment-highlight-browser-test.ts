import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

type HighlightComputedStyle = {
  backgroundColor: string
  borderRadius: string
  borderTopWidth: string
  boxShadow: string
}

type HighlightSnapshot = {
  className: string
  style: HighlightComputedStyle
  rect: {
    width: number
    height: number
  }
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4176
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
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.getActiveChordSelection === 'function' &&
      typeof api.getSelectedMeasureHighlightRect === 'function'
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

function pickFirstPlayableBassNote(dump: MeasureDump, pairIndex: number): { note: DumpNoteRow; head: DumpNoteHead } {
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
  return { note, head }
}

async function openRhythmTemplateModal(page: Page): Promise<void> {
  const firstSegmentButton = page.locator('.segment-ruler-block').first()
  await firstSegmentButton.waitFor({ state: 'visible', timeout: 20_000 })
  await firstSegmentButton.dblclick()
  await page.getByRole('dialog', { name: '加载律动模板' }).waitFor({ state: 'visible', timeout: 20_000 })
}

async function resolveTemplateRow(page: Page, templateName: string) {
  const templateRows = page.locator('.rhythm-template-row')
  await templateRows.first().waitFor({ state: 'visible', timeout: 20_000 })
  const matched = templateRows.filter({ hasText: templateName }).first()
  if (await matched.count()) return matched

  const names = await templateRows.evaluateAll((rows) =>
    rows
      .map((row) => row.querySelector('strong')?.textContent?.trim() ?? '')
      .filter((value) => value.length > 0)
      .slice(0, 8),
  )
  throw new Error(`Unable to find rhythm template "${templateName}". Available rows: ${names.join(' | ')}`)
}

async function applyRhythmTemplate(page: Page, templateName: string): Promise<void> {
  const beforeDump = await dumpAllMeasureCoordinates(page)
  const beforeBassCount =
    beforeDump.rows.find((entry) => entry.pairIndex === 0)?.notes.filter((entry) => entry.staff === 'bass').length ?? 0

  const row = await resolveTemplateRow(page, templateName)
  await row.dblclick()
  await page.getByRole('dialog', { name: '加载律动模板' }).waitFor({ state: 'hidden', timeout: 30_000 })
  await page.waitForFunction(
    (countBefore) => {
      const api = (window as unknown as {
        __scoreDebug?: { dumpAllMeasureCoordinates: () => MeasureDump }
      }).__scoreDebug
      if (!api || typeof api.dumpAllMeasureCoordinates !== 'function') return false
      const dump = api.dumpAllMeasureCoordinates()
      const row = dump.rows.find((entry) => entry.pairIndex === 0)
      if (!row?.rendered) return false
      const bassCount = row.notes.filter((entry) => entry.staff === 'bass').length
      return bassCount !== countBefore && bassCount > 0
    },
    beforeBassCount,
    { timeout: 30_000 },
  )
}

async function captureHighlightSnapshot(page: Page, scope: 'editor' | 'modal'): Promise<HighlightSnapshot> {
  const selector =
    scope === 'editor'
      ? '.board .score-stage .score-measure-highlight'
      : '.accompaniment-note-modal-card .score-stage .score-measure-highlight'

  await page.waitForFunction(
    (query) => {
      const node = document.querySelector(query) as HTMLElement | null
      return !!node && node.offsetWidth > 0 && node.offsetHeight > 0
    },
    selector,
    { timeout: 20_000 },
  )

  return page.evaluate((query) => {
    const node = document.querySelector(query) as HTMLElement | null
    if (!node) {
      throw new Error(`Highlight node not found for selector: ${query}`)
    }
    const computed = window.getComputedStyle(node)
    return {
      className: node.className,
      style: {
        backgroundColor: computed.backgroundColor,
        borderRadius: computed.borderRadius,
        borderTopWidth: computed.borderTopWidth,
        boxShadow: computed.boxShadow,
      },
      rect: {
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      },
    }
  }, selector)
}

async function setHighlightOpacity(page: Page, percent: number): Promise<void> {
  await page.locator('#selection-highlight-opacity-range').evaluate((element, value) => {
    const input = element as HTMLInputElement
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, percent)
  await page.waitForTimeout(120)
}

async function clickFirstChordMarker(page: Page): Promise<void> {
  const marker = page.locator('.chord-ruler-marker').first()
  await marker.waitFor({ state: 'visible', timeout: 20_000 })
  await marker.click()
  await page.waitForFunction(() => document.querySelector('.board .score-stage .score-measure-highlight') !== null, {
    timeout: 20_000,
  })
}

async function openAccompanimentModal(page: Page): Promise<void> {
  const dump = await dumpAllMeasureCoordinates(page)
  const { head } = pickFirstPlayableBassNote(dump, 0)
  const point = await toClientPoint(page, head.x, head.y)
  await page.mouse.click(point.x, point.y, { clickCount: 2, delay: 60 })
  await page.getByRole('dialog', { name: '伴奏音符选择' }).waitFor({ state: 'visible', timeout: 20_000 })
}

async function clickFirstAccompanimentCandidate(page: Page): Promise<void> {
  const firstCandidate = page.getByRole('button', { name: '候选小节 1' })
  await firstCandidate.waitFor({ state: 'visible', timeout: 20_000 })
  await firstCandidate.click()
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
  let browser = null

  const styleSnapshots: Record<string, { editor: HighlightSnapshot; modal: HighlightSnapshot }> = {}
  const editorSnapshots: Record<string, HighlightSnapshot> = {}
  const opacityLevels = [20, 42, 60]

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

    await clickFirstChordMarker(page)
    for (const opacity of opacityLevels) {
      await setHighlightOpacity(page, opacity)
      editorSnapshots[String(opacity)] = await captureHighlightSnapshot(page, 'editor')
    }
    await openRhythmTemplateModal(page)
    await applyRhythmTemplate(page, templateName)
    await openAccompanimentModal(page)
    await clickFirstAccompanimentCandidate(page)

    await page.waitForFunction(
      () => document.querySelector('.accompaniment-note-modal-card .score-stage .score-measure-highlight') !== null,
      { timeout: 20_000 },
    )

    for (const opacity of opacityLevels) {
      await setHighlightOpacity(page, opacity)
      const editorSnapshot = editorSnapshots[String(opacity)]
      if (!editorSnapshot) {
        throw new Error(`Missing editor highlight snapshot at ${opacity}%.`)
      }
      const modalSnapshot = await captureHighlightSnapshot(page, 'modal')
      styleSnapshots[String(opacity)] = {
        editor: editorSnapshot,
        modal: modalSnapshot,
      }
      if (editorSnapshot.style.backgroundColor !== modalSnapshot.style.backgroundColor) {
        throw new Error(
          `Highlight background mismatch at ${opacity}%: editor=${editorSnapshot.style.backgroundColor} modal=${modalSnapshot.style.backgroundColor}`,
        )
      }
      if (editorSnapshot.style.borderRadius !== modalSnapshot.style.borderRadius) {
        throw new Error(
          `Highlight border radius mismatch at ${opacity}%: editor=${editorSnapshot.style.borderRadius} modal=${modalSnapshot.style.borderRadius}`,
        )
      }
      if (editorSnapshot.style.borderTopWidth !== modalSnapshot.style.borderTopWidth) {
        throw new Error(
          `Highlight border mismatch at ${opacity}%: editor=${editorSnapshot.style.borderTopWidth} modal=${modalSnapshot.style.borderTopWidth}`,
        )
      }
      if (editorSnapshot.style.boxShadow !== modalSnapshot.style.boxShadow) {
        throw new Error(
          `Highlight box-shadow mismatch at ${opacity}%: editor=${editorSnapshot.style.boxShadow} modal=${modalSnapshot.style.boxShadow}`,
        )
      }
      if (!editorSnapshot.className.split(/\s+/).includes('score-measure-highlight')) {
        throw new Error(`Editor highlight is not using .score-measure-highlight at ${opacity}%`)
      }
      if (!modalSnapshot.className.split(/\s+/).includes('score-measure-highlight')) {
        throw new Error(`Modal highlight is not using .score-measure-highlight at ${opacity}%`)
      }
    }

    const remainingAccompanimentSpecificNodes = await page.evaluate(
      () => document.querySelectorAll('.accompaniment-preview-highlight').length,
    )
    if (remainingAccompanimentSpecificNodes !== 0) {
      throw new Error(`Expected zero .accompaniment-preview-highlight nodes, found ${remainingAccompanimentSpecificNodes}.`)
    }

    const modalHighlight = styleSnapshots['42']?.modal
    if (!modalHighlight) {
      throw new Error('Missing modal highlight snapshot at 42%.')
    }
    if (modalHighlight.rect.height < 80) {
      throw new Error(`Expected accompaniment highlight to cover the grand staff. height=${modalHighlight.rect.height}`)
    }

    await mkdir(DEBUG_OUTPUT_DIR, { recursive: true })
    await writeFile(
      path.join(DEBUG_OUTPUT_DIR, 'accompaniment-highlight-browser-report.json'),
      JSON.stringify(
        {
          xmlPath,
          templateName,
          styleSnapshots,
          modalHighlightHeightAt42: modalHighlight.rect.height,
        },
        null,
        2,
      ),
      'utf8',
    )
    await captureDebugArtifacts(page, 'accompaniment-highlight-browser.png')
    console.log('Accompaniment highlight browser test passed.')
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
