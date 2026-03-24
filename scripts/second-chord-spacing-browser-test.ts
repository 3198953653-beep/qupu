import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type PagingState = {
  currentPage: number
  pageCount: number
}

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
  scoreScale?: number
}

type StaffKind = 'treble' | 'bass'
type StaffSlotWinner = StaffKind | 'tie' | 'none'

type DumpNoteHead = {
  keyIndex: number
  pitch: string | null
  x: number
  y: number
}

type DumpNoteRow = {
  staff: StaffKind
  noteId: string
  noteIndex: number
  pitch: string | null
  isRest?: boolean
  onsetTicksInMeasure: number | null
  x: number
  rightX?: number | null
  spacingRightX?: number | null
  noteHeads: DumpNoteHead[]
  accidentalCoords?: Array<{
    keyIndex: number
    rightX: number
  }>
}

type DumpSpacingOnsetReserve = {
  onsetTicks: number
  baseX: number | null
  finalX: number | null
  leftReservePx: number | null
  rightReservePx: number | null
  rawLeftReservePx?: number | null
  rawRightReservePx?: number | null
  leftOccupiedInsetPx?: number | null
  rightOccupiedTailPx?: number | null
  leadingTrebleRequestedExtraPx?: number | null
  leadingBassRequestedExtraPx?: number | null
  leadingWinningStaff?: StaffSlotWinner
  trailingTrebleRequestedExtraPx?: number | null
  trailingBassRequestedExtraPx?: number | null
  trailingWinningStaff?: StaffSlotWinner
}

type DumpSpacingSegment = {
  fromOnsetTicks: number
  toOnsetTicks: number
  baseGapPx: number | null
  extraReservePx: number | null
  appliedGapPx: number | null
  trebleRequestedExtraPx?: number | null
  bassRequestedExtraPx?: number | null
  winningStaff?: StaffSlotWinner
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  measureWidth?: number | null
  measureStartBarX?: number | null
  measureEndBarX?: number | null
  effectiveBoundaryStartX?: number | null
  effectiveBoundaryEndX?: number | null
  effectiveLeftGapPx?: number | null
  effectiveRightGapPx?: number | null
  leadingGapPx?: number | null
  trailingGapPx?: number | null
  spacingOccupiedLeftX?: number | null
  spacingOccupiedRightX?: number | null
  spacingOnsetReserves?: DumpSpacingOnsetReserve[]
  spacingSegments?: DumpSpacingSegment[]
  overflowVsNoteEndX: number | null
  overflowVsMeasureEndBarX: number | null
  notes: DumpNoteRow[]
}

type MeasureDump = {
  totalMeasureCount: number
  renderedMeasureCount: number
  rows: MeasureDumpRow[]
}

type MergedMeasureDumpRow = MeasureDumpRow & {
  renderedPageIndex: number | null
}

type ScaleCase = {
  key: string
  autoScaleEnabled: boolean
  manualScalePercent: number
}

type StaffOnsetMetrics = {
  onsetTicks: number
  baseX: number | null
  finalX: number | null
  shiftDeltaPx: number
  rawLeftReservePx: number
  rawRightReservePx: number
  baseOccupiedLeftX: number | null
  baseOccupiedRightX: number | null
  finalOccupiedLeftX: number | null
  finalOccupiedRightX: number | null
}

type SlotRequestSummary = {
  requestedExtraPx: number
  winningStaff: StaffSlotWinner
}

type DesktopTargetResult = {
  pairIndex: number
  renderedPageIndex: number | null
  noteIndex: number | null
  onsetTicks: number | null
  direction: 'aligned' | 'backward' | 'forward' | 'both' | 'missing'
  headXs: number[]
  rawLeftReservePx: number | null
  rawRightReservePx: number | null
  expectedLeftRequestPx: number | null
  actualLeftRequestPx: number | null
  leftWinningStaff: StaffSlotWinner
  expectedRightRequestPx: number | null
  actualRightRequestPx: number | null
  rightWinningStaff: StaffSlotWinner
  visibleLeftGapPx: number | null
  visibleRightGapPx: number | null
  passed: boolean
  failureReasons: string[]
}

type DesktopScenarioReport = {
  key: string
  scale: DebugScaleConfig
  passed: boolean
  targets: DesktopTargetResult[]
}

type FixtureResult = {
  key: string
  scale: DebugScaleConfig
  measureWidth: number | null
  targetOnsetTicks: number | null
  direction: 'aligned' | 'backward' | 'forward' | 'both' | 'missing'
  headXs: number[]
  expectedLeftRequestPx: number | null
  actualLeftRequestPx: number | null
  leftWinningStaff: StaffSlotWinner
  expectedRightRequestPx: number | null
  actualRightRequestPx: number | null
  rightWinningStaff: StaffSlotWinner
  visibleLeftGapPx: number | null
  visibleRightGapPx: number | null
  passed: boolean
  failureReasons: string[]
}

type FinalReport = {
  generatedAt: string
  xmlPath: string
  desktopScenarios: DesktopScenarioReport[]
  fixtureResults: FixtureResult[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4176
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const TARGET_PAIR_COUNT = 8
const GAP_EPSILON_PX = 0.15
const HEAD_X_EPSILON_PX = 0.01
const MIN_NON_OVERLAP_GAP_PX = 0
const DEFAULT_NOTE_HEAD_WIDTH_PX = 9
const APPROX_ACCIDENTAL_WIDTH_PX = 8

const SCALE_CASES: ScaleCase[] = [
  { key: 'manual-100', autoScaleEnabled: false, manualScalePercent: 100 },
  { key: 'auto-scale', autoScaleEnabled: true, manualScalePercent: 100 },
]

const FIXTURE_SCALE_CASE: ScaleCase = {
  key: 'manual-100',
  autoScaleEnabled: false,
  manualScalePercent: 100,
}

const CROSS_STAFF_FALSE_POSITIVE_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <duration>3</duration>
        <type>eighth</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>1</duration>
        <type>16th</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>5</octave></pitch>
        <duration>8</duration>
        <type>half</type>
        <staff>1</staff>
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
      <note>
        <chord/>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>3</octave></pitch>
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

const LOCAL_BASS_BOUNDARY_COLLISION_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>3</octave></pitch>
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
      <note>
        <pitch><step>A</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

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
      const response = await fetch(url, { method: 'GET' })
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
        typeof api.getImportFeedback === 'function' &&
        typeof api.getPaging === 'function' &&
        typeof api.dumpAllMeasureCoordinates === 'function' &&
        typeof api.getScaleConfig === 'function' &&
        typeof api.setAutoScaleEnabled === 'function' &&
        typeof api.setManualScalePercent === 'function'
      )
    },
    undefined,
    { timeout: 120000 },
  )
}

