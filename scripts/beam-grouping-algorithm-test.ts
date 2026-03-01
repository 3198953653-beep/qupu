import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DOMParser } from 'linkedom'
import { computeMeasurePairsBeamGroups } from '../src/score/beamGrouping'
import { parseMusicXml } from '../src/score/musicXml'
import type { BeamLevelTag, BeamTagByLevel, NoteDuration, ScoreNote, StaffKind } from '../src/score/types'

type BeamDiffRow = {
  measureIndex: number
  measureNumber: number
  staff: StaffKind
  noteIndex: number
  expected: string
  actual: string
}

type BeamComparisonSummary = {
  sourcePath: string
  pass: boolean
  totalComparedNotes: number
  totalDiffs: number
  ignoredActualExtraNotes: number
  diffs: BeamDiffRow[]
  patternChecks: Array<{ name: string; pass: boolean; detail: string }>
}

type ExpectedMeasureBeams = {
  treble: BeamTagByLevel[]
  bass: BeamTagByLevel[]
}

const DEFAULT_SOURCE_PATH = 'C:\\Users\\76743\\Desktop\\测试音值组合.musicxml'
const REPORT_OUTPUT_PATH = path.resolve('debug/beam-grouping-report.json')
const DIFF_PRINT_LIMIT = 80
const BEAM_TAG_VALUES = new Set<BeamLevelTag>(['begin', 'continue', 'end', 'forward hook', 'backward hook'])

;(globalThis as unknown as { DOMParser?: typeof DOMParser }).DOMParser = DOMParser

function parseBeamTagValue(rawValue: string | null | undefined): BeamLevelTag | null {
  const normalized = (rawValue ?? '').trim().toLowerCase()
  if (!BEAM_TAG_VALUES.has(normalized as BeamLevelTag)) return null
  return normalized as BeamLevelTag
}

function serializeBeamTags(beamTags: BeamTagByLevel | undefined): string {
  if (!beamTags) return 'none'
  const entries = Object.entries(beamTags)
    .map(([rawLevel, tag]) => ({ level: Number(rawLevel), tag }))
    .filter((entry) => Number.isFinite(entry.level) && entry.tag)
    .sort((left, right) => left.level - right.level)
  if (entries.length === 0) return 'none'
  return entries.map((entry) => `${entry.level}:${entry.tag}`).join('|')
}

function isBeamTagMapEqual(left: BeamTagByLevel | undefined, right: BeamTagByLevel | undefined): boolean {
  return serializeBeamTags(left) === serializeBeamTags(right)
}

function toStaffKind(staffText: string | null | undefined, fallbackStaff: StaffKind): StaffKind {
  if (staffText === '1') return 'treble'
  if (staffText === '2') return 'bass'
  return fallbackStaff
}

function extractExpectedBeamsFromXml(xmlText: string): ExpectedMeasureBeams[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('测试文件 XML 解析失败。')
  }
  const firstPart = doc.querySelector('part')
  if (!firstPart) {
    throw new Error('测试文件未找到 <part> 节点。')
  }

  const measures = Array.from(firstPart.getElementsByTagName('measure'))
  const expected = measures.map<ExpectedMeasureBeams>(() => ({ treble: [], bass: [] }))

  let currentStaff: StaffKind = 'treble'
  measures.forEach((measureEl, measureIndex) => {
    const childElements = Array.from(measureEl.children)
    for (let childIndex = 0; childIndex < childElements.length; childIndex += 1) {
      const child = childElements[childIndex]
      if (child.tagName.toLowerCase() !== 'note') continue
      if (child.getElementsByTagName('grace').length > 0) continue
      currentStaff = toStaffKind(child.getElementsByTagName('staff')[0]?.textContent?.trim(), currentStaff)
      if (child.getElementsByTagName('chord').length > 0) continue

      const beamTags: BeamTagByLevel = {}
      const beamElements = Array.from(child.getElementsByTagName('beam'))
      for (let beamIndex = 0; beamIndex < beamElements.length; beamIndex += 1) {
        const beamElement = beamElements[beamIndex]
        const level = Number(beamElement.getAttribute('number') ?? '')
        if (!Number.isFinite(level)) continue
        const tag = parseBeamTagValue(beamElement.textContent)
        if (!tag) continue
        beamTags[Math.trunc(level)] = tag
      }
      expected[measureIndex][currentStaff].push(beamTags)
    }
  })

  return expected
}

function makeNote(id: string, duration: NoteDuration): ScoreNote {
  return { id, pitch: 'c/5', duration }
}

function assertPatternLevelOne(
  name: string,
  durations: NoteDuration[],
  expectedLevelOne: Array<BeamLevelTag | null>,
): { name: string; pass: boolean; detail: string } {
  const notes = durations.map((duration, index) => makeNote(`${name}-n${index + 1}`, duration))
  const beamTags = computeMeasurePairsBeamGroups({
    measurePairs: [{ treble: notes, bass: [] }],
    measureTimeSignatures: [{ beats: 4, beatType: 4 }],
  })[0].treble
  const actualLevelOne = beamTags.map((noteTagMap) => noteTagMap[1] ?? null)
  const pass =
    actualLevelOne.length === expectedLevelOne.length &&
    actualLevelOne.every((tag, index) => tag === expectedLevelOne[index])
  return {
    name,
    pass,
    detail: `expected=${JSON.stringify(expectedLevelOne)}, actual=${JSON.stringify(actualLevelOne)}`,
  }
}

