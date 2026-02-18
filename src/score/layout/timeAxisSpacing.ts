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
  spacingConfig?: TimeAxisSpacingConfig
}

const MIN_RENDER_WIDTH_PX = 1
const DEFAULT_LEFT_EDGE_PADDING_PX = 2
const DEFAULT_RIGHT_EDGE_PADDING_PX = 3
const DEFAULT_NOTE_HEAD_WIDTH_PX = 9
const TICKS_PER_QUARTER = 16
const MIN_GAP_BEATS = 1 / 32
const GAP_GAMMA = 0.72
const GAP_BASE_WEIGHT = 0.45

export type TimeAxisSpacingConfig = {
  minGapBeats: number
  gapGamma: number
  gapBaseWeight: number
  leftEdgePaddingPx: number
  rightEdgePaddingPx: number
  interOnsetPaddingPx: number
}

export const DEFAULT_TIME_AXIS_SPACING_CONFIG: TimeAxisSpacingConfig = {
  minGapBeats: MIN_GAP_BEATS,
  gapGamma: GAP_GAMMA,
  gapBaseWeight: GAP_BASE_WEIGHT,
  leftEdgePaddingPx: DEFAULT_LEFT_EDGE_PADDING_PX,
  rightEdgePaddingPx: DEFAULT_RIGHT_EDGE_PADDING_PX,
  interOnsetPaddingPx: 1,
}

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

function mapTickGapToWeight(deltaTicks: number, config: TimeAxisSpacingConfig): number {
  const beats = deltaTicks / TICKS_PER_QUARTER
  const compressed = Math.pow(Math.max(config.minGapBeats, beats), config.gapGamma)
  return config.gapBaseWeight + compressed
}

export function applyUnifiedTimeAxisSpacing(params: ApplyUnifiedTimeAxisSpacingParams): void {
  const {
    measure,
    noteStartX,
    formatWidth,
    trebleRendered,
    bassRendered,
    spacingConfig = DEFAULT_TIME_AXIS_SPACING_CONFIG,
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
  const startPad = Math.max(1, firstLeftExtent + spacingConfig.leftEdgePaddingPx)
  const endPad = Math.max(1, lastRightExtent + spacingConfig.rightEdgePaddingPx)
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
      gapWeights.push(mapTickGapToWeight(deltaTicks, spacingConfig))
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

  if (onsetTicks.length > 1) {
    const basePositions = onsetTicks.map((onset) => targetXByOnset.get(onset) ?? axisStart)
    const leftExtents = onsetTicks.map((onset) =>
      (refsByOnset.get(onset) ?? []).reduce((max, ref) => Math.max(max, ref.leftExtent), 0),
    )
    const rightExtents = onsetTicks.map((onset) =>
      (refsByOnset.get(onset) ?? []).reduce((max, ref) => Math.max(max, ref.rightExtent), DEFAULT_NOTE_HEAD_WIDTH_PX),
    )
    const minGaps = onsetTicks.slice(1).map((_, index) => {
      const glyphGap = rightExtents[index] + leftExtents[index + 1] + spacingConfig.interOnsetPaddingPx
      return Math.max(1, glyphGap)
    })
    const spanWidth = Math.max(1, axisEnd - axisStart)
    const minGapTotal = minGaps.reduce((sum, value) => sum + value, 0)
    const gapScale = minGapTotal > spanWidth ? spanWidth / minGapTotal : 1
    const scaledMinGaps = minGaps.map((value) => value * gapScale)
    const constrained = [...basePositions]

    for (let i = 1; i < constrained.length; i += 1) {
      const minAllowed = constrained[i - 1] + scaledMinGaps[i - 1]
      if (constrained[i] < minAllowed) {
        constrained[i] = minAllowed
      }
    }

    const overflow = constrained[constrained.length - 1] - axisEnd
    if (overflow > 0) {
      for (let i = 0; i < constrained.length; i += 1) {
        constrained[i] -= overflow
      }
    }

    for (let i = constrained.length - 2; i >= 0; i -= 1) {
      const maxAllowed = constrained[i + 1] - scaledMinGaps[i]
      if (constrained[i] > maxAllowed) {
        constrained[i] = maxAllowed
      }
    }

    const underflow = axisStart - constrained[0]
    if (underflow > 0) {
      for (let i = 0; i < constrained.length; i += 1) {
        constrained[i] += underflow
      }
    }

    for (let i = 1; i < constrained.length; i += 1) {
      const minAllowed = constrained[i - 1] + scaledMinGaps[i - 1]
      if (constrained[i] < minAllowed) {
        constrained[i] = minAllowed
      }
    }

    onsetTicks.forEach((onset, index) => {
      targetXByOnset.set(onset, constrained[index])
    })
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
