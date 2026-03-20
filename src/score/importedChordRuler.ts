import { formatChordRulerPositionText, getChordRulerBeatIndex, type ChordRulerEntry } from './chordRuler'
import type { TimeSignature } from './types'

const PITCH_CLASS_BY_STEP: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

const NOTE_NAMES_DEFAULT = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const CHORD_QUALITY_BY_INTERVALS = new Map<string, string>([
  ['0,4,7', ''],
  ['0,3,7', 'm'],
  ['0,3,6', 'mb5'],
  ['0,4,8', 'aug'],
  ['0,4,7,11', 'Maj7'],
  ['0,3,7,10', 'm7'],
  ['0,4,7,10', '7'],
  ['0,3,6,10', 'm7b5'],
  ['0,3,6,9', 'dim7'],
  ['0,2,4,7,11', 'Maj9'],
  ['0,2,4,7,10', '9'],
  ['0,2,3,7,10', 'm9'],
  ['0,2,4,7', 'add9'],
  ['0,2,3,7', 'madd9'],
])

export type ImportedChordPitch = {
  step: string
  alter: number
  octave: number
  midi: number
}

export type ImportedChordEvent = {
  startTick: number
  durationTicks: number
  notes: ImportedChordPitch[]
}

function toPitchClass(step: string, alter = 0): number {
  const base = PITCH_CLASS_BY_STEP[step.toUpperCase()] ?? 0
  return (base + alter + 120) % 12
}

function toSourceSpelledName(pitch: ImportedChordPitch): string {
  const accidental = pitch.alter > 0 ? '#'.repeat(pitch.alter) : 'b'.repeat(Math.abs(pitch.alter))
  return `${pitch.step.toUpperCase()}${accidental}`
}

function getPreferredNoteName(pitchClass: number, prefer: 'sharp' | 'flat' | null): string {
  const safePitchClass = ((pitchClass % 12) + 12) % 12
  if (prefer === 'sharp') return NOTE_NAMES_SHARP[safePitchClass] ?? NOTE_NAMES_DEFAULT[safePitchClass] ?? 'C'
  if (prefer === 'flat') return NOTE_NAMES_FLAT[safePitchClass] ?? NOTE_NAMES_DEFAULT[safePitchClass] ?? 'C'
  return NOTE_NAMES_DEFAULT[safePitchClass] ?? 'C'
}

export function identifyImportedChordLabel(notes: ImportedChordPitch[]): string {
  if (notes.length === 0) return 'Rest'

  const uniquePitchClasses = new Set<number>()
  const pitchClassToSourceName = new Map<number, string>()
  const sortedNotes = [...notes].sort((left, right) => left.midi - right.midi)
  const bassPitchClass = ((sortedNotes[0]?.midi ?? 0) % 12 + 12) % 12

  notes.forEach((note) => {
    const pitchClass = toPitchClass(note.step, note.alter)
    uniquePitchClasses.add(pitchClass)
    if (!pitchClassToSourceName.has(pitchClass)) {
      pitchClassToSourceName.set(pitchClass, toSourceSpelledName(note))
    }
  })

  const sourceNames = [...pitchClassToSourceName.values()]
  const hasSharp = sourceNames.some((name) => name.includes('#'))
  const hasFlat = sourceNames.some((name) => name.includes('b'))
  const prefer = hasSharp && !hasFlat ? 'sharp' : hasFlat && !hasSharp ? 'flat' : null
  const orderedPitchClasses = [...uniquePitchClasses].sort((left, right) => left - right)

  const matches: Array<{ inversionPenalty: number; name: string }> = []
  orderedPitchClasses.forEach((potentialRootPitchClass) => {
    const intervals = orderedPitchClasses
      .map((pitchClass) => (pitchClass - potentialRootPitchClass + 12) % 12)
      .sort((left, right) => left - right)
    const quality = CHORD_QUALITY_BY_INTERVALS.get(intervals.join(','))
    if (!quality) return

    const rootName =
      pitchClassToSourceName.get(potentialRootPitchClass) ?? getPreferredNoteName(potentialRootPitchClass, prefer)
    const bassName = pitchClassToSourceName.get(bassPitchClass) ?? getPreferredNoteName(bassPitchClass, prefer)
    const inversionPenalty = potentialRootPitchClass === bassPitchClass ? 0 : 1
    const chordName = inversionPenalty === 0 ? `${rootName}${quality}` : `${rootName}${quality}/${bassName}`
    matches.push({
      inversionPenalty,
      name: chordName,
    })
  })

  if (matches.length === 0) return 'Unknown'
  matches.sort((left, right) => left.inversionPenalty - right.inversionPenalty || left.name.localeCompare(right.name))
  return matches[0]?.name ?? 'Unknown'
}

export function buildImportedChordRulerEntries(params: {
  events: ImportedChordEvent[]
  timeSignature: TimeSignature
  measureTicks: number
}): ChordRulerEntry[] {
  const { events, timeSignature, measureTicks } = params
  const safeMeasureTicks = Math.max(1, Math.round(measureTicks))
  const sanitizedEvents = events
    .map((event) => ({
      startTick: Math.max(0, Math.min(safeMeasureTicks, Math.round(event.startTick))),
      durationTicks: Math.max(0, Math.round(event.durationTicks)),
      notes: event.notes,
    }))
    .sort((left, right) => left.startTick - right.startTick)

  return sanitizedEvents.reduce<ChordRulerEntry[]>((entries, event, eventIndex) => {
    const label = identifyImportedChordLabel(event.notes)
    if (label === 'Rest') return entries

    const nextStartTick = sanitizedEvents[eventIndex + 1]?.startTick ?? null
    const durationEndTick = event.startTick + Math.max(0, event.durationTicks)
    const endTick = Math.max(
      event.startTick,
      Math.min(
        safeMeasureTicks,
        nextStartTick === null ? durationEndTick : Math.min(durationEndTick, nextStartTick),
      ),
    )
    if (endTick <= event.startTick) return entries

    entries.push({
      label,
      startTick: event.startTick,
      endTick,
      positionText: formatChordRulerPositionText({
        startTick: event.startTick,
        timeSignature,
      }),
      beatIndex: getChordRulerBeatIndex({
        startTick: event.startTick,
        timeSignature,
      }),
    })
    return entries
  }, [])
}
