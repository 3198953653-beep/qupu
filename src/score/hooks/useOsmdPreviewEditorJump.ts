import { useCallback, type Dispatch, type MouseEvent as ReactMouseEvent, type MutableRefObject, type SetStateAction } from 'react'
import { findSelectionLocationInPairs } from '../keyboardEdits'
import { getLayoutNoteKey } from '../layout/renderPosition'
import type {
  ImportedNoteLocation,
  MeasureFrame,
  MeasurePair,
  NoteLayout,
  Selection,
} from '../types'
import {
  getSelectionKey,
  type OsmdPreviewSelectionTarget,
} from './osmdPreviewUtils'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useOsmdPreviewEditorJump(params: {
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
  closeOsmdPreviewRef: MutableRefObject<(() => void) | null>
  resetMidiStepChain: () => void
  setIsSelectionVisible: StateSetter<boolean>
  setActiveSelection: StateSetter<Selection>
  setSelectedSelections: StateSetter<Selection[]>
  setDraggingSelection: StateSetter<Selection | null>
  setSelectedMeasureScope: StateSetter<{ pairIndex: number; staff: Selection['staff'] } | null>
  setSelectionFrameIntent: StateSetter<import('../types').SelectionFrameIntent>
  clearActiveChordSelection: () => void
  osmdPreviewNoteLookupByDomIdRef: MutableRefObject<Map<string, OsmdPreviewSelectionTarget>>
  osmdPreviewSelectedSelectionKeyRef: MutableRefObject<string | null>
  clearOsmdPreviewNoteHighlight: () => void
  applyOsmdPreviewNoteHighlight: (target: OsmdPreviewSelectionTarget | null) => void
}) {
  const {
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
    setSelectionFrameIntent,
    clearActiveChordSelection,
    osmdPreviewNoteLookupByDomIdRef,
    osmdPreviewSelectedSelectionKeyRef,
    clearOsmdPreviewNoteHighlight,
    applyOsmdPreviewNoteHighlight,
  } = params

  const resolveOsmdPreviewTargetFromEvent = useCallback((eventTarget: EventTarget | null): OsmdPreviewSelectionTarget | null => {
    const container = osmdPreviewContainerRef.current
    if (!container || !(eventTarget instanceof Element)) return null
    let current: Element | null = eventTarget
    while (current && current !== container) {
      const id = (current as HTMLElement).id
      if (id) {
        const lookup = osmdPreviewNoteLookupByDomIdRef.current
        const target = lookup.get(id) ?? (id.startsWith('vf-') ? lookup.get(id.slice(3)) : lookup.get(`vf-${id}`))
        if (target) return target
      }
      current = current.parentElement
    }
    return null
  }, [osmdPreviewContainerRef, osmdPreviewNoteLookupByDomIdRef])

  const jumpFromOsmdPreviewToEditor = useCallback((target: OsmdPreviewSelectionTarget) => {
    const { selection, pairIndex } = target
    resetMidiStepChain()
    setIsSelectionVisible(true)
    setActiveSelection(selection)
    setSelectedSelections([selection])
    setDraggingSelection(null)
    setSelectedMeasureScope(null)
    setSelectionFrameIntent('default')
    clearActiveChordSelection()
    closeOsmdPreviewRef.current?.()

    const scrollHost = scoreScrollRef.current
    if (!scrollHost) return
    const resolvedLocation = findSelectionLocationInPairs({
      pairs: measurePairsRef.current,
      selection,
      importedNoteLookup: importedNoteLookupRef.current,
    })
    const resolvedPairIndex = resolvedLocation?.pairIndex ?? pairIndex
    const getCoarseScrollLeft = (): number | null => {
      const frame = horizontalMeasureFramesByPair[resolvedPairIndex]
      if (!frame) return null
      const frameCenterX = frame.measureX + frame.measureWidth * 0.5
      return Math.max(0, frameCenterX * scoreScaleX - scrollHost.clientWidth * 0.5)
    }
    const getPreciseScrollLeft = (): number | null => {
      const pairLayouts = noteLayoutsByPairRef.current.get(resolvedPairIndex) ?? []
      const noteLayout =
        pairLayouts.find((layout) => layout.id === selection.noteId && layout.staff === selection.staff) ??
        noteLayoutByKeyRef.current.get(getLayoutNoteKey(selection.staff, selection.noteId))
      if (!noteLayout) return null
      const targetHeadX = noteLayout.noteHeads.find((head) => head.keyIndex === selection.keyIndex)?.x ?? noteLayout.x
      const targetHeadGlobalX = horizontalRenderOffsetXRef.current + targetHeadX
      return Math.max(0, targetHeadGlobalX * scoreScaleX - scrollHost.clientWidth * 0.5)
    }

    const MAX_ATTEMPTS = 48
    let attempts = 0
    const runJumpLoop = () => {
      attempts += 1
      const coarseScrollLeft = getCoarseScrollLeft()
      if (coarseScrollLeft !== null) {
        scrollHost.scrollLeft = coarseScrollLeft
      }
      const preciseScrollLeft = getPreciseScrollLeft()
      if (preciseScrollLeft !== null) {
        scrollHost.scrollLeft = preciseScrollLeft
        return
      }
      if (attempts < MAX_ATTEMPTS) {
        window.requestAnimationFrame(runJumpLoop)
      } else {
        console.warn(
          `[osmd-jump] 无法精确定位目标音符，已停在目标小节附近。selection=${selection.staff}:${selection.noteId}[${selection.keyIndex}] pair=${resolvedPairIndex}`,
        )
      }
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(runJumpLoop)
    })
  }, [
    clearActiveChordSelection,
    closeOsmdPreviewRef,
    horizontalMeasureFramesByPair,
    horizontalRenderOffsetXRef,
    importedNoteLookupRef,
    measurePairsRef,
    noteLayoutByKeyRef,
    noteLayoutsByPairRef,
    resetMidiStepChain,
    scoreScaleX,
    scoreScrollRef,
    setActiveSelection,
    setDraggingSelection,
    setIsSelectionVisible,
    setSelectionFrameIntent,
    setSelectedMeasureScope,
    setSelectedSelections,
  ])

  const onOsmdPreviewSurfaceClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (osmdPreviewSourceMode !== 'editor') return
    const target = resolveOsmdPreviewTargetFromEvent(event.target)
    if (!target) {
      osmdPreviewSelectedSelectionKeyRef.current = null
      clearOsmdPreviewNoteHighlight()
      return
    }
    osmdPreviewSelectedSelectionKeyRef.current = getSelectionKey(target.selection)
    applyOsmdPreviewNoteHighlight(target)
  }, [
    applyOsmdPreviewNoteHighlight,
    clearOsmdPreviewNoteHighlight,
    osmdPreviewSelectedSelectionKeyRef,
    osmdPreviewSourceMode,
    resolveOsmdPreviewTargetFromEvent,
  ])

  const onOsmdPreviewSurfaceDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (osmdPreviewSourceMode !== 'editor') return
    const target = resolveOsmdPreviewTargetFromEvent(event.target)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    osmdPreviewSelectedSelectionKeyRef.current = getSelectionKey(target.selection)
    applyOsmdPreviewNoteHighlight(target)
    jumpFromOsmdPreviewToEditor(target)
  }, [
    applyOsmdPreviewNoteHighlight,
    jumpFromOsmdPreviewToEditor,
    osmdPreviewSelectedSelectionKeyRef,
    osmdPreviewSourceMode,
    resolveOsmdPreviewTargetFromEvent,
  ])

  return {
    onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick,
  }
}
