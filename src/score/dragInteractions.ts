import {
  buildAccidentalStateBeforeNote,
  getEffectivePitchForStaffPosition,
  isSameStaffPositionPitch,
  normalizeMeasurePairAt,
} from './accidentals'
import { createDragStateFromHit, resolveCurrentNoteForHit, resolveKeyFifthsForPair, resolveMeasureStaffNotesForHit } from './dragStart'
import { getStaffStepDelta, resolveGroupedTargetPitch } from './dragPitchTransform'
import { getNearestPitchByY } from './pitchUtils'
import {
  flattenBassFromPairs,
  flattenTrebleFromPairs,
  updateMeasurePairPitchAt,
  updateMeasurePairsPitch,
  updateScoreNotePitchAtKey,
} from './scoreOps'
import { resolveForwardTieTargets, resolvePreviousTieTarget } from './tieChain'
import { clearTieFrozenIncoming, getTieFrozenIncoming, setTieFrozenIncoming } from './tieFrozen'
import type { HitNote } from './layout/hitTest'
import type {
  DragState,
  DragTieTarget,
  ImportedNoteLocation,
  LayoutReflowHint,
  MeasureLayout,
  MeasurePair,
  Pitch,
  ScoreNote,
  Selection,
} from './types'

function normalizeAccidentalSymbol(accidental: string | null | undefined): string {
  return accidental ?? ''
}

function buildStaffAccidentalLayoutSignature(notes: ScoreNote[]): string {
  return notes
    .map((note, noteIndex) => {
      const root = normalizeAccidentalSymbol(note.accidental)
      const chord = note.chordPitches?.map((_, chordIndex) => normalizeAccidentalSymbol(note.chordAccidentals?.[chordIndex])).join(',') ?? ''
      return `${noteIndex}:${root}|${chord}`
    })
    .join(';')
}

function hasMeasureAccidentalLayoutChanged(beforePair: MeasurePair | undefined, afterPair: MeasurePair | undefined): boolean {
  if (!beforePair || !afterPair) return true
  const beforeTreble = buildStaffAccidentalLayoutSignature(beforePair.treble)
  const afterTreble = buildStaffAccidentalLayoutSignature(afterPair.treble)
  if (beforeTreble !== afterTreble) return true
  const beforeBass = buildStaffAccidentalLayoutSignature(beforePair.bass)
  const afterBass = buildStaffAccidentalLayoutSignature(afterPair.bass)
  return beforeBass !== afterBass
}

function buildLayoutReflowHint(params: {
  pairIndices: number[]
  fallbackPairIndex: number
  sourcePairs: MeasurePair[]
  normalizedPairs: MeasurePair[]
}): LayoutReflowHint {
  const { pairIndices, fallbackPairIndex, sourcePairs, normalizedPairs } = params
  const uniquePairIndices = [...new Set(pairIndices)].sort((left, right) => left - right)
  const resolvedPairIndex = uniquePairIndices[0] ?? fallbackPairIndex
  const accidentalLayoutChanged = uniquePairIndices.some((pairIndex) =>
    hasMeasureAccidentalLayoutChanged(sourcePairs[pairIndex], normalizedPairs[pairIndex]),
  )
  return {
    pairIndex: resolvedPairIndex,
    scoreContentChanged: normalizedPairs !== sourcePairs,
    accidentalLayoutChanged,
    shouldReflow: accidentalLayoutChanged,
  }
}

