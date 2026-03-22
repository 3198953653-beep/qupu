import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { getJianpuNumeralForPitch, hasFilledNoteHead } from '../src/score/render/noteheadNumerals'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
  scoreScale?: number
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
  isRest?: boolean
  duration: string | null
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

type PixelSampleTarget = {
  label: string
  pitch: string
  staff: 'treble' | 'bass'
  mode: 'filled' | 'hollow'
}

type PixelSample = PixelSampleTarget & {
  x: number
  y: number
}

type PixelAnalysisResult = {
  label: string
  pitch: string
  staff: 'treble' | 'bass'
  mode: 'filled' | 'hollow'
  candidatePixels: number
  overflowPixels: number
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`

const NUMERAL_TEST_MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC
  "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>8</duration>
        <type>half</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>8</duration>
        <type>half</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>3</octave></pitch>
        <duration>8</duration>
        <type>half</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>8</duration>
        <type>half</type>
        <staff>2</staff>
      </note>
    </measure>
    <measure number="3">
      <note>
        <pitch><step>F</step><alter>1</alter><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>C</step><alter>1</alter><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>A</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>B</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <measure number="4">
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>D</step><alter>1</alter><octave>5</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>5</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>A</step><octave>5</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>B</step><octave>5</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>6</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <staff>1</staff>
      </note>
      <note>
        <rest/>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

const EXPECTED_MAPPINGS = [
  { pitch: 'c/4', expected: '1' },
  { pitch: 'c#/4', expected: '1' },
  { pitch: 'cb/4', expected: '1' },
  { pitch: 'd/4', expected: '2' },
  { pitch: 'e/4', expected: '3' },
  { pitch: 'f/4', expected: '4' },
  { pitch: 'g/4', expected: '5' },
  { pitch: 'a/4', expected: '6' },
  { pitch: 'b/4', expected: '7' },
] as const

const PIXEL_SAMPLE_TARGETS: PixelSampleTarget[] = [
  { label: 'whole-c5', pitch: 'c/5', staff: 'treble', mode: 'hollow' },
  { label: 'half-d5', pitch: 'd/5', staff: 'treble', mode: 'hollow' },
  { label: 'half-e5', pitch: 'e/5', staff: 'treble', mode: 'hollow' },
  { label: 'quarter-fsharp5', pitch: 'f#/5', staff: 'treble', mode: 'filled' },
  { label: 'quarter-b4', pitch: 'b/4', staff: 'treble', mode: 'filled' },
  { label: 'eighth-dsharp5', pitch: 'd#/5', staff: 'treble', mode: 'filled' },
] as const

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
      typeof api.importMusicXmlText === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.setAutoScaleEnabled === 'function' &&
      typeof api.setManualScalePercent === 'function' &&
      typeof api.getScaleConfig === 'function'
    )
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

async function setScoreScale(
  page: Page,
  params: { autoScaleEnabled: boolean; manualScalePercent: number },
): Promise<DebugScaleConfig> {
  await page.evaluate(({ enabled, percent }) => {
    const api = (window as unknown as {
      __scoreDebug: {
        setAutoScaleEnabled: (next: boolean) => void
        setManualScalePercent: (next: number) => void
      }
    }).__scoreDebug
    api.setAutoScaleEnabled(enabled)
    api.setManualScalePercent(percent)
  }, { enabled: params.autoScaleEnabled, percent: params.manualScalePercent })

  await page.waitForFunction(
    ({ enabled, percent }) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getScaleConfig: () => { autoScaleEnabled: boolean; manualScalePercent: number }
        }
      }).__scoreDebug
      const current = api.getScaleConfig()
      return current.autoScaleEnabled === enabled && Math.abs(current.manualScalePercent - percent) < 0.001
    },
    { enabled: params.autoScaleEnabled, percent: params.manualScalePercent },
  )
  await page.waitForTimeout(160)

  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getScaleConfig: () => { autoScaleEnabled: boolean; manualScalePercent: number; scoreScale?: number }
      }
    }).__scoreDebug
    return api.getScaleConfig()
  })
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump } }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

function validateNumeralMappings(): Array<{ pitch: string; expected: string; actual: string | null }> {
  const rows = EXPECTED_MAPPINGS.map(({ pitch, expected }) => ({
    pitch,
    expected,
    actual: getJianpuNumeralForPitch(pitch),
  }))
  const mismatch = rows.find((row) => row.actual !== row.expected)
  if (mismatch) {
    throw new Error(
      `Pitch mapping mismatch for ${mismatch.pitch}: expected ${mismatch.expected}, got ${mismatch.actual ?? 'null'}`,
    )
  }
  return rows
}

function findSampleHead(
  rows: MeasureDumpRow[],
  target: PixelSampleTarget,
): PixelSample {
  for (const row of rows) {
    if (!row.rendered) continue
    for (const note of row.notes) {
      if (note.staff !== target.staff) continue
      for (const head of note.noteHeads) {
        if (head.pitch === target.pitch) {
          return {
            ...target,
            x: head.x + 6,
            y: head.y,
          }
        }
      }
    }
  }
  throw new Error(`Unable to find note head for ${target.label} (${target.staff} ${target.pitch}).`)
}

async function analyzeNoteHeadPixels(page: Page, samples: PixelSample[]): Promise<PixelAnalysisResult[]> {
  return page.evaluate(function (input) {
    const canvas = document.querySelector('canvas.score-surface') as HTMLCanvasElement | null
    if (!canvas) throw new Error('Canvas .score-surface not found.')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas 2D context not available.')

    const styleWidth = Number.parseFloat(canvas.style.width || '0')
    const styleHeight = Number.parseFloat(canvas.style.height || '0')
    const logicalWidth = styleWidth > 0 ? styleWidth : canvas.width || 1
    const logicalHeight = styleHeight > 0 ? styleHeight : canvas.height || 1
    const scaleX = canvas.width / logicalWidth
    const scaleY = canvas.height / logicalHeight
    const image = context.getImageData(0, 0, canvas.width, canvas.height)

    const results: PixelAnalysisResult[] = []
    for (const sample of input) {
      const centerX = Math.round(sample.x * scaleX)
      const centerY = Math.round(sample.y * scaleY)
      const logicalInnerRadiusX = sample.mode === 'filled' ? 4.9 : 4.8
      const logicalInnerRadiusY = sample.mode === 'filled' ? 3.6 : 3.4
      const logicalScanRadiusX = sample.mode === 'filled' ? 6.2 : 5.8
      const logicalScanRadiusY = sample.mode === 'filled' ? 4.8 : 4.4
      const scanRadiusXPx = Math.max(2, Math.ceil(logicalScanRadiusX * scaleX))
      const scanRadiusYPx = Math.max(2, Math.ceil(logicalScanRadiusY * scaleY))

      let candidatePixels = 0
      let overflowPixels = 0
      for (let y = centerY - scanRadiusYPx; y <= centerY + scanRadiusYPx; y += 1) {
        for (let x = centerX - scanRadiusXPx; x <= centerX + scanRadiusXPx; x += 1) {
          if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue
          const index = (y * canvas.width + x) * 4
          const alpha = image.data[index + 3]
          if (alpha < 32) continue
          const brightness = (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3
          const isCandidate = sample.mode === 'filled' ? brightness >= 210 : brightness <= 96
          if (!isCandidate) continue

          const dx = (x - centerX) / scaleX
          const dy = (y - centerY) / scaleY
          const scanRatio =
            (dx * dx) / (logicalScanRadiusX * logicalScanRadiusX) +
            (dy * dy) / (logicalScanRadiusY * logicalScanRadiusY)
          if (scanRatio > 1) continue

          const safeRatio =
            (dx * dx) / (logicalInnerRadiusX * logicalInnerRadiusX) +
            (dy * dy) / (logicalInnerRadiusY * logicalInnerRadiusY)
          candidatePixels += 1
          if (sample.mode === 'filled' && safeRatio > 1) {
            overflowPixels += 1
          }
        }
      }

      results.push({
        label: sample.label,
        pitch: sample.pitch,
        staff: sample.staff,
        mode: sample.mode,
        candidatePixels,
        overflowPixels,
      })
    }
    return results
  }, samples)
}

function validatePixelAnalysis(label: string, results: PixelAnalysisResult[]): void {
  const byLabel = new Map(results.map((entry) => [entry.label, entry]))
  PIXEL_SAMPLE_TARGETS.forEach((target) => {
    const result = byLabel.get(target.label)
    if (!result) {
      throw new Error(`[${label}] Missing pixel analysis for ${target.label}.`)
    }
    if (target.mode === 'hollow') {
      return
    }
    const minimumCandidatePixels = target.mode === 'filled' ? 2 : 7
    if (result.candidatePixels < minimumCandidatePixels) {
      throw new Error(
        `[${label}] ${target.label} candidate pixel count too low: ${result.candidatePixels} < ${minimumCandidatePixels}`,
      )
    }
    if (target.mode === 'filled' && result.overflowPixels > 4) {
      throw new Error(`[${label}] ${target.label} overflow pixel count too high: ${result.overflowPixels}`)
    }
  })
}

async function captureScaleScenario(params: {
  page: Page
  label: string
  autoScaleEnabled: boolean
  manualScalePercent: number
  screenshotPath: string
}): Promise<{
  label: string
  scaleConfig: DebugScaleConfig
  restNoteCount: number
  chordHeadCount: number
  samples: PixelSample[]
  analysis: PixelAnalysisResult[]
  screenshotPath: string
}> {
  const { page, label, autoScaleEnabled, manualScalePercent, screenshotPath } = params
  const scaleConfig = await setScoreScale(page, { autoScaleEnabled, manualScalePercent })
  const dump = await dumpAllMeasureCoordinates(page)
  const restNoteCount = dump.rows.flatMap((row) => row.notes).filter((note) => note.isRest === true).length
  const chordNote =
    dump.rows
      .flatMap((row) => row.notes)
      .find(
        (note) =>
          note.staff === 'treble' &&
          note.noteHeads.length > 1 &&
          note.noteHeads.some((head) => head.pitch === 'c#/5'),
      ) ?? null
  const samples = PIXEL_SAMPLE_TARGETS.map((target) => findSampleHead(dump.rows, target))
  const analysis = await analyzeNoteHeadPixels(page, samples)
  await page.locator('.score-stage.horizontal-view').screenshot({ path: screenshotPath })

  if (restNoteCount <= 0) {
    throw new Error(`[${label}] Expected at least one rest in the browser fixture.`)
  }
  if (!chordNote) {
    throw new Error(`[${label}] Expected a rendered treble chord note containing c#/5.`)
  }

  validatePixelAnalysis(label, analysis)
  return {
    label,
    scaleConfig,
    restNoteCount,
    chordHeadCount: chordNote.noteHeads.length,
    samples,
    analysis,
    screenshotPath,
  }
}

