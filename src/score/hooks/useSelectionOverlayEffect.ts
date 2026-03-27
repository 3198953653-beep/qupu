import { useEffect } from 'react'
import type { MeasurePair, Selection, TimeSignature } from '../types'

export function useSelectionOverlayEffect(params: {
  activeSelection: Selection
  draggingSelection: Selection | null
  drawSelectionMeasureOverlay: (selection: Selection) => void
  measurePairs: MeasurePair[]
  visibleSystemRange: { start: number; end: number }
  measureKeyFifthsFromImport: number[] | null
  measureTimeSignaturesFromImport: TimeSignature[] | null
}): void {
  const {
    activeSelection,
    draggingSelection,
    drawSelectionMeasureOverlay,
    measurePairs,
    visibleSystemRange,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
  } = params

  useEffect(() => {
    if (draggingSelection) return
    drawSelectionMeasureOverlay(activeSelection)
  }, [
    activeSelection,
    draggingSelection,
    drawSelectionMeasureOverlay,
    measurePairs,
    visibleSystemRange,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
  ])
}
