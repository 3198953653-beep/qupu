import {
  ACCIDENTAL_TO_MUSIC_XML,
  DURATION_BEATS,
  DURATION_MUSIC_XML,
  DURATION_TICKS,
  INITIAL_NOTES,
  MEASURE_TICKS,
  STEP_TO_SEMITONE,
  TICKS_PER_BEAT,
} from './constants'
import { getKeySignatureAlterForStep, getStepOctaveAlterFromPitch, toPitchFromStepAlter } from './pitchMath'
import {
  beatsToTicks,
  buildBassMockNotes,
  buildMeasurePairs,
  createImportedNoteId,
  fillMissingTicksWithCarryNotes,
  getLastPitch,
  splitTicksToDurations,
} from './scoreOps'
import type {
  BeamTag,
  ImportResult,
  ImportedNoteLocation,
  MeasurePair,
  MusicXmlCreator,
  MusicXmlMetadata,
  NoteDuration,
  Pitch,
  ScoreNote,
  StaffKind,
  TimeSignature,
} from './types'

const INITIAL_BASS_NOTES = buildBassMockNotes(INITIAL_NOTES)

const ACCIDENTAL_TEXT_TO_SYMBOL: Record<string, string> = {
  sharp: '#',
  flat: 'b',
  natural: 'n',
  'double-sharp': '##',
  'flat-flat': 'bb',
  'natural-sharp': '#',
  'natural-flat': 'b',
}

const ACCIDENTAL_TEXT_TO_ALTER: Record<string, number> = {
  sharp: 1,
  flat: -1,
  natural: 0,
  'double-sharp': 2,
  'flat-flat': -2,
  'natural-sharp': 1,
  'natural-flat': -1,
}

const NOTE_TYPE_TO_BEATS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
}

function getFirstTagText(root: Element | Document, tagName: string): string | undefined {
  const node = root.getElementsByTagName(tagName)[0]
  const text = node?.textContent?.trim()
  return text ? text : undefined
}

type FastNoteData = {
  isGrace: boolean
  isChord: boolean
  isRest: boolean
  staffText?: string
  typeText?: string
  durationValue: number | null
  dots: number
  accidentalText?: string
  pitchStep?: string
  pitchAlter: number | null
  pitchOctave: number | null
}

function collectFastNoteData(noteEl: Element): FastNoteData {
  const data: FastNoteData = {
    isGrace: false,
    isChord: false,
    isRest: false,
    durationValue: null,
    dots: 0,
    pitchAlter: null,
    pitchOctave: null,
  }

  const children = noteEl.children
  for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
    const child = children[childIndex]
    const tag = child.tagName.toLowerCase()
    if (tag === 'grace') {
      data.isGrace = true
      continue
    }
    if (tag === 'chord') {
      data.isChord = true
      continue
    }
    if (tag === 'rest') {
      data.isRest = true
      continue
    }
    if (tag === 'staff') {
      const value = child.textContent?.trim()
      if (value) data.staffText = value
      continue
    }
    if (tag === 'type') {
      const value = child.textContent?.trim().toLowerCase()
      if (value) data.typeText = value
      continue
    }
    if (tag === 'duration') {
      const value = child.textContent?.trim()
      const parsed = value ? Number(value) : Number.NaN
      data.durationValue = Number.isFinite(parsed) ? parsed : null
      continue
    }
    if (tag === 'dot') {
      data.dots += 1
      continue
    }
    if (tag === 'accidental') {
      const value = child.textContent?.trim().toLowerCase()
      if (value) data.accidentalText = value
      continue
    }
    if (tag !== 'pitch') continue

    const pitchChildren = child.children
    for (let pitchIndex = 0; pitchIndex < pitchChildren.length; pitchIndex += 1) {
      const pitchChild = pitchChildren[pitchIndex]
      const pitchTag = pitchChild.tagName.toLowerCase()
      if (pitchTag === 'step') {
        const step = pitchChild.textContent?.trim().toUpperCase()
        if (step) data.pitchStep = step
        continue
      }
      if (pitchTag === 'alter') {
        const alterText = pitchChild.textContent?.trim()
        const alterValue = alterText ? Number(alterText) : Number.NaN
        data.pitchAlter = Number.isFinite(alterValue) ? alterValue : null
        continue
      }
      if (pitchTag === 'octave') {
        const octaveText = pitchChild.textContent?.trim()
        const octaveValue = octaveText ? Number(octaveText) : Number.NaN
        data.pitchOctave = Number.isFinite(octaveValue) ? octaveValue : null
      }
    }
  }

  return data
}

