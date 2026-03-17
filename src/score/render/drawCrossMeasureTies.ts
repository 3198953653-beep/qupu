import { StaveTie, type Renderer } from 'vexflow'
import type {
  MeasureLayout,
  MeasurePair,
  NoteLayout,
  Pitch,
  ScoreNote,
  StaffKind,
  TieEndpoint,
  TieLayout,
} from '../types'
import { getPitchLine } from '../pitchUtils'
import { getTieFrozenIncoming } from '../tieFrozen'
import { getDragPreviewTargetKey, type DragPreviewFrozenBoundaryCurve } from './dragPreviewOverrides'
import { buildTieLayout } from './tieLayoutGeometry'

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
  highlighted: boolean,
): void {
  const safeStartX = Math.min(startX, endX - 0.5)
  const safeEndX = Math.max(endX, startX + 0.5)
  const tie = new StaveTie({
    firstNote: { getYs: () => [startY] } as any,
    lastNote: { getYs: () => [endY] } as any,
    firstIndexes: [0],
    lastIndexes: [0],
  })
  if (highlighted) {
    context.save()
    context.setFillStyle('#2437E8')
    context.setStrokeStyle('#2437E8')
  }
  tie.setContext(context)
  tie.renderTie({
    firstX: safeStartX,
    lastX: safeEndX,
    firstYs: [startY],
    lastYs: [endY],
    direction,
  })
  if (highlighted) {
    context.restore()
  }
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

function appendCrossMeasureTieLayout(
  sourceLayout: NoteLayout | null,
  tieLayout: TieLayout,
): void {
  if (!sourceLayout) return
  if (sourceLayout.crossMeasureTieLayouts.some((entry) => entry.key === tieLayout.key)) return
  sourceLayout.crossMeasureTieLayouts.push(tieLayout)
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

function findGhostStopTargetInNextMeasure(params: {
  notes: ScoreNote[]
  pairIndex: number
  staff: StaffKind
  previewPitchByTargetKey?: Map<string, Pitch> | null
}): { noteIndex: number; keyIndex: number } | null {
  const { notes, pairIndex, staff, previewPitchByTargetKey = null } = params
  for (let nextIndex = 0; nextIndex < notes.length; nextIndex += 1) {
    const specs = getTieKeySpecs({
      note: notes[nextIndex],
      pairIndex,
      staff,
      previewPitchByTargetKey,
    })
    if (specs.length === 0) continue
    const preferred = specs.find((spec) => spec.tieStop) ?? specs[0]
    if (!preferred) continue
    return {
      noteIndex: nextIndex,
      keyIndex: preferred.keyIndex,
    }
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
  suppressedTieStartKeys?: Set<string> | null
  suppressedTieStopKeys?: Set<string> | null
  allowBoundaryPartialTies?: boolean
  activeTieSegmentKey?: string | null
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
    suppressedTieStartKeys = null,
    suppressedTieStopKeys = null,
    allowBoundaryPartialTies = true,
    activeTieSegmentKey = null,
  } = params
  const safeStartPairIndex = Math.max(0, startPairIndex)
  const safeEndPairIndexExclusive = Math.min(
    measurePairs.length,
    Math.max(safeStartPairIndex, endPairIndexExclusive),
  )
  if (safeEndPairIndexExclusive <= safeStartPairIndex) return

  for (let pairIndex = safeStartPairIndex; pairIndex < safeEndPairIndexExclusive; pairIndex += 1) {
    const layouts = noteLayoutsByPair.get(pairIndex)
    if (!layouts) continue
    layouts.forEach((layout) => {
      layout.crossMeasureTieLayouts = []
    })
  }

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
          const tieTargetKey = getDragPreviewTargetKey({
            pairIndex,
            staff,
            noteId: note.id,
            keyIndex: spec.keyIndex,
          })
          const tieDirection = resolveTieDirection(staff, spec.pitch)
          const sourceStartEndpoint: TieEndpoint = {
            pairIndex,
            noteIndex,
            staff,
            noteId: note.id,
            keyIndex: spec.keyIndex,
            tieType: 'start',
          }
          const sourceStopEndpoint: TieEndpoint = {
            pairIndex,
            noteIndex,
            staff,
            noteId: note.id,
            keyIndex: spec.keyIndex,
            tieType: 'stop',
          }
          const drawCrossMeasureTieSegment = (params: {
            startX: number
            endX: number
            y: number
            endpoints: TieEndpoint[]
          }) => {
            const { startX, endX, y, endpoints } = params
            if (!Number.isFinite(startX) || !Number.isFinite(endX) || !Number.isFinite(y)) return
            const tieLayout = buildTieLayout({
              startX,
              startY: y,
              endX,
              endY: y,
              direction: tieDirection,
              endpoints,
            })
            appendCrossMeasureTieLayout(currentNoteLayout, tieLayout)
            drawTieCurve(
              context,
              startX,
              y,
              endX,
              y,
              tieDirection,
              activeTieSegmentKey === tieLayout.key,
            )
          }

          if (spec.tieStart) {
            if (suppressedTieStartKeys?.has(tieTargetKey)) return
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
              // Preview frozen boundary segment is rendered in drawMeasure
              // to keep a single drawing path and avoid duplicate ties.
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
                  const frozenTargetNote = nextStaffNotes[frozenTarget.noteIndex]
                  if (!frozenTargetNote) return
                  const targetEndpoint: TieEndpoint = {
                    pairIndex: nextPairIndex,
                    noteIndex: frozenTarget.noteIndex,
                    staff,
                    noteId: frozenTargetNote.id,
                    keyIndex: frozenTarget.keyIndex,
                    tieType: 'stop',
                  }
                  drawCrossMeasureTieSegment({
                    startX: fromAnchor.x,
                    endX: toAnchor.x,
                    y: translatedY,
                    endpoints: [sourceStartEndpoint, targetEndpoint],
                  })
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
                  const translatedY = fromAnchor.y
                  const targetNote = nextStaffNotes[nextTarget.noteIndex]
                  if (!targetNote) return
                  const targetEndpoint: TieEndpoint = {
                    pairIndex: nextPairIndex,
                    noteIndex: nextTarget.noteIndex,
                    staff,
                    noteId: targetNote.id,
                    keyIndex: nextTarget.keyIndex,
                    tieType: 'stop',
                  }
                  drawCrossMeasureTieSegment({
                    startX: fromAnchor.x,
                    endX: toAnchor.x,
                    y: translatedY,
                    endpoints: [sourceStartEndpoint, targetEndpoint],
                  })
                  return
                }
              }

              const ghostTarget = findGhostStopTargetInNextMeasure({
                notes: nextStaffNotes,
                pairIndex: nextPairIndex,
                staff,
                previewPitchByTargetKey,
              })
              if (ghostTarget) {
                const nextLayout = getNoteLayout(
                  noteLayoutsByPair,
                  nextPairIndex,
                  staff,
                  ghostTarget.noteIndex,
                )
                const toAnchor = getHeadAnchor(nextLayout, ghostTarget.keyIndex, spec.pitch)
                if (toAnchor) {
                  const translatedY = fromAnchor.y
                  drawCrossMeasureTieSegment({
                    startX: fromAnchor.x,
                    endX: toAnchor.x,
                    y: translatedY,
                    endpoints: [sourceStartEndpoint],
                  })
                  return
                }
              }
            }

            if (allowBoundaryPartialTies) {
              const rightBoundaryX = currentLayout.measureX + currentLayout.measureWidth - 1
              if (rightBoundaryX > fromAnchor.x + 0.5) {
                drawCrossMeasureTieSegment({
                  startX: fromAnchor.x,
                  endX: rightBoundaryX,
                  y: fromAnchor.y,
                  endpoints: [sourceStartEndpoint],
                })
              }
            }
          }

          if (spec.tieStop) {
            if (suppressedTieStopKeys?.has(tieTargetKey)) return
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
                drawCrossMeasureTieSegment({
                  startX: leftBoundaryX,
                  endX: fromAnchor.x,
                  y: fromAnchor.y,
                  endpoints: [sourceStopEndpoint],
                })
              }
            }
          }
        })
      })
    })
  }
}
