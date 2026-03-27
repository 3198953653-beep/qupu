import { useCallback, useRef, type MutableRefObject } from 'react'
import {
  escapeCssId,
  type OsmdPreviewSelectionTarget,
} from './osmdPreviewUtils'

export function useOsmdPreviewNoteHighlight(params: {
  osmdPreviewContainerRef: MutableRefObject<HTMLDivElement | null>
}) {
  const { osmdPreviewContainerRef } = params
  const osmdPreviewSelectedSelectionKeyRef = useRef<string | null>(null)

  const clearOsmdPreviewNoteHighlight = useCallback(() => {
    const container = osmdPreviewContainerRef.current
    if (!container) return
    container.querySelectorAll('.osmd-preview-note-selected').forEach((node) => {
      node.classList.remove('osmd-preview-note-selected')
    })
  }, [osmdPreviewContainerRef])

  const applyOsmdPreviewNoteHighlight = useCallback((target: OsmdPreviewSelectionTarget | null) => {
    clearOsmdPreviewNoteHighlight()
    if (!target) return
    const container = osmdPreviewContainerRef.current
    if (!container) return
    for (const domId of target.domIds) {
      const targetNode = container.querySelector(`#${escapeCssId(domId)}`)
      if (!targetNode) continue
      targetNode.classList.add('osmd-preview-note-selected')
      return
    }
  }, [clearOsmdPreviewNoteHighlight, osmdPreviewContainerRef])

  return {
    osmdPreviewSelectedSelectionKeyRef,
    clearOsmdPreviewNoteHighlight,
    applyOsmdPreviewNoteHighlight,
  }
}
