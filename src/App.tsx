import { useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Accidental, BarlineType, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveConnector, StaveNote, Voice } from 'vexflow'
import './App.css'

const A4_PAGE_WIDTH = 794
const SCORE_PAGE_PADDING_X = 24
const SCORE_TOP_PADDING = 28
const SYSTEM_TREBLE_OFFSET_Y = 22
const SYSTEM_BASS_OFFSET_Y = 108
const SYSTEM_GAP_Y = 44
const SYSTEM_HEIGHT = 208
const STAFF_X = SCORE_PAGE_PADDING_X
const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const QUARTER_NOTE_SECONDS = 0.5
const PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX = -8
const PREVIEW_START_THRESHOLD_PX = 3

const PIANO_MIN_MIDI = 21 // A0
const PIANO_MAX_MIDI = 108 // C8
const CHROMATIC_STEPS = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'] as const

type Pitch = string
type StemDirection = 1 | -1
type NoteDuration = 'w' | 'h' | 'q' | '8' | '16' | '32' | 'qd' | '8d' | '16d' | '32d'
type NoteDurationBase = 'w' | 'h' | 'q' | '8' | '16' | '32'
type RhythmPresetId = 'quarter' | 'twoEighth' | 'fourSixteenth' | 'eightSixteenth' | 'shortDotted'
type StaffKind = 'treble' | 'bass'
type BeamTag = 'begin' | 'continue' | 'end'

type TimeSignature = {
  beats: number
  beatType: number
}

type MusicXmlCreator = {
  type?: string
  text: string
}

type MusicXmlMetadata = {
  version: string
  workTitle: string
  rights?: string
  creators: MusicXmlCreator[]
  softwares: string[]
  encodingDate?: string
  partName: string
  partAbbreviation?: string
}

type ScoreNote = {
  id: string
  pitch: Pitch
  duration: NoteDuration
  accidental?: string | null
  chordPitches?: Pitch[]
  chordAccidentals?: Array<string | null>
}

type ImportResult = {
  trebleNotes: ScoreNote[]
  bassNotes: ScoreNote[]
  measurePairs: MeasurePair[]
  measureKeyFifths: number[]
  measureDivisions: number[]
  measureTimeSignatures: TimeSignature[]
  metadata: MusicXmlMetadata
}

type ImportFeedback = {
  kind: 'idle' | 'success' | 'error'
  message: string
}

type NoteHeadLayout = {
  x: number
  y: number
  pitch: Pitch
  keyIndex: number
}

type NoteLayout = {
  id: string
  staff: StaffKind
  pairIndex: number
  noteIndex: number
  x: number
  y: number
  pitchYMap: Record<Pitch, number>
  noteHeads: NoteHeadLayout[]
  accidentalRightXByKeyIndex: Record<number, number>
}

type DragDebugStaticRecord = {
  staff: StaffKind
  noteId: string
  noteIndex: number
  noteX: number
  headXByKeyIndex: Map<number, number>
  accidentalRightXByKeyIndex: Map<number, number>
}

type DragDebugRow = {
  frame: number
  pairIndex: number
  staff: StaffKind
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: Pitch
  noteXStatic: number | null
  noteXPreview: number | null
  noteXDelta: number | null
  headXStatic: number | null
  headXPreview: number | null
  headXDelta: number | null
  accidentalRightXStatic: number | null
  accidentalRightXPreview: number | null
  accidentalRightXDelta: number | null
  hasAccidentalModifier: boolean
  accidentalTargetRightX: number | null
  accidentalLockApplied: boolean
  accidentalLockReason: string
}

type DragDebugSnapshot = {
  frame: number
  pairIndex: number
  draggedNoteId: string
  draggedStaff: StaffKind
  rows: DragDebugRow[]
}

type Selection = {
  noteId: string
  staff: StaffKind
  keyIndex: number
}

type DragState = {
  noteId: string
  staff: StaffKind
  keyIndex: number
  pairIndex: number
  noteIndex: number
  pointerId: number
  surfaceTop: number
  startClientY: number
  pitch: Pitch
  previewStarted: boolean
  grabOffsetY: number
  pitchYMap: Record<Pitch, number>
  keyFifths: number
  accidentalStateBeforeNote: Map<string, number>
  staticNoteXById: Map<string, number>
  previewAccidentalRightXById: Map<string, Map<number, number>>
  debugStaticByNoteKey: Map<string, DragDebugStaticRecord>
}

type MeasureLayout = {
  pairIndex: number
  measureX: number
  measureWidth: number
  trebleY: number
  bassY: number
  systemTop: number
  isSystemStart: boolean
  keyFifths: number
  showKeySignature: boolean
  timeSignature: TimeSignature
  showTimeSignature: boolean
  endTimeSignature: TimeSignature | null
  showEndTimeSignature: boolean
  includeMeasureStartDecorations: boolean
  noteStartX: number
  formatWidth: number
  overlayRect: {
    x: number
    y: number
    width: number
    height: number
  }
}

type MeasurePair = {
  treble: ScoreNote[]
  bass: ScoreNote[]
}

type ImportedNoteLocation = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
}

const INITIAL_NOTES: ScoreNote[] = [
  { id: 'n1', pitch: 'c/5', duration: 'q' },
  { id: 'n2', pitch: 'e/5', duration: 'q' },
  { id: 'n3', pitch: 'g/4', duration: 'q' },
  { id: 'n4', pitch: 'd/5', duration: 'q' },
]

let nextNoteSerial = 5

