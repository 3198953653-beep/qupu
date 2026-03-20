import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
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
  scrollWidth: number
  stageOffsetLeft: number
  stageOffsetTop: number
}

type PlaybackPointSample = {
  eventPoint: PlaybackPoint | null
  statePoint: PlaybackPoint | null
  scrollLeft: number
  viewportX: number | null
  status: 'idle' | 'playing'
  color: 'red' | 'yellow'
  atMs: number
}

type PlayheadDebugLogRow = {
  seq: number
  playheadX: number | null
  containerLeftX: number
  containerRightX: number
  distanceToRightEdge: number | null
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const MANUAL_SCALE_PERCENT = 170
const PLAYHEAD_TEST_TRIGGER_MARGIN_PX = 24
const PLAYHEAD_TEST_LEFT_ANCHOR_PX = 72
const PLAYHEAD_TEST_WIDTH_PX = 2

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
      typeof api.getPlaybackTimelinePoints === 'function' &&
      typeof api.getPlayheadDebugLogRows === 'function' &&
      typeof api.getPlayheadDebugViewportSnapshot === 'function'
    )
  })
}

async function waitForReadyPlayhead(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlaybackCursorState: () => PlaybackCursorState
      }
    }).__scoreDebug
    const state = api.getPlaybackCursorState()
    return state.status === 'idle' && state.color === 'red' && state.rectPx !== null
  })
}

async function preparePlaybackFixture(page: Page): Promise<void> {
  await setScoreScale(page)
  await importMusicXmlViaDebugApi(page, buildRepeatedMusicXml(10))
  await setScoreScale(page)
  await page.waitForTimeout(250)
  await waitForReadyPlayhead(page)
}

async function reloadAndWait(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForDebugApi(page)
}

async function getPlayheadFollowToggleText(page: Page): Promise<string> {
  const button = page.getByRole('button', { name: /^播放线跟踪：(开|关)$/ })
  await button.waitFor()
  return ((await button.textContent()) ?? '').trim()
}

async function setPlayheadFollowEnabled(page: Page, enabled: boolean): Promise<void> {
  const expectedLabel = `播放线跟踪：${enabled ? '开' : '关'}`
  const button = page.getByRole('button', { name: /^播放线跟踪：(开|关)$/ })
  await button.waitFor()
  const currentLabel = ((await button.textContent()) ?? '').trim()
  if (currentLabel === expectedLabel) return
  await button.click()
  await page.waitForFunction((label) => {
    return [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === label)
  }, expectedLabel)
}

async function clickButtonByText(page: Page, text: string): Promise<void> {
  const button = page.getByRole('button', { name: text })
  await button.waitFor()
  await button.click()
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

async function getPlayheadDebugLogRows(page: Page): Promise<PlayheadDebugLogRow[]> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlayheadDebugLogRows: () => PlayheadDebugLogRow[]
      }
    }).__scoreDebug
    return api.getPlayheadDebugLogRows()
  })
}

async function getPlayheadDebugViewportSnapshot(page: Page): Promise<PlayheadDebugLogRow | null> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlayheadDebugViewportSnapshot: () => PlayheadDebugLogRow | null
      }
    }).__scoreDebug
    return api.getPlayheadDebugViewportSnapshot()
  })
}

