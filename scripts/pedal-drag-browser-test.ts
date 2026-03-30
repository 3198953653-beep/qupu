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
    manualBaselineOffsetPx: number
    staff: 'bass'
    startPairIndex: number
    startTick: number
    endPairIndex: number
    endTick: number
  }
  startX: number
  endX: number
  hitLeftX: number
  hitRightX: number
  hitTopY: number
  hitBottomY: number
  isActive: boolean
  systemKey: string
  baseBaselineY: number
  maxBaselineY: number
  autoBaselineY: number
  resolvedBaselineY: number
  baselineY: number
  pedalTopY: number
  collisionBottomY: number | null
  requiredBaselineY: number
  manualBaselineOffsetPx: number
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4183
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const POSITION_EPSILON_PX = 0.5
const BASELINE_EPSILON_PX = 0.6

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

async function getActiveLayoutModeLabel(page: Page): Promise<string> {
  const text = await page.locator('.pedal-apply-layout-chip.is-active').first().textContent()
  return (text ?? '').trim()
}

async function applyPedalStyle(page: Page, style: 'text' | 'bracket' | 'mixed'): Promise<void> {
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

async function getCanvasMetrics(page: Page): Promise<{ width: number; height: number; clientWidth: number; clientHeight: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.score-surface') as HTMLCanvasElement | null
    if (!canvas) throw new Error('Canvas .score-surface not found.')
    const rect = canvas.getBoundingClientRect()
    return {
      width: canvas.width,
      height: canvas.height,
      clientWidth: rect.width,
      clientHeight: rect.height,
    }
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
  const point = await toClientPoint(
    page,
    (row.hitLeftX + row.hitRightX) / 2,
    (row.hitTopY + row.hitBottomY) / 2,
  )
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.up()
}

async function dragSelectedPedal(page: Page, row: PedalRenderPlanRow, deltaY: number): Promise<void> {
  const point = await toClientPoint(
    page,
    (row.hitLeftX + row.hitRightX) / 2,
    (row.hitTopY + row.hitBottomY) / 2,
  )
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y + deltaY, { steps: 12 })
  await page.mouse.up()
}

function findPlanRow(plan: PedalRenderPlanRow[], pedalId: string): PedalRenderPlanRow {
  const row = plan.find((entry) => entry.span.id === pedalId)
  if (!row) {
    throw new Error(`Missing pedal render row for id=${pedalId}.`)
  }
  return row
}

