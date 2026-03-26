import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import {
  PIANO_MAX_MIDI,
  PIANO_MIN_MIDI,
  STEP_TO_SEMITONE,
} from '../constants'
import {
  buildAccidentalStateBeforeNote,
  getEffectivePitchForStaffPosition,
} from '../accidentals'
import {
  getCopyPasteFailureMessage,
  getDeleteAccidentalFailureMessage,
  getDeleteMeasureFailureMessage,
  getDeleteTieFailureMessage,
} from '../editorMessages'
import { toDisplayDuration } from '../layout/demand'
import { applyDeleteAccidentalSelection } from '../accidentalEdits'
import { applyDeleteMeasureSelection } from '../measureEdits'
import { applyDeleteTieSelection } from '../tieEdits'
import {
  appendIntervalKey,
  deleteSelectedKey,
  findSelectionLocationInPairs,
} from '../keyboardEdits'
import {
  applyClipboardPaste,
  buildClipboardFromSelections,
} from '../copyPasteEdits'
import { flattenBassFromPairs, flattenTrebleFromPairs } from '../scoreOps'
import { getStepOctaveAlterFromPitch, toPitchFromStepAlter } from '../pitchMath'
import {
  resolveForwardTieTargets,
  resolvePreviousTieTarget,
} from '../tieChain'
import { buildSelectionGroupMoveTargets } from '../selectionGroupTargets'
import { commitDragPitchToScoreData } from '../dragInteractions'
import type { NoteClipboardPayload } from '../copyPasteTypes'
import type {
  DragState,
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  Pitch,
  ScoreNote,
  Selection,
  TieSelection,
  TimeSignature,
} from '../types'

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

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('[contenteditable="true"]'))
}

function isSameSelection(left: Selection, right: Selection): boolean {
  return left.noteId === right.noteId && left.staff === right.staff && left.keyIndex === right.keyIndex
}

function appendUniqueSelection(current: Selection[], next: Selection): Selection[] {
  if (current.some((entry) => isSameSelection(entry, next))) return current
  return [...current, next]
}

type MeasureScope = { pairIndex: number; staff: Selection['staff'] } | null

export function useKeyboardCommandController(params: {
  isOsmdPreviewOpen: boolean
  draggingSelection: Selection | null
  isSelectionVisible: boolean
  measurePairs: MeasurePair[]
  activeSelection: Selection
  selectedSelections: Selection[]
  selectedMeasureScope: MeasureScope
  activeTieSelection: TieSelection | null
  activeAccidentalSelection: Selection | null
  measureKeyFifthsFromImport: number[] | null
  activeSelectionRef: MutableRefObject<Selection>
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureLayoutsRef: MutableRefObject<Map<number, MeasureLayout>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  layoutReflowHintRef: MutableRefObject<LayoutReflowHint | null>
  layoutStabilityKey: string
  pushUndoSnapshot: (sourcePairs: MeasurePair[]) => void
  resetMidiStepChain: () => void
  undoLastScoreEdit: () => boolean
  applyKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections?: Selection[],
    source?: 'default' | 'midi-step',
    options?: { collapseScopesToAdd?: Array<{ pairIndex: number; staff: Selection['staff'] }> },
  ) => void
  playAccidentalEditPreview: (params: {
    pairs: MeasurePair[]
    previewSelection: Selection | null
    previewPitch: Pitch | null
    importedNoteLookup?: Map<string, ImportedNoteLocation> | null
  }) => void
  setNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setBassNotes: Dispatch<SetStateAction<ScoreNote[]>>
  setMeasurePairsFromImport: Dispatch<SetStateAction<MeasurePair[] | null>>
  setIsSelectionVisible: Dispatch<SetStateAction<boolean>>
  setSelectedSelections: Dispatch<SetStateAction<Selection[]>>
  setSelectedMeasureScope: Dispatch<SetStateAction<MeasureScope>>
  setActiveSelection: Dispatch<SetStateAction<Selection>>
  setActiveTieSelection: Dispatch<SetStateAction<TieSelection | null>>
  setActiveAccidentalSelection: Dispatch<SetStateAction<Selection | null>>
  setNotationPaletteLastAction: Dispatch<SetStateAction<string>>
}): void {
  const {
    isOsmdPreviewOpen,
    draggingSelection,
    isSelectionVisible,
    measurePairs,
    activeSelection,
    selectedSelections,
    selectedMeasureScope,
    activeTieSelection,
    activeAccidentalSelection,
    measureKeyFifthsFromImport,
    activeSelectionRef,
    measurePairsRef,
    measurePairsFromImportRef,
    importedNoteLookupRef,
    measureLayoutsRef,
    measureKeyFifthsFromImportRef,
    measureTimeSignaturesFromImportRef,
    scoreScrollRef,
    layoutReflowHintRef,
    layoutStabilityKey,
    pushUndoSnapshot,
    resetMidiStepChain,
    undoLastScoreEdit,
    applyKeyboardEditResult,
    playAccidentalEditPreview,
    setNotes,
    setBassNotes,
    setMeasurePairsFromImport,
    setIsSelectionVisible,
    setSelectedSelections,
    setSelectedMeasureScope,
    setActiveSelection,
    setActiveTieSelection,
    setActiveAccidentalSelection,
    setNotationPaletteLastAction,
  } = params

  const noteClipboardRef = useRef<NoteClipboardPayload | null>(null)

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
    activeSelectionRef,
    importedNoteLookupRef,
    layoutStabilityKey,
    layoutReflowHintRef,
    measureKeyFifthsFromImportRef,
    measureLayoutsRef,
    measurePairsFromImportRef,
    measurePairsRef,
    pushUndoSnapshot,
    resetMidiStepChain,
    selectedSelections,
    setActiveSelection,
    setBassNotes,
    setIsSelectionVisible,
    setMeasurePairsFromImport,
    setNotes,
    setSelectedSelections,
  ])

  const moveSelectionByKeyboardArrow = useCallback((direction: 'up' | 'down'): boolean => {
    return moveSelectionsByKeyboardSteps(direction, 1, 'active')
  }, [moveSelectionsByKeyboardSteps])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOsmdPreviewOpen) return
      if (draggingSelection) return
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
    activeSelection,
    activeTieSelection,
    applyKeyboardEditResult,
    draggingSelection,
    importedNoteLookupRef,
    isOsmdPreviewOpen,
    isSelectionVisible,
    measureKeyFifthsFromImport,
    measureKeyFifthsFromImportRef,
    measurePairs,
    measurePairsFromImportRef,
    measureTimeSignaturesFromImportRef,
    moveSelectionByKeyboardArrow,
    moveSelectionsByKeyboardSteps,
    playAccidentalEditPreview,
    scoreScrollRef,
    selectedMeasureScope,
    selectedSelections,
    setActiveAccidentalSelection,
    setActiveTieSelection,
    setIsSelectionVisible,
    setNotationPaletteLastAction,
    setSelectedMeasureScope,
    setSelectedSelections,
    undoLastScoreEdit,
  ])
}
