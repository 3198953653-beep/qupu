import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type NativePreviewSystemRange = {
  startPairIndex: number
  endPairIndexExclusive: number
}

type NativePreviewSystemDiagnostics = {
  range: NativePreviewSystemRange
  equivalentEighthGapPx: number
  equivalentEighthGapNotationPx: number
  elasticScale: number
  usableWidthPx: number
  usableWidthNotationPx: number
  fixedWidthTotalPx: number
  fixedWidthTotalNotationPx: number
  elasticWidthTotalPx: number
  elasticWidthTotalNotationPx: number
  totalWidthPx: number
  totalWidthNotationPx: number
  measures: Array<{
    pairIndex: number
    measureWidth: number
    contentMeasureWidth: number
    fixedWidthPx: number
    elasticWidthPx: number
    actualStartDecorationWidthPx: number
    timelineStretchScale: number
    previewSpacingAnchorTicks: number[] | null
  }>
}

type NativePreviewRenderedMeasureDiagnostics = {
  pairIndex: number
  renderedMeasureWidthPx: number
  contentMeasureWidthPx: number
  effectiveLeftGapPx: number | null
  effectiveRightGapPx: number | null
  trailingGapPx: number | null
  spacingAnchorGapFirstToLastPx: number | null
  timelineStretchScale: number | null
  previewSpacingAnchorTicks: number[] | null
}

type NativePreviewPageDiagnostics = {
  pageIndex: number
  pageNumber: number
  notationScale: number
  actualSystemGapPx: number
  actualSystemGapNotationPx: number
  minEquivalentEighthGapPx: number
  minEquivalentEighthGapNotationPx: number
  systemRanges: NativePreviewSystemRange[]
  systems: NativePreviewSystemDiagnostics[]
  renderedMeasures: NativePreviewRenderedMeasureDiagnostics[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4178
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEBUG_OUTPUT_DIR = path.resolve('debug')
const XML_MEASURE_COUNT = 24

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
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(fallbackTimer)
      resolve()
    }
    const fallbackTimer = setTimeout(() => finish(), 5000)
    server.once('exit', () => finish())
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
      const response = await Promise.race([
        fetch(url, { method: 'GET', cache: 'no-store' }),
        sleep(1500).then(() => null),
      ])
      if (response && 'ok' in response && response.ok) return
    } catch {
      // retry
    }
    await sleep(350)
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

function buildNativePreviewFixtureXml(measureCount: number): string {
  const trebleSteps = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']
  const trebleOctaves = [5, 5, 5, 5, 5, 5, 5, 6]
  const bassSteps = ['C', 'B', 'A', 'G', 'F', 'E', 'D', 'C']
  const bassOctaves = [3, 2, 2, 2, 2, 2, 2, 2]

  const buildNotesForStaff = (staff: 1 | 2, measureIndex: number): string => {
    const steps = staff === 1 ? trebleSteps : bassSteps
    const octaves = staff === 1 ? trebleOctaves : bassOctaves
    return steps.map((step, noteIndex) => {
      const sequenceIndex = (noteIndex + measureIndex) % steps.length
      return [
        '      <note>',
        `        <pitch><step>${steps[sequenceIndex]}</step><octave>${octaves[sequenceIndex]}</octave></pitch>`,
        '        <duration>2</duration>',
        '        <type>eighth</type>',
        `        <staff>${staff}</staff>`,
        '      </note>',
      ].join('\n')
    }).join('\n')
  }

  const measures = Array.from({ length: measureCount }, (_, index) => {
    const measureNumber = index + 1
    const attributes = index === 0
      ? [
          '      <attributes>',
          '        <divisions>4</divisions>',
          '        <key><fifths>0</fifths></key>',
          '        <time><beats>4</beats><beat-type>4</beat-type></time>',
          '        <staves>2</staves>',
          '        <clef number="1"><sign>G</sign><line>2</line></clef>',
          '        <clef number="2"><sign>F</sign><line>4</line></clef>',
          '      </attributes>',
        ].join('\n')
      : ''
    return [
      `    <measure number="${measureNumber}">`,
      attributes,
      buildNotesForStaff(1, index),
      buildNotesForStaff(2, index),
      '    </measure>',
    ].filter(Boolean).join('\n')
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC
  "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>Native Preview Smoke</work-title>
  </work>
  <identification>
    <creator type="composer">Codex Browser Test</creator>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${measures}
  </part>
</score-partwise>
`
}

function buildSparseNativePreviewFixtureXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC
  "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>Native Preview Sparse Stretch</work-title>
  </work>
  <identification>
    <creator type="composer">Codex Browser Test</creator>
  </identification>
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
        <rest/>
        <duration>8</duration>
        <type>half</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <rest/>
        <duration>16</duration>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`
}

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
    return (
      !!api &&
      typeof api.importMusicXmlText === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.dumpNativePreviewLayoutDiagnostics === 'function'
    )
  })
}

