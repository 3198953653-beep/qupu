import { useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { buildNotationPaletteDerivedDisplay, type NotationPaletteDerivedDisplay, type NotationPaletteResolvedSelection } from '../notationPaletteConfig'
import { findSelectionLocationInPairs } from '../keyboardEdits'
import { toDisplayPitch } from '../pitchUtils'
import type {
  ActivePedalSelection,
  ImportFeedback,
  ImportedNoteLocation,
  MeasurePair,
  PedalSpan,
  ScoreNote,
  Selection,
  TieSelection,
} from '../types'

function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}

function appendUniqueSelection(current: Selection[], next: Selection): Selection[] {
  if (current.some((entry) => isSameSelection(entry, next))) return current
  return [...current, next]
}

function serializeNullableString(value: string | null | undefined): string {
  return value ?? ''
}

function serializeNullableNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function buildScoreNoteContentSignature(notes: ScoreNote[]): string {
  return notes
    .map((note) => [
      note.id,
      note.pitch,
      note.duration,
      note.isRest === true ? '1' : '0',
      serializeNullableString(note.accidental),
      (note.chordPitches ?? []).join(','),
      (note.chordAccidentals ?? []).map((value) => serializeNullableString(value)).join(','),
      note.tieStart === true ? '1' : '0',
      note.tieStop === true ? '1' : '0',
      (note.chordTieStarts ?? []).map((value) => (value === true ? '1' : '0')).join(','),
      (note.chordTieStops ?? []).map((value) => (value === true ? '1' : '0')).join(','),
      serializeNullableString(note.tieFrozenIncomingPitch),
      serializeNullableString(note.tieFrozenIncomingFromNoteId),
      serializeNullableNumber(note.tieFrozenIncomingFromKeyIndex),
      (note.chordTieFrozenIncomingPitches ?? []).map((value) => serializeNullableString(value)).join(','),
      (note.chordTieFrozenIncomingFromNoteIds ?? []).map((value) => serializeNullableString(value)).join(','),
      (note.chordTieFrozenIncomingFromKeyIndices ?? []).map((value) => serializeNullableNumber(value)).join(','),
    ].join('|'))
    .join('||')
}

