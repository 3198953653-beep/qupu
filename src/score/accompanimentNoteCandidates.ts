import type { AccompanimentOptionRow } from './rhythmTemplateDb'
import { splitPatternTokens, transposeNotesPattern } from './segmentRhythmTemplateEngine'
import type { Pitch } from './types'

const ROOT_NOTE_RE = /^([A-G])((?:##|bb|x|#|b)?)(-?\d+)$/
const NOTE_NAME_TABLE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const BASE_PITCHES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

export type AccompanimentNoteCandidate = {
  key: string
  notes: string
  rawNotes: string
  sourceChordType: string
  chordType: string
  specialTags: string
  previewPitches: Pitch[]
}

function clampMidi(midi: number): number {
  return Math.max(0, Math.min(127, Math.round(midi)))
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

function midiToNoteName(midi: number): string {
  const safeMidi = clampMidi(midi)
  const octave = Math.floor(safeMidi / 12) - 1
  const pitchClass = safeMidi % 12
  return `${NOTE_NAME_TABLE[pitchClass] ?? 'C'}${octave}`
}

function midiToPitch(midi: number): Pitch {
  const safeMidi = clampMidi(midi)
  const octave = Math.floor(safeMidi / 12) - 1
  const pitchClass = safeMidi % 12
  const noteName = NOTE_NAME_TABLE[pitchClass] ?? 'C'
  const step = noteName[0]?.toLowerCase() ?? 'c'
  const accidental = noteName.slice(1).replace('#', '#').replace('b', 'b')
  return `${step}${accidental}/${octave}`
}

function rankChordType(chordType: string): number {
  const text = String(chordType ?? '').trim().toLowerCase()
  if (!text) return 99
  if (text.includes('add9')) return 0
  if (text.includes('9') && !text.includes('add9')) return 1
  if (text.includes('7')) return 2
  return 3
}

function toTokenMidis(token: string): number[] | null {
  const parts = token
    .split('+')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (parts.length === 0) return null
  const midis = parts
    .map((part) => noteNameToMidi(part))
    .filter((midi): midi is number => midi !== null)
  if (midis.length === 0) return null
  return midis
}

function toPreviewPitches(pattern: string): Pitch[] {
  const firstToken = splitPatternTokens(pattern)[0] ?? ''
  const midis = toTokenMidis(firstToken) ?? []
  const uniqueMidis = [...new Set(midis)].sort((left, right) => left - right)
  return uniqueMidis.map((midi) => midiToPitch(midi))
}

export function enumerateAccompanimentNoteCandidates(params: {
  options: AccompanimentOptionRow[]
  targetChordName: string
  lowerMidi: number
  upperMidi: number
  limit?: number
}): AccompanimentNoteCandidate[] {
  const {
    options,
    targetChordName,
    lowerMidi,
    upperMidi,
    limit = 20,
  } = params

  const safeLower = Math.max(0, Math.min(127, Math.round(lowerMidi)))
  const safeUpper = Math.max(safeLower, Math.min(127, Math.round(upperMidi)))
  const seen = new Set<string>()
  const ranked: Array<{
    rank: number
    gap: number
    shiftAbs: number
    candidate: AccompanimentNoteCandidate
  }> = []

  options.forEach((option) => {
    const sourcePattern = String(option.notes ?? '').trim()
    if (!sourcePattern) return

    const transposedPattern = transposeNotesPattern({
      pattern: sourcePattern,
      targetChord: targetChordName,
      sourceChordType: option.sourceChordType,
    })
    const tokens = splitPatternTokens(transposedPattern)
    if (tokens.length === 0) return

    const tokenMidis: number[][] = []
    const allMidis: number[] = []
    for (const token of tokens) {
      const midis = toTokenMidis(token)
      if (!midis || midis.length === 0) return
      tokenMidis.push(midis)
      allMidis.push(...midis)
    }
    if (allMidis.length === 0) return

    const lo = Math.min(...allMidis)
    const hi = Math.max(...allMidis)
    const kMin = Math.ceil((safeLower - lo) / 12)
    const kMax = Math.floor((safeUpper - hi) / 12)
    if (kMin > kMax) return

    const octaveShift = kMax
    let maxAfter = safeLower
    const shiftedTokens = tokenMidis.map((midis) => {
      const shifted = midis.map((midi) => midi + octaveShift * 12)
      maxAfter = Math.max(maxAfter, ...shifted)
      return shifted.map((midi) => midiToNoteName(midi)).join('+')
    })
    const outputPattern = shiftedTokens.join('_')
    if (!outputPattern || seen.has(outputPattern)) return
    seen.add(outputPattern)

    ranked.push({
      rank: rankChordType(option.chordType),
      gap: safeUpper - maxAfter,
      shiftAbs: Math.abs(octaveShift),
      candidate: {
        key: `${option.sourceChordType}|${outputPattern}`,
        notes: outputPattern,
        rawNotes: sourcePattern,
        sourceChordType: option.sourceChordType,
        chordType: option.chordType,
        specialTags: option.specialTags,
        previewPitches: toPreviewPitches(outputPattern),
      },
    })
  })

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank
    if (left.gap !== right.gap) return left.gap - right.gap
    return left.shiftAbs - right.shiftAbs
  })

  return ranked.slice(0, Math.max(1, limit)).map((entry) => entry.candidate)
}
