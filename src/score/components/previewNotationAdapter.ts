import {
  Accidental,
  BarlineType,
  Beam,
  Dot,
  Formatter,
  Fraction,
  Renderer,
  Stave,
  StaveNote,
  Voice,
} from 'vexflow'
import { buildRenderedNoteKeys, getKeySignatureSpecFromFifths } from '../accidentals'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import { getDurationDots, toVexDuration } from '../layout/demand'
import { resolveEffectiveBoundary } from '../layout/effectiveBoundary'
import { solveHorizontalMeasureWidths } from '../layout/horizontalMeasureWidthSolver'
import {
  resolveActualStartDecorationWidths,
  resolveStartDecorationDisplayMetas,
} from '../layout/startDecorationReserve'
import {
  applyUnifiedTimeAxisSpacing,
  attachMeasureTimelineAxisLayout,
  buildMeasureTimelineBundle,
  resolvePublicAxisLayoutForConsumption,
  type TimeAxisSpacingConfig,
} from '../layout/timeAxisSpacing'
import { getPitchLine } from '../pitchUtils'
import type { MeasurePair, ScoreNote, SpacingLayoutMode, StaffKind, TimeSignature } from '../types'

const STAVE_BODY_HEIGHT_PX = 40
const STAVE_GLYPH_VERTICAL_PAD_PX = 18

// Safety-first rollout switches: keep stable legacy path by default.
const ENABLE_SINGLE_STAFF_MAIN_RULES_FOR_ACCOMPANIMENT = false
const ENABLE_SINGLE_STAFF_MAIN_RULES_FOR_SMART_CHORD = false

type RenderedStaffNote = { vexNote: StaveNote }

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

type SolverResult = {
  totalWidth: number
  measureFrames: PreviewMeasureFrame[]
}

function sanitizeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function sanitizeWidth(value: number, fallback = 1): number {
  return Math.max(1, sanitizeNumber(value, fallback))
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
}): SolverResult {
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
  }).map((value) => sanitizeWidth(value, 1))

  const decorationMetas = resolveStartDecorationDisplayMetas({
    measureCount: definitions.length,
    keyFifthsByPair,
    timeSignaturesByPair,
  })
  const { actualStartDecorationWidthPxByPair } = resolveActualStartDecorationWidths({
    metas: decorationMetas,
    grandStaffLayoutMetrics,
  })

  let cursorX = Math.max(0, paddingX)
  const measureFrames = definitions.map((entry, index) => {
    const startDecorationWidth = Math.max(0, sanitizeNumber(actualStartDecorationWidthPxByPair[index] ?? 0, 0))
    const measureWidth = sanitizeWidth((contentWidths[index] ?? 1) + startDecorationWidth, 1)
    const frame: PreviewMeasureFrame = {
      pairIndex: entry.pairIndex,
      measureX: cursorX,
      measureWidth,
    }
    cursorX += measureWidth
    return frame
  })

  return {
    totalWidth: Math.max(1, Math.ceil(cursorX + Math.max(0, paddingX))),
    measureFrames,
  }
}

function getStemDirection(clef: StaffKind, note: ScoreNote): 1 | -1 {
  const referencePitch = note.chordPitches?.[note.chordPitches.length - 1] ?? note.pitch
  return getPitchLine(clef, referencePitch) < 3 ? 1 : -1
}

function buildSingleStaffStaveNote(params: {
  note: ScoreNote
  noteIndex: number
  clef: StaffKind
  keyFifths: number
}): StaveNote {
  const { note, noteIndex, clef, keyFifths } = params
  const duration = toVexDuration(note.duration)
  const dots = getDurationDots(note.duration)
  const isRest = note.isRest === true

  if (isRest) {
    const restNote = new StaveNote({
      keys: [clef === 'treble' ? 'b/4' : 'd/3'],
      duration: `${duration}r`,
      clef,
    })
    if (dots > 0) Dot.buildAndAttach([restNote], { all: true })
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
  if (dots > 0) Dot.buildAndAttach([staveNote], { all: true })
  renderedKeys.forEach((entry, keyIndex) => {
    if (!entry.accidental) return
    staveNote.addModifier(new Accidental(entry.accidental), keyIndex)
  })
  void noteIndex
  return staveNote
}

function drawLegacySinglePass(params: {
  context: ReturnType<Renderer['getContext']>
  definitions: PreviewSingleStaffMeasure[]
  measureFrames: PreviewMeasureFrame[]
  topY: number
}): { noteCentersByPair: Map<number, number[]>; staffBounds: { top: number; bottom: number } | null } {
  const { context, definitions, measureFrames, topY } = params
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
        noteIndex,
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
    }).setStrict(false)
    voice.addTickables(staveNotes)

    const formatWidth = Math.max(8, stave.getNoteEndX() - stave.getNoteStartX() - 8)
    new Formatter().joinVoices([voice]).format([voice], formatWidth)
    const beams = Beam.generateBeams(staveNotes, {
      groups: [new Fraction(1, 4)],
    })
    voice.draw(context, stave)
    beams.forEach((beam) => beam.setContext(context).draw())

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

