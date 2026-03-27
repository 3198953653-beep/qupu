import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction, type MouseEvent as ReactMouseEvent } from 'react'
import { TICKS_PER_BEAT } from '../constants'
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
  buildMeasureStaffOnsetEntries,
  escapeCssId,
  findMeasureStaffOnsetEntry,
  getSelectionKey,
  type OsmdPreviewInstance,
  type OsmdPreviewSelectionTarget,
} from './osmdPreviewUtils'

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
  const osmdPreviewSelectedSelectionKeyRef = useRef<string | null>(null)

  const clearOsmdPreviewNoteHighlight = useCallback(() => {
    const container = osmdPreviewContainerRef.current
    if (!container) return
    container.querySelectorAll('.osmd-preview-note-selected').forEach((node) => {
      node.classList.remove('osmd-preview-note-selected')
    })
  }, [osmdPreviewContainerRef])

  const applyOsmdPreviewNoteHighlight = useCallback((target: OsmdPreviewSelectionTarget | null) => {
    clearOsmdPreviewNoteHighlight()
    if (!target) return
    const container = osmdPreviewContainerRef.current
    if (!container) return
    for (const domId of target.domIds) {
      const targetNode = container.querySelector(`#${escapeCssId(domId)}`)
      if (!targetNode) continue
      targetNode.classList.add('osmd-preview-note-selected')
      return
    }
  }, [clearOsmdPreviewNoteHighlight, osmdPreviewContainerRef])

  const resetOsmdPreviewNavigationState = useCallback(() => {
    clearOsmdPreviewNoteHighlight()
    osmdPreviewNoteLookupByDomIdRef.current.clear()
    osmdPreviewNoteLookupBySelectionRef.current.clear()
    osmdPreviewSelectedSelectionKeyRef.current = null
  }, [clearOsmdPreviewNoteHighlight])

  const rebuildOsmdPreviewNoteLookup = useCallback(() => {
    const osmd = osmdPreviewInstanceRef.current as unknown as {
      GraphicSheet?: {
        MusicPages?: Array<{
          MusicSystems?: Array<{
            StaffLines?: Array<{
              Measures?: Array<{
                measureNumber?: number
                MeasureNumber?: number
                staffEntries?: Array<{
                  graphicalVoiceEntries?: Array<{
                    notes?: Array<{
                      getSVGId?: () => string
                      sourceNote?: {
                        isRestFlag?: boolean
                        isRest?: () => boolean
                        sourceMeasure?: {
                          measureListIndex?: number
                          MeasureListIndex?: number
                          measureNumber?: number
                          MeasureNumber?: number
                        }
                        parentStaffEntry?: {
                          parentStaff?: {
                            idInMusicSheet?: number
                          }
                        }
                        voiceEntry?: {
                          timestamp?: {
                            realValue?: number
                            numerator?: number
                            denominator?: number
                          }
                          notes?: Array<unknown>
                        }
                      }
                    }>
                  }>
                }>
              }>
            }>
          }>
        }>
      }
    } | null

    const lookupByDomId = new Map<string, OsmdPreviewSelectionTarget>()
    const lookupBySelection = new Map<string, OsmdPreviewSelectionTarget>()
    if (osmdPreviewSourceMode !== 'editor') {
      osmdPreviewNoteLookupByDomIdRef.current = lookupByDomId
      osmdPreviewNoteLookupBySelectionRef.current = lookupBySelection
      clearOsmdPreviewNoteHighlight()
      return
    }
    if (!osmd?.GraphicSheet?.MusicPages?.length) {
      osmdPreviewNoteLookupByDomIdRef.current = lookupByDomId
      osmdPreviewNoteLookupBySelectionRef.current = lookupBySelection
      return
    }

    const onsetCache = new Map<string, ReturnType<typeof buildMeasureStaffOnsetEntries>>()
    const getOnsetEntries = (pairIndex: number, staff: 'treble' | 'bass') => {
      const cacheKey = `${pairIndex}|${staff}`
      const cached = onsetCache.get(cacheKey)
      if (cached) return cached
      const pair = measurePairs[pairIndex]
      if (!pair) {
        onsetCache.set(cacheKey, [])
        return []
      }
      const notes = staff === 'treble' ? pair.treble : pair.bass
      const entries = buildMeasureStaffOnsetEntries(notes)
      onsetCache.set(cacheKey, entries)
      return entries
    }

    for (const page of osmd.GraphicSheet.MusicPages) {
      const systems = page?.MusicSystems ?? []
      for (const system of systems) {
        const staffLines = system?.StaffLines ?? []
        for (let staffLineIndex = 0; staffLineIndex < staffLines.length; staffLineIndex += 1) {
          const staffLine = staffLines[staffLineIndex]
          const graphicalMeasures = staffLine?.Measures ?? []
          for (const graphicalMeasure of graphicalMeasures) {
            const staffEntries = graphicalMeasure?.staffEntries ?? []
            for (const graphicalStaffEntry of staffEntries) {
              const graphicalVoiceEntries = graphicalStaffEntry?.graphicalVoiceEntries ?? []
              for (const graphicalVoiceEntry of graphicalVoiceEntries) {
                const graphicalNotes = graphicalVoiceEntry?.notes ?? []
                for (const graphicalNote of graphicalNotes) {
                  const sourceNote = graphicalNote?.sourceNote
                  if (!sourceNote) continue
                  const isRest =
                    sourceNote.isRestFlag === true ||
                    (typeof sourceNote.isRest === 'function' && sourceNote.isRest())
                  if (isRest) continue

                  const sourceMeasure = sourceNote.sourceMeasure
                  const graphicalMeasureAny = graphicalMeasure as {
                    parentSourceMeasure?: {
                      measureListIndex?: number
                      MeasureListIndex?: number
                      measureNumber?: number
                      MeasureNumber?: number
                    }
                    ParentSourceMeasure?: {
                      measureListIndex?: number
                      MeasureListIndex?: number
                      measureNumber?: number
                      MeasureNumber?: number
                    }
                    measureNumber?: number
                    MeasureNumber?: number
                  }
                  const parentSourceMeasure = graphicalMeasureAny.parentSourceMeasure ?? graphicalMeasureAny.ParentSourceMeasure
                  const measureListIndexRaw =
                    sourceMeasure?.measureListIndex ??
                    sourceMeasure?.MeasureListIndex ??
                    parentSourceMeasure?.measureListIndex ??
                    parentSourceMeasure?.MeasureListIndex
                  const measureNumberRaw =
                    sourceMeasure?.measureNumber ??
                    sourceMeasure?.MeasureNumber ??
                    parentSourceMeasure?.measureNumber ??
                    parentSourceMeasure?.MeasureNumber ??
                    graphicalMeasureAny.measureNumber ??
                    graphicalMeasureAny.MeasureNumber
                  const pairIndex =
                    typeof measureListIndexRaw === 'number' && Number.isFinite(measureListIndexRaw)
                      ? Math.max(0, Math.round(measureListIndexRaw))
                      : typeof measureNumberRaw === 'number' && Number.isFinite(measureNumberRaw)
                        ? Math.max(0, Math.round(measureNumberRaw) - 1)
                        : -1
                  if (pairIndex < 0) continue
                  const pair = measurePairs[pairIndex]
                  if (!pair) continue

                  const staffId =
                    sourceNote.parentStaffEntry?.parentStaff?.idInMusicSheet ??
                    (staffLineIndex % 2)
                  const staff: 'treble' | 'bass' = Number(staffId) === 1 ? 'bass' : 'treble'
                  const staffNotes = staff === 'treble' ? pair.treble : pair.bass
                  if (staffNotes.length === 0) continue

                  const timestamp = sourceNote.voiceEntry?.timestamp
                  const realValue =
                    (typeof timestamp?.realValue === 'number' && Number.isFinite(timestamp.realValue)
                      ? timestamp.realValue
                      : null) ??
                    (typeof timestamp?.numerator === 'number' &&
                    Number.isFinite(timestamp.numerator) &&
                    typeof timestamp?.denominator === 'number' &&
                    Number.isFinite(timestamp.denominator) &&
                    timestamp.denominator > 0
                      ? timestamp.numerator / timestamp.denominator
                      : null)
                  if (typeof realValue !== 'number' || !Number.isFinite(realValue)) continue
                  const onsetTicks = Math.round(realValue * TICKS_PER_BEAT * 4)

                  const onsetEntries = getOnsetEntries(pairIndex, staff)
                  const onsetEntry = findMeasureStaffOnsetEntry(onsetEntries, onsetTicks)
                  if (!onsetEntry) continue
                  const note = staffNotes[onsetEntry.noteIndex]
                  if (!note) continue

                  const voiceNotes = sourceNote.voiceEntry?.notes
                  const chordIndex = Array.isArray(voiceNotes)
                    ? Math.max(0, voiceNotes.findIndex((candidate) => candidate === sourceNote))
                    : 0
                  const keyIndex = Math.max(0, Math.min(chordIndex, onsetEntry.maxKeyIndex))
                  const selection: Selection = { noteId: note.id, staff, keyIndex }

                  const rawId = typeof graphicalNote.getSVGId === 'function' ? graphicalNote.getSVGId() : ''
                  if (!rawId) continue
                  const domIds = rawId.startsWith('vf-') ? [rawId, rawId.slice(3)] : [rawId, `vf-${rawId}`]
                  const uniqueDomIds = [...new Set(domIds.filter((value) => value.length > 0))]
                  if (uniqueDomIds.length === 0) continue

                  const target: OsmdPreviewSelectionTarget = {
                    pairIndex,
                    selection,
                    domIds: uniqueDomIds,
                    measureNumber: pairIndex + 1,
                    onsetTicks,
                  }
                  const selectionKey = getSelectionKey(selection)
                  if (!lookupBySelection.has(selectionKey)) {
                    lookupBySelection.set(selectionKey, target)
                  }
                  uniqueDomIds.forEach((domId) => {
                    if (!lookupByDomId.has(domId)) {
                      lookupByDomId.set(domId, target)
                    }
                  })
                }
              }
            }
          }
        }
      }
    }

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
    osmdPreviewSourceMode,
  ])

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
  }, [osmdPreviewContainerRef])

  const jumpFromOsmdPreviewToEditor = useCallback((target: OsmdPreviewSelectionTarget) => {
    const { selection, pairIndex } = target
    resetMidiStepChain()
    setIsSelectionVisible(true)
    setActiveSelection(selection)
    setSelectedSelections([selection])
    setDraggingSelection(null)
    setSelectedMeasureScope(null)
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
  }, [applyOsmdPreviewNoteHighlight, clearOsmdPreviewNoteHighlight, osmdPreviewSourceMode, resolveOsmdPreviewTargetFromEvent])

  const onOsmdPreviewSurfaceDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (osmdPreviewSourceMode !== 'editor') return
    const target = resolveOsmdPreviewTargetFromEvent(event.target)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    osmdPreviewSelectedSelectionKeyRef.current = getSelectionKey(target.selection)
    applyOsmdPreviewNoteHighlight(target)
    jumpFromOsmdPreviewToEditor(target)
  }, [applyOsmdPreviewNoteHighlight, jumpFromOsmdPreviewToEditor, osmdPreviewSourceMode, resolveOsmdPreviewTargetFromEvent])

  return {
    osmdPreviewNoteLookupBySelectionRef,
    osmdPreviewSelectedSelectionKeyRef,
    clearOsmdPreviewNoteHighlight,
    resetOsmdPreviewNavigationState,
    rebuildOsmdPreviewNoteLookup,
    onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick,
  }
}
