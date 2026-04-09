import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { NoteClipboardPayload } from '../copyPasteTypes'
import type {
  ActivePedalSelection,
  ImportedNoteLocation,
  MeasurePair,
  PedalSpan,
  Pitch,
  Selection,
  TieSelection,
  TimeSignature,
} from '../types'
import type { MeasureScope } from './keyboardCommandShared'

export type StateSetter<T> = Dispatch<SetStateAction<T>>

export type KeyboardEditResultApplier = (
  nextPairs: MeasurePair[],
  nextSelection: Selection,
  nextSelections?: Selection[],
  source?: 'default' | 'midi-step',
  options?: { collapseScopesToAdd?: Array<{ pairIndex: number; staff: Selection['staff'] }> },
) => void

export type KeyboardAccidentalPreviewPlayer = (params: {
  pairs: MeasurePair[]
  previewSelection: Selection | null
  previewPitch: Pitch | null
  importedNoteLookup?: Map<string, ImportedNoteLocation> | null
}) => void

export type KeyboardMoveSelectionsByKeyboardSteps = (
  direction: 'up' | 'down',
  staffSteps: number,
  scope?: 'active' | 'selected',
) => boolean

export type KeyboardMoveSelectionByKeyboardArrow = (direction: 'up' | 'down') => boolean

export type KeyboardCommandEventParams = {
  event: KeyboardEvent
  isAnyPreviewOpen: boolean
  draggingSelection: Selection | null
  isSelectionVisible: boolean
  measurePairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  selectedMeasureScope: MeasureScope
  activeTieSelection: TieSelection | null
  activeAccidentalSelection: Selection | null
  activePedalSelection: ActivePedalSelection | null
  pedalSpans: PedalSpan[]
  measureKeyFifthsFromImport: number[] | null
  noteClipboardRef: MutableRefObject<NoteClipboardPayload | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  undoLastScoreEdit: () => boolean
  handleMoveSelectionsByKeyboardSteps: KeyboardMoveSelectionsByKeyboardSteps
  handleMoveSelectionByKeyboardArrow: KeyboardMoveSelectionByKeyboardArrow
  pushUndoSnapshot: (sourcePairs: MeasurePair[]) => void
  applyKeyboardEditResult: KeyboardEditResultApplier
  playAccidentalEditPreview: KeyboardAccidentalPreviewPlayer
  setPedalSpans: StateSetter<PedalSpan[]>
  setActiveTieSelection: StateSetter<TieSelection | null>
  setActiveAccidentalSelection: StateSetter<Selection | null>
  setActivePedalSelection: StateSetter<ActivePedalSelection | null>
  setIsSelectionVisible: StateSetter<boolean>
  setSelectedSelections: StateSetter<Selection[]>
  setSelectedMeasureScope: StateSetter<MeasureScope>
  setNotationPaletteLastAction: StateSetter<string>
}

export type KeyboardCommandEffectParams = Omit<KeyboardCommandEventParams, 'event'>

export type KeyboardCommandResult =
  | 'not-handled'
  | 'handled'
  | 'handled-prevent-default'
