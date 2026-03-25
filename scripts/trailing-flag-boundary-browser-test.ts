import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  noteIndex: number
  isRest?: boolean
  duration?: string | null
  onsetTicksInMeasure: number | null
  visualRightX?: number | null
}

type DumpSpacingSegment = {
  fromOnsetTicks: number
  toOnsetTicks: number
  baseGapPx?: number | null
  extraReservePx?: number | null
  appliedGapPx?: number | null
}

type DumpSpacingOnsetReserve = {
  onsetTicks: number
  rightReservePx?: number | null
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  measureWidth?: number | null
  measureEndBarX?: number | null
  trailingTailTicks?: number | null
  trailingGapPx?: number | null
  overflowVsMeasureEndBarX?: number | null
  spacingSegments?: DumpSpacingSegment[]
  spacingOnsetReserves?: DumpSpacingOnsetReserve[]
  notes: DumpNoteRow[]
}

type MeasureDump = {
  rows: MeasureDumpRow[]
}

type FixtureResult = {
  key: string
  trailingTailTicks: number | null
  trailingGapPx: number | null
  lastSegmentBaseGapPx: number | null
  lastSegmentExtraReservePx: number | null
  finalVisualGapPx: number | null
  lastOnsetRightReservePx: number | null
  overflowVsMeasureEndBarX: number | null
  passed: boolean
  failureReasons: string[]
}

type DesktopRowResult = {
  pairIndex: number
  trailingTailTicks: number | null
  trailingGapPx: number | null
  lastSegmentBaseGapPx: number | null
  lastSegmentExtraReservePx: number | null
  finalVisualGapPx: number | null
  lastOnsetRightReservePx: number | null
  overflowVsMeasureEndBarX: number | null
  passed: boolean
  failureReasons: string[]
}

type FinalReport = {
  generatedAt: string
  xmlPath: string
  desktopResults: DesktopRowResult[]
  fixtureResults: FixtureResult[]
}

type TrailingFixtureKind = 'overflow' | 'enough-room' | 'beamed'

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4185
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_XML_PATH = String.raw`C:\Users\76743\Desktop\三个声部5（D调）.musicxml`
const EPSILON_PX = 0.2
const SAFE_GAP_PX = 1

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startDevServer(): ChildProcess {
  return spawn(`npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT} --strictPort`, {
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

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // retry
    }
    await sleep(350)
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
      return (
        !!api &&
        typeof api.importMusicXmlText === 'function' &&
        typeof api.dumpAllMeasureCoordinates === 'function' &&
        typeof api.getImportFeedback === 'function' &&
        typeof api.setAutoScaleEnabled === 'function' &&
        typeof api.setManualScalePercent === 'function'
      )
    },
    undefined,
    { timeout: 120000 },
  )
}

async function setScoreScale(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        setAutoScaleEnabled: (next: boolean) => void
        setManualScalePercent: (next: number) => void
      }
    }).__scoreDebug
    api.setAutoScaleEnabled(false)
    api.setManualScalePercent(100)
  })
}

async function importMusicXml(page: Page, xmlText: string): Promise<void> {
  await page.evaluate((text) => {
    const api = (window as unknown as {
      __scoreDebug: { importMusicXmlText: (value: string) => void }
    }).__scoreDebug
    api.importMusicXmlText(text)
  }, xmlText)

  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __scoreDebug: { getImportFeedback: () => ImportFeedback }
      }).__scoreDebug
      return api.getImportFeedback().kind === 'success'
    },
    undefined,
    { timeout: 120000 },
  )
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
    }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

function roundFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null
}

