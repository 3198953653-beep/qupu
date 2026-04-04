import { useLayoutEffect, useRef, useState } from 'react'
import { Renderer } from 'vexflow'
import type { GrandStaffLayoutMetrics } from '../grandStaffLayout'
import type { TimeAxisSpacingConfig } from '../layout/timeAxisSpacing'
import { toPitchFromStepAlter } from '../pitchMath'
import { renderPreviewWithMainLayout } from './previewNotationAdapter'
import type { AccompanimentRenderMeasure } from '../hooks/useAccompanimentNoteDialogController'
import type { Pitch, ScoreNote, SpacingLayoutMode } from '../types'

type MeasureSlotLayout = {
  measureNumber: number
  candidateKey: string
  leftPx: number
  widthPx: number
}

const STRIP_PADDING_X_PX = 18
const STRIP_RENDER_HEIGHT_PX = 140
const STRIP_VIEWPORT_HEIGHT_PX = 180
const ROOT_NOTE_RE = /^([A-G])((?:##|bb|x|#|b)?)(-?\d+)$/

function parseNoteNameToPitch(name: string): Pitch | null {
  const match = ROOT_NOTE_RE.exec(String(name ?? '').trim())
  if (!match) return null
  const step = match[1]?.toUpperCase() ?? 'C'
  const accidentalText = (match[2] ?? '').replace('x', '##')
  const octave = Number(match[3])
  if (!Number.isFinite(octave)) return null
  const alter = (accidentalText.match(/#/g)?.length ?? 0) - (accidentalText.match(/b/g)?.length ?? 0)
  return toPitchFromStepAlter(step, alter, Math.trunc(octave))
}

function buildAccompanimentMeasureNotes(measure: AccompanimentRenderMeasure): ScoreNote[] {
  return measure.durationPlan.map((entry, index) => {
    const parts = entry.token
      .split('+')
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.toUpperCase() !== 'R')
    const pitches = parts
      .map((item) => parseNoteNameToPitch(item))
      .filter((item): item is Pitch => item !== null)
    if (pitches.length === 0) {
      return {
        id: `accomp-preview-note-${measure.measureNumber}-${index}`,
        pitch: 'd/3',
        duration: entry.duration,
        isRest: true,
      }
    }
    const [pitch, ...chordPitches] = pitches
    return {
      id: `accomp-preview-note-${measure.measureNumber}-${index}`,
      pitch,
      duration: entry.duration,
      chordPitches: chordPitches.length > 0 ? chordPitches : undefined,
    }
  })
}

export function AccompanimentNoteNotationStrip(props: {
  measures: AccompanimentRenderMeasure[]
  selectedCandidateKey: string | null
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
  onPreviewByMeasure: (measureNumber: number) => void
  onApplyByMeasure: (measureNumber: number) => void
}) {
  const {
    measures,
    selectedCandidateKey,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    grandStaffLayoutMetrics,
    onPreviewByMeasure,
    onApplyByMeasure,
  } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [slots, setSlots] = useState<MeasureSlotLayout[]>([])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    if (measures.length === 0) {
      const context = canvas.getContext('2d')
      if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height)
      }
      setSlots([])
      return undefined
    }

    const renderer = new Renderer(canvas, Renderer.Backends.CANVAS)
    renderer.resize(1, STRIP_RENDER_HEIGHT_PX)
    const context = renderer.getContext()
    context.clearRect(0, 0, canvas.width, STRIP_RENDER_HEIGHT_PX)

    const definitions = measures.map((measure, index) => {
      const bassNotes = buildAccompanimentMeasureNotes(measure)
      return {
        pairIndex: index,
        notes: bassNotes,
        clef: 'bass' as const,
        keyFifths: measure.keyFifths,
        timeSignature: { beats: 4, beatType: 4 },
        showKeySignature: index === 0 && measure.keyFifths !== 0,
        showTimeSignature: false,
      }
    })

    let previewResult = renderPreviewWithMainLayout({
      context,
      renderHeight: STRIP_RENDER_HEIGHT_PX,
      definitions,
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
        definitions,
        paddingX: STRIP_PADDING_X_PX,
        timeAxisSpacingConfig,
        spacingLayoutMode,
        grandStaffLayoutMetrics,
      })
    }

    const nextSlots: MeasureSlotLayout[] = measures.map((measure, index) => {
      const frame = previewResult.measureFrames[index]
      return {
        measureNumber: measure.measureNumber,
        candidateKey: measure.candidateKey,
        leftPx: frame?.measureX ?? STRIP_PADDING_X_PX,
        widthPx: Math.max(1, frame?.measureWidth ?? 1),
      }
    })

    setSlots(nextSlots)
    return undefined
  }, [
    grandStaffLayoutMetrics,
    measures,
    selectedCandidateKey,
    spacingLayoutMode,
    timeAxisSpacingConfig,
  ])

  return (
    <div className="smart-chord-notation-strip">
      <div className="smart-chord-notation-scroll">
        <div className="smart-chord-notation-stage-wrap" style={{ height: `${STRIP_VIEWPORT_HEIGHT_PX}px` }}>
          <div className="smart-chord-notation-stage">
            <canvas ref={canvasRef} className="smart-chord-notation-svg" />
            <div className="smart-chord-notation-hit-layer">
              {slots.map((slot) => (
                <button
                  key={slot.candidateKey}
                  type="button"
                  className={`smart-chord-notation-slot${selectedCandidateKey === slot.candidateKey ? ' is-active' : ''}`}
                  style={{
                    left: `${slot.leftPx}px`,
                    width: `${slot.widthPx}px`,
                    top: '0px',
                    height: `${STRIP_RENDER_HEIGHT_PX}px`,
                  }}
                  onClick={() => onPreviewByMeasure(slot.measureNumber)}
                  onDoubleClick={() => onApplyByMeasure(slot.measureNumber)}
                  title={`候选 ${slot.measureNumber}`}
                  aria-label={`候选小节 ${slot.measureNumber}`}
                  aria-pressed={selectedCandidateKey === slot.candidateKey}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
