import { STEP_TO_SEMITONE } from './constants'
import { getStepOctaveAlterFromPitch, toPitchFromStepAlter } from './pitchMath'
import { toDisplayPitch } from './pitchUtils'
import type { Pitch } from './types'

export type SmartChordToneOctaveOption = 'high' | 'low'
export type SmartChordToneCountOption = 'double' | 'triple' | 'quad' | 'quad_plus'
export type SmartChordToneFilterOption =
  | 'no_2nd'
  | 'no_single_2nd'
  | 'no_single_7th'
  | 'no_root_for_7th_9th'

export type SmartChordToneCandidate = {
  key: string
  allPitches: Pitch[]
  addedPitches: Pitch[]
  allPitchesLabel: string
  addedPitchesLabel: string
}

const ROOT_SEMITONE_BY_LETTER: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

const SEMITONE_TO_SHARP: Record<number, string> = {
  0: 'C',
  1: 'C#',
  2: 'D',
  3: 'D#',
  4: 'E',
  5: 'F',
  6: 'F#',
  7: 'G',
  8: 'G#',
  9: 'A',
  10: 'A#',
  11: 'B',
}

const SEMITONE_TO_FLAT: Record<number, string> = {
  0: 'C',
  1: 'Db',
  2: 'D',
  3: 'Eb',
  4: 'E',
  5: 'F',
  6: 'Gb',
  7: 'G',
  8: 'Ab',
  9: 'A',
  10: 'Bb',
  11: 'B',
}

function clampMidi(midi: number): number {
  return Math.max(0, Math.min(127, midi))
}

function pitchToMidi(pitch: Pitch): number | null {
  const { step, octave, alter } = getStepOctaveAlterFromPitch(pitch)
  const semitone = STEP_TO_SEMITONE[step]
  if (semitone === undefined || !Number.isFinite(octave) || !Number.isFinite(alter)) return null
  return clampMidi((octave + 1) * 12 + semitone + alter)
}