function getMeasureTicksByTime(time: TimeSignature): number {
  const beats = Number.isFinite(time.beats) && time.beats > 0 ? time.beats : 4
  const beatType = Number.isFinite(time.beatType) && time.beatType > 0 ? time.beatType : 4
  const ticks = Math.round(beats * TICKS_PER_BEAT * (4 / beatType))
  return Math.max(1, ticks)
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function getCurrentIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function getDefaultMusicXmlMetadata(): MusicXmlMetadata {
  return {
    version: '3.1',
    workTitle: 'Untitled',
    creators: [],
    softwares: ['Interactive Music Score MVP'],
    encodingDate: getCurrentIsoDate(),
    partName: 'Piano',
    partAbbreviation: 'Pno.',
  }
}

function parseMusicXmlMetadata(doc: Document): MusicXmlMetadata {
  const fallback = getDefaultMusicXmlMetadata()
  const version = doc.querySelector('score-partwise')?.getAttribute('version')?.trim() || fallback.version
  const workTitle = doc.querySelector('work > work-title')?.textContent?.trim() || fallback.workTitle
  const rights = doc.querySelector('identification > rights')?.textContent?.trim() || undefined
  const creators: MusicXmlCreator[] = Array.from(doc.querySelectorAll('identification > creator')).reduce(
    (list, creatorEl) => {
      const text = creatorEl.textContent?.trim() ?? ''
      const type = creatorEl.getAttribute('type')?.trim() ?? undefined
      if (text) list.push({ type, text })
      return list
    },
    [] as MusicXmlCreator[],
  )
  const softwares = Array.from(doc.querySelectorAll('identification > encoding > software'))
    .map((softwareEl) => softwareEl.textContent?.trim() ?? '')
    .filter((software) => software.length > 0)
  const encodingDate = doc.querySelector('identification > encoding > encoding-date')?.textContent?.trim() || fallback.encodingDate
  const partName = doc.querySelector('part-list > score-part > part-name')?.textContent?.trim() || fallback.partName
  const partAbbreviation = doc.querySelector('part-list > score-part > part-abbreviation')?.textContent?.trim() || fallback.partAbbreviation

  return {
    version,
    workTitle,
    rights,
    creators,
    softwares: softwares.length > 0 ? softwares : fallback.softwares,
    encodingDate,
    partName,
    partAbbreviation: partAbbreviation || undefined,
  }
}

function getBeamCountFromDuration(duration: NoteDuration): number {
  const durationMap: Record<NoteDuration, string> = {
    w: 'w',
    h: 'h',
    q: 'q',
    '8': '8',
    '16': '16',
    '32': '32',
    qd: 'q',
    '8d': '8',
    '16d': '16',
    '32d': '32',
  }
  const base = durationMap[duration]
  if (base === '8') return 1
  if (base === '16') return 2
  if (base === '32') return 3
  return 0
}

function computeMeasureBeamTags(notes: ScoreNote[], time: TimeSignature): Array<Record<number, BeamTag>> {
  const beamTags: Array<Record<number, BeamTag>> = notes.map(() => ({}))
  if (notes.length === 0) return beamTags

  const starts: number[] = []
  let cursor = 0
  for (const note of notes) {
    starts.push(cursor)
    cursor += DURATION_BEATS[note.duration]
  }

  const beatSpan = time.beatType > 0 ? 4 / time.beatType : 1
  const epsilon = 1e-6

  const applyRun = (level: number, run: number[]) => {
    if (run.length < 2) return
    beamTags[run[0]][level] = 'begin'
    for (let index = 1; index < run.length - 1; index += 1) {
      beamTags[run[index]][level] = 'continue'
    }
    beamTags[run[run.length - 1]][level] = 'end'
  }

  for (let level = 1; level <= 3; level += 1) {
    const groupMap = new Map<number, number[]>()
    notes.forEach((note, noteIndex) => {
      if (getBeamCountFromDuration(note.duration) < level) return
      const group = Math.floor((starts[noteIndex] + epsilon) / beatSpan)
      const existing = groupMap.get(group)
      if (existing) {
        existing.push(noteIndex)
      } else {
        groupMap.set(group, [noteIndex])
      }
    })

    groupMap.forEach((groupNoteIndexes) => {
      if (groupNoteIndexes.length < 2) return
      groupNoteIndexes.sort((left, right) => starts[left] - starts[right])

      let run: number[] = []
      for (const noteIndex of groupNoteIndexes) {
        if (run.length === 0) {
          run = [noteIndex]
          continue
        }
        const previousIndex = run[run.length - 1]
        const previousEnd = starts[previousIndex] + DURATION_BEATS[notes[previousIndex].duration]
        if (Math.abs(starts[noteIndex] - previousEnd) > epsilon) {
          applyRun(level, run)
          run = [noteIndex]
          continue
        }
        run.push(noteIndex)
      }
      applyRun(level, run)
    })
  }

  return beamTags
}

function getDurationValueByDivisions(duration: NoteDuration, divisions: number): number {
  const value = Math.round(DURATION_BEATS[duration] * divisions)
  return Math.max(1, value)
}

function getMusicXmlDoctype(version: string): string {
  if (version.startsWith('3.0')) {
    return '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
  }
  if (version.startsWith('3.1')) {
    return '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
  }
  return '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
}

export function buildMusicXmlFromMeasurePairs(params: {
  measurePairs: MeasurePair[]
  keyFifthsByMeasure?: number[] | null
  divisionsByMeasure?: number[] | null
  timeSignaturesByMeasure?: TimeSignature[] | null
  metadata?: MusicXmlMetadata | null
}): string {
  const { measurePairs, keyFifthsByMeasure, divisionsByMeasure, timeSignaturesByMeasure, metadata } = params
  const meta = metadata ?? getDefaultMusicXmlMetadata()
  const version = meta.version || '3.1'
  const lines: string[] = []

  const pickDivisions = (measureIndex: number): number => {
    const source = divisionsByMeasure?.[measureIndex] ?? divisionsByMeasure?.[measureIndex - 1] ?? 16
    const numeric = Number(source)
    if (!Number.isFinite(numeric) || numeric <= 0) return 16
    return Math.max(1, Math.round(numeric))
  }

  const pickTime = (measureIndex: number): TimeSignature => {
    const source = timeSignaturesByMeasure?.[measureIndex] ?? timeSignaturesByMeasure?.[measureIndex - 1]
    if (!source) return { beats: 4, beatType: 4 }
    const beats = Number(source.beats)
    const beatType = Number(source.beatType)
    if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0) {
      return { beats: 4, beatType: 4 }
    }
    return { beats: Math.round(beats), beatType: Math.round(beatType) }
  }

  const pickKeyFifths = (measureIndex: number): number => {
    const source = keyFifthsByMeasure?.[measureIndex] ?? keyFifthsByMeasure?.[measureIndex - 1] ?? 0
    const numeric = Number(source)
    if (!Number.isFinite(numeric)) return 0
    return Math.trunc(numeric)
  }

  const appendNote = (noteParams: {
    destination: string[]
    pitch: Pitch
    duration: NoteDuration
    accidental: string | null | undefined
    isRest: boolean
    divisions: number
    staff: 1 | 2
    voice: 1 | 2
    isChord: boolean
    beamTags: Record<number, BeamTag>
  }) => {
    const { destination, pitch, duration, accidental, isRest, divisions, staff, voice, isChord, beamTags } = noteParams
    const { step, octave, alter } = getStepOctaveAlterFromPitch(pitch)
    const durationType = DURATION_MUSIC_XML[duration]
    const accidentalXml = !isRest && accidental ? ACCIDENTAL_TO_MUSIC_XML[accidental] : undefined
    const durationValue = getDurationValueByDivisions(duration, divisions)

    destination.push('   <note>')
    if (isChord) destination.push('    <chord/>')
    if (isRest) {
      destination.push('    <rest/>')
    } else {
      destination.push('    <pitch>')
      destination.push(`     <step>${step}</step>`)
      if (alter !== 0) destination.push(`     <alter>${alter}</alter>`)
      destination.push(`     <octave>${octave}</octave>`)
      destination.push('    </pitch>')
    }
    destination.push(`    <duration>${durationValue}</duration>`)
    destination.push(`    <voice>${voice}</voice>`)
    destination.push(`    <type>${durationType.type}</type>`)
    for (let dotIndex = 0; dotIndex < durationType.dots; dotIndex += 1) {
      destination.push('    <dot/>')
    }
    if (accidentalXml) destination.push(`    <accidental>${accidentalXml}</accidental>`)
    destination.push(`    <staff>${staff}</staff>`)
    const beamNumbers = Object.keys(beamTags)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)
    beamNumbers.forEach((beamNumber) => {
      const beamValue = beamTags[beamNumber]
      if (!beamValue) return
      destination.push(`    <beam number="${beamNumber}">${beamValue}</beam>`)
    })
    destination.push('   </note>')
  }

  const appendStaffNotes = (staffParams: {
    destination: string[]
    notes: ScoreNote[]
    staff: 1 | 2
    voice: 1 | 2
    divisions: number
    time: TimeSignature
  }) => {
    const { destination, notes, staff, voice, divisions, time } = staffParams
    const staffBeamTags = computeMeasureBeamTags(notes, time)
    notes.forEach((note, noteIndex) => {
      const beamTags = staffBeamTags[noteIndex] ?? {}
      appendNote({
        destination,
        pitch: note.pitch,
        duration: note.duration,
        accidental: note.accidental,
        isRest: Boolean(note.isRest),
        divisions,
        staff,
        voice,
        isChord: false,
        beamTags,
      })
      if (note.isRest) {
        return
      }
      note.chordPitches?.forEach((chordPitch, chordIndex) => {
        appendNote({
          destination,
          pitch: chordPitch,
          duration: note.duration,
          accidental: note.chordAccidentals?.[chordIndex],
          isRest: false,
          divisions,
          staff,
          voice,
          isChord: true,
          beamTags,
        })
      })
    })
  }

  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
  lines.push(getMusicXmlDoctype(version))
  lines.push(`<score-partwise version="${escapeXml(version)}">`)
  lines.push(' <work>')
  lines.push(`  <work-title>${escapeXml(meta.workTitle || 'Untitled')}</work-title>`)
  lines.push(' </work>')
  lines.push(' <identification>')
  meta.creators.forEach((creator) => {
    if (!creator.text) return
    const typeAttr = creator.type ? ` type="${escapeXml(creator.type)}"` : ''
    lines.push(`  <creator${typeAttr}>${escapeXml(creator.text)}</creator>`)
  })
  if (meta.rights) lines.push(`  <rights>${escapeXml(meta.rights)}</rights>`)
  lines.push('  <encoding>')
  lines.push(`   <encoding-date>${escapeXml(meta.encodingDate || getCurrentIsoDate())}</encoding-date>`)
  meta.softwares.forEach((software) => {
    if (!software) return
    lines.push(`   <software>${escapeXml(software)}</software>`)
  })
  lines.push('  </encoding>')
  lines.push(' </identification>')
  lines.push(' <part-list>')
  lines.push('  <part-group type="start" number="1">')
  lines.push('   <group-symbol>brace</group-symbol>')
  lines.push('  </part-group>')
  lines.push('  <score-part id="P1">')
  lines.push(`   <part-name>${escapeXml(meta.partName || 'Piano')}</part-name>`)
  if (meta.partAbbreviation) {
    lines.push(`   <part-abbreviation>${escapeXml(meta.partAbbreviation)}</part-abbreviation>`)
  }
  lines.push('  </score-part>')
  lines.push('  <part-group type="stop" number="1" />')
  lines.push(' </part-list>')
  lines.push(' <part id="P1">')

  let previousDivisions = -1
  let previousFifths = Number.NaN
  let previousTime: TimeSignature | null = null

  measurePairs.forEach((pair, measureIndex) => {
    const divisions = pickDivisions(measureIndex)
    const fifths = pickKeyFifths(measureIndex)
    const time = pickTime(measureIndex)
    const shouldWriteDivisions = measureIndex === 0 || divisions !== previousDivisions
    const shouldWriteKey = measureIndex === 0 || fifths !== previousFifths
    const shouldWriteTime =
      measureIndex === 0 ||
      previousTime === null ||
      time.beats !== previousTime.beats ||
      time.beatType !== previousTime.beatType

    lines.push(`  <measure number="${measureIndex + 1}">`)
    if (shouldWriteDivisions || shouldWriteKey || shouldWriteTime || measureIndex === 0) {
      lines.push('   <attributes>')
      if (shouldWriteDivisions) lines.push(`    <divisions>${divisions}</divisions>`)
      if (shouldWriteKey) {
        lines.push('    <key>')
        lines.push(`     <fifths>${fifths}</fifths>`)
        lines.push('    </key>')
      }
      if (shouldWriteTime) {
        lines.push('    <time>')
        lines.push(`     <beats>${time.beats}</beats>`)
        lines.push(`     <beat-type>${time.beatType}</beat-type>`)
        lines.push('    </time>')
      }
      if (measureIndex === 0) {
        lines.push('    <staves>2</staves>')
        lines.push('    <clef number="1">')
        lines.push('     <sign>G</sign>')
        lines.push('     <line>2</line>')
        lines.push('    </clef>')
        lines.push('    <clef number="2">')
        lines.push('     <sign>F</sign>')
        lines.push('     <line>4</line>')
        lines.push('    </clef>')
      }
      lines.push('   </attributes>')
    }

    appendStaffNotes({
      destination: lines,
      notes: pair.treble,
      staff: 1,
      voice: 1,
      divisions,
      time,
    })

    const backupDuration = Math.max(1, Math.round(divisions * time.beats * (4 / time.beatType)))
    lines.push('   <backup>')
    lines.push(`    <duration>${backupDuration}</duration>`)
    lines.push('   </backup>')

    appendStaffNotes({
      destination: lines,
      notes: pair.bass,
      staff: 2,
      voice: 2,
      divisions,
      time,
    })

    lines.push('  </measure>')
    previousDivisions = divisions
    previousFifths = fifths
    previousTime = time
  })

  lines.push(' </part>')
  lines.push('</score-partwise>')
  return `${lines.join('\n')}\n`
}

