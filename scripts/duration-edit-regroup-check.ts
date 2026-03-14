import { applyPaletteDurationEdit } from '../src/score/durationEdits'
import type { MeasurePair, NoteDuration, ScoreNote, Selection, TimeSignature } from '../src/score/types'

type CaseDef = {
  name: string
  treble: NoteDuration[]
  bass: NoteDuration[]
  selectIndex: number
  action: { type: 'duration'; targetDuration: NoteDuration }
  expectedTrebleTokens: string[]
  expectedBassTokens?: string[]
}

function makeNote(id: string, duration: NoteDuration, pitch = 'c/5'): ScoreNote {
  return { id, duration, pitch }
}

function makeStaff(prefix: string, durations: NoteDuration[], pitchBase = 'c/5'): ScoreNote[] {
  return durations.map((duration, index) => makeNote(`${prefix}${index + 1}`, duration, pitchBase))
}

function makePair(trebleDurations: NoteDuration[], bassDurations: NoteDuration[]): MeasurePair[] {
  return [
    {
      treble: makeStaff('t', trebleDurations, 'c/5'),
      bass: makeStaff('b', bassDurations, 'c/3'),
    },
  ]
}

function toTokens(notes: ScoreNote[]): string[] {
  return notes.map((note) => `${note.duration}${note.isRest ? 'R' : 'N'}`)
}

function runCase(test: CaseDef): { ok: boolean; message: string } {
  const pairs = makePair(test.treble, test.bass)
  const selected = pairs[0].treble[test.selectIndex]
  if (!selected) {
    return { ok: false, message: `${test.name}: invalid selectIndex` }
  }

  const activeSelection: Selection = { noteId: selected.id, staff: 'treble', keyIndex: 0 }
  const timeSignatures: TimeSignature[] = [{ beats: 4, beatType: 4 }]

  const attempt = applyPaletteDurationEdit({
    pairs,
    activeSelection,
    selectedSelections: [activeSelection],
    isSelectionVisible: true,
    importedNoteLookup: null,
    keyFifthsByMeasure: [0],
    timeSignaturesByMeasure: timeSignatures,
    action: test.action,
    importedMode: false,
  })

  if (attempt.error || !attempt.result) {
    return {
      ok: false,
      message: `${test.name}: edit failed (${attempt.error ?? 'no-result'})`,
    }
  }

  const nextPair = attempt.result.nextPairs[0]
  if (!nextPair) {
    return { ok: false, message: `${test.name}: missing next pair` }
  }

  const actualTreble = toTokens(nextPair.treble)
  const expectedTreble = test.expectedTrebleTokens
  const trebleOk = JSON.stringify(actualTreble) === JSON.stringify(expectedTreble)

  const actualBass = toTokens(nextPair.bass)
  const expectedBass = test.expectedBassTokens ?? toTokens(pairs[0].bass)
  const bassOk = JSON.stringify(actualBass) === JSON.stringify(expectedBass)

  const noDottedRest = nextPair.treble.every((note) => !note.isRest || !note.duration.endsWith('d'))

  const ok = trebleOk && bassOk && noDottedRest
  const details: string[] = []
  if (!trebleOk) details.push(`treble expected=${expectedTreble.join(' | ')} actual=${actualTreble.join(' | ')}`)
  if (!bassOk) details.push(`bass expected=${expectedBass.join(' | ')} actual=${actualBass.join(' | ')}`)
  if (!noDottedRest) details.push('found dotted rest in output')

  return {
    ok,
    message: ok
      ? `${test.name}: PASS -> ${actualTreble.join(' | ')}`
      : `${test.name}: FAIL -> ${details.join(' ; ')}`,
  }
}

const cases: CaseDef[] = [
  {
    name: 'w -> 16 (rest regroup no-dot, beat-safe)',
    treble: ['w'],
    bass: ['q', 'q', 'q', 'q'],
    selectIndex: 0,
    action: { type: 'duration', targetDuration: '16' },
    expectedTrebleTokens: ['16N', '16R', '8R', 'qR', 'hR'],
    expectedBassTokens: ['qN', 'qN', 'qN', 'qN'],
  },
  {
    name: 'qd -> 8 (cross-beat rest split)',
    treble: ['qd', '8'],
    bass: ['q', 'q', 'q', 'q'],
    selectIndex: 0,
    action: { type: 'duration', targetDuration: '8' },
    expectedTrebleTokens: ['8N', '8R', '8R', '8N'],
  },
  {
    name: 'qd -> 16 (no dotted rest, prefer within beat)',
    treble: ['qd', '8'],
    bass: ['q', 'q', 'q', 'q'],
    selectIndex: 0,
    action: { type: 'duration', targetDuration: '16' },
    expectedTrebleTokens: ['16N', '16R', '8R', '8R', '8N'],
  },
  {
    name: '16 -> 8 with boundary note split',
    treble: ['16', '16', 'qd'],
    bass: ['q', 'q', 'q', 'q'],
    selectIndex: 1,
    action: { type: 'duration', targetDuration: '8' },
    expectedTrebleTokens: ['16N', '8N', '16N', 'qN'],
  },
  {
    name: '16 -> 8 only boundary block regroup, tail untouched',
    treble: ['16', '16', 'qd', '16', 'q', '8d'],
    bass: ['q', 'q', 'q', 'q'],
    selectIndex: 1,
    action: { type: 'duration', targetDuration: '8' },
    expectedTrebleTokens: ['16N', '8N', '16N', 'qN', '16N', 'qN', '8dN'],
  },
]

let passCount = 0
for (const test of cases) {
  const result = runCase(test)
  console.log(result.message)
  if (result.ok) passCount += 1
}

console.log(`\nSummary: ${passCount}/${cases.length} passed`)
if (passCount !== cases.length) {
  process.exitCode = 1
}