function assertClose(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > POSITION_EPSILON_PX) {
    throw new Error(`${label} mismatch. expected=${expected} actual=${actual}.`)
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

    await clickButton(page, '重置')
    await openPedalModal(page)
    const defaultLayoutModeLabel = await getActiveLayoutModeLabel(page)
    if (defaultLayoutModeLabel !== '统一') {
      throw new Error(`Expected pedal modal default layout mode to be 统一, got ${defaultLayoutModeLabel}.`)
    }
    await applyPedalStyle(page, 'text')

    const initialPlan = await waitForPedalPlan(page)
    const targetRow = initialPlan[0]
    if (!targetRow) {
      throw new Error('Expected at least one pedal span after applying pedal style.')
    }
    if (targetRow.span.layoutMode !== 'uniform') {
      throw new Error(`Expected default applied pedal layoutMode to be uniform, got ${targetRow.span.layoutMode}.`)
    }
    const companionRow = initialPlan.find(
      (entry) => entry.systemKey === targetRow.systemKey && entry.span.id !== targetRow.span.id,
    )
    if (!companionRow) {
      throw new Error('Expected another pedal span in the same system for uniform isolation testing.')
    }
    if (Math.abs(companionRow.baselineY - targetRow.baselineY) > BASELINE_EPSILON_PX) {
      throw new Error(
        `Expected uniform pedals to start aligned. target=${targetRow.baselineY} companion=${companionRow.baselineY}.`,
      )
    }
    const initialCanvasMetrics = await getCanvasMetrics(page)

    await dragSelectedPedal(page, targetRow, 480)
    await page.waitForFunction((targetPedalId) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getActivePedalSelection: () => ActivePedalSelection | null
          getPedalRenderPlan: () => PedalRenderPlanRow[]
        }
      }).__scoreDebug
      const row = api.getPedalRenderPlan().find((entry) => entry.span.id === targetPedalId)
      return (
        api.getActivePedalSelection()?.pedalId === targetPedalId &&
        !!row &&
        row.isActive &&
        row.manualBaselineOffsetPx >= 20
      )
    }, targetRow.span.id)

    const afterDownPlan = await getPedalRenderPlan(page)
    const afterDownRow = findPlanRow(afterDownPlan, targetRow.span.id)
    const selection = await getActivePedalSelection(page)
    if (selection?.pedalId !== targetRow.span.id) {
      throw new Error(`Expected active pedal selection ${targetRow.span.id}, got ${JSON.stringify(selection)}.`)
    }
    if (!afterDownRow.isActive) {
      throw new Error('Dragged pedal should remain active after vertical drag.')
    }
    if (afterDownRow.manualBaselineOffsetPx <= 0) {
      throw new Error(`Expected positive manual offset after downward drag, got ${afterDownRow.manualBaselineOffsetPx}.`)
    }
    if (afterDownRow.baselineY <= targetRow.baselineY + BASELINE_EPSILON_PX) {
      throw new Error(`Expected baseline to move down after drag. before=${targetRow.baselineY} after=${afterDownRow.baselineY}.`)
    }
    if (afterDownRow.baselineY > afterDownRow.maxBaselineY + BASELINE_EPSILON_PX) {
      throw new Error(
        `Expected downward drag to clamp at maxBaselineY. baselineY=${afterDownRow.baselineY} maxBaselineY=${afterDownRow.maxBaselineY}.`,
      )
    }
    const afterDownCompanion = findPlanRow(afterDownPlan, companionRow.span.id)
    assertClose(afterDownCompanion.baselineY, companionRow.baselineY, 'companion baseline after downward drag')
    assertClose(afterDownRow.startX, targetRow.startX, 'startX after downward drag')
    assertClose(afterDownRow.endX, targetRow.endX, 'endX after downward drag')
    const afterDownCanvasMetrics = await getCanvasMetrics(page)
    assertClose(afterDownCanvasMetrics.height, initialCanvasMetrics.height, 'canvas height after downward drag')
    assertClose(afterDownCanvasMetrics.clientHeight, initialCanvasMetrics.clientHeight, 'canvas clientHeight after downward drag')

    await dragSelectedPedal(page, afterDownRow, -320)
    await page.waitForFunction((targetPedalId) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getPedalRenderPlan: () => PedalRenderPlanRow[]
        }
      }).__scoreDebug
      const row = api.getPedalRenderPlan().find((entry) => entry.span.id === targetPedalId)
      return !!row && Math.abs(row.baselineY - row.requiredBaselineY) <= 1
    }, targetRow.span.id)

    const afterUpPlan = await getPedalRenderPlan(page)
    const afterUpRow = findPlanRow(afterUpPlan, targetRow.span.id)
    if (afterUpRow.baselineY < afterUpRow.requiredBaselineY - BASELINE_EPSILON_PX) {
      throw new Error(
        `Expected upward drag to clamp to required baseline. baselineY=${afterUpRow.baselineY} requiredBaselineY=${afterUpRow.requiredBaselineY}.`,
      )
    }
    if (afterUpRow.pedalTopY < (afterUpRow.collisionBottomY ?? Number.NEGATIVE_INFINITY) + 2 - BASELINE_EPSILON_PX) {
      throw new Error(
        `Expected upward drag to keep 2px clearance. pedalTopY=${afterUpRow.pedalTopY} collisionBottomY=${afterUpRow.collisionBottomY}.`,
      )
    }
    const afterUpCompanion = findPlanRow(afterUpPlan, companionRow.span.id)
    assertClose(afterUpCompanion.baselineY, companionRow.baselineY, 'companion baseline after upward drag')
    assertClose(afterUpRow.startX, targetRow.startX, 'startX after upward drag')
    assertClose(afterUpRow.endX, targetRow.endX, 'endX after upward drag')
    const afterUpCanvasMetrics = await getCanvasMetrics(page)
    assertClose(afterUpCanvasMetrics.height, initialCanvasMetrics.height, 'canvas height after upward drag')
    assertClose(afterUpCanvasMetrics.clientHeight, initialCanvasMetrics.clientHeight, 'canvas clientHeight after upward drag')

    await page.keyboard.press('Control+z')
    await page.waitForFunction(({ targetPedalId, expectedOffset }) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getPedalRenderPlan: () => PedalRenderPlanRow[]
        }
      }).__scoreDebug
      const row = api.getPedalRenderPlan().find((entry) => entry.span.id === targetPedalId)
      return !!row && row.manualBaselineOffsetPx === expectedOffset
    }, { targetPedalId: targetRow.span.id, expectedOffset: afterDownRow.manualBaselineOffsetPx })

    const afterUndoPlan = await getPedalRenderPlan(page)
    const afterUndoRow = findPlanRow(afterUndoPlan, targetRow.span.id)
    assertClose(afterUndoRow.startX, targetRow.startX, 'startX after undo')
    assertClose(afterUndoRow.endX, targetRow.endX, 'endX after undo')
    assertClose(afterUndoRow.baselineY, afterDownRow.baselineY, 'baselineY after undo')
    assertClose(afterUndoRow.manualBaselineOffsetPx, afterDownRow.manualBaselineOffsetPx, 'manual offset after undo')

    console.table([
      {
        step: 'initial',
        pedalId: targetRow.span.id,
        baselineY: targetRow.baselineY,
        requiredBaselineY: targetRow.requiredBaselineY,
        manualBaselineOffsetPx: targetRow.manualBaselineOffsetPx,
        canvasHeight: initialCanvasMetrics.height,
      },
      {
        step: 'after-down-drag',
        pedalId: afterDownRow.span.id,
        baselineY: afterDownRow.baselineY,
        requiredBaselineY: afterDownRow.requiredBaselineY,
        manualBaselineOffsetPx: afterDownRow.manualBaselineOffsetPx,
        canvasHeight: afterDownCanvasMetrics.height,
      },
      {
        step: 'after-up-drag',
        pedalId: afterUpRow.span.id,
        baselineY: afterUpRow.baselineY,
        requiredBaselineY: afterUpRow.requiredBaselineY,
        manualBaselineOffsetPx: afterUpRow.manualBaselineOffsetPx,
        canvasHeight: afterUpCanvasMetrics.height,
      },
      {
        step: 'after-undo',
        pedalId: afterUndoRow.span.id,
        baselineY: afterUndoRow.baselineY,
        requiredBaselineY: afterUndoRow.requiredBaselineY,
        manualBaselineOffsetPx: afterUndoRow.manualBaselineOffsetPx,
        canvasHeight: afterDownCanvasMetrics.height,
      },
    ])
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
