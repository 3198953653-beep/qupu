import { StaveTie, type Renderer } from 'vexflow'
import type { MeasureLayout, MeasurePair, NoteLayout, Pitch, ScoreNote, StaffKind } from '../types'
import { getPitchLine } from '../pitchUtils'
import { getTieFrozenIncoming } from '../tieFrozen'
import { getDragPreviewTargetKey, type DragPreviewFrozenBoundaryCurve } from './dragPreviewOverrides'

type TieKeySpec = {
  keyIndex: number
  pitch: Pitch
  tieStart: boolean
  tieStop: boolean
  frozenIncomingPitch: Pitch | null
  frozenIncomingFromNoteId: string | null
  frozenIncomingFromKeyIndex: number | null
}

function getTieKeySpecs(params: {
  note: ScoreNote
  pairIndex: number
  staff: StaffKind
  previewPitchByTargetKey?: Map<string, Pitch> | null
}): TieKeySpec[] {
  const { note, pairIndex, staff, previewPitchByTargetKey = null } = params
  if (note.isRest) return []
  const resolvePitch = (keyIndex: number, fallbackPitch: Pitch): Pitch =>
    previewPitchByTargetKey?.get(
      getDragPreviewTargetKey({
        pairIndex,
        staff,
        noteId: note.id,
        keyIndex,
      }),
    ) ?? fallbackPitch
  const rootFrozenIncoming = getTieFrozenIncoming(note, 0)
  const specs: TieKeySpec[] = [
    {
      keyIndex: 0,
      pitch: resolvePitch(0, note.pitch),
      tieStart: Boolean(note.tieStart),
      tieStop: Boolean(note.tieStop),
      frozenIncomingPitch: rootFrozenIncoming?.pitch ?? null,
      frozenIncomingFromNoteId: rootFrozenIncoming?.fromNoteId ?? null,
      frozenIncomingFromKeyIndex: rootFrozenIncoming?.fromKeyIndex ?? null,
    },
  ]
  ;(note.chordPitches ?? []).forEach((pitch, chordIndex) => {
    const frozenIncoming = getTieFrozenIncoming(note, chordIndex + 1)
    specs.push({
      keyIndex: chordIndex + 1,
      pitch: resolvePitch(chordIndex + 1, pitch),
      tieStart: Boolean(note.chordTieStarts?.[chordIndex]),
      tieStop: Boolean(note.chordTieStops?.[chordIndex]),
      frozenIncomingPitch: frozenIncoming?.pitch ?? null,
      frozenIncomingFromNoteId: frozenIncoming?.fromNoteId ?? null,
      frozenIncomingFromKeyIndex: frozenIncoming?.fromKeyIndex ?? null,
    })
  })
  return specs
}

function drawTieCurve(
  context: ReturnType<Renderer['getContext']>,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  direction: number,
): void {
  const safeStartX = Math.min(startX, endX - 0.5)
  const safeEndX = Math.max(endX, startX + 0.5)
  const tie = new StaveTie({
    firstNote: { getYs: () => [startY] } as any,
    lastNote: { getYs: () => [endY] } as any,
    firstIndexes: [0],
    lastIndexes: [0],
  })
  tie.setContext(context)
  tie.renderTie({
    firstX: safeStartX,
    lastX: safeEndX,
    firstYs: [startY],
    lastYs: [endY],
    direction,
  })
}

function resolveTieDirection(staff: StaffKind, pitch: Pitch): number {
  const line = getPitchLine(staff, pitch)
  return line < 3 ? 1 : -1
}

function getStaffNotes(measurePair: MeasurePair | undefined, staff: StaffKind): ScoreNote[] {
  if (!measurePair) return []
  return staff === 'treble' ? measurePair.treble : measurePair.bass
}

function getNoteLayout(
  noteLayoutsByPair: Map<number, NoteLayout[]>,
  pairIndex: number,
  staff: StaffKind,
  noteIndex: number,
): NoteLayout | null {
  const layouts = noteLayoutsByPair.get(pairIndex)
  if (!layouts) return null
  for (const layout of layouts) {
    if (layout.staff === staff && layout.noteIndex === noteIndex) return layout
  }
  return null
}