function updatePairsPitchAtTieTargets(params: {
  pairs: MeasurePair[]
  targets: DragTieTarget[]
  pitch: Pitch
}): { nextPairs: MeasurePair[]; changedPairIndices: number[] } {
  const { pairs, targets, pitch } = params
  if (targets.length === 0) return { nextPairs: pairs, changedPairIndices: [] }

  let nextPairs = pairs
  const changedPairIndices = new Set<number>()

  targets.forEach((target) => {
    const pair = nextPairs[target.pairIndex]
    if (!pair) return
    const sourceNotes = target.staff === 'treble' ? pair.treble : pair.bass
    const sourceNote = sourceNotes[target.noteIndex]
    if (!sourceNote || sourceNote.id !== target.noteId) return
    const nextNote = updateScoreNotePitchAtKey(sourceNote, pitch, target.keyIndex)
    if (nextNote === sourceNote) return

    if (nextPairs === pairs) {
      nextPairs = pairs.slice()
    }
    const nextPair = nextPairs[target.pairIndex] ?? pair
    const nextStaffNotes = sourceNotes.slice()
    nextStaffNotes[target.noteIndex] = nextNote
    nextPairs[target.pairIndex] =
      target.staff === 'treble'
        ? { treble: nextStaffNotes, bass: nextPair.bass }
        : { treble: nextPair.treble, bass: nextStaffNotes }
    changedPairIndices.add(target.pairIndex)
  })

  return {
    nextPairs,
    changedPairIndices: [...changedPairIndices].sort((left, right) => left - right),
  }
}

type AbsolutePitchTarget = DragTieTarget & {
  targetPitch: Pitch
}

function updatePairsPitchAtAbsoluteTargets(params: {
  pairs: MeasurePair[]
  targets: AbsolutePitchTarget[]
}): { nextPairs: MeasurePair[]; changedPairIndices: number[] } {
  const { pairs, targets } = params
  if (targets.length === 0) return { nextPairs: pairs, changedPairIndices: [] }

  let nextPairs = pairs
  const changedPairIndices = new Set<number>()

  targets.forEach((target) => {
    const pair = nextPairs[target.pairIndex]
    if (!pair) return
    const sourceNotes = target.staff === 'treble' ? pair.treble : pair.bass
    const sourceNote = sourceNotes[target.noteIndex]
    if (!sourceNote || sourceNote.id !== target.noteId) return
    const nextNote = updateScoreNotePitchAtKey(sourceNote, target.targetPitch, target.keyIndex)
    if (nextNote === sourceNote) return

    if (nextPairs === pairs) {
      nextPairs = pairs.slice()
    }
    const nextPair = nextPairs[target.pairIndex] ?? pair
    const nextStaffNotes = sourceNotes.slice()
    nextStaffNotes[target.noteIndex] = nextNote
    nextPairs[target.pairIndex] =
      target.staff === 'treble'
        ? { treble: nextStaffNotes, bass: nextPair.bass }
        : { treble: nextPair.treble, bass: nextStaffNotes }
    changedPairIndices.add(target.pairIndex)
  })

  return {
    nextPairs,
    changedPairIndices: [...changedPairIndices].sort((left, right) => left - right),
  }
}

function getPitchAtKey(note: ScoreNote | undefined, keyIndex: number): Pitch | null {
  if (!note || note.isRest) return null
  if (keyIndex <= 0) return note.pitch
  const chordIndex = keyIndex - 1
  if (!note.chordPitches || chordIndex < 0 || chordIndex >= note.chordPitches.length) return null
  return note.chordPitches[chordIndex] ?? null
}

