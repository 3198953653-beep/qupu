import {
  Accidental,
  BarlineType,
  Beam,
  Dot,
  Formatter,
  Fraction,
  Stave,
  StaveNote,
  Voice,
  type Renderer,
} from 'vexflow'
import { buildRenderedNoteKeys, getKeySignatureSpecFromFifths } from '../accidentals'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import { getDurationDots, toVexDuration } from '../layout/demand'
import { solveHorizontalMeasureWidths } from '../layout/horizontalMeasureWidthSolver'
import { resolveActualStartDecorationWidths, resolveStartDecorationDisplayMetas } from '../layout/startDecorationReserve'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import { getPitchLine } from '../pitchUtils'
import type { MeasurePair, ScoreNote, SpacingLayoutMode, StaffKind, TimeSignature } from '../types'

const STAVE_BODY_HEIGHT_PX = 40
const STAVE_GLYPH_VERTICAL_PAD_PX = 18

export type PreviewSingleStaffMeasure = {
  pairIndex: number
  notes: ScoreNote[]
  clef: StaffKind
  keyFifths: number
  timeSignature: TimeSignature
  showKeySignature: boolean
  showTimeSignature: boolean
}

export type PreviewMeasureFrame = {
  pairIndex: number
  measureX: number
  measureWidth: number
}

export type PreviewRenderResult = {
  totalWidth: number
  measureFrames: PreviewMeasureFrame[]
  noteCentersByPair: Map<number, number[]>
  staffBounds: { top: number; bottom: number } | null
}

function buildMirrorRests(params: { notes: ScoreNote[]; staff: StaffKind }): ScoreNote[] {
  const { notes, staff } = params
  const pitch = staff === 'treble' ? 'b/4' : 'd/3'
  return notes.map((note, index) => ({
    id: `preview-mirror-rest-${staff}-${index}`,
    pitch,
    duration: note.duration,
    isRest: true,
  }))
}

function buildMeasurePairsForWidthSolver(definitions: PreviewSingleStaffMeasure[]): MeasurePair[] {
  return definitions.map((entry) => {
    if (entry.clef === 'treble') {
      return {
        treble: entry.notes,
        bass: buildMirrorRests({ notes: entry.notes, staff: 'bass' }),
      }
    }
    return {
      treble: buildMirrorRests({ notes: entry.notes, staff: 'treble' }),
      bass: entry.notes,
    }
  })
}

function computeMeasureFrames(params: {
  context: ReturnType<Renderer['getContext']>
  definitions: PreviewSingleStaffMeasure[]
  paddingX: number
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}): { totalWidth: number; measureFrames: PreviewMeasureFrame[] } {
  const { context, definitions, paddingX, timeAxisSpacingConfig, grandStaffLayoutMetrics } = params
  const keyFifthsByPair = definitions.map((entry) => entry.keyFifths)
  const timeSignaturesByPair = definitions.map((entry) => entry.timeSignature)
  const contentWidths = solveHorizontalMeasureWidths({
    context,
    measurePairs: buildMeasurePairsForWidthSolver(definitions),
    measureKeyFifthsByPair: keyFifthsByPair,
    measureTimeSignaturesByPair: timeSignaturesByPair,
    spacingConfig: timeAxisSpacingConfig,
    grandStaffLayoutMetrics,
  })
  const decorationMetas = resolveStartDecorationDisplayMetas({
    measureCount: definitions.length,
    keyFifthsByPair,
    timeSignaturesByPair,
  })
  const { actualStartDecorationWidthPxByPair } = resolveActualStartDecorationWidths({
    metas: decorationMetas,
    grandStaffLayoutMetrics,
  })

  let cursorX = paddingX
  const measureFrames = definitions.map((entry, index) => {
    const startDecorationWidth = actualStartDecorationWidthPxByPair[index] ?? 0
    const measureWidth = Math.max(1, (contentWidths[index] ?? 1) + startDecorationWidth)
    const frame: PreviewMeasureFrame = {
      pairIndex: entry.pairIndex,
      measureX: cursorX,
      measureWidth,
    }
    cursorX += measureWidth
    return frame
  })

  return {
    totalWidth: Math.max(1, Math.ceil(cursorX + paddingX)),
    measureFrames,
  }
}

function getStemDirection(clef: StaffKind, note: ScoreNote): 1 | -1 {
  const referencePitch = note.chordPitches?.[note.chordPitches.length - 1] ?? note.pitch
  return getPitchLine(clef, referencePitch) < 3 ? 1 : -1
}

function buildSingleStaffStaveNote(params: {
  note: ScoreNote
  index: number
  clef: StaffKind
  keyFifths: number
}): StaveNote {
  const { note, index, clef, keyFifths } = params
  const duration = toVexDuration(note.duration)
  const dots = getDurationDots(note.duration)
  const isRest = note.isRest === true

  if (isRest) {
    const restNote = new StaveNote({
      keys: [clef === 'treble' ? 'b/4' : 'd/3'],
      duration: `${duration}r`,
      clef,
    })
    if (dots > 0) {
      Dot.buildAndAttach([restNote], { all: true })
    }
    return restNote
  }

  const rootPitch = note.pitch
  const chordPitches = note.chordPitches ?? []
  const renderedKeys = buildRenderedNoteKeys(
    note,
    clef,
    rootPitch,
    chordPitches,
    keyFifths,
    null,
    null,
    null,
    getPitchLine,
  )
  const staveNote = new StaveNote({
    keys: renderedKeys.map((entry) => entry.pitch),
    duration,
    clef,
    stemDirection: getStemDirection(clef, note),
  })
  if (dots > 0) {
    Dot.buildAndAttach([staveNote], { all: true })
  }
  renderedKeys.forEach((entry, keyIndex) => {
    if (!entry.accidental) return
    staveNote.addModifier(new Accidental(entry.accidental), keyIndex)
  })
  void index
  return staveNote
}

