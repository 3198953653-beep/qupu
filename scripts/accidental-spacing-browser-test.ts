import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
}

type DumpAccidentalCoord = {
  keyIndex: number
  columnIndex?: number | null
  reason?: string | null
  columnBaseLeftX?: number | null
  columnTargetLeftX?: number | null
  columnAppliedDeltaX?: number | null
  columnCountMeasured?: number | null
  leftMostMeasured?: number | null
  rightX: number
  leftX?: number | null
  visualRightX?: number | null
  accidentalVisualLeftXExact?: number | null
  accidentalVisualRightXExact?: number | null
  ownHeadLeftXExact?: number | null
  ownGapPxExact?: number | null
}

type DumpNoteRow = {
  staff: 'treble' | 'bass'
  noteIndex: number
  pitch: string | null
  isRest?: boolean
  duration?: string | null
  onsetTicksInMeasure: number | null
  visualRightX?: number | null
  noteHeads?: Array<{
    x: number
    y?: number | null
    pitch?: string | null
    keyIndex?: number | null
    hitMinX?: number | null
    hitMaxX?: number | null
  }>
  accidentalCoords?: DumpAccidentalCoord[]
}

type DumpSpacingSegment = {
  fromOnsetTicks: number
  toOnsetTicks: number
  extraReservePx?: number | null
  accidentalRequestedExtraPx?: number | null
  accidentalVisibleGapPx?: number | null
}

type MeasureDumpRow = {
  pairIndex: number
  measureX?: number | null
  measureWidth?: number | null
  effectiveBoundaryStartX?: number | null
  effectiveBoundaryEndX?: number | null
  notes: DumpNoteRow[]
  spacingSegments?: DumpSpacingSegment[]
}

type MeasureDump = {
  rows: MeasureDumpRow[]
}

type DurationCode = '32' | '16' | '8' | '4' | '2' | '1'

type FixtureScenario =
  | {
      key: string
      kind: 'inner'
      expectedExtra: 'positive' | 'zero'
      previousKind: 'note' | 'rest'
      targetPitch: string
      xmlText: string
    }
  | {
      key: string
      kind: 'same-onset-chord'
      targetPitch: string
      blockerPitch: string
      xmlText: string
    }
  | {
      key: string
      kind: 'previous-boundary'
      previousOnsetTicks: number
      targetOnsetTicks: number
      targetPitch: string
      xmlText: string
    }
  | {
      key: string
      kind: 'threshold-gap'
      previousOnsetTicks: number
      targetOnsetTicks: number
      targetPitch: string
      requiredGapPx: number
      expectedRequest: 'positive' | 'zero'
      maxRequestedExtraPx?: number
      xmlText: string
    }
  | {
      key: string
      kind: 'accidental-columns'
      onsetTicks: number
      expectedMaxColumns: number
      expectedPattern?: string
      expectSameColumnPitchPairs?: Array<[string, string]>
      expectDifferentColumnPitchPairs?: Array<[string, string]>
      xmlText: string
    }
  | {
      key: string
      kind: 'leading'
      targetPitch: string
      xmlText: string
    }

type InnerFixtureResult = {
  key: string
  kind: 'inner'
  targetPitch: string
  previousKind: 'note' | 'rest'
  expectedExtra: 'positive' | 'zero'
  finalGapPx: number
  accidentalRequestedExtraPx: number
  accidentalVisibleGapPx: number | null
  passed: boolean
  failureReasons: string[]
}

type LeadingFixtureResult = {
  key: string
  kind: 'leading'
  targetPitch: string
  finalGapPx: number
  passed: boolean
  failureReasons: string[]
}

type FixtureResult =
  | InnerFixtureResult
  | LeadingFixtureResult
  | SameOnsetChordFixtureResult
  | PreviousBoundaryFixtureResult
  | ThresholdGapFixtureResult
  | AccidentalColumnFixtureResult
type SameOnsetChordFixtureResult = {
  key: string
  kind: 'same-onset-chord'
  targetPitch: string
  blockerPitch: string
  finalGapPx: number
  ownGapPx: number
  passed: boolean
  failureReasons: string[]
}

type PreviousBoundaryFixtureResult = {
  key: string
  kind: 'previous-boundary'
  previousOnsetTicks: number
  targetOnsetTicks: number
  targetPitch: string
  previousOccupiedRightX: number
  minAccidentalLeftX: number
  finalGapPx: number
  passed: boolean
  failureReasons: string[]
}

type ThresholdGapFixtureResult = {
  key: string
  kind: 'threshold-gap'
  previousOnsetTicks: number
  targetOnsetTicks: number
  targetPitch: string
  requiredGapPx: number
  accidentalRequestedExtraPx: number
  accidentalVisibleGapPx: number
  expectedRequestedExtraPx: number
  finalGapPx: number
  passed: boolean
  failureReasons: string[]
}

type AccidentalColumnFixtureResult = {
  key: string
  kind: 'accidental-columns'
  onsetTicks: number
  accidentalCount: number
  columnCount: number
  maxColumnIndex: number
  passed: boolean
  failureReasons: string[]
}

type DesktopTargetResult = {
  segmentKey: string
  finalGapPx: number
  accidentalRequestedExtraPx: number
  accidentalVisibleGapPx: number | null
  passed: boolean
  failureReasons: string[]
}

type DesktopKeySignatureResult = {
  pitch: string
  onsetTicksInMeasure: number
  renderedAccidentalCount: number
  incomingAccidentalRequestedExtraPx: number
  passed: boolean
  failureReasons: string[]
}

type UserFileColumnSpreadResult = {
  checkedOnsetCount: number
  hardInfeasibleCount: number
  conflictSameColumnCount: number
  overlapConflictCount: number
  passed: boolean
  failureReasons: string[]
}

type UserFileHardConstraintResult = {
  checkedAccidentalCount: number
  ownGapViolationCount: number
  blockerOverlapViolationCount: number
  previousGapViolationCount: number
  passed: boolean
  failureReasons: string[]
}

type FinalReport = {
  generatedAt: string
  xmlPath: string
  desktopTarget: DesktopTargetResult
  desktopKeySignatureCases: DesktopKeySignatureResult[]
  fixtureResults: FixtureResult[]
  userFileBeat2ToBeat3Boundary: PreviousBoundaryFixtureResult | null
  userFileColumnSpread: UserFileColumnSpreadResult | null
  userFileHardConstraints: UserFileHardConstraintResult | null
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4186
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const DEFAULT_XML_PATH = String.raw`C:\Users\76743\Desktop\1234.musicxml`
const ACCIDENTAL_SAFE_GAP_PX = 1
const ACCIDENTAL_COLUMN_SAFE_GAP_PX = 1
const ACCIDENTAL_OWN_HEAD_SAFE_GAP_PX = 2
const ACCIDENTAL_BLOCKER_SAFE_GAP_PX = 0
const SAME_ONSET_VISIBILITY_TOLERANCE_PX = 2
const GAP_EPSILON_PX = 0.15
const LEADING_MAX_GAP_PX = 2.2
const APPROX_ACCIDENTAL_WIDTH_PX = 9
const APPROX_NOTEHEAD_WIDTH_PX = 9
const DEFAULT_LEADING_BARLINE_GAP_PX = 9.7
const USER_FILE_BEAT_BOUNDARY_NAME = '二度变音记号问题.musicxml'
const USER_FILE_COLUMN_SPREAD_NAME = '变音记号问题.musicxml'

function durationTypeFromCode(durationCode: DurationCode): 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' {
  switch (durationCode) {
    case '1':
      return 'whole'
    case '2':
      return 'half'
    case '4':
      return 'quarter'
    case '8':
      return 'eighth'
    case '16':
      return '16th'
    case '32':
      return '32nd'
  }
}

function durationTicksFromCode(durationCode: DurationCode): number {
  switch (durationCode) {
    case '1':
      return 32
    case '2':
      return 16
    case '4':
      return 8
    case '8':
      return 4
    case '16':
      return 2
    case '32':
      return 1
  }
}

function buildRestXml(durationCode: DurationCode, staff: 1 | 2, voice = 1): string {
  return [
    '      <note>',
    '        <rest/>',
    `        <duration>${durationTicksFromCode(durationCode)}</duration>`,
    `        <voice>${voice}</voice>`,
    `        <type>${durationTypeFromCode(durationCode)}</type>`,
    `        <staff>${staff}</staff>`,
    '      </note>',
  ].join('\n')
}

function buildPitchNoteXml(params: {
  durationCode: DurationCode
  step: string
  octave: number
  alter?: -2 | -1 | 1 | 2
  accidentalText?: string
  stem?: 'up' | 'down'
}): string {
  const { durationCode, step, octave, alter, accidentalText, stem } = params
  const resolvedAccidentalText =
    accidentalText ??
    (alter === 2
      ? 'double-sharp'
      : alter === 1
        ? 'sharp'
        : alter === -1
          ? 'flat'
          : alter === -2
            ? 'flat-flat'
            : null)
  return [
    '      <note>',
    '        <pitch>',
    `          <step>${step}</step>`,
    ...(typeof alter === 'number' ? [`          <alter>${alter}</alter>`] : []),
    `          <octave>${octave}</octave>`,
    '        </pitch>',
    ...(resolvedAccidentalText ? [`        <accidental>${resolvedAccidentalText}</accidental>`] : []),
    `        <duration>${durationTicksFromCode(durationCode)}</duration>`,
    '        <voice>1</voice>',
    `        <type>${durationTypeFromCode(durationCode)}</type>`,
    ...(stem ? [`        <stem>${stem}</stem>`] : []),
    '        <staff>1</staff>',
    '      </note>',
  ].join('\n')
}

function buildChordPitchNoteXml(params: {
  durationCode: DurationCode
  step: string
  octave: number
  alter?: -2 | -1 | 1 | 2
  accidentalText?: string
  stem?: 'up' | 'down'
}): string {
  const { durationCode, step, octave, alter, accidentalText, stem } = params
  const resolvedAccidentalText =
    accidentalText ??
    (alter === 2
      ? 'double-sharp'
      : alter === 1
        ? 'sharp'
        : alter === -1
          ? 'flat'
          : alter === -2
            ? 'flat-flat'
            : null)
  return [
    '      <note>',
    '        <chord/>',
    '        <pitch>',
    `          <step>${step}</step>`,
    ...(typeof alter === 'number' ? [`          <alter>${alter}</alter>`] : []),
    `          <octave>${octave}</octave>`,
    '        </pitch>',
    ...(resolvedAccidentalText ? [`        <accidental>${resolvedAccidentalText}</accidental>`] : []),
    `        <duration>${durationTicksFromCode(durationCode)}</duration>`,
    '        <voice>1</voice>',
    `        <type>${durationTypeFromCode(durationCode)}</type>`,
    ...(stem ? [`        <stem>${stem}</stem>`] : []),
    '        <staff>1</staff>',
    '      </note>',
  ].join('\n')
}

