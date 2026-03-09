import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMParser } from 'linkedom'

import { parseMusicXml } from '../src/score/musicXml'
import { attachMeasureTimelineAxisLayout, buildMeasureTimelineBundle } from '../src/score/layout/timeAxisSpacing'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '..')
const outputPath = path.join(workspaceRoot, 'debug', 'timeline-refactor-compare.json')

;(globalThis as unknown as { DOMParser?: typeof DOMParser }).DOMParser = DOMParser

function main(): void {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: npx tsx scripts/timeline-refactor-compare.ts <musicxml-path>')
    process.exitCode = 1
    return
  }

  const xmlText = fs.readFileSync(inputPath, 'utf8')
  const parsed = parseMusicXml(xmlText)

  const rows = parsed.measurePairs.map((measure, pairIndex) => {
    const timeSignature =
      parsed.measureTimeSignatures[pairIndex] ??
      parsed.measureTimeSignatures[pairIndex - 1] ?? {
        beats: 4,
        beatType: 4,
      }

    const bundle = buildMeasureTimelineBundle({
      measure,
      measureIndex: pairIndex,
      timeSignature,
      timelineMode: 'dual',
    })

    const attached = attachMeasureTimelineAxisLayout({
      bundle,
      effectiveBoundaryStartX: 0,
      effectiveBoundaryEndX: 960,
      widthPx: 960,
    })

    return {
      pairIndex,
      legacyOnsets: attached.legacyOnsets,
      publicTimelineTicks: attached.publicTimeline.points.map((point) => point.tick),
      publicTickToX: Object.fromEntries(
        [...attached.publicAxisLayout.tickToX.entries()].map(([tick, x]) => [String(tick), Number(x.toFixed(3))]),
      ),
      timelineDiffSummary: attached.timelineDiffSummary,
      trebleTimelineEvents: attached.trebleTimeline.events,
      bassTimelineEvents: attached.bassTimeline.events,
    }
  })

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        sourcePath: inputPath,
        generatedAt: new Date().toISOString(),
        measureCount: rows.length,
        differingMeasures: rows
          .filter(
            (row) =>
              row.timelineDiffSummary.legacyOnlyTicks.length > 0 ||
              row.timelineDiffSummary.mergedOnlyTicks.length > 0,
          )
          .map((row) => row.pairIndex),
        rows,
      },
      null,
      2,
    ),
    'utf8',
  )

  const differingMeasures = rows.filter(
    (row) =>
      row.timelineDiffSummary.legacyOnlyTicks.length > 0 || row.timelineDiffSummary.mergedOnlyTicks.length > 0,
  )

  console.info(`Timeline compare written: ${outputPath}`)
  console.info(`Measures: ${rows.length}`)
  console.info(`Differing measures: ${differingMeasures.length}`)
  differingMeasures.slice(0, 10).forEach((row) => {
    console.info(
      `pair ${row.pairIndex}: legacyOnly=[${row.timelineDiffSummary.legacyOnlyTicks.join(', ')}] mergedOnly=[${row.timelineDiffSummary.mergedOnlyTicks.join(', ')}]`,
    )
  })
}

main()
