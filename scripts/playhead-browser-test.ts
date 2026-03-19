import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { SAMPLE_MUSIC_XML } from '../src/score/constants'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type PlaybackPoint = {
  pairIndex: number
  onsetTick: number
}

type PlaybackCursorState = {
  point: PlaybackPoint | null
  color: 'red' | 'yellow'
  rectPx: { x: number; y: number; width: number; height: number } | null
  status: 'idle' | 'playing'
  sessionId: number
}

type PlaybackCursorDebugEvent = {
  sequence: number
  sessionId: number
  atMs: number
  kind: 'start' | 'point' | 'complete'
  point: PlaybackPoint | null
  status: 'idle' | 'playing'
}

type PlaybackTimelinePoint = {
  pairIndex: number
  onsetTick: number
  atSeconds: number
  targetCount: number
}

type ScrollSnapshot = {
  scrollLeft: number
  scrollTop: number
  clientWidth: number
  clientHeight: number
  stageOffsetLeft: number
  stageOffsetTop: number
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const MANUAL_SCALE_PERCENT = 170

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

function buildRepeatedMusicXml(measureCount: number): string {
  const measureMatch = SAMPLE_MUSIC_XML.match(/<measure number="1">[\s\S]*?<\/measure>/)
  if (!measureMatch) {
    throw new Error('Unable to extract sample measure from SAMPLE_MUSIC_XML.')
  }
  const measureTemplate = measureMatch[0]
  const repeatedMeasures = Array.from({ length: measureCount }, (_, index) =>
    measureTemplate.replace('number="1"', `number="${index + 1}"`),
  ).join('\n')
  return SAMPLE_MUSIC_XML.replace(measureTemplate, repeatedMeasures)
}

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
    return (
      !!api &&
      typeof api.importMusicXmlText === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.setAutoScaleEnabled === 'function' &&
      typeof api.setManualScalePercent === 'function' &&
      typeof api.playScore === 'function' &&
      typeof api.getPlaybackCursorState === 'function' &&
      typeof api.getPlaybackCursorEvents === 'function' &&
      typeof api.clearPlaybackCursorEvents === 'function' &&
      typeof api.getPlaybackTimelinePoints === 'function'
    )
  })
}

async function setScoreScale(page: Page): Promise<void> {
  await page.evaluate((manualScalePercent) => {
    const api = (window as unknown as {
      __scoreDebug: {
        setAutoScaleEnabled: (enabled: boolean) => void
        setManualScalePercent: (value: number) => void
      }
    }).__scoreDebug
    api.setAutoScaleEnabled(false)
    api.setManualScalePercent(manualScalePercent)
  }, MANUAL_SCALE_PERCENT)
  await page.waitForTimeout(150)
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

async function getPlaybackCursorState(page: Page): Promise<PlaybackCursorState> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlaybackCursorState: () => PlaybackCursorState
      }
    }).__scoreDebug
    return api.getPlaybackCursorState()
  })
}

async function getPlaybackCursorEvents(page: Page): Promise<PlaybackCursorDebugEvent[]> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlaybackCursorEvents: () => PlaybackCursorDebugEvent[]
      }
    }).__scoreDebug
    return api.getPlaybackCursorEvents()
  })
}

async function clearPlaybackCursorEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        clearPlaybackCursorEvents: () => void
      }
    }).__scoreDebug
    api.clearPlaybackCursorEvents()
  })
}

async function getPlaybackTimelinePoints(page: Page): Promise<PlaybackTimelinePoint[]> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlaybackTimelinePoints: () => PlaybackTimelinePoint[]
      }
    }).__scoreDebug
    return api.getPlaybackTimelinePoints()
  })
}

async function startPlayback(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        playScore: () => void
      }
    }).__scoreDebug
    api.playScore()
  })
}

async function getScrollSnapshot(page: Page): Promise<ScrollSnapshot> {
  return page.evaluate(() => {
    const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLDivElement | null
    const scoreStage = document.querySelector('.score-stage.horizontal-view') as HTMLDivElement | null
    if (!scrollHost || !scoreStage) {
      throw new Error('Score scroll host or stage element not found.')
    }
    return {
      scrollLeft: scrollHost.scrollLeft,
      scrollTop: scrollHost.scrollTop,
      clientWidth: scrollHost.clientWidth,
      clientHeight: scrollHost.clientHeight,
      stageOffsetLeft: scoreStage.offsetLeft,
      stageOffsetTop: scoreStage.offsetTop,
    }
  })
}

function pointKey(point: PlaybackPoint | null | undefined): string {
  if (!point) return 'null'
  return `${point.pairIndex}:${point.onsetTick}`
}

function rectKey(rect: PlaybackCursorState['rectPx']): string {
  if (!rect) return 'null'
  return `${rect.x.toFixed(3)}:${rect.y.toFixed(3)}:${rect.width.toFixed(3)}:${rect.height.toFixed(3)}`
}

function isPlayheadVisible(state: PlaybackCursorState, scroll: ScrollSnapshot): boolean {
  if (!state.rectPx) return false
  const left = scroll.stageOffsetLeft + state.rectPx.x
  const right = left + state.rectPx.width
  return (
    left >= scroll.scrollLeft &&
    right <= scroll.scrollLeft + scroll.clientWidth
  )
}

