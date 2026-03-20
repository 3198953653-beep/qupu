import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { DEFAULT_DEMO_MEASURE_COUNT } from '../src/score/constants'
import { buildMusicXmlFromMeasurePairs } from '../src/score/musicXml'
import type { ImportFeedback, MeasurePair } from '../src/score/types'

type ChordRulerMarkerDebugRow = {
  key: string
  pairIndex: number
  beatIndex: 1 | 3
  label: string
  startTick: number
  endTick: number
  xPx: number
  anchorSource: 'note-head' | 'spacing-tick' | 'axis' | 'frame'
}

type MeasureCoordinateReport = {
  rows: Array<{
    pairIndex: number
    measureX?: number | null
    measureWidth?: number | null
    renderedMeasureWidthPx?: number | null
    noteStartX?: number | null
    sharedStartDecorationReservePx?: number | null
    actualStartDecorationWidthPx?: number | null
    spacingAnchorTicks?: number[]
    spacingTickToX?: Record<string, number | null>
    spacingOccupiedLeftX?: number | null
    spacingOccupiedRightX?: number | null
    spacingAnchorGapFirstToLastPx?: number | null
    notes: Array<{
      staff: 'treble' | 'bass'
      pitch: string | null
      duration: string | null
      isRest: boolean
      onsetTicksInMeasure?: number | null
    }>
  }>
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4175
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const CHORD_LABEL_LEFT_INSET_PX = 8
const SCORE_STAGE_BORDER_PX = 1

function buildTwoHalfNoteImportXml(): string {
  const measurePairs: MeasurePair[] = Array.from({ length: DEFAULT_DEMO_MEASURE_COUNT }, (_, measureIndex) => ({
    treble: [
      { id: `two-half-treble-${measureIndex}-0`, pitch: 'c/5', duration: 'h' },
      { id: `two-half-treble-${measureIndex}-1`, pitch: 'c/5', duration: 'h' },
    ],
    bass: [
      { id: `two-half-bass-${measureIndex}-0`, pitch: 'c/3', duration: 'h' },
      { id: `two-half-bass-${measureIndex}-1`, pitch: 'c/3', duration: 'h' },
    ],
  }))
  return buildMusicXmlFromMeasurePairs({
    measurePairs,
    timeSignaturesByMeasure: Array.from({ length: DEFAULT_DEMO_MEASURE_COUNT }, () => ({ beats: 4, beatType: 4 })),
  })
}

function buildDecorationChangeImportXml(): string {
  const measureCount = 4
  const measurePairs: MeasurePair[] = Array.from({ length: measureCount }, (_, measureIndex) => ({
    treble: [
      { id: `decor-change-treble-${measureIndex}-0`, pitch: 'c/5', duration: 'h' },
      { id: `decor-change-treble-${measureIndex}-1`, pitch: 'c/5', duration: 'h' },
    ],
    bass: [
      { id: `decor-change-bass-${measureIndex}-0`, pitch: 'c/3', duration: 'h' },
      { id: `decor-change-bass-${measureIndex}-1`, pitch: 'c/3', duration: 'h' },
    ],
  }))
  return buildMusicXmlFromMeasurePairs({
    measurePairs,
    keyFifthsByMeasure: [0, 0, 2, 2],
    timeSignaturesByMeasure: [
      { beats: 4, beatType: 4 },
      { beats: 4, beatType: 4 },
      { beats: 2, beatType: 2 },
      { beats: 2, beatType: 2 },
    ],
  })
}

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
    server.stdout?.destroy()
    server.stderr?.destroy()
    server.once('exit', () => resolve())
    if (process.platform === 'win32' && server.pid) {
      const killer = spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.unref()
      server.unref()
      setTimeout(() => resolve(), 1000)
      resolve()
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
      typeof api.getChordRulerMarkers === 'function' &&
      typeof api.importMusicXmlText === 'function' &&
      typeof api.getImportFeedback === 'function'
    )
  })
}

async function clickButton(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label }).first()
  await button.waitFor()
  await button.evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
}

async function ensureSpacingPanelOpen(page: Page): Promise<void> {
  const slider = page.locator('#min-measure-width-range')
  if (await slider.isVisible().catch(() => false)) {
    return
  }
  await clickButton(page, '间距大小')
  await slider.waitFor()
}

async function setInputValue(page: Page, selector: string, value: number): Promise<void> {
  const input = page.locator(selector)
  await input.waitFor()
  await input.evaluate((element, nextValue) => {
    const target = element as HTMLInputElement
    target.value = String(nextValue)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function getInputValue(page: Page, selector: string): Promise<number> {
  const input = page.locator(selector)
  await input.waitFor()
  return Number(await input.inputValue())
}

async function clickSpacingReset(page: Page): Promise<void> {
  const button = page.locator('.spacing-reset-btn')
  await button.waitFor()
  await button.evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
}

async function getChordMarkers(page: Page): Promise<ChordRulerMarkerDebugRow[]> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getChordRulerMarkers: () => ChordRulerMarkerDebugRow[]
      }
    }).__scoreDebug
    return api.getChordRulerMarkers()
  })
}

async function getMeasureCoordinates(page: Page): Promise<MeasureCoordinateReport> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        dumpAllMeasureCoordinates: () => MeasureCoordinateReport
      }
    }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
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

