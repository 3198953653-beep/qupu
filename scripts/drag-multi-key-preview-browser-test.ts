import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

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
  x: number
  anchorX?: number | null
  rightX: number
  spacingRightX: number
  noteHeads: DumpNoteHead[]
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  bassY: number | null
  measureWidth: number | null
  measureStartBarX: number | null
  measureEndBarX: number | null
  notes: DumpNoteRow[]
}

type MeasureDump = {
  totalMeasureCount: number
  rows: MeasureDumpRow[]
}

type SelectedSelection = {
  noteId: string
  staff: 'treble' | 'bass'
  keyIndex: number
  pairIndex: number | null
  noteIndex: number | null
  pitch: string | null
  duration: string | null
  isRest: boolean
}

type DragDebugRow = {
  frame: number
  pairIndex: number
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: string
  noteXStatic: number | null
  noteXPreview: number | null
  noteXDelta: number | null
  anchorXStatic: number | null
  anchorXPreview: number | null
  anchorXDelta: number | null
  headXStatic: number | null
  headXPreview: number | null
  headXDelta: number | null
  headYStatic: number | null
  headYPreview: number | null
  headYDelta: number | null
}

type DragDebugSnapshot = {
  frame: number
  pairIndex: number
  draggedNoteId: string
  draggedStaff: 'treble' | 'bass'
  rows: DragDebugRow[]
}

type DragSessionState = {
  noteId: string
  staff: 'treble' | 'bass'
  keyIndex: number
  pairIndex: number
  noteIndex: number
  pitch: string
  previewStarted: boolean
} | null

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_OUTPUT_PATH = path.resolve('debug', 'drag-multi-key-preview-browser-report.json')
const DRAG_DELTA_CLIENT_Y = 112
const EPSILON = 0.001

const MULTI_KEY_PREVIEW_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>8</duration>
        <type>half</type>
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

function roundOrNull(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(3))
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
  await new Promise<void>((resolve) => {
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
      typeof api.importMusicXmlText === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.getSelectedSelections === 'function' &&
      typeof api.getDragPreviewFrames === 'function' &&
      typeof api.getDragSessionState === 'function' &&
      typeof api.setAutoScaleEnabled === 'function' &&
      typeof api.setManualScalePercent === 'function'
    )
  })
}

async function importMusicXml(page: Page, xmlText: string): Promise<void> {
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

async function setScoreScale(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        setAutoScaleEnabled: (enabled: boolean) => void
        setManualScalePercent: (percent: number) => void
      }
    }).__scoreDebug
    api.setAutoScaleEnabled(false)
    api.setManualScalePercent(100)
  })
  await page.waitForTimeout(140)
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump } }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

async function getSelectedSelections(page: Page): Promise<SelectedSelection[]> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getSelectedSelections: () => SelectedSelection[] } }).__scoreDebug
    return api.getSelectedSelections()
  })
}

async function getDragPreviewFrames(page: Page): Promise<DragDebugSnapshot[]> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getDragPreviewFrames: () => DragDebugSnapshot[] } }).__scoreDebug
    return api.getDragPreviewFrames()
  })
}

async function getDragSessionState(page: Page): Promise<DragSessionState> {
  return page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getDragSessionState: () => DragSessionState } }).__scoreDebug
    return api.getDragSessionState()
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

function requireRenderedPair(dump: MeasureDump, pairIndex: number): MeasureDumpRow {
  const row = dump.rows.find((entry) => entry.pairIndex === pairIndex)
  if (!row || !row.rendered) {
    throw new Error(`Measure pair ${pairIndex} is not rendered.`)
  }
  return row
}

function requireChordNote(row: MeasureDumpRow, staff: 'treble' | 'bass'): DumpNoteRow {
  const chordNote = row.notes
    .filter((note) => note.staff === staff && note.noteHeads.length >= 2)
    .sort((left, right) => left.noteIndex - right.noteIndex)[0]
  if (!chordNote) {
    throw new Error(`No multi-key ${staff} note found in pair ${row.pairIndex}.`)
  }
  return chordNote
}

function getHeadByKeyIndex(note: DumpNoteRow, keyIndex: number): DumpNoteHead {
  const head = note.noteHeads.find((entry) => entry.keyIndex === keyIndex)
  if (!head) {
    throw new Error(`Note ${note.noteId} is missing keyIndex ${keyIndex}.`)
  }
  return head
}

function getNoteHeadLeftX(note: DumpNoteRow): number {
  return Math.min(...note.noteHeads.map((head) => head.x))
}