function updatePairsTieFreezeAtBoundary(params: {
  pairs: MeasurePair[]
  previousTarget: DragTieTarget | null | undefined
  sourceTarget: DragTieTarget | null | undefined
  sourceOriginPitch: Pitch
}): { nextPairs: MeasurePair[]; changedPairIndices: number[] } {
  const { pairs, previousTarget, sourceTarget, sourceOriginPitch } = params
  if (!sourceTarget) return { nextPairs: pairs, changedPairIndices: [] }

  const sourcePair = pairs[sourceTarget.pairIndex]
  const sourceStaffNotes = sourceTarget.staff === 'treble' ? sourcePair?.treble : sourcePair?.bass
  const sourceNote = sourceStaffNotes?.[sourceTarget.noteIndex]
  if (!sourcePair || !sourceNote || sourceNote.id !== sourceTarget.noteId || sourceNote.isRest) {
    return { nextPairs: pairs, changedPairIndices: [] }
  }

  let shouldFreeze = false
  if (previousTarget) {
    const previousPair = pairs[previousTarget.pairIndex]
    const previousStaffNotes = previousTarget.staff === 'treble' ? previousPair?.treble : previousPair?.bass
    const previousNote = previousStaffNotes?.[previousTarget.noteIndex]
    if (previousPair && previousNote && previousNote.id === previousTarget.noteId && !previousNote.isRest) {
      const previousPitch = getPitchAtKey(previousNote, previousTarget.keyIndex)
      const sourcePitch = getPitchAtKey(sourceNote, sourceTarget.keyIndex)
      shouldFreeze = Boolean(previousPitch && sourcePitch && previousPitch !== sourcePitch)
    }
  }

  const nextSourceNote = shouldFreeze
    ? (() => {
        const previousFreeze = getTieFrozenIncoming(sourceNote, sourceTarget.keyIndex)
        const freezePayload =
          previousFreeze &&
          previousFreeze.fromNoteId === (previousTarget?.noteId ?? null) &&
          (typeof previousFreeze.fromKeyIndex === 'number' ? previousFreeze.fromKeyIndex : null) ===
            (previousTarget?.keyIndex ?? null)
            ? previousFreeze
            : {
                pitch: sourceOriginPitch,
                fromNoteId: previousTarget?.noteId ?? null,
                fromKeyIndex: previousTarget?.keyIndex ?? null,
              }
        return setTieFrozenIncoming(sourceNote, sourceTarget.keyIndex, freezePayload)
      })()
    : clearTieFrozenIncoming(sourceNote, sourceTarget.keyIndex)
  if (nextSourceNote === sourceNote) {
    return { nextPairs: pairs, changedPairIndices: [] }
  }

  const nextPairs = pairs.slice()
  const nextPair = nextPairs[sourceTarget.pairIndex] ?? sourcePair
  const nextStaffNotes = sourceStaffNotes.slice()
  nextStaffNotes[sourceTarget.noteIndex] = nextSourceNote
  nextPairs[sourceTarget.pairIndex] =
    sourceTarget.staff === 'treble'
      ? { treble: nextStaffNotes, bass: nextPair.bass }
      : { treble: nextPair.treble, bass: nextStaffNotes }
  return {
    nextPairs,
    changedPairIndices: [sourceTarget.pairIndex],
  }
}

function normalizeFrozenFromKeyIndex(value: number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  return 0
}

