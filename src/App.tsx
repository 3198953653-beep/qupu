import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import './App.css'
import {
  A4_PAGE_HEIGHT,
  A4_PAGE_WIDTH,
  DURATION_TICKS,
  INITIAL_NOTES,
  PIANO_MAX_MIDI,
  PIANO_MIN_MIDI,
  PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
  PREVIEW_START_THRESHOLD_PX,
  SCORE_TOP_PADDING,
  STEP_TO_SEMITONE,
  SYSTEM_BASS_OFFSET_Y,
  SYSTEM_HEIGHT,
  SYSTEM_TREBLE_OFFSET_Y,
  TICKS_PER_BEAT,
} from './score/constants'
import { buildAccidentalStateBeforeNote, getEffectivePitchForStaffPosition } from './score/accidentals'
import {
  toDisplayDuration,
} from './score/layout/demand'
import {
  DEFAULT_TIME_AXIS_SPACING_CONFIG,
} from './score/layout/timeAxisSpacing'
import { solveHorizontalMeasureWidths } from './score/layout/horizontalMeasureWidthSolver'
import { resolveEffectiveBoundary } from './score/layout/effectiveBoundary'
import {
  resolveActualStartDecorationWidths,
  resolveStartDecorationDisplayMetas,
} from './score/layout/startDecorationReserve'
import { useDragHandlers } from './score/dragHandlers'
import { useEditorHandlers } from './score/editorHandlers'
import { buildPlaybackTimeline, type PlaybackTimelineEvent } from './score/playbackTimeline'
import {
  useImportedRefsSync,
  useRendererCleanup,
  useRhythmLinkedBassSync,
  useScoreRenderEffect,
  useSynthLifecycle,
} from './score/hooks/useScoreEffects'
import { getDeleteAccidentalFailureMessage, getDeleteMeasureFailureMessage, getDeleteTieFailureMessage, getAccidentalEditFailureMessage, getCopyPasteFailureMessage, getDurationEditFailureMessage } from './score/editorMessages'
import { useMidiInputController } from './score/hooks/useMidiInputController'
import { usePlaybackController } from './score/hooks/usePlaybackController'
import { useScoreAudioPreviewController } from './score/hooks/useScoreAudioPreviewController'
import { useOsmdPreviewController } from './score/hooks/useOsmdPreviewController'
import { useScoreDebugApi } from './score/hooks/useScoreDebugApi'
import { ScoreControls } from './score/components/ScoreControls'
import { ScoreBoard } from './score/components/ScoreBoard'
import {
  createPianoPitches,
  toDisplayPitch,
} from './score/pitchUtils'
import {
  buildBassMockNotes,
  buildImportedNoteLookup,
  buildMeasurePairs,
  flattenBassFromPairs,
  flattenTrebleFromPairs,
} from './score/scoreOps'
import { commitDragPitchToScoreData } from './score/dragInteractions'
import { applyPaletteDurationEdit } from './score/durationEdits'
import {
  applyDeleteAccidentalSelection,
  applyPaletteAccidentalEdit,
} from './score/accidentalEdits'
import { applyDeleteTieSelection } from './score/tieEdits'
import { applyMidiStepInput, type MidiStepInputMode } from './score/midiStepEdits'
import { applyDeleteMeasureSelection } from './score/measureEdits'
import { isStaffFullMeasureRest, resolvePairTimeSignature } from './score/measureRestUtils'
import { appendIntervalKey, deleteSelectedKey, findSelectionLocationInPairs } from './score/keyboardEdits'
import { applyClipboardPaste, buildClipboardFromSelections } from './score/copyPasteEdits'
import { toPitchFromMidiWithKeyPreference } from './score/midiInput'
import { getStepOctaveAlterFromPitch, toPitchFromStepAlter } from './score/pitchMath'
import { buildStaffOnsetTicks, compareTimelinePoint, resolveSelectionTimelinePoint } from './score/selectionTimelineRange'
import { resolveForwardTieTargets, resolvePreviousTieTarget } from './score/tieChain'
import { buildSelectionGroupMoveTargets } from './score/selectionGroupTargets'
import { buildChordRulerEntries, getMeasureTicksFromTimeSignature, type ChordRulerEntry } from './score/chordRuler'
import { chordNameToDegree, normalizeKeyMode } from './score/chordDegree'
import type { MeasureTimelineBundle } from './score/timeline/types'
import type { NoteClipboardPayload } from './score/copyPasteTypes'
import {
  buildNotationPaletteDerivedDisplay,
  getDefaultNotationPaletteSelection,
  toggleDottedDuration,
  toTargetDurationFromPalette,
  type NotationPaletteItem,
  type NotationPaletteDerivedDisplay,
  type NotationPaletteResolvedSelection,
  type NotationPaletteSelection,
} from './score/notationPaletteConfig'
import type { HitGridIndex } from './score/layout/hitTest'
import type {
  BuiltInDemoMode,
  DragDebugSnapshot,
  DragState,
  ImportFeedback,
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureFrame,
  MeasureLayout,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  PlaybackCursorRect,
  PlaybackCursorState,
  PlaybackPoint,
  Pitch,
  RhythmPresetId,
  ScoreNote,
  Selection,
  SpacingLayoutMode,
  TieSelection,
  TimeSignature,
} from './score/types'

const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const INSPECTOR_SEQUENCE_PREVIEW_LIMIT = 64
const MANUAL_SCALE_BASELINE = 1
const DEFAULT_PAGE_HORIZONTAL_PADDING_PX = 86
const DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT = 134
const DEFAULT_CHORD_MARKER_PADDING_PX = 6
const CHORD_MARKER_UI_SCALE_PERCENT_MIN = 60
const CHORD_MARKER_UI_SCALE_PERCENT_MAX = 240
const CHORD_MARKER_PADDING_PX_MIN = 0
const CHORD_MARKER_PADDING_PX_MAX = 24
const SCORE_STAGE_BORDER_PX = 1
const PLAYHEAD_OFFSET_PX = 2
const PLAYHEAD_WIDTH_PX = 2
const PLAYHEAD_VERTICAL_MARGIN_PX = 15
const ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG = false
const HORIZONTAL_VIEW_MEASURE_WIDTH_PX = 220
const HORIZONTAL_VIEW_HEIGHT_PX = SCORE_TOP_PADDING * 2 + SYSTEM_HEIGHT + 26
const MAX_CANVAS_RENDER_DIM_PX = 32760
const HORIZONTAL_RENDER_BUFFER_PX = 400
const HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES = 1
const UNDO_HISTORY_LIMIT = 120
const LOCAL_STORAGE_EDITOR_MEASURE_NUMBER_KEY = 'score.editor.showInScoreMeasureNumbers'
const LOCAL_STORAGE_NOTEHEAD_JIANPU_DISPLAY_KEY = 'score.editor.showNoteHeadJianpu'
const LOCAL_STORAGE_PLAYHEAD_FOLLOW_KEY = 'score.playhead.followEnabled'
const LOCAL_STORAGE_CHORD_DEGREE_DISPLAY_KEY = 'score.chordDegree.enabled'
const CHORD_HIGHLIGHT_PAD_X_PX = 4
const CHORD_HIGHLIGHT_PAD_Y_PX = 4

const PITCHES: Pitch[] = createPianoPitches()
const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)

function toSequencePreview(notes: ScoreNote[]): string {
  if (notes.length <= INSPECTOR_SEQUENCE_PREVIEW_LIMIT) {
    return notes
      .map((note) => (note.isRest ? `Rest(${toDisplayDuration(note.duration)})` : toDisplayPitch(note.pitch)))
      .join('  |  ')
  }
  const preview = notes
    .slice(0, INSPECTOR_SEQUENCE_PREVIEW_LIMIT)
    .map((note) => (note.isRest ? `Rest(${toDisplayDuration(note.duration)})` : toDisplayPitch(note.pitch)))
    .join('  |  ')
  return `${preview}  |  ...（还剩 ${notes.length - INSPECTOR_SEQUENCE_PREVIEW_LIMIT} 个）`
}

function cloneScoreNote(note: ScoreNote): ScoreNote {
  return {
    ...note,
    chordPitches: note.chordPitches ? [...note.chordPitches] : undefined,
    chordAccidentals: note.chordAccidentals ? [...note.chordAccidentals] : undefined,
    chordTieStarts: note.chordTieStarts ? [...note.chordTieStarts] : undefined,
    chordTieStops: note.chordTieStops ? [...note.chordTieStops] : undefined,
    chordTieFrozenIncomingPitches: note.chordTieFrozenIncomingPitches ? [...note.chordTieFrozenIncomingPitches] : undefined,
    chordTieFrozenIncomingFromNoteIds: note.chordTieFrozenIncomingFromNoteIds
      ? [...note.chordTieFrozenIncomingFromNoteIds]
      : undefined,
    chordTieFrozenIncomingFromKeyIndices: note.chordTieFrozenIncomingFromKeyIndices
      ? [...note.chordTieFrozenIncomingFromKeyIndices]
      : undefined,
  }
}

function cloneMeasurePairs(pairs: MeasurePair[]): MeasurePair[] {
  return pairs.map((pair) => ({
    treble: pair.treble.map(cloneScoreNote),
    bass: pair.bass.map(cloneScoreNote),
  }))
}

function getAutoScoreScale(measureCount: number): number {
  if (measureCount >= 180) return 0.62
  if (measureCount >= 140) return 0.68
  if (measureCount >= 110) return 0.74
  if (measureCount >= 80) return 0.8
  if (measureCount >= 56) return 0.86
  if (measureCount >= 36) return 0.92
  return 1
}

function clampScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(55, Math.min(300, Math.round(value)))
}

function clampCanvasHeightPercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(70, Math.min(260, Math.round(value)))
}

function clampChordMarkerUiScalePercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT
  return Math.max(
    CHORD_MARKER_UI_SCALE_PERCENT_MIN,
    Math.min(CHORD_MARKER_UI_SCALE_PERCENT_MAX, Math.round(value)),
  )
}

function clampChordMarkerPaddingPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CHORD_MARKER_PADDING_PX
  return Math.round(clampNumber(value, CHORD_MARKER_PADDING_PX_MIN, CHORD_MARKER_PADDING_PX_MAX) * 2) / 2
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

type ChordMarkerStyleMetrics = {
  buttonHeightPx: number
  fontSizePx: number
  paddingInlinePx: number
  paddingBlockPx: number
  borderRadiusPx: number
  inlineTopPx: number
  inlineHeightPx: number
  stripHeightPx: number
  labelLeftInsetPx: number
}

function roundChordMarkerPx(value: number): number {
  return Math.round(value * 10) / 10
}

function getChordMarkerBaseStyleMetrics(scalePercent: number, uniformPaddingPx: number): ChordMarkerStyleMetrics {
  const safeScalePercent = clampChordMarkerUiScalePercent(scalePercent)
  const safePaddingPx = clampChordMarkerPaddingPx(uniformPaddingPx)
  const scale = safeScalePercent / 100
  const fontSizePx = roundChordMarkerPx(Math.max(8, 10 * scale))
  const paddingInlinePx = safePaddingPx
  const paddingBlockPx = safePaddingPx
  const buttonHeightPx = roundChordMarkerPx(fontSizePx + paddingBlockPx * 2)
  const borderRadiusPx = roundChordMarkerPx(Math.max(5, 7 * scale))
  const inlineTopPx = 22
  const inlineHeightPx = roundChordMarkerPx(Math.max(24, buttonHeightPx + 2))
  const stripHeightPx = roundChordMarkerPx(Math.max(46, inlineTopPx + inlineHeightPx))
  return {
    buttonHeightPx,
    fontSizePx,
    paddingInlinePx,
    paddingBlockPx,
    borderRadiusPx,
    inlineTopPx,
    inlineHeightPx,
    stripHeightPx,
    labelLeftInsetPx: paddingInlinePx,
  }
}

function applyChordMarkerVisualZoom(
  baseMetrics: ChordMarkerStyleMetrics,
  zoomScale: number,
): ChordMarkerStyleMetrics {
  const safeZoomScale = Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1
  const buttonHeightPx = roundChordMarkerPx(baseMetrics.buttonHeightPx * safeZoomScale)
  const fontSizePx = roundChordMarkerPx(baseMetrics.fontSizePx * safeZoomScale)
  const paddingInlinePx = roundChordMarkerPx(baseMetrics.paddingInlinePx * safeZoomScale)
  const paddingBlockPx = roundChordMarkerPx(baseMetrics.paddingBlockPx * safeZoomScale)
  const borderRadiusPx = roundChordMarkerPx(baseMetrics.borderRadiusPx * safeZoomScale)
  const inlineTopPx = baseMetrics.inlineTopPx
  const inlineHeightPx = roundChordMarkerPx(baseMetrics.inlineHeightPx * safeZoomScale)
  const baseBottomGapPx = Math.max(0, baseMetrics.stripHeightPx - (baseMetrics.inlineTopPx + baseMetrics.inlineHeightPx))
  const stripHeightPx = roundChordMarkerPx(
    inlineTopPx + inlineHeightPx + baseBottomGapPx * safeZoomScale,
  )
  return {
    buttonHeightPx,
    fontSizePx,
    paddingInlinePx,
    paddingBlockPx,
    borderRadiusPx,
    inlineTopPx,
    inlineHeightPx,
    stripHeightPx,
    labelLeftInsetPx: roundChordMarkerPx(baseMetrics.labelLeftInsetPx * safeZoomScale),
  }
}

function resolvePairKeyFifthsForKeyboard(pairIndex: number, keyFifthsByMeasure?: number[] | null): number {
  if (!keyFifthsByMeasure || keyFifthsByMeasure.length === 0) return 0
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyFifthsByMeasure[index]
    if (Number.isFinite(value)) return Math.trunc(value)
  }
  return 0
}

function resolvePairKeyMode(pairIndex: number, keyModesByMeasure?: string[] | null): 'major' | 'minor' {
  if (!keyModesByMeasure || keyModesByMeasure.length === 0) return 'major'
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyModesByMeasure[index]
    if (typeof value === 'string' && value.trim().length > 0) {
      return normalizeKeyMode(value)
    }
  }
  return 'major'
}

function shiftPitchByStaffSteps(pitch: Pitch, direction: 'up' | 'down', staffSteps = 1): Pitch | null {
  const diatonicSteps = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
  const { step, octave } = getStepOctaveAlterFromPitch(pitch)
  const sourceIndex = diatonicSteps.indexOf(step)
  if (sourceIndex < 0) return null
  const shift = Math.max(1, Math.trunc(staffSteps))
  const shiftedRawIndex = sourceIndex + (direction === 'up' ? shift : -shift)
  const octaveShift = Math.floor(shiftedRawIndex / diatonicSteps.length)
  const wrappedIndex = ((shiftedRawIndex % diatonicSteps.length) + diatonicSteps.length) % diatonicSteps.length
  const targetStep = diatonicSteps[wrappedIndex]
  const targetOctave = octave + octaveShift
  return toPitchFromStepAlter(targetStep, 0, targetOctave)
}

function isPitchWithinPianoRange(pitch: Pitch): boolean {
  const { step, octave, alter } = getStepOctaveAlterFromPitch(pitch)
  const semitone = STEP_TO_SEMITONE[step]
  if (semitone === undefined) return false
  const midi = (octave + 1) * 12 + semitone + alter
  return midi >= PIANO_MIN_MIDI && midi <= PIANO_MAX_MIDI
}

function clampDurationGapRatio(value: number): number {
  const clamped = clampNumber(value, 0.5, 4)
  return Number(clamped.toFixed(2))
}

function clampBaseMinGap32Px(value: number): number {
  const clamped = clampNumber(value, 0, 12)
  return Number(clamped.toFixed(2))
}

function clampLeadingBarlineGapPx(value: number): number {
  const clamped = clampNumber(value, 0, 80)
  return Number(clamped.toFixed(2))
}

function clampSecondChordSafeGapPx(value: number): number {
  const clamped = clampNumber(value, 0, 12)
  return Number(clamped.toFixed(2))
}

function clampPageHorizontalPaddingPx(value: number): number {
  return Math.round(clampNumber(value, 8, 120))
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('[contenteditable="true"]'))
}

type ChordRulerMarker = {
  key: string
  xPx: number
  sourceLabel: string
  displayLabel: string
  isActive: boolean
  pairIndex: number
  positionText: string
  beatIndex?: number | null
}

type ChordRulerMarkerAnchorSource = 'note-head' | 'spacing-tick' | 'axis' | 'frame'

type ChordRulerMarkerGeometry = {
  key: string
  pairIndex: number
  sourceLabel: string
  startTick: number
  endTick: number
  positionText: string
  beatIndex?: number | null
  anchorSource: ChordRulerMarkerAnchorSource
  anchorGlobalX: number
  keyFifths: number
  keyMode: 'major' | 'minor'
}

type ChordRulerMarkerMeta = {
  key: string
  pairIndex: number
  sourceLabel: string
  displayLabel: string
  startTick: number
  endTick: number
  positionText: string
  beatIndex?: number | null
  anchorGlobalX: number
  anchorXPx: number
  xPx: number
  anchorSource: ChordRulerMarkerAnchorSource
  keyFifths: number
  keyMode: 'major' | 'minor'
}

type ActiveChordSelection = {
  markerKey: string | null
  pairIndex: number
  startTick: number
  endTick: number
}

function getPlaybackPointKey(point: PlaybackPoint): string {
  return `${point.pairIndex}:${point.onsetTick}`
}

function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}

function appendUniqueSelection(current: Selection[], next: Selection): Selection[] {
  if (current.some((entry) => isSameSelection(entry, next))) return current
  return [...current, next]
}

type MeasureStaffScope = {
  pairIndex: number
  staff: Selection['staff']
}

function toMeasureStaffScopeKey(scope: MeasureStaffScope): string {
  return `${Math.trunc(scope.pairIndex)}:${scope.staff}`
}

function parseMeasureStaffScopeKey(key: string): MeasureStaffScope | null {
  if (!key) return null
  const [rawPairIndex, rawStaff] = key.split(':')
  if (rawStaff !== 'treble' && rawStaff !== 'bass') return null
  const pairIndex = Number(rawPairIndex)
  if (!Number.isFinite(pairIndex)) return null
  return {
    pairIndex: Math.trunc(pairIndex),
    staff: rawStaff,
  }
}

function sortMeasureStaffScopeKeys(keys: Iterable<string>): string[] {
  const scopes: MeasureStaffScope[] = []
  const deduped = new Set<string>()
  for (const key of keys) {
    const parsed = parseMeasureStaffScopeKey(key)
    if (!parsed || parsed.pairIndex < 0) continue
    const normalized = toMeasureStaffScopeKey(parsed)
    if (deduped.has(normalized)) continue
    deduped.add(normalized)
    scopes.push(parsed)
  }
  scopes.sort((left, right) => {
    if (left.pairIndex !== right.pairIndex) return left.pairIndex - right.pairIndex
    if (left.staff === right.staff) return 0
    return left.staff === 'treble' ? -1 : 1
  })
  return scopes.map((scope) => toMeasureStaffScopeKey(scope))
}

function collectChangedMeasureStaffScopeKeys(sourcePairs: MeasurePair[], nextPairs: MeasurePair[]): Set<string> {
  const changed = new Set<string>()
  const pairCount = Math.max(sourcePairs.length, nextPairs.length)
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const sourcePair = sourcePairs[pairIndex]
    const nextPair = nextPairs[pairIndex]
    if (!sourcePair || !nextPair) {
      changed.add(toMeasureStaffScopeKey({ pairIndex, staff: 'treble' }))
      changed.add(toMeasureStaffScopeKey({ pairIndex, staff: 'bass' }))
      continue
    }
    if (sourcePair.treble !== nextPair.treble) {
      changed.add(toMeasureStaffScopeKey({ pairIndex, staff: 'treble' }))
    }
    if (sourcePair.bass !== nextPair.bass) {
      changed.add(toMeasureStaffScopeKey({ pairIndex, staff: 'bass' }))
    }
  }
  return changed
}

function mergeFullMeasureRestCollapseScopeKeys(params: {
  currentScopeKeys: string[]
  sourcePairs: MeasurePair[]
  nextPairs: MeasurePair[]
  collapseScopesToAdd?: MeasureStaffScope[]
}): string[] {
  const {
    currentScopeKeys,
    sourcePairs,
    nextPairs,
    collapseScopesToAdd = [],
  } = params
  const nextScopeKeys = new Set<string>()
  const changedScopeKeys = collectChangedMeasureStaffScopeKeys(sourcePairs, nextPairs)
  const maxPairIndex = nextPairs.length - 1

  currentScopeKeys.forEach((scopeKey) => {
    const parsed = parseMeasureStaffScopeKey(scopeKey)
    if (!parsed) return
    if (parsed.pairIndex < 0 || parsed.pairIndex > maxPairIndex) return
    const normalized = toMeasureStaffScopeKey(parsed)
    if (changedScopeKeys.has(normalized)) return
    nextScopeKeys.add(normalized)
  })

  collapseScopesToAdd.forEach((scope) => {
    const normalized: MeasureStaffScope = {
      pairIndex: Math.trunc(scope.pairIndex),
      staff: scope.staff,
    }
    if (!Number.isFinite(normalized.pairIndex)) return
    if (normalized.pairIndex < 0 || normalized.pairIndex > maxPairIndex) return
    if (normalized.staff !== 'treble' && normalized.staff !== 'bass') return
    nextScopeKeys.add(toMeasureStaffScopeKey(normalized))
  })

  return sortMeasureStaffScopeKeys(nextScopeKeys)
}

function buildSelectionsForMeasureStaff(
  pair: MeasurePair,
  staff: Selection['staff'],
  options?: {
    collapseFullMeasureRest?: boolean
    timeSignature?: TimeSignature | null
  },
): Selection[] {
  const notes = staff === 'treble' ? pair.treble : pair.bass
  if (
    options?.collapseFullMeasureRest &&
    options.timeSignature &&
    isStaffFullMeasureRest(notes, options.timeSignature) &&
    notes[0]
  ) {
    return [{ noteId: notes[0].id, staff, keyIndex: 0 }]
  }
  const selections: Selection[] = []
  notes.forEach((note) => {
    const keyCount = 1 + (note.chordPitches?.length ?? 0)
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
      selections.push({ noteId: note.id, staff, keyIndex })
    }
  })
  return selections
}

function buildSelectionsForMeasureTickRange(
  pair: MeasurePair,
  startTickInclusive: number,
  endTickExclusive: number,
): Selection[] {
  const safeStartTick = Math.max(0, Math.round(startTickInclusive))
  const safeEndTick = Math.max(safeStartTick, Math.round(endTickExclusive))
  if (safeEndTick <= safeStartTick) return []
  const selections: Selection[] = []
  ;(['treble', 'bass'] as const).forEach((staff) => {
    const notes = staff === 'treble' ? pair.treble : pair.bass
    const onsetTicksByNoteIndex = buildStaffOnsetTicks(notes)
    notes.forEach((note, noteIndex) => {
      const onsetTick = onsetTicksByNoteIndex[noteIndex]
      if (!Number.isFinite(onsetTick)) return
      if (onsetTick < safeStartTick || onsetTick >= safeEndTick) return
      const maxKeyIndex = note.chordPitches?.length ?? 0
      for (let keyIndex = 0; keyIndex <= maxKeyIndex; keyIndex += 1) {
        selections.push({
          noteId: note.id,
          staff,
          keyIndex,
        })
      }
    })
  })
  return selections
}

type FirstMeasureNoteDebugRow = {
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: Pitch
  noteX: number | null
  noteRightX: number | null
  spacingRightX: number | null
  headX: number | null
  headY: number | null
  pitchY: number | null
}