async function waitForImportSuccess(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api =
        (window as unknown as { __scoreDebug?: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
      if (!api || typeof api.getImportFeedback !== 'function') return false
      const feedback = api.getImportFeedback()
      return feedback.kind === 'success' || feedback.kind === 'error'
    },
    undefined,
    { timeout: 120000 },
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

async function importMusicXml(page: Page, xmlText: string): Promise<void> {
  await page.evaluate((xml) => {
    const api = (window as unknown as { __scoreDebug: { importMusicXmlText: (text: string) => void } }).__scoreDebug
    api.importMusicXmlText(xml)
  }, xmlText)
  await waitForImportSuccess(page)
}

async function setScoreScale(page: Page, params: ScaleCase): Promise<DebugScaleConfig> {
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
      const next = api.getScaleConfig()
      return next.autoScaleEnabled === enabled && Math.abs(next.manualScalePercent - percent) < 0.001
    },
    { enabled: params.autoScaleEnabled, percent: params.manualScalePercent },
    { timeout: 120000 },
  )
  await page.waitForTimeout(150)
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getScaleConfig: () => { autoScaleEnabled: boolean; manualScalePercent: number; scoreScale?: number }
      }
    }).__scoreDebug
    return api.getScaleConfig()
  })
}

async function getPaging(page: Page): Promise<PagingState> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { getPaging: () => PagingState }
    }).__scoreDebug
    return api.getPaging()
  })
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
    }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

async function collectMergedRows(page: Page): Promise<MergedMeasureDumpRow[]> {
  const paging = await getPaging(page)
  const initialDump = await dumpAllMeasureCoordinates(page)
  const renderedPageIndex = paging.currentPage
  const mergedRows = Array.from({ length: initialDump.totalMeasureCount }, (_, pairIndex) => {
    const row = initialDump.rows[pairIndex]
    if (row) {
      return {
        ...row,
        renderedPageIndex: row.rendered ? renderedPageIndex : null,
      }
    }
    return {
      pairIndex,
      rendered: false,
      renderedPageIndex: null,
      overflowVsNoteEndX: null,
      overflowVsMeasureEndBarX: null,
      notes: [],
    }
  })

  const scrollMetrics = await page.evaluate(() => {
    const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLElement | null
    if (scrollHost) {
      return {
        mode: 'host' as const,
        maxScrollLeft: Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth),
        maxScrollTop: Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight),
        clientWidth: scrollHost.clientWidth,
        clientHeight: scrollHost.clientHeight,
      }
    }
    return {
      mode: 'window' as const,
      maxScrollLeft: Math.max(
        0,
        Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - window.innerWidth,
      ),
      maxScrollTop: Math.max(
        0,
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight,
      ),
      clientWidth: window.innerWidth,
      clientHeight: window.innerHeight,
    }
  })
  const scrollLeftPositions = new Set<number>([0])
  const scrollTopPositions = new Set<number>([0])
  const horizontalStep = Math.max(1, Math.floor(scrollMetrics.clientWidth * 0.85))
  const verticalStep = Math.max(1, Math.floor(scrollMetrics.clientHeight * 0.85))
  for (let scrollLeft = 0; scrollLeft <= scrollMetrics.maxScrollLeft; scrollLeft += horizontalStep) {
    scrollLeftPositions.add(scrollLeft)
  }
  for (let scrollTop = 0; scrollTop <= scrollMetrics.maxScrollTop; scrollTop += verticalStep) {
    scrollTopPositions.add(scrollTop)
  }
  scrollLeftPositions.add(scrollMetrics.maxScrollLeft)
  scrollTopPositions.add(scrollMetrics.maxScrollTop)

  for (const scrollTop of [...scrollTopPositions].sort((left, right) => left - right)) {
    for (const scrollLeft of [...scrollLeftPositions].sort((left, right) => left - right)) {
      await page.evaluate(
        ({ mode, nextScrollLeft, nextScrollTop }) => {
          if (mode === 'host') {
            const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLElement | null
            scrollHost?.scrollTo({ left: nextScrollLeft, top: nextScrollTop })
            return
          }
          window.scrollTo(nextScrollLeft, nextScrollTop)
        },
        {
          mode: scrollMetrics.mode,
          nextScrollLeft: scrollLeft,
          nextScrollTop: scrollTop,
        },
      )
      await page.waitForTimeout(150)
      const dump = await dumpAllMeasureCoordinates(page)
      dump.rows.forEach((row, pairIndex) => {
        if (!row?.rendered) return
        mergedRows[pairIndex] = {
          ...row,
          renderedPageIndex,
        }
      })
    }
  }

  return mergedRows
}

function resolveDesktopXmlPath(candidatePath: string | undefined): Promise<string> {
  if (candidatePath) {
    return Promise.resolve(path.resolve(candidatePath))
  }

  const desktopDir = path.resolve(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Desktop')
  const exactPath = path.join(desktopDir, '三个声部2（D调）.musicxml')

  return readdir(desktopDir, { withFileTypes: true }).then((entries) => {
    const exactMatch = entries.find((entry) => entry.isFile() && entry.name === path.basename(exactPath))
    if (exactMatch) {
      return exactPath
    }

    const fuzzyMatch = entries.find(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.musicxml') &&
        entry.name.includes('三个声部2') &&
        entry.name.includes('D调'),
    )
    if (fuzzyMatch) {
      return path.join(desktopDir, fuzzyMatch.name)
    }

    throw new Error(`Cannot find 三个声部2（D调）.musicxml under ${desktopDir}`)
  })
}

function dedupeSortedNumbers(values: number[], epsilon: number): number[] {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Number(value.toFixed(3)))
    .sort((left, right) => left - right)
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]) > epsilon)
}

function classifyDirection(anchorX: number | null, headXs: number[]): 'aligned' | 'backward' | 'forward' | 'both' | 'missing' {
  if (anchorX === null || !Number.isFinite(anchorX) || headXs.length === 0) return 'missing'
  const hasBackward = headXs.some((headX) => headX < anchorX - HEAD_X_EPSILON_PX)
  const hasForward = headXs.some((headX) => headX > anchorX + HEAD_X_EPSILON_PX)
  if (hasBackward && hasForward) return 'both'
  if (hasBackward) return 'backward'
  if (hasForward) return 'forward'
  return 'aligned'
}

function toRoundedFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null
}

function approximatelyEqual(left: number | null, right: number | null, epsilon = GAP_EPSILON_PX): boolean {
  if (left === null || right === null) return false
  return Math.abs(left - right) <= epsilon
}

