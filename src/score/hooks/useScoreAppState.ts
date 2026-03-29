import { useState } from 'react'
import { A4_PAGE_WIDTH, INITIAL_NOTES } from '../constants'
import { DEFAULT_TIME_AXIS_SPACING_CONFIG } from '../layout/timeAxisSpacing'
import {
  getInitialChordDegreeDisplayEnabled,
  getInitialChordMarkerBackgroundEnabled,
  getInitialPlayheadFollowEnabled,
  getInitialStaffInterGapPx,
} from './useEditorPreferencePersistence'
import {
  getDefaultNotationPaletteSelection,
  type NotationPaletteSelection,
} from '../notationPaletteConfig'
import {
  DEFAULT_CHORD_MARKER_PADDING_PX,
  DEFAULT_CHORD_MARKER_UI_SCALE_PERCENT,
  DEFAULT_PAGE_HORIZONTAL_PADDING_PX,
} from '../scorePresentation'
import type { ChordRulerEntry } from '../chordRuler'
import type {
  BuiltInDemoMode,
  DragState,
  ImportFeedback,
  MeasurePair,
  MusicXmlMetadata,
  RhythmPresetId,
  ScoreNote,
  Selection,
  TieSelection,
  TimelineSegmentOverlayMode,
  TimeSignature,
} from '../types'

export function useScoreAppState(initialBassNotes: ScoreNote[]) {
  const [notes, setNotes] = useState<ScoreNote[]>(INITIAL_NOTES)
  const [bassNotes, setBassNotes] = useState<ScoreNote[]>(initialBassNotes)
  const [rhythmPreset, setRhythmPreset] = useState<RhythmPresetId>('quarter')
  const [activeBuiltInDemo, setActiveBuiltInDemo] = useState<BuiltInDemoMode>('none')
  const [timelineSegmentOverlayMode, setTimelineSegmentOverlayMode] =
    useState<TimelineSegmentOverlayMode>('curated-two-measure')
  const [activeSelection, setActiveSelection] = useState<Selection>({
    noteId: INITIAL_NOTES[0].id,
    staff: 'treble',
    keyIndex: 0,
  })
  const [activeAccidentalSelection, setActiveAccidentalSelection] = useState<Selection | null>(null)
  const [activeTieSelection, setActiveTieSelection] = useState<TieSelection | null>(null)
  const [selectedSelections, setSelectedSelections] = useState<Selection[]>([
    { noteId: INITIAL_NOTES[0].id, staff: 'treble', keyIndex: 0 },
  ])
  const [selectedMeasureScope, setSelectedMeasureScope] = useState<{
    pairIndex: number
    staff: Selection['staff']
  } | null>(null)
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
  const [importedChordRulerEntriesByPairFromImport, setImportedChordRulerEntriesByPairFromImport] =
    useState<ChordRulerEntry[][] | null>(null)
  const [importedTimelineSegmentStartPairIndexesFromImport, setImportedTimelineSegmentStartPairIndexesFromImport] =
    useState<number[] | null>(null)
  const [, setDragDebugReport] = useState<string>('')
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false)
  const [manualScalePercent, setManualScalePercent] = useState(100)
  const [canvasHeightPercent, setCanvasHeightPercent] = useState(100)
  const [playheadFollowEnabled, setPlayheadFollowEnabled] = useState(() => getInitialPlayheadFollowEnabled())
  const [showChordDegreeEnabled, setShowChordDegreeEnabled] = useState(() => getInitialChordDegreeDisplayEnabled())
  const [showChordMarkerBackgroundEnabled, setShowChordMarkerBackgroundEnabled] =
    useState(() => getInitialChordMarkerBackgroundEnabled())
  const [staffInterGapPx, setStaffInterGapPx] = useState(() => getInitialStaffInterGapPx())
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

  return {
    notes,
    setNotes,
    bassNotes,
    setBassNotes,
    rhythmPreset,
    setRhythmPreset,
    activeBuiltInDemo,
    setActiveBuiltInDemo,
    timelineSegmentOverlayMode,
    setTimelineSegmentOverlayMode,
    activeSelection,
    setActiveSelection,
    activeAccidentalSelection,
    setActiveAccidentalSelection,
    activeTieSelection,
    setActiveTieSelection,
    selectedSelections,
    setSelectedSelections,
    selectedMeasureScope,
    setSelectedMeasureScope,
    fullMeasureRestCollapseScopeKeys,
    setFullMeasureRestCollapseScopeKeys,
    isSelectionVisible,
    setIsSelectionVisible,
    draggingSelection,
    setDraggingSelection,
    dragPreviewState,
    setDragPreviewState,
    isPlaying,
    setIsPlaying,
    musicXmlInput,
    setMusicXmlInput,
    importFeedback,
    setImportFeedback,
    isNotationPaletteOpen,
    setIsNotationPaletteOpen,
    notationPaletteSelection,
    setNotationPaletteSelection,
    notationPaletteLastAction,
    setNotationPaletteLastAction,
    isRhythmLinked,
    setIsRhythmLinked,
    measurePairsFromImport,
    setMeasurePairsFromImport,
    measureKeyFifthsFromImport,
    setMeasureKeyFifthsFromImport,
    measureKeyModesFromImport,
    setMeasureKeyModesFromImport,
    measureDivisionsFromImport,
    setMeasureDivisionsFromImport,
    measureTimeSignaturesFromImport,
    setMeasureTimeSignaturesFromImport,
    musicXmlMetadataFromImport,
    setMusicXmlMetadataFromImport,
    importedChordRulerEntriesByPairFromImport,
    setImportedChordRulerEntriesByPairFromImport,
    importedTimelineSegmentStartPairIndexesFromImport,
    setImportedTimelineSegmentStartPairIndexesFromImport,
    setDragDebugReport,
    autoScaleEnabled,
    setAutoScaleEnabled,
    manualScalePercent,
    setManualScalePercent,
    canvasHeightPercent,
    setCanvasHeightPercent,
    playheadFollowEnabled,
    setPlayheadFollowEnabled,
    showChordDegreeEnabled,
    setShowChordDegreeEnabled,
    showChordMarkerBackgroundEnabled,
    setShowChordMarkerBackgroundEnabled,
    staffInterGapPx,
    setStaffInterGapPx,
    showInScoreMeasureNumbers,
    setShowInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
    pageHorizontalPaddingPx,
    setPageHorizontalPaddingPx,
    chordMarkerUiScalePercent,
    setChordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    setChordMarkerPaddingPx,
    timeAxisSpacingConfig,
    setTimeAxisSpacingConfig,
    horizontalViewportXRange,
    setHorizontalViewportXRange,
  }
}
