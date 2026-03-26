import { useEffect, useMemo, type MutableRefObject } from 'react'
import { useMidiInputController } from './useMidiInputController'
import { useNotationPaletteController } from './useNotationPaletteController'
import { useScoreSelectionController } from './useScoreSelectionController'
import {
  useEditorPreferencePersistence,
} from './useEditorPreferencePersistence'
import { useOsmdPreviewController } from './useOsmdPreviewController'
import { useKeyboardCommandController } from './useKeyboardCommandController'
import { toSequencePreview } from '../scorePresentation'
import type { ImportFeedback, ScoreNote } from '../types'

type NotationPaletteControllerBaseParams = Omit<
  Parameters<typeof useNotationPaletteController>[0],
  'currentSelection'
>

type KeyboardCommandControllerBaseParams = Omit<
  Parameters<typeof useKeyboardCommandController>[0],
  'isOsmdPreviewOpen'
>

export function useScoreEditorUiController(params: {
  notes: ScoreNote[]
  bassNotes: ScoreNote[]
  importFeedback: ImportFeedback
  selectionController: Parameters<typeof useScoreSelectionController>[0]
  editorPreferencePersistence: Parameters<typeof useEditorPreferencePersistence>[0]
  midiInputController: Parameters<typeof useMidiInputController>[0]
  osmdPreviewController: Parameters<typeof useOsmdPreviewController>[0]
  isOsmdPreviewOpenRef: MutableRefObject<boolean>
  notationPaletteController: NotationPaletteControllerBaseParams
  keyboardCommandController: KeyboardCommandControllerBaseParams
}) {
  const {
    notes,
    bassNotes,
    importFeedback,
    selectionController,
    editorPreferencePersistence,
    midiInputController,
    osmdPreviewController,
    isOsmdPreviewOpenRef,
    notationPaletteController,
    keyboardCommandController,
  } = params

  const trebleSequenceText = useMemo(() => toSequencePreview(notes), [notes])
  const bassSequenceText = useMemo(() => toSequencePreview(bassNotes), [bassNotes])
  const isImportLoading = importFeedback.kind === 'loading'
  const importProgressPercent =
    typeof importFeedback.progress === 'number'
      ? Math.max(0, Math.min(100, importFeedback.progress))
      : null

  const selection = useScoreSelectionController(selectionController)

  useEditorPreferencePersistence(editorPreferencePersistence)

  const midi = useMidiInputController(midiInputController)
  const midiSupported = midi.midiPermissionState !== 'unsupported'

  const osmd = useOsmdPreviewController(osmdPreviewController)

  useEffect(() => {
    isOsmdPreviewOpenRef.current = osmd.isOsmdPreviewOpen
  }, [isOsmdPreviewOpenRef, osmd.isOsmdPreviewOpen])

  const notation = useNotationPaletteController({
    ...notationPaletteController,
    currentSelection: selection.currentSelection,
  })

  useKeyboardCommandController({
    ...keyboardCommandController,
    isOsmdPreviewOpen: osmd.isOsmdPreviewOpen,
  })

  return {
    trebleSequenceText,
    bassSequenceText,
    isImportLoading,
    importProgressPercent,
    midiSupported,
    ...selection,
    ...midi,
    ...osmd,
    ...notation,
  }
}
