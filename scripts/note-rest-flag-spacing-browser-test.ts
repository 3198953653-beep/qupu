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
  visualLeftX?: number | null
  visualRightX?: number | null
}

type DumpSpacingSegment = {
  fromOnsetTicks: number
  toOnsetTicks: number
  extraReservePx?: number | null
  noteRestRequestedExtraPx?: number | null
  noteRestVisibleGapPx?: number | null
}

type MeasureDumpRow = {
  pairIndex: number
  notes: DumpNoteRow[]
  spacingSegments?: DumpSpacingSegment[]
}

type MeasureDump = {
  rows: MeasureDumpRow[]
}

type DurationCode = '8' | '16' | '32'
type PairOrder = 'note-rest' | 'rest-note'
type ExtraExpectation = 'positive' | 'zero' | 'any'

type PairCheck = {
  fromOnsetTicks: number
  toOnsetTicks: number
  finalGapPx: number
  extraReservePx: number
  noteRestRequestedExtraPx: number
  noteRestVisibleGapPx: number | null
}

type FixtureScenario = {
  key: string
  order: PairOrder
  durationCode: DurationCode
  extraExpectation: ExtraExpectation
  xmlText: string
}

type FixtureScenarioResult = PairCheck & {
  key: string
  order: PairOrder
  durationCode: DurationCode
  passed: boolean
  failureReasons: string[]
}

