import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  buildAccidentalStateBeforeNote,
  getEffectivePitchForStaffPosition,
} from '../accidentals'
import { buildSelectionGroupMoveTargets } from '../selectionGroupTargets'
import { resolveForwardTieTargets, resolvePreviousTieTarget } from '../tieChain'
import { commitDragPitchToScoreData } from '../dragInteractions'
import { findSelectionLocationInPairs } from '../keyboardEdits'
import { flattenBassFromPairs, flattenTrebleFromPairs } from '../scoreOps'
import type {
  DragState,
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  Pitch,
  ScoreNote,
  Selection,
  SelectionFrameIntent,
} from '../types'
import {
  appendUniqueSelection,
  isPitchWithinPianoRange,
  resolvePairKeyFifthsForKeyboard,
  shiftPitchByStaffSteps,
} from './keyboardCommandShared'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function moveSelectionsByKeyboardSteps(params: {
  direction: 'up' | 'down'
  staffSteps: number
  scope?: 'active' | 'selected'
  activeSelectionRef: MutableRefObject<Selection>
  selectedSelections: Selection[]
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  layoutReflowHintRef: MutableRefObject<LayoutReflowHint | null>
  layoutStabilityKey: string
  pushUndoSnapshot: (sourcePairs: MeasurePair[]) => void
  resetMidiStepChain: () => void
  setNotes: StateSetter<ScoreNote[]>
  setBassNotes: StateSetter<ScoreNote[]>
  setMeasurePairsFromImport: StateSetter<MeasurePair[] | null>
  setIsSelectionVisible: StateSetter<boolean>
  setActiveSelection: StateSetter<Selection>
  setSelectedSelections: StateSetter<Selection[]>
  setSelectionFrameIntent: StateSetter<SelectionFrameIntent>
}): boolean {
  const {
    direction,
    staffSteps,
    scope = 'active',
    activeSelectionRef,
    selectedSelections,
    measurePairsRef,
    measurePairsFromImportRef,
    importedNoteLookupRef,
    measureLayoutsRef,
    measureKeyFifthsFromImportRef,
    layoutReflowHintRef,
    layoutStabilityKey,
    pushUndoSnapshot,
    resetMidiStepChain,
    setNotes,
    setBassNotes,
    setMeasurePairsFromImport,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setSelectionFrameIntent,
  } = params

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
  setSelectionFrameIntent('default')
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
}

export function moveSelectionByKeyboardArrow(
  params: Omit<Parameters<typeof moveSelectionsByKeyboardSteps>[0], 'staffSteps' | 'scope'> & {
    direction: 'up' | 'down'
  },
): boolean {
  return moveSelectionsByKeyboardSteps({
    ...params,
    staffSteps: 1,
    scope: 'active',
  })
}