async function getMarkerDomLeft(page: Page, ariaLabel: string): Promise<number> {
  const marker = page.getByRole('button', { name: ariaLabel })
  await marker.waitFor()
  return marker.evaluate((element) => {
    const button = element as HTMLButtonElement
    const parent = button.parentElement
    if (!parent) {
      throw new Error('Chord marker parent element is missing.')
    }
    const parentRect = parent.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    return buttonRect.left - parentRect.left
  })
}

async function hasChordHighlight(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelector('.score-measure-highlight') !== null)
}

async function isButtonActive(page: Page, label: string): Promise<boolean> {
  const button = page.getByRole('button', { name: label }).first()
  await button.waitFor()
  return button.evaluate((element) => element.classList.contains('active'))
}

async function verifyBuiltInDemoButtonLocation(page: Page): Promise<void> {
  const location = await page.evaluate(() => {
    const importActions = document.querySelector('.import-actions')
    const rhythmRow = document.querySelector('.rhythm-row')
    if (!importActions) {
      throw new Error('Missing .import-actions container.')
    }
    if (!rhythmRow) {
      throw new Error('Missing .rhythm-row container.')
    }

    const buttonsInImportActions = Array.from(importActions.querySelectorAll('button')).map((button) =>
      button.textContent?.trim() ?? '',
    )
    const buttonsInRhythmRow = Array.from(rhythmRow.querySelectorAll('button')).map((button) =>
      button.textContent?.trim() ?? '',
    )

    return {
      buttonsInImportActions,
      buttonsInRhythmRow,
      wholeNoteIndexInRhythmRow: buttonsInRhythmRow.indexOf('加载全音符示例'),
      halfNoteIndexInRhythmRow: buttonsInRhythmRow.indexOf('加载二分音符示例'),
    }
  })

  if (location.buttonsInImportActions.includes('加载全音符示例')) {
    throw new Error('Whole-note demo button should not appear inside .import-actions.')
  }
  if (location.buttonsInImportActions.includes('加载二分音符示例')) {
    throw new Error('Half-note demo button should not appear inside .import-actions.')
  }
  if (location.wholeNoteIndexInRhythmRow === -1) {
    throw new Error('Whole-note demo button is missing from .rhythm-row.')
  }
  if (location.wholeNoteIndexInRhythmRow !== 0) {
    throw new Error(
      `Whole-note demo button should be the first button in .rhythm-row, got index ${location.wholeNoteIndexInRhythmRow}.`,
    )
  }
  if (location.halfNoteIndexInRhythmRow === -1) {
    throw new Error('Half-note demo button is missing from .rhythm-row.')
  }
  if (location.halfNoteIndexInRhythmRow !== 1) {
    throw new Error(
      `Half-note demo button should be the second button in .rhythm-row, got index ${location.halfNoteIndexInRhythmRow}.`,
    )
  }
}

function findMarker(rows: ChordRulerMarkerDebugRow[], pairIndex: number, beatIndex: 1 | 3): ChordRulerMarkerDebugRow {
  const marker = rows.find((row) => row.pairIndex === pairIndex && row.beatIndex === beatIndex)
  if (!marker) {
    throw new Error(`Missing chord marker for pairIndex=${pairIndex} beatIndex=${beatIndex}.`)
  }
  return marker
}

async function waitForWholeNoteDemo(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        dumpAllMeasureCoordinates: () => MeasureCoordinateReport
      }
    }).__scoreDebug
    const report = api.dumpAllMeasureCoordinates()
    const firstRow = report.rows[0]
    if (!firstRow) return false
    const trebleNotes = firstRow.notes.filter((note) => note.staff === 'treble' && !note.isRest)
    const bassNotes = firstRow.notes.filter((note) => note.staff === 'bass' && !note.isRest)
    return (
      trebleNotes.length === 1 &&
      bassNotes.length === 1 &&
      trebleNotes[0]?.pitch === 'c/5' &&
      trebleNotes[0]?.duration === 'w' &&
      bassNotes[0]?.pitch === 'c/3' &&
      bassNotes[0]?.duration === 'w'
    )
  })
}

async function waitForHalfNoteDemo(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        dumpAllMeasureCoordinates: () => MeasureCoordinateReport
      }
    }).__scoreDebug
    const report = api.dumpAllMeasureCoordinates()
    const firstRow = report.rows[0]
    if (!firstRow) return false
    const trebleNotes = firstRow.notes.filter((note) => note.staff === 'treble' && !note.isRest)
    const bassNotes = firstRow.notes.filter((note) => note.staff === 'bass' && !note.isRest)
    const trebleTicks = trebleNotes.map((note) => note.onsetTicksInMeasure)
    const bassTicks = bassNotes.map((note) => note.onsetTicksInMeasure)
    return (
      trebleNotes.length === 2 &&
      bassNotes.length === 2 &&
      trebleNotes.every((note) => note.pitch === 'c/5' && note.duration === 'h') &&
      bassNotes.every((note) => note.pitch === 'c/3' && note.duration === 'h') &&
      trebleTicks.join(',') === '0,32' &&
      bassTicks.join(',') === '0,32'
    )
  })
}