function reconcileFrozenIncomingForSource(params: {
  pairs: MeasurePair[]
  sourceTarget: DragTieTarget | null | undefined
}): { nextPairs: MeasurePair[]; changedPairIndices: number[] } {
  const { pairs, sourceTarget } = params
  if (!sourceTarget) return { nextPairs: pairs, changedPairIndices: [] }

  const sourcePair = pairs[sourceTarget.pairIndex]
  const sourceNotes = sourceTarget.staff === 'treble' ? sourcePair?.treble : sourcePair?.bass
  const sourceNote = sourceNotes?.[sourceTarget.noteIndex]
  if (!sourcePair || !sourceNote || sourceNote.id !== sourceTarget.noteId || sourceNote.isRest) {
    return { nextPairs: pairs, changedPairIndices: [] }
  }
  const sourcePitch = getPitchAtKey(sourceNote, sourceTarget.keyIndex)
  if (!sourcePitch) return { nextPairs: pairs, changedPairIndices: [] }

  let nextPairs = pairs
  const changedPairIndices = new Set<number>()

  const reconcileStaff = (pairIndex: number, staff: 'treble' | 'bass') => {
    const pair = nextPairs[pairIndex]
    if (!pair) return
    const originalStaffNotes = staff === 'treble' ? pair.treble : pair.bass
    let nextStaffNotes = originalStaffNotes
    let staffChanged = false

    for (let noteIndex = 0; noteIndex < originalStaffNotes.length; noteIndex += 1) {
      const note = nextStaffNotes[noteIndex]
      if (!note || note.isRest) continue
      let nextNote = note

      const rootFrozen = getTieFrozenIncoming(nextNote, 0)
      if (
        rootFrozen &&
        rootFrozen.fromNoteId === sourceTarget.noteId &&
        normalizeFrozenFromKeyIndex(rootFrozen.fromKeyIndex) === sourceTarget.keyIndex
      ) {
        const targetPitch = getPitchAtKey(nextNote, 0)
        if (targetPitch && targetPitch === sourcePitch) {
          nextNote = clearTieFrozenIncoming(nextNote, 0)
        }
      }

      const chordCount = nextNote.chordPitches?.length ?? 0
      for (let chordIndex = 0; chordIndex < chordCount; chordIndex += 1) {
        const keyIndex = chordIndex + 1
        const chordFrozen = getTieFrozenIncoming(nextNote, keyIndex)
        if (
          chordFrozen &&
          chordFrozen.fromNoteId === sourceTarget.noteId &&
          normalizeFrozenFromKeyIndex(chordFrozen.fromKeyIndex) === sourceTarget.keyIndex
        ) {
          const targetPitch = getPitchAtKey(nextNote, keyIndex)
          if (targetPitch && targetPitch === sourcePitch) {
            nextNote = clearTieFrozenIncoming(nextNote, keyIndex)
          }
        }
      }

      if (nextNote !== note) {
        if (nextStaffNotes === originalStaffNotes) {
          nextStaffNotes = originalStaffNotes.slice()
        }
        nextStaffNotes[noteIndex] = nextNote
        staffChanged = true
      }
    }

    if (!staffChanged) return
    if (nextPairs === pairs) {
      nextPairs = pairs.slice()
    }
    const nextPair = nextPairs[pairIndex] ?? pair
    nextPairs[pairIndex] =
      staff === 'treble'
        ? { treble: nextStaffNotes, bass: nextPair.bass }
        : { treble: nextPair.treble, bass: nextStaffNotes }
    changedPairIndices.add(pairIndex)
  }

  for (let pairIndex = 0; pairIndex < nextPairs.length; pairIndex += 1) {
    reconcileStaff(pairIndex, 'treble')
    reconcileStaff(pairIndex, 'bass')
  }

  return {
    nextPairs,
    changedPairIndices: [...changedPairIndices].sort((left, right) => left - right),
  }
}

function toTargetKey(target: DragTieTarget): string {
  return `${target.staff}:${target.pairIndex}:${target.noteIndex}:${target.noteId}:${target.keyIndex}`
}

function buildGroupAbsoluteTargets(params: {
  groupTargets: DragTieTarget[] | undefined
  staffStepDelta: number | null
  reservedTargetKeys: Set<string>
}): AbsolutePitchTarget[] {
  const { groupTargets, staffStepDelta, reservedTargetKeys } = params
  if (!groupTargets || groupTargets.length === 0 || staffStepDelta === null || staffStepDelta === 0) return []
  const result: AbsolutePitchTarget[] = []
  const seen = new Set<string>()
  groupTargets.forEach((target) => {
    const key = toTargetKey(target)
    if (reservedTargetKeys.has(key) || seen.has(key)) return
    const targetPitch = resolveGroupedTargetPitch(target, staffStepDelta)
    if (!targetPitch) return
    seen.add(key)
    result.push({
      ...target,
      targetPitch,
    })
  })
  return result
}

