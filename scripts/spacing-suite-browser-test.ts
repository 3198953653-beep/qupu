import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

type MeasureDumpReport = {
  xmlPath: string
  scale: {
    autoScaleEnabled: boolean
    manualScalePercent: number
    scoreScale: number
  }
  overflowMeasureCount: number
  lineSpacingAnalysis: {
    passed: boolean
  }
  rows: Array<{
    pairIndex: number
    rendered: boolean
    renderedPageIndex: number | null
    systemTop: number | null
    measureStartBarX: number | null
    measureEndBarX: number | null
    notes: Array<{
      staff: 'treble' | 'bass'
      noteIndex: number
      onsetTicksInMeasure: number | null
      x: number
      spacingRightX: number
    }>
  }>
}

type GapLineSummary = {
  lineKey: string
  pairRange: string
  measureCount: number
  fillRatio: number
  medianGapByDeltaTicks: Record<string, number>
  ratioQuarterTo16th: number | null
}

const CASES = [
  { name: '1234', key: '1234' },
  { name: '12-bars', key: '12-bars' },
] as const

const SCALES = [70, 100]
const MAX_RATIO_QUARTER_TO_16TH = 4.2
const MIN_LINE_FILL_RATIO = 0.68
const MAX_LINE_FILL_RATIO = 0.97

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const ordered = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(ordered.length / 2)
  if (ordered.length % 2 === 0) {
    return (ordered[mid - 1] + ordered[mid]) * 0.5
  }
  return ordered[mid]
}

function buildLineSummaries(report: MeasureDumpReport): GapLineSummary[] {
  const grouped = new Map<
    string,
    {
      rows: MeasureDumpReport['rows']
      pairs: number[]
    }
  >()

  report.rows.forEach((row) => {
    if (!row.rendered) return
    const page = Number.isFinite(row.renderedPageIndex) ? row.renderedPageIndex : 0
    const top = Number.isFinite(row.systemTop) ? row.systemTop.toFixed(3) : 'null'
    const key = `${page}|${top}`
    const entry = grouped.get(key) ?? { rows: [], pairs: [] }
    entry.rows.push(row)
    entry.pairs.push(row.pairIndex)
    grouped.set(key, entry)
  })

  const summaries: GapLineSummary[] = []
  grouped.forEach((entry, key) => {
    const rows = entry.rows.slice().sort((a, b) => a.pairIndex - b.pairIndex)
    if (rows.length === 0) return

    const lineStart = Math.min(...rows.map((row) => row.measureStartBarX ?? Number.POSITIVE_INFINITY))
    const lineEnd = Math.max(...rows.map((row) => row.measureEndBarX ?? Number.NEGATIVE_INFINITY))
    const lineWidth = lineEnd - lineStart
    const contentStart = Math.min(
      ...rows.flatMap((row) => row.notes.map((note) => note.x)),
    )
    const contentEnd = Math.max(
      ...rows.flatMap((row) => row.notes.map((note) => note.spacingRightX)),
    )
    const fillRatio = Number.isFinite(lineWidth) && lineWidth > 0 ? (contentEnd - contentStart) / lineWidth : 0

    const gapsByDeltaTicks = new Map<number, number[]>()
    rows.forEach((row) => {
      ;(['treble', 'bass'] as const).forEach((staff) => {
        const notes = row.notes
          .filter((note) => note.staff === staff && typeof note.onsetTicksInMeasure === 'number')
          .sort((a, b) => {
            const onsetDelta = (a.onsetTicksInMeasure as number) - (b.onsetTicksInMeasure as number)
            if (onsetDelta !== 0) return onsetDelta
            return a.noteIndex - b.noteIndex
          })
        for (let i = 1; i < notes.length; i += 1) {
          const previous = notes[i - 1]
          const next = notes[i]
          const deltaTicks = (next.onsetTicksInMeasure as number) - (previous.onsetTicksInMeasure as number)
          const gapPx = next.x - previous.x
          if (!Number.isFinite(deltaTicks) || deltaTicks <= 0) continue
          if (!Number.isFinite(gapPx) || gapPx <= 0) continue
          const bucket = gapsByDeltaTicks.get(deltaTicks) ?? []
          bucket.push(gapPx)
          gapsByDeltaTicks.set(deltaTicks, bucket)
        }
      })
    })

    const medianGapByDeltaTicks: Record<string, number> = {}
    gapsByDeltaTicks.forEach((values, deltaTicks) => {
      const value = median(values)
      if (value !== null) {
        medianGapByDeltaTicks[String(deltaTicks)] = Number(value.toFixed(3))
      }
    })

    const quarter = medianGapByDeltaTicks['16']
    const sixteenth = medianGapByDeltaTicks['4']
    const ratioQuarterTo16th =
      typeof quarter === 'number' && typeof sixteenth === 'number' && sixteenth > 0
        ? Number((quarter / sixteenth).toFixed(3))
        : null

    summaries.push({
      lineKey: key,
      pairRange: `${rows[0].pairIndex}-${rows[rows.length - 1].pairIndex}`,
      measureCount: rows.length,
      fillRatio: Number(fillRatio.toFixed(3)),
      medianGapByDeltaTicks,
      ratioQuarterTo16th,
    })
  })

  return summaries.sort((left, right) => left.lineKey.localeCompare(right.lineKey))
}

