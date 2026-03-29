import { DURATION_TICKS, TICKS_PER_BEAT } from './constants'
import { normalizeMeasurePairAt } from './accidentals'
import { buildMeasureRestNotes, isStaffFullMeasureRest, resolvePairTimeSignature } from './measureRestUtils'
import { toPitchFromStepAlter } from './pitchMath'
import { fetchNotesFromRhythmLibrary } from './rhythmTemplateDb'
import { createImportedNoteId, splitTicksToDurations } from './scoreOps'
import type { ChordRulerEntry } from './chordRuler'
import type {
  MeasurePair,
  Pitch,
  ScoreNote,
  SegmentRhythmTemplateDetail,
  TimeSignature,
} from './types'

export type TimelineSegmentScope = {
  startPairIndex: number
  endPairIndexInclusive: number
}

type SegmentChordEvent = {
  pairIndex: number
  relativePairIndex: number
  measureNumber: number
  chordName: string
  startTick: number
  endTick: number
  startBeatInMeasure: number
  startBeatInSegment: number
  durationBeats: number
}

type ParsedRhythmTemplatePattern = Record<string, number[][]>

type ExpandedRhythmTemplateDetail = SegmentRhythmTemplateDetail & {
  pairIndex: number
  chordName: string
  startBeatInMeasure: number
  startBeatInSegment: number
  sourceChordFamily: string
}

type GeneratedBassEvent = {
  pairIndex: number
  startTick: number
  durationTicks: number
  pitchNames: string[]
  isRest: boolean
}