function buildRemainingTrebleRestsXml(remainingTicks: number): string[] {
  const restDurations: Array<{ code: DurationCode; ticks: number }> = [
    { code: '1', ticks: 32 },
    { code: '2', ticks: 16 },
    { code: '4', ticks: 8 },
    { code: '8', ticks: 4 },
    { code: '16', ticks: 2 },
    { code: '32', ticks: 1 },
  ]
  let restTicks = Math.max(0, remainingTicks)
  const xml: string[] = []
  restDurations.forEach((restDuration) => {
    while (restTicks >= restDuration.ticks) {
      xml.push(buildRestXml(restDuration.code, 1))
      restTicks -= restDuration.ticks
    }
  })
  if (restTicks !== 0) {
    throw new Error(`Failed to build filler rests for ${remainingTicks} ticks`)
  }
  return xml
}

function buildFixtureXml(events: string[]): string {
  const totalTicks = events.reduce((sum, event) => {
    if (event.includes('<chord/>')) return sum
    const match = event.match(/<duration>(\d+)<\/duration>/)
    return sum + Number(match?.[1] ?? 0)
  }, 0)
  if (totalTicks !== 32) {
    throw new Error(`Fixture must sum to 32 ticks, received ${totalTicks}`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC
  "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>8</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
${events.join('\n')}
${buildRestXml('1', 2)}
    </measure>
  </part>
</score-partwise>`
}

const FIXTURE_SCENARIOS: FixtureScenario[] = [
  {
    key: 'fixture-note-to-accidental-tight',
    kind: 'inner',
    expectedExtra: 'positive',
    previousKind: 'note',
    targetPitch: 'F#4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '32', step: 'E', octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '32', step: 'F', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(30),
    ]),
  },
  {
    key: 'fixture-rest-to-accidental-tight',
    kind: 'inner',
    expectedExtra: 'positive',
    previousKind: 'rest',
    targetPitch: 'G#4',
    xmlText: buildFixtureXml([
      buildRestXml('16', 1),
      buildPitchNoteXml({ durationCode: '4', step: 'G', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(22),
    ]),
  },
  {
    key: 'fixture-leading-boundary-accidental',
    kind: 'leading',
    targetPitch: 'Bbb4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({
        durationCode: '4',
        step: 'B',
        alter: -2,
        accidentalText: 'flat-flat',
        octave: 4,
        stem: 'up',
      }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
  {
    key: 'fixture-note-to-accidental-safe',
    kind: 'inner',
    expectedExtra: 'zero',
    previousKind: 'note',
    targetPitch: 'C#5',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '2', step: 'E', octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '2', step: 'C', alter: 1, octave: 5, stem: 'up' }),
    ]),
  },
  {
    key: 'fixture-same-onset-second-chord-accidental-clamp',
    kind: 'same-onset-chord',
    targetPitch: 'D#5',
    blockerPitch: 'C5',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '2', step: 'B', octave: 4, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      ...buildRemainingTrebleRestsXml(8),
    ]),
  },
  {
    key: 'fixture-same-onset-stem-up-accidental-clamp',
    kind: 'same-onset-chord',
    targetPitch: 'A#4',
    blockerPitch: 'G4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'E', octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(16),
    ]),
  },
  {
    key: 'fixture-user-file-first-measure-beat1',
    kind: 'same-onset-chord',
    targetPitch: 'D#5',
    blockerPitch: 'C5',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(16),
    ]),
  },
  {
    key: 'fixture-user-file-first-measure-beat2',
    kind: 'same-onset-chord',
    targetPitch: 'A#4',
    blockerPitch: 'G4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(16),
    ]),
  },
  {
    key: 'fixture-user-file-beat2-to-beat3-previous-boundary',
    kind: 'previous-boundary',
    previousOnsetTicks: 16,
    targetOnsetTicks: 32,
    targetPitch: 'B#4',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '4', step: 'B', alter: 1, octave: 4, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', octave: 5, stem: 'down' }),
    ]),
  },
  {
    key: 'fixture-second-chord-threshold-g4a4',
    kind: 'threshold-gap',
    previousOnsetTicks: 16,
    targetOnsetTicks: 32,
    targetPitch: 'B#4',
    requiredGapPx: 3,
    expectedRequest: 'positive',
    maxRequestedExtraPx: 28,
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '4', step: 'B', alter: 1, octave: 4, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', octave: 5, stem: 'down' }),
    ]),
  },
  {
    key: 'fixture-second-chord-threshold-g4b4',
    kind: 'threshold-gap',
    previousOnsetTicks: 16,
    targetOnsetTicks: 32,
    targetPitch: 'B#4',
    requiredGapPx: 1,
    expectedRequest: 'positive',
    maxRequestedExtraPx: 28,
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'G', octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'B', octave: 4, stem: 'up' }),
      buildPitchNoteXml({ durationCode: '4', step: 'B', alter: 1, octave: 4, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 5, stem: 'down' }),
      buildPitchNoteXml({ durationCode: '4', step: 'C', octave: 5, stem: 'down' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', octave: 5, stem: 'down' }),
    ]),
  },
  {
    key: 'fixture-accidental-columns-interval-second',
    kind: 'accidental-columns',
    onsetTicks: 0,
    expectedMaxColumns: 6,
    expectedPattern: '12',
    expectDifferentColumnPitchPairs: [['C#4', 'D#4']],
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
  {
    key: 'fixture-accidental-columns-interval-sixth',
    kind: 'accidental-columns',
    onsetTicks: 0,
    expectedMaxColumns: 6,
    expectedPattern: '12',
    expectDifferentColumnPitchPairs: [['C#4', 'A#4']],
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
  {
    key: 'fixture-accidental-columns-interval-seventh-reuse',
    kind: 'accidental-columns',
    onsetTicks: 0,
    expectedMaxColumns: 6,
    expectSameColumnPitchPairs: [['C#4', 'B#4']],
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'B', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
  {
    key: 'fixture-accidental-columns-pattern-3',
    kind: 'accidental-columns',
    onsetTicks: 0,
    expectedMaxColumns: 6,
    expectedPattern: '213',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'E', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
  {
    key: 'fixture-accidental-columns-pattern-4',
    kind: 'accidental-columns',
    onsetTicks: 0,
    expectedMaxColumns: 6,
    expectedPattern: '2314',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'E', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'F', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
  {
    key: 'fixture-accidental-columns-pattern-5',
    kind: 'accidental-columns',
    onsetTicks: 0,
    expectedMaxColumns: 6,
    expectedPattern: '32415',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'E', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'F', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'G', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
  {
    key: 'fixture-accidental-columns-pattern-6',
    kind: 'accidental-columns',
    onsetTicks: 0,
    expectedMaxColumns: 6,
    expectedPattern: '342516',
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'E', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'F', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'G', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
  {
    key: 'fixture-accidental-columns-overflow-8',
    kind: 'accidental-columns',
    onsetTicks: 0,
    expectedMaxColumns: 6,
    expectSameColumnPitchPairs: [
      ['C#4', 'B#4'],
      ['D#4', 'C#5'],
    ],
    xmlText: buildFixtureXml([
      buildPitchNoteXml({ durationCode: '4', step: 'C', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'D', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'E', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'F', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'G', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'A', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'B', alter: 1, octave: 4, stem: 'up' }),
      buildChordPitchNoteXml({ durationCode: '4', step: 'C', alter: 1, octave: 5, stem: 'up' }),
      ...buildRemainingTrebleRestsXml(24),
    ]),
  },
]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    server.once('exit', () => resolve())
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
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // retry
    }
    await sleep(350)
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

async function waitForDebugApi(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api = (window as unknown as { __scoreDebug?: Record<string, unknown> }).__scoreDebug
      return (
        !!api &&
        typeof api.importMusicXmlText === 'function' &&
        typeof api.dumpAllMeasureCoordinates === 'function' &&
        typeof api.getImportFeedback === 'function' &&
        typeof api.setAutoScaleEnabled === 'function' &&
        typeof api.setManualScalePercent === 'function'
      )
    },
    undefined,
    { timeout: 120000 },
  )
}

async function setScoreScale(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        setAutoScaleEnabled: (next: boolean) => void
        setManualScalePercent: (next: number) => void
      }
    }).__scoreDebug
    api.setAutoScaleEnabled(false)
    api.setManualScalePercent(100)
  })
}

async function clickButton(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label }).first()
  await button.click()
}

async function ensureSpacingPanelOpen(page: Page): Promise<void> {
  const slider = page.locator('#duration-base-gap-32')
  if (await slider.isVisible().catch(() => false)) return
  await clickButton(page, '间距大小')
  await slider.waitFor()
}

async function setRangeValue(page: Page, selector: string, value: number): Promise<void> {
  const input = page.locator(selector).first()
  await input.waitFor()
  await input.evaluate((element, nextValue) => {
    const target = element as HTMLInputElement
    target.value = String(nextValue)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function setLeadingBarlineGapPx(page: Page, nextValue: number): Promise<void> {
  await ensureSpacingPanelOpen(page)
  await setRangeValue(page, '#leading-barline-gap-range', nextValue)
  await page.waitForTimeout(150)
}

async function importMusicXml(page: Page, xmlText: string): Promise<void> {
  await page.evaluate((text) => {
    const api = (window as unknown as {
      __scoreDebug: { importMusicXmlText: (value: string) => void }
    }).__scoreDebug
    api.importMusicXmlText(text)
  }, xmlText)

  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __scoreDebug: { getImportFeedback: () => ImportFeedback }
      }).__scoreDebug
      return api.getImportFeedback().kind === 'success'
    },
    undefined,
    { timeout: 120000 },
  )
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
    }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

function normalizePitch(pitch: string | null | undefined): string {
  return (pitch ?? '').replace(/[^A-Ga-g#bxB0-9-]/g, '').toUpperCase()
}

const DIATONIC_STEP_INDEX: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
}

type OnsetAccidentalEntry = {
  pitch: string
  keyIndex: number
  columnIndex: number | null
  reason: string | null
  leftX: number
  rightX: number
}

function resolveDiatonicOrdinalFromPitchText(pitch: string | null | undefined): number | null {
  const normalized = normalizePitch(pitch)
  if (!normalized) return null
  const step = normalized[0]
  const stepIndex = DIATONIC_STEP_INDEX[step]
  if (!Number.isFinite(stepIndex)) return null
  const octaveMatch = normalized.match(/-?\d+$/)
  if (!octaveMatch) return null
  const octave = Number(octaveMatch[0])
  if (!Number.isFinite(octave)) return null
  return octave * 7 + stepIndex
}

function resolveAccidentalBounds(accidental: DumpAccidentalCoord): { leftX: number; rightX: number } | null {
  const leftX =
    typeof accidental.accidentalVisualLeftXExact === 'number' && Number.isFinite(accidental.accidentalVisualLeftXExact)
      ? accidental.accidentalVisualLeftXExact
      : typeof accidental.leftX === 'number' && Number.isFinite(accidental.leftX)
        ? accidental.leftX
        : typeof accidental.rightX === 'number' && Number.isFinite(accidental.rightX)
          ? accidental.rightX - APPROX_ACCIDENTAL_WIDTH_PX
          : Number.NaN
  const rightX =
    typeof accidental.accidentalVisualRightXExact === 'number' && Number.isFinite(accidental.accidentalVisualRightXExact)
      ? accidental.accidentalVisualRightXExact
      : typeof accidental.visualRightX === 'number' && Number.isFinite(accidental.visualRightX)
        ? accidental.visualRightX
        : typeof accidental.rightX === 'number' && Number.isFinite(accidental.rightX)
          ? accidental.rightX
          : Number.isFinite(leftX)
            ? leftX + APPROX_ACCIDENTAL_WIDTH_PX
            : Number.NaN
  if (!Number.isFinite(leftX) || !Number.isFinite(rightX)) return null
  return {
    leftX,
    rightX,
  }
}

function collectTrebleOnsetAccidentals(params: {
  row: MeasureDumpRow
  onsetTicks: number
}): OnsetAccidentalEntry[] {
  const { row, onsetTicks } = params
  const entries: OnsetAccidentalEntry[] = []
  row.notes
    .filter(
      (note) =>
        note.staff === 'treble' &&
        typeof note.onsetTicksInMeasure === 'number' &&
        Math.round(note.onsetTicksInMeasure) === onsetTicks,
    )
    .forEach((note) => {
      ;(note.accidentalCoords ?? []).forEach((accidental) => {
        const bounds = resolveAccidentalBounds(accidental)
        if (!bounds) return
        const headPitch =
          (note.noteHeads ?? []).find(
            (head) =>
              typeof head.keyIndex === 'number' && Number.isFinite(head.keyIndex) && head.keyIndex === accidental.keyIndex,
          )?.pitch ?? note.pitch
        const pitchText = typeof headPitch === 'string' ? headPitch : note.pitch
        if (!pitchText) return
        const columnIndex =
          typeof accidental.columnIndex === 'number' && Number.isFinite(accidental.columnIndex)
            ? Math.max(0, Math.round(accidental.columnIndex))
            : null
        entries.push({
          pitch: pitchText,
          keyIndex: accidental.keyIndex,
          columnIndex,
          reason: typeof accidental.reason === 'string' ? accidental.reason : null,
          leftX: bounds.leftX,
          rightX: bounds.rightX,
        })
      })
    })
  return entries
}

function assertFinite(value: number | null | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is not finite`)
  }
  return value
}