function getHeadAnchor(layout: NoteLayout | null, keyIndex: number, pitch: string): { x: number; y: number } | null {
  if (!layout) return null
  const head =
    layout.noteHeads.find((item) => item.keyIndex === keyIndex) ??
    layout.noteHeads.find((item) => item.pitch === pitch) ??
    layout.noteHeads[0]
  if (!head) return null
  return {
    x: head.x + 6,
    y: head.y,
  }
}

function hasIncomingTieInSameMeasure(params: {
  notes: ScoreNote[]
  noteIndex: number
  pitch: string
  pairIndex: number
  staff: StaffKind
  previewPitchByTargetKey?: Map<string, Pitch> | null
}): boolean {
  const { notes, noteIndex, pitch, pairIndex, staff, previewPitchByTargetKey = null } = params
  for (let previousIndex = noteIndex - 1; previousIndex >= 0; previousIndex -= 1) {
    const specs = getTieKeySpecs({
      note: notes[previousIndex],
      pairIndex,
      staff,
      previewPitchByTargetKey,
    })
    if (specs.some((spec) => spec.tieStart && spec.pitch === pitch)) return true
  }
  return false
}

function hasOutgoingTieInSameMeasure(params: {
  notes: ScoreNote[]
  noteIndex: number
  pitch: string
  pairIndex: number
  staff: StaffKind
  previewPitchByTargetKey?: Map<string, Pitch> | null
}): boolean {
  const { notes, noteIndex, pitch, pairIndex, staff, previewPitchByTargetKey = null } = params
  for (let nextIndex = noteIndex + 1; nextIndex < notes.length; nextIndex += 1) {
    const specs = getTieKeySpecs({
      note: notes[nextIndex],
      pairIndex,
      staff,
      previewPitchByTargetKey,
    })
    const matched = specs.find((spec) => spec.pitch === pitch)
    if (matched?.tieStop) return true
  }
  return false
}

function hasFrozenStopTargetInSameMeasure(params: {
  notes: ScoreNote[]
  noteIndex: number
  pairIndex: number
  staff: StaffKind
  fromNoteId: string
  fromKeyIndex: number
  previewPitchByTargetKey?: Map<string, Pitch> | null
}): boolean {
  const {
    notes,
    noteIndex,
    pairIndex,
    staff,
    fromNoteId,
    fromKeyIndex,
    previewPitchByTargetKey = null,
  } = params
  for (let candidateIndex = noteIndex + 1; candidateIndex < notes.length; candidateIndex += 1) {
    const specs = getTieKeySpecs({
      note: notes[candidateIndex],
      pairIndex,
      staff,
      previewPitchByTargetKey,
    })
    const matched = specs.find(
      (spec) =>
        spec.tieStop &&
        spec.frozenIncomingPitch &&
        spec.frozenIncomingFromNoteId === fromNoteId &&
        spec.frozenIncomingFromKeyIndex === fromKeyIndex,
    )
    if (matched) return true
  }
  return false
}

function hasIncomingTieFromPreviousMeasure(params: {
  notes: ScoreNote[]
  pairIndex: number
  staff: StaffKind
  pitch: string
  previewPitchByTargetKey?: Map<string, Pitch> | null
}): boolean {
  const { notes, pairIndex, staff, pitch, previewPitchByTargetKey = null } = params
  for (const note of notes) {
    const specs = getTieKeySpecs({
      note,
      pairIndex,
      staff,
      previewPitchByTargetKey,
    })
    if (specs.some((spec) => spec.tieStart && spec.pitch === pitch)) return true
  }
  return false
}

function findStopTargetInNextMeasure(params: {
  notes: ScoreNote[]
  pairIndex: number
  staff: StaffKind
  pitch: string
  previewPitchByTargetKey?: Map<string, Pitch> | null
}): { noteIndex: number; keyIndex: number } | null {
  const { notes, pairIndex, staff, pitch, previewPitchByTargetKey = null } = params
  for (let nextIndex = 0; nextIndex < notes.length; nextIndex += 1) {
    const specs = getTieKeySpecs({
      note: notes[nextIndex],
      pairIndex,
      staff,
      previewPitchByTargetKey,
    })
    const matched = specs.find((spec) => spec.tieStop && spec.pitch === pitch)
    if (matched) return { noteIndex: nextIndex, keyIndex: matched.keyIndex }
  }
  return null
}