async function importMusicXml(page: Page, xmlText: string): Promise<void> {
  await page.evaluate((xml) => {
    const api = (window as unknown as {
      __scoreDebug: {
        importMusicXmlText: (text: string) => void
      }
    }).__scoreDebug
    api.importMusicXmlText(xml)
  }, xmlText)

  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __scoreDebug?: {
          getImportFeedback: () => ImportFeedback
        }
      }).__scoreDebug
      if (!api || typeof api.getImportFeedback !== 'function') return false
      const feedback = api.getImportFeedback()
      return feedback.kind !== 'idle' && feedback.kind !== 'loading'
    },
    { timeout: 120_000 },
  )

  const feedback = await page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getImportFeedback: () => ImportFeedback
      }
    }).__scoreDebug
    return api.getImportFeedback()
  })
  assert.equal(feedback.kind, 'success', `MusicXML import failed: ${feedback.message}`)
}

async function dumpNativePreviewLayoutDiagnostics(page: Page): Promise<NativePreviewPageDiagnostics[]> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        dumpNativePreviewLayoutDiagnostics: () => NativePreviewPageDiagnostics[]
      }
    }).__scoreDebug
    return api.dumpNativePreviewLayoutDiagnostics()
  })
}

function countSystems(pages: NativePreviewPageDiagnostics[]): number {
  return pages.reduce((sum, page) => sum + page.systems.length, 0)
}

function getSignature(pages: NativePreviewPageDiagnostics[]): string {
  return JSON.stringify(
    pages.map((page) => ({
      pageIndex: page.pageIndex,
      notationScale: Number(page.notationScale.toFixed(3)),
      actualSystemGapPx: Number(page.actualSystemGapPx.toFixed(3)),
      ranges: page.systemRanges.map((range) => [range.startPairIndex, range.endPairIndexExclusive]),
      systems: page.systems.map((system) => ({
        range: [system.range.startPairIndex, system.range.endPairIndexExclusive],
        equivalentEighthGapPx: Number(system.equivalentEighthGapPx.toFixed(3)),
        usableWidthPx: Number(system.usableWidthPx.toFixed(3)),
        totalWidthPx: Number(system.totalWidthPx.toFixed(3)),
      })),
      renderedMeasures: page.renderedMeasures.map((measure) => ({
        pairIndex: measure.pairIndex,
        renderedMeasureWidthPx: Number(measure.renderedMeasureWidthPx.toFixed(3)),
        spacingAnchorGapFirstToLastPx:
          typeof measure.spacingAnchorGapFirstToLastPx === 'number'
            ? Number(measure.spacingAnchorGapFirstToLastPx.toFixed(3))
            : null,
        timelineStretchScale:
          typeof measure.timelineStretchScale === 'number'
            ? Number(measure.timelineStretchScale.toFixed(5))
            : null,
      })),
    })),
  )
}

async function waitForNativePreviewReady(page: Page): Promise<NativePreviewPageDiagnostics[]> {
  await page.getByRole('dialog', { name: '五线谱预览' }).waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug?: {
        dumpNativePreviewLayoutDiagnostics: () => NativePreviewPageDiagnostics[]
      }
    }).__scoreDebug
    if (!api || typeof api.dumpNativePreviewLayoutDiagnostics !== 'function') return false
      const pages = api.dumpNativePreviewLayoutDiagnostics()
      return Array.isArray(pages) && pages.length > 0 && pages.some((page) => page.systems.length > 0)
  }, { timeout: 30_000 })
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.native-preview-page-canvas') as HTMLCanvasElement | null
    return !!canvas && canvas.width > 0 && canvas.height > 0
  }, { timeout: 20_000 })
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug?: {
        dumpNativePreviewLayoutDiagnostics: () => NativePreviewPageDiagnostics[]
      }
    }).__scoreDebug
    if (!api || typeof api.dumpNativePreviewLayoutDiagnostics !== 'function') return false
    const pages = api.dumpNativePreviewLayoutDiagnostics()
    return Array.isArray(pages) && pages.some((page) => page.renderedMeasures.length > 0)
  }, { timeout: 20_000 })
  return dumpNativePreviewLayoutDiagnostics(page)
}

