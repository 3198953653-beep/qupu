import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { SAMPLE_MUSIC_XML } from './sampleMusicXmlFixture'

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

type DumpAccidentalCoord = {
  keyIndex: number
  rightX: number
  leftX: number
  visualRightX: number | null
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  pitch: string | null
  x: number
  noteHeads: DumpNoteHead[]
  accidentalCoords: DumpAccidentalCoord[]
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

type DebugSelection = {
  noteId: string
  staff: 'treble' | 'bass'
  keyIndex: number
}

type DebugSelectedSelection = DebugSelection & {
  pairIndex: number | null
  noteIndex: number | null
  pitch: string | null
  duration: string | null
  isRest: boolean
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_DRAG_DELTA_CLIENT_Y = -42

const ACCIDENTAL_PREVIEW_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
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
        <duration>4</duration>
        <type>quarter</type>
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
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
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
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
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

async function stopDevServer(server: ChildProcess): Promise<void> {
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
      typeof api.clearNotePreviewEvents === 'function' &&
      typeof api.getSelectedSelections === 'function' &&
      typeof api.getActiveSelection === 'function'
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

  await page.waitForTimeout(160)
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

function findRenderedNote(params: {
  rows: MeasureDumpRow[]
  pairIndex: number
  staff: 'treble' | 'bass'
  noteIndex: number
}): DumpNoteRow {
  const { rows, pairIndex, staff, noteIndex } = params
  const row = rows.find((entry) => entry.pairIndex === pairIndex)
  if (!row?.rendered) {
    throw new Error(`Measure pair ${pairIndex} is not rendered.`)
  }
  const note = row.notes.find((entry) => entry.staff === staff && entry.noteIndex === noteIndex)
  if (!note) {
    throw new Error(`Unable to find note pair=${pairIndex} staff=${staff} noteIndex=${noteIndex}.`)
  }
  return note
}

function findRenderedNoteById(rows: MeasureDumpRow[], noteId: string): DumpNoteRow {
  for (const row of rows) {
    const note = row.notes.find((entry) => entry.noteId === noteId)
    if (note) return note
  }
  throw new Error(`Unable to find noteId=${noteId} in rendered dump.`)
}

function findNoteHead(note: DumpNoteRow, keyIndex: number): DumpNoteHead {
  const head = note.noteHeads.find((entry) => entry.keyIndex === keyIndex)
  if (!head) {
    throw new Error(`Unable to find keyIndex=${keyIndex} for note ${note.noteId}.`)
  }
  return head
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

async function getSelectedSelections(page: Page): Promise<DebugSelectedSelection[]> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getSelectedSelections: () => DebugSelectedSelection[] } }).__scoreDebug
    return api.getSelectedSelections()
  })
}

async function getActiveSelection(page: Page): Promise<DebugSelection> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getActiveSelection: () => DebugSelection } }).__scoreDebug
    return api.getActiveSelection()
  })
}

async function waitForNotePreviewCountAtLeast(page: Page, expectedCount: number): Promise<NotePreviewEvent[]> {
  await page.waitForFunction(
    (count) => {
      const api =
        (window as unknown as { __scoreDebug?: { getNotePreviewEvents: () => NotePreviewEvent[] } }).__scoreDebug
      if (!api || typeof api.getNotePreviewEvents !== 'function') return false
      return api.getNotePreviewEvents().length >= count
    },
    expectedCount,
    { timeout: 2_000 },
  )
  return getNotePreviewEvents(page)
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

async function ensureNotationPaletteOpen(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '记谱工具面板' })
  const alreadyOpen = (await dialog.count()) > 0 && await dialog.first().isVisible()
  if (alreadyOpen) return
  await page.getByRole('button', { name: '记谱工具' }).click()
  await page.waitForSelector('[aria-label="记谱工具面板"]', { state: 'visible', timeout: 2_000 })
}

async function clickNotationPaletteButton(page: Page, label: string): Promise<void> {
  await ensureNotationPaletteOpen(page)
  await page.getByRole('button', { name: label, exact: true }).click()
}

