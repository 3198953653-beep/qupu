import { Accidental, BarlineType, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveConnector, StaveNote, StaveTie, Voice } from 'vexflow'
import { PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX, TICKS_PER_BEAT } from '../constants'
import {
  buildRenderedNoteKeys,
  getAccidentalStateKey,
  getEffectiveAlterFromContext,
  getKeySignatureSpecFromFifths,
  getRequiredAccidentalForTargetAlter,
} from '../accidentals'
import { getDurationDots, toVexDuration } from '../layout/demand'
import {
  addModifierXShift,
  deltaOrNull,
  finiteOrNull,
  getAccidentalRightXByRenderedIndex,
  getAccidentalVisualX,
  getLayoutNoteKey,
  getRenderedNoteVisualX,
} from '../layout/renderPosition'
import { applyUnifiedTimeAxisSpacing } from '../layout/timeAxisSpacing'
import type { AppliedTimeAxisSpacingMetrics, TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import { getStepOctaveAlterFromPitch } from '../pitchMath'
import { buildPitchLineMap, createPianoPitches, getPitchLine, getStrictStemDirection } from '../pitchUtils'
import { getTieFrozenIncoming } from '../tieFrozen'
import { getDragPreviewTargetKey } from './dragPreviewOverrides'
import { buildTieLayout } from './tieLayoutGeometry'
import type { RenderedNoteKey } from '../accidentals'
import type { PublicAxisLayout } from '../timeline/types'
import type {
  DragDebugRow,
  DragDebugSnapshot,
  DragDebugStaticRecord,
  MeasurePair,
  NoteLayout,
  Pitch,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
  StaffKind,
  TieEndpoint,
  TieLayout,
  TimeSignature,
} from '../types'

const PITCHES: Pitch[] = createPianoPitches()
const PITCH_LINE_MAP: Record<StaffKind, Record<Pitch, number>> = {
  treble: buildPitchLineMap('treble', PITCHES),
  bass: buildPitchLineMap('bass', PITCHES),
}
const VALID_BEAM_DURATIONS = ['4', '8', '16', '32', '64'] as const
const ACCIDENTAL_HEAD_CLEARANCE_PX = 2
const STEM_INVARIANT_RIGHT_PADDING_PX = 3.5
const MIN_FORMAT_WIDTH_PX = 8
const DEFAULT_NOTE_HEAD_HIT_RADIUS_X = 5.5
const DEFAULT_NOTE_HEAD_HIT_RADIUS_Y = 4.2
const DEFAULT_ACCIDENTAL_HIT_RADIUS_Y = 7

function getRestAnchorPitch(staff: StaffKind): Pitch {
  return staff === 'treble' ? 'b/4' : 'd/3'
}

type NoteHeadHitGeometry = {
  hitCenterX: number
  hitCenterY: number
  hitRadiusX: number
  hitRadiusY: number
  hitMinX: number
  hitMaxX: number
  hitMinY: number
  hitMaxY: number
}

type AccidentalHitGeometry = {
  hitCenterX: number
  hitCenterY: number
  hitRadiusX: number
  hitRadiusY: number
  hitMinX: number
  hitMaxX: number
  hitMinY: number
  hitMaxY: number
}

function buildNoteHeadHitGeometry(params: {
  vexNote: StaveNote
  renderedIndex: number
  headX: number
  headY: number
}): NoteHeadHitGeometry {
  const { vexNote, renderedIndex, headX, headY } = params
  const fallbackCenterX = headX + 6
  const fallbackCenterY = headY
  let centerX = fallbackCenterX
  let centerY = fallbackCenterY
  let radiusX = DEFAULT_NOTE_HEAD_HIT_RADIUS_X
  let radiusY = DEFAULT_NOTE_HEAD_HIT_RADIUS_Y

  const noteHead = (vexNote.noteHeads?.[renderedIndex] ?? null) as
    | {
        getBoundingBox?: () =>
          | {
              getX: () => number
              getY: () => number
              getW: () => number
              getH: () => number
            }
          | null
      }
    | null
  const bbox = noteHead?.getBoundingBox?.() ?? null
  if (bbox) {
    const x = bbox.getX()
    const y = bbox.getY()
    const w = bbox.getW()
    const h = bbox.getH()
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      centerX = x + w / 2
      centerY = y + h / 2
      radiusX = Math.max(2, w / 2)
      radiusY = Math.max(2, h / 2)
    }
  }

  return {
    hitCenterX: centerX,
    hitCenterY: centerY,
    hitRadiusX: radiusX,
    hitRadiusY: radiusY,
    hitMinX: centerX - radiusX,
    hitMaxX: centerX + radiusX,
    hitMinY: centerY - radiusY,
    hitMaxY: centerY + radiusY,
  }
}

function buildAccidentalHitGeometry(params: {
  centerX: number
  centerY: number
  width: number
}): AccidentalHitGeometry {
  const { centerX, centerY, width } = params
  const radiusX = Math.max(2, width / 2)
  const radiusY = Math.max(DEFAULT_ACCIDENTAL_HIT_RADIUS_Y, radiusX + 1)
  return {
    hitCenterX: centerX,
    hitCenterY: centerY,
    hitRadiusX: radiusX,
    hitRadiusY: radiusY,
    hitMinX: centerX - radiusX,
    hitMaxX: centerX + radiusX,
    hitMinY: centerY - radiusY,
    hitMaxY: centerY + radiusY,
  }
}

type PreviewNoteOverride = {
  noteId: string
  staff: StaffKind
  pitch: Pitch
  keyIndex: number
}

export type DrawMeasureParams = {
  context: ReturnType<Renderer['getContext']>
  measure: MeasurePair
  pairIndex: number
  measureX: number
  measureWidth: number
  trebleY: number
  bassY: number
  isSystemStart: boolean
  keyFifths: number
  showKeySignature: boolean
  timeSignature: TimeSignature
  showTimeSignature: boolean
  endTimeSignature?: TimeSignature | null
  showEndTimeSignature?: boolean
  activeSelection: Selection | null
  activeAccidentalSelection?: Selection | null
  activeTieSegmentKey?: string | null
  draggingSelection: Selection | null
  activeSelections?: Selection[] | null
  draggingSelections?: Selection[] | null
  highlightStaff?: StaffKind | null
  previewNotes?: PreviewNoteOverride[] | null
  previewNote?: { noteId: string; staff: StaffKind; pitch: Pitch; keyIndex: number } | null
  previewAccidentalStateBeforeNote?: Map<string, number> | null
  previewFrozenBoundaryCurve?: {
    fromPairIndex: number
    fromStaff: StaffKind
    fromNoteId: string
    fromKeyIndex: number
    toPairIndex: number
    toStaff: StaffKind
    toNoteId: string
    toKeyIndex: number
    startX: number
    startY: number
    endX: number
    endY: number
  } | null
  suppressedTieStartKeys?: Set<string> | null
  suppressedTieStopKeys?: Set<string> | null
  collectLayouts?: boolean
  suppressSystemDecorations?: boolean
  noteStartXOverride?: number
  freezePreviewAccidentalLayout?: boolean
  formatWidthOverride?: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  spacingLayoutMode?: SpacingLayoutMode
  layoutDetail?: 'full' | 'spacing-only'
  skipPainting?: boolean
  staticNoteXById?: Map<string, number> | null
  staticAccidentalRightXById?: Map<string, Map<number, number>> | null
  publicAxisLayout?: PublicAxisLayout | null
  preferMeasureBarlineAxis?: boolean
  preferMeasureEndBarlineAxis?: boolean
  enableEdgeGapCap?: boolean
  onSpacingMetrics?: (metrics: AppliedTimeAxisSpacingMetrics | null) => void
  debugCapture?: {
    frame: number
    draggedNoteId: string
    draggedStaff: StaffKind
    staticByNoteKey: Map<string, DragDebugStaticRecord>
    pushSnapshot: (snapshot: DragDebugSnapshot) => void
  } | null
  renderBoundaryPartialTies?: boolean
  forceLeadingConnector?: boolean
  onStaffLineBounds?: (bounds: {
    trebleLineTopY: number
    trebleLineBottomY: number
    bassLineTopY: number
    bassLineBottomY: number
  }) => void
}

