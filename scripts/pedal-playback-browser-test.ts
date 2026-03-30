import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type PlaybackTimelinePoint = {
  pairIndex: number
  onsetTick: number
  absoluteTick: number
  atSeconds: number
  targetCount: number
  extendedTargetCount: number
  latestReleaseAbsoluteTick: number
  latestReleaseAtSeconds: number
}

type PlaybackTimelineTarget = {
  pairIndex: number
  onsetTick: number
  absoluteTick: number
  atSeconds: number
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: string
  baseDurationTicks: number
  playbackDurationTicks: number
  durationSeconds: number
  releaseAbsoluteTick: number
  releaseAtSeconds: number
  pedalExtended: boolean
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4178
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`

const PEDAL_PLAYBACK_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
      <direction placement="below">
        <direction-type>
          <pedal type="start" line="yes" sign="yes"/>
        </direction-type>
        <staff>2</staff>
      </direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <direction placement="below">
        <direction-type>
          <pedal type="stop" line="yes" sign="yes"/>
        </direction-type>
        <staff>2</staff>
      </direction>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <direction placement="below">
        <direction-type>
          <pedal type="start" line="yes" sign="yes"/>
        </direction-type>
        <staff>2</staff>
      </direction>
      <note><pitch><step>B</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>

      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>6</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>6</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <direction placement="below">
        <direction-type>
          <pedal type="stop" line="yes" sign="yes"/>
        </direction-type>
        <staff>2</staff>
      </direction>
      <note><pitch><step>F</step><octave>6</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>6</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>6</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>B</step><octave>6</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>7</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>7</octave></pitch><duration>2</duration><type>eighth</type><staff>1</staff></note>

      <note><pitch><step>D</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type><staff>2</staff></note>
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
    server.stdout?.destroy()
    server.stderr?.destroy()
    server.once('exit', () => resolve())
    if (process.platform === 'win32' && server.pid) {
      const killer = spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.unref()
      server.unref()
      setTimeout(() => resolve(), 1000)
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
    await sleep(300)
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
      typeof api.getPlaybackTimelinePoints === 'function' &&
      typeof api.getPlaybackTimelineTargets === 'function'
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
}

async function waitForImportSuccess(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug?: {
        getImportFeedback: () => ImportFeedback
      }
    }).__scoreDebug
    if (!api || typeof api.getImportFeedback !== 'function') return false
    const feedback = api.getImportFeedback()
    return feedback.kind === 'success'
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

async function getPlaybackTimelineTargets(page: Page): Promise<PlaybackTimelineTarget[]> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlaybackTimelineTargets: () => PlaybackTimelineTarget[]
      }
    }).__scoreDebug
    return api.getPlaybackTimelineTargets()
  })
}

function getTargetsAtOnset(
  targets: PlaybackTimelineTarget[],
  pairIndex: number,
  onsetTick: number,
): PlaybackTimelineTarget[] {
  return targets.filter((target) => target.pairIndex === pairIndex && target.onsetTick === onsetTick)
}

function assertOnset(
  targets: PlaybackTimelineTarget[],
  points: PlaybackTimelinePoint[],
  params: {
    pairIndex: number
    onsetTick: number
    expectedReleaseAbsoluteTick: number
    expectedPlaybackDurationTicks: number
    expectedExtended: boolean
    expectedTargetCount?: number
  },
): void {
  const {
    pairIndex,
    onsetTick,
    expectedReleaseAbsoluteTick,
    expectedPlaybackDurationTicks,
    expectedExtended,
    expectedTargetCount = 2,
  } = params
  const onsetTargets = getTargetsAtOnset(targets, pairIndex, onsetTick)
  if (onsetTargets.length !== expectedTargetCount) {
    throw new Error(
      `Expected ${expectedTargetCount} playback targets at ${pairIndex}:${onsetTick}, got ${onsetTargets.length}.`,
    )
  }
  onsetTargets.forEach((target) => {
    if (target.releaseAbsoluteTick !== expectedReleaseAbsoluteTick) {
      throw new Error(
        `Unexpected releaseAbsoluteTick for ${pairIndex}:${onsetTick}/${target.staff}. expected=${expectedReleaseAbsoluteTick} actual=${target.releaseAbsoluteTick}.`,
      )
    }
    if (target.playbackDurationTicks !== expectedPlaybackDurationTicks) {
      throw new Error(
        `Unexpected playbackDurationTicks for ${pairIndex}:${onsetTick}/${target.staff}. expected=${expectedPlaybackDurationTicks} actual=${target.playbackDurationTicks}.`,
      )
    }
    if (target.pedalExtended !== expectedExtended) {
      throw new Error(
        `Unexpected pedalExtended for ${pairIndex}:${onsetTick}/${target.staff}. expected=${expectedExtended} actual=${target.pedalExtended}.`,
      )
    }
  })

  const point = points.find((entry) => entry.pairIndex === pairIndex && entry.onsetTick === onsetTick) ?? null
  if (!point) {
    throw new Error(`Missing playback timeline point at ${pairIndex}:${onsetTick}.`)
  }
  const expectedExtendedCount = expectedExtended ? expectedTargetCount : 0
  if (point.extendedTargetCount !== expectedExtendedCount) {
    throw new Error(
      `Unexpected extendedTargetCount for ${pairIndex}:${onsetTick}. expected=${expectedExtendedCount} actual=${point.extendedTargetCount}.`,
    )
  }
  if (point.latestReleaseAbsoluteTick !== expectedReleaseAbsoluteTick) {
    throw new Error(
      `Unexpected latestReleaseAbsoluteTick for ${pairIndex}:${onsetTick}. expected=${expectedReleaseAbsoluteTick} actual=${point.latestReleaseAbsoluteTick}.`,
    )
  }
}

async function main(): Promise<void> {
  const devServer = startDevServer()
  let browser: Browser | null = null
  try {
    await waitForServer(DEV_URL, 30_000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'networkidle' })
    await waitForDebugApi(page)
    await importMusicXml(page, PEDAL_PLAYBACK_FIXTURE_XML)
    await waitForImportSuccess(page)
    await page.waitForFunction(() => {
      const api = (window as unknown as {
        __scoreDebug?: {
          getPlaybackTimelineTargets: () => PlaybackTimelineTarget[]
        }
      }).__scoreDebug
      return Boolean(api && api.getPlaybackTimelineTargets().length >= 16)
    })

    const points = await getPlaybackTimelinePoints(page)
    const targets = await getPlaybackTimelineTargets(page)

    assertOnset(targets, points, {
      pairIndex: 0,
      onsetTick: 0,
      expectedReleaseAbsoluteTick: 32,
      expectedPlaybackDurationTicks: 32,
      expectedExtended: true,
    })
    assertOnset(targets, points, {
      pairIndex: 0,
      onsetTick: 24,
      expectedReleaseAbsoluteTick: 32,
      expectedPlaybackDurationTicks: 8,
      expectedExtended: false,
    })
    assertOnset(targets, points, {
      pairIndex: 0,
      onsetTick: 32,
      expectedReleaseAbsoluteTick: 40,
      expectedPlaybackDurationTicks: 8,
      expectedExtended: false,
    })
    assertOnset(targets, points, {
      pairIndex: 0,
      onsetTick: 48,
      expectedReleaseAbsoluteTick: 80,
      expectedPlaybackDurationTicks: 32,
      expectedExtended: true,
    })
    assertOnset(targets, points, {
      pairIndex: 1,
      onsetTick: 0,
      expectedReleaseAbsoluteTick: 80,
      expectedPlaybackDurationTicks: 16,
      expectedExtended: true,
    })
    assertOnset(targets, points, {
      pairIndex: 1,
      onsetTick: 8,
      expectedReleaseAbsoluteTick: 80,
      expectedPlaybackDurationTicks: 8,
      expectedExtended: false,
    })

    console.table(points.map((point) => ({
      pairIndex: point.pairIndex,
      onsetTick: point.onsetTick,
      targetCount: point.targetCount,
      extendedTargetCount: point.extendedTargetCount,
      latestReleaseAbsoluteTick: point.latestReleaseAbsoluteTick,
    })))
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
