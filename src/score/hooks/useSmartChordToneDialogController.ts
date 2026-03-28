import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { findSelectionLocationInPairs, replaceNoteChordPitches } from '../keyboardEdits'
import { resolvePairKeyFifths } from '../measureRestUtils'
import { toDisplayPitch } from '../pitchUtils'
import { buildStaffOnsetTicks } from '../selectionTimelineRange'
import {
  arePitchListsEquivalentByMidi,
  enumerateSmartChordToneCandidates,
  sortPitchesByMidi,
  type SmartChordToneCandidate,
  type SmartChordToneCountOption,
  type SmartChordToneFilterOption,
  type SmartChordToneOctaveOption,
} from '../smartChordToneCandidates'
import type { ImportedNoteLocation, MeasurePair, Pitch, Selection, StaffKind } from '../types'
import type { ChordRulerMarkerMeta } from './chordMarkerTypes'

export type SmartChordToneDialogTarget = {
  selection: Selection
  pairIndex: number
  noteIndex: number
  measureNumber: number
  melodyPitch: Pitch
  melodyPitchLabel: string
  chordSourceLabel: string | null
  chordDisplayLabel: string | null
  existingChordPitches: Pitch[]
  previewClef: StaffKind
  previewKeyFifths: number
}

function findCoveringChordMarker(params: {
  chordMarkerMeta: ChordRulerMarkerMeta[]
  pairIndex: number
  onsetTick: number
}): ChordRulerMarkerMeta | null {
  const { chordMarkerMeta, pairIndex, onsetTick } = params
  return chordMarkerMeta.find(
    (marker) => marker.pairIndex === pairIndex && onsetTick >= marker.startTick && onsetTick < marker.endTick,
  ) ?? null
}

