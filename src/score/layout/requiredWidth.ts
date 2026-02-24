import { Accidental, BarlineType, Dot, Formatter, Stave, StaveNote, Voice } from 'vexflow'
import { buildRenderedNoteKeys, getKeySignatureSpecFromFifths } from '../accidentals'
import { getStrictStemDirection, getPitchLine } from '../pitchUtils'
import { getDurationDots, toVexDuration, type MeasureRequiredWidthContext } from './demand'
import type { ScoreNote, StaffKind } from '../types'

const PROBE_MEASURE_WIDTH_PX = 1600
const CONTENT_PADDING_PX = 8
const SAFETY_PADDING_PX = 10

const setImplicitClefContext = (stave: Stave, clefSpec: 'treble' | 'bass') => {
  ;(stave as unknown as { clef: string }).clef = clefSpec
}

function buildVexNotesForStaff(notes: ScoreNote[], staff: StaffKind, keyFifths: number): StaveNote[] {
  return notes.map((note) => {
    const isRest = Boolean(note.isRest)
    const rootPitch = isRest ? (staff === 'treble' ? 'b/4' : 'd/3') : note.pitch
    const chordPitches = isRest ? undefined : note.chordPitches
    const renderedKeys = buildRenderedNoteKeys(
      note,
      staff,
      rootPitch,
      chordPitches,
      keyFifths,
      null,
      false,
      null,
      null,
      getPitchLine,
    )
    const dots = getDurationDots(note.duration)
    const vexNote =
      staff === 'treble'
        ? new StaveNote({
            keys: renderedKeys.map((entry) => entry.pitch),
            duration: isRest ? `${toVexDuration(note.duration)}r` : toVexDuration(note.duration),
            dots,
            clef: 'treble',
            stemDirection: getStrictStemDirection(rootPitch),
          })
        : new StaveNote({
            keys: renderedKeys.map((entry) => entry.pitch),
            duration: isRest ? `${toVexDuration(note.duration)}r` : toVexDuration(note.duration),
            dots,
            clef: 'bass',
            autoStem: true,
          })

    if (!isRest) {
      renderedKeys.forEach((entry, keyIndex) => {
        if (!entry.accidental) return
        vexNote.addModifier(new Accidental(entry.accidental), keyIndex)
      })
    }
    if (dots > 0) {
      Dot.buildAndAttach([vexNote], { all: true })
    }
    return vexNote
  })
}

export function estimateRequiredMeasureWidth(context: MeasureRequiredWidthContext): number {
  const {
    measure,
    isSystemStart,
    keyFifths,
    showKeySignature,
    timeSignature,
    showTimeSignature,
    nextTimeSignature,
    showEndTimeSignature,
  } = context

  const trebleStave = new Stave(0, 0, PROBE_MEASURE_WIDTH_PX)
  const bassStave = new Stave(0, 0, PROBE_MEASURE_WIDTH_PX)

  if (isSystemStart) {
    trebleStave.addClef('treble')
    bassStave.addClef('bass')
  } else {
    trebleStave.setBegBarType(BarlineType.NONE)
    bassStave.setBegBarType(BarlineType.NONE)
    setImplicitClefContext(trebleStave, 'treble')
    setImplicitClefContext(bassStave, 'bass')
  }

  if (showKeySignature) {
    const keySignature = getKeySignatureSpecFromFifths(keyFifths)
    trebleStave.addKeySignature(keySignature)
    bassStave.addKeySignature(keySignature)
  }

  if (showTimeSignature) {
    const label = `${timeSignature.beats}/${timeSignature.beatType}`
    trebleStave.addTimeSignature(label)
    bassStave.addTimeSignature(label)
  }

  if (showEndTimeSignature) {
    const endLabel = `${nextTimeSignature.beats}/${nextTimeSignature.beatType}`
    trebleStave.setEndTimeSignature(endLabel)
    bassStave.setEndTimeSignature(endLabel)
  }

  const noteStartX = trebleStave.getNoteStartX()
  const noteEndX = trebleStave.getNoteEndX()
  const leftDecorationWidth = Math.max(0, noteStartX)
  const rightDecorationWidth = Math.max(0, PROBE_MEASURE_WIDTH_PX - noteEndX)

  const trebleVexNotes = buildVexNotesForStaff(measure.treble, 'treble', keyFifths)
  const bassVexNotes = buildVexNotesForStaff(measure.bass, 'bass', keyFifths)
  trebleVexNotes.forEach((note) => note.setStave(trebleStave))
  bassVexNotes.forEach((note) => note.setStave(bassStave))

  const trebleVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(
    trebleVexNotes,
  )
  const bassVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(
    bassVexNotes,
  )

  const formatter = new Formatter().joinVoices([trebleVoice]).joinVoices([bassVoice])
  const minContentWidth = Math.max(1, formatter.preCalculateMinTotalWidth([trebleVoice, bassVoice]))

  const requiredWidth =
    leftDecorationWidth + minContentWidth + CONTENT_PADDING_PX + rightDecorationWidth + SAFETY_PADDING_PX
  return Math.max(1, Math.ceil(requiredWidth))
}
