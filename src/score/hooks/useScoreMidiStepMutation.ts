import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { applyMidiStepInput, type MidiStepInputMode } from '../midiStepEdits'
import { toPitchFromMidiWithKeyPreference } from '../midiInput'
import { findSelectionLocationInPairs } from '../keyboardEdits'
import { compareTimelinePoint, resolveSelectionTimelinePoint } from '../selectionTimelineRange'
import type { MeasureStaffScope } from '../fullMeasureRestCollapse'
import type {
  DragState,
  ImportedNoteLocation,
  MeasurePair,
  Selection,
  TimeSignature,
} from '../types'
import {
  extendNumberSeries,
  extendTimeSignatureSeries,
  resolvePairKeyFifthsForKeyboard,
} from './scoreMutationShared'

type StateSetter<T> = Dispatch<SetStateAction<T>>

type ApplyKeyboardEditResult = (
  nextPairs: MeasurePair[],
  nextSelection: Selection,
  nextSelections?: Selection[],
  source?: 'default' | 'midi-step',
  options?: { collapseScopesToAdd?: MeasureStaffScope[] },
) => void

export function useScoreMidiStepMutation(params: {
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  selectedSelectionsRef: MutableRefObject<Selection[]>
  activeSelectionRef: MutableRefObject<Selection>
  isSelectionVisibleRef: MutableRefObject<boolean>
  midiStepChainRef: MutableRefObject<boolean>
  midiStepLastSelectionRef: MutableRefObject<Selection | null>
  dragRef: MutableRefObject<DragState | null>
  draggingSelectionRef: MutableRefObject<Selection | null>
  isOsmdPreviewOpenRef: MutableRefObject<boolean>
  applyKeyboardEditResult: ApplyKeyboardEditResult
  setMeasureKeyFifthsFromImport: StateSetter<number[] | null>
  setMeasureDivisionsFromImport: StateSetter<number[] | null>
  setMeasureTimeSignaturesFromImport: StateSetter<TimeSignature[] | null>
}) {
  const {
    measurePairsRef,
    measurePairsFromImportRef,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    importedNoteLookupRef,
    selectedSelectionsRef,
    activeSelectionRef,
    isSelectionVisibleRef,
    midiStepChainRef,
    midiStepLastSelectionRef,
    dragRef,
    draggingSelectionRef,
    isOsmdPreviewOpenRef,
    applyKeyboardEditResult,
    setMeasureKeyFifthsFromImport,
    setMeasureDivisionsFromImport,
    setMeasureTimeSignaturesFromImport,
  } = params

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
    applyMidiReplacementByNoteNumber,
  }
}
