import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
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
import { getLayoutNoteKey } from './score/layout/renderPosition'
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
import { stopPlaybackAction } from './score/editorActions'
import { useEditorHandlers } from './score/editorHandlers'
import { buildMusicXmlExportPayload } from './score/musicXmlActions'
import { buildPlaybackTimeline, type PlaybackTimelineEvent } from './score/playbackTimeline'
import {
  previewScoreNote,
  resolveScoreNotePreviewPitch,
  type ScoreNotePreviewMode,
} from './score/notePreview'
import {
  useImportedRefsSync,
  useRendererCleanup,
  useRhythmLinkedBassSync,
  useScoreRenderEffect,
  useSynthLifecycle,
} from './score/hooks/useScoreEffects'
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
import { applyPaletteDurationEdit, type DurationEditFailureReason } from './score/durationEdits'
import {
  applyDeleteAccidentalSelection,
  applyPaletteAccidentalEdit,
  type AccidentalEditFailureReason,
} from './score/accidentalEdits'
import { applyDeleteTieSelection, type TieDeleteFailureReason } from './score/tieEdits'
import { applyMidiStepInput, type MidiStepInputMode } from './score/midiStepEdits'
import { applyDeleteMeasureSelection, type MeasureDeleteFailureReason } from './score/measureEdits'
import { isStaffFullMeasureRest, resolvePairTimeSignature } from './score/measureRestUtils'
import { appendIntervalKey, deleteSelectedKey, findSelectionLocationInPairs } from './score/keyboardEdits'
import { applyClipboardPaste, buildClipboardFromSelections, type CopyPasteFailureReason } from './score/copyPasteEdits'
import { getMidiNoteNumber, toPitchFromMidiWithKeyPreference } from './score/midiInput'
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
const PLAYHEAD_HORIZONTAL_SCROLL_TRIGGER_MARGIN_PX = 24
const PLAYHEAD_HORIZONTAL_SCROLL_LEFT_ANCHOR_PX = 72
const PLAYHEAD_VIEWPORT_MARGIN_Y_PX = 24
const ENABLE_AUTO_FIRST_MEASURE_DRAG_DEBUG = false
const HORIZONTAL_VIEW_MEASURE_WIDTH_PX = 220
const HORIZONTAL_VIEW_HEIGHT_PX = SCORE_TOP_PADDING * 2 + SYSTEM_HEIGHT + 26
const MAX_CANVAS_RENDER_DIM_PX = 32760
const HORIZONTAL_RENDER_BUFFER_PX = 400
const HORIZONTAL_RENDER_EDGE_BUFFER_MEASURES = 1
const OSMD_PREVIEW_ZOOM_DEBOUNCE_MS = 120
const DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX = 9
const DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX = 23
const DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX = 10
const DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX = 10
const OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX = DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX
const OSMD_PREVIEW_SPARSE_SYSTEM_COUNT = 4
const OSMD_PREVIEW_MIN_SYSTEM_GAP_PX = 1
const OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT = 2
const OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS = 0.01
const OSMD_PREVIEW_REPAGINATION_MAX_ATTEMPTS = 12
const OSMD_PREVIEW_REPAGINATION_MIN_STEP_PX = 2
const OSMD_PREVIEW_REPAGINATION_MAX_STEP_PX = 64
const OSMD_PREVIEW_MARGIN_APPLY_DEBOUNCE_MS = 90
const OSMD_PREVIEW_FAST_STAGE_MEASURE_LIMIT = 12
const PDF_CJK_FONT_FAMILY = 'NotoSansSC'
const PDF_CJK_FONT_FILE_NAME = 'NotoSansSC-Regular.ttf'
const PDF_CJK_FONT_URL = new URL('./assets/fonts/NotoSansSC-Regular.ttf', import.meta.url).href
const UNDO_HISTORY_LIMIT = 120
const LOCAL_STORAGE_MIDI_INPUT_KEY = 'score.midi.selectedInputId'
const LOCAL_STORAGE_EDITOR_MEASURE_NUMBER_KEY = 'score.editor.showInScoreMeasureNumbers'
const LOCAL_STORAGE_NOTEHEAD_JIANPU_DISPLAY_KEY = 'score.editor.showNoteHeadJianpu'
const LOCAL_STORAGE_PLAYHEAD_FOLLOW_KEY = 'score.playhead.followEnabled'
const LOCAL_STORAGE_CHORD_DEGREE_DISPLAY_KEY = 'score.chordDegree.enabled'
const CHORD_HIGHLIGHT_PAD_X_PX = 4
const CHORD_HIGHLIGHT_PAD_Y_PX = 4

const PITCHES: Pitch[] = createPianoPitches()
const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)
let cachedPdfCjkFontBinary: string | null = null
let cachedPdfCjkFontLoadPromise: Promise<string> | null = null

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

function getDurationEditFailureMessage(reason: DurationEditFailureReason): string {
  switch (reason) {
    case 'no-selection':
      return '未选中可编辑音符'
    case 'multi-note-block':
      return '当前多选范围不支持改时值'
    case 'selection-not-found':
      return '未选中可编辑音符'
    case 'insufficient-ticks':
      return '当前小节剩余时值不足，无法修改为该时值'
    case 'unsupported-dot':
      return '当前时值暂不支持附点修改'
    case 'unsupported-grouping':
      return '当前节奏无法在不跨拍规则下重组'
    default:
      return '当前操作暂不支持'
  }
}

function getCopyPasteFailureMessage(reason: CopyPasteFailureReason): string {
  switch (reason) {
    case 'no-selection':
      return '未选中可复制/粘贴的音符'
    case 'multi-timepoint':
    case 'multi-note-block':
      return '当前仅支持同一时间点复制'
    case 'selection-not-found':
      return '未选中可复制/粘贴的音符'
    case 'rest-source':
      return '暂不支持复制休止符'
    case 'clipboard-empty':
      return '剪贴板为空'
    case 'insufficient-ticks':
      return '后续时值不足，无法粘贴该时值'
    case 'unsupported-dot':
      return '当前时值暂不支持附点修改'
    case 'unsupported-grouping':
      return '当前节奏无法在不跨拍规则下重组'
    default:
      return '复制粘贴暂不支持当前操作'
  }
}

function getAccidentalEditFailureMessage(reason: AccidentalEditFailureReason): string {
  switch (reason) {
    case 'no-selection':
      return '未选中可编辑音符'
    case 'selection-not-found':
      return '未找到可编辑目标'
    case 'no-editable-note':
      return '当前目标是休止符，无法添加变音记号'
    case 'no-op':
      return '当前音符已是该变音'
    case 'conflict':
      return '多选目标冲突，未执行修改'
    default:
      return '当前操作暂不支持'
  }
}

function getDeleteAccidentalFailureMessage(reason: AccidentalEditFailureReason): string {
  switch (reason) {
    case 'no-selection':
      return '未选中可删除的变音记号'
    case 'selection-not-found':
      return '未找到目标变音记号'
    case 'no-editable-note':
      return '当前目标不可编辑'
    case 'no-op':
      return '当前变音记号已不存在'
    case 'conflict':
      return '目标冲突，未执行删除'
    default:
      return '当前操作暂不支持'
  }
}

function getDeleteTieFailureMessage(reason: TieDeleteFailureReason): string {
  switch (reason) {
    case 'selection-not-found':
      return '未找到目标延音线'
    case 'no-op':
      return '当前延音线已不存在'
    default:
      return '当前操作暂不支持'
  }
}

function getDeleteMeasureFailureMessage(reason: MeasureDeleteFailureReason): string {
  switch (reason) {
    case 'selection-not-found':
      return '未找到可删除的小节'
    case 'invalid-scope':
      return '当前未选中小节范围'
    case 'unsupported-grouping':
      return '当前拍号下无法生成满小节休止'
    default:
      return '当前操作暂不支持'
  }
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

function clampPageHorizontalPaddingPx(value: number): number {
  return Math.round(clampNumber(value, 8, 120))
}

function clampOsmdPreviewZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(35, Math.min(160, Math.round(value)))
}

function clampOsmdPreviewPaperScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(50, Math.min(180, Math.round(value)))
}

function clampOsmdPreviewHorizontalMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX
  return Math.max(0, Math.min(120, Math.round(value)))
}

function clampOsmdPreviewTopMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX
  return Math.max(0, Math.min(180, Math.round(value)))
}

function clampOsmdPreviewBottomMarginPx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX
  return Math.max(0, Math.min(180, Math.round(value)))
}

function sanitizeMusicXmlForOsmdPreview(xmlText: string, measurePairs: MeasurePair[]): string {
  const source = xmlText.trim()
  if (!source) return xmlText
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(source, 'application/xml')
    const parseError = doc.querySelector('parsererror')
    if (parseError) return xmlText

    const partElement = doc.getElementsByTagName('part')[0]
    if (!partElement) return xmlText

    const toNoteKey = (noteId: string, keyIndex: number): string => `${noteId}:${keyIndex}`

    const getDirectChildElements = (parent: Element, tagName: string): Element[] =>
      Array.from(parent.children).filter((child): child is Element => child.tagName === tagName)

    const getStaffNumber = (noteElement: Element): number => {
      const staffElement = getDirectChildElements(noteElement, 'staff')[0]
      if (!staffElement) return 1
      const value = Number.parseInt(staffElement.textContent ?? '1', 10)
      if (!Number.isFinite(value)) return 1
      return value
    }

    const noteElementByKey = new Map<string, Element>()
    const measureElements = Array.from(partElement.getElementsByTagName('measure'))
    const measureCount = Math.min(measureElements.length, measurePairs.length)
    for (let pairIndex = 0; pairIndex < measureCount; pairIndex += 1) {
      const pair = measurePairs[pairIndex]
      const measureElement = measureElements[pairIndex]
      if (!pair || !measureElement) continue
      const measureNotes = getDirectChildElements(measureElement, 'note')
      const trebleElements = measureNotes.filter((noteElement) => getStaffNumber(noteElement) === 1)
      const bassElements = measureNotes.filter((noteElement) => getStaffNumber(noteElement) === 2)

      const assignStaffElements = (staffNotes: ScoreNote[], staffElements: Element[]) => {
        let cursor = 0
        staffNotes.forEach((staffNote) => {
          const keyCount = 1 + (staffNote.chordPitches?.length ?? 0)
          for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
            const noteElement = staffElements[cursor]
            cursor += 1
            if (!noteElement) return
            noteElementByKey.set(toNoteKey(staffNote.id, keyIndex), noteElement)
          }
        })
      }

      assignStaffElements(pair.treble, trebleElements)
      assignStaffElements(pair.bass, bassElements)
    }

    const removeTieByType = (noteElement: Element, tieType: 'start' | 'stop'): boolean => {
      let removed = false
      getDirectChildElements(noteElement, 'tie').forEach((tieElement) => {
        const type = tieElement.getAttribute('type')?.trim().toLowerCase()
        if (type !== tieType) return
        noteElement.removeChild(tieElement)
        removed = true
      })
      return removed
    }

    const removeNotationByType = (
      noteElement: Element,
      tagName: 'tied' | 'slur',
      type: 'start' | 'stop',
    ): boolean => {
      let removed = false
      getDirectChildElements(noteElement, 'notations').forEach((notationsElement) => {
        Array.from(notationsElement.children).forEach((child) => {
          if (child.tagName !== tagName) return
          const childType = child.getAttribute('type')?.trim().toLowerCase()
          if (childType !== type) return
          notationsElement.removeChild(child)
          removed = true
        })
      })
      return removed
    }

    const appendTie = (noteElement: Element, tieType: 'start' | 'stop'): boolean => {
      const exists = getDirectChildElements(noteElement, 'tie').some((tieElement) => {
        const type = tieElement.getAttribute('type')?.trim().toLowerCase()
        return type === tieType
      })
      if (exists) return false
      const tieElement = doc.createElement('tie')
      tieElement.setAttribute('type', tieType)
      noteElement.appendChild(tieElement)
      return true
    }

    const removeTieFrozenNotation = (noteElement: Element): boolean => {
      let removed = false
      getDirectChildElements(noteElement, 'notations').forEach((notationsElement) => {
        Array.from(notationsElement.children).forEach((child) => {
          if (child.tagName !== 'other-notation') return
          const notationType = child.getAttribute('type')?.trim().toLowerCase() ?? ''
          if (!notationType.startsWith('tie-frozen-in')) return
          notationsElement.removeChild(child)
          removed = true
        })
      })
      return removed
    }

    const ensureNotationsElement = (noteElement: Element): Element => {
      const existing = getDirectChildElements(noteElement, 'notations')[0]
      if (existing) return existing
      const next = doc.createElement('notations')
      noteElement.appendChild(next)
      return next
    }

    const appendTied = (
      noteElement: Element,
      type: 'start' | 'stop',
    ): boolean => {
      const notationsElement = ensureNotationsElement(noteElement)
      const exists = Array.from(notationsElement.children).some((child) => {
        if (child.tagName !== 'tied') return false
        const childType = child.getAttribute('type')?.trim().toLowerCase()
        return childType === type
      })
      if (exists) return false
      const tied = doc.createElement('tied')
      tied.setAttribute('type', type)
      notationsElement.appendChild(tied)
      return true
    }

    const setPitchOnNoteElement = (noteElement: Element, pitch: Pitch): boolean => {
      const restElements = getDirectChildElements(noteElement, 'rest')
      let changed = false
      restElements.forEach((restElement) => {
        noteElement.removeChild(restElement)
        changed = true
      })

      let pitchElement = getDirectChildElements(noteElement, 'pitch')[0]
      if (!pitchElement) {
        pitchElement = doc.createElement('pitch')
        const firstElementChild = noteElement.firstElementChild
        if (firstElementChild) {
          noteElement.insertBefore(pitchElement, firstElementChild.nextSibling)
        } else {
          noteElement.appendChild(pitchElement)
        }
        changed = true
      }
      while (pitchElement.firstChild) {
        pitchElement.removeChild(pitchElement.firstChild)
      }
      const { step, alter, octave } = getStepOctaveAlterFromPitch(pitch)
      const stepElement = doc.createElement('step')
      stepElement.textContent = step
      pitchElement.appendChild(stepElement)
      if (alter !== 0) {
        const alterElement = doc.createElement('alter')
        alterElement.textContent = String(alter)
        pitchElement.appendChild(alterElement)
      }
      const octaveElement = doc.createElement('octave')
      octaveElement.textContent = String(octave)
      pitchElement.appendChild(octaveElement)
      return changed
    }

    const createFrozenTieStopAnchor = (targetElement: Element, frozenPitch: Pitch): Element | null => {
      const hiddenAnchor = targetElement.cloneNode(true)
      if (!(hiddenAnchor instanceof Element)) return null
      hiddenAnchor.setAttribute('print-object', 'no')

      if (!getDirectChildElements(hiddenAnchor, 'chord')[0]) {
        const chordElement = doc.createElement('chord')
        hiddenAnchor.insertBefore(chordElement, hiddenAnchor.firstChild)
      }

      getDirectChildElements(hiddenAnchor, 'tie').forEach((tieElement) => {
        hiddenAnchor.removeChild(tieElement)
      })
      getDirectChildElements(hiddenAnchor, 'accidental').forEach((accidentalElement) => {
        hiddenAnchor.removeChild(accidentalElement)
      })
      getDirectChildElements(hiddenAnchor, 'notations').forEach((notationsElement) => {
        hiddenAnchor.removeChild(notationsElement)
      })
      setPitchOnNoteElement(hiddenAnchor, frozenPitch)
      appendTie(hiddenAnchor, 'stop')
      appendTied(hiddenAnchor, 'stop')
      return hiddenAnchor
    }

    type FrozenBoundaryOperation = {
      sourceNoteId: string
      sourceKeyIndex: number
      targetNoteId: string
      targetKeyIndex: number
      frozenPitch: Pitch
    }
    const operations: FrozenBoundaryOperation[] = []
    const operationKeySet = new Set<string>()
    const pushOperation = (operation: FrozenBoundaryOperation) => {
      const key = `${operation.sourceNoteId}:${operation.sourceKeyIndex}->${operation.targetNoteId}:${operation.targetKeyIndex}`
      if (operationKeySet.has(key)) return
      operationKeySet.add(key)
      operations.push(operation)
    }

    measurePairs.forEach((pair) => {
      ;(['treble', 'bass'] as const).forEach((staff) => {
        const staffNotes = staff === 'treble' ? pair.treble : pair.bass
        staffNotes.forEach((staffNote) => {
          if (staffNote.tieFrozenIncomingPitch && staffNote.tieFrozenIncomingFromNoteId) {
            pushOperation({
              sourceNoteId: staffNote.tieFrozenIncomingFromNoteId,
              sourceKeyIndex: Number.isFinite(staffNote.tieFrozenIncomingFromKeyIndex)
                ? Math.max(0, Math.trunc(staffNote.tieFrozenIncomingFromKeyIndex as number))
                : 0,
              targetNoteId: staffNote.id,
              targetKeyIndex: 0,
              frozenPitch: staffNote.tieFrozenIncomingPitch,
            })
          }
          const chordLength = staffNote.chordPitches?.length ?? 0
          for (let chordIndex = 0; chordIndex < chordLength; chordIndex += 1) {
            const frozenPitch = staffNote.chordTieFrozenIncomingPitches?.[chordIndex]
            const fromNoteId = staffNote.chordTieFrozenIncomingFromNoteIds?.[chordIndex] ?? null
            if (!frozenPitch || !fromNoteId) continue
            pushOperation({
              sourceNoteId: fromNoteId,
              sourceKeyIndex: Number.isFinite(staffNote.chordTieFrozenIncomingFromKeyIndices?.[chordIndex])
                ? Math.max(0, Math.trunc(staffNote.chordTieFrozenIncomingFromKeyIndices?.[chordIndex] as number))
                : 0,
              targetNoteId: staffNote.id,
              targetKeyIndex: chordIndex + 1,
              frozenPitch,
            })
          }
        })
      })
    })

    let changed = false

    operations.forEach((operation) => {
      const sourceElement = noteElementByKey.get(toNoteKey(operation.sourceNoteId, operation.sourceKeyIndex))
      const targetElement = noteElementByKey.get(toNoteKey(operation.targetNoteId, operation.targetKeyIndex))
      if (!sourceElement || !targetElement) return

      if (removeNotationByType(sourceElement, 'slur', 'start')) changed = true
      if (removeTieByType(targetElement, 'stop')) changed = true
      if (removeNotationByType(targetElement, 'tied', 'stop')) changed = true
      if (removeNotationByType(targetElement, 'slur', 'stop')) changed = true
      if (removeTieFrozenNotation(targetElement)) changed = true

      if (appendTie(sourceElement, 'start')) changed = true
      if (appendTied(sourceElement, 'start')) changed = true
      const hiddenStopAnchor = createFrozenTieStopAnchor(targetElement, operation.frozenPitch)
      if (hiddenStopAnchor) {
        const parent = targetElement.parentElement
        if (parent) {
          parent.insertBefore(hiddenStopAnchor, targetElement.nextSibling)
          changed = true
        }
      }
    })

    if (!changed) return xmlText
    return new XMLSerializer().serializeToString(doc)
  } catch {
    return xmlText
  }
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('[contenteditable="true"]'))
}