function sortTrebleNotes(row: MeasureDumpRow): DumpNoteRow[] {
  return row.notes
    .filter((note) => note.staff === 'treble')
    .slice()
    .sort((left, right) => {
      const leftOnset = left.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
      const rightOnset = right.onsetTicksInMeasure ?? Number.POSITIVE_INFINITY
      if (leftOnset !== rightOnset) return leftOnset - rightOnset
      return left.noteIndex - right.noteIndex
    })
}

function buildSegmentsByKey(row: MeasureDumpRow): Map<string, DumpSpacingSegment> {
  return new Map(
    (row.spacingSegments ?? []).map((segment) => [`${segment.fromOnsetTicks}-${segment.toOnsetTicks}`, segment]),
  )
}

function getAccidentalLeftX(note: DumpNoteRow): number | null {
  const accidentalCoords = note.accidentalCoords ?? []
  const leftX = accidentalCoords.reduce((minValue, accidental) => {
    const candidate =
      typeof accidental.leftX === 'number' && Number.isFinite(accidental.leftX)
        ? accidental.leftX
        : Number.isFinite(accidental.rightX)
          ? accidental.rightX - APPROX_ACCIDENTAL_WIDTH_PX
          : Number.POSITIVE_INFINITY
    return Math.min(minValue, candidate)
  }, Number.POSITIVE_INFINITY)
  return Number.isFinite(leftX) ? leftX : null
}

function getAccidentalRightX(note: DumpNoteRow): number | null {
  const accidentalCoords = note.accidentalCoords ?? []
  const rightX = accidentalCoords.reduce((maxValue, accidental) => {
    const leftX =
      typeof accidental.accidentalVisualLeftXExact === 'number' && Number.isFinite(accidental.accidentalVisualLeftXExact)
        ? accidental.accidentalVisualLeftXExact
        : typeof accidental.leftX === 'number' && Number.isFinite(accidental.leftX)
        ? accidental.leftX
        : Number.isFinite(accidental.rightX)
          ? accidental.rightX - APPROX_ACCIDENTAL_WIDTH_PX
          : Number.NaN
    const candidate =
      typeof accidental.accidentalVisualRightXExact === 'number' && Number.isFinite(accidental.accidentalVisualRightXExact)
        ? accidental.accidentalVisualRightXExact
        : typeof accidental.visualRightX === 'number' && Number.isFinite(accidental.visualRightX)
        ? accidental.visualRightX
        : Number.isFinite(leftX)
          ? leftX + APPROX_ACCIDENTAL_WIDTH_PX
          : Number.NEGATIVE_INFINITY
    return Math.max(maxValue, candidate)
  }, Number.NEGATIVE_INFINITY)
  return Number.isFinite(rightX) ? rightX : null
}

function getNoteOccupiedRightX(note: DumpNoteRow): number | null {
  const headRightX = (note.noteHeads ?? []).reduce((maxValue, head) => {
    const resolvedRightX = resolveNoteHeadRightWithSanity(head)
    if (resolvedRightX === null || !Number.isFinite(resolvedRightX)) return maxValue
    return Math.max(maxValue, resolvedRightX)
  }, Number.NEGATIVE_INFINITY)
  const accidentalRightX = getAccidentalRightX(note)
  const occupiedRightX = Math.max(
    headRightX,
    typeof accidentalRightX === 'number' && Number.isFinite(accidentalRightX)
      ? accidentalRightX
      : Number.NEGATIVE_INFINITY,
  )
  if (Number.isFinite(occupiedRightX)) {
    return occupiedRightX
  }
  const visualRightX =
    typeof note.visualRightX === 'number' && Number.isFinite(note.visualRightX)
      ? note.visualRightX
      : null
  return visualRightX
}

function resolveNoteHeadLeftWithSanity(head: {
  x?: number | null
  hitMinX?: number | null
} | null): number | null {
  if (!head) return null
  const hitMinX =
    typeof head.hitMinX === 'number' && Number.isFinite(head.hitMinX)
      ? head.hitMinX
      : null
  const headX = typeof head.x === 'number' && Number.isFinite(head.x) ? head.x : null
  return hitMinX ?? headX
}

function resolveNoteHeadRightWithSanity(head: {
  x?: number | null
  hitMinX?: number | null
  hitMaxX?: number | null
} | null): number | null {
  if (!head) return null
  const leftX = resolveNoteHeadLeftWithSanity(head)
  const hitMaxX =
    typeof head.hitMaxX === 'number' && Number.isFinite(head.hitMaxX)
      ? head.hitMaxX
      : null
  if (leftX !== null && hitMaxX !== null && hitMaxX >= leftX) {
    return hitMaxX
  }
  return leftX !== null ? leftX + APPROX_NOTEHEAD_WIDTH_PX : hitMaxX
}

function resolveNoteHeadBoundsByPitch(params: {
  note: DumpNoteRow
  pitch: string
}): { leftX: number; rightX: number } | null {
  const { note, pitch } = params
  const normalizedPitch = normalizePitch(pitch)
  const noteHead =
    (note.noteHeads ?? []).find((head) => normalizePitch(head.pitch) === normalizedPitch) ??
    null
  if (!noteHead) {
    return null
  }
  const leftX = resolveNoteHeadLeftWithSanity(noteHead)
  const rightX =
    resolveNoteHeadRightWithSanity(noteHead) ??
    (leftX !== null ? leftX + APPROX_NOTEHEAD_WIDTH_PX : null)
  if (leftX === null || rightX === null) {
    return null
  }
  return {
    leftX,
    rightX,
  }
}

function resolveOwnNoteHeadLeftX(params: {
  note: DumpNoteRow
  targetPitch: string
  keyIndex: number
}): number | null {
  const { note, targetPitch, keyIndex } = params
  const ownHeadLeftXExact = (note.accidentalCoords ?? []).find((entry) => entry.keyIndex === keyIndex)?.ownHeadLeftXExact
  if (typeof ownHeadLeftXExact === 'number' && Number.isFinite(ownHeadLeftXExact)) {
    return ownHeadLeftXExact
  }
  const noteHeads = note.noteHeads ?? []
  const byKeyIndex = noteHeads.find(
    (head) => typeof head.keyIndex === 'number' && Number.isFinite(head.keyIndex) && head.keyIndex === keyIndex,
  )
  if (byKeyIndex) {
    const resolvedLeftX = resolveNoteHeadLeftWithSanity(byKeyIndex)
    if (resolvedLeftX !== null) {
      return resolvedLeftX
    }
  }
  const normalizedTargetPitch = normalizePitch(targetPitch)
  const byPitch = noteHeads.find((head) => normalizePitch(head.pitch) === normalizedTargetPitch)
  if (byPitch) {
    const resolvedLeftX = resolveNoteHeadLeftWithSanity(byPitch)
    if (resolvedLeftX !== null) {
      return resolvedLeftX
    }
  }
  const fallback = noteHeads.reduce((maxValue, head) => {
    if (typeof head.x !== 'number' || !Number.isFinite(head.x)) return maxValue
    return Math.max(maxValue, head.x)
  }, Number.NEGATIVE_INFINITY)
  return Number.isFinite(fallback) ? fallback : null
}

