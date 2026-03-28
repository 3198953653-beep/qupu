import { DURATION_BEATS } from './constants'
import type {
  BeamLevelTag,
  BeamTagByLevel,
  MeasurePair,
  MeasureStaffBeamResult,
  NoteDuration,
  ScoreNote,
  TimeSignature,
} from './types'

const EPSILON = 1e-6
const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function toValidTimeSignature(time: TimeSignature | null | undefined): TimeSignature {
  if (!time) return { ...DEFAULT_TIME_SIGNATURE }
  const beats = isFiniteNumber(time.beats) && time.beats > 0 ? Math.round(time.beats) : DEFAULT_TIME_SIGNATURE.beats
  const beatType =
    isFiniteNumber(time.beatType) && time.beatType > 0 ? Math.round(time.beatType) : DEFAULT_TIME_SIGNATURE.beatType
  return { beats, beatType }
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON
}

function createEmptyBeamTags(count: number): BeamTagByLevel[] {
  return Array.from({ length: count }, () => ({}))
}

function assignBeamRun(tags: BeamTagByLevel[], level: number, noteIndexes: number[]): void {
  if (noteIndexes.length < 2) return
  tags[noteIndexes[0]][level] = 'begin'
  for (let index = 1; index < noteIndexes.length - 1; index += 1) {
    tags[noteIndexes[index]][level] = 'continue'
  }
  tags[noteIndexes[noteIndexes.length - 1]][level] = 'end'
}

function assignBeamHook(
  tags: BeamTagByLevel[],
  level: number,
  segmentLength: number,
  segmentPosition: number,
  noteIndex: number,
): void {
  if (segmentLength < 2) return
  const hasLeftNeighbor = segmentPosition > 0
  const hasRightNeighbor = segmentPosition < segmentLength - 1
  if (!hasLeftNeighbor && !hasRightNeighbor) return
  let hook: BeamLevelTag
  if (hasLeftNeighbor && !hasRightNeighbor) {
    hook = 'backward hook'
  } else if (!hasLeftNeighbor && hasRightNeighbor) {
    hook = 'forward hook'
  } else {
    // Middle single-note secondary beam: prefer forward to keep deterministic output.
    hook = 'forward hook'
  }
  tags[noteIndex][level] = hook
}

function buildBeatBoundaries(time: TimeSignature): number[] {
  const beatSpan = 4 / time.beatType
  if (!isFiniteNumber(beatSpan) || beatSpan <= 0) return []
  const boundaries: number[] = []
  for (let beatIndex = 1; beatIndex < time.beats; beatIndex += 1) {
    boundaries.push(beatIndex * beatSpan)
  }
  return boundaries
}

function isBoundary(value: number, boundaries: number[]): boolean {
  for (let index = 0; index < boundaries.length; index += 1) {
    if (almostEqual(value, boundaries[index])) return true
  }
  return false
}

function buildLevelOneChains(
  notes: ScoreNote[],
  starts: number[],
  ends: number[],
  beamLevels: number[],
): number[][] {
  const chains: number[][] = []
  let chain: number[] = []
  for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
    const eligible = !notes[noteIndex].isRest && beamLevels[noteIndex] >= 1
    if (!eligible) {
      if (chain.length > 0) chains.push(chain)
      chain = []
      continue
    }
    if (chain.length === 0) {
      chain.push(noteIndex)
      continue
    }
    const previousIndex = chain[chain.length - 1]
    if (!almostEqual(starts[noteIndex], ends[previousIndex])) {
      chains.push(chain)
      chain = [noteIndex]
      continue
    }
    chain.push(noteIndex)
  }
  if (chain.length > 0) chains.push(chain)
  return chains
}

function splitChainOnBeatBoundaries(chain: number[], starts: number[], ends: number[], boundaries: number[]): number[][] {
  if (chain.length === 0) return []
  if (chain.length === 1) return [[chain[0]]]
  const groups: number[][] = []
  let group: number[] = [chain[0]]
  for (let index = 0; index < chain.length - 1; index += 1) {
    const current = chain[index]
    const next = chain[index + 1]
    const junction = ends[current]
    const nextStart = starts[next]
    const shouldSplit = almostEqual(junction, nextStart) && isBoundary(junction, boundaries)
    if (shouldSplit) {
      groups.push(group)
      group = [next]
    } else {
      group.push(next)
    }
  }
  groups.push(group)
  return groups
}