async function main() {
  const outputPath = process.argv[2] ?? path.resolve('debug', 'playhead-browser-report.json')
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
    const page = await browser.newPage({ viewport: { width: 820, height: 720 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)
    await setScoreScale(page)
    await importMusicXmlViaDebugApi(page, buildRepeatedMusicXml(4))
    await setScoreScale(page)
    await page.waitForTimeout(250)

    await page.waitForFunction(() => {
      const api = (window as unknown as {
        __scoreDebug: {
          getPlaybackCursorState: () => PlaybackCursorState
        }
      }).__scoreDebug
      const state = api.getPlaybackCursorState()
      return state.status === 'idle' && state.color === 'red' && state.rectPx !== null
    })

    const initialState = await getPlaybackCursorState(page)
    const timelinePoints = await getPlaybackTimelinePoints(page)
    if (timelinePoints.length === 0) {
      throw new Error('Playback timeline is empty after import.')
    }
    const firstTimelinePoint = timelinePoints[0]
    const lastTimelinePoint = timelinePoints[timelinePoints.length - 1]
    if (pointKey(initialState.point) !== pointKey(firstTimelinePoint)) {
      throw new Error(
        `Initial playhead point mismatch: got=${pointKey(initialState.point)} expected=${pointKey(firstTimelinePoint)}`,
      )
    }
    if (initialState.status !== 'idle' || initialState.color !== 'red') {
      throw new Error(`Initial playhead status mismatch: ${initialState.status}/${initialState.color}`)
    }
    if (!initialState.rectPx || initialState.rectPx.width !== 2) {
      throw new Error('Initial playhead rect is missing or width is not 2px.')
    }

    const initialScroll = await getScrollSnapshot(page)
    if (!isPlayheadVisible(initialState, initialScroll)) {
      throw new Error('Initial playhead is not visible inside the scroll viewport.')
    }

    await clearPlaybackCursorEvents(page)
    await startPlayback(page)

    await page.waitForFunction(() => {
      const api = (window as unknown as {
        __scoreDebug: {
          getPlaybackCursorState: () => PlaybackCursorState
        }
      }).__scoreDebug
      const state = api.getPlaybackCursorState()
      return state.status === 'playing' && state.color === 'yellow'
    })

    const playingState = await getPlaybackCursorState(page)
    if (playingState.status !== 'playing' || playingState.color !== 'yellow') {
      throw new Error(`Playhead did not switch to yellow playing state: ${playingState.status}/${playingState.color}`)
    }

    await page.waitForFunction(
      (expectedPointCount) => {
        const api = (window as unknown as {
          __scoreDebug: {
            getPlaybackCursorEvents: () => PlaybackCursorDebugEvent[]
          }
        }).__scoreDebug
        const pointEvents = api.getPlaybackCursorEvents().filter((event) => event.kind === 'point')
        return pointEvents.length >= expectedPointCount
      },
      timelinePoints.length,
      { timeout: 20_000 },
    )
    await page.waitForFunction(() => {
      const api = (window as unknown as {
        __scoreDebug: {
          getPlaybackCursorState: () => PlaybackCursorState
        }
      }).__scoreDebug
      const state = api.getPlaybackCursorState()
      return state.status === 'idle' && state.color === 'red'
    })

    const finalState = await getPlaybackCursorState(page)
    const finalScroll = await getScrollSnapshot(page)
    const playbackEvents = await getPlaybackCursorEvents(page)
    const pointEvents = playbackEvents
      .filter((event) => event.kind === 'point' && event.sessionId === finalState.sessionId)
      .map((event) => pointKey(event.point))
    const expectedPointKeys = timelinePoints.map((point) => pointKey(point))

    if (pointEvents.join('|') !== expectedPointKeys.join('|')) {
      throw new Error(
        `Playhead point sequence mismatch.\nexpected=${expectedPointKeys.join(',')}\nactual=${pointEvents.join(',')}`,
      )
    }
    if (finalState.status !== 'idle' || finalState.color !== 'red') {
      throw new Error(`Final playhead status mismatch: ${finalState.status}/${finalState.color}`)
    }
    if (pointKey(finalState.point) !== pointKey(lastTimelinePoint)) {
      throw new Error(
        `Final playhead point mismatch: got=${pointKey(finalState.point)} expected=${pointKey(lastTimelinePoint)}`,
      )
    }
    if (finalScroll.scrollLeft <= initialScroll.scrollLeft + 1) {
      throw new Error('Auto-scroll did not move the score viewport during playback.')
    }
    if (!isPlayheadVisible(finalState, finalScroll)) {
      throw new Error('Final playhead is not visible inside the scroll viewport.')
    }

    await page.waitForTimeout(250)
    const settledState = await getPlaybackCursorState(page)
    if (pointKey(settledState.point) !== pointKey(finalState.point) || rectKey(settledState.rectPx) !== rectKey(finalState.rectPx)) {
      throw new Error('Playhead moved after playback finished; it should stay on the final point.')
    }

    const report = {
      generatedAt: new Date().toISOString(),
      initialState,
      playingState,
      finalState,
      settledState,
      initialScroll,
      finalScroll,
      expectedTimelinePoints: timelinePoints,
      playbackCursorEvents: playbackEvents,
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')

    console.log(`Generated: ${outputPath}`)
    console.log(`Timeline points: ${timelinePoints.length}`)
    console.log(`Playback cursor events: ${playbackEvents.length}`)

    await browser.close()
  } finally {
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
