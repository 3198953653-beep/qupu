import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type DumpNoteHead = {
  keyIndex: number
  x: number
  y: number
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  onsetTicksInMeasure: number | null
  pitch: string | null
  noteHeads: DumpNoteHead[]
}

type MeasureDumpRow = {
  pairIndex: number
  notes: DumpNoteRow[]
}

type MeasureDump = {
  rows: MeasureDumpRow[]
}

type OverlayDebugInfo = {
  surfaceElement: { width: number; height: number }
  surfaceClientRect: { left: number; top: number; width: number; height: number }
}

type MidiProbe = {
  supported: boolean
  granted: boolean
  error: string | null
  devices: Array<{ id: string; name: string }>
}

type MidiLoopbackProbe = {
  available: boolean
  inputId: string | null
  outputId: string | null
  receivedMessages: number
}

type TestResult = {
  name: string
  pass: boolean
  detail: string
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const REPORT_PATH = path.resolve('debug', 'midi-real-device-test-report.json')
const TEST_XML_PATH = 'C:\\Users\\76743\\Desktop\\延音线.musicxml'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal })
      clearTimeout(timer)
      if (response.ok) return
    } catch {
      // retry
      clearTimeout(timer)
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
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    if (server.exitCode !== null || server.killed) {
      done()
      return
    }
    server.once('exit', () => done())
    const forceResolveTimer = setTimeout(() => {
      if (server.exitCode === null && !server.killed) {
        server.kill('SIGKILL')
      }
      done()
    }, 6000)
    if (process.platform === 'win32' && server.pid) {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      setTimeout(() => {
        if (server.exitCode === null && !server.killed) {
          server.kill('SIGKILL')
        }
      }, 1800)
      return
    }
    server.kill('SIGTERM')
    setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL')
    }, 2500)
    server.once('exit', () => clearTimeout(forceResolveTimer))
  })
}

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
    return (
      !!api &&
      typeof api.importMusicXmlText === 'function' &&
      typeof api.getImportFeedback === 'function' &&
      typeof api.dumpAllMeasureCoordinates === 'function' &&
      typeof api.getOverlayDebugInfo === 'function'
    )
  })
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
    const api = (window as unknown as { __scoreDebug: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
    return api.getImportFeedback()
  })
  if (feedback.kind !== 'success') {
    throw new Error(`MusicXML import failed: ${feedback.message}`)
  }
}

async function getDump(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api = (window as unknown as { __scoreDebug: { dumpAllMeasureCoordinates: () => unknown } }).__scoreDebug
    return api.dumpAllMeasureCoordinates() as MeasureDump
  })
}

function findNoteFromDump(
  dump: MeasureDump,
  params: { pairIndex: number; noteIndex: number; staff: 'treble' | 'bass' },
): DumpNoteRow {
  const row = dump.rows.find((item) => item.pairIndex === params.pairIndex)
  if (!row) {
    throw new Error(`Missing pairIndex=${params.pairIndex}`)
  }
  const note = row.notes.find((item) => item.noteIndex === params.noteIndex && item.staff === params.staff)
  if (!note) {
    throw new Error(`Missing note pair=${params.pairIndex}, note=${params.noteIndex}, staff=${params.staff}`)
  }
  return note
}

