import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
}

type DumpAccidentalCoord = {
  keyIndex: number
  rightX: number
  leftX?: number | null
  visualRightX?: number | null
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  noteIndex: number
  pitch: string | null
  isRest?: boolean
  duration?: string | null
  onsetTicksInMeasure: number | null
  visualRightX?: number | null
  accidentalCoords?: DumpAccidentalCoord[]
}

type DumpSpacingSegment = {
  fromOnsetTicks: number
  toOnsetTicks: number
  extraReservePx?: number | null
  accidentalRequestedExtraPx?: number | null
  accidentalVisibleGapPx?: number | null
}

type MeasureDumpRow = {
  pairIndex: number
  effectiveBoundaryStartX?: number | null
  notes: DumpNoteRow[]
  spacingSegments?: DumpSpacingSegment[]
}

type MeasureDump = {
  rows: MeasureDumpRow[]
}

type DurationCode = '32' | '16' | '8' | '4' | '2' | '1'

type FixtureScenario =
  | {
      key: string
      kind: 'inner'
      expectedExtra: 'positive' | 'zero'
      previousKind: 'note' | 'rest'
      targetPitch: string
      xmlText: string
    }
  | {
      key: string
      kind: 'leading'
      targetPitch: string
      xmlText: string
    }

type InnerFixtureResult = {
  key: string
  kind: 'inner'
  targetPitch: string
  previousKind: 'note' | 'rest'
  expectedExtra: 'positive' | 'zero'
  finalGapPx: number
  accidentalRequestedExtraPx: number
  accidentalVisibleGapPx: number | null
  passed: boolean
  failureReasons: string[]
}

type LeadingFixtureResult = {
  key: string
  kind: 'leading'
  targetPitch: string
  finalGapPx: number
  passed: boolean
  failureReasons: string[]
}

type FixtureResult = InnerFixtureResult | LeadingFixtureResult

type DesktopTargetResult = {
  segmentKey: string
  finalGapPx: number
  accidentalRequestedExtraPx: number
  accidentalVisibleGapPx: number | null
  passed: boolean
  failureReasons: string[]
}

type DesktopKeySignatureResult = {
  pitch: string
  onsetTicksInMeasure: number
  renderedAccidentalCount: number
  incomingAccidentalRequestedExtraPx: number
  passed: boolean
  failureReasons: string[]
}