function displayPitchToMidi(displayPitch: string): number | null {
  const match = /^([A-Ga-g])([#b]{0,2})(-?\d+)$/.exec(displayPitch.trim())
  if (!match) return null
  const step = match[1].toUpperCase()
  const accidentalText = match[2] ?? ''
  const octave = Number(match[3])
  const semitone = ROOT_SEMITONE_BY_LETTER[step]
  if (semitone === undefined || !Number.isFinite(octave)) return null
  const alter = (accidentalText.match(/#/g)?.length ?? 0) - (accidentalText.match(/b/g)?.length ?? 0)
  return clampMidi((octave + 1) * 12 + semitone + alter)
}

function displayPitchToCurrentPitch(displayPitch: string): Pitch | null {
  const match = /^([A-Ga-g])([#b]{0,2})(-?\d+)$/.exec(displayPitch.trim())
  if (!match) return null
  const step = match[1].toUpperCase()
  const accidentalText = match[2] ?? ''
  const octave = Number(match[3])
  if (!Number.isFinite(octave)) return null
  const alter = (accidentalText.match(/#/g)?.length ?? 0) - (accidentalText.match(/b/g)?.length ?? 0)
  return toPitchFromStepAlter(step, alter, octave)
}

function transposeDisplayPitchByOctaves(displayPitch: string, octaves: number): string | null {
  const midi = displayPitchToMidi(displayPitch)
  if (midi === null) return null
  const shiftedMidi = midi + octaves * 12
  if (shiftedMidi < 0 || shiftedMidi > 127) return null
  return midiToDisplayPitchWithSpelling(shiftedMidi, '')
}

function getSpellingPreference(chordName: string): 'sharp' | 'flat' {
  if (!chordName) return 'sharp'
  const match = /^([A-G][#b]?)(.*?)(?:\/.*)?$/.exec(chordName)
  const root = match?.[1] ?? ''
  const flatRoots = new Set(['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Fb'])
  if (flatRoots.has(root) || (root.includes('b') && !root.includes('#'))) {
    return 'flat'
  }
  return 'sharp'
}

function midiToDisplayPitchWithSpelling(midi: number, chordName: string): string {
  const normalizedMidi = clampMidi(midi)
  const octave = Math.floor(normalizedMidi / 12) - 1
  const semitone = normalizedMidi % 12
  const spellingPreference = getSpellingPreference(chordName)
  const match = /^([A-G])([#b]?)(.*?)(?:\/.*)?$/.exec(chordName ?? '')
  const rootLetter = match?.[1] ?? ''
  const rootAccidental = match?.[2] ?? ''
  const suffixLower = match?.[3]?.toLowerCase() ?? ''

  let noteName =
    spellingPreference === 'flat' ? SEMITONE_TO_FLAT[semitone] ?? 'C' : SEMITONE_TO_SHARP[semitone] ?? 'C'

  if (
    spellingPreference === 'sharp' &&
    (suffixLower.includes('maj7') || (!suffixLower.includes('m7') && suffixLower.includes('7') && suffixLower.includes('maj'))) &&
    semitone === 5
  ) {
    noteName = 'E#'
  }

  if (spellingPreference === 'flat' && rootAccidental === 'b') {
    if (rootLetter === 'C' && semitone === 11) {
      noteName = 'Cb'
    } else if (rootLetter === 'F' && semitone === 4) {
      noteName = 'Fb'
    }
    if (suffixLower.includes('m7b5') && semitone === 4) {
      noteName = 'Fb'
    }
  }

  return `${noteName}${octave}`
}

function getChordRoot(chordName: string): number | null {
  if (!chordName) return null
  const match = /^([A-G])([#b]?)/.exec(chordName)
  if (!match) return null
  const semitone = ROOT_SEMITONE_BY_LETTER[match[1]]
  if (semitone === undefined) return null
  if (match[2] === '#') return (semitone + 1) % 12
  if (match[2] === 'b') return (semitone + 11) % 12
  return semitone
}

function isSeventhOrNinthChord(chordName: string): boolean {
  if (!chordName) return false
  const match = /^[A-G][#b]?(.*?)(?:\/.*)?$/.exec(chordName)
  const suffix = match?.[1]?.toLowerCase() ?? ''
  if (suffix.includes('7')) return true
  if (suffix.includes('9') && !suffix.includes('add9')) return true
  return false
}

function parseChordToPitchClasses(chordName: string): number[] {
  if (!chordName) return []

  const match = /^([A-G][#b]?)(.*?)(?:\/.*)?$/.exec(chordName)
  if (!match) return []

  const root = match[1]
  const suffix = (match[2] ?? '').toLowerCase()
  const rootBase = ROOT_SEMITONE_BY_LETTER[root[0]]
  if (rootBase === undefined) return []

  let rootSemitone = rootBase
  if (root.includes('#')) rootSemitone += 1
  if (root.includes('b')) rootSemitone -= 1
  rootSemitone = ((rootSemitone % 12) + 12) % 12

  let intervals = [0, 4, 7]

  if (suffix.includes('m') && !suffix.includes('maj')) {
    intervals = [0, 3, 7]
  }
  if (suffix.includes('dim') || suffix.includes('°') || suffix.includes('o')) {
    intervals = [0, 3, 6]
  }
  if (suffix.includes('aug') || suffix.includes('+')) {
    intervals = [0, 4, 8]
  }
  if (suffix.includes('sus2')) {
    intervals = [0, 2, 7]
  }
  if (suffix.includes('sus4') || suffix.includes('sus')) {
    intervals = [0, 5, 7]
  }
  if (suffix.includes('b5')) {
    intervals = intervals.map((interval) => (interval === 7 ? 6 : interval))
  }

  if (suffix.includes('7')) {
    if (suffix.includes('maj7') || suffix.includes('m7+') || suffix.includes('m7#')) {
      intervals = [...intervals, 11]
    } else if (suffix.includes('dim7') || suffix.includes('°7')) {
      intervals = [...intervals, 9]
    } else {
      intervals = [...intervals, 10]
    }
  }

  if (suffix.includes('9')) {
    intervals = [...intervals, 2]
  }

  return intervals.map((interval) => (rootSemitone + interval) % 12)
}

function getIntervalDegreeFromMelody(referencePitch: string, chordTonePitch: string): number | null {
  const referenceMidi = displayPitchToMidi(referencePitch)
  const chordToneMidi = displayPitchToMidi(chordTonePitch)
  if (referenceMidi === null || chordToneMidi === null) return null

  const intervalSemitones = Math.abs(referenceMidi - chordToneMidi) % 12
  const semitoneToDegree: Record<number, number> = {
    0: 1,
    1: 2,
    2: 2,
    3: 3,
    4: 3,
    5: 4,
    6: 4,
    7: 5,
    8: 6,
    9: 6,
    10: 7,
    11: 7,
  }
  return semitoneToDegree[intervalSemitones] ?? 1
}

function applyOctaveOption(melodyDisplayPitch: string, octaveOption: SmartChordToneOctaveOption | null): {
  octaveResult: string
  referencePitch: string
} {
  if (octaveOption === 'high') {
    const highPitch = transposeDisplayPitchByOctaves(melodyDisplayPitch, 1)
    if (highPitch) {
      return {
        octaveResult: `${melodyDisplayPitch}+${highPitch}`,
        referencePitch: highPitch,
      }
    }
  }

  if (octaveOption === 'low') {
    const lowPitch = transposeDisplayPitchByOctaves(melodyDisplayPitch, -1)
    if (lowPitch) {
      return {
        octaveResult: `${lowPitch}+${melodyDisplayPitch}`,
        referencePitch: melodyDisplayPitch,
      }
    }
  }

  return {
    octaveResult: melodyDisplayPitch,
    referencePitch: melodyDisplayPitch,
  }
}

function combineDisplayResult(octaveResult: string, chordTones: string[]): string {
  const uniquePitches: string[] = []
  octaveResult.split('+').forEach((pitch) => {
    const trimmed = pitch.trim()
    if (trimmed && !uniquePitches.includes(trimmed)) {
      uniquePitches.push(trimmed)
    }
  })
  chordTones.forEach((pitch) => {
    if (pitch && !uniquePitches.includes(pitch)) {
      uniquePitches.push(pitch)
    }
  })
  uniquePitches.sort((left, right) => (displayPitchToMidi(left) ?? 0) - (displayPitchToMidi(right) ?? 0))
  return uniquePitches.join('+')
}

function createCandidateFromDisplayResult(params: {
  result: string
  melodyPitch: Pitch
}): SmartChordToneCandidate | null {
  const { result, melodyPitch } = params
  const displayPitches = result
    .split('+')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (displayPitches.length === 0) return null

  const allPitches: Pitch[] = []
  displayPitches.forEach((displayPitch) => {
    const currentPitch = displayPitchToCurrentPitch(displayPitch)
    if (!currentPitch) return
    if (!allPitches.includes(currentPitch)) {
      allPitches.push(currentPitch)
    }
  })
  if (allPitches.length === 0) return null

  let melodyConsumed = false
  const addedPitches = allPitches.filter((pitch) => {
    if (!melodyConsumed && pitch === melodyPitch) {
      melodyConsumed = true
      return false
    }
    return true
  })
  if (addedPitches.length === 0) return null

  return {
    key: addedPitches.join('|'),
    allPitches,
    addedPitches,
    allPitchesLabel: displayPitches.join(' + '),
    addedPitchesLabel: addedPitches.map((pitch) => toDisplayPitch(pitch)).join(' + '),
  }
}

export function sortPitchesByMidi(pitches: readonly Pitch[]): Pitch[] {
  return [...pitches].sort((left, right) => (pitchToMidi(left) ?? 0) - (pitchToMidi(right) ?? 0))
}

export function arePitchListsEquivalentByMidi(left: readonly Pitch[], right: readonly Pitch[]): boolean {
  if (left.length !== right.length) return false
  const leftMidis = sortPitchesByMidi(left).map((pitch) => pitchToMidi(pitch))
  const rightMidis = sortPitchesByMidi(right).map((pitch) => pitchToMidi(pitch))
  return leftMidis.every((midi, index) => midi === rightMidis[index])
}

export function enumerateSmartChordToneCandidates(params: {
  melodyPitch: Pitch
  chordName: string
  octaveOption: SmartChordToneOctaveOption | null
  chordCountOption: SmartChordToneCountOption | null
  filterOptions: SmartChordToneFilterOption[]
}): SmartChordToneCandidate[] {
  const { melodyPitch, chordName, octaveOption, chordCountOption, filterOptions } = params
  if (!melodyPitch || !chordName) return []

  const melodyDisplayPitch = toDisplayPitch(melodyPitch)
  const { octaveResult, referencePitch } = applyOctaveOption(melodyDisplayPitch, octaveOption)
  const referenceMidi = displayPitchToMidi(referencePitch)
  const melodyMidi = displayPitchToMidi(melodyDisplayPitch)
  if (referenceMidi === null || melodyMidi === null) return []

  let excludedPitchClasses = [melodyMidi % 12]
  const chordRoot = getChordRoot(chordName)
  if (
    filterOptions.includes('no_root_for_7th_9th') &&
    isSeventhOrNinthChord(chordName) &&
    chordRoot !== null &&
    !excludedPitchClasses.includes(chordRoot)
  ) {
    excludedPitchClasses = [...excludedPitchClasses, chordRoot]
  }

  const chordPitchClasses = parseChordToPitchClasses(chordName)
  if (chordPitchClasses.length === 0) return []

  const availableTones: string[] = []
  const minMidi = referenceMidi - 24
  chordPitchClasses.forEach((pitchClass) => {
    if (excludedPitchClasses.includes(pitchClass)) return
    for (let octave = 10; octave >= 0; octave -= 1) {
      const midi = pitchClass + (octave + 1) * 12
      if (midi < referenceMidi && midi >= minMidi) {
        const displayPitch = midiToDisplayPitchWithSpelling(midi, chordName)
        if (displayPitch && !availableTones.includes(displayPitch)) {
          availableTones.push(displayPitch)
        }
        break
      }
    }
  })

  const desiredCounts =
    chordCountOption === 'double'
      ? [1]
      : chordCountOption === 'triple'
        ? [2]
        : chordCountOption === 'quad'
          ? [3]
          : chordCountOption === 'quad_plus'
            ? [Math.min(Math.max(3, availableTones.length), availableTones.length)]
            : (() => {
                const counts = [1, 2, 3].filter((count) => count <= availableTones.length)
                return counts.length > 0 ? counts : [availableTones.length]
              })()

  const noSecondEnabled = filterOptions.includes('no_2nd')
  const noSingleSecondEnabled = filterOptions.includes('no_single_2nd')
  const noSingleSeventhEnabled = filterOptions.includes('no_single_7th')
  const seenResults = new Set<string>()
  const candidates: SmartChordToneCandidate[] = []

  desiredCounts.forEach((count) => {
    let filteredTones = availableTones
    if (noSecondEnabled && referencePitch) {
      const withoutSeconds = availableTones.filter((tone) => getIntervalDegreeFromMelody(referencePitch, tone) !== 2)
      filteredTones = withoutSeconds.length > 0 ? withoutSeconds : availableTones
    }

    let selectedSets: string[][] = []
    if (count <= 0) {
      selectedSets = [[]]
    } else if (count === 1) {
      const selectable = filteredTones.filter((tone) => {
        const degree = referencePitch ? getIntervalDegreeFromMelody(referencePitch, tone) : null
        if (noSingleSecondEnabled && degree === 2) return false
        if (noSingleSeventhEnabled && degree === 7) return false
        return true
      })
      const effectiveSelectable = selectable.length > 0 ? selectable : filteredTones.length > 0 ? filteredTones : availableTones
      selectedSets = effectiveSelectable.map((tone) => [tone])
    } else {
      const effectiveCount = Math.min(count, filteredTones.length)
      if (effectiveCount <= 0) {
        selectedSets = [[]]
      } else if (effectiveCount >= filteredTones.length) {
        selectedSets = [filteredTones]
      } else {
        const combinations: string[][] = []
        const buildCombinations = (startIndex: number, working: string[]) => {
          if (working.length === effectiveCount) {
            combinations.push([...working])
            return
          }
          for (let index = startIndex; index < filteredTones.length; index += 1) {
            working.push(filteredTones[index])
            buildCombinations(index + 1, working)
            working.pop()
          }
        }
        buildCombinations(0, [])
        selectedSets = combinations
      }
    }

    selectedSets.forEach((tones) => {
      const displayResult = combineDisplayResult(octaveResult, tones)
      if (seenResults.has(displayResult)) return
      seenResults.add(displayResult)
      const candidate = createCandidateFromDisplayResult({
        result: displayResult,
        melodyPitch,
      })
      if (!candidate) return
      candidates.push(candidate)
    })
  })

  return candidates
}