function runPatternChecks(): Array<{ name: string; pass: boolean; detail: string }> {
  return [
    assertPatternLevelOne(
      'cannot-cut-without-splitting',
      ['8', '16', '8', '8d'],
      ['begin', 'continue', 'continue', 'end'],
    ),
    assertPatternLevelOne(
      'can-cut-into-two-full-beats',
      ['8', '16', '16', '8', '16', '16'],
      ['begin', 'continue', 'end', 'begin', 'continue', 'end'],
    ),
    assertPatternLevelOne('contains-quarter-break', ['8', 'q', '16', '16'], [null, null, 'begin', 'end']),
  ]
}

async function main(): Promise<void> {
  const sourcePathArg = process.argv[2]
  const sourcePath = sourcePathArg && sourcePathArg.trim().length > 0 ? path.resolve(sourcePathArg) : DEFAULT_SOURCE_PATH
  const xmlText = await readFile(sourcePath, 'utf8')
  const importResult = parseMusicXml(xmlText)
  const actual = computeMeasurePairsBeamGroups({
    measurePairs: importResult.measurePairs,
    measureTimeSignatures: importResult.measureTimeSignatures,
  })
  const expected = extractExpectedBeamsFromXml(xmlText)

  const diffs: BeamDiffRow[] = []
  let totalComparedNotes = 0
  let ignoredActualExtraNotes = 0

  const measureCount = Math.max(expected.length, actual.length)
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    const expectedMeasure = expected[measureIndex] ?? { treble: [], bass: [] }
    const actualMeasure = actual[measureIndex] ?? { treble: [], bass: [] }
    ;(['treble', 'bass'] as const).forEach((staff) => {
      const expectedNotes = expectedMeasure[staff]
      const actualNotes = actualMeasure[staff]
      const compareCount = Math.min(expectedNotes.length, actualNotes.length)
      if (actualNotes.length > expectedNotes.length) {
        ignoredActualExtraNotes += actualNotes.length - expectedNotes.length
      }
      for (let noteIndex = 0; noteIndex < compareCount; noteIndex += 1) {
        totalComparedNotes += 1
        const expectedTagMap = expectedNotes[noteIndex]
        const actualTagMap = actualNotes[noteIndex]
        if (isBeamTagMapEqual(expectedTagMap, actualTagMap)) continue
        diffs.push({
          measureIndex,
          measureNumber: measureIndex + 1,
          staff,
          noteIndex,
          expected: serializeBeamTags(expectedTagMap),
          actual: serializeBeamTags(actualTagMap),
        })
      }
      if (expectedNotes.length > actualNotes.length) {
        for (let noteIndex = actualNotes.length; noteIndex < expectedNotes.length; noteIndex += 1) {
          totalComparedNotes += 1
          diffs.push({
            measureIndex,
            measureNumber: measureIndex + 1,
            staff,
            noteIndex,
            expected: serializeBeamTags(expectedNotes[noteIndex]),
            actual: 'missing',
          })
        }
      }
    })
  }

  const patternChecks = runPatternChecks()
  const patternFailed = patternChecks.some((check) => !check.pass)
  const pass = diffs.length === 0 && !patternFailed

  const summary: BeamComparisonSummary = {
    sourcePath,
    pass,
    totalComparedNotes,
    totalDiffs: diffs.length,
    ignoredActualExtraNotes,
    diffs,
    patternChecks,
  }

  await mkdir(path.dirname(REPORT_OUTPUT_PATH), { recursive: true })
  await writeFile(REPORT_OUTPUT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  console.info(`[beam-grouping-test] source: ${sourcePath}`)
  console.info(`[beam-grouping-test] compared notes: ${totalComparedNotes}`)
  console.info(`[beam-grouping-test] diff count: ${diffs.length}`)
  console.info(`[beam-grouping-test] ignored actual extra notes: ${ignoredActualExtraNotes}`)
  if (diffs.length > 0) {
    console.info(`[beam-grouping-test] showing first ${Math.min(DIFF_PRINT_LIMIT, diffs.length)} diffs:`)
    diffs.slice(0, DIFF_PRINT_LIMIT).forEach((diff) => {
      console.info(
        `  m${diff.measureNumber} ${diff.staff} note#${diff.noteIndex + 1}: expected=${diff.expected}, actual=${diff.actual}`,
      )
    })
  }

  patternChecks.forEach((check) => {
    const prefix = check.pass ? 'PASS' : 'FAIL'
    console.info(`[beam-pattern] ${prefix} ${check.name} :: ${check.detail}`)
  })

  if (!pass) {
    console.error('[beam-grouping-test] FAIL')
    process.exitCode = 1
    return
  }

  console.info('[beam-grouping-test] PASS')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[beam-grouping-test] ERROR: ${message}`)
  process.exitCode = 1
})
