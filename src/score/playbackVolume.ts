import type { StaffKind } from './types'

export const DEFAULT_PLAYBACK_VOLUME_PERCENT = 100
export const MIN_PLAYBACK_VOLUME_PERCENT = 0
export const MAX_PLAYBACK_VOLUME_PERCENT = 150
export const PLAYBACK_VOLUME_STEP = 1

export const PLAYBACK_VELOCITY_BY_STAFF = {
  treble: 0.92,
  bass: 0.72,
} as const satisfies Record<StaffKind, number>

export function clampPlaybackVolumePercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAYBACK_VOLUME_PERCENT
  return Math.max(
    MIN_PLAYBACK_VOLUME_PERCENT,
    Math.min(MAX_PLAYBACK_VOLUME_PERCENT, Math.round(value)),
  )
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function resolvePlaybackVelocityForStaff(params: {
  staff: StaffKind
  volumePercent: number
}): {
  baseVelocity: number
  resolvedVelocity: number
} {
  const { staff, volumePercent } = params
  const baseVelocity = PLAYBACK_VELOCITY_BY_STAFF[staff]
  const resolvedVelocity = clampUnitInterval(baseVelocity * (clampPlaybackVolumePercent(volumePercent) / 100))

  return {
    baseVelocity,
    resolvedVelocity,
  }
}
