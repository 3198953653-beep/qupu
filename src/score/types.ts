export type Pitch = string
export type StemDirection = 1 | -1
export type NoteDuration = 'w' | 'h' | 'q' | '8' | '16' | '32' | 'qd' | '8d' | '16d' | '32d'
export type NoteDurationBase = 'w' | 'h' | 'q' | '8' | '16' | '32'
export type RhythmPresetId = 'quarter' | 'twoEighth' | 'fourSixteenth' | 'eightSixteenth' | 'shortDotted'
export type StaffKind = 'treble' | 'bass'
export type BeamTag = 'begin' | 'continue' | 'end'

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
  accidental?: string | null
  chordPitches?: Pitch[]
  chordAccidentals?: Array<string | null>
}

export type ImportResult = {
  trebleNotes: ScoreNote[]
  bassNotes: ScoreNote[]
  measurePairs: MeasurePair[]
  measureKeyFifths: number[]
  measureDivisions: number[]
  measureTimeSignatures: TimeSignature[]
  metadata: MusicXmlMetadata
  importedNoteLookup?: Map<string, ImportedNoteLocation>
}

export type ImportFeedback = {
  kind: 'idle' | 'loading' | 'success' | 'error'
  message: string
  progress?: number | null
}

export type NoteHeadLayout = {
  x: number
  y: number
  pitch: Pitch
  keyIndex: number
}

export type NoteLayout = {
  id: string
  staff: StaffKind
  pairIndex: number
  noteIndex: number
  x: number
  rightX: number
  spacingRightX: number
  y: number
  pitchYMap: Record<Pitch, number>
  noteHeads: NoteHeadLayout[]
  accidentalRightXByKeyIndex: Record<number, number>
}

export type DragDebugStaticRecord = {
  staff: StaffKind
  noteId: string
  noteIndex: number
  noteX: number
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

export type DragState = {
  noteId: string
  staff: StaffKind
  keyIndex: number
  pairIndex: number
  noteIndex: number
  pointerId: number
  surfaceTop: number
  surfaceClientToScoreScaleY: number
  startClientY: number
  pitch: Pitch
  previewStarted: boolean
  grabOffsetY: number
  pitchYMap: Record<Pitch, number>
  keyFifths: number
  accidentalStateBeforeNote: Map<string, number>
  layoutCacheReady: boolean
  staticNoteXById: Map<string, number>
  previewAccidentalRightXById: Map<string, Map<number, number>>
  debugStaticByNoteKey: Map<string, DragDebugStaticRecord>
}

export type MeasureLayout = {
  pairIndex: number
  measureX: number
  measureWidth: number
  trebleY: number
  bassY: number
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
  overlayRect: {
    x: number
    y: number
    width: number
    height: number
  }
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
