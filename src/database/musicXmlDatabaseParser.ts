import { identifyImportedChordLabel, type ImportedChordPitch } from '../score/importedChordRuler'
import type { NoteEntryDraftRow, TemplateEntryDraftRow } from './types'

type ParsedXmlNote = {
  step: string
  octave: number
  alter: number
  duration: number
  startTime: number
  staff: number
  midi: number
}

type ParsedXmlScore = {
  divisions: number
  parts: Record<string, Record<number, ParsedXmlNote[]>>
  totalMeasures: number
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const PITCH_CLASS_MAP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function safeInt(value: string | null | undefined, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback
}

function parseXml(xmlText: string): Document {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error(parserError.textContent?.trim() || 'MusicXML 解析失败。')
  }
  return doc
}

function noteToImportedPitch(note: ParsedXmlNote): ImportedChordPitch {
  return {
    step: note.step,
    alter: note.alter,
    octave: note.octave,
    midi: note.midi,
  }
}

function midiToSharpNoteName(midi: number): string {
  const safeMidi = Math.max(0, Math.min(127, Math.round(midi)))
  const octave = Math.floor(safeMidi / 12) - 1
  const pitchClass = safeMidi % 12
  return `${NOTE_NAMES_SHARP[pitchClass] ?? 'C'}${octave}`
}

function buildParsedScore(xmlText: string): ParsedXmlScore {
  const doc = parseXml(xmlText)
  const parts: ParsedXmlScore['parts'] = {}
  let currentDivisions = 256
  let totalMeasures = 0

  Array.from(doc.getElementsByTagName('part')).forEach((partElement, partIndex) => {
    const partId = partElement.getAttribute('id')?.trim() || `P${partIndex + 1}`
    const measures: Record<number, ParsedXmlNote[]> = {}

    Array.from(partElement.getElementsByTagName('measure')).forEach((measureElement, measureIndex) => {
      const measureNumber = safeInt(measureElement.getAttribute('number'), measureIndex + 1)
      totalMeasures = Math.max(totalMeasures, measureNumber)
      const divisionsNode = measureElement.querySelector('attributes > divisions')
      if (divisionsNode?.textContent?.trim()) {
        currentDivisions = safeInt(divisionsNode.textContent, currentDivisions)
      }
      let currentTime = 0
      const notesInMeasure: ParsedXmlNote[] = []
      Array.from(measureElement.children).forEach((child) => {
        const tag = child.tagName.toLowerCase()
        if (tag === 'backup') {
          currentTime -= safeInt(child.querySelector('duration')?.textContent, 0)
          return
        }
        if (tag === 'forward') {
          currentTime += safeInt(child.querySelector('duration')?.textContent, 0)
          return
        }
        if (tag !== 'note') return

        const isRest = child.querySelector('rest') !== null
        const duration = safeInt(child.querySelector('duration')?.textContent, 0)
        const staff = safeInt(child.querySelector('staff')?.textContent, 1)
        const isChord = child.querySelector('chord') !== null
        const pitchNode = child.querySelector('pitch')

        if (isRest || !pitchNode) {
          if (!isChord) currentTime += duration
          return
        }

        const step = pitchNode.querySelector('step')?.textContent?.trim().toUpperCase() || 'C'
        const octave = safeInt(pitchNode.querySelector('octave')?.textContent, 4)
        const alter = safeInt(pitchNode.querySelector('alter')?.textContent, 0)
        const base = PITCH_CLASS_MAP[step] ?? 0
        const startTime = isChord ? (notesInMeasure[notesInMeasure.length - 1]?.startTime ?? currentTime) : currentTime
        notesInMeasure.push({
          step,
          octave,
          alter,
          duration,
          startTime,
          staff,
          midi: (octave + 1) * 12 + base + alter,
        })
        if (!isChord) currentTime += duration
      })
      notesInMeasure.sort((left, right) => left.startTime - right.startTime || left.midi - right.midi)
      measures[measureNumber] = notesInMeasure
    })

    parts[partId] = measures
  })

  if (totalMeasures <= 0) {
    totalMeasures = Object.values(parts)
      .flatMap((measureMap) => Object.keys(measureMap).map((value) => Number(value)))
      .reduce((max, value) => (Number.isFinite(value) ? Math.max(max, value) : max), 1)
  }

  return {
    divisions: currentDivisions,
    parts,
    totalMeasures: Math.max(1, totalMeasures),
  }
}

