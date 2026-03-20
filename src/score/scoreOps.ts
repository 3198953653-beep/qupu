import {
  BASS_MOCK_PATTERN,
  DURATION_GREEDY_ORDER,
  DURATION_TICKS,
  INITIAL_NOTES,
  MEASURE_TICKS,
  TICKS_PER_BEAT,
} from './constants'
import type {
  ImportedNoteLocation,
  MeasurePair,
  NoteDuration,
  Pitch,
  ScoreNote,
  StaffKind,
} from './types'

let nextNoteSerial = 5

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function createNoteId(): string {
  const id = `n${nextNoteSerial}`
  nextNoteSerial += 1
  return id
}

export function createImportedNoteId(staff: StaffKind): string {
  return `${staff}-${createNoteId()}`
}

export function beatsToTicks(beats: number, maxTicks = MEASURE_TICKS): number {
  const ticks = Math.round(beats * TICKS_PER_BEAT)
  return clamp(ticks, 1, maxTicks)
}

export function splitTicksToDurations(ticks: number): NoteDuration[] {
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

export function buildNotesFromPattern(pattern: NoteDuration[], sourceNotes: ScoreNote[]): ScoreNote[] {
  const basePitches = sourceNotes.length > 0 ? sourceNotes.map((note) => note.pitch) : INITIAL_NOTES.map((note) => note.pitch)
  return pattern.map((duration, index) => ({
    id: createNoteId(),
    pitch: basePitches[index % basePitches.length],
    duration,
  }))
}

export function buildBassMockNotes(sourceNotes: ScoreNote[]): ScoreNote[] {
  return sourceNotes.map((note, index) => ({
    id: `bass-${index + 1}`,
    pitch: BASS_MOCK_PATTERN[index % BASS_MOCK_PATTERN.length],
    duration: note.duration,
  }))
}

export function buildWholeNoteDemoNotes(measureCount: number): {
  trebleNotes: ScoreNote[]
  bassNotes: ScoreNote[]
} {
  const safeMeasureCount = Number.isFinite(measureCount) ? Math.max(1, Math.round(measureCount)) : 1
  const trebleNotes: ScoreNote[] = []
  const bassNotes: ScoreNote[] = []

  for (let measureIndex = 0; measureIndex < safeMeasureCount; measureIndex += 1) {
    trebleNotes.push({
      id: `whole-demo-t-${measureIndex + 1}`,
      pitch: 'c/5',
      duration: 'w',
    })
    bassNotes.push({
      id: `whole-demo-b-${measureIndex + 1}`,
      pitch: 'c/3',
      duration: 'w',
    })
  }

  return {
    trebleNotes,
    bassNotes,
  }
}

export function buildHalfNoteDemoNotes(measureCount: number): {
  trebleNotes: ScoreNote[]
  bassNotes: ScoreNote[]
} {
  const safeMeasureCount = Number.isFinite(measureCount) ? Math.max(1, Math.round(measureCount)) : 1
  const trebleNotes: ScoreNote[] = []
  const bassNotes: ScoreNote[] = []

  for (let measureIndex = 0; measureIndex < safeMeasureCount; measureIndex += 1) {
    trebleNotes.push(
      {
        id: `half-demo-t-${measureIndex + 1}-1`,
        pitch: 'c/5',
        duration: 'h',
      },
      {
        id: `half-demo-t-${measureIndex + 1}-2`,
        pitch: 'c/5',
        duration: 'h',
      },
    )
    bassNotes.push(
      {
        id: `half-demo-b-${measureIndex + 1}-1`,
        pitch: 'c/3',
        duration: 'h',
      },
      {
        id: `half-demo-b-${measureIndex + 1}-2`,
        pitch: 'c/3',
        duration: 'h',
      },
    )
  }

  return {
    trebleNotes,
    bassNotes,
  }
}

export function syncBassNotesToTreble(trebleNotes: ScoreNote[], currentBass: ScoreNote[]): ScoreNote[] {
  return trebleNotes.map((trebleNote, index) => ({
    id: currentBass[index]?.id ?? `bass-${index + 1}`,
    pitch: currentBass[index]?.pitch ?? BASS_MOCK_PATTERN[index % BASS_MOCK_PATTERN.length],
    duration: trebleNote.duration,
  }))
}

export function updateScoreNotePitchAtKey(note: ScoreNote, pitch: Pitch, keyIndex: number): ScoreNote {
  if (note.isRest) return note

  if (keyIndex <= 0) {
    if (note.pitch === pitch) return note
    return { ...note, pitch, accidental: null }
  }

  const chordIndex = keyIndex - 1
  const sourceChordPitches = note.chordPitches
  if (!sourceChordPitches || chordIndex < 0 || chordIndex >= sourceChordPitches.length) {
    if (note.pitch === pitch) return note
    return { ...note, pitch, accidental: null }
  }

  if (sourceChordPitches[chordIndex] === pitch) return note

  const chordPitches = sourceChordPitches.slice()
  chordPitches[chordIndex] = pitch
  const chordAccidentals = note.chordAccidentals ? note.chordAccidentals.slice() : new Array(chordPitches.length).fill(undefined)
  chordAccidentals[chordIndex] = null
  return { ...note, chordPitches, chordAccidentals }
}

export function updateNotePitch(notes: ScoreNote[], noteId: string, pitch: Pitch, keyIndex = 0): ScoreNote[] {
  const noteIndex = notes.findIndex((note) => note.id === noteId)
  if (noteIndex < 0) return notes

  const source = notes[noteIndex]
  const nextNote = updateScoreNotePitchAtKey(source, pitch, keyIndex)
  if (nextNote === source) return notes

  const next = notes.slice()
  next[noteIndex] = nextNote
  return next
}

export function flattenTrebleFromPairs(pairs: MeasurePair[]): ScoreNote[] {
  return pairs.flatMap((pair) => pair.treble)
}

export function flattenBassFromPairs(pairs: MeasurePair[]): ScoreNote[] {
  return pairs.flatMap((pair) => pair.bass)
}

export function updateMeasurePairsPitch(pairs: MeasurePair[], noteId: string, pitch: Pitch, keyIndex = 0): MeasurePair[] {
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

export function fillMissingTicksWithCarryNotes(
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

export function getLastPitch(notes: ScoreNote[], fallback: Pitch): Pitch {
  return notes.length > 0 ? notes[notes.length - 1].pitch : fallback
}

export function splitFlatNotesToMeasures(notes: ScoreNote[], staff: StaffKind, fallbackPitch: Pitch): ScoreNote[][] {
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

export function buildMeasurePairs(trebleNotes: ScoreNote[], bassNotes: ScoreNote[]): MeasurePair[] {
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

export function buildImportedNoteLookup(pairs: MeasurePair[]): Map<string, ImportedNoteLocation> {
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

export function updateMeasurePairPitchAt(
  pairs: MeasurePair[],
  location: ImportedNoteLocation,
  pitch: Pitch,
  keyIndex = 0,
): MeasurePair[] {
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
