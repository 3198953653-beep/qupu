import { Accidental, BarlineType, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveConnector, StaveNote, Voice } from 'vexflow'
import { PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX } from '../constants'
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
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import { getStepOctaveAlterFromPitch } from '../pitchMath'
import { buildPitchLineMap, createPianoPitches, getPitchLine, getStrictStemDirection } from '../pitchUtils'
import type { RenderedNoteKey } from '../accidentals'
import type {
  DragDebugRow,
  DragDebugSnapshot,
  DragDebugStaticRecord,
  MeasurePair,
  NoteLayout,
  Pitch,
  ScoreNote,
  Selection,
  StaffKind,
  TimeSignature,
} from '../types'

const PITCHES: Pitch[] = createPianoPitches()
const PITCH_LINE_MAP: Record<StaffKind, Record<Pitch, number>> = {
  treble: buildPitchLineMap('treble', PITCHES),
  bass: buildPitchLineMap('bass', PITCHES),
}
const VALID_BEAM_DURATIONS = ['4', '8', '16', '32', '64'] as const
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
  draggingSelection: Selection | null
  previewNote?: { noteId: string; staff: StaffKind; pitch: Pitch; keyIndex: number } | null
  previewAccidentalStateBeforeNote?: Map<string, number> | null
  collectLayouts?: boolean
  suppressSystemDecorations?: boolean
  noteStartXOverride?: number
  freezePreviewAccidentalLayout?: boolean
  formatWidthOverride?: number
  timeAxisSpacingConfig?: TimeAxisSpacingConfig
  skipPainting?: boolean
  staticNoteXById?: Map<string, number> | null
  staticAccidentalRightXById?: Map<string, Map<number, number>> | null
  debugCapture?: {
    frame: number
    draggedNoteId: string
    draggedStaff: StaffKind
    staticByNoteKey: Map<string, DragDebugStaticRecord>
    pushSnapshot: (snapshot: DragDebugSnapshot) => void
  } | null
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
    draggingSelection: dragging,
    previewNote = null,
    previewAccidentalStateBeforeNote = null,
    collectLayouts = true,
    suppressSystemDecorations = false,
    noteStartXOverride,
    freezePreviewAccidentalLayout = false,
    formatWidthOverride,
    timeAxisSpacingConfig,
    skipPainting = false,
    staticNoteXById = null,
    staticAccidentalRightXById = null,
    debugCapture = null,
  } = params
  const noteLayouts: NoteLayout[] = []
  const timeSignatureLabel = `${timeSignature.beats}/${timeSignature.beatType}`
  const endTimeSignatureLabel =
    showEndTimeSignature && endTimeSignature ? `${endTimeSignature.beats}/${endTimeSignature.beatType}` : null
  const lockPreviewAccidentalLayout = freezePreviewAccidentalLayout && previewNote !== null
  const previewAccidentalByRowKey = new Map<string, number>()
  const accidentalLockByRowKey = new Map<string, { targetRightX: number | null; applied: boolean; reason: string }>()

  const resolveRenderedNoteData = (
    note: ScoreNote,
    staff: StaffKind,
  ): { rootPitch: Pitch; chordPitches?: Pitch[]; previewedKeyIndex: number | null } => {
    if (!previewNote || previewNote.noteId !== note.id || previewNote.staff !== staff) {
      return { rootPitch: note.pitch, chordPitches: note.chordPitches, previewedKeyIndex: null }
    }

    if (previewNote.keyIndex <= 0) {
      return { rootPitch: previewNote.pitch, chordPitches: note.chordPitches, previewedKeyIndex: 0 }
    }

    const chordIndex = previewNote.keyIndex - 1
    const sourceChordPitches = note.chordPitches
    if (!sourceChordPitches || chordIndex < 0 || chordIndex >= sourceChordPitches.length) {
      return { rootPitch: note.pitch, chordPitches: sourceChordPitches, previewedKeyIndex: null }
    }

    const chordPitches = sourceChordPitches.slice()
    chordPitches[chordIndex] = previewNote.pitch
    return { rootPitch: note.pitch, chordPitches, previewedKeyIndex: previewNote.keyIndex }
  }

  const buildPreviewAccidentalOverridesForStaff = (
    notes: ScoreNote[],
    staff: StaffKind,
  ): Map<string, Map<number, string | null>> | null => {
    if (!previewNote || previewNote.staff !== staff || lockPreviewAccidentalLayout) return null

    const state = new Map<string, number>()
    const overrides = new Map<string, Map<number, string | null>>()
    notes.forEach((note) => {
      const rendered = resolveRenderedNoteData(note, staff)
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

  if (!skipPainting) {
    trebleStave.setContext(context).draw()
    bassStave.setContext(context).draw()
  }

  if (!suppressSystemDecorations && !skipPainting) {
    if (isSystemStart) {
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.BRACE).setContext(context).draw()
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw()
    }
    if (!showEndTimeSignature) {
      new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw()
    }
  }

  const trebleRendered = measure.treble.map((note) => {
    const rendered = resolveRenderedNoteData(note, 'treble')
    const forceChordIndex =
      !lockPreviewAccidentalLayout && rendered.previewedKeyIndex !== null && rendered.previewedKeyIndex > 0
        ? rendered.previewedKeyIndex - 1
        : null
    const renderedKeys = buildRenderedNoteKeys(
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
    const dots = getDurationDots(note.duration)
    const vexNote = new StaveNote({
      keys: renderedKeys.map((entry) => entry.pitch),
      duration: toVexDuration(note.duration),
      dots,
      clef: 'treble',
      stemDirection: getStrictStemDirection(rendered.rootPitch),
    })
    renderedKeys.forEach((entry, keyIndex) => {
      if (!entry.accidental) return
      vexNote.addModifier(new Accidental(entry.accidental), keyIndex)
    })
    if (dots > 0) {
      Dot.buildAndAttach([vexNote], { all: true })
    }
    return { vexNote, renderedKeys }
  })

  const bassRendered = measure.bass.map((note) => {
    const rendered = resolveRenderedNoteData(note, 'bass')
    const forceChordIndex =
      !lockPreviewAccidentalLayout && rendered.previewedKeyIndex !== null && rendered.previewedKeyIndex > 0
        ? rendered.previewedKeyIndex - 1
        : null
    const renderedKeys = buildRenderedNoteKeys(
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
    const dots = getDurationDots(note.duration)
    const vexNote = new StaveNote({
      keys: renderedKeys.map((entry) => entry.pitch),
      duration: toVexDuration(note.duration),
      dots,
      clef: 'bass',
      autoStem: true,
    })
    renderedKeys.forEach((entry, keyIndex) => {
      if (!entry.accidental) return
      vexNote.addModifier(new Accidental(entry.accidental), keyIndex)
    })
    if (dots > 0) {
      Dot.buildAndAttach([vexNote], { all: true })
    }
    return { vexNote, renderedKeys }
  })

  const trebleVexNotes = trebleRendered.map((entry) => entry.vexNote)
  const bassVexNotes = bassRendered.map((entry) => entry.vexNote)
  trebleVexNotes.forEach((vexNote) => vexNote.setStave(trebleStave))
  bassVexNotes.forEach((vexNote) => vexNote.setStave(bassStave))

  trebleRendered.forEach(({ vexNote, renderedKeys }, noteIndex) => {
    const noteId = measure.treble[noteIndex].id
    if (dragging?.staff === 'treble' && dragging.noteId === noteId) {
      const renderedKeyIndex = renderedKeys.findIndex((entry) => entry.keyIndex === dragging.keyIndex)
      vexNote.setKeyStyle(Math.max(0, renderedKeyIndex), { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
    } else if (selection && selection.staff === 'treble' && selection.noteId === noteId) {
      const renderedKeyIndex = renderedKeys.findIndex((entry) => entry.keyIndex === selection.keyIndex)
      vexNote.setKeyStyle(Math.max(0, renderedKeyIndex), { fillStyle: '#1f7aa8', strokeStyle: '#1f7aa8' })
    }
  })

  bassRendered.forEach(({ vexNote, renderedKeys }, noteIndex) => {
    const noteId = measure.bass[noteIndex].id
    if (dragging?.staff === 'bass' && dragging.noteId === noteId) {
      const renderedKeyIndex = renderedKeys.findIndex((entry) => entry.keyIndex === dragging.keyIndex)
      vexNote.setKeyStyle(Math.max(0, renderedKeyIndex), { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
    } else if (selection && selection.staff === 'bass' && selection.noteId === noteId) {
      const renderedKeyIndex = renderedKeys.findIndex((entry) => entry.keyIndex === selection.keyIndex)
      vexNote.setKeyStyle(Math.max(0, renderedKeyIndex), { fillStyle: '#1f7aa8', strokeStyle: '#1f7aa8' })
    }
  })

  const trebleVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(trebleVexNotes)
  const bassVoice = new Voice({ numBeats: timeSignature.beats, beatValue: timeSignature.beatType }).addTickables(bassVexNotes)
  const formatWidth =
    typeof formatWidthOverride === 'number' && Number.isFinite(formatWidthOverride)
      ? Math.max(80, formatWidthOverride)
      : Math.max(80, trebleStave.getNoteEndX() - trebleStave.getNoteStartX() - 8)

  new Formatter().joinVoices([trebleVoice]).joinVoices([bassVoice]).format([trebleVoice, bassVoice], formatWidth)

  applyUnifiedTimeAxisSpacing({
    measure,
    noteStartX: trebleStave.getNoteStartX(),
    formatWidth,
    trebleRendered,
    bassRendered,
    spacingConfig: timeAxisSpacingConfig,
  })

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

  if (staticAccidentalRightXById && staticAccidentalRightXById.size > 0) {
    const alignRenderedAccidentalOffset = (
      staff: StaffKind,
      sourceNotes: ScoreNote[],
      rendered: { vexNote: StaveNote; renderedKeys: RenderedNoteKey[] }[],
    ) => {
      sourceNotes.forEach((sourceNote, noteIndex) => {
        const renderedEntry = rendered[noteIndex]
        if (!renderedEntry) return
        const layoutKey = getLayoutNoteKey(staff, sourceNote.id)
        const targetByKeyIndex = staticAccidentalRightXById.get(layoutKey)
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

          const targetedX = targetByKeyIndex?.get(renderedKey.keyIndex)
          const fallbackTarget = Number.isFinite(noteBaseX) ? noteBaseX + PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX : null
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
  }

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


  const trebleBeams = Beam.generateBeams(trebleVexNotes, { groups: [new Fraction(1, 4)] })
  const bassBeams = Beam.generateBeams(bassVexNotes, { groups: [new Fraction(1, 4)] })
  if (!skipPainting) {
    trebleVoice.draw(context, trebleStave)
    bassVoice.draw(context, bassStave)
    trebleBeams.forEach((beam) => beam.setContext(context).draw())
    bassBeams.forEach((beam) => beam.setContext(context).draw())
  }

  if (!collectLayouts) return noteLayouts

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

    const tieRightXRaw = vexNote.getTieRightX()
    const rightFromTie = Number.isFinite(tieRightXRaw) ? tieRightXRaw : Number.NEGATIVE_INFINITY

    let rightFromStem = Number.NEGATIVE_INFINITY
    if (vexNote.hasStem()) {
      const stemX = vexNote.getStemX()
      if (Number.isFinite(stemX)) {
        rightFromStem = stemX + 1
      }
    }

    const computedRightX = Math.max(fallbackRightX, rightFromBBox, rightFromMetrics, rightFromTie, rightFromStem)
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
    // Use the note-head edge as spacing boundary.
    // VexFlow's modRightPx may change with stem/beam internals and can cause
    // pitch-only edits to trigger false overflow reflow.
    return Number.isFinite(fallbackHeadRightX) ? fallbackHeadRightX : getRenderedNoteVisualX(vexNote) + 9
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
      renderedKeys.forEach((entry, renderedIndex) => {
        const offset = accidentalByRenderedIndex.get(renderedIndex)
        if (offset === undefined) return
        accidentalRightXByKeyIndex[entry.keyIndex] = offset
      })
      const noteHeads = renderedKeys.map((entry, renderedIndex) => ({
        x: renderedHeadXByIndex.get(renderedIndex) ?? getRenderedNoteVisualX(vexNote),
        y: ys[renderedIndex] ?? ys[0],
        pitch: entry.pitch,
        keyIndex: entry.keyIndex,
      }))
      const rootHead = noteHeads.find((head) => head.keyIndex === 0) ?? noteHeads[0]
      const noteRightX = getRenderedNoteRightX(vexNote, noteHeads)
      const noteSpacingRightX = getRenderedNoteSpacingRightX(vexNote, noteHeads)
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
      renderedKeys.forEach((entry, renderedIndex) => {
        const offset = accidentalByRenderedIndex.get(renderedIndex)
        if (offset === undefined) return
        accidentalRightXByKeyIndex[entry.keyIndex] = offset
      })
      const noteHeads = renderedKeys.map((entry, renderedIndex) => ({
        x: renderedHeadXByIndex.get(renderedIndex) ?? getRenderedNoteVisualX(vexNote),
        y: ys[renderedIndex] ?? ys[0],
        pitch: entry.pitch,
        keyIndex: entry.keyIndex,
      }))
      const rootHead = noteHeads.find((head) => head.keyIndex === 0) ?? noteHeads[0]
      const noteRightX = getRenderedNoteRightX(vexNote, noteHeads)
      const noteSpacingRightX = getRenderedNoteSpacingRightX(vexNote, noteHeads)
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
        accidentalRightXByKeyIndex,
      }
    }),
  )

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

  return noteLayouts
}