async function waitForDefaultDemo(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        dumpAllMeasureCoordinates: () => MeasureCoordinateReport
      }
    }).__scoreDebug
    const report = api.dumpAllMeasureCoordinates()
    const firstRow = report.rows[0]
    if (!firstRow) return false
    const trebleNotes = firstRow.notes.filter((note) => note.staff === 'treble' && !note.isRest)
    const bassNotes = firstRow.notes.filter((note) => note.staff === 'bass' && !note.isRest)
    return (
      trebleNotes.length >= 4 &&
      bassNotes.length >= 4 &&
      trebleNotes[0]?.pitch === 'c/5' &&
      trebleNotes[0]?.duration === 'q' &&
      bassNotes[0]?.pitch === 'c/3' &&
      bassNotes[0]?.duration === 'q'
    )
  })
}

async function waitForTwoHalfImport(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        dumpAllMeasureCoordinates: () => MeasureCoordinateReport
      }
    }).__scoreDebug
    const report = api.dumpAllMeasureCoordinates()
    const firstRow = report.rows[0]
    if (!firstRow) return false
    const trebleNotes = firstRow.notes.filter((note) => note.staff === 'treble' && !note.isRest)
    const bassNotes = firstRow.notes.filter((note) => note.staff === 'bass' && !note.isRest)
    return (
      trebleNotes.length === 2 &&
      bassNotes.length === 2 &&
      trebleNotes.every((note) => note.pitch === 'c/5' && note.duration === 'h') &&
      bassNotes.every((note) => note.pitch === 'c/3' && note.duration === 'h')
    )
  })
}