type FinalReport = {
  generatedAt: string
  xmlPath: string
  desktopCheckedPairs: PairCheck[]
  fixtureResults: FixtureScenarioResult[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4184
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_XML_PATH = String.raw`C:\Users\76743\Desktop\三个声部4（D调）.musicxml`
const EPSILON_PX = 0.15

function durationTypeFromCode(durationCode: DurationCode | '4'): 'quarter' | 'eighth' | '16th' | '32nd' {
  switch (durationCode) {
    case '4':
      return 'quarter'
    case '8':
      return 'eighth'
    case '16':
      return '16th'
    case '32':
      return '32nd'
  }
}

function durationTicksFromCode(durationCode: DurationCode | '4'): number {
  switch (durationCode) {
    case '4':
      return 8
    case '8':
      return 4
    case '16':
      return 2
    case '32':
      return 1
  }
}

function buildRestXml(durationCode: DurationCode | '4', staff: 1 | 2, voice = 1): string {
  return [
    '      <note>',
    '        <rest/>',
    `        <duration>${durationTicksFromCode(durationCode)}</duration>`,
    `        <voice>${voice}</voice>`,
    `        <type>${durationTypeFromCode(durationCode)}</type>`,
    `        <staff>${staff}</staff>`,
    '      </note>',
  ].join('\n')
}

function buildTrebleFlagNoteXml(params: {
  durationCode: DurationCode
  pitchStep?: string
  pitchOctave?: number
  stem?: 'up' | 'down'
  beams?: Array<{ number: 1 | 2; value: 'begin' | 'continue' | 'end' }>
}): string {
  const {
    durationCode,
    pitchStep = 'E',
    pitchOctave = 4,
    stem = 'up',
    beams = [],
  } = params
  return [
    '      <note>',
    `        <pitch><step>${pitchStep}</step><octave>${pitchOctave}</octave></pitch>`,
    `        <duration>${durationTicksFromCode(durationCode)}</duration>`,
    '        <voice>1</voice>',
    `        <type>${durationTypeFromCode(durationCode)}</type>`,
    `        <stem>${stem}</stem>`,
    ...beams.map((beam) => `        <beam number="${beam.number}">${beam.value}</beam>`),
    '        <staff>1</staff>',
    '      </note>',
  ].join('\n')
}

function buildRemainingTrebleRestsXml(remainingTicks: number): string[] {
  const restDurations: Array<{ code: DurationCode | '4'; ticks: number }> = [
    { code: '4', ticks: 8 },
    { code: '8', ticks: 4 },
    { code: '16', ticks: 2 },
    { code: '32', ticks: 1 },
  ]
  let restTicks = Math.max(0, remainingTicks)
  const xml: string[] = []
  restDurations.forEach((restDuration) => {
    while (restTicks >= restDuration.ticks) {
      xml.push(buildRestXml(restDuration.code, 1))
      restTicks -= restDuration.ticks
    }
  })
  if (restTicks !== 0) {
    throw new Error(`Failed to build filler rests for ${remainingTicks} ticks`)
  }
  return xml
}

function buildStandaloneFlagFixtureXml(params: {
  durationCode: DurationCode
  order: PairOrder
}): string {
  const { durationCode, order } = params
  const durationTicks = durationTicksFromCode(durationCode)
  const remainingTicks = 8 - durationTicks * 2
  const trebleEvents =
    order === 'note-rest'
      ? [buildTrebleFlagNoteXml({ durationCode }), buildRestXml(durationCode, 1), ...buildRemainingTrebleRestsXml(remainingTicks)]
      : [buildRestXml(durationCode, 1), buildTrebleFlagNoteXml({ durationCode }), ...buildRemainingTrebleRestsXml(remainingTicks)]

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
        <time><beats>1</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
${trebleEvents.join('\n')}
${buildRestXml('4', 2)}
    </measure>
  </part>
</score-partwise>`
}

function buildBeamedSixteenthFixtureXml(): string {
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
        <time><beats>1</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
${buildTrebleFlagNoteXml({
  durationCode: '16',
  pitchStep: 'E',
  pitchOctave: 4,
  beams: [
    { number: 1, value: 'begin' },
    { number: 2, value: 'begin' },
  ],
})}
${buildTrebleFlagNoteXml({
  durationCode: '16',
  pitchStep: 'F',
  pitchOctave: 4,
  beams: [
    { number: 1, value: 'end' },
    { number: 2, value: 'end' },
  ],
})}
${buildRestXml('16', 1)}
${buildRestXml('16', 1)}
${buildRestXml('4', 2)}
    </measure>
  </part>
</score-partwise>`
}

const FIXTURE_SCENARIOS: FixtureScenario[] = [
  {
    key: 'fixture-eighth-note-rest',
    order: 'note-rest',
    durationCode: '8',
    extraExpectation: 'any',
    xmlText: buildStandaloneFlagFixtureXml({ durationCode: '8', order: 'note-rest' }),
  },
  {
    key: 'fixture-eighth-rest-note',
    order: 'rest-note',
    durationCode: '8',
    extraExpectation: 'zero',
    xmlText: buildStandaloneFlagFixtureXml({ durationCode: '8', order: 'rest-note' }),
  },
  {
    key: 'fixture-sixteenth-note-rest',
    order: 'note-rest',
    durationCode: '16',
    extraExpectation: 'positive',
    xmlText: buildStandaloneFlagFixtureXml({ durationCode: '16', order: 'note-rest' }),
  },
  {
    key: 'fixture-sixteenth-rest-note',
    order: 'rest-note',
    durationCode: '16',
    extraExpectation: 'zero',
    xmlText: buildStandaloneFlagFixtureXml({ durationCode: '16', order: 'rest-note' }),
  },
  {
    key: 'fixture-thirty-second-note-rest',
    order: 'note-rest',
    durationCode: '32',
    extraExpectation: 'positive',
    xmlText: buildStandaloneFlagFixtureXml({ durationCode: '32', order: 'note-rest' }),
  },
  {
    key: 'fixture-thirty-second-rest-note',
    order: 'rest-note',
    durationCode: '32',
    extraExpectation: 'zero',
    xmlText: buildStandaloneFlagFixtureXml({ durationCode: '32', order: 'rest-note' }),
  },
  {
    key: 'fixture-beamed-sixteenth-note-rest',
    order: 'note-rest',
    durationCode: '16',
    extraExpectation: 'zero',
    xmlText: buildBeamedSixteenthFixtureXml(),
  },
]

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

function assertFinite(value: number | null | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is not finite`)
  }
  return value
}

function isFlagDuration(duration: string | null | undefined): boolean {
  return duration === '8' || duration === '8d' || duration === '16' || duration === '16d' || duration === '32' || duration === '32d'
}

function sortTrebleNotes(row: MeasureDumpRow): DumpNoteRow[] {
  return row.notes
    .filter((note) => note.staff === 'treble')
    .slice()
    .sort((left, right) => {
      const leftOnset = left.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
      const rightOnset = right.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
      if (leftOnset !== rightOnset) return leftOnset - rightOnset
      return left.noteIndex - right.noteIndex
    })
}

function buildSegmentsByKey(row: MeasureDumpRow): Map<string, DumpSpacingSegment> {
  return new Map(
    (row.spacingSegments ?? []).map((segment) => [`${segment.fromOnsetTicks}-${segment.toOnsetTicks}`, segment]),
  )
}

function resolvePairCheck(params: {
  row: MeasureDumpRow
  order: PairOrder
  durationCode: DurationCode
  scenarioKey: string
}): PairCheck {
  const { row, order, durationCode, scenarioKey } = params
  const trebleNotes = sortTrebleNotes(row)
  const segmentsByKey = buildSegmentsByKey(row)

  for (let index = 1; index < trebleNotes.length; index += 1) {
    const previous = trebleNotes[index - 1]!
    const next = trebleNotes[index]!
    const previousOnset = previous.onsetTicksInMeasure
    const nextOnset = next.onsetTicksInMeasure
    if (typeof previousOnset !== 'number' || typeof nextOnset !== 'number') continue

    const matchesOrder =
      order === 'note-rest'
        ? previous.isRest !== true && next.isRest === true && previous.duration === durationCode
        : previous.isRest === true && next.isRest !== true && next.duration === durationCode
    if (!matchesOrder) continue

    const segment = segmentsByKey.get(`${previousOnset}-${nextOnset}`)
    if (!segment) {
      throw new Error(`[${scenarioKey}] Missing spacing segment ${previousOnset}-${nextOnset}`)
    }

    return {
      fromOnsetTicks: previousOnset,
      toOnsetTicks: nextOnset,
      finalGapPx:
        assertFinite(next.visualLeftX, `${scenarioKey}.next.visualLeftX`) -
        assertFinite(previous.visualRightX, `${scenarioKey}.previous.visualRightX`),
      extraReservePx: assertFinite(segment.extraReservePx ?? 0, `${scenarioKey}.segment.extraReservePx`),
      noteRestRequestedExtraPx: assertFinite(
        segment.noteRestRequestedExtraPx ?? 0,
        `${scenarioKey}.segment.noteRestRequestedExtraPx`,
      ),
      noteRestVisibleGapPx:
        typeof segment.noteRestVisibleGapPx === 'number' && Number.isFinite(segment.noteRestVisibleGapPx)
          ? segment.noteRestVisibleGapPx
          : null,
    }
  }

  throw new Error(`[${scenarioKey}] Did not find matching ${durationCode} ${order} pair`)
}

function analyzeFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: FixtureScenario
}): FixtureScenarioResult {
  const { row, scenario } = params
  const failures: string[] = []
  const pairCheck = resolvePairCheck({
    row,
    order: scenario.order,
    durationCode: scenario.durationCode,
    scenarioKey: scenario.key,
  })
  const triggeredSegments = (row.spacingSegments ?? []).filter(
    (segment) =>
      typeof segment.noteRestRequestedExtraPx === 'number' &&
      Number.isFinite(segment.noteRestRequestedExtraPx) &&
      segment.noteRestRequestedExtraPx > EPSILON_PX,
  )

  if (pairCheck.finalGapPx < -EPSILON_PX) {
    failures.push(`final-gap-negative:${pairCheck.finalGapPx.toFixed(3)}`)
  }

  if (Math.abs(pairCheck.extraReservePx - pairCheck.noteRestRequestedExtraPx) > EPSILON_PX) {
    failures.push(
      `extra-reserve-mismatch:${pairCheck.extraReservePx.toFixed(3)}!=${pairCheck.noteRestRequestedExtraPx.toFixed(3)}`,
    )
  }

  if (scenario.extraExpectation === 'positive') {
    if (pairCheck.noteRestRequestedExtraPx <= EPSILON_PX) {
      failures.push(`expected-positive-extra-missing:${pairCheck.noteRestRequestedExtraPx.toFixed(3)}`)
    }
    if ((pairCheck.noteRestVisibleGapPx ?? 0) >= -EPSILON_PX) {
      failures.push(`expected-negative-pre-gap-missing:${pairCheck.noteRestVisibleGapPx ?? 'null'}`)
    }
    if (triggeredSegments.length < 1) {
      failures.push(`expected-triggered-segment-missing:${triggeredSegments.length}`)
    }
  } else if (scenario.extraExpectation === 'zero') {
    if (pairCheck.noteRestRequestedExtraPx > EPSILON_PX) {
      failures.push(`unexpected-extra:${pairCheck.noteRestRequestedExtraPx.toFixed(3)}`)
    }
    if (scenario.key === 'fixture-beamed-sixteenth-note-rest' && triggeredSegments.length !== 0) {
      failures.push(`unexpected-triggered-segments:${triggeredSegments.length}`)
    }
  } else {
    if (pairCheck.noteRestRequestedExtraPx > EPSILON_PX && (pairCheck.noteRestVisibleGapPx ?? 0) >= -EPSILON_PX) {
      failures.push(`unexpected-nonnegative-pre-gap:${pairCheck.noteRestVisibleGapPx ?? 'null'}`)
    }
  }

  return {
    key: scenario.key,
    order: scenario.order,
    durationCode: scenario.durationCode,
    ...pairCheck,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

async function runFixtureScenario(page: Page, scenario: FixtureScenario): Promise<FixtureScenarioResult> {
  await importMusicXml(page, scenario.xmlText)
  await page.waitForTimeout(400)
  const dump = await dumpAllMeasureCoordinates(page)
  const firstRow = dump.rows[0]
  if (!firstRow) {
    throw new Error(`[${scenario.key}] No rendered measures found`)
  }
  return analyzeFixtureScenario({ row: firstRow, scenario })
}

async function main(): Promise<void> {
  const xmlPath = process.argv[2] || DEFAULT_XML_PATH
  const xmlText = await readFile(xmlPath, 'utf8')

  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  try {
    await waitForServer(DEV_URL, 120000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'networkidle' })
    await waitForDebugApi(page)
    await setScoreScale(page)

    await importMusicXml(page, xmlText)
    await page.waitForTimeout(1200)

    const dump = await dumpAllMeasureCoordinates(page)
    const firstRow = dump.rows[0]
    if (!firstRow) {
      throw new Error('No rendered measures found')
    }

    const trebleNotes = sortTrebleNotes(firstRow)
    const segmentsByKey = buildSegmentsByKey(firstRow)

    const desktopFindings: string[] = []
    const desktopCheckedPairs: PairCheck[] = []

    for (let index = 1; index < trebleNotes.length; index += 1) {
      const previous = trebleNotes[index - 1]!
      const next = trebleNotes[index]!
      const previousOnset = previous.onsetTicksInMeasure
      const nextOnset = next.onsetTicksInMeasure
      if (typeof previousOnset !== 'number' || typeof nextOnset !== 'number') continue

      const segment = segmentsByKey.get(`${previousOnset}-${nextOnset}`)
      if (!segment) continue

      const pairCheck: PairCheck = {
        fromOnsetTicks: previousOnset,
        toOnsetTicks: nextOnset,
        finalGapPx:
          assertFinite(next.visualLeftX, 'desktop.next.visualLeftX') -
          assertFinite(previous.visualRightX, 'desktop.previous.visualRightX'),
        extraReservePx: assertFinite(segment.extraReservePx ?? 0, 'desktop.segment.extraReservePx'),
        noteRestRequestedExtraPx: assertFinite(
          segment.noteRestRequestedExtraPx ?? 0,
          'desktop.segment.noteRestRequestedExtraPx',
        ),
        noteRestVisibleGapPx:
          typeof segment.noteRestVisibleGapPx === 'number' && Number.isFinite(segment.noteRestVisibleGapPx)
            ? segment.noteRestVisibleGapPx
            : null,
      }

      if (previous.isRest !== true && next.isRest === true && isFlagDuration(previous.duration)) {
        desktopCheckedPairs.push(pairCheck)
        if (pairCheck.finalGapPx < -EPSILON_PX) {
          desktopFindings.push(
            `note->rest gap stayed negative for ${previousOnset}-${nextOnset}: ${pairCheck.finalGapPx.toFixed(3)}px`,
          )
        }
        if (pairCheck.noteRestRequestedExtraPx <= EPSILON_PX) {
          desktopFindings.push(
            `note->rest segment ${previousOnset}-${nextOnset} did not request extra spacing`,
          )
        }
        if ((pairCheck.noteRestVisibleGapPx ?? 0) >= -EPSILON_PX) {
          desktopFindings.push(
            `note->rest segment ${previousOnset}-${nextOnset} was not negative before extra: ${pairCheck.noteRestVisibleGapPx ?? 'null'}`,
          )
        }
      } else if (previous.isRest === true && next.isRest !== true && isFlagDuration(next.duration)) {
        if (pairCheck.noteRestRequestedExtraPx > EPSILON_PX) {
          desktopFindings.push(
            `rest->note segment ${previousOnset}-${nextOnset} unexpectedly requested extra spacing: ${pairCheck.noteRestRequestedExtraPx.toFixed(3)}px`,
          )
        }
        if (pairCheck.finalGapPx < -EPSILON_PX) {
          desktopFindings.push(
            `rest->note gap stayed negative for ${previousOnset}-${nextOnset}: ${pairCheck.finalGapPx.toFixed(3)}px`,
          )
        }
      }
    }

    if (desktopCheckedPairs.length === 0) {
      throw new Error('Did not find any treble note->rest flagged pairs to validate')
    }

    const fixtureResults: FixtureScenarioResult[] = []
    for (const scenario of FIXTURE_SCENARIOS) {
      fixtureResults.push(await runFixtureScenario(page, scenario))
    }

    const failedFixtures = fixtureResults.filter((result) => !result.passed)
    if (desktopFindings.length > 0 || failedFixtures.length > 0) {
      const errorLines = [...desktopFindings]
      failedFixtures.forEach((fixture) => {
        errorLines.push(`[${fixture.key}] ${fixture.failureReasons.join(', ')}`)
      })
      throw new Error(errorLines.join('\n'))
    }

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      desktopCheckedPairs: desktopCheckedPairs.map((pair) => ({
        ...pair,
        finalGapPx: Number(pair.finalGapPx.toFixed(3)),
        extraReservePx: Number(pair.extraReservePx.toFixed(3)),
        noteRestRequestedExtraPx: Number(pair.noteRestRequestedExtraPx.toFixed(3)),
        noteRestVisibleGapPx:
          typeof pair.noteRestVisibleGapPx === 'number' ? Number(pair.noteRestVisibleGapPx.toFixed(3)) : null,
      })),
      fixtureResults: fixtureResults.map((result) => ({
        ...result,
        finalGapPx: Number(result.finalGapPx.toFixed(3)),
        extraReservePx: Number(result.extraReservePx.toFixed(3)),
        noteRestRequestedExtraPx: Number(result.noteRestRequestedExtraPx.toFixed(3)),
        noteRestVisibleGapPx:
          typeof result.noteRestVisibleGapPx === 'number'
            ? Number(result.noteRestVisibleGapPx.toFixed(3))
            : null,
      })),
    }

    console.log(JSON.stringify(report, null, 2))
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
