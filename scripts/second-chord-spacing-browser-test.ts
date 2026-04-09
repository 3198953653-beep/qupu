import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'

type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

type PagingState = {
  currentPage: number
  pageCount: number
}

type DebugScaleConfig = {
  autoScaleEnabled: boolean
  manualScalePercent: number
  scoreScale?: number
}

type StaffKind = 'treble' | 'bass'
type StaffSlotWinner = StaffKind | 'tie' | 'none'

type DumpNoteHead = {
  keyIndex: number
  pitch: string | null
  x: number
  y: number
}

type DumpNoteRow = {
  staff: StaffKind
  noteId: string
  noteIndex: number
  pitch: string | null
  duration?: string | null
  isRest?: boolean
  onsetTicksInMeasure: number | null
  x: number
  headRightX?: number | null
  dotLeftX?: number | null
  dotRightX?: number | null
  rightX?: number | null
  spacingRightX?: number | null
  noteHeads: DumpNoteHead[]
  accidentalCoords?: Array<{
    keyIndex: number
    rightX: number
    visualRightX?: number | null
    ownHeadLeftXExact?: number | null
    ownGapPxExact?: number | null
  }>
}

type DumpSpacingOnsetReserve = {
  onsetTicks: number
  baseX: number | null
  finalX: number | null
  leftReservePx: number | null
  rightReservePx: number | null
  rawLeftReservePx?: number | null
  rawRightReservePx?: number | null
  leftOccupiedInsetPx?: number | null
  rightOccupiedTailPx?: number | null
  leadingTrebleRequestedExtraPx?: number | null
  leadingBassRequestedExtraPx?: number | null
  leadingWinningStaff?: StaffSlotWinner
  trailingTrebleRequestedExtraPx?: number | null
  trailingBassRequestedExtraPx?: number | null
  trailingWinningStaff?: StaffSlotWinner
}

type DumpSpacingSegment = {
  fromOnsetTicks: number
  toOnsetTicks: number
  baseGapPx: number | null
  extraReservePx: number | null
  appliedGapPx: number | null
  trebleRequestedExtraPx?: number | null
  bassRequestedExtraPx?: number | null
  noteRestRequestedExtraPx?: number | null
  noteRestVisibleGapPx?: number | null
  accidentalRequestedExtraPx?: number | null
  accidentalVisibleGapPx?: number | null
  winningStaff?: StaffSlotWinner
}

type MeasureDumpRow = {
  pairIndex: number
  rendered: boolean
  measureWidth?: number | null
  measureStartBarX?: number | null
  measureEndBarX?: number | null
  effectiveBoundaryStartX?: number | null
  effectiveBoundaryEndX?: number | null
  effectiveLeftGapPx?: number | null
  effectiveRightGapPx?: number | null
  leadingGapPx?: number | null
  trailingGapPx?: number | null
  spacingOccupiedLeftX?: number | null
  spacingOccupiedRightX?: number | null
  spacingOnsetReserves?: DumpSpacingOnsetReserve[]
  spacingSegments?: DumpSpacingSegment[]
  overflowVsNoteEndX: number | null
  overflowVsMeasureEndBarX: number | null
  notes: DumpNoteRow[]
}

type MeasureDump = {
  totalMeasureCount: number
  renderedMeasureCount: number
  rows: MeasureDumpRow[]
}

type MergedMeasureDumpRow = MeasureDumpRow & {
  renderedPageIndex: number | null
}

type ScaleCase = {
  key: string
  autoScaleEnabled: boolean
  manualScalePercent: number
}

type StaffOnsetMetrics = {
  onsetTicks: number
  baseX: number | null
  finalX: number | null
  shiftDeltaPx: number
  rawLeftReservePx: number
  rawRightReservePx: number
  leftOccupiedInsetPx: number
  rightOccupiedTailPx: number
  baseOccupiedLeftX: number | null
  baseOccupiedRightX: number | null
  finalOccupiedLeftX: number | null
  finalOccupiedRightX: number | null
}

type SlotRequestSummary = {
  requestedExtraPx: number
  winningStaff: StaffSlotWinner
}

type DesktopTargetResult = {
  pairIndex: number
  renderedPageIndex: number | null
  noteIndex: number | null
  onsetTicks: number | null
  direction: 'aligned' | 'backward' | 'forward' | 'both' | 'missing'
  headXs: number[]
  rawLeftReservePx: number | null
  rawRightReservePx: number | null
  expectedLeftRequestPx: number | null
  actualLeftRequestPx: number | null
  leftWinningStaff: StaffSlotWinner
  expectedRightRequestPx: number | null
  actualRightRequestPx: number | null
  rightWinningStaff: StaffSlotWinner
  visibleLeftGapPx: number | null
  visibleRightGapPx: number | null
  passed: boolean
  failureReasons: string[]
}

type DesktopScenarioReport = {
  key: string
  scale: DebugScaleConfig
  passed: boolean
  targets: DesktopTargetResult[]
}

type FixtureResult = {
  key: string
  scale: DebugScaleConfig
  measureWidth: number | null
  targetOnsetTicks: number | null
  direction: 'aligned' | 'backward' | 'forward' | 'both' | 'missing'
  headXs: number[]
  expectedLeftRequestPx: number | null
  actualLeftRequestPx: number | null
  leftWinningStaff: StaffSlotWinner
  expectedRightRequestPx: number | null
  actualRightRequestPx: number | null
  rightWinningStaff: StaffSlotWinner
  visibleLeftGapPx: number | null
  visibleRightGapPx: number | null
  requestedSafeGapPx?: number | null
  expectedSegmentExtraPx?: number | null
  actualSegmentExtraPx?: number | null
  rawLeftReservePx?: number | null
  leftOccupiedInsetPx?: number | null
  accidentalSegmentRequestedExtraPx?: number | null
  minOwnGapPxExact?: number | null
  passed: boolean
  failureReasons: string[]
}

type UiSafeGapScenarioResult = {
  key: string
  appliedSafeGapPx: number
  expectedLeftRequestPx: number | null
  actualLeftRequestPx: number | null
  expectedRightRequestPx: number | null
  actualRightRequestPx: number | null
  passed: boolean
  failureReasons: string[]
}

type FinalReport = {
  generatedAt: string
  xmlPath: string
  desktopScenarios: DesktopScenarioReport[]
  fixtureResults: FixtureResult[]
  uiSafeGapScenarios: UiSafeGapScenarioResult[]
}

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 4176
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`
const TARGET_PAIR_COUNT = 8
const GAP_EPSILON_PX = 0.15
const HEAD_X_EPSILON_PX = 0.01
const DEFAULT_SECOND_CHORD_SAFE_GAP_PX = 3
const ACCIDENTAL_OWN_GAP_MIN_PX = 2
const DEFAULT_NOTE_HEAD_WIDTH_PX = 9
const APPROX_ACCIDENTAL_WIDTH_PX = 8
const STEM_INVARIANT_RIGHT_PADDING_PX = 3.5
const COLLISION_RIGHT_BODY_PADDING_PX = 1.0
const DOT_NOTEHEAD_CLEARANCE_PX = 4
const DOT_GAP_PARITY_EPSILON_PX = 0.25

const SCALE_CASES: ScaleCase[] = [
  { key: 'manual-100', autoScaleEnabled: false, manualScalePercent: 100 },
  { key: 'auto-scale', autoScaleEnabled: true, manualScalePercent: 100 },
]

const FIXTURE_SCALE_CASE: ScaleCase = {
  key: 'manual-100',
  autoScaleEnabled: false,
  manualScalePercent: 100,
}

const CROSS_STAFF_FALSE_POSITIVE_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>3</duration>
        <type>eighth</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>1</duration>
        <type>16th</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>5</octave></pitch>
        <duration>8</duration>
        <type>half</type>
        <staff>1</staff>
      </note>

      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

const LOCAL_BASS_BOUNDARY_COLLISION_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
        <staff>1</staff>
      </note>

      <note>
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>A</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

const INNER_SEGMENT_NO_EXTRA_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>8</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
        <staff>1</staff>
      </note>

      <note>
        <pitch><step>C</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>D</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <rest/>
        <duration>16</duration>
        <type>whole</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <rest/>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

const INNER_SEGMENT_SAFE_GAP_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
        <staff>1</staff>
      </note>

      <note>
        <pitch><step>C</step><octave>2</octave></pitch>
        <duration>1</duration>
        <type>16th</type>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>D</step><octave>2</octave></pitch>
        <duration>1</duration>
        <type>16th</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>16th</type>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>16th</type>
        <staff>2</staff>
      </note>
      <note>
        <rest/>
        <duration>2</duration>
        <type>eighth</type>
        <staff>2</staff>
      </note>
      <note>
        <rest/>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <rest/>
        <duration>8</duration>
        <type>half</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

const TRAILING_BASS_BOUNDARY_COLLISION_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>16</duration>
        <type>whole</type>
        <staff>1</staff>
      </note>

      <note>
        <rest/>
        <duration>8</duration>
        <type>half</type>
        <staff>2</staff>
      </note>
      <note>
        <rest/>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <rest/>
        <duration>2</duration>
        <type>eighth</type>
        <staff>2</staff>
      </note>
      <note>
        <rest/>
        <duration>2</duration>
        <type>16th</type>
        <staff>2</staff>
      </note>
      <note>
        <rest/>
        <duration>1</duration>
        <type>32nd</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>2</octave></pitch>
        <duration>1</duration>
        <type>32nd</type>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>D</step><octave>2</octave></pitch>
        <duration>1</duration>
        <type>32nd</type>
        <staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>2</octave></pitch>
        <duration>1</duration>
        <type>32nd</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

const DOTTED_SECOND_CHORD_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>3</duration>
        <type>eighth</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>3</duration>
        <type>eighth</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>16th</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>8</duration>
        <type>half</type>
        <staff>1</staff>
      </note>
      <note>
        <rest/>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>

      <note>
        <rest/>
        <duration>16</duration>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

const DOTTED_BASELINE_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>3</duration>
        <type>eighth</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>16th</type>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>8</duration>
        <type>half</type>
        <staff>1</staff>
      </note>
      <note>
        <rest/>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>

      <note>
        <rest/>
        <duration>16</duration>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

const DOTTED_DIRECTION_PARITY_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <divisions>256</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>384</duration>
        <voice>1</voice>
        <type>quarter</type>
        <dot/>
        <stem>up</stem>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>384</duration>
        <type>quarter</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>384</duration>
        <type>quarter</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>128</duration>
        <voice>1</voice>
        <type>eighth</type>
        <stem>down</stem>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>384</duration>
        <voice>1</voice>
        <type>quarter</type>
        <dot/>
        <stem>down</stem>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>384</duration>
        <type>quarter</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>384</duration>
        <type>quarter</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>G</step><octave>5</octave></pitch>
        <duration>384</duration>
        <type>quarter</type>
        <dot/>
        <staff>1</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>128</duration>
        <voice>1</voice>
        <type>eighth</type>
        <staff>1</staff>
      </note>

      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>1024</duration>
        <voice>2</voice>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

function buildEnharmonicConsistencyFixtureXml(params: {
  lowerStep: 'D' | 'E'
  includePreviousNote: boolean
}): string {
  const { lowerStep, includePreviousNote } = params
  const onsetPrelude = includePreviousNote
    ? `
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>1</staff>
      </note>
`
    : ''
  const targetDurationXml = includePreviousNote
    ? `
        <duration>4</duration>
        <type>quarter</type>
`
    : `
        <duration>16</duration>
        <type>whole</type>
`
  const trailingRest = includePreviousNote
    ? `
      <note>
        <rest/>
        <duration>8</duration>
        <type>half</type>
        <staff>1</staff>
      </note>
`
    : ''
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
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>${onsetPrelude}
      <note>
        <pitch><step>${lowerStep}</step><alter>1</alter><octave>4</octave></pitch>${targetDurationXml}
        <accidental>sharp</accidental>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>C</step><alter>1</alter><octave>5</octave></pitch>${targetDurationXml}
        <accidental>sharp</accidental>
        <staff>1</staff>
      </note>${trailingRest}
    </measure>
  </part>
</score-partwise>
`
}

const ENHARMONIC_PREVIOUS_DSHARP_CSHARP_FIXTURE_XML = buildEnharmonicConsistencyFixtureXml({
  lowerStep: 'D',
  includePreviousNote: true,
})

const ENHARMONIC_PREVIOUS_ESHARP_CSHARP_FIXTURE_XML = buildEnharmonicConsistencyFixtureXml({
  lowerStep: 'E',
  includePreviousNote: true,
})

const ENHARMONIC_BARLINE_DSHARP_CSHARP_FIXTURE_XML = buildEnharmonicConsistencyFixtureXml({
  lowerStep: 'D',
  includePreviousNote: false,
})

const ENHARMONIC_BARLINE_ESHARP_CSHARP_FIXTURE_XML = buildEnharmonicConsistencyFixtureXml({
  lowerStep: 'E',
  includePreviousNote: false,
})

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
      const response = await fetch(url, { method: 'GET' })
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
        typeof api.getImportFeedback === 'function' &&
        typeof api.getPaging === 'function' &&
        typeof api.dumpAllMeasureCoordinates === 'function' &&
        typeof api.getScaleConfig === 'function' &&
        typeof api.setAutoScaleEnabled === 'function' &&
        typeof api.setManualScalePercent === 'function'
      )
    },
    undefined,
    { timeout: 120000 },
  )
}

async function waitForImportSuccess(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const api =
        (window as unknown as { __scoreDebug?: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
      if (!api || typeof api.getImportFeedback !== 'function') return false
      const feedback = api.getImportFeedback()
      return feedback.kind === 'success' || feedback.kind === 'error'
    },
    undefined,
    { timeout: 120000 },
  )

  const feedback = await page.evaluate(() => {
    const api =
      (window as unknown as { __scoreDebug: { getImportFeedback: () => ImportFeedback } }).__scoreDebug
    return api.getImportFeedback()
  })
  if (feedback.kind !== 'success') {
    throw new Error(`MusicXML import failed: ${feedback.message}`)
  }
}

async function importMusicXml(page: Page, xmlText: string): Promise<void> {
  await page.evaluate((xml) => {
    const api = (window as unknown as { __scoreDebug: { importMusicXmlText: (text: string) => void } }).__scoreDebug
    api.importMusicXmlText(xml)
  }, xmlText)
  await waitForImportSuccess(page)
}

