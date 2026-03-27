import type { MeasureLayout, MeasurePair, NoteLayout, Pitch, ScoreNote, Selection } from './types'

export type FirstMeasureNoteDebugRow = {
  staff: 'treble' | 'bass'
  noteId: string
  noteIndex: number
  keyIndex: number
  pitch: Pitch
  noteX: number | null
  noteRightX: number | null
  spacingRightX: number | null
  headX: number | null
  headY: number | null
  pitchY: number | null
}

export type FirstMeasureSnapshot = {
  stage: string
  pairIndex: number
  generatedAt: string
  measureX: number | null
  measureWidth: number | null
  measureEndBarX: number | null
  noteStartX: number | null
  noteEndX: number | null
  rows: FirstMeasureNoteDebugRow[]
}

export type FirstMeasureDragContext = {
  noteId: string
  staff: Selection['staff']
  keyIndex: number
  pairIndex: number
}

function formatDebugCoord(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'null'
  return value.toFixed(3)
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function getPitchForKeyIndex(note: ScoreNote, keyIndex: number): Pitch {
  if (keyIndex <= 0) return note.pitch
  return note.chordPitches?.[keyIndex - 1] ?? note.pitch
}

export function captureFirstMeasureSnapshot(params: {
  stage: string
  pairIndex?: number
  measurePairs: MeasurePair[]
  noteLayoutsByPair: Map<number, NoteLayout[]>
  measureLayouts: Map<number, MeasureLayout>
}): FirstMeasureSnapshot | null {
  const {
    stage,
    pairIndex = 0,
    measurePairs,
    noteLayoutsByPair,
    measureLayouts,
  } = params
  const measure = measurePairs[pairIndex]
  if (!measure) return null
  const layouts = noteLayoutsByPair.get(pairIndex) ?? []
  const layoutByNoteKey = new Map<string, NoteLayout>()
  layouts.forEach((layout) => {
    layoutByNoteKey.set(`${layout.staff}:${layout.id}`, layout)
  })
  const measureLayout = measureLayouts.get(pairIndex) ?? null
  const rows: FirstMeasureNoteDebugRow[] = []
  const pushRows = (staff: 'treble' | 'bass', notes: ScoreNote[]) => {
    notes.forEach((note, noteIndex) => {
      const layout = layoutByNoteKey.get(`${staff}:${note.id}`)
      const keyCount = 1 + (note.chordPitches?.length ?? 0)
      for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
        const pitch = getPitchForKeyIndex(note, keyIndex)
        const head = layout?.noteHeads.find((item) => item.keyIndex === keyIndex)
        rows.push({
          staff,
          noteId: note.id,
          noteIndex,
          keyIndex,
          pitch,
          noteX: finiteOrNull(layout?.x),
          noteRightX: finiteOrNull(layout?.rightX),
          spacingRightX: finiteOrNull(layout?.spacingRightX),
          headX: finiteOrNull(head?.x),
          headY: finiteOrNull(head?.y),
          pitchY: finiteOrNull(layout?.pitchYMap[pitch]),
        })
      }
    })
  }
  pushRows('treble', measure.treble)
  pushRows('bass', measure.bass)
  return {
    stage,
    pairIndex,
    generatedAt: new Date().toISOString(),
    measureX: finiteOrNull(measureLayout?.measureX),
    measureWidth: finiteOrNull(measureLayout?.contentMeasureWidth ?? measureLayout?.measureWidth),
    measureEndBarX: finiteOrNull(
      measureLayout
        ? measureLayout.measureX + (measureLayout.renderedMeasureWidth ?? measureLayout.measureWidth)
        : null,
    ),
    noteStartX: finiteOrNull(measureLayout?.noteStartX),
    noteEndX: finiteOrNull(measureLayout?.noteEndX),
    rows,
  }
}