function collectOsmdPreviewPages(container: HTMLElement): HTMLElement[] {
  const directChildren = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
  const directPages = directChildren.filter((child) => {
    const tag = child.tagName.toLowerCase()
    if (tag === 'svg' || tag === 'canvas') return true
    if (tag !== 'div') return false
    return Boolean(child.querySelector('svg, canvas'))
  })
  if (directPages.length > 0) return directPages
  return Array.from(container.querySelectorAll('svg, canvas')).filter((child): child is HTMLElement => child instanceof HTMLElement)
}

function resolveOsmdPreviewPageSvgElement(pageElement: HTMLElement): SVGSVGElement | null {
  if (pageElement instanceof SVGSVGElement) return pageElement
  const nested = pageElement.querySelector('svg')
  return nested instanceof SVGSVGElement ? nested : null
}

function parseSvgLengthValue(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function getSvgRenderSize(svgElement: SVGSVGElement): { width: number; height: number } {
  const widthAttr = parseSvgLengthValue(svgElement.getAttribute('width'))
  const heightAttr = parseSvgLengthValue(svgElement.getAttribute('height'))
  if (widthAttr && heightAttr) {
    return { width: widthAttr, height: heightAttr }
  }
  const viewBox = svgElement.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.trim().split(/\s+/).map(Number)
    if (
      parts.length === 4 &&
      Number.isFinite(parts[2]) &&
      Number.isFinite(parts[3]) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return { width: parts[2], height: parts[3] }
    }
  }
  return { width: A4_PAGE_WIDTH, height: A4_PAGE_HEIGHT }
}

function getSvgCoordinateSize(svgElement: SVGSVGElement): { width: number; height: number } {
  const viewBox = svgElement.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.trim().split(/\s+/).map(Number)
    if (
      parts.length === 4 &&
      Number.isFinite(parts[2]) &&
      Number.isFinite(parts[3]) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return { width: parts[2], height: parts[3] }
    }
  }
  return getSvgRenderSize(svgElement)
}

function cloneOsmdPreviewSvgForPdf(svgElement: SVGSVGElement): { svg: SVGSVGElement; width: number; height: number } {
  const svgClone = svgElement.cloneNode(true) as SVGSVGElement
  if (!svgClone.getAttribute('xmlns')) {
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }
  if (!svgClone.getAttribute('xmlns:xlink')) {
    svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }
  const { width, height } = getSvgRenderSize(svgClone)
  if (!svgClone.getAttribute('width')) {
    svgClone.setAttribute('width', String(width))
  }
  if (!svgClone.getAttribute('height')) {
    svgClone.setAttribute('height', String(height))
  }
  return {
    svg: svgClone,
    width,
    height,
  }
}

function arrayBufferToBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let result = ''
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(bytes.length, start + chunkSize)
    const chunk = bytes.subarray(start, end)
    result += String.fromCharCode(...chunk)
  }
  return result
}