function resolveOwnNoteHeadVisibleLeftX(params: {
  note: DumpNoteRow
  targetPitch: string
  keyIndex: number
}): number | null {
  const { note, targetPitch, keyIndex } = params
  const noteHeads = note.noteHeads ?? []
  const byKeyIndex = noteHeads.find(
    (head) => typeof head.keyIndex === 'number' && Number.isFinite(head.keyIndex) && head.keyIndex === keyIndex,
  )
  if (byKeyIndex) {
    const resolvedLeftX = resolveNoteHeadLeftWithSanity(byKeyIndex)
    if (resolvedLeftX !== null) {
      return resolvedLeftX
    }
  }
  const normalizedTargetPitch = normalizePitch(targetPitch)
  const byPitch = noteHeads.find((head) => normalizePitch(head.pitch) === normalizedTargetPitch)
  if (byPitch) {
    const resolvedLeftX = resolveNoteHeadLeftWithSanity(byPitch)
    if (resolvedLeftX !== null) {
      return resolvedLeftX
    }
  }
  return null
}

function findTrebleNoteByPitch(row: MeasureDumpRow, pitch: string): DumpNoteRow | null {
  const normalizedPitch = normalizePitch(pitch)
  return (
    sortTrebleNotes(row).find((note) => {
      if (normalizePitch(note.pitch) === normalizedPitch) return true
      return (note.noteHeads ?? []).some((head) => normalizePitch(head.pitch) === normalizedPitch)
    }) ?? null
  )
}

function analyzeInnerFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'inner' }>
}): InnerFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const trebleNotes = sortTrebleNotes(row)
  const targetIndex = trebleNotes.findIndex((note) => normalizePitch(note.pitch) === normalizePitch(scenario.targetPitch))
  if (targetIndex <= 0) {
    throw new Error(`[${scenario.key}] Could not find target note ${scenario.targetPitch}`)
  }
  const previousNote = trebleNotes[targetIndex - 1]!
  const targetNote = trebleNotes[targetIndex]!
  const previousKind = previousNote.isRest === true ? 'rest' : 'note'
  if (previousKind !== scenario.previousKind) {
    failures.push(`previous-kind-mismatch:${previousKind}!=${scenario.previousKind}`)
  }

  const previousOnset = previousNote.onsetTicksInMeasure
  const targetOnset = targetNote.onsetTicksInMeasure
  if (typeof previousOnset !== 'number' || typeof targetOnset !== 'number') {
    throw new Error(`[${scenario.key}] Missing onset ticks for target pair`)
  }
  const segment = buildSegmentsByKey(row).get(`${previousOnset}-${targetOnset}`)
  if (!segment) {
    throw new Error(`[${scenario.key}] Missing spacing segment ${previousOnset}-${targetOnset}`)
  }

  const accidentalLeftX = assertFinite(getAccidentalLeftX(targetNote), `${scenario.key}.accidentalLeftX`)
  const previousOccupiedRightX = assertFinite(
    targetIndex > 0 ? getNoteOccupiedRightX(previousNote) : null,
    `${scenario.key}.previousOccupiedRightX`,
  )
  const finalGapPx = accidentalLeftX - previousOccupiedRightX
  const accidentalRequestedExtraPx = assertFinite(
    segment.accidentalRequestedExtraPx ?? 0,
    `${scenario.key}.segment.accidentalRequestedExtraPx`,
  )
  const accidentalVisibleGapPx =
    typeof segment.accidentalVisibleGapPx === 'number' && Number.isFinite(segment.accidentalVisibleGapPx)
      ? segment.accidentalVisibleGapPx
      : null

  if (finalGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`final-gap-too-small:${finalGapPx.toFixed(3)}`)
  }

  if (scenario.expectedExtra === 'positive') {
    if (accidentalRequestedExtraPx <= GAP_EPSILON_PX) {
      failures.push(`expected-positive-extra-missing:${accidentalRequestedExtraPx.toFixed(3)}`)
    }
    if (accidentalVisibleGapPx === null || accidentalVisibleGapPx >= ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
      failures.push(`expected-tight-pre-gap-missing:${accidentalVisibleGapPx ?? 'null'}`)
    }
  } else {
    if (accidentalRequestedExtraPx > GAP_EPSILON_PX) {
      failures.push(`unexpected-extra:${accidentalRequestedExtraPx.toFixed(3)}`)
    }
    if (accidentalVisibleGapPx !== null && accidentalVisibleGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
      failures.push(`unexpected-tight-pre-gap:${accidentalVisibleGapPx.toFixed(3)}`)
    }
  }

  return {
    key: scenario.key,
    kind: 'inner',
    targetPitch: scenario.targetPitch,
    previousKind: scenario.previousKind,
    expectedExtra: scenario.expectedExtra,
    finalGapPx: Number(finalGapPx.toFixed(3)),
    accidentalRequestedExtraPx: Number(accidentalRequestedExtraPx.toFixed(3)),
    accidentalVisibleGapPx:
      typeof accidentalVisibleGapPx === 'number' ? Number(accidentalVisibleGapPx.toFixed(3)) : null,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeLeadingFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'leading' }>
}): LeadingFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const targetNote =
    findTrebleNoteByPitch(row, scenario.targetPitch) ??
    sortTrebleNotes(row).find((note) => (note.accidentalCoords?.length ?? 0) > 0) ??
    null
  if (!targetNote) {
    throw new Error(`[${scenario.key}] Could not find target note ${scenario.targetPitch}`)
  }
  const accidentalLeftX = assertFinite(getAccidentalLeftX(targetNote), `${scenario.key}.accidentalLeftX`)
  const boundaryStartX = assertFinite(row.effectiveBoundaryStartX, `${scenario.key}.effectiveBoundaryStartX`)
  const finalGapPx = accidentalLeftX - boundaryStartX

  if (finalGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`final-gap-too-small:${finalGapPx.toFixed(3)}`)
  }
  if (finalGapPx > LEADING_MAX_GAP_PX) {
    failures.push(`final-gap-too-large:${finalGapPx.toFixed(3)}`)
  }

  return {
    key: scenario.key,
    kind: 'leading',
    targetPitch: scenario.targetPitch,
    finalGapPx: Number(finalGapPx.toFixed(3)),
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeSameOnsetChordFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'same-onset-chord' }>
}): SameOnsetChordFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const targetNote =
    findTrebleNoteByPitch(row, scenario.targetPitch) ??
    sortTrebleNotes(row).find((note) => (note.accidentalCoords?.length ?? 0) > 0) ??
    null
  const blockerNote = findTrebleNoteByPitch(row, scenario.blockerPitch)
  if (!targetNote) {
    throw new Error(`[${scenario.key}] Could not find target note ${scenario.targetPitch}`)
  }
  if (!blockerNote) {
    failures.push(`blocker-note-not-found:${scenario.blockerPitch}`)
  }
  if (
    blockerNote &&
    typeof targetNote.onsetTicksInMeasure === 'number' &&
    typeof blockerNote.onsetTicksInMeasure === 'number' &&
    targetNote.onsetTicksInMeasure !== blockerNote.onsetTicksInMeasure
  ) {
    failures.push(`onset-mismatch:${targetNote.onsetTicksInMeasure}!=${blockerNote.onsetTicksInMeasure}`)
  }

  const targetAccidental = (targetNote.accidentalCoords ?? [])[0] ?? null
  if (!targetAccidental) {
    throw new Error(`[${scenario.key}] Missing accidental coords for ${scenario.targetPitch}`)
  }
  const accidentalRightX = assertFinite(
    typeof targetAccidental.accidentalVisualRightXExact === 'number' &&
      Number.isFinite(targetAccidental.accidentalVisualRightXExact)
      ? targetAccidental.accidentalVisualRightXExact
      : getAccidentalRightX(targetNote),
    `${scenario.key}.accidentalRightX`,
  )
  const accidentalLeftX = assertFinite(
    typeof targetAccidental.accidentalVisualLeftXExact === 'number' &&
      Number.isFinite(targetAccidental.accidentalVisualLeftXExact)
      ? targetAccidental.accidentalVisualLeftXExact
      : getAccidentalLeftX(targetNote),
    `${scenario.key}.accidentalLeftX`,
  )
  const ownHeadLeftX = assertFinite(
    resolveOwnNoteHeadLeftX({
      note: targetNote,
      targetPitch: scenario.targetPitch,
      keyIndex: targetAccidental.keyIndex,
    }),
    `${scenario.key}.ownHeadLeftX`,
  )
  const ownHeadVisibleLeftX = resolveOwnNoteHeadVisibleLeftX({
    note: targetNote,
    targetPitch: scenario.targetPitch,
    keyIndex: targetAccidental.keyIndex,
  })
  const ownHeadExactFromAccidental =
    typeof targetAccidental.ownHeadLeftXExact === 'number' && Number.isFinite(targetAccidental.ownHeadLeftXExact)
      ? targetAccidental.ownHeadLeftXExact
      : null
  if (
    typeof ownHeadExactFromAccidental === 'number' &&
    Number.isFinite(ownHeadExactFromAccidental) &&
    typeof ownHeadVisibleLeftX === 'number' &&
    Number.isFinite(ownHeadVisibleLeftX) &&
    Math.abs(ownHeadExactFromAccidental - ownHeadVisibleLeftX) > 0.5 + GAP_EPSILON_PX
  ) {
    failures.push(
      `own-head-exact-mismatch:exact=${ownHeadExactFromAccidental.toFixed(3)} visible=${ownHeadVisibleLeftX.toFixed(3)}`,
    )
  }
  const blockerHeadBounds = blockerNote
    ? resolveNoteHeadBoundsByPitch({
        note: blockerNote,
        pitch: scenario.blockerPitch,
      })
    : null
  if (!blockerHeadBounds) {
    failures.push(`blocker-head-bounds-not-found:${scenario.blockerPitch}`)
  }
  const blockerHeadLeftX = blockerHeadBounds?.leftX ?? Number.NaN
  const blockerHeadRightX = blockerHeadBounds?.rightX ?? Number.NaN
  const finalGapPx = Number.isFinite(blockerHeadLeftX)
    ? blockerHeadLeftX - accidentalRightX
    : Number.NaN
  const overlapsBlockerHead =
    Number.isFinite(blockerHeadLeftX) &&
    Number.isFinite(blockerHeadRightX) &&
    accidentalRightX > blockerHeadLeftX + ACCIDENTAL_BLOCKER_SAFE_GAP_PX + GAP_EPSILON_PX &&
    accidentalLeftX < blockerHeadRightX - ACCIDENTAL_BLOCKER_SAFE_GAP_PX - GAP_EPSILON_PX
  if (Number.isFinite(finalGapPx)) {
    const blockerGapIndicatesOverlap = finalGapPx < -GAP_EPSILON_PX
    if (overlapsBlockerHead !== blockerGapIndicatesOverlap) {
      failures.push(
        `blocker-gap-geometry-mismatch:gap=${finalGapPx.toFixed(3)} overlap=${String(overlapsBlockerHead)}`,
      )
    }
  }
  if (overlapsBlockerHead) {
    failures.push(
      `blocker-head-overlap:left=${accidentalLeftX.toFixed(3)} right=${accidentalRightX.toFixed(3)} blocker=[${blockerHeadLeftX.toFixed(3)},${blockerHeadRightX.toFixed(3)}]`,
    )
  }
  const ownHeadGapPx = ownHeadLeftX - accidentalRightX
  const ownGapExact =
    typeof targetAccidental.ownGapPxExact === 'number' && Number.isFinite(targetAccidental.ownGapPxExact)
      ? targetAccidental.ownGapPxExact
      : null
  if (
    typeof ownGapExact === 'number' &&
    Number.isFinite(ownGapExact) &&
    Math.abs(ownGapExact - ownHeadGapPx) > 0.5 + GAP_EPSILON_PX
  ) {
    failures.push(`own-gap-exact-mismatch:exact=${ownGapExact.toFixed(3)} measured=${ownHeadGapPx.toFixed(3)}`)
  }
  const ownGapForAssertion =
    typeof ownGapExact === 'number' && Number.isFinite(ownGapExact)
      ? ownGapExact
      : ownHeadGapPx
  if (
    typeof ownGapExact === 'number' &&
    Number.isFinite(ownGapExact) &&
    ownHeadGapPx < ACCIDENTAL_OWN_HEAD_SAFE_GAP_PX - GAP_EPSILON_PX &&
    ownGapExact >= ACCIDENTAL_OWN_HEAD_SAFE_GAP_PX - GAP_EPSILON_PX
  ) {
    failures.push(`own-gap-truth-mismatch:exact=${ownGapExact.toFixed(3)} measured=${ownHeadGapPx.toFixed(3)}`)
  }
  if (ownGapForAssertion < ACCIDENTAL_OWN_HEAD_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`own-gap-too-small:${ownGapForAssertion.toFixed(3)}`)
  }

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
        ? row.effectiveBoundaryStartX
      : typeof row.measureX === 'number' && Number.isFinite(row.measureX)
        ? row.measureX
        : null
  const leftVisibilityAllowancePx = APPROX_ACCIDENTAL_WIDTH_PX + SAME_ONSET_VISIBILITY_TOLERANCE_PX
  if (boundaryStartX !== null && accidentalLeftX < boundaryStartX - leftVisibilityAllowancePx) {
    failures.push(
      `accidental-left-outside-measure:${accidentalLeftX.toFixed(3)}<${(boundaryStartX - leftVisibilityAllowancePx).toFixed(3)}`,
    )
  }

  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
        ? row.effectiveBoundaryEndX
      : typeof row.measureX === 'number' &&
          Number.isFinite(row.measureX) &&
          typeof row.measureWidth === 'number' &&
          Number.isFinite(row.measureWidth)
        ? row.measureX + row.measureWidth
        : null
  if (boundaryEndX !== null && accidentalRightX > boundaryEndX + SAME_ONSET_VISIBILITY_TOLERANCE_PX) {
    failures.push(
      `accidental-right-outside-measure:${accidentalRightX.toFixed(3)}>${(boundaryEndX + SAME_ONSET_VISIBILITY_TOLERANCE_PX).toFixed(3)}`,
    )
  }

  return {
    key: scenario.key,
    kind: 'same-onset-chord',
    targetPitch: scenario.targetPitch,
    blockerPitch: scenario.blockerPitch,
    finalGapPx: Number(finalGapPx.toFixed(3)),
    ownGapPx: Number(ownGapForAssertion.toFixed(3)),
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzePreviousBoundaryFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'previous-boundary' }>
}): PreviousBoundaryFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const trebleNotes = sortTrebleNotes(row)
  const previousOnsetNotes = trebleNotes.filter(
    (note) =>
      typeof note.onsetTicksInMeasure === 'number' &&
      Math.round(note.onsetTicksInMeasure) === scenario.previousOnsetTicks,
  )
  const targetOnsetNotes = trebleNotes.filter(
    (note) =>
      typeof note.onsetTicksInMeasure === 'number' &&
      Math.round(note.onsetTicksInMeasure) === scenario.targetOnsetTicks,
  )

  if (previousOnsetNotes.length === 0) {
    failures.push(`missing-previous-onset:${scenario.previousOnsetTicks}`)
  }
  if (targetOnsetNotes.length === 0) {
    failures.push(`missing-target-onset:${scenario.targetOnsetTicks}`)
  }

  const targetNote =
    targetOnsetNotes.find((note) => normalizePitch(note.pitch) === normalizePitch(scenario.targetPitch)) ??
    findTrebleNoteByPitch(row, scenario.targetPitch) ??
    null
  if (!targetNote) {
    failures.push(`target-note-not-found:${scenario.targetPitch}`)
  }

  const previousOccupiedRightX = previousOnsetNotes.reduce((maxValue, note) => {
    const occupiedRightX = getNoteOccupiedRightX(note)
    if (occupiedRightX === null || !Number.isFinite(occupiedRightX)) return maxValue
    return Math.max(maxValue, occupiedRightX)
  }, Number.NEGATIVE_INFINITY)
  if (!Number.isFinite(previousOccupiedRightX)) {
    failures.push('missing-previous-occupied-right-x')
  }

  const targetAccidentalLeftX = targetOnsetNotes.reduce((minValue, note) => {
    const accidentalLeftX = getAccidentalLeftX(note)
    if (accidentalLeftX === null || !Number.isFinite(accidentalLeftX)) return minValue
    return Math.min(minValue, accidentalLeftX)
  }, Number.POSITIVE_INFINITY)
  if (!Number.isFinite(targetAccidentalLeftX)) {
    failures.push('missing-target-accidental-left-x')
  }

  const finalGapPx =
    Number.isFinite(previousOccupiedRightX) && Number.isFinite(targetAccidentalLeftX)
      ? targetAccidentalLeftX - previousOccupiedRightX
      : Number.NaN
  if (Number.isFinite(finalGapPx) && finalGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`previous-boundary-gap-too-small:${finalGapPx.toFixed(3)}`)
  }

  return {
    key: scenario.key,
    kind: 'previous-boundary',
    previousOnsetTicks: scenario.previousOnsetTicks,
    targetOnsetTicks: scenario.targetOnsetTicks,
    targetPitch: scenario.targetPitch,
    previousOccupiedRightX: Number.isFinite(previousOccupiedRightX) ? Number(previousOccupiedRightX.toFixed(3)) : Number.NaN,
    minAccidentalLeftX: Number.isFinite(targetAccidentalLeftX) ? Number(targetAccidentalLeftX.toFixed(3)) : Number.NaN,
    finalGapPx: Number.isFinite(finalGapPx) ? Number(finalGapPx.toFixed(3)) : Number.NaN,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeThresholdGapFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'threshold-gap' }>
}): ThresholdGapFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const trebleNotes = sortTrebleNotes(row)
  const previousOnsetNotes = trebleNotes.filter(
    (note) =>
      typeof note.onsetTicksInMeasure === 'number' &&
      Math.round(note.onsetTicksInMeasure) === scenario.previousOnsetTicks,
  )
  const targetOnsetNotes = trebleNotes.filter(
    (note) =>
      typeof note.onsetTicksInMeasure === 'number' &&
      Math.round(note.onsetTicksInMeasure) === scenario.targetOnsetTicks,
  )
  if (previousOnsetNotes.length === 0) {
    failures.push(`missing-previous-onset:${scenario.previousOnsetTicks}`)
  }
  if (targetOnsetNotes.length === 0) {
    failures.push(`missing-target-onset:${scenario.targetOnsetTicks}`)
  }

  const targetNote =
    targetOnsetNotes.find((note) => normalizePitch(note.pitch) === normalizePitch(scenario.targetPitch)) ??
    findTrebleNoteByPitch(row, scenario.targetPitch) ??
    null
  if (!targetNote) {
    failures.push(`target-note-not-found:${scenario.targetPitch}`)
  }

  const previousOccupiedRightX = previousOnsetNotes.reduce((maxValue, note) => {
    const occupiedRightX = getNoteOccupiedRightX(note)
    if (occupiedRightX === null || !Number.isFinite(occupiedRightX)) return maxValue
    return Math.max(maxValue, occupiedRightX)
  }, Number.NEGATIVE_INFINITY)
  if (!Number.isFinite(previousOccupiedRightX)) {
    failures.push('missing-previous-occupied-right-x')
  }

  const targetAccidentalLeftX = targetOnsetNotes.reduce((minValue, note) => {
    const accidentalLeftX = getAccidentalLeftX(note)
    if (accidentalLeftX === null || !Number.isFinite(accidentalLeftX)) return minValue
    return Math.min(minValue, accidentalLeftX)
  }, Number.POSITIVE_INFINITY)
  if (!Number.isFinite(targetAccidentalLeftX)) {
    failures.push('missing-target-accidental-left-x')
  }

  const segment = (row.spacingSegments ?? []).find(
    (entry) => entry.fromOnsetTicks === scenario.previousOnsetTicks && entry.toOnsetTicks === scenario.targetOnsetTicks,
  )
  if (!segment) {
    failures.push(`missing-target-segment:${scenario.previousOnsetTicks}->${scenario.targetOnsetTicks}`)
  }
  const accidentalRequestedExtraPx =
    segment && typeof segment.accidentalRequestedExtraPx === 'number' && Number.isFinite(segment.accidentalRequestedExtraPx)
      ? segment.accidentalRequestedExtraPx
      : Number.NaN
  const accidentalVisibleGapPx =
    segment && typeof segment.accidentalVisibleGapPx === 'number' && Number.isFinite(segment.accidentalVisibleGapPx)
      ? segment.accidentalVisibleGapPx
      : Number.NaN
  if (!Number.isFinite(accidentalRequestedExtraPx)) {
    failures.push('missing-accidental-requested-extra')
  }
  if (!Number.isFinite(accidentalVisibleGapPx)) {
    failures.push('missing-accidental-visible-gap')
  }

  const expectedRequestedExtraPx =
    Number.isFinite(accidentalVisibleGapPx)
      ? Math.max(0, scenario.requiredGapPx - accidentalVisibleGapPx)
      : Number.NaN
  if (
    Number.isFinite(accidentalRequestedExtraPx) &&
    Number.isFinite(expectedRequestedExtraPx) &&
    Math.abs(accidentalRequestedExtraPx - expectedRequestedExtraPx) > GAP_EPSILON_PX
  ) {
    failures.push(`request-not-threshold-clamped:${accidentalRequestedExtraPx.toFixed(3)}!=${expectedRequestedExtraPx.toFixed(3)}`)
  }
  if (scenario.expectedRequest === 'positive' && !(accidentalRequestedExtraPx > GAP_EPSILON_PX)) {
    failures.push(`expected-positive-request-missing:${accidentalRequestedExtraPx.toFixed(3)}`)
  }
  if (scenario.expectedRequest === 'zero' && accidentalRequestedExtraPx > GAP_EPSILON_PX) {
    failures.push(`expected-zero-request-missing:${accidentalRequestedExtraPx.toFixed(3)}`)
  }
  if (
    typeof scenario.maxRequestedExtraPx === 'number' &&
    Number.isFinite(scenario.maxRequestedExtraPx) &&
    Number.isFinite(accidentalRequestedExtraPx) &&
    accidentalRequestedExtraPx > scenario.maxRequestedExtraPx + GAP_EPSILON_PX
  ) {
    failures.push(`requested-extra-too-large:${accidentalRequestedExtraPx.toFixed(3)}>${scenario.maxRequestedExtraPx.toFixed(3)}`)
  }

  const finalGapPx =
    Number.isFinite(previousOccupiedRightX) && Number.isFinite(targetAccidentalLeftX)
      ? targetAccidentalLeftX - previousOccupiedRightX
      : Number.NaN
  if (Number.isFinite(finalGapPx) && finalGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`final-gap-too-small:${finalGapPx.toFixed(3)}`)
  }

  return {
    key: scenario.key,
    kind: 'threshold-gap',
    previousOnsetTicks: scenario.previousOnsetTicks,
    targetOnsetTicks: scenario.targetOnsetTicks,
    targetPitch: scenario.targetPitch,
    requiredGapPx: scenario.requiredGapPx,
    accidentalRequestedExtraPx: Number.isFinite(accidentalRequestedExtraPx)
      ? Number(accidentalRequestedExtraPx.toFixed(3))
      : Number.NaN,
    accidentalVisibleGapPx: Number.isFinite(accidentalVisibleGapPx)
      ? Number(accidentalVisibleGapPx.toFixed(3))
      : Number.NaN,
    expectedRequestedExtraPx: Number.isFinite(expectedRequestedExtraPx)
      ? Number(expectedRequestedExtraPx.toFixed(3))
      : Number.NaN,
    finalGapPx: Number.isFinite(finalGapPx) ? Number(finalGapPx.toFixed(3)) : Number.NaN,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeAccidentalColumnFixtureScenario(params: {
  row: MeasureDumpRow
  scenario: Extract<FixtureScenario, { kind: 'accidental-columns' }>
}): AccidentalColumnFixtureResult {
  const { row, scenario } = params
  const failures: string[] = []
  const entries = collectTrebleOnsetAccidentals({
    row,
    onsetTicks: scenario.onsetTicks,
  })
  if (entries.length === 0) {
    failures.push(`missing-onset-accidentals:${scenario.onsetTicks}`)
  }
  entries.forEach((entry) => {
    if (typeof entry.columnIndex !== 'number' || !Number.isFinite(entry.columnIndex)) {
      failures.push(`missing-column-index:${entry.pitch}[${entry.keyIndex}]`)
    }
  })

  const columnIndices = entries
    .map((entry) => entry.columnIndex)
    .filter((columnIndex): columnIndex is number => typeof columnIndex === 'number' && Number.isFinite(columnIndex))
  const distinctColumns = new Set<number>(columnIndices)
  const maxColumnIndex =
    columnIndices.length > 0 ? Math.max(...columnIndices) : Number.NaN
  if (distinctColumns.size > scenario.expectedMaxColumns) {
    failures.push(`column-count-too-large:${distinctColumns.size}>${scenario.expectedMaxColumns}`)
  }

  const entriesWithOrdinal = entries
    .map((entry) => ({
      ...entry,
      diatonicOrdinal: resolveDiatonicOrdinalFromPitchText(entry.pitch),
    }))
    .filter((entry) => typeof entry.diatonicOrdinal === 'number' && Number.isFinite(entry.diatonicOrdinal))
    .sort((left, right) => {
      if (left.diatonicOrdinal !== right.diatonicOrdinal) {
        return left.diatonicOrdinal - right.diatonicOrdinal
      }
      return left.keyIndex - right.keyIndex
    })

  if (scenario.expectedPattern) {
    const expectedLength = scenario.expectedPattern.length
    if (entriesWithOrdinal.length < expectedLength) {
      failures.push(`pattern-entry-count-too-small:${entriesWithOrdinal.length}<${expectedLength}`)
    } else {
      const actualPattern = entriesWithOrdinal
        .slice(0, expectedLength)
        .map((entry) =>
          typeof entry.columnIndex === 'number' && Number.isFinite(entry.columnIndex)
            ? String(entry.columnIndex + 1)
            : '?',
        )
        .join('')
      if (actualPattern !== scenario.expectedPattern) {
        failures.push(`column-pattern-mismatch:${actualPattern}!=${scenario.expectedPattern}`)
      }
    }
  }

  const resolveEntryByPitch = (pitch: string): (typeof entriesWithOrdinal)[number] | null => {
    const normalizedPitch = normalizePitch(pitch)
    return entriesWithOrdinal.find((entry) => normalizePitch(entry.pitch) === normalizedPitch) ?? null
  }

  scenario.expectSameColumnPitchPairs?.forEach(([leftPitch, rightPitch]) => {
    const leftEntry = resolveEntryByPitch(leftPitch)
    const rightEntry = resolveEntryByPitch(rightPitch)
    if (!leftEntry || !rightEntry) {
      failures.push(`same-column-pair-not-found:${leftPitch},${rightPitch}`)
      return
    }
    if (leftEntry.columnIndex !== rightEntry.columnIndex) {
      failures.push(
        `same-column-violation:${leftPitch}[${leftEntry.columnIndex}]!=${rightPitch}[${rightEntry.columnIndex}]`,
      )
    }
  })

  scenario.expectDifferentColumnPitchPairs?.forEach(([leftPitch, rightPitch]) => {
    const leftEntry = resolveEntryByPitch(leftPitch)
    const rightEntry = resolveEntryByPitch(rightPitch)
    if (!leftEntry || !rightEntry) {
      failures.push(`different-column-pair-not-found:${leftPitch},${rightPitch}`)
      return
    }
    if (leftEntry.columnIndex === rightEntry.columnIndex) {
      failures.push(`different-column-violation:${leftPitch},${rightPitch}`)
    }
  })

  for (let left = 0; left < entriesWithOrdinal.length; left += 1) {
    const leftEntry = entriesWithOrdinal[left]!
    for (let right = left + 1; right < entriesWithOrdinal.length; right += 1) {
      const rightEntry = entriesWithOrdinal[right]!
      const diatonicDistance = Math.abs(rightEntry.diatonicOrdinal - leftEntry.diatonicOrdinal)
      if (diatonicDistance < 1 || diatonicDistance > 5) continue
      if (leftEntry.columnIndex === rightEntry.columnIndex) {
        failures.push(`conflict-same-column:${leftEntry.pitch},${rightEntry.pitch}`)
        continue
      }
      const horizontalGap = Math.max(
        rightEntry.leftX - leftEntry.rightX,
        leftEntry.leftX - rightEntry.rightX,
      )
      if (horizontalGap < ACCIDENTAL_COLUMN_SAFE_GAP_PX - GAP_EPSILON_PX) {
        failures.push(`conflict-gap-too-small:${leftEntry.pitch},${rightEntry.pitch}:${horizontalGap.toFixed(3)}`)
      }
    }
  }

  if (distinctColumns.size > 1) {
    const distinctVisualLeftX = entriesWithOrdinal
      .map((entry) => entry.leftX)
      .sort((left, right) => left - right)
      .reduce<number[]>((result, value) => {
        const last = result[result.length - 1]
        if (typeof last !== 'number' || Math.abs(value - last) > 0.5) {
          result.push(value)
        }
        return result
      }, [])
    if (distinctVisualLeftX.length < 2) {
      failures.push(`column-visual-collapse:${distinctVisualLeftX.length}<2`)
    }
  }

  return {
    key: scenario.key,
    kind: 'accidental-columns',
    onsetTicks: scenario.onsetTicks,
    accidentalCount: entries.length,
    columnCount: distinctColumns.size,
    maxColumnIndex: Number.isFinite(maxColumnIndex) ? Number(maxColumnIndex.toFixed(3)) : Number.NaN,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeUserFileColumnSpread(params: {
  dump: MeasureDump
}): UserFileColumnSpreadResult {
  const { dump } = params
  const failures: string[] = []
  let checkedOnsetCount = 0
  let hardInfeasibleCount = 0
  let conflictSameColumnCount = 0
  let overlapConflictCount = 0

  dump.rows.forEach((row) => {
    const trebleOnsets = [...new Set(
      row.notes
        .filter(
          (note) =>
            note.staff === 'treble' &&
            typeof note.onsetTicksInMeasure === 'number' &&
            Number.isFinite(note.onsetTicksInMeasure),
        )
        .map((note) => Math.round(note.onsetTicksInMeasure as number)),
    )]
      .sort((left, right) => left - right)

    trebleOnsets.forEach((onsetTicks) => {
      const entries = collectTrebleOnsetAccidentals({
        row,
        onsetTicks,
      })
      if (entries.length <= 1) return
      const distinctColumns = new Set(
        entries
          .map((entry) => entry.columnIndex)
          .filter((columnIndex): columnIndex is number => typeof columnIndex === 'number' && Number.isFinite(columnIndex)),
      )

      const entriesWithOrdinal = entries
        .map((entry) => ({
          ...entry,
          diatonicOrdinal: resolveDiatonicOrdinalFromPitchText(entry.pitch),
        }))
        .filter((entry) => typeof entry.diatonicOrdinal === 'number' && Number.isFinite(entry.diatonicOrdinal))
      const hardInfeasibleTagged = entries.some((entry) => {
        const reason = typeof entry.reason === 'string' ? entry.reason : ''
        return reason.includes('hard-infeasible')
      })
      if (hardInfeasibleTagged) {
        hardInfeasibleCount += 1
        failures.push(`pair${row.pairIndex}-onset${onsetTicks}:hard-infeasible`)
      }

      for (let left = 0; left < entriesWithOrdinal.length; left += 1) {
        const leftEntry = entriesWithOrdinal[left]!
        for (let right = left + 1; right < entriesWithOrdinal.length; right += 1) {
          const rightEntry = entriesWithOrdinal[right]!
          const diatonicDistance = Math.abs(rightEntry.diatonicOrdinal - leftEntry.diatonicOrdinal)
          if (diatonicDistance < 1 || diatonicDistance > 5) continue
          if (leftEntry.columnIndex === rightEntry.columnIndex) {
            conflictSameColumnCount += 1
            failures.push(`pair${row.pairIndex}-onset${onsetTicks}:conflict-same-column:${leftEntry.pitch},${rightEntry.pitch}`)
            continue
          }
          const horizontalOverlap =
            leftEntry.rightX > rightEntry.leftX + GAP_EPSILON_PX &&
            leftEntry.leftX < rightEntry.rightX - GAP_EPSILON_PX
          if (horizontalOverlap) {
            overlapConflictCount += 1
            failures.push(`pair${row.pairIndex}-onset${onsetTicks}:conflict-overlap:${leftEntry.pitch},${rightEntry.pitch}`)
          }
        }
      }

      checkedOnsetCount += 1
      if (distinctColumns.size > 1) {
        const distinctVisualLeftX = entries
          .map((entry) => entry.leftX)
          .sort((left, right) => left - right)
          .reduce<number[]>((result, value) => {
            const last = result[result.length - 1]
            if (typeof last !== 'number' || Math.abs(value - last) > 0.5) {
              result.push(value)
            }
            return result
          }, [])
        const minimumDistinctVisualColumns = Math.min(distinctColumns.size, 3)
        if (distinctVisualLeftX.length < minimumDistinctVisualColumns) {
          failures.push(
            `pair${row.pairIndex}-onset${onsetTicks}:visual-columns-${distinctVisualLeftX.length}<${minimumDistinctVisualColumns}`,
          )
        }
      }
    })
  })

  return {
    checkedOnsetCount,
    hardInfeasibleCount,
    conflictSameColumnCount,
    overlapConflictCount,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeUserFileHardConstraints(params: {
  dump: MeasureDump
}): UserFileHardConstraintResult {
  const { dump } = params
  const failures: string[] = []
  let checkedAccidentalCount = 0
  let ownGapViolationCount = 0
  let blockerOverlapViolationCount = 0
  let previousGapViolationCount = 0

  const targetRows = (dump.rows ?? []).filter(
    (row) => row && (row.pairIndex === 0 || row.pairIndex === 1),
  )
  targetRows.forEach((row) => {
    const trebleNotes = row.notes.filter((note) => note.staff === 'treble')
    const onsetTicksList = [...new Set(
      trebleNotes
        .map((note) =>
          typeof note.onsetTicksInMeasure === 'number' && Number.isFinite(note.onsetTicksInMeasure)
            ? Math.round(note.onsetTicksInMeasure)
            : null,
        )
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    )].sort((left, right) => left - right)
    trebleNotes.forEach((note) => {
        const noteHeads = note.noteHeads ?? []
        const accidentalCoords = note.accidentalCoords ?? []
        const noteOnsetTicks =
          typeof note.onsetTicksInMeasure === 'number' && Number.isFinite(note.onsetTicksInMeasure)
            ? Math.round(note.onsetTicksInMeasure)
            : null
        const previousOnsetTicks =
          typeof noteOnsetTicks === 'number'
            ? onsetTicksList.filter((onset) => onset < noteOnsetTicks).slice(-1)[0] ?? null
            : null
        const previousOnsetNotes =
          typeof previousOnsetTicks === 'number'
            ? trebleNotes.filter((candidate) => {
                const candidateOnset =
                  typeof candidate.onsetTicksInMeasure === 'number' && Number.isFinite(candidate.onsetTicksInMeasure)
                    ? Math.round(candidate.onsetTicksInMeasure)
                    : null
                return candidateOnset === previousOnsetTicks
              })
            : []
        const previousOccupiedRightX = previousOnsetNotes.reduce((maxValue, previousNote) => {
          const occupiedRight = getNoteOccupiedRightX(previousNote)
          if (occupiedRight === null || !Number.isFinite(occupiedRight)) return maxValue
          return Math.max(maxValue, occupiedRight)
        }, Number.NEGATIVE_INFINITY)
        accidentalCoords.forEach((accidental) => {
          checkedAccidentalCount += 1
          const ownHead =
            noteHeads.find(
              (head) =>
                typeof head.keyIndex === 'number' &&
                Number.isFinite(head.keyIndex) &&
                head.keyIndex === accidental.keyIndex,
            ) ?? null
          const ownPitch = ownHead?.pitch ?? note.pitch
          const ownOrdinal = resolveDiatonicOrdinalFromPitchText(ownPitch)
          const ownHeadLeftX = resolveNoteHeadLeftWithSanity(ownHead)
          const accidentalBounds = resolveAccidentalBounds(accidental)

          const ownGapMeasured =
            typeof accidental.ownGapPxExact === 'number' && Number.isFinite(accidental.ownGapPxExact)
              ? accidental.ownGapPxExact
              : ownHeadLeftX !== null && accidentalBounds
                ? ownHeadLeftX - accidentalBounds.rightX
                : Number.NaN
          if (Number.isFinite(ownGapMeasured) && ownGapMeasured < ACCIDENTAL_OWN_HEAD_SAFE_GAP_PX - GAP_EPSILON_PX) {
            ownGapViolationCount += 1
            failures.push(
              `pair${row.pairIndex}-onset${note.onsetTicksInMeasure}-key${accidental.keyIndex}:own-gap-too-small:${Number(ownGapMeasured).toFixed(3)}`,
            )
          }

          if (!accidentalBounds || typeof ownOrdinal !== 'number' || !Number.isFinite(ownOrdinal)) {
            return
          }

          if (Number.isFinite(previousOccupiedRightX)) {
            const previousGapPx = accidentalBounds.leftX - previousOccupiedRightX
            if (previousGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
              previousGapViolationCount += 1
              failures.push(
                `pair${row.pairIndex}-onset${note.onsetTicksInMeasure}-key${accidental.keyIndex}:previous-gap-too-small:${previousGapPx.toFixed(3)}`,
              )
            }
          }

          noteHeads.forEach((blockerHead) => {
            if (
              typeof blockerHead.keyIndex === 'number' &&
              Number.isFinite(blockerHead.keyIndex) &&
              blockerHead.keyIndex === accidental.keyIndex
            ) {
              return
            }
            const blockerPitch = blockerHead.pitch
            const blockerOrdinal = resolveDiatonicOrdinalFromPitchText(blockerPitch)
            if (typeof blockerOrdinal !== 'number' || !Number.isFinite(blockerOrdinal)) return
            const diatonicDistance = Math.abs(blockerOrdinal - ownOrdinal)
            if (diatonicDistance < 1 || diatonicDistance > 5) return
            const blockerLeftX = resolveNoteHeadLeftWithSanity(blockerHead)
            const blockerRightX = resolveNoteHeadRightWithSanity(blockerHead)
            if (blockerLeftX === null || blockerRightX === null) return
            const horizontalOverlap =
              accidentalBounds.rightX > blockerLeftX + GAP_EPSILON_PX &&
              accidentalBounds.leftX < blockerRightX - GAP_EPSILON_PX
            if (horizontalOverlap) {
              blockerOverlapViolationCount += 1
              failures.push(
                `pair${row.pairIndex}-onset${note.onsetTicksInMeasure}-key${accidental.keyIndex}:blocker-overlap:${ownPitch},${blockerPitch}`,
              )
            }
          })
        })
      })
  })

  return {
    checkedAccidentalCount,
    ownGapViolationCount,
    blockerOverlapViolationCount,
    previousGapViolationCount,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeFixtureScenario(row: MeasureDumpRow, scenario: FixtureScenario): FixtureResult {
  if (scenario.kind === 'leading') {
    return analyzeLeadingFixtureScenario({
      row,
      scenario,
    })
  }
  if (scenario.kind === 'threshold-gap') {
    return analyzeThresholdGapFixtureScenario({
      row,
      scenario,
    })
  }
  if (scenario.kind === 'accidental-columns') {
    return analyzeAccidentalColumnFixtureScenario({
      row,
      scenario,
    })
  }
  if (scenario.kind === 'previous-boundary') {
    return analyzePreviousBoundaryFixtureScenario({
      row,
      scenario,
    })
  }
  if (scenario.kind === 'same-onset-chord') {
    return analyzeSameOnsetChordFixtureScenario({
      row,
      scenario,
    })
  }
  return analyzeInnerFixtureScenario({
    row,
    scenario,
  })
}

function analyzeDesktopTarget(row: MeasureDumpRow): DesktopTargetResult {
  const failures: string[] = []
  const segmentKey = '48-52'
  const segmentsByKey = buildSegmentsByKey(row)
  const segment = segmentsByKey.get(segmentKey)
  if (!segment) {
    throw new Error(`[desktop] Missing target spacing segment ${segmentKey}`)
  }
  const trebleNotes = sortTrebleNotes(row)
  const previousNote = trebleNotes.find((note) => note.onsetTicksInMeasure === 48) ?? null
  const currentNote = trebleNotes.find((note) => note.onsetTicksInMeasure === 52) ?? null
  if (!previousNote || !currentNote) {
    throw new Error('[desktop] Could not find target treble notes for 48->52 segment')
  }
  const accidentalLeftX = assertFinite(getAccidentalLeftX(currentNote), 'desktop.target.accidentalLeftX')
  const previousOccupiedRightX = assertFinite(getNoteOccupiedRightX(previousNote), 'desktop.previous.occupiedRightX')
  const finalGapPx = accidentalLeftX - previousOccupiedRightX
  const accidentalRequestedExtraPx = assertFinite(
    segment.accidentalRequestedExtraPx ?? 0,
    'desktop.segment.accidentalRequestedExtraPx',
  )
  const accidentalVisibleGapPx =
    typeof segment.accidentalVisibleGapPx === 'number' && Number.isFinite(segment.accidentalVisibleGapPx)
      ? segment.accidentalVisibleGapPx
      : null

  if (accidentalRequestedExtraPx <= GAP_EPSILON_PX) {
    failures.push(`expected-positive-extra-missing:${accidentalRequestedExtraPx.toFixed(3)}`)
  }
  if (finalGapPx < ACCIDENTAL_SAFE_GAP_PX - GAP_EPSILON_PX) {
    failures.push(`final-gap-too-small:${finalGapPx.toFixed(3)}`)
  }

  return {
    segmentKey,
    finalGapPx: Number(finalGapPx.toFixed(3)),
    accidentalRequestedExtraPx: Number(accidentalRequestedExtraPx.toFixed(3)),
    accidentalVisibleGapPx:
      typeof accidentalVisibleGapPx === 'number' ? Number(accidentalVisibleGapPx.toFixed(3)) : null,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeDesktopKeySignatureCases(row: MeasureDumpRow): DesktopKeySignatureResult[] {
  const trebleNotes = sortTrebleNotes(row)
  const segmentsByKey = buildSegmentsByKey(row)

  return ['G#5', 'C#5'].map((pitch) => {
    const failures: string[] = []
    const note = trebleNotes.find((entry) => normalizePitch(entry.pitch) === normalizePitch(pitch))
    if (!note) {
      throw new Error(`[desktop] Could not find key-signature pitch ${pitch}`)
    }
    const renderedAccidentalCount = note.accidentalCoords?.length ?? 0
    if (renderedAccidentalCount !== 0) {
      failures.push(`unexpected-rendered-accidental:${renderedAccidentalCount}`)
    }
    const noteIndex = trebleNotes.findIndex((entry) => entry === note)
    const previousNote = noteIndex > 0 ? trebleNotes[noteIndex - 1] ?? null : null
    let incomingAccidentalRequestedExtraPx = 0
    if (
      previousNote &&
      typeof previousNote.onsetTicksInMeasure === 'number' &&
      typeof note.onsetTicksInMeasure === 'number'
    ) {
      const segment = segmentsByKey.get(`${previousNote.onsetTicksInMeasure}-${note.onsetTicksInMeasure}`)
      incomingAccidentalRequestedExtraPx = assertFinite(
        segment?.accidentalRequestedExtraPx ?? 0,
        `[desktop] ${pitch} accidentalRequestedExtraPx`,
      )
      if (incomingAccidentalRequestedExtraPx > GAP_EPSILON_PX) {
        failures.push(`unexpected-extra:${incomingAccidentalRequestedExtraPx.toFixed(3)}`)
      }
    }
    return {
      pitch,
      onsetTicksInMeasure: assertFinite(note.onsetTicksInMeasure, `[desktop] ${pitch} onsetTicksInMeasure`),
      renderedAccidentalCount,
      incomingAccidentalRequestedExtraPx: Number(incomingAccidentalRequestedExtraPx.toFixed(3)),
      passed: failures.length === 0,
      failureReasons: failures,
    }
  })
}

async function runFixtureScenario(page: Page, scenario: FixtureScenario): Promise<FixtureResult> {
  await setLeadingBarlineGapPx(
    page,
    scenario.kind === 'leading' ? 0 : DEFAULT_LEADING_BARLINE_GAP_PX,
  )
  await importMusicXml(page, scenario.xmlText)
  await page.waitForTimeout(400)
  const dump = await dumpAllMeasureCoordinates(page)
  const firstRow = dump.rows[0]
  if (!firstRow) {
    throw new Error(`[${scenario.key}] No rendered measures found`)
  }
  return analyzeFixtureScenario(firstRow, scenario)
}

async function main(): Promise<void> {
  const xmlPath = process.argv[2] || DEFAULT_XML_PATH
  const xmlText = await readFile(xmlPath, 'utf8')
  const isDefaultDesktopXml =
    path.resolve(xmlPath).toLowerCase() === path.resolve(DEFAULT_XML_PATH).toLowerCase()

  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  try {
    await waitForServer(DEV_URL, 120000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForDebugApi(page)
    await setScoreScale(page)

    await importMusicXml(page, xmlText)
    await page.waitForTimeout(1200)

    const dump = await dumpAllMeasureCoordinates(page)
    const firstRow = dump.rows[0]
    if (!firstRow) {
      throw new Error('No rendered measures found')
    }

    const desktopTarget = isDefaultDesktopXml
      ? analyzeDesktopTarget(firstRow)
      : {
          segmentKey: 'n/a',
          finalGapPx: 0,
          accidentalRequestedExtraPx: 0,
          accidentalVisibleGapPx: null,
          passed: true,
          failureReasons: [],
        }
    const desktopKeySignatureCases = isDefaultDesktopXml ? analyzeDesktopKeySignatureCases(firstRow) : []

    const fixtureResults: FixtureResult[] = []
    for (const scenario of FIXTURE_SCENARIOS) {
      fixtureResults.push(await runFixtureScenario(page, scenario))
    }

    const isUserFileBeatBoundaryCheckTarget =
      path.basename(path.resolve(xmlPath)).toLowerCase() === USER_FILE_BEAT_BOUNDARY_NAME.toLowerCase()
    const userFileBeat2ToBeat3Boundary = isUserFileBeatBoundaryCheckTarget
      ? analyzePreviousBoundaryFixtureScenario({
          row: firstRow,
          scenario: {
            key: 'user-file-first-measure-beat2-to-beat3',
            kind: 'previous-boundary',
            previousOnsetTicks: 16,
            targetOnsetTicks: 32,
            targetPitch: 'B#4',
            xmlText: '',
          },
        })
      : null
    const isUserFileColumnSpreadTarget =
      path.basename(path.resolve(xmlPath)).toLowerCase() === USER_FILE_COLUMN_SPREAD_NAME.toLowerCase()
    const userFileColumnSpread = isUserFileColumnSpreadTarget
      ? analyzeUserFileColumnSpread({
          dump,
        })
      : null
    const userFileHardConstraints = isUserFileColumnSpreadTarget
      ? analyzeUserFileHardConstraints({
          dump,
        })
      : null

    const failedDesktopCases = [
      ...(desktopTarget.passed ? [] : [`desktop-target:${desktopTarget.failureReasons.join(',')}`]),
      ...desktopKeySignatureCases
        .filter((entry) => !entry.passed)
        .map((entry) => `desktop-${entry.pitch}:${entry.failureReasons.join(',')}`),
      ...(userFileBeat2ToBeat3Boundary && !userFileBeat2ToBeat3Boundary.passed
        ? [`user-file-beat2-to-beat3:${userFileBeat2ToBeat3Boundary.failureReasons.join(',')}`]
        : []),
      ...(userFileColumnSpread && !userFileColumnSpread.passed
        ? [`user-file-column-spread:${userFileColumnSpread.failureReasons.join(',')}`]
        : []),
      ...(userFileHardConstraints && !userFileHardConstraints.passed
        ? [`user-file-hard-constraints:${userFileHardConstraints.failureReasons.join(',')}`]
        : []),
    ]
    const failedFixtures = fixtureResults
      .filter((result) => !result.passed)
      .map((result) => `[${result.key}] ${result.failureReasons.join(', ')}`)

    const userBeat1 = fixtureResults.find(
      (result): result is SameOnsetChordFixtureResult =>
        result.kind === 'same-onset-chord' && result.key === 'fixture-user-file-first-measure-beat1',
    )
    const userBeat2 = fixtureResults.find(
      (result): result is SameOnsetChordFixtureResult =>
        result.kind === 'same-onset-chord' && result.key === 'fixture-user-file-first-measure-beat2',
    )
    if (userBeat1 && userBeat2) {
      const ownGapDelta = Math.abs(userBeat1.ownGapPx - userBeat2.ownGapPx)
      console.log(
        `[user-file-own-gap-delta] beat1=${userBeat1.ownGapPx.toFixed(3)} beat2=${userBeat2.ownGapPx.toFixed(3)} delta=${ownGapDelta.toFixed(3)}`,
      )
      if (ownGapDelta > 0.5 + GAP_EPSILON_PX) {
        failedFixtures.push(
          `[user-file-own-gap-parity] beat1=${userBeat1.ownGapPx.toFixed(3)} beat2=${userBeat2.ownGapPx.toFixed(3)} delta=${ownGapDelta.toFixed(3)}`,
        )
      }
    }

    if (failedDesktopCases.length > 0 || failedFixtures.length > 0) {
      throw new Error([...failedDesktopCases, ...failedFixtures].join('\n'))
    }

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      desktopTarget,
      desktopKeySignatureCases,
      fixtureResults,
      userFileBeat2ToBeat3Boundary,
      userFileColumnSpread,
      userFileHardConstraints,
    }

    console.log(JSON.stringify(report, null, 2))
  } finally {
    if (browser) await browser.close()
    await stopDevServer(server)
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
