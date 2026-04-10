import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium } from 'playwright'

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4179
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startDevServer(): ChildProcess {
  const server = process.platform === 'win32'
    ? spawn(
        'cmd.exe',
        ['/c', `npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT} --strictPort`],
        {
          cwd: process.cwd(),
          stdio: 'ignore',
          env: process.env,
          detached: true,
        },
      )
    : spawn(
        'npm',
        ['run', 'dev', '--', '--host', DEV_HOST, '--port', String(DEV_PORT), '--strictPort'],
        {
          cwd: process.cwd(),
          stdio: 'ignore',
          env: process.env,
          detached: true,
        },
      )
  server.unref()
  return server
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

async function run(): Promise<void> {
  const server = startDevServer()
  try {
    console.log('[database-workspace-test] waiting for dev server')
    await waitForServer(DEV_URL, 60_000)
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
    console.log('[database-workspace-test] opening app')
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    await page.getByRole('button', { name: '编辑曲谱', exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: '数据库', exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
    assert.equal(await page.getByRole('button', { name: '数据库', exact: true }).count(), 1, 'expected one global database button')
    await page.locator('.board').waitFor({ state: 'visible', timeout: 20_000 })
    assert.equal(await page.locator('.import-actions').getByRole('button', { name: '数据库', exact: true }).count(), 0, 'editor toolbar should not contain database button')

    console.log('[database-workspace-test] opening database workspace')
    await page.getByRole('button', { name: '数据库', exact: true }).click()
    await page.getByRole('heading', { name: '数据库工作区' }).waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByText('当前数据库：app_data.db').waitFor({ state: 'visible', timeout: 20_000 })
    assert.equal(await page.getByRole('button', { name: '返回乐谱编辑', exact: true }).count(), 0, 'database page should not contain return button')

    const topTabs = page.locator('.database-top-tabs button')
    await assert.doesNotReject(async () => topTabs.nth(0).waitFor({ state: 'visible', timeout: 20_000 }))
    assert.equal(await topTabs.count(), 3, 'expected three database tabs')

    console.log('[database-workspace-test] waiting for built-in rows')
    const noteTableRows = page.locator('.database-table tbody tr')
    await noteTableRows.first().waitFor({ state: 'visible', timeout: 20_000 })

    console.log('[database-workspace-test] toggling note preview')
    await page.getByRole('button', { name: '曲谱预览' }).click()
    await page.locator('.database-preview-card').first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.locator('.database-preview-card canvas').first().waitFor({ state: 'visible', timeout: 20_000 })

    console.log('[database-workspace-test] switching template tab')
    await page.getByRole('button', { name: '伴奏模板录入', exact: true }).click()
    await page.locator('.database-table tbody tr').first().waitFor({ state: 'visible', timeout: 20_000 })

    console.log('[database-workspace-test] switching to entry mode')
    await page.locator('.database-mode-toggle').getByRole('button', { name: '录入数据', exact: true }).click()
    await page.getByRole('button', { name: '选择文件' }).waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByText('尚未解析文件。').waitFor({ state: 'visible', timeout: 20_000 })

    console.log('[database-workspace-test] returning to editor')
    await page.getByRole('button', { name: '编辑曲谱', exact: true }).click()
    await page.locator('.board').waitFor({ state: 'visible', timeout: 20_000 })

    console.log('[database-workspace-test] done')
    await browser.close()
  } finally {
    await stopDevServer(server)
  }
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