type FirstMeasureSnapshot = {
  stage: string
  pairIndex: number
  generatedAt: string
  measureX: number | null
  measureWidth: number | null
  measureEndBarX: number | null
  noteStartX: number | null
  noteEndX: number | null
  rows: FirstMeasureNoteDebugRow[]
}

type UndoSnapshot = {
  pairs: MeasurePair[]
  imported: boolean
  selection: Selection
  isSelectionVisible: boolean
  fullMeasureRestCollapseScopeKeys: string[]
}

function App() {
  const [notes, setNotes] = useState<ScoreNote[]>(INITIAL_NOTES)
  const [bassNotes, setBassNotes] = useState<ScoreNote[]>(INITIAL_BASS_NOTES)
  const [rhythmPreset, setRhythmPreset] = useState<RhythmPresetId>('quarter')
  const [activeBuiltInDemo, setActiveBuiltInDemo] = useState<BuiltInDemoMode>('none')
  const [activeSelection, setActiveSelection] = useState<Selection>({ noteId: INITIAL_NOTES[0].id, staff: 'treble', keyIndex: 0 })
  const [activeAccidentalSelection, setActiveAccidentalSelection] = useState<Selection | null>(null)
  const [activeTieSelection, setActiveTieSelection] = useState<TieSelection | null>(null)
  const [selectedSelections, setSelectedSelections] = useState<Selection[]>([
    { noteId: INITIAL_NOTES[0].id, staff: 'treble', keyIndex: 0 },
  ])
  const [selectedMeasureScope, setSelectedMeasureScope] = useState<{ pairIndex: number; staff: Selection['staff'] } | null>(null)
  const [activeChordSelection, setActiveChordSelection] = useState<ActiveChordSelection | null>(null)
  const [fullMeasureRestCollapseScopeKeys, setFullMeasureRestCollapseScopeKeys] = useState<string[]>([])
  const [isSelectionVisible, setIsSelectionVisible] = useState(true)
  const [draggingSelection, setDraggingSelection] = useState<Selection | null>(null)
  const [dragPreviewState, setDragPreviewState] = useState<DragState | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [musicXmlInput, setMusicXmlInput] = useState<string>('')
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>({ kind: 'idle', message: '' })
  const [isNotationPaletteOpen, setIsNotationPaletteOpen] = useState(false)
  const [notationPaletteSelection, setNotationPaletteSelection] = useState<NotationPaletteSelection>(
    () => getDefaultNotationPaletteSelection(),
  )
  const [notationPaletteLastAction, setNotationPaletteLastAction] = useState('未选择')
  const [isRhythmLinked, setIsRhythmLinked] = useState(false)
  const [measurePairsFromImport, setMeasurePairsFromImport] = useState<MeasurePair[] | null>(null)
  const [measureKeyFifthsFromImport, setMeasureKeyFifthsFromImport] = useState<number[] | null>(null)
  const [measureKeyModesFromImport, setMeasureKeyModesFromImport] = useState<string[] | null>(null)
  const [measureDivisionsFromImport, setMeasureDivisionsFromImport] = useState<number[] | null>(null)
  const [measureTimeSignaturesFromImport, setMeasureTimeSignaturesFromImport] = useState<TimeSignature[] | null>(null)
  const [musicXmlMetadataFromImport, setMusicXmlMetadataFromImport] = useState<MusicXmlMetadata | null>(null)
  const [importedChordRulerEntriesByPairFromImport, setImportedChordRulerEntriesByPairFromImport] = useState<ChordRulerEntry[][] | null>(null)
  const [, setDragDebugReport] = useState<string>('')
  const [, setMeasureEdgeDebugReport] = useState<string>('')
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false)
  const [manualScalePercent, setManualScalePercent] = useState(100)
  const [canvasHeightPercent, setCanvasHeightPercent] = useState(100)
  const [playheadFollowEnabled, setPlayheadFollowEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    const storedValue = window.localStorage.getItem(LOCAL_STORAGE_PLAYHEAD_FOLLOW_KEY)
    if (storedValue === '1' || storedValue === 'true') return true
    if (storedValue === '0' || storedValue === 'false') return false
    return true
  })
  const [showChordDegreeEnabled, setShowChordDegreeEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    const storedValue = window.localStorage.getItem(LOCAL_STORAGE_CHORD_DEGREE_DISPLAY_KEY)
    if (storedValue === '1' || storedValue === 'true') return true
    if (storedValue === '0' || storedValue === 'false') return false
    return false
  })
  const [showInScoreMeasureNumbers, setShowInScoreMeasureNumbers] = useState(false)
  const [showNoteHeadJianpuEnabled, setShowNoteHeadJianpuEnabled] = useState(false)
  const [pageHorizontalPaddingPx, setPageHorizontalPaddingPx] = useState(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
  const [chordMarkerUiScalePercent, setChordMarkerUiScalePercent] = useState(DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT)
  const [chordMarkerPaddingPx, setChordMarkerPaddingPx] = useState(DEFAULT_CHORD_MARKER_PADDING_PX)
  const [timeAxisSpacingConfig, setTimeAxisSpacingConfig] = useState(DEFAULT_TIME_AXIS_SPACING_CONFIG)
  const [horizontalViewportXRange, setHorizontalViewportXRange] = useState<{ startX: number; endX: number }>({
    startX: 0,
    endX: A4_PAGE_WIDTH,
  })

  const scoreRef = useRef<HTMLCanvasElement | null>(null)
  const scoreOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const scoreScrollRef = useRef<HTMLDivElement | null>(null)
  const scoreStageRef = useRef<HTMLDivElement | null>(null)
  const playheadFollowHydratedRef = useRef(false)
  const chordDegreeDisplayHydratedRef = useRef(false)
  const showInScoreMeasureNumbersHydratedRef = useRef(false)
  const showNoteHeadJianpuHydratedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | Tone.Sampler | null>(null)

  const noteLayoutsRef = useRef<NoteLayout[]>([])
  const noteLayoutsByPairRef = useRef<Map<number, NoteLayout[]>>(new Map())
  const noteLayoutByKeyRef = useRef<Map<string, NoteLayout>>(new Map())
  const horizontalRenderOffsetXRef = useRef(0)
  const hitGridRef = useRef<HitGridIndex | null>(null)
  const measureLayoutsRef = useRef<Map<number, MeasureLayout>>(new Map())
  const measureTimelineBundlesRef = useRef<Map<number, MeasureTimelineBundle>>(new Map())
  const measurePairsRef = useRef<MeasurePair[]>([])
  const dragDebugFramesRef = useRef<DragDebugSnapshot[]>([])
  const dragRef = useRef<DragState | null>(null)
  const dragPreviewFrameRef = useRef(0)
  const dragRafRef = useRef<number | null>(null)
  const dragPendingRef = useRef<{ drag: DragState; pitch: Pitch } | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const rendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const widthProbeRendererRef = useRef<Renderer | null>(null)
  const horizontalMeasureWidthCacheRef = useRef<Map<string, number>>(new Map())
  const overlayRendererRef = useRef<Renderer | null>(null)
  const overlayRendererSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const overlayLastRectRef = useRef<MeasureLayout['overlayRect'] | null>(null)
  const stopPlayTimerRef = useRef<number | null>(null)
  const playbackPointTimerIdsRef = useRef<number[]>([])
  const playbackSessionIdRef = useRef(0)
  const measurePairsFromImportRef = useRef<MeasurePair[] | null>(null)
  const measureKeyFifthsFromImportRef = useRef<number[] | null>(null)
  const measureKeyModesFromImportRef = useRef<string[] | null>(null)
  const measureDivisionsFromImportRef = useRef<number[] | null>(null)
  const measureTimeSignaturesFromImportRef = useRef<TimeSignature[] | null>(null)
  const musicXmlMetadataFromImportRef = useRef<MusicXmlMetadata | null>(null)
  const importedNoteLookupRef = useRef<Map<string, ImportedNoteLocation>>(new Map())
  const firstMeasureBaselineRef = useRef<FirstMeasureSnapshot | null>(null)
  const firstMeasureDragContextRef = useRef<{
    noteId: string
    staff: Selection['staff']
    keyIndex: number
    pairIndex: number
  } | null>(null)
  const firstMeasureDebugRafRef = useRef<number | null>(null)
  const importFeedbackRef = useRef<ImportFeedback>(importFeedback)
  const activeSelectionRef = useRef<Selection>(activeSelection)
  const selectedSelectionsRef = useRef<Selection[]>(selectedSelections)
  const fullMeasureRestCollapseScopeKeysRef = useRef<string[]>(fullMeasureRestCollapseScopeKeys)
  const isSelectionVisibleRef = useRef<boolean>(isSelectionVisible)
  const draggingSelectionRef = useRef<Selection | null>(draggingSelection)
  const undoHistoryRef = useRef<UndoSnapshot[]>([])
  const layoutReflowHintRef = useRef<LayoutReflowHint | null>(null)
  const midiStepChainRef = useRef(false)
  const midiStepLastSelectionRef = useRef<Selection | null>(null)
  const noteClipboardRef = useRef<NoteClipboardPayload | null>(null)
  const chordMarkerLayoutRequestRef = useRef(0)
  const chordMarkerLayoutAppliedRef = useRef(0)
  const isOsmdPreviewOpenRef = useRef(false)
  const { notePreviewEventsRef, handlePreviewScoreNote, playAccidentalEditPreview } =
    useScoreAudioPreviewController({
      synthRef,
    })
  const measurePairs = useMemo(
    () => measurePairsFromImport ?? buildMeasurePairs(notes, bassNotes),
    [measurePairsFromImport, notes, bassNotes],
  )
  const chordRulerEntriesByPair = useMemo(
    () => {
      if (measurePairsFromImport !== null) {
        if (!importedChordRulerEntriesByPairFromImport) return null
        return measurePairs.map((_, pairIndex) => importedChordRulerEntriesByPairFromImport[pairIndex] ?? [])
      }
      return measurePairs.map((_, pairIndex) =>
        buildChordRulerEntries({
          pairIndex,
          timeSignature: resolvePairTimeSignature(pairIndex, measureTimeSignaturesFromImport),
        }),
      )
    },
    [importedChordRulerEntriesByPairFromImport, measurePairs, measurePairsFromImport, measureTimeSignaturesFromImport],
  )
  const supplementalSpacingTicksByPair = useMemo(
    () =>
      chordRulerEntriesByPair
        ? chordRulerEntriesByPair.map((entries) => entries.map((entry) => entry.startTick))
        : null,
    [chordRulerEntriesByPair],
  )
  const playbackTimelineEvents = useMemo(
    () =>
      buildPlaybackTimeline({
        measurePairs,
        timeSignaturesByMeasure: measureTimeSignaturesFromImport,
      }),
    [measurePairs, measureTimeSignaturesFromImport],
  )
  const playbackTimelineEventByPointKey = useMemo(
    () =>
      new Map<string, PlaybackTimelineEvent>(
        playbackTimelineEvents.map((event) => [getPlaybackPointKey(event.point), event] as const),
      ),
    [playbackTimelineEvents],
  )
  const firstPlaybackPoint = playbackTimelineEvents[0]?.point ?? null
  const spacingLayoutMode: SpacingLayoutMode = 'custom'
  const safeChordMarkerUiScalePercent = clampChordMarkerUiScalePercent(chordMarkerUiScalePercent)
  const safeChordMarkerPaddingPx = clampChordMarkerPaddingPx(chordMarkerPaddingPx)
  const chordMarkerBaseStyleMetrics = useMemo(
    () => getChordMarkerBaseStyleMetrics(safeChordMarkerUiScalePercent, safeChordMarkerPaddingPx),
    [safeChordMarkerPaddingPx, safeChordMarkerUiScalePercent],
  )
  const getWidthProbeContext = useCallback((): ReturnType<Renderer['getContext']> | null => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null
    const probeWidth = 2048
    const probeHeight = 768
    const existing = widthProbeRendererRef.current
    if (existing) {
      existing.resize(probeWidth, probeHeight)
      return existing.getContext()
    }
    const canvas = document.createElement('canvas')
    const renderer = new Renderer(canvas, SCORE_RENDER_BACKEND)
    renderer.resize(probeWidth, probeHeight)
    widthProbeRendererRef.current = renderer
    return renderer.getContext()
  }, [])
  const horizontalMeasureStartDecorationWidths = useMemo(() => {
    if (measurePairs.length === 0) return []
    const displayMetas = resolveStartDecorationDisplayMetas({
      measureCount: measurePairs.length,
      keyFifthsByPair: measureKeyFifthsFromImport,
      timeSignaturesByPair: measureTimeSignaturesFromImport,
    })
    return resolveActualStartDecorationWidths({
      metas: displayMetas,
    }).actualStartDecorationWidthPxByPair
  }, [measurePairs.length, measureKeyFifthsFromImport, measureTimeSignaturesFromImport])
  const horizontalContentMeasureWidths = useMemo(() => {
    if (measurePairs.length === 0) return []
    const probeContext = getWidthProbeContext()
    if (!probeContext) {
      return measurePairs.map(() => HORIZONTAL_VIEW_MEASURE_WIDTH_PX)
    }
    const solverMaxIterations =
      measurePairs.length > 120 ? 8 : measurePairs.length > 48 ? 16 : 60
    const eagerProbeMeasureLimit =
      measurePairs.length > 120 ? 16 : measurePairs.length > 60 ? 24 : Number.POSITIVE_INFINITY
    return solveHorizontalMeasureWidths({
      context: probeContext,
      measurePairs,
      measureKeyFifthsByPair: measureKeyFifthsFromImport,
      measureTimeSignaturesByPair: measureTimeSignaturesFromImport,
      supplementalSpacingTicksByPair,
      spacingConfig: timeAxisSpacingConfig,
      maxIterations: solverMaxIterations,
      eagerProbeMeasureLimit,
      widthCache: horizontalMeasureWidthCacheRef.current,
    })
  }, [
    getWidthProbeContext,
    measurePairs,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair,
    timeAxisSpacingConfig,
  ])
  const horizontalRenderedMeasureWidths = useMemo(
    () =>
      horizontalContentMeasureWidths.map((contentMeasureWidth, pairIndex) =>
        Math.max(1, contentMeasureWidth + (horizontalMeasureStartDecorationWidths[pairIndex] ?? 0)),
      ),
    [horizontalContentMeasureWidths, horizontalMeasureStartDecorationWidths],
  )
  const horizontalEstimatedMeasureWidthTotal = useMemo(() => {
    if (horizontalRenderedMeasureWidths.length === 0) return HORIZONTAL_VIEW_MEASURE_WIDTH_PX
    const total = horizontalRenderedMeasureWidths.reduce((sum, width) => sum + width, 0)
    return Math.max(HORIZONTAL_VIEW_MEASURE_WIDTH_PX, total)
  }, [horizontalRenderedMeasureWidths])
  const autoScoreScale = useMemo(() => getAutoScoreScale(measurePairs.length), [measurePairs.length])
  const safeManualScalePercent = clampScalePercent(manualScalePercent)
  const safeCanvasHeightPercent = clampCanvasHeightPercent(canvasHeightPercent)
  const relativeScale = autoScaleEnabled ? autoScoreScale : safeManualScalePercent / 100
  const horizontalDisplayScale = relativeScale * MANUAL_SCALE_BASELINE
  const provisionalDisplayScoreHeight = HORIZONTAL_VIEW_HEIGHT_PX
  const displayScoreWidth = useMemo(() => {
    const totalMeasureWidth = horizontalEstimatedMeasureWidthTotal
    const baseWidth = Math.max(A4_PAGE_WIDTH, pageHorizontalPaddingPx * 2 + totalMeasureWidth)
    // Keep horizontal display width in the same scale space as canvas transform.
    // Otherwise scroll-space and render-space drift apart and can leave blank tails.
    return Math.max(A4_PAGE_WIDTH, Math.round(baseWidth * horizontalDisplayScale))
  }, [horizontalEstimatedMeasureWidthTotal, pageHorizontalPaddingPx, horizontalDisplayScale])
  const baseScoreScale = relativeScale * MANUAL_SCALE_BASELINE
  const minScaleForCanvasHeight = provisionalDisplayScoreHeight / MAX_CANVAS_RENDER_DIM_PX
  const scoreScaleX = baseScoreScale
  const scoreScaleY = Math.max(baseScoreScale, minScaleForCanvasHeight)
  const chordMarkerStyleMetrics = useMemo(
    () => applyChordMarkerVisualZoom(chordMarkerBaseStyleMetrics, baseScoreScale),
    [baseScoreScale, chordMarkerBaseStyleMetrics],
  )
  const canvasHeightScale = safeCanvasHeightPercent / 100
  const viewportHeightScaleByZoom = Math.max(0.1, scoreScaleY / MANUAL_SCALE_BASELINE)
  const scoreScale = scoreScaleX
  const autoScalePercent = Math.round(baseScoreScale * 100)
  const totalScoreWidth = Math.max(1, Math.round(displayScoreWidth / scoreScaleX))
  const trebleNoteById = useMemo(() => new Map(notes.map((note) => [note.id, note] as const)), [notes])
  const bassNoteById = useMemo(() => new Map(bassNotes.map((note) => [note.id, note] as const)), [bassNotes])
  const trebleNoteIndexById = useMemo(() => {
    const byId = new Map<string, number>()
    notes.forEach((note, index) => byId.set(note.id, index))
    return byId
  }, [notes])
  const bassNoteIndexById = useMemo(() => {
    const byId = new Map<string, number>()
    bassNotes.forEach((note, index) => byId.set(note.id, index))
    return byId
  }, [bassNotes])
  const horizontalMeasureFramesByPair = useMemo(() => {
    if (horizontalRenderedMeasureWidths.length === 0) return [] as MeasureFrame[]
    let cursorX = pageHorizontalPaddingPx
    return horizontalRenderedMeasureWidths.map((measureWidth, pairIndex) => {
      const contentMeasureWidth = horizontalContentMeasureWidths[pairIndex] ?? Math.max(1, measureWidth)
      const actualStartDecorationWidthPx = horizontalMeasureStartDecorationWidths[pairIndex] ?? 0
      const frame: MeasureFrame = {
        measureX: cursorX,
        measureWidth,
        contentMeasureWidth,
        renderedMeasureWidth: measureWidth,
        actualStartDecorationWidthPx,
      }
      cursorX += measureWidth
      return frame
    })
  }, [
    horizontalContentMeasureWidths,
    horizontalRenderedMeasureWidths,
    horizontalMeasureStartDecorationWidths,
    pageHorizontalPaddingPx,
  ])
  const getMeasureFrameContentGeometry = useCallback((frame: MeasureFrame | null | undefined) => {
    if (!frame) return null
    const actualStartDecorationWidthPx =
      typeof frame.actualStartDecorationWidthPx === 'number' && Number.isFinite(frame.actualStartDecorationWidthPx)
        ? Math.max(0, frame.actualStartDecorationWidthPx)
        : 0
    const contentMeasureWidth =
      typeof frame.contentMeasureWidth === 'number' && Number.isFinite(frame.contentMeasureWidth)
        ? Math.max(1, frame.contentMeasureWidth)
        : Math.max(1, frame.measureWidth - actualStartDecorationWidthPx)
    return {
      contentStartX: frame.measureX + actualStartDecorationWidthPx,
      contentMeasureWidth,
    }
  }, [])
  const horizontalViewportWidthInScore = Math.max(1, horizontalViewportXRange.endX - horizontalViewportXRange.startX)
  const horizontalRenderSurfaceWidth = useMemo(() => {
    const desiredWidth = Math.ceil(horizontalViewportWidthInScore + HORIZONTAL_RENDER_BUFFER_PX * 2)
    const targetWidth = Math.max(1200, desiredWidth)
    return Math.max(1, Math.min(totalScoreWidth, Math.min(MAX_CANVAS_RENDER_DIM_PX, targetWidth)))
  }, [totalScoreWidth, horizontalViewportWidthInScore])
  const horizontalRenderOffsetX = useMemo(() => {
    // Keep a left buffer inside the render surface so partially visible
    // measures at viewport start are not clipped when scrolling settles.
    const desiredOffset = Math.max(0, Math.floor(horizontalViewportXRange.startX - HORIZONTAL_RENDER_BUFFER_PX))
    const maxOffset = Math.max(0, totalScoreWidth - horizontalRenderSurfaceWidth)
    return Math.max(0, Math.min(maxOffset, desiredOffset))
  }, [horizontalViewportXRange.startX, totalScoreWidth, horizontalRenderSurfaceWidth])
  horizontalRenderOffsetXRef.current = horizontalRenderOffsetX
  const scoreWidth = horizontalRenderSurfaceWidth
  const systemRanges = useMemo(() => [{ startPairIndex: 0, endPairIndexExclusive: measurePairs.length }], [measurePairs.length])
  const scaledScoreContentHeight = Math.max(1, HORIZONTAL_VIEW_HEIGHT_PX * viewportHeightScaleByZoom)
  const displayScoreHeight = Math.max(1, Math.round(scaledScoreContentHeight * canvasHeightScale))
  const scoreHeight = Math.max(1, Math.round(scaledScoreContentHeight / scoreScaleY))
  const renderQualityScale = useMemo(() => {
    const maxBackingStoreDim = 32760
    const devicePixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1
    const targetQualityX = Math.max(1, devicePixelRatio, Math.abs(scoreScaleX))
    const targetQualityY = Math.max(1, devicePixelRatio, Math.abs(scoreScaleY))
    const maxQualityX = Math.max(1, maxBackingStoreDim / Math.max(1, scoreWidth))
    const maxQualityY = Math.max(1, maxBackingStoreDim / Math.max(1, scoreHeight))
    return {
      x: Math.max(1, Math.min(targetQualityX, maxQualityX)),
      y: Math.max(1, Math.min(targetQualityY, maxQualityY)),
    }
  }, [scoreScaleX, scoreScaleY, scoreWidth, scoreHeight])
  const systemsPerPage = 1
  const pageCount = 1
  const safeCurrentPage = 0
  const visibleSystemRange = useMemo(() => ({ start: 0, end: 0 }), [])
  const horizontalRenderWindow = useMemo(() => {
    const frames = horizontalMeasureFramesByPair
    const renderWindowStartX = horizontalRenderOffsetX
    const renderWindowEndX = Math.min(totalScoreWidth, horizontalRenderOffsetX + scoreWidth)
    if (frames.length === 0) {
      return {
        startPairIndex: 0,
        endPairIndexExclusive: 0,
        startX: renderWindowStartX,
        endX: renderWindowEndX,
      }
    }
    // The surface range already includes left/right buffer via horizontalRenderOffsetX
    // and horizontalRenderSurfaceWidth, so use it directly for pair filtering.
    const bufferedStartX = renderWindowStartX
    const bufferedEndX = renderWindowEndX

    let startPairIndex = 0
    while (
      startPairIndex < frames.length &&
      frames[startPairIndex].measureX + frames[startPairIndex].measureWidth < bufferedStartX
    ) {
      startPairIndex += 1
    }

    let endPairIndexExclusive = startPairIndex
    while (endPairIndexExclusive < frames.length && frames[endPairIndexExclusive].measureX <= bufferedEndX) {
      endPairIndexExclusive += 1
    }

    startPairIndex = Math.max(0, startPairIndex - HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES)
    endPairIndexExclusive = Math.min(frames.length, endPairIndexExclusive + HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES)
    if (endPairIndexExclusive <= startPairIndex) {
      startPairIndex = Math.max(0, Math.min(frames.length - 1, startPairIndex))
      endPairIndexExclusive = Math.min(frames.length, startPairIndex + 1)
    }

    const firstFrame = frames[startPairIndex]
    const lastFrame = frames[endPairIndexExclusive - 1]
    const startX = Math.max(0, (firstFrame?.measureX ?? 0) - 120)
    const endX = Math.min(totalScoreWidth, (lastFrame ? lastFrame.measureX + lastFrame.measureWidth : totalScoreWidth) + 120)
    return { startPairIndex, endPairIndexExclusive, startX, endX }
  }, [
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    scoreWidth,
    totalScoreWidth,
  ])
  const layoutStabilityKey = useMemo(() => {
    const systemRangeKey = systemRanges.map((range) => `${range.startPairIndex}-${range.endPairIndexExclusive}`).join(',')
    const spacingKey = [
      timeAxisSpacingConfig.baseMinGap32Px,
      timeAxisSpacingConfig.leadingBarlineGapPx,
      timeAxisSpacingConfig.secondChordSafeGapPx,
      timeAxisSpacingConfig.durationGapRatios.thirtySecond,
      timeAxisSpacingConfig.durationGapRatios.sixteenth,
      timeAxisSpacingConfig.durationGapRatios.eighth,
      timeAxisSpacingConfig.durationGapRatios.quarter,
      timeAxisSpacingConfig.durationGapRatios.half,
      timeAxisSpacingConfig.durationGapRatios.whole,
      spacingLayoutMode,
    ].join(',')
    return `${scoreWidth}|${scoreHeight}|${pageHorizontalPaddingPx}|${systemRangeKey}|${spacingKey}`
  }, [
    scoreWidth,
    scoreHeight,
    pageHorizontalPaddingPx,
    systemRanges,
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.leadingBarlineGapPx,
    timeAxisSpacingConfig.secondChordSafeGapPx,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.half,
    timeAxisSpacingConfig.durationGapRatios.whole,
    spacingLayoutMode,
  ])
  const [chordMarkerLayoutRevision, setChordMarkerLayoutRevision] = useState(0)
  const [chordRulerMarkerGeometryByKey, setChordRulerMarkerGeometryByKey] =
    useState<Map<string, ChordRulerMarkerGeometry>>(new Map())
  const {
    playbackCursorPoint,
    playbackCursorColor,
    playbackSessionId,
    playheadStatus,
    playheadElementRef,
    playheadDebugLogText,
    playbackCursorEventsRef,
    playheadDebugLogRowsRef,
    latestPlayheadDebugSnapshotRef,
    playheadDebugSequenceRef,
    measurePlayheadDebugLogRow,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
    handlePlaybackStart,
    handlePlaybackPoint,
    handlePlaybackComplete,
  } = usePlaybackController({
    synthRef,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    setIsPlaying,
    firstPlaybackPoint,
    scoreScrollRef,
    getPlayheadRectPx: () => playheadRectPx,
    playheadGeometryRevision: `${layoutStabilityKey}:${chordMarkerLayoutRevision}`,
    playheadFollowEnabled,
  })
  useLayoutEffect(() => {
    chordMarkerLayoutRequestRef.current += 1
  }, [
    measurePairs,
    measurePairsFromImport,
    measureTimeSignaturesFromImport,
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    scoreScaleX,
    layoutStabilityKey,
  ])
  const buildChordRulerMarkerGeometrySnapshot = useCallback(() => {
    const appliedRenderOffsetX = horizontalRenderOffsetXRef.current
    const markers = new Map<string, ChordRulerMarkerGeometry>()
    const resolveTickHeadGlobalX = (params: {
      pairIndex: number
      startTick: number
    }): number | null => {
      const { pairIndex, startTick } = params
      const pair = measurePairs[pairIndex]
      if (!pair) return null
      const pairLayouts = noteLayoutsByPairRef.current.get(pairIndex) ?? []
      if (pairLayouts.length === 0) return null

      const trebleOnsetTicksByIndex = buildStaffOnsetTicks(pair.treble)
      const bassOnsetTicksByIndex = buildStaffOnsetTicks(pair.bass)
      let bestCandidate: { headGlobalX: number; staffPriority: number; noteIndex: number } | null = null

      for (const layout of pairLayouts) {
        const sourceNote = layout.staff === 'treble' ? pair.treble[layout.noteIndex] : pair.bass[layout.noteIndex]
        if (!sourceNote || sourceNote.isRest) continue
        const onsetTicksByIndex = layout.staff === 'treble' ? trebleOnsetTicksByIndex : bassOnsetTicksByIndex
        const onsetTick = onsetTicksByIndex[layout.noteIndex]
        if (onsetTick !== startTick) continue
        const rootHead = layout.noteHeads.find((head) => head.keyIndex === 0) ?? layout.noteHeads[0] ?? null
        if (!rootHead) continue
        const localHeadLeftX = Number.isFinite(rootHead.hitMinX) ? (rootHead.hitMinX as number) : rootHead.x
        if (!Number.isFinite(localHeadLeftX)) continue
        const candidate = {
          headGlobalX: localHeadLeftX + appliedRenderOffsetX,
          staffPriority: layout.staff === 'treble' ? 0 : 1,
          noteIndex: layout.noteIndex,
        }
        if (
          bestCandidate === null ||
          candidate.headGlobalX < bestCandidate.headGlobalX - 0.001 ||
          (Math.abs(candidate.headGlobalX - bestCandidate.headGlobalX) <= 0.001 &&
            (candidate.staffPriority < bestCandidate.staffPriority ||
              (candidate.staffPriority === bestCandidate.staffPriority && candidate.noteIndex < bestCandidate.noteIndex)))
        ) {
          bestCandidate = candidate
        }
      }

      return bestCandidate?.headGlobalX ?? null
    }

    horizontalMeasureFramesByPair.forEach((frame, pairIndex) => {
      const timelineBundle = measureTimelineBundlesRef.current.get(pairIndex) ?? null
      const timeSignature = resolvePairTimeSignature(pairIndex, measureTimeSignaturesFromImport)
      const measureTicks = Math.max(1, timelineBundle?.measureTicks ?? getMeasureTicksFromTimeSignature(timeSignature))
      const chordEntries = chordRulerEntriesByPair?.[pairIndex] ?? []
      chordEntries.forEach((entry, entryIndex) => {
        const safeStartTick = Math.max(0, Math.min(measureTicks, Math.round(entry.startTick)))
        const safeEndTick = Math.max(safeStartTick, Math.min(measureTicks, Math.round(entry.endTick)))
        if (safeEndTick <= safeStartTick) return

        let anchorSource: ChordRulerMarkerAnchorSource = 'frame'
        let anchorGlobalX = resolveTickHeadGlobalX({ pairIndex, startTick: safeStartTick })
        if (anchorGlobalX !== null) {
          anchorSource = 'note-head'
        } else {
          const spacingTickX = timelineBundle?.spacingTickToX.get(safeStartTick)
          if (typeof spacingTickX === 'number' && Number.isFinite(spacingTickX)) {
            anchorSource = 'spacing-tick'
            anchorGlobalX = spacingTickX + appliedRenderOffsetX
          } else {
            const axisX = timelineBundle?.publicAxisLayout?.tickToX.get(safeStartTick)
            if (typeof axisX === 'number' && Number.isFinite(axisX)) {
              anchorSource = 'axis'
              anchorGlobalX = axisX + appliedRenderOffsetX
            } else {
              const frameContentGeometry = getMeasureFrameContentGeometry(frame)
              anchorSource = 'frame'
              anchorGlobalX = frameContentGeometry
                ? frameContentGeometry.contentStartX +
                  frameContentGeometry.contentMeasureWidth * (safeStartTick / Math.max(1, measureTicks))
                : frame.measureX + frame.measureWidth * (safeStartTick / Math.max(1, measureTicks))
            }
          }
        }

        if (typeof anchorGlobalX !== 'number' || !Number.isFinite(anchorGlobalX)) return
        const key = `chord-ruler-${pairIndex + 1}-${safeStartTick}-${entryIndex}`
        markers.set(key, {
          key,
          pairIndex,
          beatIndex: entry.beatIndex,
          sourceLabel: entry.label,
          startTick: safeStartTick,
          endTick: safeEndTick,
          positionText: entry.positionText,
          anchorSource,
          anchorGlobalX,
          keyFifths: resolvePairKeyFifthsForKeyboard(pairIndex, measureKeyFifthsFromImport),
          keyMode: resolvePairKeyMode(pairIndex, measureKeyModesFromImport),
        })
      })
    })

    return markers
  }, [
    chordRulerEntriesByPair,
    getMeasureFrameContentGeometry,
    horizontalMeasureFramesByPair,
    measureKeyFifthsFromImport,
    measureKeyModesFromImport,
    measurePairs,
    measureTimeSignaturesFromImport,
  ])
  const onAfterScoreRender = useCallback(() => {
    const request = chordMarkerLayoutRequestRef.current
    if (request <= chordMarkerLayoutAppliedRef.current) return
    chordMarkerLayoutAppliedRef.current = request
    setChordRulerMarkerGeometryByKey(buildChordRulerMarkerGeometrySnapshot())
    setChordMarkerLayoutRevision((current) => (current === request ? current : request))
  }, [buildChordRulerMarkerGeometrySnapshot])

  useEffect(() => {
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) {
      setHorizontalViewportXRange({ startX: 0, endX: totalScoreWidth })
      return
    }

    const updateViewport = () => {
      const nextStartX = Math.max(0, scrollHost.scrollLeft / scoreScaleX)
      const nextEndX = Math.max(nextStartX + 1, (scrollHost.scrollLeft + scrollHost.clientWidth) / scoreScaleX)
      setHorizontalViewportXRange((current) => {
        if (Math.abs(current.startX - nextStartX) < 0.5 && Math.abs(current.endX - nextEndX) < 0.5) {
          return current
        }
        return { startX: nextStartX, endX: nextEndX }
      })
    }

    updateViewport()
    scrollHost.addEventListener('scroll', updateViewport, { passive: true })
    window.addEventListener('resize', updateViewport)

    return () => {
      scrollHost.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
    }
  }, [scoreScaleX, totalScoreWidth, displayScoreWidth])

  useImportedRefsSync({
    measurePairsFromImport,
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    measureKeyModesFromImport,
    measureKeyModesFromImportRef,
    measureDivisionsFromImport,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    measurePairs,
    measurePairsRef,
  })

  useRhythmLinkedBassSync({
    notes,
    isRhythmLinked,
    setBassNotes,
  })

  useScoreRenderEffect({
    scoreRef,
    rendererRef,
    rendererSizeRef,
    scoreWidth,
    scoreHeight,
    measurePairs,
    systemRanges,
    visibleSystemRange,
    renderOriginSystemIndex: visibleSystemRange.start,
    visiblePairRange: {
      startPairIndex: horizontalRenderWindow.startPairIndex,
      endPairIndexExclusive: horizontalRenderWindow.endPairIndexExclusive,
    },
    clearViewportXRange: null,
    measureFramesByPair: horizontalMeasureFramesByPair,
    renderOffsetX: horizontalRenderOffsetX,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    supplementalSpacingTicksByPair,
    activeSelection: isSelectionVisible ? activeSelection : null,
    activeAccidentalSelection,
    activeTieSegmentKey: activeTieSelection?.key ?? null,
    draggingSelection,
    activeSelections: isSelectionVisible ? selectedSelections : [],
    draggingSelections: draggingSelection ? [draggingSelection] : [],
    selectedMeasureScope,
    fullMeasureRestCollapseScopeKeys,
    layoutReflowHintRef,
    layoutStabilityKey,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    backend: SCORE_RENDER_BACKEND,
    pagePaddingX: pageHorizontalPaddingPx,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    showInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    renderScaleX: scoreScaleX,
    renderScaleY: scoreScaleY,
    renderQualityScaleX: renderQualityScale.x,
    renderQualityScaleY: renderQualityScale.y,
    dragPreview: draggingSelection ? dragPreviewState : null,
    onAfterRender: onAfterScoreRender,
  })

  useSynthLifecycle({
    synthRef,
  })

  useRendererCleanup({
    dragRafRef,
    dragPendingRef,
    rendererRef,
    rendererSizeRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
  })

  useEffect(() => {
    return () => {
      widthProbeRendererRef.current = null
    }
  }, [])

  useEffect(() => {
    if (horizontalMeasureWidthCacheRef.current.size === 0) return
    horizontalMeasureWidthCacheRef.current.clear()
  }, [
    timeAxisSpacingConfig.baseMinGap32Px,
    timeAxisSpacingConfig.leadingBarlineGapPx,
    timeAxisSpacingConfig.secondChordSafeGapPx,
    timeAxisSpacingConfig.interOnsetPaddingPx,
    timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    timeAxisSpacingConfig.durationGapRatios.sixteenth,
    timeAxisSpacingConfig.durationGapRatios.eighth,
    timeAxisSpacingConfig.durationGapRatios.quarter,
    timeAxisSpacingConfig.durationGapRatios.half,
    timeAxisSpacingConfig.durationGapRatios.whole,
  ])

  const pushUndoSnapshot = useCallback((sourcePairs: MeasurePair[]) => {
    if (!sourcePairs || sourcePairs.length === 0) return
    const stack = undoHistoryRef.current
    stack.push({
      pairs: cloneMeasurePairs(sourcePairs),
      imported: measurePairsFromImportRef.current !== null,
      selection: { ...activeSelectionRef.current },
      isSelectionVisible: isSelectionVisibleRef.current,
      fullMeasureRestCollapseScopeKeys: [...fullMeasureRestCollapseScopeKeysRef.current],
    })
    if (stack.length > UNDO_HISTORY_LIMIT) {
      stack.splice(0, stack.length - UNDO_HISTORY_LIMIT)
    }
  }, [])

  const resetMidiStepChain = useCallback(() => {
    midiStepChainRef.current = false
    midiStepLastSelectionRef.current = null
  }, [])

  const canContinueMidiStep = useCallback((targetSelection: Selection): boolean => {
    if (!midiStepChainRef.current) return false
    const lastSelection = midiStepLastSelectionRef.current
    if (!lastSelection) return false
    return isSameSelection(lastSelection, targetSelection)
  }, [])

  const clearActiveChordSelection = useCallback(() => {
    setActiveChordSelection(null)
  }, [])

  const {
    clearDragOverlay,
    onSurfacePointerMove,
    endDrag,
    beginDrag,
  } = useDragHandlers({
    scoreRef,
    scoreOverlayRef,
    noteLayoutsRef,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    hitGridRef,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    measurePairsRef,
    dragDebugFramesRef,
    dragRef,
    dragPreviewFrameRef,
    dragRafRef,
    dragPendingRef,
    overlayRendererRef,
    overlayRendererSizeRef,
    overlayLastRectRef,
    setDragDebugReport,
    setLayoutReflowHint: (hint) => {
      const decoratedHint = hint ? { ...hint, layoutStabilityKey } : null
      layoutReflowHintRef.current = decoratedHint
    },
    setMeasurePairsFromImport,
    setNotes,
    setBassNotes,
    setDragPreviewState,
    setActiveSelection,
    setDraggingSelection,
    currentSelections: selectedSelections,
    onSelectionPointerDown: (_selection, nextSelections, _mode) => {
      void _selection
      void _mode
      resetMidiStepChain()
      setActiveAccidentalSelection(null)
      setActiveTieSelection(null)
      setSelectedMeasureScope(null)
      clearActiveChordSelection()
      const nextTargetSelections = nextSelections
      setSelectedSelections((current) => {
        if (
          current.length === nextTargetSelections.length &&
          current.every((entry, index) => isSameSelection(entry, nextTargetSelections[index]))
        ) {
          return current
        }
        return nextTargetSelections
      })
    },
    onSelectionTapRelease: (selection) => {
      resetMidiStepChain()
      setActiveAccidentalSelection(null)
      setActiveTieSelection(null)
      setSelectedMeasureScope(null)
      clearActiveChordSelection()
      setSelectedSelections([selection])
      setActiveSelection(selection)
      setIsSelectionVisible(true)
    },
    onAccidentalPointerDown: (selection) => {
      resetMidiStepChain()
      setActiveAccidentalSelection(selection)
      setActiveTieSelection(null)
      setSelectedMeasureScope(null)
      clearActiveChordSelection()
      setDraggingSelection(null)
      setSelectedSelections([])
      setIsSelectionVisible(false)
    },
    onTiePointerDown: (selection) => {
      resetMidiStepChain()
      setActiveTieSelection(selection)
      setActiveAccidentalSelection(null)
      setSelectedMeasureScope(null)
      clearActiveChordSelection()
      setDraggingSelection(null)
      setSelectedSelections([])
      setIsSelectionVisible(false)
    },
    onBeforeApplyScoreChange: (sourcePairs) => {
      pushUndoSnapshot(sourcePairs)
    },
    onAfterApplyScoreChange: ({ sourcePairs, nextPairs }) => {
      setFullMeasureRestCollapseScopeKeys((current) =>
        mergeFullMeasureRestCollapseScopeKeys({
          currentScopeKeys: current,
          sourcePairs,
          nextPairs,
        }),
      )
    },
    onBlankPointerDown: ({ pairIndex, staff }) => {
      resetMidiStepChain()
      setActiveAccidentalSelection(null)
      setActiveTieSelection(null)
      clearActiveChordSelection()
      if (pairIndex === null || staff === null) {
        setIsSelectionVisible(false)
        setSelectedSelections([])
        setSelectedMeasureScope(null)
        return
      }
      const targetPair = measurePairsRef.current[pairIndex]
      if (!targetPair) {
        setIsSelectionVisible(false)
        setSelectedSelections([])
        setSelectedMeasureScope(null)
        return
      }
      const timeSignature = resolvePairTimeSignature(pairIndex, measureTimeSignaturesFromImportRef.current)
      const canCollapseFullMeasureRest = fullMeasureRestCollapseScopeKeys.includes(
        toMeasureStaffScopeKey({ pairIndex, staff }),
      )
      const nextSelections = buildSelectionsForMeasureStaff(targetPair, staff, {
        collapseFullMeasureRest: canCollapseFullMeasureRest,
        timeSignature,
      })
      if (nextSelections.length === 0) {
        setIsSelectionVisible(false)
        setSelectedSelections([])
        setSelectedMeasureScope(null)
        return
      }
      setIsSelectionVisible(true)
      setSelectedSelections(nextSelections)
      setActiveSelection(nextSelections[0])
      setSelectedMeasureScope({ pairIndex, staff })
    },
    onSelectionActivated: () => {
      resetMidiStepChain()
      setActiveAccidentalSelection(null)
      setActiveTieSelection(null)
      clearActiveChordSelection()
      setIsSelectionVisible(true)
    },
    onPreviewScoreNote: handlePreviewScoreNote,
    measurePairsFromImportRef,
    importedNoteLookupRef,
    measureKeyFifthsFromImportRef,
    trebleNoteById,
    bassNoteById,
    pitches: PITCHES,
    previewDefaultAccidentalOffsetPx: PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
    previewStartThresholdPx: PREVIEW_START_THRESHOLD_PX,
    backend: SCORE_RENDER_BACKEND,
    scoreScaleX,
    scoreScaleY,
    renderQualityScaleX: renderQualityScale.x,
    renderQualityScaleY: renderQualityScale.y,
    viewportXRange: horizontalViewportXRange,
    renderOffsetX: horizontalRenderOffsetX,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    showNoteHeadJianpu: showNoteHeadJianpuEnabled,
  })

  const {
    playScore,
    importMusicXmlText,
    importMusicXmlFromTextarea,
    openMusicXmlFilePicker,
    onMusicXmlFileChange,
    loadSampleMusicXml,
    loadWholeNoteDemo,
    loadHalfNoteDemo,
    exportMusicXmlFile,
    resetScore,
    applyRhythmPreset,
  } = useEditorHandlers({
    synthRef,
    notes,
    playbackTimelineEvents,
    stopPlayTimerRef,
    playbackPointTimerIdsRef,
    playbackSessionIdRef,
    setIsPlaying,
    onPlaybackStart: handlePlaybackStart,
    onPlaybackPoint: handlePlaybackPoint,
    onPlaybackComplete: handlePlaybackComplete,
    onImportedScoreApplied: requestPlaybackCursorReset,
    setNotes,
    setBassNotes,
    setMeasurePairsFromImport,
    measurePairsFromImportRef,
    setMeasureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    setMeasureKeyModesFromImport,
    measureKeyModesFromImportRef,
    setMeasureDivisionsFromImport,
    measureDivisionsFromImportRef,
    setMeasureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    setMusicXmlMetadataFromImport,
    musicXmlMetadataFromImportRef,
    setImportedChordRulerEntriesByPairFromImport,
    importedNoteLookupRef,
    dragRef,
    clearDragOverlay,
    setDraggingSelection,
    setActiveSelection,
    setIsRhythmLinked,
    setImportFeedback,
    musicXmlInput,
    setMusicXmlInput,
    fileInputRef,
    measurePairs,
    setRhythmPreset,
    pitches: PITCHES,
    initialTrebleNotes: INITIAL_NOTES,
    initialBassNotes: INITIAL_BASS_NOTES,
  })

  const clearFullMeasureRestCollapseScopes = useCallback(() => {
    setFullMeasureRestCollapseScopeKeys([])
  }, [])

  const importMusicXmlTextWithCollapseReset = useCallback((xmlText: string) => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    importMusicXmlText(xmlText)
  }, [clearActiveChordSelection, clearFullMeasureRestCollapseScopes, importMusicXmlText, stopActivePlaybackSession])

  const importMusicXmlFromTextareaWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    importMusicXmlFromTextarea()
  }, [clearActiveChordSelection, clearFullMeasureRestCollapseScopes, importMusicXmlFromTextarea, stopActivePlaybackSession])

  const onMusicXmlFileChangeWithCollapseReset = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    await onMusicXmlFileChange(event)
  }, [clearActiveChordSelection, clearFullMeasureRestCollapseScopes, onMusicXmlFileChange, stopActivePlaybackSession])

  const loadSampleMusicXmlWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    loadSampleMusicXml()
  }, [clearActiveChordSelection, clearFullMeasureRestCollapseScopes, loadSampleMusicXml, stopActivePlaybackSession])

  const loadWholeNoteDemoWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('whole-note')
    loadWholeNoteDemo()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    loadWholeNoteDemo,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
  ])

  const loadHalfNoteDemoWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('half-note')
    loadHalfNoteDemo()
  }, [
    clearActiveChordSelection,
    clearFullMeasureRestCollapseScopes,
    loadHalfNoteDemo,
    requestPlaybackCursorReset,
    stopActivePlaybackSession,
  ])

  const resetScoreWithCollapseReset = useCallback(() => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    resetScore()
  }, [clearActiveChordSelection, clearFullMeasureRestCollapseScopes, requestPlaybackCursorReset, resetScore, stopActivePlaybackSession])

  const applyRhythmPresetWithCollapseReset = useCallback((presetId: RhythmPresetId) => {
    stopActivePlaybackSession()
    requestPlaybackCursorReset()
    clearFullMeasureRestCollapseScopes()
    clearActiveChordSelection()
    setActiveBuiltInDemo('none')
    applyRhythmPreset(presetId)
  }, [applyRhythmPreset, clearActiveChordSelection, clearFullMeasureRestCollapseScopes, requestPlaybackCursorReset, stopActivePlaybackSession])

  useEffect(() => {
    return () => {
      if (stopPlayTimerRef.current !== null) {
        window.clearTimeout(stopPlayTimerRef.current)
        stopPlayTimerRef.current = null
      }
      playbackPointTimerIdsRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      playbackPointTimerIdsRef.current = []
      playbackSessionIdRef.current += 1
      const stoppableSynth = synthRef.current as (Tone.PolySynth | Tone.Sampler | { releaseAll?: (time?: number) => void }) | null
      if (stoppableSynth && typeof stoppableSynth.releaseAll === 'function') {
        try {
          stoppableSynth.releaseAll()
        } catch {
          // Ignore best-effort cleanup failures on disposed Tone voices.
        }
      }
    }
  }, [])

  useEffect(() => {
    const hasActiveTreble = notes.some((note) => note.id === activeSelection.noteId)
    const hasActiveBass = bassNotes.some((note) => note.id === activeSelection.noteId)

    if (activeSelection.staff === 'treble') {
      if (hasActiveTreble) return
      if (notes[0]) {
        setIsSelectionVisible(true)
        setActiveSelection({ noteId: notes[0].id, staff: 'treble', keyIndex: 0 })
        return
      }
      if (bassNotes[0]) {
        setIsSelectionVisible(true)
        setActiveSelection({ noteId: bassNotes[0].id, staff: 'bass', keyIndex: 0 })
      }
      return
    }

    if (hasActiveBass) return
    if (bassNotes[0]) {
      setIsSelectionVisible(true)
      setActiveSelection({ noteId: bassNotes[0].id, staff: 'bass', keyIndex: 0 })
      return
    }
    if (notes[0]) {
      setIsSelectionVisible(true)
      setActiveSelection({ noteId: notes[0].id, staff: 'treble', keyIndex: 0 })
    }
  }, [activeSelection, notes, bassNotes])

  const activePool = activeSelection.staff === 'treble' ? notes : bassNotes
  const activePoolById = activeSelection.staff === 'treble' ? trebleNoteById : bassNoteById
  const activePoolIndexById = activeSelection.staff === 'treble' ? trebleNoteIndexById : bassNoteIndexById
  const currentSelection = activePoolById.get(activeSelection.noteId) ?? activePool[0] ?? notes[0]
  const currentSelectionPosition = (activePoolIndexById.get(currentSelection.id) ?? 0) + 1
  const currentSelectionPitch =
    activeSelection.keyIndex > 0
      ? currentSelection.chordPitches?.[activeSelection.keyIndex - 1] ?? currentSelection.pitch
      : currentSelection.pitch
  const currentSelectionPitchLabel = currentSelection.isRest ? '休止符' : toDisplayPitch(currentSelectionPitch)
  const derivedNotationPaletteDisplay = useMemo<NotationPaletteDerivedDisplay>(() => {
    if (!isSelectionVisible) {
      return buildNotationPaletteDerivedDisplay({ isSelectionVisible: false, selections: [] })
    }

    const selectionExists = (selection: Selection): boolean =>
      selection.staff === 'treble' ? trebleNoteById.has(selection.noteId) : bassNoteById.has(selection.noteId)

    const effectiveSelections = (() => {
      const filteredSelections = selectedSelections.filter(selectionExists)
      return selectionExists(activeSelection) ? appendUniqueSelection(filteredSelections, activeSelection) : filteredSelections
    })()

    const resolvedSelections: NotationPaletteResolvedSelection[] = effectiveSelections
      .map((selection) => {
        const location = findSelectionLocationInPairs({
          pairs: measurePairs,
          selection,
          importedNoteLookup: importedNoteLookupRef.current,
        })
        if (!location) return null
        const pair = measurePairs[location.pairIndex]
        const note =
          location.staff === 'treble' ? pair?.treble[location.noteIndex] ?? null : pair?.bass[location.noteIndex] ?? null
        if (!note || note.id !== selection.noteId) return null
        return {
          noteId: selection.noteId,
          staff: selection.staff,
          keyIndex: selection.keyIndex,
          note,
        }
      })
      .filter((selection): selection is NotationPaletteResolvedSelection => selection !== null)

    return buildNotationPaletteDerivedDisplay({
      isSelectionVisible: true,
      selections: resolvedSelections,
    })
  }, [activeSelection, bassNoteById, isSelectionVisible, measurePairs, selectedSelections, trebleNoteById])
  const trebleSequenceText = useMemo(() => toSequencePreview(notes), [notes])
  const bassSequenceText = useMemo(() => toSequencePreview(bassNotes), [bassNotes])
  const isImportLoading = importFeedback.kind === 'loading'
  const importProgressPercent =
    typeof importFeedback.progress === 'number' ? Math.max(0, Math.min(100, importFeedback.progress)) : null
  useEffect(() => {
    activeSelectionRef.current = activeSelection
  }, [activeSelection])
  useEffect(() => {
    selectedSelectionsRef.current = selectedSelections
  }, [selectedSelections])
  useEffect(() => {
    fullMeasureRestCollapseScopeKeysRef.current = fullMeasureRestCollapseScopeKeys
  }, [fullMeasureRestCollapseScopeKeys])

  useEffect(() => {
    if (isSelectionVisible) return
    if (selectedMeasureScope === null) return
    setSelectedMeasureScope(null)
  }, [isSelectionVisible, selectedMeasureScope])

  useEffect(() => {
    if (selectedMeasureScope === null) return
    if (selectedMeasureScope.pairIndex >= measurePairs.length) {
      setSelectedMeasureScope(null)
    }
  }, [selectedMeasureScope, measurePairs.length])
  useEffect(() => {
    if (!activeTieSelection) return
    const stillExists = activeTieSelection.endpoints.some((endpoint) => {
      const pair = measurePairs[endpoint.pairIndex]
      if (!pair) return false
      const staffNotes = endpoint.staff === 'treble' ? pair.treble : pair.bass
      const note = staffNotes[endpoint.noteIndex] ?? staffNotes.find((entry) => entry.id === endpoint.noteId)
      if (!note || note.id !== endpoint.noteId) return false
      if (endpoint.tieType === 'start') {
        return endpoint.keyIndex <= 0
          ? Boolean(note.tieStart)
          : Boolean(note.chordTieStarts?.[endpoint.keyIndex - 1])
      }
      return endpoint.keyIndex <= 0
        ? Boolean(note.tieStop)
        : Boolean(note.chordTieStops?.[endpoint.keyIndex - 1])
    })
    if (stillExists) return
    setActiveTieSelection(null)
  }, [activeTieSelection, measurePairs])
  useEffect(() => {
    isSelectionVisibleRef.current = isSelectionVisible
  }, [isSelectionVisible])
  useEffect(() => {
    draggingSelectionRef.current = draggingSelection
  }, [draggingSelection])
  useEffect(() => {
    const exists = (selection: Selection): boolean =>
      selection.staff === 'treble'
        ? trebleNoteById.has(selection.noteId)
        : bassNoteById.has(selection.noteId)

    setSelectedSelections((current) => {
      if (!isSelectionVisible) {
        return current.length === 0 ? current : []
      }
      const filtered = current.filter((selection) => exists(selection))
      const withActive = exists(activeSelection)
        ? appendUniqueSelection(filtered, activeSelection)
        : filtered
      if (
        withActive.length === current.length &&
        withActive.every((entry, index) => isSameSelection(entry, current[index]))
      ) {
        return current
      }
      return withActive
    })
  }, [activeSelection, isSelectionVisible, trebleNoteById, bassNoteById])
  useEffect(() => {
    importFeedbackRef.current = importFeedback
  }, [importFeedback])

  useEffect(() => {
    // Import/reset can replace key signature/time signature context; clear undo chain
    // to avoid replaying snapshots under mismatched score metadata.
    undoHistoryRef.current = []
  }, [
    measureKeyFifthsFromImport,
    measureDivisionsFromImport,
    measureTimeSignaturesFromImport,
    musicXmlMetadataFromImport,
  ])

  const undoLastScoreEdit = useCallback((): boolean => {
    const stack = undoHistoryRef.current
    if (stack.length === 0) return false
    const snapshot = stack.pop()
    if (!snapshot) return false

    const restoredPairs = cloneMeasurePairs(snapshot.pairs)
    setDragPreviewState(null)
    dragRef.current = null
    clearDragOverlay()
    setDraggingSelection(null)
    resetMidiStepChain()

    if (snapshot.imported) {
      measurePairsFromImportRef.current = restoredPairs
      setMeasurePairsFromImport(restoredPairs)
    } else {
      measurePairsFromImportRef.current = null
      setMeasurePairsFromImport(null)
      setImportedChordRulerEntriesByPairFromImport(null)
    }
    importedNoteLookupRef.current = buildImportedNoteLookup(restoredPairs)
    setNotes(flattenTrebleFromPairs(restoredPairs))
    setBassNotes(flattenBassFromPairs(restoredPairs))
    setIsSelectionVisible(snapshot.isSelectionVisible)
    setActiveAccidentalSelection(null)
    setActiveTieSelection(null)
    setSelectedMeasureScope(null)
    clearActiveChordSelection()
    setFullMeasureRestCollapseScopeKeys(snapshot.fullMeasureRestCollapseScopeKeys)
    setActiveSelection(snapshot.selection)
    setSelectedSelections(snapshot.isSelectionVisible ? [snapshot.selection] : [])
    return true
  }, [
    clearActiveChordSelection,
    clearDragOverlay,
    resetMidiStepChain,
    setActiveAccidentalSelection,
    setActiveTieSelection,
    setBassNotes,
    setFullMeasureRestCollapseScopeKeys,
    setMeasurePairsFromImport,
    setNotes,
    setImportedChordRulerEntriesByPairFromImport,
    setDraggingSelection,
    setSelectedMeasureScope,
  ])

  const applyKeyboardEditResult = useCallback(
    (
      nextPairs: MeasurePair[],
      nextSelection: Selection,
      nextSelections: Selection[] = [nextSelection],
      source: 'default' | 'midi-step' = 'default',
      options?: {
        collapseScopesToAdd?: MeasureStaffScope[]
      },
    ) => {
      const sourcePairs = measurePairsRef.current
      const collapseScopesToAdd = options?.collapseScopesToAdd ?? []
      if (nextPairs !== sourcePairs) {
        pushUndoSnapshot(sourcePairs)
      }
      if (nextPairs !== sourcePairs || collapseScopesToAdd.length > 0) {
        setFullMeasureRestCollapseScopeKeys((current) =>
          mergeFullMeasureRestCollapseScopeKeys({
            currentScopeKeys: current,
            sourcePairs,
            nextPairs,
            collapseScopesToAdd,
          }),
        )
      }
      if (source !== 'midi-step') {
        resetMidiStepChain()
      }
      setIsRhythmLinked(false)
      if (measurePairsFromImportRef.current) {
        measurePairsFromImportRef.current = nextPairs
        setMeasurePairsFromImport(nextPairs)
      }
      importedNoteLookupRef.current = buildImportedNoteLookup(nextPairs)
      setNotes(flattenTrebleFromPairs(nextPairs))
      setBassNotes(flattenBassFromPairs(nextPairs))
      setIsSelectionVisible(true)
      setActiveAccidentalSelection(null)
      setActiveTieSelection(null)
      setSelectedMeasureScope(null)
      clearActiveChordSelection()
      setActiveSelection(nextSelection)
      setSelectedSelections(nextSelections)
    },
    [
      clearActiveChordSelection,
      pushUndoSnapshot,
      resetMidiStepChain,
      setFullMeasureRestCollapseScopeKeys,
      setActiveAccidentalSelection,
      setActiveTieSelection,
      setBassNotes,
      setMeasurePairsFromImport,
      setNotes,
      setActiveSelection,
      setIsRhythmLinked,
      setSelectedMeasureScope,
    ],
  )

  const resolveMidiTargetSelection = useCallback((pairs: MeasurePair[]): Selection | null => {
    if (pairs.length === 0) return null
    const fallbackSelection = activeSelectionRef.current
    const candidateSelections =
      selectedSelectionsRef.current.length > 0 ? selectedSelectionsRef.current : [fallbackSelection]
    const timelinePoints = candidateSelections
      .map((selection) =>
        resolveSelectionTimelinePoint({
          pairs,
          selection,
          importedNoteLookup: importedNoteLookupRef.current,
        }),
      )
      .filter((point): point is NonNullable<typeof point> => point !== null)
    if (timelinePoints.length === 0) {
      return candidateSelections[0] ?? null
    }
    timelinePoints.sort((left, right) => {
      const byTime = compareTimelinePoint(left, right)
      if (byTime !== 0) return byTime
      if (left.staff !== right.staff) return left.staff === 'treble' ? -1 : 1
      if (left.noteIndex !== right.noteIndex) return left.noteIndex - right.noteIndex
      if (left.selection.keyIndex !== right.selection.keyIndex) return left.selection.keyIndex - right.selection.keyIndex
      return left.selection.noteId.localeCompare(right.selection.noteId)
    })
    return timelinePoints[0]?.selection ?? candidateSelections[0] ?? null
  }, [])

  const applyMidiReplacementByNoteNumber = useCallback((midiNoteNumber: number) => {
    if (isOsmdPreviewOpenRef.current) return
    if (dragRef.current || draggingSelectionRef.current) return
    if (!isSelectionVisibleRef.current) return

    const sourcePairs = measurePairsRef.current
    const targetSelection = resolveMidiTargetSelection(sourcePairs)
    if (!targetSelection) return

    const selectionLocation = findSelectionLocationInPairs({
      pairs: sourcePairs,
      selection: targetSelection,
      importedNoteLookup: importedNoteLookupRef.current,
    })
    if (!selectionLocation) return

    const keyFifths = resolvePairKeyFifthsForKeyboard(selectionLocation.pairIndex, measureKeyFifthsFromImportRef.current)
    const targetPitch = toPitchFromMidiWithKeyPreference(midiNoteNumber, keyFifths)
    const mode: MidiStepInputMode = canContinueMidiStep(targetSelection)
      ? 'insert-after-anchor'
      : 'replace-anchor'

    const stepAttempt = applyMidiStepInput({
      pairs: sourcePairs,
      anchorSelection: targetSelection,
      mode,
      targetPitch,
      importedMode: measurePairsFromImportRef.current !== null,
      importedNoteLookup: importedNoteLookupRef.current,
      keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
      timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
      allowAutoAppendMeasure: true,
    })
    if (!stepAttempt.result || stepAttempt.error) return

    const { result } = stepAttempt
    if (result.appendedMeasureCount > 0 && measurePairsFromImportRef.current) {
      const targetLength = result.nextPairs.length
      const extendNumberSeries = (
        source: number[] | null,
        fallback: number,
        normalize: (value: number) => number,
      ): number[] => {
        const next: number[] = []
        let carry = normalize(fallback)
        for (let index = 0; index < targetLength; index += 1) {
          const raw = source?.[index]
          if (Number.isFinite(raw)) {
            carry = normalize(raw as number)
          }
          next.push(carry)
        }
        return next
      }
      const extendTimeSignatureSeries = (source: TimeSignature[] | null): TimeSignature[] => {
        const next: TimeSignature[] = []
        let carry: TimeSignature = { beats: 4, beatType: 4 }
        for (let index = 0; index < targetLength; index += 1) {
          const candidate = source?.[index]
          if (
            candidate &&
            Number.isFinite(candidate.beats) &&
            candidate.beats > 0 &&
            Number.isFinite(candidate.beatType) &&
            candidate.beatType > 0
          ) {
            carry = {
              beats: Math.max(1, Math.round(candidate.beats)),
              beatType: Math.max(1, Math.round(candidate.beatType)),
            }
          }
          next.push({
            beats: carry.beats,
            beatType: carry.beatType,
          })
        }
        return next
      }

      const nextKeyFifths = extendNumberSeries(
        measureKeyFifthsFromImportRef.current,
        0,
        (value) => Math.trunc(value),
      )
      const nextDivisions = extendNumberSeries(
        measureDivisionsFromImportRef.current,
        16,
        (value) => Math.max(1, Math.round(value)),
      )
      const nextTimeSignatures = extendTimeSignatureSeries(measureTimeSignaturesFromImportRef.current)
      measureKeyFifthsFromImportRef.current = nextKeyFifths
      setMeasureKeyFifthsFromImport(nextKeyFifths)
      measureDivisionsFromImportRef.current = nextDivisions
      setMeasureDivisionsFromImport(nextDivisions)
      measureTimeSignaturesFromImportRef.current = nextTimeSignatures
      setMeasureTimeSignaturesFromImport(nextTimeSignatures)
    }

    const collapseScopesToAdd: MeasureStaffScope[] = []
    if (result.appendedMeasureCount > 0) {
      const appendStartPairIndex = Math.max(0, result.nextPairs.length - result.appendedMeasureCount)
      for (let pairIndex = appendStartPairIndex; pairIndex < result.nextPairs.length; pairIndex += 1) {
        collapseScopesToAdd.push({ pairIndex, staff: 'treble' })
        collapseScopesToAdd.push({ pairIndex, staff: 'bass' })
      }
    }

    applyKeyboardEditResult(
      result.nextPairs,
      result.nextSelection,
      [result.nextSelection],
      'midi-step',
      { collapseScopesToAdd },
    )
    midiStepChainRef.current = true
    midiStepLastSelectionRef.current = result.nextSelection
  }, [
    applyKeyboardEditResult,
    canContinueMidiStep,
    resolveMidiTargetSelection,
    setMeasureDivisionsFromImport,
    setMeasureKeyFifthsFromImport,
    setMeasureTimeSignaturesFromImport,
  ])

  const {
    midiPermissionState,
    midiInputOptions,
    selectedMidiInputId,
    setSelectedMidiInputId,
  } = useMidiInputController({
    onMidiNoteNumber: applyMidiReplacementByNoteNumber,
  })
  const midiSupported = midiPermissionState !== 'unsupported'

  useEffect(() => {
    if (typeof window === 'undefined') return
    playheadFollowHydratedRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!playheadFollowHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_PLAYHEAD_FOLLOW_KEY,
      playheadFollowEnabled ? '1' : '0',
    )
  }, [playheadFollowEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    chordDegreeDisplayHydratedRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!chordDegreeDisplayHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_CHORD_DEGREE_DISPLAY_KEY,
      showChordDegreeEnabled ? '1' : '0',
    )
  }, [showChordDegreeEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') {
      showInScoreMeasureNumbersHydratedRef.current = true
      return
    }
    const storedValue = window.localStorage.getItem(LOCAL_STORAGE_EDITOR_MEASURE_NUMBER_KEY)
    if (storedValue === '1' || storedValue === 'true') {
      setShowInScoreMeasureNumbers(true)
    } else if (storedValue === '0' || storedValue === 'false') {
      setShowInScoreMeasureNumbers(false)
    }
    showInScoreMeasureNumbersHydratedRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!showInScoreMeasureNumbersHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_EDITOR_MEASURE_NUMBER_KEY,
      showInScoreMeasureNumbers ? '1' : '0',
    )
  }, [showInScoreMeasureNumbers])

  useEffect(() => {
    if (typeof window === 'undefined') {
      showNoteHeadJianpuHydratedRef.current = true
      return
    }
    const storedValue = window.localStorage.getItem(LOCAL_STORAGE_NOTEHEAD_JIANPU_DISPLAY_KEY)
    if (storedValue === '1' || storedValue === 'true') {
      setShowNoteHeadJianpuEnabled(true)
    } else if (storedValue === '0' || storedValue === 'false') {
      setShowNoteHeadJianpuEnabled(false)
    }
    showNoteHeadJianpuHydratedRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!showNoteHeadJianpuHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_NOTEHEAD_JIANPU_DISPLAY_KEY,
      showNoteHeadJianpuEnabled ? '1' : '0',
    )
  }, [showNoteHeadJianpuEnabled])

  const moveSelectionsByKeyboardSteps = useCallback((
    direction: 'up' | 'down',
    staffSteps: number,
    scope: 'active' | 'selected' = 'active',
  ): boolean => {
    const currentSelection = activeSelectionRef.current
    const sourcePairs = measurePairsRef.current
    const importedLookup = importedNoteLookupRef.current
    const selectionLocation = findSelectionLocationInPairs({
      pairs: sourcePairs,
      selection: currentSelection,
      importedNoteLookup: importedLookup,
    })
    if (!selectionLocation) return false

    const sourcePair = sourcePairs[selectionLocation.pairIndex]
    if (!sourcePair) return false
    const staffNotes = selectionLocation.staff === 'treble' ? sourcePair.treble : sourcePair.bass
    const sourceNote = staffNotes[selectionLocation.noteIndex]
    if (!sourceNote || sourceNote.isRest) return false

    const selectedPitch =
      currentSelection.keyIndex > 0
        ? sourceNote.chordPitches?.[currentSelection.keyIndex - 1] ?? null
        : sourceNote.pitch
    if (!selectedPitch) return false

    const shiftedStaffPositionPitch = shiftPitchByStaffSteps(selectedPitch, direction, staffSteps)
    if (!shiftedStaffPositionPitch) return false

    const keyFifths = resolvePairKeyFifthsForKeyboard(selectionLocation.pairIndex, measureKeyFifthsFromImportRef.current)
    const accidentalStateBeforeNote = buildAccidentalStateBeforeNote(staffNotes, selectionLocation.noteIndex, keyFifths)
    const nextPitch = getEffectivePitchForStaffPosition(
      shiftedStaffPositionPitch,
      keyFifths,
      accidentalStateBeforeNote,
    )
    if (!isPitchWithinPianoRange(nextPitch) || nextPitch === selectedPitch) return false

    const importedPairs = measurePairsFromImportRef.current
    const activePairs = importedPairs ?? sourcePairs
    const linkedTieTargets = resolveForwardTieTargets({
      measurePairs: activePairs,
      pairIndex: selectionLocation.pairIndex,
      noteIndex: selectionLocation.noteIndex,
      keyIndex: currentSelection.keyIndex,
      staff: currentSelection.staff,
      pitchHint: selectedPitch,
    })
    const previousTieTarget = resolvePreviousTieTarget({
      measurePairs: activePairs,
      pairIndex: selectionLocation.pairIndex,
      noteIndex: selectionLocation.noteIndex,
      keyIndex: currentSelection.keyIndex,
      staff: currentSelection.staff,
      pitchHint: selectedPitch,
    })

    const dragState: DragState = {
      noteId: currentSelection.noteId,
      staff: currentSelection.staff,
      keyIndex: currentSelection.keyIndex,
      pairIndex: selectionLocation.pairIndex,
      noteIndex: selectionLocation.noteIndex,
      linkedTieTargets:
        linkedTieTargets.length > 0
          ? linkedTieTargets
          : [
              {
                pairIndex: selectionLocation.pairIndex,
                noteIndex: selectionLocation.noteIndex,
                staff: currentSelection.staff,
                noteId: currentSelection.noteId,
                keyIndex: currentSelection.keyIndex,
                pitch: selectedPitch,
              },
            ],
      previousTieTarget,
      groupMoveTargets:
        scope === 'selected'
          ? buildSelectionGroupMoveTargets({
              effectiveSelections: appendUniqueSelection(selectedSelections, currentSelection),
              primarySelection: currentSelection,
              measurePairs: activePairs,
              importedNoteLookup: importedLookup,
              measureLayouts: measureLayoutsRef.current,
              importedKeyFifths: measureKeyFifthsFromImportRef.current,
            })
          : [],
      pointerId: -1,
      surfaceTop: 0,
      surfaceClientToScoreScaleY: 1,
      startClientY: 0,
      originPitch: selectedPitch,
      pitch: selectedPitch,
      previewStarted: false,
      grabOffsetY: 0,
      pitchYMap: {} as Record<Pitch, number>,
      keyFifths,
      accidentalStateBeforeNote,
      layoutCacheReady: false,
      staticAnchorXById: new Map(),
      previewAccidentalRightXById: new Map(),
      debugStaticByNoteKey: new Map(),
    }

    const result = commitDragPitchToScoreData({
      drag: dragState,
      pitch: nextPitch,
      importedPairs,
      importedNoteLookup: importedLookup,
      currentPairs: sourcePairs,
      importedKeyFifths: measureKeyFifthsFromImportRef.current,
    })

    const sourceSnapshotPairs = result.fromImported ? (importedPairs ?? sourcePairs) : sourcePairs
    if (result.normalizedPairs !== sourceSnapshotPairs) {
      pushUndoSnapshot(sourceSnapshotPairs)
    }

    const decoratedLayoutHint = result.layoutReflowHint.scoreContentChanged
      ? { ...result.layoutReflowHint, layoutStabilityKey }
      : null
    layoutReflowHintRef.current = decoratedLayoutHint

    if (result.fromImported) {
      measurePairsFromImportRef.current = result.normalizedPairs
      setMeasurePairsFromImport(result.normalizedPairs)
      setNotes(flattenTrebleFromPairs(result.normalizedPairs))
      setBassNotes(flattenBassFromPairs(result.normalizedPairs))
    } else {
      setNotes(result.trebleNotes)
      setBassNotes(result.bassNotes)
    }
    setIsSelectionVisible(true)
    setActiveSelection({
      noteId: currentSelection.noteId,
      staff: currentSelection.staff,
      keyIndex: currentSelection.keyIndex,
    })
    if (scope === 'selected') {
      setSelectedSelections((current) => appendUniqueSelection(current, currentSelection))
    }
    resetMidiStepChain()
    return true
  }, [
    layoutStabilityKey,
    pushUndoSnapshot,
    resetMidiStepChain,
    selectedSelections,
    setBassNotes,
    setMeasurePairsFromImport,
    setNotes,
    setActiveSelection,
  ])

  const moveSelectionByKeyboardArrow = useCallback((direction: 'up' | 'down'): boolean => {
    return moveSelectionsByKeyboardSteps(direction, 1, 'active')
  }, [moveSelectionsByKeyboardSteps])
  const {
    isOsmdPreviewOpen,
    isOsmdPreviewExportingPdf,
    osmdPreviewStatusText,
    osmdPreviewError,
    osmdPreviewPageIndex,
    osmdPreviewPageCount,
    osmdPreviewShowPageNumbers,
    osmdPreviewZoomDraftPercent,
    safeOsmdPreviewPaperScalePercent,
    safeOsmdPreviewHorizontalMarginPx,
    safeOsmdPreviewFirstPageTopMarginPx,
    safeOsmdPreviewTopMarginPx,
    safeOsmdPreviewBottomMarginPx,
    osmdPreviewPaperScale,
    osmdPreviewPaperWidthPx,
    osmdPreviewPaperHeightPx,
    osmdPreviewContainerRef,
    osmdDirectFileInputRef,
    osmdPreviewInstanceRef,
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewNoteLookupBySelectionRef,
    osmdPreviewSelectedSelectionKeyRef,
    closeOsmdPreview,
    openOsmdPreview,
    openDirectOsmdFilePicker,
    onOsmdDirectFileChange,
    exportOsmdPreviewPdf,
    goToPrevOsmdPreviewPage,
    goToNextOsmdPreviewPage,
    commitOsmdPreviewZoomPercent,
    scheduleOsmdPreviewZoomPercentCommit,
    onOsmdPreviewPaperScalePercentChange,
    onOsmdPreviewHorizontalMarginPxChange,
    onOsmdPreviewFirstPageTopMarginPxChange,
    onOsmdPreviewTopMarginPxChange,
    onOsmdPreviewBottomMarginPxChange,
    onOsmdPreviewShowPageNumbersChange,
    onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick,
    dumpOsmdPreviewSystemMetrics,
  } = useOsmdPreviewController({
    measurePairs,
    measurePairsRef,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    horizontalMeasureFramesByPair,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    scoreScrollRef,
    scoreScaleX,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setDraggingSelection,
    setSelectedMeasureScope,
    clearActiveChordSelection,
    resetMidiStepChain,
  })

  useEffect(() => {
    isOsmdPreviewOpenRef.current = isOsmdPreviewOpen
  }, [isOsmdPreviewOpen])

  const openBeamGroupingTool = useCallback(() => {
    window.alert('音值组合算法已就绪，暂未接入业务流程。')
    setImportFeedback({
      kind: 'success',
      message: '音值组合算法模块已就绪（暂未接入业务流程）。',
    })
    console.info('[beam-grouping] 独立算法入口已就绪：src/score/beamGrouping.ts（当前仅占位提示，不改谱面）')
  }, [])

  const toggleNotationPalette = useCallback(() => {
    setIsNotationPaletteOpen(true)
  }, [])

  const closeNotationPalette = useCallback(() => {
    setIsNotationPaletteOpen(false)
  }, [])

  const onNotationPaletteSelectionChange = useCallback(
    (nextSelection: NotationPaletteSelection, actionLabel: string, item: NotationPaletteItem) => {
      setNotationPaletteSelection(nextSelection)
      const sourcePairs = measurePairsRef.current
      const sourceImportedNoteLookup = importedNoteLookupRef.current
      const importedMode = measurePairsFromImportRef.current !== null

      if (item.behavior === 'ui-only') {
        setNotationPaletteLastAction(actionLabel)
        console.info('[notation-palette]', actionLabel, nextSelection)
        return
      }

      if (item.behavior === 'rest-to-note-disabled') {
        if (isSelectionVisible && currentSelection?.isRest) {
          const message = '首版暂不支持休止符转音符'
          setNotationPaletteLastAction(message)
          console.info('[notation-palette]', message, nextSelection)
          return
        }
        setNotationPaletteLastAction(actionLabel)
        console.info('[notation-palette]', actionLabel, nextSelection)
        return
      }

      if (item.behavior === 'accidental-edit' && item.kind === 'accidental') {
        const attempt = applyPaletteAccidentalEdit({
          pairs: sourcePairs,
          activeSelection,
          selectedSelections,
          isSelectionVisible,
          importedNoteLookup: importedNoteLookupRef.current,
          keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
          accidentalId: item.id,
        })
        if (attempt.error) {
          const message = getAccidentalEditFailureMessage(attempt.error)
          setNotationPaletteLastAction(message)
          console.info('[notation-palette]', message, nextSelection)
          return
        }
        if (attempt.result) {
          applyKeyboardEditResult(attempt.result.nextPairs, attempt.result.nextSelection, attempt.result.nextSelections)
          playAccidentalEditPreview({
            pairs: sourcePairs,
            previewSelection: attempt.result.previewSelection,
            previewPitch: attempt.result.previewPitch,
            importedNoteLookup: sourceImportedNoteLookup,
          })
        }
        setNotationPaletteLastAction(actionLabel)
        console.info('[notation-palette]', actionLabel, nextSelection)
        return
      }

      const action =
        item.behavior === 'duration-edit' && item.kind === 'duration'
          ? { type: 'duration' as const, targetDuration: toTargetDurationFromPalette(item.id) }
          : item.behavior === 'dot-toggle'
            ? { type: 'toggle-dot' as const, targetDuration: currentSelection ? toggleDottedDuration(currentSelection.duration) : null }
            : item.behavior === 'note-to-rest'
              ? { type: 'note-to-rest' as const }
              : null

      if (!action) {
        setNotationPaletteLastAction(actionLabel)
        console.info('[notation-palette]', actionLabel, nextSelection)
        return
      }

      const attempt = applyPaletteDurationEdit({
        pairs: sourcePairs,
        activeSelection,
        selectedSelections,
        isSelectionVisible,
        importedNoteLookup: importedNoteLookupRef.current,
        keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
        timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
        action,
        importedMode,
      })

      if (attempt.error) {
        const message = getDurationEditFailureMessage(attempt.error)
        setNotationPaletteLastAction(message)
        console.info('[notation-palette]', message, nextSelection)
        return
      }

      if (attempt.result) {
        applyKeyboardEditResult(attempt.result.nextPairs, attempt.result.nextSelection, attempt.result.nextSelections)
      }

      setNotationPaletteLastAction(actionLabel)
      console.info('[notation-palette]', actionLabel, nextSelection)
    },
    [
      activeSelection,
      applyKeyboardEditResult,
      currentSelection,
      isSelectionVisible,
      playAccidentalEditPreview,
      selectedSelections,
    ],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOsmdPreviewOpen) return
      if (dragRef.current || draggingSelection) return
      if (isTextInputTarget(event.target)) return

      const scrollHost = scoreScrollRef.current
      if (!scrollHost) return
      const activeElement = document.activeElement
      if (!(activeElement instanceof HTMLElement)) return
      if (!(activeElement === scrollHost || scrollHost.contains(activeElement))) return

      const isUndoShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z'
      if (isUndoShortcut) {
        const restored = undoLastScoreEdit()
        if (restored) {
          event.preventDefault()
        }
        return
      }

      if (event.key === 'Escape' && activeTieSelection) {
        event.preventDefault()
        setActiveTieSelection(null)
        return
      }

      if (event.key === 'Escape' && activeAccidentalSelection) {
        event.preventDefault()
        setActiveAccidentalSelection(null)
        return
      }

      const isCopyShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'c'
      if (isCopyShortcut) {
        event.preventDefault()
        const copyAttempt = buildClipboardFromSelections({
          pairs: measurePairs,
          activeSelection,
          selectedSelections,
          isSelectionVisible,
          importedNoteLookup: importedNoteLookupRef.current,
        })
        if (!copyAttempt.payload || copyAttempt.error) {
          const message = getCopyPasteFailureMessage(copyAttempt.error ?? 'selection-not-found')
          setNotationPaletteLastAction(message)
          console.info('[copy-paste]', message)
          return
        }
        noteClipboardRef.current = copyAttempt.payload
        const message = `已复制 ${copyAttempt.payload.pitches.length} 个音（${toDisplayDuration(copyAttempt.payload.duration)}）`
        setNotationPaletteLastAction(message)
        console.info('[copy-paste]', message, copyAttempt.payload)
        return
      }

      const isPasteShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'v'
      if (isPasteShortcut) {
        event.preventDefault()
        const pasteAttempt = applyClipboardPaste({
          pairs: measurePairs,
          clipboard: noteClipboardRef.current,
          activeSelection,
          isSelectionVisible,
          importedNoteLookup: importedNoteLookupRef.current,
          keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
          timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
          importedMode: measurePairsFromImportRef.current !== null,
        })
        if (!pasteAttempt.result || pasteAttempt.error) {
          const message = getCopyPasteFailureMessage(pasteAttempt.error ?? 'selection-not-found')
          setNotationPaletteLastAction(message)
          console.info('[copy-paste]', message)
          return
        }
        applyKeyboardEditResult(
          pasteAttempt.result.nextPairs,
          pasteAttempt.result.nextSelection,
          pasteAttempt.result.nextSelections,
        )
        const copiedCount = noteClipboardRef.current?.pitches.length ?? 0
        const message = `已粘贴 ${copiedCount} 个音`
        setNotationPaletteLastAction(message)
        console.info('[copy-paste]', message)
        return
      }

      if (event.key === 'Delete' && activeTieSelection) {
        const deleteAttempt = applyDeleteTieSelection({
          pairs: measurePairs,
          selection: activeTieSelection,
          fallbackSelection: activeSelection,
        })
        if (deleteAttempt.error || !deleteAttempt.result) {
          const message = getDeleteTieFailureMessage(deleteAttempt.error ?? 'selection-not-found')
          setNotationPaletteLastAction(message)
          console.info('[tie-delete]', message)
          return
        }
        event.preventDefault()
        applyKeyboardEditResult(
          deleteAttempt.result.nextPairs,
          deleteAttempt.result.nextSelection,
          deleteAttempt.result.nextSelections,
        )
        setActiveTieSelection(null)
        setIsSelectionVisible(false)
        setSelectedSelections([])
        setSelectedMeasureScope(null)
        setNotationPaletteLastAction('已删除延音线')
        console.info('[tie-delete] 已删除延音线')
        return
      }

      if (event.key === 'Delete' && activeAccidentalSelection) {
        const sourceImportedNoteLookup = importedNoteLookupRef.current
        const deleteAttempt = applyDeleteAccidentalSelection({
          pairs: measurePairs,
          selection: activeAccidentalSelection,
          importedNoteLookup: sourceImportedNoteLookup,
          keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
        })
        if (deleteAttempt.error || !deleteAttempt.result) {
          const message = getDeleteAccidentalFailureMessage(deleteAttempt.error ?? 'selection-not-found')
          setNotationPaletteLastAction(message)
          console.info('[accidental-delete]', message)
          return
        }
        event.preventDefault()
        applyKeyboardEditResult(
          deleteAttempt.result.nextPairs,
          deleteAttempt.result.nextSelection,
          deleteAttempt.result.nextSelections,
        )
        playAccidentalEditPreview({
          pairs: measurePairs,
          previewSelection: deleteAttempt.result.previewSelection,
          previewPitch: deleteAttempt.result.previewPitch,
          importedNoteLookup: sourceImportedNoteLookup,
        })
        setActiveAccidentalSelection(null)
        setIsSelectionVisible(false)
        setSelectedSelections([])
        setSelectedMeasureScope(null)
        setNotationPaletteLastAction('已删除变音记号（按上下文回落并重算）')
        console.info('[accidental-delete] 已删除变音记号（按上下文回落并重算）')
        return
      }

      if (event.key === 'Delete' && selectedMeasureScope && isSelectionVisible) {
        const deleteAttempt = applyDeleteMeasureSelection({
          pairs: measurePairs,
          selectedMeasureScope,
          importedMode: measurePairsFromImportRef.current !== null,
          keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
          timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
        })
        if (deleteAttempt.error || !deleteAttempt.result) {
          const message = getDeleteMeasureFailureMessage(deleteAttempt.error ?? 'selection-not-found')
          setNotationPaletteLastAction(message)
          console.info('[measure-delete]', message)
          return
        }
        event.preventDefault()
        applyKeyboardEditResult(
          deleteAttempt.result.nextPairs,
          deleteAttempt.result.nextSelection,
          deleteAttempt.result.nextSelections,
          'default',
          {
            collapseScopesToAdd: [{
              pairIndex: selectedMeasureScope.pairIndex,
              staff: selectedMeasureScope.staff,
            }],
          },
        )
        setSelectedMeasureScope({
          pairIndex: selectedMeasureScope.pairIndex,
          staff: selectedMeasureScope.staff,
        })
        setSelectedSelections([deleteAttempt.result.nextSelection])
        setNotationPaletteLastAction('已清空该小节并替换为全休止符')
        console.info('[measure-delete] 已清空该小节并替换为全休止符', selectedMeasureScope)
        return
      }

      if (!isSelectionVisible) return

      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        const moved = moveSelectionsByKeyboardSteps(event.key === 'ArrowUp' ? 'up' : 'down', 7, 'selected')
        if (moved) {
          event.preventDefault()
        }
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const moved = moveSelectionByKeyboardArrow(event.key === 'ArrowUp' ? 'up' : 'down')
        if (moved) {
          event.preventDefault()
        }
        return
      }

      if (event.key === 'Delete') {
        const result = deleteSelectedKey({
          pairs: measurePairs,
          selection: activeSelection,
          keyFifthsByMeasure: measureKeyFifthsFromImport,
          importedNoteLookup: importedNoteLookupRef.current,
        })
        if (!result) return
        event.preventDefault()
        applyKeyboardEditResult(result.nextPairs, result.nextSelection)
        return
      }

      const digitMatch = /^Digit([2-8])$/.exec(event.code)
      if (!digitMatch) return
      const intervalDegree = Number(digitMatch[1])
      if (!Number.isFinite(intervalDegree)) return
      const result = appendIntervalKey({
        pairs: measurePairs,
        selection: activeSelection,
        intervalDegree,
        direction: event.shiftKey ? 'down' : 'up',
        keyFifthsByMeasure: measureKeyFifthsFromImport,
        importedNoteLookup: importedNoteLookupRef.current,
      })
      if (!result) return
      event.preventDefault()
      applyKeyboardEditResult(result.nextPairs, result.nextSelection)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    activeAccidentalSelection,
    activeTieSelection,
    isOsmdPreviewOpen,
    draggingSelection,
    isSelectionVisible,
    measurePairs,
    activeSelection,
    selectedSelections,
    selectedMeasureScope,
    measureKeyFifthsFromImport,
    applyKeyboardEditResult,
    moveSelectionsByKeyboardSteps,
    moveSelectionByKeyboardArrow,
    playAccidentalEditPreview,
    undoLastScoreEdit,
  ])

  const scoreSurfaceOffsetXPx = horizontalRenderOffsetX * scoreScaleX
  const scaledRenderedScoreHeight = Math.max(1, scoreHeight * scoreScaleY)
  const scoreSurfaceOffsetYPx = Math.max(0, (displayScoreHeight - scaledRenderedScoreHeight) / 2)
  const playheadRectPx = useMemo<PlaybackCursorRect | null>(() => {
    void layoutStabilityKey
    void chordMarkerLayoutRevision
    if (!playbackCursorPoint) return null
    const playbackEvent = playbackTimelineEventByPointKey.get(getPlaybackPointKey(playbackCursorPoint)) ?? null
    if (!playbackEvent) return null

    const pairLayouts = noteLayoutsByPairRef.current.get(playbackCursorPoint.pairIndex) ?? []
    const layoutByStaffNoteIndex = new Map<string, NoteLayout>()
    pairLayouts.forEach((layout) => {
      layoutByStaffNoteIndex.set(`${layout.staff}:${layout.noteIndex}`, layout)
    })

    let bestHeadCandidate:
      | {
          globalX: number
          staffPriority: number
          noteIndex: number
          keyIndex: number
        }
      | null = null

    for (const target of playbackEvent.targets) {
      const layout = layoutByStaffNoteIndex.get(`${target.staff}:${target.noteIndex}`) ?? null
      if (!layout) continue
      const head = layout.noteHeads.find((item) => item.keyIndex === target.keyIndex) ?? null
      if (!head) continue
      const localLeftX = Number.isFinite(head.hitMinX) ? (head.hitMinX as number) : head.x
      if (!Number.isFinite(localLeftX)) continue
      const candidate = {
        globalX: localLeftX + horizontalRenderOffsetX,
        staffPriority: target.staff === 'treble' ? 0 : 1,
        noteIndex: target.noteIndex,
        keyIndex: target.keyIndex,
      }
      if (
        bestHeadCandidate === null ||
        candidate.globalX < bestHeadCandidate.globalX - 0.001 ||
        (Math.abs(candidate.globalX - bestHeadCandidate.globalX) <= 0.001 &&
          (candidate.staffPriority < bestHeadCandidate.staffPriority ||
            (candidate.staffPriority === bestHeadCandidate.staffPriority &&
              (candidate.noteIndex < bestHeadCandidate.noteIndex ||
                (candidate.noteIndex === bestHeadCandidate.noteIndex && candidate.keyIndex < bestHeadCandidate.keyIndex)))))
      ) {
        bestHeadCandidate = candidate
      }
    }

    let globalHeadLeftX: number | null = null
    if (bestHeadCandidate !== null) {
      globalHeadLeftX = bestHeadCandidate.globalX
    }
    if (globalHeadLeftX === null) {
      const timelineBundle = measureTimelineBundlesRef.current.get(playbackCursorPoint.pairIndex) ?? null
      const axisX = timelineBundle?.publicAxisLayout?.tickToX.get(playbackCursorPoint.onsetTick)
      if (typeof axisX === 'number' && Number.isFinite(axisX)) {
        globalHeadLeftX = axisX + horizontalRenderOffsetX
      }
    }
    if (globalHeadLeftX === null) {
      const frame = horizontalMeasureFramesByPair[playbackCursorPoint.pairIndex] ?? null
      const frameContentGeometry = getMeasureFrameContentGeometry(frame)
      if (frame && frameContentGeometry) {
        globalHeadLeftX =
          frameContentGeometry.contentStartX +
          frameContentGeometry.contentMeasureWidth *
            (playbackCursorPoint.onsetTick / Math.max(1, playbackEvent.measureTicks))
      }
    }
    if (globalHeadLeftX === null || !Number.isFinite(globalHeadLeftX)) return null

    const measureLayout =
      measureLayoutsRef.current.get(playbackCursorPoint.pairIndex) ??
      [...measureLayoutsRef.current.values()][0] ??
      null
    const trebleTopRaw =
      measureLayout !== null && Number.isFinite(measureLayout.trebleLineTopY)
        ? measureLayout.trebleLineTopY
        : SCORE_TOP_PADDING + SYSTEM_TREBLE_OFFSET_Y
    const trebleBottomRaw =
      measureLayout !== null && Number.isFinite(measureLayout.trebleLineBottomY)
        ? measureLayout.trebleLineBottomY
        : SCORE_TOP_PADDING + SYSTEM_TREBLE_OFFSET_Y + 40
    const bassTopRaw =
      measureLayout !== null && Number.isFinite(measureLayout.bassLineTopY)
        ? measureLayout.bassLineTopY
        : SCORE_TOP_PADDING + SYSTEM_BASS_OFFSET_Y
    const bassBottomRaw =
      measureLayout !== null && Number.isFinite(measureLayout.bassLineBottomY)
        ? measureLayout.bassLineBottomY
        : SCORE_TOP_PADDING + SYSTEM_BASS_OFFSET_Y + 40
    const lineTopRaw = Math.min(trebleTopRaw, trebleBottomRaw, bassTopRaw, bassBottomRaw)
    const lineBottomRaw = Math.max(trebleTopRaw, trebleBottomRaw, bassTopRaw, bassBottomRaw)
    const x = globalHeadLeftX * scoreScaleX + SCORE_STAGE_BORDER_PX - PLAYHEAD_OFFSET_PX
    const y = scoreSurfaceOffsetYPx + lineTopRaw * scoreScaleY + SCORE_STAGE_BORDER_PX - PLAYHEAD_VERTICAL_MARGIN_PX
    const bottomY =
      scoreSurfaceOffsetYPx + lineBottomRaw * scoreScaleY + SCORE_STAGE_BORDER_PX + PLAYHEAD_VERTICAL_MARGIN_PX
    const height = bottomY - y
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(height)) return null
    if (height <= 0) return null
    return {
      x,
      y,
      width: PLAYHEAD_WIDTH_PX,
      height,
    }
  }, [
    chordMarkerLayoutRevision,
    getMeasureFrameContentGeometry,
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetX,
    layoutStabilityKey,
    playbackCursorPoint,
    playbackTimelineEventByPointKey,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetYPx,
  ])
  const playbackCursorState = useMemo<PlaybackCursorState>(() => ({
    point: playbackCursorPoint ? { ...playbackCursorPoint } : null,
    color: playbackCursorColor,
    rectPx: playheadRectPx ? { ...playheadRectPx } : null,
  }), [playbackCursorColor, playbackCursorPoint, playheadRectPx])
  const measureRulerTicks = useMemo(() => {
    if (horizontalMeasureFramesByPair.length === 0) return [] as Array<{ key: string; xPx: number; label: string }>
    return horizontalMeasureFramesByPair.map((frame, index) => {
      return {
        key: `measure-ruler-${index + 1}`,
        // Keep ruler ticks in the same visual coordinate space as barlines in the bordered stage.
        xPx: frame.measureX * scoreScaleX + SCORE_STAGE_BORDER_PX,
        label: `${index + 1}`,
      }
    })
  }, [horizontalMeasureFramesByPair, scoreScaleX])
  const chordRulerMarkerMetaByKey = useMemo(() => {
    const markers = new Map<string, ChordRulerMarkerMeta>()
    chordRulerMarkerGeometryByKey.forEach((geometry, key) => {
      const displayLabel = showChordDegreeEnabled
        ? chordNameToDegree(geometry.sourceLabel, geometry.keyFifths, geometry.keyMode)
        : geometry.sourceLabel
      const textAnchorXPx = geometry.anchorGlobalX * scoreScaleX + SCORE_STAGE_BORDER_PX
      const buttonLeftXPx = textAnchorXPx - chordMarkerStyleMetrics.labelLeftInsetPx
      if (!Number.isFinite(buttonLeftXPx)) return
      markers.set(key, {
        key: geometry.key,
        pairIndex: geometry.pairIndex,
        beatIndex: geometry.beatIndex,
        sourceLabel: geometry.sourceLabel,
        displayLabel,
        startTick: geometry.startTick,
        endTick: geometry.endTick,
        positionText: geometry.positionText,
        anchorGlobalX: geometry.anchorGlobalX,
        anchorXPx: textAnchorXPx,
        xPx: buttonLeftXPx,
        anchorSource: geometry.anchorSource,
        keyFifths: geometry.keyFifths,
        keyMode: geometry.keyMode,
      })
    })
    return markers
  }, [
    chordMarkerStyleMetrics.labelLeftInsetPx,
    chordRulerMarkerGeometryByKey,
    scoreScaleX,
    showChordDegreeEnabled,
  ])
  useEffect(() => {
    if (!activeChordSelection) return
    if (activeChordSelection.markerKey === null) return
    if (chordRulerMarkerMetaByKey.has(activeChordSelection.markerKey)) return
    setActiveChordSelection(null)
  }, [activeChordSelection, chordRulerMarkerMetaByKey])
  const chordRulerMarkers = useMemo(() => {
    if (chordRulerMarkerMetaByKey.size === 0) return [] as ChordRulerMarker[]
    return [...chordRulerMarkerMetaByKey.values()].map((marker) => ({
      key: marker.key,
      xPx: marker.xPx,
      sourceLabel: marker.sourceLabel,
      displayLabel: marker.displayLabel,
      isActive: activeChordSelection?.markerKey === marker.key,
      pairIndex: marker.pairIndex,
      positionText: marker.positionText,
      beatIndex: marker.beatIndex,
    }))
  }, [activeChordSelection, chordRulerMarkerMetaByKey])
  const applyChordSelectionRange = useCallback((params: {
    pairIndex: number
    startTick: number
    endTick: number
    markerKey?: string | null
  }): Selection[] => {
    const targetPair = measurePairsRef.current[params.pairIndex]
    if (!targetPair) return []
    const nextSelections = buildSelectionsForMeasureTickRange(targetPair, params.startTick, params.endTick)
    resetMidiStepChain()
    setActiveAccidentalSelection(null)
    setActiveTieSelection(null)
    setSelectedMeasureScope(null)
    setDraggingSelection(null)
    if (nextSelections.length > 0) {
      setIsSelectionVisible(true)
      setSelectedSelections(nextSelections)
      setActiveSelection(nextSelections[0])
    } else {
      setIsSelectionVisible(false)
      setSelectedSelections([])
    }
    setActiveChordSelection({
      markerKey: params.markerKey ?? null,
      pairIndex: params.pairIndex,
      startTick: params.startTick,
      endTick: params.endTick,
    })
    return nextSelections
  }, [resetMidiStepChain])
  const onChordRulerMarkerClick = useCallback((markerKey: string) => {
    const marker = chordRulerMarkerMetaByKey.get(markerKey)
    if (!marker) return
    applyChordSelectionRange({
      pairIndex: marker.pairIndex,
      startTick: marker.startTick,
      endTick: marker.endTick,
      markerKey: marker.key,
    })
  }, [applyChordSelectionRange, chordRulerMarkerMetaByKey])
  const resolveChordHighlightContentBounds = useCallback((params: {
    pairIndex: number
    startTick: number
    endTick: number
  }): { leftXRaw: number; rightXRaw: number } | null => {
    const safeStartTick = Math.max(0, Math.round(params.startTick))
    const safeEndTick = Math.max(safeStartTick, Math.round(params.endTick))
    if (safeEndTick <= safeStartTick) return null

    const pair = measurePairsRef.current[params.pairIndex]
    if (!pair) return null
    const pairLayouts = noteLayoutsByPairRef.current.get(params.pairIndex) ?? []
    if (pairLayouts.length === 0) return null

    const layoutByStaffNoteIndex = new Map<string, NoteLayout>()
    pairLayouts.forEach((layout) => {
      layoutByStaffNoteIndex.set(`${layout.staff}:${layout.noteIndex}`, layout)
    })

    let minLeftX = Number.POSITIVE_INFINITY
    let maxRightX = Number.NEGATIVE_INFINITY
    const acceptBounds = (left: number, right: number) => {
      if (!Number.isFinite(left) || !Number.isFinite(right)) return
      if (right <= left) return
      minLeftX = Math.min(minLeftX, left)
      maxRightX = Math.max(maxRightX, right)
    }

    ;(['treble', 'bass'] as const).forEach((staff) => {
      const staffNotes = staff === 'treble' ? pair.treble : pair.bass
      const onsetTicksByNoteIndex = buildStaffOnsetTicks(staffNotes)
      staffNotes.forEach((_, noteIndex) => {
        const onsetTick = onsetTicksByNoteIndex[noteIndex]
        if (!Number.isFinite(onsetTick)) return
        if (onsetTick < safeStartTick || onsetTick >= safeEndTick) return

        const layout = layoutByStaffNoteIndex.get(`${staff}:${noteIndex}`) ?? null
        if (!layout) return

        const leftCandidates: number[] = []
        if (Number.isFinite(layout.x)) leftCandidates.push(layout.x)
        layout.noteHeads.forEach((head) => {
          if (Number.isFinite(head.hitMinX)) {
            leftCandidates.push(head.hitMinX as number)
          } else if (Number.isFinite(head.x)) {
            leftCandidates.push(head.x)
          }
        })
        layout.accidentalLayouts.forEach((accidental) => {
          if (Number.isFinite(accidental.hitMinX)) {
            leftCandidates.push(accidental.hitMinX as number)
            return
          }
          if (!Number.isFinite(accidental.x)) return
          if (Number.isFinite(accidental.hitRadiusX)) {
            leftCandidates.push(accidental.x - (accidental.hitRadiusX as number))
            return
          }
          leftCandidates.push(accidental.x - 4)
        })

        const rightCandidates: number[] = []
        layout.noteHeads.forEach((head) => {
          if (Number.isFinite(head.hitMaxX)) {
            rightCandidates.push(head.hitMaxX as number)
            return
          }
          if (Number.isFinite(head.x)) {
            rightCandidates.push(head.x + 9)
          }
        })
        if (Number.isFinite(layout.spacingRightX)) {
          rightCandidates.push(layout.spacingRightX)
        }
        if (rightCandidates.length === 0 && Number.isFinite(layout.x)) {
          rightCandidates.push(layout.x + 9)
        }
        if (rightCandidates.length === 0 && Number.isFinite(layout.rightX)) {
          rightCandidates.push(layout.rightX)
        }

        const noteLeft = leftCandidates.length > 0 ? Math.min(...leftCandidates) : Number.POSITIVE_INFINITY
        const noteRight = rightCandidates.length > 0 ? Math.max(...rightCandidates) : Number.NEGATIVE_INFINITY
        acceptBounds(noteLeft, noteRight)
      })
    })

    if (!Number.isFinite(minLeftX) || !Number.isFinite(maxRightX)) return null
    if (maxRightX <= minLeftX) return null
    return {
      leftXRaw: minLeftX,
      rightXRaw: maxRightX,
    }
  }, [])
  const selectedMeasureHighlightRectPx = useMemo(() => {
    void layoutStabilityKey
    void chordMarkerLayoutRevision
    const measurePadX = 6
    const measurePadY = 4
    if (activeChordSelection !== null) {
      const measureLayout = measureLayoutsRef.current.get(activeChordSelection.pairIndex) ?? null
      if (!measureLayout) return null
      const contentBounds = resolveChordHighlightContentBounds({
        pairIndex: activeChordSelection.pairIndex,
        startTick: activeChordSelection.startTick,
        endTick: activeChordSelection.endTick,
      })
      if (!contentBounds) return null
      const trebleTopRaw = Number.isFinite(measureLayout.trebleLineTopY) ? measureLayout.trebleLineTopY : measureLayout.trebleY
      const trebleBottomRaw =
        Number.isFinite(measureLayout.trebleLineBottomY) ? measureLayout.trebleLineBottomY : measureLayout.trebleY + 40
      const bassTopRaw = Number.isFinite(measureLayout.bassLineTopY) ? measureLayout.bassLineTopY : measureLayout.bassY
      const bassBottomRaw =
        Number.isFinite(measureLayout.bassLineBottomY) ? measureLayout.bassLineBottomY : measureLayout.bassY + 40
      const trebleTop = Math.min(trebleTopRaw, trebleBottomRaw)
      const trebleBottom = Math.max(trebleTopRaw, trebleBottomRaw)
      const bassTop = Math.min(bassTopRaw, bassBottomRaw)
      const bassBottom = Math.max(bassTopRaw, bassBottomRaw)
      const lineTop = Math.min(trebleTop, bassTop)
      const lineBottom = Math.max(trebleBottom, bassBottom)
      const x = scoreSurfaceOffsetXPx + contentBounds.leftXRaw * scoreScaleX + SCORE_STAGE_BORDER_PX
      const y = scoreSurfaceOffsetYPx + lineTop * scoreScaleY + SCORE_STAGE_BORDER_PX
      const width = (contentBounds.rightXRaw - contentBounds.leftXRaw) * scoreScaleX
      const height = (lineBottom - lineTop) * scoreScaleY
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null
      }
      if (width <= 0 || height <= 0) return null
      return {
        x: x - CHORD_HIGHLIGHT_PAD_X_PX,
        y: y - CHORD_HIGHLIGHT_PAD_Y_PX,
        width: width + CHORD_HIGHLIGHT_PAD_X_PX * 2,
        height: height + CHORD_HIGHLIGHT_PAD_Y_PX * 2,
      }
    }
    if (selectedMeasureScope === null) return null
    const measureLayout = measureLayoutsRef.current.get(selectedMeasureScope.pairIndex) ?? null
    if (!measureLayout) return null
    const frame = horizontalMeasureFramesByPair[selectedMeasureScope.pairIndex] ?? null
    const x =
      frame !== null
        ? frame.measureX * scoreScaleX + SCORE_STAGE_BORDER_PX
        : scoreSurfaceOffsetXPx + measureLayout.measureX * scoreScaleX + SCORE_STAGE_BORDER_PX
    const lineTopRaw =
      selectedMeasureScope.staff === 'treble'
        ? (Number.isFinite(measureLayout.trebleLineTopY) ? measureLayout.trebleLineTopY : measureLayout.trebleY)
        : (Number.isFinite(measureLayout.bassLineTopY) ? measureLayout.bassLineTopY : measureLayout.bassY)
    const lineBottomRaw =
      selectedMeasureScope.staff === 'treble'
        ? (Number.isFinite(measureLayout.trebleLineBottomY) ? measureLayout.trebleLineBottomY : measureLayout.trebleY + 40)
        : (Number.isFinite(measureLayout.bassLineBottomY) ? measureLayout.bassLineBottomY : measureLayout.bassY + 40)
    const lineTop = Math.min(lineTopRaw, lineBottomRaw)
    const lineBottom = Math.max(lineTopRaw, lineBottomRaw)
    const y = scoreSurfaceOffsetYPx + lineTop * scoreScaleY + SCORE_STAGE_BORDER_PX
    const width =
      frame !== null
        ? frame.measureWidth * scoreScaleX
        : measureLayout.measureWidth * scoreScaleX
    const height = (lineBottom - lineTop) * scoreScaleY
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
      return null
    }
    if (width <= 0 || height <= 0) return null
    return {
      x: x - measurePadX,
      y: y - measurePadY,
      width: width + measurePadX * 2,
      height: height + measurePadY * 2,
    }
  }, [
    activeChordSelection,
    chordMarkerLayoutRevision,
    horizontalMeasureFramesByPair,
    resolveChordHighlightContentBounds,
    selectedMeasureScope,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    scoreScaleX,
    scoreScaleY,
    layoutStabilityKey,
  ])
  const formatDebugCoord = (value: number | null | undefined): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'null'
    return value.toFixed(3)
  }
  const finiteOrNull = (value: number | null | undefined): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return value
  }
  const getPitchForKeyIndex = (note: ScoreNote, keyIndex: number): Pitch => {
    if (keyIndex <= 0) return note.pitch
    return note.chordPitches?.[keyIndex - 1] ?? note.pitch
  }
  const captureFirstMeasureSnapshot = (stage: string): FirstMeasureSnapshot | null => {
    const pairIndex = 0
    const measure = measurePairsRef.current[pairIndex]
    if (!measure) return null
    const layouts = noteLayoutsByPairRef.current.get(pairIndex) ?? []
    const layoutByNoteKey = new Map<string, NoteLayout>()
    layouts.forEach((layout) => {
      layoutByNoteKey.set(`${layout.staff}:${layout.id}`, layout)
    })
    const measureLayout = measureLayoutsRef.current.get(pairIndex) ?? null
    const rows: FirstMeasureNoteDebugRow[] = []
    const pushRows = (staff: 'treble' | 'bass', notes: ScoreNote[]) => {
      notes.forEach((note, noteIndex) => {
        const layout = layoutByNoteKey.get(`${staff}:${note.id}`)
        const keyCount = 1 + (note.chordPitches?.length ?? 0)
        for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
          const pitch = getPitchForKeyIndex(note, keyIndex)
          const head = layout?.noteHeads.find((item) => item.keyIndex === keyIndex)
          rows.push({
            staff,
            noteId: note.id,
            noteIndex,
            keyIndex,
            pitch,
            noteX: finiteOrNull(layout?.x),
            noteRightX: finiteOrNull(layout?.rightX),
            spacingRightX: finiteOrNull(layout?.spacingRightX),
            headX: finiteOrNull(head?.x),
            headY: finiteOrNull(head?.y),
            pitchY: finiteOrNull(layout?.pitchYMap[pitch]),
          })
        }
      })
    }
    pushRows('treble', measure.treble)
    pushRows('bass', measure.bass)
    return {
      stage,
      pairIndex,
      generatedAt: new Date().toISOString(),
      measureX: finiteOrNull(measureLayout?.measureX),
      measureWidth: finiteOrNull(measureLayout?.contentMeasureWidth ?? measureLayout?.measureWidth),
      measureEndBarX: finiteOrNull(
        measureLayout
          ? measureLayout.measureX + (measureLayout.renderedMeasureWidth ?? measureLayout.measureWidth)
          : null,
      ),
      noteStartX: finiteOrNull(measureLayout?.noteStartX),
      noteEndX: finiteOrNull(measureLayout?.noteEndX),
      rows,
    }
  }
  const buildFirstMeasureDiffReport = (
    beforeSnapshot: FirstMeasureSnapshot,
    afterSnapshot: FirstMeasureSnapshot,
  ): string => {
    const afterByRowKey = new Map<string, FirstMeasureNoteDebugRow>()
    afterSnapshot.rows.forEach((row) => {
      afterByRowKey.set(`${row.staff}:${row.noteId}:${row.keyIndex}`, row)
    })
    const lines: string[] = [
      `generatedAt: ${new Date().toISOString()}`,
      `debugTarget: first-measure(pair=0)`,
      `dragged: ${
        firstMeasureDragContextRef.current
          ? `${firstMeasureDragContextRef.current.staff}:${firstMeasureDragContextRef.current.noteId}[key=${firstMeasureDragContextRef.current.keyIndex}] pair=${firstMeasureDragContextRef.current.pairIndex}`
          : 'unknown'
      }`,
      `dragPreviewFrameCount: ${dragDebugFramesRef.current.length}`,
      `baselineStage: ${beforeSnapshot.stage} at ${beforeSnapshot.generatedAt}`,
      `releaseStage: ${afterSnapshot.stage} at ${afterSnapshot.generatedAt}`,
      `baseline measureX=${formatDebugCoord(beforeSnapshot.measureX)} measureWidth=${formatDebugCoord(beforeSnapshot.measureWidth)} measureEndBarX=${formatDebugCoord(beforeSnapshot.measureEndBarX)} noteStartX=${formatDebugCoord(beforeSnapshot.noteStartX)} noteEndX=${formatDebugCoord(beforeSnapshot.noteEndX)}`,
      `release  measureX=${formatDebugCoord(afterSnapshot.measureX)} measureWidth=${formatDebugCoord(afterSnapshot.measureWidth)} measureEndBarX=${formatDebugCoord(afterSnapshot.measureEndBarX)} noteStartX=${formatDebugCoord(afterSnapshot.noteStartX)} noteEndX=${formatDebugCoord(afterSnapshot.noteEndX)}`,
      '',
      'rows (before -> after | delta):',
    ]
    beforeSnapshot.rows.forEach((beforeRow) => {
      const rowKey = `${beforeRow.staff}:${beforeRow.noteId}:${beforeRow.keyIndex}`
      const afterRow = afterByRowKey.get(rowKey)
      const delta = (afterValue: number | null, beforeValue: number | null): string => {
        if (typeof afterValue !== 'number' || typeof beforeValue !== 'number') return 'null'
        return (afterValue - beforeValue).toFixed(3)
      }
      lines.push(
        [
          `- ${beforeRow.staff} note=${beforeRow.noteId} idx=${beforeRow.noteIndex} key=${beforeRow.keyIndex} pitch=${beforeRow.pitch}:`,
          `noteX ${formatDebugCoord(beforeRow.noteX)} -> ${formatDebugCoord(afterRow?.noteX)} (d=${delta(afterRow?.noteX ?? null, beforeRow.noteX)})`,
          `headX ${formatDebugCoord(beforeRow.headX)} -> ${formatDebugCoord(afterRow?.headX)} (d=${delta(afterRow?.headX ?? null, beforeRow.headX)})`,
          `headY ${formatDebugCoord(beforeRow.headY)} -> ${formatDebugCoord(afterRow?.headY)} (d=${delta(afterRow?.headY ?? null, beforeRow.headY)})`,
          `pitchY ${formatDebugCoord(beforeRow.pitchY)} -> ${formatDebugCoord(afterRow?.pitchY)} (d=${delta(afterRow?.pitchY ?? null, beforeRow.pitchY)})`,
          `rightX ${formatDebugCoord(beforeRow.noteRightX)} -> ${formatDebugCoord(afterRow?.noteRightX)} (d=${delta(afterRow?.noteRightX ?? null, beforeRow.noteRightX)})`,
          `spacingRightX ${formatDebugCoord(beforeRow.spacingRightX)} -> ${formatDebugCoord(afterRow?.spacingRightX)} (d=${delta(afterRow?.spacingRightX ?? null, beforeRow.spacingRightX)})`,
        ].join(' '),
      )
    })
    return lines.join('\n')
  }
  const onBeginDragWithFirstMeasureDebug: typeof beginDrag = (event) => {
    scoreScrollRef.current?.focus()
    beginDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    const drag = dragRef.current
    if (!drag) return
    firstMeasureDragContextRef.current = {
      noteId: drag.noteId,
      staff: drag.staff,
      keyIndex: drag.keyIndex,
      pairIndex: drag.pairIndex,
    }
    firstMeasureBaselineRef.current = captureFirstMeasureSnapshot('before-drag')
  }
  const onEndDragWithFirstMeasureDebug: typeof endDrag = (event) => {
    const dragging = dragRef.current
    endDrag(event)
    if (!ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG) return
    if (!dragging) return
    const beforeSnapshot = firstMeasureBaselineRef.current
    if (!beforeSnapshot) return
    if (firstMeasureDebugRafRef.current !== null) {
      window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      firstMeasureDebugRafRef.current = null
    }
    firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
      firstMeasureDebugRafRef.current = window.requestAnimationFrame(() => {
        const afterSnapshot = captureFirstMeasureSnapshot('after-drag-release')
        if (afterSnapshot) {
          const report = buildFirstMeasureDiffReport(beforeSnapshot, afterSnapshot)
          setMeasureEdgeDebugReport(report)
          console.log(report)
        }
        firstMeasureBaselineRef.current = null
        firstMeasureDragContextRef.current = null
        firstMeasureDebugRafRef.current = null
      })
    })
  }
  const dumpAllMeasureCoordinateReport = useCallback(() => {
    const measureLayouts = measureLayoutsRef.current
    const noteLayoutsByPair = noteLayoutsByPairRef.current
    const measureTimelineBundles = measureTimelineBundlesRef.current
    const pairs = measurePairsRef.current
    const toRoundedNumber = (value: number | null | undefined, digits: number): number | null => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      return Number(value.toFixed(digits))
    }
    const buildOnsetTicksByNoteIndex = (staffNotes: ScoreNote[]): number[] => {
      const onsetTicks: number[] = []
      let cursor = 0
      staffNotes.forEach((note) => {
        onsetTicks.push(cursor)
        const ticks = DURATION_TICKS[note.duration]
        const safeTicks = Number.isFinite(ticks) ? Math.max(1, ticks) : TICKS_PER_BEAT
        cursor += safeTicks
      })
      return onsetTicks
    }
    const rows = pairs.map((pair, pairIndex) => {
      const measureLayout = measureLayouts.get(pairIndex) ?? null
      const pairLayouts = noteLayoutsByPair.get(pairIndex) ?? []
      const timelineBundle = measureTimelineBundles.get(pairIndex) ?? null
      const trebleOnsetTicksByIndex = buildOnsetTicksByNoteIndex(pair.treble)
      const bassOnsetTicksByIndex = buildOnsetTicksByNoteIndex(pair.bass)
      const axisPointBuckets = new Map<
        number,
        { xTotal: number; xCount: number; trebleNoteCount: number; bassNoteCount: number }
      >()
      pairLayouts.forEach((layout) => {
        const onsetTicks =
          layout.staff === 'treble'
            ? (trebleOnsetTicksByIndex[layout.noteIndex] ?? null)
            : (bassOnsetTicksByIndex[layout.noteIndex] ?? null)
        if (typeof onsetTicks !== 'number' || !Number.isFinite(onsetTicks)) return
        const bucket = axisPointBuckets.get(onsetTicks) ?? {
          xTotal: 0,
          xCount: 0,
          trebleNoteCount: 0,
          bassNoteCount: 0,
        }
        if (Number.isFinite(layout.x)) {
          bucket.xTotal += layout.x
          bucket.xCount += 1
        }
        if (layout.staff === 'treble') {
          bucket.trebleNoteCount += 1
        } else {
          bucket.bassNoteCount += 1
        }
        axisPointBuckets.set(onsetTicks, bucket)
      })
      const orderedOnsets = [...axisPointBuckets.keys()].sort((left, right) => left - right)
      const timeAxisPointIndexByOnset = new Map<number, number>()
      const timeAxisPointXByOnset = new Map<number, number | null>()
      const timeAxisPoints = orderedOnsets.map((onsetTicks, pointIndex) => {
        const bucket = axisPointBuckets.get(onsetTicks)
        const averagedX =
          bucket && bucket.xCount > 0 ? toRoundedNumber(bucket.xTotal / bucket.xCount, 3) : null
        timeAxisPointIndexByOnset.set(onsetTicks, pointIndex)
        timeAxisPointXByOnset.set(onsetTicks, averagedX)
        const trebleNoteCount = bucket?.trebleNoteCount ?? 0
        const bassNoteCount = bucket?.bassNoteCount ?? 0
        return {
          pointIndex,
          onsetTicksInMeasure: onsetTicks,
          onsetBeatsInMeasure: toRoundedNumber(onsetTicks / TICKS_PER_BEAT, 4),
          x: averagedX,
          noteCount: trebleNoteCount + bassNoteCount,
          trebleNoteCount,
          bassNoteCount,
        }
      })
      const layoutRows = pairLayouts
        .slice()
        .sort((left, right) => {
          if (left.staff !== right.staff) return left.staff.localeCompare(right.staff)
          if (left.noteIndex !== right.noteIndex) return left.noteIndex - right.noteIndex
          return left.x - right.x
        })
        .map((layout) => {
          const sourceNote = layout.staff === 'treble' ? pair.treble[layout.noteIndex] : pair.bass[layout.noteIndex]
          const onsetTicksInMeasure =
            sourceNote && layout.staff === 'treble'
              ? (trebleOnsetTicksByIndex[layout.noteIndex] ?? null)
              : sourceNote
                ? (bassOnsetTicksByIndex[layout.noteIndex] ?? null)
                : null
          return {
            staff: layout.staff,
            noteId: layout.id,
            noteIndex: layout.noteIndex,
            pitch: sourceNote?.pitch ?? null,
            isRest: sourceNote?.isRest === true,
            duration: sourceNote?.duration ?? null,
            durationTicksInMeasure:
              sourceNote && Number.isFinite(DURATION_TICKS[sourceNote.duration])
                ? DURATION_TICKS[sourceNote.duration]
                : null,
            onsetTicksInMeasure:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? onsetTicksInMeasure
                : null,
            onsetBeatsInMeasure:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? toRoundedNumber(onsetTicksInMeasure / TICKS_PER_BEAT, 4)
                : null,
            timeAxisPointIndex:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? (timeAxisPointIndexByOnset.get(onsetTicksInMeasure) ?? null)
                : null,
            timeAxisPointX:
              typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
                ? (timeAxisPointXByOnset.get(onsetTicksInMeasure) ?? null)
                : null,
            x: layout.x,
            anchorX: layout.anchorX,
            visualLeftX: layout.visualLeftX,
            visualRightX: layout.visualRightX,
            rightX: layout.rightX,
            spacingRightX: layout.spacingRightX,
            noteHeads: layout.noteHeads.map((head) => ({
              keyIndex: head.keyIndex,
              pitch: head.pitch,
              x: head.x,
              y: head.y,
            })),
            accidentalCoords: Object.entries(layout.accidentalRightXByKeyIndex)
              .map(([rawKeyIndex, leftX]) => {
                const keyIndex = Number(rawKeyIndex)
                const accidentalLayout = layout.accidentalLayouts.find((entry) => entry.keyIndex === keyIndex)
                return {
                  keyIndex,
                  rightX: leftX,
                  leftX:
                    typeof accidentalLayout?.hitMinX === 'number' && Number.isFinite(accidentalLayout.hitMinX)
                      ? accidentalLayout.hitMinX
                      : leftX,
                  visualRightX:
                    typeof accidentalLayout?.hitMaxX === 'number' && Number.isFinite(accidentalLayout.hitMaxX)
                      ? accidentalLayout.hitMaxX
                      : null,
                }
              })
              .filter((entry) => Number.isFinite(entry.keyIndex) && Number.isFinite(entry.rightX))
              .sort((left, right) => left.keyIndex - right.keyIndex),
          }
        })

      const onsetRows = layoutRows.filter(
        (row): row is (typeof layoutRows)[number] & { onsetTicksInMeasure: number } =>
          typeof row.onsetTicksInMeasure === 'number' && Number.isFinite(row.onsetTicksInMeasure),
      )
      const firstOnsetTicks =
        onsetRows.length > 0
          ? onsetRows.reduce((minValue, row) => Math.min(minValue, row.onsetTicksInMeasure), Number.POSITIVE_INFINITY)
          : null
      const lastOnsetTicks =
        onsetRows.length > 0
          ? onsetRows.reduce((maxValue, row) => Math.max(maxValue, row.onsetTicksInMeasure), Number.NEGATIVE_INFINITY)
          : null

      const firstOnsetRows =
        typeof firstOnsetTicks === 'number' && Number.isFinite(firstOnsetTicks)
          ? onsetRows.filter((row) => row.onsetTicksInMeasure === firstOnsetTicks)
          : []
      const lastOnsetRows =
        typeof lastOnsetTicks === 'number' && Number.isFinite(lastOnsetTicks)
          ? onsetRows.filter((row) => row.onsetTicksInMeasure === lastOnsetTicks)
          : []

      const firstVisualLeftX = firstOnsetRows.reduce((minValue, row) => {
        let rowMin = Number.POSITIVE_INFINITY
        if (Number.isFinite(row.x)) rowMin = Math.min(rowMin, row.x)
        row.noteHeads.forEach((head) => {
          if (Number.isFinite(head.x)) rowMin = Math.min(rowMin, head.x)
        })
        row.accidentalCoords.forEach((accidental) => {
          if (typeof accidental.leftX === 'number' && Number.isFinite(accidental.leftX)) {
            rowMin = Math.min(rowMin, accidental.leftX)
          } else if (Number.isFinite(accidental.rightX)) {
            rowMin = Math.min(rowMin, accidental.rightX - 9)
          }
        })
        return Number.isFinite(rowMin) ? Math.min(minValue, rowMin) : minValue
      }, Number.POSITIVE_INFINITY)

      const lastVisualRightX = lastOnsetRows.reduce((maxValue, row) => {
        const rowRightX = Number.isFinite(row.spacingRightX)
          ? row.spacingRightX
          : Number.isFinite(row.rightX)
            ? row.rightX
            : Number.NEGATIVE_INFINITY
        return Number.isFinite(rowRightX) ? Math.max(maxValue, rowRightX) : maxValue
      }, Number.NEGATIVE_INFINITY)

      const maxVisualRightX =
        layoutRows.length > 0 ? layoutRows.reduce((maxX, row) => Math.max(maxX, row.rightX), Number.NEGATIVE_INFINITY) : null
      const maxSpacingRightX =
        layoutRows.length > 0
          ? layoutRows.reduce((maxX, row) => Math.max(maxX, row.spacingRightX), Number.NEGATIVE_INFINITY)
          : null

      const effectiveBoundary = measureLayout
        ? resolveEffectiveBoundary({
            measureX: measureLayout.measureX,
            measureWidth: measureLayout.measureWidth,
            noteStartX: measureLayout.noteStartX,
            noteEndX: measureLayout.noteEndX,
            showStartDecorations:
              measureLayout.isSystemStart ||
              measureLayout.showKeySignature ||
              measureLayout.showTimeSignature ||
              measureLayout.includeMeasureStartDecorations,
            showEndDecorations: measureLayout.showEndTimeSignature,
          })
        : null
      const spacingAnchorTicks = timelineBundle?.spacingAnchorTicks ?? orderedOnsets
      const firstSpacingTick = spacingAnchorTicks.length > 0 ? spacingAnchorTicks[0] ?? null : null
      const lastSpacingTick = spacingAnchorTicks.length > 0 ? spacingAnchorTicks[spacingAnchorTicks.length - 1] ?? null : null
      const firstSpacingTickX =
        typeof firstSpacingTick === 'number' && Number.isFinite(firstSpacingTick)
          ? timelineBundle?.spacingTickToX.get(firstSpacingTick) ?? timeAxisPointXByOnset.get(firstSpacingTick) ?? null
          : null
      const lastSpacingTickX =
        typeof lastSpacingTick === 'number' && Number.isFinite(lastSpacingTick)
          ? timelineBundle?.spacingTickToX.get(lastSpacingTick) ?? timeAxisPointXByOnset.get(lastSpacingTick) ?? null
          : null

      return {
        pairIndex,
        rendered: measureLayout !== null,
        timelineMode: timelineBundle?.timelineMode ?? 'legacy',
        measureX: measureLayout?.measureX ?? null,
        measureWidth: measureLayout?.contentMeasureWidth ?? measureLayout?.measureWidth ?? null,
        renderedMeasureWidthPx:
          measureLayout?.renderedMeasureWidth ?? measureLayout?.measureWidth ?? null,
        systemTop: measureLayout?.systemTop ?? null,
        trebleY: measureLayout?.trebleY ?? null,
        bassY: measureLayout?.bassY ?? null,
        measureStartBarX: measureLayout?.measureX ?? null,
        measureEndBarX:
          measureLayout
            ? measureLayout.measureX + (measureLayout.renderedMeasureWidth ?? measureLayout.measureWidth)
            : null,
        noteStartX: measureLayout?.noteStartX ?? null,
        noteEndX: measureLayout?.noteEndX ?? null,
        sharedStartDecorationReservePx:
          measureLayout && Number.isFinite(measureLayout.sharedStartDecorationReservePx)
            ? Number((measureLayout.sharedStartDecorationReservePx as number).toFixed(3))
            : null,
        actualStartDecorationWidthPx:
          measureLayout && Number.isFinite(measureLayout.actualStartDecorationWidthPx)
            ? Number((measureLayout.actualStartDecorationWidthPx as number).toFixed(3))
            : null,
        effectiveBoundaryStartX:
          measureLayout && Number.isFinite(measureLayout.effectiveBoundaryStartX)
            ? Number((measureLayout.effectiveBoundaryStartX as number).toFixed(3))
            : effectiveBoundary
              ? Number(effectiveBoundary.effectiveStartX.toFixed(3))
              : null,
        effectiveBoundaryEndX:
          measureLayout && Number.isFinite(measureLayout.effectiveBoundaryEndX)
            ? Number((measureLayout.effectiveBoundaryEndX as number).toFixed(3))
            : effectiveBoundary
              ? Number(effectiveBoundary.effectiveEndX.toFixed(3))
              : null,
        effectiveLeftGapPx:
          measureLayout && Number.isFinite(measureLayout.effectiveLeftGapPx)
            ? Number((measureLayout.effectiveLeftGapPx as number).toFixed(3))
            : effectiveBoundary && Number.isFinite(firstVisualLeftX)
              ? Number((firstVisualLeftX - effectiveBoundary.effectiveStartX).toFixed(3))
              : null,
        effectiveRightGapPx:
          measureLayout && Number.isFinite(measureLayout.effectiveRightGapPx)
            ? Number((measureLayout.effectiveRightGapPx as number).toFixed(3))
            : effectiveBoundary && Number.isFinite(lastVisualRightX)
              ? Number((effectiveBoundary.effectiveEndX - lastVisualRightX).toFixed(3))
              : null,
        leadingGapPx:
          measureLayout && Number.isFinite(measureLayout.leadingGapPx)
            ? Number((measureLayout.leadingGapPx as number).toFixed(3))
            : effectiveBoundary && typeof firstSpacingTickX === 'number' && Number.isFinite(firstSpacingTickX)
              ? Number((firstSpacingTickX - effectiveBoundary.effectiveStartX).toFixed(3))
              : null,
        trailingTailTicks:
          measureLayout && Number.isFinite(measureLayout.trailingTailTicks)
            ? Math.max(0, Math.round(measureLayout.trailingTailTicks as number))
            : timelineBundle && typeof lastSpacingTick === 'number' && Number.isFinite(lastSpacingTick)
              ? Math.max(0, Math.round(timelineBundle.measureTicks - lastSpacingTick))
              : null,
        trailingGapPx:
          measureLayout && Number.isFinite(measureLayout.trailingGapPx)
            ? Number((measureLayout.trailingGapPx as number).toFixed(3))
            : effectiveBoundary && typeof lastSpacingTickX === 'number' && Number.isFinite(lastSpacingTickX)
              ? Number((effectiveBoundary.effectiveEndX - lastSpacingTickX).toFixed(3))
              : null,
        spacingOccupiedLeftX:
          measureLayout && Number.isFinite(measureLayout.spacingOccupiedLeftX)
            ? Number((measureLayout.spacingOccupiedLeftX as number).toFixed(3))
            : null,
        spacingOccupiedRightX:
          measureLayout && Number.isFinite(measureLayout.spacingOccupiedRightX)
            ? Number((measureLayout.spacingOccupiedRightX as number).toFixed(3))
            : null,
        spacingAnchorGapFirstToLastPx:
          measureLayout && Number.isFinite(measureLayout.spacingAnchorGapFirstToLastPx)
            ? Number((measureLayout.spacingAnchorGapFirstToLastPx as number).toFixed(3))
            : null,
        timeAxisTicksPerBeat: TICKS_PER_BEAT,
        legacyOnsets: timelineBundle?.legacyOnsets ?? orderedOnsets,
        spacingAnchorTicks,
        spacingTickToX:
          timelineBundle?.spacingTickToX
            ? Object.fromEntries(
                [...timelineBundle.spacingTickToX.entries()].map(([tick, x]) => [
                  String(tick),
                  toRoundedNumber(x, 3),
                ]),
              )
            : {},
        spacingOnsetReserves:
          measureLayout?.spacingOnsetReserves?.map((entry) => ({
            onsetTicks: entry.onsetTicks,
            baseX: toRoundedNumber(entry.baseX, 3),
            finalX: toRoundedNumber(entry.finalX, 3),
            leftReservePx: toRoundedNumber(entry.leftReservePx, 3),
            rightReservePx: toRoundedNumber(entry.rightReservePx, 3),
            rawLeftReservePx: toRoundedNumber(entry.rawLeftReservePx, 3),
            rawRightReservePx: toRoundedNumber(entry.rawRightReservePx, 3),
            leftOccupiedInsetPx: toRoundedNumber(entry.leftOccupiedInsetPx, 3),
            rightOccupiedTailPx: toRoundedNumber(entry.rightOccupiedTailPx, 3),
            leadingTrebleRequestedExtraPx: toRoundedNumber(entry.leadingTrebleRequestedExtraPx, 3),
            leadingBassRequestedExtraPx: toRoundedNumber(entry.leadingBassRequestedExtraPx, 3),
            leadingWinningStaff: entry.leadingWinningStaff,
            trailingTrebleRequestedExtraPx: toRoundedNumber(entry.trailingTrebleRequestedExtraPx, 3),
            trailingBassRequestedExtraPx: toRoundedNumber(entry.trailingBassRequestedExtraPx, 3),
            trailingWinningStaff: entry.trailingWinningStaff,
          })) ?? [],
        spacingSegments:
          measureLayout?.spacingSegments?.map((entry) => ({
            fromOnsetTicks: entry.fromOnsetTicks,
            toOnsetTicks: entry.toOnsetTicks,
            baseGapPx: toRoundedNumber(entry.baseGapPx, 3),
            extraReservePx: toRoundedNumber(entry.extraReservePx, 3),
            appliedGapPx: toRoundedNumber(entry.appliedGapPx, 3),
            trebleRequestedExtraPx: toRoundedNumber(entry.trebleRequestedExtraPx, 3),
            bassRequestedExtraPx: toRoundedNumber(entry.bassRequestedExtraPx, 3),
            noteRestRequestedExtraPx: toRoundedNumber(entry.noteRestRequestedExtraPx, 3),
            noteRestVisibleGapPx:
              typeof entry.noteRestVisibleGapPx === 'number'
                ? toRoundedNumber(entry.noteRestVisibleGapPx, 3)
                : null,
            accidentalRequestedExtraPx: toRoundedNumber(entry.accidentalRequestedExtraPx, 3),
            accidentalVisibleGapPx:
              typeof entry.accidentalVisibleGapPx === 'number'
                ? toRoundedNumber(entry.accidentalVisibleGapPx, 3)
                : null,
            winningStaff: entry.winningStaff,
          })) ?? [],
        trebleTimelineEvents:
          timelineBundle?.trebleTimeline.events.map((event) => ({
            noteId: event.noteId,
            noteIndex: event.noteIndex,
            startTick: event.startTick,
            endTick: event.endTick,
            durationTicks: event.durationTicks,
            isRest: event.isRest,
          })) ?? [],
        bassTimelineEvents:
          timelineBundle?.bassTimeline.events.map((event) => ({
            noteId: event.noteId,
            noteIndex: event.noteIndex,
            startTick: event.startTick,
            endTick: event.endTick,
            durationTicks: event.durationTicks,
            isRest: event.isRest,
          })) ?? [],
        publicTimelineTicks: timelineBundle?.publicTimeline.points.map((point) => point.tick) ?? [],
        publicTickToX:
          timelineBundle?.publicAxisLayout
            ? Object.fromEntries(
                [...timelineBundle.publicAxisLayout.tickToX.entries()].map(([tick, x]) => [
                  String(tick),
                  toRoundedNumber(x, 3),
                ]),
              )
            : {},
        publicTimelineScale:
          timelineBundle?.publicAxisLayout && Number.isFinite(timelineBundle.publicAxisLayout.timelineScale)
            ? Number(timelineBundle.publicAxisLayout.timelineScale.toFixed(6))
            : null,
        publicTimelineTotalAnchorWeight:
          timelineBundle?.publicAxisLayout && Number.isFinite(timelineBundle.publicAxisLayout.totalAnchorWeight)
            ? Number(timelineBundle.publicAxisLayout.totalAnchorWeight.toFixed(6))
            : null,
        timelineDiffSummary: timelineBundle?.timelineDiffSummary ?? null,
        timeAxisPoints,
        maxVisualRightX,
        maxSpacingRightX,
        overflowVsNoteEndX:
          measureLayout && typeof maxSpacingRightX === 'number'
            ? Number((maxSpacingRightX - measureLayout.noteEndX).toFixed(3))
            : null,
        overflowVsMeasureEndBarX:
          measureLayout && typeof maxSpacingRightX === 'number'
            ? Number((maxSpacingRightX - (measureLayout.measureX + measureLayout.measureWidth)).toFixed(3))
            : null,
        notes: layoutRows,
      }
    })

    return {
      generatedAt: new Date().toISOString(),
      totalMeasureCount: pairs.length,
      renderedMeasureCount: rows.filter((row) => row.rendered).length,
      visibleSystemRange: { ...visibleSystemRange },
      rows,
    }
  }, [visibleSystemRange])

  useEffect(() => {
    return () => {
      if (firstMeasureDebugRafRef.current !== null) {
        window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      }
    }
  }, [])
  const debugApi = useMemo(() => ({
    importMusicXmlText: (xmlText: string) => {
      importMusicXmlTextWithCollapseReset(xmlText)
    },
    playScore: () => {
      void playScore()
    },
    getImportFeedback: () => importFeedbackRef.current,
    getScaleConfig: () => ({
      autoScaleEnabled,
      manualScalePercent: safeManualScalePercent,
      baseScoreScale,
      scoreScale,
      scoreScaleX,
      scoreScaleY,
      isHorizontalView: true,
      spacingLayoutMode,
    }),
    setAutoScaleEnabled: (enabled: boolean) => {
      setAutoScaleEnabled(Boolean(enabled))
    },
    getShowNoteHeadJianpuEnabled: () => showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled: (enabled: boolean) => {
      setShowNoteHeadJianpuEnabled(Boolean(enabled))
    },
    setManualScalePercent: (nextPercent: number) => {
      setManualScalePercent(clampScalePercent(nextPercent))
    },
    dumpAllMeasureCoordinates: () => dumpAllMeasureCoordinateReport(),
    getOsmdPreviewSystemMetrics: () => dumpOsmdPreviewSystemMetrics(),
    getOsmdPreviewRebalanceStats: () => osmdPreviewLastRebalanceStatsRef.current,
    getOsmdPreviewInstance: () => osmdPreviewInstanceRef.current,
    getDragPreviewFrames: () =>
      dragDebugFramesRef.current.map((frame) => ({
        ...frame,
        rows: frame.rows.map((row) => ({ ...row })),
      })),
    getNotePreviewEvents: () => notePreviewEventsRef.current.map((event) => ({ ...event })),
    clearNotePreviewEvents: () => {
      notePreviewEventsRef.current = []
    },
    getPlaybackCursorState: () => ({
      ...playbackCursorState,
      point: playbackCursorState.point ? { ...playbackCursorState.point } : null,
      rectPx: playbackCursorState.rectPx ? { ...playbackCursorState.rectPx } : null,
      status: playheadStatus,
      sessionId: playbackSessionId,
    }),
    getPlaybackCursorEvents: () => playbackCursorEventsRef.current.map((event) => ({
      ...event,
      point: event.point ? { ...event.point } : null,
    })),
    clearPlaybackCursorEvents: () => {
      playbackCursorEventsRef.current = []
    },
    getPlayheadDebugLogRows: () => playheadDebugLogRowsRef.current.map((row) => ({ ...row })),
    getPlayheadDebugViewportSnapshot: () =>
      measurePlayheadDebugLogRow(
        latestPlayheadDebugSnapshotRef.current?.seq ?? playheadDebugSequenceRef.current,
      ) ??
      (latestPlayheadDebugSnapshotRef.current ? { ...latestPlayheadDebugSnapshotRef.current } : null),
    applyChordSelectionRange: (pairIndex: number, startTick: number, endTick: number) => ({
      selectedCount: applyChordSelectionRange({
        pairIndex,
        startTick,
        endTick,
        markerKey: null,
      }).length,
    }),
    getSelectedSelections: () =>
      selectedSelectionsRef.current.map((selection) => {
        const matchedEntry = (() => {
          for (let pairIndex = 0; pairIndex < measurePairsRef.current.length; pairIndex += 1) {
            const pair = measurePairsRef.current[pairIndex]
            if (!pair) continue
            const staffNotes = selection.staff === 'treble' ? pair.treble : pair.bass
            const noteIndex = staffNotes.findIndex((note) => note.id === selection.noteId)
            if (noteIndex < 0) continue
            return {
              pairIndex,
              noteIndex,
              note: staffNotes[noteIndex] ?? null,
            }
          }
          return {
            pairIndex: null,
            noteIndex: null,
            note: null as ScoreNote | null,
          }
        })()
        return {
          ...selection,
          pairIndex: matchedEntry.pairIndex,
          noteIndex: matchedEntry.noteIndex,
          pitch: matchedEntry.note?.pitch ?? null,
          duration: matchedEntry.note?.duration ?? null,
          isRest: matchedEntry.note?.isRest === true,
        }
      }),
    getActiveChordSelection: () => (activeChordSelection ? { ...activeChordSelection } : null),
    getSelectedMeasureHighlightRect: () =>
      selectedMeasureHighlightRectPx ? { ...selectedMeasureHighlightRectPx } : null,
    getChordRulerMarkers: () =>
      [...chordRulerMarkerMetaByKey.values()].map((marker) => ({
        key: marker.key,
        pairIndex: marker.pairIndex,
        beatIndex: marker.beatIndex,
        label: marker.displayLabel,
        sourceLabel: marker.sourceLabel,
        displayLabel: marker.displayLabel,
        startTick: marker.startTick,
        endTick: marker.endTick,
        positionText: marker.positionText,
        anchorGlobalX: marker.anchorGlobalX,
        anchorXPx: marker.anchorXPx,
        xPx: marker.xPx,
        anchorSource: marker.anchorSource,
        keyFifths: marker.keyFifths,
        keyMode: marker.keyMode,
      })),
    getPlaybackTimelinePoints: () =>
      playbackTimelineEvents.map((event) => ({
        pairIndex: event.pairIndex,
        onsetTick: event.onsetTick,
        atSeconds: event.atSeconds,
        targetCount: event.targets.length,
      })),
    getDragSessionState: () => {
      const drag = dragRef.current
      if (!drag) return null
      return {
        noteId: drag.noteId,
        staff: drag.staff,
        keyIndex: drag.keyIndex,
        pairIndex: drag.pairIndex,
        noteIndex: drag.noteIndex,
        pitch: drag.pitch,
        previewStarted: drag.previewStarted,
        groupPreviewLeadTarget: drag.groupPreviewLeadTarget ? { ...drag.groupPreviewLeadTarget } : null,
        linkedTieTargets: drag.linkedTieTargets?.map((target) => ({ ...target })) ?? [],
        previousTieTarget: drag.previousTieTarget ? { ...drag.previousTieTarget } : null,
        previewFrozenBoundary: drag.previewFrozenBoundary
          ? {
              fromTarget: { ...drag.previewFrozenBoundary.fromTarget },
              toTarget: { ...drag.previewFrozenBoundary.toTarget },
              startX: drag.previewFrozenBoundary.startX,
              startY: drag.previewFrozenBoundary.startY,
              endX: drag.previewFrozenBoundary.endX,
              endY: drag.previewFrozenBoundary.endY,
              frozenPitch: drag.previewFrozenBoundary.frozenPitch,
            }
          : null,
      }
    },
    getTieStateSnapshot: () =>
      measurePairsRef.current.map((pair, pairIndex) => {
        const mapNote = (note: ScoreNote, noteIndex: number) => ({
          noteIndex,
          noteId: note.id,
          pitch: note.pitch,
          tieStart: Boolean(note.tieStart),
          tieStop: Boolean(note.tieStop),
          tieFrozenIncomingPitch: note.tieFrozenIncomingPitch ?? null,
          tieFrozenIncomingFromNoteId: note.tieFrozenIncomingFromNoteId ?? null,
          tieFrozenIncomingFromKeyIndex:
            typeof note.tieFrozenIncomingFromKeyIndex === 'number' && Number.isFinite(note.tieFrozenIncomingFromKeyIndex)
              ? Math.max(0, Math.trunc(note.tieFrozenIncomingFromKeyIndex))
              : null,
        })
        return {
          pairIndex,
          treble: pair.treble.map(mapNote),
          bass: pair.bass.map(mapNote),
        }
      }),
    getOverlayDebugInfo: () => {
      const overlay = scoreOverlayRef.current
      const surface = scoreRef.current
      if (!overlay || !surface) return null
      const overlayClientRect = overlay.getBoundingClientRect()
      const surfaceClientRect = surface.getBoundingClientRect()
      return {
        scoreScale,
        overlayRectInScore: overlayLastRectRef.current
          ? { ...overlayLastRectRef.current }
          : null,
        overlayElement: {
          width: overlay.width,
          height: overlay.height,
          styleLeft: overlay.style.left,
          styleTop: overlay.style.top,
          styleWidth: overlay.style.width,
          styleHeight: overlay.style.height,
          display: overlay.style.display,
        },
        overlayClientRect: {
          left: overlayClientRect.left,
          top: overlayClientRect.top,
          width: overlayClientRect.width,
          height: overlayClientRect.height,
        },
        surfaceElement: {
          width: surface.width,
          height: surface.height,
        },
        surfaceClientRect: {
          left: surfaceClientRect.left,
          top: surfaceClientRect.top,
          width: surfaceClientRect.width,
          height: surfaceClientRect.height,
        },
      }
    },
    getPaging: () => ({
      currentPage: safeCurrentPage,
      pageCount,
      systemsPerPage,
      visibleSystemRange: { ...visibleSystemRange },
    }),
    getActiveSelection: () => ({ ...activeSelection }),
    getOsmdPreviewSelectedSelectionKey: () => osmdPreviewSelectedSelectionKeyRef.current,
    getOsmdPreviewNoteTargets: () =>
      [...osmdPreviewNoteLookupBySelectionRef.current.values()].map((target) => ({
        pairIndex: target.pairIndex,
        measureNumber: target.measureNumber,
        onsetTicks: target.onsetTicks,
        domIds: [...target.domIds],
        selection: { ...target.selection },
      })),
  }), [
    activeChordSelection,
    activeSelection,
    applyChordSelectionRange,
    autoScaleEnabled,
    baseScoreScale,
    chordRulerMarkerMetaByKey,
    dumpAllMeasureCoordinateReport,
    dumpOsmdPreviewSystemMetrics,
    importMusicXmlTextWithCollapseReset,
    measurePlayheadDebugLogRow,
    notePreviewEventsRef,
    osmdPreviewLastRebalanceStatsRef,
    osmdPreviewSelectedSelectionKeyRef,
    osmdPreviewNoteLookupBySelectionRef,
    osmdPreviewInstanceRef,
    overlayLastRectRef,
    pageCount,
    playbackCursorEventsRef,
    playbackCursorState,
    playbackSessionId,
    playbackTimelineEvents,
    playheadStatus,
    playheadDebugLogRowsRef,
    playheadDebugSequenceRef,
    latestPlayheadDebugSnapshotRef,
    playScore,
    safeCurrentPage,
    safeManualScalePercent,
    scoreOverlayRef,
    scoreRef,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    selectedMeasureHighlightRectPx,
    showNoteHeadJianpuEnabled,
    spacingLayoutMode,
    systemsPerPage,
    visibleSystemRange,
  ])
  useScoreDebugApi({
    enabled: import.meta.env.DEV,
    debugApi,
  })

  const scoreControlsProps = useMemo(() => ({
    isPlaying,
    onPlayScore: playScore,
    onStopScore: stopActivePlaybackSession,
    onReset: resetScoreWithCollapseReset,
    playheadFollowEnabled,
    onTogglePlayheadFollow: () => setPlayheadFollowEnabled((enabled) => !enabled),
    showChordDegreeEnabled,
    onToggleChordDegreeDisplay: () => setShowChordDegreeEnabled((enabled) => !enabled),
    showInScoreMeasureNumbers,
    onToggleInScoreMeasureNumbers: () => setShowInScoreMeasureNumbers((current) => !current),
    showNoteHeadJianpuEnabled,
    onToggleNoteHeadJianpuDisplay: () => setShowNoteHeadJianpuEnabled((current) => !current),
    autoScaleEnabled,
    autoScalePercent,
    onToggleAutoScale: () => setAutoScaleEnabled((enabled) => !enabled),
    manualScalePercent: safeManualScalePercent,
    onManualScalePercentChange: (nextPercent: number) => setManualScalePercent(clampScalePercent(nextPercent)),
    canvasHeightPercent: safeCanvasHeightPercent,
    onCanvasHeightPercentChange: (nextPercent: number) => setCanvasHeightPercent(clampCanvasHeightPercent(nextPercent)),
    pageHorizontalPaddingPx,
    chordMarkerUiScalePercent: safeChordMarkerUiScalePercent,
    chordMarkerPaddingPx: safeChordMarkerPaddingPx,
    baseMinGap32Px: timeAxisSpacingConfig.baseMinGap32Px,
    leadingBarlineGapPx: timeAxisSpacingConfig.leadingBarlineGapPx,
    secondChordSafeGapPx: timeAxisSpacingConfig.secondChordSafeGapPx,
    durationGapRatio32: timeAxisSpacingConfig.durationGapRatios.thirtySecond,
    durationGapRatio16: timeAxisSpacingConfig.durationGapRatios.sixteenth,
    durationGapRatio8: timeAxisSpacingConfig.durationGapRatios.eighth,
    durationGapRatio4: timeAxisSpacingConfig.durationGapRatios.quarter,
    durationGapRatio2: timeAxisSpacingConfig.durationGapRatios.half,
    durationGapRatioWhole: timeAxisSpacingConfig.durationGapRatios.whole,
    onPageHorizontalPaddingPxChange: (nextValue: number) =>
      setPageHorizontalPaddingPx(clampPageHorizontalPaddingPx(nextValue)),
    onChordMarkerUiScalePercentChange: (nextValue: number) =>
      setChordMarkerUiScalePercent(clampChordMarkerUiScalePercent(nextValue)),
    onChordMarkerPaddingPxChange: (nextValue: number) =>
      setChordMarkerPaddingPx(clampChordMarkerPaddingPx(nextValue)),
    onBaseMinGap32PxChange: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        baseMinGap32Px: clampBaseMinGap32Px(nextValue),
      })),
    onLeadingBarlineGapPxChange: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        leadingBarlineGapPx: clampLeadingBarlineGapPx(nextValue),
      })),
    onSecondChordSafeGapPxChange: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        secondChordSafeGapPx: clampSecondChordSafeGapPx(nextValue),
      })),
    onDurationGapRatio32Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          thirtySecond: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatio16Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          sixteenth: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatio8Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          eighth: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatio4Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          quarter: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatio2Change: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          half: clampDurationGapRatio(nextValue),
        },
      })),
    onDurationGapRatioWholeChange: (nextValue: number) =>
      setTimeAxisSpacingConfig((current) => ({
        ...current,
        durationGapRatios: {
          ...current.durationGapRatios,
          whole: clampDurationGapRatio(nextValue),
        },
      })),
    onResetSpacingConfig: () => {
      setTimeAxisSpacingConfig({
        ...DEFAULT_TIME_AXIS_SPACING_CONFIG,
        durationGapRatios: { ...DEFAULT_TIME_AXIS_SPACING_CONFIG.durationGapRatios },
      })
      setPageHorizontalPaddingPx(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
      setChordMarkerUiScalePercent(DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT)
      setChordMarkerPaddingPx(DEFAULT_CHORD_MARKER_PADDING_PX)
    },
    onOpenMusicXmlFilePicker: openMusicXmlFilePicker,
    onLoadSampleMusicXml: loadSampleMusicXmlWithCollapseReset,
    onLoadWholeNoteDemo: loadWholeNoteDemoWithCollapseReset,
    onLoadHalfNoteDemo: loadHalfNoteDemoWithCollapseReset,
    onExportMusicXmlFile: exportMusicXmlFile,
    onOpenOsmdPreview: openOsmdPreview,
    onOpenBeamGroupingTool: openBeamGroupingTool,
    isNotationPaletteOpen,
    onToggleNotationPalette: toggleNotationPalette,
    onCloseNotationPalette: closeNotationPalette,
    notationPaletteSelection,
    notationPaletteLastAction,
    notationPaletteActiveItemIdsOverride: derivedNotationPaletteDisplay?.activeItemIds ?? null,
    notationPaletteSummaryOverride: derivedNotationPaletteDisplay?.summary ?? null,
    onNotationPaletteSelectionChange,
    onOpenDirectOsmdFilePicker: openDirectOsmdFilePicker,
    onImportMusicXmlFromTextarea: importMusicXmlFromTextareaWithCollapseReset,
    midiSupported,
    midiPermissionState,
    midiInputOptions,
    selectedMidiInputId,
    onSelectedMidiInputIdChange: setSelectedMidiInputId,
    fileInputRef,
    osmdDirectFileInputRef,
    onMusicXmlFileChange: onMusicXmlFileChangeWithCollapseReset,
    onOsmdDirectFileChange,
    importFeedback,
    rhythmPreset,
    activeBuiltInDemo,
    onApplyRhythmPreset: applyRhythmPresetWithCollapseReset,
  }), [
    activeBuiltInDemo,
    autoScaleEnabled,
    autoScalePercent,
    closeNotationPalette,
    derivedNotationPaletteDisplay,
    exportMusicXmlFile,
    fileInputRef,
    importFeedback,
    importMusicXmlFromTextareaWithCollapseReset,
    isNotationPaletteOpen,
    isPlaying,
    loadHalfNoteDemoWithCollapseReset,
    loadSampleMusicXmlWithCollapseReset,
    loadWholeNoteDemoWithCollapseReset,
    midiInputOptions,
    midiPermissionState,
    midiSupported,
    notationPaletteLastAction,
    notationPaletteSelection,
    onMusicXmlFileChangeWithCollapseReset,
    onNotationPaletteSelectionChange,
    onOsmdDirectFileChange,
    openBeamGroupingTool,
    openDirectOsmdFilePicker,
    openMusicXmlFilePicker,
    openOsmdPreview,
    osmdDirectFileInputRef,
    pageHorizontalPaddingPx,
    playScore,
    playheadFollowEnabled,
    resetScoreWithCollapseReset,
    rhythmPreset,
    safeCanvasHeightPercent,
    safeChordMarkerPaddingPx,
    safeChordMarkerUiScalePercent,
    safeManualScalePercent,
    selectedMidiInputId,
    showChordDegreeEnabled,
    showInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    stopActivePlaybackSession,
    timeAxisSpacingConfig,
    toggleNotationPalette,
    applyRhythmPresetWithCollapseReset,
  ])

  const scoreBoardProps = useMemo(() => ({
    scoreScrollRef,
    scoreStageRef,
    playheadRef: playheadElementRef,
    displayScoreWidth,
    displayScoreHeight,
    chordMarkerStyleMetrics,
    scoreSurfaceLogicalWidthPx: scoreWidth,
    scoreSurfaceLogicalHeightPx: scoreHeight,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx: scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx: scoreSurfaceOffsetYPx,
    measureRulerTicks,
    chordRulerMarkers,
    onChordRulerMarkerClick,
    playheadRectPx,
    playheadStatus,
    selectedMeasureHighlightRectPx,
    draggingSelection,
    scoreRef,
    scoreOverlayRef,
    onBeginDrag: onBeginDragWithFirstMeasureDebug,
    onSurfacePointerMove,
    onEndDrag: onEndDragWithFirstMeasureDebug,
    selectedStaffLabel: activeSelection.staff === 'treble' ? '高音谱表' : '低音谱表',
    selectedPitchLabel: currentSelectionPitchLabel,
    selectedDurationLabel: toDisplayDuration(currentSelection.duration),
    selectedPosition: currentSelectionPosition,
    selectedPoolSize: activePool.length,
    trebleSequenceText,
    bassSequenceText,
    playheadDebugLogText,
  }), [
    activePool.length,
    activeSelection.staff,
    bassSequenceText,
    chordMarkerStyleMetrics,
    chordRulerMarkers,
    currentSelection.duration,
    currentSelectionPitchLabel,
    currentSelectionPosition,
    displayScoreHeight,
    displayScoreWidth,
    draggingSelection,
    measureRulerTicks,
    onBeginDragWithFirstMeasureDebug,
    onChordRulerMarkerClick,
    onEndDragWithFirstMeasureDebug,
    onSurfacePointerMove,
    playheadDebugLogText,
    playheadElementRef,
    playheadRectPx,
    playheadStatus,
    scoreHeight,
    scoreOverlayRef,
    scoreRef,
    scoreScrollRef,
    scoreScaleX,
    scoreScaleY,
    scoreStageRef,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    scoreWidth,
    selectedMeasureHighlightRectPx,
    trebleSequenceText,
  ])

  return (
    <main className="app-shell">
      <ScoreControls {...scoreControlsProps} />

      <ScoreBoard {...scoreBoardProps} />

      {isImportLoading && (
        <div className="import-modal" role="status" aria-live="polite" aria-label="导入进行中">
          <div className="import-modal-card">
            <h3>正在加载乐谱</h3>
            <p>{importFeedback.message}</p>
            <div className="import-modal-track">
              <div
                className="import-modal-bar"
                style={{ width: `${importProgressPercent === null ? 45 : Math.max(4, importProgressPercent)}%` }}
              />
            </div>
            <p className="import-modal-percent">
              {importProgressPercent === null ? '处理中...' : `${importProgressPercent}%`}
            </p>
          </div>
        </div>
      )}

      {isOsmdPreviewOpen && (
        <div className="osmd-preview-modal" role="dialog" aria-modal="true" aria-label="OSMD预览" onClick={closeOsmdPreview}>
          <div className="osmd-preview-card" onClick={(event) => event.stopPropagation()}>
            <div className="osmd-preview-header">
              <h3>OSMD预览</h3>
              <div className="osmd-preview-header-actions">
                <button
                  type="button"
                  onClick={exportOsmdPreviewPdf}
                  disabled={isOsmdPreviewExportingPdf}
                >
                  {isOsmdPreviewExportingPdf ? '导出中...' : '导出PDF'}
                </button>
                <button type="button" onClick={closeOsmdPreview} disabled={isOsmdPreviewExportingPdf}>关闭</button>
              </div>
            </div>
            <div className="osmd-preview-side">
              <div className="osmd-preview-pagination">
                <button type="button" onClick={goToPrevOsmdPreviewPage} disabled={osmdPreviewPageIndex <= 0}>
                  上一页
                </button>
                <span>{`${Math.min(osmdPreviewPageCount, osmdPreviewPageIndex + 1)} / ${osmdPreviewPageCount}`}</span>
                <button
                  type="button"
                  onClick={goToNextOsmdPreviewPage}
                  disabled={osmdPreviewPageIndex >= osmdPreviewPageCount - 1}
                >
                  下一页
                </button>
              </div>
              <div className="osmd-preview-toggle">
                <label htmlFor="osmd-preview-page-number-toggle">页码</label>
                <input
                  id="osmd-preview-page-number-toggle"
                  type="checkbox"
                  checked={osmdPreviewShowPageNumbers}
                  onChange={(event) => onOsmdPreviewShowPageNumbersChange(event.target.checked)}
                />
                <span>{osmdPreviewShowPageNumbers ? '显示' : '隐藏'}</span>
              </div>
            <div className="osmd-preview-zoom">
              <label htmlFor="osmd-preview-zoom-range">音符缩放</label>
              <input
                id="osmd-preview-zoom-range"
                type="range"
                min={35}
                max={160}
                step={1}
                value={osmdPreviewZoomDraftPercent}
                onInput={(event) =>
                  scheduleOsmdPreviewZoomPercentCommit(Number((event.target as HTMLInputElement).value))
                }
                onPointerUp={(event) => commitOsmdPreviewZoomPercent(Number((event.target as HTMLInputElement).value))}
                onKeyUp={(event) => {
                  if (event.key !== 'Enter') return
                  commitOsmdPreviewZoomPercent(Number((event.target as HTMLInputElement).value))
                }}
              />
              <input
                type="number"
                min={35}
                max={160}
                step={1}
                value={osmdPreviewZoomDraftPercent}
                onInput={(event) =>
                  scheduleOsmdPreviewZoomPercentCommit(Number((event.target as HTMLInputElement).value))
                }
                onBlur={(event) => commitOsmdPreviewZoomPercent(Number((event.target as HTMLInputElement).value))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  commitOsmdPreviewZoomPercent(Number((event.target as HTMLInputElement).value))
                }}
              />
              <span>%</span>
            </div>
            <div className="osmd-preview-zoom">
              <label htmlFor="osmd-preview-paper-scale-range">纸张缩放</label>
              <input
                id="osmd-preview-paper-scale-range"
                type="range"
                min={50}
                max={180}
                step={1}
                value={safeOsmdPreviewPaperScalePercent}
                onInput={(event) =>
                  onOsmdPreviewPaperScalePercentChange(Number((event.target as HTMLInputElement).value))
                }
                onChange={(event) => onOsmdPreviewPaperScalePercentChange(Number(event.target.value))}
              />
              <input
                type="number"
                min={50}
                max={180}
                step={1}
                value={safeOsmdPreviewPaperScalePercent}
                onInput={(event) =>
                  onOsmdPreviewPaperScalePercentChange(Number((event.target as HTMLInputElement).value))
                }
                onChange={(event) => onOsmdPreviewPaperScalePercentChange(Number(event.target.value))}
              />
              <span>%</span>
            </div>
            <div className="osmd-preview-zoom">
              <label htmlFor="osmd-preview-horizontal-margin-range">左右边距</label>
              <input
                id="osmd-preview-horizontal-margin-range"
                type="range"
                min={0}
                max={120}
                step={1}
                value={safeOsmdPreviewHorizontalMarginPx}
                onInput={(event) =>
                  onOsmdPreviewHorizontalMarginPxChange(Number((event.target as HTMLInputElement).value))
                }
                onChange={(event) => onOsmdPreviewHorizontalMarginPxChange(Number(event.target.value))}
              />
              <input
                type="number"
                min={0}
                max={120}
                step={1}
                value={safeOsmdPreviewHorizontalMarginPx}
                onInput={(event) =>
                  onOsmdPreviewHorizontalMarginPxChange(Number((event.target as HTMLInputElement).value))
                }
                onChange={(event) => onOsmdPreviewHorizontalMarginPxChange(Number(event.target.value))}
              />
              <span>px</span>
            </div>
            <div className="osmd-preview-zoom">
              <label htmlFor="osmd-preview-first-top-margin-range">首页顶部</label>
              <input
                id="osmd-preview-first-top-margin-range"
                type="range"
                min={0}
                max={180}
                step={1}
                value={safeOsmdPreviewFirstPageTopMarginPx}
                onInput={(event) =>
                  onOsmdPreviewFirstPageTopMarginPxChange(Number((event.target as HTMLInputElement).value))
                }
                onChange={(event) => onOsmdPreviewFirstPageTopMarginPxChange(Number(event.target.value))}
              />
              <input
                type="number"
                min={0}
                max={180}
                step={1}
                value={safeOsmdPreviewFirstPageTopMarginPx}
                onInput={(event) =>
                  onOsmdPreviewFirstPageTopMarginPxChange(Number((event.target as HTMLInputElement).value))
                }
                onChange={(event) => onOsmdPreviewFirstPageTopMarginPxChange(Number(event.target.value))}
              />
              <span>px</span>
            </div>
            <div className="osmd-preview-zoom">
              <label htmlFor="osmd-preview-top-margin-range">后续页顶部</label>
              <input
                id="osmd-preview-top-margin-range"
                type="range"
                min={0}
                max={180}
                step={1}
                value={safeOsmdPreviewTopMarginPx}
                onInput={(event) =>
                  onOsmdPreviewTopMarginPxChange(Number((event.target as HTMLInputElement).value))
                }
                onChange={(event) => onOsmdPreviewTopMarginPxChange(Number(event.target.value))}
              />
              <input
                type="number"
                min={0}
                max={180}
                step={1}
                value={safeOsmdPreviewTopMarginPx}
                onInput={(event) =>
                  onOsmdPreviewTopMarginPxChange(Number((event.target as HTMLInputElement).value))
                }
                onChange={(event) => onOsmdPreviewTopMarginPxChange(Number(event.target.value))}
              />
              <span>px</span>
            </div>
              <div className="osmd-preview-zoom">
                <label htmlFor="osmd-preview-bottom-margin-range">底部边距</label>
                <input
                  id="osmd-preview-bottom-margin-range"
                  type="range"
                  min={0}
                  max={180}
                  step={1}
                  value={safeOsmdPreviewBottomMarginPx}
                  onInput={(event) =>
                    onOsmdPreviewBottomMarginPxChange(Number((event.target as HTMLInputElement).value))
                  }
                  onChange={(event) => onOsmdPreviewBottomMarginPxChange(Number(event.target.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={180}
                  step={1}
                  value={safeOsmdPreviewBottomMarginPx}
                  onInput={(event) =>
                    onOsmdPreviewBottomMarginPxChange(Number((event.target as HTMLInputElement).value))
                  }
                  onChange={(event) => onOsmdPreviewBottomMarginPxChange(Number(event.target.value))}
                />
                <span>px</span>
              </div>
              {osmdPreviewStatusText && <p className="osmd-preview-status">{osmdPreviewStatusText}</p>}
              {osmdPreviewError && <p className="osmd-preview-error">{osmdPreviewError}</p>}
            </div>
            <div className="osmd-preview-body osmd-preview-main-body">
              <div
                className="osmd-preview-paper-frame"
                style={{
                  width: `${osmdPreviewPaperWidthPx}px`,
                  height: `${osmdPreviewPaperHeightPx}px`,
                }}
              >
                <div
                  ref={osmdPreviewContainerRef}
                  className="osmd-preview-surface"
                  onClick={onOsmdPreviewSurfaceClick}
                  onDoubleClick={onOsmdPreviewSurfaceDoubleClick}
                  style={{
                    width: `${A4_PAGE_WIDTH}px`,
                    height: `${A4_PAGE_HEIGHT}px`,
                    transform: `scale(${osmdPreviewPaperScale})`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App


