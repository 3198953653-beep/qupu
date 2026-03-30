import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page } from 'playwright'

type ActivePedalSelection = {
  pedalId: string
}

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
  hitLeftX: number
  hitRightX: number
  hitTopY: number
  hitBottomY: number
  isActive: boolean
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4182
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const PEDAL_STYLES = ['text', 'bracket', 'mixed'] as const

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
      typeof api.getPedalRenderPlan === 'function' &&
      typeof api.getActivePedalSelection === 'function'
    )
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

async function applyPedalStyle(
  page: Page,
  style: (typeof PEDAL_STYLES)[number],
  overwriteExisting: boolean,
): Promise<void> {
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

async function getActivePedalSelection(page: Page): Promise<ActivePedalSelection | null> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getActivePedalSelection: () => ActivePedalSelection | null
      }
    }).__scoreDebug
    return api.getActivePedalSelection()
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

async function clickPedalSpan(page: Page, row: PedalRenderPlanRow): Promise<void> {
  const targetPoint = await toClientPoint(
    page,
    (row.hitLeftX + row.hitRightX) / 2,
    (row.hitTopY + row.hitBottomY) / 2,
  )
  await page.mouse.move(targetPoint.x, targetPoint.y)
  await page.mouse.down()
  await page.mouse.up()
}

async function waitForActivePedalSelection(page: Page, pedalId: string | null): Promise<void> {
  await page.waitForFunction((targetPedalId) => {
    const api = (window as unknown as {
      __scoreDebug: {
        getActivePedalSelection: () => ActivePedalSelection | null
        getPedalRenderPlan: () => PedalRenderPlanRow[]
      }
    }).__scoreDebug
    const selection = api.getActivePedalSelection()
    const plan = api.getPedalRenderPlan()
    if (targetPedalId === null) {
      return selection === null && plan.every((entry) => entry.isActive === false)
    }
    return (
      selection?.pedalId === targetPedalId &&
      plan.some((entry) => entry.span.id === targetPedalId && entry.isActive === true)
    )
  }, pedalId)
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

    await clickButton(page, '重置')

    let overwriteExisting = false
    let lastTargetId: string | null = null
    let baselineIds: string[] = []

    for (const style of PEDAL_STYLES) {
      await openPedalModal(page)
      await applyPedalStyle(page, style, overwriteExisting)
      overwriteExisting = true

      const plan = await waitForPedalPlan(page)
      if (!plan.every((entry) => entry.span.style === style)) {
        throw new Error(`Expected all pedal spans to use style=${style}, got ${plan.map((entry) => entry.span.style).join(',')}.`)
      }
      const targetRow = plan[0]
      if (!targetRow) {
        throw new Error(`Missing pedal render plan row for style=${style}.`)
      }
      await clickPedalSpan(page, targetRow)
      await waitForActivePedalSelection(page, targetRow.span.id)

      const selection = await getActivePedalSelection(page)
      if (selection?.pedalId !== targetRow.span.id) {
        throw new Error(`Expected active pedal selection ${targetRow.span.id} for style=${style}, got ${JSON.stringify(selection)}.`)
      }

      lastTargetId = targetRow.span.id
      baselineIds = plan.map((entry) => entry.span.id)
    }

    if (!lastTargetId) {
      throw new Error('No pedal was selected during the browser test.')
    }

    await page.keyboard.press('Delete')
    await page.waitForFunction((targetPedalId) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getPedalRenderPlan: () => PedalRenderPlanRow[]
          getActivePedalSelection: () => ActivePedalSelection | null
        }
      }).__scoreDebug
      return (
        api.getActivePedalSelection() === null &&
        api.getPedalRenderPlan().every((entry) => entry.span.id !== targetPedalId)
      )
    }, lastTargetId)

    const afterDeletePlan = await getPedalRenderPlan(page)
    if (afterDeletePlan.length !== Math.max(0, baselineIds.length - 1)) {
      throw new Error(`Delete should remove exactly one pedal span. before=${baselineIds.length} after=${afterDeletePlan.length}.`)
    }

    await page.keyboard.press('Control+z')
    await page.waitForFunction((targetPedalId) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getPedalRenderPlan: () => PedalRenderPlanRow[]
          getActivePedalSelection: () => ActivePedalSelection | null
        }
      }).__scoreDebug
      const selection = api.getActivePedalSelection()
      const plan = api.getPedalRenderPlan()
      return (
        selection?.pedalId === targetPedalId &&
        plan.some((entry) => entry.span.id === targetPedalId && entry.isActive === true)
      )
    }, lastTargetId)

    const afterUndoPlan = await getPedalRenderPlan(page)
    const afterUndoIds = afterUndoPlan.map((entry) => entry.span.id)
    if (afterUndoIds.join(',') !== baselineIds.join(',')) {
      throw new Error(`Undo should restore the original pedal ids. before=[${baselineIds.join(',')}] after=[${afterUndoIds.join(',')}].`)
    }

    console.table(afterUndoPlan.map((entry) => ({
      pedalId: entry.span.id,
      style: entry.span.style,
      isActive: entry.isActive,
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