async function runSingleCase(params: {
  xmlPath: string
  outputPath: string
  manualScalePercent: number
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'npm',
      [
        'run',
        'test:coords:browser',
        '--',
        params.xmlPath,
        params.outputPath,
        String(params.manualScalePercent),
        'false',
      ],
      {
        cwd: process.cwd(),
        shell: true,
        stdio: 'inherit',
        env: process.env,
      },
    )
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`test:coords:browser failed with exit code ${String(code)}`))
    })
  })
}

async function resolveDesktopXmlPath(key: (typeof CASES)[number]['key']): Promise<string> {
  const desktopDir = path.resolve(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Desktop')
  const entries = await readdir(desktopDir, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith('.musicxml'))

  if (key === '1234') {
    const exact = '1234.musicxml'
    if (candidates.includes(exact)) {
      return path.join(desktopDir, exact)
    }
    const matched = candidates.find((name) => name.includes('1234'))
    if (!matched) {
      throw new Error(`Cannot find 1234 MusicXML under ${desktopDir}`)
    }
    return path.join(desktopDir, matched)
  }

  const exactChinese = `12${String.fromCharCode(0x4e2a)}${String.fromCharCode(0x5c0f)}${String.fromCharCode(0x8282)}.musicxml`
  if (candidates.includes(exactChinese)) {
    return path.join(desktopDir, exactChinese)
  }
  const matchedChinese = candidates.find(
    (name) => name.includes(String.fromCharCode(0x5c0f, 0x8282)) && name.includes('12'),
  )
  if (matchedChinese) {
    return path.join(desktopDir, matchedChinese)
  }
  const matched = candidates.find((name) => name.includes('12') && !name.includes('1234'))
  if (!matched) {
    throw new Error(`Cannot find 12-bars MusicXML under ${desktopDir}`)
  }
  return path.join(desktopDir, matched)
}

async function main() {
  const outputDir = path.resolve('debug', 'spacing-suite')
  await mkdir(outputDir, { recursive: true })

  let failed = false
  for (const fileCase of CASES) {
    const xmlPath = await resolveDesktopXmlPath(fileCase.key)
    for (const scale of SCALES) {
      const outputPath = path.join(outputDir, `${fileCase.name}-${scale}.json`)
      await runSingleCase({
        xmlPath,
        outputPath,
        manualScalePercent: scale,
      })

      const report = JSON.parse(await readFile(outputPath, 'utf8')) as MeasureDumpReport
      const lines = buildLineSummaries(report)
      const overflowPass = report.overflowMeasureCount === 0
      const orderingPass = report.lineSpacingAnalysis.passed
      const ratioPass = lines.every(
        (line) =>
          line.ratioQuarterTo16th === null || line.ratioQuarterTo16th <= MAX_RATIO_QUARTER_TO_16TH,
      )
      const fillPass = lines.every(
        (line) => line.fillRatio >= MIN_LINE_FILL_RATIO && line.fillRatio <= MAX_LINE_FILL_RATIO,
      )

      if (!overflowPass || !orderingPass || !ratioPass || !fillPass) {
        failed = true
      }

      console.log(`\n[spacing-suite] ${fileCase.name} @ ${scale}%`)
      console.log(
        `checks: overflow=${overflowPass ? 'PASS' : 'FAIL'} ordering=${orderingPass ? 'PASS' : 'FAIL'} ` +
          `q16-ratio=${ratioPass ? 'PASS' : 'FAIL'} fill=${fillPass ? 'PASS' : 'FAIL'}`,
      )
      lines.forEach((line) => {
        console.log(
          `line ${line.lineKey} pairs=${line.pairRange} measures=${line.measureCount} fill=${line.fillRatio} ` +
            `ratioQ16=${line.ratioQuarterTo16th ?? 'n/a'} gaps=${JSON.stringify(line.medianGapByDeltaTicks)}`,
        )
      })
    }
  }

  if (failed) {
    throw new Error('Spacing suite failed. See checks above.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
