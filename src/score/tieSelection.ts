import type { TieEndpoint, TieSelection } from './types'

function compareTieEndpoints(left: TieEndpoint, right: TieEndpoint): number {
  if (left.pairIndex !== right.pairIndex) return left.pairIndex - right.pairIndex
  if (left.noteIndex !== right.noteIndex) return left.noteIndex - right.noteIndex
  if (left.staff !== right.staff) return left.staff.localeCompare(right.staff)
  if (left.noteId !== right.noteId) return left.noteId.localeCompare(right.noteId)
  if (left.keyIndex !== right.keyIndex) return left.keyIndex - right.keyIndex
  return left.tieType.localeCompare(right.tieType)
}

export function getTieEndpointIdentity(endpoint: TieEndpoint): string {
  return [
    endpoint.pairIndex,
    endpoint.noteIndex,
    endpoint.staff,
    endpoint.noteId,
    endpoint.keyIndex,
    endpoint.tieType,
  ].join('|')
}

export function normalizeTieEndpoints(endpoints: TieEndpoint[]): TieEndpoint[] {
  const uniqueByIdentity = new Map<string, TieEndpoint>()
  endpoints.forEach((endpoint) => {
    uniqueByIdentity.set(getTieEndpointIdentity(endpoint), { ...endpoint })
  })
  return [...uniqueByIdentity.values()].sort(compareTieEndpoints)
}

export function buildTieSegmentKey(endpoints: TieEndpoint[]): string {
  const normalized = normalizeTieEndpoints(endpoints)
  return normalized.map(getTieEndpointIdentity).join('->')
}

export function buildTieSelection(endpoints: TieEndpoint[]): TieSelection {
  const normalized = normalizeTieEndpoints(endpoints)
  return {
    key: normalized.map(getTieEndpointIdentity).join('->'),
    endpoints: normalized,
  }
}

export function cloneTieSelection(selection: TieSelection): TieSelection {
  return {
    key: selection.key,
    endpoints: selection.endpoints.map((endpoint) => ({ ...endpoint })),
  }
}