function assertFinite(value: number | null | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is not finite`)
  }
  return value
}

function buildRestXml(durationType: '16th' | '32nd' | 'whole', durationValue: number, staff: 1 | 2): string {
  return [
    '      <note>',
    '        <rest/>',
    `        <duration>${durationValue}</duration>`,
    '        <voice>1</voice>',
    `        <type>${durationType}</type>`,
    `        <staff>${staff}</staff>`,
    '      </note>',
  ].join('\n')
}

function buildTrebleNoteXml(params: {
  durationType: '16th' | '32nd'
  durationValue: number
  pitchStep?: string
  pitchOctave?: number
  stem?: 'up' | 'down'
  beams?: Array<{ number: 1 | 2; value: 'begin' | 'continue' | 'end' }>
}): string {
  const {
    durationType,
    durationValue,
    pitchStep = 'G',
    pitchOctave = 4,
    stem = 'up',
    beams = [],
  } = params
  return [
    '      <note>',
    `        <pitch><step>${pitchStep}</step><octave>${pitchOctave}</octave></pitch>`,
    `        <duration>${durationValue}</duration>`,
    '        <voice>1</voice>',
    `        <type>${durationType}</type>`,
    `        <stem>${stem}</stem>`,
    ...beams.map((beam) => `        <beam number="${beam.number}">${beam.value}</beam>`),
    '        <staff>1</staff>',
    '      </note>',
  ].join('\n')
}

function buildTrailingFixtureXml(kind: TrailingFixtureKind): string {
  const trebleEvents: string[] = []
  if (kind === 'overflow') {
    for (let index = 0; index < 31; index += 1) {
      trebleEvents.push(buildRestXml('32nd', 1, 1))
    }
    trebleEvents.push(buildTrebleNoteXml({ durationType: '32nd', durationValue: 1, pitchStep: 'G' }))
  } else if (kind === 'enough-room') {
    for (let index = 0; index < 15; index += 1) {
      trebleEvents.push(buildRestXml('16th', 2, 1))
    }
    trebleEvents.push(
      buildTrebleNoteXml({
        durationType: '16th',
        durationValue: 2,
        pitchStep: 'C',
        pitchOctave: 5,
      }),
    )
  } else {
    for (let index = 0; index < 14; index += 1) {
      trebleEvents.push(buildRestXml('16th', 2, 1))
    }
    trebleEvents.push(
      buildTrebleNoteXml({
        durationType: '16th',
        durationValue: 2,
        pitchStep: 'E',
        beams: [
          { number: 1, value: 'begin' },
          { number: 2, value: 'begin' },
        ],
      }),
    )
    trebleEvents.push(
      buildTrebleNoteXml({
        durationType: '16th',
        durationValue: 2,
        pitchStep: 'G',
        beams: [
          { number: 1, value: 'end' },
          { number: 2, value: 'end' },
        ],
      }),
    )
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
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
        <divisions>8</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
${trebleEvents.join('\n')}
${buildRestXml('whole', 32, 2)}
    </measure>
  </part>
</score-partwise>`
}

function findLastSegment(row: MeasureDumpRow): DumpSpacingSegment | null {
  if (!row.spacingSegments || row.spacingSegments.length === 0) return null
  return row.spacingSegments[row.spacingSegments.length - 1] ?? null
}

function findLastOnsetRightReservePx(row: MeasureDumpRow): number | null {
  if (!row.spacingOnsetReserves || row.spacingOnsetReserves.length === 0) return null
  const lastReserve = row.spacingOnsetReserves[row.spacingOnsetReserves.length - 1] ?? null
  return roundFinite(lastReserve?.rightReservePx)
}

function findLastVisibleNote(row: MeasureDumpRow): DumpNoteRow | null {
  const noteRows = row.notes
    .filter((note) => note.isRest !== true)
    .slice()
    .sort((left, right) => {
      const leftOnset = left.onsetTicksInMeasure ?? Number.NEGATIVE_INFINITY
      const rightOnset = right.onsetTicksInMeasure ?? Number.NEGATIVE_INFINITY
      if (leftOnset !== rightOnset) return leftOnset - rightOnset
      const leftRight = left.visualRightX ?? Number.NEGATIVE_INFINITY
      const rightRight = right.visualRightX ?? Number.NEGATIVE_INFINITY
      return leftRight - rightRight
    })
  return noteRows[noteRows.length - 1] ?? null
}