export function buildFirstMeasureDiffReport(params: {
  beforeSnapshot: FirstMeasureSnapshot
  afterSnapshot: FirstMeasureSnapshot
  dragContext: FirstMeasureDragContext | null
  dragPreviewFrameCount: number
}): string {
  const {
    beforeSnapshot,
    afterSnapshot,
    dragContext,
    dragPreviewFrameCount,
  } = params
  const afterByRowKey = new Map<string, FirstMeasureNoteDebugRow>()
  afterSnapshot.rows.forEach((row) => {
    afterByRowKey.set(`${row.staff}:${row.noteId}:${row.keyIndex}`, row)
  })
  const lines: string[] = [
    `generatedAt: ${new Date().toISOString()}`,
    `debugTarget: first-measure(pair=0)`,
    `dragged: ${
      dragContext
        ? `${dragContext.staff}:${dragContext.noteId}[key=${dragContext.keyIndex}] pair=${dragContext.pairIndex}`
        : 'unknown'
    }`,
    `dragPreviewFrameCount: ${dragPreviewFrameCount}`,
    `baselineStage: ${beforeSnapshot.stage} at ${beforeSnapshot.generatedAt}`,
    `releaseStage: ${afterSnapshot.stage} at ${afterSnapshot.generatedAt}`,
    `baseline measureX=${formatDebugCoord(beforeSnapshot.measureX)} measureWidth=${formatDebugCoord(beforeSnapshot.measureWidth)} measureEndBarX=${formatDebugCoord(beforeSnapshot.measureEndBarX)} noteStartX=${formatDebugCoord(beforeSnapshot.noteStartX)} noteEndX=${formatDebugCoord(beforeSnapshot.noteEndX)}`,
    `release  measureX=${formatDebugCoord(afterSnapshot.measureX)} measureWidth=${formatDebugCoord(afterSnapshot.measureWidth)} measureEndBarX=${formatDebugCoord(afterSnapshot.measureEndBarX)} noteStartX=${formatDebugCoord(afterSnapshot.noteStartX)} noteEndX=${formatDebugCoord(afterSnapshot.noteEndX)}`,
    '',
    'rows (before -> after | delta):',
  ]
  beforeSnapshot.rows.forEach((beforeRow) => {
    const rowKey = `${beforeRow.staff}:${beforeRow.noteId}:${beforeRow.keyIndex}`
    const afterRow = afterByRowKey.get(rowKey)
    const delta = (afterValue: number | null, beforeValue: number | null): string => {
      if (typeof afterValue !== 'number' || typeof beforeValue !== 'number') return 'null'
      return (afterValue - beforeValue).toFixed(3)
    }
    lines.push(
      [
        `- ${beforeRow.staff} note=${beforeRow.noteId} idx=${beforeRow.noteIndex} key=${beforeRow.keyIndex} pitch=${beforeRow.pitch}:`,
        `noteX ${formatDebugCoord(beforeRow.noteX)} -> ${formatDebugCoord(afterRow?.noteX)} (d=${delta(afterRow?.noteX ?? null, beforeRow.noteX)})`,
        `headX ${formatDebugCoord(beforeRow.headX)} -> ${formatDebugCoord(afterRow?.headX)} (d=${delta(afterRow?.headX ?? null, beforeRow.headX)})`,
        `headY ${formatDebugCoord(beforeRow.headY)} -> ${formatDebugCoord(afterRow?.headY)} (d=${delta(afterRow?.headY ?? null, beforeRow.headY)})`,
        `pitchY ${formatDebugCoord(beforeRow.pitchY)} -> ${formatDebugCoord(afterRow?.pitchY)} (d=${delta(afterRow?.pitchY ?? null, beforeRow.pitchY)})`,
        `rightX ${formatDebugCoord(beforeRow.noteRightX)} -> ${formatDebugCoord(afterRow?.noteRightX)} (d=${delta(afterRow?.noteRightX ?? null, beforeRow.noteRightX)})`,
        `spacingRightX ${formatDebugCoord(beforeRow.spacingRightX)} -> ${formatDebugCoord(afterRow?.spacingRightX)} (d=${delta(afterRow?.spacingRightX ?? null, beforeRow.spacingRightX)})`,
      ].join(' '),
    )
  })
  return lines.join('\n')
}