const DEFAULT_PITCH_RANGE = 'B1-G4'
const DEFAULT_STRUCTURE_TYPE = '不限制'
const DEFAULT_OCTAVE_MODE = '跟随模板'
const STRUCTURE_SINGLE = '单音'
const DURATION_EPSILON = 0.000001
const MELODY_CONFLICT_THRESHOLD = 0.1
const DEFAULT_MAX_AVOID_COUNT = 2
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const BASE_PITCHES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}
const ROOT_NOTE_RE = /^([A-G])((?:##|bb|x|#|b)?)(-?\d+)$/

function clampMidi(midi: number): number {
  return Math.max(0, Math.min(127, Math.round(midi)))
}

function trimNumericString(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  if (Math.abs(rounded - Math.round(rounded)) <= DURATION_EPSILON) {
    return String(Math.round(rounded))
  }
  return rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function parseBeatValue(text: string): number | null {
  const numeric = Number(String(text ?? '').trim())
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return numeric
}

function getMeasureQuarterBeats(timeSignature: TimeSignature): number {
  const beats = Number.isFinite(timeSignature.beats) ? Math.max(1, Math.round(timeSignature.beats)) : 4
  const beatType = Number.isFinite(timeSignature.beatType) ? Math.max(1, Math.round(timeSignature.beatType)) : 4
  return beats * (4 / beatType)
}

function parsePitchName(name: string): { step: string; alter: number; octave: number } | null {
  const match = ROOT_NOTE_RE.exec(String(name ?? '').trim())
  if (!match) return null
  const step = match[1]?.toUpperCase() ?? 'C'
  const accidental = match[2] ?? ''
  const octave = Number(match[3])
  if (!Number.isFinite(octave)) return null
  const normalizedAccidental = accidental === 'x' ? '##' : accidental
  const alter = (normalizedAccidental.match(/#/g)?.length ?? 0) - (normalizedAccidental.match(/b/g)?.length ?? 0)
  return {
    step,
    alter,
    octave: Math.trunc(octave),
  }
}

function noteNameToMidi(name: string): number | null {
  const parsed = parsePitchName(name)
  if (!parsed) return null
  const semitone = BASE_PITCHES[parsed.step]
  if (semitone === undefined) return null
  return clampMidi((parsed.octave + 1) * 12 + semitone + parsed.alter)
}

function midiToNoteNameWithPreference(midi: number, prefer: 'sharp' | 'flat' | null): string {
  const safeMidi = clampMidi(midi)
  const octave = Math.floor(safeMidi / 12) - 1
  const pitchClass = safeMidi % 12
  const table =
    prefer === 'sharp'
      ? NOTE_NAMES_SHARP
      : prefer === 'flat'
        ? NOTE_NAMES_FLAT
        : NOTE_NAMES
  return `${table[pitchClass] ?? 'C'}${octave}`
}

function noteNameToPitch(name: string): Pitch {
  const parsed = parsePitchName(name)
  if (!parsed) return 'c/3'
  return toPitchFromStepAlter(parsed.step, parsed.alter, parsed.octave)
}

function splitPatternTokens(pattern: string): string[] {
  return String(pattern ?? '')
    .replaceAll('_', ',')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function parseRhythmDurations(rhythm: string): number[] {
  return String(rhythm ?? '')
    .split(',')
    .map((entry) => parseBeatValue(entry))
    .filter((value): value is number => value !== null)
}

function parseRhythmTemplatePattern(patternData: string): ParsedRhythmTemplatePattern {
  const result: ParsedRhythmTemplatePattern = {}
  const lines = String(patternData ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  lines.forEach((line) => {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) return
    const voiceId = line.slice(0, separatorIndex).trim()
    const measureText = line.slice(separatorIndex + 1)
    if (!voiceId) return
    result[voiceId] = measureText.split('|').map((measureEntry) =>
      measureEntry
        .split(',')
        .map((value) => parseBeatValue(value))
        .filter((value): value is number => value !== null),
    )
  })

  return result
}

export function parseTimelineSegmentScopeKey(scopeKey: string): TimelineSegmentScope | null {
  const [rawStart, rawEnd] = String(scopeKey ?? '').split(':')
  const startPairIndex = Number(rawStart)
  const endPairIndexInclusive = Number(rawEnd)
  if (!Number.isFinite(startPairIndex) || !Number.isFinite(endPairIndexInclusive)) {
    return null
  }
  const normalizedStart = Math.max(0, Math.trunc(startPairIndex))
  const normalizedEnd = Math.max(normalizedStart, Math.trunc(endPairIndexInclusive))
  return {
    startPairIndex: normalizedStart,
    endPairIndexInclusive: normalizedEnd,
  }
}

function buildSegmentChordEvents(params: {
  scope: TimelineSegmentScope
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  measureTimeSignaturesByMeasure: TimeSignature[] | null
}): SegmentChordEvent[] {
  const { scope, chordRulerEntriesByPair, measureTimeSignaturesByMeasure } = params
  if (!chordRulerEntriesByPair) return []

  const events: SegmentChordEvent[] = []
  let segmentBeatCursor = 0

  for (let pairIndex = scope.startPairIndex; pairIndex <= scope.endPairIndexInclusive; pairIndex += 1) {
    const timeSignature = resolvePairTimeSignature(pairIndex, measureTimeSignaturesByMeasure)
    const entries = [...(chordRulerEntriesByPair[pairIndex] ?? [])]
      .filter((entry) => entry.endTick > entry.startTick && entry.label && entry.label !== 'Rest')
      .sort((left, right) => left.startTick - right.startTick || left.endTick - right.endTick)

    entries.forEach((entry) => {
      const durationBeats = (entry.endTick - entry.startTick) / TICKS_PER_BEAT
      if (!Number.isFinite(durationBeats) || durationBeats <= 0) return
      events.push({
        pairIndex,
        relativePairIndex: pairIndex - scope.startPairIndex,
        measureNumber: pairIndex + 1,
        chordName: entry.label,
        startTick: Math.max(0, Math.round(entry.startTick)),
        endTick: Math.max(0, Math.round(entry.endTick)),
        startBeatInMeasure: entry.startTick / TICKS_PER_BEAT,
        startBeatInSegment: segmentBeatCursor + entry.startTick / TICKS_PER_BEAT,
        durationBeats,
      })
    })

    segmentBeatCursor += getMeasureQuarterBeats(timeSignature)
  }

  return events
}

export function buildSegmentDurationCombo(params: {
  scope: TimelineSegmentScope
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  measureTimeSignaturesByMeasure: TimeSignature[] | null
}): string | null {
  const events = buildSegmentChordEvents(params)
  if (events.length === 0) return null
  return events.map((event) => trimNumericString(event.durationBeats)).join('_')
}

function getRhythmVoiceId(durationBeats: number): string {
  if (Math.abs(durationBeats - 4) <= DURATION_EPSILON) return 'P1'
  if (Math.abs(durationBeats - 2) <= DURATION_EPSILON) return 'P2'
  if (Math.abs(durationBeats - 1) <= DURATION_EPSILON) return 'P3'
  if (Math.abs(durationBeats - 0.5) <= DURATION_EPSILON) return 'P4'
  return 'P1'
}

function getSpellingPreference(noteName: string): 'sharp' | 'flat' | null {
  if (noteName.includes('b') && !noteName.includes('#')) return 'flat'
  if (noteName.includes('#') && !noteName.includes('b')) return 'sharp'
  return null
}

export function normalizeChordForSearch(symbol: string): string {
  const raw = String(symbol ?? '').trim()
  if (!raw) return 'C'
  const match = /^([A-G][#b]?)([A-Za-z0-9ø°#b\-]+)?(?:\/(.*))?$/.exec(raw)
  if (!match) return 'C'

  const root = match[1] ?? 'C'
  const suffix = match[2] ?? ''
  const bassRaw = match[3] ?? ''
  const suffixLower = suffix.toLowerCase()
  const mapping: Record<string, string> = {
    m: '',
    m6: '6',
    add9: 'add9',
    sus2: 'sus2',
    sus4: 'sus4',
    madd9: 'add9',
    '9': 'Maj9',
    m9: 'Maj9',
    '11': 'Maj11',
    m11: 'Maj11',
    '13': 'Maj13',
    m13: 'Maj13',
    maj: 'Maj',
    maj9: 'Maj9',
    maj11: 'Maj11',
    maj13: 'Maj13',
  }

  const baseFamily = suffixLower.includes('7')
    ? 'CMaj7'
    : (() => {
        const mapped = mapping[suffixLower] ?? ''
        return mapped ? `C${mapped}` : 'C'
      })()

  const bassMatch = /^([A-G][#b]?)/.exec(bassRaw.trim())
  if (!bassMatch) return baseFamily

  const bass = bassMatch[1]
  const rootPc = noteNameToMidi(`${root}4`)
  const bassPc = noteNameToMidi(`${bass}4`)
  if (rootPc === null || bassPc === null) return baseFamily

  const interval = ((bassPc - rootPc) % 12 + 12) % 12
  const degreeMap: Record<number, number> = {
    3: 3,
    4: 3,
    7: 5,
    10: 7,
    11: 7,
    2: 9,
  }
  const degree = degreeMap[interval]
  if (!degree) return baseFamily

  const bassMap: Record<number, string> = {
    3: 'E',
    5: 'G',
    7: 'B',
    9: 'D',
  }
  const targetBass = bassMap[degree]
  if (!targetBass) return baseFamily

  const family =
    degree === 7
      ? 'CMaj7'
      : degree === 9 && !suffixLower.includes('7') && !suffixLower.includes('9')
        ? 'Cadd9'
        : suffixLower.includes('add9')
          ? 'Cadd9'
          : baseFamily

  return `${family}/${targetBass}`
}

async function buildRhythmTemplateDetails(params: {
  scope: TimelineSegmentScope
  patternData: string
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  measureTimeSignaturesByMeasure: TimeSignature[] | null
}): Promise<ExpandedRhythmTemplateDetail[]> {
  const { scope, patternData, chordRulerEntriesByPair, measureTimeSignaturesByMeasure } = params
  const chordEvents = buildSegmentChordEvents({
    scope,
    chordRulerEntriesByPair,
    measureTimeSignaturesByMeasure,
  })
  if (chordEvents.length === 0) return []

  const parsedPattern = parseRhythmTemplatePattern(patternData)
  const voiceCursorByMeasureKey = new Map<string, number>()

  return Promise.all(chordEvents.map(async (event) => {
    const voiceId = getRhythmVoiceId(event.durationBeats)
    const measurePatterns = parsedPattern[voiceId] ?? []
    const measureDurations = measurePatterns[event.relativePairIndex] ?? []
    const cursorKey = `${voiceId}|${event.relativePairIndex}`
    let cursor = voiceCursorByMeasureKey.get(cursorKey) ?? 0
    const selectedDurations: number[] = []
    let accumulatedDuration = 0

    while (
      cursor < measureDurations.length &&
      accumulatedDuration + measureDurations[cursor] <= event.durationBeats + DURATION_EPSILON
    ) {
      const nextDuration = measureDurations[cursor]
      selectedDurations.push(nextDuration)
      accumulatedDuration += nextDuration
      cursor += 1
    }

    if (selectedDurations.length === 0) {
      selectedDurations.push(event.durationBeats)
    } else {
      voiceCursorByMeasureKey.set(cursorKey, cursor)
    }

    const sourceChordFamily = normalizeChordForSearch(event.chordName)
    const defaultNotes =
      selectedDurations.length > 0
        ? await fetchNotesFromRhythmLibrary({
            chordFamily: sourceChordFamily,
            noteCount: selectedDurations.length,
            direction: null,
            structure: STRUCTURE_SINGLE,
          })
        : null

    return {
      notes: defaultNotes ?? '',
      rhythm: selectedDurations.map((duration) => trimNumericString(duration)).join(','),
      pitchRange: DEFAULT_PITCH_RANGE,
      structureType: DEFAULT_STRUCTURE_TYPE,
      octaveMode: DEFAULT_OCTAVE_MODE,
      spanRows: 1,
      spanPos: 0,
      groupDuration: event.durationBeats,
      melodyNotes: '',
      melodyRhythm: '',
      pairIndex: event.pairIndex,
      chordName: event.chordName,
      startBeatInMeasure: event.startBeatInMeasure,
      startBeatInSegment: event.startBeatInSegment,
      sourceChordFamily,
    }
  }))
}

function isOctavePattern(tokens: string[]): boolean {
  if (tokens.length === 0) return false
  const firstToken = tokens[0]
  if (!firstToken || !firstToken.includes('+')) return false
  const parts = firstToken.split('+').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  if (parts.length < 2) return false
  const midis = parts
    .map((part) => noteNameToMidi(part))
    .filter((midi): midi is number => midi !== null)
    .sort((left, right) => left - right)
  if (midis.length < 2) return false
  const pitchClasses = new Set(midis.map((midi) => midi % 12))
  return pitchClasses.size === 1 && midis[midis.length - 1] - midis[0] >= 12
}

function applyOctaveToPattern(pattern: string, mode: 'follow' | 'force' | 'none'): string {
  if (mode === 'follow') return pattern
  const tokens = splitPatternTokens(pattern)
  if (tokens.length === 0) return pattern
  const firstToken = tokens[0]

  if (mode === 'force' && !isOctavePattern(tokens)) {
    const parts = firstToken.split('+').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    const midis = parts
      .map((part) => noteNameToMidi(part))
      .filter((midi): midi is number => midi !== null)
    if (midis.length > 0) {
      const lowerNote = midiToNoteNameWithPreference(Math.min(...midis) - 12, null)
      tokens[0] = `${lowerNote}+${firstToken}`
    }
  }

  if (mode === 'none' && isOctavePattern(tokens)) {
    const parts = firstToken.split('+').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    const parsed = parts
      .map((part) => ({ part, midi: noteNameToMidi(part) }))
      .filter((entry): entry is { part: string; midi: number } => entry.midi !== null)
      .sort((left, right) => left.midi - right.midi)
    if (parsed.length >= 2) {
      tokens[0] = parsed.slice(1).map((entry) => entry.part).join('+')
    }
  }

  return tokens.join(',')
}

function detectStructure(tokens: string[]): string {
  if (tokens.length === 0) return STRUCTURE_SINGLE
  if (isOctavePattern(tokens)) return STRUCTURE_SINGLE
  return tokens.every((token) => !token.includes('+')) ? STRUCTURE_SINGLE : '和弦'
}

function detectDirection(tokens: string[]): string {
  if (tokens.length < 2) return '上上上上'
  const pivots = tokens
    .map((token) =>
      token
        .split('+')
        .map((part) => noteNameToMidi(part.trim()))
        .filter((midi): midi is number => midi !== null),
    )
    .filter((midis) => midis.length > 0)
    .map((midis) => Math.min(...midis))

  if (pivots.length < 2) return '上上上上'
  const ascending = pivots.every((value, index) => index === 0 || pivots[index - 1] < value)
  const descending = pivots.every((value, index) => index === 0 || pivots[index - 1] > value)
  if (ascending) return '上上上上'
  if (descending) return '下下下下'
  return '混合'
}

type ChordSpec = {
  root: string
  quality: 'maj' | 'min' | 'dom' | 'dim' | 'halfdim' | 'aug' | 'sus2' | 'sus4'
  raw: string
}

function parseChordSpec(chordName: string): ChordSpec {
  const raw = String(chordName ?? '').trim()
  const match = /^([A-G][#b]?)([^/]*)?(?:\/.*)?$/.exec(raw)
  const root = match?.[1] ?? 'C'
  const suffix = (match?.[2] ?? '').toLowerCase()

  if (suffix.includes('m7b5') || suffix.includes('ø')) {
    return { root, quality: 'halfdim', raw }
  }
  if (suffix.includes('dim') || suffix.includes('°') || suffix.includes('o')) {
    return { root, quality: 'dim', raw }
  }
  if (suffix.includes('aug') || suffix.includes('+')) {
    return { root, quality: 'aug', raw }
  }
  if (suffix.includes('sus2')) {
    return { root, quality: 'sus2', raw }
  }
  if (suffix.includes('sus4') || suffix.includes('sus')) {
    return { root, quality: 'sus4', raw }
  }
  if (suffix.includes('maj')) {
    return { root, quality: 'maj', raw }
  }
  if (suffix.includes('m') && !suffix.includes('maj')) {
    return { root, quality: 'min', raw }
  }
  if (suffix.includes('7')) {
    return { root, quality: 'dom', raw }
  }
  return { root, quality: 'maj', raw }
}

function getDegreeInterval(quality: ChordSpec['quality'], degree: number): number {
  if (degree === 1) return 0
  if (degree === 2) return 2
  if (degree === 3) {
    return quality === 'min' || quality === 'dim' || quality === 'halfdim' ? 3 : 4
  }
  if (degree === 4) return 5
  if (degree === 5) {
    if (quality === 'dim' || quality === 'halfdim') return 6
    if (quality === 'aug') return 8
    return 7
  }
  if (degree === 6) {
    return quality === 'min' || quality === 'dim' || quality === 'halfdim' ? 8 : 9
  }
  if (degree === 7) {
    if (quality === 'maj') return 11
    if (quality === 'dim') return 9
    return 10
  }
  return 0
}

function parseDegreeToken(token: string): { accidentalOffset: number; degreeIndex: number; octaveShift: number } | null {
  const match = /^([#b]*)(\d+)$/.exec(String(token ?? '').trim())
  if (!match) return null
  const accidentalOffset = (match[1].match(/#/g)?.length ?? 0) - (match[1].match(/b/g)?.length ?? 0)
  const degreeValue = Number(match[2])
  if (!Number.isFinite(degreeValue) || degreeValue <= 0) return null
  return {
    accidentalOffset,
    degreeIndex: ((degreeValue - 1) % 7) + 1,
    octaveShift: Math.floor((degreeValue - 1) / 7),
  }
}

function buildNoteFromDegree(params: {
  token: string
  targetChord: string
  baseOctave?: number
}): string {
  const { token, targetChord, baseOctave = 4 } = params
  const parsed = parseDegreeToken(token)
  if (!parsed) return token
  const spec = parseChordSpec(targetChord)
  const rootMidi = noteNameToMidi(`${spec.root}${baseOctave}`) ?? 60
  const interval =
    getDegreeInterval(spec.quality, parsed.degreeIndex) +
    parsed.accidentalOffset +
    parsed.octaveShift * 12
  return midiToNoteNameWithPreference(rootMidi + interval, getSpellingPreference(spec.root))
}

function transposeAbsoluteGroup(params: {
  token: string
  sourceChord: string
  targetChord: string
}): string {
  const { token, sourceChord, targetChord } = params
  const sourceSpec = parseChordSpec(sourceChord)
  const targetSpec = parseChordSpec(targetChord)
  const sourceRootMidi = noteNameToMidi(`${sourceSpec.root}4`) ?? 60
  const targetRootMidi = noteNameToMidi(`${targetSpec.root}4`) ?? 60
  const targetPrefer = getSpellingPreference(targetSpec.root)

  return token
    .split('+')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((noteName) => {
      const midi = noteNameToMidi(noteName)
      if (midi === null) return noteName
      const interval = midi - sourceRootMidi
      return midiToNoteNameWithPreference(targetRootMidi + interval, targetPrefer)
    })
    .join('+')
}

function transposeNotesPattern(params: {
  pattern: string
  targetChord: string
  sourceChordFamily: string | null
}): string {
  const { pattern, targetChord, sourceChordFamily } = params
  if (!pattern) return pattern
  const separator = pattern.includes('_') && !pattern.includes(',') ? '_' : ','
  const tokens = pattern.split(separator).map((entry) => entry.trim()).filter((entry) => entry.length > 0)

  const mapped = tokens.map((token) => {
    const parts = token.split('+').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    if (parts.length === 0) return token
    const isAbsolute = parts.every((part) => ROOT_NOTE_RE.test(part))
    if (isAbsolute && sourceChordFamily) {
      return transposeAbsoluteGroup({
        token,
        sourceChord: sourceChordFamily,
        targetChord,
      })
    }
    return parts
      .map((part) => {
        if (String(part).toUpperCase() === 'R') return part
        return parseDegreeToken(part) ? buildNoteFromDegree({ token: part, targetChord }) : part
      })
      .join('+')
  })

  return mapped.join(separator)
}

function parsePitchRange(rangeText: string): { minMidi: number; maxMidi: number } {
  const [rawMin = '', rawMax = ''] = String(rangeText ?? '').split('-', 2)
  const minMidi = noteNameToMidi(rawMin.trim()) ?? 35
  const maxMidi = noteNameToMidi(rawMax.trim()) ?? 67
  return {
    minMidi: Math.min(minMidi, maxMidi),
    maxMidi: Math.max(minMidi, maxMidi),
  }
}

function clampMidiIntoRange(midi: number, minMidi: number, maxMidi: number): number {
  let nextMidi = midi
  while (nextMidi < minMidi) nextMidi += 12
  while (nextMidi > maxMidi) nextMidi -= 12
  while (nextMidi < minMidi) nextMidi += 12
  return clampMidi(nextMidi)
}

function buildMelodyStartBeats(params: {
  measurePairs: MeasurePair[]
  scope: TimelineSegmentScope
  measureTimeSignaturesByMeasure: TimeSignature[] | null
}): number[] {
  const { measurePairs, scope, measureTimeSignaturesByMeasure } = params
  const starts: number[] = []
  let segmentBeatCursor = 0

  for (let pairIndex = scope.startPairIndex; pairIndex <= scope.endPairIndexInclusive; pairIndex += 1) {
    const pair = measurePairs[pairIndex]
    const trebleNotes = pair?.treble ?? []
    let onsetTicks = 0
    trebleNotes.forEach((note) => {
      if (!note.isRest) {
        starts.push(segmentBeatCursor + onsetTicks / TICKS_PER_BEAT)
      }
      onsetTicks += DURATION_TICKS[note.duration] ?? 0
    })
    segmentBeatCursor += getMeasureQuarterBeats(resolvePairTimeSignature(pairIndex, measureTimeSignaturesByMeasure))
  }

  return starts
}

function buildGeneratedBassEvents(params: {
  details: ExpandedRhythmTemplateDetail[]
  melodyStartBeats: number[]
}): Promise<GeneratedBassEvent[]> {
  const { details, melodyStartBeats } = params

  return Promise.all(details.flatMap(async (detail) => {
    const rhythmDurations = parseRhythmDurations(detail.rhythm)
    if (rhythmDurations.length === 0) return []

    let avoidCount = 0
    const rhythmEvents = rhythmDurations.map((duration, index) => {
      const startBeat = detail.startBeatInSegment + rhythmDurations.slice(0, index).reduce((sum, value) => sum + value, 0)
      let isRest = false
      if (index > 0) {
        const hasConflict = melodyStartBeats.some((melodyStart) =>
          Math.abs(melodyStart - startBeat) < MELODY_CONFLICT_THRESHOLD,
        )
        if (hasConflict && avoidCount < DEFAULT_MAX_AVOID_COUNT) {
          avoidCount += 1
          isRest = true
        }
      }
      return {
        duration,
        startBeat,
        isRest,
      }
    })

    const playableRhythmEvents = rhythmEvents.filter((event) => !event.isRest)
    const octaveModeText = String(detail.octaveMode ?? '')
    const octaveMode =
      octaveModeText.includes('强制八度')
        ? 'force'
        : octaveModeText.includes('无八度') && !octaveModeText.includes('跟随')
          ? 'none'
          : 'follow'

    let noteTokens = splitPatternTokens(detail.notes)
    if (octaveMode !== 'follow' && noteTokens.length > 0) {
      noteTokens = splitPatternTokens(applyOctaveToPattern(noteTokens.join(','), octaveMode))
    }

    const detectedStructure = detectStructure(noteTokens)
    const targetStructure =
      detail.structureType === STRUCTURE_SINGLE || detail.structureType === '和弦'
        ? detail.structureType
        : detectedStructure
    void detectDirection(noteTokens)

    if (noteTokens.length === 0 && playableRhythmEvents.length > 0) {
      const fetched = await fetchNotesFromRhythmLibrary({
        chordFamily: detail.sourceChordFamily,
        noteCount: playableRhythmEvents.length,
        direction: null,
        structure: targetStructure,
      })
      noteTokens = splitPatternTokens(fetched ?? '')
    }

    if (noteTokens.length === 1 && rhythmEvents.length > 1) {
      noteTokens = new Array(rhythmEvents.length).fill(noteTokens[0])
    } else if (noteTokens.length > 1 && noteTokens.length !== rhythmEvents.length) {
      const repeated: string[] = []
      while (repeated.length < rhythmEvents.length) {
        repeated.push(...noteTokens)
      }
      noteTokens = repeated.slice(0, rhythmEvents.length)
    }

    rhythmEvents.forEach((event, index) => {
      const token = noteTokens[index]?.trim() ?? ''
      if (token.toUpperCase() === 'R') {
        event.isRest = true
      }
    })

    const noteRange = parsePitchRange(detail.pitchRange)
    const playableTokens = rhythmEvents.reduce<string[]>((tokens, event, index) => {
      const token = noteTokens[index]?.trim() ?? ''
      if (!event.isRest) {
        tokens.push(token)
      }
      return tokens
    }, [])

    let playableTokenIndex = 0

    return rhythmEvents.map<GeneratedBassEvent>((event) => {
      const durationTicks = Math.max(1, Math.round(event.duration * TICKS_PER_BEAT))
      const measureStartBeat = event.startBeat - detail.startBeatInSegment + detail.startBeatInMeasure
      if (event.isRest) {
        return {
          pairIndex: detail.pairIndex,
          startTick: Math.max(0, Math.round(measureStartBeat * TICKS_PER_BEAT)),
          durationTicks,
          pitchNames: [],
          isRest: true,
        }
      }

      const token = playableTokens[playableTokenIndex]?.trim() ?? ''
      playableTokenIndex += 1
      const transposed = transposeNotesPattern({
        pattern: token,
        targetChord: detail.chordName,
        sourceChordFamily: detail.sourceChordFamily,
      })
      const rawPitchNames = transposed
        .split('+')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && entry.toUpperCase() !== 'R')

      const pitchNames = [...new Set(
        rawPitchNames
          .map((noteName) => {
            const midi = noteNameToMidi(noteName)
            if (midi === null) return null
            const clampedMidi = clampMidiIntoRange(midi, noteRange.minMidi, noteRange.maxMidi)
            return midiToNoteNameWithPreference(clampedMidi, getSpellingPreference(detail.chordName))
          })
          .filter((noteName): noteName is string => noteName !== null),
      )].sort((left, right) => (noteNameToMidi(left) ?? 0) - (noteNameToMidi(right) ?? 0))

      return {
        pairIndex: detail.pairIndex,
        startTick: Math.max(0, Math.round(measureStartBeat * TICKS_PER_BEAT)),
        durationTicks,
        pitchNames,
        isRest: pitchNames.length === 0,
      }
    })
  }))
    .then((chunks) => chunks.flat())
}

function buildEventNotes(params: {
  event: GeneratedBassEvent
}): ScoreNote[] {
  const { event } = params
  const durations = splitTicksToDurations(event.durationTicks)
  if (durations.length === 0) return []

  if (event.isRest || event.pitchNames.length === 0) {
    return durations.map((duration) => ({
      id: createImportedNoteId('bass'),
      pitch: 'd/3',
      duration,
      isRest: true,
    }))
  }

  const [rootNoteName, ...chordNoteNames] = event.pitchNames
  const rootPitch = noteNameToPitch(rootNoteName)
  const chordPitches = chordNoteNames.map((noteName) => noteNameToPitch(noteName))

  return durations.map((duration, durationIndex) => ({
    id: createImportedNoteId('bass'),
    pitch: rootPitch,
    duration,
    chordPitches: chordPitches.length > 0 ? chordPitches : undefined,
    tieStart: durationIndex < durations.length - 1 ? true : undefined,
    tieStop: durationIndex > 0 ? true : undefined,
    chordTieStarts:
      chordPitches.length > 0 && durationIndex < durations.length - 1
        ? new Array(chordPitches.length).fill(true)
        : undefined,
    chordTieStops:
      chordPitches.length > 0 && durationIndex > 0
        ? new Array(chordPitches.length).fill(true)
        : undefined,
  }))
}

function clearBassTieFields(note: ScoreNote): ScoreNote {
  return {
    ...note,
    tieStart: undefined,
    tieStop: undefined,
    chordTieStarts: undefined,
    chordTieStops: undefined,
    tieFrozenIncomingPitch: undefined,
    tieFrozenIncomingFromNoteId: undefined,
    tieFrozenIncomingFromKeyIndex: undefined,
    chordTieFrozenIncomingPitches: undefined,
    chordTieFrozenIncomingFromNoteIds: undefined,
    chordTieFrozenIncomingFromKeyIndices: undefined,
  }
}

function replaceBassSegmentInPairs(params: {
  measurePairs: MeasurePair[]
  scope: TimelineSegmentScope
  generatedEvents: GeneratedBassEvent[]
  measureTimeSignaturesByMeasure: TimeSignature[] | null
  measureKeyFifthsByMeasure: number[] | null
}): {
  nextPairs: MeasurePair[]
  collapseScopesToAdd: Array<{ pairIndex: number; staff: 'bass' }>
} {
  const {
    measurePairs,
    scope,
    generatedEvents,
    measureTimeSignaturesByMeasure,
    measureKeyFifthsByMeasure,
  } = params

  const eventsByPair = new Map<number, GeneratedBassEvent[]>()
  generatedEvents.forEach((event) => {
    const existing = eventsByPair.get(event.pairIndex)
    if (existing) {
      existing.push(event)
    } else {
      eventsByPair.set(event.pairIndex, [event])
    }
  })

  let nextPairs = measurePairs.slice()

  for (let pairIndex = scope.startPairIndex; pairIndex <= scope.endPairIndexInclusive; pairIndex += 1) {
    const pair = nextPairs[pairIndex]
    if (!pair) continue
    const timeSignature = resolvePairTimeSignature(pairIndex, measureTimeSignaturesByMeasure)
    const measureTicks = Math.max(1, Math.round(getMeasureQuarterBeats(timeSignature) * TICKS_PER_BEAT))
    const pairEvents = [...(eventsByPair.get(pairIndex) ?? [])]
      .sort((left, right) => left.startTick - right.startTick || left.durationTicks - right.durationTicks)

    const nextBassNotes: ScoreNote[] = []
    let cursorTick = 0

    pairEvents.forEach((event) => {
      const clampedStartTick = Math.max(cursorTick, Math.min(measureTicks, event.startTick))
      if (clampedStartTick > cursorTick) {
        nextBassNotes.push(...buildEventNotes({
          event: {
            pairIndex,
            startTick: cursorTick,
            durationTicks: clampedStartTick - cursorTick,
            pitchNames: [],
            isRest: true,
          },
        }))
      }

      const safeDurationTicks = Math.max(1, Math.min(event.durationTicks, measureTicks - clampedStartTick))
      nextBassNotes.push(...buildEventNotes({
        event: {
          ...event,
          startTick: clampedStartTick,
          durationTicks: safeDurationTicks,
        },
      }))
      cursorTick = clampedStartTick + safeDurationTicks
    })

    if (cursorTick < measureTicks) {
      nextBassNotes.push(...buildEventNotes({
        event: {
          pairIndex,
          startTick: cursorTick,
          durationTicks: measureTicks - cursorTick,
          pitchNames: [],
          isRest: true,
        },
      }))
    }

    const replacementBass =
      nextBassNotes.length > 0
        ? nextBassNotes.map(clearBassTieFields)
        : (buildMeasureRestNotes({
            staff: 'bass',
            timeSignature,
            importedMode: true,
          }) ?? [])

    nextPairs[pairIndex] = {
      treble: pair.treble,
      bass: replacementBass,
    }
  }

  if (scope.startPairIndex > 0) {
    const previousPair = nextPairs[scope.startPairIndex - 1]
    if (previousPair) {
      nextPairs[scope.startPairIndex - 1] = {
        treble: previousPair.treble,
        bass: previousPair.bass.map((note) => ({
          ...note,
          tieStart: undefined,
          chordTieStarts: undefined,
        })),
      }
    }
  }

  if (scope.endPairIndexInclusive + 1 < nextPairs.length) {
    const nextBoundaryPair = nextPairs[scope.endPairIndexInclusive + 1]
    if (nextBoundaryPair) {
      nextPairs[scope.endPairIndexInclusive + 1] = {
        treble: nextBoundaryPair.treble,
        bass: nextBoundaryPair.bass.map((note) => ({
          ...note,
          tieStop: undefined,
          chordTieStops: undefined,
          tieFrozenIncomingPitch: undefined,
          tieFrozenIncomingFromNoteId: undefined,
          tieFrozenIncomingFromKeyIndex: undefined,
          chordTieFrozenIncomingPitches: undefined,
          chordTieFrozenIncomingFromNoteIds: undefined,
          chordTieFrozenIncomingFromKeyIndices: undefined,
        })),
      }
    }
  }

  const normalizeStart = Math.max(0, scope.startPairIndex - 1)
  const normalizeEnd = Math.min(nextPairs.length - 1, scope.endPairIndexInclusive + 1)
  for (let pairIndex = normalizeStart; pairIndex <= normalizeEnd; pairIndex += 1) {
    nextPairs = normalizeMeasurePairAt(nextPairs, pairIndex, measureKeyFifthsByMeasure)
  }

  const collapseScopesToAdd: Array<{ pairIndex: number; staff: 'bass' }> = []
  for (let pairIndex = scope.startPairIndex; pairIndex <= scope.endPairIndexInclusive; pairIndex += 1) {
    const pair = nextPairs[pairIndex]
    if (!pair) continue
    if (isStaffFullMeasureRest(pair.bass, resolvePairTimeSignature(pairIndex, measureTimeSignaturesByMeasure))) {
      collapseScopesToAdd.push({ pairIndex, staff: 'bass' })
    }
  }

  return {
    nextPairs,
    collapseScopesToAdd,
  }
}

export async function buildSegmentRhythmTemplateApplication(params: {
  measurePairs: MeasurePair[]
  scope: TimelineSegmentScope
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  measureTimeSignaturesByMeasure: TimeSignature[] | null
  measureKeyFifthsByMeasure: number[] | null
  patternData: string
}): Promise<{
  durationCombo: string
  templDetails: SegmentRhythmTemplateDetail[]
  nextPairs: MeasurePair[]
  collapseScopesToAdd: Array<{ pairIndex: number; staff: 'bass' }>
}> {
  const {
    measurePairs,
    scope,
    chordRulerEntriesByPair,
    measureTimeSignaturesByMeasure,
    measureKeyFifthsByMeasure,
    patternData,
  } = params

  const durationCombo = buildSegmentDurationCombo({
    scope,
    chordRulerEntriesByPair,
    measureTimeSignaturesByMeasure,
  })
  if (!durationCombo) {
    throw new Error('当前段落没有可用和弦时值序列。')
  }

  const templDetails = await buildRhythmTemplateDetails({
    scope,
    patternData,
    chordRulerEntriesByPair,
    measureTimeSignaturesByMeasure,
  })
  if (templDetails.length === 0) {
    throw new Error('所选律动模板无法映射到当前段落的和弦序列。')
  }

  const melodyStartBeats = buildMelodyStartBeats({
    measurePairs,
    scope,
    measureTimeSignaturesByMeasure,
  })
  const generatedEvents = await buildGeneratedBassEvents({
    details: templDetails,
    melodyStartBeats,
  })
  const replaced = replaceBassSegmentInPairs({
    measurePairs,
    scope,
    generatedEvents,
    measureTimeSignaturesByMeasure,
    measureKeyFifthsByMeasure,
  })

  return {
    durationCombo,
    templDetails: templDetails.map((detail) => ({
      notes: detail.notes,
      rhythm: detail.rhythm,
      pitchRange: detail.pitchRange,
      structureType: detail.structureType,
      octaveMode: detail.octaveMode,
      spanRows: detail.spanRows,
      spanPos: detail.spanPos,
      groupDuration: detail.groupDuration,
      melodyNotes: detail.melodyNotes,
      melodyRhythm: detail.melodyRhythm,
    })),
    nextPairs: replaced.nextPairs,
    collapseScopesToAdd: replaced.collapseScopesToAdd,
  }
}
