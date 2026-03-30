import type { ChordRulerEntry } from './chordRuler'

export type Pitch = string
export type StemDirection = 1 | -1
export type NoteDuration = 'w' | 'hd' | 'h' | 'q' | '8' | '16' | '32' | 'qd' | '8d' | '16d' | '32d'
export type NoteDurationBase = 'w' | 'h' | 'q' | '8' | '16' | '32'
export type RhythmPresetId = 'quarter' | 'twoEighth' | 'fourSixteenth' | 'eightSixteenth' | 'shortDotted'
export type BuiltInDemoMode = 'none' | 'whole-note' | 'half-note'
export type TimelineSegmentOverlayMode = 'none' | 'curated-two-measure' | 'imported-last-part'
export type ScoreSourceKind =
  | 'reset-default'
  | 'musicxml-file'
  | 'musicxml-text'
  | 'sample-musicxml'
  | 'built-in-demo'
  | 'rhythm-preset'
  | 'ai-draft'
export type StaffKind = 'treble' | 'bass'
export type PedalStyle = 'text' | 'bracket' | 'mixed'
export type PedalApplyScope = 'all' | 'segment' | 'chord'
export type PedalLayoutMode = 'flexible' | 'uniform'
export type ActivePedalSelection = {
  pedalId: string
}
export type BeamTag = 'begin' | 'continue' | 'end'
export type BeamLevelTag = 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook'
export type BeamTagByLevel = Record<number, BeamLevelTag>
export type MeasureStaffBeamResult = {
  treble: BeamTagByLevel[]
  bass: BeamTagByLevel[]
}
export type SpacingLayoutMode = 'custom' | 'legacy'

export type TimeSignature = {
  beats: number
  beatType: number
}

export type MusicXmlCreator = {
  type?: string
  text: string
}

export type MusicXmlMetadata = {
  version: string
  workTitle: string
  rights?: string
  creators: MusicXmlCreator[]
  softwares: string[]
  encodingDate?: string
  partName: string
  partAbbreviation?: string
}

export type ScoreNote = {
  id: string
  pitch: Pitch
  duration: NoteDuration
  isRest?: boolean
  accidental?: string | null
  chordPitches?: Pitch[]
  chordAccidentals?: Array<string | null>
  tieStart?: boolean
  tieStop?: boolean
  chordTieStarts?: boolean[]
  chordTieStops?: boolean[]
  tieFrozenIncomingPitch?: Pitch | null
  tieFrozenIncomingFromNoteId?: string | null
  tieFrozenIncomingFromKeyIndex?: number | null
  chordTieFrozenIncomingPitches?: Array<Pitch | null>
  chordTieFrozenIncomingFromNoteIds?: Array<string | null>
  chordTieFrozenIncomingFromKeyIndices?: Array<number | null>
}

export type ImportResult = {
  trebleNotes: ScoreNote[]
  bassNotes: ScoreNote[]
  measurePairs: MeasurePair[]
  pedalSpans: PedalSpan[]
  measureKeyFifths: number[]
  measureKeyModes: string[]
  measureDivisions: number[]
  measureTimeSignatures: TimeSignature[]
  metadata: MusicXmlMetadata
  importedNoteLookup?: Map<string, ImportedNoteLocation>
  importedChordRulerEntriesByPair?: ChordRulerEntry[][] | null
  importedTimelineSegmentStartPairIndexes?: number[] | null
}

export type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

export type SegmentRhythmTemplateDetail = {
  notes: string
  rawNotes: string
  sourceChordType: string | null
  rhythm: string
  pitchRange: string
  structureType: string
  octaveMode: string
  spanRows: number | null
  spanPos: number | null
  groupDuration: number | null
  melodyNotes: string
  melodyRhythm: string
}

export type SegmentRhythmTemplateBinding = {
  scopeKey: string
  templateId: string
  templateName: string
  selectedDifficulty: string | null
  selectedStyles: string[]
  patternData: string
  templDetails: SegmentRhythmTemplateDetail[]
  durationCombo: string
}

export type PedalSpan = {
  id: string
  style: PedalStyle
  layoutMode: PedalLayoutMode
  manualBaselineOffsetPx: number
  staff: 'bass'
  startPairIndex: number
  startTick: number
  endPairIndex: number
  endTick: number
}

