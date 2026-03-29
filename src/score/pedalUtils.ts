import { getBeatTicksByTimeSignature } from './chordRuler'
import { collectMeasureTickRangeNotes } from './chordRangeNoteCoverage'
import { resolvePairTimeSignature } from './measureRestUtils'
import type { ChordRulerEntry } from './chordRuler'
import type { MeasurePair, PedalApplyScope, PedalSpan, PedalStyle, TimeSignature } from './types'

export const PEDAL_RETRACT_BEAT_RATIO = 0.1
export const PEDAL_MIN_VISUAL_GAP_PX = 2

export const PEDAL_STYLE_LABELS: Record<PedalStyle, string> = {
  text: 'TEXT',
  bracket: 'BRACKET',
  mixed: 'MIXED',
}

type PedalTargetScopeRange =
  | {
      scope: 'all'
    }
  | {
      scope: 'segment'
      startPairIndex: number
      endPairIndexInclusive: number
    }
  | {
      scope: 'chord'
      pairIndex: number
      startTick: number
      endTick: number
    }

let pedalSpanIdSeq = 0

export function createPedalSpanId(): string {
  pedalSpanIdSeq += 1
  return `pedal-span-${pedalSpanIdSeq}`
}

function normalizePairIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function normalizeTick(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function sortPedalSpans(spans: readonly PedalSpan[]): PedalSpan[] {
  return [...spans].sort((left, right) => {
    if (left.startPairIndex !== right.startPairIndex) return left.startPairIndex - right.startPairIndex
    if (left.startTick !== right.startTick) return left.startTick - right.startTick
    if (left.endPairIndex !== right.endPairIndex) return left.endPairIndex - right.endPairIndex
    if (left.endTick !== right.endTick) return left.endTick - right.endTick
    return left.id.localeCompare(right.id)
  })
}

export function normalizePedalSpan(span: PedalSpan): PedalSpan {
  const startPairIndex = normalizePairIndex(span.startPairIndex)
  const endPairIndex = Math.max(startPairIndex, normalizePairIndex(span.endPairIndex))
  const startTick = normalizeTick(span.startTick)
  const endTick = normalizeTick(span.endTick)
  return {
    id: span.id || createPedalSpanId(),
    style: span.style,
    staff: 'bass',
    startPairIndex,
    startTick,
    endPairIndex,
    endTick,
  }
}

export function getPedalStyleFromMusicXmlAttributes(params: {
  signAttr?: string | null
  lineAttr?: string | null
}): PedalStyle {
  const signAttr = params.signAttr?.trim().toLowerCase() ?? ''
  const lineAttr = params.lineAttr?.trim().toLowerCase() ?? ''
  if (lineAttr === 'yes' && signAttr === 'no') return 'bracket'
  if (lineAttr === 'yes') return 'mixed'
  return 'text'
}

export function getMusicXmlPedalStyleAttributes(style: PedalStyle): {
  sign: 'yes' | 'no'
  line: 'yes' | 'no'
} {
  if (style === 'bracket') {
    return { sign: 'no', line: 'yes' }
  }
  if (style === 'mixed') {
    return { sign: 'yes', line: 'yes' }
  }
  return { sign: 'yes', line: 'no' }
}

export function spanIntersectsPedalScope(span: PedalSpan, scope: PedalTargetScopeRange): boolean {
  if (scope.scope === 'all') return true
  if (scope.scope === 'segment') {
    return !(span.endPairIndex < scope.startPairIndex || span.startPairIndex > scope.endPairIndexInclusive)
  }
  if (span.startPairIndex !== scope.pairIndex || span.endPairIndex !== scope.pairIndex) return false
  return !(span.endTick <= scope.startTick || span.startTick >= scope.endTick)
}

export function buildPedalSpansForScope(params: {
  style: PedalStyle
  scope: PedalTargetScopeRange
  measurePairs: MeasurePair[]
  chordRulerEntriesByPair: ChordRulerEntry[][] | null
  measureTimeSignaturesByMeasure: TimeSignature[] | null
}): PedalSpan[] {
  const {
    style,
    scope,
    measurePairs,
    chordRulerEntriesByPair,
    measureTimeSignaturesByMeasure,
  } = params
  if (!chordRulerEntriesByPair || chordRulerEntriesByPair.length === 0 || measurePairs.length === 0) return []

  const nextSpans: PedalSpan[] = []
  chordRulerEntriesByPair.forEach((entries, pairIndex) => {
    if (scope.scope === 'segment') {
      if (pairIndex < scope.startPairIndex || pairIndex > scope.endPairIndexInclusive) return
    } else if (scope.scope === 'chord' && pairIndex !== scope.pairIndex) {
      return
    }

    const timeSignature = resolvePairTimeSignature(pairIndex, measureTimeSignaturesByMeasure)
    const beatTicks = Math.max(1, getBeatTicksByTimeSignature(timeSignature))
    const retractTicks = Math.max(1, Math.round(beatTicks * PEDAL_RETRACT_BEAT_RATIO))

    entries.forEach((entry) => {
      if (scope.scope === 'chord') {
        if (normalizeTick(entry.startTick) !== normalizeTick(scope.startTick)) return
        if (normalizeTick(entry.endTick) !== normalizeTick(scope.endTick)) return
      }

      const startTick = normalizeTick(entry.startTick)
      const rawEndTick = normalizeTick(entry.endTick)
      if (rawEndTick <= startTick) return
      const pair = measurePairs[pairIndex]
      const latestOnsetTickInRange = pair
        ? collectMeasureTickRangeNotes({
            pair,
            startTickInclusive: startTick,
            endTickExclusive: rawEndTick,
            includeRests: false,
          }).reduce<number | null>((latestTick, noteMatch) => {
            if (!Number.isFinite(noteMatch.onsetTickInMeasure)) return latestTick
            if (latestTick === null || noteMatch.onsetTickInMeasure > latestTick) {
              return noteMatch.onsetTickInMeasure
            }
            return latestTick
          }, null)
        : null
      const candidateEndTick = Math.max(startTick + 1, rawEndTick - retractTicks)
      const safeEndTick =
        latestOnsetTickInRange !== null
          ? Math.max(candidateEndTick, latestOnsetTickInRange + 1)
          : candidateEndTick
      const endTick = Math.min(rawEndTick, safeEndTick)
      if (endTick <= startTick) return

      nextSpans.push(
        normalizePedalSpan({
          id: createPedalSpanId(),
          style,
          staff: 'bass',
          startPairIndex: pairIndex,
          startTick,
          endPairIndex: pairIndex,
          endTick,
        }),
      )
    })
  })

  return sortPedalSpans(nextSpans)
}

export function getDefaultPedalApplyScope(params: {
  hasActiveChord: boolean
  hasActiveSegment: boolean
}): PedalApplyScope {
  const { hasActiveChord, hasActiveSegment } = params
  if (hasActiveChord) return 'chord'
  if (hasActiveSegment) return 'segment'
  return 'all'
}