async function clickNote(
  page: Page,
  params: { pairIndex: number; noteIndex: number; staff: 'treble' | 'bass'; keyIndex?: number; withCtrl?: boolean },
): Promise<void> {
  const point = await page.evaluate((payload) => {
    const api = (window as unknown as {
      __scoreDebug: {
        dumpAllMeasureCoordinates: () => MeasureDump
        getOverlayDebugInfo: () => OverlayDebugInfo | null
      }
    }).__scoreDebug
    const dump = api.dumpAllMeasureCoordinates()
    const row = dump.rows.find((item) => item.pairIndex === payload.pairIndex)
    if (!row) return null
    const note = row.notes.find((item) => item.noteIndex === payload.noteIndex && item.staff === payload.staff)
    if (!note) return null
    const head = note.noteHeads.find((item) => item.keyIndex === payload.keyIndex) ?? note.noteHeads[0]
    const geometry = api.getOverlayDebugInfo()
    if (!head || !geometry) return null
    const scaleX = geometry.surfaceClientRect.width / geometry.surfaceElement.width
    const scaleY = geometry.surfaceClientRect.height / geometry.surfaceElement.height
    return {
      x: geometry.surfaceClientRect.left + head.x * scaleX,
      y: geometry.surfaceClientRect.top + head.y * scaleY,
    }
  }, {
    pairIndex: params.pairIndex,
    noteIndex: params.noteIndex,
    staff: params.staff,
    keyIndex: params.keyIndex ?? 0,
  })

  if (!point) {
    throw new Error(`Failed to resolve click point: ${JSON.stringify(params)}`)
  }

  if (params.withCtrl) await page.keyboard.down('Control')
  await page.mouse.click(point.x, point.y)
  if (params.withCtrl) await page.keyboard.up('Control')
  await page.waitForTimeout(90)
}

async function getInspectorPitchLabel(page: Page): Promise<string> {
  const text = await page.locator('.inspector p').nth(1).locator('strong').innerText()
  return text.trim()
}

async function sendMidiNoteOnToSelectedInput(
  page: Page,
  noteNumber: number,
  velocity = 100,
): Promise<{ ok: boolean; inputId: string | null; handlerType: string }> {
  return page.evaluate(async ({ note, velocityValue }) => {
    const select = document.getElementById('midi-input-select') as HTMLSelectElement | null
    const selectedId = select?.value ?? ''
    if (typeof navigator.requestMIDIAccess !== 'function') {
      return { ok: false, inputId: null, handlerType: 'unsupported' }
    }
    const access = await navigator.requestMIDIAccess()
    const inputs = Array.from(access.inputs.values())
    const input =
      inputs.find((item) => item.id === selectedId) ??
      inputs.find((item) => typeof item.onmidimessage === 'function') ??
      inputs[0] ??
      null
    if (!input || typeof input.onmidimessage !== 'function') {
      return { ok: false, inputId: input?.id ?? null, handlerType: typeof input?.onmidimessage }
    }
    input.onmidimessage({ data: new Uint8Array([0x90, note, velocityValue]) } as MIDIMessageEvent)
    return { ok: true, inputId: input.id, handlerType: typeof input.onmidimessage }
  }, { note: noteNumber, velocityValue: velocity })
}

async function waitForMidiInputHandlerBound(page: Page, preferredId: string, timeoutMs = 10_000): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await page.evaluate(async (targetId) => {
      if (typeof navigator.requestMIDIAccess !== 'function') return false
      const access = await navigator.requestMIDIAccess()
      const inputs = Array.from(access.inputs.values())
      const input = inputs.find((item) => item.id === targetId) ?? inputs[0] ?? null
      return !!input && typeof input.onmidimessage === 'function'
    }, preferredId)
    if (state) return true
    await page.waitForTimeout(120)
  }
  return false
}

async function detectMidiOutputLoopback(page: Page, preferredInputId: string): Promise<MidiLoopbackProbe> {
  return page.evaluate(async (targetInputId) => {
    if (typeof navigator.requestMIDIAccess !== 'function') {
      return { available: false, inputId: null, outputId: null, receivedMessages: 0 } satisfies MidiLoopbackProbe
    }
    const access = await navigator.requestMIDIAccess()
    const inputs = Array.from(access.inputs.values())
    const outputs = Array.from(access.outputs.values())
    const input = inputs.find((item) => item.id === targetInputId) ?? inputs[0] ?? null
    if (!input || outputs.length === 0) {
      return {
        available: false,
        inputId: input?.id ?? null,
        outputId: null,
        receivedMessages: 0,
      } satisfies MidiLoopbackProbe
    }
    const inputNamePrefix = (input.name ?? '').split('-')[0]?.trim() ?? ''
    const output =
      outputs.find((item) => item.name && inputNamePrefix && item.name.startsWith(inputNamePrefix)) ??
      outputs[0] ??
      null
    if (!output) {
      return {
        available: false,
        inputId: input.id,
        outputId: null,
        receivedMessages: 0,
      } satisfies MidiLoopbackProbe
    }
    let receivedMessages = 0
    const previousHandler = input.onmidimessage
    input.onmidimessage = (event) => {
      const data = event?.data
      const command = (data?.[0] ?? 0) & 0xf0
      const velocity = data?.[2] ?? 0
      if (command === 0x90 && velocity > 0) {
        receivedMessages += 1
      }
    }
    output.send([0x90, 72, 96])
    output.send([0x80, 72, 0], window.performance.now() + 120)
    await new Promise((resolve) => setTimeout(resolve, 600))
    input.onmidimessage = previousHandler
    return {
      available: receivedMessages > 0,
      inputId: input.id,
      outputId: output.id,
      receivedMessages,
    } satisfies MidiLoopbackProbe
  }, preferredInputId)
}