async function runPlaybackAndCollectPointSamples(
  page: Page,
  expectedPointCount: number,
): Promise<{ playingState: PlaybackCursorState; pointSamples: PlaybackPointSample[] }> {
  await clearPlaybackCursorEvents(page)
  await page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        playScore: () => void
      }
    }).__scoreDebug
    api.playScore()
  })

  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlaybackCursorState: () => PlaybackCursorState
      }
    }).__scoreDebug
    const state = api.getPlaybackCursorState()
    return state.status === 'playing' && state.color === 'yellow'
  })
  await page.waitForFunction(() => {
    const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLDivElement | null
    const playhead = document.querySelector('.score-playhead') as HTMLDivElement | null
    if (!scrollHost || !playhead) return false
    const scrollHostRect = scrollHost.getBoundingClientRect()
    const playheadRect = playhead.getBoundingClientRect()
    return playheadRect.left >= scrollHostRect.left - 1 && playheadRect.right <= scrollHostRect.right + 1
  }, { timeout: 10_000 })

  const playingState = await getPlaybackCursorState(page)
  const pointSamples: PlaybackPointSample[] = []
  for (let pointIndex = 0; pointIndex < expectedPointCount; pointIndex += 1) {
    await page.waitForFunction(
      (requiredPointCount) => {
        const api = (window as unknown as {
          __scoreDebug: {
            getPlaybackCursorEvents: () => PlaybackCursorDebugEvent[]
          }
        }).__scoreDebug
        const pointEvents = api.getPlaybackCursorEvents().filter((event) => event.kind === 'point')
        return pointEvents.length >= requiredPointCount
      },
      pointIndex + 1,
      { timeout: 20_000 },
    )
    await page.waitForTimeout(32)

    const playbackEvents = await getPlaybackCursorEvents(page)
    const pointEvents = playbackEvents.filter((event) => event.kind === 'point')
    const pointEvent = pointEvents[pointIndex]
    if (!pointEvent) {
      throw new Error(`Missing point event at index ${pointIndex}.`)
    }

    const currentState = await getPlaybackCursorState(page)
    const scroll = await getScrollSnapshot(page)
    const playheadGeometry = await getPlayheadDomGeometry(page)
    pointSamples.push({
      eventPoint: pointEvent.point ? { ...pointEvent.point } : null,
      statePoint: currentState.point ? { ...currentState.point } : null,
      scrollLeft: scroll.scrollLeft,
      viewportX: currentState.rectPx ? playheadGeometry.playheadX : null,
      status: currentState.status,
      color: currentState.color,
      atMs: pointEvent.atMs,
    })
  }

  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlaybackCursorState: () => PlaybackCursorState
      }
    }).__scoreDebug
    const state = api.getPlaybackCursorState()
    return state.status === 'idle' && state.color === 'red'
  })

  return { playingState, pointSamples }
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
      scrollWidth: scrollHost.scrollWidth,
      stageOffsetLeft: scoreStage.offsetLeft,
      stageOffsetTop: scoreStage.offsetTop,
    }
  })
}

