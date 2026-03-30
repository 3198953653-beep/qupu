import type { MutableRefObject } from 'react'
import type { ActivePedalSelection, MeasurePair, ScoreNote, Selection } from '../types'
import type { ActiveChordSelection, ChordRulerMarkerMeta } from './useChordMarkerController'
import type { OsmdPreviewSelectionTarget } from './useOsmdPreviewController'

export function buildRuntimeDebugSelectionApi(params: {
  applyChordSelectionRange: (params: {
    pairIndex: number
    startTick: number
    endTick: number
    markerKey?: string | null
  }) => Selection[]
  selectedSelectionsRef: MutableRefObject<Selection[]>
  measurePairsRef: MutableRefObject<MeasurePair[]>
  activeChordSelection: ActiveChordSelection | null
  selectedMeasureHighlightRectPx: { x: number; y: number; width: number; height: number } | null
  chordRulerMarkerMetaByKey: Map<string, ChordRulerMarkerMeta>
  activeSelection: Selection
  activePedalSelection: ActivePedalSelection | null
  osmdPreviewSelectedSelectionKeyRef: MutableRefObject<string | null>
  osmdPreviewNoteLookupBySelectionRef: MutableRefObject<Map<string, OsmdPreviewSelectionTarget>>
}) {
  const {
    applyChordSelectionRange,
    selectedSelectionsRef,
    measurePairsRef,
    activeChordSelection,
    selectedMeasureHighlightRectPx,
    chordRulerMarkerMetaByKey,
    activeSelection,
    activePedalSelection,
    osmdPreviewSelectedSelectionKeyRef,
    osmdPreviewNoteLookupBySelectionRef,
  } = params

  return {
    applyChordSelectionRange: (pairIndex: number, startTick: number, endTick: number) => ({
      selectedCount: applyChordSelectionRange({
        pairIndex,
        startTick,
        endTick,
        markerKey: null,
      }).length,
    }),
    getSelectedSelections: () =>
      selectedSelectionsRef.current.map((selection) => {
        const matchedEntry = (() => {
          for (let pairIndex = 0; pairIndex < measurePairsRef.current.length; pairIndex += 1) {
            const pair = measurePairsRef.current[pairIndex]
            if (!pair) continue
            const staffNotes = selection.staff === 'treble' ? pair.treble : pair.bass
            const noteIndex = staffNotes.findIndex((note) => note.id === selection.noteId)
            if (noteIndex < 0) continue
            return {
              pairIndex,
              noteIndex,
              note: staffNotes[noteIndex] ?? null,
            }
          }
          return {
            pairIndex: null,
            noteIndex: null,
            note: null as ScoreNote | null,
          }
        })()
        return {
          ...selection,
          pairIndex: matchedEntry.pairIndex,
          noteIndex: matchedEntry.noteIndex,
          pitch: matchedEntry.note?.pitch ?? null,
          duration: matchedEntry.note?.duration ?? null,
          isRest: matchedEntry.note?.isRest === true,
        }
      }),
    getActiveChordSelection: () => (activeChordSelection ? { ...activeChordSelection } : null),
    getSelectedMeasureHighlightRect: () =>
      selectedMeasureHighlightRectPx ? { ...selectedMeasureHighlightRectPx } : null,
    getChordRulerMarkers: () =>
      [...chordRulerMarkerMetaByKey.values()].map((marker) => ({
        key: marker.key,
        pairIndex: marker.pairIndex,
        beatIndex: marker.beatIndex,
        label: marker.displayLabel,
        sourceLabel: marker.sourceLabel,
        displayLabel: marker.displayLabel,
        startTick: marker.startTick,
        endTick: marker.endTick,
        positionText: marker.positionText,
        anchorGlobalX: marker.anchorGlobalX,
        anchorXPx: marker.anchorXPx,
        xPx: marker.xPx,
        anchorSource: marker.anchorSource,
        keyFifths: marker.keyFifths,
        keyMode: marker.keyMode,
      })),
    getActiveSelection: () => ({ ...activeSelection }),
    getActivePedalSelection: () => (activePedalSelection ? { ...activePedalSelection } : null),
    getOsmdPreviewSelectedSelectionKey: () => osmdPreviewSelectedSelectionKeyRef.current,
    getOsmdPreviewNoteTargets: () =>
      [...osmdPreviewNoteLookupBySelectionRef.current.values()].map((target) => ({
        pairIndex: target.pairIndex,
        measureNumber: target.measureNumber,
        onsetTicks: target.onsetTicks,
        domIds: [...target.domIds],
        selection: { ...target.selection },
      })),
  }
}