async function setScoreScale(page: Page, params: ScaleCase): Promise<DebugScaleConfig> {
  await page.evaluate(({ enabled, percent }) => {
    const api = (window as unknown as {
      __scoreDebug: {
        setAutoScaleEnabled: (next: boolean) => void
        setManualScalePercent: (next: number) => void
      }
    }).__scoreDebug
    api.setAutoScaleEnabled(enabled)
    api.setManualScalePercent(percent)
  }, { enabled: params.autoScaleEnabled, percent: params.manualScalePercent })

  await page.waitForFunction(
    ({ enabled, percent }) => {
      const api = (window as unknown as {
        __scoreDebug: {
          getScaleConfig: () => { autoScaleEnabled: boolean; manualScalePercent: number }
        }
      }).__scoreDebug
      const next = api.getScaleConfig()
      return next.autoScaleEnabled === enabled && Math.abs(next.manualScalePercent - percent) < 0.001
    },
    { enabled: params.autoScaleEnabled, percent: params.manualScalePercent },
    { timeout: 120000 },
  )
  await page.waitForTimeout(150)
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: {
        getScaleConfig: () => { autoScaleEnabled: boolean; manualScalePercent: number; scoreScale?: number }
      }
    }).__scoreDebug
    return api.getScaleConfig()
  })
}

async function ensureGlobalSpacingPanelOpen(page: Page): Promise<void> {
  const safeGapSlider = page.locator('#second-chord-safe-gap-range')
  if ((await safeGapSlider.count()) > 0 && await safeGapSlider.first().isVisible()) {
    return
  }
  await page.getByRole('button', { name: '间距大小' }).click()
  await safeGapSlider.first().waitFor({ state: 'visible', timeout: 120000 })
}

async function setSecondChordSafeGapPx(page: Page, nextValue: number): Promise<void> {
  await ensureGlobalSpacingPanelOpen(page)
  const safeValue = Number(nextValue.toFixed(1))
  const slider = page.locator('#second-chord-safe-gap-range').first()
  await slider.evaluate((input, value) => {
    const element = input as HTMLInputElement
    element.value = String(value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, safeValue)
  await page.waitForFunction(
    (value) => {
      const input = document.querySelector('#second-chord-safe-gap-input') as HTMLInputElement | null
      if (!input) return false
      const currentValue = Number(input.value)
      return Number.isFinite(currentValue) && Math.abs(currentValue - value) < 0.001
    },
    safeValue,
    { timeout: 120000 },
  )
  await page.waitForTimeout(150)
}

async function getPaging(page: Page): Promise<PagingState> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { getPaging: () => PagingState }
    }).__scoreDebug
    return api.getPaging()
  })
}

async function dumpAllMeasureCoordinates(page: Page): Promise<MeasureDump> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __scoreDebug: { dumpAllMeasureCoordinates: () => MeasureDump }
    }).__scoreDebug
    return api.dumpAllMeasureCoordinates()
  })
}

async function collectMergedRows(page: Page): Promise<MergedMeasureDumpRow[]> {
  const paging = await getPaging(page)
  const initialDump = await dumpAllMeasureCoordinates(page)
  const renderedPageIndex = paging.currentPage
  const mergedRows = Array.from({ length: initialDump.totalMeasureCount }, (_, pairIndex) => {
    const row = initialDump.rows[pairIndex]
    if (row) {
      return {
        ...row,
        renderedPageIndex: row.rendered ? renderedPageIndex : null,
      }
    }
    return {
      pairIndex,
      rendered: false,
      renderedPageIndex: null,
      overflowVsNoteEndX: null,
      overflowVsMeasureEndBarX: null,
      notes: [],
    }
  })

  const scrollMetrics = await page.evaluate(() => {
    const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLElement | null
    if (scrollHost) {
      return {
        mode: 'host' as const,
        maxScrollLeft: Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth),
        maxScrollTop: Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight),
        clientWidth: scrollHost.clientWidth,
        clientHeight: scrollHost.clientHeight,
      }
    }
    return {
      mode: 'window' as const,
      maxScrollLeft: Math.max(
        0,
        Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - window.innerWidth,
      ),
      maxScrollTop: Math.max(
        0,
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight,
      ),
      clientWidth: window.innerWidth,
      clientHeight: window.innerHeight,
    }
  })
  const scrollLeftPositions = new Set<number>([0])
  const scrollTopPositions = new Set<number>([0])
  const horizontalStep = Math.max(1, Math.floor(scrollMetrics.clientWidth * 0.85))
  const verticalStep = Math.max(1, Math.floor(scrollMetrics.clientHeight * 0.85))
  for (let scrollLeft = 0; scrollLeft <= scrollMetrics.maxScrollLeft; scrollLeft += horizontalStep) {
    scrollLeftPositions.add(scrollLeft)
  }
  for (let scrollTop = 0; scrollTop <= scrollMetrics.maxScrollTop; scrollTop += verticalStep) {
    scrollTopPositions.add(scrollTop)
  }
  scrollLeftPositions.add(scrollMetrics.maxScrollLeft)
  scrollTopPositions.add(scrollMetrics.maxScrollTop)

  for (const scrollTop of [...scrollTopPositions].sort((left, right) => left - right)) {
    for (const scrollLeft of [...scrollLeftPositions].sort((left, right) => left - right)) {
      await page.evaluate(
        ({ mode, nextScrollLeft, nextScrollTop }) => {
          if (mode === 'host') {
            const scrollHost = document.querySelector('.score-scroll.horizontal-view') as HTMLElement | null
            scrollHost?.scrollTo({ left: nextScrollLeft, top: nextScrollTop })
            return
          }
          window.scrollTo(nextScrollLeft, nextScrollTop)
        },
        {
          mode: scrollMetrics.mode,
          nextScrollLeft: scrollLeft,
          nextScrollTop: scrollTop,
        },
      )
      await page.waitForTimeout(150)
      const dump = await dumpAllMeasureCoordinates(page)
      dump.rows.forEach((row, pairIndex) => {
        if (!row?.rendered) return
        mergedRows[pairIndex] = {
          ...row,
          renderedPageIndex,
        }
      })
    }
  }

  return mergedRows
}

function resolveDesktopXmlPath(candidatePath: string | undefined): Promise<string> {
  if (candidatePath) {
    return Promise.resolve(path.resolve(candidatePath))
  }

  const desktopDir = path.resolve(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Desktop')
  const exactPath = path.join(desktopDir, '三个声部2（D调）.musicxml')

  return readdir(desktopDir, { withFileTypes: true }).then((entries) => {
    const exactMatch = entries.find((entry) => entry.isFile() && entry.name === path.basename(exactPath))
    if (exactMatch) {
      return exactPath
    }

    const fuzzyMatch = entries.find(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.musicxml') &&
        entry.name.includes('三个声部2') &&
        entry.name.includes('D调'),
    )
    if (fuzzyMatch) {
      return path.join(desktopDir, fuzzyMatch.name)
    }

    throw new Error(`Cannot find 三个声部2（D调）.musicxml under ${desktopDir}`)
  })
}

function dedupeSortedNumbers(values: number[], epsilon: number): number[] {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Number(value.toFixed(3)))
    .sort((left, right) => left - right)
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]) > epsilon)
}

function classifyDirection(anchorX: number | null, headXs: number[]): 'aligned' | 'backward' | 'forward' | 'both' | 'missing' {
  if (anchorX === null || !Number.isFinite(anchorX) || headXs.length === 0) return 'missing'
  const hasBackward = headXs.some((headX) => headX < anchorX - HEAD_X_EPSILON_PX)
  const hasForward = headXs.some((headX) => headX > anchorX + HEAD_X_EPSILON_PX)
  if (hasBackward && hasForward) return 'both'
  if (hasBackward) return 'backward'
  if (hasForward) return 'forward'
  return 'aligned'
}

function toRoundedFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null
}

function approximatelyEqual(left: number | null, right: number | null, epsilon = GAP_EPSILON_PX): boolean {
  if (left === null || right === null) return false
  return Math.abs(left - right) <= epsilon
}

function sanitizeSpacingOnsetReserve(
  entry: DumpSpacingOnsetReserve | null | undefined,
): DumpSpacingOnsetReserve | null {
  if (!entry || !Number.isFinite(entry.onsetTicks)) return null
  return {
    onsetTicks: Math.round(entry.onsetTicks),
    baseX: toRoundedFiniteNumber(entry.baseX),
    finalX: toRoundedFiniteNumber(entry.finalX),
    leftReservePx: toRoundedFiniteNumber(entry.leftReservePx),
    rightReservePx: toRoundedFiniteNumber(entry.rightReservePx),
    rawLeftReservePx: toRoundedFiniteNumber(entry.rawLeftReservePx),
    rawRightReservePx: toRoundedFiniteNumber(entry.rawRightReservePx),
    leftOccupiedInsetPx: toRoundedFiniteNumber(entry.leftOccupiedInsetPx),
    rightOccupiedTailPx: toRoundedFiniteNumber(entry.rightOccupiedTailPx),
    leadingTrebleRequestedExtraPx: toRoundedFiniteNumber(entry.leadingTrebleRequestedExtraPx),
    leadingBassRequestedExtraPx: toRoundedFiniteNumber(entry.leadingBassRequestedExtraPx),
    leadingWinningStaff: entry.leadingWinningStaff ?? 'none',
    trailingTrebleRequestedExtraPx: toRoundedFiniteNumber(entry.trailingTrebleRequestedExtraPx),
    trailingBassRequestedExtraPx: toRoundedFiniteNumber(entry.trailingBassRequestedExtraPx),
    trailingWinningStaff: entry.trailingWinningStaff ?? 'none',
  }
}

function sanitizeSpacingSegment(entry: DumpSpacingSegment | null | undefined): DumpSpacingSegment | null {
  if (!entry || !Number.isFinite(entry.fromOnsetTicks) || !Number.isFinite(entry.toOnsetTicks)) return null
  return {
    fromOnsetTicks: Math.round(entry.fromOnsetTicks),
    toOnsetTicks: Math.round(entry.toOnsetTicks),
    baseGapPx: toRoundedFiniteNumber(entry.baseGapPx),
    extraReservePx: toRoundedFiniteNumber(entry.extraReservePx),
    appliedGapPx: toRoundedFiniteNumber(entry.appliedGapPx),
    trebleRequestedExtraPx: toRoundedFiniteNumber(entry.trebleRequestedExtraPx),
    bassRequestedExtraPx: toRoundedFiniteNumber(entry.bassRequestedExtraPx),
    noteRestRequestedExtraPx: toRoundedFiniteNumber(entry.noteRestRequestedExtraPx),
    noteRestVisibleGapPx: toRoundedFiniteNumber(entry.noteRestVisibleGapPx),
    accidentalRequestedExtraPx: toRoundedFiniteNumber(entry.accidentalRequestedExtraPx),
    accidentalVisibleGapPx: toRoundedFiniteNumber(entry.accidentalVisibleGapPx),
    winningStaff: entry.winningStaff ?? 'none',
  }
}

function getNoteOccupiedLeftX(note: DumpNoteRow): number | null {
  let minX = Number.POSITIVE_INFINITY
  note.noteHeads.forEach((head) => {
    if (Number.isFinite(head.x)) {
      minX = Math.min(minX, head.x)
    }
  })
  note.accidentalCoords?.forEach((accidental) => {
    if (Number.isFinite(accidental.rightX)) {
      minX = Math.min(minX, accidental.rightX - APPROX_ACCIDENTAL_WIDTH_PX)
    }
  })
  if (Number.isFinite(note.x)) {
    minX = Math.min(minX, note.x)
  }
  return Number.isFinite(minX) ? Number(minX.toFixed(3)) : null
}

function getNoteOccupiedRightX(note: DumpNoteRow): number | null {
  let maxX = Number.NEGATIVE_INFINITY
  if (typeof note.rightX === 'number' && Number.isFinite(note.rightX)) {
    maxX = Math.max(maxX, note.rightX)
  }
  if (typeof note.spacingRightX === 'number' && Number.isFinite(note.spacingRightX)) {
    maxX = Math.max(maxX, note.spacingRightX)
  }
  note.noteHeads.forEach((head) => {
    if (Number.isFinite(head.x)) {
      maxX = Math.max(maxX, head.x + DEFAULT_NOTE_HEAD_WIDTH_PX)
    }
  })
  if (Number.isFinite(note.x)) {
    maxX = Math.max(maxX, note.x)
  }
  return Number.isFinite(maxX) ? Number(maxX.toFixed(3)) : null
}

function getNoteRawReserveExtents(note: DumpNoteRow): { rawLeftReservePx: number; rawRightReservePx: number } {
  if (!Number.isFinite(note.x)) {
    return {
      rawLeftReservePx: 0,
      rawRightReservePx: 0,
    }
  }

  let rawLeftReservePx = 0
  let rawRightReservePx = 0
  note.noteHeads.forEach((head) => {
    if (!Number.isFinite(head.x)) return
    if (head.x < note.x - HEAD_X_EPSILON_PX) {
      rawLeftReservePx = Math.max(rawLeftReservePx, note.x - head.x)
    }
    if (head.x > note.x + HEAD_X_EPSILON_PX) {
      rawRightReservePx = Math.max(rawRightReservePx, head.x - note.x)
    }
  })
  note.accidentalCoords?.forEach((accidental) => {
    if (!Number.isFinite(accidental.rightX)) return
    const accidentalLeftX = accidental.rightX - APPROX_ACCIDENTAL_WIDTH_PX
    rawLeftReservePx = Math.max(rawLeftReservePx, note.x - accidentalLeftX)
  })
  if (typeof note.dotRightX === 'number' && Number.isFinite(note.dotRightX) && note.dotRightX > note.x + HEAD_X_EPSILON_PX) {
    rawRightReservePx = Math.max(rawRightReservePx, note.dotRightX - note.x)
  }

  return {
    rawLeftReservePx: Number(rawLeftReservePx.toFixed(3)),
    rawRightReservePx: Number(rawRightReservePx.toFixed(3)),
  }
}

function resolveWinningStaff(trebleRequestedExtraPx: number, bassRequestedExtraPx: number): StaffSlotWinner {
  const safeTrebleRequestedExtraPx = Math.max(0, trebleRequestedExtraPx)
  const safeBassRequestedExtraPx = Math.max(0, bassRequestedExtraPx)
  if (safeTrebleRequestedExtraPx <= 0 && safeBassRequestedExtraPx <= 0) return 'none'
  if (Math.abs(safeTrebleRequestedExtraPx - safeBassRequestedExtraPx) <= 0.001) return 'tie'
  return safeTrebleRequestedExtraPx > safeBassRequestedExtraPx ? 'treble' : 'bass'
}