function resolveIsolatedBeamSegment(
  tags: BeamTagByLevel[],
  level: number,
  group: number[],
  beamLevels: number[],
): void {
  if (group.length < 2) return
  let runIndexes: number[] = []
  let runPositions: number[] = []
  const flush = () => {
    if (runIndexes.length >= 2) {
      assignBeamRun(tags, level, runIndexes)
    } else if (runIndexes.length === 1) {
      assignBeamHook(tags, level, group.length, runPositions[0], runIndexes[0])
    }
    runIndexes = []
    runPositions = []
  }
  for (let pos = 0; pos < group.length; pos += 1) {
    const noteIndex = group[pos]
    const eligible = beamLevels[noteIndex] >= level
    if (!eligible) {
      flush()
      continue
    }
    runIndexes.push(noteIndex)
    runPositions.push(pos)
  }
  flush()
}

export function getBeamLevelFromDuration(duration: NoteDuration): 0 | 1 | 2 | 3 {
  switch (duration) {
    case 'hd':
    case 'h':
    case 'q':
    case 'qd':
    case 'w':
      return 0
    case '8':
    case '8d':
      return 1
    case '16':
    case '16d':
      return 2
    case '32':
    case '32d':
      return 3
    default:
      return 0
  }
}

export function computeStaffBeamGroups(notes: ScoreNote[], time: TimeSignature): BeamTagByLevel[] {
  const beamTags = createEmptyBeamTags(notes.length)
  if (notes.length === 0) return beamTags
  const validTime = toValidTimeSignature(time)
  const boundaries = buildBeatBoundaries(validTime)
  const starts: number[] = []
  const ends: number[] = []
  const beamLevels: number[] = []
  let cursor = 0
  for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
    const note = notes[noteIndex]
    const beats = DURATION_BEATS[note.duration] ?? 0
    starts.push(cursor)
    cursor += beats
    ends.push(cursor)
    beamLevels.push(getBeamLevelFromDuration(note.duration))
  }

  const levelOneChains = buildLevelOneChains(notes, starts, ends, beamLevels)
  const levelOneGroups: number[][] = []
  for (let chainIndex = 0; chainIndex < levelOneChains.length; chainIndex += 1) {
    const splitGroups = splitChainOnBeatBoundaries(levelOneChains[chainIndex], starts, ends, boundaries)
    for (let groupIndex = 0; groupIndex < splitGroups.length; groupIndex += 1) {
      const group = splitGroups[groupIndex]
      levelOneGroups.push(group)
      assignBeamRun(beamTags, 1, group)
    }
  }

  for (let level = 2; level <= 3; level += 1) {
    for (let groupIndex = 0; groupIndex < levelOneGroups.length; groupIndex += 1) {
      resolveIsolatedBeamSegment(beamTags, level, levelOneGroups[groupIndex], beamLevels)
    }
  }

  return beamTags
}

export function computeMeasurePairsBeamGroups(params: {
  measurePairs: MeasurePair[]
  measureTimeSignatures?: TimeSignature[] | null
}): MeasureStaffBeamResult[] {
  const { measurePairs, measureTimeSignatures } = params
  const results: MeasureStaffBeamResult[] = []
  let previousTime = { ...DEFAULT_TIME_SIGNATURE }
  for (let pairIndex = 0; pairIndex < measurePairs.length; pairIndex += 1) {
    const pair = measurePairs[pairIndex]
    const nextTime = toValidTimeSignature(measureTimeSignatures?.[pairIndex] ?? previousTime)
    previousTime = nextTime
    results.push({
      treble: computeStaffBeamGroups(pair.treble, nextTime),
      bass: computeStaffBeamGroups(pair.bass, nextTime),
    })
  }
  return results
}