function getNoteHeadRightX(note: DumpNoteRow): number {
  return Math.max(...note.noteHeads.map((head) => head.x))
}

function resolveBlankStaffPoint(row: MeasureDumpRow, targetNote: DumpNoteRow): { x: number; y: number } {
  const targetRootHeadY = getHeadByKeyIndex(targetNote, 0).y
  if (!Number.isFinite(targetRootHeadY)) {
    throw new Error(`Target note ${targetNote.noteId} is missing a valid root head y.`)
  }
  const staffNotes = row.notes
    .filter((note) => note.staff === targetNote.staff && note.noteHeads.length > 0)
    .sort((left, right) => left.noteIndex - right.noteIndex)
  const targetIndex = staffNotes.findIndex((note) => note.noteId === targetNote.noteId)
  if (targetIndex < 0) {
    throw new Error(`Target note ${targetNote.noteId} is not in the ${targetNote.staff} note list.`)
  }

  const candidates: Array<{ x: number; clearance: number }> = []
  const targetLeftX = getNoteHeadLeftX(targetNote)
  const targetRightX = getNoteHeadRightX(targetNote)
  const previous = staffNotes[targetIndex - 1] ?? null
  const next = staffNotes[targetIndex + 1] ?? null

  if (typeof row.measureStartBarX === 'number' && Number.isFinite(row.measureStartBarX)) {
    const leadingClearance = targetLeftX - row.measureStartBarX
    if (leadingClearance >= 12) {
      return {
        x: row.measureStartBarX + Math.min(10, Math.max(6, leadingClearance / 3)),
        y: targetRootHeadY,
      }
    }
  }

  if (previous) {
    const previousRightX = getNoteHeadRightX(previous)
    const clearance = targetLeftX - previousRightX
    if (clearance > 0) {
      candidates.push({
        x: previousRightX + clearance / 2,
        clearance,
      })
    }
  }
  if (next) {
    const nextLeftX = getNoteHeadLeftX(next)
    const clearance = nextLeftX - targetRightX
    if (clearance > 0) {
      candidates.push({
        x: targetRightX + clearance / 2,
        clearance,
      })
    }
  }
  if (typeof row.measureStartBarX === 'number' && Number.isFinite(row.measureStartBarX)) {
    const clearance = targetLeftX - row.measureStartBarX
    if (clearance > 0) {
      candidates.push({
        x: row.measureStartBarX + Math.min(10, Math.max(6, clearance / 3)),
        clearance,
      })
    }
  }
  const contentMeasureRightX =
    typeof row.measureStartBarX === 'number' &&
    Number.isFinite(row.measureStartBarX) &&
    typeof row.measureWidth === 'number' &&
    Number.isFinite(row.measureWidth)
      ? row.measureStartBarX + row.measureWidth
      : null
  if (typeof contentMeasureRightX === 'number' && Number.isFinite(contentMeasureRightX)) {
    const clearance = contentMeasureRightX - targetRightX
    if (clearance > 0) {
      candidates.push({
        x: contentMeasureRightX - Math.min(16, Math.max(8, clearance / 2)),
        clearance,
      })
    }
  }

  const winner = candidates.sort((left, right) => right.clearance - left.clearance)[0]
  if (!winner || !Number.isFinite(winner.x)) {
    throw new Error(`Unable to find a blank bass-staff click point for pair ${row.pairIndex}.`)
  }
  return {
    x: winner.x,
    y: targetRootHeadY,
  }
}

function buildHeadYByKeyIndex(note: DumpNoteRow): Map<number, number> {
  return new Map(note.noteHeads.map((head) => [head.keyIndex, head.y]))
}

function buildHeadXByKeyIndex(note: DumpNoteRow): Map<number, number> {
  return new Map(note.noteHeads.map((head) => [head.keyIndex, head.x]))
}

function hasMeaningfulDelta(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > EPSILON
}

async function waitForBlankSelection(
  page: Page,
  params: { noteId: string; staff: 'treble' | 'bass' },
): Promise<SelectedSelection[]> {
  await page.waitForFunction(
    ({ noteId, staff }) => {
      const api =
        (window as unknown as {
          __scoreDebug: { getSelectedSelections: () => Array<{ noteId: string; staff: string; keyIndex: number }> }
        }).__scoreDebug
      const selections = api.getSelectedSelections()
      const targetSelections = selections.filter((entry) => entry.noteId === noteId && entry.staff === staff)
      return (
        targetSelections.some((entry) => entry.keyIndex === 0) &&
        targetSelections.some((entry) => entry.keyIndex === 1)
      )
    },
    params,
    { timeout: 10_000 },
  )
  return getSelectedSelections(page)
}