async function clickNoteHead(params: {
  page: Page
  note: DumpNoteRow
  keyIndex?: number
  append?: boolean
}): Promise<void> {
  const { page, note, keyIndex = 0, append = false } = params
  const head = findNoteHead(note, keyIndex)
  const clientPoint = await toClientPoint(page, head.x, head.y)
  if (append) {
    await page.keyboard.down('Control')
  }
  await page.mouse.move(clientPoint.x, clientPoint.y)
  await page.mouse.down()
  await page.mouse.up()
  if (append) {
    await page.keyboard.up('Control')
  }
  await page.waitForTimeout(140)
}

async function clickAccidentalGlyph(params: {
  page: Page
  note: DumpNoteRow
  keyIndex?: number
}): Promise<void> {
  const { page, note, keyIndex = 0 } = params
  const accidental = note.accidentalCoords.find((entry) => entry.keyIndex === keyIndex)
  if (!accidental) {
    throw new Error(`Unable to find accidental glyph for note ${note.noteId} keyIndex=${keyIndex}.`)
  }
  const head = findNoteHead(note, keyIndex)
  const rightEdge = typeof accidental.visualRightX === 'number' && Number.isFinite(accidental.visualRightX)
    ? accidental.visualRightX
    : accidental.rightX
  const logicalX = Number.isFinite(accidental.leftX) && Number.isFinite(rightEdge)
    ? (accidental.leftX + rightEdge) / 2
    : accidental.leftX
  const clientPoint = await toClientPoint(page, logicalX, head.y)
  await page.mouse.move(clientPoint.x, clientPoint.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(140)
}

function expectSingleClickPreviewPitch(events: NotePreviewEvent[], expectedPitch: string, context: string): void {
  const clickEvents = events.filter((event) => event.mode === 'click')
  if (clickEvents.length !== 1) {
    throw new Error(`${context}: expected exactly 1 click preview event, got ${clickEvents.length}.`)
  }
  if (clickEvents[0]?.pitch !== expectedPitch) {
    throw new Error(`${context}: expected pitch=${expectedPitch}, got ${clickEvents[0]?.pitch ?? 'null'}.`)
  }
}

async function runAccidentalPreviewScenarios(page: Page) {
  await importMusicXmlViaDebugApi(page, ACCIDENTAL_PREVIEW_FIXTURE_XML)
  await setScoreScale(page)
  await ensureNotationPaletteOpen(page)

  const baseRows = await collectMergedDump(page)
  const singleNote = findRenderedNote({ rows: baseRows, pairIndex: 0, staff: 'treble', noteIndex: 0 })
  await clickNoteHead({ page, note: singleNote, keyIndex: 0 })

  await clearNotePreviewEvents(page)
  await clickNotationPaletteButton(page, '升记号')
  const sharpEvents = await waitForNotePreviewCountAtLeast(page, 1)
  expectSingleClickPreviewPitch(sharpEvents, 'c#/5', 'single-note sharp preview')

  await clearNotePreviewEvents(page)
  await clickNotationPaletteButton(page, '还原记号')
  const naturalEvents = await waitForNotePreviewCountAtLeast(page, 1)
  expectSingleClickPreviewPitch(naturalEvents, 'c/5', 'single-note natural preview')

  await clearNotePreviewEvents(page)
  await clickNotationPaletteButton(page, '升记号')
  const reSharpEvents = await waitForNotePreviewCountAtLeast(page, 1)
  expectSingleClickPreviewPitch(reSharpEvents, 'c#/5', 'single-note re-sharp preview')

  await clearNotePreviewEvents(page)
  await clickNotationPaletteButton(page, '升记号')
  await page.waitForTimeout(180)
  const noOpEvents = await getNotePreviewEvents(page)
  if (noOpEvents.length !== 0) {
    throw new Error(`no-op accidental edit should not preview, got ${noOpEvents.length} event(s).`)
  }

  const sharpRows = await collectMergedDump(page)
  const sharpNote = findRenderedNoteById(sharpRows, singleNote.noteId)
  await clearNotePreviewEvents(page)
  await clickAccidentalGlyph({ page, note: sharpNote, keyIndex: 0 })
  await clearNotePreviewEvents(page)
  await page.keyboard.press('Delete')
  const deleteEvents = await waitForNotePreviewCountAtLeast(page, 1)
  expectSingleClickPreviewPitch(deleteEvents, 'c/5', 'accidental delete preview')

  const afterDeleteRows = await collectMergedDump(page)
  const deletedPitch = findRenderedNoteById(afterDeleteRows, singleNote.noteId).pitch
  if (deletedPitch !== 'c/5') {
    throw new Error(`accidental delete should commit c/5, got ${deletedPitch ?? 'null'}.`)
  }

  await importMusicXmlViaDebugApi(page, ACCIDENTAL_PREVIEW_FIXTURE_XML)
  await setScoreScale(page)
  await ensureNotationPaletteOpen(page)

  const chordRows = await collectMergedDump(page)
  const chordNote = findRenderedNote({ rows: chordRows, pairIndex: 1, staff: 'treble', noteIndex: 0 })
  await clickNoteHead({ page, note: chordNote, keyIndex: 1 })
  const chordActiveSelection = await getActiveSelection(page)
  if (
    chordActiveSelection.noteId !== chordNote.noteId ||
    chordActiveSelection.staff !== 'treble' ||
    chordActiveSelection.keyIndex !== 1
  ) {
    throw new Error(`Chord-member selection did not activate keyIndex 1: ${JSON.stringify(chordActiveSelection)}`)
  }

  await clearNotePreviewEvents(page)
  await clickNotationPaletteButton(page, '升记号')
  const chordEvents = await waitForNotePreviewCountAtLeast(page, 1)
  expectSingleClickPreviewPitch(chordEvents, 'c#/5', 'chord-member accidental preview')

  await importMusicXmlViaDebugApi(page, ACCIDENTAL_PREVIEW_FIXTURE_XML)
  await setScoreScale(page)
  await ensureNotationPaletteOpen(page)

  const multiRows = await collectMergedDump(page)
  const firstNote = findRenderedNote({ rows: multiRows, pairIndex: 0, staff: 'treble', noteIndex: 0 })
  const secondNote = findRenderedNote({ rows: multiRows, pairIndex: 0, staff: 'treble', noteIndex: 1 })
  await clickNoteHead({ page, note: firstNote, keyIndex: 0 })
  await clickNoteHead({ page, note: secondNote, keyIndex: 0, append: true })

  const selectedSelections = await getSelectedSelections(page)
  const selectedKeys = new Set(selectedSelections.map((entry) => `${entry.staff}:${entry.noteId}:${entry.keyIndex}`))
  if (
    !selectedKeys.has(`treble:${firstNote.noteId}:0`) ||
    !selectedKeys.has(`treble:${secondNote.noteId}:0`)
  ) {
    throw new Error(`Multi-selection did not include both notes: ${JSON.stringify(selectedSelections)}`)
  }

  const multiActiveSelection = await getActiveSelection(page)
  if (
    multiActiveSelection.noteId !== secondNote.noteId ||
    multiActiveSelection.staff !== 'treble' ||
    multiActiveSelection.keyIndex !== 0
  ) {
    throw new Error(`Multi-selection active note mismatch: ${JSON.stringify(multiActiveSelection)}`)
  }

  await clearNotePreviewEvents(page)
  await clickNotationPaletteButton(page, '降记号')
  const multiEvents = await waitForNotePreviewCountAtLeast(page, 1)
  expectSingleClickPreviewPitch(multiEvents, 'db/5', 'multi-selection accidental preview')

  return {
    sharpEvents,
    naturalEvents,
    reSharpEvents,
    noOpEvents,
    deleteEvents,
    chordEvents,
    multiEvents,
    chordActiveSelection,
    multiActiveSelection,
    selectedSelections,
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

    const accidentalPreview = await runAccidentalPreviewScenarios(page)

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
      accidentalPreview,
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')

    console.log(`Generated: ${outputPath}`)
    console.log(`Demo click events: ${demoClickEvents.length}`)
    console.log(`Imported smooth drag events: ${smoothDrag.events.length}`)
    console.log(`Imported fast drag events: ${fastDrag.events.length}`)
    console.log(`Accidental preview scenarios validated: 6`)

    await browser.close()
  } finally {
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