function getSpacingOnsetReserves(row: MergedMeasureDumpRow): DumpSpacingOnsetReserve[] {
  return (row.spacingOnsetReserves ?? [])
    .map((entry) => sanitizeSpacingOnsetReserve(entry))
    .filter((entry): entry is DumpSpacingOnsetReserve => entry !== null)
    .sort((left, right) => left.onsetTicks - right.onsetTicks)
}

function getSpacingSegments(row: MergedMeasureDumpRow): DumpSpacingSegment[] {
  return (row.spacingSegments ?? [])
    .map((entry) => sanitizeSpacingSegment(entry))
    .filter((entry): entry is DumpSpacingSegment => entry !== null)
    .sort((left, right) => {
      if (left.fromOnsetTicks !== right.fromOnsetTicks) return left.fromOnsetTicks - right.fromOnsetTicks
      return left.toOnsetTicks - right.toOnsetTicks
    })
}

function buildStaffOnsetMetrics(row: MergedMeasureDumpRow, staff: StaffKind): StaffOnsetMetrics[] {
  const onsetReserveByTick = new Map<number, DumpSpacingOnsetReserve>()
  getSpacingOnsetReserves(row).forEach((entry) => {
    onsetReserveByTick.set(entry.onsetTicks, entry)
  })

  const notesByTick = new Map<number, DumpNoteRow[]>()
  row.notes.forEach((note) => {
    if (note.staff !== staff || note.isRest === true) return
    if (typeof note.onsetTicksInMeasure !== 'number' || !Number.isFinite(note.onsetTicksInMeasure)) return
    const onsetTicks = Math.round(note.onsetTicksInMeasure)
    const bucket = notesByTick.get(onsetTicks)
    if (bucket) {
      bucket.push(note)
      return
    }
    notesByTick.set(onsetTicks, [note])
  })

  return [...notesByTick.keys()]
    .sort((left, right) => left - right)
    .map((onsetTicks) => {
      const onsetNotes = notesByTick.get(onsetTicks) ?? []
      const onsetReserve = onsetReserveByTick.get(onsetTicks) ?? null
      const finalXFromNote = onsetNotes.find((note) => Number.isFinite(note.x))?.x ?? null
      const finalX = onsetReserve?.finalX ?? toRoundedFiniteNumber(finalXFromNote)
      const baseX = onsetReserve?.baseX ?? finalX
      const shiftDeltaPx =
        finalX !== null && baseX !== null ? Number((finalX - baseX).toFixed(3)) : 0

      let rawLeftReservePx = 0
      let rawRightReservePx = 0
      let finalOccupiedLeftX = Number.POSITIVE_INFINITY
      let finalOccupiedRightX = Number.NEGATIVE_INFINITY

      onsetNotes.forEach((note) => {
        const rawReserve = getNoteRawReserveExtents(note)
        rawLeftReservePx = Math.max(rawLeftReservePx, rawReserve.rawLeftReservePx)
        rawRightReservePx = Math.max(rawRightReservePx, rawReserve.rawRightReservePx)
        const occupiedLeftX = getNoteOccupiedLeftX(note)
        const occupiedRightX = getNoteOccupiedRightX(note)
        if (occupiedLeftX !== null) finalOccupiedLeftX = Math.min(finalOccupiedLeftX, occupiedLeftX)
        if (occupiedRightX !== null) finalOccupiedRightX = Math.max(finalOccupiedRightX, occupiedRightX)
      })

      const safeFinalOccupiedLeftX =
        Number.isFinite(finalOccupiedLeftX) ? Number(finalOccupiedLeftX.toFixed(3)) : finalX
      const safeFinalOccupiedRightX =
        Number.isFinite(finalOccupiedRightX) ? Number(finalOccupiedRightX.toFixed(3)) : finalX

      return {
        onsetTicks,
        baseX,
        finalX,
        shiftDeltaPx,
        rawLeftReservePx: Number(rawLeftReservePx.toFixed(3)),
        rawRightReservePx: Number(rawRightReservePx.toFixed(3)),
        leftOccupiedInsetPx: Number(
          Math.max(
            0,
            onsetReserve?.leftOccupiedInsetPx ??
              (safeFinalOccupiedLeftX !== null && finalX !== null ? finalX - safeFinalOccupiedLeftX : 0),
          ).toFixed(3),
        ),
        rightOccupiedTailPx: Number(
          Math.max(
            0,
            onsetReserve?.rightOccupiedTailPx ??
              (safeFinalOccupiedRightX !== null && finalX !== null ? safeFinalOccupiedRightX - finalX : 0),
          ).toFixed(3),
        ),
        finalOccupiedLeftX: safeFinalOccupiedLeftX,
        finalOccupiedRightX: safeFinalOccupiedRightX,
        baseOccupiedLeftX:
          safeFinalOccupiedLeftX !== null
            ? Number((safeFinalOccupiedLeftX - shiftDeltaPx).toFixed(3))
            : null,
        baseOccupiedRightX:
          safeFinalOccupiedRightX !== null
            ? Number((safeFinalOccupiedRightX - shiftDeltaPx).toFixed(3))
            : null,
      }
    })
}

function computeExpectedLeftRequestPx(
  metrics: StaffOnsetMetrics,
  previousMetrics: StaffOnsetMetrics | null,
  boundaryStartX: number | null,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): number {
  if (metrics.rawLeftReservePx <= HEAD_X_EPSILON_PX) return 0
  if (metrics.baseX === null) return 0
  const visibleLeftGapPx =
    previousMetrics && previousMetrics.baseX !== null
      ? metrics.baseX -
        previousMetrics.baseX -
        Math.max(0, previousMetrics.rawRightReservePx) -
        Math.max(0, metrics.rawLeftReservePx)
      : boundaryStartX !== null
        ? (metrics.baseX - Math.max(0, metrics.rawLeftReservePx)) - boundaryStartX
        : null
  if (visibleLeftGapPx === null) return 0
  return Number(Math.max(0, secondChordSafeGapPx - visibleLeftGapPx).toFixed(3))
}

function computeExpectedRightRequestPx(
  metrics: StaffOnsetMetrics,
  nextMetrics: StaffOnsetMetrics | null,
  boundaryEndX: number | null,
  sourceNote: DumpNoteRow | null,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): number {
  if (metrics.rawRightReservePx <= HEAD_X_EPSILON_PX) return 0
  if (metrics.baseX === null) return 0
  const visibleRightGapPx =
    nextMetrics && nextMetrics.baseX !== null
      ? nextMetrics.baseX -
        metrics.baseX -
        Math.max(0, metrics.rawRightReservePx) -
        Math.max(0, nextMetrics.rawLeftReservePx)
      : boundaryEndX !== null
        ? boundaryEndX - (metrics.baseX + Math.max(0, metrics.rawRightReservePx))
        : null
  if (visibleRightGapPx === null) return 0
  return Number(Math.max(0, secondChordSafeGapPx - visibleRightGapPx).toFixed(3))
}

function computeFinalVisibleLeftGapPx(params: {
  metrics: StaffOnsetMetrics | null
  previousMetrics: StaffOnsetMetrics | null
  boundaryStartX: number | null
  appliedExtraPx: number
}): number | null {
  const { metrics, previousMetrics, boundaryStartX, appliedExtraPx } = params
  if (!metrics || metrics.baseX === null) return null
  const baseVisibleLeftGapPx =
    previousMetrics && previousMetrics.baseX !== null
      ? metrics.baseX -
        previousMetrics.baseX -
        Math.max(0, previousMetrics.rawRightReservePx) -
        Math.max(0, metrics.rawLeftReservePx)
      : boundaryStartX !== null
        ? (metrics.baseX - Math.max(0, metrics.rawLeftReservePx)) - boundaryStartX
        : null
  if (baseVisibleLeftGapPx === null) return null
  return Number((baseVisibleLeftGapPx + Math.max(0, appliedExtraPx)).toFixed(3))
}

function computeFinalVisibleRightGapPx(params: {
  metrics: StaffOnsetMetrics | null
  nextMetrics: StaffOnsetMetrics | null
  boundaryEndX: number | null
  sourceNote: DumpNoteRow | null
  appliedExtraPx: number
}): number | null {
  const { metrics, nextMetrics, boundaryEndX, sourceNote, appliedExtraPx } = params
  if (!metrics || metrics.baseX === null) return null
  const _unusedSourceNote = sourceNote
  void _unusedSourceNote
  const baseVisibleRightGapPx =
    nextMetrics && nextMetrics.baseX !== null
      ? nextMetrics.baseX -
        metrics.baseX -
        Math.max(0, metrics.rawRightReservePx) -
        Math.max(0, nextMetrics.rawLeftReservePx)
      : boundaryEndX !== null
        ? boundaryEndX - (metrics.baseX + Math.max(0, metrics.rawRightReservePx))
        : null
  if (baseVisibleRightGapPx === null) return null
  return Number((baseVisibleRightGapPx + Math.max(0, appliedExtraPx)).toFixed(3))
}

function resolveSlotRequestSummary(params: {
  row: MergedMeasureDumpRow
  staff: StaffKind
  onsetTicks: number
  side: 'left' | 'right'
}): SlotRequestSummary {
  const onsetReserves = getSpacingOnsetReserves(params.row)
  const spacingSegments = getSpacingSegments(params.row)
  const sharedIndex = onsetReserves.findIndex((entry) => entry.onsetTicks === params.onsetTicks)
  if (sharedIndex < 0) {
    return {
      requestedExtraPx: 0,
      winningStaff: 'none',
    }
  }

  const onsetReserve = onsetReserves[sharedIndex] ?? null
  const isFirst = sharedIndex === 0
  const isLast = sharedIndex === onsetReserves.length - 1

  if (params.side === 'left') {
    if (isFirst) {
      return {
        requestedExtraPx:
          params.staff === 'treble'
            ? Math.max(0, onsetReserve?.leadingTrebleRequestedExtraPx ?? 0)
            : Math.max(0, onsetReserve?.leadingBassRequestedExtraPx ?? 0),
        winningStaff: onsetReserve?.leadingWinningStaff ?? 'none',
      }
    }
    const previousSegment =
      spacingSegments.find((segment) => segment.toOnsetTicks === params.onsetTicks) ?? null
    return {
      requestedExtraPx:
        params.staff === 'treble'
          ? Math.max(0, previousSegment?.trebleRequestedExtraPx ?? 0)
          : Math.max(0, previousSegment?.bassRequestedExtraPx ?? 0),
      winningStaff: previousSegment?.winningStaff ?? 'none',
    }
  }

  if (isLast) {
    return {
      requestedExtraPx:
        params.staff === 'treble'
          ? Math.max(0, onsetReserve?.trailingTrebleRequestedExtraPx ?? 0)
          : Math.max(0, onsetReserve?.trailingBassRequestedExtraPx ?? 0),
      winningStaff: onsetReserve?.trailingWinningStaff ?? 'none',
    }
  }
  const nextSegment =
    spacingSegments.find((segment) => segment.fromOnsetTicks === params.onsetTicks) ?? null
  return {
    requestedExtraPx:
      params.staff === 'treble'
        ? Math.max(0, nextSegment?.trebleRequestedExtraPx ?? 0)
        : Math.max(0, nextSegment?.bassRequestedExtraPx ?? 0),
    winningStaff: nextSegment?.winningStaff ?? 'none',
  }
}

function findChordNoteByOnset(row: MergedMeasureDumpRow, staff: StaffKind, onsetTicks: number): DumpNoteRow | null {
  return (
    row.notes.find(
      (note) =>
        note.staff === staff &&
        note.isRest !== true &&
        typeof note.onsetTicksInMeasure === 'number' &&
        Math.round(note.onsetTicksInMeasure) === onsetTicks &&
        Array.isArray(note.noteHeads) &&
        note.noteHeads.length > 1,
    ) ?? null
  )
}

function findSpacingSegmentByTicks(
  row: MergedMeasureDumpRow,
  fromOnsetTicks: number,
  toOnsetTicks: number,
): DumpSpacingSegment | null {
  return (
    getSpacingSegments(row).find(
      (segment) => segment.fromOnsetTicks === fromOnsetTicks && segment.toOnsetTicks === toOnsetTicks,
    ) ?? null
  )
}

function pushFailure(failures: string[], code: string, detail?: string | number | null): void {
  if (detail === undefined) {
    failures.push(code)
    return
  }
  failures.push(`${code}:${detail}`)
}