function getNotesInRange(
  score: ParsedXmlScore,
  partId: string,
  measureNumber: number,
  startTick: number,
  endTick: number,
  targetStaff?: number,
): ParsedXmlNote[] {
  const notes = score.parts[partId]?.[measureNumber] ?? []
  return notes.filter((note) => {
    if (note.startTime < startTick || note.startTime >= endTick) return false
    if (targetStaff !== undefined && note.staff !== targetStaff) return false
    return true
  })
}

function groupByStartTime(notes: ParsedXmlNote[]): ParsedXmlNote[][] {
  const groups = new Map<number, ParsedXmlNote[]>()
  notes.forEach((note) => {
    const bucket = groups.get(note.startTime) ?? []
    bucket.push(note)
    groups.set(note.startTime, bucket)
  })
  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1].slice().sort((left, right) => left.midi - right.midi))
}

function formatDuration(durationTicks: number, divisions: number): string {
  if (!Number.isFinite(divisions) || divisions <= 0) return '0'
  const beats = durationTicks / divisions
  return Number.isInteger(beats) ? String(Math.trunc(beats)) : String(Math.round(beats * 1000) / 1000)
}

function computePatternDurations(patternData: string): { totalDuration: number | null; durationCombo: string | null } {
  const lines = String(patternData ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return { totalDuration: null, durationCombo: null }
  }

  const first = lines[0] ?? ''
  if (first.includes(':') && first.split(':', 1)[0]?.startsWith('P')) {
    const ref = first.split(':', 2)[1] ?? ''
    const measureTotals = ref
      .split('|')
      .map((measureEntry) => measureEntry.split(',').reduce((total, value) => total + (Number(value) || 0), 0))
    const totalDuration = measureTotals.reduce((total, value) => total + value, 0)
    return {
      totalDuration: Number.isInteger(totalDuration) ? totalDuration : null,
      durationCombo: measureTotals.length > 0 ? measureTotals.map((value) => String(value)).join('_') : null,
    }
  }

  const values = lines
    .map((line) => line.split('|')[1]?.trim() ?? '')
    .filter((value) => value.length > 0)
  const total = values.reduce((sum, value) => sum + (Number(value) || 0), 0)
  return {
    totalDuration: Number.isInteger(total) ? total : null,
    durationCombo: values.length > 0 ? values.join('_') : null,
  }
}