async function setRangeValue(page: Page, selector: string, value: number): Promise<void> {
  await page.locator(selector).evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    input.value = String(nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function setNativePreviewZoomValue(page: Page, value: number): Promise<void> {
  await page.locator('#native-preview-zoom-range').evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    input.value = String(nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function waitForDiagnosticsChange(
  page: Page,
  previousSignature: string,
): Promise<NativePreviewPageDiagnostics[]> {
  await page.waitForFunction(
    (signature) => {
      const api = (window as unknown as {
        __scoreDebug?: {
          dumpNativePreviewLayoutDiagnostics: () => NativePreviewPageDiagnostics[]
        }
      }).__scoreDebug
      if (!api || typeof api.dumpNativePreviewLayoutDiagnostics !== 'function') return false
      const pages = api.dumpNativePreviewLayoutDiagnostics()
      if (!Array.isArray(pages) || pages.length === 0) return false
      const nextSignature = JSON.stringify(
        pages.map((page) => ({
          pageIndex: page.pageIndex,
          notationScale: Number(page.notationScale.toFixed(3)),
          actualSystemGapPx: Number(page.actualSystemGapPx.toFixed(3)),
          ranges: page.systemRanges.map((range) => [range.startPairIndex, range.endPairIndexExclusive]),
          systems: page.systems.map((system) => ({
            range: [system.range.startPairIndex, system.range.endPairIndexExclusive],
            equivalentEighthGapPx: Number(system.equivalentEighthGapPx.toFixed(3)),
            usableWidthPx: Number(system.usableWidthPx.toFixed(3)),
            totalWidthPx: Number(system.totalWidthPx.toFixed(3)),
          })),
          renderedMeasures: page.renderedMeasures.map((measure) => ({
            pairIndex: measure.pairIndex,
            renderedMeasureWidthPx: Number(measure.renderedMeasureWidthPx.toFixed(3)),
            spacingAnchorGapFirstToLastPx:
              typeof measure.spacingAnchorGapFirstToLastPx === 'number'
                ? Number(measure.spacingAnchorGapFirstToLastPx.toFixed(3))
                : null,
            timelineStretchScale:
              typeof measure.timelineStretchScale === 'number'
                ? Number(measure.timelineStretchScale.toFixed(5))
                : null,
          })),
        })),
      )
      return nextSignature !== signature
    },
    previousSignature,
    { timeout: 30_000 },
  )
  return dumpNativePreviewLayoutDiagnostics(page)
}

async function waitForRenderedMeasure(page: Page, pairIndex: number): Promise<void> {
  await page.waitForFunction(
    (targetPairIndex) => {
      const api = (window as unknown as {
        __scoreDebug?: {
          dumpNativePreviewLayoutDiagnostics: () => NativePreviewPageDiagnostics[]
        }
      }).__scoreDebug
      if (!api || typeof api.dumpNativePreviewLayoutDiagnostics !== 'function') return false
      const pages = api.dumpNativePreviewLayoutDiagnostics()
      return Array.isArray(pages) && pages.some((pageItem) =>
        pageItem.renderedMeasures.some((measure) => measure.pairIndex === targetPairIndex),
      )
    },
    pairIndex,
    { timeout: 20_000 },
  )
}

function getRenderedMeasureDiagnostics(
  pages: NativePreviewPageDiagnostics[],
  pairIndex: number,
): NativePreviewRenderedMeasureDiagnostics {
  for (const page of pages) {
    const found = page.renderedMeasures.find((measure) => measure.pairIndex === pairIndex)
    if (found) return found
  }
  throw new Error(`Could not find rendered diagnostics for pair ${pairIndex}.`)
}

async function captureDebugArtifacts(page: Page, name: string): Promise<void> {
  await mkdir(DEBUG_OUTPUT_DIR, { recursive: true })
  await page.screenshot({
    path: path.join(DEBUG_OUTPUT_DIR, name),
    fullPage: true,
  })
}

async function run(): Promise<void> {
  const xmlText = buildNativePreviewFixtureXml(XML_MEASURE_COUNT)
  const sparseXmlText = buildSparseNativePreviewFixtureXml()
  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  try {
    await waitForServer(DEV_URL, 30_000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1720, height: 1180 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await waitForDebugApi(page)
    await importMusicXml(page, xmlText)

    await page.getByRole('button', { name: 'OSMD预览' }).waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: '五线谱预览' }).waitFor({ state: 'visible', timeout: 20_000 })

    await page.getByRole('button', { name: '五线谱预览' }).click()
    const initialDiagnostics = await waitForNativePreviewReady(page)
    assert.ok(initialDiagnostics.length >= 1, 'Expected native preview to produce at least one page.')
    assert.ok(countSystems(initialDiagnostics) >= 2, 'Expected native preview fixture to produce multiple systems.')

    const dialog = page.getByRole('dialog', { name: '五线谱预览' })
    await expectText(dialog.locator('.native-preview-title'), 'Native Preview Smoke')
    await expectText(dialog.locator('.native-preview-subtitle'), 'Codex Browser Test')
    await expectChecked(dialog.locator('#native-preview-page-number-toggle'), true, 'Expected page numbers to default to enabled.')
    await expectInputValue(dialog.locator('#native-preview-zoom-range'), '66', 'Expected native preview zoom default to be 66.')
    await expectInputValue(dialog.locator('#native-preview-paper-scale-range'), '100', 'Expected native preview paper scale default to be 100.')
    await expectInputValue(dialog.locator('#native-preview-horizontal-margin-range'), '68', 'Expected native preview horizontal margin default to be 68.')
    await expectInputValue(dialog.locator('#native-preview-first-top-margin-range'), '132', 'Expected native preview first-page top margin default to be 132.')
    await expectInputValue(dialog.locator('#native-preview-top-margin-range'), '10', 'Expected native preview following-page top margin default to be 10.')
    await expectInputValue(dialog.locator('#native-preview-bottom-margin-range'), '86', 'Expected native preview bottom margin default to be 86.')
    await expectInputValue(dialog.locator('#native-preview-min-eighth-gap-range'), '20', 'Expected native preview minimum eighth gap default to be 20.')
    await expectInputValue(dialog.locator('#native-preview-min-grand-staff-gap-range'), '44', 'Expected native preview minimum grand-staff gap default to be 44.')

    const initialSignature = getSignature(initialDiagnostics)
    const initialPageCount = initialDiagnostics.length
    const initialSystemCount = countSystems(initialDiagnostics)

    await setNativePreviewZoomValue(page, 140)
    const highZoomDiagnostics = await waitForDiagnosticsChange(page, initialSignature)
    const highZoomSignature = getSignature(highZoomDiagnostics)

    await setNativePreviewZoomValue(page, 70)
    const lowZoomDiagnostics = await waitForDiagnosticsChange(page, highZoomSignature)
    const lowZoomSignature = getSignature(lowZoomDiagnostics)

    assert.ok(
      highZoomDiagnostics.length > lowZoomDiagnostics.length ||
      countSystems(highZoomDiagnostics) > countSystems(lowZoomDiagnostics),
      'Higher notation zoom should increase page count or system count in native preview.',
    )
    assert.ok(
      highZoomDiagnostics.every((pageItem) => Math.abs(pageItem.notationScale - 1.4) <= 0.001),
      'High zoom diagnostics should report the expected notation scale.',
    )
    assert.ok(
      lowZoomDiagnostics.every((pageItem) => Math.abs(pageItem.notationScale - 0.7) <= 0.001),
      'Low zoom diagnostics should report the expected notation scale.',
    )

    await setNativePreviewZoomValue(page, 100)
    const restoredZoomDiagnostics = await waitForDiagnosticsChange(page, lowZoomSignature)
    const restoredZoomSignature = getSignature(restoredZoomDiagnostics)

    await setRangeValue(page, '#native-preview-min-eighth-gap-range', 36)
    const highEighthDiagnostics = await waitForDiagnosticsChange(page, restoredZoomSignature)
    const highEighthSignature = getSignature(highEighthDiagnostics)

    await setRangeValue(page, '#native-preview-min-eighth-gap-range', 14)
    const lowEighthDiagnostics = await waitForDiagnosticsChange(page, highEighthSignature)

    assert.ok(
      countSystems(highEighthDiagnostics) > countSystems(lowEighthDiagnostics),
      'Higher min eighth gap should force more systems than a looser threshold.',
    )
    assert.ok(
      highEighthDiagnostics.every((pageItem) => pageItem.systems.every((system) => system.equivalentEighthGapPx >= 36 - 0.01)),
      'High min eighth gap diagnostics should respect the configured threshold.',
    )
    assert.ok(
      lowEighthDiagnostics.every((pageItem) => pageItem.systems.every((system) => system.equivalentEighthGapPx >= 14 - 0.01)),
      'Low min eighth gap diagnostics should respect the configured threshold.',
    )

    await setRangeValue(page, '#native-preview-min-eighth-gap-range', 36)
    const restoredHighEighthDiagnostics = await waitForDiagnosticsChange(page, getSignature(lowEighthDiagnostics))
    const restoredHighEighthSignature = getSignature(restoredHighEighthDiagnostics)

    await setRangeValue(page, '#native-preview-min-grand-staff-gap-range', 96)
    const highGrandStaffGapDiagnostics = await waitForDiagnosticsChange(page, restoredHighEighthSignature)

    assert.ok(
      highGrandStaffGapDiagnostics.length > restoredHighEighthDiagnostics.length,
      'Higher min grand-staff gap should increase native preview page count for the dense fixture.',
    )
    assert.ok(
      restoredHighEighthDiagnostics.every((pageItem) => pageItem.actualSystemGapPx >= 44 - 0.01 || pageItem.systems.length <= 1),
      'Default grand-staff gap diagnostics should stay above the configured threshold.',
    )
    assert.ok(
      highGrandStaffGapDiagnostics.every((pageItem) => pageItem.actualSystemGapPx >= 96 - 0.01 || pageItem.systems.length <= 1),
      'High grand-staff gap diagnostics should stay above the configured threshold when a page has multiple systems.',
    )

    const paginationLabel = dialog.locator('.osmd-preview-pagination span')
    await expectText(paginationLabel, `1 / ${highGrandStaffGapDiagnostics.length}`)
    if (highGrandStaffGapDiagnostics.length > 1) {
      await dialog.getByRole('button', { name: '下一页' }).click()
      await expectText(paginationLabel, `2 / ${highGrandStaffGapDiagnostics.length}`)
    }

    const pageNumber = dialog.locator('.native-preview-page-number')
    await assertVisible(pageNumber, 'Expected native preview page number overlay to be visible by default.')
    await dialog.locator('#native-preview-page-number-toggle').uncheck()
    await assertHidden(pageNumber, 'Expected native preview page number overlay to hide when the toggle is disabled.')
    await dialog.locator('#native-preview-page-number-toggle').check()
    await assertVisible(pageNumber, 'Expected native preview page number overlay to reappear after re-enabling the toggle.')
    if (highGrandStaffGapDiagnostics.length > 1) {
      await dialog.getByRole('button', { name: '上一页' }).click()
      await expectText(paginationLabel, `1 / ${highGrandStaffGapDiagnostics.length}`)
    }

    await dialog.getByRole('button', { name: '关闭' }).click()
    await importMusicXml(page, sparseXmlText)
    await page.getByRole('button', { name: '五线谱预览' }).click()
    await waitForRenderedMeasure(page, 0)
    const sparseInitialDiagnostics = await waitForNativePreviewReady(page)
    assert.equal(sparseInitialDiagnostics.length, 1, 'Sparse fixture should fit on a single preview page.')
    const sparseInitialMeasure = getRenderedMeasureDiagnostics(sparseInitialDiagnostics, 0)

    await setRangeValue(page, '#native-preview-horizontal-margin-range', 120)
    await waitForDiagnosticsChange(page, getSignature(sparseInitialDiagnostics))
    await waitForRenderedMeasure(page, 0)
    const sparseNarrowDiagnostics = await dumpNativePreviewLayoutDiagnostics(page)
    const sparseNarrowMeasure = getRenderedMeasureDiagnostics(sparseNarrowDiagnostics, 0)
    const sparseNarrowSignature = getSignature(sparseNarrowDiagnostics)

    await setRangeValue(page, '#native-preview-horizontal-margin-range', 0)
    await waitForDiagnosticsChange(page, sparseNarrowSignature)
    await waitForRenderedMeasure(page, 0)
    const sparseWideDiagnostics = await dumpNativePreviewLayoutDiagnostics(page)
    const sparseWideMeasure = getRenderedMeasureDiagnostics(sparseWideDiagnostics, 0)

    assert.ok(
      sparseWideMeasure.timelineStretchScale !== null &&
      sparseNarrowMeasure.timelineStretchScale !== null &&
      sparseWideMeasure.timelineStretchScale > sparseNarrowMeasure.timelineStretchScale,
      'Wider usable width should increase native preview timeline stretch for a sparse single-measure system.',
    )
    assert.ok(
      sparseWideMeasure.spacingAnchorGapFirstToLastPx !== null &&
      sparseNarrowMeasure.spacingAnchorGapFirstToLastPx !== null &&
      sparseWideMeasure.spacingAnchorGapFirstToLastPx > sparseNarrowMeasure.spacingAnchorGapFirstToLastPx,
      'Sparse single-measure systems should expand anchor-to-anchor spacing when the system gets wider.',
    )
    assert.ok(
      (sparseWideMeasure.previewSpacingAnchorTicks?.length ?? 0) > 2,
      'Sparse stretch mode should inject preview spacing anchors beyond the original note onsets.',
    )
    assert.ok(
      sparseWideMeasure.effectiveRightGapPx === null || sparseWideMeasure.effectiveRightGapPx < sparseWideMeasure.renderedMeasureWidthPx * 0.3,
      'Sparse single-measure stretch should not leave the rendered content heavily bunched against the left edge.',
    )

    await mkdir(DEBUG_OUTPUT_DIR, { recursive: true })
    await writeFile(
      path.join(DEBUG_OUTPUT_DIR, 'native-preview-browser-report.json'),
      JSON.stringify(
        {
          measureCount: XML_MEASURE_COUNT,
          initialPageCount,
          initialSystemCount,
          initialDiagnostics,
          highZoomDiagnostics,
          lowZoomDiagnostics,
          restoredZoomDiagnostics,
          highEighthDiagnostics,
          lowEighthDiagnostics,
          restoredHighEighthDiagnostics,
          highGrandStaffGapDiagnostics,
          sparseInitialDiagnostics,
          sparseInitialMeasure,
          sparseNarrowDiagnostics,
          sparseNarrowMeasure,
          sparseWideDiagnostics,
          sparseWideMeasure,
        },
        null,
        2,
      ),
      'utf8',
    )
    await captureDebugArtifacts(page, 'native-preview-browser.png')
    console.log('Native preview browser smoke test passed.')
  } finally {
    if (browser) {
      await browser.close()
    }
    await stopDevServer(server)
  }
}

async function expectText(locator: ReturnType<Page['locator']>, expected: string): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: 20_000 })
  const actual = (await locator.textContent())?.trim() ?? ''
  assert.equal(actual, expected)
}

async function expectInputValue(
  locator: ReturnType<Page['locator']>,
  expected: string,
  message?: string,
): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: 20_000 })
  const actual = await locator.inputValue()
  assert.equal(actual, expected, message)
}

async function expectChecked(locator: ReturnType<Page['locator']>, expected: boolean, message?: string): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: 20_000 })
  const actual = await locator.isChecked()
  assert.equal(actual, expected, message)
}

async function assertVisible(locator: ReturnType<Page['locator']>, message: string): Promise<void> {
  const count = await locator.count()
  assert.ok(count > 0, message)
  const visible = await locator.first().isVisible()
  assert.ok(visible, message)
}

async function assertHidden(locator: ReturnType<Page['locator']>, message: string): Promise<void> {
  const count = await locator.count()
  if (count === 0) return
  const visible = await locator.first().isVisible()
  assert.ok(!visible, message)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