export type NoteHeadLayout = {
  x: number
  y: number
  pitch: Pitch
  keyIndex: number
  hitCenterX?: number
  hitCenterY?: number
  hitRadiusX?: number
  hitRadiusY?: number
  hitMinX?: number
  hitMaxX?: number
  hitMinY?: number
  hitMaxY?: number
}

export type AccidentalLayout = {
  keyIndex: number
  x: number
  y: number
  renderedAccidental: string
  hitCenterX?: number
  hitCenterY?: number
  hitRadiusX?: number
  hitRadiusY?: number
  hitMinX?: number
  hitMaxX?: number
  hitMinY?: number
  hitMaxY?: number
}

export type TieEndpointType = 'start' | 'stop'

export type TieEndpoint = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
  noteId: string
  keyIndex: number
  tieType: TieEndpointType
}

export type TieSelection = {
  key: string
  endpoints: TieEndpoint[]
}

export type TieLayout = TieSelection & {
  startX: number
  startY: number
  endX: number
  endY: number
  direction: number
  hitCenterX?: number
  hitCenterY?: number
  hitRadiusX?: number
  hitRadiusY?: number
  hitMinX?: number
  hitMaxX?: number
  hitMinY?: number
  hitMaxY?: number
}

export type NoteLayout = {
  id: string
  staff: StaffKind
  pairIndex: number
  noteIndex: number
  isRest?: boolean
  hasFlag?: boolean
  x: number
  anchorX: number
  visualLeftX: number
  visualRightX: number
  visualTopY: number
  visualBottomY: number
  rightX: number
  spacingRightX: number
  y: number
  pitchYMap: Record<Pitch, number>
  noteHeads: NoteHeadLayout[]
  accidentalLayouts: AccidentalLayout[]
  inMeasureTieLayouts: TieLayout[]
  crossMeasureTieLayouts: TieLayout[]
  accidentalRightXByKeyIndex: Record<number, number>
  stemDirection: StemDirection | null
}

export type DragDebugStaticRecord = {
  staff: StaffKind
  noteId: string
  noteIndex: number
  noteX: number
  anchorX: number
  stemDirection: StemDirection | null
  headXByKeyIndex: Map<number, number>
  headYByKeyIndex: Map<number, number>
  accidentalRightXByKeyIndex: Map<number, number>
}

export type DragDebugRow = {
  frame: number
  pairIndex: number
  staff: StaffKind
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: Pitch
  noteXStatic: number | null
  noteXPreview: number | null
  noteXDelta: number | null
  anchorXStatic: number | null
  anchorXPreview: number | null
  anchorXDelta: number | null
  headXStatic: number | null
  headXPreview: number | null
  headXDelta: number | null
  headYStatic: number | null
  headYPreview: number | null
  headYDelta: number | null
  accidentalRightXStatic: number | null
  accidentalRightXPreview: number | null
  accidentalRightXDelta: number | null
  hasAccidentalModifier: boolean
  accidentalTargetRightX: number | null
  accidentalLockApplied: boolean
  accidentalLockReason: string
}

export type DragDebugSnapshot = {
  frame: number
  pairIndex: number
  draggedNoteId: string
  draggedStaff: StaffKind
  rows: DragDebugRow[]
}

export type Selection = {
  noteId: string
  staff: StaffKind
  keyIndex: number
}

export type PlaybackPoint = {
  pairIndex: number
  onsetTick: number
}

export type PlaybackCursorRect = {
  x: number
  y: number
  width: number
  height: number
}

export type PlaybackCursorState = {
  point: PlaybackPoint | null
  color: 'red' | 'yellow'
  rectPx: PlaybackCursorRect | null
}