async function sendMidiNoteOnViaOutputLoopback(
  page: Page,
  noteNumber: number,
  velocity: number,
  preferredInputId: string,
  preferredOutputId: string | null,
): Promise<{ ok: boolean; inputId: string | null; outputId: string | null; detail: string }> {
  return page.evaluate(
    async ({ note, velocityValue, targetInputId, targetOutputId }) => {
      if (typeof navigator.requestMIDIAccess !== 'function') {
        return { ok: false, inputId: null, outputId: null, detail: 'unsupported' }
      }
      const access = await navigator.requestMIDIAccess()
      const inputs = Array.from(access.inputs.values())
      const outputs = Array.from(access.outputs.values())
      const input = inputs.find((item) => item.id === targetInputId) ?? inputs[0] ?? null
      const output = outputs.find((item) => item.id === targetOutputId) ?? outputs[0] ?? null
      if (!input || !output) {
        return {
          ok: false,
          inputId: input?.id ?? null,
          outputId: output?.id ?? null,
          detail: 'missing io',
        }
      }
      output.send([0x90, note, velocityValue])
      output.send([0x80, note, 0], window.performance.now() + 110)
      return {
        ok: true,
        inputId: input.id,
        outputId: output.id,
        detail: 'sent',
      }
    },
    {
      note: noteNumber,
      velocityValue: velocity,
      targetInputId: preferredInputId,
      targetOutputId: preferredOutputId,
    },
  )
}

function getPitchByNoteId(dump: MeasureDump): Map<string, string | null> {
  const map = new Map<string, string | null>()
  dump.rows.forEach((row) => {
    row.notes.forEach((note) => {
      map.set(note.noteId, note.pitch)
    })
  })
  return map
}