function computeFinalVisualGapPx(row: MeasureDumpRow): number | null {
  const lastNote = findLastVisibleNote(row)
  if (!lastNote) return null
  const measureEndBarX = roundFinite(row.measureEndBarX)
  const visualRightX = roundFinite(lastNote.visualRightX)
  if (measureEndBarX === null || visualRightX === null) return null
  return Number((measureEndBarX - visualRightX).toFixed(3))
}

function analyzeDesktopRow(row: MeasureDumpRow): DesktopRowResult {
  const failures: string[] = []
  const trailingTailTicks =
    typeof row.trailingTailTicks === 'number' && Number.isFinite(row.trailingTailTicks)
      ? Math.round(row.trailingTailTicks)
      : null
  const trailingGapPx = roundFinite(row.trailingGapPx)
  const overflowVsMeasureEndBarX = roundFinite(row.overflowVsMeasureEndBarX)
  const lastSegment = findLastSegment(row)
  const lastSegmentBaseGapPx = roundFinite(lastSegment?.baseGapPx)
  const lastSegmentExtraReservePx = roundFinite(lastSegment?.extraReservePx)
  const finalVisualGapPx = computeFinalVisualGapPx(row)
  const lastOnsetRightReservePx = findLastOnsetRightReservePx(row)

  if (row.pairIndex === 0) {
    if (trailingTailTicks !== 2) {
      failures.push(`unexpected-trailing-tail-ticks:${trailingTailTicks ?? 'null'}`)
    }
    if ((lastSegmentExtraReservePx ?? 0) > EPSILON_PX) {
      failures.push(`unexpected-last-segment-extra:${lastSegmentExtraReservePx ?? 'null'}`)
    }
    if (
      trailingGapPx === null ||
      lastSegmentBaseGapPx === null ||
      Math.abs(trailingGapPx - lastSegmentBaseGapPx) > EPSILON_PX
    ) {
      failures.push(`unexpected-trailing-gap:${trailingGapPx ?? 'null'}!=${lastSegmentBaseGapPx ?? 'null'}`)
    }
  } else if (row.pairIndex >= 1 && row.pairIndex <= 3) {
    if (finalVisualGapPx === null || finalVisualGapPx < SAFE_GAP_PX - EPSILON_PX) {
      failures.push(`trailing-visual-gap-too-small:${finalVisualGapPx ?? 'null'}`)
    }
    if ((lastOnsetRightReservePx ?? 0) > EPSILON_PX) {
      failures.push(`unexpected-last-onset-right-reserve:${lastOnsetRightReservePx ?? 'null'}`)
    }
  }

  if ((overflowVsMeasureEndBarX ?? 0) > EPSILON_PX) {
    failures.push(`overflow-vs-measure-end-barline:${overflowVsMeasureEndBarX}`)
  }

  return {
    pairIndex: row.pairIndex,
    trailingTailTicks,
    trailingGapPx,
    lastSegmentBaseGapPx,
    lastSegmentExtraReservePx,
    finalVisualGapPx,
    lastOnsetRightReservePx,
    overflowVsMeasureEndBarX,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeFixtureRow(row: MeasureDumpRow, key: string, kind: TrailingFixtureKind): FixtureResult {
  const failures: string[] = []
  const trailingTailTicks =
    typeof row.trailingTailTicks === 'number' && Number.isFinite(row.trailingTailTicks)
      ? Math.round(row.trailingTailTicks)
      : null
  const trailingGapPx = roundFinite(row.trailingGapPx)
  const overflowVsMeasureEndBarX = roundFinite(row.overflowVsMeasureEndBarX)
  const lastSegment = findLastSegment(row)
  const lastSegmentBaseGapPx = roundFinite(lastSegment?.baseGapPx)
  const lastSegmentExtraReservePx = roundFinite(lastSegment?.extraReservePx)
  const finalVisualGapPx = computeFinalVisualGapPx(row)
  const lastOnsetRightReservePx = findLastOnsetRightReservePx(row)

  if ((overflowVsMeasureEndBarX ?? 0) > EPSILON_PX) {
    failures.push(`overflow-vs-measure-end-barline:${overflowVsMeasureEndBarX}`)
  }
  if ((lastOnsetRightReservePx ?? 0) > EPSILON_PX) {
    failures.push(`unexpected-last-onset-right-reserve:${lastOnsetRightReservePx ?? 'null'}`)
  }

  if (kind === 'overflow') {
    if (trailingTailTicks !== 2) {
      failures.push(`unexpected-trailing-tail-ticks:${trailingTailTicks ?? 'null'}`)
    }
    if (finalVisualGapPx === null || finalVisualGapPx < SAFE_GAP_PX - EPSILON_PX) {
      failures.push(`trailing-visual-gap-too-small:${finalVisualGapPx ?? 'null'}`)
    }
    if (
      trailingGapPx === null ||
      lastSegmentBaseGapPx === null ||
      trailingGapPx <= lastSegmentBaseGapPx + EPSILON_PX
    ) {
      failures.push(`expected-tail-grow-missing:${trailingGapPx ?? 'null'}<=${lastSegmentBaseGapPx ?? 'null'}`)
    }
  } else {
    if (finalVisualGapPx !== null && finalVisualGapPx < SAFE_GAP_PX - EPSILON_PX) {
      failures.push(`trailing-visual-gap-too-small:${finalVisualGapPx}`)
    }
    if (
      trailingGapPx === null ||
      lastSegmentBaseGapPx === null ||
      Math.abs(trailingGapPx - lastSegmentBaseGapPx) > EPSILON_PX
    ) {
      failures.push(`unexpected-tail-grow:${trailingGapPx ?? 'null'}!=${lastSegmentBaseGapPx ?? 'null'}`)
    }
  }

  return {
    key,
    trailingTailTicks,
    trailingGapPx,
    lastSegmentBaseGapPx,
    lastSegmentExtraReservePx,
    finalVisualGapPx,
    lastOnsetRightReservePx,
    overflowVsMeasureEndBarX,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

async function runFixtureScenario(page: Page, key: string, kind: TrailingFixtureKind): Promise<FixtureResult> {
  await importMusicXml(page, buildTrailingFixtureXml(kind))
  await page.waitForTimeout(500)
  const dump = await dumpAllMeasureCoordinates(page)
  const firstRow = dump.rows[0]
  if (!firstRow) {
    throw new Error(`[${key}] No rendered measures found`)
  }
  return analyzeFixtureRow(firstRow, key, kind)
}

async function main(): Promise<void> {
  const xmlPath = process.argv[2] || DEFAULT_XML_PATH
  const xmlText = await readFile(xmlPath, 'utf8')

  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  server.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk))

  try {
    await waitForServer(DEV_URL, 120000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 2200, height: 1400 } })
    page.on('console', (message) => {
      console.log(`[browser:${message.type()}] ${message.text()}`)
    })
    page.on('pageerror', (error) => {
      console.error(`[browser:pageerror] ${error.stack ?? error.message}`)
    })

    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForDebugApi(page)
    await setScoreScale(page)

    await importMusicXml(page, xmlText)
    await page.waitForTimeout(1200)
    const desktopDump = await dumpAllMeasureCoordinates(page)
    const desktopResults = desktopDump.rows.slice(0, 4).map((row) => analyzeDesktopRow(row))

    const fixtureResults = [
      await runFixtureScenario(page, 'fixture-trailing-32nd-overflow', 'overflow'),
      await runFixtureScenario(page, 'fixture-trailing-16th-enough-room', 'enough-room'),
      await runFixtureScenario(page, 'fixture-trailing-beamed-16th', 'beamed'),
    ]

    const failures = [
      ...desktopResults.flatMap((result) =>
        result.passed ? [] : [`desktop-pair-${result.pairIndex}: ${result.failureReasons.join(', ')}`],
      ),
      ...fixtureResults.flatMap((result) =>
        result.passed ? [] : [`${result.key}: ${result.failureReasons.join(', ')}`],
      ),
    ]

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      desktopResults,
      fixtureResults,
    }

    console.log(JSON.stringify(report, null, 2))

    if (failures.length > 0) {
      throw new Error(failures.join('\n'))
    }
  } finally {
    if (browser) await browser.close()
    await stopDevServer(server)
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
