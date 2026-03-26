import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Renderer } from 'vexflow'
import './App.css'
import {
  A4_PAGE_HEIGHT,
  A4_PAGE_WIDTH,
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
} from './score/constants'
import { buildAccidentalStateBeforeNote, getEffectivePitchForStaffPosition } from './score/accidentals'
import {
  toDisplayDuration,
} from './score/layout/demand'
import {
  DEFAULT_TIME_AXIS_SPACING_CONFIG,
} from './score/layout/timeAxisSpacing'
import { solveHorizontalMeasureWidths } from './score/layout/horizontalMeasureWidthSolver'
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
import { useChordMarkerController } from './score/hooks/useChordMarkerController'
import { useScoreMutationController } from './score/hooks/useScoreMutationController'
import { useEditorActionWrappers } from './score/hooks/useEditorActionWrappers'
import { useScoreSelectionController } from './score/hooks/useScoreSelectionController'
import {
  getInitialChordDegreeDisplayEnabled,
  getInitialPlayheadFollowEnabled,
  useEditorPreferencePersistence,
} from './score/hooks/useEditorPreferencePersistence'
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
import { applyDeleteMeasureSelection } from './score/measureEdits'
import { isStaffFullMeasureRest, resolvePairTimeSignature } from './score/measureRestUtils'
import { appendIntervalKey, deleteSelectedKey, findSelectionLocationInPairs } from './score/keyboardEdits'
import { applyClipboardPaste, buildClipboardFromSelections } from './score/copyPasteEdits'
import { getStepOctaveAlterFromPitch, toPitchFromStepAlter } from './score/pitchMath'
import { resolveForwardTieTargets, resolvePreviousTieTarget } from './score/tieChain'
import { buildSelectionGroupMoveTargets } from './score/selectionGroupTargets'
import { buildChordRulerEntries, type ChordRulerEntry } from './score/chordRuler'
import { mergeFullMeasureRestCollapseScopeKeys, toMeasureStaffScopeKey } from './score/fullMeasureRestCollapse'
import {
  buildFirstMeasureDiffReport,
  buildMeasureCoordinateDebugReport,
  captureFirstMeasureSnapshot,
  type FirstMeasureDragContext,
  type FirstMeasureSnapshot,
} from './score/scoreDebugReports'
import type { MeasureTimelineBundle } from './score/timeline/types'
import type { NoteClipboardPayload } from './score/copyPasteTypes'
import {
  getDefaultNotationPaletteSelection,
  toggleDottedDuration,
  toTargetDurationFromPalette,
  type NotationPaletteItem,
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
  const [playheadFollowEnabled, setPlayheadFollowEnabled] = useState(() => getInitialPlayheadFollowEnabled())
  const [showChordDegreeEnabled, setShowChordDegreeEnabled] = useState(() => getInitialChordDegreeDisplayEnabled())
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
  const firstMeasureDragContextRef = useRef<FirstMeasureDragContext | null>(null)
  const firstMeasureDebugRafRef = useRef<number | null>(null)
  const importFeedbackRef = useRef<ImportFeedback>(importFeedback)
  const activeSelectionRef = useRef<Selection>(activeSelection)
  const selectedSelectionsRef = useRef<Selection[]>(selectedSelections)
  const fullMeasureRestCollapseScopeKeysRef = useRef<string[]>(fullMeasureRestCollapseScopeKeys)
  const isSelectionVisibleRef = useRef<boolean>(isSelectionVisible)
  const draggingSelectionRef = useRef<Selection | null>(draggingSelection)
  const clearDragOverlayRef = useRef<() => void>(() => {})
  const layoutReflowHintRef = useRef<LayoutReflowHint | null>(null)
  const midiStepChainRef = useRef(false)
  const midiStepLastSelectionRef = useRef<Selection | null>(null)
  const noteClipboardRef = useRef<NoteClipboardPayload | null>(null)
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
  const scoreSurfaceOffsetXPx = horizontalRenderOffsetX * scoreScaleX
  const scaledRenderedScoreHeight = Math.max(1, scoreHeight * scoreScaleY)
  const scoreSurfaceOffsetYPx = Math.max(0, (displayScoreHeight - scaledRenderedScoreHeight) / 2)
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
  const clearActiveAccidentalSelection = useCallback(() => {
    setActiveAccidentalSelection(null)
  }, [])
  const clearActiveTieSelection = useCallback(() => {
    setActiveTieSelection(null)
  }, [])
  const clearSelectedMeasureScope = useCallback(() => {
    setSelectedMeasureScope(null)
  }, [])
  const clearDraggingSelection = useCallback(() => {
    setDraggingSelection(null)
  }, [])
  const clearDragPreviewState = useCallback(() => {
    setDragPreviewState(null)
  }, [])
  const clearImportedChordRulerEntries = useCallback(() => {
    setImportedChordRulerEntriesByPairFromImport(null)
  }, [])
  const resetMidiStepChain = useCallback(() => {
    midiStepChainRef.current = false
    midiStepLastSelectionRef.current = null
  }, [])
  const {
    chordMarkerLayoutRevision,
    activeChordSelection,
    clearActiveChordSelection,
    onAfterScoreRender,
    measureRulerTicks,
    chordRulerMarkerMetaByKey,
    chordRulerMarkers,
    applyChordSelectionRange,
    onChordRulerMarkerClick,
    selectedMeasureHighlightRectPx,
  } = useChordMarkerController({
    measurePairs,
    measurePairsRef,
    chordRulerEntriesByPair,
    horizontalMeasureFramesByPair,
    measureTimeSignaturesFromImport,
    measureKeyFifthsFromImport,
    measureKeyModesFromImport,
    horizontalRenderOffsetX,
    horizontalRenderOffsetXRef,
    noteLayoutsByPairRef,
    measureLayoutsRef,
    measureTimelineBundlesRef,
    scoreScaleX,
    scoreScaleY,
    scoreSurfaceOffsetXPx,
    scoreSurfaceOffsetYPx,
    selectedMeasureScope,
    showChordDegreeEnabled,
    chordMarkerLabelLeftInsetPx: chordMarkerStyleMetrics.labelLeftInsetPx,
    stageBorderPx: SCORE_STAGE_BORDER_PX,
    chordHighlightPadXPx: CHORD_HIGHLIGHT_PAD_X_PX,
    chordHighlightPadYPx: CHORD_HIGHLIGHT_PAD_Y_PX,
    layoutStabilityKey,
    getMeasureFrameContentGeometry,
    setIsSelectionVisible,
    setSelectedSelections,
    setActiveSelection,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    clearDraggingSelection,
    resetMidiStepChain,
  })
  const {
    pushUndoSnapshot,
    undoLastScoreEdit,
    applyKeyboardEditResult,
    applyMidiReplacementByNoteNumber,
  } = useScoreMutationController({
    measurePairsRef,
    measurePairsFromImportRef,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImport,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImport,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImport,
    importedNoteLookupRef,
    selectedSelectionsRef,
    activeSelectionRef,
    isSelectionVisibleRef,
    fullMeasureRestCollapseScopeKeysRef,
    midiStepChainRef,
    midiStepLastSelectionRef,
    dragRef,
    draggingSelectionRef,
    isOsmdPreviewOpenRef,
    clearDragOverlayRef,
    clearDragPreviewState,
    clearDraggingSelection,
    resetMidiStepChain,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    clearActiveChordSelection,
    setMeasurePairsFromImport,
    clearImportedChordRulerEntries,
    setNotes,
    setBassNotes,
    setIsSelectionVisible,
    setFullMeasureRestCollapseScopeKeys,
    setActiveSelection,
    setSelectedSelections,
    setIsRhythmLinked,
    setMeasureKeyFifthsFromImport,
    setMeasureDivisionsFromImport,
    setMeasureTimeSignaturesFromImport,
  })
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
  clearDragOverlayRef.current = clearDragOverlay

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
  const {
    importMusicXmlTextWithCollapseReset,
    importMusicXmlFromTextareaWithCollapseReset,
    onMusicXmlFileChangeWithCollapseReset,
    loadSampleMusicXmlWithCollapseReset,
    loadWholeNoteDemoWithCollapseReset,
    loadHalfNoteDemoWithCollapseReset,
    resetScoreWithCollapseReset,
    applyRhythmPresetWithCollapseReset,
  } = useEditorActionWrappers({
    stopActivePlaybackSession,
    requestPlaybackCursorReset,
    clearActiveChordSelection,
    setActiveBuiltInDemo,
    setFullMeasureRestCollapseScopeKeys,
    importMusicXmlText,
    importMusicXmlFromTextarea,
    onMusicXmlFileChange,
    loadSampleMusicXml,
    loadWholeNoteDemo,
    loadHalfNoteDemo,
    resetScore,
    applyRhythmPreset,
  })

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

  const trebleSequenceText = useMemo(() => toSequencePreview(notes), [notes])
  const bassSequenceText = useMemo(() => toSequencePreview(bassNotes), [bassNotes])
  const isImportLoading = importFeedback.kind === 'loading'
  const importProgressPercent =
    typeof importFeedback.progress === 'number' ? Math.max(0, Math.min(100, importFeedback.progress)) : null
  const {
    currentSelection,
    currentSelectionPosition,
    currentSelectionPitchLabel,
    selectedPoolSize,
    derivedNotationPaletteDisplay,
  } = useScoreSelectionController({
    notes,
    bassNotes,
    measurePairs,
    activeSelection,
    selectedSelections,
    selectedMeasureScope,
    activeTieSelection,
    isSelectionVisible,
    draggingSelection,
    importFeedback,
    fallbackSelectionNote: INITIAL_NOTES[0],
    trebleNoteById,
    bassNoteById,
    trebleNoteIndexById,
    bassNoteIndexById,
    importedNoteLookupRef,
    activeSelectionRef,
    selectedSelectionsRef,
    fullMeasureRestCollapseScopeKeys,
    fullMeasureRestCollapseScopeKeysRef,
    isSelectionVisibleRef,
    draggingSelectionRef,
    importFeedbackRef,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setSelectedMeasureScope,
    setActiveTieSelection,
  })
  useEditorPreferencePersistence({
    playheadFollowEnabled,
    showChordDegreeEnabled,
    showInScoreMeasureNumbers,
    setShowInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
  })
  const {
    midiPermissionState,
    midiInputOptions,
    selectedMidiInputId,
    setSelectedMidiInputId,
  } = useMidiInputController({
    onMidiNoteNumber: applyMidiReplacementByNoteNumber,
  })
  const midiSupported = midiPermissionState !== 'unsupported'

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
    firstMeasureBaselineRef.current = captureFirstMeasureSnapshot({
      stage: 'before-drag',
      measurePairs: measurePairsRef.current,
      noteLayoutsByPair: noteLayoutsByPairRef.current,
      measureLayouts: measureLayoutsRef.current,
    })
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
        const afterSnapshot = captureFirstMeasureSnapshot({
          stage: 'after-drag-release',
          measurePairs: measurePairsRef.current,
          noteLayoutsByPair: noteLayoutsByPairRef.current,
          measureLayouts: measureLayoutsRef.current,
        })
        if (afterSnapshot) {
          const report = buildFirstMeasureDiffReport({
            beforeSnapshot,
            afterSnapshot,
            dragContext: firstMeasureDragContextRef.current,
            dragPreviewFrameCount: dragDebugFramesRef.current.length,
          })
          setMeasureEdgeDebugReport(report)
          console.log(report)
        }
        firstMeasureBaselineRef.current = null
        firstMeasureDragContextRef.current = null
        firstMeasureDebugRafRef.current = null
      })
    })
  }
  const dumpAllMeasureCoordinateReport = useCallback(() => buildMeasureCoordinateDebugReport({
    measureLayouts: measureLayoutsRef.current,
    noteLayoutsByPair: noteLayoutsByPairRef.current,
    measureTimelineBundles: measureTimelineBundlesRef.current,
    measurePairs: measurePairsRef.current,
    visibleSystemRange,
  }), [visibleSystemRange])

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
    selectedPoolSize,
    trebleSequenceText,
    bassSequenceText,
    playheadDebugLogText,
  }), [
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
    selectedPoolSize,
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