export function parseMusicXml(xml: string, options?: { measureLimit?: number }): ImportResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('解析乐谱失败，请检查文件格式。')
  }
  const metadata = parseMusicXmlMetadata(doc)
  const rawMeasureLimit = options?.measureLimit
  const measureLimit =
    typeof rawMeasureLimit === 'number' && Number.isFinite(rawMeasureLimit)
      ? Math.max(1, Math.trunc(rawMeasureLimit))
      : Number.POSITIVE_INFINITY

  const partNodes = Array.from(doc.getElementsByTagName('part'))
  if (partNodes.length === 0) {
    throw new Error('该乐谱文件中未找到 <part> 节点。')
  }

  const measureSlots: {
    notes: Record<StaffKind, ScoreNote[]>
    ticksUsed: Record<StaffKind, number>
    touched: Record<StaffKind, boolean>
    measureTicks: number
  }[] = []
  const measureKeyFifths: number[] = []
  const measureDivisions: number[] = []
  const measureTimeSignatures: TimeSignature[] = []

  const ensureMeasureSlot = (index: number) => {
    if (!measureSlots[index]) {
      measureSlots[index] = {
        notes: { treble: [], bass: [] },
        ticksUsed: { treble: 0, bass: 0 },
        touched: { treble: false, bass: false },
        measureTicks: MEASURE_TICKS,
      }
    }
    return measureSlots[index]
  }

  const lastPitch: Record<StaffKind, Pitch> = { treble: 'c/4', bass: 'c/3' }

  partNodes.forEach((partEl, partIndex) => {
    const measureEls = partEl.getElementsByTagName('measure')
    if (measureEls.length === 0) return

    let divisions = 1
    let currentFifths = 0
    let currentTime: TimeSignature = { beats: 4, beatType: 4 }
    const measureCount = Math.min(measureEls.length, measureLimit)
    for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
      const measureEl = measureEls[measureIndex]
      const slot = ensureMeasureSlot(measureIndex)
      const divisionsText = getFirstTagText(measureEl, 'divisions')
      const maybeDivisions = divisionsText ? Number(divisionsText) : Number.NaN
      if (Number.isFinite(maybeDivisions) && maybeDivisions > 0) {
        divisions = maybeDivisions
      }
      if (measureDivisions[measureIndex] === undefined) {
        measureDivisions[measureIndex] = Math.max(1, Math.round(divisions))
      }

      const beatsText = getFirstTagText(measureEl, 'beats')
      const beatTypeText = getFirstTagText(measureEl, 'beat-type')
      const maybeBeats = beatsText ? Number(beatsText) : Number.NaN
      const maybeBeatType = beatTypeText ? Number(beatTypeText) : Number.NaN
      const nextBeats = Number.isFinite(maybeBeats) && maybeBeats > 0 ? Math.round(maybeBeats) : currentTime.beats
      const nextBeatType =
        Number.isFinite(maybeBeatType) && maybeBeatType > 0 ? Math.round(maybeBeatType) : currentTime.beatType
      currentTime = { beats: nextBeats, beatType: nextBeatType }
      if (measureTimeSignatures[measureIndex] === undefined) {
        measureTimeSignatures[measureIndex] = { ...currentTime }
      }
      slot.measureTicks = getMeasureTicksByTime(currentTime)

      const fifthsText = getFirstTagText(measureEl, 'fifths')
      const maybeFifths = fifthsText ? Number(fifthsText) : Number.NaN
      if (Number.isFinite(maybeFifths)) {
        currentFifths = Math.trunc(maybeFifths)
      }
      if (measureKeyFifths[measureIndex] === undefined) {
        measureKeyFifths[measureIndex] = currentFifths
      }

      const measureAlterState: Record<StaffKind, Map<string, number>> = {
        treble: new Map(),
        bass: new Map(),
      }

      const noteEls = measureEl.getElementsByTagName('note')
      for (let noteIndex = 0; noteIndex < noteEls.length; noteIndex += 1) {
        const noteEl = noteEls[noteIndex]
        const noteData = collectFastNoteData(noteEl)
        if (noteData.isGrace) continue

        const staffText = noteData.staffText
        const staff: StaffKind =
          staffText === '2' ? 'bass' : staffText === '1' ? 'treble' : partNodes.length > 1 && partIndex === 1 ? 'bass' : 'treble'

        const isChordTone = noteData.isChord
        if (isChordTone) {
          if (noteData.isRest) continue
          const chordStep = noteData.pitchStep
          const chordOctave = noteData.pitchOctave
          if (!chordStep || chordOctave === null || STEP_TO_SEMITONE[chordStep] === undefined) continue

          const pitchKey = `${chordStep}${chordOctave}`
          const carriedAlter = measureAlterState[staff].get(pitchKey)
          const accidentalAlter = noteData.accidentalText ? ACCIDENTAL_TEXT_TO_ALTER[noteData.accidentalText] : undefined
          const resolvedAlter =
            noteData.pitchAlter ??
            accidentalAlter ??
            (carriedAlter !== undefined ? carriedAlter : getKeySignatureAlterForStep(chordStep, currentFifths))
          const chordPitch = toPitchFromStepAlter(chordStep, resolvedAlter, chordOctave)
          measureAlterState[staff].set(pitchKey, resolvedAlter)

          const previous = slot.notes[staff][slot.notes[staff].length - 1]
          if (!previous) continue

          const nextChordPitches = previous.chordPitches ? [...previous.chordPitches, chordPitch] : [chordPitch]
          const chordAccidental = (noteData.accidentalText ? ACCIDENTAL_TEXT_TO_SYMBOL[noteData.accidentalText] : undefined) ?? null
          const nextChordAccidentals = previous.chordAccidentals
            ? [...previous.chordAccidentals, chordAccidental]
            : [chordAccidental]

          slot.notes[staff][slot.notes[staff].length - 1] = {
            ...previous,
            chordPitches: nextChordPitches,
            chordAccidentals: nextChordAccidentals,
          }
          continue
        }

        if (slot.ticksUsed[staff] >= slot.measureTicks) continue

        let beats: number | null = null
        if (noteData.typeText) {
          const base = NOTE_TYPE_TO_BEATS[noteData.typeText]
          if (base) {
            beats = base
            let add = base / 2
            for (let dotIndex = 0; dotIndex < noteData.dots; dotIndex += 1) {
              beats += add
              add /= 2
            }
          }
        }
        if (beats === null && noteData.durationValue !== null && divisions > 0) {
          beats = noteData.durationValue / divisions
        }
        if (!beats) continue

        const isRest = noteData.isRest
        let pitch = lastPitch[staff]
        if (!isRest) {
          if (noteData.pitchStep && noteData.pitchOctave !== null && STEP_TO_SEMITONE[noteData.pitchStep] !== undefined) {
            const pitchKey = `${noteData.pitchStep}${noteData.pitchOctave}`
            const carriedAlter = measureAlterState[staff].get(pitchKey)
            const accidentalAlter = noteData.accidentalText ? ACCIDENTAL_TEXT_TO_ALTER[noteData.accidentalText] : undefined
            const resolvedAlter =
              noteData.pitchAlter ??
              accidentalAlter ??
              (carriedAlter !== undefined ? carriedAlter : getKeySignatureAlterForStep(noteData.pitchStep, currentFifths))
            pitch = toPitchFromStepAlter(noteData.pitchStep, resolvedAlter, noteData.pitchOctave)
            measureAlterState[staff].set(pitchKey, resolvedAlter)
          }
        }
        const explicitAccidental = isRest ? undefined : (noteData.accidentalText ? ACCIDENTAL_TEXT_TO_SYMBOL[noteData.accidentalText] : undefined) ?? null
        const notePattern = splitTicksToDurations(beatsToTicks(beats, slot.measureTicks))

        slot.touched[staff] = true
        for (let patternIndex = 0; patternIndex < notePattern.length; patternIndex += 1) {
          const duration = notePattern[patternIndex]
          const durationTicks = DURATION_TICKS[duration]
          if (slot.ticksUsed[staff] + durationTicks > slot.measureTicks) break
          const nextNote: ScoreNote = {
            id: createImportedNoteId(staff),
            pitch,
            duration,
            isRest,
          }
          if (!isRest) {
            nextNote.accidental = patternIndex === 0 ? explicitAccidental : null
          }
          slot.notes[staff].push(nextNote)
          slot.ticksUsed[staff] += durationTicks
        }

        lastPitch[staff] = pitch
      }
    }
  })

  const importedPairs: MeasurePair[] = []
  const importedTrebleNotes: ScoreNote[] = []
  const importedBassNotes: ScoreNote[] = []
  const importedNoteLookup = new Map<string, ImportedNoteLocation>()
  let trebleCarry = 'c/4'
  let bassCarry = 'c/3'

  measureSlots.forEach((slot) => {
    if (!slot || (!slot.touched.treble && !slot.touched.bass)) return

    const treblePitch = getLastPitch(slot.notes.treble, trebleCarry)
    const bassPitch = getLastPitch(slot.notes.bass, bassCarry)
    const treble = fillMissingTicksWithCarryNotes(
      slot.notes.treble,
      'treble',
      slot.ticksUsed.treble,
      treblePitch,
      slot.measureTicks,
    )
    const bass = fillMissingTicksWithCarryNotes(slot.notes.bass, 'bass', slot.ticksUsed.bass, bassPitch, slot.measureTicks)

    const pairIndex = importedPairs.length
    for (let noteIndex = 0; noteIndex < treble.length; noteIndex += 1) {
      const note = treble[noteIndex]
      importedTrebleNotes.push(note)
      importedNoteLookup.set(note.id, { pairIndex, noteIndex, staff: 'treble' })
    }
    for (let noteIndex = 0; noteIndex < bass.length; noteIndex += 1) {
      const note = bass[noteIndex]
      importedBassNotes.push(note)
      importedNoteLookup.set(note.id, { pairIndex, noteIndex, staff: 'bass' })
    }

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
      measureKeyFifths: new Array(fallbackPairs.length).fill(0),
      measureDivisions: new Array(fallbackPairs.length).fill(16),
      measureTimeSignatures: new Array(fallbackPairs.length).fill(null).map(() => ({ beats: 4, beatType: 4 })),
      metadata,
    }
  }

  const alignedKeyFifths =
    measureKeyFifths.length === importedPairs.length
      ? measureKeyFifths
      : importedPairs.map((_, index) => measureKeyFifths[index] ?? measureKeyFifths[index - 1] ?? 0)
  const alignedDivisions = importedPairs.map(
    (_, index) => measureDivisions[index] ?? measureDivisions[index - 1] ?? 16,
  )
  const alignedTimes = importedPairs.map(
    (_, index) => measureTimeSignatures[index] ?? measureTimeSignatures[index - 1] ?? { beats: 4, beatType: 4 },
  )

  return {
    trebleNotes: importedTrebleNotes,
    bassNotes: importedBassNotes,
    measurePairs: importedPairs,
    measureKeyFifths: alignedKeyFifths,
    measureDivisions: alignedDivisions,
    measureTimeSignatures: alignedTimes,
    metadata,
    importedNoteLookup,
  }
}