const DURATION_BEATS: Record<NoteDuration, number> = {
  w: 4,
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

const TICKS_PER_BEAT = 16

const DURATION_TICKS: Record<NoteDuration, number> = {
  w: 64,
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

const DURATION_GREEDY_ORDER: NoteDuration[] = ['w', 'h', 'qd', 'q', '8d', '8', '16d', '16', '32d', '32']
const MEASURE_TICKS = 64

const DURATION_TONE: Record<NoteDuration, string> = {
  w: '1n',
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

const DURATION_LABEL: Record<NoteDuration, string> = {
  w: 'Whole',
  h: 'Half',
  qd: 'Dotted Quarter',
  q: 'Quarter',
  '8': 'Eighth',
  '16d': 'Dotted Sixteenth',
  '16': 'Sixteenth',
  '32': 'Thirty-second',
  '8d': 'Dotted Eighth',
  '32d': 'Dotted Thirty-second',
}

const DURATION_MUSIC_XML: Record<NoteDuration, { type: string; dots: number }> = {
  w: { type: 'whole', dots: 0 },
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

const DURATION_LAYOUT_WEIGHT: Record<NoteDuration, number> = {
  w: 0.8,
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

const ACCIDENTAL_TO_MUSIC_XML: Record<string, string> = {
  '#': 'sharp',
  b: 'flat',
  n: 'natural',
  '##': 'double-sharp',
  bb: 'flat-flat',
}

const RHYTHM_PRESETS: { id: RhythmPresetId; label: string; pattern: NoteDuration[] }[] = [
  { id: 'quarter', label: 'Quarter Pulse', pattern: ['q', 'q', 'q', 'q'] },
  { id: 'twoEighth', label: '2x Eighth Pattern', pattern: ['8', '8', '8', '8', '8', '8', '8', '8'] },
  {
    id: 'fourSixteenth',
    label: '4x Sixteenth Pattern',
    pattern: ['16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16'],
  },
  {
    id: 'eightSixteenth',
    label: '8-16-16 Pattern',
    pattern: ['8', '16', '16', '8', '16', '16', '8', '16', '16', '8', '16', '16'],
  },
  {
    id: 'shortDotted',
    label: 'Short Dotted Pattern',
    pattern: ['8d', '16', '8d', '16', '8d', '16', '8d', '16'],
  },
]

const SAMPLE_MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
const BASS_MOCK_PATTERN: Pitch[] = ['c/3', 'g/2', 'a/2', 'e/3', 'f/2', 'c/3', 'd/3', 'g/2']
const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}
const KEY_SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const
const KEY_FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const
const KEY_FIFTHS_TO_MAJOR: Record<number, string> = {
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

const pitchLineCache = new Map<string, number>()

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function midiToPitch(midi: number): Pitch {
  const note = CHROMATIC_STEPS[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${note}/${octave}`
}

function createPianoPitches(): Pitch[] {
  const result: Pitch[] = []
  for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi += 1) {
    result.push(midiToPitch(midi))
  }
  return result
}

const PITCHES: Pitch[] = createPianoPitches()

function parsePitch(pitch: Pitch): { note: string; octave: number } {
  const [note, octaveText] = pitch.split('/')
  return { note, octave: Number(octaveText) }
}

function formatPitchName(note: string): string {
  if (!note) return note
  return `${note[0].toUpperCase()}${note.slice(1)}`
}

function getPitchLine(clef: StaffKind, pitch: Pitch): number {
  const key = `${clef}|${pitch}`
  const cached = pitchLineCache.get(key)
  if (cached !== undefined) return cached

  const probe = new StaveNote({
    keys: [pitch],
    duration: 'q',
    clef,
  })
  const line = probe.getKeyLine(0)
  pitchLineCache.set(key, line)
  return line
}

function getAccidentalFromPitch(pitch: Pitch): string | null {
  const { note } = parsePitch(pitch)
  const accidental = note.slice(1)
  return accidental.length > 0 ? accidental : null
}

function getAccidentalSymbolFromAlter(alter: number): string | null {
  if (alter === 2) return '##'
  if (alter === 1) return '#'
  if (alter === -1) return 'b'
  if (alter === -2) return 'bb'
  if (alter === 0) return null
  return null
}

function getAccidentalStateKey(step: string, octave: number): string {
  return `${step}${octave}`
}

function getLayoutNoteKey(staff: StaffKind, noteId: string): string {
  return `${staff}|${noteId}`
}

function getRenderedNoteVisualX(note: StaveNote): number {
  return note.getNoteHeadBeginX()
}

function finiteOrNull(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function deltaOrNull(preview: number | null, baseline: number | null): number | null {
  if (preview === null || baseline === null) return null
  return preview - baseline
}

function roundNumber(value: number, digits = 3): number {
  const base = 10 ** digits
  return Math.round(value * base) / base
}

function getAccidentalVisualX(note: StaveNote, modifier: Accidental, renderedIndex: number): number | null {
  const absoluteX = (modifier as unknown as { getAbsoluteX?: () => number }).getAbsoluteX?.()
  if (typeof absoluteX === 'number' && Number.isFinite(absoluteX)) return absoluteX
  const start = note.getModifierStartXY(1, renderedIndex)
  const startX = start?.x
  if (!Number.isFinite(startX)) return null
  // Mirror VexFlow Accidental.draw(): x = start.x - width (+ xShift at render time).
  const width = modifier.getWidth()
  const fallbackX = startX - width + modifier.getXShift()
  return Number.isFinite(fallbackX) ? fallbackX : null
}

function getAccidentalRightXByRenderedIndex(note: StaveNote): Map<number, number> {
  const positions = new Map<number, number>()
  note.getModifiersByType(Accidental.CATEGORY).forEach((modifier) => {
    const renderedIndex = modifier.getIndex()
    if (renderedIndex === undefined) return
    const rightX = getAccidentalVisualX(note, modifier as Accidental, renderedIndex)
    if (rightX === null) return
    positions.set(renderedIndex, rightX)
  })
  return positions
}

function addModifierXShift(modifier: Accidental, delta: number): void {
  const raw = modifier as unknown as { xShift?: number }
  const current = typeof raw.xShift === 'number' ? raw.xShift : modifier.getXShift()
  raw.xShift = current + delta
}

function getEffectiveAlterFromContext(
  step: string,
  octave: number,
  keyFifths: number,
  accidentalStateBeforeNote?: Map<string, number> | null,
): number {
  const carried = accidentalStateBeforeNote?.get(getAccidentalStateKey(step, octave))
  if (carried !== undefined) return carried
  return getKeySignatureAlterForStep(step, keyFifths)
}

function getEffectivePitchForStaffPosition(
  staffPositionPitch: Pitch,
  keyFifths: number,
  accidentalStateBeforeNote?: Map<string, number> | null,
): Pitch {
  const { step, octave } = getStepOctaveAlterFromPitch(staffPositionPitch)
  const effectiveAlter = getEffectiveAlterFromContext(step, octave, keyFifths, accidentalStateBeforeNote)
  return toPitchFromStepAlter(step, effectiveAlter, octave)
}

function isSameStaffPositionPitch(left: Pitch, right: Pitch): boolean {
  const leftParts = getStepOctaveAlterFromPitch(left)
  const rightParts = getStepOctaveAlterFromPitch(right)
  return leftParts.step === rightParts.step && leftParts.octave === rightParts.octave
}

function getAccidentalFromPitchAgainstContext(
  renderedPitch: Pitch,
  keyFifths: number,
  accidentalStateBeforeNote?: Map<string, number> | null,
): string | null {
  const { step, octave, alter } = getStepOctaveAlterFromPitch(renderedPitch)
  const expectedAlter = getEffectiveAlterFromContext(step, octave, keyFifths, accidentalStateBeforeNote)
  if (alter === expectedAlter) return null
  if (alter === 0 && expectedAlter !== 0) return 'n'
  return getAccidentalSymbolFromAlter(alter)
}

function getRenderedAccidental(
  note: ScoreNote,
  renderedPitch: Pitch,
  keyFifths: number,
  accidentalStateBeforeNote?: Map<string, number> | null,
  forceFromPitch = false,
): string | null {
  if (!forceFromPitch && note.accidental !== undefined) return note.accidental
  return forceFromPitch
    ? getAccidentalFromPitchAgainstContext(renderedPitch, keyFifths, accidentalStateBeforeNote)
    : getAccidentalFromPitch(renderedPitch)
}

function toPitchFromStepAlter(step: string, alter: number, octave: number): Pitch {
  if (Number.isInteger(alter) && alter >= -2 && alter <= 2) {
    const accidental = alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : ''
    return `${step.toLowerCase()}${accidental}/${octave}`
  }
  const midi = clamp((octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter, PIANO_MIN_MIDI, PIANO_MAX_MIDI)
  return midiToPitch(midi)
}

function getAlterFromAccidentalSymbol(accidental: string): number | undefined {
  const ACCIDENTAL_ALTER_MAP: Record<string, number> = {
    '#': 1,
    b: -1,
    n: 0,
    '##': 2,
    bb: -2,
  }
  return ACCIDENTAL_ALTER_MAP[accidental]
}

function getStepOctaveAlterFromPitch(pitch: Pitch): { step: string; octave: number; alter: number } {
  const { note, octave } = parsePitch(pitch)
  const step = note[0]?.toUpperCase() ?? 'C'
  const accidental = note.slice(1)
  const alter = getAlterFromAccidentalSymbol(accidental) ?? 0
  return { step, octave, alter }
}

function getKeySignatureAlterForStep(step: string, fifths: number): number {
  if (fifths > 0) {
    const sharpSteps = KEY_SHARP_ORDER.slice(0, Math.min(fifths, KEY_SHARP_ORDER.length))
    return sharpSteps.includes(step as (typeof KEY_SHARP_ORDER)[number]) ? 1 : 0
  }
  if (fifths < 0) {
    const flatSteps = KEY_FLAT_ORDER.slice(0, Math.min(-fifths, KEY_FLAT_ORDER.length))
    return flatSteps.includes(step as (typeof KEY_FLAT_ORDER)[number]) ? -1 : 0
  }
  return 0
}

function getKeySignatureSpecFromFifths(fifths: number): string {
  const clamped = clamp(Math.trunc(fifths), -7, 7)
  return KEY_FIFTHS_TO_MAJOR[clamped] ?? 'C'
}

function resolvePitchByAccidentalState(
  pitch: Pitch,
  accidental: string | null | undefined,
  state: Map<string, number>,
  keyFifths: number,
): Pitch {
  const { step, octave, alter: pitchAlter } = getStepOctaveAlterFromPitch(pitch)
  const key = `${step}${octave}`

  let resolvedAlter = pitchAlter
  if (accidental === null) {
    resolvedAlter = getEffectiveAlterFromContext(step, octave, keyFifths, state)
  } else if (typeof accidental === 'string') {
    resolvedAlter = getAlterFromAccidentalSymbol(accidental) ?? pitchAlter
  }

  state.set(key, resolvedAlter)
  return toPitchFromStepAlter(step, resolvedAlter, octave)
}

function buildAccidentalStateBeforeNote(notes: ScoreNote[], noteIndex: number, keyFifths: number): Map<string, number> {
  const state = new Map<string, number>()
  const end = clamp(noteIndex, 0, notes.length)
  for (let index = 0; index < end; index += 1) {
    const note = notes[index]
    resolvePitchByAccidentalState(note.pitch, note.accidental, state, keyFifths)
    note.chordPitches?.forEach((chordPitch, chordIndex) => {
      const chordAccidental = note.chordAccidentals?.[chordIndex]
      resolvePitchByAccidentalState(chordPitch, chordAccidental, state, keyFifths)
    })
  }
  return state
}

function getRequiredAccidentalForTargetAlter(targetAlter: number, expectedAlter: number): string | null {
  if (targetAlter === expectedAlter) return null
  if (targetAlter === 0 && expectedAlter !== 0) return 'n'
  return getAccidentalSymbolFromAlter(targetAlter)
}

function normalizeMeasureStaffByAccidentalState(notes: ScoreNote[], keyFifths: number): ScoreNote[] {
  const state = new Map<string, number>()
  let changed = false

  const next = notes.map((note) => {
    const { step, octave, alter } = getStepOctaveAlterFromPitch(note.pitch)
    const expectedAlter = getEffectiveAlterFromContext(step, octave, keyFifths, state)
    const nextAccidental = getRequiredAccidentalForTargetAlter(alter, expectedAlter)
    state.set(getAccidentalStateKey(step, octave), alter)

    const currentAccidental = note.accidental ?? null
    const rootChanged = currentAccidental !== nextAccidental

    let nextChordAccidentals = note.chordAccidentals
    let chordChanged = false
    if (note.chordPitches?.length) {
      const computedChordAccidentals = note.chordPitches.map((chordPitch) => {
        const chordParts = getStepOctaveAlterFromPitch(chordPitch)
        const chordExpectedAlter = getEffectiveAlterFromContext(chordParts.step, chordParts.octave, keyFifths, state)
        const chordAccidental = getRequiredAccidentalForTargetAlter(chordParts.alter, chordExpectedAlter)
        state.set(getAccidentalStateKey(chordParts.step, chordParts.octave), chordParts.alter)
        return chordAccidental
      })
      const currentChordAccidentals = note.chordAccidentals ?? new Array(computedChordAccidentals.length).fill(null)
      chordChanged =
        currentChordAccidentals.length !== computedChordAccidentals.length ||
        computedChordAccidentals.some((accidental, index) => accidental !== currentChordAccidentals[index])
      if (chordChanged) {
        nextChordAccidentals = computedChordAccidentals
      }
    }

    if (!rootChanged && !chordChanged) return note
    changed = true
    const nextNote: ScoreNote = { ...note, accidental: nextAccidental }
    if (note.chordPitches?.length) {
      nextNote.chordAccidentals = nextChordAccidentals
    }
    return nextNote
  })

  return changed ? next : notes
}

function normalizeMeasurePairAt(pairs: MeasurePair[], pairIndex: number, keyFifthsByMeasure?: number[] | null): MeasurePair[] {
  const pair = pairs[pairIndex]
  if (!pair) return pairs

  const keyFifths = keyFifthsByMeasure?.[pairIndex] ?? 0
  const nextTreble = normalizeMeasureStaffByAccidentalState(pair.treble, keyFifths)
  const nextBass = normalizeMeasureStaffByAccidentalState(pair.bass, keyFifths)
  if (nextTreble === pair.treble && nextBass === pair.bass) return pairs

  const nextPairs = pairs.slice()
  nextPairs[pairIndex] = { treble: nextTreble, bass: nextBass }
  return nextPairs
}

type RenderedNoteKey = {
  pitch: Pitch
  accidental: string | null
  keyIndex: number
}

function buildRenderedNoteKeys(
  note: ScoreNote,
  staff: StaffKind,
  renderedPitch: Pitch,
  renderedChordPitches: Pitch[] | undefined,
  keyFifths: number,
  accidentalStateBeforeNote: Map<string, number> | null,
  forceRootAccidentalFromPitch: boolean,
  forceChordAccidentalFromPitchIndex: number | null,
  accidentalOverridesByKeyIndex?: Map<number, string | null> | null,
): RenderedNoteKey[] {
  const rootOverride = accidentalOverridesByKeyIndex?.get(0)
  const keys: RenderedNoteKey[] = [
    {
      pitch: renderedPitch,
      accidental:
        rootOverride !== undefined
          ? rootOverride
          : getRenderedAccidental(
              note,
              renderedPitch,
              keyFifths,
              accidentalStateBeforeNote,
              forceRootAccidentalFromPitch,
            ),
      keyIndex: 0,
    },
  ]

  renderedChordPitches?.forEach((pitch, index) => {
    const chordOverride = accidentalOverridesByKeyIndex?.get(index + 1)
    const chordAccidental = note.chordAccidentals?.[index]
    const accidental =
      chordOverride !== undefined
        ? chordOverride
        : forceChordAccidentalFromPitchIndex === index
          ? getAccidentalFromPitchAgainstContext(pitch, keyFifths, accidentalStateBeforeNote)
          : chordAccidental !== undefined
            ? chordAccidental
            : getAccidentalFromPitch(pitch)
    keys.push({ pitch, accidental, keyIndex: index + 1 })
  })

  keys.sort((left, right) => getPitchLine(staff, left.pitch) - getPitchLine(staff, right.pitch))
  return keys
}

function buildPitchLineMap(clef: StaffKind): Record<Pitch, number> {
  const map = {} as Record<Pitch, number>
  for (const pitch of PITCHES) {
    map[pitch] = getPitchLine(clef, pitch)
  }
  return map
}

const PITCH_LINE_MAP: Record<StaffKind, Record<Pitch, number>> = {
  treble: buildPitchLineMap('treble'),
  bass: buildPitchLineMap('bass'),
}

function toDisplayPitch(pitch: Pitch): string {
  const { note, octave } = parsePitch(pitch)
  return `${formatPitchName(note)}${octave}`
}

function toTonePitch(pitch: Pitch): string {
  const { note, octave } = parsePitch(pitch)
  return `${formatPitchName(note)}${octave}`
}

function toDisplayDuration(duration: NoteDuration): string {
  return DURATION_LABEL[duration]
}

function toVexDuration(duration: NoteDuration): NoteDurationBase {
  return duration.replace(/d+$/, '') as NoteDurationBase
}

function getDurationDots(duration: NoteDuration): number {
  const dots = duration.match(/d/g)
  return dots ? dots.length : 0
}

function countVisibleAccidentals(accidentals?: Array<string | null>): number {
  if (!accidentals || accidentals.length === 0) return 0
  let count = 0
  accidentals.forEach((value) => {
    if (value) count += 1
  })
  return count
}

function getNoteLayoutDemand(note: ScoreNote): number {
  const durationWeight = DURATION_LAYOUT_WEIGHT[note.duration] ?? 1
  const chordSize = 1 + (note.chordPitches?.length ?? 0)
  const accidentalCount = (note.accidental ? 1 : 0) + countVisibleAccidentals(note.chordAccidentals)
  const chordSpreadBonus = chordSize > 1 ? (chordSize - 1) * 0.35 : 0
  return durationWeight * chordSize + accidentalCount * 0.85 + chordSpreadBonus
}

function getStaffLayoutDemand(notes: ScoreNote[]): number {
  if (notes.length === 0) return 1
  return notes.reduce((sum, note) => sum + getNoteLayoutDemand(note), 0)
}

function getMeasureLayoutDemand(
  measure: MeasurePair,
  showKeySignature: boolean,
  showTimeSignature: boolean,
  showEndTimeSignature: boolean,
): number {
  const noteDemand = getStaffLayoutDemand(measure.treble) + getStaffLayoutDemand(measure.bass)
  const beginDecorations = (showKeySignature ? 2.2 : 0) + (showTimeSignature ? 2.4 : 0)
  const endDecoration = showEndTimeSignature ? 1.6 : 0
  return Math.max(1, noteDemand + beginDecorations + endDecoration)
}

function allocateMeasureWidthsByDemand(demands: number[], totalWidth: number): number[] {
  if (demands.length === 0) return []

  const safeTotal = Math.max(demands.length, Math.floor(totalWidth))
  const measureCount = demands.length
  const idealMinWidth = Math.floor(safeTotal / measureCount)
  const minWidth = Math.max(80, Math.min(180, Math.floor(idealMinWidth * 0.45)))
  const minTotal = minWidth * measureCount
  if (safeTotal <= minTotal) {
    const even = Math.floor(safeTotal / measureCount)
    const result = new Array<number>(measureCount).fill(even)
    let remainder = safeTotal - even * measureCount
    for (let i = 0; i < result.length && remainder > 0; i += 1) {
      result[i] += 1
      remainder -= 1
    }
    return result
  }

  const flex = safeTotal - minTotal
  const demandSum = demands.reduce((sum, demand) => sum + Math.max(0.0001, demand), 0)
  const floatWidths = demands.map((demand) => minWidth + (flex * Math.max(0.0001, demand)) / demandSum)
  const widths = floatWidths.map((value) => Math.floor(value))
  let remainder = safeTotal - widths.reduce((sum, width) => sum + width, 0)

  const rankByFraction = floatWidths
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)

  for (let i = 0; i < rankByFraction.length && remainder > 0; i += 1) {
    widths[rankByFraction[i].index] += 1
    remainder -= 1
  }

  return widths
}

function createImportedNoteId(staff: StaffKind): string {
  return `${staff}-${createNoteId()}`
}

function beatsToTicks(beats: number, maxTicks = MEASURE_TICKS): number {
  const ticks = Math.round(beats * TICKS_PER_BEAT)
  return clamp(ticks, 1, maxTicks)
}

function splitTicksToDurations(ticks: number): NoteDuration[] {
  const pattern: NoteDuration[] = []
  let remaining = ticks

  while (remaining > 0) {
    const nextDuration = DURATION_GREEDY_ORDER.find((duration) => DURATION_TICKS[duration] <= remaining)
    if (!nextDuration) break
    pattern.push(nextDuration)
    remaining -= DURATION_TICKS[nextDuration]
  }

  return pattern
}

function parseMusicXmlPitchParts(noteEl: Element): { step: string; octave: number; alter?: number } | null {
  const pitchEl = noteEl.querySelector('pitch')
  if (!pitchEl) return null

  const step = pitchEl.querySelector('step')?.textContent?.trim().toUpperCase()
  const alterText = pitchEl.querySelector('alter')?.textContent?.trim()
  const octaveText = pitchEl.querySelector('octave')?.textContent?.trim()
  if (!step || !octaveText || STEP_TO_SEMITONE[step] === undefined) return null

  const octave = Number(octaveText)
  if (!Number.isFinite(octave)) return null
  if (!alterText) return { step, octave }

  const alter = Number(alterText)
  if (!Number.isFinite(alter)) return null
  return { step, octave, alter }
}

function getMeasureTicksByTime(time: TimeSignature): number {
  const beats = Number.isFinite(time.beats) && time.beats > 0 ? time.beats : 4
  const beatType = Number.isFinite(time.beatType) && time.beatType > 0 ? time.beatType : 4
  const ticks = Math.round(beats * TICKS_PER_BEAT * (4 / beatType))
  return Math.max(1, ticks)
}

function parseMusicXmlAccidental(noteEl: Element): string | undefined {
  const accidentalText = noteEl.querySelector('accidental')?.textContent?.trim().toLowerCase()
  if (!accidentalText) return undefined

  const ACCIDENTAL_MAP: Record<string, string> = {
    sharp: '#',
    flat: 'b',
    natural: 'n',
    'double-sharp': '##',
    'flat-flat': 'bb',
    'natural-sharp': '#',
    'natural-flat': 'b',
  }

  return ACCIDENTAL_MAP[accidentalText]
}

function parseMusicXmlAccidentalAlter(noteEl: Element): number | undefined {
  const accidentalText = noteEl.querySelector('accidental')?.textContent?.trim().toLowerCase()
  if (!accidentalText) return undefined

  const ACCIDENTAL_ALTER_MAP: Record<string, number> = {
    sharp: 1,
    flat: -1,
    natural: 0,
    'double-sharp': 2,
    'flat-flat': -2,
    'natural-sharp': 1,
    'natural-flat': -1,
  }

  return ACCIDENTAL_ALTER_MAP[accidentalText]
}

function parseMusicXmlBeats(noteEl: Element, divisions: number): number | null {
  const typeText = noteEl.querySelector('type')?.textContent?.trim().toLowerCase()
  const dots = noteEl.getElementsByTagName('dot').length

  let beats: number | null = null
  if (typeText) {
    const baseBeats: Record<string, number> = {
      whole: 4,
      half: 2,
      quarter: 1,
      eighth: 0.5,
      '16th': 0.25,
      '32nd': 0.125,
      '64th': 0.0625,
    }
    const base = baseBeats[typeText]
    if (base) {
      beats = base
      let add = base / 2
      for (let i = 0; i < dots; i += 1) {
        beats += add
        add /= 2
      }
    }
  }

  if (beats === null) {
    const durationText = noteEl.querySelector('duration')?.textContent?.trim()
    const durationValue = durationText ? Number(durationText) : Number.NaN
    if (Number.isFinite(durationValue) && divisions > 0) {
      beats = durationValue / divisions
    }
  }

  if (beats === null || beats <= 0) return null
  return beats
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function getCurrentIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function getDefaultMusicXmlMetadata(): MusicXmlMetadata {
  return {
    version: '3.1',
    workTitle: 'Untitled',
    creators: [],
    softwares: ['Interactive Music Score MVP'],
    encodingDate: getCurrentIsoDate(),
    partName: 'Piano',
    partAbbreviation: 'Pno.',
  }
}

function parseMusicXmlMetadata(doc: Document): MusicXmlMetadata {
  const fallback = getDefaultMusicXmlMetadata()
  const version = doc.querySelector('score-partwise')?.getAttribute('version')?.trim() || fallback.version
  const workTitle = doc.querySelector('work > work-title')?.textContent?.trim() || fallback.workTitle
  const rights = doc.querySelector('identification > rights')?.textContent?.trim() || undefined
  const creators: MusicXmlCreator[] = Array.from(doc.querySelectorAll('identification > creator')).reduce(
    (list, creatorEl) => {
      const text = creatorEl.textContent?.trim() ?? ''
      const type = creatorEl.getAttribute('type')?.trim() ?? undefined
      if (text) list.push({ type, text })
      return list
    },
    [] as MusicXmlCreator[],
  )
  const softwares = Array.from(doc.querySelectorAll('identification > encoding > software'))
    .map((softwareEl) => softwareEl.textContent?.trim() ?? '')
    .filter((software) => software.length > 0)
  const encodingDate = doc.querySelector('identification > encoding > encoding-date')?.textContent?.trim() || fallback.encodingDate
  const partName = doc.querySelector('part-list > score-part > part-name')?.textContent?.trim() || fallback.partName
  const partAbbreviation = doc.querySelector('part-list > score-part > part-abbreviation')?.textContent?.trim() || fallback.partAbbreviation

  return {
    version,
    workTitle,
    rights,
    creators,
    softwares: softwares.length > 0 ? softwares : fallback.softwares,
    encodingDate,
    partName,
    partAbbreviation: partAbbreviation || undefined,
  }
}

function getBeamCountFromDuration(duration: NoteDuration): number {
  const base = toVexDuration(duration)
  if (base === '8') return 1
  if (base === '16') return 2
  if (base === '32') return 3
  return 0
}

function computeMeasureBeamTags(notes: ScoreNote[], time: TimeSignature): Array<Record<number, BeamTag>> {
  const beamTags: Array<Record<number, BeamTag>> = notes.map(() => ({}))
  if (notes.length === 0) return beamTags

  const starts: number[] = []
  let cursor = 0
  for (const note of notes) {
    starts.push(cursor)
    cursor += DURATION_BEATS[note.duration]
  }

  const beatSpan = time.beatType > 0 ? 4 / time.beatType : 1
  const epsilon = 1e-6

  const applyRun = (level: number, run: number[]) => {
    if (run.length < 2) return
    beamTags[run[0]][level] = 'begin'
    for (let index = 1; index < run.length - 1; index += 1) {
      beamTags[run[index]][level] = 'continue'
    }
    beamTags[run[run.length - 1]][level] = 'end'
  }

  for (let level = 1; level <= 3; level += 1) {
    const groupMap = new Map<number, number[]>()
    notes.forEach((note, noteIndex) => {
      if (getBeamCountFromDuration(note.duration) < level) return
      const group = Math.floor((starts[noteIndex] + epsilon) / beatSpan)
      const existing = groupMap.get(group)
      if (existing) {
        existing.push(noteIndex)
      } else {
        groupMap.set(group, [noteIndex])
      }
    })

    groupMap.forEach((groupNoteIndexes) => {
      if (groupNoteIndexes.length < 2) return
      groupNoteIndexes.sort((left, right) => starts[left] - starts[right])

      let run: number[] = []
      for (const noteIndex of groupNoteIndexes) {
        if (run.length === 0) {
          run = [noteIndex]
          continue
        }
        const previousIndex = run[run.length - 1]
        const previousEnd = starts[previousIndex] + DURATION_BEATS[notes[previousIndex].duration]
        if (Math.abs(starts[noteIndex] - previousEnd) > epsilon) {
          applyRun(level, run)
          run = [noteIndex]
          continue
        }
        run.push(noteIndex)
      }
      applyRun(level, run)
    })
  }

  return beamTags
}

function getDurationValueByDivisions(duration: NoteDuration, divisions: number): number {
  const value = Math.round(DURATION_BEATS[duration] * divisions)
  return Math.max(1, value)
}

function getMusicXmlDoctype(version: string): string {
  if (version.startsWith('3.0')) {
    return '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
  }
  if (version.startsWith('3.1')) {
    return '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
  }
  return '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
}

function buildMusicXmlFromMeasurePairs(params: {
  measurePairs: MeasurePair[]
  keyFifthsByMeasure?: number[] | null
  divisionsByMeasure?: number[] | null
  timeSignaturesByMeasure?: TimeSignature[] | null
  metadata?: MusicXmlMetadata | null
}): string {
  const { measurePairs, keyFifthsByMeasure, divisionsByMeasure, timeSignaturesByMeasure, metadata } = params
  const meta = metadata ?? getDefaultMusicXmlMetadata()
  const version = meta.version || '3.1'
  const lines: string[] = []

  const pickDivisions = (measureIndex: number): number => {
    const source = divisionsByMeasure?.[measureIndex] ?? divisionsByMeasure?.[measureIndex - 1] ?? 16
    const numeric = Number(source)
    if (!Number.isFinite(numeric) || numeric <= 0) return 16
    return Math.max(1, Math.round(numeric))
  }

  const pickTime = (measureIndex: number): TimeSignature => {
    const source = timeSignaturesByMeasure?.[measureIndex] ?? timeSignaturesByMeasure?.[measureIndex - 1]
    if (!source) return { beats: 4, beatType: 4 }
    const beats = Number(source.beats)
    const beatType = Number(source.beatType)
    if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0) {
      return { beats: 4, beatType: 4 }
    }
    return { beats: Math.round(beats), beatType: Math.round(beatType) }
  }

  const pickKeyFifths = (measureIndex: number): number => {
    const source = keyFifthsByMeasure?.[measureIndex] ?? keyFifthsByMeasure?.[measureIndex - 1] ?? 0
    const numeric = Number(source)
    if (!Number.isFinite(numeric)) return 0
    return Math.trunc(numeric)
  }

  const appendNote = (noteParams: {
    destination: string[]
    pitch: Pitch
    duration: NoteDuration
    accidental: string | null | undefined
    divisions: number
    staff: 1 | 2
    voice: 1 | 2
    isChord: boolean
    beamTags: Record<number, BeamTag>
  }) => {
    const { destination, pitch, duration, accidental, divisions, staff, voice, isChord, beamTags } = noteParams
    const { step, octave, alter } = getStepOctaveAlterFromPitch(pitch)
    const durationType = DURATION_MUSIC_XML[duration]
    const accidentalXml = accidental ? ACCIDENTAL_TO_MUSIC_XML[accidental] : undefined
    const durationValue = getDurationValueByDivisions(duration, divisions)

    destination.push('   <note>')
    if (isChord) destination.push('    <chord/>')
    destination.push('    <pitch>')
    destination.push(`     <step>${step}</step>`)
    if (alter !== 0) destination.push(`     <alter>${alter}</alter>`)
    destination.push(`     <octave>${octave}</octave>`)
    destination.push('    </pitch>')
    destination.push(`    <duration>${durationValue}</duration>`)
    destination.push(`    <voice>${voice}</voice>`)
    destination.push(`    <type>${durationType.type}</type>`)
    for (let dotIndex = 0; dotIndex < durationType.dots; dotIndex += 1) {
      destination.push('    <dot/>')
    }
    if (accidentalXml) destination.push(`    <accidental>${accidentalXml}</accidental>`)
    destination.push(`    <staff>${staff}</staff>`)
    const beamNumbers = Object.keys(beamTags)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)
    beamNumbers.forEach((beamNumber) => {
      const beamValue = beamTags[beamNumber]
      if (!beamValue) return
      destination.push(`    <beam number="${beamNumber}">${beamValue}</beam>`)
    })
    destination.push('   </note>')
  }

  const appendStaffNotes = (staffParams: {
    destination: string[]
    notes: ScoreNote[]
    staff: 1 | 2
    voice: 1 | 2
    divisions: number
    time: TimeSignature
  }) => {
    const { destination, notes, staff, voice, divisions, time } = staffParams
    const staffBeamTags = computeMeasureBeamTags(notes, time)
    notes.forEach((note, noteIndex) => {
      const beamTags = staffBeamTags[noteIndex] ?? {}
      appendNote({
        destination,
        pitch: note.pitch,
        duration: note.duration,
        accidental: note.accidental,
        divisions,
        staff,
        voice,
        isChord: false,
        beamTags,
      })
      note.chordPitches?.forEach((chordPitch, chordIndex) => {
        appendNote({
          destination,
          pitch: chordPitch,
          duration: note.duration,
          accidental: note.chordAccidentals?.[chordIndex],
          divisions,
          staff,
          voice,
          isChord: true,
          beamTags,
        })
      })
    })
  }

  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
  lines.push(getMusicXmlDoctype(version))
  lines.push(`<score-partwise version="${escapeXml(version)}">`)
  lines.push(' <work>')
  lines.push(`  <work-title>${escapeXml(meta.workTitle || 'Untitled')}</work-title>`)
  lines.push(' </work>')
  lines.push(' <identification>')
  meta.creators.forEach((creator) => {
    if (!creator.text) return
    const typeAttr = creator.type ? ` type="${escapeXml(creator.type)}"` : ''
    lines.push(`  <creator${typeAttr}>${escapeXml(creator.text)}</creator>`)
  })
  if (meta.rights) lines.push(`  <rights>${escapeXml(meta.rights)}</rights>`)
  lines.push('  <encoding>')
  lines.push(`   <encoding-date>${escapeXml(meta.encodingDate || getCurrentIsoDate())}</encoding-date>`)
  meta.softwares.forEach((software) => {
    if (!software) return
    lines.push(`   <software>${escapeXml(software)}</software>`)
  })
  lines.push('  </encoding>')
  lines.push(' </identification>')
  lines.push(' <part-list>')
  lines.push('  <part-group type="start" number="1">')
  lines.push('   <group-symbol>brace</group-symbol>')
  lines.push('  </part-group>')
  lines.push('  <score-part id="P1">')
  lines.push(`   <part-name>${escapeXml(meta.partName || 'Piano')}</part-name>`)
  if (meta.partAbbreviation) {
    lines.push(`   <part-abbreviation>${escapeXml(meta.partAbbreviation)}</part-abbreviation>`)
  }
  lines.push('  </score-part>')
  lines.push('  <part-group type="stop" number="1" />')
  lines.push(' </part-list>')
  lines.push(' <part id="P1">')

  let previousDivisions = -1
  let previousFifths = Number.NaN

  measurePairs.forEach((pair, measureIndex) => {
    const divisions = pickDivisions(measureIndex)
    const fifths = pickKeyFifths(measureIndex)
    const time = pickTime(measureIndex)
    const shouldWriteDivisions = measureIndex === 0 || divisions !== previousDivisions
    const shouldWriteKey = measureIndex === 0 || fifths !== previousFifths
    const shouldWriteTime = true

    lines.push(`  <measure number="${measureIndex + 1}">`)
    if (shouldWriteDivisions || shouldWriteKey || shouldWriteTime || measureIndex === 0) {
      lines.push('   <attributes>')
      if (shouldWriteDivisions) lines.push(`    <divisions>${divisions}</divisions>`)
      if (shouldWriteKey) {
        lines.push('    <key>')
        lines.push(`     <fifths>${fifths}</fifths>`)
        lines.push('    </key>')
      }
      if (shouldWriteTime) {
        lines.push('    <time>')
        lines.push(`     <beats>${time.beats}</beats>`)
        lines.push(`     <beat-type>${time.beatType}</beat-type>`)
        lines.push('    </time>')
      }
      if (measureIndex === 0) {
        lines.push('    <staves>2</staves>')
        lines.push('    <clef number="1">')
        lines.push('     <sign>G</sign>')
        lines.push('     <line>2</line>')
        lines.push('    </clef>')
        lines.push('    <clef number="2">')
        lines.push('     <sign>F</sign>')
        lines.push('     <line>4</line>')
        lines.push('    </clef>')
      }
      lines.push('   </attributes>')
    }

    appendStaffNotes({
      destination: lines,
      notes: pair.treble,
      staff: 1,
      voice: 1,
      divisions,
      time,
    })

    const backupDuration = Math.max(1, Math.round(divisions * time.beats * (4 / time.beatType)))
    lines.push('   <backup>')
    lines.push(`    <duration>${backupDuration}</duration>`)
    lines.push('   </backup>')

    appendStaffNotes({
      destination: lines,
      notes: pair.bass,
      staff: 2,
      voice: 2,
      divisions,
      time,
    })

    lines.push('  </measure>')
    previousDivisions = divisions
    previousFifths = fifths
  })

  lines.push(' </part>')
  lines.push('</score-partwise>')
  return `${lines.join('\n')}\n`
}

function fillMissingTicksWithCarryNotes(
  notes: ScoreNote[],
  staff: StaffKind,
  ticksUsed: number,
  carryPitch: Pitch,
  measureTicks = MEASURE_TICKS,
): ScoreNote[] {
  const filled = [...notes]
  let remaining = clamp(measureTicks - ticksUsed, 0, measureTicks)

  while (remaining > 0) {
    const duration = DURATION_GREEDY_ORDER.find((item) => DURATION_TICKS[item] <= remaining)
    if (!duration) break
    filled.push({
      id: createImportedNoteId(staff),
      pitch: carryPitch,
      duration,
    })
    remaining -= DURATION_TICKS[duration]
  }

  return filled
}

function getLastPitch(notes: ScoreNote[], fallback: Pitch): Pitch {
  return notes.length > 0 ? notes[notes.length - 1].pitch : fallback
}

function splitFlatNotesToMeasures(notes: ScoreNote[], staff: StaffKind, fallbackPitch: Pitch): ScoreNote[][] {
  if (notes.length === 0) {
    return [fillMissingTicksWithCarryNotes([], staff, 0, fallbackPitch)]
  }

  const measures: ScoreNote[][] = []
  let current: ScoreNote[] = []
  let ticksUsed = 0
  let carryPitch = fallbackPitch

  for (const note of notes) {
    const ticks = DURATION_TICKS[note.duration]
    if (ticksUsed + ticks > MEASURE_TICKS) {
      measures.push(fillMissingTicksWithCarryNotes(current, staff, ticksUsed, carryPitch))
      current = []
      ticksUsed = 0
    }

    current.push(note)
    ticksUsed += ticks
    carryPitch = note.pitch

    if (ticksUsed === MEASURE_TICKS) {
      measures.push(current)
      current = []
      ticksUsed = 0
    }
  }

  if (current.length > 0) {
    measures.push(fillMissingTicksWithCarryNotes(current, staff, ticksUsed, carryPitch))
  }

  return measures.length > 0 ? measures : [fillMissingTicksWithCarryNotes([], staff, 0, carryPitch)]
}

function buildMeasurePairs(trebleNotes: ScoreNote[], bassNotes: ScoreNote[]): MeasurePair[] {
  const trebleMeasures = splitFlatNotesToMeasures(trebleNotes, 'treble', 'c/4')
  const bassMeasures = splitFlatNotesToMeasures(bassNotes, 'bass', 'c/3')
  const count = Math.max(trebleMeasures.length, bassMeasures.length)

  const pairs: MeasurePair[] = []
  let trebleCarryPitch = getLastPitch(trebleNotes, 'c/4')
  let bassCarryPitch = getLastPitch(bassNotes, 'c/3')

  for (let index = 0; index < count; index += 1) {
    const treble = trebleMeasures[index] ?? fillMissingTicksWithCarryNotes([], 'treble', 0, trebleCarryPitch)
    const bass = bassMeasures[index] ?? fillMissingTicksWithCarryNotes([], 'bass', 0, bassCarryPitch)

    trebleCarryPitch = getLastPitch(treble, trebleCarryPitch)
    bassCarryPitch = getLastPitch(bass, bassCarryPitch)

    pairs.push({ treble, bass })
  }

  return pairs
}

function parseMusicXml(xml: string): ImportResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('Failed to parse MusicXML. Check XML format.')
  }
  const metadata = parseMusicXmlMetadata(doc)

  const partNodes = Array.from(doc.getElementsByTagName('part'))
  if (partNodes.length === 0) {
    throw new Error('No <part> node found in this MusicXML file.')
  }

  const measureSlots: {
    notes: Record<StaffKind, ScoreNote[]>
    ticksUsed: Record<StaffKind, number>
    touched: Record<StaffKind, boolean>
    measureTicks: number
  }[] = []
  const measureKeyFifths: number[] = []
  const measureDivisions: number[] = []
  const measureTimeSignatures: TimeSignature[] = []

  const ensureMeasureSlot = (index: number) => {
    if (!measureSlots[index]) {
        measureSlots[index] = {
          notes: { treble: [], bass: [] },
          ticksUsed: { treble: 0, bass: 0 },
          touched: { treble: false, bass: false },
          measureTicks: MEASURE_TICKS,
        }
      }
      return measureSlots[index]
    }

  const lastPitch: Record<StaffKind, Pitch> = { treble: 'c/4', bass: 'c/3' }

  partNodes.forEach((partEl, partIndex) => {
    const measureEls = Array.from(partEl.getElementsByTagName('measure'))
    if (measureEls.length === 0) return

    let divisions = 1
    let currentFifths = 0
    let currentTime: TimeSignature = { beats: 4, beatType: 4 }
    measureEls.forEach((measureEl, measureIndex) => {
      const slot = ensureMeasureSlot(measureIndex)
      const divisionsText = measureEl.querySelector('attributes > divisions')?.textContent?.trim()
      const maybeDivisions = divisionsText ? Number(divisionsText) : Number.NaN
      if (Number.isFinite(maybeDivisions) && maybeDivisions > 0) {
        divisions = maybeDivisions
      }
      if (measureDivisions[measureIndex] === undefined) {
        measureDivisions[measureIndex] = Math.max(1, Math.round(divisions))
      }

      const beatsText = measureEl.querySelector('attributes > time > beats')?.textContent?.trim()
      const beatTypeText = measureEl.querySelector('attributes > time > beat-type')?.textContent?.trim()
      const maybeBeats = beatsText ? Number(beatsText) : Number.NaN
      const maybeBeatType = beatTypeText ? Number(beatTypeText) : Number.NaN
      const nextBeats = Number.isFinite(maybeBeats) && maybeBeats > 0 ? Math.round(maybeBeats) : currentTime.beats
      const nextBeatType =
        Number.isFinite(maybeBeatType) && maybeBeatType > 0 ? Math.round(maybeBeatType) : currentTime.beatType
      currentTime = { beats: nextBeats, beatType: nextBeatType }
      if (measureTimeSignatures[measureIndex] === undefined) {
        measureTimeSignatures[measureIndex] = { ...currentTime }
      }
      slot.measureTicks = getMeasureTicksByTime(currentTime)

      const fifthsText = measureEl.querySelector('attributes > key > fifths')?.textContent?.trim()
      const maybeFifths = fifthsText ? Number(fifthsText) : Number.NaN
      if (Number.isFinite(maybeFifths)) {
        currentFifths = Math.trunc(maybeFifths)
      }
      if (measureKeyFifths[measureIndex] === undefined) {
        measureKeyFifths[measureIndex] = currentFifths
      }

      const measureAlterState: Record<StaffKind, Map<string, number>> = {
        treble: new Map(),
        bass: new Map(),
      }

      const noteEls = Array.from(measureEl.getElementsByTagName('note'))
      noteEls.forEach((noteEl) => {
        if (noteEl.querySelector('grace')) return

        const staffText = noteEl.querySelector('staff')?.textContent?.trim()
        const staff: StaffKind =
          staffText === '2' ? 'bass' : staffText === '1' ? 'treble' : partNodes.length > 1 && partIndex === 1 ? 'bass' : 'treble'

        const isChordTone = Boolean(noteEl.querySelector('chord'))
        if (isChordTone) {
          const isRest = Boolean(noteEl.querySelector('rest'))
          const chordPitchParts = isRest ? null : parseMusicXmlPitchParts(noteEl)
          if (!chordPitchParts) return

          const pitchKey = `${chordPitchParts.step}${chordPitchParts.octave}`
          const carriedAlter = measureAlterState[staff].get(pitchKey)
          const accidentalAlter = parseMusicXmlAccidentalAlter(noteEl)
          const resolvedAlter =
            chordPitchParts.alter ??
            accidentalAlter ??
            (carriedAlter !== undefined ? carriedAlter : getKeySignatureAlterForStep(chordPitchParts.step, currentFifths))
          const chordPitch = toPitchFromStepAlter(chordPitchParts.step, resolvedAlter, chordPitchParts.octave)
          measureAlterState[staff].set(pitchKey, resolvedAlter)

          const previous = slot.notes[staff][slot.notes[staff].length - 1]
          if (!previous) return

          const nextChordPitches = previous.chordPitches ? [...previous.chordPitches, chordPitch] : [chordPitch]
          const chordAccidental = parseMusicXmlAccidental(noteEl) ?? null
          const nextChordAccidentals = previous.chordAccidentals
            ? [...previous.chordAccidentals, chordAccidental]
            : [chordAccidental]

          slot.notes[staff][slot.notes[staff].length - 1] = {
            ...previous,
            chordPitches: nextChordPitches,
            chordAccidentals: nextChordAccidentals,
          }
          return
        }

        if (slot.ticksUsed[staff] >= slot.measureTicks) return

        const beats = parseMusicXmlBeats(noteEl, divisions)
        if (!beats) return

        const isRest = Boolean(noteEl.querySelector('rest'))
        let pitch = lastPitch[staff]
        if (!isRest) {
          const parsedPitch = parseMusicXmlPitchParts(noteEl)
          if (parsedPitch) {
            const pitchKey = `${parsedPitch.step}${parsedPitch.octave}`
            const carriedAlter = measureAlterState[staff].get(pitchKey)
            const accidentalAlter = parseMusicXmlAccidentalAlter(noteEl)
            const resolvedAlter =
              parsedPitch.alter ??
              accidentalAlter ??
              (carriedAlter !== undefined ? carriedAlter : getKeySignatureAlterForStep(parsedPitch.step, currentFifths))
            pitch = toPitchFromStepAlter(parsedPitch.step, resolvedAlter, parsedPitch.octave)
            measureAlterState[staff].set(pitchKey, resolvedAlter)
          }
        }
        const explicitAccidental = isRest ? undefined : parseMusicXmlAccidental(noteEl) ?? null
        const notePattern = splitTicksToDurations(beatsToTicks(beats, slot.measureTicks))

        slot.touched[staff] = true
        for (let patternIndex = 0; patternIndex < notePattern.length; patternIndex += 1) {
          const duration = notePattern[patternIndex]
          const durationTicks = DURATION_TICKS[duration]
          if (slot.ticksUsed[staff] + durationTicks > slot.measureTicks) break
          slot.notes[staff].push({
            id: createImportedNoteId(staff),
            pitch,
            duration,
            accidental: patternIndex === 0 ? explicitAccidental : null,
          })
          slot.ticksUsed[staff] += durationTicks
        }

        lastPitch[staff] = pitch
      })
    })
  })

  const importedPairs: MeasurePair[] = []
  let trebleCarry = 'c/4'
  let bassCarry = 'c/3'

  measureSlots.forEach((slot) => {
    if (!slot || (!slot.touched.treble && !slot.touched.bass)) return

    const treblePitch = getLastPitch(slot.notes.treble, trebleCarry)
    const bassPitch = getLastPitch(slot.notes.bass, bassCarry)
    const treble = fillMissingTicksWithCarryNotes(
      slot.notes.treble,
      'treble',
      slot.ticksUsed.treble,
      treblePitch,
      slot.measureTicks,
    )
    const bass = fillMissingTicksWithCarryNotes(slot.notes.bass, 'bass', slot.ticksUsed.bass, bassPitch, slot.measureTicks)

    trebleCarry = getLastPitch(treble, trebleCarry)
    bassCarry = getLastPitch(bass, bassCarry)
    importedPairs.push({ treble, bass })
  })

  if (importedPairs.length === 0) {
    const fallbackPairs = buildMeasurePairs(INITIAL_NOTES, INITIAL_BASS_NOTES)
    return {
      trebleNotes: fallbackPairs.flatMap((pair) => pair.treble),
      bassNotes: fallbackPairs.flatMap((pair) => pair.bass),
      measurePairs: fallbackPairs,
      measureKeyFifths: new Array(fallbackPairs.length).fill(0),
      measureDivisions: new Array(fallbackPairs.length).fill(16),
      measureTimeSignatures: new Array(fallbackPairs.length).fill(null).map(() => ({ beats: 4, beatType: 4 })),
      metadata,
    }
  }

  const alignedKeyFifths =
    measureKeyFifths.length === importedPairs.length
      ? measureKeyFifths
      : importedPairs.map((_, index) => measureKeyFifths[index] ?? measureKeyFifths[index - 1] ?? 0)
  const alignedDivisions = importedPairs.map(
    (_, index) => measureDivisions[index] ?? measureDivisions[index - 1] ?? 16,
  )
  const alignedTimes = importedPairs.map(
    (_, index) => measureTimeSignatures[index] ?? measureTimeSignatures[index - 1] ?? { beats: 4, beatType: 4 },
  )

  return {
    trebleNotes: importedPairs.flatMap((pair) => pair.treble),
    bassNotes: importedPairs.flatMap((pair) => pair.bass),
    measurePairs: importedPairs,
    measureKeyFifths: alignedKeyFifths,
    measureDivisions: alignedDivisions,
    measureTimeSignatures: alignedTimes,
    metadata,
  }
}

function createNoteId(): string {
  const id = `n${nextNoteSerial}`
  nextNoteSerial += 1
  return id
}

function buildNotesFromPattern(pattern: NoteDuration[], sourceNotes: ScoreNote[]): ScoreNote[] {
  const basePitches = sourceNotes.length > 0 ? sourceNotes.map((note) => note.pitch) : INITIAL_NOTES.map((note) => note.pitch)
  return pattern.map((duration, index) => ({
    id: createNoteId(),
    pitch: basePitches[index % basePitches.length],
    duration,
  }))
}

function buildBassMockNotes(sourceNotes: ScoreNote[]): ScoreNote[] {
  return sourceNotes.map((note, index) => ({
    id: `bass-${index + 1}`,
    pitch: BASS_MOCK_PATTERN[index % BASS_MOCK_PATTERN.length],
    duration: note.duration,
  }))
}

function syncBassNotesToTreble(trebleNotes: ScoreNote[], currentBass: ScoreNote[]): ScoreNote[] {
  return trebleNotes.map((trebleNote, index) => ({
    id: currentBass[index]?.id ?? `bass-${index + 1}`,
    pitch: currentBass[index]?.pitch ?? BASS_MOCK_PATTERN[index % BASS_MOCK_PATTERN.length],
    duration: trebleNote.duration,
  }))
}

const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)

function getStrictStemDirection(pitch: Pitch): StemDirection {
  const line = getPitchLine('treble', pitch)
  return line < 3 ? 1 : -1
}

function getNearestPitchByY(y: number, pitchYMap: Record<Pitch, number>, preferred?: Pitch): Pitch {
  let winner: Pitch = preferred ?? PITCHES[0]
  let winnerDistance = Math.abs(y - (pitchYMap[winner] ?? 0))

  for (const pitch of PITCHES) {
    const distance = Math.abs(y - pitchYMap[pitch])
    if (distance < winnerDistance) {
      winner = pitch
      winnerDistance = distance
    }
  }

  return winner
}

type HitNote = {
  layout: NoteLayout
  head: NoteHeadLayout
}

type HitGridCandidate = {
  layout: NoteLayout
  head: NoteHeadLayout
}

type HitGridIndex = {
  cellSize: number
  cells: Map<string, HitGridCandidate[]>
}

const HIT_INDEX_CELL_SIZE = 40

function toHitCellKey(cellX: number, cellY: number): string {
  return `${cellX}|${cellY}`
}

function buildHitGridIndex(layouts: NoteLayout[], cellSize = HIT_INDEX_CELL_SIZE): HitGridIndex {
  const safeCellSize = Math.max(16, Math.floor(cellSize))
  const cells = new Map<string, HitGridCandidate[]>()
  layouts.forEach((layout) => {
    layout.noteHeads.forEach((head) => {
      const cellX = Math.floor(head.x / safeCellSize)
      const cellY = Math.floor(head.y / safeCellSize)
      const key = toHitCellKey(cellX, cellY)
      const list = cells.get(key)
      if (list) {
        list.push({ layout, head })
        return
      }
      cells.set(key, [{ layout, head }])
    })
  })
  return { cellSize: safeCellSize, cells }
}

function getHitNote(
  x: number,
  y: number,
  layouts: NoteLayout[],
  radius = 24,
  hitIndex: HitGridIndex | null = null,
): HitNote | null {
  if (layouts.length === 0) return null

  const candidates: HitGridCandidate[] = []
  if (hitIndex && hitIndex.cells.size > 0) {
    const minCellX = Math.floor((x - radius) / hitIndex.cellSize)
    const maxCellX = Math.floor((x + radius) / hitIndex.cellSize)
    const minCellY = Math.floor((y - radius) / hitIndex.cellSize)
    const maxCellY = Math.floor((y + radius) / hitIndex.cellSize)
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const list = hitIndex.cells.get(toHitCellKey(cellX, cellY))
        if (!list) continue
        candidates.push(...list)
      }
    }
  }

  let winnerLayout: NoteLayout | null = null
  let winnerHead: NoteHeadLayout | null = null
  const radiusSq = radius * radius
  let winnerDistanceSq = Number.POSITIVE_INFINITY

  const scanCandidate = (layout: NoteLayout, head: NoteHeadLayout) => {
    const dx = head.x - x
    if (dx < -radius || dx > radius) return
    const dy = head.y - y
    if (dy < -radius || dy > radius) return

    const distanceSq = dx * dx + dy * dy
    if (distanceSq < winnerDistanceSq) {
      winnerLayout = layout
      winnerHead = head
      winnerDistanceSq = distanceSq
    }
  }

  if (candidates.length > 0) {
    for (const candidate of candidates) {
      scanCandidate(candidate.layout, candidate.head)
      if (winnerDistanceSq === 0) break
    }
  } else {
    for (const layout of layouts) {
      for (const head of layout.noteHeads) {
        scanCandidate(layout, head)
        if (winnerDistanceSq === 0) break
      }
      if (winnerDistanceSq === 0) break
    }
  }

  if (!winnerLayout || !winnerHead || winnerDistanceSq > radiusSq) return null
  return { layout: winnerLayout, head: winnerHead }
}

function updateScoreNotePitchAtKey(note: ScoreNote, pitch: Pitch, keyIndex: number): ScoreNote {
  if (keyIndex <= 0) {
    if (note.pitch === pitch) return note
    const { accidental: _accidental, ...rest } = note
    return { ...rest, pitch, accidental: null }
  }

  const chordIndex = keyIndex - 1
  const sourceChordPitches = note.chordPitches
  if (!sourceChordPitches || chordIndex < 0 || chordIndex >= sourceChordPitches.length) {
    if (note.pitch === pitch) return note
    const { accidental: _accidental, ...rest } = note
    return { ...rest, pitch, accidental: null }
  }

  if (sourceChordPitches[chordIndex] === pitch) return note

  const chordPitches = sourceChordPitches.slice()
  chordPitches[chordIndex] = pitch
  const chordAccidentals = note.chordAccidentals ? note.chordAccidentals.slice() : new Array(chordPitches.length).fill(undefined)
  chordAccidentals[chordIndex] = null
  return { ...note, chordPitches, chordAccidentals }
}

function updateNotePitch(notes: ScoreNote[], noteId: string, pitch: Pitch, keyIndex = 0): ScoreNote[] {
  const noteIndex = notes.findIndex((note) => note.id === noteId)
  if (noteIndex < 0) return notes

  const source = notes[noteIndex]
  const nextNote = updateScoreNotePitchAtKey(source, pitch, keyIndex)
  if (nextNote === source) return notes

  const next = notes.slice()
  next[noteIndex] = nextNote
  return next
}

function flattenTrebleFromPairs(pairs: MeasurePair[]): ScoreNote[] {
  return pairs.flatMap((pair) => pair.treble)
}

function flattenBassFromPairs(pairs: MeasurePair[]): ScoreNote[] {
  return pairs.flatMap((pair) => pair.bass)
}

function updateMeasurePairsPitch(pairs: MeasurePair[], noteId: string, pitch: Pitch, keyIndex = 0): MeasurePair[] {
  let changed = false
  const nextPairs = pairs.map((pair) => {
    const nextTreble = updateNotePitch(pair.treble, noteId, pitch, keyIndex)
    const nextBass = updateNotePitch(pair.bass, noteId, pitch, keyIndex)
    if (nextTreble === pair.treble && nextBass === pair.bass) return pair
    changed = true
    return { treble: nextTreble, bass: nextBass }
  })

  return changed ? nextPairs : pairs
}

function getVisibleSystemRange(scrollTop: number, viewportHeight: number, systemCount: number): { start: number; end: number } {
  if (systemCount <= 1) return { start: 0, end: 0 }

  const systemStride = SYSTEM_HEIGHT + SYSTEM_GAP_Y
  const startOffset = Math.max(0, scrollTop - SCORE_TOP_PADDING)
  const endOffset = Math.max(0, scrollTop + viewportHeight - SCORE_TOP_PADDING)
  const bufferSystems = 1

  const start = clamp(Math.floor(startOffset / systemStride) - bufferSystems, 0, systemCount - 1)
  const end = clamp(Math.ceil(endOffset / systemStride) + bufferSystems, 0, systemCount - 1)
  return { start, end }
}

function buildMeasureOverlayRect(
  noteMinX: number,
  noteMaxX: number,
  noteStartX: number,
  measureX: number,
  measureWidth: number,
  systemTop: number,
  scoreWidth: number,
  scoreHeight: number,
  isSystemStart: boolean,
  includeMeasureStartDecorations: boolean,
): MeasureLayout['overlayRect'] {
  const leftPad = 56
  const rightPad = 42
  const topPad = 34
  const bottomPad = 42
  const systemStartDecorationGuard = 2
  const interMeasureBarlineGuard = 2
  const noteLeft = Number.isFinite(noteMinX) ? noteMinX : noteStartX
  const noteRight = Number.isFinite(noteMaxX) ? noteMaxX : measureX + measureWidth - 12
  const measureRight = measureX + measureWidth
  let leftEdge = Math.floor(noteLeft - leftPad)
  if (isSystemStart) {
    const minSafeLeft = Math.floor(noteStartX + systemStartDecorationGuard)
    leftEdge = Math.max(leftEdge, minSafeLeft)
  } else {
    const minSafeLeft = Math.floor(measureX + interMeasureBarlineGuard)
    leftEdge = includeMeasureStartDecorations ? minSafeLeft : Math.max(leftEdge, minSafeLeft)
  }
  const x = clamp(leftEdge, 0, scoreWidth)
  const right = clamp(Math.ceil(noteRight + rightPad), x, Math.min(scoreWidth, measureRight))
  const y = clamp(systemTop - topPad, 0, scoreHeight)
  const maxWidth = scoreWidth - x
  const maxHeight = scoreHeight - y
  const width = clamp(right - x, 0, maxWidth)
  const height = clamp(SYSTEM_HEIGHT + topPad + bottomPad, 0, maxHeight)
  return { x, y, width, height }
}

function buildImportedNoteLookup(pairs: MeasurePair[]): Map<string, ImportedNoteLocation> {
  const lookup = new Map<string, ImportedNoteLocation>()
  pairs.forEach((pair, pairIndex) => {
    pair.treble.forEach((note, noteIndex) => {
      lookup.set(note.id, { pairIndex, noteIndex, staff: 'treble' })
    })
    pair.bass.forEach((note, noteIndex) => {
      lookup.set(note.id, { pairIndex, noteIndex, staff: 'bass' })
    })
  })
  return lookup
}

function updateMeasurePairPitchAt(pairs: MeasurePair[], location: ImportedNoteLocation, pitch: Pitch, keyIndex = 0): MeasurePair[] {
  const pair = pairs[location.pairIndex]
  if (!pair) return pairs

  const sourceList = location.staff === 'treble' ? pair.treble : pair.bass
  const sourceNote = sourceList[location.noteIndex]
  if (!sourceNote) return pairs
  const nextNote = updateScoreNotePitchAtKey(sourceNote, pitch, keyIndex)
  if (nextNote === sourceNote) return pairs

  const nextPairs = pairs.slice()
  const nextPair: MeasurePair = { treble: pair.treble, bass: pair.bass }
  const nextList = sourceList.slice()
  nextList[location.noteIndex] = nextNote

  if (location.staff === 'treble') {
    nextPair.treble = nextList
  } else {
    nextPair.bass = nextList
  }
  nextPairs[location.pairIndex] = nextPair
  return nextPairs
}

function createAiVariation(notes: ScoreNote[]): ScoreNote[] {
  let cursor = Math.floor(Math.random() * PITCHES.length)

  return notes.map((note) => {
    const deltaOptions = [-2, -1, 0, 1, 2]
    const delta = deltaOptions[Math.floor(Math.random() * deltaOptions.length)]
    cursor = clamp(cursor + delta, 0, PITCHES.length - 1)
    const { accidental: _accidental, ...rest } = note
    return { ...rest, pitch: PITCHES[cursor] }
  })
}

function App() {
  const [notes, setNotes] = useState<ScoreNote[]>(INITIAL_NOTES)
  const [bassNotes, setBassNotes] = useState<ScoreNote[]>(INITIAL_BASS_NOTES)
  const [rhythmPreset, setRhythmPreset] = useState<RhythmPresetId>('quarter')
  const [activeSelection, setActiveSelection] = useState<Selection>({ noteId: INITIAL_NOTES[0].id, staff: 'treble', keyIndex: 0 })
  const [draggingSelection, setDraggingSelection] = useState<Selection | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [musicXmlInput, setMusicXmlInput] = useState<string>('')
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>({ kind: 'idle', message: '' })
  const [isRhythmLinked, setIsRhythmLinked] = useState(true)
  const [measurePairsFromImport, setMeasurePairsFromImport] = useState<MeasurePair[] | null>(null)
  const [measureKeyFifthsFromImport, setMeasureKeyFifthsFromImport] = useState<number[] | null>(null)
  const [measureDivisionsFromImport, setMeasureDivisionsFromImport] = useState<number[] | null>(null)
  const [measureTimeSignaturesFromImport, setMeasureTimeSignaturesFromImport] = useState<TimeSignature[] | null>(null)
  const [musicXmlMetadataFromImport, setMusicXmlMetadataFromImport] = useState<MusicXmlMetadata | null>(null)
  const [visibleSystemRange, setVisibleSystemRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  const [dragDebugReport, setDragDebugReport] = useState<string>('')

  const scoreRef = useRef<HTMLCanvasElement | null>(null)
  const scoreOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const scoreScrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | null>(null)

  const noteLayoutsRef = useRef<NoteLayout[]>([])
  const noteLayoutsByPairRef = useRef<Map<number, NoteLayout[]>>(new Map())
  const hitGridRef = useRef<HitGridIndex | null>(null)
  const measureLayoutsRef = useRef<Map<number, MeasureLayout>>(new Map())
  const measurePairsRef = useRef<MeasurePair[]>([])
  const dragDebugFramesRef = useRef<DragDebugSnapshot[]>([])
  const dragRef = useRef<DragState | null>(null)
  const dragPreviewFrameRef = useRef(0)
  const dragRafRef = useRef<number | null>(null)
  const dragPendingRef = useRef<{ drag: DragState; pitch: Pitch } | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const overlayRendererRef = useRef<Renderer | null>(null)
  const overlayRendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const overlayLastRectRef = useRef<MeasureLayout['overlayRect'] | null>(null)
  const stopPlayTimerRef = useRef<number | null>(null)
  const measurePairsFromImportRef = useRef<MeasurePair[] | null>(null)
  const measureKeyFifthsFromImportRef = useRef<number[] | null>(null)
  const measureDivisionsFromImportRef = useRef<number[] | null>(null)
  const measureTimeSignaturesFromImportRef = useRef<TimeSignature[] | null>(null)
  const musicXmlMetadataFromImportRef = useRef<MusicXmlMetadata | null>(null)
  const importedNoteLookupRef = useRef<Map<string, ImportedNoteLocation>>(new Map())
  const scoreWidth = A4_PAGE_WIDTH
  const measurePairs = useMemo(
    () => measurePairsFromImport ?? buildMeasurePairs(notes, bassNotes),
    [measurePairsFromImport, notes, bassNotes],
  )
  const measuresPerLine = 2
  const systemCount = Math.max(1, Math.ceil(measurePairs.length / measuresPerLine))
  const scoreHeight = SCORE_TOP_PADDING * 2 + systemCount * SYSTEM_HEIGHT + Math.max(0, systemCount - 1) * SYSTEM_GAP_Y

  const drawMeasureToContext = (params: {
    context: ReturnType<Renderer['getContext']>
    measure: MeasurePair
    pairIndex: number
    measureX: number
    measureWidth: number
    trebleY: number
    bassY: number
    isSystemStart: boolean
    keyFifths: number
    showKeySignature: boolean
    timeSignature: TimeSignature
    showTimeSignature: boolean
    endTimeSignature?: TimeSignature | null
    showEndTimeSignature?: boolean
    activeSelection: Selection | null
    draggingSelection: Selection | null
    previewNote?: { noteId: string; staff: StaffKind; pitch: Pitch; keyIndex: number } | null
    previewAccidentalStateBeforeNote?: Map<string, number> | null
    collectLayouts?: boolean
    suppressSystemDecorations?: boolean
    noteStartXOverride?: number
    freezePreviewAccidentalLayout?: boolean
    formatWidthOverride?: number
    staticNoteXById?: Map<string, number> | null
    staticAccidentalRightXById?: Map<string, Map<number, number>> | null
    debugCapture?: {
      frame: number
      draggedNoteId: string
      draggedStaff: StaffKind
      staticByNoteKey: Map<string, DragDebugStaticRecord>
      pushSnapshot: (snapshot: DragDebugSnapshot) => void
    } | null
  }): NoteLayout[] => {
    const {
      context,
      measure,
      pairIndex,
      measureX,
      measureWidth,
      trebleY,
      bassY,
      isSystemStart,
      keyFifths,
      showKeySignature,
      timeSignature,
      showTimeSignature,
      endTimeSignature = null,
      showEndTimeSignature = false,
      activeSelection: selection,
      draggingSelection: dragging,
      previewNote = null,
      previewAccidentalStateBeforeNote = null,
      collectLayouts = true,
      suppressSystemDecorations = false,
      noteStartXOverride,
      freezePreviewAccidentalLayout = false,
      formatWidthOverride,
      staticNoteXById = null,
      staticAccidentalRightXById = null,
      debugCapture = null,
    } = params
    const noteLayouts: NoteLayout[] = []
    const timeSignatureLabel = `${timeSignature.beats}/${timeSignature.beatType}`
    const endTimeSignatureLabel =
      showEndTimeSignature && endTimeSignature ? `${endTimeSignature.beats}/${endTimeSignature.beatType}` : null
    const lockPreviewAccidentalLayout = freezePreviewAccidentalLayout && previewNote !== null
    const previewAccidentalByRowKey = new Map<string, number>()
    const accidentalLockByRowKey = new Map<string, { targetRightX: number | null; applied: boolean; reason: string }>()

    const resolveRenderedNoteData = (
      note: ScoreNote,
      staff: StaffKind,
    ): { rootPitch: Pitch; chordPitches?: Pitch[]; previewedKeyIndex: number | null } => {
      if (!previewNote || previewNote.noteId !== note.id || previewNote.staff !== staff) {
        return { rootPitch: note.pitch, chordPitches: note.chordPitches, previewedKeyIndex: null }
      }

      if (previewNote.keyIndex <= 0) {
        return { rootPitch: previewNote.pitch, chordPitches: note.chordPitches, previewedKeyIndex: 0 }
      }

      const chordIndex = previewNote.keyIndex - 1
      const sourceChordPitches = note.chordPitches
      if (!sourceChordPitches || chordIndex < 0 || chordIndex >= sourceChordPitches.length) {
        return { rootPitch: note.pitch, chordPitches: sourceChordPitches, previewedKeyIndex: null }
      }

      const chordPitches = sourceChordPitches.slice()
      chordPitches[chordIndex] = previewNote.pitch
      return { rootPitch: note.pitch, chordPitches, previewedKeyIndex: previewNote.keyIndex }
    }

    const buildPreviewAccidentalOverridesForStaff = (
      notes: ScoreNote[],
      staff: StaffKind,
    ): Map<string, Map<number, string | null>> | null => {
      if (!previewNote || previewNote.staff !== staff || lockPreviewAccidentalLayout) return null

      const state = new Map<string, number>()
      const overrides = new Map<string, Map<number, string | null>>()
      notes.forEach((note) => {
        const rendered = resolveRenderedNoteData(note, staff)
        const noteOverrides = new Map<number, string | null>()

        const rootParts = getStepOctaveAlterFromPitch(rendered.rootPitch)
        const rootExpectedAlter = getEffectiveAlterFromContext(rootParts.step, rootParts.octave, keyFifths, state)
        const rootAccidental = getRequiredAccidentalForTargetAlter(rootParts.alter, rootExpectedAlter)
        noteOverrides.set(0, rootAccidental)
        state.set(getAccidentalStateKey(rootParts.step, rootParts.octave), rootParts.alter)

        rendered.chordPitches?.forEach((chordPitch, chordIndex) => {
          const chordParts = getStepOctaveAlterFromPitch(chordPitch)
          const chordExpectedAlter = getEffectiveAlterFromContext(chordParts.step, chordParts.octave, keyFifths, state)
          const chordAccidental = getRequiredAccidentalForTargetAlter(chordParts.alter, chordExpectedAlter)
          noteOverrides.set(chordIndex + 1, chordAccidental)
          state.set(getAccidentalStateKey(chordParts.step, chordParts.octave), chordParts.alter)
        })

        overrides.set(note.id, noteOverrides)
      })

      return overrides
    }

    const treblePreviewAccidentalOverrides = buildPreviewAccidentalOverridesForStaff(measure.treble, 'treble')
    const bassPreviewAccidentalOverrides = buildPreviewAccidentalOverridesForStaff(measure.bass, 'bass')

    const trebleStave = new Stave(measureX, trebleY, measureWidth)
    const bassStave = new Stave(measureX, bassY, measureWidth)
    const setImplicitClefContext = (stave: Stave, clefSpec: 'treble' | 'bass') => {
      // Keep correct clef-dependent modifier placement on mid-system measures
      // without drawing an extra clef glyph.
      ;(stave as unknown as { clef: string }).clef = clefSpec
    }

    if (suppressSystemDecorations) {
      trebleStave.setBegBarType(BarlineType.NONE)
      bassStave.setBegBarType(BarlineType.NONE)
      if (!isSystemStart) {
        setImplicitClefContext(trebleStave, 'treble')
        setImplicitClefContext(bassStave, 'bass')
        if (showKeySignature) {
          const keySignature = getKeySignatureSpecFromFifths(keyFifths)
          trebleStave.addKeySignature(keySignature)
          bassStave.addKeySignature(keySignature)
        }
        if (showTimeSignature) {
          trebleStave.addTimeSignature(timeSignatureLabel)
          bassStave.addTimeSignature(timeSignatureLabel)
        }
      }
      if (typeof noteStartXOverride === 'number') {
        trebleStave.setNoteStartX(noteStartXOverride)
        bassStave.setNoteStartX(noteStartXOverride)
      }
    } else if (isSystemStart) {
      trebleStave.addClef('treble')
      bassStave.addClef('bass')
      if (showKeySignature) {
        const keySignature = getKeySignatureSpecFromFifths(keyFifths)
        trebleStave.addKeySignature(keySignature)
        bassStave.addKeySignature(keySignature)
      }
      if (showTimeSignature) {
        trebleStave.addTimeSignature(timeSignatureLabel)
        bassStave.addTimeSignature(timeSignatureLabel)
      }
    } else {
      trebleStave.setBegBarType(BarlineType.NONE)
      bassStave.setBegBarType(BarlineType.NONE)
      setImplicitClefContext(trebleStave, 'treble')
      setImplicitClefContext(bassStave, 'bass')
      if (showKeySignature) {
        const keySignature = getKeySignatureSpecFromFifths(keyFifths)
        trebleStave.addKeySignature(keySignature)
        bassStave.addKeySignature(keySignature)
      }
      if (showTimeSignature) {
        trebleStave.addTimeSignature(timeSignatureLabel)
        bassStave.addTimeSignature(timeSignatureLabel)
      }
    }

    if (endTimeSignatureLabel) {
      trebleStave.setEndTimeSignature(endTimeSignatureLabel)
      bassStave.setEndTimeSignature(endTimeSignatureLabel)
    }

    trebleStave.setContext(context).draw()
    bassStave.setContext(context).draw()

    if (!suppressSystemDecorations) {
      if (isSystemStart) {
        new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.BRACE).setContext(context).draw()
        new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw()
      }
      if (!showEndTimeSignature) {
        new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw()
      }
    }

    const trebleRendered = measure.treble.map((note) => {
      const rendered = resolveRenderedNoteData(note, 'treble')
      const forceChordIndex =
        !lockPreviewAccidentalLayout && rendered.previewedKeyIndex !== null && rendered.previewedKeyIndex > 0
          ? rendered.previewedKeyIndex - 1
          : null
      const renderedKeys = buildRenderedNoteKeys(
        note,
        'treble',
        rendered.rootPitch,
        rendered.chordPitches,
        keyFifths,
        previewAccidentalStateBeforeNote,
        !lockPreviewAccidentalLayout && rendered.previewedKeyIndex === 0,
        forceChordIndex,
        treblePreviewAccidentalOverrides?.get(note.id) ?? null,
      )
      const dots = getDurationDots(note.duration)
      const vexNote = new StaveNote({
        keys: renderedKeys.map((entry) => entry.pitch),
        duration: toVexDuration(note.duration),
        dots,
        clef: 'treble',
        stemDirection: getStrictStemDirection(rendered.rootPitch),
      })
      renderedKeys.forEach((entry, keyIndex) => {
        if (!entry.accidental) return
        vexNote.addModifier(new Accidental(entry.accidental), keyIndex)
      })
      if (dots > 0) {
        Dot.buildAndAttach([vexNote], { all: true })
      }
      return { vexNote, renderedKeys }
    })

    const bassRendered = measure.bass.map((note) => {
      const rendered = resolveRenderedNoteData(note, 'bass')
      const forceChordIndex =
        !lockPreviewAccidentalLayout && rendered.previewedKeyIndex !== null && rendered.previewedKeyIndex > 0
          ? rendered.previewedKeyIndex - 1
          : null
      const renderedKeys = buildRenderedNoteKeys(
        note,
        'bass',
        rendered.rootPitch,
        rendered.chordPitches,
        keyFifths,
        previewAccidentalStateBeforeNote,
        !lockPreviewAccidentalLayout && rendered.previewedKeyIndex === 0,
        forceChordIndex,
        bassPreviewAccidentalOverrides?.get(note.id) ?? null,
      )
      const dots = getDurationDots(note.duration)
      const vexNote = new StaveNote({
        keys: renderedKeys.map((entry) => entry.pitch),
        duration: toVexDuration(note.duration),
        dots,
        clef: 'bass',
        autoStem: true,
      })
      renderedKeys.forEach((entry, keyIndex) => {
        if (!entry.accidental) return
        vexNote.addModifier(new Accidental(entry.accidental), keyIndex)
      })
      if (dots > 0) {
        Dot.buildAndAttach([vexNote], { all: true })
      }
      return { vexNote, renderedKeys }
    })

    const trebleVexNotes = trebleRendered.map((entry) => entry.vexNote)
    const bassVexNotes = bassRendered.map((entry) => entry.vexNote)
    trebleVexNotes.forEach((vexNote) => vexNote.setStave(trebleStave))
    bassVexNotes.forEach((vexNote) => vexNote.setStave(bassStave))

    trebleRendered.forEach(({ vexNote, renderedKeys }, noteIndex) => {
      const noteId = measure.treble[noteIndex].id
      if (dragging?.staff === 'treble' && dragging.noteId === noteId) {
        const renderedKeyIndex = renderedKeys.findIndex((entry) => entry.keyIndex === dragging.keyIndex)
        vexNote.setKeyStyle(Math.max(0, renderedKeyIndex), { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
      } else if (selection && selection.staff === 'treble' && selection.noteId === noteId) {
        const renderedKeyIndex = renderedKeys.findIndex((entry) => entry.keyIndex === selection.keyIndex)
        vexNote.setKeyStyle(Math.max(0, renderedKeyIndex), { fillStyle: '#1f7aa8', strokeStyle: '#1f7aa8' })
      }
    })

    bassRendered.forEach(({ vexNote, renderedKeys }, noteIndex) => {
      const noteId = measure.bass[noteIndex].id
      if (dragging?.staff === 'bass' && dragging.noteId === noteId) {
        const renderedKeyIndex = renderedKeys.findIndex((entry) => entry.keyIndex === dragging.keyIndex)
        vexNote.setKeyStyle(Math.max(0, renderedKeyIndex), { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
      } else if (selection && selection.staff === 'bass' && selection.noteId === noteId) {
        const renderedKeyIndex = renderedKeys.findIndex((entry) => entry.keyIndex === selection.keyIndex)
        vexNote.setKeyStyle(Math.max(0, renderedKeyIndex), { fillStyle: '#1f7aa8', strokeStyle: '#1f7aa8' })
      }
    })

    const trebleVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(trebleVexNotes)
    const bassVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(bassVexNotes)
    const formatWidth =
      typeof formatWidthOverride === 'number' && Number.isFinite(formatWidthOverride)
        ? Math.max(80, formatWidthOverride)
        : Math.max(80, trebleStave.getNoteEndX() - trebleStave.getNoteStartX() - 8)

    new Formatter().joinVoices([trebleVoice]).joinVoices([bassVoice]).format([trebleVoice, bassVoice], formatWidth)

    if (staticNoteXById && staticNoteXById.size > 0) {
      const alignRenderedX = (staff: StaffKind, sourceNotes: ScoreNote[], rendered: { vexNote: StaveNote }[]) => {
        sourceNotes.forEach((sourceNote, noteIndex) => {
          const targetX = staticNoteXById.get(getLayoutNoteKey(staff, sourceNote.id))
          const vexNote = rendered[noteIndex]?.vexNote
          if (targetX === undefined || !vexNote) return
          const currentX = getRenderedNoteVisualX(vexNote)
          if (!Number.isFinite(currentX)) return
          const delta = targetX - currentX
          if (Math.abs(delta) < 0.001) return
          vexNote.setXShift(vexNote.getXShift() + delta)
        })
      }

      alignRenderedX('treble', measure.treble, trebleRendered)
      alignRenderedX('bass', measure.bass, bassRendered)
    }

    if (staticAccidentalRightXById && staticAccidentalRightXById.size > 0) {
      const alignRenderedAccidentalOffset = (
        staff: StaffKind,
        sourceNotes: ScoreNote[],
        rendered: { vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }[],
      ) => {
        sourceNotes.forEach((sourceNote, noteIndex) => {
          const renderedEntry = rendered[noteIndex]
          if (!renderedEntry) return
          const layoutKey = getLayoutNoteKey(staff, sourceNote.id)
          const targetByKeyIndex = staticAccidentalRightXById.get(layoutKey)
          const noteBaseX = staticNoteXById?.get(layoutKey) ?? getRenderedNoteVisualX(renderedEntry.vexNote)
          const accidentalModifiers = renderedEntry.vexNote
            .getModifiersByType(Accidental.CATEGORY)
            .map((modifier) => modifier as Accidental)

          renderedEntry.renderedKeys.forEach((renderedKey, renderedIndex) => {
            if (!renderedKey.accidental) return
            const rowKey = `${layoutKey}|${renderedKey.keyIndex}`
            const modifier = accidentalModifiers.find((item) => item.getIndex() === renderedIndex)
            if (!modifier) {
              accidentalLockByRowKey.set(rowKey, {
                targetRightX: null,
                applied: false,
                reason: 'no-modifier',
              })
              return
            }

            const targetedX = targetByKeyIndex?.get(renderedKey.keyIndex)
            const fallbackTarget = Number.isFinite(noteBaseX) ? noteBaseX + PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX : null
            const targetRightX =
              typeof targetedX === 'number' && Number.isFinite(targetedX)
                ? targetedX
                : fallbackTarget
            if (targetRightX === null) {
              accidentalLockByRowKey.set(rowKey, {
                targetRightX: null,
                applied: false,
                reason: 'no-target',
              })
              return
            }

            const currentRightX = getAccidentalVisualX(renderedEntry.vexNote, modifier, renderedIndex)
            if (currentRightX === null) {
              accidentalLockByRowKey.set(rowKey, {
                targetRightX,
                applied: false,
                reason: 'invalid-current-x',
              })
              return
            }

            const delta = targetRightX - currentRightX
            if (Math.abs(delta) >= 0.001) {
              addModifierXShift(modifier, delta)
            }

            const alignedRightX = getAccidentalVisualX(renderedEntry.vexNote, modifier, renderedIndex)
            if (alignedRightX !== null) {
              previewAccidentalByRowKey.set(rowKey, alignedRightX)
            } else {
              previewAccidentalByRowKey.set(rowKey, targetRightX)
            }
            accidentalLockByRowKey.set(rowKey, {
              targetRightX,
              applied: true,
              reason: Math.abs(delta) >= 0.001 ? 'native-aligned' : 'native-already-aligned',
            })
          })
        })
      }

      alignRenderedAccidentalOffset('treble', measure.treble, trebleRendered)
      alignRenderedAccidentalOffset('bass', measure.bass, bassRendered)
    }

    if (debugCapture) {
      const rows: DragDebugRow[] = []
      const captureDebugRowsForStaff = (
        staff: StaffKind,
        sourceNotes: ScoreNote[],
        rendered: { vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }[],
      ) => {
        sourceNotes.forEach((sourceNote, noteIndex) => {
          const renderedEntry = rendered[noteIndex]
          if (!renderedEntry) return
          const noteKey = getLayoutNoteKey(staff, sourceNote.id)
          const staticRecord = debugCapture.staticByNoteKey.get(noteKey)
          const noteXPreview = finiteOrNull(getRenderedNoteVisualX(renderedEntry.vexNote))
          const noteXStatic = finiteOrNull(staticRecord?.noteX ?? null)
          const accidentalPreviewByRenderedIndex = getAccidentalRightXByRenderedIndex(renderedEntry.vexNote)

          renderedEntry.renderedKeys.forEach((renderedKey, renderedIndex) => {
            const lockInfo = accidentalLockByRowKey.get(`${noteKey}|${renderedKey.keyIndex}`)
            const rawHeadXPreview = finiteOrNull(renderedEntry.vexNote.noteHeads[renderedIndex]?.getAbsoluteX())
            const headXPreview =
              rawHeadXPreview !== null && Math.abs(rawHeadXPreview) > 0.0001 ? rawHeadXPreview : noteXPreview
            const headXStatic = finiteOrNull(staticRecord?.headXByKeyIndex.get(renderedKey.keyIndex))
            const previewByLock = finiteOrNull(previewAccidentalByRowKey.get(`${noteKey}|${renderedKey.keyIndex}`))
            const accidentalRightXPreview =
              previewByLock ?? finiteOrNull(accidentalPreviewByRenderedIndex.get(renderedIndex))
            const accidentalRightXStatic = finiteOrNull(
              staticRecord?.accidentalRightXByKeyIndex.get(renderedKey.keyIndex),
            )
            rows.push({
              frame: debugCapture.frame,
              pairIndex,
              staff,
              noteId: sourceNote.id,
              noteIndex,
              keyIndex: renderedKey.keyIndex,
              pitch: renderedKey.pitch,
              noteXStatic,
              noteXPreview,
              noteXDelta: deltaOrNull(noteXPreview, noteXStatic),
              headXStatic,
              headXPreview,
              headXDelta: deltaOrNull(headXPreview, headXStatic),
              accidentalRightXStatic,
              accidentalRightXPreview,
              accidentalRightXDelta: deltaOrNull(accidentalRightXPreview, accidentalRightXStatic),
              hasAccidentalModifier: Boolean(renderedKey.accidental),
              accidentalTargetRightX: lockInfo?.targetRightX ?? null,
              accidentalLockApplied: lockInfo?.applied ?? false,
              accidentalLockReason: lockInfo?.reason ?? 'no-lock-record',
            })
          })
        })
      }

      captureDebugRowsForStaff('treble', measure.treble, trebleRendered)
      captureDebugRowsForStaff('bass', measure.bass, bassRendered)
      debugCapture.pushSnapshot({
        frame: debugCapture.frame,
        pairIndex,
        draggedNoteId: debugCapture.draggedNoteId,
        draggedStaff: debugCapture.draggedStaff,
        rows,
      })
    }


    const trebleBeams = Beam.generateBeams(trebleVexNotes, { groups: [new Fraction(1, 4)] })
    const bassBeams = Beam.generateBeams(bassVexNotes, { groups: [new Fraction(1, 4)] })
    trebleVoice.draw(context, trebleStave)
    bassVoice.draw(context, bassStave)
    trebleBeams.forEach((beam) => beam.setContext(context).draw())
    bassBeams.forEach((beam) => beam.setContext(context).draw())

    if (!collectLayouts) return noteLayouts

    const treblePitchYMap = {} as Record<Pitch, number>
    const bassPitchYMap = {} as Record<Pitch, number>
    for (const pitch of PITCHES) {
      treblePitchYMap[pitch] = trebleStave.getYForNote(PITCH_LINE_MAP.treble[pitch])
      bassPitchYMap[pitch] = bassStave.getYForNote(PITCH_LINE_MAP.bass[pitch])
    }

    const trebleExtraPitches = new Set<Pitch>()
    const bassExtraPitches = new Set<Pitch>()
    trebleRendered.forEach(({ renderedKeys }) => renderedKeys.forEach((entry) => trebleExtraPitches.add(entry.pitch)))
    bassRendered.forEach(({ renderedKeys }) => renderedKeys.forEach((entry) => bassExtraPitches.add(entry.pitch)))

    trebleExtraPitches.forEach((pitch) => {
      if (treblePitchYMap[pitch] !== undefined) return
      treblePitchYMap[pitch] = trebleStave.getYForNote(getPitchLine('treble', pitch))
    })
    bassExtraPitches.forEach((pitch) => {
      if (bassPitchYMap[pitch] !== undefined) return
      bassPitchYMap[pitch] = bassStave.getYForNote(getPitchLine('bass', pitch))
    })

    noteLayouts.push(
      ...trebleRendered.map(({ vexNote, renderedKeys }, noteIndex) => {
        const ys = vexNote.getYs()
        const renderedHeadXByIndex = new Map<number, number>()
        renderedKeys.forEach((_, renderedIndex) => {
          const headX = vexNote.noteHeads[renderedIndex]?.getAbsoluteX() ?? getRenderedNoteVisualX(vexNote)
          if (!Number.isFinite(headX)) return
          renderedHeadXByIndex.set(renderedIndex, headX)
        })
        const accidentalByRenderedIndex = getAccidentalRightXByRenderedIndex(vexNote)
        const accidentalRightXByKeyIndex: Record<number, number> = {}
        renderedKeys.forEach((entry, renderedIndex) => {
          const offset = accidentalByRenderedIndex.get(renderedIndex)
          if (offset === undefined) return
          accidentalRightXByKeyIndex[entry.keyIndex] = offset
        })
        const noteHeads = renderedKeys.map((entry, renderedIndex) => ({
          x: renderedHeadXByIndex.get(renderedIndex) ?? getRenderedNoteVisualX(vexNote),
          y: ys[renderedIndex] ?? ys[0],
          pitch: entry.pitch,
          keyIndex: entry.keyIndex,
        }))
        const rootHead = noteHeads.find((head) => head.keyIndex === 0) ?? noteHeads[0]
        return {
        id: measure.treble[noteIndex].id,
        staff: 'treble' as const,
        pairIndex,
        noteIndex,
        x: getRenderedNoteVisualX(vexNote),
        y: rootHead?.y ?? ys[0] ?? 0,
        pitchYMap: treblePitchYMap,
        noteHeads,
        accidentalRightXByKeyIndex,
      }
      }),
    )
    noteLayouts.push(
      ...bassRendered.map(({ vexNote, renderedKeys }, noteIndex) => {
        const ys = vexNote.getYs()
        const renderedHeadXByIndex = new Map<number, number>()
        renderedKeys.forEach((_, renderedIndex) => {
          const headX = vexNote.noteHeads[renderedIndex]?.getAbsoluteX() ?? getRenderedNoteVisualX(vexNote)
          if (!Number.isFinite(headX)) return
          renderedHeadXByIndex.set(renderedIndex, headX)
        })
        const accidentalByRenderedIndex = getAccidentalRightXByRenderedIndex(vexNote)
        const accidentalRightXByKeyIndex: Record<number, number> = {}
        renderedKeys.forEach((entry, renderedIndex) => {
          const offset = accidentalByRenderedIndex.get(renderedIndex)
          if (offset === undefined) return
          accidentalRightXByKeyIndex[entry.keyIndex] = offset
        })
        const noteHeads = renderedKeys.map((entry, renderedIndex) => ({
          x: renderedHeadXByIndex.get(renderedIndex) ?? getRenderedNoteVisualX(vexNote),
          y: ys[renderedIndex] ?? ys[0],
          pitch: entry.pitch,
          keyIndex: entry.keyIndex,
        }))
        const rootHead = noteHeads.find((head) => head.keyIndex === 0) ?? noteHeads[0]
        return {
        id: measure.bass[noteIndex].id,
        staff: 'bass' as const,
        pairIndex,
        noteIndex,
        x: getRenderedNoteVisualX(vexNote),
        y: rootHead?.y ?? ys[0] ?? 0,
        pitchYMap: bassPitchYMap,
        noteHeads,
        accidentalRightXByKeyIndex,
      }
      }),
    )

    return noteLayouts
  }

  useEffect(() => {
    measurePairsFromImportRef.current = measurePairsFromImport
  }, [measurePairsFromImport])

  useEffect(() => {
    measureKeyFifthsFromImportRef.current = measureKeyFifthsFromImport
  }, [measureKeyFifthsFromImport])

  useEffect(() => {
    measureDivisionsFromImportRef.current = measureDivisionsFromImport
  }, [measureDivisionsFromImport])

  useEffect(() => {
    measureTimeSignaturesFromImportRef.current = measureTimeSignaturesFromImport
  }, [measureTimeSignaturesFromImport])

  useEffect(() => {
    musicXmlMetadataFromImportRef.current = musicXmlMetadataFromImport
  }, [musicXmlMetadataFromImport])

  useEffect(() => {
    measurePairsRef.current = measurePairs
  }, [measurePairs])

  useEffect(() => {
    if (!isRhythmLinked) return

    setBassNotes((currentBass) => {
      const sameShape =
        currentBass.length === notes.length && currentBass.every((bassNote, index) => bassNote.duration === notes[index]?.duration)
      if (sameShape) return currentBass
      return syncBassNotesToTreble(notes, currentBass)
    })
  }, [notes, isRhythmLinked])

  useEffect(() => {
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) return

    let rafId: number | null = null

    const updateVisibleRange = () => {
      const next = getVisibleSystemRange(scrollHost.scrollTop, scrollHost.clientHeight, systemCount)
      setVisibleSystemRange((current) => {
        if (current.start === next.start && current.end === next.end) return current
        return next
      })
    }

    const scheduleVisibleRangeUpdate = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        updateVisibleRange()
      })
    }

    updateVisibleRange()
    scrollHost.addEventListener('scroll', scheduleVisibleRangeUpdate, { passive: true })
    window.addEventListener('resize', scheduleVisibleRangeUpdate)

    return () => {
      scrollHost.removeEventListener('scroll', scheduleVisibleRangeUpdate)
      window.removeEventListener('resize', scheduleVisibleRangeUpdate)
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [systemCount])

  useEffect(() => {
    const root = scoreRef.current
    if (!root) return

    let renderer = rendererRef.current
    if (!renderer) {
      renderer = new Renderer(root, SCORE_RENDER_BACKEND)
      rendererRef.current = renderer
    }
    const currentSize = rendererSizeRef.current
    if (currentSize.width !== scoreWidth || currentSize.height !== scoreHeight) {
      renderer.resize(scoreWidth, scoreHeight)
      rendererSizeRef.current = { width: scoreWidth, height: scoreHeight }
    }
    const context = renderer.getContext()
    context.clear()

    const nextLayouts: NoteLayout[] = []
    const nextLayoutsByPair = new Map<number, NoteLayout[]>()
    const nextMeasureLayouts = new Map<number, MeasureLayout>()
    const maxSystemIndex = Math.max(0, systemCount - 1)
    const startSystem = clamp(visibleSystemRange.start, 0, maxSystemIndex)
    const endSystem = clamp(visibleSystemRange.end, startSystem, maxSystemIndex)

    for (let systemIndex = startSystem; systemIndex <= endSystem; systemIndex += 1) {
      const start = systemIndex * measuresPerLine
      const systemMeasures = measurePairs.slice(start, start + measuresPerLine)
      if (systemMeasures.length === 0) continue

      const systemTop = SCORE_TOP_PADDING + systemIndex * (SYSTEM_HEIGHT + SYSTEM_GAP_Y)
      const trebleY = systemTop + SYSTEM_TREBLE_OFFSET_Y
      const bassY = systemTop + SYSTEM_BASS_OFFSET_Y
      const systemUsableWidth = scoreWidth - SCORE_PAGE_PADDING_X * 2

      const systemMeta = systemMeasures.map((measure, indexInSystem) => {
        const pairIndex = start + indexInSystem
        const isSystemStart = indexInSystem === 0
        const timeSignature =
          measureTimeSignaturesFromImport?.[pairIndex] ??
          measureTimeSignaturesFromImport?.[pairIndex - 1] ?? {
            beats: 4,
            beatType: 4,
          }
        const previousTimeSignature =
          pairIndex > 0
            ? measureTimeSignaturesFromImport?.[pairIndex - 1] ??
              measureTimeSignaturesFromImport?.[pairIndex - 2] ?? {
                beats: 4,
                beatType: 4,
              }
            : timeSignature
        const showTimeSignature =
          pairIndex === 0 ||
          timeSignature.beats !== previousTimeSignature.beats ||
          timeSignature.beatType !== previousTimeSignature.beatType
        const hasNextMeasure = pairIndex + 1 < measurePairs.length
        const nextTimeSignature =
          hasNextMeasure
            ? measureTimeSignaturesFromImport?.[pairIndex + 1] ??
              measureTimeSignaturesFromImport?.[pairIndex] ??
              timeSignature
            : timeSignature
        const isSystemEnd = indexInSystem === systemMeasures.length - 1
        const showEndTimeSignature =
          hasNextMeasure &&
          isSystemEnd &&
          (nextTimeSignature.beats !== timeSignature.beats || nextTimeSignature.beatType !== timeSignature.beatType)
        const keyFifths = measureKeyFifthsFromImport?.[pairIndex] ?? measureKeyFifthsFromImport?.[pairIndex - 1] ?? 0
        const previousKeyFifths = pairIndex > 0 ? (measureKeyFifthsFromImport?.[pairIndex - 1] ?? 0) : keyFifths
        const showKeySignature = isSystemStart || keyFifths !== previousKeyFifths
        const includeMeasureStartDecorations = !isSystemStart && (showKeySignature || showTimeSignature)
        return {
          pairIndex,
          measure,
          isSystemStart,
          keyFifths,
          showKeySignature,
          timeSignature,
          showTimeSignature,
          nextTimeSignature,
          showEndTimeSignature,
          includeMeasureStartDecorations,
        }
      })
      const measureDemands = systemMeta.map((entry) =>
        getMeasureLayoutDemand(
          entry.measure,
          entry.showKeySignature,
          entry.showTimeSignature,
          entry.showEndTimeSignature,
        ),
      )
      const measureWidths = allocateMeasureWidthsByDemand(measureDemands, systemUsableWidth)
      let measureCursorX = STAFF_X

      systemMeta.forEach((entry, indexInSystem) => {
        const measureWidth = measureWidths[indexInSystem] ?? Math.floor(systemUsableWidth / systemMeasures.length)
        const measureX = measureCursorX
        measureCursorX += measureWidth

        const noteStartProbe = new Stave(measureX, trebleY, measureWidth)
        if (entry.isSystemStart) {
          noteStartProbe.addClef('treble')
          if (entry.showKeySignature) {
            noteStartProbe.addKeySignature(getKeySignatureSpecFromFifths(entry.keyFifths))
          }
          if (entry.showTimeSignature) {
            noteStartProbe.addTimeSignature(`${entry.timeSignature.beats}/${entry.timeSignature.beatType}`)
          }
        } else {
          noteStartProbe.setBegBarType(BarlineType.NONE)
          if (entry.showKeySignature) {
            noteStartProbe.addKeySignature(getKeySignatureSpecFromFifths(entry.keyFifths))
          }
          if (entry.showTimeSignature) {
            noteStartProbe.addTimeSignature(`${entry.timeSignature.beats}/${entry.timeSignature.beatType}`)
          }
        }

        const noteStartX = noteStartProbe.getNoteStartX()
        const formatWidth = Math.max(80, noteStartProbe.getNoteEndX() - noteStartX - 8)
        const measureNoteLayouts = drawMeasureToContext({
          context,
          measure: entry.measure,
          pairIndex: entry.pairIndex,
          measureX,
          measureWidth,
          trebleY,
          bassY,
          isSystemStart: entry.isSystemStart,
          keyFifths: entry.keyFifths,
          showKeySignature: entry.showKeySignature,
          timeSignature: entry.timeSignature,
          showTimeSignature: entry.showTimeSignature,
          endTimeSignature: entry.nextTimeSignature,
          showEndTimeSignature: entry.showEndTimeSignature,
          activeSelection,
          draggingSelection: null,
        })

        nextLayouts.push(...measureNoteLayouts)
        const pairLayouts = nextLayoutsByPair.get(entry.pairIndex)
        if (pairLayouts) {
          pairLayouts.push(...measureNoteLayouts)
        } else {
          nextLayoutsByPair.set(entry.pairIndex, [...measureNoteLayouts])
        }

        let minNoteX = Number.POSITIVE_INFINITY
        let maxNoteX = Number.NEGATIVE_INFINITY
        for (const layout of measureNoteLayouts) {
          if (layout.x < minNoteX) minNoteX = layout.x
          if (layout.x > maxNoteX) maxNoteX = layout.x
        }
        const overlayRect = buildMeasureOverlayRect(
          minNoteX,
          maxNoteX,
          noteStartX,
          measureX,
          measureWidth,
          systemTop,
          scoreWidth,
          scoreHeight,
          entry.isSystemStart,
          entry.includeMeasureStartDecorations,
        )
        nextMeasureLayouts.set(entry.pairIndex, {
          pairIndex: entry.pairIndex,
          measureX,
          measureWidth,
          trebleY,
          bassY,
          systemTop,
          isSystemStart: entry.isSystemStart,
          keyFifths: entry.keyFifths,
          showKeySignature: entry.showKeySignature,
          timeSignature: entry.timeSignature,
          showTimeSignature: entry.showTimeSignature,
          endTimeSignature: entry.nextTimeSignature,
          showEndTimeSignature: entry.showEndTimeSignature,
          includeMeasureStartDecorations: entry.includeMeasureStartDecorations,
          noteStartX,
          formatWidth,
          overlayRect,
        })
      })
    }

    noteLayoutsRef.current = nextLayouts
    noteLayoutsByPairRef.current = nextLayoutsByPair
    hitGridRef.current = buildHitGridIndex(nextLayouts)
    measureLayoutsRef.current = nextMeasureLayouts
  }, [
    measurePairs,
    scoreWidth,
    scoreHeight,
    systemCount,
    measuresPerLine,
    visibleSystemRange.start,
    visibleSystemRange.end,
    activeSelection.noteId,
    activeSelection.staff,
    activeSelection.keyIndex,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
  ])

  useEffect(() => {
    synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination()
    return () => {
      synthRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current)
      }
      dragRafRef.current = null
      dragPendingRef.current = null
      rendererRef.current = null
      rendererSizeRef.current = { width: 0, height: 0 }
      overlayRendererRef.current = null
      overlayRendererSizeRef.current = { width: 0, height: 0 }
      overlayLastRectRef.current = null
    }
  }, [])

  const clearDragOverlay = () => {
    const overlay = scoreOverlayRef.current
    if (!overlay) return
    const overlay2d = overlay.getContext('2d')
    if (!overlay2d) return
    overlay2d.clearRect(0, 0, overlay.width, overlay.height)
    overlay.style.display = 'none'
    overlayLastRectRef.current = null
  }

  const ensureOverlayCanvasForRect = (rect: MeasureLayout['overlayRect']) => {
    const overlay = scoreOverlayRef.current
    if (!overlay) return null

    const nextWidth = Math.max(1, Math.ceil(rect.width))
    const nextHeight = Math.max(1, Math.ceil(rect.height))
    const nextLeft = Math.floor(rect.x)
    const nextTop = Math.floor(rect.y)

    if (overlay.width !== nextWidth || overlay.height !== nextHeight) {
      overlay.width = nextWidth
      overlay.height = nextHeight
      overlayRendererRef.current = null
      overlayRendererSizeRef.current = { width: 0, height: 0 }
    }

    overlay.style.left = `${nextLeft}px`
    overlay.style.top = `${nextTop}px`
    overlay.style.width = `${nextWidth}px`
    overlay.style.height = `${nextHeight}px`
    overlay.style.display = 'block'
    overlayLastRectRef.current = rect

    return { x: nextLeft, y: nextTop, width: nextWidth, height: nextHeight }
  }

  const getOverlayContext = () => {
    const overlay = scoreOverlayRef.current
    if (!overlay) return null

    let renderer = overlayRendererRef.current
    if (!renderer) {
      renderer = new Renderer(overlay, SCORE_RENDER_BACKEND)
      overlayRendererRef.current = renderer
    }
    const currentSize = overlayRendererSizeRef.current
    const overlayWidth = overlay.width || 1
    const overlayHeight = overlay.height || 1
    if (currentSize.width !== overlayWidth || currentSize.height !== overlayHeight) {
      renderer.resize(overlayWidth, overlayHeight)
      overlayRendererSizeRef.current = { width: overlayWidth, height: overlayHeight }
    }

    return renderer.getContext()
  }

  const buildStaticNoteXById = (pairIndex: number): Map<string, number> => {
    const byId = new Map<string, number>()
    const pairLayouts = noteLayoutsByPairRef.current.get(pairIndex) ?? []
    pairLayouts.forEach((layout) => {
      const layoutKey = getLayoutNoteKey(layout.staff, layout.id)
      byId.set(layoutKey, layout.x)
    })
    return byId
  }

  const buildDragDebugStaticByNoteKey = (pairIndex: number): Map<string, DragDebugStaticRecord> => {
    const byNoteKey = new Map<string, DragDebugStaticRecord>()
    const pairLayouts = noteLayoutsByPairRef.current.get(pairIndex) ?? []
    pairLayouts.forEach((layout) => {
      const noteKey = getLayoutNoteKey(layout.staff, layout.id)
      const headXByKeyIndex = new Map<number, number>()
      layout.noteHeads.forEach((head) => {
        if (!Number.isFinite(head.keyIndex) || !Number.isFinite(head.x)) return
        headXByKeyIndex.set(head.keyIndex, head.x)
      })
      const accidentalRightXByKeyIndex = new Map<number, number>()
      Object.entries(layout.accidentalRightXByKeyIndex).forEach(([keyIndexText, rightX]) => {
        const keyIndex = Number(keyIndexText)
        if (!Number.isFinite(keyIndex) || !Number.isFinite(rightX)) return
        accidentalRightXByKeyIndex.set(keyIndex, rightX)
      })
      byNoteKey.set(noteKey, {
        staff: layout.staff,
        noteId: layout.id,
        noteIndex: layout.noteIndex,
        noteX: layout.x,
        headXByKeyIndex,
        accidentalRightXByKeyIndex,
      })
    })
    return byNoteKey
  }

  const buildPreviewAccidentalRightXFromStatic = (
    staticByNoteKey: Map<string, DragDebugStaticRecord>,
  ): Map<string, Map<number, number>> => {
    const byId = new Map<string, Map<number, number>>()
    staticByNoteKey.forEach((record, noteKey) => {
      const byKeyIndex = new Map<number, number>()
      record.headXByKeyIndex.forEach((headX, keyIndex) => {
        if (!Number.isFinite(headX)) return
        byKeyIndex.set(keyIndex, headX + PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX)
      })
      record.accidentalRightXByKeyIndex.forEach((rightX, keyIndex) => {
        if (!Number.isFinite(rightX)) return
        byKeyIndex.set(keyIndex, rightX)
      })
      if (byKeyIndex.size === 0) return
      byId.set(noteKey, byKeyIndex)
    })
    return byId
  }

  const dumpDragDebugReport = () => {
    const frames = dragDebugFramesRef.current
    if (frames.length === 0) {
      setDragDebugReport('No drag preview frames captured yet. Drag a note first, then click this button again.')
      return
    }

    const maxAbsNoteDelta = Math.max(
      0,
      ...frames.flatMap((frame) =>
        frame.rows.map((row) => Math.abs(row.noteXDelta ?? 0)),
      ),
    )
    const maxAbsHeadDelta = Math.max(
      0,
      ...frames.flatMap((frame) =>
        frame.rows.map((row) => Math.abs(row.headXDelta ?? 0)),
      ),
    )
    const maxAbsAccidentalDelta = Math.max(
      0,
      ...frames.flatMap((frame) =>
        frame.rows.map((row) => Math.abs(row.accidentalRightXDelta ?? 0)),
      ),
    )
    const allRows = frames.flatMap((frame) => frame.rows)
    const accidentalLockReasonCount = allRows.reduce<Record<string, number>>((acc, row) => {
      const key = row.accidentalLockReason
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
    const accidentalLockAppliedCount = allRows.filter((row) => row.accidentalLockApplied).length
    const accidentalModifierRows = allRows.filter((row) => row.hasAccidentalModifier).length
    const unstableAccidentalRows = allRows
      .filter((row) => Math.abs(row.accidentalRightXDelta ?? 0) > 0.5)
      .map((row) => ({
        frame: row.frame,
        staff: row.staff,
        noteId: row.noteId,
        keyIndex: row.keyIndex,
        accidentalRightXStatic: row.accidentalRightXStatic === null ? null : roundNumber(row.accidentalRightXStatic),
        accidentalRightXPreview:
          row.accidentalRightXPreview === null ? null : roundNumber(row.accidentalRightXPreview),
        accidentalRightXDelta: row.accidentalRightXDelta === null ? null : roundNumber(row.accidentalRightXDelta),
        accidentalTargetRightX:
          row.accidentalTargetRightX === null ? null : roundNumber(row.accidentalTargetRightX),
        accidentalLockApplied: row.accidentalLockApplied,
        accidentalLockReason: row.accidentalLockReason,
      }))

    const report = {
      generatedAt: new Date().toISOString(),
      frameCount: frames.length,
      pairIndex: frames[0]?.pairIndex ?? null,
      draggedNote: frames[0] ? { staff: frames[0].draggedStaff, noteId: frames[0].draggedNoteId } : null,
      maxAbsDelta: {
        noteX: roundNumber(maxAbsNoteDelta),
        headX: roundNumber(maxAbsHeadDelta),
        accidentalRightX: roundNumber(maxAbsAccidentalDelta),
      },
      summary: {
        rowCount: allRows.length,
        accidentalModifierRows,
        accidentalLockAppliedCount,
        accidentalLockReasonCount,
        unstableAccidentalRowsCount: unstableAccidentalRows.length,
        unstableAccidentalRows,
      },
      frames: frames.map((frame) => ({
        frame: frame.frame,
        pairIndex: frame.pairIndex,
        draggedNoteId: frame.draggedNoteId,
        draggedStaff: frame.draggedStaff,
        rows: frame.rows.map((row) => ({
          ...row,
          noteXStatic: row.noteXStatic === null ? null : roundNumber(row.noteXStatic),
          noteXPreview: row.noteXPreview === null ? null : roundNumber(row.noteXPreview),
          noteXDelta: row.noteXDelta === null ? null : roundNumber(row.noteXDelta),
          headXStatic: row.headXStatic === null ? null : roundNumber(row.headXStatic),
          headXPreview: row.headXPreview === null ? null : roundNumber(row.headXPreview),
          headXDelta: row.headXDelta === null ? null : roundNumber(row.headXDelta),
          accidentalRightXStatic:
            row.accidentalRightXStatic === null ? null : roundNumber(row.accidentalRightXStatic),
          accidentalRightXPreview:
            row.accidentalRightXPreview === null ? null : roundNumber(row.accidentalRightXPreview),
          accidentalRightXDelta:
            row.accidentalRightXDelta === null ? null : roundNumber(row.accidentalRightXDelta),
          accidentalTargetRightX:
            row.accidentalTargetRightX === null ? null : roundNumber(row.accidentalTargetRightX),
        })),
      })),
    }
    setDragDebugReport(JSON.stringify(report, null, 2))
  }

  const clearDragDebugReport = () => {
    dragDebugFramesRef.current = []
    setDragDebugReport('')
  }

  const drawDragMeasurePreview = (drag: DragState) => {
    dragPreviewFrameRef.current += 1
    const measureLayout = measureLayoutsRef.current.get(drag.pairIndex)
    const measure = measurePairsRef.current[drag.pairIndex]
    if (!measureLayout || !measure) return
    const previewShowKeySignature = !measureLayout.isSystemStart && measureLayout.showKeySignature
    const previewShowTimeSignature = !measureLayout.isSystemStart && measureLayout.showTimeSignature

    const overlayFrame = ensureOverlayCanvasForRect(measureLayout.overlayRect)
    if (!overlayFrame) return

    const overlayContext = getOverlayContext()
    if (!overlayContext) return
    const overlayContext2D = (overlayContext as unknown as { context2D?: CanvasRenderingContext2D }).context2D
    if (!overlayContext2D) return

    overlayContext.clearRect(0, 0, overlayFrame.width, overlayFrame.height)
    overlayContext.save()
    overlayContext.setFillStyle('#ffffff')
    overlayContext.fillRect(0, 0, overlayFrame.width, overlayFrame.height)
    overlayContext.restore()
    overlayContext.save()
    overlayContext2D.translate(-overlayFrame.x, -overlayFrame.y)
    overlayContext.setFillStyle('#000000')
    overlayContext.setStrokeStyle('#000000')

    drawMeasureToContext({
      context: overlayContext,
      measure,
      pairIndex: measureLayout.pairIndex,
      measureX: measureLayout.measureX,
      measureWidth: measureLayout.measureWidth,
      trebleY: measureLayout.trebleY,
      bassY: measureLayout.bassY,
      isSystemStart: measureLayout.isSystemStart,
      keyFifths: measureLayout.keyFifths,
      showKeySignature: previewShowKeySignature,
      timeSignature: measureLayout.timeSignature,
      showTimeSignature: previewShowTimeSignature,
      endTimeSignature: measureLayout.endTimeSignature,
      showEndTimeSignature: measureLayout.showEndTimeSignature,
      activeSelection: null,
      draggingSelection: null,
      previewNote: { noteId: drag.noteId, staff: drag.staff, pitch: drag.pitch, keyIndex: drag.keyIndex },
      previewAccidentalStateBeforeNote: drag.accidentalStateBeforeNote,
      collectLayouts: false,
      suppressSystemDecorations: true,
      noteStartXOverride: measureLayout.noteStartX,
      freezePreviewAccidentalLayout: false,
      formatWidthOverride: measureLayout.formatWidth,
      staticNoteXById: drag.staticNoteXById,
      staticAccidentalRightXById: drag.previewAccidentalRightXById,
      debugCapture: {
        frame: dragPreviewFrameRef.current,
        draggedNoteId: drag.noteId,
        draggedStaff: drag.staff,
        staticByNoteKey: drag.debugStaticByNoteKey,
        pushSnapshot: (snapshot) => {
          const list = dragDebugFramesRef.current
          list.push(snapshot)
          if (list.length > 360) {
            list.splice(0, list.length - 360)
          }
        },
      },
    })
    overlayContext.restore()
  }

  const applyDragPreview = (drag: DragState, pitch: Pitch) => {
    if (pitch === drag.pitch) return

    const nextDrag = { ...drag, pitch }
    dragRef.current = nextDrag
    drawDragMeasurePreview(nextDrag)
  }

  const commitDragPitchToScore = (drag: DragState, pitch: Pitch) => {
    const importedPairs = measurePairsFromImportRef.current
    if (importedPairs) {
      const location = importedNoteLookupRef.current.get(drag.noteId)
      const updated = location
        ? updateMeasurePairPitchAt(importedPairs, location, pitch, drag.keyIndex)
        : updateMeasurePairsPitch(importedPairs, drag.noteId, pitch, drag.keyIndex)
      const normalizeIndex = location?.pairIndex ?? drag.pairIndex
      const normalized = normalizeMeasurePairAt(updated, normalizeIndex, measureKeyFifthsFromImportRef.current)

      measurePairsFromImportRef.current = normalized
      setMeasurePairsFromImport(normalized)
      setNotes(flattenTrebleFromPairs(normalized))
      setBassNotes(flattenBassFromPairs(normalized))
      return
    }

    const currentPairs = measurePairsRef.current
    const updated = updateMeasurePairsPitch(currentPairs, drag.noteId, pitch, drag.keyIndex)
    const normalized = normalizeMeasurePairAt(updated, drag.pairIndex, null)
    setNotes(flattenTrebleFromPairs(normalized))
    setBassNotes(flattenBassFromPairs(normalized))
  }

  const flushPendingDrag = () => {
    dragRafRef.current = null
    const pending = dragPendingRef.current
    if (!pending) return

    dragPendingRef.current = null
    applyDragPreview(pending.drag, pending.pitch)
  }

  const scheduleDragCommit = (drag: DragState, pitch: Pitch) => {
    if (pitch === drag.pitch) return

    dragPendingRef.current = { drag, pitch }
    if (dragRafRef.current !== null) return

    dragRafRef.current = window.requestAnimationFrame(flushPendingDrag)
  }

  const onSurfacePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return

    if (!drag.previewStarted && Math.abs(event.clientY - drag.startClientY) < PREVIEW_START_THRESHOLD_PX) {
      return
    }

    const dragForPreview = drag.previewStarted ? drag : { ...drag, previewStarted: true }
    if (!drag.previewStarted) {
      dragRef.current = dragForPreview
      drawDragMeasurePreview(dragForPreview)
    }

    const y = event.clientY - drag.surfaceTop
    const targetY = y - drag.grabOffsetY
    const staffPositionPitch = getNearestPitchByY(targetY, drag.pitchYMap, drag.pitch)
    const pitch = isSameStaffPositionPitch(staffPositionPitch, drag.pitch)
      ? drag.pitch
      : getEffectivePitchForStaffPosition(staffPositionPitch, drag.keyFifths, drag.accidentalStateBeforeNote)
    if (pitch === drag.pitch) return

    scheduleDragCommit(dragForPreview, pitch)
  }

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return

    if (dragRafRef.current !== null) {
      window.cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    const pending = dragPendingRef.current
    dragPendingRef.current = null
    let finalPitch = drag.pitch
    if (pending && pending.drag.pointerId === drag.pointerId) {
      finalPitch = pending.pitch
    }
    commitDragPitchToScore(drag, finalPitch)

    dragRef.current = null
    dragPreviewFrameRef.current = 0
    clearDragOverlay()
    setDraggingSelection(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const playScore = async () => {
    const synth = synthRef.current
    if (!synth) return

    await Tone.start()
    setIsPlaying(true)

    const start = Tone.now() + 0.05
    let cursor = start
    notes.forEach((note, index) => {
      const bassNote = bassNotes[index]
      synth.triggerAttackRelease(toTonePitch(note.pitch), DURATION_TONE[note.duration], cursor)
      if (bassNote) {
        synth.triggerAttackRelease(toTonePitch(bassNote.pitch), DURATION_TONE[bassNote.duration], cursor, 0.72)
      }
      cursor += DURATION_BEATS[note.duration] * QUARTER_NOTE_SECONDS
    })

    if (stopPlayTimerRef.current !== null) {
      window.clearTimeout(stopPlayTimerRef.current)
    }

    stopPlayTimerRef.current = window.setTimeout(() => {
      setIsPlaying(false)
      stopPlayTimerRef.current = null
    }, Math.max(200, (cursor - start) * 1000 + 200))
  }

  const applyImportedScore = (result: ImportResult) => {
    setNotes(result.trebleNotes)
    setBassNotes(result.bassNotes)
    setMeasurePairsFromImport(result.measurePairs)
    measurePairsFromImportRef.current = result.measurePairs
    setMeasureKeyFifthsFromImport(result.measureKeyFifths)
    measureKeyFifthsFromImportRef.current = result.measureKeyFifths
    setMeasureDivisionsFromImport(result.measureDivisions)
    measureDivisionsFromImportRef.current = result.measureDivisions
    setMeasureTimeSignaturesFromImport(result.measureTimeSignatures)
    measureTimeSignaturesFromImportRef.current = result.measureTimeSignatures
    setMusicXmlMetadataFromImport(result.metadata)
    musicXmlMetadataFromImportRef.current = result.metadata
    importedNoteLookupRef.current = buildImportedNoteLookup(result.measurePairs)
    dragRef.current = null
    clearDragOverlay()
    setDraggingSelection(null)

    if (result.trebleNotes[0]) {
      setActiveSelection({ noteId: result.trebleNotes[0].id, staff: 'treble', keyIndex: 0 })
      return
    }
    if (result.bassNotes[0]) {
      setActiveSelection({ noteId: result.bassNotes[0].id, staff: 'bass', keyIndex: 0 })
    }
  }

  const importMusicXmlText = (xmlText: string) => {
    const content = xmlText.trim()
    if (!content) {
      setImportFeedback({ kind: 'error', message: 'Paste MusicXML text first, then import.' })
      return
    }

    try {
      const imported = parseMusicXml(content)
      setIsRhythmLinked(false)
      applyImportedScore(imported)
      setImportFeedback({
        kind: 'success',
        message: `Imported ${imported.measurePairs.length} measures: treble ${imported.trebleNotes.length} notes, bass ${imported.bassNotes.length} notes.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import MusicXML.'
      setImportFeedback({ kind: 'error', message })
    }
  }

  const importMusicXmlFromTextarea = () => {
    importMusicXmlText(musicXmlInput)
  }

  const openMusicXmlFilePicker = () => {
    fileInputRef.current?.click()
  }

  const onMusicXmlFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const xmlText = await file.text()
      setMusicXmlInput(xmlText)
      importMusicXmlText(xmlText)
    } catch {
      setImportFeedback({ kind: 'error', message: 'Could not read the selected file.' })
    } finally {
      event.currentTarget.value = ''
    }
  }

  const loadSampleMusicXml = () => {
    setMusicXmlInput(SAMPLE_MUSIC_XML)
    importMusicXmlText(SAMPLE_MUSIC_XML)
  }

  const exportMusicXmlFile = () => {
    const xmlText = buildMusicXmlFromMeasurePairs({
      measurePairs,
      keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
      divisionsByMeasure: measureDivisionsFromImportRef.current,
      timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
      metadata: musicXmlMetadataFromImportRef.current,
    })

    const title = musicXmlMetadataFromImportRef.current?.workTitle?.trim() || 'score'
    const safeName = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'score'
    const blob = new Blob([xmlText], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeName}.musicxml`
    link.click()
    URL.revokeObjectURL(url)

    setImportFeedback({
      kind: 'success',
      message: `Exported ${measurePairs.length} measures to ${safeName}.musicxml`,
    })
  }

  const resetScore = () => {
    setNotes(INITIAL_NOTES)
    setBassNotes(INITIAL_BASS_NOTES)
    setMeasurePairsFromImport(null)
    measurePairsFromImportRef.current = null
    setMeasureKeyFifthsFromImport(null)
    measureKeyFifthsFromImportRef.current = null
    setMeasureDivisionsFromImport(null)
    measureDivisionsFromImportRef.current = null
    setMeasureTimeSignaturesFromImport(null)
    measureTimeSignaturesFromImportRef.current = null
    setMusicXmlMetadataFromImport(null)
    musicXmlMetadataFromImportRef.current = null
    importedNoteLookupRef.current.clear()
    dragRef.current = null
    clearDragOverlay()
    setActiveSelection({ noteId: INITIAL_NOTES[0].id, staff: 'treble', keyIndex: 0 })
    setDraggingSelection(null)
    setRhythmPreset('quarter')
    setImportFeedback({ kind: 'idle', message: '' })
    setIsRhythmLinked(true)
  }

  const runAiDraft = () => {
    setMeasurePairsFromImport(null)
    measurePairsFromImportRef.current = null
    setMeasureKeyFifthsFromImport(null)
    measureKeyFifthsFromImportRef.current = null
    setMeasureDivisionsFromImport(null)
    measureDivisionsFromImportRef.current = null
    setMeasureTimeSignaturesFromImport(null)
    measureTimeSignaturesFromImportRef.current = null
    setMusicXmlMetadataFromImport(null)
    musicXmlMetadataFromImportRef.current = null
    importedNoteLookupRef.current.clear()
    dragRef.current = null
    clearDragOverlay()
    setNotes((current) => createAiVariation(current))
  }

  const applyRhythmPreset = (presetId: RhythmPresetId) => {
    const preset = RHYTHM_PRESETS.find((item) => item.id === presetId)
    if (!preset) return

    setIsRhythmLinked(true)
    setMeasurePairsFromImport(null)
    measurePairsFromImportRef.current = null
    setMeasureKeyFifthsFromImport(null)
    measureKeyFifthsFromImportRef.current = null
    setMeasureDivisionsFromImport(null)
    measureDivisionsFromImportRef.current = null
    setMeasureTimeSignaturesFromImport(null)
    measureTimeSignaturesFromImportRef.current = null
    setMusicXmlMetadataFromImport(null)
    musicXmlMetadataFromImportRef.current = null
    importedNoteLookupRef.current.clear()
    dragRef.current = null
    clearDragOverlay()

    let nextActive = ''
    setNotes((current) => {
      const next = buildNotesFromPattern(preset.pattern, current)
      nextActive = next[0]?.id ?? ''
      return next
    })
    if (nextActive) {
      setActiveSelection({ noteId: nextActive, staff: 'treble', keyIndex: 0 })
    }
    setRhythmPreset(presetId)
  }

  const beginDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const surface = scoreRef.current
    if (!surface) return

    const rect = surface.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const hit = getHitNote(x, y, noteLayoutsRef.current, 30, hitGridRef.current)

    if (!hit) return

    const hitNote = hit.layout
    const hitHead = hit.head

    event.preventDefault()
    dragPreviewFrameRef.current = 0
    dragDebugFramesRef.current = []
    clearDragOverlay()
    let current: ScoreNote | undefined
    const importedPairs = measurePairsFromImportRef.current
    if (importedPairs) {
      const located = importedNoteLookupRef.current.get(hitNote.id)
      if (located) {
        const pair = importedPairs[located.pairIndex]
        current = (located.staff === 'treble' ? pair?.treble : pair?.bass)?.[located.noteIndex]
      }
      if (!current) {
        const pair = importedPairs[hitNote.pairIndex]
        current = (hitNote.staff === 'treble' ? pair?.treble : pair?.bass)?.[hitNote.noteIndex]
      }
    }
    if (!current) {
      const sourceNotes = hitNote.staff === 'treble' ? notes : bassNotes
      current = sourceNotes.find((note) => note.id === hitNote.id)
    }
    const measurePair = (importedPairs ?? measurePairsRef.current)[hitNote.pairIndex]
    const measureStaffNotes = hitNote.staff === 'treble' ? (measurePair?.treble ?? []) : (measurePair?.bass ?? [])
    const keyFifths =
      measureLayoutsRef.current.get(hitNote.pairIndex)?.keyFifths ??
      measureKeyFifthsFromImportRef.current?.[hitNote.pairIndex] ??
      measureKeyFifthsFromImportRef.current?.[hitNote.pairIndex - 1] ??
      0
    const accidentalStateBeforeNote = buildAccidentalStateBeforeNote(measureStaffNotes, hitNote.noteIndex, keyFifths)
    const noteCenterY = hitHead.y
    const grabOffsetY = y - noteCenterY
    const hitKeyIndex = hitHead.keyIndex
    const currentPitch =
      current && hitKeyIndex > 0 ? current.chordPitches?.[hitKeyIndex - 1] ?? current.pitch : current?.pitch
    const pitch = currentPitch ?? hitHead.pitch ?? getNearestPitchByY(noteCenterY, hitNote.pitchYMap)
    const staticNoteXById = buildStaticNoteXById(hitNote.pairIndex)
    const debugStaticByNoteKey = buildDragDebugStaticByNoteKey(hitNote.pairIndex)
    const previewAccidentalRightXById = buildPreviewAccidentalRightXFromStatic(debugStaticByNoteKey)

    const dragState: DragState = {
      noteId: hitNote.id,
      staff: hitNote.staff,
      keyIndex: hitKeyIndex,
      pairIndex: hitNote.pairIndex,
      noteIndex: hitNote.noteIndex,
      pointerId: event.pointerId,
      surfaceTop: rect.top,
      startClientY: event.clientY,
      pitch,
      previewStarted: false,
      grabOffsetY,
      pitchYMap: hitNote.pitchYMap,
      keyFifths,
      accidentalStateBeforeNote,
      staticNoteXById,
      previewAccidentalRightXById,
      debugStaticByNoteKey,
    }

    dragRef.current = dragState
    setActiveSelection((currentSelection) => {
      if (
        currentSelection.noteId === hitNote.id &&
        currentSelection.staff === hitNote.staff &&
        currentSelection.keyIndex === hitKeyIndex
      ) {
        return currentSelection
      }
      return { noteId: hitNote.id, staff: hitNote.staff, keyIndex: hitKeyIndex }
    })
    setDraggingSelection((currentSelection) => {
      if (
        currentSelection &&
        currentSelection.noteId === hitNote.id &&
        currentSelection.staff === hitNote.staff &&
        currentSelection.keyIndex === hitKeyIndex
      ) {
        return currentSelection
      }
      return { noteId: hitNote.id, staff: hitNote.staff, keyIndex: hitKeyIndex }
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const activePool = activeSelection.staff === 'treble' ? notes : bassNotes
  const currentSelection = activePool.find((note) => note.id === activeSelection.noteId) ?? activePool[0] ?? notes[0]
  const currentSelectionPitch =
    activeSelection.keyIndex > 0
      ? currentSelection.chordPitches?.[activeSelection.keyIndex - 1] ?? currentSelection.pitch
      : currentSelection.pitch
  const trebleSequenceText = useMemo(() => notes.map((note) => toDisplayPitch(note.pitch)).join('  |  '), [notes])
  const bassSequenceText = useMemo(() => bassNotes.map((note) => toDisplayPitch(note.pitch)).join('  |  '), [bassNotes])

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Interactive Music Score MVP</p>
        <h1>Real-time Staff Preview + Drag Editing</h1>
        <p className="subtitle">
          A4-style score page with line wrapping across all measures. You can import MusicXML and drag notes in treble or bass.
        </p>
      </section>

      <section className="control-row">
        <button type="button" onClick={playScore} disabled={isPlaying}>
          {isPlaying ? 'Playing...' : 'Play Measure'}
        </button>
        <button type="button" onClick={runAiDraft}>
          AI Draft
        </button>
        <button type="button" onClick={resetScore}>
          Reset
        </button>
      </section>

      <section className="import-panel">
        <div className="import-actions">
          <button type="button" onClick={openMusicXmlFilePicker}>
            Load MusicXML File
          </button>
          <button type="button" onClick={loadSampleMusicXml}>
            Load Sample XML
          </button>
          <button type="button" onClick={exportMusicXmlFile}>
            Export MusicXML
          </button>
          <button type="button" onClick={importMusicXmlFromTextarea}>
            Import XML Text
          </button>
        </div>

        <input
          ref={fileInputRef}
          className="xml-file-input"
          type="file"
          accept=".musicxml,.xml,text/xml,application/xml"
          onChange={onMusicXmlFileChange}
        />

        <textarea
          className="xml-input"
          value={musicXmlInput}
          onChange={(event) => setMusicXmlInput(event.target.value)}
          placeholder="Paste MusicXML text here, then click Import XML Text."
          spellCheck={false}
        />

        {importFeedback.kind !== 'idle' && (
          <p className={`import-feedback ${importFeedback.kind}`}>{importFeedback.message}</p>
        )}
      </section>

      <section className="rhythm-row">
        {RHYTHM_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`rhythm-btn ${rhythmPreset === preset.id ? 'active' : ''}`}
            onClick={() => applyRhythmPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </section>

      <section className="board">
        <div className="score-scroll" ref={scoreScrollRef}>
          <div className="score-stage" style={{ width: `${scoreWidth}px`, height: `${scoreHeight}px` }}>
            <canvas
              className={`score-surface ${draggingSelection ? 'is-dragging' : ''}`}
              ref={scoreRef}
              onPointerDown={beginDrag}
              onPointerMove={onSurfacePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
            <canvas className="score-overlay" ref={scoreOverlayRef} width={1} height={1} />
          </div>
        </div>

        <div className="inspector">
          <h2>Selected Note</h2>
          <p>
            Staff: <strong>{activeSelection.staff === 'treble' ? 'Treble' : 'Bass'}</strong>
          </p>
          <p>
            Pitch: <strong>{toDisplayPitch(currentSelectionPitch)}</strong>
          </p>
          <p>
            Duration: <strong>{toDisplayDuration(currentSelection.duration)}</strong>
          </p>
          <p>
            Position: <strong>{activePool.findIndex((note) => note.id === currentSelection.id) + 1}</strong> /{' '}
            {activePool.length}
          </p>
          <p className="sequence">Treble: {trebleSequenceText}</p>
          <p className="sequence">Bass: {bassSequenceText}</p>
          <div className="debug-tools">
            <button type="button" onClick={dumpDragDebugReport}>
              Dump Drag Log
            </button>
            <button type="button" onClick={clearDragDebugReport}>
              Clear Drag Log
            </button>
          </div>
          <textarea
            className="debug-log"
            value={dragDebugReport}
            readOnly
            placeholder="Drag a note, then click Dump Drag Log."
            spellCheck={false}
          />
        </div>
      </section>
    </main>
  )
}

export default App