function sanitizeSpacingOnsetReserve(
  entry: DumpSpacingOnsetReserve | null | undefined,
): DumpSpacingOnsetReserve | null {
  if (!entry || !Number.isFinite(entry.onsetTicks)) return null
  return {
    onsetTicks: Math.round(entry.onsetTicks),
    baseX: toRoundedFiniteNumber(entry.baseX),
    finalX: toRoundedFiniteNumber(entry.finalX),
    leftReservePx: toRoundedFiniteNumber(entry.leftReservePx),
    rightReservePx: toRoundedFiniteNumber(entry.rightReservePx),
    rawLeftReservePx: toRoundedFiniteNumber(entry.rawLeftReservePx),
    rawRightReservePx: toRoundedFiniteNumber(entry.rawRightReservePx),
    leftOccupiedInsetPx: toRoundedFiniteNumber(entry.leftOccupiedInsetPx),
    rightOccupiedTailPx: toRoundedFiniteNumber(entry.rightOccupiedTailPx),
    leadingTrebleRequestedExtraPx: toRoundedFiniteNumber(entry.leadingTrebleRequestedExtraPx),
    leadingBassRequestedExtraPx: toRoundedFiniteNumber(entry.leadingBassRequestedExtraPx),
    leadingWinningStaff: entry.leadingWinningStaff ?? 'none',
    trailingTrebleRequestedExtraPx: toRoundedFiniteNumber(entry.trailingTrebleRequestedExtraPx),
    trailingBassRequestedExtraPx: toRoundedFiniteNumber(entry.trailingBassRequestedExtraPx),
    trailingWinningStaff: entry.trailingWinningStaff ?? 'none',
  }
}

function sanitizeSpacingSegment(entry: DumpSpacingSegment | null | undefined): DumpSpacingSegment | null {
  if (!entry || !Number.isFinite(entry.fromOnsetTicks) || !Number.isFinite(entry.toOnsetTicks)) return null
  return {
    fromOnsetTicks: Math.round(entry.fromOnsetTicks),
    toOnsetTicks: Math.round(entry.toOnsetTicks),
    baseGapPx: toRoundedFiniteNumber(entry.baseGapPx),
    extraReservePx: toRoundedFiniteNumber(entry.extraReservePx),
    appliedGapPx: toRoundedFiniteNumber(entry.appliedGapPx),
    trebleRequestedExtraPx: toRoundedFiniteNumber(entry.trebleRequestedExtraPx),
    bassRequestedExtraPx: toRoundedFiniteNumber(entry.bassRequestedExtraPx),
    winningStaff: entry.winningStaff ?? 'none',
  }
}

function getNoteOccupiedLeftX(note: DumpNoteRow): number | null {
  let minX = Number.POSITIVE_INFINITY
  note.noteHeads.forEach((head) => {
    if (Number.isFinite(head.x)) {
      minX = Math.min(minX, head.x)
    }
  })
  note.accidentalCoords?.forEach((accidental) => {
    if (Number.isFinite(accidental.rightX)) {
      minX = Math.min(minX, accidental.rightX - APPROX_ACCIDENTAL_WIDTH_PX)
    }
  })
  if (Number.isFinite(note.x)) {
    minX = Math.min(minX, note.x)
  }
  return Number.isFinite(minX) ? Number(minX.toFixed(3)) : null
}

function getNoteOccupiedRightX(note: DumpNoteRow): number | null {
  let maxX = Number.NEGATIVE_INFINITY
  if (typeof note.rightX === 'number' && Number.isFinite(note.rightX)) {
    maxX = Math.max(maxX, note.rightX)
  }
  if (typeof note.spacingRightX === 'number' && Number.isFinite(note.spacingRightX)) {
    maxX = Math.max(maxX, note.spacingRightX)
  }
  note.noteHeads.forEach((head) => {
    if (Number.isFinite(head.x)) {
      maxX = Math.max(maxX, head.x + DEFAULT_NOTE_HEAD_WIDTH_PX)
    }
  })
  if (Number.isFinite(note.x)) {
    maxX = Math.max(maxX, note.x)
  }
  return Number.isFinite(maxX) ? Number(maxX.toFixed(3)) : null
}

function getNoteRawReserveExtents(note: DumpNoteRow): { rawLeftReservePx: number; rawRightReservePx: number } {
  if (!Number.isFinite(note.x)) {
    return {
      rawLeftReservePx: 0,
      rawRightReservePx: 0,
    }
  }

  let rawLeftReservePx = 0
  let rawRightReservePx = 0
  note.noteHeads.forEach((head) => {
    if (!Number.isFinite(head.x)) return
    if (head.x < note.x - HEAD_X_EPSILON_PX) {
      rawLeftReservePx = Math.max(rawLeftReservePx, note.x - head.x)
    }
    if (head.x > note.x + HEAD_X_EPSILON_PX) {
      rawRightReservePx = Math.max(rawRightReservePx, head.x - note.x)
    }
  })
  note.accidentalCoords?.forEach((accidental) => {
    if (!Number.isFinite(accidental.rightX)) return
    const accidentalLeftX = accidental.rightX - APPROX_ACCIDENTAL_WIDTH_PX
    rawLeftReservePx = Math.max(rawLeftReservePx, note.x - accidentalLeftX)
  })

  return {
    rawLeftReservePx: Number(rawLeftReservePx.toFixed(3)),
    rawRightReservePx: Number(rawRightReservePx.toFixed(3)),
  }
}

function resolveWinningStaff(trebleRequestedExtraPx: number, bassRequestedExtraPx: number): StaffSlotWinner {
  const safeTrebleRequestedExtraPx = Math.max(0, trebleRequestedExtraPx)
  const safeBassRequestedExtraPx = Math.max(0, bassRequestedExtraPx)
  if (safeTrebleRequestedExtraPx <= 0 && safeBassRequestedExtraPx <= 0) return 'none'
  if (Math.abs(safeTrebleRequestedExtraPx - safeBassRequestedExtraPx) <= 0.001) return 'tie'
  return safeTrebleRequestedExtraPx > safeBassRequestedExtraPx ? 'treble' : 'bass'
}

function getSpacingOnsetReserves(row: MergedMeasureDumpRow): DumpSpacingOnsetReserve[] {
  return (row.spacingOnsetReserves ?? [])
    .map((entry) => sanitizeSpacingOnsetReserve(entry))
    .filter((entry): entry is DumpSpacingOnsetReserve => entry !== null)
    .sort((left, right) => left.onsetTicks - right.onsetTicks)
}

