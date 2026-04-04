import { useLayoutEffect, useRef, useState } from 'react'
import { Accidental, BarlineType, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveNote, Voice } from 'vexflow'
import { buildRenderedNoteKeys, getKeySignatureSpecFromFifths } from '../accidentals'
import { getDurationDots, toVexDuration } from '../layout/demand'
import { getPitchLine } from '../pitchUtils'
import { toPitchFromStepAlter } from '../pitchMath'
import type { AccompanimentRenderMeasure } from '../hooks/useAccompanimentNoteDialogController'
import type { Pitch, ScoreNote } from '../types'

type MeasureSlotLayout = {
  measureNumber: number
  candidateKey: string
  leftPx: number
  widthPx: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const STRIP_PADDING_X_PX = 18
const STRIP_RENDER_HEIGHT_PX = 140
const STRIP_VIEWPORT_HEIGHT_PX = 180
const STAVE_TOP_PX = 24
const MEASURE_WIDTH_PX = 220
const SELECTED_STYLE = { fillStyle: '#2437E8', strokeStyle: '#2437E8' } as const
const ROOT_NOTE_RE = /^([A-G])((?:##|bb|x|#|b)?)(-?\d+)$/

function centerRenderedSvgContent(svgElement: SVGSVGElement): void {
  const childNodes = Array.from(svgElement.children)
  if (childNodes.length === 0) return
  const contentGroup = document.createElementNS(SVG_NS, 'g')
  childNodes.forEach((childNode) => contentGroup.appendChild(childNode))
  svgElement.appendChild(contentGroup)

  const bbox = contentGroup.getBBox()
  if (!Number.isFinite(bbox.y) || !Number.isFinite(bbox.height) || bbox.height <= 0) return
  const offsetY = STRIP_RENDER_HEIGHT_PX / 2 - (bbox.y + bbox.height / 2)
  if (Math.abs(offsetY) < 0.1) return
  contentGroup.setAttribute('transform', `translate(0 ${offsetY})`)
}

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

function getStemDirection(pitches: Pitch[]): 1 | -1 {
  const referencePitch = pitches[pitches.length - 1] ?? 'd/3'
  return getPitchLine('bass', referencePitch) < 3 ? 1 : -1
}

function buildMeasureStaveNotes(params: {
  measure: AccompanimentRenderMeasure
  keyFifths: number
  isSelected: boolean
}): StaveNote[] {
  const { measure, keyFifths, isSelected } = params
  return measure.durationPlan.map((entry, index) => {
    const duration = toVexDuration(entry.duration)
    const dots = getDurationDots(entry.duration)
    const token = entry.token
    const parts = token
      .split('+')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    const hasRest = parts.length === 0 || parts.every((entry) => entry.toUpperCase() === 'R')
    if (hasRest) {
      const restNote = new StaveNote({
        keys: ['d/3'],
        duration: `${duration}r`,
        clef: 'bass',
      })
      if (dots > 0) {
        Dot.buildAndAttach([restNote], { all: true })
      }
      if (isSelected) restNote.setStyle(SELECTED_STYLE)
      return restNote
    }

    const pitches = parts
      .filter((entry) => entry.toUpperCase() !== 'R')
      .map((entry) => parseNoteNameToPitch(entry))
      .filter((entry): entry is Pitch => entry !== null)

    if (pitches.length === 0) {
      const restNote = new StaveNote({
        keys: ['d/3'],
        duration: `${duration}r`,
        clef: 'bass',
      })
      if (dots > 0) {
        Dot.buildAndAttach([restNote], { all: true })
      }
      if (isSelected) restNote.setStyle(SELECTED_STYLE)
      return restNote
    }

    const [rootPitch, ...chordPitches] = pitches
    const displayNote: ScoreNote = {
      id: `candidate-token-${index}`,
      pitch: rootPitch,
      duration: 'q',
      chordPitches,
    }
    const renderedKeys = buildRenderedNoteKeys(
      displayNote,
      'bass',
      rootPitch,
      chordPitches,
      keyFifths,
      null,
      null,
      null,
      getPitchLine,
    )
    const staveNote = new StaveNote({
      keys: renderedKeys.map((entry) => entry.pitch),
      duration,
      clef: 'bass',
      stemDirection: getStemDirection(pitches),
    })
    if (dots > 0) {
      Dot.buildAndAttach([staveNote], { all: true })
    }
    renderedKeys.forEach((entry, keyIndex) => {
      if (!entry.accidental) return
      const accidental = new Accidental(entry.accidental)
      if (isSelected) accidental.setStyle(SELECTED_STYLE)
      staveNote.addModifier(accidental, keyIndex)
    })
    if (isSelected) staveNote.setStyle(SELECTED_STYLE)
    return staveNote
  })
}

export function AccompanimentNoteNotationStrip(props: {
  measures: AccompanimentRenderMeasure[]
  selectedCandidateKey: string | null
  onPreviewByMeasure: (measureNumber: number) => void
  onApplyByMeasure: (measureNumber: number) => void
}) {
  const { measures, selectedCandidateKey, onPreviewByMeasure, onApplyByMeasure } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [slots, setSlots] = useState<MeasureSlotLayout[]>([])

  useLayoutEffect(() => {
    const hostElement = hostRef.current
    if (!hostElement) return undefined
    hostElement.replaceChildren()
    if (measures.length === 0) {
      setSlots([])
      return undefined
    }

    const totalWidth = STRIP_PADDING_X_PX * 2 + measures.length * MEASURE_WIDTH_PX
    const renderer = new Renderer(hostElement, Renderer.Backends.SVG)
    renderer.resize(totalWidth, STRIP_RENDER_HEIGHT_PX)
    const context = renderer.getContext()

    const nextSlots: MeasureSlotLayout[] = []
    measures.forEach((measure, index) => {
      const x = STRIP_PADDING_X_PX + index * MEASURE_WIDTH_PX
      const stave = new Stave(x, STAVE_TOP_PX, MEASURE_WIDTH_PX)
      if (index === 0) {
        stave.addClef('bass')
        if (measure.keyFifths !== 0) {
          stave.addKeySignature(getKeySignatureSpecFromFifths(measure.keyFifths))
        }
      }
      stave.setBegBarType(index === 0 ? BarlineType.SINGLE : BarlineType.SINGLE)
      stave.setEndBarType(index === measures.length - 1 ? BarlineType.END : BarlineType.SINGLE)
      stave.setContext(context).draw()

      const staveNotes = buildMeasureStaveNotes({
        measure,
        keyFifths: measure.keyFifths,
        isSelected: selectedCandidateKey === measure.candidateKey,
      })
      if (staveNotes.length > 0) {
        const voice = new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false).addTickables(staveNotes)
        new Formatter().joinVoices([voice]).format([voice], Math.max(1, stave.getNoteEndX() - stave.getNoteStartX()))
        const beams = Beam.generateBeams(staveNotes, {
          groups: [new Fraction(1, 4)],
        })
        voice.draw(context, stave)
        beams.forEach((beam) => {
          beam.setContext(context).draw()
        })
      }

      nextSlots.push({
        measureNumber: measure.measureNumber,
        candidateKey: measure.candidateKey,
        leftPx: x,
        widthPx: MEASURE_WIDTH_PX,
      })
    })

    const svgElement = hostElement.querySelector('svg')
    if (svgElement instanceof SVGSVGElement) {
      centerRenderedSvgContent(svgElement)
      svgElement.setAttribute('aria-hidden', 'true')
    }
    setSlots(nextSlots)
    return undefined
  }, [measures, selectedCandidateKey])

  return (
    <div className="smart-chord-notation-strip">
      <div className="smart-chord-notation-scroll">
        <div className="smart-chord-notation-stage-wrap" style={{ height: `${STRIP_VIEWPORT_HEIGHT_PX}px` }}>
          <div className="smart-chord-notation-stage">
            <div ref={hostRef} className="smart-chord-notation-svg" />
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
