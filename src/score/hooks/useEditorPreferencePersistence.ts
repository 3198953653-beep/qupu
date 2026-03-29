import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { DEFAULT_STAFF_INTER_GAP_PX, clampStaffInterGapPx } from '../grandStaffLayout'

const LOCAL_STORAGE_EDITOR_MEASURE_NUMBER_KEY = 'score.editor.showInScoreMeasureNumbers'
const LOCAL_STORAGE_NOTEHEAD_JIANPU_DISPLAY_KEY = 'score.editor.showNoteHeadJianpu'
const LOCAL_STORAGE_PLAYHEAD_FOLLOW_KEY = 'score.playhead.followEnabled'
const LOCAL_STORAGE_CHORD_DEGREE_DISPLAY_KEY = 'score.chordDegree.enabled'
const LOCAL_STORAGE_CHORD_MARKER_BACKGROUND_KEY = 'score.chordMarkerBackground.enabled'
const LOCAL_STORAGE_STAFF_INTER_GAP_KEY = 'score.staffInterGapPx'

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const storedValue = window.localStorage.getItem(key)
  if (storedValue === '1' || storedValue === 'true') return true
  if (storedValue === '0' || storedValue === 'false') return false
  return fallback
}

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  const storedValue = window.localStorage.getItem(key)
  if (storedValue === null) return fallback
  const parsed = Number(storedValue)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getInitialPlayheadFollowEnabled(): boolean {
  return readStoredBoolean(LOCAL_STORAGE_PLAYHEAD_FOLLOW_KEY, true)
}

export function getInitialChordDegreeDisplayEnabled(): boolean {
  return readStoredBoolean(LOCAL_STORAGE_CHORD_DEGREE_DISPLAY_KEY, false)
}

export function getInitialChordMarkerBackgroundEnabled(): boolean {
  return readStoredBoolean(LOCAL_STORAGE_CHORD_MARKER_BACKGROUND_KEY, true)
}

export function getInitialStaffInterGapPx(): number {
  return clampStaffInterGapPx(readStoredNumber(LOCAL_STORAGE_STAFF_INTER_GAP_KEY, DEFAULT_STAFF_INTER_GAP_PX))
}

export function useEditorPreferencePersistence(params: {
  playheadFollowEnabled: boolean
  showChordDegreeEnabled: boolean
  showChordMarkerBackgroundEnabled: boolean
  staffInterGapPx: number
  showInScoreMeasureNumbers: boolean
  setShowInScoreMeasureNumbers: Dispatch<SetStateAction<boolean>>
  showNoteHeadJianpuEnabled: boolean
  setShowNoteHeadJianpuEnabled: Dispatch<SetStateAction<boolean>>
}): void {
  const {
    playheadFollowEnabled,
    showChordDegreeEnabled,
    showChordMarkerBackgroundEnabled,
    staffInterGapPx,
    showInScoreMeasureNumbers,
    setShowInScoreMeasureNumbers,
    showNoteHeadJianpuEnabled,
    setShowNoteHeadJianpuEnabled,
  } = params

  const playheadFollowHydratedRef = useRef(false)
  const chordDegreeDisplayHydratedRef = useRef(false)
  const chordMarkerBackgroundHydratedRef = useRef(false)
  const staffInterGapHydratedRef = useRef(false)
  const showInScoreMeasureNumbersHydratedRef = useRef(false)
  const showNoteHeadJianpuHydratedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    playheadFollowHydratedRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!playheadFollowHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_PLAYHEAD_FOLLOW_KEY,
      playheadFollowEnabled ? '1' : '0',
    )
  }, [playheadFollowEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    chordDegreeDisplayHydratedRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!chordDegreeDisplayHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_CHORD_DEGREE_DISPLAY_KEY,
      showChordDegreeEnabled ? '1' : '0',
    )
  }, [showChordDegreeEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    chordMarkerBackgroundHydratedRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!chordMarkerBackgroundHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_CHORD_MARKER_BACKGROUND_KEY,
      showChordMarkerBackgroundEnabled ? '1' : '0',
    )
  }, [showChordMarkerBackgroundEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    staffInterGapHydratedRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!staffInterGapHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_STAFF_INTER_GAP_KEY,
      String(clampStaffInterGapPx(staffInterGapPx)),
    )
  }, [staffInterGapPx])

  useEffect(() => {
    if (typeof window === 'undefined') {
      showInScoreMeasureNumbersHydratedRef.current = true
      return
    }
    setShowInScoreMeasureNumbers(readStoredBoolean(LOCAL_STORAGE_EDITOR_MEASURE_NUMBER_KEY, false))
    showInScoreMeasureNumbersHydratedRef.current = true
  }, [setShowInScoreMeasureNumbers])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!showInScoreMeasureNumbersHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_EDITOR_MEASURE_NUMBER_KEY,
      showInScoreMeasureNumbers ? '1' : '0',
    )
  }, [showInScoreMeasureNumbers])

  useEffect(() => {
    if (typeof window === 'undefined') {
      showNoteHeadJianpuHydratedRef.current = true
      return
    }
    setShowNoteHeadJianpuEnabled(readStoredBoolean(LOCAL_STORAGE_NOTEHEAD_JIANPU_DISPLAY_KEY, false))
    showNoteHeadJianpuHydratedRef.current = true
  }, [setShowNoteHeadJianpuEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!showNoteHeadJianpuHydratedRef.current) return
    window.localStorage.setItem(
      LOCAL_STORAGE_NOTEHEAD_JIANPU_DISPLAY_KEY,
      showNoteHeadJianpuEnabled ? '1' : '0',
    )
  }, [showNoteHeadJianpuEnabled])
}