function getSpacingSegments(row: MergedMeasureDumpRow): DumpSpacingSegment[] {
  return (row.spacingSegments ?? [])
    .map((entry) => sanitizeSpacingSegment(entry))
    .filter((entry): entry is DumpSpacingSegment => entry !== null)
    .sort((left, right) => {
      if (left.fromOnsetTicks !== right.fromOnsetTicks) return left.fromOnsetTicks - right.fromOnsetTicks
      return left.toOnsetTicks - right.toOnsetTicks
    })
}

function buildStaffOnsetMetrics(row: MergedMeasureDumpRow, staff: StaffKind): StaffOnsetMetrics[] {
  const onsetReserveByTick = new Map<number, DumpSpacingOnsetReserve>()
  getSpacingOnsetReserves(row).forEach((entry) => {
    onsetReserveByTick.set(entry.onsetTicks, entry)
  })

  const notesByTick = new Map<number, DumpNoteRow[]>()
  row.notes.forEach((note) => {
    if (note.staff !== staff || note.isRest === true) return
    if (typeof note.onsetTicksInMeasure !== 'number' || !Number.isFinite(note.onsetTicksInMeasure)) return
    const onsetTicks = Math.round(note.onsetTicksInMeasure)
    const bucket = notesByTick.get(onsetTicks)
    if (bucket) {
      bucket.push(note)
      return
    }
    notesByTick.set(onsetTicks, [note])
  })

  return [...notesByTick.keys()]
    .sort((left, right) => left - right)
    .map((onsetTicks) => {
      const onsetNotes = notesByTick.get(onsetTicks) ?? []
      const onsetReserve = onsetReserveByTick.get(onsetTicks) ?? null
      const finalXFromNote = onsetNotes.find((note) => Number.isFinite(note.x))?.x ?? null
      const finalX = onsetReserve?.finalX ?? toRoundedFiniteNumber(finalXFromNote)
      const baseX = onsetReserve?.baseX ?? finalX
      const shiftDeltaPx =
        finalX !== null && baseX !== null ? Number((finalX - baseX).toFixed(3)) : 0

      let rawLeftReservePx = 0
      let rawRightReservePx = 0
      let finalOccupiedLeftX = Number.POSITIVE_INFINITY
      let finalOccupiedRightX = Number.NEGATIVE_INFINITY

      onsetNotes.forEach((note) => {
        const rawReserve = getNoteRawReserveExtents(note)
        rawLeftReservePx = Math.max(rawLeftReservePx, rawReserve.rawLeftReservePx)
        rawRightReservePx = Math.max(rawRightReservePx, rawReserve.rawRightReservePx)
        const occupiedLeftX = getNoteOccupiedLeftX(note)
        const occupiedRightX = getNoteOccupiedRightX(note)
        if (occupiedLeftX !== null) finalOccupiedLeftX = Math.min(finalOccupiedLeftX, occupiedLeftX)
        if (occupiedRightX !== null) finalOccupiedRightX = Math.max(finalOccupiedRightX, occupiedRightX)
      })

      const safeFinalOccupiedLeftX =
        Number.isFinite(finalOccupiedLeftX) ? Number(finalOccupiedLeftX.toFixed(3)) : finalX
      const safeFinalOccupiedRightX =
        Number.isFinite(finalOccupiedRightX) ? Number(finalOccupiedRightX.toFixed(3)) : finalX

      return {
        onsetTicks,
        baseX,
        finalX,
        shiftDeltaPx,
        rawLeftReservePx: Number(rawLeftReservePx.toFixed(3)),
        rawRightReservePx: Number(rawRightReservePx.toFixed(3)),
        finalOccupiedLeftX: safeFinalOccupiedLeftX,
        finalOccupiedRightX: safeFinalOccupiedRightX,
        baseOccupiedLeftX:
          safeFinalOccupiedLeftX !== null
            ? Number((safeFinalOccupiedLeftX - shiftDeltaPx).toFixed(3))
            : null,
        baseOccupiedRightX:
          safeFinalOccupiedRightX !== null
            ? Number((safeFinalOccupiedRightX - shiftDeltaPx).toFixed(3))
            : null,
      }
    })
}

function computeExpectedLeftRequestPx(
  metrics: StaffOnsetMetrics,
  previousMetrics: StaffOnsetMetrics | null,
  boundaryStartX: number | null,
): number {
  if (metrics.rawLeftReservePx <= HEAD_X_EPSILON_PX) return 0
  if (metrics.baseX === null) return 0
  const blockerRightX = previousMetrics?.baseOccupiedRightX ?? boundaryStartX
  if (blockerRightX === null) return 0
  const availableLeftClearancePx = Math.max(0, metrics.baseX - blockerRightX)
  return Number(Math.max(0, metrics.rawLeftReservePx - availableLeftClearancePx).toFixed(3))
}

function computeExpectedRightRequestPx(
  metrics: StaffOnsetMetrics,
  nextMetrics: StaffOnsetMetrics | null,
  boundaryEndX: number | null,
): number {
  if (metrics.rawRightReservePx <= HEAD_X_EPSILON_PX) return 0
  if (metrics.baseX === null || metrics.baseOccupiedRightX === null) return 0
  const blockerLeftX = nextMetrics?.baseOccupiedLeftX ?? boundaryEndX
  if (blockerLeftX === null) return 0
  const baseRightTailPx = Math.max(0, metrics.baseOccupiedRightX - metrics.baseX)
  const baseRightBodyPx = Math.max(0, baseRightTailPx - metrics.rawRightReservePx)
  const availableRightProtrusionClearancePx = Math.max(0, blockerLeftX - metrics.baseX - baseRightBodyPx)
  return Number(Math.max(0, metrics.rawRightReservePx - availableRightProtrusionClearancePx).toFixed(3))
}