function detectSegments(score: ParsedXmlScore, segmentPartId: string): Array<{ start: number; end: number }> {
  const segmentMeasures = Object.keys(score.parts[segmentPartId] ?? {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)

  const anchors = segmentMeasures.filter((measureNumber) => (score.parts[segmentPartId]?.[measureNumber] ?? []).length > 0)
  if (anchors.length === 0) {
    return [{ start: 1, end: score.totalMeasures }]
  }

  return anchors.map((start, index) => ({
    start,
    end: index + 1 < anchors.length ? Math.max(start, anchors[index + 1]! - 1) : score.totalMeasures,
  }))
}

function buildFileBaseName(fileName: string): string {
  return String(fileName ?? '').replace(/\.[^.]+$/, '') || '未命名'
}

function buildSegmentName(baseName: string, index: number, total: number): string {
  if (total <= 1) return baseName
  return `${baseName}-段落${index + 1}`
}

function analyzePatternWithMeasures(score: ParsedXmlScore): { byMeasure: Record<number, string[]>; flat: string[] } {
  const melodyPartId = 'P1'
  const chordPartId = 'P3'
  const byMeasure: Record<number, string[]> = {}
  const flat: string[] = []

  const chordPartMeasures = score.parts[chordPartId]
  if (!chordPartMeasures) {
    const measureNumbers = Object.keys(score.parts[melodyPartId] ?? {})
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)
    measureNumbers.forEach((measureNumber) => {
      const grouped = groupByStartTime((score.parts[melodyPartId]?.[measureNumber] ?? []).filter((note) => note.staff === 2))
      if (grouped.length === 0) return
      const noteStrings = grouped.map((group) => group.map((note) => midiToSharpNoteName(note.midi)).join('+'))
      const durationStrings = grouped.map((group) => formatDuration(group[0]?.duration ?? score.divisions, score.divisions))
      const totalDuration = grouped.reduce((sum, group) => sum + (group[0]?.duration ?? 0), 0)
      const line = `-|${formatDuration(totalDuration, score.divisions)}|${noteStrings.join(',')}|${durationStrings.join(',')}|${grouped.length}`
      byMeasure[measureNumber] = [line]
      flat.push(line)
    })
    return { byMeasure, flat }
  }

  const measureNumbers = Object.keys(chordPartMeasures)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)

  measureNumbers.forEach((measureNumber) => {
    const chordGroups = groupByStartTime(chordPartMeasures[measureNumber] ?? [])
    const groupedByChord = new Map<string, Array<{ ticks: number; notesSeq: string; dursSeq: string; count: number }>>()

    chordGroups.forEach((chordGroup) => {
      const maxDuration = Math.max(...chordGroup.map((note) => note.duration), score.divisions) || score.divisions
      const startTick = chordGroup[0]?.startTime ?? 0
      const endTick = startTick + (maxDuration || score.divisions)
      const chordName = identifyImportedChordLabel(chordGroup.map(noteToImportedPitch))
      const bassNotes = getNotesInRange(score, melodyPartId, measureNumber, startTick, endTick, 2)
      if (bassNotes.length === 0) return
      const groupedBass = groupByStartTime(bassNotes)
      const notesSeq = groupedBass.map((group) => group.map((note) => midiToSharpNoteName(note.midi)).join('+')).join(',')
      const dursSeq = groupedBass.map((group) => formatDuration(group[0]?.duration ?? score.divisions, score.divisions)).join(',')
      const entry = {
        ticks: maxDuration || score.divisions,
        notesSeq,
        dursSeq,
        count: groupedBass.length,
      }
      const bucket = groupedByChord.get(chordName) ?? []
      bucket.push(entry)
      groupedByChord.set(chordName, bucket)
    })

    const lines = [...groupedByChord.entries()].map(([chordName, entries]) => {
      if (entries.length === 1) {
        const entry = entries[0]!
        return `${chordName}|${formatDuration(entry.ticks, score.divisions)}|${entry.notesSeq}|${entry.dursSeq}|${entry.count}`
      }
      const totalTicks = entries.reduce((sum, entry) => sum + entry.ticks, 0)
      const mergedNotes = entries.map((entry) => entry.notesSeq).filter(Boolean).join(',')
      const mergedDurs = entries.map((entry) => entry.dursSeq).filter(Boolean).join(',')
      const countText = entries.map((entry) => String(entry.count)).join('+')
      return `${chordName}|${formatDuration(totalTicks, score.divisions)}|${mergedNotes}|${mergedDurs}|${countText}`
    })

    byMeasure[measureNumber] = lines
    flat.push(...lines)
  })

  return { byMeasure, flat }
}

