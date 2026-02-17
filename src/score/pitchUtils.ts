import { StaveNote } from 'vexflow'
import { CHROMATIC_STEPS, PIANO_MAX_MIDI, PIANO_MIN_MIDI } from './constants'
import type { Pitch, StaffKind, StemDirection } from './types'

const pitchLineCache = new Map<string, number>()

function midiToPitch(midi: number): Pitch {
  const note = CHROMATIC_STEPS[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${note}/${octave}`
}

export function createPianoPitches(): Pitch[] {
  const result: Pitch[] = []
  for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi += 1) {
    result.push(midiToPitch(midi))
  }
  return result
}

export function parsePitch(pitch: Pitch): { note: string; octave: number } {
  const [note, octaveText] = pitch.split('/')
  return { note, octave: Number(octaveText) }
}

export function formatPitchName(note: string): string {
  if (!note) return note
  return `${note[0].toUpperCase()}${note.slice(1)}`
}

export function toDisplayPitch(pitch: Pitch): string {
  const { note, octave } = parsePitch(pitch)
  return `${formatPitchName(note)}${octave}`
}

export function toTonePitch(pitch: Pitch): string {
  const { note, octave } = parsePitch(pitch)
  return `${formatPitchName(note)}${octave}`
}

export function getPitchLine(clef: StaffKind, pitch: Pitch): number {
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

export function buildPitchLineMap(clef: StaffKind, pitches: Pitch[]): Record<Pitch, number> {
  const map = {} as Record<Pitch, number>
  for (const pitch of pitches) {
    map[pitch] = getPitchLine(clef, pitch)
  }
  return map
}

export function getStrictStemDirection(pitch: Pitch): StemDirection {
  const line = getPitchLine('treble', pitch)
  return line < 3 ? 1 : -1
}

export function getNearestPitchByY(
  y: number,
  pitchYMap: Record<Pitch, number>,
  pitches: Pitch[],
  preferred?: Pitch,
): Pitch {
  let winner: Pitch = preferred ?? pitches[0]
  let winnerDistance = Math.abs(y - (pitchYMap[winner] ?? 0))

  for (const pitch of pitches) {
    const distance = Math.abs(y - pitchYMap[pitch])
    if (distance < winnerDistance) {
      winner = pitch
      winnerDistance = distance
    }
  }

  return winner
}