async function loadPdfCjkFontBinary(): Promise<string> {
  if (cachedPdfCjkFontBinary) return cachedPdfCjkFontBinary
  if (cachedPdfCjkFontLoadPromise) return cachedPdfCjkFontLoadPromise
  cachedPdfCjkFontLoadPromise = (async () => {
    const response = await fetch(PDF_CJK_FONT_URL)
    if (!response.ok) {
      throw new Error(`中文字体加载失败: HTTP ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    const binary = arrayBufferToBinaryString(buffer)
    cachedPdfCjkFontBinary = binary
    return binary
  })()
  try {
    return await cachedPdfCjkFontLoadPromise
  } finally {
    cachedPdfCjkFontLoadPromise = null
  }
}

function ensurePdfCjkFontRegistered(pdf: any): void {
  if (!pdf.existsFileInVFS(PDF_CJK_FONT_FILE_NAME)) {
    if (!cachedPdfCjkFontBinary) {
      throw new Error('中文字体未加载完成。')
    }
    pdf.addFileToVFS(PDF_CJK_FONT_FILE_NAME, cachedPdfCjkFontBinary)
  }
  const fontList = pdf.getFontList()
  const existingStyles = fontList[PDF_CJK_FONT_FAMILY] ?? []
  if (!existingStyles.includes('normal')) {
    pdf.addFont(PDF_CJK_FONT_FILE_NAME, PDF_CJK_FONT_FAMILY, 'normal', 'normal', 'Identity-H')
  }
}

function overrideInlineFontFamily(styleText: string | null, familyName: string): string {
  const sanitized = (styleText ?? '').replace(/font-family\s*:[^;]+;?/gi, '').trim()
  const suffix = sanitized.length > 0 ? (sanitized.endsWith(';') ? '' : ';') : ''
  return `${sanitized}${suffix}font-family:'${familyName}';`
}

function svgContainsCjkText(svgElement: SVGSVGElement): boolean {
  const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff]/
  const textNodes = svgElement.querySelectorAll('text, tspan')
  for (const node of textNodes) {
    const value = node.textContent ?? ''
    if (cjkPattern.test(value)) return true
  }
  return false
}

function applyPdfCjkFontToSvgText(svgElement: SVGSVGElement): void {
  const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff]/
  const textNodes = svgElement.querySelectorAll('text, tspan')
  textNodes.forEach((node) => {
    const value = node.textContent ?? ''
    if (!cjkPattern.test(value)) return
    node.setAttribute('font-family', PDF_CJK_FONT_FAMILY)
    node.setAttribute('style', overrideInlineFontFamily(node.getAttribute('style'), PDF_CJK_FONT_FAMILY))
  })
}

function applyOsmdPreviewPageVisibility(pages: HTMLElement[], pageIndex: number): void {
  if (pages.length <= 1) return
  const safeIndex = Math.max(0, Math.min(pages.length - 1, pageIndex))
  pages.forEach((page, index) => {
    page.style.display = index === safeIndex ? '' : 'none'
  })
}

function applyOsmdPreviewPageNumbers(pages: HTMLElement[], visible: boolean): void {
  pages.forEach((page, index) => {
    const svg = resolveOsmdPreviewPageSvgElement(page)
    if (!svg) return
    const pageNumber = index + 1
    const existing = svg.querySelector('.osmd-preview-page-number-overlay')
    if (!visible || pageNumber <= 1) {
      existing?.remove()
      return
    }
    const svgNamespace = 'http://www.w3.org/2000/svg'
    const { width } = getSvgCoordinateSize(svg)
    const isEvenPage = pageNumber % 2 === 0
    const marginX = Math.max(36, width * 0.03)
    const x = isEvenPage ? marginX : Math.max(marginX, width - marginX)
    const y = 18
    const label = existing instanceof SVGTextElement
      ? existing
      : document.createElementNS(svgNamespace, 'text')
    label.setAttribute('class', 'osmd-preview-page-number-overlay')
    label.setAttribute('text-anchor', isEvenPage ? 'start' : 'end')
    label.setAttribute('dominant-baseline', 'hanging')
    label.setAttribute('font-size', '30')
    label.setAttribute('font-weight', '600')
    label.setAttribute('fill', '#000000')
    label.setAttribute('x', x.toFixed(3))
    label.setAttribute('y', y.toFixed(3))
    label.textContent = String(pageNumber)
    if (!(existing instanceof SVGTextElement)) {
      svg.appendChild(label)
    }
  })
}

type OsmdPreviewPoint = { x: number; y: number }
type OsmdPreviewSize = { width: number; height: number }
type OsmdPreviewBoundingBox = {
  RelativePosition?: OsmdPreviewPoint
  AbsolutePosition?: OsmdPreviewPoint
  Size?: OsmdPreviewSize
  ChildElements?: OsmdPreviewBoundingBox[]
}
type OsmdPreviewMusicSystem = {
  PositionAndShape?: OsmdPreviewBoundingBox
}
type OsmdPreviewPage = {
  MusicSystems?: OsmdPreviewMusicSystem[]
  PositionAndShape?: OsmdPreviewBoundingBox
}
type OsmdPreviewGraphicalSheet = {
  MusicPages?: OsmdPreviewPage[]
  reCalculate?: () => void
}
type OsmdPreviewEngravingRules = {
  PageLeftMargin: number
  PageRightMargin: number
  PageTopMargin: number
  PageBottomMargin: number
  PageHeight?: number
}
type OsmdPreviewDrawer = {
  drawSheet: (graphicalSheet: unknown) => void
}
type OsmdPreviewInstance = {
  Zoom: number
  render: () => void
  GraphicSheet?: OsmdPreviewGraphicalSheet
  Drawer?: OsmdPreviewDrawer
  EngravingRules?: OsmdPreviewEngravingRules
}

type OsmdPreviewSystemFrame = {
  system: OsmdPreviewMusicSystem
  y: number
  height: number
}

type OsmdPreviewRebalanceStats = {
  executed: boolean
  pageCount: number
  mutatedCount: number
  targetFirstTop: number
  targetFollowingTop: number
  targetBottom: number
  layoutBottom: number
  minSystemGap: number
  repaginationAttempts: number
  requiresRepagination: boolean
  pageSummaries: Array<{
    pageIndex: number
    frameCount: number
    mutated: number
    mode: 'sparse' | 'distributed'
    firstYBefore: number | null
    firstYAfter: number | null
    gapCount: number
    minGapShortfall: number
    bottomGapAfter: number | null
  }>
}

type OsmdPreviewSelectionTarget = {
  pairIndex: number
  selection: Selection
  domIds: string[]
  measureNumber: number
  onsetTicks: number
}

type MeasureStaffOnsetEntry = {
  noteIndex: number
  onsetTicks: number
  maxKeyIndex: number
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

type NotePreviewDebugEvent = {
  sequence: number
  atMs: number
  noteId: string
  keyIndex: number
  mode: ScoreNotePreviewMode
  pitch: Pitch
}

type PlaybackCursorDebugEvent = {
  sequence: number
  sessionId: number
  atMs: number
  kind: 'start' | 'point' | 'complete'
  point: PlaybackPoint | null
  status: 'idle' | 'playing'
}

type PlayheadDebugLogRow = {
  seq: number
  playheadX: number | null
  containerLeftX: number
  containerRightX: number
  distanceToRightEdge: number | null
}

function escapeCssId(id: string): string {
  if (typeof (window as unknown as { CSS?: { escape?: (value: string) => string } }).CSS?.escape === 'function') {
    return (window as unknown as { CSS: { escape: (value: string) => string } }).CSS.escape(id)
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
}

function getSelectionKey(selection: Selection): string {
  return `${selection.staff}|${selection.noteId}|${selection.keyIndex}`
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

function buildMeasureStaffOnsetEntries(notes: ScoreNote[]): MeasureStaffOnsetEntry[] {
  const entries: MeasureStaffOnsetEntry[] = []
  let cursorTicks = 0
  notes.forEach((note, noteIndex) => {
    const maxKeyIndex = note.chordPitches?.length ?? 0
    entries.push({
      noteIndex,
      onsetTicks: cursorTicks,
      maxKeyIndex,
    })
    cursorTicks += DURATION_TICKS[note.duration] ?? 0
  })
  return entries
}

function findMeasureStaffOnsetEntry(
  entries: MeasureStaffOnsetEntry[],
  onsetTicks: number,
): MeasureStaffOnsetEntry | null {
  if (entries.length === 0) return null
  let best: MeasureStaffOnsetEntry | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    const delta = Math.abs(entry.onsetTicks - onsetTicks)
    if (delta < bestDelta) {
      bestDelta = delta
      best = entry
    }
    if (delta === 0) break
  }
  if (!best) return null
  // OSMD timestamp and custom tick conversion can have small float->int drift.
  return bestDelta <= 1 ? best : null
}

function collectOsmdPreviewSystemFrames(page: OsmdPreviewPage): OsmdPreviewSystemFrame[] {
  const systems = page.MusicSystems ?? []
  return systems
    .map((system) => {
      const box = system.PositionAndShape
      const y = box?.RelativePosition?.y
      const height = box?.Size?.height
      if (
        typeof y !== 'number' ||
        !Number.isFinite(y) ||
        typeof height !== 'number' ||
        !Number.isFinite(height)
      ) {
        return null
      }
      return {
        system,
        y,
        height: Math.max(0, height),
      }
    })
    .filter((frame): frame is OsmdPreviewSystemFrame => frame !== null)
    .sort((left, right) => left.y - right.y)
}

function setOsmdPreviewSystemY(system: OsmdPreviewMusicSystem, nextY: number): boolean {
  const box = system.PositionAndShape
  const position = box?.RelativePosition
  if (!position || !Number.isFinite(position.y) || !Number.isFinite(nextY)) return false
  const delta = nextY - position.y
  if (Math.abs(delta) < 0.01) return false
  position.y = nextY
  const absolute = box?.AbsolutePosition
  if (absolute && Number.isFinite(absolute.y)) {
    absolute.y += delta
  }
  const shiftAbsoluteTreeY = (target: OsmdPreviewBoundingBox | undefined): void => {
    if (!target || !target.ChildElements || target.ChildElements.length === 0) return
    target.ChildElements.forEach((child) => {
      const childAbsolute = child.AbsolutePosition
      if (childAbsolute && Number.isFinite(childAbsolute.y)) {
        childAbsolute.y += delta
      }
      shiftAbsoluteTreeY(child)
    })
  }
  shiftAbsoluteTreeY(box)
  return true
}

function rebalanceOsmdPreviewVerticalSystems(
  osmd: OsmdPreviewInstance,
  firstPageTopMarginPx: number,
  followingPageTopMarginPx: number,
  bottomMarginPx: number,
  layoutBottomMarginPx = bottomMarginPx,
  repaginationAttempts = 0,
): OsmdPreviewRebalanceStats {
  const sheet = osmd.GraphicSheet
  const pages = sheet?.MusicPages ?? []
  const safeFirstPageTopMarginPx = clampOsmdPreviewTopMarginPx(firstPageTopMarginPx)
  const safeFollowingPageTopMarginPx = clampOsmdPreviewTopMarginPx(followingPageTopMarginPx)
  const safeBottomMarginPx = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
  const safeLayoutBottomMarginPx = clampOsmdPreviewBottomMarginPx(layoutBottomMarginPx)
  if (!sheet || pages.length === 0) {
    return {
      executed: false,
      pageCount: pages.length,
      mutatedCount: 0,
      targetFirstTop: safeFirstPageTopMarginPx,
      targetFollowingTop: safeFollowingPageTopMarginPx,
      targetBottom: safeBottomMarginPx,
      layoutBottom: safeLayoutBottomMarginPx,
      minSystemGap: OSMD_PREVIEW_MIN_SYSTEM_GAP_PX,
      repaginationAttempts,
      requiresRepagination: false,
      pageSummaries: [],
    }
  }

  let hasMutated = false
  let mutatedCount = 0
  let requiresRepagination = false
  const rulePageHeight = osmd.EngravingRules?.PageHeight
  const hasRulePageHeight = typeof rulePageHeight === 'number' && Number.isFinite(rulePageHeight) && rulePageHeight > 0
  const referencePageHeightUnits = pages.reduce((maxHeight, page) => {
    const candidate = page.PositionAndShape?.Size?.height
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
      return maxHeight
    }
    return Math.max(maxHeight, candidate)
  }, 0)
  const normalizedPageHeightUnits = hasRulePageHeight
    ? rulePageHeight
    : referencePageHeightUnits > 0
      ? referencePageHeightUnits
      : A4_PAGE_HEIGHT
  const pageSummaries: OsmdPreviewRebalanceStats['pageSummaries'] = []
  pages.forEach((page, pageIndex) => {
    const frames = collectOsmdPreviewSystemFrames(page)
    if (frames.length === 0) {
      pageSummaries.push({
        pageIndex,
        frameCount: 0,
        mutated: 0,
        mode: 'distributed',
        firstYBefore: null,
        firstYAfter: null,
        gapCount: 0,
        minGapShortfall: 0,
        bottomGapAfter: null,
      })
      return
    }
    const firstYBefore = frames[0].y
    const pageHeightUnits = normalizedPageHeightUnits

    let pageMutated = 0

    const heights = frames.map((frame) => frame.height)
    const sourceGaps = frames.slice(0, -1).map((frame, index) => {
      const next = frames[index + 1]
      const gap = next.y - (frame.y + heights[index])
      return Math.max(0, gap)
    })
    const sourceGapSum = sourceGaps.reduce((sum, gap) => sum + gap, 0)
    const targetTop = pageIndex === 0 ? safeFirstPageTopMarginPx : safeFollowingPageTopMarginPx
    const gapCount = sourceGaps.length
    const minGapTotal = gapCount * OSMD_PREVIEW_MIN_SYSTEM_GAP_PX
    const heightSum = heights.reduce((sum, height) => sum + height, 0)
    const targetBottom = safeBottomMarginPx
    const minRequiredSpan = heightSum + minGapTotal
    const maxFeasibleTop = Math.max(0, pageHeightUnits - targetBottom - minRequiredSpan)
    const appliedTop = Math.min(targetTop, maxFeasibleTop)
    const topShortfall = Math.max(0, targetTop - appliedTop)
    const availableSpan = Math.max(0, pageHeightUnits - appliedTop - targetBottom)
    const contentShortfall = Math.max(0, minRequiredSpan - availableSpan)
    const minGapShortfall = topShortfall + contentShortfall
    const extraGapSpan = Math.max(0, availableSpan - minRequiredSpan)
    const targetGaps =
      gapCount === 0
        ? []
        : sourceGapSum > 1e-6
          ? sourceGaps.map((gap) => OSMD_PREVIEW_MIN_SYSTEM_GAP_PX + (gap / sourceGapSum) * extraGapSpan)
          : sourceGaps.map(() => OSMD_PREVIEW_MIN_SYSTEM_GAP_PX + extraGapSpan / gapCount)
    if (
      minGapShortfall > OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS &&
      frames.length >= OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT
    ) {
      requiresRepagination = true
    }

    let cursorY = appliedTop
    frames.forEach((frame, index) => {
      if (setOsmdPreviewSystemY(frame.system, cursorY)) {
        hasMutated = true
        mutatedCount += 1
        pageMutated += 1
      }
      cursorY += heights[index]
      if (index < targetGaps.length) {
        cursorY += targetGaps[index]
      }
    })
    const lastFrameAfter = frames[frames.length - 1]
    const lastFrameAfterY = lastFrameAfter.system.PositionAndShape?.RelativePosition?.y
    const bottomGapAfter =
      typeof lastFrameAfterY === 'number' && Number.isFinite(lastFrameAfterY)
        ? Number((pageHeightUnits - (lastFrameAfterY + lastFrameAfter.height)).toFixed(3))
        : null
    pageSummaries.push({
      pageIndex,
      frameCount: frames.length,
      mutated: pageMutated,
      mode: frames.length <= OSMD_PREVIEW_SPARSE_SYSTEM_COUNT ? 'sparse' : 'distributed',
      firstYBefore,
      firstYAfter: frames[0].system.PositionAndShape?.RelativePosition?.y ?? null,
      gapCount,
      minGapShortfall: Number(minGapShortfall.toFixed(3)),
      bottomGapAfter,
    })
  })

  if (hasMutated) {
    const drawer = osmd.Drawer as unknown as {
      clear?: () => void
      backend?: { clear?: () => void }
      Backends?: Array<{ clear?: () => void }>
    }
    if (Array.isArray(drawer.Backends) && drawer.Backends.length > 0) {
      drawer.Backends.forEach((backend) => backend.clear?.())
    } else if (drawer.backend?.clear) {
      drawer.backend.clear()
    } else if (drawer.clear) {
      drawer.clear()
    }
    osmd.Drawer?.drawSheet(sheet)
  }
  return {
    executed: true,
    pageCount: pages.length,
    mutatedCount,
    targetFirstTop: safeFirstPageTopMarginPx,
    targetFollowingTop: safeFollowingPageTopMarginPx,
    targetBottom: safeBottomMarginPx,
    layoutBottom: safeLayoutBottomMarginPx,
    minSystemGap: OSMD_PREVIEW_MIN_SYSTEM_GAP_PX,
    repaginationAttempts,
    requiresRepagination,
    pageSummaries,
  }
}

function renderAndRebalanceOsmdPreview(
  osmd: OsmdPreviewInstance,
  horizontalMarginPx: number,
  firstPageTopMarginPx: number,
  followingPageTopMarginPx: number,
  bottomMarginPx: number,
): OsmdPreviewRebalanceStats {
  const safeHorizontalMarginPx = clampOsmdPreviewHorizontalMarginPx(horizontalMarginPx)
  const safeBottomMarginPx = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
  applyOsmdPreviewHorizontalMargins(osmd, safeHorizontalMarginPx)

  const baseLayoutBottomPx = clampOsmdPreviewBottomMarginPx(
    Math.min(safeBottomMarginPx, DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX),
  )
  let layoutBottomPx = baseLayoutBottomPx
  let attempt = 0
  while (true) {
    applyOsmdPreviewVerticalMargins(osmd, OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX, layoutBottomPx)
    osmd.render()
    const stats = rebalanceOsmdPreviewVerticalSystems(
      osmd,
      firstPageTopMarginPx,
      followingPageTopMarginPx,
      safeBottomMarginPx,
      layoutBottomPx,
      attempt,
    )
    const maxShortfall = stats.pageSummaries.reduce(
      (maxValue, summary) =>
        summary.frameCount >= OSMD_PREVIEW_REPAGINATION_MIN_FRAME_COUNT
          ? Math.max(maxValue, summary.minGapShortfall)
          : maxValue,
      0,
    )
    if (!stats.requiresRepagination || maxShortfall <= OSMD_PREVIEW_REPAGINATION_SHORTFALL_EPS) {
      return stats
    }
    if (attempt >= OSMD_PREVIEW_REPAGINATION_MAX_ATTEMPTS || layoutBottomPx >= 180) {
      return stats
    }
    const step = clampNumber(
      Math.ceil(maxShortfall),
      OSMD_PREVIEW_REPAGINATION_MIN_STEP_PX,
      OSMD_PREVIEW_REPAGINATION_MAX_STEP_PX,
    )
    const nextLayoutBottomPx = clampOsmdPreviewBottomMarginPx(layoutBottomPx + step)
    if (nextLayoutBottomPx <= layoutBottomPx) {
      return stats
    }
    layoutBottomPx = nextLayoutBottomPx
    attempt += 1
  }
}

function applyOsmdPreviewHorizontalMargins(
  osmd: OsmdPreviewInstance,
  horizontalMarginPx: number,
): void {
  const rules = osmd.EngravingRules
  if (!rules) return
  const safeMarginPx = clampOsmdPreviewHorizontalMarginPx(horizontalMarginPx)
  rules.PageLeftMargin = safeMarginPx
  rules.PageRightMargin = safeMarginPx
}

function applyOsmdPreviewVerticalMargins(
  osmd: OsmdPreviewInstance,
  topMarginPx: number,
  bottomMarginPx: number,
): void {
  const rules = osmd.EngravingRules
  if (!rules) return
  rules.PageTopMargin = clampOsmdPreviewTopMarginPx(topMarginPx)
  rules.PageBottomMargin = clampOsmdPreviewBottomMarginPx(bottomMarginPx)
}

function buildFastOsmdPreviewXml(xmlText: string, measureLimit: number): string {
  const safeLimit = Math.max(1, Math.floor(measureLimit))
  if (!Number.isFinite(safeLimit)) return xmlText
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, 'application/xml')
    if (doc.querySelector('parsererror')) return xmlText
    const partNodes = Array.from(doc.querySelectorAll('score-partwise > part, score-timewise > part'))
    if (partNodes.length === 0) return xmlText
    let hasTrimmedMeasures = false
    partNodes.forEach((partNode) => {
      const measureNodes = Array.from(partNode.children).filter((node) => node.tagName.toLowerCase() === 'measure')
      for (let index = safeLimit; index < measureNodes.length; index += 1) {
        measureNodes[index].remove()
        hasTrimmedMeasures = true
      }
    })
    if (!hasTrimmedMeasures) return xmlText
    return new XMLSerializer().serializeToString(doc)
  } catch {
    return xmlText
  }
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

type MidiPermissionState = 'idle' | 'granted' | 'denied' | 'unsupported' | 'error'

type MidiInputOption = {
  id: string
  name: string
}

type WebMidiMessageEventLike = {
  data?: Uint8Array | number[] | null
}

type WebMidiInputLike = {
  id: string
  name?: string
  onmidimessage: ((event: WebMidiMessageEventLike) => void) | null
}

type WebMidiAccessLike = {
  inputs?: {
    values?: () => IterableIterator<WebMidiInputLike>
    forEach?: (callback: (value: WebMidiInputLike) => void) => void
  }
  onstatechange: ((event: unknown) => void) | null
}

function collectMidiInputs(access: WebMidiAccessLike | null): WebMidiInputLike[] {
  if (!access?.inputs) return []
  const values = access.inputs.values?.()
  if (values) {
    return Array.from(values).filter((input): input is WebMidiInputLike => Boolean(input?.id))
  }
  const list: WebMidiInputLike[] = []
  access.inputs.forEach?.((input) => {
    if (input?.id) list.push(input)
  })
  return list
}

function toMidiPermissionStateFromError(error: unknown): MidiPermissionState {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()
  if (message.includes('denied') || message.includes('notallowed') || message.includes('permission')) {
    return 'denied'
  }
  return 'error'
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
  const [playbackCursorPoint, setPlaybackCursorPoint] = useState<PlaybackPoint | null>(null)
  const [playbackCursorColor, setPlaybackCursorColor] = useState<'red' | 'yellow'>('red')
  const [playbackSessionId, setPlaybackSessionId] = useState(0)
  const [playbackCursorResetVersion, setPlaybackCursorResetVersion] = useState(1)
  const [playheadDebugLogRows, setPlayheadDebugLogRows] = useState<PlayheadDebugLogRow[]>([])
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
  const [isOsmdPreviewOpen, setIsOsmdPreviewOpen] = useState(false)
  const [midiPermissionState, setMidiPermissionState] = useState<MidiPermissionState>('idle')
  const [midiInputOptions, setMidiInputOptions] = useState<MidiInputOption[]>([])
  const [selectedMidiInputId, setSelectedMidiInputId] = useState('')
  const [osmdPreviewSourceMode, setOsmdPreviewSourceMode] = useState<'editor' | 'direct-file'>('editor')
  const [osmdPreviewXml, setOsmdPreviewXml] = useState<string>('')
  const [osmdPreviewStatusText, setOsmdPreviewStatusText] = useState<string>('')
  const [osmdPreviewError, setOsmdPreviewError] = useState<string>('')
  const [isOsmdPreviewExportingPdf, setIsOsmdPreviewExportingPdf] = useState(false)
  const [osmdPreviewPageIndex, setOsmdPreviewPageIndex] = useState(0)
  const [osmdPreviewPageCount, setOsmdPreviewPageCount] = useState(1)
  const [osmdPreviewShowPageNumbers, setOsmdPreviewShowPageNumbers] = useState(true)
  const [osmdPreviewZoomPercent, setOsmdPreviewZoomPercent] = useState(66)
  const [osmdPreviewZoomDraftPercent, setOsmdPreviewZoomDraftPercent] = useState(66)
  const [osmdPreviewPaperScalePercent, setOsmdPreviewPaperScalePercent] = useState(100)
  const [osmdPreviewHorizontalMarginPx, setOsmdPreviewHorizontalMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX,
  )
  const [osmdPreviewFirstPageTopMarginPx, setOsmdPreviewFirstPageTopMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX,
  )
  const [osmdPreviewTopMarginPx, setOsmdPreviewTopMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX,
  )
  const [osmdPreviewBottomMarginPx, setOsmdPreviewBottomMarginPx] = useState(
    DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX,
  )
  const [horizontalViewportXRange, setHorizontalViewportXRange] = useState<{ startX: number; endX: number }>({
    startX: 0,
    endX: A4_PAGE_WIDTH,
  })

  const scoreRef = useRef<HTMLCanvasElement | null>(null)
  const scoreOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const scoreScrollRef = useRef<HTMLDivElement | null>(null)
  const scoreStageRef = useRef<HTMLDivElement | null>(null)
  const osmdPreviewContainerRef = useRef<HTMLDivElement | null>(null)
  const osmdPreviewPagesRef = useRef<HTMLElement[]>([])
  const osmdPreviewInstanceRef = useRef<OsmdPreviewInstance | null>(null)
  const osmdPreviewNoteLookupByDomIdRef = useRef<Map<string, OsmdPreviewSelectionTarget>>(new Map())
  const osmdPreviewNoteLookupBySelectionRef = useRef<Map<string, OsmdPreviewSelectionTarget>>(new Map())
  const osmdPreviewSelectedSelectionKeyRef = useRef<string | null>(null)
  const osmdPreviewHorizontalMarginPxRef = useRef<number>(DEFAULT_OSMD_PREVIEW_HORIZONTAL_MARGIN_PX)
  const osmdPreviewFirstPageTopMarginPxRef = useRef<number>(DEFAULT_OSMD_PREVIEW_FIRST_PAGE_TOP_MARGIN_PX)
  const osmdPreviewTopMarginPxRef = useRef<number>(DEFAULT_OSMD_PREVIEW_FOLLOWING_PAGE_TOP_MARGIN_PX)
  const osmdPreviewBottomMarginPxRef = useRef<number>(DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX)
  const osmdPreviewShowPageNumbersRef = useRef<boolean>(true)
  const osmdPreviewPageIndexRef = useRef<number>(0)
  const osmdPreviewLastRebalanceStatsRef = useRef<OsmdPreviewRebalanceStats | null>(null)
  const playheadFollowHydratedRef = useRef(false)
  const chordDegreeDisplayHydratedRef = useRef(false)
  const showInScoreMeasureNumbersHydratedRef = useRef(false)
  const showNoteHeadJianpuHydratedRef = useRef(false)
  const osmdPreviewZoomCommitTimerRef = useRef<number | null>(null)
  const osmdPreviewMarginApplyTimerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const osmdDirectFileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | Tone.Sampler | null>(null)
  const notePreviewEventsRef = useRef<NotePreviewDebugEvent[]>([])
  const notePreviewSequenceRef = useRef(0)
  const playbackCursorEventsRef = useRef<PlaybackCursorDebugEvent[]>([])
  const playbackCursorSequenceRef = useRef(0)
  const playheadDebugLogRowsRef = useRef<PlayheadDebugLogRow[]>([])
  const playheadDebugSequenceRef = useRef(0)
  const playheadDebugLastSnapshotKeyRef = useRef<string | null>(null)
  const playheadDebugLastIdlePointKeyRef = useRef<string | null>(null)
  const playheadDebugMeasureRafRef = useRef<number | null>(null)
  const playheadDebugScrollRafRef = useRef<number | null>(null)
  const latestPlayheadDebugSnapshotRef = useRef<PlayheadDebugLogRow | null>(null)
  const playheadElementRef = useRef<HTMLDivElement | null>(null)

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
  const lastAppliedPlaybackCursorResetVersionRef = useRef(0)
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
  const isOsmdPreviewOpenRef = useRef<boolean>(isOsmdPreviewOpen)
  const undoHistoryRef = useRef<UndoSnapshot[]>([])
  const layoutReflowHintRef = useRef<LayoutReflowHint | null>(null)
  const midiAccessRef = useRef<WebMidiAccessLike | null>(null)
  const midiInputsByIdRef = useRef<Map<string, WebMidiInputLike>>(new Map())
  const boundMidiInputIdRef = useRef<string>('')
  const midiStepChainRef = useRef(false)
  const midiStepLastSelectionRef = useRef<Selection | null>(null)
  const noteClipboardRef = useRef<NoteClipboardPayload | null>(null)
  const chordMarkerLayoutRequestRef = useRef(0)
  const chordMarkerLayoutAppliedRef = useRef(0)
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

  const handlePreviewScoreNote = useCallback((params: {
    note: ScoreNote
    keyIndex: number
    mode: ScoreNotePreviewMode
    targetPitch?: Pitch | null
  }) => {
    const { note, keyIndex, mode, targetPitch = null } = params
    const resolvedPitch = resolveScoreNotePreviewPitch({
      note,
      keyIndex,
      targetPitch,
    })
    if (!resolvedPitch) return

    notePreviewSequenceRef.current += 1
    notePreviewEventsRef.current.push({
      sequence: notePreviewSequenceRef.current,
      atMs: Date.now(),
      noteId: note.id,
      keyIndex,
      mode,
      pitch: resolvedPitch,
    })
    if (notePreviewEventsRef.current.length > 240) {
      notePreviewEventsRef.current.splice(0, notePreviewEventsRef.current.length - 240)
    }

    void previewScoreNote({
      synth: synthRef.current,
      note,
      keyIndex,
      mode,
      targetPitch,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[audio] 音符试听失败：${message}`)
    })
  }, [])

  const requestPlaybackCursorReset = useCallback(() => {
    setPlaybackCursorResetVersion((current) => current + 1)
  }, [])

  useEffect(() => {
    if (lastAppliedPlaybackCursorResetVersionRef.current === playbackCursorResetVersion) return
    lastAppliedPlaybackCursorResetVersionRef.current = playbackCursorResetVersion
    setPlaybackCursorPoint(firstPlaybackPoint)
    setPlaybackCursorColor('red')
  }, [firstPlaybackPoint, playbackCursorResetVersion])

  const appendPlaybackCursorDebugEvent = useCallback((params: {
    kind: PlaybackCursorDebugEvent['kind']
    sessionId: number
    point: PlaybackPoint | null
    status: PlaybackCursorDebugEvent['status']
  }) => {
    const { kind, sessionId, point, status } = params
    playbackCursorSequenceRef.current += 1
    playbackCursorEventsRef.current.push({
      sequence: playbackCursorSequenceRef.current,
      sessionId,
      atMs: Date.now(),
      kind,
      point: point ? { ...point } : null,
      status,
    })
    if (playbackCursorEventsRef.current.length > 240) {
      playbackCursorEventsRef.current.splice(0, playbackCursorEventsRef.current.length - 240)
    }
  }, [])

  const stopActivePlaybackSession = useCallback(() => {
    stopPlaybackAction({
      synthRef,
      stopPlayTimerRef,
      playbackPointTimerIdsRef,
      playbackSessionIdRef,
      setIsPlaying,
    })
    const nextSessionId = playbackSessionIdRef.current
    setPlaybackSessionId(nextSessionId)
    setPlaybackCursorColor('red')
  }, [])

  const handlePlaybackStart = useCallback((params: {
    sessionId: number
    firstEvent: PlaybackTimelineEvent | null
  }) => {
    const { sessionId, firstEvent } = params
    setPlaybackSessionId(sessionId)
    setPlaybackCursorColor('yellow')
    if (firstEvent) {
      setPlaybackCursorPoint(firstEvent.point)
    }
    appendPlaybackCursorDebugEvent({
      kind: 'start',
      sessionId,
      point: firstEvent?.point ?? null,
      status: 'playing',
    })
  }, [appendPlaybackCursorDebugEvent])

  const handlePlaybackPoint = useCallback((params: {
    sessionId: number
    event: PlaybackTimelineEvent
  }) => {
    const { sessionId, event } = params
    setPlaybackSessionId(sessionId)
    setPlaybackCursorPoint(event.point)
    setPlaybackCursorColor('yellow')
    appendPlaybackCursorDebugEvent({
      kind: 'point',
      sessionId,
      point: event.point,
      status: 'playing',
    })
  }, [appendPlaybackCursorDebugEvent])

  const handlePlaybackComplete = useCallback((params: {
    sessionId: number
    lastEvent: PlaybackTimelineEvent | null
  }) => {
    const { sessionId, lastEvent } = params
    setPlaybackSessionId(sessionId)
    if (lastEvent) {
      setPlaybackCursorPoint(lastEvent.point)
    }
    setPlaybackCursorColor('red')
    appendPlaybackCursorDebugEvent({
      kind: 'complete',
      sessionId,
      point: lastEvent?.point ?? null,
      status: 'idle',
    })
  }, [appendPlaybackCursorDebugEvent])

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
  const midiSupported = midiPermissionState !== 'unsupported'
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
    isOsmdPreviewOpenRef.current = isOsmdPreviewOpen
  }, [isOsmdPreviewOpen])
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

  const refreshMidiInputs = useCallback((access: WebMidiAccessLike | null) => {
    const inputs = collectMidiInputs(access)
    const nextOptions: MidiInputOption[] = []
    const nextInputMap = new Map<string, WebMidiInputLike>()
    inputs.forEach((input) => {
      if (!input?.id) return
      nextInputMap.set(input.id, input)
      nextOptions.push({
        id: input.id,
        name: input.name?.trim() || '未命名设备',
      })
    })
    midiInputsByIdRef.current = nextInputMap
    setMidiInputOptions(nextOptions)
    setSelectedMidiInputId((current) => {
      if (current && nextInputMap.has(current)) return current
      const rememberedId = typeof window !== 'undefined' ? window.localStorage.getItem(LOCAL_STORAGE_MIDI_INPUT_KEY) : ''
      if (rememberedId && nextInputMap.has(rememberedId)) return rememberedId
      return nextOptions[0]?.id ?? ''
    })
  }, [])

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

  const handleMidiMessage = useCallback((event: WebMidiMessageEventLike) => {
    const rawData = event?.data
    const messageData =
      rawData instanceof Uint8Array ? rawData : Array.isArray(rawData) ? new Uint8Array(rawData) : null
    if (!messageData) return
    const midiNoteNumber = getMidiNoteNumber(messageData)
    if (midiNoteNumber === null) return
    applyMidiReplacementByNoteNumber(midiNoteNumber)
  }, [applyMidiReplacementByNoteNumber])

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

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (selectedMidiInputId) {
      window.localStorage.setItem(LOCAL_STORAGE_MIDI_INPUT_KEY, selectedMidiInputId)
    } else {
      window.localStorage.removeItem(LOCAL_STORAGE_MIDI_INPUT_KEY)
    }
  }, [selectedMidiInputId])

  useEffect(() => {
    const boundId = boundMidiInputIdRef.current
    if (boundId) {
      const previousInput = midiInputsByIdRef.current.get(boundId)
      if (previousInput) previousInput.onmidimessage = null
      boundMidiInputIdRef.current = ''
    }
    if (!selectedMidiInputId) return
    const selectedInput = midiInputsByIdRef.current.get(selectedMidiInputId)
    if (!selectedInput) return
    selectedInput.onmidimessage = handleMidiMessage
    boundMidiInputIdRef.current = selectedMidiInputId
    return () => {
      if (boundMidiInputIdRef.current !== selectedMidiInputId) return
      selectedInput.onmidimessage = null
      boundMidiInputIdRef.current = ''
    }
  }, [handleMidiMessage, selectedMidiInputId])

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      setMidiPermissionState('unsupported')
      return
    }
    const midiNavigator = navigator as Navigator & {
      requestMIDIAccess?: () => Promise<WebMidiAccessLike>
    }
    if (typeof midiNavigator.requestMIDIAccess !== 'function') {
      setMidiPermissionState('unsupported')
      setMidiInputOptions([])
      setSelectedMidiInputId('')
      return
    }

    let cancelled = false
    midiNavigator.requestMIDIAccess()
      .then((access) => {
        if (cancelled) return
        const normalizedAccess = access as unknown as WebMidiAccessLike
        midiAccessRef.current = normalizedAccess
        setMidiPermissionState('granted')
        refreshMidiInputs(normalizedAccess)
        normalizedAccess.onstatechange = () => {
          refreshMidiInputs(normalizedAccess)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        midiAccessRef.current = null
        midiInputsByIdRef.current = new Map()
        setMidiInputOptions([])
        setSelectedMidiInputId('')
        setMidiPermissionState(toMidiPermissionStateFromError(error))
      })

    return () => {
      cancelled = true
      const boundId = boundMidiInputIdRef.current
      if (boundId) {
        const boundInput = midiInputsByIdRef.current.get(boundId)
        if (boundInput) boundInput.onmidimessage = null
        boundMidiInputIdRef.current = ''
      }
      const access = midiAccessRef.current
      if (access) access.onstatechange = null
      midiAccessRef.current = null
    }
  }, [refreshMidiInputs])

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
      staticNoteXById: new Map(),
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

  const closeOsmdPreview = useCallback(() => {
    if (osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
      osmdPreviewZoomCommitTimerRef.current = null
    }
    setIsOsmdPreviewOpen(false)
    setOsmdPreviewStatusText('')
    setOsmdPreviewError('')
    setOsmdPreviewSourceMode('editor')
    setOsmdPreviewPageIndex(0)
    setOsmdPreviewPageCount(1)
    osmdPreviewPagesRef.current = []
    osmdPreviewInstanceRef.current = null
    const container = osmdPreviewContainerRef.current
    if (container) {
      container.querySelectorAll('.osmd-preview-note-selected').forEach((node) => {
        node.classList.remove('osmd-preview-note-selected')
      })
    }
    osmdPreviewNoteLookupByDomIdRef.current.clear()
    osmdPreviewNoteLookupBySelectionRef.current.clear()
    osmdPreviewSelectedSelectionKeyRef.current = null
  }, [])

  const clearOsmdPreviewNoteHighlight = useCallback(() => {
    const container = osmdPreviewContainerRef.current
    if (!container) return
    container.querySelectorAll('.osmd-preview-note-selected').forEach((node) => {
      node.classList.remove('osmd-preview-note-selected')
    })
  }, [])

  const applyOsmdPreviewNoteHighlight = useCallback((target: OsmdPreviewSelectionTarget | null) => {
    clearOsmdPreviewNoteHighlight()
    if (!target) return
    const container = osmdPreviewContainerRef.current
    if (!container) return
    for (const domId of target.domIds) {
      const targetNode = container.querySelector(`#${escapeCssId(domId)}`)
      if (!targetNode) continue
      targetNode.classList.add('osmd-preview-note-selected')
      return
    }
  }, [clearOsmdPreviewNoteHighlight])

  const rebuildOsmdPreviewNoteLookup = useCallback(() => {
    const osmd = osmdPreviewInstanceRef.current as unknown as {
      GraphicSheet?: {
        MusicPages?: Array<{
          MusicSystems?: Array<{
            StaffLines?: Array<{
              Measures?: Array<{
                measureNumber?: number
                MeasureNumber?: number
                staffEntries?: Array<{
                  graphicalVoiceEntries?: Array<{
                    notes?: Array<{
                      getSVGId?: () => string
                      sourceNote?: {
                        isRestFlag?: boolean
                        isRest?: () => boolean
                        sourceMeasure?: {
                          measureNumber?: number
                          MeasureNumber?: number
                        }
                        parentStaffEntry?: {
                          parentStaff?: {
                            idInMusicSheet?: number
                          }
                        }
                        voiceEntry?: {
                          timestamp?: {
                            realValue?: number
                            numerator?: number
                            denominator?: number
                          }
                          notes?: Array<unknown>
                        }
                      }
                    }>
                  }>
                }>
              }>
            }>
          }>
        }>
      }
    } | null
    const lookupByDomId = new Map<string, OsmdPreviewSelectionTarget>()
    const lookupBySelection = new Map<string, OsmdPreviewSelectionTarget>()
    if (osmdPreviewSourceMode !== 'editor') {
      osmdPreviewNoteLookupByDomIdRef.current = lookupByDomId
      osmdPreviewNoteLookupBySelectionRef.current = lookupBySelection
      clearOsmdPreviewNoteHighlight()
      return
    }
    if (!osmd?.GraphicSheet?.MusicPages?.length) {
      osmdPreviewNoteLookupByDomIdRef.current = lookupByDomId
      osmdPreviewNoteLookupBySelectionRef.current = lookupBySelection
      return
    }

    const onsetCache = new Map<string, MeasureStaffOnsetEntry[]>()
    const getOnsetEntries = (pairIndex: number, staff: 'treble' | 'bass'): MeasureStaffOnsetEntry[] => {
      const cacheKey = `${pairIndex}|${staff}`
      const cached = onsetCache.get(cacheKey)
      if (cached) return cached
      const pair = measurePairs[pairIndex]
      if (!pair) {
        onsetCache.set(cacheKey, [])
        return []
      }
      const notes = staff === 'treble' ? pair.treble : pair.bass
      const entries = buildMeasureStaffOnsetEntries(notes)
      onsetCache.set(cacheKey, entries)
      return entries
    }

    for (const page of osmd.GraphicSheet.MusicPages) {
      const systems = page?.MusicSystems ?? []
      for (const system of systems) {
        const staffLines = system?.StaffLines ?? []
        for (let staffLineIndex = 0; staffLineIndex < staffLines.length; staffLineIndex += 1) {
          const staffLine = staffLines[staffLineIndex]
          const graphicalMeasures = staffLine?.Measures ?? []
          for (const graphicalMeasure of graphicalMeasures) {
            const staffEntries = graphicalMeasure?.staffEntries ?? []
            for (const graphicalStaffEntry of staffEntries) {
              const graphicalVoiceEntries = graphicalStaffEntry?.graphicalVoiceEntries ?? []
              for (const graphicalVoiceEntry of graphicalVoiceEntries) {
                const graphicalNotes = graphicalVoiceEntry?.notes ?? []
                for (const graphicalNote of graphicalNotes) {
                  const sourceNote = graphicalNote?.sourceNote
                  if (!sourceNote) continue
                  const isRest = sourceNote.isRestFlag === true || (typeof sourceNote.isRest === 'function' && sourceNote.isRest())
                  if (isRest) continue

                  const sourceMeasure = sourceNote.sourceMeasure as
                    | {
                        measureListIndex?: number
                        MeasureListIndex?: number
                        measureNumber?: number
                        MeasureNumber?: number
                      }
                    | undefined
                  const graphicalMeasureAny = graphicalMeasure as
                    | {
                        parentSourceMeasure?: {
                          measureListIndex?: number
                          MeasureListIndex?: number
                          measureNumber?: number
                          MeasureNumber?: number
                        }
                        ParentSourceMeasure?: {
                          measureListIndex?: number
                          MeasureListIndex?: number
                          measureNumber?: number
                          MeasureNumber?: number
                        }
                        measureNumber?: number
                        MeasureNumber?: number
                      }
                    | undefined
                  const parentSourceMeasure =
                    graphicalMeasureAny?.parentSourceMeasure ??
                    graphicalMeasureAny?.ParentSourceMeasure
                  const measureListIndexRaw =
                    sourceMeasure?.measureListIndex ??
                    sourceMeasure?.MeasureListIndex ??
                    parentSourceMeasure?.measureListIndex ??
                    parentSourceMeasure?.MeasureListIndex
                  const measureNumberRaw =
                    sourceMeasure?.measureNumber ??
                    sourceMeasure?.MeasureNumber ??
                    parentSourceMeasure?.measureNumber ??
                    parentSourceMeasure?.MeasureNumber ??
                    graphicalMeasureAny?.measureNumber ??
                    graphicalMeasureAny?.MeasureNumber
                  const pairIndex =
                    typeof measureListIndexRaw === 'number' && Number.isFinite(measureListIndexRaw)
                      ? Math.max(0, Math.round(measureListIndexRaw))
                      : typeof measureNumberRaw === 'number' && Number.isFinite(measureNumberRaw)
                        ? Math.max(0, Math.round(measureNumberRaw) - 1)
                        : -1
                  if (pairIndex < 0) continue
                  const pair = measurePairs[pairIndex]
                  if (!pair) continue

                  const staffId =
                    sourceNote.parentStaffEntry?.parentStaff?.idInMusicSheet ??
                    (staffLineIndex % 2)
                  const staff: 'treble' | 'bass' = Number(staffId) === 1 ? 'bass' : 'treble'
                  const staffNotes = staff === 'treble' ? pair.treble : pair.bass
                  if (staffNotes.length === 0) continue

                  const timestamp = sourceNote.voiceEntry?.timestamp
                  const realValue =
                    (typeof timestamp?.realValue === 'number' && Number.isFinite(timestamp.realValue)
                      ? timestamp.realValue
                      : null) ??
                    (typeof timestamp?.numerator === 'number' &&
                    Number.isFinite(timestamp.numerator) &&
                    typeof timestamp?.denominator === 'number' &&
                    Number.isFinite(timestamp.denominator) &&
                    timestamp.denominator > 0
                      ? timestamp.numerator / timestamp.denominator
                      : null)
                  if (typeof realValue !== 'number' || !Number.isFinite(realValue)) continue
                  const onsetTicks = Math.round(realValue * TICKS_PER_BEAT * 4)

                  const onsetEntries = getOnsetEntries(pairIndex, staff)
                  const onsetEntry = findMeasureStaffOnsetEntry(onsetEntries, onsetTicks)
                  if (!onsetEntry) continue
                  const note = staffNotes[onsetEntry.noteIndex]
                  if (!note) continue

                  const voiceNotes = sourceNote.voiceEntry?.notes
                  const chordIndex = Array.isArray(voiceNotes)
                    ? Math.max(0, voiceNotes.findIndex((candidate) => candidate === sourceNote))
                    : 0
                  const keyIndex = Math.max(0, Math.min(chordIndex, onsetEntry.maxKeyIndex))
                  const selection: Selection = { noteId: note.id, staff, keyIndex }

                  const rawId = typeof graphicalNote.getSVGId === 'function' ? graphicalNote.getSVGId() : ''
                  if (!rawId) continue
                  const domIds = rawId.startsWith('vf-') ? [rawId, rawId.slice(3)] : [rawId, `vf-${rawId}`]
                  const uniqueDomIds = [...new Set(domIds.filter((value) => value.length > 0))]
                  if (uniqueDomIds.length === 0) continue

                  const target: OsmdPreviewSelectionTarget = {
                    pairIndex,
                    selection,
                    domIds: uniqueDomIds,
                    measureNumber: pairIndex + 1,
                    onsetTicks,
                  }
                  const selectionKey = getSelectionKey(selection)
                  if (!lookupBySelection.has(selectionKey)) {
                    lookupBySelection.set(selectionKey, target)
                  }
                  uniqueDomIds.forEach((domId) => {
                    if (!lookupByDomId.has(domId)) {
                      lookupByDomId.set(domId, target)
                    }
                  })
                }
              }
            }
          }
        }
      }
    }

    osmdPreviewNoteLookupByDomIdRef.current = lookupByDomId
    osmdPreviewNoteLookupBySelectionRef.current = lookupBySelection
    const selectedKey = osmdPreviewSelectedSelectionKeyRef.current
    if (!selectedKey) {
      clearOsmdPreviewNoteHighlight()
      return
    }
    applyOsmdPreviewNoteHighlight(lookupBySelection.get(selectedKey) ?? null)
  }, [applyOsmdPreviewNoteHighlight, clearOsmdPreviewNoteHighlight, measurePairs, osmdPreviewSourceMode])

  const resolveOsmdPreviewTargetFromEvent = useCallback((eventTarget: EventTarget | null): OsmdPreviewSelectionTarget | null => {
    const container = osmdPreviewContainerRef.current
    if (!container || !(eventTarget instanceof Element)) return null
    let current: Element | null = eventTarget
    while (current && current !== container) {
      const id = (current as HTMLElement).id
      if (id) {
        const lookup = osmdPreviewNoteLookupByDomIdRef.current
        const target =
          lookup.get(id) ??
          (id.startsWith('vf-') ? lookup.get(id.slice(3)) : lookup.get(`vf-${id}`))
        if (target) return target
      }
      current = current.parentElement
    }
    return null
  }, [])

  const jumpFromOsmdPreviewToEditor = useCallback((target: OsmdPreviewSelectionTarget) => {
    const { selection, pairIndex } = target
    resetMidiStepChain()
    setIsSelectionVisible(true)
    setActiveSelection(selection)
    setSelectedSelections([selection])
    setDraggingSelection(null)
    setSelectedMeasureScope(null)
    clearActiveChordSelection()
    closeOsmdPreview()

    const scrollHost = scoreScrollRef.current
    if (!scrollHost) return
    const resolvedLocation = findSelectionLocationInPairs({
      pairs: measurePairsRef.current,
      selection,
      importedNoteLookup: importedNoteLookupRef.current,
    })
    const resolvedPairIndex = resolvedLocation?.pairIndex ?? pairIndex
    const getCoarseScrollLeft = (): number | null => {
      const frame = horizontalMeasureFramesByPair[resolvedPairIndex]
      if (!frame) return null
      const frameCenterX = frame.measureX + frame.measureWidth * 0.5
      return Math.max(0, frameCenterX * scoreScaleX - scrollHost.clientWidth * 0.5)
    }
    const getPreciseScrollLeft = (): number | null => {
      const pairLayouts = noteLayoutsByPairRef.current.get(resolvedPairIndex) ?? []
      const noteLayout =
        pairLayouts.find((layout) => layout.id === selection.noteId && layout.staff === selection.staff) ??
        noteLayoutByKeyRef.current.get(getLayoutNoteKey(selection.staff, selection.noteId))
      if (!noteLayout) return null
      const targetHeadX = noteLayout.noteHeads.find((head) => head.keyIndex === selection.keyIndex)?.x ?? noteLayout.x
      const targetHeadGlobalX = horizontalRenderOffsetXRef.current + targetHeadX
      return Math.max(0, targetHeadGlobalX * scoreScaleX - scrollHost.clientWidth * 0.5)
    }

    const MAX_ATTEMPTS = 48
    let attempts = 0
    const runJumpLoop = () => {
      attempts += 1
      const coarseScrollLeft = getCoarseScrollLeft()
      if (coarseScrollLeft !== null) {
        scrollHost.scrollLeft = coarseScrollLeft
      }
      const preciseScrollLeft = getPreciseScrollLeft()
      if (preciseScrollLeft !== null) {
        scrollHost.scrollLeft = preciseScrollLeft
        return
      }
      if (attempts < MAX_ATTEMPTS) {
        window.requestAnimationFrame(runJumpLoop)
      } else {
        console.warn(
          `[osmd-jump] 无法精确定位目标音符，已停在目标小节附近。selection=${selection.staff}:${selection.noteId}[${selection.keyIndex}] pair=${resolvedPairIndex}`,
        )
      }
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(runJumpLoop)
    })
  }, [clearActiveChordSelection, closeOsmdPreview, horizontalMeasureFramesByPair, resetMidiStepChain, scoreScaleX])

  const onOsmdPreviewSurfaceClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (osmdPreviewSourceMode !== 'editor') return
    const target = resolveOsmdPreviewTargetFromEvent(event.target)
    if (!target) {
      osmdPreviewSelectedSelectionKeyRef.current = null
      clearOsmdPreviewNoteHighlight()
      return
    }
    osmdPreviewSelectedSelectionKeyRef.current = getSelectionKey(target.selection)
    applyOsmdPreviewNoteHighlight(target)
  }, [applyOsmdPreviewNoteHighlight, clearOsmdPreviewNoteHighlight, osmdPreviewSourceMode, resolveOsmdPreviewTargetFromEvent])

  const onOsmdPreviewSurfaceDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (osmdPreviewSourceMode !== 'editor') return
    const target = resolveOsmdPreviewTargetFromEvent(event.target)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    osmdPreviewSelectedSelectionKeyRef.current = getSelectionKey(target.selection)
    applyOsmdPreviewNoteHighlight(target)
    jumpFromOsmdPreviewToEditor(target)
  }, [applyOsmdPreviewNoteHighlight, jumpFromOsmdPreviewToEditor, osmdPreviewSourceMode, resolveOsmdPreviewTargetFromEvent])

  const openOsmdPreviewWithXml = useCallback((previewXmlText: string, sourceMode: 'editor' | 'direct-file') => {
    setOsmdPreviewSourceMode(sourceMode)
    setOsmdPreviewXml(previewXmlText)
    setOsmdPreviewStatusText('正在生成OSMD预览...')
    setOsmdPreviewError('')
    setOsmdPreviewPageIndex(0)
    setOsmdPreviewPageCount(1)
    setIsOsmdPreviewOpen(true)
  }, [])

  const openOsmdPreview = useCallback(() => {
    const { xmlText } = buildMusicXmlExportPayload({
      measurePairs,
      keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
      divisionsByMeasure: measureDivisionsFromImportRef.current,
      timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
      metadata: musicXmlMetadataFromImportRef.current,
    })
    const previewXmlText = sanitizeMusicXmlForOsmdPreview(xmlText, measurePairs)
    openOsmdPreviewWithXml(previewXmlText, 'editor')
  }, [measurePairs, openOsmdPreviewWithXml])

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
      selectedSelections,
    ],
  )

  const openDirectOsmdFilePicker = useCallback(() => {
    const input = osmdDirectFileInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }, [])

  const onOsmdDirectFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const selectedFile = input.files?.[0]
    input.value = ''
    if (!selectedFile) return
    try {
      setOsmdPreviewError('')
      setOsmdPreviewStatusText('正在读取MusicXML文件...')
      const xmlText = await selectedFile.text()
      if (!xmlText.trim()) {
        setOsmdPreviewStatusText('')
        setOsmdPreviewError('所选文件为空，无法预览。')
        return
      }
      openOsmdPreviewWithXml(xmlText, 'direct-file')
    } catch (error) {
      setOsmdPreviewStatusText('')
      const message = error instanceof Error ? error.message : '读取MusicXML文件失败。'
      setOsmdPreviewError(message)
    }
  }, [openOsmdPreviewWithXml])
  const exportOsmdPreviewPdf = useCallback(async () => {
    if (isOsmdPreviewExportingPdf) return
    const container = osmdPreviewContainerRef.current
    if (!container) {
      setOsmdPreviewError('当前没有可导出的预览内容。')
      return
    }
    const pageElements = collectOsmdPreviewPages(container)
    if (pageElements.length === 0) {
      setOsmdPreviewError('当前没有可导出的预览页面。')
      return
    }

    setIsOsmdPreviewExportingPdf(true)
    setOsmdPreviewError('')
    try {
      const { jsPDF } = await import('jspdf')
      type Svg2PdfFn = (
        element: SVGElement,
        pdf: unknown,
        options?: { x?: number; y?: number; width?: number; height?: number },
      ) => Promise<void> | void
      const svg2pdfModule = await import('svg2pdf.js')
      const svg2pdfMaybe = svg2pdfModule as unknown as {
        svg2pdf?: Svg2PdfFn
        default?: Svg2PdfFn
      }
      const svg2pdf = svg2pdfMaybe.svg2pdf ?? svg2pdfMaybe.default
      if (typeof svg2pdf !== 'function') {
        throw new Error('未找到SVG转PDF模块。')
      }
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
        compress: true,
      })
      let exportedCount = 0
      const totalCount = pageElements.length
      for (let pageIndex = 0; pageIndex < pageElements.length; pageIndex += 1) {
        const svgElement = resolveOsmdPreviewPageSvgElement(pageElements[pageIndex])
        if (!svgElement) continue
        setOsmdPreviewStatusText(`正在导出PDF... ${Math.min(totalCount, exportedCount + 1)} / ${totalCount}`)
        const { svg: svgForPdf, width, height } = cloneOsmdPreviewSvgForPdf(svgElement)
        if (svgContainsCjkText(svgForPdf)) {
          if (!cachedPdfCjkFontBinary) {
            await loadPdfCjkFontBinary()
          }
          ensurePdfCjkFontRegistered(pdf)
          applyPdfCjkFontToSvgText(svgForPdf)
        }
        if (exportedCount > 0) {
          pdf.addPage('a4', 'portrait')
        }
        const pdfWidth = pdf.internal.pageSize.getWidth()
        const pdfHeight = pdf.internal.pageSize.getHeight()
        const sourceAspect = width / Math.max(1e-6, height)
        const pdfAspect = pdfWidth / Math.max(1e-6, pdfHeight)
        let drawWidth = pdfWidth
        let drawHeight = pdfHeight
        let drawX = 0
        let drawY = 0
        if (sourceAspect > pdfAspect) {
          drawHeight = pdfWidth / sourceAspect
          drawY = (pdfHeight - drawHeight) / 2
        } else {
          drawWidth = pdfHeight * sourceAspect
          drawX = (pdfWidth - drawWidth) / 2
        }
        pdf.setFillColor(255, 255, 255)
        pdf.rect(0, 0, pdfWidth, pdfHeight, 'F')
        await svg2pdf(svgForPdf, pdf, {
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
        })
        exportedCount += 1
      }

      if (exportedCount <= 0) {
        throw new Error('预览中未找到可导出的SVG页面。')
      }
      const rawFileName = (musicXmlMetadataFromImportRef.current?.workTitle ?? 'score-preview').trim() || 'score-preview'
      const safeFileName = rawFileName.replace(/[\\/:*?"<>|]+/g, '_')
      pdf.save(`${safeFileName}.pdf`)
      setOsmdPreviewStatusText(`PDF导出完成，共 ${exportedCount} 页。`)
      window.setTimeout(() => {
        setOsmdPreviewStatusText((current) =>
          current.startsWith('PDF导出完成') ? '' : current,
        )
      }, 2200)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF导出失败。'
      setOsmdPreviewError(message)
    } finally {
      setIsOsmdPreviewExportingPdf(false)
    }
  }, [isOsmdPreviewExportingPdf])
  const goToPrevOsmdPreviewPage = useCallback(() => {
    setOsmdPreviewPageIndex((current) => Math.max(0, current - 1))
  }, [])
  const goToNextOsmdPreviewPage = useCallback(() => {
    setOsmdPreviewPageIndex((current) => Math.min(Math.max(0, osmdPreviewPageCount - 1), current + 1))
  }, [osmdPreviewPageCount])
  const commitOsmdPreviewZoomPercent = useCallback((nextValue: number) => {
    const clamped = clampOsmdPreviewZoomPercent(nextValue)
    if (osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
      osmdPreviewZoomCommitTimerRef.current = null
    }
    setOsmdPreviewZoomDraftPercent(clamped)
    setOsmdPreviewZoomPercent((current) => (current === clamped ? current : clamped))
  }, [])
  const scheduleOsmdPreviewZoomPercentCommit = useCallback((nextValue: number) => {
    const clamped = clampOsmdPreviewZoomPercent(nextValue)
    setOsmdPreviewZoomDraftPercent(clamped)
    if (osmdPreviewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
    }
    osmdPreviewZoomCommitTimerRef.current = window.setTimeout(() => {
      osmdPreviewZoomCommitTimerRef.current = null
      setOsmdPreviewZoomPercent((current) => (current === clamped ? current : clamped))
    }, OSMD_PREVIEW_ZOOM_DEBOUNCE_MS)
  }, [])
  const onOsmdPreviewPaperScalePercentChange = useCallback((nextValue: number) => {
    setOsmdPreviewPaperScalePercent(clampOsmdPreviewPaperScalePercent(nextValue))
  }, [])
  const onOsmdPreviewHorizontalMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewHorizontalMarginPx(clampOsmdPreviewHorizontalMarginPx(nextValue))
  }, [])
  const onOsmdPreviewFirstPageTopMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewFirstPageTopMarginPx(clampOsmdPreviewTopMarginPx(nextValue))
  }, [])
  const onOsmdPreviewTopMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewTopMarginPx(clampOsmdPreviewTopMarginPx(nextValue))
  }, [])
  const onOsmdPreviewBottomMarginPxChange = useCallback((nextValue: number) => {
    setOsmdPreviewBottomMarginPx(clampOsmdPreviewBottomMarginPx(nextValue))
  }, [])
  const onOsmdPreviewShowPageNumbersChange = useCallback((nextVisible: boolean) => {
    setOsmdPreviewShowPageNumbers(Boolean(nextVisible))
  }, [])

  useEffect(() => {
    setOsmdPreviewZoomDraftPercent((current) => {
      const clamped = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent)
      return current === clamped ? current : clamped
    })
  }, [osmdPreviewZoomPercent])

  useEffect(() => {
    osmdPreviewHorizontalMarginPxRef.current = clampOsmdPreviewHorizontalMarginPx(osmdPreviewHorizontalMarginPx)
  }, [osmdPreviewHorizontalMarginPx])

  useEffect(() => {
    osmdPreviewFirstPageTopMarginPxRef.current = clampOsmdPreviewTopMarginPx(osmdPreviewFirstPageTopMarginPx)
  }, [osmdPreviewFirstPageTopMarginPx])

  useEffect(() => {
    osmdPreviewTopMarginPxRef.current = clampOsmdPreviewTopMarginPx(osmdPreviewTopMarginPx)
  }, [osmdPreviewTopMarginPx])

  useEffect(() => {
    osmdPreviewBottomMarginPxRef.current = clampOsmdPreviewBottomMarginPx(osmdPreviewBottomMarginPx)
  }, [osmdPreviewBottomMarginPx])

  useEffect(() => {
    osmdPreviewShowPageNumbersRef.current = osmdPreviewShowPageNumbers
  }, [osmdPreviewShowPageNumbers])

  useEffect(() => {
    osmdPreviewPageIndexRef.current = osmdPreviewPageIndex
  }, [osmdPreviewPageIndex])

  useEffect(() => {
    return () => {
      if (osmdPreviewZoomCommitTimerRef.current !== null) {
        window.clearTimeout(osmdPreviewZoomCommitTimerRef.current)
        osmdPreviewZoomCommitTimerRef.current = null
      }
      if (osmdPreviewMarginApplyTimerRef.current !== null) {
        window.clearTimeout(osmdPreviewMarginApplyTimerRef.current)
        osmdPreviewMarginApplyTimerRef.current = null
      }
    }
  }, [])

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
        const deleteAttempt = applyDeleteAccidentalSelection({
          pairs: measurePairs,
          selection: activeAccidentalSelection,
          importedNoteLookup: importedNoteLookupRef.current,
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
    undoLastScoreEdit,
  ])

  useEffect(() => {
    if (!isOsmdPreviewOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeOsmdPreview()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeOsmdPreview, isOsmdPreviewOpen])

  useEffect(() => {
    if (!isOsmdPreviewOpen) return
    if (!osmdPreviewXml.trim()) {
      setOsmdPreviewError('没有可预览的MusicXML数据。')
      setOsmdPreviewStatusText('')
      return
    }

    let canceled = false

    const renderPreview = async () => {
      try {
        const container = osmdPreviewContainerRef.current
        if (!container) return
        setOsmdPreviewError('')
        setOsmdPreviewStatusText('正在生成OSMD预览...')
        container.innerHTML = ''

        const osmdModule = await import('opensheetmusicdisplay')
        if (canceled) return

        const osmd = new osmdModule.OpenSheetMusicDisplay(container, {
          autoResize: false,
          backend: 'svg',
          drawTitle: true,
          pageFormat: 'A4_P',
          drawMeasureNumbers: true,
          drawMeasureNumbersOnlyAtSystemStart: true,
          useXMLMeasureNumbers: true,
        })
        const fastStageXml = buildFastOsmdPreviewXml(osmdPreviewXml, OSMD_PREVIEW_FAST_STAGE_MEASURE_LIMIT)
        const useFastStageXml = fastStageXml !== osmdPreviewXml

        await osmd.load(useFastStageXml ? fastStageXml : osmdPreviewXml)
        if (canceled) return
        const previewInstance = osmd as unknown as OsmdPreviewInstance
        osmd.Zoom = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent) / 100
        // Stage 1: render once and show page 1 as early as possible.
        applyOsmdPreviewHorizontalMargins(previewInstance, osmdPreviewHorizontalMarginPxRef.current)
        applyOsmdPreviewVerticalMargins(
          previewInstance,
          OSMD_PREVIEW_LAYOUT_TOP_MARGIN_PX,
          clampOsmdPreviewBottomMarginPx(
            Math.min(osmdPreviewBottomMarginPxRef.current, DEFAULT_OSMD_PREVIEW_BOTTOM_MARGIN_PX),
          ),
        )
        previewInstance.render()
        if (canceled) return
        osmdPreviewInstanceRef.current = previewInstance
        let renderedPages = collectOsmdPreviewPages(container)
        osmdPreviewPagesRef.current = renderedPages
        applyOsmdPreviewPageNumbers(renderedPages, osmdPreviewShowPageNumbersRef.current)
        let graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
        let nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
        setOsmdPreviewPageCount(nextPageCount)
        applyOsmdPreviewPageVisibility(renderedPages, 0)
        rebuildOsmdPreviewNoteLookup()
        setOsmdPreviewStatusText(
          useFastStageXml ? '已显示第一页，正在后台加载完整曲谱...' : '已显示第一页，正在优化后续分页...',
        )

        // Give browser a paint chance before heavy re-balance.
        await new Promise<void>((resolve) => {
          if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            resolve()
            return
          }
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve())
          })
        })
        if (canceled) return

        if (useFastStageXml) {
          setOsmdPreviewStatusText('正在加载完整曲谱并优化分页...')
          await osmd.load(osmdPreviewXml)
          if (canceled) return
          osmd.Zoom = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent) / 100
        }

        // Stage 2: full re-balance for all pages.
        osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
          previewInstance,
          osmdPreviewHorizontalMarginPxRef.current,
          osmdPreviewFirstPageTopMarginPxRef.current,
          osmdPreviewTopMarginPxRef.current,
          osmdPreviewBottomMarginPxRef.current,
        )
        if (canceled) return
        renderedPages = collectOsmdPreviewPages(container)
        osmdPreviewPagesRef.current = renderedPages
        applyOsmdPreviewPageNumbers(renderedPages, osmdPreviewShowPageNumbersRef.current)
        graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
        nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
        setOsmdPreviewPageCount(nextPageCount)
        applyOsmdPreviewPageVisibility(renderedPages, 0)
        rebuildOsmdPreviewNoteLookup()
        setOsmdPreviewStatusText('')
      } catch (error) {
        if (canceled) return
        setOsmdPreviewStatusText('')
        const message = error instanceof Error ? error.message : 'OSMD预览渲染失败。'
        setOsmdPreviewError(message)
      }
    }

    void renderPreview()

    return () => {
      canceled = true
      osmdPreviewInstanceRef.current = null
      osmdPreviewPagesRef.current = []
      const container = osmdPreviewContainerRef.current
      if (container) {
        container.innerHTML = ''
      }
      osmdPreviewNoteLookupByDomIdRef.current.clear()
      osmdPreviewNoteLookupBySelectionRef.current.clear()
      osmdPreviewSelectedSelectionKeyRef.current = null
    }
  }, [isOsmdPreviewOpen, osmdPreviewXml, rebuildOsmdPreviewNoteLookup])

  useEffect(() => {
    setOsmdPreviewPageIndex((current) => Math.max(0, Math.min(current, osmdPreviewPageCount - 1)))
  }, [osmdPreviewPageCount])

  useEffect(() => {
    if (!isOsmdPreviewOpen) return
    const osmd = osmdPreviewInstanceRef.current
    if (!osmd) return
    const nextZoom = clampOsmdPreviewZoomPercent(osmdPreviewZoomPercent) / 100
    if (Math.abs(osmd.Zoom - nextZoom) < 1e-6) return
    osmd.Zoom = nextZoom
    osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
      osmd,
      osmdPreviewHorizontalMarginPxRef.current,
      osmdPreviewFirstPageTopMarginPxRef.current,
      osmdPreviewTopMarginPxRef.current,
      osmdPreviewBottomMarginPxRef.current,
    )
    const container = osmdPreviewContainerRef.current
    if (!container) return
    const renderedPages = collectOsmdPreviewPages(container)
    osmdPreviewPagesRef.current = renderedPages
    applyOsmdPreviewPageNumbers(renderedPages, osmdPreviewShowPageNumbersRef.current)
    const graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
    const nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
    setOsmdPreviewPageCount(nextPageCount)
    applyOsmdPreviewPageVisibility(renderedPages, osmdPreviewPageIndexRef.current)
    rebuildOsmdPreviewNoteLookup()
  }, [isOsmdPreviewOpen, osmdPreviewZoomPercent, rebuildOsmdPreviewNoteLookup])

  useEffect(() => {
    if (!isOsmdPreviewOpen) return
    const osmd = osmdPreviewInstanceRef.current
    if (!osmd) return
    if (osmdPreviewMarginApplyTimerRef.current !== null) {
      window.clearTimeout(osmdPreviewMarginApplyTimerRef.current)
      osmdPreviewMarginApplyTimerRef.current = null
    }
    osmdPreviewMarginApplyTimerRef.current = window.setTimeout(() => {
      osmdPreviewMarginApplyTimerRef.current = null
      const container = osmdPreviewContainerRef.current
      osmdPreviewLastRebalanceStatsRef.current = renderAndRebalanceOsmdPreview(
        osmd,
        osmdPreviewHorizontalMarginPx,
        osmdPreviewFirstPageTopMarginPx,
        osmdPreviewTopMarginPx,
        osmdPreviewBottomMarginPx,
      )
      if (!container) return
      const renderedPages = collectOsmdPreviewPages(container)
      osmdPreviewPagesRef.current = renderedPages
      applyOsmdPreviewPageNumbers(renderedPages, osmdPreviewShowPageNumbersRef.current)
      const graphicPageCount = osmd.GraphicSheet?.MusicPages?.length ?? 0
      const nextPageCount = Math.max(1, renderedPages.length, graphicPageCount)
      setOsmdPreviewPageCount(nextPageCount)
      applyOsmdPreviewPageVisibility(renderedPages, osmdPreviewPageIndexRef.current)
      rebuildOsmdPreviewNoteLookup()
    }, OSMD_PREVIEW_MARGIN_APPLY_DEBOUNCE_MS)
    return () => {
      if (osmdPreviewMarginApplyTimerRef.current !== null) {
        window.clearTimeout(osmdPreviewMarginApplyTimerRef.current)
        osmdPreviewMarginApplyTimerRef.current = null
      }
    }
  }, [
    isOsmdPreviewOpen,
    osmdPreviewHorizontalMarginPx,
    osmdPreviewFirstPageTopMarginPx,
    osmdPreviewTopMarginPx,
    osmdPreviewBottomMarginPx,
    rebuildOsmdPreviewNoteLookup,
  ])

  useEffect(() => {
    applyOsmdPreviewPageVisibility(osmdPreviewPagesRef.current, osmdPreviewPageIndex)
  }, [osmdPreviewPageIndex, osmdPreviewPageCount])

  useEffect(() => {
    applyOsmdPreviewPageNumbers(osmdPreviewPagesRef.current, osmdPreviewShowPageNumbers)
  }, [osmdPreviewShowPageNumbers, osmdPreviewPageCount])

  const safeOsmdPreviewPaperScalePercent = clampOsmdPreviewPaperScalePercent(osmdPreviewPaperScalePercent)
  const safeOsmdPreviewHorizontalMarginPx = clampOsmdPreviewHorizontalMarginPx(osmdPreviewHorizontalMarginPx)
  const safeOsmdPreviewFirstPageTopMarginPx = clampOsmdPreviewTopMarginPx(osmdPreviewFirstPageTopMarginPx)
  const safeOsmdPreviewTopMarginPx = clampOsmdPreviewTopMarginPx(osmdPreviewTopMarginPx)
  const safeOsmdPreviewBottomMarginPx = clampOsmdPreviewBottomMarginPx(osmdPreviewBottomMarginPx)
  const osmdPreviewPaperScale = safeOsmdPreviewPaperScalePercent / 100
  const osmdPreviewPaperWidthPx = A4_PAGE_WIDTH * osmdPreviewPaperScale
  const osmdPreviewPaperHeightPx = A4_PAGE_HEIGHT * osmdPreviewPaperScale

  const scoreSurfaceOffsetXPx = horizontalRenderOffsetX * scoreScaleX
  const scaledRenderedScoreHeight = Math.max(1, scoreHeight * scoreScaleY)
  const scoreSurfaceOffsetYPx = Math.max(0, (displayScoreHeight - scaledRenderedScoreHeight) / 2)
  const playheadStatus: 'idle' | 'playing' = playbackCursorColor === 'yellow' ? 'playing' : 'idle'
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
  const measurePlayheadViewportGeometry = useCallback(() => {
    const scrollHost = scoreScrollRef.current
    const playheadElement = playheadElementRef.current
    if (!scrollHost || !playheadElement) return null

    const scrollHostRect = scrollHost.getBoundingClientRect()
    const playheadRect = playheadElement.getBoundingClientRect()
    return {
      scrollLeft: scrollHost.scrollLeft,
      scrollTop: scrollHost.scrollTop,
      clientWidth: scrollHost.clientWidth,
      clientHeight: scrollHost.clientHeight,
      maxScrollLeft: Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth),
      maxScrollTop: Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight),
      viewportLeft: playheadRect.left - scrollHostRect.left,
      viewportRight: playheadRect.right - scrollHostRect.left,
      viewportTop: playheadRect.top - scrollHostRect.top,
      viewportBottom: playheadRect.bottom - scrollHostRect.top,
    }
  }, [])
  useEffect(() => {
    if (playheadStatus !== 'playing' || !playheadRectPx || !playheadFollowEnabled) return

    const scrollHost = scoreScrollRef.current
    const geometry = measurePlayheadViewportGeometry()
    if (!scrollHost || !geometry) return

    let nextScrollLeft = geometry.scrollLeft
    let nextScrollTop = geometry.scrollTop

    if (geometry.viewportLeft < 0) {
      nextScrollLeft = Math.max(
        0,
        Math.min(
          geometry.maxScrollLeft,
          geometry.scrollLeft + geometry.viewportLeft - PLAYHEAD_HORIZONTAL_SCROLL_LEFT_ANCHOR_PX,
        ),
      )
    } else if (geometry.clientWidth - geometry.viewportRight <= PLAYHEAD_HORIZONTAL_SCROLL_TRIGGER_MARGIN_PX) {
      const targetScrollLeft = Math.max(
        0,
        geometry.scrollLeft + geometry.viewportLeft - PLAYHEAD_HORIZONTAL_SCROLL_LEFT_ANCHOR_PX,
      )
      if (targetScrollLeft <= geometry.maxScrollLeft) {
        nextScrollLeft = targetScrollLeft
      } else {
        nextScrollLeft = geometry.maxScrollLeft
      }
    }

    if (geometry.viewportTop - PLAYHEAD_VIEWPORT_MARGIN_Y_PX < 0) {
      nextScrollTop = Math.max(0, geometry.scrollTop + geometry.viewportTop - PLAYHEAD_VIEWPORT_MARGIN_Y_PX)
    } else if (geometry.viewportBottom + PLAYHEAD_VIEWPORT_MARGIN_Y_PX > geometry.clientHeight) {
      nextScrollTop = Math.max(
        0,
        geometry.scrollTop + geometry.viewportBottom + PLAYHEAD_VIEWPORT_MARGIN_Y_PX - geometry.clientHeight,
      )
    }

    nextScrollLeft = Math.max(0, Math.min(geometry.maxScrollLeft, nextScrollLeft))
    nextScrollTop = Math.max(0, Math.min(geometry.maxScrollTop, nextScrollTop))

    if (Math.abs(nextScrollLeft - geometry.scrollLeft) < 0.5 && Math.abs(nextScrollTop - geometry.scrollTop) < 0.5) {
      return
    }
    scrollHost.scrollTo({
      left: nextScrollLeft,
      top: nextScrollTop,
      behavior: 'auto',
    })
  }, [measurePlayheadViewportGeometry, playheadFollowEnabled, playheadRectPx, playheadStatus, playbackSessionId])
  const measurePlayheadDebugLogRow = useCallback((sequence: number): PlayheadDebugLogRow | null => {
    const geometry = measurePlayheadViewportGeometry()
    if (!geometry) return null

    const roundCoord = (value: number): number => Number(value.toFixed(1))
    const containerLeftX = 0
    const containerRightX = roundCoord(geometry.clientWidth)
    const playheadX = roundCoord(geometry.viewportLeft)
    const distanceToRightEdge = roundCoord(containerRightX - playheadX)
    return {
      seq: sequence,
      playheadX,
      containerLeftX,
      containerRightX,
      distanceToRightEdge,
    }
  }, [measurePlayheadViewportGeometry])
  const appendPlayheadDebugLogRow = useCallback(() => {
    const nextRow = measurePlayheadDebugLogRow(playheadDebugSequenceRef.current + 1)
    if (!nextRow) return
    const snapshotKey = JSON.stringify({
      playheadX: nextRow.playheadX,
      containerLeftX: nextRow.containerLeftX,
      containerRightX: nextRow.containerRightX,
      distanceToRightEdge: nextRow.distanceToRightEdge,
    })
    if (playheadDebugLastSnapshotKeyRef.current === snapshotKey) return

    playheadDebugSequenceRef.current += 1
    nextRow.seq = playheadDebugSequenceRef.current
    playheadDebugLastSnapshotKeyRef.current = snapshotKey
    latestPlayheadDebugSnapshotRef.current = nextRow
    setPlayheadDebugLogRows((current) => {
      const nextRows = [...current, nextRow]
      if (nextRows.length > 200) {
        nextRows.splice(0, nextRows.length - 200)
      }
      playheadDebugLogRowsRef.current = nextRows
      return nextRows
    })
  }, [measurePlayheadDebugLogRow])
  const schedulePlayheadDebugLogRow = useCallback(() => {
    if (playheadDebugMeasureRafRef.current !== null) {
      window.cancelAnimationFrame(playheadDebugMeasureRafRef.current)
      playheadDebugMeasureRafRef.current = null
    }
    playheadDebugMeasureRafRef.current = window.requestAnimationFrame(() => {
      playheadDebugMeasureRafRef.current = window.requestAnimationFrame(() => {
        playheadDebugMeasureRafRef.current = null
        appendPlayheadDebugLogRow()
      })
    })
  }, [appendPlayheadDebugLogRow])
  const playheadDebugLogText = useMemo(() => {
    if (playheadDebugLogRows.length === 0) {
      return '等待播放线位置数据...'
    }
    return playheadDebugLogRows
      .map((row) => {
        return [
          `播放线X：${row.playheadX === null ? '暂无' : row.playheadX.toFixed(1)}`,
          `容器左边缘X：${row.containerLeftX.toFixed(1)}`,
          `容器右边缘X：${row.containerRightX.toFixed(1)}`,
          `距右边缘：${row.distanceToRightEdge === null ? '暂无' : row.distanceToRightEdge.toFixed(1)}`,
        ].join(' ｜ ')
      })
      .join('\n')
  }, [playheadDebugLogRows])
  useEffect(() => {
    const currentPointKey = playbackCursorPoint ? getPlaybackPointKey(playbackCursorPoint) : null
    const shouldRefreshIdleLog =
      playheadDebugLogRowsRef.current.length === 0 || playheadDebugLastIdlePointKeyRef.current !== currentPointKey
    if (playheadStatus !== 'playing' && !shouldRefreshIdleLog) {
      return
    }
    schedulePlayheadDebugLogRow()
    playheadDebugLastIdlePointKeyRef.current = currentPointKey
  }, [playbackCursorPoint, playheadRectPx, playheadStatus, schedulePlayheadDebugLogRow])
  useEffect(() => {
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) return

    const handleScroll = () => {
      if (playheadStatus !== 'playing') return
      if (playheadDebugScrollRafRef.current !== null) return
      playheadDebugScrollRafRef.current = window.requestAnimationFrame(() => {
        playheadDebugScrollRafRef.current = null
        schedulePlayheadDebugLogRow()
      })
    }

    scrollHost.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollHost.removeEventListener('scroll', handleScroll)
      if (playheadDebugScrollRafRef.current !== null) {
        window.cancelAnimationFrame(playheadDebugScrollRafRef.current)
        playheadDebugScrollRafRef.current = null
      }
      if (playheadDebugMeasureRafRef.current !== null) {
        window.cancelAnimationFrame(playheadDebugMeasureRafRef.current)
        playheadDebugMeasureRafRef.current = null
      }
    }
  }, [playheadStatus, schedulePlayheadDebugLogRow])
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
            rightX: layout.rightX,
            spacingRightX: layout.spacingRightX,
            noteHeads: layout.noteHeads.map((head) => ({
              keyIndex: head.keyIndex,
              pitch: head.pitch,
              x: head.x,
              y: head.y,
            })),
            accidentalCoords: Object.entries(layout.accidentalRightXByKeyIndex)
              .map(([rawKeyIndex, rightX]) => ({
                keyIndex: Number(rawKeyIndex),
                rightX,
              }))
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
          if (Number.isFinite(accidental.rightX)) {
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

  const dumpOsmdPreviewSystemMetrics = useCallback(() => {
    const osmd = osmdPreviewInstanceRef.current
    if (!osmd) {
      return {
        hasPreview: false,
        pageCount: 0,
        pages: [] as Array<{
          pageIndex: number
          pageHeight: number | null
          pageHeightRaw: number | null
          bottomGap: number | null
          bottomGapRaw: number | null
          systemCount: number
          systemY: number[]
          systemHeights: number[]
        }>,
      }
    }
    const pages = osmd.GraphicSheet?.MusicPages ?? []
    const rulePageHeight = osmd.EngravingRules?.PageHeight
    const hasRulePageHeight =
      typeof rulePageHeight === 'number' && Number.isFinite(rulePageHeight) && rulePageHeight > 0
    const referencePageHeight = pages.reduce((maxHeight, page) => {
      const candidate = page.PositionAndShape?.Size?.height
      if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
        return maxHeight
      }
      return Math.max(maxHeight, candidate)
    }, 0)
    const normalizedPageHeight = hasRulePageHeight
      ? rulePageHeight
      : referencePageHeight > 0
        ? referencePageHeight
        : null
    return {
      hasPreview: true,
      pageCount: pages.length,
      pages: pages.map((page, pageIndex) => {
        const systems = page.MusicSystems ?? []
        const rawPageHeight =
          typeof page.PositionAndShape?.Size?.height === 'number' && Number.isFinite(page.PositionAndShape.Size.height)
            ? Number(page.PositionAndShape.Size.height.toFixed(3))
            : null
        const lastSystemBottom =
          systems.length > 0
            ? (systems[systems.length - 1].PositionAndShape?.RelativePosition?.y ?? 0) +
              (systems[systems.length - 1].PositionAndShape?.Size?.height ?? 0)
            : null
        return {
          pageIndex,
          pageHeight: normalizedPageHeight !== null ? Number(normalizedPageHeight.toFixed(3)) : rawPageHeight,
          pageHeightRaw: rawPageHeight,
          bottomGap:
            normalizedPageHeight !== null && typeof lastSystemBottom === 'number' && Number.isFinite(lastSystemBottom)
              ? Number(
                  (
                    normalizedPageHeight -
                    lastSystemBottom
                  ).toFixed(3),
                )
              : null,
          bottomGapRaw:
            rawPageHeight !== null && typeof lastSystemBottom === 'number' && Number.isFinite(lastSystemBottom)
              ? Number((rawPageHeight - lastSystemBottom).toFixed(3))
              : null,
          systemCount: systems.length,
          systemY: systems.map((system) => {
            const y = system.PositionAndShape?.RelativePosition?.y
            return typeof y === 'number' && Number.isFinite(y) ? Number(y.toFixed(3)) : NaN
          }),
          systemHeights: systems.map((system) => {
            const h = system.PositionAndShape?.Size?.height
            return typeof h === 'number' && Number.isFinite(h) ? Number(h.toFixed(3)) : NaN
          }),
        }
      }),
    }
  }, [])

  useEffect(() => {
    return () => {
      if (firstMeasureDebugRafRef.current !== null) {
        window.cancelAnimationFrame(firstMeasureDebugRafRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const debugApi = {
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
    }
    ;(window as unknown as { __scoreDebug?: typeof debugApi }).__scoreDebug = debugApi
    return () => {
      delete (window as unknown as { __scoreDebug?: typeof debugApi }).__scoreDebug
    }
  }, [
    importMusicXmlTextWithCollapseReset,
    playScore,
    dumpAllMeasureCoordinateReport,
    dumpOsmdPreviewSystemMetrics,
    pageCount,
    safeCurrentPage,
    safeManualScalePercent,
    autoScaleEnabled,
    baseScoreScale,
    scoreScale,
    scoreScaleX,
    scoreScaleY,
    spacingLayoutMode,
    showNoteHeadJianpuEnabled,
    dragDebugFramesRef,
    dragRef,
    scoreOverlayRef,
    scoreRef,
    overlayLastRectRef,
    osmdPreviewLastRebalanceStatsRef,
    systemsPerPage,
    visibleSystemRange,
    activeSelection,
    playbackCursorState,
    playbackSessionId,
    playheadStatus,
    playbackTimelineEvents,
    chordRulerMarkerMetaByKey,
    measurePlayheadDebugLogRow,
    applyChordSelectionRange,
    activeChordSelection,
    selectedMeasureHighlightRectPx,
  ])

  return (
    <main className="app-shell">
      <ScoreControls
        isPlaying={isPlaying}
        onPlayScore={playScore}
        onStopScore={stopActivePlaybackSession}
        onReset={resetScoreWithCollapseReset}
        playheadFollowEnabled={playheadFollowEnabled}
        onTogglePlayheadFollow={() => setPlayheadFollowEnabled((enabled) => !enabled)}
        showChordDegreeEnabled={showChordDegreeEnabled}
        onToggleChordDegreeDisplay={() => setShowChordDegreeEnabled((enabled) => !enabled)}
        showInScoreMeasureNumbers={showInScoreMeasureNumbers}
        onToggleInScoreMeasureNumbers={() => setShowInScoreMeasureNumbers((current) => !current)}
        showNoteHeadJianpuEnabled={showNoteHeadJianpuEnabled}
        onToggleNoteHeadJianpuDisplay={() => setShowNoteHeadJianpuEnabled((current) => !current)}
        autoScaleEnabled={autoScaleEnabled}
        autoScalePercent={autoScalePercent}
        onToggleAutoScale={() => setAutoScaleEnabled((enabled) => !enabled)}
        manualScalePercent={safeManualScalePercent}
        onManualScalePercentChange={(nextPercent) => setManualScalePercent(clampScalePercent(nextPercent))}
        canvasHeightPercent={safeCanvasHeightPercent}
        onCanvasHeightPercentChange={(nextPercent) => setCanvasHeightPercent(clampCanvasHeightPercent(nextPercent))}
        pageHorizontalPaddingPx={pageHorizontalPaddingPx}
        chordMarkerUiScalePercent={safeChordMarkerUiScalePercent}
        chordMarkerPaddingPx={safeChordMarkerPaddingPx}
        baseMinGap32Px={timeAxisSpacingConfig.baseMinGap32Px}
        leadingBarlineGapPx={timeAxisSpacingConfig.leadingBarlineGapPx}
        durationGapRatio32={timeAxisSpacingConfig.durationGapRatios.thirtySecond}
        durationGapRatio16={timeAxisSpacingConfig.durationGapRatios.sixteenth}
        durationGapRatio8={timeAxisSpacingConfig.durationGapRatios.eighth}
        durationGapRatio4={timeAxisSpacingConfig.durationGapRatios.quarter}
        durationGapRatio2={timeAxisSpacingConfig.durationGapRatios.half}
        durationGapRatioWhole={timeAxisSpacingConfig.durationGapRatios.whole}
        onPageHorizontalPaddingPxChange={(nextValue) =>
          setPageHorizontalPaddingPx(clampPageHorizontalPaddingPx(nextValue))
        }
        onChordMarkerUiScalePercentChange={(nextValue) =>
          setChordMarkerUiScalePercent(clampChordMarkerUiScalePercent(nextValue))
        }
        onChordMarkerPaddingPxChange={(nextValue) =>
          setChordMarkerPaddingPx(clampChordMarkerPaddingPx(nextValue))
        }
        onBaseMinGap32PxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            baseMinGap32Px: clampBaseMinGap32Px(nextValue),
          }))
        }
        onLeadingBarlineGapPxChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            leadingBarlineGapPx: clampLeadingBarlineGapPx(nextValue),
          }))
        }
        onDurationGapRatio32Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              thirtySecond: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio16Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              sixteenth: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio8Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              eighth: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio4Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              quarter: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatio2Change={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              half: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onDurationGapRatioWholeChange={(nextValue) =>
          setTimeAxisSpacingConfig((current) => ({
            ...current,
            durationGapRatios: {
              ...current.durationGapRatios,
              whole: clampDurationGapRatio(nextValue),
            },
          }))
        }
        onResetSpacingConfig={() => {
          setTimeAxisSpacingConfig({
            ...DEFAULT_TIME_AXIS_SPACING_CONFIG,
            durationGapRatios: { ...DEFAULT_TIME_AXIS_SPACING_CONFIG.durationGapRatios },
          })
          setPageHorizontalPaddingPx(DEFAULT_PAGE_HORIZONTAL_PADDING_PX)
          setChordMarkerUiScalePercent(DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT)
          setChordMarkerPaddingPx(DEFAULT_CHORD_MARKER_PADDING_PX)
        }}
        onOpenMusicXmlFilePicker={openMusicXmlFilePicker}
        onLoadSampleMusicXml={loadSampleMusicXmlWithCollapseReset}
        onLoadWholeNoteDemo={loadWholeNoteDemoWithCollapseReset}
        onLoadHalfNoteDemo={loadHalfNoteDemoWithCollapseReset}
        onExportMusicXmlFile={exportMusicXmlFile}
        onOpenOsmdPreview={openOsmdPreview}
        onOpenBeamGroupingTool={openBeamGroupingTool}
        isNotationPaletteOpen={isNotationPaletteOpen}
        onToggleNotationPalette={toggleNotationPalette}
        onCloseNotationPalette={closeNotationPalette}
        notationPaletteSelection={notationPaletteSelection}
        notationPaletteLastAction={notationPaletteLastAction}
        notationPaletteActiveItemIdsOverride={derivedNotationPaletteDisplay?.activeItemIds ?? null}
        notationPaletteSummaryOverride={derivedNotationPaletteDisplay?.summary ?? null}
        onNotationPaletteSelectionChange={onNotationPaletteSelectionChange}
        onOpenDirectOsmdFilePicker={openDirectOsmdFilePicker}
        onImportMusicXmlFromTextarea={importMusicXmlFromTextareaWithCollapseReset}
        midiSupported={midiSupported}
        midiPermissionState={midiPermissionState}
        midiInputOptions={midiInputOptions}
        selectedMidiInputId={selectedMidiInputId}
        onSelectedMidiInputIdChange={setSelectedMidiInputId}
        fileInputRef={fileInputRef}
        osmdDirectFileInputRef={osmdDirectFileInputRef}
        onMusicXmlFileChange={onMusicXmlFileChangeWithCollapseReset}
        onOsmdDirectFileChange={onOsmdDirectFileChange}
        importFeedback={importFeedback}
        rhythmPreset={rhythmPreset}
        activeBuiltInDemo={activeBuiltInDemo}
        onApplyRhythmPreset={applyRhythmPresetWithCollapseReset}
      />

      <ScoreBoard
        scoreScrollRef={scoreScrollRef}
        scoreStageRef={scoreStageRef}
        playheadRef={playheadElementRef}
        displayScoreWidth={displayScoreWidth}
        displayScoreHeight={displayScoreHeight}
        chordMarkerStyleMetrics={chordMarkerStyleMetrics}
        scoreSurfaceLogicalWidthPx={scoreWidth}
        scoreSurfaceLogicalHeightPx={scoreHeight}
        scoreScaleX={scoreScaleX}
        scoreScaleY={scoreScaleY}
        scoreSurfaceOffsetXPx={scoreSurfaceOffsetXPx}
        scoreSurfaceOffsetYPx={scoreSurfaceOffsetYPx}
        measureRulerTicks={measureRulerTicks}
        chordRulerMarkers={chordRulerMarkers}
        onChordRulerMarkerClick={onChordRulerMarkerClick}
        playheadRectPx={playheadRectPx}
        playheadStatus={playheadStatus}
        selectedMeasureHighlightRectPx={selectedMeasureHighlightRectPx}
        draggingSelection={draggingSelection}
        scoreRef={scoreRef}
        scoreOverlayRef={scoreOverlayRef}
        onBeginDrag={onBeginDragWithFirstMeasureDebug}
        onSurfacePointerMove={onSurfacePointerMove}
        onEndDrag={onEndDragWithFirstMeasureDebug}
        selectedStaffLabel={activeSelection.staff === 'treble' ? '高音谱表' : '低音谱表'}
        selectedPitchLabel={currentSelectionPitchLabel}
        selectedDurationLabel={toDisplayDuration(currentSelection.duration)}
        selectedPosition={currentSelectionPosition}
        selectedPoolSize={activePool.length}
        trebleSequenceText={trebleSequenceText}
        bassSequenceText={bassSequenceText}
        playheadDebugLogText={playheadDebugLogText}
      />

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