export const drawMeasureToContext = (params: DrawMeasureParams): NoteLayout[] => {
  const {
    context,
    measure,
    pairIndex,
    measureX,
    measureWidth,
    trebleY,
    bassY,
    isSystemStart,
    keyFifths,
    showKeySignature,
    timeSignature,
    showTimeSignature,
    endTimeSignature = null,
    showEndTimeSignature = false,
    activeSelection: selection,
    activeAccidentalSelection = null,
    activeTieSegmentKey = null,
    draggingSelection: dragging,
    activeSelections = null,
    draggingSelections = null,
    highlightStaff = null,
    previewNotes = null,
    previewNote = null,
    previewAccidentalStateBeforeNote = null,
    previewFrozenBoundaryCurve = null,
    suppressedTieStartKeys = null,
    suppressedTieStopKeys = null,
    collectLayouts = true,
    suppressSystemDecorations = false,
    noteStartXOverride,
    freezePreviewAccidentalLayout = false,
    formatWidthOverride,
    timeAxisSpacingConfig,
    spacingLayoutMode = 'custom',
    layoutDetail = 'full',
    skipPainting = false,
    staticNoteXById = null,
    staticAccidentalRightXById = null,
    publicAxisLayout = null,
    preferMeasureBarlineAxis = !isSystemStart && !showKeySignature && !showTimeSignature,
    preferMeasureEndBarlineAxis = !showEndTimeSignature,
    enableEdgeGapCap = true,
    onSpacingMetrics,
    debugCapture = null,
    renderBoundaryPartialTies = true,
    forceLeadingConnector = false,
    onStaffLineBounds,
  } = params
  const isSpacingOnlyLayout = layoutDetail === 'spacing-only'
  const noteLayouts: NoteLayout[] = []
  const timeSignatureLabel = `${timeSignature.beats}/${timeSignature.beatType}`
  const endTimeSignatureLabel =
    showEndTimeSignature && endTimeSignature ? `${endTimeSignature.beats}/${endTimeSignature.beatType}` : null
  const normalizedPreviewNotes = previewNotes ?? (previewNote ? [previewNote] : [])
  const previewNoteByLayoutKey = new Map<string, PreviewNoteOverride>()
  normalizedPreviewNotes.forEach((entry) => {
    previewNoteByLayoutKey.set(getLayoutNoteKey(entry.staff, entry.noteId), entry)
  })
  const selectionEntries: Selection[] = selection ? [selection] : []
  const draggingEntries: Selection[] = dragging ? [dragging] : []
  activeSelections?.forEach((entry) => selectionEntries.push(entry))
  draggingSelections?.forEach((entry) => draggingEntries.push(entry))
  const selectionKeySetByLayout = new Map<string, Set<number>>()
  const draggingKeySetByLayout = new Map<string, Set<number>>()
  const appendSelectionKey = (
    store: Map<string, Set<number>>,
    selectionEntry: Selection,
  ) => {
    const key = getLayoutNoteKey(selectionEntry.staff, selectionEntry.noteId)
    const current = store.get(key)
    if (current) {
      current.add(selectionEntry.keyIndex)
      return
    }
    store.set(key, new Set([selectionEntry.keyIndex]))
  }
  selectionEntries.forEach((entry) => appendSelectionKey(selectionKeySetByLayout, entry))
  draggingEntries.forEach((entry) => appendSelectionKey(draggingKeySetByLayout, entry))
  const inMeasureTieLayoutsByLayoutKey = new Map<string, TieLayout[]>()
  const appendInMeasureTieLayout = (layoutKey: string, tieLayout: TieLayout) => {
    const existing = inMeasureTieLayoutsByLayoutKey.get(layoutKey)
    if (existing) {
      if (!existing.some((entry) => entry.key === tieLayout.key)) {
        existing.push(tieLayout)
      }
      return
    }
    inMeasureTieLayoutsByLayoutKey.set(layoutKey, [tieLayout])
  }
  const lockPreviewAccidentalLayout = freezePreviewAccidentalLayout && normalizedPreviewNotes.length > 0
  const previewAccidentalByRowKey = new Map<string, number>()
  const accidentalLockByRowKey = new Map<string, { targetRightX: number | null; applied: boolean; reason: string }>()

  const resolveRenderedNoteData = (
    note: ScoreNote,
    staff: StaffKind,
  ): { rootPitch: Pitch; chordPitches?: Pitch[]; previewedKeyIndex: number | null; isRest: boolean } => {
    if (note.isRest) {
      return {
        rootPitch: getRestAnchorPitch(staff),
        chordPitches: undefined,
        previewedKeyIndex: null,
        isRest: true,
      }
    }

    const previewEntry = previewNoteByLayoutKey.get(getLayoutNoteKey(staff, note.id))
    if (!previewEntry) {
      return { rootPitch: note.pitch, chordPitches: note.chordPitches, previewedKeyIndex: null, isRest: false }
    }

    if (previewEntry.keyIndex <= 0) {
      return { rootPitch: previewEntry.pitch, chordPitches: note.chordPitches, previewedKeyIndex: 0, isRest: false }
    }

    const chordIndex = previewEntry.keyIndex - 1
    const sourceChordPitches = note.chordPitches
    if (!sourceChordPitches || chordIndex < 0 || chordIndex >= sourceChordPitches.length) {
      return { rootPitch: note.pitch, chordPitches: sourceChordPitches, previewedKeyIndex: null, isRest: false }
    }

    const chordPitches = sourceChordPitches.slice()
    chordPitches[chordIndex] = previewEntry.pitch
    return { rootPitch: note.pitch, chordPitches, previewedKeyIndex: previewEntry.keyIndex, isRest: false }
  }

  const buildPreviewAccidentalOverridesForStaff = (
    notes: ScoreNote[],
    staff: StaffKind,
  ): Map<string, Map<number, string | null>> | null => {
    if (previewNoteByLayoutKey.size === 0 || lockPreviewAccidentalLayout) return null

    const state = new Map<string, number>()
    const overrides = new Map<string, Map<number, string | null>>()
    notes.forEach((note) => {
      const rendered = resolveRenderedNoteData(note, staff)
      if (rendered.isRest) {
        overrides.set(note.id, new Map([[0, null]]))
        return
      }
      const noteOverrides = new Map<number, string | null>()

      const rootParts = getStepOctaveAlterFromPitch(rendered.rootPitch)
      const rootExpectedAlter = getEffectiveAlterFromContext(rootParts.step, rootParts.octave, keyFifths, state)
      const rootAccidental = getRequiredAccidentalForTargetAlter(rootParts.alter, rootExpectedAlter)
      noteOverrides.set(0, rootAccidental)
      state.set(getAccidentalStateKey(rootParts.step, rootParts.octave), rootParts.alter)

      rendered.chordPitches?.forEach((chordPitch, chordIndex) => {
        const chordParts = getStepOctaveAlterFromPitch(chordPitch)
        const chordExpectedAlter = getEffectiveAlterFromContext(chordParts.step, chordParts.octave, keyFifths, state)
        const chordAccidental = getRequiredAccidentalForTargetAlter(chordParts.alter, chordExpectedAlter)
        noteOverrides.set(chordIndex + 1, chordAccidental)
        state.set(getAccidentalStateKey(chordParts.step, chordParts.octave), chordParts.alter)
      })

      overrides.set(note.id, noteOverrides)
    })

    return overrides
  }

  const treblePreviewAccidentalOverrides = buildPreviewAccidentalOverridesForStaff(measure.treble, 'treble')
  const bassPreviewAccidentalOverrides = buildPreviewAccidentalOverridesForStaff(measure.bass, 'bass')

  const trebleStave = new Stave(measureX, trebleY, measureWidth)
  const bassStave = new Stave(measureX, bassY, measureWidth)
  const resolveStaffLineBounds = () => {
    const rawTrebleTop = trebleStave.getYForLine(0)
    const rawTrebleBottom = trebleStave.getYForLine(4)
    const rawBassTop = bassStave.getYForLine(0)
    const rawBassBottom = bassStave.getYForLine(4)
    const trebleLineTopY = Number.isFinite(rawTrebleTop) ? rawTrebleTop : trebleY
    const trebleLineBottomY = Number.isFinite(rawTrebleBottom) ? rawTrebleBottom : trebleY + 40
    const bassLineTopY = Number.isFinite(rawBassTop) ? rawBassTop : bassY
    const bassLineBottomY = Number.isFinite(rawBassBottom) ? rawBassBottom : bassY + 40
    return {
      trebleLineTopY: Math.min(trebleLineTopY, trebleLineBottomY),
      trebleLineBottomY: Math.max(trebleLineTopY, trebleLineBottomY),
      bassLineTopY: Math.min(bassLineTopY, bassLineBottomY),
      bassLineBottomY: Math.max(bassLineTopY, bassLineBottomY),
    }
  }
  onStaffLineBounds?.(resolveStaffLineBounds())
  const setImplicitClefContext = (stave: Stave, clefSpec: 'treble' | 'bass') => {
    // Keep correct clef-dependent modifier placement on mid-system measures
    // without drawing an extra clef glyph.
    ;(stave as unknown as { clef: string }).clef = clefSpec
  }

  if (suppressSystemDecorations) {
    trebleStave.setBegBarType(BarlineType.NONE)
    bassStave.setBegBarType(BarlineType.NONE)
    if (!isSystemStart) {
      setImplicitClefContext(trebleStave, 'treble')
      setImplicitClefContext(bassStave, 'bass')
      if (showKeySignature) {
        const keySignature = getKeySignatureSpecFromFifths(keyFifths)
        trebleStave.addKeySignature(keySignature)
        bassStave.addKeySignature(keySignature)
      }
      if (showTimeSignature) {
        trebleStave.addTimeSignature(timeSignatureLabel)
        bassStave.addTimeSignature(timeSignatureLabel)
      }
    }
    if (typeof noteStartXOverride === 'number') {
      trebleStave.setNoteStartX(noteStartXOverride)
      bassStave.setNoteStartX(noteStartXOverride)
    }
  } else if (isSystemStart) {
    trebleStave.addClef('treble')
    bassStave.addClef('bass')
    if (showKeySignature) {
      const keySignature = getKeySignatureSpecFromFifths(keyFifths)
      trebleStave.addKeySignature(keySignature)
      bassStave.addKeySignature(keySignature)
    }
    if (showTimeSignature) {
      trebleStave.addTimeSignature(timeSignatureLabel)
      bassStave.addTimeSignature(timeSignatureLabel)
    }
  } else {
    trebleStave.setBegBarType(BarlineType.NONE)
    bassStave.setBegBarType(BarlineType.NONE)
    setImplicitClefContext(trebleStave, 'treble')
    setImplicitClefContext(bassStave, 'bass')
    if (showKeySignature) {
      const keySignature = getKeySignatureSpecFromFifths(keyFifths)
      trebleStave.addKeySignature(keySignature)
      bassStave.addKeySignature(keySignature)
    }
    if (showTimeSignature) {
      trebleStave.addTimeSignature(timeSignatureLabel)
      bassStave.addTimeSignature(timeSignatureLabel)
    }
  }

  if (endTimeSignatureLabel) {
    trebleStave.setEndTimeSignature(endTimeSignatureLabel)
    bassStave.setEndTimeSignature(endTimeSignatureLabel)
  }

  // In barline-axis mode (mid-system measure without start decorations),
  // remove VexFlow's implicit left note-start inset so edge-cap=0 can
  // truly touch the measure start boundary.
  if (
    typeof noteStartXOverride !== 'number' &&
    !suppressSystemDecorations &&
    preferMeasureBarlineAxis
  ) {
    trebleStave.setNoteStartX(measureX)
    bassStave.setNoteStartX(measureX)
  }

  if (!skipPainting) {
    trebleStave.setContext(context).draw()
    bassStave.setContext(context).draw()
  }

  if (!skipPainting) {
    const context2D = (context as unknown as { context2D?: CanvasRenderingContext2D }).context2D
    if (context2D) {
      context2D.save()
      context2D.fillStyle = '#111111'
      context2D.font = '14px "Times New Roman", serif'
      context2D.textAlign = 'center'
      context2D.textBaseline = 'bottom'
      const labelX = measureX
      const labelY = trebleY + 24
      context2D.fillText(String(pairIndex + 1), labelX, labelY)
      context2D.restore()
    }
  }

  if (!skipPainting) {
    if (!suppressSystemDecorations && isSystemStart) {
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.BRACE).setContext(context).draw()
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw()
    } else if (forceLeadingConnector) {
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw()
    }
    if (!showEndTimeSignature) {
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw()
    }
  }

  const trebleRendered = measure.treble.map((note) => {
    const rendered = resolveRenderedNoteData(note, 'treble')
    const renderedKeys: RenderedNoteKey[] = rendered.isRest
      ? [{ pitch: rendered.rootPitch, accidental: null, keyIndex: 0 }]
      : (() => {
          const forceChordIndex =
            !lockPreviewAccidentalLayout && rendered.previewedKeyIndex !== null && rendered.previewedKeyIndex > 0
              ? rendered.previewedKeyIndex - 1
              : null
          return buildRenderedNoteKeys(
            note,
            'treble',
            rendered.rootPitch,
            rendered.chordPitches,
            keyFifths,
            previewAccidentalStateBeforeNote,
            !lockPreviewAccidentalLayout && rendered.previewedKeyIndex === 0,
            forceChordIndex,
            treblePreviewAccidentalOverrides?.get(note.id) ?? null,
            getPitchLine,
          )
        })()
    const dots = getDurationDots(note.duration)
    const vexNote = new StaveNote({
      keys: renderedKeys.map((entry) => entry.pitch),
      duration: rendered.isRest ? `${toVexDuration(note.duration)}r` : toVexDuration(note.duration),
      dots,
      clef: 'treble',
      stemDirection: getStrictStemDirection(rendered.rootPitch),
    })
    if (!rendered.isRest) {
      renderedKeys.forEach((entry, keyIndex) => {
        if (!entry.accidental) return
        vexNote.addModifier(new Accidental(entry.accidental), keyIndex)
      })
    }
    if (dots > 0) {
      Dot.buildAndAttach([vexNote], { all: true })
    }
    return { vexNote, renderedKeys }
  })

  const bassRendered = measure.bass.map((note) => {
    const rendered = resolveRenderedNoteData(note, 'bass')
    const renderedKeys: RenderedNoteKey[] = rendered.isRest
      ? [{ pitch: rendered.rootPitch, accidental: null, keyIndex: 0 }]
      : (() => {
          const forceChordIndex =
            !lockPreviewAccidentalLayout && rendered.previewedKeyIndex !== null && rendered.previewedKeyIndex > 0
              ? rendered.previewedKeyIndex - 1
              : null
          return buildRenderedNoteKeys(
            note,
            'bass',
            rendered.rootPitch,
            rendered.chordPitches,
            keyFifths,
            previewAccidentalStateBeforeNote,
            !lockPreviewAccidentalLayout && rendered.previewedKeyIndex === 0,
            forceChordIndex,
            bassPreviewAccidentalOverrides?.get(note.id) ?? null,
            getPitchLine,
          )
        })()
    const dots = getDurationDots(note.duration)
    const vexNote = new StaveNote({
      keys: renderedKeys.map((entry) => entry.pitch),
      duration: rendered.isRest ? `${toVexDuration(note.duration)}r` : toVexDuration(note.duration),
      dots,
      clef: 'bass',
      autoStem: true,
    })
    if (!rendered.isRest) {
      renderedKeys.forEach((entry, keyIndex) => {
        if (!entry.accidental) return
        vexNote.addModifier(new Accidental(entry.accidental), keyIndex)
      })
    }
    if (dots > 0) {
      Dot.buildAndAttach([vexNote], { all: true })
    }
    return { vexNote, renderedKeys }
  })

  const trebleVexNotes = trebleRendered.map((entry) => entry.vexNote)
  const bassVexNotes = bassRendered.map((entry) => entry.vexNote)
  trebleVexNotes.forEach((vexNote) => vexNote.setStave(trebleStave))
  bassVexNotes.forEach((vexNote) => vexNote.setStave(bassStave))

  if (highlightStaff === 'treble' || highlightStaff === 'bass') {
    const measureHighlightStyle = { fillStyle: '#2437E8', strokeStyle: '#2437E8' }
    if (highlightStaff === 'treble') {
      trebleVexNotes.forEach((vexNote) => vexNote.setStyle(measureHighlightStyle))
    } else {
      bassVexNotes.forEach((vexNote) => vexNote.setStyle(measureHighlightStyle))
    }
  }

  trebleRendered.forEach(({ vexNote, renderedKeys }, noteIndex) => {
    const noteId = measure.treble[noteIndex].id
    const layoutKey = getLayoutNoteKey('treble', noteId)
    const draggingKeySet = draggingKeySetByLayout.get(layoutKey)
    const selectedKeySet = selectionKeySetByLayout.get(layoutKey)
    renderedKeys.forEach((entry, renderedIndex) => {
      if (draggingKeySet?.has(entry.keyIndex)) {
        vexNote.setKeyStyle(Math.max(0, renderedIndex), { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
      } else if (selectedKeySet?.has(entry.keyIndex)) {
        vexNote.setKeyStyle(Math.max(0, renderedIndex), { fillStyle: '#2437E8', strokeStyle: '#2437E8' })
      }
    })
  })

  bassRendered.forEach(({ vexNote, renderedKeys }, noteIndex) => {
    const noteId = measure.bass[noteIndex].id
    const layoutKey = getLayoutNoteKey('bass', noteId)
    const draggingKeySet = draggingKeySetByLayout.get(layoutKey)
    const selectedKeySet = selectionKeySetByLayout.get(layoutKey)
    renderedKeys.forEach((entry, renderedIndex) => {
      if (draggingKeySet?.has(entry.keyIndex)) {
        vexNote.setKeyStyle(Math.max(0, renderedIndex), { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
      } else if (selectedKeySet?.has(entry.keyIndex)) {
        vexNote.setKeyStyle(Math.max(0, renderedIndex), { fillStyle: '#2437E8', strokeStyle: '#2437E8' })
      }
    })
  })

  if (activeAccidentalSelection) {
    const applyAccidentalHighlight = (
      staff: StaffKind,
      sourceNotes: ScoreNote[],
      rendered: Array<{ vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }>,
    ) => {
      if (activeAccidentalSelection.staff !== staff) return
      sourceNotes.forEach((sourceNote, noteIndex) => {
        if (sourceNote.id !== activeAccidentalSelection.noteId) return
        const renderedEntry = rendered[noteIndex]
        if (!renderedEntry) return
        const renderedIndex = renderedEntry.renderedKeys.findIndex(
          (entry) => entry.keyIndex === activeAccidentalSelection.keyIndex,
        )
        if (renderedIndex < 0) return
        const accidentalModifier = renderedEntry.vexNote
          .getModifiersByType(Accidental.CATEGORY)
          .find((modifier) => modifier.getIndex() === renderedIndex) as Accidental | undefined
        accidentalModifier?.setStyle({ fillStyle: '#2437E8', strokeStyle: '#2437E8' })
      })
    }
    applyAccidentalHighlight('treble', measure.treble, trebleRendered)
    applyAccidentalHighlight('bass', measure.bass, bassRendered)
  }

  const trebleVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(trebleVexNotes)
  const bassVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(bassVexNotes)
  const formatWidth =
    typeof formatWidthOverride === 'number' && Number.isFinite(formatWidthOverride)
      ? Math.max(MIN_FORMAT_WIDTH_PX, formatWidthOverride)
      : Math.max(MIN_FORMAT_WIDTH_PX, trebleStave.getNoteEndX() - trebleStave.getNoteStartX() - 8)

  new Formatter().joinVoices([trebleVoice]).joinVoices([bassVoice]).format([trebleVoice, bassVoice], formatWidth)

  let appliedSpacingMetrics: AppliedTimeAxisSpacingMetrics | null = null
  if (spacingLayoutMode === 'custom') {
    appliedSpacingMetrics = applyUnifiedTimeAxisSpacing({
      measure,
      noteStartX: trebleStave.getNoteStartX(),
      formatWidth,
      trebleRendered,
      bassRendered,
      spacingConfig: timeAxisSpacingConfig,
      measureTicks: Math.max(1, Math.round(timeSignature.beats * TICKS_PER_BEAT * (4 / timeSignature.beatType))),
      sparseTailAnchorMode: 'none',
      compactTailAnchorTicks: 4,
      uniformSpacingByTicks: true,
      measureStartBarX: measureX,
      measureEndBarX: measureX + measureWidth,
      publicAxisLayout,
      preferMeasureBarlineAxis,
      preferMeasureEndBarlineAxis,
      enableEdgeGapCap,
    })
  }
  if (onSpacingMetrics) {
    onSpacingMetrics(appliedSpacingMetrics)
  }

  if (staticNoteXById && staticNoteXById.size > 0) {
    const alignRenderedX = (staff: StaffKind, sourceNotes: ScoreNote[], rendered: { vexNote: StaveNote }[]) => {
      sourceNotes.forEach((sourceNote, noteIndex) => {
        const targetX = staticNoteXById.get(getLayoutNoteKey(staff, sourceNote.id))
        const vexNote = rendered[noteIndex]?.vexNote
        if (targetX === undefined || !vexNote) return
        const currentX = getRenderedNoteVisualX(vexNote)
        if (!Number.isFinite(currentX)) return
        const delta = targetX - currentX
        if (Math.abs(delta) < 0.001) return
        vexNote.setXShift(vexNote.getXShift() + delta)
      })
    }

    alignRenderedX('treble', measure.treble, trebleRendered)
    alignRenderedX('bass', measure.bass, bassRendered)
  }

  const alignRenderedAccidentalOffset = (
    staff: StaffKind,
    sourceNotes: ScoreNote[],
    rendered: { vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }[],
  ) => {
    sourceNotes.forEach((sourceNote, noteIndex) => {
      const renderedEntry = rendered[noteIndex]
      if (!renderedEntry) return
      const layoutKey = getLayoutNoteKey(staff, sourceNote.id)
      const targetByKeyIndex = staticAccidentalRightXById?.get(layoutKey)
      const noteBaseX = staticNoteXById?.get(layoutKey) ?? getRenderedNoteVisualX(renderedEntry.vexNote)
      const accidentalModifiers = renderedEntry.vexNote
        .getModifiersByType(Accidental.CATEGORY)
        .map((modifier) => modifier as Accidental)

      renderedEntry.renderedKeys.forEach((renderedKey, renderedIndex) => {
        if (!renderedKey.accidental) return
        const rowKey = `${layoutKey}|${renderedKey.keyIndex}`
        const modifier = accidentalModifiers.find((item) => item.getIndex() === renderedIndex)
        if (!modifier) {
          accidentalLockByRowKey.set(rowKey, {
            targetRightX: null,
            applied: false,
            reason: 'no-modifier',
          })
          return
        }

        const headXRaw = renderedEntry.vexNote.noteHeads[renderedIndex]?.getAbsoluteX()
        const headX =
          Number.isFinite(headXRaw) && Math.abs(headXRaw) > 0.0001
            ? headXRaw
            : noteBaseX
        const widthRaw = modifier.getWidth()
        const modifierWidth = Number.isFinite(widthRaw) ? widthRaw : null
        const targetByHead =
          typeof headX === 'number' && Number.isFinite(headX) && modifierWidth !== null
            ? headX - modifierWidth - ACCIDENTAL_HEAD_CLEARANCE_PX
            : null

        const targetedX = targetByKeyIndex?.get(renderedKey.keyIndex)
        const fallbackTarget =
          targetByHead ?? (Number.isFinite(noteBaseX) ? noteBaseX + PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX : null)
        const targetRightX =
          typeof targetedX === 'number' && Number.isFinite(targetedX)
            ? targetedX
            : fallbackTarget
        if (targetRightX === null) {
          accidentalLockByRowKey.set(rowKey, {
            targetRightX: null,
            applied: false,
            reason: 'no-target',
          })
          return
        }

        const currentRightX = getAccidentalVisualX(renderedEntry.vexNote, modifier, renderedIndex)
        if (currentRightX === null) {
          accidentalLockByRowKey.set(rowKey, {
            targetRightX,
            applied: false,
            reason: 'invalid-current-x',
          })
          return
        }

        const delta = targetRightX - currentRightX
        if (Math.abs(delta) >= 0.001) {
          addModifierXShift(modifier, delta)
        }

        const alignedRightX = getAccidentalVisualX(renderedEntry.vexNote, modifier, renderedIndex)
        if (alignedRightX !== null) {
          previewAccidentalByRowKey.set(rowKey, alignedRightX)
        } else {
          previewAccidentalByRowKey.set(rowKey, targetRightX)
        }
        accidentalLockByRowKey.set(rowKey, {
          targetRightX,
          applied: true,
          reason: Math.abs(delta) >= 0.001 ? 'native-aligned' : 'native-already-aligned',
        })
      })
    })
  }

  alignRenderedAccidentalOffset('treble', measure.treble, trebleRendered)
  alignRenderedAccidentalOffset('bass', measure.bass, bassRendered)

  if (debugCapture) {
    const rows: DragDebugRow[] = []
    const captureDebugRowsForStaff = (
      staff: StaffKind,
      sourceNotes: ScoreNote[],
      rendered: { vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }[],
    ) => {
      sourceNotes.forEach((sourceNote, noteIndex) => {
        const renderedEntry = rendered[noteIndex]
        if (!renderedEntry) return
        const noteKey = getLayoutNoteKey(staff, sourceNote.id)
        const staticRecord = debugCapture.staticByNoteKey.get(noteKey)
        const noteXPreview = finiteOrNull(getRenderedNoteVisualX(renderedEntry.vexNote))
        const noteXStatic = finiteOrNull(staticRecord?.noteX ?? null)
        const accidentalPreviewByRenderedIndex = getAccidentalRightXByRenderedIndex(renderedEntry.vexNote)

        renderedEntry.renderedKeys.forEach((renderedKey, renderedIndex) => {
          const lockInfo = accidentalLockByRowKey.get(`${noteKey}|${renderedKey.keyIndex}`)
          const rawHeadXPreview = finiteOrNull(renderedEntry.vexNote.noteHeads[renderedIndex]?.getAbsoluteX())
          const headXPreview =
            rawHeadXPreview !== null && Math.abs(rawHeadXPreview) > 0.0001 ? rawHeadXPreview : noteXPreview
          const headXStatic = finiteOrNull(staticRecord?.headXByKeyIndex.get(renderedKey.keyIndex))
          const rawHeadYPreview = finiteOrNull(renderedEntry.vexNote.getYs()[renderedIndex] ?? renderedEntry.vexNote.getYs()[0])
          const headYPreview = rawHeadYPreview
          const headYStatic = finiteOrNull(staticRecord?.headYByKeyIndex.get(renderedKey.keyIndex))
          const previewByLock = finiteOrNull(previewAccidentalByRowKey.get(`${noteKey}|${renderedKey.keyIndex}`))
          const accidentalRightXPreview =
            previewByLock ?? finiteOrNull(accidentalPreviewByRenderedIndex.get(renderedIndex))
          const accidentalRightXStatic = finiteOrNull(
            staticRecord?.accidentalRightXByKeyIndex.get(renderedKey.keyIndex),
          )
          rows.push({
            frame: debugCapture.frame,
            pairIndex,
            staff,
            noteId: sourceNote.id,
            noteIndex,
            keyIndex: renderedKey.keyIndex,
            pitch: renderedKey.pitch,
            noteXStatic,
            noteXPreview,
            noteXDelta: deltaOrNull(noteXPreview, noteXStatic),
            headXStatic,
            headXPreview,
            headXDelta: deltaOrNull(headXPreview, headXStatic),
            headYStatic,
            headYPreview,
            headYDelta: deltaOrNull(headYPreview, headYStatic),
            accidentalRightXStatic,
            accidentalRightXPreview,
            accidentalRightXDelta: deltaOrNull(accidentalRightXPreview, accidentalRightXStatic),
            hasAccidentalModifier: Boolean(renderedKey.accidental),
            accidentalTargetRightX: lockInfo?.targetRightX ?? null,
            accidentalLockApplied: lockInfo?.applied ?? false,
            accidentalLockReason: lockInfo?.reason ?? 'no-lock-record',
          })
        })
      })
    }

    captureDebugRowsForStaff('treble', measure.treble, trebleRendered)
    captureDebugRowsForStaff('bass', measure.bass, bassRendered)
    debugCapture.pushSnapshot({
      frame: debugCapture.frame,
      pairIndex,
      draggedNoteId: debugCapture.draggedNoteId,
      draggedStaff: debugCapture.draggedStaff,
      rows,
    })
  }


  const trebleBeams: Beam[] = isSpacingOnlyLayout
    ? []
    : Beam.generateBeams(trebleVexNotes, { groups: [new Fraction(1, 4)] })
  const bassBeams: Beam[] = isSpacingOnlyLayout
    ? []
    : Beam.generateBeams(bassVexNotes, { groups: [new Fraction(1, 4)] })
  if (!skipPainting) {
    trebleVoice.draw(context, trebleStave)
    bassVoice.draw(context, bassStave)
    trebleBeams.forEach((beam) => beam.setContext(context).draw())
    bassBeams.forEach((beam) => beam.setContext(context).draw())
  }

  const getTieKeySpecs = (
    note: ScoreNote,
    renderedNote: { renderedKeys: RenderedNoteKey[] } | undefined,
  ): Array<{
    keyIndex: number
    pitch: Pitch
    tieStart: boolean
    tieStop: boolean
    frozenIncomingPitch: Pitch | null
    frozenIncomingFromNoteId: string | null
    frozenIncomingFromKeyIndex: number | null
  }> => {
    if (note.isRest) return []
    const renderedPitchByKeyIndex = new Map<number, Pitch>()
    renderedNote?.renderedKeys.forEach((entry) => {
      renderedPitchByKeyIndex.set(entry.keyIndex, entry.pitch)
    })
    const resolvePitch = (keyIndex: number, fallbackPitch: Pitch): Pitch =>
      renderedPitchByKeyIndex.get(keyIndex) ?? fallbackPitch
    const rootFrozenIncoming = getTieFrozenIncoming(note, 0)
    const specs: Array<{
      keyIndex: number
      pitch: Pitch
      tieStart: boolean
      tieStop: boolean
      frozenIncomingPitch: Pitch | null
      frozenIncomingFromNoteId: string | null
      frozenIncomingFromKeyIndex: number | null
    }> = [
      {
        keyIndex: 0,
        pitch: resolvePitch(0, note.pitch),
        tieStart: Boolean(note.tieStart),
        tieStop: Boolean(note.tieStop),
        frozenIncomingPitch: rootFrozenIncoming?.pitch ?? null,
        frozenIncomingFromNoteId: rootFrozenIncoming?.fromNoteId ?? null,
        frozenIncomingFromKeyIndex: rootFrozenIncoming?.fromKeyIndex ?? null,
      },
    ]
    ;(note.chordPitches ?? []).forEach((pitch, chordIndex) => {
      const frozenIncoming = getTieFrozenIncoming(note, chordIndex + 1)
      specs.push({
        keyIndex: chordIndex + 1,
        pitch: resolvePitch(chordIndex + 1, pitch),
        tieStart: Boolean(note.chordTieStarts?.[chordIndex]),
        tieStop: Boolean(note.chordTieStops?.[chordIndex]),
        frozenIncomingPitch: frozenIncoming?.pitch ?? null,
        frozenIncomingFromNoteId: frozenIncoming?.fromNoteId ?? null,
        frozenIncomingFromKeyIndex: frozenIncoming?.fromKeyIndex ?? null,
      })
    })
    return specs
  }

  const findRenderedIndexByKeyIndex = (
    rendered: { renderedKeys: RenderedNoteKey[] } | undefined,
    keyIndex: number,
  ): number => {
    if (!rendered) return -1
    return rendered.renderedKeys.findIndex((entry) => entry.keyIndex === keyIndex)
  }

  const findRenderedIndexByPitch = (
    rendered: { renderedKeys: RenderedNoteKey[] } | undefined,
    pitch: Pitch,
  ): number => {
    if (!rendered) return -1
    return rendered.renderedKeys.findIndex((entry) => entry.pitch === pitch)
  }

  const tieHighlightFill = '#2437E8'

  const drawTieCurveByAnchors = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    direction: number,
    highlighted: boolean,
  ) => {
    const safeStartX = Math.min(startX, endX - 0.5)
    const safeEndX = Math.max(endX, startX + 0.5)
    const tie = new StaveTie({
      firstNote: { getYs: () => [startY] } as any,
      lastNote: { getYs: () => [endY] } as any,
      firstIndexes: [0],
      lastIndexes: [0],
    })
    if (highlighted) {
      context.save()
      context.setFillStyle(tieHighlightFill)
      context.setStrokeStyle(tieHighlightFill)
    }
    tie.setContext(context)
    tie.renderTie({
      firstX: safeStartX,
      lastX: safeEndX,
      firstYs: [startY],
      lastYs: [endY],
      direction,
    })
    if (highlighted) {
      context.restore()
    }
  }

  const getTieAnchorX = (
    renderedNote: { vexNote: StaveNote; renderedKeys: RenderedNoteKey[] } | undefined,
    renderedIndex: number,
  ): number | null => {
    if (!renderedNote) return null
    const raw = renderedNote.vexNote.noteHeads[renderedIndex]?.getAbsoluteX()
    if (Number.isFinite(raw)) return raw + 6
    const fallback = renderedNote.vexNote.getAbsoluteX()
    return Number.isFinite(fallback) ? fallback : null
  }

  const findFrozenIncomingTargetInMeasure = (params: {
    sourceNotes: ScoreNote[]
    rendered: Array<{ vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }>
    sourceNoteIndex: number
    sourceNoteId: string
    sourceKeyIndex: number
  }): { noteIndex: number; keyIndex: number; frozenPitch: Pitch } | null => {
    const {
      sourceNotes,
      rendered,
      sourceNoteIndex,
      sourceNoteId,
      sourceKeyIndex,
    } = params
    for (let candidateIndex = sourceNoteIndex + 1; candidateIndex < sourceNotes.length; candidateIndex += 1) {
      const candidate = sourceNotes[candidateIndex]
      if (!candidate || candidate.isRest) continue
      const specs = getTieKeySpecs(candidate, rendered[candidateIndex])
      const matched = specs.find(
        (spec) =>
          spec.tieStop &&
          spec.frozenIncomingPitch &&
          spec.frozenIncomingFromNoteId === sourceNoteId &&
          spec.frozenIncomingFromKeyIndex === sourceKeyIndex,
      )
      if (!matched || !matched.frozenIncomingPitch) continue
      return {
        noteIndex: candidateIndex,
        keyIndex: matched.keyIndex,
        frozenPitch: matched.frozenIncomingPitch,
      }
    }
    return null
  }

  const findGhostTargetInMeasure = (params: {
    sourceNotes: ScoreNote[]
    rendered: Array<{ vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }>
    sourceNoteIndex: number
  }): { noteIndex: number; keyIndex: number } | null => {
    const { sourceNotes, rendered, sourceNoteIndex } = params
    for (let candidateIndex = sourceNoteIndex + 1; candidateIndex < sourceNotes.length; candidateIndex += 1) {
      const candidate = sourceNotes[candidateIndex]
      if (!candidate || candidate.isRest) continue
      const renderedNext = rendered[candidateIndex]
      if (!renderedNext || renderedNext.renderedKeys.length === 0) continue
      const keyIndex = renderedNext.renderedKeys[0]?.keyIndex ?? 0
      return {
        noteIndex: candidateIndex,
        keyIndex: Number.isFinite(keyIndex) ? keyIndex : 0,
      }
    }
    return null
  }

  const resolveStopEndpointInMeasure = (params: {
    sourceNotes: ScoreNote[]
    rendered: Array<{ vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }>
    staff: StaffKind
    targetNoteIndex: number
    targetPitch: Pitch
  }): TieEndpoint | null => {
    const { sourceNotes, rendered, staff, targetNoteIndex, targetPitch } = params
    const note = sourceNotes[targetNoteIndex]
    if (!note || note.isRest) return null
    const specs = getTieKeySpecs(note, rendered[targetNoteIndex])
    const resolvedSpec =
      specs.find((spec) => spec.tieStop && spec.pitch === targetPitch) ??
      specs.find((spec) => spec.pitch === targetPitch) ??
      null
    if (!resolvedSpec) return null
    return {
      pairIndex,
      noteIndex: targetNoteIndex,
      staff,
      noteId: note.id,
      keyIndex: resolvedSpec.keyIndex,
      tieType: 'stop',
    }
  }

  const drawTiesForStaff = (
    sourceNotes: ScoreNote[],
    rendered: Array<{ vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }>,
    staff: StaffKind,
  ) => {
    if (isSpacingOnlyLayout) return

    for (let noteIndex = 0; noteIndex < sourceNotes.length; noteIndex += 1) {
      const sourceNote = sourceNotes[noteIndex]
      if (sourceNote.isRest) continue
      const renderedCurrent = rendered[noteIndex]
      if (!renderedCurrent) continue

      const tieSpecs = getTieKeySpecs(sourceNote, renderedCurrent)
      tieSpecs.forEach((spec) => {
        if (!spec.tieStart && !spec.tieStop) return

        const currentRenderedIndex = findRenderedIndexByKeyIndex(renderedCurrent, spec.keyIndex)
        if (currentRenderedIndex < 0) return
        const tieTargetKey = getDragPreviewTargetKey({
          pairIndex,
          staff,
          noteId: sourceNote.id,
          keyIndex: spec.keyIndex,
        })
        const tieDirection = getPitchLine(staff, spec.pitch) < 3 ? 1 : -1
        const sourceLayoutKey = getLayoutNoteKey(staff, sourceNote.id)
        const sourceStartEndpoint: TieEndpoint = {
          pairIndex,
          noteIndex,
          staff,
          noteId: sourceNote.id,
          keyIndex: spec.keyIndex,
          tieType: 'start',
        }
        const sourceStopEndpoint: TieEndpoint = {
          pairIndex,
          noteIndex,
          staff,
          noteId: sourceNote.id,
          keyIndex: spec.keyIndex,
          tieType: 'stop',
        }
        const drawInMeasureTieSegment = (params: {
          startX: number
          endX: number
          y: number
          endpoints: TieEndpoint[]
        }) => {
          const { startX, endX, y, endpoints } = params
          if (!Number.isFinite(startX) || !Number.isFinite(endX) || !Number.isFinite(y)) return
          const tieLayout = buildTieLayout({
            startX,
            startY: y,
            endX,
            endY: y,
            direction: tieDirection,
            endpoints,
          })
          appendInMeasureTieLayout(sourceLayoutKey, tieLayout)
          if (skipPainting) return
          drawTieCurveByAnchors(
            startX,
            y,
            endX,
            y,
            tieDirection,
            activeTieSegmentKey === tieLayout.key,
          )
        }

        if (spec.tieStart) {
          if (suppressedTieStartKeys?.has(tieTargetKey)) return
          if (
            previewFrozenBoundaryCurve &&
            previewFrozenBoundaryCurve.fromPairIndex === pairIndex &&
            previewFrozenBoundaryCurve.fromStaff === staff &&
            previewFrozenBoundaryCurve.fromNoteId === sourceNote.id &&
            previewFrozenBoundaryCurve.fromKeyIndex === spec.keyIndex
          ) {
            if (!skipPainting) {
              drawTieCurveByAnchors(
                previewFrozenBoundaryCurve.startX,
                previewFrozenBoundaryCurve.startY,
                previewFrozenBoundaryCurve.endX,
                previewFrozenBoundaryCurve.endY,
                tieDirection,
                false,
              )
            }
            return
          }

          const frozenTarget = findFrozenIncomingTargetInMeasure({
            sourceNotes,
            rendered,
            sourceNoteIndex: noteIndex,
            sourceNoteId: sourceNote.id,
            sourceKeyIndex: spec.keyIndex,
          })
          if (frozenTarget) {
              const renderedNext = rendered[frozenTarget.noteIndex]
              const nextRenderedIndex = findRenderedIndexByKeyIndex(renderedNext, frozenTarget.keyIndex)
              if (renderedNext && nextRenderedIndex >= 0) {
                const translatedY =
                  renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
                const startX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
                const endX = getTieAnchorX(renderedNext, nextRenderedIndex)
                if (
                  Number.isFinite(translatedY) &&
                  typeof startX === 'number' &&
                  Number.isFinite(startX) &&
                  typeof endX === 'number' &&
                  Number.isFinite(endX)
                ) {
                  const targetNote = sourceNotes[frozenTarget.noteIndex]
                  if (!targetNote) return
                  const targetEndpoint: TieEndpoint = {
                    pairIndex,
                    noteIndex: frozenTarget.noteIndex,
                    staff,
                    noteId: targetNote.id,
                    keyIndex: frozenTarget.keyIndex,
                    tieType: 'stop',
                  }
                  drawInMeasureTieSegment({
                    startX,
                    endX,
                    y: translatedY,
                    endpoints: [sourceStartEndpoint, targetEndpoint],
                  })
                  return
                }
              }
          }

          const renderedNext = rendered[noteIndex + 1]
          const nextRenderedIndex = findRenderedIndexByPitch(renderedNext, spec.pitch)
          if (renderedNext && nextRenderedIndex >= 0) {
            const translatedY =
              renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
            const startX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
            const endX = getTieAnchorX(renderedNext, nextRenderedIndex)
            if (
              Number.isFinite(translatedY) &&
              typeof startX === 'number' &&
              Number.isFinite(startX) &&
              typeof endX === 'number' &&
              Number.isFinite(endX)
            ) {
              const targetEndpoint = resolveStopEndpointInMeasure({
                sourceNotes,
                rendered,
                staff,
                targetNoteIndex: noteIndex + 1,
                targetPitch: spec.pitch,
              })
              drawInMeasureTieSegment({
                startX,
                endX,
                y: translatedY,
                endpoints: targetEndpoint ? [sourceStartEndpoint, targetEndpoint] : [sourceStartEndpoint],
              })
              return
            }
          }

          const ghostTarget = findGhostTargetInMeasure({
            sourceNotes,
            rendered,
            sourceNoteIndex: noteIndex,
          })
          if (ghostTarget) {
            const renderedGhost = rendered[ghostTarget.noteIndex]
            const ghostRenderedIndex = findRenderedIndexByKeyIndex(renderedGhost, ghostTarget.keyIndex)
            if (renderedGhost && ghostRenderedIndex >= 0) {
              const translatedY =
                renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
              const startX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
              const endX = getTieAnchorX(renderedGhost, ghostRenderedIndex)
              if (
                Number.isFinite(translatedY) &&
                typeof startX === 'number' &&
                Number.isFinite(startX) &&
                typeof endX === 'number' &&
                Number.isFinite(endX)
              ) {
                drawInMeasureTieSegment({
                  startX,
                  endX,
                  y: translatedY,
                  endpoints: [sourceStartEndpoint],
                })
                return
              }
            }
          } else if (renderBoundaryPartialTies) {
            const translatedY =
              renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
            const startX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
            const rightBoundaryX = measureX + measureWidth - 1
            if (
              Number.isFinite(translatedY) &&
              typeof startX === 'number' &&
              Number.isFinite(startX) &&
              Number.isFinite(rightBoundaryX) &&
              rightBoundaryX > startX + 0.5
            ) {
              drawInMeasureTieSegment({
                startX,
                endX: rightBoundaryX,
                y: translatedY,
                endpoints: [sourceStartEndpoint],
              })
            }
          }
        }

        if (spec.tieStop) {
          if (suppressedTieStopKeys?.has(tieTargetKey)) return
          if (spec.frozenIncomingPitch) return
          const previousNote = sourceNotes[noteIndex - 1]
          const previousRendered = rendered[noteIndex - 1]
          const hasIncomingTieInCurrentMeasure =
            noteIndex > 0 &&
            Boolean(previousNote) &&
            getTieKeySpecs(previousNote, previousRendered).some(
              (previousSpec) => previousSpec.tieStart && previousSpec.pitch === spec.pitch,
            )
          if (hasIncomingTieInCurrentMeasure) return

          if (renderBoundaryPartialTies) {
            const translatedY =
              renderedCurrent.vexNote.getYs()[currentRenderedIndex] ?? renderedCurrent.vexNote.getYs()[0]
            const endX = getTieAnchorX(renderedCurrent, currentRenderedIndex)
            const leftBoundaryX = measureX + 1
            if (
              Number.isFinite(translatedY) &&
              typeof endX === 'number' &&
              Number.isFinite(endX) &&
              Number.isFinite(leftBoundaryX) &&
              endX > leftBoundaryX + 0.5
            ) {
              drawInMeasureTieSegment({
                startX: leftBoundaryX,
                endX,
                y: translatedY,
                endpoints: [sourceStopEndpoint],
              })
            }
          }
        }
      })
    }
  }

  drawTiesForStaff(measure.treble, trebleRendered, 'treble')
  drawTiesForStaff(measure.bass, bassRendered, 'bass')

  if (!collectLayouts) return noteLayouts

  if (isSpacingOnlyLayout) {
    const buildMinimalLayouts = (
      staff: StaffKind,
      sourceNotes: ScoreNote[],
      rendered: { vexNote: StaveNote }[],
    ): NoteLayout[] =>
      sourceNotes.map((sourceNote, noteIndex) => {
        const vexNote = rendered[noteIndex]?.vexNote
        const x = vexNote ? getRenderedNoteVisualX(vexNote) : 0
        let spacingRightX = vexNote ? getRenderedNoteVisualX(vexNote) + 9 : x
        if (vexNote) {
          if (vexNote.hasStem()) {
            const stemX = vexNote.getStemX()
            if (Number.isFinite(stemX)) {
              spacingRightX = Math.max(spacingRightX, stemX + 1)
            }
          }
        }
        return {
          id: sourceNote.id,
          staff,
          pairIndex,
          noteIndex,
          x,
          rightX: spacingRightX,
          spacingRightX,
          y: 0,
          pitchYMap: {},
          noteHeads: [],
          accidentalLayouts: [],
          inMeasureTieLayouts: [],
          crossMeasureTieLayouts: [],
          accidentalRightXByKeyIndex: {},
        }
      })

    noteLayouts.push(...buildMinimalLayouts('treble', measure.treble, trebleRendered))
    noteLayouts.push(...buildMinimalLayouts('bass', measure.bass, bassRendered))
    return noteLayouts
  }

  const getRenderedNoteRightX = (
    vexNote: StaveNote,
    noteHeads: Array<{ x: number }>,
  ): number => {
    const fallbackRightX = noteHeads.reduce(
      (maxX, head) => Math.max(maxX, head.x),
      getRenderedNoteVisualX(vexNote),
    )
    const bbox = vexNote.getBoundingBox()
    const rightFromBBox = bbox ? bbox.getX() + bbox.getW() : Number.NEGATIVE_INFINITY

    let rightFromMetrics = Number.NEGATIVE_INFINITY
    try {
      const metrics = vexNote.getMetrics()
      const absoluteX = vexNote.getAbsoluteX()
      const metricRightEdge =
        absoluteX + metrics.notePx + metrics.rightDisplacedHeadPx + metrics.modRightPx
      if (Number.isFinite(metricRightEdge)) {
        rightFromMetrics = metricRightEdge
      }
    } catch {
      rightFromMetrics = Number.NEGATIVE_INFINITY
    }

    let rightFromStem = Number.NEGATIVE_INFINITY
    if (vexNote.hasStem()) {
      const stemX = vexNote.getStemX()
      if (Number.isFinite(stemX)) {
        rightFromStem = stemX + 1
      }
    }

    const computedRightX = Math.max(fallbackRightX, rightFromBBox, rightFromMetrics, rightFromStem)
    return Number.isFinite(computedRightX) ? computedRightX : fallbackRightX
  }

  const getRenderedNoteSpacingRightX = (
    vexNote: StaveNote,
    noteHeads: Array<{ x: number }>,
  ): number => {
    const fallbackHeadRightX = noteHeads.reduce(
      (maxX, head) => Math.max(maxX, head.x + 9),
      getRenderedNoteVisualX(vexNote) + 9,
    )
    const stemInvariantPadding = vexNote.hasStem() ? STEM_INVARIANT_RIGHT_PADDING_PX : 0
    const spacingRightX = fallbackHeadRightX + stemInvariantPadding
    return Number.isFinite(spacingRightX) ? spacingRightX : getRenderedNoteVisualX(vexNote) + 9
  }

  const getMaxBeamRightX = (beams: Beam[]): number => {
    let maxRightX = Number.NEGATIVE_INFINITY
    beams.forEach((beam) => {
      VALID_BEAM_DURATIONS.forEach((duration) => {
        const beamLines = beam.getBeamLines(duration)
        beamLines.forEach((line) => {
          const start = line.start
          const end = line.end
          if (Number.isFinite(start)) {
            maxRightX = Math.max(maxRightX, start + 1)
          }
          if (typeof end === 'number' && Number.isFinite(end)) {
            maxRightX = Math.max(maxRightX, end + 1)
          }
        })
      })
    })
    return maxRightX
  }

  const treblePitchYMap = {} as Record<Pitch, number>
  const bassPitchYMap = {} as Record<Pitch, number>
  if (!isSpacingOnlyLayout) {
    for (const pitch of PITCHES) {
      treblePitchYMap[pitch] = trebleStave.getYForNote(PITCH_LINE_MAP.treble[pitch])
      bassPitchYMap[pitch] = bassStave.getYForNote(PITCH_LINE_MAP.bass[pitch])
    }

    const trebleExtraPitches = new Set<Pitch>()
    const bassExtraPitches = new Set<Pitch>()
    trebleRendered.forEach(({ renderedKeys }) => renderedKeys.forEach((entry) => trebleExtraPitches.add(entry.pitch)))
    bassRendered.forEach(({ renderedKeys }) => renderedKeys.forEach((entry) => bassExtraPitches.add(entry.pitch)))

    trebleExtraPitches.forEach((pitch) => {
      if (treblePitchYMap[pitch] !== undefined) return
      treblePitchYMap[pitch] = trebleStave.getYForNote(getPitchLine('treble', pitch))
    })
    bassExtraPitches.forEach((pitch) => {
      if (bassPitchYMap[pitch] !== undefined) return
      bassPitchYMap[pitch] = bassStave.getYForNote(getPitchLine('bass', pitch))
    })
  }

  noteLayouts.push(
    ...trebleRendered.map(({ vexNote, renderedKeys }, noteIndex) => {
      const ys = vexNote.getYs()
      const renderedHeadXByIndex = new Map<number, number>()
      renderedKeys.forEach((_, renderedIndex) => {
        const headX = vexNote.noteHeads[renderedIndex]?.getAbsoluteX() ?? getRenderedNoteVisualX(vexNote)
        if (!Number.isFinite(headX)) return
        renderedHeadXByIndex.set(renderedIndex, headX)
      })
      const accidentalByRenderedIndex = getAccidentalRightXByRenderedIndex(vexNote)
      const accidentalRightXByKeyIndex: Record<number, number> = {}
      const accidentalLayouts = renderedKeys.flatMap((entry, renderedIndex) => {
        const accidentalX = accidentalByRenderedIndex.get(renderedIndex)
        if (accidentalX === undefined || !entry.accidental) return []
        const modifier = vexNote
          .getModifiersByType(Accidental.CATEGORY)
          .find((candidate) => candidate.getIndex() === renderedIndex) as Accidental | undefined
        const width = Number.isFinite(modifier?.getWidth()) ? (modifier?.getWidth() as number) : 8
        const centerX = accidentalX + width / 2
        const centerY = ys[renderedIndex] ?? ys[0] ?? 0
        return [
          {
            keyIndex: entry.keyIndex,
            x: centerX,
            y: centerY,
            renderedAccidental: entry.accidental,
            ...buildAccidentalHitGeometry({
              centerX,
              centerY,
              width,
            }),
          },
        ]
      })
      renderedKeys.forEach((entry, renderedIndex) => {
        const offset = accidentalByRenderedIndex.get(renderedIndex)
        if (offset === undefined) return
        accidentalRightXByKeyIndex[entry.keyIndex] = offset
      })
      const noteHeads = renderedKeys.map((entry, renderedIndex) => {
        const headX = renderedHeadXByIndex.get(renderedIndex) ?? getRenderedNoteVisualX(vexNote)
        const headY = ys[renderedIndex] ?? ys[0]
        const hitGeometry = buildNoteHeadHitGeometry({
          vexNote,
          renderedIndex,
          headX,
          headY,
        })
        return {
          x: headX,
          y: headY,
          pitch: entry.pitch,
          keyIndex: entry.keyIndex,
          ...hitGeometry,
        }
      })
      const rootHead = noteHeads.find((head) => head.keyIndex === 0) ?? noteHeads[0]
      const noteSpacingRightX = getRenderedNoteSpacingRightX(vexNote, noteHeads)
      const noteRightX = isSpacingOnlyLayout ? noteSpacingRightX : getRenderedNoteRightX(vexNote, noteHeads)
      const layoutKey = getLayoutNoteKey('treble', measure.treble[noteIndex].id)
      return {
        id: measure.treble[noteIndex].id,
        staff: 'treble' as const,
        pairIndex,
        noteIndex,
        x: getRenderedNoteVisualX(vexNote),
        rightX: noteRightX,
        spacingRightX: noteSpacingRightX,
        y: rootHead?.y ?? ys[0] ?? 0,
        pitchYMap: treblePitchYMap,
        noteHeads,
        accidentalLayouts,
        inMeasureTieLayouts: inMeasureTieLayoutsByLayoutKey.get(layoutKey) ?? [],
        crossMeasureTieLayouts: [],
        accidentalRightXByKeyIndex,
      }
    }),
  )
  noteLayouts.push(
    ...bassRendered.map(({ vexNote, renderedKeys }, noteIndex) => {
      const ys = vexNote.getYs()
      const renderedHeadXByIndex = new Map<number, number>()
      renderedKeys.forEach((_, renderedIndex) => {
        const headX = vexNote.noteHeads[renderedIndex]?.getAbsoluteX() ?? getRenderedNoteVisualX(vexNote)
        if (!Number.isFinite(headX)) return
        renderedHeadXByIndex.set(renderedIndex, headX)
      })
      const accidentalByRenderedIndex = getAccidentalRightXByRenderedIndex(vexNote)
      const accidentalRightXByKeyIndex: Record<number, number> = {}
      const accidentalLayouts = renderedKeys.flatMap((entry, renderedIndex) => {
        const accidentalX = accidentalByRenderedIndex.get(renderedIndex)
        if (accidentalX === undefined || !entry.accidental) return []
        const modifier = vexNote
          .getModifiersByType(Accidental.CATEGORY)
          .find((candidate) => candidate.getIndex() === renderedIndex) as Accidental | undefined
        const width = Number.isFinite(modifier?.getWidth()) ? (modifier?.getWidth() as number) : 8
        const centerX = accidentalX + width / 2
        const centerY = ys[renderedIndex] ?? ys[0] ?? 0
        return [
          {
            keyIndex: entry.keyIndex,
            x: centerX,
            y: centerY,
            renderedAccidental: entry.accidental,
            ...buildAccidentalHitGeometry({
              centerX,
              centerY,
              width,
            }),
          },
        ]
      })
      renderedKeys.forEach((entry, renderedIndex) => {
        const offset = accidentalByRenderedIndex.get(renderedIndex)
        if (offset === undefined) return
        accidentalRightXByKeyIndex[entry.keyIndex] = offset
      })
      const noteHeads = renderedKeys.map((entry, renderedIndex) => {
        const headX = renderedHeadXByIndex.get(renderedIndex) ?? getRenderedNoteVisualX(vexNote)
        const headY = ys[renderedIndex] ?? ys[0]
        const hitGeometry = buildNoteHeadHitGeometry({
          vexNote,
          renderedIndex,
          headX,
          headY,
        })
        return {
          x: headX,
          y: headY,
          pitch: entry.pitch,
          keyIndex: entry.keyIndex,
          ...hitGeometry,
        }
      })
      const rootHead = noteHeads.find((head) => head.keyIndex === 0) ?? noteHeads[0]
      const noteSpacingRightX = getRenderedNoteSpacingRightX(vexNote, noteHeads)
      const noteRightX = isSpacingOnlyLayout ? noteSpacingRightX : getRenderedNoteRightX(vexNote, noteHeads)
      const layoutKey = getLayoutNoteKey('bass', measure.bass[noteIndex].id)
      return {
        id: measure.bass[noteIndex].id,
        staff: 'bass' as const,
        pairIndex,
        noteIndex,
        x: getRenderedNoteVisualX(vexNote),
        rightX: noteRightX,
        spacingRightX: noteSpacingRightX,
        y: rootHead?.y ?? ys[0] ?? 0,
        pitchYMap: bassPitchYMap,
        noteHeads,
        accidentalLayouts,
        inMeasureTieLayouts: inMeasureTieLayoutsByLayoutKey.get(layoutKey) ?? [],
        crossMeasureTieLayouts: [],
        accidentalRightXByKeyIndex,
      }
    }),
  )

  if (!isSpacingOnlyLayout) {
    const beamRightX = getMaxBeamRightX([...trebleBeams, ...bassBeams])
    if (Number.isFinite(beamRightX) && noteLayouts.length > 0) {
      let rightMostLayoutIndex = 0
      for (let i = 1; i < noteLayouts.length; i += 1) {
        if (noteLayouts[i].rightX > noteLayouts[rightMostLayoutIndex].rightX) {
          rightMostLayoutIndex = i
        }
      }
      noteLayouts[rightMostLayoutIndex].rightX = Math.max(noteLayouts[rightMostLayoutIndex].rightX, beamRightX)
    }
  }

  return noteLayouts
}