export function useScoreSelectionController(params: {
  notes: ScoreNote[]
  bassNotes: ScoreNote[]
  measurePairs: MeasurePair[]
  pedalSpans: PedalSpan[]
  activeSelection: Selection
  selectedSelections: Selection[]
  selectedMeasureScope: { pairIndex: number; staff: Selection['staff'] } | null
  activeTieSelection: TieSelection | null
  activePedalSelection: ActivePedalSelection | null
  isSelectionVisible: boolean
  draggingSelection: Selection | null
  selectionFrameIntent: import('../types').SelectionFrameIntent
  importFeedback: ImportFeedback
  fallbackSelectionNote: ScoreNote
  trebleNoteById: Map<string, ScoreNote>
  bassNoteById: Map<string, ScoreNote>
  trebleNoteIndexById: Map<string, number>
  bassNoteIndexById: Map<string, number>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  activeSelectionRef: MutableRefObject<Selection>
  activePedalSelectionRef: MutableRefObject<ActivePedalSelection | null>
  pedalSpansRef: MutableRefObject<PedalSpan[]>
  selectedSelectionsRef: MutableRefObject<Selection[]>
  fullMeasureRestCollapseScopeKeys: string[]
  fullMeasureRestCollapseScopeKeysRef: MutableRefObject<string[]>
  isSelectionVisibleRef: MutableRefObject<boolean>
  draggingSelectionRef: MutableRefObject<Selection | null>
  importFeedbackRef: MutableRefObject<ImportFeedback>
  setIsSelectionVisible: (visible: boolean) => void
  setActiveSelection: (selection: Selection) => void
  setSelectedSelections: Dispatch<SetStateAction<Selection[]>>
  setSelectedMeasureScope: (scope: { pairIndex: number; staff: Selection['staff'] } | null) => void
  setActiveTieSelection: (selection: TieSelection | null) => void
  setActivePedalSelection: (selection: ActivePedalSelection | null) => void
  setSelectionFrameIntent: Dispatch<SetStateAction<import('../types').SelectionFrameIntent>>
}): {
  currentSelection: ScoreNote
  currentSelectionPosition: number
  currentSelectionPitchLabel: string
  selectedPoolSize: number
  derivedNotationPaletteDisplay: NotationPaletteDerivedDisplay
} {
  const {
    notes,
    bassNotes,
    measurePairs,
    pedalSpans,
    activeSelection,
    selectedSelections,
    selectedMeasureScope,
    activeTieSelection,
    activePedalSelection,
    isSelectionVisible,
    draggingSelection,
    selectionFrameIntent,
    importFeedback,
    fallbackSelectionNote,
    trebleNoteById,
    bassNoteById,
    trebleNoteIndexById,
    bassNoteIndexById,
    importedNoteLookupRef,
    activeSelectionRef,
    activePedalSelectionRef,
    pedalSpansRef,
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
    setActivePedalSelection,
    setSelectionFrameIntent,
  } = params

  const notesContentSignature = useMemo(() => buildScoreNoteContentSignature(notes), [notes])
  const bassNotesContentSignature = useMemo(() => buildScoreNoteContentSignature(bassNotes), [bassNotes])
  const previousNotesContentSignatureRef = useRef(notesContentSignature)
  const previousBassNotesContentSignatureRef = useRef(bassNotesContentSignature)

  useEffect(() => {
    const notesChanged =
      previousNotesContentSignatureRef.current !== notesContentSignature ||
      previousBassNotesContentSignatureRef.current !== bassNotesContentSignature
    previousNotesContentSignatureRef.current = notesContentSignature
    previousBassNotesContentSignatureRef.current = bassNotesContentSignature
    if (!notesChanged) return
    if (selectionFrameIntent === 'default') return
    setSelectionFrameIntent('default')
  }, [bassNotesContentSignature, notesContentSignature, selectionFrameIntent, setSelectionFrameIntent])

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
  }, [activeSelection, bassNotes, notes, setActiveSelection, setIsSelectionVisible])

  const activePool = activeSelection.staff === 'treble' ? notes : bassNotes
  const activePoolById = activeSelection.staff === 'treble' ? trebleNoteById : bassNoteById
  const activePoolIndexById = activeSelection.staff === 'treble' ? trebleNoteIndexById : bassNoteIndexById
  const currentSelection =
    activePoolById.get(activeSelection.noteId) ??
    activePool[0] ??
    notes[0] ??
    bassNotes[0] ??
    fallbackSelectionNote
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
  }, [
    activeSelection,
    bassNoteById,
    importedNoteLookupRef,
    isSelectionVisible,
    measurePairs,
    selectedSelections,
    trebleNoteById,
  ])

  useEffect(() => {
    activeSelectionRef.current = activeSelection
  }, [activeSelection, activeSelectionRef])

  useEffect(() => {
    activePedalSelectionRef.current = activePedalSelection
  }, [activePedalSelection, activePedalSelectionRef])

  useEffect(() => {
    pedalSpansRef.current = pedalSpans
  }, [pedalSpans, pedalSpansRef])

  useEffect(() => {
    selectedSelectionsRef.current = selectedSelections
  }, [selectedSelections, selectedSelectionsRef])

  useEffect(() => {
    fullMeasureRestCollapseScopeKeysRef.current = fullMeasureRestCollapseScopeKeys
  }, [fullMeasureRestCollapseScopeKeys, fullMeasureRestCollapseScopeKeysRef])

  useEffect(() => {
    if (isSelectionVisible) return
    if (selectedMeasureScope === null) return
    setSelectedMeasureScope(null)
  }, [isSelectionVisible, selectedMeasureScope, setSelectedMeasureScope])

  useEffect(() => {
    if (selectedMeasureScope === null) return
    if (selectedMeasureScope.pairIndex >= measurePairs.length) {
      setSelectedMeasureScope(null)
    }
  }, [measurePairs.length, selectedMeasureScope, setSelectedMeasureScope])

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
  }, [activeTieSelection, measurePairs, setActiveTieSelection])

  useEffect(() => {
    if (!activePedalSelection) return
    const stillExists = pedalSpans.some((span) => span.id === activePedalSelection.pedalId)
    if (stillExists) return
    setActivePedalSelection(null)
  }, [activePedalSelection, pedalSpans, setActivePedalSelection])

  useEffect(() => {
    isSelectionVisibleRef.current = isSelectionVisible
  }, [isSelectionVisible, isSelectionVisibleRef])

  useEffect(() => {
    draggingSelectionRef.current = draggingSelection
  }, [draggingSelection, draggingSelectionRef])

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
  }, [activeSelection, bassNoteById, isSelectionVisible, setSelectedSelections, trebleNoteById])

  useEffect(() => {
    importFeedbackRef.current = importFeedback
  }, [importFeedback, importFeedbackRef])

  return {
    currentSelection,
    currentSelectionPosition,
    currentSelectionPitchLabel,
    selectedPoolSize: activePool.length,
    derivedNotationPaletteDisplay,
  }
}