export function buildDragStateForHit(params: {
  hit: HitNote
  pointerId: number
  surfaceTop: number
  surfaceClientToScoreScaleY: number
  startClientY: number
  localPointerY: number
  importedPairs: MeasurePair[] | null
  importedNoteLookup: Map<string, ImportedNoteLocation>
  trebleNoteById: Map<string, ScoreNote>
  bassNoteById: Map<string, ScoreNote>
  currentMeasurePairs: MeasurePair[]
  measureLayouts: Map<number, MeasureLayout>
  importedKeyFifths: number[] | null
  pitches: Pitch[]
}): { dragState: DragState; selection: Selection } {
  const {
    hit,
    pointerId,
    surfaceTop,
    surfaceClientToScoreScaleY,
    startClientY,
    localPointerY,
    importedPairs,
    importedNoteLookup,
    trebleNoteById,
    bassNoteById,
    currentMeasurePairs,
    measureLayouts,
    importedKeyFifths,
    pitches,
  } = params
  const hitNote = hit.layout
  const hitHead = hit.head

  const current = resolveCurrentNoteForHit({
    hitLayout: hitNote,
    importedPairs,
    importedNoteLookup,
    trebleNoteById,
    bassNoteById,
  })
  const measureStaffNotes = resolveMeasureStaffNotesForHit({
    hitLayout: hitNote,
    importedPairs,
    currentMeasurePairs,
  })
  const keyFifths = resolveKeyFifthsForPair({
    pairIndex: hitNote.pairIndex,
    measureLayouts,
    importedKeyFifths,
  })
  const accidentalStateBeforeNote = buildAccidentalStateBeforeNote(measureStaffNotes, hitNote.noteIndex, keyFifths)
  const noteCenterY = hitHead.y
  const grabOffsetY = localPointerY - noteCenterY
  const hitKeyIndex = hitHead.keyIndex
  const currentPitch = current && hitKeyIndex > 0 ? current.chordPitches?.[hitKeyIndex - 1] ?? current.pitch : current?.pitch
  const pitch = currentPitch ?? hitHead.pitch ?? getNearestPitchByY(noteCenterY, hitNote.pitchYMap, pitches)
  const activeMeasurePairs = importedPairs ?? currentMeasurePairs
  const importedLocation = importedPairs ? importedNoteLookup.get(hitNote.id) : null
  const tieSourcePairIndex = importedLocation?.pairIndex ?? hitNote.pairIndex
  const tieSourceNoteIndex = importedLocation?.noteIndex ?? hitNote.noteIndex
  const linkedTieTargets =
    resolveForwardTieTargets({
      measurePairs: activeMeasurePairs,
      pairIndex: tieSourcePairIndex,
      noteIndex: tieSourceNoteIndex,
      keyIndex: hitKeyIndex,
      staff: hitNote.staff,
      pitchHint: pitch,
    }) ?? []
  const previousTieTarget = resolvePreviousTieTarget({
    measurePairs: activeMeasurePairs,
    pairIndex: tieSourcePairIndex,
    noteIndex: tieSourceNoteIndex,
    keyIndex: hitKeyIndex,
    staff: hitNote.staff,
    pitchHint: pitch,
  })

  const dragState: DragState = createDragStateFromHit({
    hit,
    pointerId,
    surfaceTop,
    surfaceClientToScoreScaleY,
    startClientY,
    pitch,
    grabOffsetY,
    keyFifths,
    accidentalStateBeforeNote,
  })
  dragState.linkedTieTargets = linkedTieTargets.length > 0
    ? linkedTieTargets
    : [
        {
          pairIndex: tieSourcePairIndex,
          noteIndex: tieSourceNoteIndex,
          staff: hitNote.staff,
          noteId: hitNote.id,
          keyIndex: hitKeyIndex,
          pitch,
        },
      ]
  dragState.previousTieTarget = previousTieTarget

  return {
    dragState,
    selection: { noteId: hitNote.id, staff: hitNote.staff, keyIndex: hitKeyIndex },
  }
}

