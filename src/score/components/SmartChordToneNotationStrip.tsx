import { useLayoutEffect, useRef, useState } from 'react'
import { Renderer } from 'vexflow'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import { sortPitchesByMidi, type SmartChordToneCandidate } from '../smartChordToneCandidates'
import { renderPreviewWithMainLayout } from './previewNotationAdapter'
import type { SmartChordToneDialogTarget } from '../hooks/useSmartChordToneDialogController'
import type { ScoreNote, SpacingLayoutMode } from '../types'

type CandidateSlotLayout = {
  key: string
  leftPx: number
  widthPx: number
}

const STRIP_PADDING_X_PX = 18
const STRIP_VIEWPORT_HEIGHT_PX = 160
const STRIP_RENDER_HEIGHT_PX = 120

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getCandidateOverlayLabel(candidate: SmartChordToneCandidate): string {
  return `新增和弦音 ${candidate.addedPitchesLabel}；完整和弦 ${candidate.allPitchesLabel}`
}

export function SmartChordToneNotationStrip(props: {
  target: SmartChordToneDialogTarget
  candidates: SmartChordToneCandidate[]
  selectedCandidateKey: string | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  onPreviewCandidate: (candidateKey: string) => void
  onApplyCandidate: (candidateKey: string) => void
}) {
  const {
    target,
    candidates,
    selectedCandidateKey,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    grandStaffLayoutMetrics,
    onPreviewCandidate,
    onApplyCandidate,
  } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [slotLayouts, setSlotLayouts] = useState<CandidateSlotLayout[]>([])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    if (candidates.length === 0) {
      const context = canvas.getContext('2d')
      if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height)
      }
      setSlotLayouts([])
      return undefined
    }

    const totalBeats = Math.max(1, candidates.length)
    const renderer = new Renderer(canvas, Renderer.Backends.CANVAS)
    renderer.resize(1, STRIP_RENDER_HEIGHT_PX)
    const context = renderer.getContext()
    context.clearRect(0, 0, canvas.width, STRIP_RENDER_HEIGHT_PX)

    const activeStaff = target.previewClef === 'bass' ? 'bass' : 'treble'
    const previewNotes = candidates.map<ScoreNote>((candidate, index) => ({
      id: `smart-candidate-note-${index}`,
      pitch: target.melodyPitch,
      duration: 'q',
      chordPitches: sortPitchesByMidi(candidate.addedPitches),
    }))
    let previewResult = renderPreviewWithMainLayout({
      context,
      renderHeight: STRIP_RENDER_HEIGHT_PX,
      definitions: [{
        pairIndex: 0,
        notes: previewNotes,
        clef: activeStaff,
        keyFifths: target.previewKeyFifths,
        timeSignature: { beats: totalBeats, beatType: 4 },
        showKeySignature: target.previewKeyFifths !== 0,
        showTimeSignature: false,
      }],
      paddingX: STRIP_PADDING_X_PX,
      timeAxisSpacingConfig,
      spacingLayoutMode,
      grandStaffLayoutMetrics,
    })
    if (canvas.width !== previewResult.totalWidth || canvas.height !== STRIP_RENDER_HEIGHT_PX) {
      renderer.resize(previewResult.totalWidth, STRIP_RENDER_HEIGHT_PX)
      context.clearRect(0, 0, previewResult.totalWidth, STRIP_RENDER_HEIGHT_PX)
      previewResult = renderPreviewWithMainLayout({
        context,
        renderHeight: STRIP_RENDER_HEIGHT_PX,
        definitions: [{
          pairIndex: 0,
          notes: previewNotes,
          clef: activeStaff,
          keyFifths: target.previewKeyFifths,
          timeSignature: { beats: totalBeats, beatType: 4 },
          showKeySignature: target.previewKeyFifths !== 0,
          showTimeSignature: false,
        }],
        paddingX: STRIP_PADDING_X_PX,
        timeAxisSpacingConfig,
        spacingLayoutMode,
        grandStaffLayoutMetrics,
      })
    }
    const noteCenters = previewResult.noteCentersByPair.get(0) ?? []

    const fallbackCenters = candidates.map((_, index) =>
      STRIP_PADDING_X_PX + ((index + 0.5) * Math.max(1, previewResult.measureFrames[0]?.measureWidth ?? 1)) / candidates.length)
    const slotCenters = candidates.map((_, index) => noteCenters[index] ?? fallbackCenters[index])
    const firstFrame = previewResult.measureFrames[0]
    const contentStartX = firstFrame?.measureX ?? STRIP_PADDING_X_PX
    const contentEndX =
      firstFrame
        ? firstFrame.measureX + firstFrame.measureWidth
        : STRIP_PADDING_X_PX + Math.max(1, previewResult.totalWidth - STRIP_PADDING_X_PX * 2)
    const nextLayouts = slotCenters.map((centerX, index) => {
      const leftBoundary = index === 0 ? contentStartX : (slotCenters[index - 1] + centerX) / 2
      const rightBoundary = index === slotCenters.length - 1 ? contentEndX : (centerX + slotCenters[index + 1]) / 2
      return {
        key: candidates[index]?.key ?? `candidate-${index}`,
        leftPx: clamp(leftBoundary, 0, previewResult.totalWidth),
        widthPx: Math.max(1, clamp(rightBoundary, 0, previewResult.totalWidth) - clamp(leftBoundary, 0, previewResult.totalWidth)),
      }
    })
    setSlotLayouts(nextLayouts)
    return undefined
  }, [
    candidates,
    grandStaffLayoutMetrics,
    selectedCandidateKey,
    spacingLayoutMode,
    target,
    timeAxisSpacingConfig,
  ])

  return (
    <div className="smart-chord-notation-strip">
      <div className="smart-chord-notation-scroll">
        <div className="smart-chord-notation-stage-wrap" style={{ height: `${STRIP_VIEWPORT_HEIGHT_PX}px` }}>
          <div className="smart-chord-notation-stage">
            <canvas ref={canvasRef} className="smart-chord-notation-svg" />
            <div className="smart-chord-notation-hit-layer">
              {slotLayouts.map((slotLayout, index) => {
                const candidate = candidates[index]
                if (!candidate) return null
                return (
                  <button
                    key={slotLayout.key}
                    type="button"
                    className={`smart-chord-notation-slot${selectedCandidateKey === candidate.key ? ' is-active' : ''}`}
                    style={{
                      left: `${slotLayout.leftPx}px`,
                      width: `${slotLayout.widthPx}px`,
                      top: '0px',
                      height: `${STRIP_RENDER_HEIGHT_PX}px`,
                    }}
                    onClick={() => onPreviewCandidate(candidate.key)}
                    onDoubleClick={() => onApplyCandidate(candidate.key)}
                    title={getCandidateOverlayLabel(candidate)}
                    aria-label={getCandidateOverlayLabel(candidate)}
                    aria-pressed={selectedCandidateKey === candidate.key}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
