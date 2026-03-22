const NOTE_MAP: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  'E#': 5,
  Fb: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
  'B#': 0,
}

const CHORD_ROOT_RE = /^([A-G](?:##|bb|#|b)?)(.*)$/

const MAJOR_TONIC_BY_FIFTHS: Record<number, string> = {
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

const MINOR_TONIC_BY_FIFTHS: Record<number, string> = {
  [-7]: 'Ab',
  [-6]: 'Eb',
  [-5]: 'Bb',
  [-4]: 'F',
  [-3]: 'C',
  [-2]: 'G',
  [-1]: 'D',
  0: 'A',
  1: 'E',
  2: 'B',
  3: 'F#',
  4: 'C#',
  5: 'G#',
  6: 'D#',
  7: 'A#',
}

export function normalizeKeyMode(mode: string | null | undefined): 'major' | 'minor' {
  const normalized = String(mode ?? 'major').trim().toLowerCase()
  return normalized.includes('min') ? 'minor' : 'major'
}

export function keySignatureToTonicName(fifths: number, mode: string | null | undefined = 'major'): string {
  const clampedFifths = Math.max(-7, Math.min(7, Math.trunc(fifths)))
  if (normalizeKeyMode(mode) === 'minor') {
    return MINOR_TONIC_BY_FIFTHS[clampedFifths] ?? 'A'
  }
  return MAJOR_TONIC_BY_FIFTHS[clampedFifths] ?? 'C'
}

function noteNameToPitchClass(noteName: string): number {
  return NOTE_MAP[String(noteName ?? '').trim()] ?? 0
}

function normalizeDeltaToSignedSemitones(delta: number): number {
  let normalized = Math.trunc(delta) % 12
  if (normalized > 6) normalized -= 12
  if (normalized < -6) normalized += 12
  return normalized
}

export function pcToDegree(pc: number, tonicPc: number, mode: string | null | undefined = 'major'): string {
  const interval = ((Math.trunc(pc) - Math.trunc(tonicPc)) % 12 + 12) % 12
  const preferredDegreesByInterval =
    normalizeKeyMode(mode) === 'minor'
      ? ['1', 'b2', '2', '3', '#3', '4', '#4', '5', '6', '#6', '7', '#7']
      : ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7']

  const preferredDegree = preferredDegreesByInterval[interval]
  if (preferredDegree) return preferredDegree

  const baseIntervals =
    normalizeKeyMode(mode) === 'minor'
      ? new Map<number, number>([
          [1, 0],
          [2, 2],
          [3, 3],
          [4, 5],
          [5, 7],
          [6, 8],
          [7, 10],
        ])
      : new Map<number, number>([
          [1, 0],
          [2, 2],
          [3, 4],
          [4, 5],
          [5, 7],
          [6, 9],
          [7, 11],
        ])

  for (const [degree, baseInterval] of baseIntervals.entries()) {
    if (interval === baseInterval) return String(degree)
  }

  let bestDegree: number | null = null
  let bestDelta: number | null = null
  let bestAbsDelta: number | null = null

  for (const [degree, baseInterval] of baseIntervals.entries()) {
    const delta = normalizeDeltaToSignedSemitones(interval - baseInterval)
    const absDelta = Math.abs(delta)
    if (bestAbsDelta === null || absDelta < bestAbsDelta) {
      bestDegree = degree
      bestDelta = delta
      bestAbsDelta = absDelta
    }
  }

  if (bestDegree === null || bestDelta === null || bestAbsDelta === null || bestAbsDelta > 2) {
    return '?'
  }
  if (bestDelta === 0) return String(bestDegree)
  if (bestDelta > 0) return `${'#'.repeat(bestDelta)}${bestDegree}`
  return `${'b'.repeat(-bestDelta)}${bestDegree}`
}

export function chordNameToDegree(
  chordName: string,
  keyFifths = 0,
  keyMode: string | null | undefined = 'major',
): string {
  const text = String(chordName ?? '').trim()
  if (!text || text === 'Rest' || text === 'Unknown') return text

  let left = text
  let right: string | null = null
  const slashIndex = text.indexOf('/')
  if (slashIndex >= 0) {
    left = text.slice(0, slashIndex).trim()
    right = text.slice(slashIndex + 1).trim()
  }

  const leftMatch = CHORD_ROOT_RE.exec(left)
  if (!leftMatch) return text

  const [, rootName, suffix] = leftMatch
  const tonicName = keySignatureToTonicName(keyFifths, keyMode)
  const tonicPc = noteNameToPitchClass(tonicName)
  const rootPc = noteNameToPitchClass(rootName)
  const degree = pcToDegree(rootPc, tonicPc, keyMode)
  let result = `${degree}${suffix}`

  if (!right) return result

  const rightMatch = CHORD_ROOT_RE.exec(right)
  if (!rightMatch) return `${result}/${right}`
  const [, bassName, bassSuffix] = rightMatch
  const bassPc = noteNameToPitchClass(bassName)
  const bassDegree = pcToDegree(bassPc, tonicPc, keyMode)
  result = `${result}/${bassDegree}${bassSuffix}`
  return result
}