export type DragState = {
  noteId: string
  staff: StaffKind
  keyIndex: number
  pairIndex: number
  noteIndex: number
  groupPreviewLeadTarget?: DragTieTarget | null
  linkedTieTargets?: DragTieTarget[]
  previousTieTarget?: DragTieTarget | null
  previewFrozenBoundary?: {
    fromTarget: DragTieTarget
    toTarget: DragTieTarget
    startX: number
    startY: number
    endX: number
    endY: number
    frozenPitch: Pitch
  } | null
  groupMoveTargets?: DragTieTarget[]
  pointerId: number
  surfaceTop: number
  surfaceClientToScoreScaleY: number
  startClientY: number
  originPitch: Pitch
  pitch: Pitch
  previewStarted: boolean
  selectionMode?: 'replace' | 'append' | 'range'
  startedWithReplaceDeferred?: boolean
  startTimestampMs?: number
  startSelection?: Selection
  grabOffsetY: number
  pitchYMap: Record<Pitch, number>
  keyFifths: number
  accidentalStateBeforeNote: Map<string, number>
  layoutCacheReady: boolean
  staticAnchorXById: Map<string, number>
  previewAccidentalRightXById: Map<string, Map<number, number>>
  debugStaticByNoteKey: Map<string, DragDebugStaticRecord>
}

export type DragTieTarget = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
  noteId: string
  keyIndex: number
  pitch: Pitch
  contextKeyFifths?: number
  contextAccidentalStateBeforeNote?: Map<string, number>
}

export type MeasureLayout = {
  pairIndex: number
  measureX: number
  measureWidth: number
  contentMeasureWidth: number
  renderedMeasureWidth: number
  trebleY: number
  bassY: number
  trebleLineTopY: number
  trebleLineBottomY: number
  bassLineTopY: number
  bassLineBottomY: number
  systemTop: number
  isSystemStart: boolean
  keyFifths: number
  showKeySignature: boolean
  timeSignature: TimeSignature
  showTimeSignature: boolean
  endTimeSignature: TimeSignature | null
  showEndTimeSignature: boolean
  includeMeasureStartDecorations: boolean
  noteStartX: number
  noteEndX: number
  formatWidth: number
  sharedStartDecorationReservePx?: number
  actualStartDecorationWidthPx?: number
  effectiveBoundaryStartX?: number
  effectiveBoundaryEndX?: number
  effectiveLeftGapPx?: number
  effectiveRightGapPx?: number
  leadingGapPx?: number
  trailingTailTicks?: number
  trailingGapPx?: number
  spacingOccupiedLeftX?: number
  spacingOccupiedRightX?: number
  spacingAnchorGapFirstToLastPx?: number
  spacingOnsetReserves?: Array<{
    onsetTicks: number
    baseX: number
    finalX: number
    leftReservePx: number
    rightReservePx: number
    rawLeftReservePx: number
    rawRightReservePx: number
    leftOccupiedInsetPx: number
    rightOccupiedTailPx: number
    leadingTrebleRequestedExtraPx: number
    leadingBassRequestedExtraPx: number
    leadingWinningStaff: 'treble' | 'bass' | 'tie' | 'none'
    trailingTrebleRequestedExtraPx: number
    trailingBassRequestedExtraPx: number
    trailingWinningStaff: 'treble' | 'bass' | 'tie' | 'none'
  }>
  spacingSegments?: Array<{
    fromOnsetTicks: number
    toOnsetTicks: number
    baseGapPx: number
    extraReservePx: number
    appliedGapPx: number
    trebleRequestedExtraPx: number
    bassRequestedExtraPx: number
    noteRestRequestedExtraPx?: number
    noteRestVisibleGapPx?: number | null
    accidentalRequestedExtraPx?: number
    accidentalVisibleGapPx?: number | null
    winningStaff: 'treble' | 'bass' | 'tie' | 'none'
  }>
  overlayRect: {
    x: number
    y: number
    width: number
    height: number
  }
}

export type MeasureFrame = {
  measureX: number
  measureWidth: number
  contentMeasureWidth?: number
  renderedMeasureWidth?: number
  actualStartDecorationWidthPx?: number
}

export type EffectiveMeasureBoundary = {
  measureStartBarX: number
  measureEndBarX: number
  effectiveStartX: number
  effectiveEndX: number
}

export type MeasurePair = {
  treble: ScoreNote[]
  bass: ScoreNote[]
}

export type ImportedNoteLocation = {
  pairIndex: number
  noteIndex: number
  staff: StaffKind
}

export type LayoutReflowHint = {
  pairIndex: number
  scoreContentChanged: boolean
  accidentalLayoutChanged: boolean
  shouldReflow: boolean
  layoutStabilityKey?: string
}
