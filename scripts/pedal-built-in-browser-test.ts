import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'

type PedalRenderPlanRow = {
  span: {
    id: string
    style: 'text' | 'bracket' | 'mixed'
    layoutMode: 'flexible' | 'uniform'
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
  layoutMode: 'flexible' | 'uniform'
  systemKey: string
  occupiedStartX: number
  occupiedEndX: number
  baseBaselineY: number
  baselineY: number
  pedalTopY: number
  collisionBottomY: number | null
  requiredBaselineY: number
  laneIndex: number
  requiredStartX: number | null
  requiredEndX: number | null
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4176
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const PEDAL_GAP_EPSILON_PX = 0.4
const PEDAL_BASELINE_EPSILON_PX = 0.2

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
const PEDAL_LAYOUT_MODES = ['flexible', 'uniform'] as const
const PEDAL_LAYOUT_MODE_LABELS: Record<(typeof PEDAL_LAYOUT_MODES)[number], string> = {
  flexible: '灵活',
  uniform: '统一',
}

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

async function selectPedalLayoutMode(page: Page, layoutMode: typeof PEDAL_LAYOUT_MODES[number]): Promise<void> {
  await clickButton(page, PEDAL_LAYOUT_MODE_LABELS[layoutMode])
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
    if (entry.requiredEndX !== null && entry.endX < entry.requiredEndX - PEDAL_GAP_EPSILON_PX) {
      throw new Error(
        `${contextLabel}: pedal ${entry.span.id} ends too early. endX=${entry.endX.toFixed(3)} requiredEndX=${entry.requiredEndX.toFixed(3)}.`,
      )
    }
    if (entry.collisionBottomY !== null && entry.pedalTopY < entry.collisionBottomY + 2 - PEDAL_GAP_EPSILON_PX) {
      throw new Error(
        `${contextLabel}: pedal ${entry.span.id} collides with bass glyphs. pedalTopY=${entry.pedalTopY.toFixed(3)} collisionBottomY=${entry.collisionBottomY.toFixed(3)} requiredBaselineY=${entry.requiredBaselineY.toFixed(3)} baselineY=${entry.baselineY.toFixed(3)}.`,
      )
    }
  })
}

function assertSingleBaseline(plan: PedalRenderPlanRow[], contextLabel: string): void {
  const groups = new Map<string, PedalRenderPlanRow[]>()
  plan.forEach((entry) => {
    if (entry.layoutMode !== 'uniform') return
    const key = entry.systemKey
    const existing = groups.get(key)
    if (existing) {
      existing.push(entry)
      return
    }
    groups.set(key, [entry])
  })

  groups.forEach((rows, baselineKey) => {
    rows.forEach((entry) => {
      if (entry.baselineY < entry.requiredBaselineY - PEDAL_BASELINE_EPSILON_PX) {
        throw new Error(
          `${contextLabel}: pedal ${entry.span.id} baseline is below the required avoidance baseline. baselineY=${entry.baselineY.toFixed(3)} requiredBaselineY=${entry.requiredBaselineY.toFixed(3)}.`,
        )
      }
      if (entry.laneIndex !== 0) {
        throw new Error(`${contextLabel}: pedal ${entry.span.id} unexpectedly used lane ${entry.laneIndex}.`)
      }
    })

    const referenceBaselineY = rows[0]?.baselineY ?? Number.NaN
    rows.forEach((entry) => {
      if (Math.abs(entry.baselineY - referenceBaselineY) > PEDAL_BASELINE_EPSILON_PX) {
        throw new Error(
          `${contextLabel}: baseline mismatch inside system ${baselineKey}. reference=${referenceBaselineY.toFixed(3)} current=${entry.baselineY.toFixed(3)}.`,
        )
      }
    })
  })
}

function assertFlexibleBaselines(plan: PedalRenderPlanRow[], contextLabel: string): void {
  plan.forEach((entry) => {
    if (entry.layoutMode !== 'flexible') return
    if (entry.baselineY < entry.requiredBaselineY - PEDAL_BASELINE_EPSILON_PX) {
      throw new Error(
        `${contextLabel}: flexible pedal ${entry.span.id} baseline is below the required avoidance baseline. baselineY=${entry.baselineY.toFixed(3)} requiredBaselineY=${entry.requiredBaselineY.toFixed(3)}.`,
      )
    }
    if (entry.laneIndex !== 0) {
      throw new Error(`${contextLabel}: flexible pedal ${entry.span.id} unexpectedly used lane ${entry.laneIndex}.`)
    }
  })
}

async function runCase(page: Page, params: {
  buttonLabel: string
  demoKey: string
  style: typeof PEDAL_STYLES[number]
  layoutMode: typeof PEDAL_LAYOUT_MODES[number]
  overwriteExisting: boolean
}): Promise<{
  demoKey: string
  style: typeof PEDAL_STYLES[number]
  layoutMode: typeof PEDAL_LAYOUT_MODES[number]
  spanCount: number
  baselineCount: number
}> {
  const { buttonLabel, demoKey, style, layoutMode, overwriteExisting } = params
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
  await selectPedalLayoutMode(page, layoutMode)
  await applyPedalStyle(page, style, overwriteExisting)
  const plan = await waitForPedalPlan(page)
  const contextLabel = `${demoKey}/${layoutMode}/${style}`
  assertCoverage(plan, contextLabel)
  assertFlexibleBaselines(plan, contextLabel)
  assertSingleBaseline(plan, contextLabel)
  return {
    demoKey,
    style,
    layoutMode,
    spanCount: plan.length,
    baselineCount: new Set(
      plan
        .filter((entry) => entry.layoutMode === 'uniform')
        .map((entry) => entry.systemKey),
    ).size,
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
      layoutMode: typeof PEDAL_LAYOUT_MODES[number]
      spanCount: number
      baselineCount: number
    }> = []

    for (const demoCase of DEMO_CASES) {
      for (const layoutMode of PEDAL_LAYOUT_MODES) {
        let overwriteExisting = false
        for (const style of PEDAL_STYLES) {
          const result = await runCase(page, {
            buttonLabel: demoCase.buttonLabel,
            demoKey: demoCase.key,
            style,
            layoutMode,
            overwriteExisting,
          })
          overwriteExisting = true
          results.push(result)
        }
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