async function main() {
  const reportPath = process.argv[2] ?? path.resolve('debug', 'notehead-jianpu-browser-report.json')
  const manualScreenshotPath = path.resolve('debug', 'notehead-jianpu-manual-100.png')
  const autoScreenshotPath = path.resolve('debug', 'notehead-jianpu-auto-scale.png')
  const devServer = startDevServer()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
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
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)
    await importMusicXmlViaDebugApi(page, NUMERAL_TEST_MUSIC_XML)
    await page.waitForTimeout(180)

    const mappingChecks = validateNumeralMappings()
    const durationChecks = [
      { duration: 'w', filled: hasFilledNoteHead('w') },
      { duration: 'h', filled: hasFilledNoteHead('h') },
      { duration: 'q', filled: hasFilledNoteHead('q') },
      { duration: '8', filled: hasFilledNoteHead('8') },
    ]
    await mkdir(path.dirname(manualScreenshotPath), { recursive: true })

    const manualScenario = await captureScaleScenario({
      page,
      label: 'manual-100',
      autoScaleEnabled: false,
      manualScalePercent: 100,
      screenshotPath: manualScreenshotPath,
    })
    const autoScenario = await captureScaleScenario({
      page,
      label: 'auto-scale',
      autoScaleEnabled: true,
      manualScalePercent: 100,
      screenshotPath: autoScreenshotPath,
    })

    const report = {
      generatedAt: new Date().toISOString(),
      mappingChecks,
      durationChecks,
      manualScenario,
      autoScenario,
    }

    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    console.log(`Generated: ${reportPath}`)
    console.log(`Manual screenshot: ${manualScreenshotPath}`)
    console.log(`Auto screenshot: ${autoScreenshotPath}`)
  } finally {
    await browser?.close()
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
