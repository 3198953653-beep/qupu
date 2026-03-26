import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { applyMidiStepInput, type MidiStepInputMode } from '../midiStepEdits'
import { toPitchFromMidiWithKeyPreference } from '../midiInput'
import { findSelectionLocationInPairs } from '../keyboardEdits'
import { buildImportedNoteLookup, flattenBassFromPairs, flattenTrebleFromPairs } from '../scoreOps'
import { compareTimelinePoint, resolveSelectionTimelinePoint } from '../selectionTimelineRange'
import { mergeFullMeasureRestCollapseScopeKeys, type MeasureStaffScope } from '../fullMeasureRestCollapse'
import type {
  DragState,
  ImportedNoteLocation,
  MeasurePair,
  MusicXmlMetadata,
  ScoreNote,
  Selection,
  TimeSignature,
} from '../types'

type UndoSnapshot = {
  pairs: MeasurePair[]
  imported: boolean
  selection: Selection
  isSelectionVisible: boolean
  fullMeasureRestCollapseScopeKeys: string[]
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

function resolvePairKeyFifthsForKeyboard(pairIndex: number, keyFifthsByMeasure?: number[] | null): number {
  if (!keyFifthsByMeasure || keyFifthsByMeasure.length === 0) return 0
  for (let index = pairIndex; index >= 0; index -= 1) {
    const value = keyFifthsByMeasure[index]
    if (Number.isFinite(value)) return Math.trunc(value)
  }
  return 0
}

function extendNumberSeries(
  source: number[] | null,
  targetLength: number,
  fallback: number,
  normalize: (value: number) => number,
): number[] {
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

function extendTimeSignatureSeries(source: TimeSignature[] | null, targetLength: number): TimeSignature[] {
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

export function useScoreMutationController(params: {
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  measureKeyFifthsFromImport: number[] | null
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureDivisionsFromImport: number[] | null
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImport: TimeSignature[] | null
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  musicXmlMetadataFromImport: MusicXmlMetadata | null
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  selectedSelectionsRef: MutableRefObject<Selection[]>
  activeSelectionRef: MutableRefObject<Selection>
  isSelectionVisibleRef: MutableRefObject<boolean>
  fullMeasureRestCollapseScopeKeysRef: MutableRefObject<string[]>
  midiStepChainRef: MutableRefObject<boolean>
  midiStepLastSelectionRef: MutableRefObject<Selection | null>
  dragRef: MutableRefObject<DragState | null>
  draggingSelectionRef: MutableRefObject<Selection | null>
  isOsmdPreviewOpenRef: MutableRefObject<boolean>
  clearDragOverlayRef: MutableRefObject<() => void>
  clearDragPreviewState: () => void
  clearDraggingSelection: () => void
  resetMidiStepChain: () => void
  clearActiveAccidentalSelection: () => void
  clearActiveTieSelection: () => void
  clearSelectedMeasureScope: () => void
  clearActiveChordSelection: () => void
  setMeasurePairsFromImport: Dispatch<SetStateAction<MeasurePair[] | null>>
  clearImportedChordRulerEntries: () => void
  setNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setBassNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setIsSelectionVisible: Dispatch<SetStateAction<boolean>>
  setFullMeasureRestCollapseScopeKeys: Dispatch<SetStateAction<string[]>>
  setActiveSelection: Dispatch<SetStateAction<Selection>>
  setSelectedSelections: Dispatch<SetStateAction<Selection[]>>
  setIsRhythmLinked: Dispatch<SetStateAction<boolean>>
  setMeasureKeyFifthsFromImport: Dispatch<SetStateAction<number[] | null>>
  setMeasureDivisionsFromImport: Dispatch<SetStateAction<number[] | null>>
  setMeasureTimeSignaturesFromImport: Dispatch<SetStateAction<TimeSignature[] | null>>
}): {
  pushUndoSnapshot: (sourcePairs: MeasurePair[]) => void
  undoLastScoreEdit: () => boolean
  applyKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections?: Selection[],
    source?: 'default' | 'midi-step',
    options?: { collapseScopesToAdd?: MeasureStaffScope[] },
  ) => void
  applyMidiReplacementByNoteNumber: (midiNoteNumber: number) => void
} {
  const {
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
  } = params

  const undoHistoryRef = useRef<UndoSnapshot[]>([])

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
    if (stack.length > 120) {
      stack.splice(0, stack.length - 120)
    }
  }, [
    activeSelectionRef,
    fullMeasureRestCollapseScopeKeysRef,
    isSelectionVisibleRef,
    measurePairsFromImportRef,
  ])

  const undoLastScoreEdit = useCallback((): boolean => {
    const stack = undoHistoryRef.current
    if (stack.length === 0) return false
    const snapshot = stack.pop()
    if (!snapshot) return false

    const restoredPairs = cloneMeasurePairs(snapshot.pairs)
    clearDragPreviewState()
    dragRef.current = null
    clearDragOverlayRef.current()
    clearDraggingSelection()
    resetMidiStepChain()

    if (snapshot.imported) {
      measurePairsFromImportRef.current = restoredPairs
      setMeasurePairsFromImport(restoredPairs)
    } else {
      measurePairsFromImportRef.current = null
      setMeasurePairsFromImport(null)
      clearImportedChordRulerEntries()
    }
    importedNoteLookupRef.current = buildImportedNoteLookup(restoredPairs)
    setNotes(flattenTrebleFromPairs(restoredPairs))
    setBassNotes(flattenBassFromPairs(restoredPairs))
    setIsSelectionVisible(snapshot.isSelectionVisible)
    clearActiveAccidentalSelection()
    clearActiveTieSelection()
    clearSelectedMeasureScope()
    clearActiveChordSelection()
    setFullMeasureRestCollapseScopeKeys(snapshot.fullMeasureRestCollapseScopeKeys)
    setActiveSelection(snapshot.selection)
    setSelectedSelections(snapshot.isSelectionVisible ? [snapshot.selection] : [])
    return true
  }, [
    clearActiveAccidentalSelection,
    clearActiveChordSelection,
    clearActiveTieSelection,
    clearDragOverlayRef,
    clearDragPreviewState,
    clearDraggingSelection,
    clearImportedChordRulerEntries,
    clearSelectedMeasureScope,
    dragRef,
    importedNoteLookupRef,
    measurePairsFromImportRef,
    resetMidiStepChain,
    setActiveSelection,
    setBassNotes,
    setFullMeasureRestCollapseScopeKeys,
    setIsSelectionVisible,
    setMeasurePairsFromImport,
    setNotes,
    setSelectedSelections,
  ])

  const applyKeyboardEditResult = useCallback((
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections: Selection[] = [nextSelection],
    source: 'default' | 'midi-step' = 'default',
    options?: { collapseScopesToAdd?: MeasureStaffScope[] },
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
    clearActiveAccidentalSelection()
    clearActiveTieSelection()
    clearSelectedMeasureScope()
    clearActiveChordSelection()
    setActiveSelection(nextSelection)
    setSelectedSelections(nextSelections)
  }, [
    clearActiveAccidentalSelection,
    clearActiveChordSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    importedNoteLookupRef,
    measurePairsFromImportRef,
    measurePairsRef,
    pushUndoSnapshot,
    resetMidiStepChain,
    setActiveSelection,
    setBassNotes,
    setFullMeasureRestCollapseScopeKeys,
    setIsRhythmLinked,
    setIsSelectionVisible,
    setMeasurePairsFromImport,
    setNotes,
    setSelectedSelections,
  ])

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
  }, [
    activeSelectionRef,
    importedNoteLookupRef,
    selectedSelectionsRef,
  ])

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
    const mode: MidiStepInputMode = midiStepChainRef.current && midiStepLastSelectionRef.current &&
      midiStepLastSelectionRef.current.noteId === targetSelection.noteId &&
      midiStepLastSelectionRef.current.staff === targetSelection.staff &&
      midiStepLastSelectionRef.current.keyIndex === targetSelection.keyIndex
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
      const nextKeyFifths = extendNumberSeries(
        measureKeyFifthsFromImportRef.current,
        targetLength,
        0,
        (value) => Math.trunc(value),
      )
      const nextDivisions = extendNumberSeries(
        measureDivisionsFromImportRef.current,
        targetLength,
        16,
        (value) => Math.max(1, Math.round(value)),
      )
      const nextTimeSignatures = extendTimeSignatureSeries(measureTimeSignaturesFromImportRef.current, targetLength)
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
    dragRef,
    draggingSelectionRef,
    importedNoteLookupRef,
    isOsmdPreviewOpenRef,
    isSelectionVisibleRef,
    measureDivisionsFromImportRef,
    measureKeyFifthsFromImportRef,
    measurePairsFromImportRef,
    measurePairsRef,
    measureTimeSignaturesFromImportRef,
    midiStepChainRef,
    midiStepLastSelectionRef,
    resolveMidiTargetSelection,
    setMeasureDivisionsFromImport,
    setMeasureKeyFifthsFromImport,
    setMeasureTimeSignaturesFromImport,
  ])

  return {
    pushUndoSnapshot,
    undoLastScoreEdit,
    applyKeyboardEditResult,
    applyMidiReplacementByNoteNumber,
  }
}
