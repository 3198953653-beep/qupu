import { BarlineType, Stave } from 'vexflow'
import { getKeySignatureSpecFromFifths } from '../accidentals'
import { SYSTEM_BASS_OFFSET_Y, SYSTEM_TREBLE_OFFSET_Y } from '../constants'
import type { TimeSignature } from '../types'

const START_DECORATION_PROBE_WIDTH_PX = 1024

export type StartDecorationDisplayMeta = {
  pairIndex: number
  isSystemStart: boolean
  keyFifths: number
  showKeySignature: boolean
  timeSignature: TimeSignature
  showTimeSignature: boolean
}

export function toTimeSignatureKey(signature: TimeSignature): string {
  return `${signature.beats}/${signature.beatType}`
}

export function hasVisibleStartDecorations(
  meta: Pick<StartDecorationDisplayMeta, 'isSystemStart' | 'showKeySignature' | 'showTimeSignature'>,
): boolean {
  return meta.isSystemStart || meta.showKeySignature || meta.showTimeSignature
}

export function applyMeasureStartDecorationsToStave(
  stave: Stave,
  clef: 'treble' | 'bass',
  meta: Pick<StartDecorationDisplayMeta, 'isSystemStart' | 'keyFifths' | 'showKeySignature' | 'timeSignature' | 'showTimeSignature'>,
): void {
  if (meta.isSystemStart) {
    stave.addClef(clef)
  } else {
    stave.setBegBarType(BarlineType.NONE)
  }

  if (meta.showKeySignature) {
    stave.addKeySignature(getKeySignatureSpecFromFifths(meta.keyFifths))
  }
  if (meta.showTimeSignature) {
    stave.addTimeSignature(toTimeSignatureKey(meta.timeSignature))
  }
}

export function measureActualStartDecorationWidthPx(
  meta: Pick<StartDecorationDisplayMeta, 'isSystemStart' | 'keyFifths' | 'showKeySignature' | 'timeSignature' | 'showTimeSignature'>,
): number {
  if (!hasVisibleStartDecorations(meta)) {
    return 0
  }

  const trebleStave = new Stave(0, SYSTEM_TREBLE_OFFSET_Y, START_DECORATION_PROBE_WIDTH_PX)
  const bassStave = new Stave(0, SYSTEM_BASS_OFFSET_Y, START_DECORATION_PROBE_WIDTH_PX)
  applyMeasureStartDecorationsToStave(trebleStave, 'treble', meta)
  applyMeasureStartDecorationsToStave(bassStave, 'bass', meta)

  return Math.max(0, trebleStave.getNoteStartX(), bassStave.getNoteStartX())
}

export function resolveStartDecorationDisplayMetas(params: {
  measureCount: number
  keyFifthsByPair: number[] | null
  timeSignaturesByPair: TimeSignature[] | null
  systemStartPairIndices?: ReadonlySet<number> | null
}): StartDecorationDisplayMeta[] {
  const { measureCount, keyFifthsByPair, timeSignaturesByPair, systemStartPairIndices = null } = params
  const metas: StartDecorationDisplayMeta[] = []
  let previousKeyFifths = 0
  let previousTimeSignature: TimeSignature = { beats: 4, beatType: 4 }

  for (let pairIndex = 0; pairIndex < measureCount; pairIndex += 1) {
    const isSystemStart = pairIndex === 0 || systemStartPairIndices?.has(pairIndex) === true
    const keyFifths = keyFifthsByPair?.[pairIndex] ?? previousKeyFifths
    const timeSignature = timeSignaturesByPair?.[pairIndex] ?? previousTimeSignature
    const showKeySignature = isSystemStart || keyFifths !== previousKeyFifths
    const showTimeSignature =
      isSystemStart ||
      timeSignature.beats !== previousTimeSignature.beats ||
      timeSignature.beatType !== previousTimeSignature.beatType

    metas.push({
      pairIndex,
      isSystemStart,
      keyFifths,
      showKeySignature,
      timeSignature,
      showTimeSignature,
    })

    previousKeyFifths = keyFifths
    previousTimeSignature = timeSignature
  }

  return metas
}

export function resolveActualStartDecorationWidths(params: {
  metas: readonly StartDecorationDisplayMeta[]
}): {
  actualStartDecorationWidthPxByPair: number[]
} {
  const actualStartDecorationWidthPxByPair = params.metas.map((meta) =>
    Number(measureActualStartDecorationWidthPx(meta).toFixed(3)),
  )

  return {
    actualStartDecorationWidthPxByPair,
  }
}

export function resolveMeasureStartDecorationReserve(params: {
  actualStartDecorationWidthPx: number
}): {
  noteStartOffsetPx: number
  preferMeasureStartBarlineAxis: boolean
  showStartBoundaryReserve: boolean
} {
  const actualStartDecorationWidthPx = Math.max(0, params.actualStartDecorationWidthPx)

  if (actualStartDecorationWidthPx > 0) {
    return {
      noteStartOffsetPx: actualStartDecorationWidthPx,
      preferMeasureStartBarlineAxis: false,
      showStartBoundaryReserve: true,
    }
  }

  return {
    noteStartOffsetPx: 0,
    preferMeasureStartBarlineAxis: true,
    showStartBoundaryReserve: false,
  }
}