async function getPlayheadDomGeometry(page: Page): Promise<{
  containerLeftX: number
  containerRightX: number
  playheadX: number | null
  playheadRightX: number | null
}> {
  return page.evaluate(() => {
    const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLDivElement | null
    const playhead = document.querySelector('.score-playhead') as HTMLDivElement | null
    if (!scrollHost) {
      throw new Error('Score scroll host not found for playhead DOM geometry.')
    }
    const scrollHostRect = scrollHost.getBoundingClientRect()
    const playheadRect = playhead?.getBoundingClientRect() ?? null
    return {
      containerLeftX: 0,
      containerRightX: scrollHost.clientWidth,
      playheadX: playheadRect ? playheadRect.left - scrollHostRect.left : null,
      playheadRightX: playheadRect ? playheadRect.right - scrollHostRect.left : null,
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

function isPlayheadVisible(geometry: {
  containerLeftX: number
  containerRightX: number
  playheadX: number | null
  playheadRightX: number | null
}): boolean {
  if (geometry.playheadX === null || geometry.playheadRightX === null) return false
  return geometry.playheadX >= geometry.containerLeftX && geometry.playheadRightX <= geometry.containerRightX
}

async function main() {
  const outputPath = process.argv[2] ?? path.resolve('debug', 'playhead-browser-report.json')
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
    const page = await browser.newPage({ viewport: { width: 820, height: 720 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)
    const defaultFollowToggleText = await getPlayheadFollowToggleText(page)
    if (defaultFollowToggleText !== '播放线跟踪：开') {
      throw new Error(`Expected default playhead follow toggle to be on, but got "${defaultFollowToggleText}".`)
    }

    await setPlayheadFollowEnabled(page, false)
    await reloadAndWait(page)
    const persistedOffToggleText = await getPlayheadFollowToggleText(page)
    if (persistedOffToggleText !== '播放线跟踪：关') {
      throw new Error(`Expected playhead follow toggle to persist as off after reload, but got "${persistedOffToggleText}".`)
    }

    await preparePlaybackFixture(page)

    const followOffInitialScroll = await getScrollSnapshot(page)
    const followOffInitialLogRows = await getPlayheadDebugLogRows(page)
    await clearPlaybackCursorEvents(page)
    await page.evaluate(() => {
      const api = (window as unknown as {
        __scoreDebug: {
          playScore: () => void
        }
      }).__scoreDebug
      api.playScore()
    })
    await page.waitForFunction(() => {
      const api = (window as unknown as {
        __scoreDebug: {
          getPlaybackCursorState: () => PlaybackCursorState
        }
      }).__scoreDebug
      const state = api.getPlaybackCursorState()
      return state.status === 'playing' && state.color === 'yellow'
    })
    await page.waitForFunction(
      ({ expectedScrollLeft, expectedScrollTop }) => {
        const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLDivElement | null
        const playhead = document.querySelector('.score-playhead') as HTMLDivElement | null
        if (!scrollHost || !playhead) return false
        const scrollHostRect = scrollHost.getBoundingClientRect()
        const playheadRect = playhead.getBoundingClientRect()
        const playheadLeft = playheadRect.left - scrollHostRect.left
        const playheadRight = playheadRect.right - scrollHostRect.left
        return (
          Math.abs(scrollHost.scrollLeft - expectedScrollLeft) <= 1 &&
          Math.abs(scrollHost.scrollTop - expectedScrollTop) <= 1 &&
          playheadLeft > scrollHost.clientWidth + 4 &&
          playheadRight > scrollHost.clientWidth + 4
        )
      },
      {
        expectedScrollLeft: followOffInitialScroll.scrollLeft,
        expectedScrollTop: followOffInitialScroll.scrollTop,
      },
      { timeout: 20_000 },
    )
    await page.waitForTimeout(120)

    const followOffMidScroll = await getScrollSnapshot(page)
    const followOffMidGeometry = await getPlayheadDomGeometry(page)
    const followOffMidLogRows = await getPlayheadDebugLogRows(page)
    if (Math.abs(followOffMidScroll.scrollLeft - followOffInitialScroll.scrollLeft) > 1) {
      throw new Error(
        `Playhead follow disabled but scrollLeft still changed during playback: initial=${followOffInitialScroll.scrollLeft} current=${followOffMidScroll.scrollLeft}`,
      )
    }
    if (Math.abs(followOffMidScroll.scrollTop - followOffInitialScroll.scrollTop) > 1) {
      throw new Error(
        `Playhead follow disabled but scrollTop still changed during playback: initial=${followOffInitialScroll.scrollTop} current=${followOffMidScroll.scrollTop}`,
      )
    }
    if (followOffMidLogRows.length <= followOffInitialLogRows.length) {
      throw new Error('Playhead debug log did not continue updating while follow was disabled.')
    }
    if (
      followOffMidGeometry.playheadX === null ||
      followOffMidGeometry.playheadX <= followOffMidGeometry.containerRightX + 4
    ) {
      throw new Error(
        `Expected playhead to move outside the container when follow is disabled, but playheadX=${followOffMidGeometry.playheadX}.`,
      )
    }

    await setPlayheadFollowEnabled(page, true)
    await page.waitForFunction(
      ({ previousScrollLeft }) => {
        const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLDivElement | null
        const playhead = document.querySelector('.score-playhead') as HTMLDivElement | null
        if (!scrollHost || !playhead) return false
        const scrollHostRect = scrollHost.getBoundingClientRect()
        const playheadRect = playhead.getBoundingClientRect()
        const playheadLeft = playheadRect.left - scrollHostRect.left
        const playheadRight = playheadRect.right - scrollHostRect.left
        return (
          scrollHost.scrollLeft > previousScrollLeft + 1 &&
          playheadLeft >= -1 &&
          playheadRight <= scrollHost.clientWidth + 1
        )
      },
      { previousScrollLeft: followOffMidScroll.scrollLeft },
      { timeout: 10_000 },
    )
    const followOnRecoveredScroll = await getScrollSnapshot(page)
    if (followOnRecoveredScroll.scrollLeft <= followOffMidScroll.scrollLeft + 1) {
      throw new Error('Playhead follow was re-enabled during playback, but horizontal auto-scroll did not resume.')
    }
    await clickButtonByText(page, '停止')
    await page.waitForFunction(() => {
      const api = (window as unknown as {
        __scoreDebug: {
          getPlaybackCursorState: () => PlaybackCursorState
        }
      }).__scoreDebug
      const state = api.getPlaybackCursorState()
      return state.status === 'idle' && state.color === 'red'
    })

    await reloadAndWait(page)
    const persistedOnToggleText = await getPlayheadFollowToggleText(page)
    if (persistedOnToggleText !== '播放线跟踪：开') {
      throw new Error(`Expected playhead follow toggle to persist as on after reload, but got "${persistedOnToggleText}".`)
    }

    await preparePlaybackFixture(page)

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
    const initialPlayheadDomGeometry = await getPlayheadDomGeometry(page)
    if (!isPlayheadVisible(initialPlayheadDomGeometry)) {
      throw new Error('Initial playhead is not visible inside the scroll viewport.')
    }
    const initialDebugSnapshot = await getPlayheadDebugViewportSnapshot(page)
    const initialDebugLogRows = await getPlayheadDebugLogRows(page)
    if (!initialDebugSnapshot) {
      throw new Error('Initial playhead debug snapshot is missing.')
    }
    if (initialDebugLogRows.length < 1) {
      throw new Error('Expected at least one initial playhead debug log row.')
    }
    const initialDebugKeys = Object.keys(initialDebugSnapshot).sort().join(',')
    if (initialDebugKeys !== 'containerLeftX,containerRightX,distanceToRightEdge,playheadX,seq') {
      throw new Error(`Unexpected initial playhead debug snapshot shape: ${initialDebugKeys}`)
    }
    if (Math.abs(initialDebugSnapshot.containerLeftX - initialPlayheadDomGeometry.containerLeftX) > 0.2) {
      throw new Error(
        `Initial debug container left edge mismatch: log=${initialDebugSnapshot.containerLeftX} dom=${initialPlayheadDomGeometry.containerLeftX}`,
      )
    }
    if (Math.abs(initialDebugSnapshot.containerRightX - initialPlayheadDomGeometry.containerRightX) > 1) {
      throw new Error(
        `Initial debug container right edge mismatch: log=${initialDebugSnapshot.containerRightX} dom=${initialPlayheadDomGeometry.containerRightX}`,
      )
    }
    if (initialDebugSnapshot.playheadX === null || initialPlayheadDomGeometry.playheadX === null) {
      throw new Error('Initial playhead DOM geometry is missing.')
    }
    if (Math.abs(initialDebugSnapshot.playheadX - initialPlayheadDomGeometry.playheadX) > 1.5) {
      throw new Error(
        `Initial debug playhead X mismatch: log=${initialDebugSnapshot.playheadX} dom=${initialPlayheadDomGeometry.playheadX}`,
      )
    }
    await page.evaluate(() => {
      const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLDivElement | null
      if (!scrollHost) {
        throw new Error('Score scroll host not found for idle scroll test.')
      }
      const maxScrollLeft = Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth)
      scrollHost.scrollTo({ left: Math.min(140, maxScrollLeft), behavior: 'auto' })
    })
    await page.waitForTimeout(150)
    const idleScrolledDebugLogRows = await getPlayheadDebugLogRows(page)
    if (idleScrolledDebugLogRows.length !== initialDebugLogRows.length) {
      throw new Error('Playhead debug log changed during idle manual scrolling; expected idle logs to stay frozen.')
    }
    await page.evaluate(() => {
      const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLDivElement | null
      if (!scrollHost) {
        throw new Error('Score scroll host not found when resetting idle scroll.')
      }
      scrollHost.scrollTo({ left: 0, behavior: 'auto' })
    })
    await page.waitForTimeout(150)
    const idleResetDebugLogRows = await getPlayheadDebugLogRows(page)
    if (idleResetDebugLogRows.length !== initialDebugLogRows.length) {
      throw new Error('Playhead debug log changed while resetting idle scroll; expected idle logs to stay frozen.')
    }
    await page.evaluate(() => {
      const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLDivElement | null
      if (!scrollHost) {
        throw new Error('Score scroll host not found for pre-playback offscreen test.')
      }
      const maxScrollLeft = Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth)
      scrollHost.scrollTo({ left: maxScrollLeft, behavior: 'auto' })
    })
    await page.waitForTimeout(150)
    const prePlaybackOffscreenGeometry = await getPlayheadDomGeometry(page)
    if (
      prePlaybackOffscreenGeometry.playheadRightX === null ||
      prePlaybackOffscreenGeometry.playheadRightX > -1
    ) {
      throw new Error(
        `Expected the playhead to be offscreen to the left before playback recovery, but got playheadRightX=${prePlaybackOffscreenGeometry.playheadRightX}.`,
      )
    }

    const { playingState, pointSamples } = await runPlaybackAndCollectPointSamples(page, timelinePoints.length)
    if (playingState.status !== 'playing' || playingState.color !== 'yellow') {
      throw new Error(`Playhead did not switch to yellow playing state: ${playingState.status}/${playingState.color}`)
    }

    const finalState = await getPlaybackCursorState(page)
    const finalScroll = await getScrollSnapshot(page)
    const finalPlayheadDomGeometry = await getPlayheadDomGeometry(page)
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
    if (!isPlayheadVisible(finalPlayheadDomGeometry)) {
      throw new Error('Final playhead is not visible inside the scroll viewport.')
    }
    if (pointSamples.length !== timelinePoints.length) {
      throw new Error(`Playback point sample count mismatch: expected=${timelinePoints.length} actual=${pointSamples.length}`)
    }

    const sampledEventPointKeys = pointSamples.map((sample) => pointKey(sample.eventPoint))
    if (sampledEventPointKeys.join('|') !== expectedPointKeys.join('|')) {
      throw new Error(
        `Playback point samples lost ordering.\nexpected=${expectedPointKeys.join(',')}\nactual=${sampledEventPointKeys.join(',')}`,
      )
    }

    const mismatchedPointSample = pointSamples.find((sample) => pointKey(sample.eventPoint) !== pointKey(sample.statePoint))
    if (mismatchedPointSample) {
      throw new Error(
        `Point sample desynced from current playhead state: event=${pointKey(mismatchedPointSample.eventPoint)} state=${pointKey(mismatchedPointSample.statePoint)}`,
      )
    }
    const negativeViewportSample = pointSamples.find((sample) => sample.viewportX !== null && sample.viewportX < -1)
    if (negativeViewportSample) {
      throw new Error(
        `Playback sample is still offscreen to the left after recovery: point=${pointKey(negativeViewportSample.eventPoint)} viewportX=${negativeViewportSample.viewportX.toFixed(2)}`,
      )
    }

    const maxScrollLeft = Math.max(0, finalScroll.scrollWidth - finalScroll.clientWidth)
    const horizontalJumpSamples: PlaybackPointSample[] = []
    let previousSampleScrollLeft = initialScroll.scrollLeft
    let hasStablePointSegment = false
    pointSamples.forEach((sample) => {
      if (Math.abs(sample.scrollLeft - previousSampleScrollLeft) > 1) {
        horizontalJumpSamples.push(sample)
      } else {
        hasStablePointSegment = true
      }
      previousSampleScrollLeft = sample.scrollLeft
    })

    if (!hasStablePointSegment) {
      throw new Error('Auto-scroll still changes the viewport on every playback point; expected long stable segments between jumps.')
    }
    if (horizontalJumpSamples.length < 1) {
      throw new Error(`Expected at least 1 horizontal jump during playback, but only saw ${horizontalJumpSamples.length}.`)
    }
    if (horizontalJumpSamples.length > Math.ceil(pointSamples.length / 4)) {
      throw new Error(
        `Horizontal auto-scroll changed too often: jumps=${horizontalJumpSamples.length}, points=${pointSamples.length}.`,
      )
    }

    const leftAnchorTolerancePx = 10
    const triggerMarginTolerancePx = 10
    const pageJumpSamples = horizontalJumpSamples.filter((sample) => {
      return sample.viewportX !== null && Math.abs(sample.viewportX - PLAYHEAD_TEST_LEFT_ANCHOR_PX) <= leftAnchorTolerancePx
    })
    const tailRightAlignedJumpSamples = horizontalJumpSamples.filter((sample) => {
      return Math.abs(sample.scrollLeft - maxScrollLeft) <= 1
    })

    if (pageJumpSamples.length < 1) {
      throw new Error('Expected at least one page-style jump back to the left anchor.')
    }

    pageJumpSamples.forEach((sample) => {
      const sampleIndex = pointSamples.indexOf(sample)
      const previousSample = sampleIndex > 0 ? pointSamples[sampleIndex - 1] : null
      if (sample.viewportX === null) {
        throw new Error(`Jump sample is missing playhead viewport coordinates at ${pointKey(sample.eventPoint)}.`)
      }
      if (Math.abs(sample.viewportX - PLAYHEAD_TEST_LEFT_ANCHOR_PX) > leftAnchorTolerancePx) {
        throw new Error(
          `Playhead did not jump back to the left anchor after scrolling: point=${pointKey(sample.eventPoint)} viewportX=${sample.viewportX.toFixed(2)}`,
        )
      }
      if (previousSample && previousSample.scrollLeft < sample.scrollLeft) {
        const scrollDelta = sample.scrollLeft - previousSample.scrollLeft
        const preJumpViewportX = sample.viewportX + scrollDelta
        const preJumpRightGap = initialScroll.clientWidth - (preJumpViewportX + PLAYHEAD_TEST_WIDTH_PX)
        if (preJumpRightGap > PLAYHEAD_TEST_TRIGGER_MARGIN_PX + triggerMarginTolerancePx) {
          throw new Error(
            `Horizontal jump fired too early: point=${pointKey(sample.eventPoint)} gap=${preJumpRightGap.toFixed(2)} expected<=${PLAYHEAD_TEST_TRIGGER_MARGIN_PX + triggerMarginTolerancePx}`,
          )
        }
      }
    })

    if (tailRightAlignedJumpSamples.length < 1) {
      throw new Error('Expected at least one tail right-alignment jump, but none was detected.')
    }
    if (tailRightAlignedJumpSamples.length > 1) {
      throw new Error(`Expected at most one tail right-alignment jump, but saw ${tailRightAlignedJumpSamples.length}.`)
    }
    if (pageJumpSamples.length + tailRightAlignedJumpSamples.length !== horizontalJumpSamples.length) {
      throw new Error('Detected a horizontal scroll change that is neither a page jump nor a tail right-alignment jump.')
    }

    const tailRightAlignSample = tailRightAlignedJumpSamples[0]
    if (!tailRightAlignSample) {
      throw new Error('Missing tail right-alignment sample.')
    }
    const tailRightAlignSampleIndex = pointSamples.indexOf(tailRightAlignSample)
    if (tailRightAlignSampleIndex <= 0) {
      throw new Error('Tail right-alignment happened without a previous playback sample to compare against.')
    }
    const previousTailSample = pointSamples[tailRightAlignSampleIndex - 1]
    if (!previousTailSample) {
      throw new Error('Missing playback sample immediately before tail right-alignment.')
    }
    if (tailRightAlignSample.viewportX === null) {
      throw new Error(`Tail right-alignment sample is missing viewport coordinates at ${pointKey(tailRightAlignSample.eventPoint)}.`)
    }
    const tailScrollDelta = tailRightAlignSample.scrollLeft - previousTailSample.scrollLeft
    if (tailScrollDelta <= 1) {
      throw new Error(`Tail right-alignment did not advance scrollLeft: delta=${tailScrollDelta.toFixed(2)}`)
    }
    const preTailJumpViewportX = tailRightAlignSample.viewportX + tailScrollDelta
    const preTailJumpRightGap = finalScroll.clientWidth - (preTailJumpViewportX + PLAYHEAD_TEST_WIDTH_PX)
    if (preTailJumpRightGap > PLAYHEAD_TEST_TRIGGER_MARGIN_PX + triggerMarginTolerancePx) {
      throw new Error(
        `Tail right-alignment fired too early: point=${pointKey(tailRightAlignSample.eventPoint)} gap=${preTailJumpRightGap.toFixed(2)} expected<=${PLAYHEAD_TEST_TRIGGER_MARGIN_PX + triggerMarginTolerancePx}`,
      )
    }
    const tailAbsoluteX = tailRightAlignSample.viewportX + tailRightAlignSample.scrollLeft
    const tailTargetScrollLeft = Math.max(0, tailAbsoluteX - PLAYHEAD_TEST_LEFT_ANCHOR_PX)
    if (tailTargetScrollLeft <= maxScrollLeft + 1) {
      throw new Error(
        `Tail right-alignment sample was not actually beyond the left-anchor placement range: target=${tailTargetScrollLeft.toFixed(2)} max=${maxScrollLeft.toFixed(2)}`,
      )
    }

    const tailPlaybackSamples = pointSamples.slice(tailRightAlignSampleIndex)
    tailPlaybackSamples.forEach((sample) => {
      if (sample.viewportX === null) {
        throw new Error(`Tail playback sample is missing playhead viewport coordinates at ${pointKey(sample.eventPoint)}.`)
      }
      if (sample.viewportX < -1 || sample.viewportX + PLAYHEAD_TEST_WIDTH_PX > finalScroll.clientWidth + 1) {
        throw new Error(
          `Tail playback sample is not fully visible: point=${pointKey(sample.eventPoint)} viewportX=${sample.viewportX.toFixed(2)}`,
        )
      }
    })

    if (Math.abs(tailRightAlignSample.scrollLeft - maxScrollLeft) > 1) {
      throw new Error(
        `Tail jump did not align all the way to maxScrollLeft: point=${pointKey(tailRightAlignSample.eventPoint)} scrollLeft=${tailRightAlignSample.scrollLeft} maxScrollLeft=${maxScrollLeft}`,
      )
    }
    tailPlaybackSamples.forEach((sample) => {
      if (Math.abs(sample.scrollLeft - maxScrollLeft) > 1) {
        throw new Error(
          `Tail playback moved away from maxScrollLeft after right alignment: point=${pointKey(sample.eventPoint)} scrollLeft=${sample.scrollLeft} maxScrollLeft=${maxScrollLeft}`,
        )
      }
    })

    await page.waitForTimeout(250)
    const settledState = await getPlaybackCursorState(page)
    if (pointKey(settledState.point) !== pointKey(finalState.point) || rectKey(settledState.rectPx) !== rectKey(finalState.rectPx)) {
      throw new Error('Playhead moved after playback finished; it should stay on the final point.')
    }
    const finalDebugSnapshot = await getPlayheadDebugViewportSnapshot(page)
    const playheadDebugLogRows = await getPlayheadDebugLogRows(page)
    if (!finalDebugSnapshot) {
      throw new Error('Final playhead debug snapshot is missing.')
    }
    if (playheadDebugLogRows.length <= initialDebugLogRows.length) {
      throw new Error('Playhead debug log did not grow during playback.')
    }

    const debugLogHasUnexpectedShape = playheadDebugLogRows.find((row) => {
      const keys = Object.keys(row).sort().join(',')
      return keys !== 'containerLeftX,containerRightX,distanceToRightEdge,playheadX,seq'
    })
    if (debugLogHasUnexpectedShape) {
      throw new Error(
        `Playhead debug log row contains unexpected keys at row #${debugLogHasUnexpectedShape.seq}.`,
      )
    }

    const inconsistentContainerEdgeRow = playheadDebugLogRows.find((row) => {
      return Math.abs(row.containerLeftX) > 0.2 || Math.abs(row.containerRightX - finalScroll.clientWidth) > 1
    })
    if (inconsistentContainerEdgeRow) {
      throw new Error(
        `Debug container edges are not fixed at row #${inconsistentContainerEdgeRow.seq}: left=${inconsistentContainerEdgeRow.containerLeftX} right=${inconsistentContainerEdgeRow.containerRightX}`,
      )
    }

    const inconsistentDistanceRow = playheadDebugLogRows.find((row) => {
      if (row.playheadX === null || row.distanceToRightEdge === null) {
        return false
      }
      return Math.abs(row.distanceToRightEdge - (row.containerRightX - row.playheadX)) > 0.2
    })
    if (inconsistentDistanceRow) {
      throw new Error(
        `Debug distance-to-right-edge mismatch at row #${inconsistentDistanceRow.seq}: playheadX=${inconsistentDistanceRow.playheadX} rightX=${inconsistentDistanceRow.containerRightX} distance=${inconsistentDistanceRow.distanceToRightEdge}`,
      )
    }

    if (Math.abs(finalDebugSnapshot.containerLeftX - finalPlayheadDomGeometry.containerLeftX) > 0.2) {
      throw new Error(
        `Final debug container left edge mismatch: log=${finalDebugSnapshot.containerLeftX} dom=${finalPlayheadDomGeometry.containerLeftX}`,
      )
    }
    if (Math.abs(finalDebugSnapshot.containerRightX - finalPlayheadDomGeometry.containerRightX) > 1) {
      throw new Error(
        `Final debug container right edge mismatch: log=${finalDebugSnapshot.containerRightX} dom=${finalPlayheadDomGeometry.containerRightX}`,
      )
    }
    if (finalDebugSnapshot.playheadX === null || finalPlayheadDomGeometry.playheadX === null) {
      throw new Error('Final playhead DOM geometry is missing.')
    }
    if (Math.abs(finalDebugSnapshot.playheadX - finalPlayheadDomGeometry.playheadX) > 1.5) {
      throw new Error(
        `Final debug playhead X mismatch: log=${finalDebugSnapshot.playheadX} dom=${finalPlayheadDomGeometry.playheadX}`,
      )
    }

    const logTextareaValue = await page.locator('textarea[aria-label="播放线位置日志"]').inputValue()
    if (
      !logTextareaValue.includes('播放线X：') ||
      !logTextareaValue.includes('容器左边缘X：') ||
      !logTextareaValue.includes('容器右边缘X：') ||
      !logTextareaValue.includes('距右边缘：')
    ) {
      throw new Error('Simplified playhead log text is missing one or more required Chinese labels.')
    }
    if (
      logTextareaValue.includes('session=') ||
      logTextareaValue.includes('scrollLeft=') ||
      logTextareaValue.includes('playheadStage=') ||
      logTextareaValue.includes('canvasViewport=')
    ) {
      throw new Error('Simplified playhead log text still contains old verbose debug fields.')
    }

    const report = {
      generatedAt: new Date().toISOString(),
      initialState,
      playingState,
      finalState,
      settledState,
      initialScroll,
      prePlaybackOffscreenGeometry,
      finalScroll,
      initialDebugSnapshot,
      initialPlayheadDomGeometry,
      finalDebugSnapshot,
      finalPlayheadDomGeometry,
      tailRightAlignSample,
      pointSamples,
      horizontalJumpSamples,
      pageJumpSamples,
      tailRightAlignedJumpSamples,
      playheadDebugLogRows,
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
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    await stopDevServer(devServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
