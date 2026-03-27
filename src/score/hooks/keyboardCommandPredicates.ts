import type { MutableRefObject } from 'react'
import type { Selection } from '../types'
import { isTextInputTarget } from './keyboardCommandShared'

export function shouldIgnoreKeyboardCommand(params: {
  event: KeyboardEvent
  isOsmdPreviewOpen: boolean
  draggingSelection: Selection | null
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
}): boolean {
  const { event, isOsmdPreviewOpen, draggingSelection, scoreScrollRef } = params

  if (isOsmdPreviewOpen) return true
  if (draggingSelection) return true
  if (isTextInputTarget(event.target)) return true

  const scrollHost = scoreScrollRef.current
  if (!scrollHost) return true
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return true
  if (!(activeElement === scrollHost || scrollHost.contains(activeElement))) return true

  return false
}

export function isUndoShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'z'
  )
}

export function isCopyShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'c'
  )
}

export function isPasteShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'v'
  )
}

export function isSelectedScopeMoveShortcut(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    (event.key === 'ArrowUp' || event.key === 'ArrowDown')
  )
}

export function isActiveSelectionMoveShortcut(event: KeyboardEvent): boolean {
  return event.key === 'ArrowUp' || event.key === 'ArrowDown'
}

export function getIntervalDegreeFromKeyboardEvent(event: KeyboardEvent): number | null {
  const digitMatch = /^Digit([2-8])$/.exec(event.code)
  if (!digitMatch) return null
  const intervalDegree = Number(digitMatch[1])
  return Number.isFinite(intervalDegree) ? intervalDegree : null
}
