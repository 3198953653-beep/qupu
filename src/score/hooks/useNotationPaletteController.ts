import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { getAccidentalEditFailureMessage, getDurationEditFailureMessage } from '../editorMessages'
import { applyPaletteDurationEdit } from '../durationEdits'
import { applyPaletteAccidentalEdit } from '../accidentalEdits'
import {
  toggleDottedDuration,
  toTargetDurationFromPalette,
  type NotationPaletteItem,
  type NotationPaletteSelection,
} from '../notationPaletteConfig'
import type { ImportFeedback, ImportedNoteLocation, MeasurePair, ScoreNote, Selection } from '../types'

export function useNotationPaletteController(params: {
  activeSelection: Selection
  selectedSelections: Selection[]
  isSelectionVisible: boolean
  currentSelection: ScoreNote | null
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measurePairsFromImportRef: MutableRefObject<MeasurePair[] | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<import('../types').TimeSignature[] | null>
  setImportFeedback: Dispatch<SetStateAction<ImportFeedback>>
  setIsNotationPaletteOpen: Dispatch<SetStateAction<boolean>>
  setNotationPaletteSelection: Dispatch<SetStateAction<NotationPaletteSelection>>
  setNotationPaletteLastAction: Dispatch<SetStateAction<string>>
  applyKeyboardEditResult: (
    nextPairs: MeasurePair[],
    nextSelection: Selection,
    nextSelections?: Selection[],
    source?: 'default' | 'midi-step',
    options?: { collapseScopesToAdd?: import('../fullMeasureRestCollapse').MeasureStaffScope[] },
  ) => void
  playAccidentalEditPreview: (params: {
    pairs: MeasurePair[]
    previewSelection: Selection | null
    previewPitch: import('../types').Pitch | null
    importedNoteLookup: Map<string, ImportedNoteLocation>
  }) => void
}): {
  openBeamGroupingTool: () => void
  toggleNotationPalette: () => void
  closeNotationPalette: () => void
  onNotationPaletteSelectionChange: (
    nextSelection: NotationPaletteSelection,
    actionLabel: string,
    item: NotationPaletteItem,
  ) => void
} {
  const {
    activeSelection,
    selectedSelections,
    isSelectionVisible,
    currentSelection,
    measurePairsRef,
    measurePairsFromImportRef,
    importedNoteLookupRef,
    measureKeyFifthsFromImportRef,
    measureTimeSignaturesFromImportRef,
    setImportFeedback,
    setIsNotationPaletteOpen,
    setNotationPaletteSelection,
    setNotationPaletteLastAction,
    applyKeyboardEditResult,
    playAccidentalEditPreview,
  } = params

  const openBeamGroupingTool = useCallback(() => {
    window.alert('音值组合算法已就绪，暂未接入业务流程。')
    setImportFeedback({
      kind: 'success',
      message: '音值组合算法模块已就绪（暂未接入业务流程）。',
    })
    console.info('[beam-grouping] 独立算法入口已就绪：src/score/beamGrouping.ts（当前仅占位提示，不改谱面）')
  }, [setImportFeedback])

  const toggleNotationPalette = useCallback(() => {
    setIsNotationPaletteOpen(true)
  }, [setIsNotationPaletteOpen])

  const closeNotationPalette = useCallback(() => {
    setIsNotationPaletteOpen(false)
  }, [setIsNotationPaletteOpen])

  const onNotationPaletteSelectionChange = useCallback((
    nextSelection: NotationPaletteSelection,
    actionLabel: string,
    item: NotationPaletteItem,
  ) => {
    setNotationPaletteSelection(nextSelection)
    const sourcePairs = measurePairsRef.current
    const sourceImportedNoteLookup = importedNoteLookupRef.current
    const importedMode = measurePairsFromImportRef.current !== null

    if (item.behavior === 'ui-only') {
      setNotationPaletteLastAction(actionLabel)
      console.info('[notation-palette]', actionLabel, nextSelection)
      return
    }

    if (item.behavior === 'rest-to-note-disabled') {
      if (isSelectionVisible && currentSelection?.isRest) {
        const message = '首版暂不支持休止符转音符'
        setNotationPaletteLastAction(message)
        console.info('[notation-palette]', message, nextSelection)
        return
      }
      setNotationPaletteLastAction(actionLabel)
      console.info('[notation-palette]', actionLabel, nextSelection)
      return
    }

    if (item.behavior === 'accidental-edit' && item.kind === 'accidental') {
      const attempt = applyPaletteAccidentalEdit({
        pairs: sourcePairs,
        activeSelection,
        selectedSelections,
        isSelectionVisible,
        importedNoteLookup: importedNoteLookupRef.current,
        keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
        accidentalId: item.id,
      })
      if (attempt.error) {
        const message = getAccidentalEditFailureMessage(attempt.error)
        setNotationPaletteLastAction(message)
        console.info('[notation-palette]', message, nextSelection)
        return
      }
      if (attempt.result) {
        applyKeyboardEditResult(attempt.result.nextPairs, attempt.result.nextSelection, attempt.result.nextSelections)
        playAccidentalEditPreview({
          pairs: sourcePairs,
          previewSelection: attempt.result.previewSelection,
          previewPitch: attempt.result.previewPitch,
          importedNoteLookup: sourceImportedNoteLookup,
        })
      }
      setNotationPaletteLastAction(actionLabel)
      console.info('[notation-palette]', actionLabel, nextSelection)
      return
    }

    const action =
      item.behavior === 'duration-edit' && item.kind === 'duration'
        ? { type: 'duration' as const, targetDuration: toTargetDurationFromPalette(item.id) }
        : item.behavior === 'dot-toggle'
          ? { type: 'toggle-dot' as const, targetDuration: currentSelection ? toggleDottedDuration(currentSelection.duration) : null }
          : item.behavior === 'note-to-rest'
            ? { type: 'note-to-rest' as const }
            : null

    if (!action) {
      setNotationPaletteLastAction(actionLabel)
      console.info('[notation-palette]', actionLabel, nextSelection)
      return
    }

    const attempt = applyPaletteDurationEdit({
      pairs: sourcePairs,
      activeSelection,
      selectedSelections,
      isSelectionVisible,
      importedNoteLookup: importedNoteLookupRef.current,
      keyFifthsByMeasure: measureKeyFifthsFromImportRef.current,
      timeSignaturesByMeasure: measureTimeSignaturesFromImportRef.current,
      action,
      importedMode,
    })

    if (attempt.error) {
      const message = getDurationEditFailureMessage(attempt.error)
      setNotationPaletteLastAction(message)
      console.info('[notation-palette]', message, nextSelection)
      return
    }

    if (attempt.result) {
      applyKeyboardEditResult(attempt.result.nextPairs, attempt.result.nextSelection, attempt.result.nextSelections)
    }

    setNotationPaletteLastAction(actionLabel)
    console.info('[notation-palette]', actionLabel, nextSelection)
  }, [
    activeSelection,
    applyKeyboardEditResult,
    currentSelection,
    importedNoteLookupRef,
    isSelectionVisible,
    measureKeyFifthsFromImportRef,
    measurePairsFromImportRef,
    measurePairsRef,
    measureTimeSignaturesFromImportRef,
    playAccidentalEditPreview,
    selectedSelections,
    setNotationPaletteLastAction,
    setNotationPaletteSelection,
  ])

  return {
    openBeamGroupingTool,
    toggleNotationPalette,
    closeNotationPalette,
    onNotationPaletteSelectionChange,
  }
}
