import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type {
  ImportedNoteLocation,
  MeasureFrame,
  MeasurePair,
  NoteLayout,
  Selection,
} from '../types'
import { buildOsmdPreviewNoteLookup } from './buildOsmdPreviewNoteLookup'
import { useOsmdPreviewEditorJump } from './useOsmdPreviewEditorJump'
import { useOsmdPreviewNoteHighlight } from './useOsmdPreviewNoteHighlight'
import type { OsmdPreviewInstance, OsmdPreviewSelectionTarget } from './osmdPreviewUtils'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useOsmdPreviewNavigation(params: {
  measurePairs: MeasurePair[]
  measurePairsRef: MutableRefObject<MeasurePair[]>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  horizontalMeasureFramesByPair: MeasureFrame[]
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  noteLayoutByKeyRef: MutableRefObject<Map<string, NoteLayout>>
  horizontalRenderOffsetXRef: MutableRefObject<number>
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  scoreScaleX: number
  osmdPreviewSourceMode: 'editor' | 'direct-file'
  osmdPreviewContainerRef: MutableRefObject<HTMLDivElement | null>
  osmdPreviewInstanceRef: MutableRefObject<OsmdPreviewInstance | null>
  closeOsmdPreviewRef: MutableRefObject<(() => void) | null>
  resetMidiStepChain: () => void
  setIsSelectionVisible: StateSetter<boolean>
  setActiveSelection: StateSetter<Selection>
  setSelectedSelections: StateSetter<Selection[]>
  setDraggingSelection: StateSetter<Selection | null>
  setSelectedMeasureScope: StateSetter<{ pairIndex: number; staff: Selection['staff'] } | null>
  clearActiveChordSelection: () => void
}) {
  const {
    measurePairs,
    measurePairsRef,
    importedNoteLookupRef,
    horizontalMeasureFramesByPair,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    scoreScrollRef,
    scoreScaleX,
    osmdPreviewSourceMode,
    osmdPreviewContainerRef,
    osmdPreviewInstanceRef,
    closeOsmdPreviewRef,
    resetMidiStepChain,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setDraggingSelection,
    setSelectedMeasureScope,
    clearActiveChordSelection,
  } = params

  const osmdPreviewNoteLookupByDomIdRef = useRef<Map<string, OsmdPreviewSelectionTarget>>(new Map())
  const osmdPreviewNoteLookupBySelectionRef = useRef<Map<string, OsmdPreviewSelectionTarget>>(new Map())
  const {
    osmdPreviewSelectedSelectionKeyRef,
    clearOsmdPreviewNoteHighlight,
    applyOsmdPreviewNoteHighlight,
  } = useOsmdPreviewNoteHighlight({
    osmdPreviewContainerRef,
  })

  const resetOsmdPreviewNavigationState = useCallback(() => {
    clearOsmdPreviewNoteHighlight()
    osmdPreviewNoteLookupByDomIdRef.current.clear()
    osmdPreviewNoteLookupBySelectionRef.current.clear()
    osmdPreviewSelectedSelectionKeyRef.current = null
  }, [clearOsmdPreviewNoteHighlight, osmdPreviewSelectedSelectionKeyRef])

  const rebuildOsmdPreviewNoteLookup = useCallback(() => {
    const { lookupByDomId, lookupBySelection } = buildOsmdPreviewNoteLookup({
      measurePairs,
      osmdPreviewInstance: osmdPreviewInstanceRef.current,
      osmdPreviewSourceMode,
    })

    osmdPreviewNoteLookupByDomIdRef.current = lookupByDomId
    osmdPreviewNoteLookupBySelectionRef.current = lookupBySelection
    const selectedKey = osmdPreviewSelectedSelectionKeyRef.current
    if (!selectedKey) {
      clearOsmdPreviewNoteHighlight()
      return
    }
    applyOsmdPreviewNoteHighlight(lookupBySelection.get(selectedKey) ?? null)
  }, [
    applyOsmdPreviewNoteHighlight,
    clearOsmdPreviewNoteHighlight,
    measurePairs,
    osmdPreviewInstanceRef,
    osmdPreviewSelectedSelectionKeyRef,
    osmdPreviewSourceMode,
  ])

  const editorJump = useOsmdPreviewEditorJump({
    measurePairsRef,
    importedNoteLookupRef,
    horizontalMeasureFramesByPair,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    scoreScrollRef,
    scoreScaleX,
    osmdPreviewSourceMode,
    osmdPreviewContainerRef,
    closeOsmdPreviewRef,
    resetMidiStepChain,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setDraggingSelection,
    setSelectedMeasureScope,
    clearActiveChordSelection,
    osmdPreviewNoteLookupByDomIdRef,
    osmdPreviewSelectedSelectionKeyRef,
    clearOsmdPreviewNoteHighlight,
    applyOsmdPreviewNoteHighlight,
  })

  return {
    osmdPreviewNoteLookupBySelectionRef,
    osmdPreviewSelectedSelectionKeyRef,
    clearOsmdPreviewNoteHighlight,
    resetOsmdPreviewNavigationState,
    rebuildOsmdPreviewNoteLookup,
    onOsmdPreviewSurfaceClick: editorJump.onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick: editorJump.onOsmdPreviewSurfaceDoubleClick,
  }
}
