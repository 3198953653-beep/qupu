import {
  shouldIgnoreKeyboardCommand,
} from './keyboardCommandPredicates'
import {
  handleDeleteKeyboardCommand,
  handleGlobalKeyboardCommand,
  handleIntervalKeyboardCommand,
  handleSelectionKeyboardCommand,
} from './keyboardCommandRouting'
import type { KeyboardCommandEventParams, KeyboardCommandResult } from './keyboardCommandTypes'

function finishKeyboardCommand(event: KeyboardEvent, result: KeyboardCommandResult): boolean {
  if (result === 'not-handled') return false
  if (result === 'handled-prevent-default') {
    event.preventDefault()
  }
  return true
}

export function handleKeyboardCommandEvent(params: KeyboardCommandEventParams) {
  const { event, isOsmdPreviewOpen, draggingSelection, scoreScrollRef, isSelectionVisible } = params

  if (shouldIgnoreKeyboardCommand({
    event,
    isOsmdPreviewOpen,
    draggingSelection,
    scoreScrollRef,
  })) {
    return
  }

  if (finishKeyboardCommand(event, handleGlobalKeyboardCommand(params))) {
    return
  }

  if (finishKeyboardCommand(event, handleDeleteKeyboardCommand(params))) {
    return
  }

  if (!isSelectionVisible) return

  if (finishKeyboardCommand(event, handleSelectionKeyboardCommand(params))) {
    return
  }

  if (event.metaKey || event.ctrlKey || event.altKey) return

  finishKeyboardCommand(event, handleIntervalKeyboardCommand(params))
}