export function getDragMovePitch(params: { drag: DragState; clientY: number; pitches: Pitch[] }): Pitch {
  const { drag, clientY, pitches } = params
  const y = (clientY - drag.surfaceTop) * drag.surfaceClientToScoreScaleY
  const targetY = y - drag.grabOffsetY
  const staffPositionPitch = getNearestPitchByY(targetY, drag.pitchYMap, pitches, drag.pitch)
  if (isSameStaffPositionPitch(staffPositionPitch, drag.pitch)) {
    return drag.pitch
  }
  return getEffectivePitchForStaffPosition(staffPositionPitch, drag.keyFifths, drag.accidentalStateBeforeNote)
}

export function commitDragPitchToScoreData(params: {
  drag: DragState
  pitch: Pitch
  importedPairs: MeasurePair[] | null
  importedNoteLookup: Map<string, ImportedNoteLocation>
  currentPairs: MeasurePair[]
  importedKeyFifths: number[] | null
}): 
  | { normalizedPairs: MeasurePair[]; fromImported: true; layoutReflowHint: LayoutReflowHint }
  | { normalizedPairs: MeasurePair[]; trebleNotes: ScoreNote[]; bassNotes: ScoreNote[]; fromImported: false; layoutReflowHint: LayoutReflowHint } {
  const { drag, pitch, importedPairs, importedNoteLookup, currentPairs, importedKeyFifths } = params
  const staffStepDelta = getStaffStepDelta(drag.originPitch ?? drag.pitch, pitch)

  if (importedPairs) {
    const sourcePairs = importedPairs
    const location = importedNoteLookup.get(drag.noteId)
    const tieTargets =
      drag.linkedTieTargets && drag.linkedTieTargets.length > 0
        ? drag.linkedTieTargets
        : location
          ? [{
              pairIndex: location.pairIndex,
              noteIndex: location.noteIndex,
              staff: location.staff,
              noteId: drag.noteId,
              keyIndex: drag.keyIndex,
              pitch: drag.pitch,
            }]
          : []
    const { nextPairs: updatedByPrimary, changedPairIndices: primaryChangedPairIndices } =
      tieTargets.length > 0
        ? updatePairsPitchAtTieTargets({
            pairs: sourcePairs,
            targets: tieTargets,
            pitch,
          })
        : {
            nextPairs: location
              ? updateMeasurePairPitchAt(sourcePairs, location, pitch, drag.keyIndex)
              : updateMeasurePairsPitch(sourcePairs, drag.noteId, pitch, drag.keyIndex),
            changedPairIndices: [location?.pairIndex ?? drag.pairIndex],
          }
    const primaryTargetKeys = new Set<string>(tieTargets.map((target) => toTargetKey(target)))
    const groupAbsoluteTargets =
      buildGroupAbsoluteTargets({
        groupTargets: drag.groupMoveTargets,
        staffStepDelta,
        reservedTargetKeys: primaryTargetKeys,
      })
    const { nextPairs: updatedByGroup, changedPairIndices: groupChangedPairIndices } = updatePairsPitchAtAbsoluteTargets({
      pairs: updatedByPrimary,
      targets: groupAbsoluteTargets,
    })
    const sourceTieTarget = tieTargets.find((target) => target.noteId === drag.noteId && target.keyIndex === drag.keyIndex) ?? tieTargets[0] ?? null
    const { nextPairs: updated, changedPairIndices: tieFreezeChangedPairIndices } = updatePairsTieFreezeAtBoundary({
      pairs: updatedByGroup,
      previousTarget: drag.previousTieTarget,
      sourceTarget: sourceTieTarget,
      sourceOriginPitch: drag.originPitch ?? drag.pitch,
    })
    const { nextPairs: updatedWithReconciledFrozenTargets, changedPairIndices: reconciledFrozenTargetPairIndices } =
      reconcileFrozenIncomingForSource({
        pairs: updated,
        sourceTarget: sourceTieTarget,
      })
    const changedPairIndices = [
      ...new Set([
        ...primaryChangedPairIndices,
        ...groupChangedPairIndices,
        ...tieFreezeChangedPairIndices,
        ...reconciledFrozenTargetPairIndices,
      ]),
    ].sort((left, right) => left - right)
    let normalizedPairs = updatedWithReconciledFrozenTargets
    changedPairIndices.forEach((pairIndex) => {
      normalizedPairs = normalizeMeasurePairAt(normalizedPairs, pairIndex, importedKeyFifths)
    })
    const layoutHintPairIndices = changedPairIndices.length > 0 ? changedPairIndices : [location?.pairIndex ?? drag.pairIndex]
    return {
      normalizedPairs,
      fromImported: true,
      layoutReflowHint: buildLayoutReflowHint({
        pairIndices: layoutHintPairIndices,
        fallbackPairIndex: location?.pairIndex ?? drag.pairIndex,
        sourcePairs,
        normalizedPairs,
      }),
    }
  }

  const sourcePairs = currentPairs
  const tieTargets =
    drag.linkedTieTargets && drag.linkedTieTargets.length > 0
      ? drag.linkedTieTargets
      : []
  const { nextPairs: updatedByPrimary, changedPairIndices: primaryChangedPairIndices } =
    tieTargets.length > 0
      ? updatePairsPitchAtTieTargets({
          pairs: sourcePairs,
          targets: tieTargets,
          pitch,
        })
      : {
          nextPairs: updateMeasurePairsPitch(sourcePairs, drag.noteId, pitch, drag.keyIndex),
          changedPairIndices: [drag.pairIndex],
        }
  const primaryTargetKeys = new Set<string>(tieTargets.map((target) => toTargetKey(target)))
  const groupAbsoluteTargets =
    buildGroupAbsoluteTargets({
      groupTargets: drag.groupMoveTargets,
      staffStepDelta,
      reservedTargetKeys: primaryTargetKeys,
    })
  const { nextPairs: updatedByGroup, changedPairIndices: groupChangedPairIndices } = updatePairsPitchAtAbsoluteTargets({
    pairs: updatedByPrimary,
    targets: groupAbsoluteTargets,
  })
  const sourceTieTarget = tieTargets.find((target) => target.noteId === drag.noteId && target.keyIndex === drag.keyIndex) ?? tieTargets[0] ?? null
  const { nextPairs: updated, changedPairIndices: tieFreezeChangedPairIndices } = updatePairsTieFreezeAtBoundary({
    pairs: updatedByGroup,
    previousTarget: drag.previousTieTarget,
    sourceTarget: sourceTieTarget,
    sourceOriginPitch: drag.originPitch ?? drag.pitch,
  })
  const { nextPairs: updatedWithReconciledFrozenTargets, changedPairIndices: reconciledFrozenTargetPairIndices } =
    reconcileFrozenIncomingForSource({
      pairs: updated,
      sourceTarget: sourceTieTarget,
    })
  const changedPairIndices = [
    ...new Set([
      ...primaryChangedPairIndices,
      ...groupChangedPairIndices,
      ...tieFreezeChangedPairIndices,
      ...reconciledFrozenTargetPairIndices,
    ]),
  ].sort((left, right) => left - right)
  let normalizedPairs = updatedWithReconciledFrozenTargets
  changedPairIndices.forEach((pairIndex) => {
    normalizedPairs = normalizeMeasurePairAt(normalizedPairs, pairIndex, null)
  })
  const layoutHintPairIndices = changedPairIndices.length > 0 ? changedPairIndices : [drag.pairIndex]
  return {
    normalizedPairs,
    trebleNotes: flattenTrebleFromPairs(normalizedPairs),
    bassNotes: flattenBassFromPairs(normalizedPairs),
    fromImported: false,
    layoutReflowHint: buildLayoutReflowHint({
      pairIndices: layoutHintPairIndices,
      fallbackPairIndex: drag.pairIndex,
      sourcePairs,
      normalizedPairs,
    }),
  }
}