function renderLegacySingleStaff(params: {
  context: ReturnType<Renderer['getContext']>
  renderHeight: number
  definitions: PreviewSingleStaffMeasure[]
  measureFrames: PreviewMeasureFrame[]
  totalWidth: number
}): PreviewRenderResult {
  const { context, renderHeight, definitions, measureFrames, totalWidth } = params
  const defaultTop = Math.max(0, Math.round((renderHeight - STAVE_BODY_HEIGHT_PX) / 2))
  const firstPass = drawLegacySinglePass({
    context,
    definitions,
    measureFrames,
    topY: defaultTop,
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
  const secondPass = drawLegacySinglePass({
    context,
    definitions,
    measureFrames,
    topY: defaultTop + shiftY,
  })

  return {
    totalWidth,
    measureFrames,
    noteCentersByPair: secondPass.noteCentersByPair,
    staffBounds: secondPass.staffBounds,
  }
}

function drawSingleStaffMeasureToContext(params: {
  context: ReturnType<Renderer['getContext']>
  definition: PreviewSingleStaffMeasure
  frame: PreviewMeasureFrame
  topY: number
  timeAxisSpacingConfig: TimeAxisSpacingConfig
}): { centers: number[]; staffBounds: { top: number; bottom: number } } {
  const { context, definition, frame, topY, timeAxisSpacingConfig } = params

  const stave = new Stave(frame.measureX, topY, frame.measureWidth)
  stave.setBegBarType(BarlineType.SINGLE)
  stave.setEndBarType(BarlineType.SINGLE)
  if (definition.pairIndex === 0) {
    stave.addClef(definition.clef)
  }
  if (definition.showKeySignature && definition.keyFifths !== 0) {
    stave.addKeySignature(getKeySignatureSpecFromFifths(definition.keyFifths))
  }
  if (definition.showTimeSignature) {
    stave.addTimeSignature(`${definition.timeSignature.beats}/${definition.timeSignature.beatType}`)
  }
  stave.setContext(context).draw()

  const notes = definition.notes
  const staveNotes = notes.map((note, noteIndex) =>
    buildSingleStaffStaveNote({
      note,
      noteIndex,
      clef: definition.clef,
      keyFifths: definition.keyFifths,
    }),
  )

  staveNotes.forEach((vexNote) => {
    vexNote.setStave(stave)
  })

  if (staveNotes.length === 0) {
    return {
      centers: [],
      staffBounds: {
        top: stave.getYForLine(0) - STAVE_GLYPH_VERTICAL_PAD_PX,
        bottom: stave.getYForLine(4) + STAVE_GLYPH_VERTICAL_PAD_PX,
      },
    }
  }

  const voice = new Voice({
    numBeats: definition.timeSignature.beats,
    beatValue: definition.timeSignature.beatType,
  }).setStrict(false)
  voice.addTickables(staveNotes)

  const noteStartX = stave.getNoteStartX()
  const noteEndX = stave.getNoteEndX()
  const formatWidth = sanitizeWidth(noteEndX - noteStartX - 8, 8)
  new Formatter().joinVoices([voice]).format([voice], formatWidth)

  const activeMeasure: MeasurePair =
    definition.clef === 'treble'
      ? { treble: notes, bass: [] }
      : { treble: [], bass: notes }

  const timelineBase = buildMeasureTimelineBundle({
    measure: activeMeasure,
    measureIndex: definition.pairIndex,
    timeSignature: definition.timeSignature,
    spacingConfig: timeAxisSpacingConfig,
    timelineMode: 'merged',
    supplementalSpacingTicks: null,
  })
  const boundary = resolveEffectiveBoundary({
    measureX: frame.measureX,
    measureWidth: frame.measureWidth,
    noteStartX,
    noteEndX,
    showStartDecorations: true,
    showEndDecorations: false,
  })
  const timelineBundle = attachMeasureTimelineAxisLayout({
    bundle: timelineBase,
    effectiveBoundaryStartX: boundary.effectiveStartX,
    effectiveBoundaryEndX: boundary.effectiveEndX,
    widthPx: frame.measureWidth,
    spacingConfig: timeAxisSpacingConfig,
  })

  const rendered = staveNotes.map<RenderedStaffNote>((vexNote) => ({ vexNote }))

  applyUnifiedTimeAxisSpacing({
    measure: activeMeasure,
    noteStartX,
    formatWidth,
    trebleRendered: definition.clef === 'treble' ? rendered : [],
    bassRendered: definition.clef === 'bass' ? rendered : [],
    timelineBundle,
    spacingConfig: timeAxisSpacingConfig,
    publicAxisLayout: resolvePublicAxisLayoutForConsumption(timelineBundle),
    spacingAnchorTicks: timelineBundle.spacingAnchorTicks,
    preferMeasureBarlineAxis: false,
    preferMeasureEndBarlineAxis: true,
  })

  const beams = Beam.generateBeams(staveNotes, { groups: [new Fraction(1, 4)] })
  voice.draw(context, stave)
  beams.forEach((beam) => beam.setContext(context).draw())

  return {
    centers: staveNotes.map((note) => note.getAbsoluteX()).filter((x) => Number.isFinite(x)),
    staffBounds: {
      top: stave.getYForLine(0) - STAVE_GLYPH_VERTICAL_PAD_PX,
      bottom: stave.getYForLine(4) + STAVE_GLYPH_VERTICAL_PAD_PX,
    },
  }
}

function renderSingleStaffMainRules(params: {
  context: ReturnType<Renderer['getContext']>
  renderHeight: number
  definitions: PreviewSingleStaffMeasure[]
  measureFrames: PreviewMeasureFrame[]
  totalWidth: number
  timeAxisSpacingConfig: TimeAxisSpacingConfig
}): PreviewRenderResult {
  const { context, renderHeight, definitions, measureFrames, totalWidth, timeAxisSpacingConfig } = params

  const renderPass = (topY: number) => {
    const noteCentersByPair = new Map<number, number[]>()
    let minTop = Number.POSITIVE_INFINITY
    let maxBottom = Number.NEGATIVE_INFINITY

    definitions.forEach((definition, index) => {
      const frame = measureFrames[index]
      if (!frame) return
      let rendered: { centers: number[]; staffBounds: { top: number; bottom: number } }
      try {
        rendered = drawSingleStaffMeasureToContext({
          context,
          definition,
          frame,
          topY,
          timeAxisSpacingConfig,
        })
      } catch (error) {
        const measureNumber = definition.pairIndex + 1
        console.error(
          `[previewNotationAdapter] main-rule render failed at pairIndex=${definition.pairIndex}, measure=${measureNumber}, staff=${definition.clef}`,
          error,
        )
        throw error
      }
      noteCentersByPair.set(definition.pairIndex, rendered.centers)
      minTop = Math.min(minTop, rendered.staffBounds.top)
      maxBottom = Math.max(maxBottom, rendered.staffBounds.bottom)
    })

    return {
      noteCentersByPair,
      staffBounds:
        Number.isFinite(minTop) && Number.isFinite(maxBottom) && maxBottom > minTop
          ? { top: minTop, bottom: maxBottom }
          : null,
    }
  }

  const firstTop = Math.max(0, Math.round((renderHeight - STAVE_BODY_HEIGHT_PX) / 2))
  const first = renderPass(firstTop)
  if (!first.staffBounds) {
    return {
      totalWidth,
      measureFrames,
      noteCentersByPair: first.noteCentersByPair,
      staffBounds: null,
    }
  }

  const shift = renderHeight / 2 - (first.staffBounds.top + first.staffBounds.bottom) / 2
  if (Math.abs(shift) < 0.5) {
    return {
      totalWidth,
      measureFrames,
      noteCentersByPair: first.noteCentersByPair,
      staffBounds: first.staffBounds,
    }
  }

  context.clearRect(0, 0, totalWidth, renderHeight)
  const second = renderPass(firstTop + shift)
  return {
    totalWidth,
    measureFrames,
    noteCentersByPair: second.noteCentersByPair,
    staffBounds: second.staffBounds,
  }
}

function resolveEnableMainRules(definitions: PreviewSingleStaffMeasure[]): boolean {
  // Heuristic: accompaniment preview renders multiple measures, smart-chord preview renders a single measure.
  const isAccompanimentPreview = definitions.length > 1
  return isAccompanimentPreview
    ? ENABLE_SINGLE_STAFF_MAIN_RULES_FOR_ACCOMPANIMENT
    : ENABLE_SINGLE_STAFF_MAIN_RULES_FOR_SMART_CHORD
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

  if (definitions.length === 0) {
    return {
      totalWidth: Math.max(1, paddingX * 2),
      measureFrames: [],
      noteCentersByPair: new Map(),
      staffBounds: null,
    }
  }

  const safeFallback = (): PreviewRenderResult => ({
    totalWidth: Math.max(1, paddingX * 2),
    measureFrames: definitions.map((definition, index) => ({
      pairIndex: definition.pairIndex,
      measureX: Math.max(0, paddingX + index * 100),
      measureWidth: 100,
    })),
    noteCentersByPair: new Map<number, number[]>(),
    staffBounds: null,
  })

  try {
    const solver = computeMeasureFrames({
      context,
      definitions,
      paddingX,
      timeAxisSpacingConfig,
      grandStaffLayoutMetrics,
    })

    if (resolveEnableMainRules(definitions)) {
      try {
        return renderSingleStaffMainRules({
          context,
          renderHeight,
          definitions,
          measureFrames: solver.measureFrames,
          totalWidth: solver.totalWidth,
          timeAxisSpacingConfig,
        })
      } catch (error) {
        console.error('[previewNotationAdapter] single-staff main-rule path failed, fallback to stable legacy path', error)
      }
    }

    return renderLegacySingleStaff({
      context,
      renderHeight,
      definitions,
      measureFrames: solver.measureFrames,
      totalWidth: solver.totalWidth,
    })
  } catch (error) {
    console.error('[previewNotationAdapter] preview rendering failed, return safe empty layout', error)
    return safeFallback()
  }
}
