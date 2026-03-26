import { DURATION_TICKS, TICKS_PER_BEAT } from './constants'
import { resolveEffectiveBoundary } from './layout/effectiveBoundary'
import type { MeasureTimelineBundle } from './timeline/types'
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

export function buildMeasureCoordinateDebugReport(params: {
  measureLayouts: Map<number, MeasureLayout>
  noteLayoutsByPair: Map<number, NoteLayout[]>
  measureTimelineBundles: Map<number, MeasureTimelineBundle>
  measurePairs: MeasurePair[]
  visibleSystemRange: { start: number; end: number }
}): {
  generatedAt: string
  totalMeasureCount: number
  renderedMeasureCount: number
  visibleSystemRange: { start: number; end: number }
  rows: unknown[]
} {
  const {
    measureLayouts,
    noteLayoutsByPair,
    measureTimelineBundles,
    measurePairs,
    visibleSystemRange,
  } = params
  const toRoundedNumber = (value: number | null | undefined, digits: number): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return Number(value.toFixed(digits))
  }
  const buildOnsetTicksByNoteIndex = (staffNotes: ScoreNote[]): number[] => {
    const onsetTicks: number[] = []
    let cursor = 0
    staffNotes.forEach((note) => {
      onsetTicks.push(cursor)
      const ticks = DURATION_TICKS[note.duration]
      const safeTicks = Number.isFinite(ticks) ? Math.max(1, ticks) : TICKS_PER_BEAT
      cursor += safeTicks
    })
    return onsetTicks
  }

  const rows = measurePairs.map((pair, pairIndex) => {
    const measureLayout = measureLayouts.get(pairIndex) ?? null
    const pairLayouts = noteLayoutsByPair.get(pairIndex) ?? []
    const timelineBundle = measureTimelineBundles.get(pairIndex) ?? null
    const trebleOnsetTicksByIndex = buildOnsetTicksByNoteIndex(pair.treble)
    const bassOnsetTicksByIndex = buildOnsetTicksByNoteIndex(pair.bass)
    const axisPointBuckets = new Map<
      number,
      { xTotal: number; xCount: number; trebleNoteCount: number; bassNoteCount: number }
    >()
    pairLayouts.forEach((layout) => {
      const onsetTicks =
        layout.staff === 'treble'
          ? (trebleOnsetTicksByIndex[layout.noteIndex] ?? null)
          : (bassOnsetTicksByIndex[layout.noteIndex] ?? null)
      if (typeof onsetTicks !== 'number' || !Number.isFinite(onsetTicks)) return
      const bucket = axisPointBuckets.get(onsetTicks) ?? {
        xTotal: 0,
        xCount: 0,
        trebleNoteCount: 0,
        bassNoteCount: 0,
      }
      if (Number.isFinite(layout.x)) {
        bucket.xTotal += layout.x
        bucket.xCount += 1
      }
      if (layout.staff === 'treble') {
        bucket.trebleNoteCount += 1
      } else {
        bucket.bassNoteCount += 1
      }
      axisPointBuckets.set(onsetTicks, bucket)
    })
    const orderedOnsets = [...axisPointBuckets.keys()].sort((left, right) => left - right)
    const timeAxisPointIndexByOnset = new Map<number, number>()
    const timeAxisPointXByOnset = new Map<number, number | null>()
    const timeAxisPoints = orderedOnsets.map((onsetTicks, pointIndex) => {
      const bucket = axisPointBuckets.get(onsetTicks)
      const averagedX =
        bucket && bucket.xCount > 0 ? toRoundedNumber(bucket.xTotal / bucket.xCount, 3) : null
      timeAxisPointIndexByOnset.set(onsetTicks, pointIndex)
      timeAxisPointXByOnset.set(onsetTicks, averagedX)
      const trebleNoteCount = bucket?.trebleNoteCount ?? 0
      const bassNoteCount = bucket?.bassNoteCount ?? 0
      return {
        pointIndex,
        onsetTicksInMeasure: onsetTicks,
        onsetBeatsInMeasure: toRoundedNumber(onsetTicks / TICKS_PER_BEAT, 4),
        x: averagedX,
        noteCount: trebleNoteCount + bassNoteCount,
        trebleNoteCount,
        bassNoteCount,
      }
    })
    const layoutRows = pairLayouts
      .slice()
      .sort((left, right) => {
        if (left.staff !== right.staff) return left.staff.localeCompare(right.staff)
        if (left.noteIndex !== right.noteIndex) return left.noteIndex - right.noteIndex
        return left.x - right.x
      })
      .map((layout) => {
        const sourceNote = layout.staff === 'treble' ? pair.treble[layout.noteIndex] : pair.bass[layout.noteIndex]
        const onsetTicksInMeasure =
          sourceNote && layout.staff === 'treble'
            ? (trebleOnsetTicksByIndex[layout.noteIndex] ?? null)
            : sourceNote
              ? (bassOnsetTicksByIndex[layout.noteIndex] ?? null)
              : null
        return {
          staff: layout.staff,
          noteId: layout.id,
          noteIndex: layout.noteIndex,
          pitch: sourceNote?.pitch ?? null,
          isRest: sourceNote?.isRest === true,
          duration: sourceNote?.duration ?? null,
          durationTicksInMeasure:
            sourceNote && Number.isFinite(DURATION_TICKS[sourceNote.duration])
              ? DURATION_TICKS[sourceNote.duration]
              : null,
          onsetTicksInMeasure:
            typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
              ? onsetTicksInMeasure
              : null,
          onsetBeatsInMeasure:
            typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
              ? toRoundedNumber(onsetTicksInMeasure / TICKS_PER_BEAT, 4)
              : null,
          timeAxisPointIndex:
            typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
              ? (timeAxisPointIndexByOnset.get(onsetTicksInMeasure) ?? null)
              : null,
          timeAxisPointX:
            typeof onsetTicksInMeasure === 'number' && Number.isFinite(onsetTicksInMeasure)
              ? (timeAxisPointXByOnset.get(onsetTicksInMeasure) ?? null)
              : null,
          x: layout.x,
          anchorX: layout.anchorX,
          visualLeftX: layout.visualLeftX,
          visualRightX: layout.visualRightX,
          rightX: layout.rightX,
          spacingRightX: layout.spacingRightX,
          noteHeads: layout.noteHeads.map((head) => ({
            keyIndex: head.keyIndex,
            pitch: head.pitch,
            x: head.x,
            y: head.y,
          })),
          accidentalCoords: Object.entries(layout.accidentalRightXByKeyIndex)
            .map(([rawKeyIndex, leftX]) => {
              const keyIndex = Number(rawKeyIndex)
              const accidentalLayout = layout.accidentalLayouts.find((entry) => entry.keyIndex === keyIndex)
              return {
                keyIndex,
                rightX: leftX,
                leftX:
                  typeof accidentalLayout?.hitMinX === 'number' && Number.isFinite(accidentalLayout.hitMinX)
                    ? accidentalLayout.hitMinX
                    : leftX,
                visualRightX:
                  typeof accidentalLayout?.hitMaxX === 'number' && Number.isFinite(accidentalLayout.hitMaxX)
                    ? accidentalLayout.hitMaxX
                    : null,
              }
            })
            .filter((entry) => Number.isFinite(entry.keyIndex) && Number.isFinite(entry.rightX))
            .sort((left, right) => left.keyIndex - right.keyIndex),
        }
      })

    const onsetRows = layoutRows.filter(
      (row): row is (typeof layoutRows)[number] & { onsetTicksInMeasure: number } =>
        typeof row.onsetTicksInMeasure === 'number' && Number.isFinite(row.onsetTicksInMeasure),
    )
    const firstOnsetTicks =
      onsetRows.length > 0
        ? onsetRows.reduce((minValue, row) => Math.min(minValue, row.onsetTicksInMeasure), Number.POSITIVE_INFINITY)
        : null
    const lastOnsetTicks =
      onsetRows.length > 0
        ? onsetRows.reduce((maxValue, row) => Math.max(maxValue, row.onsetTicksInMeasure), Number.NEGATIVE_INFINITY)
        : null

    const firstOnsetRows =
      typeof firstOnsetTicks === 'number' && Number.isFinite(firstOnsetTicks)
        ? onsetRows.filter((row) => row.onsetTicksInMeasure === firstOnsetTicks)
        : []
    const lastOnsetRows =
      typeof lastOnsetTicks === 'number' && Number.isFinite(lastOnsetTicks)
        ? onsetRows.filter((row) => row.onsetTicksInMeasure === lastOnsetTicks)
        : []

    const firstVisualLeftX = firstOnsetRows.reduce((minValue, row) => {
      let rowMin = Number.POSITIVE_INFINITY
      if (Number.isFinite(row.x)) rowMin = Math.min(rowMin, row.x)
      row.noteHeads.forEach((head) => {
        if (Number.isFinite(head.x)) rowMin = Math.min(rowMin, head.x)
      })
      row.accidentalCoords.forEach((accidental) => {
        if (typeof accidental.leftX === 'number' && Number.isFinite(accidental.leftX)) {
          rowMin = Math.min(rowMin, accidental.leftX)
        } else if (Number.isFinite(accidental.rightX)) {
          rowMin = Math.min(rowMin, accidental.rightX - 9)
        }
      })
      return Number.isFinite(rowMin) ? Math.min(minValue, rowMin) : minValue
    }, Number.POSITIVE_INFINITY)

    const lastVisualRightX = lastOnsetRows.reduce((maxValue, row) => {
      const rowRightX = Number.isFinite(row.spacingRightX)
        ? row.spacingRightX
        : Number.isFinite(row.rightX)
          ? row.rightX
          : Number.NEGATIVE_INFINITY
      return Number.isFinite(rowRightX) ? Math.max(maxValue, rowRightX) : maxValue
    }, Number.NEGATIVE_INFINITY)

    const maxVisualRightX =
      layoutRows.length > 0 ? layoutRows.reduce((maxX, row) => Math.max(maxX, row.rightX), Number.NEGATIVE_INFINITY) : null
    const maxSpacingRightX =
      layoutRows.length > 0
        ? layoutRows.reduce((maxX, row) => Math.max(maxX, row.spacingRightX), Number.NEGATIVE_INFINITY)
        : null

    const effectiveBoundary = measureLayout
      ? resolveEffectiveBoundary({
          measureX: measureLayout.measureX,
          measureWidth: measureLayout.measureWidth,
          noteStartX: measureLayout.noteStartX,
          noteEndX: measureLayout.noteEndX,
          showStartDecorations:
            measureLayout.isSystemStart ||
            measureLayout.showKeySignature ||
            measureLayout.showTimeSignature ||
            measureLayout.includeMeasureStartDecorations,
          showEndDecorations: measureLayout.showEndTimeSignature,
        })
      : null
    const spacingAnchorTicks = timelineBundle?.spacingAnchorTicks ?? orderedOnsets
    const firstSpacingTick = spacingAnchorTicks.length > 0 ? spacingAnchorTicks[0] ?? null : null
    const lastSpacingTick = spacingAnchorTicks.length > 0 ? spacingAnchorTicks[spacingAnchorTicks.length - 1] ?? null : null
    const firstSpacingTickX =
      typeof firstSpacingTick === 'number' && Number.isFinite(firstSpacingTick)
        ? timelineBundle?.spacingTickToX.get(firstSpacingTick) ?? timeAxisPointXByOnset.get(firstSpacingTick) ?? null
        : null
    const lastSpacingTickX =
      typeof lastSpacingTick === 'number' && Number.isFinite(lastSpacingTick)
        ? timelineBundle?.spacingTickToX.get(lastSpacingTick) ?? timeAxisPointXByOnset.get(lastSpacingTick) ?? null
        : null

    return {
      pairIndex,
      rendered: measureLayout !== null,
      timelineMode: timelineBundle?.timelineMode ?? 'legacy',
      measureX: measureLayout?.measureX ?? null,
      measureWidth: measureLayout?.contentMeasureWidth ?? measureLayout?.measureWidth ?? null,
      renderedMeasureWidthPx:
        measureLayout?.renderedMeasureWidth ?? measureLayout?.measureWidth ?? null,
      systemTop: measureLayout?.systemTop ?? null,
      trebleY: measureLayout?.trebleY ?? null,
      bassY: measureLayout?.bassY ?? null,
      measureStartBarX: measureLayout?.measureX ?? null,
      measureEndBarX:
        measureLayout
          ? measureLayout.measureX + (measureLayout.renderedMeasureWidth ?? measureLayout.measureWidth)
          : null,
      noteStartX: measureLayout?.noteStartX ?? null,
      noteEndX: measureLayout?.noteEndX ?? null,
      sharedStartDecorationReservePx:
        measureLayout && Number.isFinite(measureLayout.sharedStartDecorationReservePx)
          ? Number((measureLayout.sharedStartDecorationReservePx as number).toFixed(3))
          : null,
      actualStartDecorationWidthPx:
        measureLayout && Number.isFinite(measureLayout.actualStartDecorationWidthPx)
          ? Number((measureLayout.actualStartDecorationWidthPx as number).toFixed(3))
          : null,
      effectiveBoundaryStartX:
        measureLayout && Number.isFinite(measureLayout.effectiveBoundaryStartX)
          ? Number((measureLayout.effectiveBoundaryStartX as number).toFixed(3))
          : effectiveBoundary
            ? Number(effectiveBoundary.effectiveStartX.toFixed(3))
            : null,
      effectiveBoundaryEndX:
        measureLayout && Number.isFinite(measureLayout.effectiveBoundaryEndX)
          ? Number((measureLayout.effectiveBoundaryEndX as number).toFixed(3))
          : effectiveBoundary
            ? Number(effectiveBoundary.effectiveEndX.toFixed(3))
            : null,
      effectiveLeftGapPx:
        measureLayout && Number.isFinite(measureLayout.effectiveLeftGapPx)
          ? Number((measureLayout.effectiveLeftGapPx as number).toFixed(3))
          : effectiveBoundary && Number.isFinite(firstVisualLeftX)
            ? Number((firstVisualLeftX - effectiveBoundary.effectiveStartX).toFixed(3))
            : null,
      effectiveRightGapPx:
        measureLayout && Number.isFinite(measureLayout.effectiveRightGapPx)
          ? Number((measureLayout.effectiveRightGapPx as number).toFixed(3))
          : effectiveBoundary && Number.isFinite(lastVisualRightX)
            ? Number((effectiveBoundary.effectiveEndX - lastVisualRightX).toFixed(3))
            : null,
      leadingGapPx:
        measureLayout && Number.isFinite(measureLayout.leadingGapPx)
          ? Number((measureLayout.leadingGapPx as number).toFixed(3))
          : effectiveBoundary && typeof firstSpacingTickX === 'number' && Number.isFinite(firstSpacingTickX)
            ? Number((firstSpacingTickX - effectiveBoundary.effectiveStartX).toFixed(3))
            : null,
      trailingTailTicks:
        measureLayout && Number.isFinite(measureLayout.trailingTailTicks)
          ? Math.max(0, Math.round(measureLayout.trailingTailTicks as number))
          : timelineBundle && typeof lastSpacingTick === 'number' && Number.isFinite(lastSpacingTick)
            ? Math.max(0, Math.round(timelineBundle.measureTicks - lastSpacingTick))
            : null,
      trailingGapPx:
        measureLayout && Number.isFinite(measureLayout.trailingGapPx)
          ? Number((measureLayout.trailingGapPx as number).toFixed(3))
          : effectiveBoundary && typeof lastSpacingTickX === 'number' && Number.isFinite(lastSpacingTickX)
            ? Number((effectiveBoundary.effectiveEndX - lastSpacingTickX).toFixed(3))
            : null,
      spacingOccupiedLeftX:
        measureLayout && Number.isFinite(measureLayout.spacingOccupiedLeftX)
          ? Number((measureLayout.spacingOccupiedLeftX as number).toFixed(3))
          : null,
      spacingOccupiedRightX:
        measureLayout && Number.isFinite(measureLayout.spacingOccupiedRightX)
          ? Number((measureLayout.spacingOccupiedRightX as number).toFixed(3))
          : null,
      spacingAnchorGapFirstToLastPx:
        measureLayout && Number.isFinite(measureLayout.spacingAnchorGapFirstToLastPx)
          ? Number((measureLayout.spacingAnchorGapFirstToLastPx as number).toFixed(3))
          : null,
      timeAxisTicksPerBeat: TICKS_PER_BEAT,
      legacyOnsets: timelineBundle?.legacyOnsets ?? orderedOnsets,
      spacingAnchorTicks,
      spacingTickToX:
        timelineBundle?.spacingTickToX
          ? Object.fromEntries(
              [...timelineBundle.spacingTickToX.entries()].map(([tick, x]) => [
                String(tick),
                toRoundedNumber(x, 3),
              ]),
            )
          : {},
      spacingOnsetReserves:
        measureLayout?.spacingOnsetReserves?.map((entry) => ({
          onsetTicks: entry.onsetTicks,
          baseX: toRoundedNumber(entry.baseX, 3),
          finalX: toRoundedNumber(entry.finalX, 3),
          leftReservePx: toRoundedNumber(entry.leftReservePx, 3),
          rightReservePx: toRoundedNumber(entry.rightReservePx, 3),
          rawLeftReservePx: toRoundedNumber(entry.rawLeftReservePx, 3),
          rawRightReservePx: toRoundedNumber(entry.rawRightReservePx, 3),
          leftOccupiedInsetPx: toRoundedNumber(entry.leftOccupiedInsetPx, 3),
          rightOccupiedTailPx: toRoundedNumber(entry.rightOccupiedTailPx, 3),
          leadingTrebleRequestedExtraPx: toRoundedNumber(entry.leadingTrebleRequestedExtraPx, 3),
          leadingBassRequestedExtraPx: toRoundedNumber(entry.leadingBassRequestedExtraPx, 3),
          leadingWinningStaff: entry.leadingWinningStaff,
          trailingTrebleRequestedExtraPx: toRoundedNumber(entry.trailingTrebleRequestedExtraPx, 3),
          trailingBassRequestedExtraPx: toRoundedNumber(entry.trailingBassRequestedExtraPx, 3),
          trailingWinningStaff: entry.trailingWinningStaff,
        })) ?? [],
      spacingSegments:
        measureLayout?.spacingSegments?.map((entry) => ({
          fromOnsetTicks: entry.fromOnsetTicks,
          toOnsetTicks: entry.toOnsetTicks,
          baseGapPx: toRoundedNumber(entry.baseGapPx, 3),
          extraReservePx: toRoundedNumber(entry.extraReservePx, 3),
          appliedGapPx: toRoundedNumber(entry.appliedGapPx, 3),
          trebleRequestedExtraPx: toRoundedNumber(entry.trebleRequestedExtraPx, 3),
          bassRequestedExtraPx: toRoundedNumber(entry.bassRequestedExtraPx, 3),
          noteRestRequestedExtraPx: toRoundedNumber(entry.noteRestRequestedExtraPx, 3),
          noteRestVisibleGapPx:
            typeof entry.noteRestVisibleGapPx === 'number'
              ? toRoundedNumber(entry.noteRestVisibleGapPx, 3)
              : null,
          accidentalRequestedExtraPx: toRoundedNumber(entry.accidentalRequestedExtraPx, 3),
          accidentalVisibleGapPx:
            typeof entry.accidentalVisibleGapPx === 'number'
              ? toRoundedNumber(entry.accidentalVisibleGapPx, 3)
              : null,
          winningStaff: entry.winningStaff,
        })) ?? [],
      trebleTimelineEvents:
        timelineBundle?.trebleTimeline.events.map((event) => ({
          noteId: event.noteId,
          noteIndex: event.noteIndex,
          startTick: event.startTick,
          endTick: event.endTick,
          durationTicks: event.durationTicks,
          isRest: event.isRest,
        })) ?? [],
      bassTimelineEvents:
        timelineBundle?.bassTimeline.events.map((event) => ({
          noteId: event.noteId,
          noteIndex: event.noteIndex,
          startTick: event.startTick,
          endTick: event.endTick,
          durationTicks: event.durationTicks,
          isRest: event.isRest,
        })) ?? [],
      publicTimelineTicks: timelineBundle?.publicTimeline.points.map((point) => point.tick) ?? [],
      publicTickToX:
        timelineBundle?.publicAxisLayout
          ? Object.fromEntries(
              [...timelineBundle.publicAxisLayout.tickToX.entries()].map(([tick, x]) => [
                String(tick),
                toRoundedNumber(x, 3),
              ]),
            )
          : {},
      publicTimelineScale:
        timelineBundle?.publicAxisLayout && Number.isFinite(timelineBundle.publicAxisLayout.timelineScale)
          ? Number(timelineBundle.publicAxisLayout.timelineScale.toFixed(6))
          : null,
      publicTimelineTotalAnchorWeight:
        timelineBundle?.publicAxisLayout && Number.isFinite(timelineBundle.publicAxisLayout.totalAnchorWeight)
          ? Number(timelineBundle.publicAxisLayout.totalAnchorWeight.toFixed(6))
          : null,
      timelineDiffSummary: timelineBundle?.timelineDiffSummary ?? null,
      timeAxisPoints,
      maxVisualRightX,
      maxSpacingRightX,
      overflowVsNoteEndX:
        measureLayout && typeof maxSpacingRightX === 'number'
          ? Number((maxSpacingRightX - measureLayout.noteEndX).toFixed(3))
          : null,
      overflowVsMeasureEndBarX:
        measureLayout && typeof maxSpacingRightX === 'number'
          ? Number((maxSpacingRightX - (measureLayout.measureX + measureLayout.measureWidth)).toFixed(3))
          : null,
      notes: layoutRows,
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    totalMeasureCount: measurePairs.length,
    renderedMeasureCount: rows.filter((row) => row.rendered).length,
    visibleSystemRange: { ...visibleSystemRange },
    rows,
  }
}
