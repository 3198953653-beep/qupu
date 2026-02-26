import type { MeasurePair, Pitch, ScoreNote, StaffKind } from '../types'

type TieKeySpec = {
  keyIndex: number
  pitch: Pitch
  tieStart: boolean
  tieStop: boolean
}

type TieMatch = {
  noteIndex: number
  keyIndex: number
  tieStart: boolean
  tieStop: boolean
}

export type TieRedrawRange = {
  startPairIndex: number
  endPairIndexExclusive: number
  pairIndices: number[]
  pitch: Pitch | null
}

function getStaffNotes(measurePairs: MeasurePair[], pairIndex: number, staff: StaffKind): ScoreNote[] | null {
  const pair = measurePairs[pairIndex]
  if (!pair) return null
  return staff === 'treble' ? pair.treble : pair.bass
}

function getTieKeySpecs(note: ScoreNote): TieKeySpec[] {
  if (!note || note.isRest) return []
  const specs: TieKeySpec[] = [
    {
      keyIndex: 0,
      pitch: note.pitch,
      tieStart: Boolean(note.tieStart),
      tieStop: Boolean(note.tieStop),
    },
  ]
  ;(note.chordPitches ?? []).forEach((pitch, chordIndex) => {
    specs.push({
      keyIndex: chordIndex + 1,
      pitch,
      tieStart: Boolean(note.chordTieStarts?.[chordIndex]),
      tieStop: Boolean(note.chordTieStops?.[chordIndex]),
    })
  })
  return specs
}

function findSourceSpec(params: {
  note: ScoreNote | undefined
  keyIndex: number
  pitchHint?: Pitch | null
}): TieKeySpec | null {
  const { note, keyIndex, pitchHint } = params
  if (!note || note.isRest) return null
  const specs = getTieKeySpecs(note)
  if (specs.length === 0) return null

  const byKeyIndex = specs.find((spec) => spec.keyIndex === keyIndex)
  if (byKeyIndex) return byKeyIndex
  if (pitchHint) {
    const byPitch = specs.find((spec) => spec.pitch === pitchHint)
    if (byPitch) return byPitch
  }
  return specs[0] ?? null
}

function findMatchingTieSpecInPair(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  staff: StaffKind
  pitch: Pitch
  requireTieStart?: boolean
  requireTieStop?: boolean
  preferLast?: boolean
}): TieMatch | null {
  const {
    measurePairs,
    pairIndex,
    staff,
    pitch,
    requireTieStart = false,
    requireTieStop = false,
    preferLast = false,
  } = params
  const notes = getStaffNotes(measurePairs, pairIndex, staff)
  if (!notes || notes.length === 0) return null

  const noteIndices = Array.from({ length: notes.length }, (_, index) => index)
  if (preferLast) noteIndices.reverse()

  for (const noteIndex of noteIndices) {
    const note = notes[noteIndex]
    const specs = getTieKeySpecs(note)
    for (const spec of specs) {
      if (spec.pitch !== pitch) continue
      if (requireTieStart && !spec.tieStart) continue
      if (requireTieStop && !spec.tieStop) continue
      return {
        noteIndex,
        keyIndex: spec.keyIndex,
        tieStart: spec.tieStart,
        tieStop: spec.tieStop,
      }
    }
  }

  return null
}

export function resolveTieRedrawRange(params: {
  measurePairs: MeasurePair[]
  pairIndex: number
  staff: StaffKind
  noteIndex: number
  keyIndex: number
  pitchHint?: Pitch | null
}): TieRedrawRange {
  const {
    measurePairs,
    pairIndex,
    staff,
    noteIndex,
    keyIndex,
    pitchHint = null,
  } = params
  const clampedPairIndex = Math.max(0, Math.min(pairIndex, Math.max(0, measurePairs.length - 1)))
  const fallback: TieRedrawRange = {
    startPairIndex: clampedPairIndex,
    endPairIndexExclusive: clampedPairIndex + 1,
    pairIndices: [clampedPairIndex],
    pitch: pitchHint ?? null,
  }

  const notes = getStaffNotes(measurePairs, clampedPairIndex, staff)
  const sourceNote = notes?.[noteIndex]
  const sourceSpec = findSourceSpec({
    note: sourceNote,
    keyIndex,
    pitchHint,
  })
  if (!sourceSpec) return fallback

  const targetPitch = sourceSpec.pitch
  let startPairIndex = clampedPairIndex
  let endPairIndexExclusive = clampedPairIndex + 1

  let backwardPairIndex = clampedPairIndex
  let backwardSpec: TieMatch | TieKeySpec = sourceSpec
  while (backwardPairIndex > 0 && backwardSpec.tieStop) {
    const previousPairIndex = backwardPairIndex - 1
    const previousMatch = findMatchingTieSpecInPair({
      measurePairs,
      pairIndex: previousPairIndex,
      staff,
      pitch: targetPitch,
      requireTieStart: true,
      preferLast: true,
    })
    if (!previousMatch) break
    startPairIndex = previousPairIndex
    backwardPairIndex = previousPairIndex
    backwardSpec = previousMatch
  }

  let forwardPairIndex = clampedPairIndex
  let forwardSpec: TieMatch | TieKeySpec = sourceSpec
  while (forwardPairIndex + 1 < measurePairs.length && forwardSpec.tieStart) {
    const nextPairIndex = forwardPairIndex + 1
    const nextMatch = findMatchingTieSpecInPair({
      measurePairs,
      pairIndex: nextPairIndex,
      staff,
      pitch: targetPitch,
      requireTieStop: true,
      preferLast: false,
    })
    if (!nextMatch) break
    endPairIndexExclusive = nextPairIndex + 1
    forwardPairIndex = nextPairIndex
    forwardSpec = nextMatch
  }

  const pairIndices: number[] = []
  for (let index = startPairIndex; index < endPairIndexExclusive; index += 1) {
    pairIndices.push(index)
  }

  return {
    startPairIndex,
    endPairIndexExclusive,
    pairIndices,
    pitch: targetPitch,
  }
}