function resolveSlotRequestSummary(params: {
  row: MergedMeasureDumpRow
  staff: StaffKind
  onsetTicks: number
  side: 'left' | 'right'
}): SlotRequestSummary {
  const onsetReserves = getSpacingOnsetReserves(params.row)
  const spacingSegments = getSpacingSegments(params.row)
  const sharedIndex = onsetReserves.findIndex((entry) => entry.onsetTicks === params.onsetTicks)
  if (sharedIndex < 0) {
    return {
      requestedExtraPx: 0,
      winningStaff: 'none',
    }
  }

  const onsetReserve = onsetReserves[sharedIndex] ?? null
  const isFirst = sharedIndex === 0
  const isLast = sharedIndex === onsetReserves.length - 1

  if (params.side === 'left') {
    if (isFirst) {
      return {
        requestedExtraPx:
          params.staff === 'treble'
            ? Math.max(0, onsetReserve?.leadingTrebleRequestedExtraPx ?? 0)
            : Math.max(0, onsetReserve?.leadingBassRequestedExtraPx ?? 0),
        winningStaff: onsetReserve?.leadingWinningStaff ?? 'none',
      }
    }
    const previousSegment =
      spacingSegments.find((segment) => segment.toOnsetTicks === params.onsetTicks) ?? null
    return {
      requestedExtraPx:
        params.staff === 'treble'
          ? Math.max(0, previousSegment?.trebleRequestedExtraPx ?? 0)
          : Math.max(0, previousSegment?.bassRequestedExtraPx ?? 0),
      winningStaff: previousSegment?.winningStaff ?? 'none',
    }
  }

  if (isLast) {
    return {
      requestedExtraPx:
        params.staff === 'treble'
          ? Math.max(0, onsetReserve?.trailingTrebleRequestedExtraPx ?? 0)
          : Math.max(0, onsetReserve?.trailingBassRequestedExtraPx ?? 0),
      winningStaff: onsetReserve?.trailingWinningStaff ?? 'none',
    }
  }
  const nextSegment =
    spacingSegments.find((segment) => segment.fromOnsetTicks === params.onsetTicks) ?? null
  return {
    requestedExtraPx:
      params.staff === 'treble'
        ? Math.max(0, nextSegment?.trebleRequestedExtraPx ?? 0)
        : Math.max(0, nextSegment?.bassRequestedExtraPx ?? 0),
    winningStaff: nextSegment?.winningStaff ?? 'none',
  }
}

function pushFailure(failures: string[], code: string, detail?: string | number | null): void {
  if (detail === undefined) {
    failures.push(code)
    return
  }
  failures.push(`${code}:${detail}`)
}