function getSpacingTickX(row: MeasureCoordinateReport['rows'][number], tick: number): number {
  const value = row.spacingTickToX?.[String(tick)] ?? null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing spacingTickToX for tick ${tick}.`)
  }
  return value
}

function getSpacingGap(row: MeasureCoordinateReport['rows'][number], startTick: number, endTick: number): number {
  if (typeof row.spacingAnchorGapFirstToLastPx === 'number' && Number.isFinite(row.spacingAnchorGapFirstToLastPx)) {
    return row.spacingAnchorGapFirstToLastPx
  }
  return getSpacingTickX(row, endTick) - getSpacingTickX(row, startTick)
}

function getRequiredMeasureWidth(row: MeasureCoordinateReport['rows'][number], label: string): number {
  if (typeof row.measureWidth !== 'number' || !Number.isFinite(row.measureWidth)) {
    throw new Error(`${label} measureWidth is missing.`)
  }
  return row.measureWidth
}

function getRequiredRenderedMeasureWidth(row: MeasureCoordinateReport['rows'][number], label: string): number {
  if (typeof row.renderedMeasureWidthPx !== 'number' || !Number.isFinite(row.renderedMeasureWidthPx)) {
    throw new Error(`${label} renderedMeasureWidthPx is missing.`)
  }
  return row.renderedMeasureWidthPx
}

function getRequiredMeasureStartInset(row: MeasureCoordinateReport['rows'][number], label: string): number {
  if (typeof row.measureX !== 'number' || !Number.isFinite(row.measureX)) {
    throw new Error(`${label} measureX is missing.`)
  }
  if (typeof row.noteStartX !== 'number' || !Number.isFinite(row.noteStartX)) {
    throw new Error(`${label} noteStartX is missing.`)
  }
  return row.noteStartX - row.measureX
}

function getRequiredActualStartDecorationWidth(row: MeasureCoordinateReport['rows'][number], label: string): number {
  if (
    typeof row.actualStartDecorationWidthPx !== 'number' ||
    !Number.isFinite(row.actualStartDecorationWidthPx)
  ) {
    throw new Error(`${label} actualStartDecorationWidthPx is missing.`)
  }
  return row.actualStartDecorationWidthPx
}

async function main() {
  const outputPath = process.argv[2] ?? path.resolve('debug', 'chord-marker-browser-report.json')
  const devServer = startDevServer()
  let browser: Browser | null = null
  devServer.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('Local:') || text.includes('ready in')) {
      process.stdout.write(text)
    }
  })
  devServer.stderr?.on('data', (chunk) => process.stderr.write(chunk.toString()))

  try {
    await waitForServer(DEV_URL, 45_000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)
    await waitForDefaultDemo(page)
    await verifyBuiltInDemoButtonLocation(page)

    if (!(await isButtonActive(page, '四分脉冲'))) {
      throw new Error('Quarter preset should be active in the default demo.')
    }
    if (await isButtonActive(page, '加载全音符示例')) {
      throw new Error('Whole-note demo button should be inactive in the default demo.')
    }
    if (await isButtonActive(page, '加载二分音符示例')) {
      throw new Error('Half-note demo button should be inactive in the default demo.')
    }

    const defaultMarkers = await getChordMarkers(page)
    const defaultBeat1Marker = findMarker(defaultMarkers, 0, 1)
    const defaultBeat3Marker = findMarker(defaultMarkers, 0, 3)
    if (defaultBeat1Marker.anchorSource !== 'note-head') {
      throw new Error(`Expected default beat 1 marker to use note-head anchor, got ${defaultBeat1Marker.anchorSource}.`)
    }
    if (defaultBeat3Marker.anchorSource !== 'note-head') {
      throw new Error(`Expected default beat 3 marker to use note-head anchor, got ${defaultBeat3Marker.anchorSource}.`)
    }
    if (defaultBeat3Marker.xPx <= defaultBeat1Marker.xPx + 10) {
      throw new Error(
        `Default demo beat 3 marker did not move right of beat 1 marker: beat1=${defaultBeat1Marker.xPx} beat3=${defaultBeat3Marker.xPx}.`,
      )
    }

    await clickButton(page, '加载全音符示例')
    await waitForWholeNoteDemo(page)

    if (!(await isButtonActive(page, '加载全音符示例'))) {
      throw new Error('Whole-note demo button should become active after loading the whole-note demo.')
    }
    if (await isButtonActive(page, '加载二分音符示例')) {
      throw new Error('Half-note demo button should stay inactive while the whole-note demo is active.')
    }
    if (await isButtonActive(page, '四分脉冲')) {
      throw new Error('Rhythm preset buttons should not stay active while a built-in demo is active.')
    }

    const wholeDefaultReport = await getMeasureCoordinates(page)
    const wholeDefaultFirstRow = wholeDefaultReport.rows[0]
    if (!wholeDefaultFirstRow) {
      throw new Error('Whole-note demo measure report is missing the first row.')
    }

    const wholeMarkers = await getChordMarkers(page)
    const wholeBeat1Marker = findMarker(wholeMarkers, 0, 1)
    const wholeBeat3Marker = findMarker(wholeMarkers, 0, 3)
    if (wholeBeat1Marker.anchorSource !== 'note-head') {
      throw new Error(`Expected whole-note beat 1 marker to use note-head anchor, got ${wholeBeat1Marker.anchorSource}.`)
    }
    if (wholeBeat3Marker.anchorSource !== 'spacing-tick') {
      throw new Error(`Expected whole-note beat 3 marker to use spacing-tick anchor, got ${wholeBeat3Marker.anchorSource}.`)
    }
    if (wholeBeat3Marker.xPx <= wholeBeat1Marker.xPx + 10) {
      throw new Error(
        `Whole-note beat 3 marker did not gain its own x position: beat1=${wholeBeat1Marker.xPx} beat3=${wholeBeat3Marker.xPx}.`,
      )
    }
    const wholeSpacingAnchorTicks = wholeDefaultFirstRow.spacingAnchorTicks ?? []
    if (!wholeSpacingAnchorTicks.includes(wholeBeat3Marker.startTick)) {
      throw new Error(
        `Whole-note spacing anchors are missing beat 3 tick ${wholeBeat3Marker.startTick}: ${wholeSpacingAnchorTicks.join(', ')}.`,
      )
    }
    const wholeBeat1SpacingX = wholeDefaultFirstRow.spacingTickToX?.[String(wholeBeat1Marker.startTick)] ?? null
    const wholeBeat3SpacingX = wholeDefaultFirstRow.spacingTickToX?.[String(wholeBeat3Marker.startTick)] ?? null
    if (typeof wholeBeat1SpacingX !== 'number' || !Number.isFinite(wholeBeat1SpacingX)) {
      throw new Error('Whole-note beat 1 spacingTickToX is missing.')
    }
    if (typeof wholeBeat3SpacingX !== 'number' || !Number.isFinite(wholeBeat3SpacingX)) {
      throw new Error('Whole-note beat 3 spacingTickToX is missing.')
    }
    const wholeBeat1AnchorX = wholeBeat1Marker.xPx + CHORD_LABEL_LEFT_INSET_PX - SCORE_STAGE_BORDER_PX
    const wholeBeat3AnchorX = wholeBeat3Marker.xPx + CHORD_LABEL_LEFT_INSET_PX - SCORE_STAGE_BORDER_PX
    if (Math.abs(wholeBeat1AnchorX - wholeBeat1SpacingX) > 1.5) {
      throw new Error(
        `Whole-note beat 1 marker anchor does not match spacingTickToX: marker=${wholeBeat1AnchorX} spacing=${wholeBeat1SpacingX}.`,
      )
    }
    if (Math.abs(wholeBeat3AnchorX - wholeBeat3SpacingX) > 1.5) {
      throw new Error(
        `Whole-note beat 3 marker anchor does not match spacingTickToX: marker=${wholeBeat3AnchorX} spacing=${wholeBeat3SpacingX}.`,
      )
    }

    const wholeBeat1DomLeft = await getMarkerDomLeft(page, '第1小节第1拍和弦 C')
    const wholeBeat3DomLeft = await getMarkerDomLeft(page, '第1小节第3拍和弦 Am')
    if (Math.abs(wholeBeat1DomLeft - wholeBeat1Marker.xPx) > 1.5) {
      throw new Error(
        `Whole-note beat 1 DOM left does not match debug x: dom=${wholeBeat1DomLeft} debug=${wholeBeat1Marker.xPx}.`,
      )
    }
    if (Math.abs(wholeBeat3DomLeft - wholeBeat3Marker.xPx) > 1.5) {
      throw new Error(
        `Whole-note beat 3 DOM left does not match debug x: dom=${wholeBeat3DomLeft} debug=${wholeBeat3Marker.xPx}.`,
      )
    }
    if (wholeBeat3DomLeft <= wholeBeat1DomLeft + 10) {
      throw new Error(
        `Whole-note beat 3 DOM marker still overlaps beat 1: beat1=${wholeBeat1DomLeft} beat3=${wholeBeat3DomLeft}.`,
      )
    }

    await clickButton(page, '第1小节第3拍和弦 Am')
    await page.waitForTimeout(100)
    if (await hasChordHighlight(page)) {
      throw new Error('Whole-note beat 3 marker should not create a highlight for a carried whole note.')
    }

    await clickButton(page, '第1小节第1拍和弦 C')
    await page.waitForFunction(() => document.querySelector('.score-measure-highlight') !== null)

    await ensureSpacingPanelOpen(page)

    const defaultMinMeasureWidthPx = await getInputValue(page, '#min-measure-width-input')
    if (defaultMinMeasureWidthPx !== 120) {
      throw new Error(`Expected default min measure width to be 120, got ${defaultMinMeasureWidthPx}.`)
    }

    const wholeDefaultWidth = getRequiredMeasureWidth(wholeDefaultFirstRow, 'Whole-note default first')
    const wholeDefaultRenderedWidth = getRequiredRenderedMeasureWidth(wholeDefaultFirstRow, 'Whole-note default first')
    const wholeDefaultGap = getSpacingGap(wholeDefaultFirstRow, 0, 32)
    if (wholeDefaultWidth < 120) {
      throw new Error(`Whole-note default first measure should respect the 120px floor, got ${wholeDefaultWidth}.`)
    }
    if (wholeDefaultRenderedWidth < wholeDefaultWidth + 8) {
      throw new Error(
        `Whole-note first measure should render wider than its content width when start decorations exist: content=${wholeDefaultWidth.toFixed(3)} rendered=${wholeDefaultRenderedWidth.toFixed(3)}.`,
      )
    }

    await setInputValue(page, '#min-measure-width-input', 200)
    await page.waitForFunction(
      ({ previousWidth, previousGap }) => {
        const api = (window as unknown as {
          __scoreDebug: {
            dumpAllMeasureCoordinates: () => MeasureCoordinateReport
          }
        }).__scoreDebug
        const row = api.dumpAllMeasureCoordinates().rows[0]
        if (!row || typeof row.measureWidth !== 'number' || !Number.isFinite(row.measureWidth)) return false
        const spacing = row.spacingTickToX ?? {}
        const fallbackGap = Number(spacing['32']) - Number(spacing['0'])
        const gap =
          typeof row.spacingAnchorGapFirstToLastPx === 'number' && Number.isFinite(row.spacingAnchorGapFirstToLastPx)
            ? row.spacingAnchorGapFirstToLastPx
            : fallbackGap
        return row.measureWidth >= 199.5 && row.measureWidth > previousWidth + 8 && gap > previousGap + 8
      },
      { previousWidth: wholeDefaultWidth, previousGap: wholeDefaultGap },
    )

    const wholeExpandedReport = await getMeasureCoordinates(page)
    const wholeExpandedFirstRow = wholeExpandedReport.rows[0]
    if (!wholeExpandedFirstRow) {
      throw new Error('Expanded whole-note report is missing the first row.')
    }
    const wholeExpandedWidth = getRequiredMeasureWidth(wholeExpandedFirstRow, 'Whole-note expanded first')
    const wholeExpandedGap = getSpacingGap(wholeExpandedFirstRow, 0, 32)
    if (wholeExpandedWidth < 199.5) {
      throw new Error(`Whole-note first measure should expand to the 200px floor, got ${wholeExpandedWidth}.`)
    }
    if (wholeExpandedGap <= wholeDefaultGap + 8) {
      throw new Error(
        `Whole-note spacing gap should grow with the wider measure: default=${wholeDefaultGap.toFixed(3)} expanded=${wholeExpandedGap.toFixed(3)}.`,
      )
    }

    await clickSpacingReset(page)
    await page.waitForFunction(() => {
      const input = document.querySelector('#min-measure-width-input') as HTMLInputElement | null
      return input?.value === '120'
    })
    await page.waitForFunction(
      ({ baselineWidth, baselineGap }) => {
        const api = (window as unknown as {
          __scoreDebug: {
            dumpAllMeasureCoordinates: () => MeasureCoordinateReport
          }
        }).__scoreDebug
        const row = api.dumpAllMeasureCoordinates().rows[0]
        if (!row || typeof row.measureWidth !== 'number' || !Number.isFinite(row.measureWidth)) return false
        const spacing = row.spacingTickToX ?? {}
        const fallbackGap = Number(spacing['32']) - Number(spacing['0'])
        const gap =
          typeof row.spacingAnchorGapFirstToLastPx === 'number' && Number.isFinite(row.spacingAnchorGapFirstToLastPx)
            ? row.spacingAnchorGapFirstToLastPx
            : fallbackGap
        return Math.abs(row.measureWidth - baselineWidth) <= 1.5 && Math.abs(gap - baselineGap) <= 1.5
      },
      { baselineWidth: wholeDefaultWidth, baselineGap: wholeDefaultGap },
    )

    const wholeResetSpacingReport = await getMeasureCoordinates(page)
    const wholeResetSpacingFirstRow = wholeResetSpacingReport.rows[0]
    if (!wholeResetSpacingFirstRow) {
      throw new Error('Whole-note report is missing after spacing reset.')
    }

    await clickButton(page, '加载二分音符示例')
    await waitForHalfNoteDemo(page)

    if (!(await isButtonActive(page, '加载二分音符示例'))) {
      throw new Error('Half-note demo button should become active after loading the half-note demo.')
    }
    if (await isButtonActive(page, '加载全音符示例')) {
      throw new Error('Whole-note demo button should turn inactive after switching to the half-note demo.')
    }
    if (await isButtonActive(page, '四分脉冲')) {
      throw new Error('Rhythm preset buttons should stay inactive while the half-note demo is active.')
    }

    const halfDemoReport = await getMeasureCoordinates(page)
    const halfDemoFirstRow = halfDemoReport.rows[0]
    if (!halfDemoFirstRow) {
      throw new Error('Half-note demo measure report is missing the first row.')
    }
    const halfDemoComparableRows = halfDemoReport.rows.slice(0, Math.min(4, halfDemoReport.rows.length))
    if (halfDemoComparableRows.length < 2) {
      throw new Error('Half-note demo should expose at least two comparable measures.')
    }
    const halfDemoBaselineWidth = getRequiredMeasureWidth(halfDemoComparableRows[0], 'Half-note baseline row 0')
    const halfDemoBaselineGap = getSpacingGap(halfDemoComparableRows[0], 0, 32)
    const halfDemoBaselineActualDecoration = getRequiredActualStartDecorationWidth(
      halfDemoComparableRows[0],
      'Half-note baseline row 0',
    )
    if (halfDemoBaselineActualDecoration <= 0) {
      throw new Error(`Half-note first measure should report a positive actual start decoration width, got ${halfDemoBaselineActualDecoration}.`)
    }
    halfDemoComparableRows.forEach((row, rowIndex) => {
      const width = getRequiredMeasureWidth(row, `Half-note row ${rowIndex}`)
      const renderedWidth = getRequiredRenderedMeasureWidth(row, `Half-note row ${rowIndex}`)
      const inset = getRequiredMeasureStartInset(row, `Half-note row ${rowIndex}`)
      const gap = getSpacingGap(row, 0, 32)
      const actualDecoration = getRequiredActualStartDecorationWidth(row, `Half-note row ${rowIndex}`)
      if (rowIndex === 0) {
        if (Math.abs(inset - halfDemoBaselineActualDecoration) > 1.5) {
          throw new Error(
            `Half-note first measure inset should match its actual decoration width: inset=${inset.toFixed(3)} actual=${halfDemoBaselineActualDecoration.toFixed(3)}.`,
          )
        }
        if (renderedWidth < width + 8) {
          throw new Error(
            `Half-note first measure should render wider than its content width when decorated: content=${width.toFixed(3)} rendered=${renderedWidth.toFixed(3)}.`,
          )
        }
        return
      }
      if (actualDecoration !== 0) {
        throw new Error(`Half-note row ${rowIndex} should not report start decorations, got ${actualDecoration}.`)
      }
      if (Math.abs(inset) > 1.5) {
        throw new Error(`Half-note row ${rowIndex} should start at the barline axis, got inset=${inset.toFixed(3)}.`)
      }
      if (Math.abs(width - halfDemoBaselineWidth) > 1.5) {
        throw new Error(
          `Half-note content width should match across equal-content measures: row0=${halfDemoBaselineWidth.toFixed(3)} row${rowIndex}=${width.toFixed(3)}.`,
        )
      }
      if (Math.abs(gap - halfDemoBaselineGap) > 1.5) {
        throw new Error(
          `Half-note demo spacing gap should match across measures: row0=${halfDemoBaselineGap.toFixed(3)} row${rowIndex}=${gap.toFixed(3)}.`,
        )
      }
      if (Math.abs(renderedWidth - width) > 1.5) {
        throw new Error(
          `Half-note undecorated measures should not report extra rendered width: content=${width.toFixed(3)} rendered=${renderedWidth.toFixed(3)}.`,
        )
      }
    })
    const halfTrebleNotes = halfDemoFirstRow.notes.filter((note) => note.staff === 'treble' && !note.isRest)
    const halfBassNotes = halfDemoFirstRow.notes.filter((note) => note.staff === 'bass' && !note.isRest)
    if (halfTrebleNotes.length !== 2 || halfBassNotes.length !== 2) {
      throw new Error(
        `Half-note demo should render two notes per staff, got treble=${halfTrebleNotes.length} bass=${halfBassNotes.length}.`,
      )
    }
    if (
      halfTrebleNotes.map((note) => note.onsetTicksInMeasure).join(',') !== '0,32' ||
      halfBassNotes.map((note) => note.onsetTicksInMeasure).join(',') !== '0,32'
    ) {
      throw new Error(
        `Half-note demo note onsets should be [0,32], got treble=[${halfTrebleNotes.map((note) => note.onsetTicksInMeasure).join(',')}] bass=[${halfBassNotes.map((note) => note.onsetTicksInMeasure).join(',')}].`,
      )
    }

    const halfMarkers = await getChordMarkers(page)
    const halfBeat1Marker = findMarker(halfMarkers, 0, 1)
    const halfBeat3Marker = findMarker(halfMarkers, 0, 3)
    if (halfBeat1Marker.anchorSource !== 'note-head' || halfBeat3Marker.anchorSource !== 'note-head') {
      throw new Error(
        `Half-note demo markers should align to note-heads: beat1=${halfBeat1Marker.anchorSource} beat3=${halfBeat3Marker.anchorSource}.`,
      )
    }
    if (halfBeat3Marker.xPx <= halfBeat1Marker.xPx + 10) {
      throw new Error(
        `Half-note demo beat 3 marker should sit to the right of beat 1: beat1=${halfBeat1Marker.xPx} beat3=${halfBeat3Marker.xPx}.`,
      )
    }

    const decorationChangeImportXml = buildDecorationChangeImportXml()
    await importMusicXmlViaDebugApi(page, decorationChangeImportXml)
    await waitForTwoHalfImport(page)

    const decorationChangeReport = await getMeasureCoordinates(page)
    const decorationRows = decorationChangeReport.rows.slice(0, 4)
    if (decorationRows.length < 4) {
      throw new Error(`Decoration-change import should expose 4 measures, got ${decorationRows.length}.`)
    }
    const changedMeasureRow = decorationRows[2]
    const plainMeasureRow = decorationRows[1]
    const baselineMeasureRow = decorationRows[0]
    const baselineActualDecoration = getRequiredActualStartDecorationWidth(baselineMeasureRow, 'Decoration baseline row 0')
    const plainActualDecoration = getRequiredActualStartDecorationWidth(plainMeasureRow, 'Decoration plain row 1')
    const changedActualDecoration = getRequiredActualStartDecorationWidth(changedMeasureRow, 'Decoration changed row 2')
    if (baselineActualDecoration <= 0) {
      throw new Error(`Decoration baseline row 0 should report a positive actual decoration width, got ${baselineActualDecoration}.`)
    }
    if (plainActualDecoration !== 0) {
      throw new Error(`Decoration plain row 1 should not report start decorations, got ${plainActualDecoration}.`)
    }
    if (changedActualDecoration <= 0) {
      throw new Error(`Decoration changed row 2 should report a positive actual decoration width, got ${changedActualDecoration}.`)
    }
    const changedInset = getRequiredMeasureStartInset(changedMeasureRow, 'Decoration changed row 2')
    const baselineInset = getRequiredMeasureStartInset(baselineMeasureRow, 'Decoration baseline row 0')
    const plainInset = getRequiredMeasureStartInset(plainMeasureRow, 'Decoration plain row 1')
    if (Math.abs(baselineInset - baselineActualDecoration) > 1.5) {
      throw new Error(
        `Decoration baseline row 0 inset should match its actual decoration width: inset=${baselineInset.toFixed(3)} actual=${baselineActualDecoration.toFixed(3)}.`,
      )
    }
    if (Math.abs(plainInset) > 1.5) {
      throw new Error(
        `Decoration plain row 1 should start at the barline axis, got inset=${plainInset.toFixed(3)}.`,
      )
    }
    if (Math.abs(changedInset - changedActualDecoration) > 1.5) {
      throw new Error(
        `Decoration changed row 2 inset should match its actual decoration width: inset=${changedInset.toFixed(3)} actual=${changedActualDecoration.toFixed(3)}.`,
      )
    }
    const changedGap = getSpacingGap(changedMeasureRow, 0, 32)
    const baselineGap = getSpacingGap(baselineMeasureRow, 0, 32)
    const plainGap = getSpacingGap(plainMeasureRow, 0, 32)
    if (Math.abs(changedGap - baselineGap) > 1.5 || Math.abs(plainGap - baselineGap) > 1.5) {
      throw new Error(
        `Decoration-change import should keep identical spacing gap across measures: row0=${baselineGap.toFixed(3)} row1=${plainGap.toFixed(3)} row2=${changedGap.toFixed(3)}.`,
      )
    }
    const changedWidth = getRequiredMeasureWidth(changedMeasureRow, 'Decoration changed row 2')
    const baselineWidth = getRequiredMeasureWidth(baselineMeasureRow, 'Decoration baseline row 0')
    const plainWidth = getRequiredMeasureWidth(plainMeasureRow, 'Decoration plain row 1')
    const changedRenderedWidth = getRequiredRenderedMeasureWidth(changedMeasureRow, 'Decoration changed row 2')
    const baselineRenderedWidth = getRequiredRenderedMeasureWidth(baselineMeasureRow, 'Decoration baseline row 0')
    const plainRenderedWidth = getRequiredRenderedMeasureWidth(plainMeasureRow, 'Decoration plain row 1')
    if (
      Math.abs(changedWidth - plainWidth) > 1.5 ||
      Math.abs(baselineWidth - plainWidth) > 1.5
    ) {
      throw new Error(
        `Decoration-change import should keep content width aligned across equal-content measures: row0=${baselineWidth.toFixed(3)} row1=${plainWidth.toFixed(3)} row2=${changedWidth.toFixed(3)}.`,
      )
    }
    if (changedRenderedWidth < plainRenderedWidth + 8 || baselineRenderedWidth < plainRenderedWidth + 8) {
      throw new Error(
        `Decorated measures should render wider than plain measures after separating content width: row0=${baselineRenderedWidth.toFixed(3)} row1=${plainRenderedWidth.toFixed(3)} row2=${changedRenderedWidth.toFixed(3)}.`,
      )
    }

    const twoHalfImportXml = buildTwoHalfNoteImportXml()
    await importMusicXmlViaDebugApi(page, twoHalfImportXml)
    await waitForTwoHalfImport(page)

    if (await isButtonActive(page, '加载全音符示例') || await isButtonActive(page, '加载二分音符示例')) {
      throw new Error('Built-in demo buttons should clear their active state after importing MusicXML.')
    }

    const twoHalfReport = await getMeasureCoordinates(page)
    const twoHalfFirstRow = twoHalfReport.rows[0]
    if (!twoHalfFirstRow) {
      throw new Error('Two-half-note import report is missing the first row.')
    }

    const wholeAnchorTicks = wholeResetSpacingFirstRow.spacingAnchorTicks ?? []
    const twoHalfAnchorTicks = twoHalfFirstRow.spacingAnchorTicks ?? []
    if (wholeAnchorTicks.join(',') !== '0,32') {
      throw new Error(`Whole-note demo spacing anchors should be [0,32], got [${wholeAnchorTicks.join(',')}].`)
    }
    if (twoHalfAnchorTicks.join(',') !== '0,32') {
      throw new Error(`Two-half import spacing anchors should be [0,32], got [${twoHalfAnchorTicks.join(',')}].`)
    }

    const wholeGap = getSpacingGap(wholeResetSpacingFirstRow, 0, 32)
    const twoHalfGap = getSpacingGap(twoHalfFirstRow, 0, 32)
    const wholeWidth = getRequiredMeasureWidth(wholeResetSpacingFirstRow, 'Whole-note reset first')
    const twoHalfWidth = getRequiredMeasureWidth(twoHalfFirstRow, 'Two-half first')
    if (wholeGap < twoHalfGap * 0.9) {
      throw new Error(
        `Whole-note spacing gap still collapsed too much: whole=${wholeGap.toFixed(3)} twoHalf=${twoHalfGap.toFixed(3)}.`,
      )
    }
    if (wholeWidth < twoHalfWidth * 0.88) {
      throw new Error(
        `Whole-note measure width is still too narrow: whole=${wholeWidth.toFixed(3)} twoHalf=${twoHalfWidth.toFixed(3)}.`,
      )
    }
    if (twoHalfWidth < 120) {
      throw new Error(`Two-half first measure should not shrink below the 120px floor, got ${twoHalfWidth}.`)
    }

    await clickButton(page, '重置')
    await waitForDefaultDemo(page)

    if (!(await isButtonActive(page, '四分脉冲'))) {
      throw new Error('Quarter preset should be active again after reset.')
    }
    if (await isButtonActive(page, '加载全音符示例') || await isButtonActive(page, '加载二分音符示例')) {
      throw new Error('Built-in demo buttons should be inactive again after reset.')
    }

    const resetMarkers = await getChordMarkers(page)
    const resetBeat1Marker = findMarker(resetMarkers, 0, 1)
    const resetBeat3Marker = findMarker(resetMarkers, 0, 3)
    if (resetBeat1Marker.anchorSource !== 'note-head' || resetBeat3Marker.anchorSource !== 'note-head') {
      throw new Error(
        `Default demo markers regressed after reset: beat1=${resetBeat1Marker.anchorSource} beat3=${resetBeat3Marker.anchorSource}.`,
      )
    }
    if (resetBeat3Marker.xPx <= resetBeat1Marker.xPx + 10) {
      throw new Error(
        `Default demo beat 3 marker collapsed after reset: beat1=${resetBeat1Marker.xPx} beat3=${resetBeat3Marker.xPx}.`,
      )
    }

    await clickButton(page, '第1小节第3拍和弦 Am')
    await page.waitForFunction(() => document.querySelector('.score-measure-highlight') !== null)

    const report = {
      generatedAt: new Date().toISOString(),
      wholeDefaultFirstRow,
      wholeExpandedFirstRow,
      wholeResetSpacingFirstRow,
      halfDemoFirstRow,
      halfDemoComparableRows,
      decorationChangeRows: decorationRows,
      twoHalfFirstRow,
      wholeVsTwoHalfComparison: {
        wholeWidth,
        twoHalfWidth,
        wholeGap,
        twoHalfGap,
      },
      uniformStartDecorationComparison: {
        halfDemoBaselineWidth,
        halfDemoBaselineGap,
        halfDemoBaselineActualDecoration,
        decorationBaselineWidth: baselineWidth,
        decorationPlainWidth: plainWidth,
        decorationChangedWidth: changedWidth,
        decorationBaselineActualDecoration: baselineActualDecoration,
        decorationPlainActualDecoration: plainActualDecoration,
        decorationChangedActualDecoration: changedActualDecoration,
        decorationBaselineInset: baselineInset,
        decorationPlainInset: plainInset,
        decorationChangedInset: changedInset,
        decorationBaselineGap: baselineGap,
        decorationPlainGap: plainGap,
        decorationChangedGap: changedGap,
      },
      wholeMinWidthComparison: {
        defaultMinMeasureWidthPx,
        wholeDefaultWidth,
        wholeExpandedWidth,
        wholeDefaultGap,
        wholeExpandedGap,
      },
      defaultMarkers,
      wholeMarkers,
      halfMarkers,
      resetMarkers,
      wholeBeat1DomLeft,
      wholeBeat3DomLeft,
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(`Generated: ${outputPath}`)

    await browser.close()
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