async function main(): Promise<void> {
  await mkdir(path.dirname(REPORT_PATH), { recursive: true })
  const shouldStartServer = process.env.MIDI_TEST_SKIP_SERVER !== '1'
  const server = shouldStartServer ? startDevServer() : null
  const testResults: TestResult[] = []
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    deviceProbe: null,
    loopbackProbe: null,
    selectedInputId: null,
    results: testResults,
  }

  server?.stdout?.on('data', (chunk) => {
    process.stdout.write(`[dev] ${chunk}`)
  })
  server?.stderr?.on('data', (chunk) => {
    process.stderr.write(`[dev:err] ${chunk}`)
  })

  try {
    await waitForServer(DEV_URL, 60_000)
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    await context.grantPermissions(['midi', 'midi-sysex'], { origin: DEV_URL })
    const page = await context.newPage()
    await page.addInitScript(() => {
      if (typeof navigator.requestMIDIAccess !== 'function') return
      const original = navigator.requestMIDIAccess.bind(navigator)
      let cachedPromise: Promise<MIDIAccess> | null = null
      let cachedWrapped: Promise<MIDIAccess> | null = null
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: () => {
          if (!cachedPromise) cachedPromise = original()
          if (!cachedWrapped) {
            cachedWrapped = cachedPromise.then((access) => {
              const inputMap = new Map<string, MIDIInput>()
              const inputValues = () => {
                const rawInputs = Array.from(access.inputs.values())
                rawInputs.forEach((input) => {
                  if (!inputMap.has(input.id)) inputMap.set(input.id, input)
                })
                return inputMap.values()
              }
              const wrappedInputs = {
                values: inputValues,
                forEach: (callback: (value: MIDIInput) => void) => {
                  Array.from(inputValues()).forEach((item) => callback(item))
                },
              }
              return {
                inputs: wrappedInputs,
                outputs: access.outputs,
                onstatechange: null,
                sysexEnabled: access.sysexEnabled,
              } as unknown as MIDIAccess
            })
          }
          return cachedWrapped
        },
      })
    })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await waitForDebugApi(page)

    const deviceProbe = await page.evaluate(async () => {
      if (typeof navigator.requestMIDIAccess !== 'function') {
        return {
          supported: false,
          granted: false,
          error: 'requestMIDIAccess unavailable',
          devices: [],
        } satisfies MidiProbe
      }
      try {
        const access = await navigator.requestMIDIAccess()
        return {
          supported: true,
          granted: true,
          error: null,
          devices: Array.from(access.inputs.values()).map((item) => ({
            id: item.id,
            name: item.name ?? '未命名设备',
          })),
        } satisfies MidiProbe
      } catch (error) {
        return {
          supported: true,
          granted: false,
          error: error instanceof Error ? error.message : String(error ?? 'unknown'),
          devices: [],
        } satisfies MidiProbe
      }
    })
    report.deviceProbe = deviceProbe
    testResults.push({
      name: 'MIDI权限与设备枚举',
      pass: deviceProbe.supported && deviceProbe.granted && deviceProbe.devices.length > 0,
      detail: `supported=${deviceProbe.supported}, granted=${deviceProbe.granted}, devices=${deviceProbe.devices.length}${deviceProbe.error ? `, error=${deviceProbe.error}` : ''}`,
    })
    if (!deviceProbe.supported || !deviceProbe.granted || deviceProbe.devices.length === 0) {
      await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
      throw new Error('未检测到可用真机MIDI输入设备或权限未授予，无法完成真机全量测试。')
    }

    await page.waitForSelector('#midi-input-select')
    const firstInputId = deviceProbe.devices[0].id
    await page.selectOption('#midi-input-select', firstInputId)
    await page.waitForTimeout(220)
    const selectedInputId = await page.$eval('#midi-input-select', (node) => (node as HTMLSelectElement).value)
    report.selectedInputId = selectedInputId
    testResults.push({
      name: '设备下拉选择',
      pass: selectedInputId === firstInputId,
      detail: `selected=${selectedInputId}, expected=${firstInputId}`,
    })
    const midiManualBindCheck = await page.evaluate(async (targetId) => {
      if (typeof navigator.requestMIDIAccess !== 'function') {
        return { ok: false, reason: 'unsupported' }
      }
      const access = await navigator.requestMIDIAccess()
      const input = Array.from(access.inputs.values()).find((item) => item.id === targetId) ?? null
      if (!input) return { ok: false, reason: 'missing-input' }
      let hit = 0
      input.onmidimessage = () => {
        hit += 1
      }
      const handlerType = typeof input.onmidimessage
      if (typeof input.onmidimessage === 'function') {
        input.onmidimessage({ data: new Uint8Array([0x90, 64, 100]) } as MIDIMessageEvent)
      }
      const reached = hit > 0
      return {
        ok: handlerType === 'function' && reached,
        handlerType,
        reached,
      }
    }, selectedInputId)
    testResults.push({
      name: 'MIDI底层手动绑定可写性',
      pass: midiManualBindCheck.ok,
      detail: `handlerType=${(midiManualBindCheck as { handlerType?: string }).handlerType ?? 'unknown'}, reached=${String((midiManualBindCheck as { reached?: boolean }).reached ?? false)}`,
    })
    const midiHandlerBound = await waitForMidiInputHandlerBound(page, selectedInputId)
    testResults.push({
      name: 'MIDI输入处理器绑定',
      pass: midiHandlerBound,
      detail: `selected=${selectedInputId}, bound=${midiHandlerBound}`,
    })
    const loopbackProbe = await detectMidiOutputLoopback(page, selectedInputId)
    report.loopbackProbe = loopbackProbe
    testResults.push({
      name: 'MIDI输出回环可用性',
      pass: loopbackProbe.available,
      detail: `input=${loopbackProbe.inputId}, output=${loopbackProbe.outputId}, received=${loopbackProbe.receivedMessages}`,
    })
    const sendNoteOn = async (noteNumber: number, velocity = 100) => {
      if (loopbackProbe.available) {
        const sent = await sendMidiNoteOnViaOutputLoopback(
          page,
          noteNumber,
          velocity,
          selectedInputId,
          loopbackProbe.outputId,
        )
        return {
          ok: sent.ok,
          inputId: sent.inputId,
          channel: `loopback:${sent.outputId ?? 'n/a'}`,
        }
      }
      const sent = await sendMidiNoteOnToSelectedInput(page, noteNumber, velocity)
      return {
        ok: sent.ok,
        inputId: sent.inputId,
        channel: `direct:${sent.handlerType}`,
      }
    }

    const xmlText = await readFile(TEST_XML_PATH, 'utf8')
    await importMusicXmlViaDebugApi(page, xmlText)
    await page.waitForTimeout(220)

    // A. 单选替换
    await clickNote(page, { pairIndex: 0, noteIndex: 0, staff: 'treble', keyIndex: 0 })
    await page.locator('.score-scroll.horizontal-view').focus()
    const beforeSinglePitch = await getInspectorPitchLabel(page)
    const sentSingle = await sendNoteOn(60)
    await page.waitForTimeout(180)
    const afterSinglePitch = await getInspectorPitchLabel(page)
    testResults.push({
      name: '单选MIDI替换',
      pass: sentSingle.ok && beforeSinglePitch !== afterSinglePitch && afterSinglePitch === 'C4',
      detail: `sent=${sentSingle.ok}(${sentSingle.inputId}/${sentSingle.channel}), before=${beforeSinglePitch}, after=${afterSinglePitch}`,
    })

    // B. 多选优先最早（同一staff）
    const beforeMultiDump = await getDump(page)
    const early = findNoteFromDump(beforeMultiDump, { pairIndex: 0, noteIndex: 0, staff: 'treble' })
    const late = findNoteFromDump(beforeMultiDump, { pairIndex: 0, noteIndex: 3, staff: 'treble' })
    await clickNote(page, { pairIndex: 0, noteIndex: 0, staff: 'treble', withCtrl: true })
    await clickNote(page, { pairIndex: 0, noteIndex: 3, staff: 'treble', withCtrl: true })
    await page.locator('.score-scroll.horizontal-view').focus()
    const sentMulti = await sendNoteOn(62)
    await page.waitForTimeout(200)
    const afterMultiDump = await getDump(page)
    const beforePitchMap = getPitchByNoteId(beforeMultiDump)
    const afterPitchMap = getPitchByNoteId(afterMultiDump)
    const earlyChanged = beforePitchMap.get(early.noteId) !== afterPitchMap.get(early.noteId)
    const lateChanged = beforePitchMap.get(late.noteId) !== afterPitchMap.get(late.noteId)
    testResults.push({
      name: '多选仅替换最早音符',
      pass: sentMulti.ok && earlyChanged && !lateChanged,
      detail: `sent=${sentMulti.ok}(${sentMulti.inputId}/${sentMulti.channel}), earlyChanged=${earlyChanged}, lateChanged=${lateChanged}`,
    })

    // C. 休止符替换
    await clickNote(page, { pairIndex: 3, noteIndex: 2, staff: 'treble' })
    await page.locator('.score-scroll.horizontal-view').focus()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(180)
    const restLabel = await getInspectorPitchLabel(page)
    const sentRest = await sendNoteOn(65)
    await page.waitForTimeout(200)
    const afterRestLabel = await getInspectorPitchLabel(page)
    testResults.push({
      name: '休止符可被MIDI替换',
      pass: restLabel === '休止符' && sentRest.ok && afterRestLabel !== '休止符',
      detail: `before=${restLabel}, sent=${sentRest.ok}(${sentRest.inputId}/${sentRest.channel}), after=${afterRestLabel}`,
    })

    // D. 延音链整链联动（检查跨小节有多个音高一起改）
    await importMusicXmlViaDebugApi(page, xmlText)
    await page.waitForTimeout(220)
    const beforeTieDump = await getDump(page)
    await clickNote(page, { pairIndex: 1, noteIndex: 0, staff: 'treble' })
    const sentTie = await sendNoteOn(67)
    await page.waitForTimeout(220)
    const afterTieDump = await getDump(page)
    const changedRows: Array<{ pairIndex: number; noteId: string }> = []
    const beforeTieMap = getPitchByNoteId(beforeTieDump)
    afterTieDump.rows.forEach((row) => {
      row.notes.forEach((note) => {
        if (note.staff !== 'treble') return
        const beforePitch = beforeTieMap.get(note.noteId) ?? null
        if (beforePitch !== note.pitch) {
          changedRows.push({ pairIndex: row.pairIndex, noteId: note.noteId })
        }
      })
    })
    const changedPairCount = new Set(changedRows.map((item) => item.pairIndex)).size
    testResults.push({
      name: '延音链整链联动',
      pass: sentTie.ok && changedRows.length >= 2 && changedPairCount >= 2,
      detail: `sent=${sentTie.ok}(${sentTie.inputId}/${sentTie.channel}), changedRows=${changedRows.length}, changedPairs=${changedPairCount}`,
    })

    // E. 预览打开时MIDI输入不生效
    await clickNote(page, { pairIndex: 0, noteIndex: 0, staff: 'treble' })
    const beforePreviewBlockDump = await getDump(page)
    await page.getByRole('button', { name: 'OSMD预览' }).click()
    await page.waitForSelector('.osmd-preview-modal', { state: 'visible', timeout: 20_000 })
    const sentWhilePreview = await sendNoteOn(69)
    await page.waitForTimeout(250)
    await page.getByRole('button', { name: '关闭' }).click()
    await page.waitForSelector('.osmd-preview-modal', { state: 'hidden', timeout: 20_000 })
    const afterPreviewBlockDump = await getDump(page)
    const beforePreviewMap = getPitchByNoteId(beforePreviewBlockDump)
    const afterPreviewMap = getPitchByNoteId(afterPreviewBlockDump)
    let changedCountWhenPreviewOpen = 0
    beforePreviewMap.forEach((pitch, noteId) => {
      if ((afterPreviewMap.get(noteId) ?? null) !== pitch) changedCountWhenPreviewOpen += 1
    })
    testResults.push({
      name: 'OSMD预览打开时MIDI忽略',
      pass: sentWhilePreview.ok && changedCountWhenPreviewOpen === 0,
      detail: `sent=${sentWhilePreview.ok}(${sentWhilePreview.inputId}/${sentWhilePreview.channel}), changedCount=${changedCountWhenPreviewOpen}`,
    })

    // F. 设备ID持久化
    const storedId = await page.evaluate(() => window.localStorage.getItem('score.midi.selectedInputId') ?? '')
    testResults.push({
      name: '设备选择持久化',
      pass: storedId === selectedInputId,
      detail: `stored=${storedId}, selected=${selectedInputId}`,
    })

    await context.close()
    await browser.close()

    const failed = testResults.filter((item) => !item.pass)
    report.failedCount = failed.length
    report.summary = failed.length === 0 ? 'PASS' : 'FAIL'
    await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')

    if (failed.length > 0) {
      const detail = failed.map((item) => `${item.name}: ${item.detail}`).join('\n')
      throw new Error(`MIDI真机测试失败 ${failed.length} 项:\n${detail}`)
    }
    console.log(`MIDI真机测试通过，共 ${testResults.length} 项。报告: ${REPORT_PATH}`)
  } finally {
    if (server) {
      await stopDevServer(server)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