export function useSmartChordToneDialogController(params: {
  measurePairsRef: MutableRefObject<MeasurePair[]>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureKeyFifthsByMeasure: number[] | null
  chordRulerMarkerMetaByKey: Map<string, ChordRulerMarkerMeta>
  handlePreviewPitchStack: (params: { pitches: Pitch[]; mode: 'click' | 'drag' }) => void
  applyKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections?: Selection[],
    source?: 'default' | 'midi-step',
  ) => void
  setIsSelectionVisible: (visible: boolean) => void
  setSelectedSelections: (selections: Selection[]) => void
  setActiveSelection: (selection: Selection) => void
  clearActiveAccidentalSelection: () => void
  clearActiveTieSelection: () => void
  clearSelectedMeasureScope: () => void
  clearActiveChordSelection: () => void
  resetMidiStepChain: () => void
}) {
  const {
    measurePairsRef,
    importedNoteLookupRef,
    measureKeyFifthsByMeasure,
    chordRulerMarkerMetaByKey,
    handlePreviewPitchStack,
    applyKeyboardEditResult,
    setIsSelectionVisible,
    setSelectedSelections,
    setActiveSelection,
    clearActiveAccidentalSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    clearActiveChordSelection,
    resetMidiStepChain,
  } = params

  const [isOpen, setIsOpen] = useState(false)
  const [target, setTarget] = useState<SmartChordToneDialogTarget | null>(null)
  const [octaveOption, setOctaveOption] = useState<SmartChordToneOctaveOption | null>(null)
  const [chordCountOption, setChordCountOption] = useState<SmartChordToneCountOption | null>(null)
  const [filterOptions, setFilterOptions] = useState<SmartChordToneFilterOption[]>([])
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null)

  const sortedChordMarkerMeta = useMemo(
    () =>
      [...chordRulerMarkerMetaByKey.values()].sort((left, right) => {
        if (left.pairIndex !== right.pairIndex) return left.pairIndex - right.pairIndex
        if (left.startTick !== right.startTick) return left.startTick - right.startTick
        return left.endTick - right.endTick
      }),
    [chordRulerMarkerMetaByKey],
  )

  const closeSmartChordToneDialog = useCallback(() => {
    setIsOpen(false)
    setTarget(null)
    setOctaveOption(null)
    setChordCountOption(null)
    setFilterOptions([])
    setSelectedCandidateKey(null)
  }, [])

  const restoreTargetSelection = useCallback((selection: Selection) => {
    resetMidiStepChain()
    clearActiveAccidentalSelection()
    clearActiveTieSelection()
    clearSelectedMeasureScope()
    clearActiveChordSelection()
    setIsSelectionVisible(true)
    setSelectedSelections([selection])
    setActiveSelection(selection)
  }, [
    clearActiveAccidentalSelection,
    clearActiveChordSelection,
    clearActiveTieSelection,
    clearSelectedMeasureScope,
    resetMidiStepChain,
    setActiveSelection,
    setIsSelectionVisible,
    setSelectedSelections,
  ])

  const openSmartChordToneDialogForSelection = useCallback((selection: Selection) => {
    if (selection.staff !== 'treble') return
    const normalizedSelection: Selection = {
      noteId: selection.noteId,
      staff: 'treble',
      keyIndex: 0,
    }
    const location = findSelectionLocationInPairs({
      pairs: measurePairsRef.current,
      selection: normalizedSelection,
      importedNoteLookup: importedNoteLookupRef.current,
    })
    if (!location || location.staff !== 'treble') return
    const pair = measurePairsRef.current[location.pairIndex]
    const note = pair?.treble[location.noteIndex]
    if (!pair || !note || note.isRest) return

    const onsetTick = buildStaffOnsetTicks(pair.treble)[location.noteIndex]
    if (!Number.isFinite(onsetTick)) return
    const coveringChordMarker = findCoveringChordMarker({
      chordMarkerMeta: sortedChordMarkerMeta,
      pairIndex: location.pairIndex,
      onsetTick,
    })

    setTarget({
      selection: normalizedSelection,
      pairIndex: location.pairIndex,
      noteIndex: location.noteIndex,
      measureNumber: location.pairIndex + 1,
      melodyPitch: note.pitch,
      melodyPitchLabel: toDisplayPitch(note.pitch),
      chordSourceLabel: coveringChordMarker?.sourceLabel ?? null,
      chordDisplayLabel: coveringChordMarker?.displayLabel ?? null,
      existingChordPitches: sortPitchesByMidi(note.chordPitches ?? []),
      previewClef: location.staff,
      previewKeyFifths: resolvePairKeyFifths(location.pairIndex, measureKeyFifthsByMeasure),
    })
    setOctaveOption(null)
    setChordCountOption(null)
    setFilterOptions([])
    setSelectedCandidateKey(null)
    setIsOpen(true)
  }, [importedNoteLookupRef, measureKeyFifthsByMeasure, measurePairsRef, sortedChordMarkerMeta])

  const candidates = useMemo<SmartChordToneCandidate[]>(() => {
    if (!target?.chordSourceLabel) return []
    return enumerateSmartChordToneCandidates({
      melodyPitch: target.melodyPitch,
      chordName: target.chordSourceLabel,
      octaveOption,
      chordCountOption,
      filterOptions,
    })
  }, [chordCountOption, filterOptions, octaveOption, target])

  useEffect(() => {
    if (!isOpen) return
    setSelectedCandidateKey((current) => {
      if (current && candidates.some((candidate) => candidate.key === current)) {
        return current
      }
      if (!target) return null
      const matchedCandidate = candidates.find((candidate) =>
        arePitchListsEquivalentByMidi(candidate.addedPitches, target.existingChordPitches),
      )
      return matchedCandidate?.key ?? null
    })
  }, [candidates, isOpen, target])

  const toggleOctaveOption = useCallback((nextOption: SmartChordToneOctaveOption) => {
    setOctaveOption((current) => (current === nextOption ? null : nextOption))
  }, [])

  const toggleChordCountOption = useCallback((nextOption: SmartChordToneCountOption) => {
    setChordCountOption((current) => (current === nextOption ? null : nextOption))
  }, [])

  const toggleFilterOption = useCallback((nextOption: SmartChordToneFilterOption) => {
    setFilterOptions((current) =>
      current.includes(nextOption) ? current.filter((entry) => entry !== nextOption) : [...current, nextOption],
    )
  }, [])

  const previewCandidate = useCallback((candidateKey: string) => {
    const candidate = candidates.find((entry) => entry.key === candidateKey)
    if (!candidate) return
    setSelectedCandidateKey(candidate.key)
    handlePreviewPitchStack({
      pitches: candidate.allPitches,
      mode: 'click',
    })
  }, [candidates, handlePreviewPitchStack])

  const applyCandidate = useCallback((candidateKey: string) => {
    if (!target) return
    const candidate = candidates.find((entry) => entry.key === candidateKey)
    if (!candidate) return

    const nextChordPitches = sortPitchesByMidi(candidate.addedPitches)
    const mutation = replaceNoteChordPitches({
      pairs: measurePairsRef.current,
      selection: target.selection,
      chordPitches: nextChordPitches,
      keyFifthsByMeasure: measureKeyFifthsByMeasure,
      importedNoteLookup: importedNoteLookupRef.current,
    })

    if (mutation) {
      applyKeyboardEditResult(mutation.nextPairs, mutation.nextSelection, [mutation.nextSelection])
    } else {
      restoreTargetSelection(target.selection)
    }

    closeSmartChordToneDialog()
  }, [
    applyKeyboardEditResult,
    candidates,
    closeSmartChordToneDialog,
    importedNoteLookupRef,
    measureKeyFifthsByMeasure,
    measurePairsRef,
    restoreTargetSelection,
    target,
  ])

  return {
    openSmartChordToneDialogForSelection,
    smartChordToneDialog: {
      isOpen,
      target,
      octaveOption,
      chordCountOption,
      filterOptions,
      candidates,
      selectedCandidateKey,
      closeSmartChordToneDialog,
      toggleOctaveOption,
      toggleChordCountOption,
      toggleFilterOption,
      previewCandidate,
      applyCandidate,
    },
  }
}
