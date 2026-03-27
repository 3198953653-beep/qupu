import { TICKS_PER_BEAT } from '../constants'
import type { MeasurePair, Selection } from '../types'
import {
  buildMeasureStaffOnsetEntries,
  findMeasureStaffOnsetEntry,
  getSelectionKey,
  type OsmdPreviewInstance,
  type OsmdPreviewSelectionTarget,
} from './osmdPreviewUtils'

export type OsmdPreviewNoteLookup = {
  lookupByDomId: Map<string, OsmdPreviewSelectionTarget>
  lookupBySelection: Map<string, OsmdPreviewSelectionTarget>
}

export function buildOsmdPreviewNoteLookup(params: {
  measurePairs: MeasurePair[]
  osmdPreviewInstance: OsmdPreviewInstance | null
  osmdPreviewSourceMode: 'editor' | 'direct-file'
}): OsmdPreviewNoteLookup {
  const { measurePairs, osmdPreviewInstance, osmdPreviewSourceMode } = params

  const lookupByDomId = new Map<string, OsmdPreviewSelectionTarget>()
  const lookupBySelection = new Map<string, OsmdPreviewSelectionTarget>()
  if (osmdPreviewSourceMode !== 'editor') {
    return {
      lookupByDomId,
      lookupBySelection,
    }
  }

  const osmd = osmdPreviewInstance as unknown as {
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

  if (!osmd?.GraphicSheet?.MusicPages?.length) {
    return {
      lookupByDomId,
      lookupBySelection,
    }
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

  return {
    lookupByDomId,
    lookupBySelection,
  }
}
