import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
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
  accidentalVisualLeftXExact?: number | null
  accidentalVisualRightXExact?: number | null
  ownHeadLeftXExact?: number | null
  ownGapPxExact?: number | null
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  noteIndex: number
  pitch: string | null
  isRest?: boolean
  duration?: string | null
  onsetTicksInMeasure: number | null
  visualRightX?: number | null
  noteHeads?: Array<{
    x: number
    y?: number | null
    pitch?: string | null
    keyIndex?: number | null
    hitMinX?: number | null
    hitMaxX?: number | null
  }>
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
  measureX?: number | null
  measureWidth?: number | null
  effectiveBoundaryStartX?: number | null
  effectiveBoundaryEndX?: number | null
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
      kind: 'same-onset-chord'
      targetPitch: string
      blockerPitch: string
      xmlText: string
    }
  | {
      key: string
      kind: 'previous-boundary'
      previousOnsetTicks: number
      targetOnsetTicks: number
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

type FixtureResult =
  | InnerFixtureResult
  | LeadingFixtureResult
  | SameOnsetChordFixtureResult
  | PreviousBoundaryFixtureResult
type SameOnsetChordFixtureResult = {
  key: string
  kind: 'same-onset-chord'
  targetPitch: string
  blockerPitch: string
  finalGapPx: number
  ownGapPx: number
  passed: boolean
  failureReasons: string[]
}

type PreviousBoundaryFixtureResult = {
  key: string
  kind: 'previous-boundary'
  previousOnsetTicks: number
  targetOnsetTicks: number
  targetPitch: string
  previousOccupiedRightX: number
  minAccidentalLeftX: number
  finalGapPx: number
  passed: boolean
  failureReasons: string[]
}

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
  userFileBeat2ToBeat3Boundary: PreviousBoundaryFixtureResult | null
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4186
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_XML_PATH = String.raw`C:\Users\76743\Desktop\1234.musicxml`
const ACCIDENTAL_SAFE_GAP_PX = 1
const ACCIDENTAL_OWN_HEAD_SAFE_GAP_PX = 2
const ACCIDENTAL_BLOCKER_SAFE_GAP_PX = 0
const SAME_ONSET_VISIBILITY_TOLERANCE_PX = 2
const GAP_EPSILON_PX = 0.15
const LEADING_MAX_GAP_PX = 2.2
const APPROX_ACCIDENTAL_WIDTH_PX = 9
const APPROX_NOTEHEAD_WIDTH_PX = 9
const DEFAULT_LEADING_BARLINE_GAP_PX = 9.7
const USER_FILE_BEAT_BOUNDARY_NAME = '二度变音记号问题.musicxml'

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

function buildChordPitchNoteXml(params: {
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
    '        <chord/>',
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
    if (event.includes('<chord/>')) return sum
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
  {
    key: 'fixture-same-onset-second-chord-accidental-clamp',
    kind: 'same-onset-chord',
    targetPitch: 'D#5',
    blockerPitch: 'C5',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '2', step: 'B', octave: 4, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      ...buildRemainingTrebleRestsXml(8),
    ]),
  },
  {
    key: 'fixture-same-onset-stem-up-accidental-clamp',
    kind: 'same-onset-chord',
    targetPitch: 'A#4',
    blockerPitch: 'G4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'E', octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(16),
    ]),
  },
  {
    key: 'fixture-user-file-first-measure-beat1',
    kind: 'same-onset-chord',
    targetPitch: 'D#5',
    blockerPitch: 'C5',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(16),
    ]),
  },
  {
    key: 'fixture-user-file-first-measure-beat2',
    kind: 'same-onset-chord',
    targetPitch: 'A#4',
    blockerPitch: 'G4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(16),
    ]),
  },
  {
    key: 'fixture-user-file-beat2-to-beat3-previous-boundary',
    kind: 'previous-boundary',
    previousOnsetTicks: 16,
    targetOnsetTicks: 32,
    targetPitch: 'B#4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '4', step: 'B', alter: 1, octave: 4, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', octave: 5, accidentalText: 'natural', stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', octave: 5, stem: 'down' }),
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

function getAccidentalRightX(note: DumpNoteRow): number | null {
  const accidentalCoords = note.accidentalCoords ?? []
  const rightX = accidentalCoords.reduce((maxValue, accidental) => {
    const leftX =
      typeof accidental.accidentalVisualLeftXExact === 'number' && Number.isFinite(accidental.accidentalVisualLeftXExact)
        ? accidental.accidentalVisualLeftXExact
        : typeof accidental.leftX === 'number' && Number.isFinite(accidental.leftX)
        ? accidental.leftX
        : Number.isFinite(accidental.rightX)
          ? accidental.rightX - APPROX_ACCIDENTAL_WIDTH_PX
          : Number.NaN
    const candidate =
      typeof accidental.accidentalVisualRightXExact === 'number' && Number.isFinite(accidental.accidentalVisualRightXExact)
        ? accidental.accidentalVisualRightXExact
        : typeof accidental.visualRightX === 'number' && Number.isFinite(accidental.visualRightX)
        ? accidental.visualRightX
        : Number.isFinite(leftX)
          ? leftX + APPROX_ACCIDENTAL_WIDTH_PX
          : Number.NEGATIVE_INFINITY
    return Math.max(maxValue, candidate)
  }, Number.NEGATIVE_INFINITY)
  return Number.isFinite(rightX) ? rightX : null
}

function getNoteOccupiedRightX(note: DumpNoteRow): number | null {
  const headRightX = (note.noteHeads ?? []).reduce((maxValue, head) => {
    const resolvedRightX = resolveNoteHeadRightWithSanity(head)
    if (resolvedRightX === null || !Number.isFinite(resolvedRightX)) return maxValue
    return Math.max(maxValue, resolvedRightX)
  }, Number.NEGATIVE_INFINITY)
  const visualRightX =
    typeof note.visualRightX === 'number' && Number.isFinite(note.visualRightX)
      ? note.visualRightX
      : Number.NEGATIVE_INFINITY
  const accidentalRightX = getAccidentalRightX(note)
  const occupiedRightX = Math.max(
    headRightX,
    visualRightX,
    typeof accidentalRightX === 'number' && Number.isFinite(accidentalRightX)
      ? accidentalRightX
      : Number.NEGATIVE_INFINITY,
  )
  return Number.isFinite(occupiedRightX) ? occupiedRightX : null
}

function resolveNoteHeadLeftWithSanity(head: {
  x?: number | null
  hitMinX?: number | null
} | null): number | null {
  if (!head) return null
  const hitMinX =
    typeof head.hitMinX === 'number' && Number.isFinite(head.hitMinX)
      ? head.hitMinX
      : null
  const headX = typeof head.x === 'number' && Number.isFinite(head.x) ? head.x : null
  return hitMinX ?? headX
}

function resolveNoteHeadRightWithSanity(head: {
  x?: number | null
  hitMinX?: number | null
  hitMaxX?: number | null
} | null): number | null {
  if (!head) return null
  const leftX = resolveNoteHeadLeftWithSanity(head)
  const hitMaxX =
    typeof head.hitMaxX === 'number' && Number.isFinite(head.hitMaxX)
      ? head.hitMaxX
      : null
  if (leftX !== null && hitMaxX !== null && hitMaxX >= leftX) {
    return hitMaxX
  }
  return leftX !== null ? leftX + APPROX_NOTEHEAD_WIDTH_PX : hitMaxX
}

function resolveNoteHeadBoundsByPitch(params: {
  note: DumpNoteRow
  pitch: string
}): { leftX: number; rightX: number } | null {
  const { note, pitch } = params
  const normalizedPitch = normalizePitch(pitch)
  const noteHead =
    (note.noteHeads ?? []).find((head) => normalizePitch(head.pitch) === normalizedPitch) ??
    null
  if (!noteHead) {
    return null
  }
  const leftX = resolveNoteHeadLeftWithSanity(noteHead)
  const rightX =
    resolveNoteHeadRightWithSanity(noteHead) ??
    (leftX !== null ? leftX + APPROX_NOTEHEAD_WIDTH_PX : null)
  if (leftX === null || rightX === null) {
    return null
  }
  return {
    leftX,
    rightX,
  }
}

function resolveOwnNoteHeadLeftX(params: {
  note: DumpNoteRow
  targetPitch: string
  keyIndex: number
}): number | null {
  const { note, targetPitch, keyIndex } = params
  const ownHeadLeftXExact = (note.accidentalCoords ?? []).find((entry) => entry.keyIndex === keyIndex)?.ownHeadLeftXExact
  if (typeof ownHeadLeftXExact === 'number' && Number.isFinite(ownHeadLeftXExact)) {
    return ownHeadLeftXExact
  }
  const noteHeads = note.noteHeads ?? []
  const byKeyIndex = noteHeads.find(
    (head) => typeof head.keyIndex === 'number' && Number.isFinite(head.keyIndex) && head.keyIndex === keyIndex,
  )
  if (byKeyIndex) {
    const resolvedLeftX = resolveNoteHeadLeftWithSanity(byKeyIndex)
    if (resolvedLeftX !== null) {
      return resolvedLeftX
    }
  }
  const normalizedTargetPitch = normalizePitch(targetPitch)
  const byPitch = noteHeads.find((head) => normalizePitch(head.pitch) === normalizedTargetPitch)
  if (byPitch) {
    const resolvedLeftX = resolveNoteHeadLeftWithSanity(byPitch)
    if (resolvedLeftX !== null) {
      return resolvedLeftX
    }
  }
  const fallback = noteHeads.reduce((maxValue, head) => {
    if (typeof head.x !== 'number' || !Number.isFinite(head.x)) return maxValue
    return Math.max(maxValue, head.x)
  }, Number.NEGATIVE_INFINITY)
  return Number.isFinite(fallback) ? fallback : null
}

function resolveOwnNoteHeadVisibleLeftX(params: {
  note: DumpNoteRow
  targetPitch: string
  keyIndex: number
}): number | null {
  const { note, targetPitch, keyIndex } = params
  const noteHeads = note.noteHeads ?? []
  const byKeyIndex = noteHeads.find(
    (head) => typeof head.keyIndex === 'number' && Number.isFinite(head.keyIndex) && head.keyIndex === keyIndex,
  )
  if (byKeyIndex) {
    const resolvedLeftX = resolveNoteHeadLeftWithSanity(byKeyIndex)
    if (resolvedLeftX !== null) {
      return resolvedLeftX
    }
  }
  const normalizedTargetPitch = normalizePitch(targetPitch)
  const byPitch = noteHeads.find((head) => normalizePitch(head.pitch) === normalizedTargetPitch)
  if (byPitch) {
    const resolvedLeftX = resolveNoteHeadLeftWithSanity(byPitch)
    if (resolvedLeftX !== null) {
      return resolvedLeftX
    }
  }
  return null
}

function findTrebleNoteByPitch(row: MeasureDumpRow, pitch: string): DumpNoteRow | null {
  const normalizedPitch = normalizePitch(pitch)
  return (
    sortTrebleNotes(row).find((note) => {
      if (normalizePitch(note.pitch) === normalizedPitch) return true
      return (note.noteHeads ?? []).some((head) => normalizePitch(head.pitch) === normalizedPitch)
    }) ?? null
  )
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

function analyzeSameOnsetChordFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'same-onset-chord' }>
}): SameOnsetChordFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const targetNote =
    findTrebleNoteByPitch(row, scenario.targetPitch) ??
    sortTrebleNotes(row).find((note) => (note.accidentalCoords?.length ?? 0) > 0) ??
    null
  const blockerNote = findTrebleNoteByPitch(row, scenario.blockerPitch)
  if (!targetNote) {
    throw new Error(`[${scenario.key}] Could not find target note ${scenario.targetPitch}`)
  }
  if (!blockerNote) {
    failures.push(`blocker-note-not-found:${scenario.blockerPitch}`)
  }
  if (
    blockerNote &&
    typeof targetNote.onsetTicksInMeasure === 'number' &&
    typeof blockerNote.onsetTicksInMeasure === 'number' &&
    targetNote.onsetTicksInMeasure !== blockerNote.onsetTicksInMeasure
  ) {
    failures.push(`onset-mismatch:${targetNote.onsetTicksInMeasure}!=${blockerNote.onsetTicksInMeasure}`)
  }

  const targetAccidental = (targetNote.accidentalCoords ?? [])[0] ?? null
  if (!targetAccidental) {
    throw new Error(`[${scenario.key}] Missing accidental coords for ${scenario.targetPitch}`)
  }
  const accidentalRightX = assertFinite(
    typeof targetAccidental.accidentalVisualRightXExact === 'number' &&
      Number.isFinite(targetAccidental.accidentalVisualRightXExact)
      ? targetAccidental.accidentalVisualRightXExact
      : getAccidentalRightX(targetNote),
    `${scenario.key}.accidentalRightX`,
  )
  const accidentalLeftX = assertFinite(
    typeof targetAccidental.accidentalVisualLeftXExact === 'number' &&
      Number.isFinite(targetAccidental.accidentalVisualLeftXExact)
      ? targetAccidental.accidentalVisualLeftXExact
      : getAccidentalLeftX(targetNote),
    `${scenario.key}.accidentalLeftX`,
  )
  const ownHeadLeftX = assertFinite(
    resolveOwnNoteHeadLeftX({
      note: targetNote,
      targetPitch: scenario.targetPitch,
      keyIndex: targetAccidental.keyIndex,
    }),
    `${scenario.key}.ownHeadLeftX`,
  )
  const ownHeadVisibleLeftX = resolveOwnNoteHeadVisibleLeftX({
    note: targetNote,
    targetPitch: scenario.targetPitch,
    keyIndex: targetAccidental.keyIndex,
  })
  const ownHeadExactFromAccidental =
    typeof targetAccidental.ownHeadLeftXExact === 'number' && Number.isFinite(targetAccidental.ownHeadLeftXExact)
      ? targetAccidental.ownHeadLeftXExact
      : null
  if (
    typeof ownHeadExactFromAccidental === 'number' &&
    Number.isFinite(ownHeadExactFromAccidental) &&
    typeof ownHeadVisibleLeftX === 'number' &&
    Number.isFinite(ownHeadVisibleLeftX) &&
    Math.abs(ownHeadExactFromAccidental - ownHeadVisibleLeftX) > 0.5 + GAP_EPSILON_PX
  ) {
    failures.push(
      `own-head-exact-mismatch:exact=${ownHeadExactFromAccidental.toFixed(3)} visible=${ownHeadVisibleLeftX.toFixed(3)}`,
    )
  }
  const blockerHeadBounds = blockerNote
    ? resolveNoteHeadBoundsByPitch({
        note: blockerNote,
        pitch: scenario.blockerPitch,
      })
    : null
  if (!blockerHeadBounds) {
    failures.push(`blocker-head-bounds-not-found:${scenario.blockerPitch}`)
  }
  const blockerHeadLeftX = blockerHeadBounds?.leftX ?? Number.NaN
  const blockerHeadRightX = blockerHeadBounds?.rightX ?? Number.NaN
  const finalGapPx = Number.isFinite(blockerHeadLeftX)
    ? blockerHeadLeftX - accidentalRightX
    : Number.NaN
  const overlapsBlockerHead =
    Number.isFinite(blockerHeadLeftX) &&
    Number.isFinite(blockerHeadRightX) &&
    accidentalRightX > blockerHeadLeftX + ACCIDENTAL_BLOCKER_SAFE_GAP_PX + GAP_EPSILON_PX &&
    accidentalLeftX < blockerHeadRightX - ACCIDENTAL_BLOCKER_SAFE_GAP_PX - GAP_EPSILON_PX
  if (Number.isFinite(finalGapPx)) {
    const blockerGapIndicatesOverlap = finalGapPx < -GAP_EPSILON_PX
    if (overlapsBlockerHead !== blockerGapIndicatesOverlap) {
      failures.push(
        `blocker-gap-geometry-mismatch:gap=${finalGapPx.toFixed(3)} overlap=${String(overlapsBlockerHead)}`,
      )
    }
  }
  if (overlapsBlockerHead) {
    failures.push(
      `blocker-head-overlap:left=${accidentalLeftX.toFixed(3)} right=${accidentalRightX.toFixed(3)} blocker=[${blockerHeadLeftX.toFixed(3)},${blockerHeadRightX.toFixed(3)}]`,
    )
  }
  const ownHeadGapPx = ownHeadLeftX - accidentalRightX
  const ownGapExact =
    typeof targetAccidental.ownGapPxExact === 'number' && Number.isFinite(targetAccidental.ownGapPxExact)
      ? targetAccidental.ownGapPxExact
      : null
  if (
    typeof ownGapExact === 'number' &&
    Number.isFinite(ownGapExact) &&
    Math.abs(ownGapExact - ownHeadGapPx) > 0.5 + GAP_EPSILON_PX
  ) {
    failures.push(`own-gap-exact-mismatch:exact=${ownGapExact.toFixed(3)} measured=${ownHeadGapPx.toFixed(3)}`)
  }
  const ownGapForAssertion =
    typeof ownGapExact === 'number' && Number.isFinite(ownGapExact)
      ? ownGapExact
      : ownHeadGapPx
  if (
    typeof ownGapExact === 'number' &&
    Number.isFinite(ownGapExact) &&
    ownHeadGapPx < ACCIDENTAL_OWN_HEAD_SAFE_GAP_PX - GAP_EPSILON_PX &&
    ownGapExact >= ACCIDENTAL_OWN_HEAD_SAFE_GAP_PX - GAP_EPSILON_PX
  ) {
    failures.push(`own-gap-truth-mismatch:exact=${ownGapExact.toFixed(3)} measured=${ownHeadGapPx.toFixed(3)}`)
  }
  if (ownGapForAssertion < ACCIDENTAL_OWN_HEAD_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`own-gap-too-small:${ownGapForAssertion.toFixed(3)}`)
  }

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
        ? row.effectiveBoundaryStartX
      : typeof row.measureX === 'number' && Number.isFinite(row.measureX)
        ? row.measureX
        : null
  const leftVisibilityAllowancePx = APPROX_ACCIDENTAL_WIDTH_PX + SAME_ONSET_VISIBILITY_TOLERANCE_PX
  if (boundaryStartX !== null && accidentalLeftX < boundaryStartX - leftVisibilityAllowancePx) {
    failures.push(
      `accidental-left-outside-measure:${accidentalLeftX.toFixed(3)}<${(boundaryStartX - leftVisibilityAllowancePx).toFixed(3)}`,
    )
  }

  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
        ? row.effectiveBoundaryEndX
      : typeof row.measureX === 'number' &&
          Number.isFinite(row.measureX) &&
          typeof row.measureWidth === 'number' &&
          Number.isFinite(row.measureWidth)
        ? row.measureX + row.measureWidth
        : null
  if (boundaryEndX !== null && accidentalRightX > boundaryEndX + SAME_ONSET_VISIBILITY_TOLERANCE_PX) {
    failures.push(
      `accidental-right-outside-measure:${accidentalRightX.toFixed(3)}>${(boundaryEndX + SAME_ONSET_VISIBILITY_TOLERANCE_PX).toFixed(3)}`,
    )
  }

  return {
    key: scenario.key,
    kind: 'same-onset-chord',
    targetPitch: scenario.targetPitch,
    blockerPitch: scenario.blockerPitch,
    finalGapPx: Number(finalGapPx.toFixed(3)),
    ownGapPx: Number(ownGapForAssertion.toFixed(3)),
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzePreviousBoundaryFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'previous-boundary' }>
}): PreviousBoundaryFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const trebleNotes = sortTrebleNotes(row)
  const previousOnsetNotes = trebleNotes.filter(
    (note) =>
      typeof note.onsetTicksInMeasure === 'number' &&
      Math.round(note.onsetTicksInMeasure) === scenario.previousOnsetTicks,
  )
  const targetOnsetNotes = trebleNotes.filter(
    (note) =>
      typeof note.onsetTicksInMeasure === 'number' &&
      Math.round(note.onsetTicksInMeasure) === scenario.targetOnsetTicks,
  )

  if (previousOnsetNotes.length === 0) {
    failures.push(`missing-previous-onset:${scenario.previousOnsetTicks}`)
  }
  if (targetOnsetNotes.length === 0) {
    failures.push(`missing-target-onset:${scenario.targetOnsetTicks}`)
  }

  const targetNote =
    targetOnsetNotes.find((note) => normalizePitch(note.pitch) === normalizePitch(scenario.targetPitch)) ??
    findTrebleNoteByPitch(row, scenario.targetPitch) ??
    null
  if (!targetNote) {
    failures.push(`target-note-not-found:${scenario.targetPitch}`)
  }

  const previousOccupiedRightX = previousOnsetNotes.reduce((maxValue, note) => {
    const occupiedRightX = getNoteOccupiedRightX(note)
    if (occupiedRightX === null || !Number.isFinite(occupiedRightX)) return maxValue
    return Math.max(maxValue, occupiedRightX)
  }, Number.NEGATIVE_INFINITY)
  if (!Number.isFinite(previousOccupiedRightX)) {
    failures.push('missing-previous-occupied-right-x')
  }

  const targetAccidentalLeftX = targetOnsetNotes.reduce((minValue, note) => {
    const accidentalLeftX = getAccidentalLeftX(note)
    if (accidentalLeftX === null || !Number.isFinite(accidentalLeftX)) return minValue
    return Math.min(minValue, accidentalLeftX)
  }, Number.POSITIVE_INFINITY)
  if (!Number.isFinite(targetAccidentalLeftX)) {
    failures.push('missing-target-accidental-left-x')
  }

  const finalGapPx =
    Number.isFinite(previousOccupiedRightX) && Number.isFinite(targetAccidentalLeftX)
      ? targetAccidentalLeftX - previousOccupiedRightX
      : Number.NaN
  if (Number.isFinite(finalGapPx) && finalGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`previous-boundary-gap-too-small:${finalGapPx.toFixed(3)}`)
  }

  return {
    key: scenario.key,
    kind: 'previous-boundary',
    previousOnsetTicks: scenario.previousOnsetTicks,
    targetOnsetTicks: scenario.targetOnsetTicks,
    targetPitch: scenario.targetPitch,
    previousOccupiedRightX: Number.isFinite(previousOccupiedRightX) ? Number(previousOccupiedRightX.toFixed(3)) : Number.NaN,
    minAccidentalLeftX: Number.isFinite(targetAccidentalLeftX) ? Number(targetAccidentalLeftX.toFixed(3)) : Number.NaN,
    finalGapPx: Number.isFinite(finalGapPx) ? Number(finalGapPx.toFixed(3)) : Number.NaN,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeFixtureScenario(row: MeasureDumpRow, scenario: FixtureScenario): FixtureResult {
  if (scenario.kind === 'leading') {
    return analyzeLeadingFixtureScenario({
      row,
      scenario,
    })
  }
  if (scenario.kind === 'previous-boundary') {
    return analyzePreviousBoundaryFixtureScenario({
      row,
      scenario,
    })
  }
  if (scenario.kind === 'same-onset-chord') {
    return analyzeSameOnsetChordFixtureScenario({
      row,
      scenario,
    })
  }
  return analyzeInnerFixtureScenario({
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
  const isDefaultDesktopXml =
    path.resolve(xmlPath).toLowerCase() === path.resolve(DEFAULT_XML_PATH).toLowerCase()

  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  try {
    await waitForServer(DEV_URL, 120000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForDebugApi(page)
    await setScoreScale(page)

    await importMusicXml(page, xmlText)
    await page.waitForTimeout(1200)

    const dump = await dumpAllMeasureCoordinates(page)
    const firstRow = dump.rows[0]
    if (!firstRow) {
      throw new Error('No rendered measures found')
    }

    const desktopTarget = isDefaultDesktopXml
      ? analyzeDesktopTarget(firstRow)
      : {
          segmentKey: 'n/a',
          finalGapPx: 0,
          accidentalRequestedExtraPx: 0,
          accidentalVisibleGapPx: null,
          passed: true,
          failureReasons: [],
        }
    const desktopKeySignatureCases = isDefaultDesktopXml ? analyzeDesktopKeySignatureCases(firstRow) : []

    const fixtureResults: FixtureResult[] = []
    for (const scenario of FIXTURE_SCENARIOS) {
      fixtureResults.push(await runFixtureScenario(page, scenario))
    }

    const isUserFileBeatBoundaryCheckTarget =
      path.basename(path.resolve(xmlPath)).toLowerCase() === USER_FILE_BEAT_BOUNDARY_NAME.toLowerCase()
    const userFileBeat2ToBeat3Boundary = isUserFileBeatBoundaryCheckTarget
      ? analyzePreviousBoundaryFixtureScenario({
          row: firstRow,
          scenario: {
            key: 'user-file-first-measure-beat2-to-beat3',
            kind: 'previous-boundary',
            previousOnsetTicks: 16,
            targetOnsetTicks: 32,
            targetPitch: 'B#4',
            xmlText: '',
          },
        })
      : null

    const failedDesktopCases = [
      ...(desktopTarget.passed ? [] : [`desktop-target:${desktopTarget.failureReasons.join(',')}`]),
      ...desktopKeySignatureCases
        .filter((entry) => !entry.passed)
        .map((entry) => `desktop-${entry.pitch}:${entry.failureReasons.join(',')}`),
      ...(userFileBeat2ToBeat3Boundary && !userFileBeat2ToBeat3Boundary.passed
        ? [`user-file-beat2-to-beat3:${userFileBeat2ToBeat3Boundary.failureReasons.join(',')}`]
        : []),
    ]
    const failedFixtures = fixtureResults
      .filter((result) => !result.passed)
      .map((result) => `[${result.key}] ${result.failureReasons.join(', ')}`)

    const userBeat1 = fixtureResults.find(
      (result): result is SameOnsetChordFixtureResult =>
        result.kind === 'same-onset-chord' && result.key === 'fixture-user-file-first-measure-beat1',
    )
    const userBeat2 = fixtureResults.find(
      (result): result is SameOnsetChordFixtureResult =>
        result.kind === 'same-onset-chord' && result.key === 'fixture-user-file-first-measure-beat2',
    )
    if (userBeat1 && userBeat2) {
      const ownGapDelta = Math.abs(userBeat1.ownGapPx - userBeat2.ownGapPx)
      console.log(
        `[user-file-own-gap-delta] beat1=${userBeat1.ownGapPx.toFixed(3)} beat2=${userBeat2.ownGapPx.toFixed(3)} delta=${ownGapDelta.toFixed(3)}`,
      )
      if (ownGapDelta > 0.5 + GAP_EPSILON_PX) {
        failedFixtures.push(
          `[user-file-own-gap-parity] beat1=${userBeat1.ownGapPx.toFixed(3)} beat2=${userBeat2.ownGapPx.toFixed(3)} delta=${ownGapDelta.toFixed(3)}`,
        )
      }
    }

    if (failedDesktopCases.length > 0 || failedFixtures.length > 0) {
      throw new Error([...failedDesktopCases, ...failedFixtures].join('\n'))
    }

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      desktopTarget,
      desktopKeySignatureCases,
      fixtureResults,
      userFileBeat2ToBeat3Boundary,
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
