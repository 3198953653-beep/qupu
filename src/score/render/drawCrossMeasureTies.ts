import type { Renderer } from 'vexflow'
import type { MeasureLayout, MeasurePair, NoteLayout, Pitch, ScoreNote, StaffKind } from '../types'

type TieKeySpec = {
  keyIndex: number
  pitch: Pitch
  tieStart: boolean
  tieStop: boolean
}

function getTieKeySpecs(note: ScoreNote): TieKeySpec[] {
  if (note.isRest) return []
  const specs: TieKeySpec[] = [
    {
      keyIndex: 0,
      pitch: note.pitch,
      tieStart: Boolean(note.tieStart),
      tieStop: Boolean(note.tieStop),
    },
  ]
  ;(note.chordPitches ?? []).forEach((pitch, chordIndex) => {
    specs.push({
      keyIndex: chordIndex + 1,
      pitch,
      tieStart: Boolean(note.chordTieStarts?.[chordIndex]),
      tieStop: Boolean(note.chordTieStops?.[chordIndex]),
    })
  })
  return specs
}

function findKeyIndexByPitch(note: ScoreNote | undefined, pitch: string): number | null {
  if (!note || note.isRest) return null
  if (note.pitch === pitch) return 0
  const chordIndex = note.chordPitches?.findIndex((item) => item === pitch) ?? -1
  return chordIndex >= 0 ? chordIndex + 1 : null
}

function drawTieCurve(
  context: ReturnType<Renderer['getContext']>,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): void {
  const safeStartX = Math.min(startX, endX - 0.5)
  const safeEndX = Math.max(endX, startX + 0.5)
  const span = Math.max(1, safeEndX - safeStartX)
  const depth = Math.max(3.5, Math.min(10, span * 0.22))
  const centerX = (safeStartX + safeEndX) * 0.5
  const outerY = Math.max(startY, endY) + depth
  const innerY = outerY - 1.8

  context.save()
  context.setFillStyle('#111111')
  context.beginPath()
  context.moveTo(safeStartX, startY)
  context.quadraticCurveTo(centerX, outerY, safeEndX, endY)
  context.quadraticCurveTo(centerX, innerY, safeStartX, startY)
  context.closePath()
  context.fill()
  context.restore()
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

function hasIncomingTieInSameMeasure(notes: ScoreNote[], noteIndex: number, pitch: string): boolean {
  for (let previousIndex = noteIndex - 1; previousIndex >= 0; previousIndex -= 1) {
    const specs = getTieKeySpecs(notes[previousIndex])
    if (specs.some((spec) => spec.tieStart && spec.pitch === pitch)) return true
  }
  return false
}

function hasOutgoingTieInSameMeasure(notes: ScoreNote[], noteIndex: number, pitch: string): boolean {
  for (let nextIndex = noteIndex + 1; nextIndex < notes.length; nextIndex += 1) {
    const keyIndex = findKeyIndexByPitch(notes[nextIndex], pitch)
    if (keyIndex === null) continue
    const specs = getTieKeySpecs(notes[nextIndex])
    const matched = specs.find((spec) => spec.keyIndex === keyIndex)
    if (matched?.tieStop) return true
  }
  return false
}

function hasIncomingTieFromPreviousMeasure(notes: ScoreNote[], pitch: string): boolean {
  for (const note of notes) {
    const specs = getTieKeySpecs(note)
    if (specs.some((spec) => spec.tieStart && spec.pitch === pitch)) return true
  }
  return false
}

function findStopTargetInNextMeasure(notes: ScoreNote[], pitch: string): { noteIndex: number; keyIndex: number } | null {
  for (let nextIndex = 0; nextIndex < notes.length; nextIndex += 1) {
    const keyIndex = findKeyIndexByPitch(notes[nextIndex], pitch)
    if (keyIndex === null) continue
    const specs = getTieKeySpecs(notes[nextIndex])
    const matched = specs.find((spec) => spec.keyIndex === keyIndex)
    if (matched?.tieStop) return { noteIndex: nextIndex, keyIndex }
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
  allowBoundaryPartialTies?: boolean
}): void {
  const {
    context,
    measurePairs,
    noteLayoutsByPair,
    measureLayouts,
    startPairIndex,
    endPairIndexExclusive,
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
        const noteSpecs = getTieKeySpecs(note)
        if (noteSpecs.length === 0) return
        const currentNoteLayout = getNoteLayout(noteLayoutsByPair, pairIndex, staff, noteIndex)
        if (!currentNoteLayout) return

        noteSpecs.forEach((spec) => {
          const fromAnchor = getHeadAnchor(currentNoteLayout, spec.keyIndex, spec.pitch)
          if (!fromAnchor) return

          if (spec.tieStart) {
            if (hasOutgoingTieInSameMeasure(currentStaffNotes, noteIndex, spec.pitch)) return

            const nextPairIndex = pairIndex + 1
            if (nextPairIndex < safeEndPairIndexExclusive) {
              const nextPair = measurePairs[nextPairIndex]
              const nextStaffNotes = getStaffNotes(nextPair, staff)
              const nextTarget = findStopTargetInNextMeasure(nextStaffNotes, spec.pitch)
              if (nextTarget) {
                const nextLayout = getNoteLayout(
                  noteLayoutsByPair,
                  nextPairIndex,
                  staff,
                  nextTarget.noteIndex,
                )
                const toAnchor = getHeadAnchor(nextLayout, nextTarget.keyIndex, spec.pitch)
                if (toAnchor) {
                  drawTieCurve(context, fromAnchor.x, fromAnchor.y, toAnchor.x, toAnchor.y)
                  return
                }
              }
            }

            if (allowBoundaryPartialTies) {
              const rightBoundaryX = currentLayout.measureX + currentLayout.measureWidth - 1
              if (rightBoundaryX > fromAnchor.x + 0.5) {
                drawTieCurve(context, fromAnchor.x, fromAnchor.y, rightBoundaryX, fromAnchor.y)
              }
            }
          }

          if (spec.tieStop) {
            if (hasIncomingTieInSameMeasure(currentStaffNotes, noteIndex, spec.pitch)) return

            const previousPairIndex = pairIndex - 1
            const previousStaffNotes =
              previousPairIndex >= safeStartPairIndex
                ? getStaffNotes(measurePairs[previousPairIndex], staff)
                : []
            if (previousStaffNotes.length > 0 && hasIncomingTieFromPreviousMeasure(previousStaffNotes, spec.pitch)) {
              return
            }

            if (allowBoundaryPartialTies) {
              const leftBoundaryX = currentLayout.measureX + 1
              if (fromAnchor.x > leftBoundaryX + 0.5) {
                drawTieCurve(context, leftBoundaryX, fromAnchor.y, fromAnchor.x, fromAnchor.y)
              }
            }
          }
        })
      })
    })
  }
}
