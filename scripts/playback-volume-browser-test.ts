import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'

type PlaybackVolumeConfig = {
  trebleVolumePercent: number
  bassVolumePercent: number
}

type PlaybackTimelineTarget = {
  staff: 'treble' | 'bass'
  baseVelocity: number
  resolvedVelocity: number
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4179
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const EPSILON = 0.0001

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
      typeof api.getPlaybackVolumeConfig === 'function' &&
      typeof api.getPlaybackTimelineTargets === 'function'
    )
  })
}

async function getPlaybackVolumeConfig(page: Page): Promise<PlaybackVolumeConfig> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPlaybackVolumeConfig: () => PlaybackVolumeConfig
      }
    }).__scoreDebug
    return api.getPlaybackVolumeConfig()
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

function assertClose(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > EPSILON) {
    throw new Error(`${label} mismatch. expected=${expected} actual=${actual}`)
  }
}

function assertPlaybackVelocities(params: {
  targets: PlaybackTimelineTarget[]
  treblePercent: number
  bassPercent: number
}): void {
  const { targets, treblePercent, bassPercent } = params
  const firstTrebleTarget = targets.find((target) => target.staff === 'treble') ?? null
  const firstBassTarget = targets.find((target) => target.staff === 'bass') ?? null

  if (!firstTrebleTarget || !firstBassTarget) {
    throw new Error('Expected both treble and bass playback targets in the default score.')
  }

  const expectedTrebleVelocity = Math.max(0, Math.min(1, firstTrebleTarget.baseVelocity * (treblePercent / 100)))
  const expectedBassVelocity = Math.max(0, Math.min(1, firstBassTarget.baseVelocity * (bassPercent / 100)))

  assertClose(firstTrebleTarget.resolvedVelocity, expectedTrebleVelocity, 'treble resolvedVelocity')
  assertClose(firstBassTarget.resolvedVelocity, expectedBassVelocity, 'bass resolvedVelocity')
}

async function openPlaybackVolumeModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: '音量调节' }).click()
  await page.getByRole('dialog', { name: '播放音量调节' }).waitFor()
}

async function closePlaybackVolumeModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: '关闭音量调节窗口' }).click()
  await page.getByRole('dialog', { name: '播放音量调节' }).waitFor({ state: 'hidden' })
}

async function setPlaybackVolumes(page: Page, treblePercent: number, bassPercent: number): Promise<void> {
  await page.getByLabel('上谱表音量数值').fill(String(treblePercent))
  await page.getByLabel('下谱表音量数值').fill(String(bassPercent))
  const trebleSliderValue = await page.getByLabel('上谱表音量滑块').inputValue()
  const bassSliderValue = await page.getByLabel('下谱表音量滑块').inputValue()
  if (trebleSliderValue !== String(treblePercent) || bassSliderValue !== String(bassPercent)) {
    throw new Error(
      `Expected slider values ${treblePercent}/${bassPercent}, got ${trebleSliderValue}/${bassSliderValue}.`,
    )
  }
}

async function assertPlaybackVolumeConfig(
  page: Page,
  expectedTreblePercent: number,
  expectedBassPercent: number,
): Promise<void> {
  await page.waitForFunction(
    ({ treble, bass }) => {
      const api = (window as unknown as {
        __scoreDebug?: {
          getPlaybackVolumeConfig: () => PlaybackVolumeConfig
        }
      }).__scoreDebug
      if (!api || typeof api.getPlaybackVolumeConfig !== 'function') return false
      const config = api.getPlaybackVolumeConfig()
      return config.trebleVolumePercent === treble && config.bassVolumePercent === bass
    },
    { treble: expectedTreblePercent, bass: expectedBassPercent },
  )
  const config = await getPlaybackVolumeConfig(page)
  if (
    config.trebleVolumePercent !== expectedTreblePercent ||
    config.bassVolumePercent !== expectedBassPercent
  ) {
    throw new Error(
      `Unexpected playback volume config. expected=${expectedTreblePercent}/${expectedBassPercent} actual=${config.trebleVolumePercent}/${config.bassVolumePercent}.`,
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

    await assertPlaybackVolumeConfig(page, 100, 100)
    assertPlaybackVelocities({
      targets: await getPlaybackTimelineTargets(page),
      treblePercent: 100,
      bassPercent: 100,
    })

    await openPlaybackVolumeModal(page)
    await setPlaybackVolumes(page, 50, 150)
    await closePlaybackVolumeModal(page)
    await assertPlaybackVolumeConfig(page, 50, 150)
    assertPlaybackVelocities({
      targets: await getPlaybackTimelineTargets(page),
      treblePercent: 50,
      bassPercent: 150,
    })

    await openPlaybackVolumeModal(page)
    await setPlaybackVolumes(page, 0, 150)
    await closePlaybackVolumeModal(page)
    await assertPlaybackVolumeConfig(page, 0, 150)
    assertPlaybackVelocities({
      targets: await getPlaybackTimelineTargets(page),
      treblePercent: 0,
      bassPercent: 150,
    })

    await openPlaybackVolumeModal(page)
    await page.getByRole('button', { name: '恢复默认' }).click()
    await assertPlaybackVolumeConfig(page, 100, 100)
    await closePlaybackVolumeModal(page)
    assertPlaybackVelocities({
      targets: await getPlaybackTimelineTargets(page),
      treblePercent: 100,
      bassPercent: 100,
    })

    await openPlaybackVolumeModal(page)
    await setPlaybackVolumes(page, 35, 120)
    await closePlaybackVolumeModal(page)
    await assertPlaybackVolumeConfig(page, 35, 120)

    await page.reload({ waitUntil: 'networkidle' })
    await waitForDebugApi(page)
    await assertPlaybackVolumeConfig(page, 35, 120)

    await openPlaybackVolumeModal(page)
    const trebleInputValue = await page.getByLabel('上谱表音量数值').inputValue()
    const bassInputValue = await page.getByLabel('下谱表音量数值').inputValue()
    if (trebleInputValue !== '35' || bassInputValue !== '120') {
      throw new Error(`Expected persisted modal values 35/120, got ${trebleInputValue}/${bassInputValue}.`)
    }
    await page.getByRole('button', { name: '恢复默认' }).click()
    await closePlaybackVolumeModal(page)
    await assertPlaybackVolumeConfig(page, 100, 100)

    console.table((await getPlaybackTimelineTargets(page))
      .filter((target, index) => index < 4)
      .map((target) => ({
        staff: target.staff,
        baseVelocity: target.baseVelocity,
        resolvedVelocity: target.resolvedVelocity,
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