type FinalReport = {
  generatedAt: string
  xmlPath: string
  desktopTarget: DesktopTargetResult
  desktopKeySignatureCases: DesktopKeySignatureResult[]
  fixtureResults: FixtureResult[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4186
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_XML_PATH = String.raw`C:\Users\76743\Desktop\1234.musicxml`
const ACCIDENTAL_SAFE_GAP_PX = 1
const GAP_EPSILON_PX = 0.15
const LEADING_MAX_GAP_PX = 2.2
const APPROX_ACCIDENTAL_WIDTH_PX = 9
const DEFAULT_LEADING_BARLINE_GAP_PX = 9.7

function durationTypeFromCode(durationCode: DurationCode): 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' {
  switch (durationCode) {
    case '1':
      return 'whole'
    case '2':
      return 'half'
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

function durationTicksFromCode(durationCode: DurationCode): number {
  switch (durationCode) {
    case '1':
      return 32
    case '2':
      return 16
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

function buildRestXml(durationCode: DurationCode, staff: 1 | 2, voice = 1): string {
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

function buildPitchNoteXml(params: {
  durationCode: DurationCode
  step: string
  octave: number
  alter?: -2 | -1 | 1 | 2
  accidentalText?: string
  stem?: 'up' | 'down'
}): string {
  const { durationCode, step, octave, alter, accidentalText, stem } = params
  const resolvedAccidentalText =
    accidentalText ??
    (alter === 2
      ? 'double-sharp'
      : alter === 1
        ? 'sharp'
        : alter === -1
          ? 'flat'
          : alter === -2
            ? 'flat-flat'
            : null)
  return [
    '      <note>',
    '        <pitch>',
    `          <step>${step}</step>`,
    ...(typeof alter === 'number' ? [`          <alter>${alter}</alter>`] : []),
    `          <octave>${octave}</octave>`,
    '        </pitch>',
    ...(resolvedAccidentalText ? [`        <accidental>${resolvedAccidentalText}</accidental>`] : []),
    `        <duration>${durationTicksFromCode(durationCode)}</duration>`,
    '        <voice>1</voice>',
    `        <type>${durationTypeFromCode(durationCode)}</type>`,
    ...(stem ? [`        <stem>${stem}</stem>`] : []),
    '        <staff>1</staff>',
    '      </note>',
  ].join('\n')
}

function buildRemainingTrebleRestsXml(remainingTicks: number): string[] {
  const restDurations: Array<{ code: DurationCode; ticks: number }> = [
    { code: '1', ticks: 32 },
    { code: '2', ticks: 16 },
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

function buildFixtureXml(events: string[]): string {
  const totalTicks = events.reduce((sum, event) => {
    const match = event.match(/<duration>(\d+)<\/duration>/)
    return sum + Number(match?.[1] ?? 0)
  }, 0)
  if (totalTicks !== 32) {
    throw new Error(`Fixture must sum to 32 ticks, received ${totalTicks}`)
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
${events.join('\n')}
${buildRestXml('1', 2)}
    </measure>
  </part>
</score-partwise>`
}

const FIXTURE_SCENARIOS: FixtureScenario[] = [
  {
    key: 'fixture-note-to-accidental-tight',
    kind: 'inner',
    expectedExtra: 'positive',
    previousKind: 'note',
    targetPitch: 'F#4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '32', step: 'E', octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '32', step: 'F', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(30),
    ]),
  },
  {
    key: 'fixture-rest-to-accidental-tight',
    kind: 'inner',
    expectedExtra: 'positive',
    previousKind: 'rest',
    targetPitch: 'G#4',
    xmlText: buildFixtureXml([
      buildRestXml('16', 1),
      buildPitchNoteXml({ durationCode: '4', step: 'G', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(22),
    ]),
  },
  {
    key: 'fixture-leading-boundary-accidental',
    kind: 'leading',
    targetPitch: 'Bbb4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({
        durationCode: '4',
        step: 'B',
        alter: -2,
        accidentalText: 'flat-flat',
        octave: 4,
        stem: 'up',
      }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
  {
    key: 'fixture-note-to-accidental-safe',
    kind: 'inner',
    expectedExtra: 'zero',
    previousKind: 'note',
    targetPitch: 'C#5',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '2', step: 'E', octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '2', step: 'C', alter: 1, octave: 5, stem: 'up' }),
    ]),
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

async function clickButton(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label }).first()
  await button.click()
}

async function ensureSpacingPanelOpen(page: Page): Promise<void> {
  const slider = page.locator('#duration-base-gap-32')
  if (await slider.isVisible().catch(() => false)) return
  await clickButton(page, '间距大小')
  await slider.waitFor()
}

async function setRangeValue(page: Page, selector: string, value: number): Promise<void> {
  const input = page.locator(selector).first()
  await input.waitFor()
  await input.evaluate((element, nextValue) => {
    const target = element as HTMLInputElement
    target.value = String(nextValue)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function setLeadingBarlineGapPx(page: Page, nextValue: number): Promise<void> {
  await ensureSpacingPanelOpen(page)
  await setRangeValue(page, '#leading-barline-gap-range', nextValue)
  await page.waitForTimeout(150)
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

function normalizePitch(pitch: string | null | undefined): string {
  return (pitch ?? '').replace(/[^A-Ga-g#bxB0-9-]/g, '').toUpperCase()
}

function assertFinite(value: number | null | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is not finite`)
  }
  return value
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

function getAccidentalLeftX(note: DumpNoteRow): number | null {
  const accidentalCoords = note.accidentalCoords ?? []
  const leftX = accidentalCoords.reduce((minValue, accidental) => {
    const candidate =
      typeof accidental.leftX === 'number' && Number.isFinite(accidental.leftX)
        ? accidental.leftX
        : Number.isFinite(accidental.rightX)
          ? accidental.rightX - APPROX_ACCIDENTAL_WIDTH_PX
          : Number.POSITIVE_INFINITY
    return Math.min(minValue, candidate)
  }, Number.POSITIVE_INFINITY)
  return Number.isFinite(leftX) ? leftX : null
}

function findTrebleNoteByPitch(row: MeasureDumpRow, pitch: string): DumpNoteRow | null {
  const normalizedPitch = normalizePitch(pitch)
  return sortTrebleNotes(row).find((note) => normalizePitch(note.pitch) === normalizedPitch) ?? null
}

function analyzeInnerFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'inner' }>
}): InnerFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const trebleNotes = sortTrebleNotes(row)
  const targetIndex = trebleNotes.findIndex((note) => normalizePitch(note.pitch) === normalizePitch(scenario.targetPitch))
  if (targetIndex <= 0) {
    throw new Error(`[${scenario.key}] Could not find target note ${scenario.targetPitch}`)
  }
  const previousNote = trebleNotes[targetIndex - 1]!
  const targetNote = trebleNotes[targetIndex]!
  const previousKind = previousNote.isRest === true ? 'rest' : 'note'
  if (previousKind !== scenario.previousKind) {
    failures.push(`previous-kind-mismatch:${previousKind}!=${scenario.previousKind}`)
  }

  const previousOnset = previousNote.onsetTicksInMeasure
  const targetOnset = targetNote.onsetTicksInMeasure
  if (typeof previousOnset !== 'number' || typeof targetOnset !== 'number') {
    throw new Error(`[${scenario.key}] Missing onset ticks for target pair`)
  }
  const segment = buildSegmentsByKey(row).get(`${previousOnset}-${targetOnset}`)
  if (!segment) {
    throw new Error(`[${scenario.key}] Missing spacing segment ${previousOnset}-${targetOnset}`)
  }

  const accidentalLeftX = assertFinite(getAccidentalLeftX(targetNote), `${scenario.key}.accidentalLeftX`)
  const previousVisualRightX = assertFinite(targetIndex > 0 ? previousNote.visualRightX : null, `${scenario.key}.previousVisualRightX`)
  const finalGapPx = accidentalLeftX - previousVisualRightX
  const accidentalRequestedExtraPx = assertFinite(
    segment.accidentalRequestedExtraPx ?? 0,
    `${scenario.key}.segment.accidentalRequestedExtraPx`,
  )
  const accidentalVisibleGapPx =
    typeof segment.accidentalVisibleGapPx === 'number' && Number.isFinite(segment.accidentalVisibleGapPx)
      ? segment.accidentalVisibleGapPx
      : null

  if (finalGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`final-gap-too-small:${finalGapPx.toFixed(3)}`)
  }

  if (scenario.expectedExtra === 'positive') {
    if (accidentalRequestedExtraPx <= GAP_EPSILON_PX) {
      failures.push(`expected-positive-extra-missing:${accidentalRequestedExtraPx.toFixed(3)}`)
    }
    if (accidentalVisibleGapPx === null || accidentalVisibleGapPx >= ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
      failures.push(`expected-tight-pre-gap-missing:${accidentalVisibleGapPx ?? 'null'}`)
    }
  } else {
    if (accidentalRequestedExtraPx > GAP_EPSILON_PX) {
      failures.push(`unexpected-extra:${accidentalRequestedExtraPx.toFixed(3)}`)
    }
    if (accidentalVisibleGapPx !== null && accidentalVisibleGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
      failures.push(`unexpected-tight-pre-gap:${accidentalVisibleGapPx.toFixed(3)}`)
    }
  }

  return {
    key: scenario.key,
    kind: 'inner',
    targetPitch: scenario.targetPitch,
    previousKind: scenario.previousKind,
    expectedExtra: scenario.expectedExtra,
    finalGapPx: Number(finalGapPx.toFixed(3)),
    accidentalRequestedExtraPx: Number(accidentalRequestedExtraPx.toFixed(3)),
    accidentalVisibleGapPx:
      typeof accidentalVisibleGapPx === 'number' ? Number(accidentalVisibleGapPx.toFixed(3)) : null,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeLeadingFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'leading' }>
}): LeadingFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const targetNote =
    findTrebleNoteByPitch(row, scenario.targetPitch) ??
    sortTrebleNotes(row).find((note) => (note.accidentalCoords?.length ?? 0) > 0) ??
    null
  if (!targetNote) {
    throw new Error(`[${scenario.key}] Could not find target note ${scenario.targetPitch}`)
  }
  const accidentalLeftX = assertFinite(getAccidentalLeftX(targetNote), `${scenario.key}.accidentalLeftX`)
  const boundaryStartX = assertFinite(row.effectiveBoundaryStartX, `${scenario.key}.effectiveBoundaryStartX`)
  const finalGapPx = accidentalLeftX - boundaryStartX

  if (finalGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`final-gap-too-small:${finalGapPx.toFixed(3)}`)
  }
  if (finalGapPx > LEADING_MAX_GAP_PX) {
    failures.push(`final-gap-too-large:${finalGapPx.toFixed(3)}`)
  }

  return {
    key: scenario.key,
    kind: 'leading',
    targetPitch: scenario.targetPitch,
    finalGapPx: Number(finalGapPx.toFixed(3)),
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeFixtureScenario(row: MeasureDumpRow, scenario: FixtureScenario): FixtureResult {
  return scenario.kind === 'leading'
    ? analyzeLeadingFixtureScenario({
        row,
        scenario,
      })
    : analyzeInnerFixtureScenario({
        row,
        scenario,
      })
}

function analyzeDesktopTarget(row: MeasureDumpRow): DesktopTargetResult {
  const failures: string[] = []
  const segmentKey = '48-52'
  const segmentsByKey = buildSegmentsByKey(row)
  const segment = segmentsByKey.get(segmentKey)
  if (!segment) {
    throw new Error(`[desktop] Missing target spacing segment ${segmentKey}`)
  }
  const trebleNotes = sortTrebleNotes(row)
  const previousNote = trebleNotes.find((note) => note.onsetTicksInMeasure === 48) ?? null
  const currentNote = trebleNotes.find((note) => note.onsetTicksInMeasure === 52) ?? null
  if (!previousNote || !currentNote) {
    throw new Error('[desktop] Could not find target treble notes for 48->52 segment')
  }
  const accidentalLeftX = assertFinite(getAccidentalLeftX(currentNote), 'desktop.target.accidentalLeftX')
  const previousVisualRightX = assertFinite(previousNote.visualRightX, 'desktop.previous.visualRightX')
  const finalGapPx = accidentalLeftX - previousVisualRightX
  const accidentalRequestedExtraPx = assertFinite(
    segment.accidentalRequestedExtraPx ?? 0,
    'desktop.segment.accidentalRequestedExtraPx',
  )
  const accidentalVisibleGapPx =
    typeof segment.accidentalVisibleGapPx === 'number' && Number.isFinite(segment.accidentalVisibleGapPx)
      ? segment.accidentalVisibleGapPx
      : null

  if (accidentalRequestedExtraPx <= GAP_EPSILON_PX) {
    failures.push(`expected-positive-extra-missing:${accidentalRequestedExtraPx.toFixed(3)}`)
  }
  if (finalGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`final-gap-too-small:${finalGapPx.toFixed(3)}`)
  }

  return {
    segmentKey,
    finalGapPx: Number(finalGapPx.toFixed(3)),
    accidentalRequestedExtraPx: Number(accidentalRequestedExtraPx.toFixed(3)),
    accidentalVisibleGapPx:
      typeof accidentalVisibleGapPx === 'number' ? Number(accidentalVisibleGapPx.toFixed(3)) : null,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeDesktopKeySignatureCases(row: MeasureDumpRow): DesktopKeySignatureResult[] {
  const trebleNotes = sortTrebleNotes(row)
  const segmentsByKey = buildSegmentsByKey(row)

  return ['G#5', 'C#5'].map((pitch) => {
    const failures: string[] = []
    const note = trebleNotes.find((entry) => normalizePitch(entry.pitch) === normalizePitch(pitch))
    if (!note) {
      throw new Error(`[desktop] Could not find key-signature pitch ${pitch}`)
    }
    const renderedAccidentalCount = note.accidentalCoords?.length ?? 0
    if (renderedAccidentalCount !== 0) {
      failures.push(`unexpected-rendered-accidental:${renderedAccidentalCount}`)
    }
    const noteIndex = trebleNotes.findIndex((entry) => entry === note)
    const previousNote = noteIndex > 0 ? trebleNotes[noteIndex - 1] ?? null : null
    let incomingAccidentalRequestedExtraPx = 0
    if (
      previousNote &&
      typeof previousNote.onsetTicksInMeasure === 'number' &&
      typeof note.onsetTicksInMeasure === 'number'
    ) {
      const segment = segmentsByKey.get(`${previousNote.onsetTicksInMeasure}-${note.onsetTicksInMeasure}`)
      incomingAccidentalRequestedExtraPx = assertFinite(
        segment?.accidentalRequestedExtraPx ?? 0,
        `[desktop] ${pitch} accidentalRequestedExtraPx`,
      )
      if (incomingAccidentalRequestedExtraPx > GAP_EPSILON_PX) {
        failures.push(`unexpected-extra:${incomingAccidentalRequestedExtraPx.toFixed(3)}`)
      }
    }
    return {
      pitch,
      onsetTicksInMeasure: assertFinite(note.onsetTicksInMeasure, `[desktop] ${pitch} onsetTicksInMeasure`),
      renderedAccidentalCount,
      incomingAccidentalRequestedExtraPx: Number(incomingAccidentalRequestedExtraPx.toFixed(3)),
      passed: failures.length === 0,
      failureReasons: failures,
    }
  })
}

async function runFixtureScenario(page: Page, scenario: FixtureScenario): Promise<FixtureResult> {
  await setLeadingBarlineGapPx(
    page,
    scenario.kind === 'leading' ? 0 : DEFAULT_LEADING_BARLINE_GAP_PX,
  )
  await importMusicXml(page, scenario.xmlText)
  await page.waitForTimeout(400)
  const dump = await dumpAllMeasureCoordinates(page)
  const firstRow = dump.rows[0]
  if (!firstRow) {
    throw new Error(`[${scenario.key}] No rendered measures found`)
  }
  return analyzeFixtureScenario(firstRow, scenario)
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
    await page.goto(DEV_URL, { waitUntil: 'networkidle', timeout: 120000 })
    await waitForDebugApi(page)
    await setScoreScale(page)

    await importMusicXml(page, xmlText)
    await page.waitForTimeout(1200)

    const dump = await dumpAllMeasureCoordinates(page)
    const firstRow = dump.rows[0]
    if (!firstRow) {
      throw new Error('No rendered measures found')
    }

    const desktopTarget = analyzeDesktopTarget(firstRow)
    const desktopKeySignatureCases = analyzeDesktopKeySignatureCases(firstRow)

    const fixtureResults: FixtureResult[] = []
    for (const scenario of FIXTURE_SCENARIOS) {
      fixtureResults.push(await runFixtureScenario(page, scenario))
    }

    const failedDesktopCases = [
      ...(desktopTarget.passed ? [] : [`desktop-target:${desktopTarget.failureReasons.join(',')}`]),
      ...desktopKeySignatureCases
        .filter((entry) => !entry.passed)
        .map((entry) => `desktop-${entry.pitch}:${entry.failureReasons.join(',')}`),
    ]
    const failedFixtures = fixtureResults
      .filter((result) => !result.passed)
      .map((result) => `[${result.key}] ${result.failureReasons.join(', ')}`)

    if (failedDesktopCases.length > 0 || failedFixtures.length > 0) {
      throw new Error([...failedDesktopCases, ...failedFixtures].join('\n'))
    }

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      desktopTarget,
      desktopKeySignatureCases,
      fixtureResults,
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
