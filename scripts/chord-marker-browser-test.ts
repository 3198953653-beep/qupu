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
    measureWidth?: number | null
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

async function verifyWholeNoteDemoButtonLocation(page: Page): Promise<void> {
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
    }
  })

  if (location.buttonsInImportActions.includes('加载全音符示例')) {
    throw new Error('Whole-note demo button should not appear inside .import-actions.')
  }
  if (location.wholeNoteIndexInRhythmRow === -1) {
    throw new Error('Whole-note demo button is missing from .rhythm-row.')
  }
  if (location.wholeNoteIndexInRhythmRow !== 0) {
    throw new Error(
      `Whole-note demo button should be the first button in .rhythm-row, got index ${location.wholeNoteIndexInRhythmRow}.`,
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
    await verifyWholeNoteDemoButtonLocation(page)

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

    const wholeDemoReport = await getMeasureCoordinates(page)
    const wholeDemoFirstRow = wholeDemoReport.rows[0]
    if (!wholeDemoFirstRow) {
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
    const wholeSpacingAnchorTicks = wholeDemoFirstRow.spacingAnchorTicks ?? []
    if (!wholeSpacingAnchorTicks.includes(wholeBeat3Marker.startTick)) {
      throw new Error(
        `Whole-note spacing anchors are missing beat 3 tick ${wholeBeat3Marker.startTick}: ${wholeSpacingAnchorTicks.join(', ')}.`,
      )
    }
    const wholeBeat1SpacingX = wholeDemoFirstRow.spacingTickToX?.[String(wholeBeat1Marker.startTick)] ?? null
    const wholeBeat3SpacingX = wholeDemoFirstRow.spacingTickToX?.[String(wholeBeat3Marker.startTick)] ?? null
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

    const twoHalfImportXml = buildTwoHalfNoteImportXml()
    await importMusicXmlViaDebugApi(page, twoHalfImportXml)
    await waitForTwoHalfImport(page)

    const twoHalfReport = await getMeasureCoordinates(page)
    const twoHalfFirstRow = twoHalfReport.rows[0]
    if (!twoHalfFirstRow) {
      throw new Error('Two-half-note import report is missing the first row.')
    }

    const wholeAnchorTicks = wholeDemoFirstRow.spacingAnchorTicks ?? []
    const twoHalfAnchorTicks = twoHalfFirstRow.spacingAnchorTicks ?? []
    if (wholeAnchorTicks.join(',') !== '0,32') {
      throw new Error(`Whole-note demo spacing anchors should be [0,32], got [${wholeAnchorTicks.join(',')}].`)
    }
    if (twoHalfAnchorTicks.join(',') !== '0,32') {
      throw new Error(`Two-half import spacing anchors should be [0,32], got [${twoHalfAnchorTicks.join(',')}].`)
    }

    const wholeGap = getSpacingGap(wholeDemoFirstRow, 0, 32)
    const twoHalfGap = getSpacingGap(twoHalfFirstRow, 0, 32)
    const wholeWidth = wholeDemoFirstRow.measureWidth
    const twoHalfWidth = twoHalfFirstRow.measureWidth
    if (typeof wholeWidth !== 'number' || !Number.isFinite(wholeWidth)) {
      throw new Error('Whole-note first measure width is missing.')
    }
    if (typeof twoHalfWidth !== 'number' || !Number.isFinite(twoHalfWidth)) {
      throw new Error('Two-half first measure width is missing.')
    }
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

    await clickButton(page, '重置')
    await waitForDefaultDemo(page)

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
      wholeDemoFirstRow,
      twoHalfFirstRow,
      wholeVsTwoHalfComparison: {
        wholeWidth,
        twoHalfWidth,
        wholeGap,
        twoHalfGap,
      },
      defaultMarkers,
      wholeMarkers,
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
