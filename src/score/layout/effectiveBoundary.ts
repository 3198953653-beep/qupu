import type { EffectiveMeasureBoundary } from '../types'

type ResolveEffectiveBoundaryParams = {
  measureX: number
  measureWidth: number
  noteStartX: number
  noteEndX: number
  showStartDecorations: boolean
  showEndDecorations: boolean
}

function finiteOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

export function resolveEffectiveBoundary(params: ResolveEffectiveBoundaryParams): EffectiveMeasureBoundary {
  const measureStartBarX = finiteOrFallback(params.measureX, 0)
  const safeMeasureWidth = Math.max(1, finiteOrFallback(params.measureWidth, 1))
  const measureEndBarX = measureStartBarX + safeMeasureWidth

  const rawStart = params.showStartDecorations
    ? finiteOrFallback(params.noteStartX, measureStartBarX)
    : measureStartBarX
  const rawEnd = params.showEndDecorations
    ? finiteOrFallback(params.noteEndX, measureEndBarX)
    : measureEndBarX

  const effectiveStartX = Math.max(measureStartBarX, Math.min(rawStart, measureEndBarX))
  const effectiveEndX = Math.min(measureEndBarX, Math.max(rawEnd, measureStartBarX))

  if (effectiveEndX >= effectiveStartX) {
    return {
      measureStartBarX,
      measureEndBarX,
      effectiveStartX,
      effectiveEndX,
    }
  }

  return {
    measureStartBarX,
    measureEndBarX,
    effectiveStartX: measureStartBarX,
    effectiveEndX: measureEndBarX,
  }
}