function findFrozenStopTargetInNextMeasure(params: {
  notes: ScoreNote[]
  pairIndex: number
  staff: StaffKind
  fromNoteId: string
  fromKeyIndex: number
  previewPitchByTargetKey?: Map<string, Pitch> | null
}): { noteIndex: number; keyIndex: number; frozenPitch: Pitch } | null {
  const {
    notes,
    pairIndex,
    staff,
    fromNoteId,
    fromKeyIndex,
    previewPitchByTargetKey = null,
  } = params
  for (let nextIndex = 0; nextIndex < notes.length; nextIndex += 1) {
    const specs = getTieKeySpecs({
      note: notes[nextIndex],
      pairIndex,
      staff,
      previewPitchByTargetKey,
    })
    for (const spec of specs) {
      if (!spec.tieStop || !spec.frozenIncomingPitch) continue
      if (spec.frozenIncomingFromNoteId !== fromNoteId) continue
      if (spec.frozenIncomingFromKeyIndex !== fromKeyIndex) continue
      return {
        noteIndex: nextIndex,
        keyIndex: spec.keyIndex,
        frozenPitch: spec.frozenIncomingPitch,
      }
    }
  }
  return null
}

export function drawCrossMeasureTies(params: {
  context: ReturnType<Renderer['getContext']>
  measurePairs: MeasurePair[]
  noteLayoutsByPair: Map<number, NoteLayout[]>
  measureLayouts: Map<number, MeasureLayout>
  startPairIndex: number
  endPairIndexExclusive: number
  previewPitchByTargetKey?: Map<string, Pitch> | null
  previewFrozenBoundaryCurve?: DragPreviewFrozenBoundaryCurve | null
  allowBoundaryPartialTies?: boolean
}): void {
  const {
    context,
    measurePairs,
    noteLayoutsByPair,
    measureLayouts,
    startPairIndex,
    endPairIndexExclusive,
    previewPitchByTargetKey = null,
    previewFrozenBoundaryCurve = null,
    allowBoundaryPartialTies = true,
  } = params
  const safeStartPairIndex = Math.max(0, startPairIndex)
  const safeEndPairIndexExclusive = Math.min(
    measurePairs.length,
    Math.max(safeStartPairIndex, endPairIndexExclusive),
  )
  if (safeEndPairIndexExclusive <= safeStartPairIndex) return

  for (let pairIndex = safeStartPairIndex; pairIndex < safeEndPairIndexExclusive; pairIndex += 1) {
    const currentPair = measurePairs[pairIndex]
    const currentLayout = measureLayouts.get(pairIndex)
    if (!currentPair || !currentLayout) continue

    ;(['treble', 'bass'] as const).forEach((staff) => {
      const currentStaffNotes = getStaffNotes(currentPair, staff)
      currentStaffNotes.forEach((note, noteIndex) => {
        const noteSpecs = getTieKeySpecs({
          note,
          pairIndex,
          staff,
          previewPitchByTargetKey,
        })
        if (noteSpecs.length === 0) return
        const currentNoteLayout = getNoteLayout(noteLayoutsByPair, pairIndex, staff, noteIndex)
        if (!currentNoteLayout) return

        noteSpecs.forEach((spec) => {
          const fromAnchor = getHeadAnchor(currentNoteLayout, spec.keyIndex, spec.pitch)
          if (!fromAnchor) return

          if (spec.tieStart) {
            if (
              hasFrozenStopTargetInSameMeasure({
                notes: currentStaffNotes,
                noteIndex,
                pairIndex,
                staff,
                fromNoteId: note.id,
                fromKeyIndex: spec.keyIndex,
                previewPitchByTargetKey,
              })
            ) {
              return
            }
            if (
              previewFrozenBoundaryCurve &&
              pairIndex === previewFrozenBoundaryCurve.fromPairIndex &&
              staff === previewFrozenBoundaryCurve.fromStaff &&
              note.id === previewFrozenBoundaryCurve.fromNoteId &&
              spec.keyIndex === previewFrozenBoundaryCurve.fromKeyIndex
            ) {
              drawTieCurve(
                context,
                previewFrozenBoundaryCurve.startX,
                previewFrozenBoundaryCurve.startY,
                previewFrozenBoundaryCurve.endX,
                previewFrozenBoundaryCurve.endY,
                resolveTieDirection(staff, previewFrozenBoundaryCurve.frozenPitch),
              )
              return
            }
            if (
              hasOutgoingTieInSameMeasure({
                notes: currentStaffNotes,
                noteIndex,
                pitch: spec.pitch,
                pairIndex,
                staff,
                previewPitchByTargetKey,
              })
            ) {
              return
            }

            const nextPairIndex = pairIndex + 1
            if (nextPairIndex < safeEndPairIndexExclusive) {
              const nextPair = measurePairs[nextPairIndex]
              const nextStaffNotes = getStaffNotes(nextPair, staff)
              const frozenTarget = findFrozenStopTargetInNextMeasure({
                notes: nextStaffNotes,
                pairIndex: nextPairIndex,
                staff,
                fromNoteId: note.id,
                fromKeyIndex: spec.keyIndex,
                previewPitchByTargetKey,
              })
              if (frozenTarget) {
                const nextLayout = getNoteLayout(
                  noteLayoutsByPair,
                  nextPairIndex,
                  staff,
                  frozenTarget.noteIndex,
                )
                const toAnchor = getHeadAnchor(nextLayout, frozenTarget.keyIndex, frozenTarget.frozenPitch)
                if (toAnchor) {
                  const translatedY = fromAnchor.y
                  drawTieCurve(
                    context,
                    fromAnchor.x,
                    translatedY,
                    toAnchor.x,
                    translatedY,
                    resolveTieDirection(staff, frozenTarget.frozenPitch),
                  )
                  return
                }
              }
              const nextTarget = findStopTargetInNextMeasure({
                notes: nextStaffNotes,
                pairIndex: nextPairIndex,
                staff,
                pitch: spec.pitch,
                previewPitchByTargetKey,
              })
              if (nextTarget) {
                const nextLayout = getNoteLayout(
                  noteLayoutsByPair,
                  nextPairIndex,
                  staff,
                  nextTarget.noteIndex,
                )
                const toAnchor = getHeadAnchor(nextLayout, nextTarget.keyIndex, spec.pitch)
                if (toAnchor) {
                  drawTieCurve(
                    context,
                    fromAnchor.x,
                    fromAnchor.y,
                    toAnchor.x,
                    toAnchor.y,
                    resolveTieDirection(staff, spec.pitch),
                  )
                  return
                }
              }
            }

            if (allowBoundaryPartialTies) {
              const rightBoundaryX = currentLayout.measureX + currentLayout.measureWidth - 1
              if (rightBoundaryX > fromAnchor.x + 0.5) {
                drawTieCurve(
                  context,
                  fromAnchor.x,
                  fromAnchor.y,
                  rightBoundaryX,
                  fromAnchor.y,
                  resolveTieDirection(staff, spec.pitch),
                )
              }
            }
          }

          if (spec.tieStop) {
            if (spec.frozenIncomingPitch) return
            if (
              hasIncomingTieInSameMeasure({
                notes: currentStaffNotes,
                noteIndex,
                pitch: spec.pitch,
                pairIndex,
                staff,
                previewPitchByTargetKey,
              })
            ) {
              return
            }

            const previousPairIndex = pairIndex - 1
            const previousStaffNotes =
              previousPairIndex >= safeStartPairIndex
                ? getStaffNotes(measurePairs[previousPairIndex], staff)
                : []
            if (
              previousStaffNotes.length > 0 &&
              hasIncomingTieFromPreviousMeasure({
                notes: previousStaffNotes,
                pairIndex: previousPairIndex,
                staff,
                pitch: spec.pitch,
                previewPitchByTargetKey,
              })
            ) {
              return
            }

            if (allowBoundaryPartialTies) {
              const leftBoundaryX = currentLayout.measureX + 1
              if (fromAnchor.x > leftBoundaryX + 0.5) {
                drawTieCurve(
                  context,
                  leftBoundaryX,
                  fromAnchor.y,
                  fromAnchor.x,
                  fromAnchor.y,
                  resolveTieDirection(staff, spec.pitch),
                )
              }
            }
          }
        })
      })
    })
  }
}
