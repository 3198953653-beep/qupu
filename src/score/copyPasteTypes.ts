import type { NoteDuration, Pitch, StaffKind } from './types'

export type NoteClipboardPayload = {
  duration: NoteDuration
  pitches: Pitch[]
  sourceStaff: StaffKind
  sourceKeyIndices: number[]
}

