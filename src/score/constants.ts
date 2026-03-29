import type { NoteDuration, Pitch, RhythmPresetId, ScoreNote } from './types'
import { DEFAULT_STAFF_INTER_GAP_PX, getGrandStaffLayoutMetrics } from './grandStaffLayout'

export const A4_PAGE_WIDTH = 794
export const A4_PAGE_HEIGHT = 1123
export const SCORE_PAGE_PADDING_X = 24
export const SCORE_TOP_PADDING = 44
const DEFAULT_GRAND_STAFF_LAYOUT = getGrandStaffLayoutMetrics(DEFAULT_STAFF_INTER_GAP_PX)
export const SYSTEM_TREBLE_OFFSET_Y = DEFAULT_GRAND_STAFF_LAYOUT.trebleOffsetY
export const SYSTEM_BASS_OFFSET_Y = DEFAULT_GRAND_STAFF_LAYOUT.bassOffsetY
export const SYSTEM_GAP_Y = 44
export const SYSTEM_HEIGHT = DEFAULT_GRAND_STAFF_LAYOUT.systemHeightPx
export const STAFF_X = SCORE_PAGE_PADDING_X
export const QUARTER_NOTE_SECONDS = 0.5
export const PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX = -8
export const PREVIEW_START_THRESHOLD_PX = 3

export const PIANO_MIN_MIDI = 21 // A0
export const PIANO_MAX_MIDI = 108 // C8
export const CHROMATIC_STEPS = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'] as const

export const DEFAULT_DEMO_MEASURE_COUNT = 16

const INITIAL_TREBLE_MEASURE_TEMPLATE: ReadonlyArray<Pick<ScoreNote, 'pitch' | 'duration'>> = [
  { pitch: 'c/5', duration: 'q' },
  { pitch: 'e/5', duration: 'q' },
  { pitch: 'g/4', duration: 'q' },
  { pitch: 'd/5', duration: 'q' },
]

export const INITIAL_NOTES: ScoreNote[] = Array.from({ length: DEFAULT_DEMO_MEASURE_COUNT }, (_, measureIndex) =>
  INITIAL_TREBLE_MEASURE_TEMPLATE.map((entry, slotIndex) => ({
    id: `seed-t-${measureIndex + 1}-${slotIndex + 1}`,
    pitch: entry.pitch,
    duration: entry.duration,
  })),
).flat()

export const DURATION_BEATS: Record<NoteDuration, number> = {
  w: 4,
  hd: 3,
  h: 2,
  qd: 1.5,
  q: 1,
  '8': 0.5,
  '16d': 0.375,
  '16': 0.25,
  '32': 0.125,
  '8d': 0.75,
  '32d': 0.1875,
}

export const TICKS_PER_BEAT = 16

export const DURATION_TICKS: Record<NoteDuration, number> = {
  w: 64,
  hd: 48,
  h: 32,
  qd: 24,
  q: 16,
  '8d': 12,
  '8': 8,
  '16d': 6,
  '16': 4,
  '32d': 3,
  '32': 2,
}

export const DURATION_GREEDY_ORDER: NoteDuration[] = ['w', 'hd', 'h', 'qd', 'q', '8d', '8', '16d', '16', '32d', '32']
export const MEASURE_TICKS = 64

export const DURATION_TONE: Record<NoteDuration, string> = {
  w: '1n',
  hd: '2n.',
  h: '2n',
  qd: '4n.',
  q: '4n',
  '8': '8n',
  '16d': '16n.',
  '16': '16n',
  '32': '32n',
  '8d': '8n.',
  '32d': '32n.',
}

export const DURATION_LABEL: Record<NoteDuration, string> = {
  w: '全音符',
  hd: '附点二分音符',
  h: '二分音符',
  qd: '附点四分音符',
  q: '四分音符',
  '8': '八分音符',
  '16d': '附点十六分音符',
  '16': '十六分音符',
  '32': '三十二分音符',
  '8d': '附点八分音符',
  '32d': '附点三十二分音符',
}

export const DURATION_MUSIC_XML: Record<NoteDuration, { type: string; dots: number }> = {
  w: { type: 'whole', dots: 0 },
  hd: { type: 'half', dots: 1 },
  h: { type: 'half', dots: 0 },
  qd: { type: 'quarter', dots: 1 },
  q: { type: 'quarter', dots: 0 },
  '8d': { type: 'eighth', dots: 1 },
  '8': { type: 'eighth', dots: 0 },
  '16d': { type: '16th', dots: 1 },
  '16': { type: '16th', dots: 0 },
  '32d': { type: '32nd', dots: 1 },
  '32': { type: '32nd', dots: 0 },
}

export const DURATION_LAYOUT_WEIGHT: Record<NoteDuration, number> = {
  w: 0.8,
  hd: 1.1,
  h: 1.0,
  qd: 1.3,
  q: 1.2,
  '8d': 1.7,
  '8': 1.6,
  '16d': 2.2,
  '16': 2.0,
  '32d': 2.8,
  '32': 2.6,
}

export const ACCIDENTAL_TO_MUSIC_XML: Record<string, string> = {
  '#': 'sharp',
  b: 'flat',
  n: 'natural',
  '##': 'double-sharp',
  bb: 'flat-flat',
}

export const RHYTHM_PRESETS: { id: RhythmPresetId; label: string; pattern: NoteDuration[] }[] = [
  { id: 'quarter', label: '四分脉冲', pattern: ['q', 'q', 'q', 'q'] },
  { id: 'twoEighth', label: '双八分型', pattern: ['8', '8', '8', '8', '8', '8', '8', '8'] },
  {
    id: 'fourSixteenth',
    label: '四连十六分型',
    pattern: ['16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16'],
  },
  {
    id: 'eightSixteenth',
    label: '8-16-16 组合',
    pattern: ['8', '16', '16', '8', '16', '16', '8', '16', '16', '8', '16', '16'],
  },
  {
    id: 'shortDotted',
    label: '短附点型',
    pattern: ['8d', '16', '8d', '16', '8d', '16', '8d', '16'],
  },
]

export const SAMPLE_MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <pitch><step>G</step><octave>4</octave></pitch>
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
        <pitch><step>G</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>F</step><octave>2</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
`

export const BASS_MOCK_PATTERN: Pitch[] = ['c/3', 'g/2', 'a/2', 'e/3']

export const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

export const KEY_SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const
export const KEY_FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const

export const KEY_FIFTHS_TO_MAJOR: Record<number, string> = {
  [-7]: 'Cb',
  [-6]: 'Gb',
  [-5]: 'Db',
  [-4]: 'Ab',
  [-3]: 'Eb',
  [-2]: 'Bb',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F#',
  7: 'C#',
}