async function main(): Promise<void> {
  const outputPath = process.argv[2] ?? DEFAULT_OUTPUT_PATH
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
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)
    await importMusicXml(page, MULTI_KEY_PREVIEW_FIXTURE_XML)
    await setScoreScale(page)

  const beforeDump = await dumpAllMeasureCoordinates(page)
  const pair0 = requireRenderedPair(beforeDump, 0)
    const targetNote = requireChordNote(pair0, 'treble')
    const initialAnchorX = typeof targetNote.anchorX === 'number' ? targetNote.anchorX : null
    const initialHeadXByKeyIndex = buildHeadXByKeyIndex(targetNote)
    const initialHeadYByKeyIndex = buildHeadYByKeyIndex(targetNote)
    const blankPoint = resolveBlankStaffPoint(pair0, targetNote)

    await page.locator('canvas.score-surface').scrollIntoViewIfNeeded()
    await page.waitForTimeout(120)
    const blankClient = await toClientPoint(page, blankPoint.x, blankPoint.y)
    await page.mouse.click(blankClient.x, blankClient.y)
    try {
      await waitForBlankSelection(page, { noteId: targetNote.noteId, staff: 'treble' })
    } catch (error) {
      const currentSelections = await getSelectedSelections(page)
      throw new Error(
        `Blank-staff selection did not settle for note ${targetNote.noteId}. Current selections: ${JSON.stringify(currentSelections)}`,
        { cause: error },
      )
    }

    const selectedSelections = await getSelectedSelections(page)
    const selectedTargetKeys = selectedSelections
      .filter((entry) => entry.noteId === targetNote.noteId && entry.staff === 'treble')
      .map((entry) => entry.keyIndex)
      .sort((left, right) => left - right)
    if (!selectedTargetKeys.includes(0) || !selectedTargetKeys.includes(1)) {
      throw new Error(`Blank-staff selection did not include both keyIndex 0 and 1 for note ${targetNote.noteId}.`)
    }

    const selectedDump = await dumpAllMeasureCoordinates(page)
    const pair0Selected = requireRenderedPair(selectedDump, 0)
    const targetNoteSelected = pair0Selected.notes.find(
      (note) => note.noteId === targetNote.noteId && note.staff === 'treble',
    )
    if (!targetNoteSelected) {
      throw new Error(`Target note ${targetNote.noteId} is missing after blank-staff selection.`)
    }
    const targetRootHeadSelected = getHeadByKeyIndex(targetNoteSelected, 0)

    const dragHitOffsets: Array<{ dx: number; dy: number }> = []
    for (const dy of [0, -2, 2, -4, 4, -6, 6]) {
      for (const dx of [6, 4, 8, 2, 10, 0, 12, -2, 14]) {
        dragHitOffsets.push({ dx, dy })
      }
    }
    let dragStart: { x: number; y: number } | null = null
    let dragEnd: { x: number; y: number } | null = null
    for (const offset of dragHitOffsets) {
      const candidateStart = await toClientPoint(
        page,
        targetRootHeadSelected.x + offset.dx,
        targetRootHeadSelected.y + offset.dy,
      )
      const candidateEnd = { x: candidateStart.x, y: candidateStart.y + DRAG_DELTA_CLIENT_Y }
      await page.mouse.move(candidateStart.x, candidateStart.y)
      await page.mouse.down()
      const dragSessionAfterDown = await getDragSessionState(page)
      if (dragSessionAfterDown?.noteId === targetNote.noteId && dragSessionAfterDown.staff === 'treble') {
        dragStart = candidateStart
        dragEnd = candidateEnd
        await page.mouse.move(candidateEnd.x, candidateEnd.y, { steps: 12 })
        break
      }
      await page.mouse.up()
      await page.waitForTimeout(60)
      await page.mouse.click(blankClient.x, blankClient.y)
      await waitForBlankSelection(page, { noteId: targetNote.noteId, staff: 'treble' })
    }
    if (!dragStart || !dragEnd) {
      throw new Error(`Unable to acquire a draggable hit point for note ${targetNote.noteId} after blank-staff selection.`)
    }
    try {
      await page.waitForFunction(
        () => {
          const api =
            (window as unknown as {
              __scoreDebug: { getDragSessionState: () => { previewStarted?: boolean } | null }
            }).__scoreDebug
          return api.getDragSessionState()?.previewStarted === true
        },
        undefined,
        { timeout: 10_000 },
      )
    } catch (error) {
      const currentDragSession = await getDragSessionState(page)
      throw new Error(`Drag preview never entered previewStarted=true for note ${targetNote.noteId}.`, {
        cause: { error, currentDragSession },
      })
    }
    await page.waitForTimeout(220)

    const duringHoldDump = await dumpAllMeasureCoordinates(page)
    const pair0DuringHold = requireRenderedPair(duringHoldDump, 0)
    const targetNoteDuringHold = pair0DuringHold.notes.find(
      (note) => note.noteId === targetNote.noteId && note.staff === 'treble',
    )
    if (!targetNoteDuringHold) {
      throw new Error(`Target note ${targetNote.noteId} is missing during drag preview.`)
    }
    const duringHoldAnchorX = typeof targetNoteDuringHold.anchorX === 'number' ? targetNoteDuringHold.anchorX : null
    const duringHoldHeadYByKeyIndex = buildHeadYByKeyIndex(targetNoteDuringHold)
    const duringHoldHeadXByKeyIndex = buildHeadXByKeyIndex(targetNoteDuringHold)
    const stagnantDuringHoldKeys = [0, 1].filter((keyIndex) => {
      const beforeY = initialHeadYByKeyIndex.get(keyIndex)
      const duringY = duringHoldHeadYByKeyIndex.get(keyIndex)
      return !hasMeaningfulDelta(
        typeof beforeY === 'number' && typeof duringY === 'number' ? duringY - beforeY : null,
      )
    })
    if (stagnantDuringHoldKeys.length > 0) {
      throw new Error(`Some selected chord keys did not move while the mouse was still down: [${stagnantDuringHoldKeys.join(', ')}]`)
    }
    if (
      hasMeaningfulDelta(
        typeof initialAnchorX === 'number' && typeof duringHoldAnchorX === 'number'
          ? duringHoldAnchorX - initialAnchorX
          : null,
      )
    ) {
      throw new Error(
        `The dragged chord anchor drifted during preview: anchorX=${String(roundOrNull(initialAnchorX))}->${String(roundOrNull(duringHoldAnchorX))}.`,
      )
    }
    const flippedDuringHoldKeys = [0, 1].filter((keyIndex) => {
      const beforeX = initialHeadXByKeyIndex.get(keyIndex)
      const duringX = duringHoldHeadXByKeyIndex.get(keyIndex)
      return hasMeaningfulDelta(
        typeof beforeX === 'number' && typeof duringX === 'number' ? duringX - beforeX : null,
      )
    })
    if (flippedDuringHoldKeys.length === 0) {
      throw new Error(
        `The preview never showed a visible horizontal chord-geometry change for note ${targetNote.noteId}; fixture did not cross the flip threshold.`,
      )
    }

    const previewFrames = await getDragPreviewFrames(page)
    const lastFrame = previewFrames[previewFrames.length - 1] ?? null
    const targetPreviewRows =
      lastFrame?.rows
        .filter((row) => row.noteId === targetNote.noteId && row.staff === 'treble')
        .sort((left, right) => left.keyIndex - right.keyIndex) ?? []
    if (targetPreviewRows.length > 0) {
      if (!targetPreviewRows.some((row) => row.keyIndex === 0) || !targetPreviewRows.some((row) => row.keyIndex === 1)) {
        throw new Error(`Preview frame is missing one of the selected chord keys for note ${targetNote.noteId}.`)
      }
      const stagnantPreviewRows = targetPreviewRows.filter(
        (row) => (row.keyIndex === 0 || row.keyIndex === 1) && !hasMeaningfulDelta(row.headYDelta),
      )
      if (stagnantPreviewRows.length > 0) {
        const stagnantKeys = stagnantPreviewRows.map((row) => row.keyIndex).join(', ')
        throw new Error(`Some selected chord keys did not move during preview capture: [${stagnantKeys}]`)
      }
      const driftingAnchorRows = targetPreviewRows.filter(
        (row) => (row.keyIndex === 0 || row.keyIndex === 1) && hasMeaningfulDelta(row.anchorXDelta),
      )
      if (driftingAnchorRows.length > 0) {
        const driftingKeys = driftingAnchorRows
          .map((row) => `${row.keyIndex}(anchorX=${String(roundOrNull(row.anchorXDelta))})`)
          .join(', ')
        throw new Error(`Some selected chord keys drifted on the time axis during preview capture: [${driftingKeys}]`)
      }
    }

    await page.mouse.up()
    await page.waitForTimeout(220)

    const afterDump = await dumpAllMeasureCoordinates(page)
    const pair0After = requireRenderedPair(afterDump, 0)
    const targetNoteAfter = pair0After.notes.find(
      (note) => note.noteId === targetNote.noteId && note.staff === 'treble',
    )
    if (!targetNoteAfter) {
      throw new Error(`Target note ${targetNote.noteId} is missing after drag commit.`)
    }

    const finalHeadYByKeyIndex = buildHeadYByKeyIndex(targetNoteAfter)
    const unchangedCommittedKeys = [0, 1].filter((keyIndex) => {
      const beforeY = initialHeadYByKeyIndex.get(keyIndex)
      const afterY = finalHeadYByKeyIndex.get(keyIndex)
      return !hasMeaningfulDelta(
        typeof beforeY === 'number' && typeof afterY === 'number' ? afterY - beforeY : null,
      )
    })
    if (unchangedCommittedKeys.length > 0) {
      throw new Error(`Some selected chord keys did not move after commit: [${unchangedCommittedKeys.join(', ')}]`)
    }

    const report = {
      generatedAt: new Date().toISOString(),
      blankSelection: {
        pairIndex: pair0.pairIndex,
        blankPoint: {
          x: roundOrNull(blankPoint.x),
          y: roundOrNull(blankPoint.y),
        },
        selectedTargetKeys,
      },
      drag: {
        targetNoteId: targetNote.noteId,
        dragDeltaClientY: DRAG_DELTA_CLIENT_Y,
        start: {
          x: roundOrNull(dragStart.x),
          y: roundOrNull(dragStart.y),
        },
        end: {
          x: roundOrNull(dragEnd.x),
          y: roundOrNull(dragEnd.y),
        },
      },
      preview: {
        frameCount: previewFrames.length,
        initialAnchorX: roundOrNull(initialAnchorX),
        duringHoldAnchorX: roundOrNull(duringHoldAnchorX),
        duringHoldHeadXByKeyIndex: Object.fromEntries(
          [...duringHoldHeadXByKeyIndex.entries()].map(([keyIndex, value]) => [String(keyIndex), roundOrNull(value)]),
        ),
        duringHoldHeadYByKeyIndex: Object.fromEntries(
          [...duringHoldHeadYByKeyIndex.entries()].map(([keyIndex, value]) => [String(keyIndex), roundOrNull(value)]),
        ),
        lastFrameRows: targetPreviewRows.map((row) => ({
          frame: row.frame,
          keyIndex: row.keyIndex,
          pitch: row.pitch,
          noteXStatic: roundOrNull(row.noteXStatic),
          noteXPreview: roundOrNull(row.noteXPreview),
          noteXDelta: roundOrNull(row.noteXDelta),
          anchorXStatic: roundOrNull(row.anchorXStatic),
          anchorXPreview: roundOrNull(row.anchorXPreview),
          anchorXDelta: roundOrNull(row.anchorXDelta),
          headXStatic: roundOrNull(row.headXStatic),
          headXPreview: roundOrNull(row.headXPreview),
          headXDelta: roundOrNull(row.headXDelta),
          headYStatic: roundOrNull(row.headYStatic),
          headYPreview: roundOrNull(row.headYPreview),
          headYDelta: roundOrNull(row.headYDelta),
        })),
      },
      commit: {
        initialHeadXByKeyIndex: Object.fromEntries(
          [...initialHeadXByKeyIndex.entries()].map(([keyIndex, value]) => [String(keyIndex), roundOrNull(value)]),
        ),
        initialHeadYByKeyIndex: Object.fromEntries(
          [...initialHeadYByKeyIndex.entries()].map(([keyIndex, value]) => [String(keyIndex), roundOrNull(value)]),
        ),
        finalHeadYByKeyIndex: Object.fromEntries(
          [...finalHeadYByKeyIndex.entries()].map(([keyIndex, value]) => [String(keyIndex), roundOrNull(value)]),
        ),
      },
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')
    await browser.close()
    browser = null

    console.log(`Generated: ${outputPath}`)
    console.log(`Target note: ${targetNote.noteId}`)
    console.log(`Selected target keys: ${selectedTargetKeys.join(', ')}`)
    console.log(`Preview frame count: ${previewFrames.length}`)
    console.log(
      `Preview deltas: ${targetPreviewRows
        .map(
          (row) =>
            `[${row.keyIndex}] anchor=${String(roundOrNull(row.anchorXDelta))} headX=${String(roundOrNull(row.headXDelta))} headY=${String(roundOrNull(row.headYDelta))}`,
        )
        .join(', ')}`,
    )
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