function drawSinglePass(params: {
  context: ReturnType<Renderer['getContext']>
  renderHeight: number
  definitions: PreviewSingleStaffMeasure[]
  measureFrames: PreviewMeasureFrame[]
  topY: number
  spacingLayoutMode: SpacingLayoutMode
}): { noteCentersByPair: Map<number, number[]>; staffBounds: { top: number; bottom: number } | null } {
  const { context, renderHeight, definitions, measureFrames, topY } = params
  void renderHeight
  const noteCentersByPair = new Map<number, number[]>()
  let minTop = Number.POSITIVE_INFINITY
  let maxBottom = Number.NEGATIVE_INFINITY

  definitions.forEach((definition, index) => {
    const frame = measureFrames[index]
    if (!frame) return
    const stave = new Stave(frame.measureX, topY, frame.measureWidth)
    stave.setBegBarType(BarlineType.SINGLE)
    stave.setEndBarType(index === definitions.length - 1 ? BarlineType.END : BarlineType.SINGLE)
    if (index === 0) {
      stave.addClef(definition.clef)
    }
    if (definition.showKeySignature && definition.keyFifths !== 0) {
      stave.addKeySignature(getKeySignatureSpecFromFifths(definition.keyFifths))
    }
    if (definition.showTimeSignature) {
      stave.addTimeSignature(`${definition.timeSignature.beats}/${definition.timeSignature.beatType}`)
    }
    stave.setContext(context).draw()

    const staveNotes = definition.notes.map((note, noteIndex) =>
      buildSingleStaffStaveNote({
        note,
        index: noteIndex,
        clef: definition.clef,
        keyFifths: definition.keyFifths,
      }))
    if (staveNotes.length === 0) {
      noteCentersByPair.set(definition.pairIndex, [])
      return
    }

    const voice = new Voice({
      numBeats: definition.timeSignature.beats,
      beatValue: definition.timeSignature.beatType,
    }).setStrict(false).addTickables(staveNotes)

    const formatWidth = Math.max(8, stave.getNoteEndX() - stave.getNoteStartX() - 8)
    new Formatter().joinVoices([voice]).format([voice], formatWidth)
    const beams = Beam.generateBeams(staveNotes, {
      groups: [new Fraction(1, 4)],
    })
    voice.draw(context, stave)
    beams.forEach((beam) => {
      beam.setContext(context).draw()
    })

    const centers = [...staveNotes]
      .map((note) => note.getAbsoluteX())
      .filter((x) => Number.isFinite(x))
    noteCentersByPair.set(definition.pairIndex, centers)

    const top = stave.getYForLine(0) - STAVE_GLYPH_VERTICAL_PAD_PX
    const bottom = stave.getYForLine(4) + STAVE_GLYPH_VERTICAL_PAD_PX
    minTop = Math.min(minTop, top)
    maxBottom = Math.max(maxBottom, bottom)
  })

  return {
    noteCentersByPair,
    staffBounds:
      Number.isFinite(minTop) && Number.isFinite(maxBottom) && maxBottom > minTop
        ? { top: minTop, bottom: maxBottom }
        : null,
  }
}

export function renderPreviewWithMainLayout(params: {
  context: ReturnType<Renderer['getContext']>
  renderHeight: number
  definitions: PreviewSingleStaffMeasure[]
  paddingX: number
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}): PreviewRenderResult {
  const {
    context,
    renderHeight,
    definitions,
    paddingX,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    grandStaffLayoutMetrics,
  } = params
  void spacingLayoutMode

  const { totalWidth, measureFrames } = computeMeasureFrames({
    context,
    definitions,
    paddingX,
    timeAxisSpacingConfig,
    grandStaffLayoutMetrics,
  })
  const defaultTop = Math.max(0, Math.round((renderHeight - STAVE_BODY_HEIGHT_PX) / 2))
  const firstPass = drawSinglePass({
    context,
    renderHeight,
    definitions,
    measureFrames,
    topY: defaultTop,
    spacingLayoutMode,
  })
  const bounds = firstPass.staffBounds
  if (!bounds) {
    return {
      totalWidth,
      measureFrames,
      noteCentersByPair: firstPass.noteCentersByPair,
      staffBounds: null,
    }
  }

  const targetCenterY = renderHeight / 2
  const currentCenterY = (bounds.top + bounds.bottom) / 2
  const shiftY = targetCenterY - currentCenterY
  if (Math.abs(shiftY) < 0.5) {
    return {
      totalWidth,
      measureFrames,
      noteCentersByPair: firstPass.noteCentersByPair,
      staffBounds: bounds,
    }
  }

  context.clearRect(0, 0, totalWidth, renderHeight)
  const secondPass = drawSinglePass({
    context,
    renderHeight,
    definitions,
    measureFrames,
    topY: defaultTop + shiftY,
    spacingLayoutMode,
  })
  return {
    totalWidth,
    measureFrames,
    noteCentersByPair: secondPass.noteCentersByPair,
    staffBounds: secondPass.staffBounds,
  }
}
