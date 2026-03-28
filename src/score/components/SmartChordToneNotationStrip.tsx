import { useLayoutEffect, useRef, useState } from 'react'
import { Accidental, BarlineType, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow'
import { buildRenderedNoteKeys, getKeySignatureSpecFromFifths } from '../accidentals'
import { getPitchLine } from '../pitchUtils'
import { sortPitchesByMidi, type SmartChordToneCandidate } from '../smartChordToneCandidates'
import type { SmartChordToneDialogTarget } from '../hooks/useSmartChordToneDialogController'
import type { Pitch, ScoreNote } from '../types'

type CandidateSlotLayout = {
  key: string
  leftPx: number
  widthPx: number
}

const PROBE_STAVE_WIDTH_PX = 240
const STRIP_PADDING_X_PX = 18
const STRIP_VIEWPORT_HEIGHT_PX = 160
const STRIP_RENDER_HEIGHT_PX = 120
const CANDIDATE_SLOT_WIDTH_PX = 88
const MIN_CONTENT_WIDTH_PX = 160
const CONTENT_SIDE_PADDING_PX = 10
const STAVE_BODY_HEIGHT_PX = 40
const SELECTED_CANDIDATE_STYLE = {
  fillStyle: '#2437E8',
  strokeStyle: '#2437E8',
} as const
const SVG_NS = 'http://www.w3.org/2000/svg'

type StyleableStaveNote = StaveNote & {
  setStemStyle?: (style: typeof SELECTED_CANDIDATE_STYLE) => StaveNote
  setFlagStyle?: (style: typeof SELECTED_CANDIDATE_STYLE) => StaveNote
  setLedgerLineStyle?: (style: typeof SELECTED_CANDIDATE_STYLE) => StaveNote
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getStaveTopPx(): number {
  return Math.max(0, Math.round((STRIP_RENDER_HEIGHT_PX - STAVE_BODY_HEIGHT_PX) / 2))
}

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

function getStemDirection(clef: SmartChordToneDialogTarget['previewClef'], pitch: Pitch): 1 | -1 {
  return getPitchLine(clef, pitch) < 3 ? 1 : -1
}

function getCandidateOverlayLabel(candidate: SmartChordToneCandidate): string {
  return `新增和弦音 ${candidate.addedPitchesLabel}；完整和弦 ${candidate.allPitchesLabel}`
}

function buildCandidateStaveNote(params: {
  candidate: SmartChordToneCandidate
  target: SmartChordToneDialogTarget
  isSelected: boolean
}): StaveNote {
  const { candidate, target, isSelected } = params
  const chordPitches = sortPitchesByMidi(candidate.addedPitches)
  const allPitches = sortPitchesByMidi(candidate.allPitches)
  const displayNote: ScoreNote = {
    id: candidate.key,
    pitch: target.melodyPitch,
    duration: 'q',
    chordPitches,
  }
  const forceAccidentalFromPitchKeyIndices = new Set<number>([
    0,
    ...chordPitches.map((_, index) => index + 1),
  ])
  const renderedKeys = buildRenderedNoteKeys(
    displayNote,
    target.previewClef,
    displayNote.pitch,
    displayNote.chordPitches,
    target.previewKeyFifths,
    null,
    forceAccidentalFromPitchKeyIndices,
    null,
    getPitchLine,
  )
  const stemReferencePitch = allPitches[allPitches.length - 1] ?? target.melodyPitch
  const vexNote = new StaveNote({
    keys: renderedKeys.map((entry) => entry.pitch),
    duration: 'q',
    clef: target.previewClef,
    stemDirection: getStemDirection(target.previewClef, stemReferencePitch),
  })

  renderedKeys.forEach((entry, keyIndex) => {
    if (!entry.accidental) return
    const accidental = new Accidental(entry.accidental)
    if (isSelected) {
      accidental.setStyle(SELECTED_CANDIDATE_STYLE)
    }
    vexNote.addModifier(accidental, keyIndex)
  })

  if (isSelected) {
    vexNote.setStyle(SELECTED_CANDIDATE_STYLE)
    renderedKeys.forEach((_, keyIndex) => {
      vexNote.setKeyStyle(keyIndex, SELECTED_CANDIDATE_STYLE)
    })
    const styleableNote = vexNote as StyleableStaveNote
    styleableNote.setStemStyle?.(SELECTED_CANDIDATE_STYLE)
    styleableNote.setFlagStyle?.(SELECTED_CANDIDATE_STYLE)
    styleableNote.setLedgerLineStyle?.(SELECTED_CANDIDATE_STYLE)
  }

  return vexNote
}

function measureStartDecorationWidth(target: SmartChordToneDialogTarget): number {
  const probeStave = new Stave(0, 0, PROBE_STAVE_WIDTH_PX)
  probeStave.setBegBarType(BarlineType.NONE)
  probeStave.setEndBarType(BarlineType.NONE)
  probeStave.addClef(target.previewClef)
  if (target.previewKeyFifths !== 0) {
    probeStave.addKeySignature(getKeySignatureSpecFromFifths(target.previewKeyFifths))
  }
  return Math.max(0, probeStave.getNoteStartX())
}

export function SmartChordToneNotationStrip(props: {
  target: SmartChordToneDialogTarget
  candidates: SmartChordToneCandidate[]
  selectedCandidateKey: string | null
  onPreviewCandidate: (candidateKey: string) => void
  onApplyCandidate: (candidateKey: string) => void
}) {
  const {
    target,
    candidates,
    selectedCandidateKey,
    onPreviewCandidate,
    onApplyCandidate,
  } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [slotLayouts, setSlotLayouts] = useState<CandidateSlotLayout[]>([])

  useLayoutEffect(() => {
    const hostElement = hostRef.current
    if (!hostElement) return undefined
    hostElement.replaceChildren()
    if (candidates.length === 0) {
      setSlotLayouts([])
      return undefined
    }

    const startDecorationWidth = measureStartDecorationWidth(target)
    const roughContentWidth = Math.max(MIN_CONTENT_WIDTH_PX, candidates.length * CANDIDATE_SLOT_WIDTH_PX)
    const staveWidth = startDecorationWidth + roughContentWidth + CONTENT_SIDE_PADDING_PX * 2
    const totalWidth = staveWidth + STRIP_PADDING_X_PX * 2
    const staveTopPx = getStaveTopPx()

    const renderer = new Renderer(hostElement, Renderer.Backends.SVG)
    renderer.resize(totalWidth, STRIP_RENDER_HEIGHT_PX)
    const context = renderer.getContext()

    const stave = new Stave(STRIP_PADDING_X_PX, staveTopPx, staveWidth)
    stave.setBegBarType(BarlineType.NONE)
    stave.setEndBarType(BarlineType.NONE)
    stave.addClef(target.previewClef)
    if (target.previewKeyFifths !== 0) {
      stave.addKeySignature(getKeySignatureSpecFromFifths(target.previewKeyFifths))
    }
    stave.setContext(context).draw()

    const vexNotes = candidates.map((candidate) =>
      buildCandidateStaveNote({
        candidate,
        target,
        isSelected: candidate.key === selectedCandidateKey,
      }),
    )
    vexNotes.forEach((note) => note.setStave(stave))

    const voice = new Voice({
      numBeats: Math.max(1, candidates.length),
      beatValue: 4,
    }).addTickables(vexNotes)

    const measuredMinWidth = Math.ceil(new Formatter().joinVoices([voice]).preCalculateMinTotalWidth([voice]))
    const contentWidth = Math.max(
      MIN_CONTENT_WIDTH_PX,
      candidates.length * CANDIDATE_SLOT_WIDTH_PX,
      measuredMinWidth + candidates.length * 8,
    )
    const availableWidth = Math.max(1, Math.floor(stave.getNoteEndX() - stave.getNoteStartX() - CONTENT_SIDE_PADDING_PX * 2))
    if (availableWidth < contentWidth) {
      const resizedWidth = startDecorationWidth + contentWidth + CONTENT_SIDE_PADDING_PX * 2
      const resizedTotalWidth = resizedWidth + STRIP_PADDING_X_PX * 2
      hostElement.replaceChildren()
      const resizedRenderer = new Renderer(hostElement, Renderer.Backends.SVG)
      resizedRenderer.resize(resizedTotalWidth, STRIP_RENDER_HEIGHT_PX)
      const resizedContext = resizedRenderer.getContext()
      const resizedStave = new Stave(STRIP_PADDING_X_PX, staveTopPx, resizedWidth)
      resizedStave.setBegBarType(BarlineType.NONE)
      resizedStave.setEndBarType(BarlineType.NONE)
      resizedStave.addClef(target.previewClef)
      if (target.previewKeyFifths !== 0) {
        resizedStave.addKeySignature(getKeySignatureSpecFromFifths(target.previewKeyFifths))
      }
      resizedStave.setContext(resizedContext).draw()
      vexNotes.forEach((note) => note.setStave(resizedStave))
      new Formatter().joinVoices([voice]).format(
        [voice],
        Math.max(1, Math.floor(resizedStave.getNoteEndX() - resizedStave.getNoteStartX() - CONTENT_SIDE_PADDING_PX * 2)),
      )
      voice.draw(resizedContext, resizedStave)
      const resizedSvgElement = hostElement.querySelector('svg')
      if (resizedSvgElement instanceof SVGSVGElement) {
        centerRenderedSvgContent(resizedSvgElement)
      }

      const slotCenters = vexNotes.map((note) => note.getAbsoluteX())
      const contentStartX = resizedStave.getNoteStartX() - CONTENT_SIDE_PADDING_PX
      const contentEndX = resizedStave.getNoteEndX() + CONTENT_SIDE_PADDING_PX
      const nextLayouts = slotCenters.map((centerX, index) => {
        const leftBoundary = index === 0 ? contentStartX : (slotCenters[index - 1] + centerX) / 2
        const rightBoundary = index === slotCenters.length - 1 ? contentEndX : (centerX + slotCenters[index + 1]) / 2
        return {
          key: candidates[index]?.key ?? `candidate-${index}`,
          leftPx: clamp(leftBoundary, 0, resizedTotalWidth),
          widthPx: Math.max(1, clamp(rightBoundary, 0, resizedTotalWidth) - clamp(leftBoundary, 0, resizedTotalWidth)),
        }
      })
      setSlotLayouts(nextLayouts)
      hostElement.querySelector('svg')?.setAttribute('aria-hidden', 'true')
      return undefined
    }

    new Formatter().joinVoices([voice]).format([voice], availableWidth)
    voice.draw(context, stave)
    const svgElement = hostElement.querySelector('svg')
    if (svgElement instanceof SVGSVGElement) {
      centerRenderedSvgContent(svgElement)
    }

    const slotCenters = vexNotes.map((note) => note.getAbsoluteX())
    const contentStartX = stave.getNoteStartX() - CONTENT_SIDE_PADDING_PX
    const contentEndX = stave.getNoteEndX() + CONTENT_SIDE_PADDING_PX
    const nextLayouts = slotCenters.map((centerX, index) => {
      const leftBoundary = index === 0 ? contentStartX : (slotCenters[index - 1] + centerX) / 2
      const rightBoundary = index === slotCenters.length - 1 ? contentEndX : (centerX + slotCenters[index + 1]) / 2
      return {
        key: candidates[index]?.key ?? `candidate-${index}`,
        leftPx: clamp(leftBoundary, 0, totalWidth),
        widthPx: Math.max(1, clamp(rightBoundary, 0, totalWidth) - clamp(leftBoundary, 0, totalWidth)),
      }
    })
    setSlotLayouts(nextLayouts)
    hostElement.querySelector('svg')?.setAttribute('aria-hidden', 'true')
    return undefined
  }, [candidates, selectedCandidateKey, target])

  return (
    <div className="smart-chord-notation-strip">
      <div className="smart-chord-notation-scroll">
        <div className="smart-chord-notation-stage-wrap" style={{ height: `${STRIP_VIEWPORT_HEIGHT_PX}px` }}>
          <div className="smart-chord-notation-stage">
            <div ref={hostRef} className="smart-chord-notation-svg" />
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