function validateSharedSlotDebug(row: MergedMeasureDumpRow, failures: string[]): void {
  const onsetReserves = getSpacingOnsetReserves(row)
  const spacingSegments = getSpacingSegments(row)

  spacingSegments.forEach((segment) => {
    const trebleRequestedExtraPx = Math.max(0, segment.trebleRequestedExtraPx ?? 0)
    const bassRequestedExtraPx = Math.max(0, segment.bassRequestedExtraPx ?? 0)
    const expectedExtraReservePx = Number(Math.max(trebleRequestedExtraPx, bassRequestedExtraPx).toFixed(3))
    if (!approximatelyEqual(segment.extraReservePx, expectedExtraReservePx)) {
      pushFailure(
        failures,
        'segment-extra-not-max',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.extraReservePx ?? 'null'}!=${expectedExtraReservePx}`,
      )
    }
    const expectedAppliedGapPx =
      segment.baseGapPx !== null ? Number((segment.baseGapPx + expectedExtraReservePx).toFixed(3)) : null
    if (!approximatelyEqual(segment.appliedGapPx, expectedAppliedGapPx)) {
      pushFailure(
        failures,
        'segment-applied-gap-mismatch',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.appliedGapPx ?? 'null'}!=${expectedAppliedGapPx ?? 'null'}`,
      )
    }
    const expectedWinningStaff = resolveWinningStaff(trebleRequestedExtraPx, bassRequestedExtraPx)
    if ((segment.winningStaff ?? 'none') !== expectedWinningStaff) {
      pushFailure(
        failures,
        'segment-winning-staff-mismatch',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.winningStaff ?? 'none'}!=${expectedWinningStaff}`,
      )
    }
  })

  const firstOnsetReserve = onsetReserves[0] ?? null
  if (firstOnsetReserve) {
    const expectedLeadingExtraPx = Number(
      Math.max(
        Math.max(0, firstOnsetReserve.leadingTrebleRequestedExtraPx ?? 0),
        Math.max(0, firstOnsetReserve.leadingBassRequestedExtraPx ?? 0),
      ).toFixed(3),
    )
    if (!approximatelyEqual(firstOnsetReserve.leftReservePx, expectedLeadingExtraPx)) {
      pushFailure(
        failures,
        'leading-slot-not-max',
        `${firstOnsetReserve.leftReservePx ?? 'null'}!=${expectedLeadingExtraPx}`,
      )
    }
    const expectedLeadingWinner = resolveWinningStaff(
      Math.max(0, firstOnsetReserve.leadingTrebleRequestedExtraPx ?? 0),
      Math.max(0, firstOnsetReserve.leadingBassRequestedExtraPx ?? 0),
    )
    if ((firstOnsetReserve.leadingWinningStaff ?? 'none') !== expectedLeadingWinner) {
      pushFailure(
        failures,
        'leading-winning-staff-mismatch',
        `${firstOnsetReserve.leadingWinningStaff ?? 'none'}!=${expectedLeadingWinner}`,
      )
    }
  }

  const lastOnsetReserve = onsetReserves[onsetReserves.length - 1] ?? null
  if (lastOnsetReserve) {
    const expectedTrailingExtraPx = Number(
      Math.max(
        Math.max(0, lastOnsetReserve.trailingTrebleRequestedExtraPx ?? 0),
        Math.max(0, lastOnsetReserve.trailingBassRequestedExtraPx ?? 0),
      ).toFixed(3),
    )
    if (!approximatelyEqual(lastOnsetReserve.rightReservePx, expectedTrailingExtraPx)) {
      pushFailure(
        failures,
        'trailing-slot-not-max',
        `${lastOnsetReserve.rightReservePx ?? 'null'}!=${expectedTrailingExtraPx}`,
      )
    }
    const expectedTrailingWinner = resolveWinningStaff(
      Math.max(0, lastOnsetReserve.trailingTrebleRequestedExtraPx ?? 0),
      Math.max(0, lastOnsetReserve.trailingBassRequestedExtraPx ?? 0),
    )
    if ((lastOnsetReserve.trailingWinningStaff ?? 'none') !== expectedTrailingWinner) {
      pushFailure(
        failures,
        'trailing-winning-staff-mismatch',
        `${lastOnsetReserve.trailingWinningStaff ?? 'none'}!=${expectedTrailingWinner}`,
      )
    }
  }
}

function validateNoBarlineOverflow(row: MergedMeasureDumpRow, failures: string[]): void {
  const overflowVsMeasureEndBarX =
    typeof row.overflowVsMeasureEndBarX === 'number' && Number.isFinite(row.overflowVsMeasureEndBarX)
      ? Number(row.overflowVsMeasureEndBarX.toFixed(3))
      : null
  if (overflowVsMeasureEndBarX !== null && overflowVsMeasureEndBarX > GAP_EPSILON_PX) {
    pushFailure(failures, 'overflow-vs-measure-end-barline', overflowVsMeasureEndBarX)
  }
}

function analyzeDesktopTargetRow(
  row: MergedMeasureDumpRow,
  pairIndex: number,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): DesktopTargetResult {
  const failures: string[] = []
  validateSharedSlotDebug(row, failures)
  validateNoBarlineOverflow(row, failures)

  if (!row.rendered) {
    pushFailure(failures, 'measure-not-rendered')
  }

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null

  const trebleMetrics = buildStaffOnsetMetrics(row, 'treble')
  const bassMetrics = buildStaffOnsetMetrics(row, 'bass')
  const candidates = (['treble', 'bass'] as StaffKind[])
    .flatMap((staff) => {
      const staffMetrics = staff === 'treble' ? trebleMetrics : bassMetrics
      return staffMetrics
        .filter(
          (metrics) =>
            metrics.rawLeftReservePx > HEAD_X_EPSILON_PX || metrics.rawRightReservePx > HEAD_X_EPSILON_PX,
        )
        .map((metrics) => ({
          staff,
          metrics,
          note:
            findChordNoteByOnset(row, staff, metrics.onsetTicks) ??
            row.notes.find(
              (note) =>
                note.staff === staff &&
                note.isRest !== true &&
                typeof note.onsetTicksInMeasure === 'number' &&
                Math.round(note.onsetTicksInMeasure) === metrics.onsetTicks,
            ) ??
            null,
        }))
        .filter((candidate) => candidate.note !== null)
    })
    .sort((left, right) => {
      if (left.metrics.onsetTicks !== right.metrics.onsetTicks) {
        return left.metrics.onsetTicks - right.metrics.onsetTicks
      }
      if ((left.note?.noteIndex ?? Number.POSITIVE_INFINITY) !== (right.note?.noteIndex ?? Number.POSITIVE_INFINITY)) {
        return (left.note?.noteIndex ?? Number.POSITIVE_INFINITY) - (right.note?.noteIndex ?? Number.POSITIVE_INFINITY)
      }
      return left.staff.localeCompare(right.staff)
    })

  const selectedCandidate = candidates[0] ?? null
  if (!selectedCandidate) {
    return {
      pairIndex,
      renderedPageIndex: row.renderedPageIndex,
      noteIndex: null,
      onsetTicks: null,
      direction: 'missing',
      headXs: [],
      rawLeftReservePx: null,
      rawRightReservePx: null,
      expectedLeftRequestPx: null,
      actualLeftRequestPx: null,
      leftWinningStaff: 'none',
      expectedRightRequestPx: null,
      actualRightRequestPx: null,
      rightWinningStaff: 'none',
      visibleLeftGapPx: null,
      visibleRightGapPx: null,
      passed: failures.length === 0,
      failureReasons: failures,
    }
  }

  const targetStaff = selectedCandidate.staff
  const targetMetrics = selectedCandidate.metrics
  const targetNote = selectedCandidate.note
  const staffMetrics = targetStaff === 'treble' ? trebleMetrics : bassMetrics
  const targetMetricsIndex = staffMetrics.findIndex((metrics) => metrics.onsetTicks === targetMetrics.onsetTicks)
  const previousMetrics = targetMetricsIndex > 0 ? staffMetrics[targetMetricsIndex - 1] ?? null : null
  const nextMetrics =
    targetMetricsIndex >= 0 && targetMetricsIndex < staffMetrics.length - 1
      ? staffMetrics[targetMetricsIndex + 1] ?? null
      : null
  const targetOnsetTicks = targetMetrics.onsetTicks
  const headXs = targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []
  const anchorX = targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null
  const direction = classifyDirection(anchorX, headXs)

  const expectedLeftRequestPx =
    targetMetrics.rawLeftReservePx > HEAD_X_EPSILON_PX
      ? computeExpectedLeftRequestPx(targetMetrics, previousMetrics, boundaryStartX, secondChordSafeGapPx)
      : 0
  const expectedRightRequestPx =
    targetMetrics.rawRightReservePx > HEAD_X_EPSILON_PX
      ? computeExpectedRightRequestPx(targetMetrics, nextMetrics, boundaryEndX, targetNote, secondChordSafeGapPx)
      : 0

  const actualLeftSummary = resolveSlotRequestSummary({
    row,
    staff: targetStaff,
    onsetTicks: targetOnsetTicks,
    side: 'left',
  })
  const actualRightSummary = resolveSlotRequestSummary({
    row,
    staff: targetStaff,
    onsetTicks: targetOnsetTicks,
    side: 'right',
  })

  if (
    targetMetrics.rawLeftReservePx > HEAD_X_EPSILON_PX &&
    !approximatelyEqual(actualLeftSummary.requestedExtraPx, expectedLeftRequestPx)
  ) {
    pushFailure(
      failures,
      'left-request-mismatch',
      `${actualLeftSummary.requestedExtraPx}!=${expectedLeftRequestPx}`,
    )
  }
  if (
    targetMetrics.rawRightReservePx > HEAD_X_EPSILON_PX &&
    !approximatelyEqual(actualRightSummary.requestedExtraPx, expectedRightRequestPx)
  ) {
    pushFailure(
      failures,
      'right-request-mismatch',
      `${actualRightSummary.requestedExtraPx}!=${expectedRightRequestPx}`,
    )
  }

  if (
    targetMetrics.rawLeftReservePx > HEAD_X_EPSILON_PX &&
    actualLeftSummary.requestedExtraPx > GAP_EPSILON_PX &&
    actualLeftSummary.winningStaff !== targetStaff
  ) {
    pushFailure(failures, 'left-winning-staff-mismatch', actualLeftSummary.winningStaff)
  }
  if (
    targetMetrics.rawRightReservePx > HEAD_X_EPSILON_PX &&
    actualRightSummary.requestedExtraPx > GAP_EPSILON_PX &&
    actualRightSummary.winningStaff !== targetStaff
  ) {
    pushFailure(failures, 'right-winning-staff-mismatch', actualRightSummary.winningStaff)
  }

  const visibleLeftGapPx =
    targetMetrics.rawLeftReservePx > HEAD_X_EPSILON_PX
      ? computeFinalVisibleLeftGapPx({
          metrics: targetMetrics,
          previousMetrics,
          boundaryStartX,
          appliedExtraPx: actualLeftSummary.requestedExtraPx,
        })
      : null
  const visibleRightGapPx =
    targetMetrics.rawRightReservePx > HEAD_X_EPSILON_PX
      ? computeFinalVisibleRightGapPx({
          metrics: targetMetrics,
          nextMetrics,
          boundaryEndX,
          sourceNote: targetNote,
          appliedExtraPx: actualRightSummary.requestedExtraPx,
        })
      : null

  if (
    targetMetrics.rawLeftReservePx > HEAD_X_EPSILON_PX &&
    (visibleLeftGapPx === null || visibleLeftGapPx < secondChordSafeGapPx - GAP_EPSILON_PX)
  ) {
    pushFailure(failures, 'left-visible-gap-too-small', visibleLeftGapPx)
  }
  if (
    targetMetrics.rawRightReservePx > HEAD_X_EPSILON_PX &&
    (visibleRightGapPx === null || visibleRightGapPx < secondChordSafeGapPx - GAP_EPSILON_PX)
  ) {
    pushFailure(failures, 'right-visible-gap-too-small', visibleRightGapPx)
  }

  return {
    pairIndex,
    renderedPageIndex: row.renderedPageIndex,
    noteIndex: targetNote?.noteIndex ?? null,
    onsetTicks: targetOnsetTicks,
    direction,
    headXs,
    rawLeftReservePx: targetMetrics.rawLeftReservePx,
    rawRightReservePx: targetMetrics.rawRightReservePx,
    expectedLeftRequestPx,
    actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
    leftWinningStaff: actualLeftSummary.winningStaff,
    expectedRightRequestPx,
    actualRightRequestPx: Number(actualRightSummary.requestedExtraPx.toFixed(3)),
    rightWinningStaff: actualRightSummary.winningStaff,
    visibleLeftGapPx,
    visibleRightGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeDesktopScenario(
  rows: MergedMeasureDumpRow[],
  scale: DebugScaleConfig,
  key: string,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): DesktopScenarioReport {
  const targets = Array.from({ length: TARGET_PAIR_COUNT }, (_, pairIndex) =>
    analyzeDesktopTargetRow(
      rows[pairIndex] ?? {
        pairIndex,
        rendered: false,
        renderedPageIndex: null,
        overflowVsNoteEndX: null,
        overflowVsMeasureEndBarX: null,
        notes: [],
      },
      pairIndex,
      secondChordSafeGapPx,
    ),
  )

  return {
    key,
    scale,
    passed: targets.every((target) => target.passed),
    targets,
  }
}

function analyzeCrossStaffFixture(
  row: MergedMeasureDumpRow,
  scale: DebugScaleConfig,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): FixtureResult {
  const failures: string[] = []
  validateSharedSlotDebug(row, failures)
  validateNoBarlineOverflow(row, failures)

  const bassMetrics = buildStaffOnsetMetrics(row, 'bass')
  const trebleMetrics = buildStaffOnsetMetrics(row, 'treble')
  const targetMetrics = bassMetrics.find((metrics) => metrics.rawLeftReservePx > HEAD_X_EPSILON_PX) ?? null
  const targetNote =
    row.notes.find(
      (note) =>
        note.staff === 'bass' &&
        note.isRest !== true &&
        typeof note.onsetTicksInMeasure === 'number' &&
        targetMetrics &&
        Math.round(note.onsetTicksInMeasure) === targetMetrics.onsetTicks &&
        Array.isArray(note.noteHeads) &&
        note.noteHeads.length > 1,
    ) ?? null

  if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
  if (!targetMetrics || !targetNote) pushFailure(failures, 'target-bass-displaced-chord-missing')

  const targetIndex = targetMetrics ? bassMetrics.findIndex((metrics) => metrics.onsetTicks === targetMetrics.onsetTicks) : -1
  const previousMetrics = targetIndex > 0 ? bassMetrics[targetIndex - 1] ?? null : null
  const nextMetrics =
    targetIndex >= 0 && targetIndex < bassMetrics.length - 1 ? bassMetrics[targetIndex + 1] ?? null : null

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null

  const expectedLeftRequestPx = targetMetrics
    ? computeExpectedLeftRequestPx(targetMetrics, previousMetrics, boundaryStartX, secondChordSafeGapPx)
    : null
  const expectedRightRequestPx = targetMetrics
    ? computeExpectedRightRequestPx(targetMetrics, nextMetrics, boundaryEndX, targetNote, secondChordSafeGapPx)
    : null

  if ((expectedLeftRequestPx ?? 0) > GAP_EPSILON_PX || (expectedRightRequestPx ?? 0) > GAP_EPSILON_PX) {
    pushFailure(
      failures,
      'fixture-should-have-no-bass-local-collision',
      `${expectedLeftRequestPx ?? 'null'}/${expectedRightRequestPx ?? 'null'}`,
    )
  }

  const actualLeftSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'left',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const actualRightSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'right',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }

  if (actualLeftSummary.requestedExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'cross-staff-false-positive-left', actualLeftSummary.requestedExtraPx)
  }
  if (actualRightSummary.requestedExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'cross-staff-false-positive-right', actualRightSummary.requestedExtraPx)
  }

  const spacingSegments = getSpacingSegments(row)
  spacingSegments.forEach((segment) => {
    if ((segment.extraReservePx ?? 0) > GAP_EPSILON_PX) {
      pushFailure(
        failures,
        'unexpected-extra-segment',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.extraReservePx ?? 'null'}`,
      )
    }
  })

  if (
    targetMetrics &&
    previousMetrics &&
    !trebleMetrics.some(
      (metrics) =>
        metrics.onsetTicks > previousMetrics.onsetTicks &&
        metrics.onsetTicks < targetMetrics.onsetTicks,
    )
  ) {
    pushFailure(failures, 'fixture-missing-interleaved-treble-onset')
  }

  const headXs = targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []
  const direction = classifyDirection(
    targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null,
    headXs,
  )
  const measureWidth =
    typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
      ? Number(row.measureWidth.toFixed(3))
      : null
  const visibleLeftGapPx =
    typeof row.effectiveLeftGapPx === 'number' && Number.isFinite(row.effectiveLeftGapPx)
      ? Number(row.effectiveLeftGapPx.toFixed(3))
      : null
  const visibleRightGapPx =
    typeof row.effectiveRightGapPx === 'number' && Number.isFinite(row.effectiveRightGapPx)
      ? Number(row.effectiveRightGapPx.toFixed(3))
      : null

  return {
    key: 'fixture-cross-staff-no-false-positive',
    scale,
    measureWidth,
    targetOnsetTicks: targetMetrics?.onsetTicks ?? null,
    direction,
    headXs,
    expectedLeftRequestPx,
    actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
    leftWinningStaff: actualLeftSummary.winningStaff,
    expectedRightRequestPx,
    actualRightRequestPx: Number(actualRightSummary.requestedExtraPx.toFixed(3)),
    rightWinningStaff: actualRightSummary.winningStaff,
    visibleLeftGapPx,
    visibleRightGapPx,
    requestedSafeGapPx: secondChordSafeGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeLocalCollisionFixture(
  row: MergedMeasureDumpRow,
  scale: DebugScaleConfig,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): FixtureResult {
  const failures: string[] = []
  validateSharedSlotDebug(row, failures)
  validateNoBarlineOverflow(row, failures)

  const bassMetrics = buildStaffOnsetMetrics(row, 'bass')
  const targetMetrics = bassMetrics.find((metrics) => metrics.rawLeftReservePx > HEAD_X_EPSILON_PX) ?? null
  const targetNote =
    row.notes.find(
      (note) =>
        note.staff === 'bass' &&
        note.isRest !== true &&
        typeof note.onsetTicksInMeasure === 'number' &&
        targetMetrics &&
        Math.round(note.onsetTicksInMeasure) === targetMetrics.onsetTicks &&
        Array.isArray(note.noteHeads) &&
        note.noteHeads.length > 1,
    ) ?? null

  if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
  if (!targetMetrics || !targetNote) pushFailure(failures, 'target-bass-displaced-chord-missing')

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null

  const expectedLeftRequestPx = targetMetrics
    ? computeExpectedLeftRequestPx(targetMetrics, null, boundaryStartX, secondChordSafeGapPx)
    : null
  const expectedRightRequestPx = targetMetrics
    ? computeExpectedRightRequestPx(targetMetrics, bassMetrics[1] ?? null, boundaryEndX, targetNote, secondChordSafeGapPx)
    : null

  if ((expectedLeftRequestPx ?? 0) <= GAP_EPSILON_PX) {
    pushFailure(failures, 'fixture-expected-leading-collision-missing')
  }
  if ((expectedRightRequestPx ?? 0) > GAP_EPSILON_PX) {
    pushFailure(failures, 'fixture-should-not-request-right', expectedRightRequestPx)
  }

  const actualLeftSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'left',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const actualRightSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'right',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }

  if (expectedLeftRequestPx !== null && !approximatelyEqual(actualLeftSummary.requestedExtraPx, expectedLeftRequestPx)) {
    pushFailure(
      failures,
      'leading-request-mismatch',
      `${actualLeftSummary.requestedExtraPx}!=${expectedLeftRequestPx}`,
    )
  }
  if (actualRightSummary.requestedExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'unexpected-right-request', actualRightSummary.requestedExtraPx)
  }
  if (actualLeftSummary.winningStaff !== 'bass') {
    pushFailure(failures, 'leading-winning-staff-not-bass', actualLeftSummary.winningStaff)
  }

  const spacingSegments = getSpacingSegments(row)
  spacingSegments.forEach((segment) => {
    if ((segment.extraReservePx ?? 0) > GAP_EPSILON_PX) {
      pushFailure(
        failures,
        'unexpected-inner-segment-extra',
        `${segment.fromOnsetTicks}->${segment.toOnsetTicks}:${segment.extraReservePx ?? 'null'}`,
      )
    }
  })

  const finalVisibleLeftGapPx = computeFinalVisibleLeftGapPx({
    metrics: targetMetrics,
    previousMetrics: null,
    boundaryStartX,
    appliedExtraPx: actualLeftSummary.requestedExtraPx,
  })
  if (finalVisibleLeftGapPx === null || finalVisibleLeftGapPx < secondChordSafeGapPx - GAP_EPSILON_PX) {
    pushFailure(failures, 'leading-visible-gap-too-small', finalVisibleLeftGapPx)
  }

  const headXs = targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []
  const direction = classifyDirection(
    targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null,
    headXs,
  )
  if (direction !== 'backward') {
    pushFailure(failures, 'fixture-direction-not-backward', direction)
  }

  const measureWidth =
    typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
      ? Number(row.measureWidth.toFixed(3))
      : null
  const visibleLeftGapPx = finalVisibleLeftGapPx
  const visibleRightGapPx =
    typeof row.effectiveRightGapPx === 'number' && Number.isFinite(row.effectiveRightGapPx)
      ? Number(row.effectiveRightGapPx.toFixed(3))
      : null

  return {
    key: 'fixture-local-leading-collision',
    scale,
    measureWidth,
    targetOnsetTicks: targetMetrics?.onsetTicks ?? null,
    direction,
    headXs,
    expectedLeftRequestPx,
    actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
    leftWinningStaff: actualLeftSummary.winningStaff,
    expectedRightRequestPx,
    actualRightRequestPx: Number(actualRightSummary.requestedExtraPx.toFixed(3)),
    rightWinningStaff: actualRightSummary.winningStaff,
    visibleLeftGapPx,
    visibleRightGapPx,
    requestedSafeGapPx: secondChordSafeGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeInnerSegmentNoExtraFixture(
  row: MergedMeasureDumpRow,
  scale: DebugScaleConfig,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): FixtureResult {
  const failures: string[] = []
  validateSharedSlotDebug(row, failures)
  validateNoBarlineOverflow(row, failures)

  const bassMetrics = buildStaffOnsetMetrics(row, 'bass')
  const firstMetrics = bassMetrics[0] ?? null
  const secondMetrics = bassMetrics[1] ?? null
  const firstNote = firstMetrics ? findChordNoteByOnset(row, 'bass', firstMetrics.onsetTicks) : null
  const secondNote = secondMetrics ? findChordNoteByOnset(row, 'bass', secondMetrics.onsetTicks) : null
  if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
  if (!firstMetrics || !secondMetrics || !firstNote || !secondNote) {
    pushFailure(failures, 'fixture-missing-inner-chord-pair')
  }

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null
  const firstDirection = classifyDirection(
    firstNote && Number.isFinite(firstNote.x) ? Number(firstNote.x.toFixed(3)) : null,
    firstNote ? dedupeSortedNumbers(firstNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : [],
  )
  const secondDirection = classifyDirection(
    secondNote && Number.isFinite(secondNote.x) ? Number(secondNote.x.toFixed(3)) : null,
    secondNote ? dedupeSortedNumbers(secondNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : [],
  )
  if (firstDirection !== 'forward') pushFailure(failures, 'fixture-first-direction-not-forward', firstDirection)
  if (secondDirection !== 'backward') pushFailure(failures, 'fixture-second-direction-not-backward', secondDirection)

  const expectedRightRequestPx =
    firstMetrics && firstNote
      ? computeExpectedRightRequestPx(firstMetrics, secondMetrics, boundaryEndX, firstNote, secondChordSafeGapPx)
      : null
  const expectedLeftRequestPx =
    secondMetrics
      ? computeExpectedLeftRequestPx(secondMetrics, firstMetrics, boundaryStartX, secondChordSafeGapPx)
      : null
  const actualRightSummary =
    firstMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: firstMetrics.onsetTicks,
          side: 'right',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const actualLeftSummary =
    secondMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: secondMetrics.onsetTicks,
          side: 'left',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const expectedSegmentExtraPx =
    expectedLeftRequestPx !== null && expectedRightRequestPx !== null
      ? Number(Math.max(expectedLeftRequestPx, expectedRightRequestPx).toFixed(3))
      : null
  const segment = firstMetrics && secondMetrics
    ? findSpacingSegmentByTicks(row, firstMetrics.onsetTicks, secondMetrics.onsetTicks)
    : null
  const actualSegmentExtraPx = Number(Math.max(0, segment?.extraReservePx ?? 0).toFixed(3))

  if ((expectedSegmentExtraPx ?? 0) > GAP_EPSILON_PX) {
    pushFailure(failures, 'fixture-expected-zero-segment-extra-missing', expectedSegmentExtraPx)
  }
  if (actualSegmentExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'unexpected-segment-extra', actualSegmentExtraPx)
  }
  if (segment && !approximatelyEqual(segment.appliedGapPx, segment.baseGapPx)) {
    pushFailure(failures, 'segment-gap-should-stay-base', `${segment.appliedGapPx ?? 'null'}!=${segment.baseGapPx ?? 'null'}`)
  }

  const finalVisibleLeftGapPx = computeFinalVisibleLeftGapPx({
    metrics: secondMetrics,
    previousMetrics: firstMetrics,
    boundaryStartX,
    appliedExtraPx: actualLeftSummary.requestedExtraPx,
  })
  const finalVisibleRightGapPx = computeFinalVisibleRightGapPx({
    metrics: firstMetrics,
    nextMetrics: secondMetrics,
    boundaryEndX,
    sourceNote: firstNote,
    appliedExtraPx: actualRightSummary.requestedExtraPx,
  })
  if (finalVisibleLeftGapPx === null || finalVisibleLeftGapPx < secondChordSafeGapPx - GAP_EPSILON_PX) {
    pushFailure(failures, 'inner-left-gap-too-small', finalVisibleLeftGapPx)
  }
  if (finalVisibleRightGapPx === null || finalVisibleRightGapPx < secondChordSafeGapPx - GAP_EPSILON_PX) {
    pushFailure(failures, 'inner-right-gap-too-small', finalVisibleRightGapPx)
  }

  return {
    key: 'fixture-inner-segment-no-extra',
    scale,
    measureWidth:
      typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
        ? Number(row.measureWidth.toFixed(3))
        : null,
    targetOnsetTicks: firstMetrics?.onsetTicks ?? null,
    direction: 'both',
    headXs: [],
    expectedLeftRequestPx,
    actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
    leftWinningStaff: actualLeftSummary.winningStaff,
    expectedRightRequestPx,
    actualRightRequestPx: Number(actualRightSummary.requestedExtraPx.toFixed(3)),
    rightWinningStaff: actualRightSummary.winningStaff,
    visibleLeftGapPx: finalVisibleLeftGapPx,
    visibleRightGapPx: finalVisibleRightGapPx,
    requestedSafeGapPx: secondChordSafeGapPx,
    expectedSegmentExtraPx,
    actualSegmentExtraPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeInnerSegmentSafeGapFixture(
  row: MergedMeasureDumpRow,
  scale: DebugScaleConfig,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): FixtureResult {
  const failures: string[] = []
  validateSharedSlotDebug(row, failures)
  validateNoBarlineOverflow(row, failures)

  const bassMetrics = buildStaffOnsetMetrics(row, 'bass')
  const firstMetrics = bassMetrics[0] ?? null
  const secondMetrics = bassMetrics[1] ?? null
  const firstNote = firstMetrics ? findChordNoteByOnset(row, 'bass', firstMetrics.onsetTicks) : null
  const secondNote = secondMetrics ? findChordNoteByOnset(row, 'bass', secondMetrics.onsetTicks) : null
  if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
  if (!firstMetrics || !secondMetrics || !firstNote || !secondNote) {
    pushFailure(failures, 'fixture-missing-inner-chord-pair')
  }

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null
  const firstDirection = classifyDirection(
    firstNote && Number.isFinite(firstNote.x) ? Number(firstNote.x.toFixed(3)) : null,
    firstNote ? dedupeSortedNumbers(firstNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : [],
  )
  const secondDirection = classifyDirection(
    secondNote && Number.isFinite(secondNote.x) ? Number(secondNote.x.toFixed(3)) : null,
    secondNote ? dedupeSortedNumbers(secondNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : [],
  )
  if (firstDirection === 'missing') pushFailure(failures, 'fixture-first-direction-missing')
  if (secondDirection === 'missing') pushFailure(failures, 'fixture-second-direction-missing')

  const expectedRightRequestPx =
    firstMetrics && firstNote
      ? computeExpectedRightRequestPx(firstMetrics, secondMetrics, boundaryEndX, firstNote, secondChordSafeGapPx)
      : null
  const expectedLeftRequestPx =
    secondMetrics
      ? computeExpectedLeftRequestPx(secondMetrics, firstMetrics, boundaryStartX, secondChordSafeGapPx)
      : null
  const actualRightSummary =
    firstMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: firstMetrics.onsetTicks,
          side: 'right',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const actualLeftSummary =
    secondMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: secondMetrics.onsetTicks,
          side: 'left',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const expectedSegmentExtraPx =
    expectedLeftRequestPx !== null && expectedRightRequestPx !== null
      ? Number(Math.max(expectedLeftRequestPx, expectedRightRequestPx).toFixed(3))
      : null
  const segment = firstMetrics && secondMetrics
    ? findSpacingSegmentByTicks(row, firstMetrics.onsetTicks, secondMetrics.onsetTicks)
    : null
  const actualSegmentExtraPx = Number(Math.max(0, segment?.extraReservePx ?? 0).toFixed(3))

  if ((expectedSegmentExtraPx ?? 0) <= GAP_EPSILON_PX) {
    pushFailure(failures, 'fixture-expected-positive-segment-extra-missing', expectedSegmentExtraPx)
  }
  if (actualSegmentExtraPx <= GAP_EPSILON_PX) {
    pushFailure(failures, 'fixture-actual-segment-extra-missing', actualSegmentExtraPx)
  }
  if (actualLeftSummary.requestedExtraPx <= GAP_EPSILON_PX) {
    pushFailure(failures, 'inner-left-request-missing', actualLeftSummary.requestedExtraPx)
  }
  if (actualLeftSummary.winningStaff !== 'bass') {
    pushFailure(failures, 'inner-left-winning-staff-not-bass', actualLeftSummary.winningStaff)
  }

  if (
    (expectedRightRequestPx ?? 0) > GAP_EPSILON_PX &&
    !approximatelyEqual(actualRightSummary.requestedExtraPx, expectedRightRequestPx)
  ) {
    pushFailure(failures, 'inner-right-request-mismatch', `${actualRightSummary.requestedExtraPx}!=${expectedRightRequestPx}`)
  }
  if (
    (expectedLeftRequestPx ?? 0) > GAP_EPSILON_PX &&
    !approximatelyEqual(actualLeftSummary.requestedExtraPx, expectedLeftRequestPx)
  ) {
    pushFailure(failures, 'inner-left-request-mismatch', `${actualLeftSummary.requestedExtraPx}!=${expectedLeftRequestPx}`)
  }
  if (expectedSegmentExtraPx !== null && !approximatelyEqual(actualSegmentExtraPx, expectedSegmentExtraPx)) {
    pushFailure(failures, 'inner-segment-extra-mismatch', `${actualSegmentExtraPx}!=${expectedSegmentExtraPx}`)
  }

  const finalVisibleLeftGapPx = computeFinalVisibleLeftGapPx({
    metrics: secondMetrics,
    previousMetrics: firstMetrics,
    boundaryStartX,
    appliedExtraPx: actualLeftSummary.requestedExtraPx,
  })
  const finalVisibleRightGapPx = computeFinalVisibleRightGapPx({
    metrics: firstMetrics,
    nextMetrics: secondMetrics,
    boundaryEndX,
    sourceNote: firstNote,
    appliedExtraPx: actualRightSummary.requestedExtraPx,
  })
  if (finalVisibleLeftGapPx === null || finalVisibleLeftGapPx < secondChordSafeGapPx - GAP_EPSILON_PX) {
    pushFailure(failures, 'inner-left-gap-too-small', finalVisibleLeftGapPx)
  }
  if (
    (expectedRightRequestPx ?? 0) > GAP_EPSILON_PX &&
    (finalVisibleRightGapPx === null || finalVisibleRightGapPx < secondChordSafeGapPx - GAP_EPSILON_PX)
  ) {
    pushFailure(failures, 'inner-right-gap-too-small', finalVisibleRightGapPx)
  }

  return {
    key: 'fixture-inner-segment-safe-gap',
    scale,
    measureWidth:
      typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
        ? Number(row.measureWidth.toFixed(3))
        : null,
    targetOnsetTicks: firstMetrics?.onsetTicks ?? null,
    direction:
      firstDirection === 'missing' && secondDirection === 'missing'
        ? 'missing'
        : firstDirection === secondDirection
          ? firstDirection
          : 'both',
    headXs: [],
    expectedLeftRequestPx,
    actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
    leftWinningStaff: actualLeftSummary.winningStaff,
    expectedRightRequestPx,
    actualRightRequestPx:
      (expectedRightRequestPx ?? 0) > GAP_EPSILON_PX
        ? Number(actualRightSummary.requestedExtraPx.toFixed(3))
        : 0,
    rightWinningStaff:
      (expectedRightRequestPx ?? 0) > GAP_EPSILON_PX ? actualRightSummary.winningStaff : 'none',
    visibleLeftGapPx: finalVisibleLeftGapPx,
    visibleRightGapPx: finalVisibleRightGapPx,
    requestedSafeGapPx: secondChordSafeGapPx,
    expectedSegmentExtraPx,
    actualSegmentExtraPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeTrailingCollisionFixture(
  row: MergedMeasureDumpRow,
  scale: DebugScaleConfig,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): FixtureResult {
  const failures: string[] = []
  validateSharedSlotDebug(row, failures)
  validateNoBarlineOverflow(row, failures)

  const bassMetrics = buildStaffOnsetMetrics(row, 'bass')
  const targetMetrics = [...bassMetrics].reverse().find((metrics) => metrics.rawRightReservePx > HEAD_X_EPSILON_PX) ?? null
  const targetNote =
    targetMetrics ? findChordNoteByOnset(row, 'bass', targetMetrics.onsetTicks) : null

  if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
  if (!targetMetrics || !targetNote) pushFailure(failures, 'target-bass-forward-chord-missing')

  const boundaryStartX =
    typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
      ? Number(row.effectiveBoundaryStartX.toFixed(3))
      : null
  const boundaryEndX =
    typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
      ? Number(row.effectiveBoundaryEndX.toFixed(3))
      : null
  const targetIndex =
    targetMetrics !== null ? bassMetrics.findIndex((metrics) => metrics.onsetTicks === targetMetrics.onsetTicks) : -1
  const previousMetrics = targetIndex > 0 ? bassMetrics[targetIndex - 1] ?? null : null

  const expectedLeftRequestPx = targetMetrics
    ? computeExpectedLeftRequestPx(targetMetrics, previousMetrics, boundaryStartX, secondChordSafeGapPx)
    : null
  const expectedRightRequestPx = targetMetrics && targetNote
    ? computeExpectedRightRequestPx(targetMetrics, null, boundaryEndX, targetNote, secondChordSafeGapPx)
    : null

  if ((expectedLeftRequestPx ?? 0) > GAP_EPSILON_PX) {
    pushFailure(failures, 'fixture-should-not-request-left', expectedLeftRequestPx)
  }

  const actualLeftSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'left',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
  const actualRightSummary =
    targetMetrics !== null
      ? resolveSlotRequestSummary({
          row,
          staff: 'bass',
          onsetTicks: targetMetrics.onsetTicks,
          side: 'right',
        })
      : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }

  if (actualLeftSummary.requestedExtraPx > GAP_EPSILON_PX) {
    pushFailure(failures, 'unexpected-left-request', actualLeftSummary.requestedExtraPx)
  }
  if ((expectedRightRequestPx ?? 0) > GAP_EPSILON_PX) {
    if (!approximatelyEqual(actualRightSummary.requestedExtraPx, expectedRightRequestPx)) {
      pushFailure(failures, 'trailing-request-mismatch', `${actualRightSummary.requestedExtraPx}!=${expectedRightRequestPx}`)
    }
    if (actualRightSummary.winningStaff !== 'bass') {
      pushFailure(failures, 'trailing-winning-staff-not-bass', actualRightSummary.winningStaff)
    }
  } else {
    if (actualRightSummary.requestedExtraPx > GAP_EPSILON_PX) {
      pushFailure(failures, 'unexpected-trailing-request', actualRightSummary.requestedExtraPx)
    }
    if (actualRightSummary.winningStaff !== 'none') {
      pushFailure(failures, 'unexpected-trailing-winning-staff', actualRightSummary.winningStaff)
    }
  }

  const finalVisibleRightGapPx = computeFinalVisibleRightGapPx({
    metrics: targetMetrics,
    nextMetrics: null,
    boundaryEndX,
    sourceNote: targetNote,
    appliedExtraPx: actualRightSummary.requestedExtraPx,
  })
  if (finalVisibleRightGapPx === null || finalVisibleRightGapPx < secondChordSafeGapPx - GAP_EPSILON_PX) {
    pushFailure(failures, 'trailing-visible-gap-too-small', finalVisibleRightGapPx)
  }

  const direction = classifyDirection(
    targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null,
    targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : [],
  )
  if (direction !== 'forward') {
    pushFailure(failures, 'fixture-direction-not-forward', direction)
  }

  return {
    key: 'fixture-trailing-boundary-collision',
    scale,
    measureWidth:
      typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
        ? Number(row.measureWidth.toFixed(3))
        : null,
    targetOnsetTicks: targetMetrics?.onsetTicks ?? null,
    direction,
    headXs: targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : [],
    expectedLeftRequestPx,
    actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
    leftWinningStaff: actualLeftSummary.winningStaff,
    expectedRightRequestPx,
    actualRightRequestPx:
      (expectedRightRequestPx ?? 0) > GAP_EPSILON_PX
        ? Number(actualRightSummary.requestedExtraPx.toFixed(3))
        : 0,
    rightWinningStaff:
      (expectedRightRequestPx ?? 0) > GAP_EPSILON_PX ? actualRightSummary.winningStaff : 'none',
    visibleLeftGapPx:
      typeof row.effectiveLeftGapPx === 'number' && Number.isFinite(row.effectiveLeftGapPx)
        ? Number(row.effectiveLeftGapPx.toFixed(3))
        : null,
    visibleRightGapPx: finalVisibleRightGapPx,
    requestedSafeGapPx: secondChordSafeGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeDottedFixture(params: {
  row: MergedMeasureDumpRow
  scale: DebugScaleConfig
  key: string
  requireChordHeads: boolean
}): FixtureResult {
  const { row, scale, key, requireChordHeads } = params
  const failures: string[] = []
  validateNoBarlineOverflow(row, failures)

  const targetNote =
    row.notes.find(
      (note) =>
        note.staff === 'treble' &&
        note.isRest !== true &&
        Array.isArray(note.noteHeads) &&
        (requireChordHeads ? note.noteHeads.length > 1 : note.noteHeads.length === 1) &&
        typeof note.dotLeftX === 'number' &&
        Number.isFinite(note.dotLeftX) &&
        typeof note.dotRightX === 'number' &&
        Number.isFinite(note.dotRightX),
    ) ?? null
  const nextNote =
    targetNote !== null
      ? row.notes.find(
          (note) =>
            note.staff === 'treble' &&
            note.isRest !== true &&
            note.noteIndex > targetNote.noteIndex &&
            typeof note.onsetTicksInMeasure === 'number' &&
            Number.isFinite(note.onsetTicksInMeasure),
        ) ?? null
      : null

  if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
  if (!targetNote) pushFailure(failures, 'dotted-target-note-missing')
  if (!nextNote) pushFailure(failures, 'dotted-next-note-missing')

  const headRightX = toRoundedFiniteNumber(targetNote?.headRightX)
  const dotLeftX = toRoundedFiniteNumber(targetNote?.dotLeftX)
  const dotRightX = toRoundedFiniteNumber(targetNote?.dotRightX)
  const noteRightX = toRoundedFiniteNumber(targetNote?.rightX)
  const spacingRightX = toRoundedFiniteNumber(targetNote?.spacingRightX)
  const nextOccupiedLeftX = nextNote ? getNoteOccupiedLeftX(nextNote) : null
  const ownGapPx =
    headRightX !== null && dotLeftX !== null ? Number((dotLeftX - headRightX).toFixed(3)) : null
  const nextGapPx =
    nextOccupiedLeftX !== null && dotRightX !== null
      ? Number((nextOccupiedLeftX - dotRightX).toFixed(3))
      : null

  if (headRightX === null) pushFailure(failures, 'dotted-head-right-missing')
  if (dotLeftX === null || dotRightX === null) pushFailure(failures, 'dotted-bounds-missing')
  if (ownGapPx === null || ownGapPx < DOT_NOTEHEAD_CLEARANCE_PX - GAP_EPSILON_PX) {
    pushFailure(failures, 'dotted-own-gap-too-small', ownGapPx)
  }
  if (nextGapPx === null || nextGapPx < -GAP_EPSILON_PX) {
    pushFailure(failures, 'dotted-next-gap-overlap', nextGapPx)
  }
  if (dotRightX !== null && noteRightX !== null && noteRightX < dotRightX - GAP_EPSILON_PX) {
    pushFailure(failures, 'dotted-rightx-missing-dot', `${noteRightX}<${dotRightX}`)
  }
  if (dotRightX !== null && spacingRightX !== null && spacingRightX < dotRightX - GAP_EPSILON_PX) {
    pushFailure(failures, 'dotted-spacing-rightx-missing-dot', `${spacingRightX}<${dotRightX}`)
  }

  const headXs = targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []
  const direction = classifyDirection(
    targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null,
    headXs,
  )

  return {
    key,
    scale,
    measureWidth:
      typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
        ? Number(row.measureWidth.toFixed(3))
        : null,
    targetOnsetTicks:
      targetNote && typeof targetNote.onsetTicksInMeasure === 'number' && Number.isFinite(targetNote.onsetTicksInMeasure)
        ? Math.round(targetNote.onsetTicksInMeasure)
        : null,
    direction,
    headXs,
    expectedLeftRequestPx: headRightX !== null ? Number((headRightX + DOT_NOTEHEAD_CLEARANCE_PX).toFixed(3)) : null,
    actualLeftRequestPx: dotLeftX,
    leftWinningStaff: 'treble',
    expectedRightRequestPx: dotRightX,
    actualRightRequestPx: nextOccupiedLeftX,
    rightWinningStaff: nextNote ? 'treble' : 'none',
    visibleLeftGapPx: ownGapPx,
    visibleRightGapPx: nextGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeDottedBaselineFixture(
  row: MergedMeasureDumpRow,
  scale: DebugScaleConfig,
): FixtureResult {
  return analyzeDottedFixture({
    row,
    scale,
    key: 'fixture-dotted-baseline',
    requireChordHeads: false,
  })
}

function analyzeDottedSecondChordFixture(
  row: MergedMeasureDumpRow,
  scale: DebugScaleConfig,
): FixtureResult {
  return analyzeDottedFixture({
    row,
    scale,
    key: 'fixture-dotted-second-chord',
    requireChordHeads: true,
  })
}

function buildDottedGapParityFixtureResult(params: {
  baselineFixture: FixtureResult
  secondChordFixture: FixtureResult
}): FixtureResult {
  const { baselineFixture, secondChordFixture } = params
  const failures: string[] = []

  if (!baselineFixture.passed) pushFailure(failures, 'baseline-fixture-failed', baselineFixture.key)
  if (!secondChordFixture.passed) pushFailure(failures, 'second-chord-fixture-failed', secondChordFixture.key)

  const baselineGapPx = baselineFixture.visibleLeftGapPx
  const secondChordGapPx = secondChordFixture.visibleLeftGapPx
  if (baselineGapPx === null || secondChordGapPx === null) {
    pushFailure(
      failures,
      'dotted-gap-missing',
      `${baselineGapPx ?? 'null'}!=${secondChordGapPx ?? 'null'}`,
    )
  } else if (Math.abs(baselineGapPx - secondChordGapPx) > DOT_GAP_PARITY_EPSILON_PX) {
    pushFailure(failures, 'dotted-gap-mismatch', `${baselineGapPx}!=${secondChordGapPx}`)
  }

  return {
    key: 'fixture-dotted-gap-parity',
    scale: secondChordFixture.scale,
    measureWidth: secondChordFixture.measureWidth,
    targetOnsetTicks: secondChordFixture.targetOnsetTicks,
    direction: secondChordFixture.direction,
    headXs: secondChordFixture.headXs,
    expectedLeftRequestPx: baselineGapPx,
    actualLeftRequestPx: secondChordGapPx,
    leftWinningStaff: secondChordFixture.leftWinningStaff,
    expectedRightRequestPx: baselineFixture.visibleRightGapPx,
    actualRightRequestPx: secondChordFixture.visibleRightGapPx,
    rightWinningStaff: secondChordFixture.rightWinningStaff,
    visibleLeftGapPx: secondChordGapPx,
    visibleRightGapPx: secondChordFixture.visibleRightGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function analyzeDottedDirectionParityFixture(
  row: MergedMeasureDumpRow,
  scale: DebugScaleConfig,
): FixtureResult {
  const failures: string[] = []
  validateNoBarlineOverflow(row, failures)

  const dottedChords = row.notes
    .filter(
      (note) =>
        note.staff === 'treble' &&
        note.isRest !== true &&
        Array.isArray(note.noteHeads) &&
        note.noteHeads.length > 1 &&
        typeof note.headRightX === 'number' &&
        Number.isFinite(note.headRightX) &&
        typeof note.dotLeftX === 'number' &&
        Number.isFinite(note.dotLeftX) &&
        typeof note.dotRightX === 'number' &&
        Number.isFinite(note.dotRightX),
    )
    .sort((left, right) => {
      const leftOnset = typeof left.onsetTicksInMeasure === 'number' && Number.isFinite(left.onsetTicksInMeasure)
        ? left.onsetTicksInMeasure
        : Number.POSITIVE_INFINITY
      const rightOnset = typeof right.onsetTicksInMeasure === 'number' && Number.isFinite(right.onsetTicksInMeasure)
        ? right.onsetTicksInMeasure
        : Number.POSITIVE_INFINITY
      if (leftOnset !== rightOnset) return leftOnset - rightOnset
      return left.noteIndex - right.noteIndex
    })

  const firstChord = dottedChords[0] ?? null
  const secondChord = dottedChords[1] ?? null

  if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
  if (!firstChord) pushFailure(failures, 'direction-first-dotted-chord-missing')
  if (!secondChord) pushFailure(failures, 'direction-second-dotted-chord-missing')

  const firstGapPx =
    firstChord &&
    typeof firstChord.headRightX === 'number' &&
    typeof firstChord.dotLeftX === 'number'
      ? Number((firstChord.dotLeftX - firstChord.headRightX).toFixed(3))
      : null
  const secondGapPx =
    secondChord &&
    typeof secondChord.headRightX === 'number' &&
    typeof secondChord.dotLeftX === 'number'
      ? Number((secondChord.dotLeftX - secondChord.headRightX).toFixed(3))
      : null

  if (firstGapPx === null) pushFailure(failures, 'direction-first-gap-missing')
  if (secondGapPx === null) pushFailure(failures, 'direction-second-gap-missing')
  if (
    firstGapPx !== null &&
    secondGapPx !== null &&
    Math.abs(firstGapPx - secondGapPx) > DOT_GAP_PARITY_EPSILON_PX
  ) {
    pushFailure(failures, 'direction-gap-mismatch', `${firstGapPx}!=${secondGapPx}`)
  }

  const secondChordNextNote =
    secondChord !== null
      ? row.notes.find(
          (note) =>
            note.staff === 'treble' &&
            note.isRest !== true &&
            note.noteIndex > secondChord.noteIndex &&
            typeof note.onsetTicksInMeasure === 'number' &&
            Number.isFinite(note.onsetTicksInMeasure),
        ) ?? null
      : null
  const nextOccupiedLeftX = secondChordNextNote ? getNoteOccupiedLeftX(secondChordNextNote) : null
  const secondRightGapPx =
    secondChord &&
    typeof secondChord.dotRightX === 'number' &&
    nextOccupiedLeftX !== null
      ? Number((nextOccupiedLeftX - secondChord.dotRightX).toFixed(3))
      : null
  if (secondRightGapPx === null || secondRightGapPx < -GAP_EPSILON_PX) {
    pushFailure(failures, 'direction-second-right-overlap', secondRightGapPx)
  }

  return {
    key: 'fixture-dotted-direction-parity',
    scale,
    measureWidth:
      typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
        ? Number(row.measureWidth.toFixed(3))
        : null,
    targetOnsetTicks:
      secondChord && typeof secondChord.onsetTicksInMeasure === 'number' && Number.isFinite(secondChord.onsetTicksInMeasure)
        ? Math.round(secondChord.onsetTicksInMeasure)
        : null,
    direction: 'both',
    headXs: [
      ...(firstChord ? dedupeSortedNumbers(firstChord.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []),
      ...(secondChord ? dedupeSortedNumbers(secondChord.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : []),
    ],
    expectedLeftRequestPx: firstGapPx,
    actualLeftRequestPx: secondGapPx,
    leftWinningStaff: 'treble',
    expectedRightRequestPx:
      secondChord && typeof secondChord.dotRightX === 'number' ? Number(secondChord.dotRightX.toFixed(3)) : null,
    actualRightRequestPx: nextOccupiedLeftX,
    rightWinningStaff: secondChordNextNote ? 'treble' : 'none',
    visibleLeftGapPx: secondGapPx,
    visibleRightGapPx: secondRightGapPx,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

function createEnharmonicConsistencyAnalyzer(params: {
  key: string
  lowerPitch: 'd#/4' | 'e#/4'
  targetOnsetTicks: number
  requirePreviousSegment: boolean
}) {
  const { key, lowerPitch, targetOnsetTicks, requirePreviousSegment } = params
  return (
    row: MergedMeasureDumpRow,
    scale: DebugScaleConfig,
    secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
  ): FixtureResult => {
    const failures: string[] = []

    const normalizePitch = (value: string | null | undefined): string | null => {
      if (typeof value !== 'string') return null
      return value.trim().toLowerCase()
    }

    const targetNote =
      row.notes.find((note) => {
        if (note.staff !== 'treble' || note.isRest === true) return false
        if (!Number.isFinite(note.onsetTicksInMeasure)) return false
        if (Math.round(note.onsetTicksInMeasure as number) !== targetOnsetTicks) return false
        if (!Array.isArray(note.noteHeads) || note.noteHeads.length < 2) return false
        const normalizedHeadPitches = new Set(
          note.noteHeads.map((head) => normalizePitch(head.pitch)).filter((pitch): pitch is string => pitch !== null),
        )
        return normalizedHeadPitches.has(lowerPitch) && normalizedHeadPitches.has('c#/5')
      }) ?? null

    const onsetReserve =
      getSpacingOnsetReserves(row).find((reserve) => reserve.onsetTicks === targetOnsetTicks) ?? null
    const trebleMetrics = buildStaffOnsetMetrics(row, 'treble')
    const targetMetrics = trebleMetrics.find((metrics) => metrics.onsetTicks === targetOnsetTicks) ?? null
    const targetMetricsIndex = trebleMetrics.findIndex((metrics) => metrics.onsetTicks === targetOnsetTicks)
    const previousMetrics = targetMetricsIndex > 0 ? trebleMetrics[targetMetricsIndex - 1] ?? null : null
    const nextMetrics =
      targetMetricsIndex >= 0 && targetMetricsIndex < trebleMetrics.length - 1
        ? trebleMetrics[targetMetricsIndex + 1] ?? null
        : null

    if (!row.rendered) pushFailure(failures, 'fixture-not-rendered')
    if (!targetNote) pushFailure(failures, 'enharmonic-target-note-missing')
    if (!onsetReserve) pushFailure(failures, 'enharmonic-onset-reserve-missing')
    if (!targetMetrics) pushFailure(failures, 'enharmonic-target-metrics-missing')

    const boundaryStartX =
      typeof row.effectiveBoundaryStartX === 'number' && Number.isFinite(row.effectiveBoundaryStartX)
        ? Number(row.effectiveBoundaryStartX.toFixed(3))
        : null
    const boundaryEndX =
      typeof row.effectiveBoundaryEndX === 'number' && Number.isFinite(row.effectiveBoundaryEndX)
        ? Number(row.effectiveBoundaryEndX.toFixed(3))
        : null

    const expectedLeftRequestPx =
      targetMetrics !== null
        ? computeExpectedLeftRequestPx(targetMetrics, previousMetrics, boundaryStartX, secondChordSafeGapPx)
        : null
    const expectedRightRequestPx =
      targetMetrics !== null
        ? computeExpectedRightRequestPx(targetMetrics, nextMetrics, boundaryEndX, targetNote, secondChordSafeGapPx)
        : null

    const actualLeftSummary =
      targetMetrics !== null
        ? resolveSlotRequestSummary({
            row,
            staff: 'treble',
            onsetTicks: targetMetrics.onsetTicks,
            side: 'left',
          })
        : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }
    const actualRightSummary =
      targetMetrics !== null
        ? resolveSlotRequestSummary({
            row,
            staff: 'treble',
            onsetTicks: targetMetrics.onsetTicks,
            side: 'right',
          })
        : { requestedExtraPx: 0, winningStaff: 'none' as StaffSlotWinner }

    const segment =
      previousMetrics !== null
        ? findSpacingSegmentByTicks(row, previousMetrics.onsetTicks, targetOnsetTicks)
        : null
    if (requirePreviousSegment && !segment) {
      pushFailure(failures, 'enharmonic-target-segment-missing')
    }

    const accidentalSegmentRequestedExtraPx =
      segment !== null ? Number(Math.max(0, segment.accidentalRequestedExtraPx ?? 0).toFixed(3)) : 0

    const ownGapValues = (targetNote?.accidentalCoords ?? [])
      .map((accidental) => toRoundedFiniteNumber(accidental.ownGapPxExact))
      .filter((value): value is number => value !== null)
    const minOwnGapPxExact =
      ownGapValues.length > 0 ? Number(Math.min(...ownGapValues).toFixed(3)) : null
    if (targetNote && ownGapValues.length < 2) {
      pushFailure(failures, 'enharmonic-accidentals-missing', ownGapValues.length)
    }
    if (minOwnGapPxExact === null || minOwnGapPxExact < ACCIDENTAL_OWN_GAP_MIN_PX - GAP_EPSILON_PX) {
      pushFailure(failures, 'enharmonic-own-gap-too-small', minOwnGapPxExact)
    }

    const finalVisibleLeftGapPx = computeFinalVisibleLeftGapPx({
      metrics: targetMetrics,
      previousMetrics,
      boundaryStartX,
      appliedExtraPx: actualLeftSummary.requestedExtraPx,
    })

    const direction = classifyDirection(
      targetNote && Number.isFinite(targetNote.x) ? Number(targetNote.x.toFixed(3)) : null,
      targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : [],
    )

    return {
      key,
      scale,
      measureWidth:
        typeof row.measureWidth === 'number' && Number.isFinite(row.measureWidth)
          ? Number(row.measureWidth.toFixed(3))
          : null,
      targetOnsetTicks: targetOnsetTicks,
      direction,
      headXs: targetNote ? dedupeSortedNumbers(targetNote.noteHeads.map((head) => head.x), HEAD_X_EPSILON_PX) : [],
      expectedLeftRequestPx,
      actualLeftRequestPx: Number(actualLeftSummary.requestedExtraPx.toFixed(3)),
      leftWinningStaff: actualLeftSummary.winningStaff,
      expectedRightRequestPx,
      actualRightRequestPx: Number(actualRightSummary.requestedExtraPx.toFixed(3)),
      rightWinningStaff: actualRightSummary.winningStaff,
      visibleLeftGapPx: finalVisibleLeftGapPx,
      visibleRightGapPx: computeFinalVisibleRightGapPx({
        metrics: targetMetrics,
        nextMetrics,
        boundaryEndX,
        sourceNote: targetNote,
        appliedExtraPx: actualRightSummary.requestedExtraPx,
      }),
      requestedSafeGapPx: secondChordSafeGapPx,
      actualSegmentExtraPx: segment !== null ? Number(Math.max(0, segment.extraReservePx ?? 0).toFixed(3)) : 0,
      rawLeftReservePx: onsetReserve?.rawLeftReservePx ?? null,
      leftOccupiedInsetPx: onsetReserve?.leftOccupiedInsetPx ?? null,
      accidentalSegmentRequestedExtraPx,
      minOwnGapPxExact,
      passed: failures.length === 0,
      failureReasons: failures,
    }
  }
}

function buildEnharmonicParityFixtureResult(params: {
  key: string
  baseFixture: FixtureResult
  targetFixture: FixtureResult
  compareAccidentalSegment: boolean
  expectTargetNotSmaller?: boolean
}): FixtureResult {
  const { key, baseFixture, targetFixture, compareAccidentalSegment, expectTargetNotSmaller = false } = params
  const failures: string[] = []
  const compareMetric = (
    metricName: string,
    baseValue: number | null | undefined,
    targetValue: number | null | undefined,
  ) => {
    if (baseValue === null || baseValue === undefined || targetValue === null || targetValue === undefined) {
      pushFailure(failures, `${metricName}-missing`, `${baseValue ?? 'null'}!=${targetValue ?? 'null'}`)
      return
    }
    if (expectTargetNotSmaller) {
      if (targetValue + 0.5 < baseValue) {
        pushFailure(failures, `${metricName}-target-smaller`, `${targetValue}<${baseValue}`)
      }
      return
    }
    if (Math.abs(baseValue - targetValue) > 0.5) {
      pushFailure(failures, `${metricName}-mismatch`, `${baseValue}!=${targetValue}`)
    }
  }

  if (!baseFixture.passed) pushFailure(failures, 'base-fixture-failed', baseFixture.key)
  if (!targetFixture.passed) pushFailure(failures, 'target-fixture-failed', targetFixture.key)

  compareMetric('raw-left-reserve', baseFixture.rawLeftReservePx, targetFixture.rawLeftReservePx)
  compareMetric('left-occupied-inset', baseFixture.leftOccupiedInsetPx, targetFixture.leftOccupiedInsetPx)
  compareMetric('left-request', baseFixture.actualLeftRequestPx, targetFixture.actualLeftRequestPx)
  if (compareAccidentalSegment) {
    compareMetric(
      'accidental-segment-request',
      baseFixture.accidentalSegmentRequestedExtraPx,
      targetFixture.accidentalSegmentRequestedExtraPx,
    )
  }
  compareMetric('min-own-gap', baseFixture.minOwnGapPxExact, targetFixture.minOwnGapPxExact)

  return {
    key,
    scale: targetFixture.scale,
    measureWidth: targetFixture.measureWidth,
    targetOnsetTicks: targetFixture.targetOnsetTicks,
    direction:
      baseFixture.direction === targetFixture.direction
        ? baseFixture.direction
        : 'both',
    headXs: [],
    expectedLeftRequestPx: baseFixture.actualLeftRequestPx,
    actualLeftRequestPx: targetFixture.actualLeftRequestPx,
    leftWinningStaff: targetFixture.leftWinningStaff,
    expectedRightRequestPx: baseFixture.actualRightRequestPx,
    actualRightRequestPx: targetFixture.actualRightRequestPx,
    rightWinningStaff: targetFixture.rightWinningStaff,
    visibleLeftGapPx: targetFixture.visibleLeftGapPx,
    visibleRightGapPx: targetFixture.visibleRightGapPx,
    rawLeftReservePx: targetFixture.rawLeftReservePx,
    leftOccupiedInsetPx: targetFixture.leftOccupiedInsetPx,
    accidentalSegmentRequestedExtraPx: targetFixture.accidentalSegmentRequestedExtraPx,
    minOwnGapPxExact: targetFixture.minOwnGapPxExact,
    passed: failures.length === 0,
    failureReasons: failures,
  }
}

async function runDesktopScenario(
  page: Page,
  xmlText: string,
  scaleCase: ScaleCase,
  secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX,
): Promise<DesktopScenarioReport> {
  await setSecondChordSafeGapPx(page, secondChordSafeGapPx)
  await importMusicXml(page, xmlText)
  const appliedScale = await setScoreScale(page, scaleCase)
  const mergedRows = await collectMergedRows(page)
  return analyzeDesktopScenario(mergedRows, appliedScale, scaleCase.key, secondChordSafeGapPx)
}

async function runFixtureScenario(params: {
  page: Page
  xmlText: string
  analyzer: (row: MergedMeasureDumpRow, scale: DebugScaleConfig, secondChordSafeGapPx: number) => FixtureResult
  secondChordSafeGapPx?: number
}): Promise<FixtureResult> {
  const { page, xmlText, analyzer, secondChordSafeGapPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX } = params
  await setSecondChordSafeGapPx(page, secondChordSafeGapPx)
  await importMusicXml(page, xmlText)
  const appliedScale = await setScoreScale(page, FIXTURE_SCALE_CASE)
  const mergedRows = await collectMergedRows(page)
  const row =
    mergedRows[0] ??
    ({
      pairIndex: 0,
      rendered: false,
      renderedPageIndex: null,
      overflowVsNoteEndX: null,
      overflowVsMeasureEndBarX: null,
      notes: [],
    } satisfies MergedMeasureDumpRow)
  return analyzer(row, appliedScale, secondChordSafeGapPx)
}

async function runUiSafeGapScenario(params: {
  page: Page
  safeGapPx: number
}): Promise<UiSafeGapScenarioResult> {
  const { page, safeGapPx } = params
  const fixture = await runFixtureScenario({
    page,
    xmlText: LOCAL_BASS_BOUNDARY_COLLISION_FIXTURE_XML,
    analyzer: analyzeLocalCollisionFixture,
    secondChordSafeGapPx: safeGapPx,
  })
  return {
    key: `ui-safe-gap-${safeGapPx}`,
    appliedSafeGapPx: safeGapPx,
    expectedLeftRequestPx: fixture.expectedLeftRequestPx,
    actualLeftRequestPx: fixture.actualLeftRequestPx,
    expectedRightRequestPx: fixture.expectedRightRequestPx,
    actualRightRequestPx: fixture.actualRightRequestPx,
    passed: fixture.passed,
    failureReasons: [...fixture.failureReasons],
  }
}

async function main(): Promise<void> {
  const xmlPath = await resolveDesktopXmlPath(process.argv[2])
  const reportPath = process.argv[3] ?? path.resolve('debug', 'second-chord-spacing-browser-report.json')
  const xmlText = await readFile(xmlPath, 'utf8')

  const server = startDevServer()
  let browser: import('playwright').Browser | null = null

  server.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk))

  try {
    await waitForServer(DEV_URL, 120000)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 4200, height: 1800 } })
    page.on('console', (message) => {
      console.log(`[browser:${message.type()}] ${message.text()}`)
    })
    page.on('pageerror', (error) => {
      console.error(`[browser:pageerror] ${error.stack ?? error.message}`)
    })

    console.log('[second-chord-spacing] opening app')
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
    console.log('[second-chord-spacing] waiting for debug API')
    await waitForDebugApi(page)

    const desktopScenarios: DesktopScenarioReport[] = []
    for (const scaleCase of SCALE_CASES) {
      console.log(`[second-chord-spacing] running desktop sample ${scaleCase.key}`)
      desktopScenarios.push(await runDesktopScenario(page, xmlText, scaleCase))
    }

    const fixtureResults: FixtureResult[] = []
    console.log('[second-chord-spacing] running cross-staff false-positive fixture')
    fixtureResults.push(
      await runFixtureScenario({
        page,
        xmlText: CROSS_STAFF_FALSE_POSITIVE_FIXTURE_XML,
        analyzer: analyzeCrossStaffFixture,
      }),
    )
    console.log('[second-chord-spacing] running local overlap fixture')
    fixtureResults.push(
      await runFixtureScenario({
        page,
        xmlText: LOCAL_BASS_BOUNDARY_COLLISION_FIXTURE_XML,
        analyzer: analyzeLocalCollisionFixture,
      }),
    )
    console.log('[second-chord-spacing] running inner-segment no-extra fixture')
    fixtureResults.push(
      await runFixtureScenario({
        page,
        xmlText: INNER_SEGMENT_NO_EXTRA_FIXTURE_XML,
        analyzer: analyzeInnerSegmentNoExtraFixture,
      }),
    )
    console.log('[second-chord-spacing] running inner-segment safe-gap fixture')
    fixtureResults.push(
      await runFixtureScenario({
        page,
        xmlText: INNER_SEGMENT_SAFE_GAP_FIXTURE_XML,
        analyzer: analyzeInnerSegmentSafeGapFixture,
      }),
    )
    console.log('[second-chord-spacing] running trailing boundary fixture')
    fixtureResults.push(
      await runFixtureScenario({
        page,
        xmlText: TRAILING_BASS_BOUNDARY_COLLISION_FIXTURE_XML,
        analyzer: analyzeTrailingCollisionFixture,
      }),
    )
    console.log('[second-chord-spacing] running dotted baseline fixture')
    const dottedBaselineFixture = await runFixtureScenario({
      page,
      xmlText: DOTTED_BASELINE_FIXTURE_XML,
      analyzer: analyzeDottedBaselineFixture,
    })
    fixtureResults.push(dottedBaselineFixture)
    console.log('[second-chord-spacing] running dotted second-chord fixture')
    const dottedSecondChordFixture = await runFixtureScenario({
      page,
      xmlText: DOTTED_SECOND_CHORD_FIXTURE_XML,
      analyzer: analyzeDottedSecondChordFixture,
    })
    fixtureResults.push(dottedSecondChordFixture)
    fixtureResults.push(
      buildDottedGapParityFixtureResult({
        baselineFixture: dottedBaselineFixture,
        secondChordFixture: dottedSecondChordFixture,
      }),
    )
    console.log('[second-chord-spacing] running dotted direction-parity fixture')
    fixtureResults.push(
      await runFixtureScenario({
        page,
        xmlText: DOTTED_DIRECTION_PARITY_FIXTURE_XML,
        analyzer: analyzeDottedDirectionParityFixture,
      }),
    )
    console.log('[second-chord-spacing] running enharmonic previous-note fixtures')
    const enharmonicPreviousDSharpFixture = await runFixtureScenario({
      page,
      xmlText: ENHARMONIC_PREVIOUS_DSHARP_CSHARP_FIXTURE_XML,
      analyzer: createEnharmonicConsistencyAnalyzer({
        key: 'fixture-enharmonic-previous-dsharp-csharp',
        lowerPitch: 'd#/4',
        targetOnsetTicks: 16,
        requirePreviousSegment: true,
      }),
    })
    const enharmonicPreviousESharpFixture = await runFixtureScenario({
      page,
      xmlText: ENHARMONIC_PREVIOUS_ESHARP_CSHARP_FIXTURE_XML,
      analyzer: createEnharmonicConsistencyAnalyzer({
        key: 'fixture-enharmonic-previous-esharp-csharp',
        lowerPitch: 'e#/4',
        targetOnsetTicks: 16,
        requirePreviousSegment: true,
      }),
    })
    fixtureResults.push(enharmonicPreviousDSharpFixture)
    fixtureResults.push(enharmonicPreviousESharpFixture)
    fixtureResults.push(
      buildEnharmonicParityFixtureResult({
        key: 'fixture-enharmonic-previous-parity',
        baseFixture: enharmonicPreviousDSharpFixture,
        targetFixture: enharmonicPreviousESharpFixture,
        compareAccidentalSegment: true,
        expectTargetNotSmaller: true,
      }),
    )

    console.log('[second-chord-spacing] running enharmonic barline fixtures')
    const enharmonicBarlineDSharpFixture = await runFixtureScenario({
      page,
      xmlText: ENHARMONIC_BARLINE_DSHARP_CSHARP_FIXTURE_XML,
      analyzer: createEnharmonicConsistencyAnalyzer({
        key: 'fixture-enharmonic-barline-dsharp-csharp',
        lowerPitch: 'd#/4',
        targetOnsetTicks: 0,
        requirePreviousSegment: false,
      }),
    })
    const enharmonicBarlineESharpFixture = await runFixtureScenario({
      page,
      xmlText: ENHARMONIC_BARLINE_ESHARP_CSHARP_FIXTURE_XML,
      analyzer: createEnharmonicConsistencyAnalyzer({
        key: 'fixture-enharmonic-barline-esharp-csharp',
        lowerPitch: 'e#/4',
        targetOnsetTicks: 0,
        requirePreviousSegment: false,
      }),
    })
    fixtureResults.push(enharmonicBarlineDSharpFixture)
    fixtureResults.push(enharmonicBarlineESharpFixture)
    fixtureResults.push(
      buildEnharmonicParityFixtureResult({
        key: 'fixture-enharmonic-barline-parity',
        baseFixture: enharmonicBarlineDSharpFixture,
        targetFixture: enharmonicBarlineESharpFixture,
        compareAccidentalSegment: false,
        expectTargetNotSmaller: true,
      }),
    )

    const uiSafeGapScenarios: UiSafeGapScenarioResult[] = []
    console.log('[second-chord-spacing] running UI safe-gap scenario 0px')
    uiSafeGapScenarios.push(await runUiSafeGapScenario({ page, safeGapPx: 0 }))
    console.log('[second-chord-spacing] running UI safe-gap scenario 3px')
    uiSafeGapScenarios.push(await runUiSafeGapScenario({ page, safeGapPx: DEFAULT_SECOND_CHORD_SAFE_GAP_PX }))

    if (uiSafeGapScenarios.length >= 2) {
      const zeroGapScenario = uiSafeGapScenarios[0]
      const defaultGapScenario = uiSafeGapScenarios[1]
      if (
        zeroGapScenario &&
        defaultGapScenario &&
        zeroGapScenario.actualLeftRequestPx !== null &&
        defaultGapScenario.actualLeftRequestPx !== null
      ) {
        const expectedDeltaPx = DEFAULT_SECOND_CHORD_SAFE_GAP_PX
        const actualDeltaPx = Number(
          (defaultGapScenario.actualLeftRequestPx - zeroGapScenario.actualLeftRequestPx).toFixed(3),
        )
        if (Math.abs(actualDeltaPx - expectedDeltaPx) > GAP_EPSILON_PX) {
          defaultGapScenario.passed = false
          defaultGapScenario.failureReasons.push(`ui-safe-gap-delta:${actualDeltaPx}!=${expectedDeltaPx}`)
        }
      }
    }

    const report: FinalReport = {
      generatedAt: new Date().toISOString(),
      xmlPath,
      desktopScenarios,
      fixtureResults,
      uiSafeGapScenarios,
    }

    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    desktopScenarios.forEach((scenario) => {
      console.log(
        `[second-chord-spacing] desktop ${scenario.key}: ${scenario.passed ? 'PASS' : 'FAIL'} ` +
          `(scale=${scenario.scale.scoreScale ?? 'n/a'})`,
      )
      scenario.targets.forEach((target) => {
        console.log(
          `  pair=${target.pairIndex} page=${target.renderedPageIndex ?? 'n/a'} onset=${target.onsetTicks ?? 'null'} ` +
            `direction=${target.direction} left=${target.actualLeftRequestPx ?? 'null'}/${target.expectedLeftRequestPx ?? 'null'} ` +
            `right=${target.actualRightRequestPx ?? 'null'}/${target.expectedRightRequestPx ?? 'null'} ` +
            `winnerL=${target.leftWinningStaff} winnerR=${target.rightWinningStaff} ` +
            `visibleLeftGap=${target.visibleLeftGapPx ?? 'null'} visibleRightGap=${target.visibleRightGapPx ?? 'null'} ` +
            `${target.passed ? 'PASS' : 'FAIL'} ${target.failureReasons.length > 0 ? JSON.stringify(target.failureReasons) : ''}`,
        )
      })
    })

    fixtureResults.forEach((fixture) => {
      console.log(
        `[second-chord-spacing] ${fixture.key}: ${fixture.passed ? 'PASS' : 'FAIL'} ` +
          `left=${fixture.actualLeftRequestPx ?? 'null'}/${fixture.expectedLeftRequestPx ?? 'null'} ` +
          `right=${fixture.actualRightRequestPx ?? 'null'}/${fixture.expectedRightRequestPx ?? 'null'} ` +
          `winnerL=${fixture.leftWinningStaff} winnerR=${fixture.rightWinningStaff} ` +
          `direction=${fixture.direction} visibleLeftGap=${fixture.visibleLeftGapPx ?? 'null'} ` +
          `visibleRightGap=${fixture.visibleRightGapPx ?? 'null'} ` +
          `${fixture.failureReasons.length > 0 ? JSON.stringify(fixture.failureReasons) : ''}`,
      )
    })

    uiSafeGapScenarios.forEach((scenario) => {
      console.log(
        `[second-chord-spacing] ${scenario.key}: ${scenario.passed ? 'PASS' : 'FAIL'} ` +
          `left=${scenario.actualLeftRequestPx ?? 'null'}/${scenario.expectedLeftRequestPx ?? 'null'} ` +
          `right=${scenario.actualRightRequestPx ?? 'null'}/${scenario.expectedRightRequestPx ?? 'null'} ` +
          `${scenario.failureReasons.length > 0 ? JSON.stringify(scenario.failureReasons) : ''}`,
      )
    })

    console.log(`Generated: ${reportPath}`)

    if (
      !desktopScenarios.every((scenario) => scenario.passed) ||
      !fixtureResults.every((fixture) => fixture.passed) ||
      !uiSafeGapScenarios.every((scenario) => scenario.passed)
    ) {
      throw new Error('Second-chord spacing regression detected.')
    }
  } finally {
    if (browser) {
      await browser.close()
    }
    await stopDevServer(server)
  }
}

void main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message)
  } else {
    console.error(error)
  }
  process.exitCode = 1
})
