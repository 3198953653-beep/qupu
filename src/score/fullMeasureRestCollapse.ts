import type { MeasurePair, Selection } from './types'

export type MeasureStaffScope = {
  pairIndex: number
  staff: Selection['staff']
}

export function toMeasureStaffScopeKey(scope: MeasureStaffScope): string {
  return `${Math.trunc(scope.pairIndex)}:${scope.staff}`
}

function parseMeasureStaffScopeKey(key: string): MeasureStaffScope | null {
  if (!key) return null
  const [rawPairIndex, rawStaff] = key.split(':')
  if (rawStaff !== 'treble' && rawStaff !== 'bass') return null
  const pairIndex = Number(rawPairIndex)
  if (!Number.isFinite(pairIndex)) return null
  return {
    pairIndex: Math.trunc(pairIndex),
    staff: rawStaff,
  }
}

function sortMeasureStaffScopeKeys(keys: Iterable<string>): string[] {
  const scopes: MeasureStaffScope[] = []
  const deduped = new Set<string>()
  for (const key of keys) {
    const parsed = parseMeasureStaffScopeKey(key)
    if (!parsed || parsed.pairIndex < 0) continue
    const normalized = toMeasureStaffScopeKey(parsed)
    if (deduped.has(normalized)) continue
    deduped.add(normalized)
    scopes.push(parsed)
  }
  scopes.sort((left, right) => {
    if (left.pairIndex !== right.pairIndex) return left.pairIndex - right.pairIndex
    if (left.staff === right.staff) return 0
    return left.staff === 'treble' ? -1 : 1
  })
  return scopes.map((scope) => toMeasureStaffScopeKey(scope))
}

function collectChangedMeasureStaffScopeKeys(sourcePairs: MeasurePair[], nextPairs: MeasurePair[]): Set<string> {
  const changed = new Set<string>()
  const pairCount = Math.max(sourcePairs.length, nextPairs.length)
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const sourcePair = sourcePairs[pairIndex]
    const nextPair = nextPairs[pairIndex]
    if (!sourcePair || !nextPair) {
      changed.add(toMeasureStaffScopeKey({ pairIndex, staff: 'treble' }))
      changed.add(toMeasureStaffScopeKey({ pairIndex, staff: 'bass' }))
      continue
    }
    if (sourcePair.treble !== nextPair.treble) {
      changed.add(toMeasureStaffScopeKey({ pairIndex, staff: 'treble' }))
    }
    if (sourcePair.bass !== nextPair.bass) {
      changed.add(toMeasureStaffScopeKey({ pairIndex, staff: 'bass' }))
    }
  }
  return changed
}

export function mergeFullMeasureRestCollapseScopeKeys(params: {
  currentScopeKeys: string[]
  sourcePairs: MeasurePair[]
  nextPairs: MeasurePair[]
  collapseScopesToAdd?: MeasureStaffScope[]
}): string[] {
  const {
    currentScopeKeys,
    sourcePairs,
    nextPairs,
    collapseScopesToAdd = [],
  } = params
  const nextScopeKeys = new Set<string>()
  const changedScopeKeys = collectChangedMeasureStaffScopeKeys(sourcePairs, nextPairs)
  const maxPairIndex = nextPairs.length - 1

  currentScopeKeys.forEach((scopeKey) => {
    const parsed = parseMeasureStaffScopeKey(scopeKey)
    if (!parsed) return
    if (parsed.pairIndex < 0 || parsed.pairIndex > maxPairIndex) return
    const normalized = toMeasureStaffScopeKey(parsed)
    if (changedScopeKeys.has(normalized)) return
    nextScopeKeys.add(normalized)
  })

  collapseScopesToAdd.forEach((scope) => {
    const normalized: MeasureStaffScope = {
      pairIndex: Math.trunc(scope.pairIndex),
      staff: scope.staff,
    }
    if (!Number.isFinite(normalized.pairIndex)) return
    if (normalized.pairIndex < 0 || normalized.pairIndex > maxPairIndex) return
    if (normalized.staff !== 'treble' && normalized.staff !== 'bass') return
    nextScopeKeys.add(toMeasureStaffScopeKey(normalized))
  })

  return sortMeasureStaffScopeKeys(nextScopeKeys)
}
