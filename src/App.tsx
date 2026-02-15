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

const PIANO_MIN_MIDI = 21 // A0
const PIANO_MAX_MIDI = 108 // C8
const CHROMATIC_STEPS = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'] as const

type Pitch = string
type StemDirection = 1 | -1
type NoteDuration = 'w' | 'h' | 'q' | '8' | '16' | '32' | 'qd' | '8d' | '16d' | '32d'
type NoteDurationBase = 'w' | 'h' | 'q' | '8' | '16' | '32'
type RhythmPresetId = 'quarter' | 'twoEighth' | 'fourSixteenth' | 'eightSixteenth' | 'shortDotted'
type StaffKind = 'treble' | 'bass'

type ScoreNote = {
  id: string
  pitch: Pitch
  duration: NoteDuration
}

type ImportResult = {
  trebleNotes: ScoreNote[]
  bassNotes: ScoreNote[]
  measurePairs: MeasurePair[]
}

type ImportFeedback = {
  kind: 'idle' | 'success' | 'error'
  message: string
}

type NoteLayout = {
  id: string
  staff: StaffKind
  x: number
  y: number
  pitchYMap: Record<Pitch, number>
}

type Selection = {
  noteId: string
  staff: StaffKind
}

type DragState = {
  noteId: string
  staff: StaffKind
  pointerId: number
  pitch: Pitch
  grabOffsetY: number
  pitchYMap: Record<Pitch, number>
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

function buildPitchLineMap(clef: StaffKind): Record<Pitch, number> {
  const map = {} as Record<Pitch, number>
  for (const pitch of PITCHES) {
    const probe = new StaveNote({
      keys: [pitch],
      duration: 'q',
      clef,
    })
    map[pitch] = probe.getKeyLine(0)
  }
  return map
}

const PITCH_LINE_MAP: Record<StaffKind, Record<Pitch, number>> = {
  treble: buildPitchLineMap('treble'),
  bass: buildPitchLineMap('bass'),
}

function toDisplayPitch(pitch: Pitch): string {
  const { note, octave } = parsePitch(pitch)
  return `${note.toUpperCase()}${octave}`
}

function toTonePitch(pitch: Pitch): string {
  const { note, octave } = parsePitch(pitch)
  return `${note.toUpperCase()}${octave}`
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

function createImportedNoteId(staff: StaffKind): string {
  return `${staff}-${createNoteId()}`
}

function beatsToTicks(beats: number): number {
  const ticks = Math.round(beats * TICKS_PER_BEAT)
  return clamp(ticks, 1, MEASURE_TICKS)
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

function parseMusicXmlPitch(noteEl: Element): Pitch | null {
  const pitchEl = noteEl.querySelector('pitch')
  if (!pitchEl) return null

  const step = pitchEl.querySelector('step')?.textContent?.trim().toUpperCase()
  const alterText = pitchEl.querySelector('alter')?.textContent?.trim()
  const octaveText = pitchEl.querySelector('octave')?.textContent?.trim()
  if (!step || !octaveText || STEP_TO_SEMITONE[step] === undefined) return null

  const alter = alterText ? Number(alterText) : 0
  const octave = Number(octaveText)
  if (!Number.isFinite(alter) || !Number.isFinite(octave)) return null

  const midi = clamp((octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter, PIANO_MIN_MIDI, PIANO_MAX_MIDI)
  return midiToPitch(midi)
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

function fillMissingTicksWithCarryNotes(notes: ScoreNote[], staff: StaffKind, ticksUsed: number, carryPitch: Pitch): ScoreNote[] {
  const filled = [...notes]
  let remaining = clamp(MEASURE_TICKS - ticksUsed, 0, MEASURE_TICKS)

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

  const partNodes = Array.from(doc.getElementsByTagName('part'))
  if (partNodes.length === 0) {
    throw new Error('No <part> node found in this MusicXML file.')
  }

  const measureSlots: {
    notes: Record<StaffKind, ScoreNote[]>
    ticksUsed: Record<StaffKind, number>
    touched: Record<StaffKind, boolean>
  }[] = []

  const ensureMeasureSlot = (index: number) => {
    if (!measureSlots[index]) {
      measureSlots[index] = {
        notes: { treble: [], bass: [] },
        ticksUsed: { treble: 0, bass: 0 },
        touched: { treble: false, bass: false },
      }
    }
    return measureSlots[index]
  }

  const lastPitch: Record<StaffKind, Pitch> = { treble: 'c/4', bass: 'c/3' }

  partNodes.forEach((partEl, partIndex) => {
    const measureEls = Array.from(partEl.getElementsByTagName('measure'))
    if (measureEls.length === 0) return

    let divisions = 1
    measureEls.forEach((measureEl, measureIndex) => {
      const slot = ensureMeasureSlot(measureIndex)
      const divisionsText = measureEl.querySelector('attributes > divisions')?.textContent?.trim()
      const maybeDivisions = divisionsText ? Number(divisionsText) : Number.NaN
      if (Number.isFinite(maybeDivisions) && maybeDivisions > 0) {
        divisions = maybeDivisions
      }

      const noteEls = Array.from(measureEl.getElementsByTagName('note'))
      noteEls.forEach((noteEl) => {
        if (noteEl.querySelector('grace')) return
        if (noteEl.querySelector('chord')) return

        const staffText = noteEl.querySelector('staff')?.textContent?.trim()
        const staff: StaffKind =
          staffText === '2' ? 'bass' : staffText === '1' ? 'treble' : partNodes.length > 1 && partIndex === 1 ? 'bass' : 'treble'

        if (slot.ticksUsed[staff] >= MEASURE_TICKS) return

        const beats = parseMusicXmlBeats(noteEl, divisions)
        if (!beats) return

        const isRest = Boolean(noteEl.querySelector('rest'))
        const parsedPitch = isRest ? null : parseMusicXmlPitch(noteEl)
        const pitch = parsedPitch ?? lastPitch[staff]
        const notePattern = splitTicksToDurations(beatsToTicks(beats))

        slot.touched[staff] = true
        for (const duration of notePattern) {
          const durationTicks = DURATION_TICKS[duration]
          if (slot.ticksUsed[staff] + durationTicks > MEASURE_TICKS) break
          slot.notes[staff].push({
            id: createImportedNoteId(staff),
            pitch,
            duration,
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
    const treble = fillMissingTicksWithCarryNotes(slot.notes.treble, 'treble', slot.ticksUsed.treble, treblePitch)
    const bass = fillMissingTicksWithCarryNotes(slot.notes.bass, 'bass', slot.ticksUsed.bass, bassPitch)

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
    }
  }

  return {
    trebleNotes: importedPairs.flatMap((pair) => pair.treble),
    bassNotes: importedPairs.flatMap((pair) => pair.bass),
    measurePairs: importedPairs,
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
  const line = PITCH_LINE_MAP.treble[pitch]
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

function getHitNote(x: number, y: number, layouts: NoteLayout[], radius = 24): NoteLayout | null {
  if (layouts.length === 0) return null

  let winner: NoteLayout | null = null
  let winnerDistance = Number.POSITIVE_INFINITY

  for (const layout of layouts) {
    const distance = Math.hypot(layout.x - x, layout.y - y)
    if (distance < winnerDistance) {
      winner = layout
      winnerDistance = distance
    }
  }

  if (!winner || winnerDistance > radius) return null
  return winner
}

function updateNotePitch(notes: ScoreNote[], noteId: string, pitch: Pitch): ScoreNote[] {
  const noteIndex = notes.findIndex((note) => note.id === noteId)
  if (noteIndex < 0) return notes

  const source = notes[noteIndex]
  if (source.pitch === pitch) return notes

  const next = notes.slice()
  next[noteIndex] = { ...source, pitch }
  return next
}

function flattenTrebleFromPairs(pairs: MeasurePair[]): ScoreNote[] {
  return pairs.flatMap((pair) => pair.treble)
}

function flattenBassFromPairs(pairs: MeasurePair[]): ScoreNote[] {
  return pairs.flatMap((pair) => pair.bass)
}

function updateMeasurePairsPitch(pairs: MeasurePair[], noteId: string, pitch: Pitch): MeasurePair[] {
  let changed = false
  const nextPairs = pairs.map((pair) => {
    const nextTreble = updateNotePitch(pair.treble, noteId, pitch)
    const nextBass = updateNotePitch(pair.bass, noteId, pitch)
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

function updateMeasurePairPitchAt(pairs: MeasurePair[], location: ImportedNoteLocation, pitch: Pitch): MeasurePair[] {
  const pair = pairs[location.pairIndex]
  if (!pair) return pairs

  const sourceList = location.staff === 'treble' ? pair.treble : pair.bass
  const sourceNote = sourceList[location.noteIndex]
  if (!sourceNote || sourceNote.pitch === pitch) return pairs

  const nextPairs = pairs.slice()
  const nextPair: MeasurePair = { treble: pair.treble, bass: pair.bass }
  const nextList = sourceList.slice()
  nextList[location.noteIndex] = { ...sourceNote, pitch }

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
    return { ...note, pitch: PITCHES[cursor] }
  })
}

function App() {
  const [notes, setNotes] = useState<ScoreNote[]>(INITIAL_NOTES)
  const [bassNotes, setBassNotes] = useState<ScoreNote[]>(INITIAL_BASS_NOTES)
  const [rhythmPreset, setRhythmPreset] = useState<RhythmPresetId>('quarter')
  const [activeSelection, setActiveSelection] = useState<Selection>({ noteId: INITIAL_NOTES[0].id, staff: 'treble' })
  const [draggingSelection, setDraggingSelection] = useState<Selection | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [musicXmlInput, setMusicXmlInput] = useState<string>('')
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>({ kind: 'idle', message: '' })
  const [isRhythmLinked, setIsRhythmLinked] = useState(true)
  const [measurePairsFromImport, setMeasurePairsFromImport] = useState<MeasurePair[] | null>(null)
  const [visibleSystemRange, setVisibleSystemRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 })

  const scoreRef = useRef<HTMLCanvasElement | null>(null)
  const scoreScrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | null>(null)

  const noteLayoutsRef = useRef<NoteLayout[]>([])
  const dragRef = useRef<DragState | null>(null)
  const dragRafRef = useRef<number | null>(null)
  const dragPendingRef = useRef<{ drag: DragState; pitch: Pitch } | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const stopPlayTimerRef = useRef<number | null>(null)
  const measurePairsFromImportRef = useRef<MeasurePair[] | null>(null)
  const importedNoteLookupRef = useRef<Map<string, ImportedNoteLocation>>(new Map())
  const scoreWidth = A4_PAGE_WIDTH
  const measurePairs = useMemo(
    () => measurePairsFromImport ?? buildMeasurePairs(notes, bassNotes),
    [measurePairsFromImport, notes, bassNotes],
  )
  const measuresPerLine = 2
  const systemCount = Math.max(1, Math.ceil(measurePairs.length / measuresPerLine))
  const scoreHeight = SCORE_TOP_PADDING * 2 + systemCount * SYSTEM_HEIGHT + Math.max(0, systemCount - 1) * SYSTEM_GAP_Y

  useEffect(() => {
    measurePairsFromImportRef.current = measurePairsFromImport
  }, [measurePairsFromImport])

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
      const measureWidth = Math.floor(systemUsableWidth / systemMeasures.length)

      systemMeasures.forEach((measure, indexInSystem) => {
        const measureX = STAFF_X + indexInSystem * measureWidth
        const trebleStave = new Stave(measureX, trebleY, measureWidth)
        const bassStave = new Stave(measureX, bassY, measureWidth)

        if (indexInSystem === 0) {
          trebleStave.addClef('treble').addTimeSignature('4/4')
          bassStave.addClef('bass').addTimeSignature('4/4')
        } else {
          trebleStave.setBegBarType(BarlineType.NONE)
          bassStave.setBegBarType(BarlineType.NONE)
        }

        trebleStave.setContext(context).draw()
        bassStave.setContext(context).draw()

        if (indexInSystem === 0) {
          new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.BRACE).setContext(context).draw()
          new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw()
        }
        new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw()

        const trebleVexNotes = measure.treble.map((note) => {
          const dots = getDurationDots(note.duration)
          const vexNote = new StaveNote({
            keys: [note.pitch],
            duration: toVexDuration(note.duration),
            dots,
            clef: 'treble',
            stemDirection: getStrictStemDirection(note.pitch),
          })
          if (note.pitch.includes('#')) vexNote.addModifier(new Accidental('#'), 0)
          if (dots > 0) {
            Dot.buildAndAttach([vexNote], { all: true })
          }
          return vexNote
        })

        const bassVexNotes = measure.bass.map((note) => {
          const dots = getDurationDots(note.duration)
          const vexNote = new StaveNote({
            keys: [note.pitch],
            duration: toVexDuration(note.duration),
            dots,
            clef: 'bass',
            autoStem: true,
          })
          if (note.pitch.includes('#')) vexNote.addModifier(new Accidental('#'), 0)
          if (dots > 0) {
            Dot.buildAndAttach([vexNote], { all: true })
          }
          return vexNote
        })

        trebleVexNotes.forEach((vexNote, index) => {
          const noteId = measure.treble[index].id
          if (draggingSelection?.staff === 'treble' && draggingSelection.noteId === noteId) {
            vexNote.setKeyStyle(0, { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
          } else if (activeSelection.staff === 'treble' && activeSelection.noteId === noteId) {
            vexNote.setKeyStyle(0, { fillStyle: '#145f84', strokeStyle: '#145f84' })
          }
        })

        bassVexNotes.forEach((vexNote, index) => {
          const noteId = measure.bass[index].id
          if (draggingSelection?.staff === 'bass' && draggingSelection.noteId === noteId) {
            vexNote.setKeyStyle(0, { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
          } else if (activeSelection.staff === 'bass' && activeSelection.noteId === noteId) {
            vexNote.setKeyStyle(0, { fillStyle: '#145f84', strokeStyle: '#145f84' })
          }
        })

        const trebleVoice = new Voice({ numBeats: 4, beatValue: 4 }).addTickables(trebleVexNotes)
        const bassVoice = new Voice({ numBeats: 4, beatValue: 4 }).addTickables(bassVexNotes)
        const formatWidth = Math.max(80, trebleStave.getNoteEndX() - trebleStave.getNoteStartX() - 8)

        new Formatter().joinVoices([trebleVoice]).joinVoices([bassVoice]).format([trebleVoice, bassVoice], formatWidth)

        const trebleBeams = Beam.generateBeams(trebleVexNotes, { groups: [new Fraction(1, 4)] })
        const bassBeams = Beam.generateBeams(bassVexNotes, { groups: [new Fraction(1, 4)] })

        trebleVoice.draw(context, trebleStave)
        bassVoice.draw(context, bassStave)
        trebleBeams.forEach((beam) => beam.setContext(context).draw())
        bassBeams.forEach((beam) => beam.setContext(context).draw())

        const treblePitchYMap = {} as Record<Pitch, number>
        const bassPitchYMap = {} as Record<Pitch, number>
        for (const pitch of PITCHES) {
          treblePitchYMap[pitch] = trebleStave.getYForNote(PITCH_LINE_MAP.treble[pitch])
          bassPitchYMap[pitch] = bassStave.getYForNote(PITCH_LINE_MAP.bass[pitch])
        }

        nextLayouts.push(
          ...trebleVexNotes.map((vexNote, index) => ({
            id: measure.treble[index].id,
            staff: 'treble' as const,
            x: vexNote.getAbsoluteX(),
            y: vexNote.getYs()[0],
            pitchYMap: treblePitchYMap,
          })),
        )
        nextLayouts.push(
          ...bassVexNotes.map((vexNote, index) => ({
            id: measure.bass[index].id,
            staff: 'bass' as const,
            x: vexNote.getAbsoluteX(),
            y: vexNote.getYs()[0],
            pitchYMap: bassPitchYMap,
          })),
        )
      })
    }

    noteLayoutsRef.current = nextLayouts
  }, [
    measurePairs,
    scoreWidth,
    scoreHeight,
    systemCount,
    measuresPerLine,
    activeSelection,
    draggingSelection,
    visibleSystemRange.start,
    visibleSystemRange.end,
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
    }
  }, [])

  const applyDragPreview = (drag: DragState, pitch: Pitch) => {
    if (pitch === drag.pitch) return

    const nextDrag = { ...drag, pitch }
    dragRef.current = nextDrag
    commitDragPitchToScore(nextDrag, pitch)
  }

  const commitDragPitchToScore = (drag: DragState, pitch: Pitch) => {
    if (measurePairsFromImportRef.current) {
      const location = importedNoteLookupRef.current.get(drag.noteId)
      if (location) {
        setMeasurePairsFromImport((current) => {
          if (!current) return current
          const next = updateMeasurePairPitchAt(current, location, pitch)
          measurePairsFromImportRef.current = next
          return next
        })
        return
      }

      setMeasurePairsFromImport((current) => {
        if (!current) return current
        const next = updateMeasurePairsPitch(current, drag.noteId, pitch)
        measurePairsFromImportRef.current = next
        return next
      })
      return
    }

    if (drag.staff === 'treble') {
      setNotes((current) => updateNotePitch(current, drag.noteId, pitch))
    } else {
      setBassNotes((current) => updateNotePitch(current, drag.noteId, pitch))
    }
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

    const surface = scoreRef.current
    if (!surface) return

    const rect = surface.getBoundingClientRect()
    const y = event.clientY - rect.top
    const targetY = y - drag.grabOffsetY
    const pitch = getNearestPitchByY(targetY, drag.pitchYMap, drag.pitch)
    scheduleDragCommit(drag, pitch)
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

    const importedPairs = measurePairsFromImportRef.current
    if (importedPairs) {
      setNotes(flattenTrebleFromPairs(importedPairs))
      setBassNotes(flattenBassFromPairs(importedPairs))
    }

    dragRef.current = null
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
    importedNoteLookupRef.current = buildImportedNoteLookup(result.measurePairs)
    dragRef.current = null
    setDraggingSelection(null)

    if (result.trebleNotes[0]) {
      setActiveSelection({ noteId: result.trebleNotes[0].id, staff: 'treble' })
      return
    }
    if (result.bassNotes[0]) {
      setActiveSelection({ noteId: result.bassNotes[0].id, staff: 'bass' })
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

  const resetScore = () => {
    setNotes(INITIAL_NOTES)
    setBassNotes(INITIAL_BASS_NOTES)
    setMeasurePairsFromImport(null)
    measurePairsFromImportRef.current = null
    importedNoteLookupRef.current.clear()
    dragRef.current = null
    setActiveSelection({ noteId: INITIAL_NOTES[0].id, staff: 'treble' })
    setDraggingSelection(null)
    setRhythmPreset('quarter')
    setImportFeedback({ kind: 'idle', message: '' })
    setIsRhythmLinked(true)
  }

  const runAiDraft = () => {
    setMeasurePairsFromImport(null)
    measurePairsFromImportRef.current = null
    importedNoteLookupRef.current.clear()
    dragRef.current = null
    setNotes((current) => createAiVariation(current))
  }

  const applyRhythmPreset = (presetId: RhythmPresetId) => {
    const preset = RHYTHM_PRESETS.find((item) => item.id === presetId)
    if (!preset) return

    setIsRhythmLinked(true)
    setMeasurePairsFromImport(null)
    measurePairsFromImportRef.current = null
    importedNoteLookupRef.current.clear()
    dragRef.current = null

    let nextActive = ''
    setNotes((current) => {
      const next = buildNotesFromPattern(preset.pattern, current)
      nextActive = next[0]?.id ?? ''
      return next
    })
    if (nextActive) {
      setActiveSelection({ noteId: nextActive, staff: 'treble' })
    }
    setRhythmPreset(presetId)
  }

  const beginDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const surface = scoreRef.current
    if (!surface) return

    const rect = surface.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const hitNote = getHitNote(x, y, noteLayoutsRef.current, 30)

    if (!hitNote) return

    event.preventDefault()
    const sourceNotes = hitNote.staff === 'treble' ? notes : bassNotes
    const current = sourceNotes.find((note) => note.id === hitNote.id)
    const noteCenterY = hitNote.y
    const grabOffsetY = y - noteCenterY
    const pitch = current?.pitch ?? getNearestPitchByY(noteCenterY, hitNote.pitchYMap)

    const dragState: DragState = {
      noteId: hitNote.id,
      staff: hitNote.staff,
      pointerId: event.pointerId,
      pitch,
      grabOffsetY,
      pitchYMap: hitNote.pitchYMap,
    }

    dragRef.current = dragState
    setActiveSelection({ noteId: hitNote.id, staff: hitNote.staff })
    setDraggingSelection({ noteId: hitNote.id, staff: hitNote.staff })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const activePool = activeSelection.staff === 'treble' ? notes : bassNotes
  const currentSelection = activePool.find((note) => note.id === activeSelection.noteId) ?? activePool[0] ?? notes[0]
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
          </div>
        </div>

        <div className="inspector">
          <h2>Selected Note</h2>
          <p>
            Staff: <strong>{activeSelection.staff === 'treble' ? 'Treble' : 'Bass'}</strong>
          </p>
          <p>
            Pitch: <strong>{toDisplayPitch(currentSelection.pitch)}</strong>
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
        </div>
      </section>
    </main>
  )
}

export default App

