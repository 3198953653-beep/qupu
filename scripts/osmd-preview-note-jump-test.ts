import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'

type DebugSelection = { noteId: string; staff: 'treble' | 'bass'; keyIndex: number }
type DebugTarget = {
  pairIndex: number
  measureNumber: number
  onsetTicks: number
  domIds: string[]
  selection: DebugSelection
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // retry
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

function startDevServer(): ChildProcess {
  return spawn(`npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT} --strictPort`, {
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
    if (process.platform === 'win32' && server.pid) {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      setTimeout(() => resolve(), 1800)
      return
    }
    server.once('exit', () => resolve())
    server.kill('SIGTERM')
    setTimeout(() => resolve(), 2500)
  })
}

async function main(): Promise<void> {
  const xmlPath = process.argv[2] ?? 'C:\\Users\\76743\\Desktop\\1234.musicxml'
  const targetMeasure = Number(process.argv[3] ?? '5')
  const targetOrdinalInMeasure = Math.max(1, Number(process.argv[4] ?? '3'))
  const xml = await readFile(xmlPath, 'utf8')

  const server = startDevServer()
  server.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('ready in')) process.stdout.write(text)
  })

  let browser: import('playwright').Browser | null = null
  try {
    await waitForServer(DEV_URL, 45_000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })

    await page.waitForFunction(() => {
      const api = (window as any).__scoreDebug
      return (
        !!api &&
        typeof api.importMusicXmlText === 'function' &&
        typeof api.getImportFeedback === 'function' &&
        typeof api.getOsmdPreviewNoteTargets === 'function' &&
        typeof api.getActiveSelection === 'function' &&
        typeof api.getOsmdPreviewSelectedSelectionKey === 'function'
      )
    })

    await page.evaluate((xmlText) => {
      ;(window as any).__scoreDebug.importMusicXmlText(xmlText)
    }, xml)

    await page.waitForFunction(() => {
      const feedback = (window as any).__scoreDebug.getImportFeedback()
      return feedback?.kind === 'success' || feedback?.kind === 'error'
    }, { timeout: 120_000 })

    await page.getByRole('button', { name: 'OSMD预览' }).click()
    await page.waitForSelector('.osmd-preview-modal', { state: 'visible' })
    await page.waitForFunction(() => !!document.querySelector('.osmd-preview-surface svg'))

    await page.waitForFunction(
      () => {
        const targets = (window as any).__scoreDebug.getOsmdPreviewNoteTargets() as DebugTarget[]
        return Array.isArray(targets) && targets.length > 0
      },
      { timeout: 30_000 },
    )

    const chosen = await page.evaluate(({ preferredMeasure, preferredOrdinal }) => {
      const api = (window as any).__scoreDebug
      const targets = (api.getOsmdPreviewNoteTargets() as DebugTarget[]) ?? []
      const preferred: Array<{ target: DebugTarget; domId: string }> = []
      for (const target of targets) {
        if (target.measureNumber !== preferredMeasure) continue
        for (const domId of target.domIds) {
          if (typeof domId !== 'string' || domId.length === 0) continue
          if (!document.getElementById(domId)) continue
          preferred.push({ target, domId })
          break
        }
      }
      if (preferred.length > 0) {
        preferred.sort((left, right) => {
          if (left.target.onsetTicks !== right.target.onsetTicks) {
            return left.target.onsetTicks - right.target.onsetTicks
          }
          if (left.target.selection.staff !== right.target.selection.staff) {
            return left.target.selection.staff.localeCompare(right.target.selection.staff)
          }
          return left.target.selection.noteId.localeCompare(right.target.selection.noteId)
        })
        const index = Math.max(0, Math.min(preferred.length - 1, preferredOrdinal - 1))
        return preferred[index]
      }
      for (const target of targets) {
        for (const domId of target.domIds) {
          if (typeof domId !== 'string' || domId.length === 0) continue
          if (!document.getElementById(domId)) continue
          return { target, domId }
        }
      }
      return null
    }, { preferredMeasure: targetMeasure, preferredOrdinal: targetOrdinalInMeasure })

    if (!chosen) {
      throw new Error(`No clickable preview note found (preferred measure=${targetMeasure}).`)
    }

    const expectedSelection = chosen.target.selection
    const expectedKey = `${expectedSelection.staff}|${expectedSelection.noteId}|${expectedSelection.keyIndex}`

    const clickOk = await page.evaluate((domId) => {
      const node = document.getElementById(domId)
      if (!node) return false
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      return true
    }, chosen.domId)
    if (!clickOk) {
      throw new Error(`Preview note element not found for click: ${chosen.domId}`)
    }

    await page.waitForTimeout(120)
    const clickState = await page.evaluate(() => {
      const api = (window as any).__scoreDebug
      return {
        selectedKey: api.getOsmdPreviewSelectedSelectionKey() as string | null,
        highlightedCount: document.querySelectorAll('.osmd-preview-note-selected').length,
      }
    })

    if (clickState.selectedKey !== expectedKey) {
      throw new Error(`Single-click selection mismatch: expected=${expectedKey}, got=${clickState.selectedKey ?? 'null'}`)
    }
    if (clickState.highlightedCount <= 0) {
      throw new Error('Single-click did not produce any preview highlight node.')
    }

    const doubleClickOk = await page.evaluate((domId) => {
      const node = document.getElementById(domId)
      if (!node) return false
      node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2, view: window }))
      return true
    }, chosen.domId)
    if (!doubleClickOk) {
      throw new Error(`Preview note element not found for double-click: ${chosen.domId}`)
    }

    await page.waitForSelector('.osmd-preview-modal', { state: 'hidden', timeout: 15_000 })
    await page.waitForTimeout(250)

    const editorState = await page.evaluate(() => {
      const api = (window as any).__scoreDebug
      return {
        activeSelection: api.getActiveSelection() as DebugSelection,
        overlay: api.getOverlayDebugInfo?.() ?? null,
      }
    })
    const activeSelection = editorState.activeSelection
    const actualKey = `${activeSelection.staff}|${activeSelection.noteId}|${activeSelection.keyIndex}`
    if (actualKey !== expectedKey) {
      throw new Error(`Double-click jump mismatch: expected=${expectedKey}, got=${actualKey}`)
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          xmlPath,
          preferredMeasure: targetMeasure,
          preferredOrdinalInMeasure: targetOrdinalInMeasure,
          chosen: {
            measureNumber: chosen.target.measureNumber,
            onsetTicks: chosen.target.onsetTicks,
            domId: chosen.domId,
            selection: chosen.target.selection,
          },
          clickState,
          editorSelectionAfterDoubleClick: activeSelection,
          overlayDisplay: editorState.overlay?.overlayElement?.display ?? null,
        },
        null,
        2,
      ),
    )
  } finally {
    if (browser) await browser.close()
    await stopDevServer(server)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