function validateSharedSlotDebug(row: MergedMeasureDumpRow, failures: string[]): void {
  const onsetReserves = getSpacingOnsetReserves(row)
  const spacingSegments = getSpacingSegments(row)

  spacingSegments.forEach((segment) => {
    const trebleRequestedExtraPx = Math.max(0, segment.trebleRequestedExtraPx ?? 0)
    const bassRequestedExtraPx = Math.max(0, segment.bassRequestedExtraPx ?? 0)
    const expectedExtraReservePx = Number(Math.max(trebleRequestedExtraPx, bassRequestedExtraPx).toFixed(3))
    if (!approximatelyEqual(segment.extraReservePx, expectedExtraReservePx)) {
      pushFailure(
        failures,
        'segment-extra-not-max',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.extraReservePx ?? 'null'}!=${expectedExtraReservePx}`,
      )
    }
    const expectedAppliedGapPx =
      segment.baseGapPx !== null ? Number((segment.baseGapPx + expectedExtraReservePx).toFixed(3)) : null
    if (!approximatelyEqual(segment.appliedGapPx, expectedAppliedGapPx)) {
      pushFailure(
        failures,
        'segment-applied-gap-mismatch',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.appliedGapPx ?? 'null'}!=${expectedAppliedGapPx ?? 'null'}`,
      )
    }
    const expectedWinningStaff = resolveWinningStaff(trebleRequestedExtraPx, bassRequestedExtraPx)
    if ((segment.winningStaff ?? 'none') !== expectedWinningStaff) {
      pushFailure(
        failures,
        'segment-winning-staff-mismatch',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.winningStaff ?? 'none'}!=${expectedWinningStaff}`,
      )
    }
  })

  const firstOnsetReserve = onsetReserves[0] ?? null
  if (firstOnsetReserve) {
    const expectedLeadingExtraPx = Number(
      Math.max(
        Math.max(0, firstOnsetReserve.leadingTrebleRequestedExtraPx ?? 0),
        Math.max(0, firstOnsetReserve.leadingBassRequestedExtraPx ?? 0),
      ).toFixed(3),
    )
    if (!approximatelyEqual(firstOnsetReserve.leftReservePx, expectedLeadingExtraPx)) {
      pushFailure(
        failures,
        'leading-slot-not-max',
        `${firstOnsetReserve.leftReservePx ?? 'null'}!=${expectedLeadingExtraPx}`,
      )
    }
    const expectedLeadingWinner = resolveWinningStaff(
      Math.max(0, firstOnsetReserve.leadingTrebleRequestedExtraPx ?? 0),
      Math.max(0, firstOnsetReserve.leadingBassRequestedExtraPx ?? 0),
    )
    if ((firstOnsetReserve.leadingWinningStaff ?? 'none') !== expectedLeadingWinner) {
      pushFailure(
        failures,
        'leading-winning-staff-mismatch',
        `${firstOnsetReserve.leadingWinningStaff ?? 'none'}!=${expectedLeadingWinner}`,
      )
    }
  }

  const lastOnsetReserve = onsetReserves[onsetReserves.length - 1] ?? null
  if (lastOnsetReserve) {
    const expectedTrailingExtraPx = Number(
      Math.max(
        Math.max(0, lastOnsetReserve.trailingTrebleRequestedExtraPx ?? 0),
        Math.max(0, lastOnsetReserve.trailingBassRequestedExtraPx ?? 0),
      ).toFixed(3),
    )
    if (!approximatelyEqual(lastOnsetReserve.rightReservePx, expectedTrailingExtraPx)) {
      pushFailure(
        failures,
        'trailing-slot-not-max',
        `${lastOnsetReserve.rightReservePx ?? 'null'}!=${expectedTrailingExtraPx}`,
      )
    }
    const expectedTrailingWinner = resolveWinningStaff(
      Math.max(0, lastOnsetReserve.trailingTrebleRequestedExtraPx ?? 0),
      Math.max(0, lastOnsetReserve.trailingBassRequestedExtraPx ?? 0),
    )
    if ((lastOnsetReserve.trailingWinningStaff ?? 'none') !== expectedTrailingWinner) {
      pushFailure(
        failures,
        'trailing-winning-staff-mismatch',
        `${lastOnsetReserve.trailingWinningStaff ?? 'none'}!=${expectedTrailingWinner}`,
      )
    }
  }
}

function validateNoBarlineOverflow(row: MergedMeasureDumpRow, failures: string[]): void {
  const overflowVsMeasureEndBarX =
    typeof row.overflowVsMeasureEndBarX === 'number' && Number.isFinite(row.overflowVsMeasureEndBarX)
      ? Number(row.overflowVsMeasureEndBarX.toFixed(3))
      : null
  if (overflowVsMeasureEndBarX !== null && overflowVsMeasureEndBarX > GAP_EPSILON_PX) {
    pushFailure(failures, 'overflow-vs-measure-end-barline', overflowVsMeasureEndBarX)
  }
}

function analyzeDesktopTargetRow(row: MergedMeasureDumpRow, pairIndex: number): DesktopTargetResult {
  const failures: string[] = []
  validateSharedSlotDebug(row, failures)
  validateNoBarlineOverflow(row, failures)

  if (!row.rendered) {
    pushFailure(failures, 'measure-not-rendered')
  }

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null

  const bassMetrics = buildStaffOnsetMetrics(row, 'bass')
  const targetNote =
    row.notes
      .filter((note) => note.staff === 'bass' && note.isRest !== true && Array.isArray(note.noteHeads) && note.noteHeads.length > 1)
      .sort((left, right) => {
        const leftOnset = left.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
        const rightOnset = right.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
        if (leftOnset !== rightOnset) return leftOnset - rightOnset
        return left.noteIndex - right.noteIndex
      })[0] ?? null

  if (!targetNote) {
    pushFailure(failures, 'target-bass-displaced-chord-missing')
  }

  const targetOnsetTicks =
    targetNote && typeof targetNote.onsetTicksInMeasure === 'number' && Number.isFinite(targetNote.onsetTicksInMeasure)
      ? Math.round(targetNote.onsetTicksInMeasure)
      : null
  const headXs = targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []
  const anchorX = targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null
  const direction = classifyDirection(anchorX, headXs)
  if (targetNote && (direction === 'aligned' || direction === 'missing')) {
    pushFailure(failures, 'unexpected-direction', direction)
  }

  const targetMetricsIndex =
    targetOnsetTicks !== null ? bassMetrics.findIndex((metrics) => metrics.onsetTicks === targetOnsetTicks) : -1
  const targetMetrics = targetMetricsIndex >= 0 ? bassMetrics[targetMetricsIndex] ?? null : null
  if (targetNote && !targetMetrics) {
    pushFailure(failures, 'target-onset-metrics-missing')
  }

  const previousMetrics = targetMetricsIndex > 0 ? bassMetrics[targetMetricsIndex - 1] ?? null : null
  const nextMetrics =
    targetMetricsIndex >= 0 && targetMetricsIndex < bassMetrics.length - 1
      ? bassMetrics[targetMetricsIndex + 1] ?? null
      : null

  const expectedLeftRequestPx =
    targetMetrics && direction !== 'forward'
      ? computeExpectedLeftRequestPx(targetMetrics, previousMetrics, boundaryStartX)
      : targetMetrics
        ? 0
        : null
  const expectedRightRequestPx =
    targetMetrics && direction !== 'backward'
      ? computeExpectedRightRequestPx(targetMetrics, nextMetrics, boundaryEndX)
      : targetMetrics
        ? 0
        : null

  const actualLeftSummary =
    targetOnsetTicks !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetOnsetTicks,
          side: 'left',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const actualRightSummary =
    targetOnsetTicks !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetOnsetTicks,
          side: 'right',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }

  if (expectedLeftRequestPx !== null && !approximatelyEqual(actualLeftSummary.requestedExtraPx, expectedLeftRequestPx)) {
    pushFailure(
      failures,
      'left-request-mismatch',
      `${actualLeftSummary.requestedExtraPx}!=${expectedLeftRequestPx}`,
    )
  }
  if (expectedRightRequestPx !== null && !approximatelyEqual(actualRightSummary.requestedExtraPx, expectedRightRequestPx)) {
    pushFailure(
      failures,
      'right-request-mismatch',
      `${actualRightSummary.requestedExtraPx}!=${expectedRightRequestPx}`,
    )
  }

  if (direction === 'backward' && actualRightSummary.requestedExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'backward-request-leaked-right', actualRightSummary.requestedExtraPx)
  }
  if (direction === 'forward' && actualLeftSummary.requestedExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'forward-request-leaked-left', actualLeftSummary.requestedExtraPx)
  }

  const visibleLeftGapPx =
    typeof row.effectiveLeftGapPx === 'number' && Number.isFinite(row.effectiveLeftGapPx)
      ? Number(row.effectiveLeftGapPx.toFixed(3))
      : null
  const visibleRightGapPx =
    typeof row.effectiveRightGapPx === 'number' && Number.isFinite(row.effectiveRightGapPx)
      ? Number(row.effectiveRightGapPx.toFixed(3))
      : null

  return {
    pairIndex,
    renderedPageIndex: row.renderedPageIndex,
    noteIndex: targetNote?.noteIndex ?? null,
    onsetTicks: targetOnsetTicks,
    direction,
    headXs,
    rawLeftReservePx: targetMetrics ? targetMetrics.rawLeftReservePx : null,
    rawRightReservePx: targetMetrics ? targetMetrics.rawRightReservePx : null,
    expectedLeftRequestPx,
    actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
    leftWinningStaff: actualLeftSummary.winningStaff,
    expectedRightRequestPx,
    actualRightRequestPx: Number(actualRightSummary.requestedExtraPx.toFixed(3)),
    rightWinningStaff: actualRightSummary.winningStaff,
    visibleLeftGapPx,
    visibleRightGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeDesktopScenario(rows: MergedMeasureDumpRow[], scale: DebugScaleConfig, key: string): DesktopScenarioReport {
  const targets = Array.from({ length: TARGET_PAIR_COUNT }, (_, pairIndex) =>
    analyzeDesktopTargetRow(
      rows[pairIndex] ?? {
        pairIndex,
        rendered: false,
        renderedPageIndex: null,
        overflowVsNoteEndX: null,
        overflowVsMeasureEndBarX: null,
        notes: [],
      },
      pairIndex,
    ),
  )

  return {
    key,
    scale,
    passed: targets.every((target) => target.passed),
    targets,
  }
}

function analyzeCrossStaffFixture(row: MergedMeasureDumpRow, scale: DebugScaleConfig): FixtureResult {
  const failures: string[] = []
  validateSharedSlotDebug(row, failures)
  validateNoBarlineOverflow(row, failures)

  const bassMetrics = buildStaffOnsetMetrics(row, 'bass')
  const trebleMetrics = buildStaffOnsetMetrics(row, 'treble')
  const targetMetrics = bassMetrics.find((metrics) => metrics.rawLeftReservePx > HEAD_X_EPSILON_PX) ?? null
  const targetNote =
    row.notes.find(
      (note) =>
        note.staff === 'bass' &&
        note.isRest !== true &&
        typeof note.onsetTicksInMeasure === 'number' &&
        targetMetrics &&
        Math.round(note.onsetTicksInMeasure) === targetMetrics.onsetTicks &&
        Array.isArray(note.noteHeads) &&
        note.noteHeads.length > 1,
    ) ?? null

  if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
  if (!targetMetrics || !targetNote) pushFailure(failures, 'target-bass-displaced-chord-missing')

  const targetIndex = targetMetrics ? bassMetrics.findIndex((metrics) => metrics.onsetTicks === targetMetrics.onsetTicks) : -1
  const previousMetrics = targetIndex > 0 ? bassMetrics[targetIndex - 1] ?? null : null
  const nextMetrics =
    targetIndex >= 0 && targetIndex < bassMetrics.length - 1 ? bassMetrics[targetIndex + 1] ?? null : null

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null

  const expectedLeftRequestPx = targetMetrics
    ? computeExpectedLeftRequestPx(targetMetrics, previousMetrics, boundaryStartX)
    : null
  const expectedRightRequestPx = targetMetrics
    ? computeExpectedRightRequestPx(targetMetrics, nextMetrics, boundaryEndX)
    : null

  if ((expectedLeftRequestPx ?? 0) > GAP_EPSILON_PX || (expectedRightRequestPx ?? 0) > GAP_EPSILON_PX) {
    pushFailure(
      failures,
      'fixture-should-have-no-bass-local-collision',
      `${expectedLeftRequestPx ?? 'null'}/${expectedRightRequestPx ?? 'null'}`,
    )
  }

  const actualLeftSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'left',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const actualRightSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'right',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }

  if (actualLeftSummary.requestedExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'cross-staff-false-positive-left', actualLeftSummary.requestedExtraPx)
  }
  if (actualRightSummary.requestedExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'cross-staff-false-positive-right', actualRightSummary.requestedExtraPx)
  }

  const spacingSegments = getSpacingSegments(row)
  spacingSegments.forEach((segment) => {
    if ((segment.extraReservePx ?? 0) > GAP_EPSILON_PX) {
      pushFailure(
        failures,
        'unexpected-extra-segment',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.extraReservePx ?? 'null'}`,
      )
    }
  })

  if (
    targetMetrics &&
    previousMetrics &&
    !trebleMetrics.some(
      (metrics) =>
        metrics.onsetTicks > previousMetrics.onsetTicks &&
        metrics.onsetTicks < targetMetrics.onsetTicks,
    )
  ) {
    pushFailure(failures, 'fixture-missing-interleaved-treble-onset')
  }

  const headXs = targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []
  const direction = classifyDirection(
    targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null,
    headXs,
  )
  const measureWidth =
    typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
      ? Number(row.measureWidth.toFixed(3))
      : null
  const visibleLeftGapPx =
    typeof row.effectiveLeftGapPx === 'number' && Number.isFinite(row.effectiveLeftGapPx)
      ? Number(row.effectiveLeftGapPx.toFixed(3))
      : null
  const visibleRightGapPx =
    typeof row.effectiveRightGapPx === 'number' && Number.isFinite(row.effectiveRightGapPx)
      ? Number(row.effectiveRightGapPx.toFixed(3))
      : null

  return {
    key: 'fixture-cross-staff-no-false-positive',
    scale,
    measureWidth,
    targetOnsetTicks: targetMetrics?.onsetTicks ?? null,
    direction,
    headXs,
    expectedLeftRequestPx,
    actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
    leftWinningStaff: actualLeftSummary.winningStaff,
    expectedRightRequestPx,
    actualRightRequestPx: Number(actualRightSummary.requestedExtraPx.toFixed(3)),
    rightWinningStaff: actualRightSummary.winningStaff,
    visibleLeftGapPx,
    visibleRightGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeLocalCollisionFixture(row: MergedMeasureDumpRow, scale: DebugScaleConfig): FixtureResult {
  const failures: string[] = []
  validateSharedSlotDebug(row, failures)
  validateNoBarlineOverflow(row, failures)

  const bassMetrics = buildStaffOnsetMetrics(row, 'bass')
  const targetMetrics = bassMetrics.find((metrics) => metrics.rawLeftReservePx > HEAD_X_EPSILON_PX) ?? null
  const targetNote =
    row.notes.find(
      (note) =>
        note.staff === 'bass' &&
        note.isRest !== true &&
        typeof note.onsetTicksInMeasure === 'number' &&
        targetMetrics &&
        Math.round(note.onsetTicksInMeasure) === targetMetrics.onsetTicks &&
        Array.isArray(note.noteHeads) &&
        note.noteHeads.length > 1,
    ) ?? null

  if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
  if (!targetMetrics || !targetNote) pushFailure(failures, 'target-bass-displaced-chord-missing')

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null

  const expectedLeftRequestPx = targetMetrics
    ? computeExpectedLeftRequestPx(targetMetrics, null, boundaryStartX)
    : null
  const expectedRightRequestPx = targetMetrics
    ? computeExpectedRightRequestPx(targetMetrics, bassMetrics[1] ?? null, boundaryEndX)
    : null

  if ((expectedLeftRequestPx ?? 0) <= GAP_EPSILON_PX) {
    pushFailure(failures, 'fixture-expected-leading-collision-missing')
  }
  if ((expectedRightRequestPx ?? 0) > GAP_EPSILON_PX) {
    pushFailure(failures, 'fixture-should-not-request-right', expectedRightRequestPx)
  }

  const actualLeftSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'left',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const actualRightSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'right',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }

  if (expectedLeftRequestPx !== null && !approximatelyEqual(actualLeftSummary.requestedExtraPx, expectedLeftRequestPx)) {
    pushFailure(
      failures,
      'leading-request-mismatch',
      `${actualLeftSummary.requestedExtraPx}!=${expectedLeftRequestPx}`,
    )
  }
  if (actualRightSummary.requestedExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'unexpected-right-request', actualRightSummary.requestedExtraPx)
  }
  if (actualLeftSummary.winningStaff !== 'bass') {
    pushFailure(failures, 'leading-winning-staff-not-bass', actualLeftSummary.winningStaff)
  }

  const spacingSegments = getSpacingSegments(row)
  spacingSegments.forEach((segment) => {
    if ((segment.extraReservePx ?? 0) > GAP_EPSILON_PX) {
      pushFailure(
        failures,
        'unexpected-inner-segment-extra',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.extraReservePx ?? 'null'}`,
      )
    }
  })

  const visibleLeftGapPx =
    typeof row.effectiveLeftGapPx === 'number' && Number.isFinite(row.effectiveLeftGapPx)
      ? Number(row.effectiveLeftGapPx.toFixed(3))
      : null
  if (visibleLeftGapPx === null || visibleLeftGapPx < MIN_NON_OVERLAP_GAP_PX - GAP_EPSILON_PX) {
    pushFailure(failures, 'leading-visible-gap-too-small', visibleLeftGapPx)
  }

  const headXs = targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []
  const direction = classifyDirection(
    targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null,
    headXs,
  )
  if (direction !== 'backward') {
    pushFailure(failures, 'fixture-direction-not-backward', direction)
  }

  const measureWidth =
    typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
      ? Number(row.measureWidth.toFixed(3))
      : null
  const visibleRightGapPx =
    typeof row.effectiveRightGapPx === 'number' && Number.isFinite(row.effectiveRightGapPx)
      ? Number(row.effectiveRightGapPx.toFixed(3))
      : null

  return {
    key: 'fixture-local-leading-collision',
    scale,
    measureWidth,
    targetOnsetTicks: targetMetrics?.onsetTicks ?? null,
    direction,
    headXs,
    expectedLeftRequestPx,
    actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
    leftWinningStaff: actualLeftSummary.winningStaff,
    expectedRightRequestPx,
    actualRightRequestPx: Number(actualRightSummary.requestedExtraPx.toFixed(3)),
    rightWinningStaff: actualRightSummary.winningStaff,
    visibleLeftGapPx,
    visibleRightGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

async function runDesktopScenario(page: Page, xmlText: string, scaleCase: ScaleCase): Promise<DesktopScenarioReport> {
  await importMusicXml(page, xmlText)
  const appliedScale = await setScoreScale(page, scaleCase)
  const mergedRows = await collectMergedRows(page)
  return analyzeDesktopScenario(mergedRows, appliedScale, scaleCase.key)
}

async function runFixtureScenario(params: {
  page: Page
  xmlText: string
  analyzer: (row: MergedMeasureDumpRow, scale: DebugScaleConfig) => FixtureResult
}): Promise<FixtureResult> {
  const { page, xmlText, analyzer } = params
  await importMusicXml(page, xmlText)
  const appliedScale = await setScoreScale(page, FIXTURE_SCALE_CASE)
  const mergedRows = await collectMergedRows(page)
  const row =
    mergedRows[0] ??
    ({
      pairIndex: 0,
      rendered: false,
      renderedPageIndex: null,
      overflowVsNoteEndX: null,
      overflowVsMeasureEndBarX: null,
      notes: [],
    } satisfies MergedMeasureDumpRow)
  return analyzer(row, appliedScale)
}

async function main(): Promise<void> {
  const xmlPath = await resolveDesktopXmlPath(process.argv[2])
  const reportPath = process.argv[3] ?? path.resolve('debug', 'second-chord-spacing-browser-report.json')
  const xmlText = await readFile(xmlPath, 'utf8')

  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  server.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk))

  try {
    await waitForServer(DEV_URL, 120000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 4200, height: 1800 } })
    page.on('console', (message) => {
      console.log(`[browser:${message.type()}] ${message.text()}`)
    })
    page.on('pageerror', (error) => {
      console.error(`[browser:pageerror] ${error.stack ?? error.message}`)
    })

    console.log('[second-chord-spacing] opening app')
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    console.log('[second-chord-spacing] waiting for debug API')
    await waitForDebugApi(page)

    const desktopScenarios: DesktopScenarioReport[] = []
    for (const scaleCase of SCALE_CASES) {
      console.log(`[second-chord-spacing] running desktop sample ${scaleCase.key}`)
      desktopScenarios.push(await runDesktopScenario(page, xmlText, scaleCase))
    }

    const fixtureResults: FixtureResult[] = []
    console.log('[second-chord-spacing] running cross-staff false-positive fixture')
    fixtureResults.push(
      await runFixtureScenario({
        page,
        xmlText: CROSS_STAFF_FALSE_POSITIVE_FIXTURE_XML,
        analyzer: analyzeCrossStaffFixture,
      }),
    )
    console.log('[second-chord-spacing] running local overlap fixture')
    fixtureResults.push(
      await runFixtureScenario({
        page,
        xmlText: LOCAL_BASS_BOUNDARY_COLLISION_FIXTURE_XML,
        analyzer: analyzeLocalCollisionFixture,
      }),
    )

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      desktopScenarios,
      fixtureResults,
    }

    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    desktopScenarios.forEach((scenario) => {
      console.log(
        `[second-chord-spacing] desktop ${scenario.key}: ${scenario.passed ? 'PASS' : 'FAIL'} ` +
          `(scale=${scenario.scale.scoreScale ?? 'n/a'})`,
      )
      scenario.targets.forEach((target) => {
        console.log(
          `  pair=${target.pairIndex} page=${target.renderedPageIndex ?? 'n/a'} onset=${target.onsetTicks ?? 'null'} ` +
            `direction=${target.direction} left=${target.actualLeftRequestPx ?? 'null'}/${target.expectedLeftRequestPx ?? 'null'} ` +
            `right=${target.actualRightRequestPx ?? 'null'}/${target.expectedRightRequestPx ?? 'null'} ` +
            `winnerL=${target.leftWinningStaff} winnerR=${target.rightWinningStaff} ` +
            `visibleLeftGap=${target.visibleLeftGapPx ?? 'null'} visibleRightGap=${target.visibleRightGapPx ?? 'null'} ` +
            `${target.passed ? 'PASS' : 'FAIL'} ${target.failureReasons.length > 0 ? JSON.stringify(target.failureReasons) : ''}`,
        )
      })
    })

    fixtureResults.forEach((fixture) => {
      console.log(
        `[second-chord-spacing] ${fixture.key}: ${fixture.passed ? 'PASS' : 'FAIL'} ` +
          `left=${fixture.actualLeftRequestPx ?? 'null'}/${fixture.expectedLeftRequestPx ?? 'null'} ` +
          `right=${fixture.actualRightRequestPx ?? 'null'}/${fixture.expectedRightRequestPx ?? 'null'} ` +
          `winnerL=${fixture.leftWinningStaff} winnerR=${fixture.rightWinningStaff} ` +
          `direction=${fixture.direction} visibleLeftGap=${fixture.visibleLeftGapPx ?? 'null'} ` +
          `visibleRightGap=${fixture.visibleRightGapPx ?? 'null'} ` +
          `${fixture.failureReasons.length > 0 ? JSON.stringify(fixture.failureReasons) : ''}`,
      )
    })

    console.log(`Generated: ${reportPath}`)

    if (
      !desktopScenarios.every((scenario) => scenario.passed) ||
      !fixtureResults.every((fixture) => fixture.passed)
    ) {
      throw new Error('Second-chord spacing regression detected.')
    }
  } finally {
    if (browser) {
      await browser.close()
    }
    await stopDevServer(server)
  }
}

void main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message)
  } else {
    console.error(error)
  }
  process.exitCode = 1
})
