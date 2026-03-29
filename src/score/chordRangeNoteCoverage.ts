import { buildStaffOnsetTicks } from './selectionTimelineRange'
import type { MeasurePair, NoteLayout, ScoreNote, StaffKind } from './types'

export type MeasureTickRangeNoteMatch = {
  staff: StaffKind
  noteIndex: number
  note: ScoreNote
  onsetTickInMeasure: number
}

export type MeasureTickRangeLayoutCoverage = MeasureTickRangeNoteMatch & {
  layout: NoteLayout
  leftXRaw: number
  selectionRightXRaw: number
  visualRightXRaw: number
}

function collectLeftCandidates(layout: NoteLayout): number[] {
  const candidates: number[] = []
  if (Number.isFinite(layout.x)) candidates.push(layout.x)
  layout.noteHeads.forEach((head) => {
    if (Number.isFinite(head.hitMinX)) {
      candidates.push(head.hitMinX as number)
      return
    }
    if (Number.isFinite(head.x)) {
      candidates.push(head.x)
    }
  })
  layout.accidentalLayouts.forEach((accidental) => {
    if (Number.isFinite(accidental.hitMinX)) {
      candidates.push(accidental.hitMinX as number)
      return
    }
    if (!Number.isFinite(accidental.x)) return
    if (Number.isFinite(accidental.hitRadiusX)) {
      candidates.push(accidental.x - (accidental.hitRadiusX as number))
      return
    }
    candidates.push(accidental.x - 4)
  })
  return candidates
}

function collectSelectionRightCandidates(layout: NoteLayout): number[] {
  const candidates: number[] = []
  layout.noteHeads.forEach((head) => {
    if (Number.isFinite(head.hitMaxX)) {
      candidates.push(head.hitMaxX as number)
      return
    }
    if (Number.isFinite(head.x)) {
      candidates.push(head.x + 9)
    }
  })
  if (Number.isFinite(layout.spacingRightX)) {
    candidates.push(layout.spacingRightX)
  }
  if (candidates.length === 0 && Number.isFinite(layout.x)) {
    candidates.push(layout.x + 9)
  }
  if (candidates.length === 0 && Number.isFinite(layout.rightX)) {
    candidates.push(layout.rightX)
  }
  return candidates
}

function collectVisualRightCandidates(layout: NoteLayout): number[] {
  const candidates: number[] = []
  if (Number.isFinite(layout.visualRightX)) {
    candidates.push(layout.visualRightX)
  }
  if (Number.isFinite(layout.rightX)) {
    candidates.push(layout.rightX)
  }
  layout.noteHeads.forEach((head) => {
    if (Number.isFinite(head.hitMaxX)) {
      candidates.push(head.hitMaxX as number)
      return
    }
    if (Number.isFinite(head.x)) {
      candidates.push(head.x + 9)
    }
  })
  if (Number.isFinite(layout.spacingRightX)) {
    candidates.push(layout.spacingRightX)
  }
  return candidates
}

export function collectMeasureTickRangeNotes(params: {
  pair: MeasurePair
  startTickInclusive: number
  endTickExclusive: number
  includeRests?: boolean
}): MeasureTickRangeNoteMatch[] {
  const { pair, startTickInclusive, endTickExclusive, includeRests = true } = params
  const safeStartTick = Math.max(0, Math.round(startTickInclusive))
  const safeEndTick = Math.max(safeStartTick, Math.round(endTickExclusive))
  if (safeEndTick <= safeStartTick) return []

  const matches: MeasureTickRangeNoteMatch[] = []
  ;(['treble', 'bass'] as const).forEach((staff) => {
    const notes = staff === 'treble' ? pair.treble : pair.bass
    const onsetTicksByNoteIndex = buildStaffOnsetTicks(notes)
    notes.forEach((note, noteIndex) => {
      const onsetTickInMeasure = onsetTicksByNoteIndex[noteIndex]
      if (!Number.isFinite(onsetTickInMeasure)) return
      if (onsetTickInMeasure < safeStartTick || onsetTickInMeasure >= safeEndTick) return
      if (!includeRests && note.isRest) return
      matches.push({
        staff,
        noteIndex,
        note,
        onsetTickInMeasure,
      })
    })
  })
  return matches
}

export function collectMeasureTickRangeLayoutCoverage(params: {
  pair: MeasurePair
  pairLayouts: NoteLayout[]
  startTickInclusive: number
  endTickExclusive: number
  includeRests?: boolean
}): MeasureTickRangeLayoutCoverage[] {
  const { pair, pairLayouts, startTickInclusive, endTickExclusive, includeRests = true } = params
  if (pairLayouts.length === 0) return []

  const layoutByStaffNoteIndex = new Map<string, NoteLayout>()
  pairLayouts.forEach((layout) => {
    layoutByStaffNoteIndex.set(`${layout.staff}:${layout.noteIndex}`, layout)
  })

  return collectMeasureTickRangeNotes({
    pair,
    startTickInclusive,
    endTickExclusive,
    includeRests,
  }).flatMap((match) => {
    const layout = layoutByStaffNoteIndex.get(`${match.staff}:${match.noteIndex}`) ?? null
    if (!layout) return []

    const leftCandidates = collectLeftCandidates(layout)
    const selectionRightCandidates = collectSelectionRightCandidates(layout)
    const visualRightCandidates = collectVisualRightCandidates(layout)
    const leftXRaw = leftCandidates.length > 0 ? Math.min(...leftCandidates) : Number.POSITIVE_INFINITY
    const selectionRightXRaw =
      selectionRightCandidates.length > 0 ? Math.max(...selectionRightCandidates) : Number.NEGATIVE_INFINITY
    const visualRightXRaw =
      visualRightCandidates.length > 0 ? Math.max(...visualRightCandidates) : Number.NEGATIVE_INFINITY

    if (!Number.isFinite(leftXRaw)) return []
    if (!Number.isFinite(selectionRightXRaw) && !Number.isFinite(visualRightXRaw)) return []

    return [{
      ...match,
      layout,
      leftXRaw,
      selectionRightXRaw,
      visualRightXRaw,
    }]
  })
}

export function getMeasureTickRangeLayoutBounds(
  coverage: readonly MeasureTickRangeLayoutCoverage[],
  rightMode: 'selection' | 'visual',
): { leftXRaw: number; rightXRaw: number } | null {
  if (coverage.length === 0) return null
  let minLeftX = Number.POSITIVE_INFINITY
  let maxRightX = Number.NEGATIVE_INFINITY

  coverage.forEach((entry) => {
    const rightXRaw = rightMode === 'visual' ? entry.visualRightXRaw : entry.selectionRightXRaw
    if (!Number.isFinite(entry.leftXRaw) || !Number.isFinite(rightXRaw)) return
    if (rightXRaw <= entry.leftXRaw) return
    minLeftX = Math.min(minLeftX, entry.leftXRaw)
    maxRightX = Math.max(maxRightX, rightXRaw)
  })

  if (!Number.isFinite(minLeftX) || !Number.isFinite(maxRightX) || maxRightX <= minLeftX) {
    return null
  }
  return {
    leftXRaw: minLeftX,
    rightXRaw: maxRightX,
  }
}