export function analyzeAccompanimentNoteFile(xmlText: string, fileName: string): NoteEntryDraftRow[] {
  const score = buildParsedScore(xmlText)
  const melodyPartId = 'P1'
  const chordPartId = 'P3'
  const chordMeasures = score.parts[chordPartId]
  if (!chordMeasures) {
    throw new Error('找不到和弦声部 (P3)。请检查 MusicXML 文件结构。')
  }

  const rows: NoteEntryDraftRow[] = []
  const measureNumbers = Object.keys(chordMeasures)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)

  measureNumbers.forEach((measureNumber) => {
    const chordGroups = groupByStartTime(chordMeasures[measureNumber] ?? [])
    chordGroups.forEach((chordGroup) => {
      const maxDuration = Math.max(...chordGroup.map((note) => note.duration), score.divisions) || score.divisions
      const startTick = chordGroup[0]?.startTime ?? 0
      const endTick = startTick + maxDuration
      const accompanimentNotes = getNotesInRange(score, melodyPartId, measureNumber, startTick, endTick, 2)
      if (accompanimentNotes.length === 0) return
      const grouped = groupByStartTime(accompanimentNotes)
      const formattedStrings = grouped.map((group) => group.map((note) => midiToSharpNoteName(note.midi)).join('+'))
      const directionPitches = grouped.map((group) => group[group.length - 1]?.midi ?? 0)
      const directions: string[] = []
      for (let index = 0; index < directionPitches.length - 1; index += 1) {
        const delta = directionPitches[index + 1]! - directionPitches[index]!
        directions.push(delta > 0 ? '上' : delta < 0 ? '下' : '平')
      }
      rows.push({
        notes: formattedStrings.join('_'),
        noteCount: grouped.length,
        chordType: identifyImportedChordLabel(chordGroup.map(noteToImportedPitch)),
        chordIndex: formattedStrings
          .map((token, index) => (token.includes('+') ? String(index + 1) : ''))
          .filter(Boolean)
          .join(','),
        noteDirection: directions.length > 0 ? directions.join('') : '-',
        structure: grouped.some((group) => group.length > 1) ? '单音＋和弦' : '单音',
        styleTags: '',
        specialTags: '',
        isCommon: false,
        filePath: fileName,
      })
    })
  })

  return rows
}

export function analyzeAccompanimentTemplateFile(xmlText: string, fileName: string): TemplateEntryDraftRow[] {
  const score = buildParsedScore(xmlText)
  const { byMeasure } = analyzePatternWithMeasures(score)
  const segments = detectSegments(score, 'P4')
  const baseName = buildFileBaseName(fileName)

  return segments.map((segment, index, list) => {
    const lines = Array.from({ length: segment.end - segment.start + 1 }, (_, offset) => byMeasure[segment.start + offset] ?? [])
      .flat()
      .filter((line) => line.trim().length > 0)
    const patternData = lines.join('\n')
    const { totalDuration, durationCombo } = computePatternDurations(patternData)
    return {
      name: buildSegmentName(baseName, index, list.length),
      filePath: fileName,
      patternData,
      totalDuration,
      durationCombo: durationCombo ?? '',
      difficultyTags: '',
      styleTags: '',
    }
  }).filter((row) => row.patternData.trim().length > 0)
}

export function analyzeRhythmTemplateFile(xmlText: string, fileName: string): TemplateEntryDraftRow[] {
  const score = buildParsedScore(xmlText)
  const segments = detectSegments(score, 'P5')
  const baseName = buildFileBaseName(fileName)
  const partIds = ['P1', 'P2', 'P3', 'P4']

  return segments.map((segment, index, list) => {
    const lines = partIds
      .filter((partId) => score.parts[partId])
      .map((partId) => {
        const measureStrings = Array.from({ length: segment.end - segment.start + 1 }, (_, offset) => {
          const measureNumber = segment.start + offset
          const groups = groupByStartTime(score.parts[partId]?.[measureNumber] ?? [])
          return groups
            .map((group) => formatDuration(group[0]?.duration ?? score.divisions, score.divisions))
            .join(',')
        })
        return `${partId}:${measureStrings.join('|')}`
      })
      .filter((line) => line.trim().length > 0)
    const patternData = lines.join('\n')
    const { totalDuration, durationCombo } = computePatternDurations(patternData)
    return {
      name: buildSegmentName(baseName, index, list.length),
      filePath: fileName,
      patternData,
      totalDuration,
      durationCombo: durationCombo ?? '',
      difficultyTags: '',
      styleTags: '',
    }
  }).filter((row) => row.patternData.trim().length > 0)
}
