import type { StaveNote } from 'vexflow'
import { DURATION_TICKS } from '../constants'
import { getRenderedNoteVisualX } from './renderPosition'
import type { MeasurePair, ScoreNote } from '../types'

type RenderedStaffNote = {
  vexNote: StaveNote
}

type TimeAxisNoteRef = {
  onsetTicks: number
  vexNote: StaveNote
  leftExtent: number
  rightExtent: number
}

type ApplyUnifiedTimeAxisSpacingParams = {
  measure: MeasurePair
  noteStartX: number
  formatWidth: number
  trebleRendered: RenderedStaffNote[]
  bassRendered: RenderedStaffNote[]
  leftEdgePaddingPx?: number
  rightEdgePaddingPx?: number
}

const MIN_RENDER_WIDTH_PX = 1
const DEFAULT_LEFT_EDGE_PADDING_PX = 2
const DEFAULT_RIGHT_EDGE_PADDING_PX = 3
const DEFAULT_NOTE_HEAD_WIDTH_PX = 9
const TICKS_PER_QUARTER = 16
const MIN_GAP_BEATS = 1 / 32
const GAP_GAMMA = 0.72
const GAP_BASE_WEIGHT = 0.45

function getTickDuration(note: ScoreNote): number {
  const ticks = DURATION_TICKS[note.duration]
  if (!Number.isFinite(ticks)) return TICKS_PER_QUARTER
  return Math.max(1, ticks)
}

function getNoteHorizontalExtents(vexNote: StaveNote, headX: number): { leftExtent: number; rightExtent: number } {
  let leftExtent = 0
  let rightExtent = DEFAULT_NOTE_HEAD_WIDTH_PX

  const bbox = vexNote.getBoundingBox()
  if (!bbox) return { leftExtent, rightExtent }

  const bboxLeft = bbox.getX()
  const bboxRight = bbox.getX() + bbox.getW()
  if (!Number.isFinite(bboxLeft) || !Number.isFinite(bboxRight)) {
    return { leftExtent, rightExtent }
  }

  leftExtent = Math.max(0, headX - bboxLeft)
  rightExtent = Math.max(DEFAULT_NOTE_HEAD_WIDTH_PX, bboxRight - headX)
  return { leftExtent, rightExtent }
}

function buildTimeAxisRefs(notes: ScoreNote[], rendered: RenderedStaffNote[]): TimeAxisNoteRef[] {
  const refs: TimeAxisNoteRef[] = []
  let cursorTicks = 0

  notes.forEach((note, noteIndex) => {
    const durationTicks = getTickDuration(note)
    const renderedEntry = rendered[noteIndex]
    if (renderedEntry) {
      const headX = getRenderedNoteVisualX(renderedEntry.vexNote)
      if (Number.isFinite(headX)) {
        const extents = getNoteHorizontalExtents(renderedEntry.vexNote, headX)
        refs.push({
          onsetTicks: cursorTicks,
          vexNote: renderedEntry.vexNote,
          leftExtent: extents.leftExtent,
          rightExtent: extents.rightExtent,
        })
      }
    }
    cursorTicks += durationTicks
  })

  return refs
}

function mapTickGapToWeight(deltaTicks: number): number {
  const beats = deltaTicks / TICKS_PER_QUARTER
  const compressed = Math.pow(Math.max(MIN_GAP_BEATS, beats), GAP_GAMMA)
  return GAP_BASE_WEIGHT + compressed
}

export function applyUnifiedTimeAxisSpacing(params: ApplyUnifiedTimeAxisSpacingParams): void {
  const {
    measure,
    noteStartX,
    formatWidth,
    trebleRendered,
    bassRendered,
    leftEdgePaddingPx = DEFAULT_LEFT_EDGE_PADDING_PX,
    rightEdgePaddingPx = DEFAULT_RIGHT_EDGE_PADDING_PX,
  } = params

  const refs = [
    ...buildTimeAxisRefs(measure.treble, trebleRendered),
    ...buildTimeAxisRefs(measure.bass, bassRendered),
  ]
  if (refs.length === 0) return

  const refsByOnset = new Map<number, TimeAxisNoteRef[]>()
  refs.forEach((ref) => {
    const list = refsByOnset.get(ref.onsetTicks)
    if (list) {
      list.push(ref)
    } else {
      refsByOnset.set(ref.onsetTicks, [ref])
    }
  })

  const onsetTicks = [...refsByOnset.keys()].sort((a, b) => a - b)
  if (onsetTicks.length === 0) return

  const firstOnsetRefs = refsByOnset.get(onsetTicks[0]) ?? []
  const lastOnsetRefs = refsByOnset.get(onsetTicks[onsetTicks.length - 1]) ?? []
  const firstLeftExtent = firstOnsetRefs.reduce((max, ref) => Math.max(max, ref.leftExtent), 0)
  const lastRightExtent = lastOnsetRefs.reduce((max, ref) => Math.max(max, ref.rightExtent), DEFAULT_NOTE_HEAD_WIDTH_PX)

  const usableFormatWidth = Math.max(MIN_RENDER_WIDTH_PX, formatWidth)
  const startPad = Math.max(1, firstLeftExtent + leftEdgePaddingPx)
  const endPad = Math.max(1, lastRightExtent + rightEdgePaddingPx)
  const axisStart = noteStartX + startPad
  const axisEnd = noteStartX + usableFormatWidth - endPad

  const targetXByOnset = new Map<number, number>()

  if (axisEnd <= axisStart) {
    const fallbackX = noteStartX + usableFormatWidth * 0.5
    onsetTicks.forEach((onset) => {
      targetXByOnset.set(onset, fallbackX)
    })
  } else if (onsetTicks.length === 1) {
    targetXByOnset.set(onsetTicks[0], (axisStart + axisEnd) * 0.5)
  } else {
    const spanWidth = axisEnd - axisStart
    const gapWeights: number[] = []
    for (let i = 1; i < onsetTicks.length; i += 1) {
      const deltaTicks = Math.max(1, onsetTicks[i] - onsetTicks[i - 1])
      gapWeights.push(mapTickGapToWeight(deltaTicks))
    }
    const totalWeight = gapWeights.reduce((sum, value) => sum + value, 0)
    if (totalWeight <= 0) {
      const step = spanWidth / (onsetTicks.length - 1)
      onsetTicks.forEach((onset, index) => {
        targetXByOnset.set(onset, axisStart + step * index)
      })
    } else {
      targetXByOnset.set(onsetTicks[0], axisStart)
      let cumulative = 0
      for (let i = 1; i < onsetTicks.length; i += 1) {
        cumulative += gapWeights[i - 1]
        const ratio = cumulative / totalWeight
        targetXByOnset.set(onsetTicks[i], axisStart + spanWidth * ratio)
      }
    }
  }

  refs.forEach((ref) => {
    const targetX = targetXByOnset.get(ref.onsetTicks)
    if (targetX === undefined) return
    const currentX = getRenderedNoteVisualX(ref.vexNote)
    if (!Number.isFinite(currentX)) return
    const delta = targetX - currentX
    if (Math.abs(delta) < 0.001) return
    ref.vexNote.setXShift(ref.vexNote.getXShift() + delta)
  })
}
