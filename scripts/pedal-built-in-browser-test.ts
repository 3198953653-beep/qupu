import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'

type PedalRenderPlanRow = {
  span: {
    id: string
    style: 'text' | 'bracket' | 'mixed'
    staff: 'bass'
    startPairIndex: number
    startTick: number
    endPairIndex: number
    endTick: number
  }
  baseStartX: number
  baseEndX: number
  startX: number
  endX: number
  occupiedStartX: number
  occupiedEndX: number
  baseBaselineY: number
  baselineY: number
  laneIndex: number
  requiredStartX: number | null
  requiredEndX: number | null
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4176
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const PEDAL_GAP_EPSILON_PX = 0.4

const DEMO_CASES = [
  { key: 'reset-default', buttonLabel: '重置' },
  { key: 'whole-note', buttonLabel: '加载全音符示例' },
  { key: 'half-note', buttonLabel: '加载二分音符示例' },
  { key: 'quarter', buttonLabel: '四分脉冲' },
  { key: 'two-eighth', buttonLabel: '双八分型' },
  { key: 'four-sixteenth', buttonLabel: '四连十六分型' },
  { key: 'eight-sixteenth', buttonLabel: '8-16-16 组合' },
  { key: 'short-dotted', buttonLabel: '短附点型' },
] as const

const PEDAL_STYLES = ['text', 'bracket', 'mixed'] as const

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
    await sleep(300)
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
      return
    }
    server.kill('SIGTERM')
    setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL')
    }, 2500)
  })
}

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
    return !!api && typeof api.getPedalRenderPlan === 'function' && typeof api.getChordRulerMarkers === 'function'
  })
}

async function clickButton(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label }).first()
  await button.waitFor()
  await button.evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
}

async function openPedalModal(page: Page): Promise<void> {
  await clickButton(page, '添加踏板')
  await page.getByRole('dialog', { name: '添加踏板' }).waitFor()
}

async function applyPedalStyle(page: Page, style: typeof PEDAL_STYLES[number], overwriteExisting: boolean): Promise<void> {
  if (overwriteExisting) {
    page.once('dialog', (dialog) => {
      void dialog.accept()
    })
  }
  await clickButton(page, style.toUpperCase())
  await page.getByRole('dialog', { name: '添加踏板' }).waitFor({ state: 'hidden' })
}

async function getPedalRenderPlan(page: Page): Promise<PedalRenderPlanRow[]> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPedalRenderPlan: () => PedalRenderPlanRow[]
      }
    }).__scoreDebug
    return api.getPedalRenderPlan()
  })
}

async function waitForPedalPlan(page: Page): Promise<PedalRenderPlanRow[]> {
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPedalRenderPlan: () => PedalRenderPlanRow[]
      }
    }).__scoreDebug
    return api.getPedalRenderPlan().length > 0
  })
  return getPedalRenderPlan(page)
}

function assertCoverage(plan: PedalRenderPlanRow[], contextLabel: string): void {
  plan.forEach((entry) => {
    if (entry.requiredStartX !== null && entry.startX > entry.requiredStartX + PEDAL_GAP_EPSILON_PX) {
      throw new Error(
        `${contextLabel}: pedal ${entry.span.id} starts too late. startX=${entry.startX.toFixed(3)} requiredStartX=${entry.requiredStartX.toFixed(3)}.`,
      )
    }
    if (entry.requiredEndX !== null && entry.endX < entry.requiredEndX - PEDAL_GAP_EPSILON_PX) {
      throw new Error(
        `${contextLabel}: pedal ${entry.span.id} ends too early. endX=${entry.endX.toFixed(3)} requiredEndX=${entry.requiredEndX.toFixed(3)}.`,
      )
    }
  })
}

function assertNoLaneOverlap(plan: PedalRenderPlanRow[], contextLabel: string): void {
  const groups = new Map<string, PedalRenderPlanRow[]>()
  plan.forEach((entry) => {
    const key = `${entry.baseBaselineY.toFixed(2)}|${entry.laneIndex}`
    const existing = groups.get(key)
    if (existing) {
      existing.push(entry)
      return
    }
    groups.set(key, [entry])
  })

  groups.forEach((rows, laneKey) => {
    const ordered = [...rows].sort((left, right) => left.occupiedStartX - right.occupiedStartX)
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]
      const current = ordered[index]
      if (current.occupiedStartX < previous.occupiedEndX + 4 - PEDAL_GAP_EPSILON_PX) {
        throw new Error(
          `${contextLabel}: lane overlap in ${laneKey}. prev=${previous.span.id} [${previous.occupiedStartX.toFixed(3)}, ${previous.occupiedEndX.toFixed(3)}] current=${current.span.id} [${current.occupiedStartX.toFixed(3)}, ${current.occupiedEndX.toFixed(3)}].`,
        )
      }
    }
  })
}

async function runCase(page: Page, params: {
  buttonLabel: string
  demoKey: string
  style: typeof PEDAL_STYLES[number]
  overwriteExisting: boolean
}): Promise<{
  demoKey: string
  style: typeof PEDAL_STYLES[number]
  spanCount: number
  laneCount: number
}> {
  const { buttonLabel, demoKey, style, overwriteExisting } = params
  await clickButton(page, buttonLabel)
  await page.waitForFunction(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getPedalRenderPlan: () => PedalRenderPlanRow[]
      }
    }).__scoreDebug
    return api.getPedalRenderPlan().length === 0
  })
  await openPedalModal(page)
  await applyPedalStyle(page, style, overwriteExisting)
  const plan = await waitForPedalPlan(page)
  const contextLabel = `${demoKey}/${style}`
  assertCoverage(plan, contextLabel)
  assertNoLaneOverlap(plan, contextLabel)
  return {
    demoKey,
    style,
    spanCount: plan.length,
    laneCount: Math.max(0, ...plan.map((entry) => entry.laneIndex + 1)),
  }
}

async function main(): Promise<void> {
  const devServer = startDevServer()
  let browser: Browser | null = null
  try {
    await waitForServer(DEV_URL, 30_000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1720, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'networkidle' })
    await waitForDebugApi(page)

    const results: Array<{
      demoKey: string
      style: typeof PEDAL_STYLES[number]
      spanCount: number
      laneCount: number
    }> = []

    for (const demoCase of DEMO_CASES) {
      let overwriteExisting = false
      for (const style of PEDAL_STYLES) {
        const result = await runCase(page, {
          buttonLabel: demoCase.buttonLabel,
          demoKey: demoCase.key,
          style,
          overwriteExisting,
        })
        overwriteExisting = true
        results.push(result)
      }
    }

    console.table(results)
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
