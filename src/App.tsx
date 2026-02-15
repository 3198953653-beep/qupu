import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Accidental, Beam, Formatter, Fraction, Renderer, Stave, StaveConnector, StaveNote, Voice } from 'vexflow'
import './App.css'

const TREBLE_STAFF_Y = 56
const BASS_STAFF_Y = 172
const STAFF_HEIGHT = 330
const STAFF_MIN_WIDTH = 520
const STAFF_X = 24
const QUARTER_NOTE_SECONDS = 0.5

const PIANO_MIN_MIDI = 21 // A0
const PIANO_MAX_MIDI = 108 // C8
const CHROMATIC_STEPS = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'] as const

type Pitch = string
type StemDirection = 1 | -1
type NoteDuration = 'q' | '8' | '16' | '8d'
type RhythmPresetId = 'quarter' | 'twoEighth' | 'fourSixteenth' | 'eightSixteenth' | 'shortDotted'
type StaffKind = 'treble' | 'bass'

type ScoreNote = {
  id: string
  pitch: Pitch
  duration: NoteDuration
}

type NoteLayout = {
  id: string
  staff: StaffKind
  x: number
  y: number
}

type Selection = {
  noteId: string
  staff: StaffKind
}

type DragState = {
  noteId: string
  staff: StaffKind
  pointerId: number
  pitch: Pitch
  grabOffsetY: number
}

const INITIAL_NOTES: ScoreNote[] = [
  { id: 'n1', pitch: 'c/5', duration: 'q' },
  { id: 'n2', pitch: 'e/5', duration: 'q' },
  { id: 'n3', pitch: 'g/4', duration: 'q' },
  { id: 'n4', pitch: 'd/5', duration: 'q' },
]

let nextNoteSerial = 5

const DURATION_BEATS: Record<NoteDuration, number> = {
  q: 1,
  '8': 0.5,
  '16': 0.25,
  '8d': 0.75,
}

const DURATION_TONE: Record<NoteDuration, string> = {
  q: '4n',
  '8': '8n',
  '16': '16n',
  '8d': '8n.',
}

const DURATION_LABEL: Record<NoteDuration, string> = {
  q: '四分',
  '8': '八分',
  '16': '十六分',
  '8d': '附点八分',
}

const RHYTHM_PRESETS: { id: RhythmPresetId; label: string; pattern: NoteDuration[] }[] = [
  { id: 'quarter', label: '四分节奏', pattern: ['q', 'q', 'q', 'q'] },
  { id: 'twoEighth', label: '二八节奏', pattern: ['8', '8', '8', '8', '8', '8', '8', '8'] },
  {
    id: 'fourSixteenth',
    label: '四十六节奏',
    pattern: ['16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16', '16'],
  },
  {
    id: 'eightSixteenth',
    label: '八十六节奏',
    pattern: ['8', '16', '16', '8', '16', '16', '8', '16', '16', '8', '16', '16'],
  },
  {
    id: 'shortDotted',
    label: '小附点节奏',
    pattern: ['8d', '16', '8d', '16', '8d', '16', '8d', '16'],
  },
]

const BASS_MOCK_PATTERN: Pitch[] = ['c/3', 'g/2', 'a/2', 'e/3', 'f/2', 'c/3', 'd/3', 'g/2']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function midiToPitch(midi: number): Pitch {
  const note = CHROMATIC_STEPS[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${note}/${octave}`
}

function createPianoPitches(): Pitch[] {
  const result: Pitch[] = []
  for (let midi = PIANO_MIN_MIDI; midi <= PIANO_MAX_MIDI; midi += 1) {
    result.push(midiToPitch(midi))
  }
  return result
}

const PITCHES: Pitch[] = createPianoPitches()

function parsePitch(pitch: Pitch): { note: string; octave: number } {
  const [note, octaveText] = pitch.split('/')
  return { note, octave: Number(octaveText) }
}

function buildPitchLineMap(clef: StaffKind): Record<Pitch, number> {
  const map = {} as Record<Pitch, number>
  for (const pitch of PITCHES) {
    const probe = new StaveNote({
      keys: [pitch],
      duration: 'q',
      clef,
    })
    map[pitch] = probe.getKeyLine(0)
  }
  return map
}

const PITCH_LINE_MAP: Record<StaffKind, Record<Pitch, number>> = {
  treble: buildPitchLineMap('treble'),
  bass: buildPitchLineMap('bass'),
}

function toDisplayPitch(pitch: Pitch): string {
  const { note, octave } = parsePitch(pitch)
  return `${note.toUpperCase()}${octave}`
}

function toTonePitch(pitch: Pitch): string {
  const { note, octave } = parsePitch(pitch)
  return `${note.toUpperCase()}${octave}`
}

function toDisplayDuration(duration: NoteDuration): string {
  return DURATION_LABEL[duration]
}

function createNoteId(): string {
  const id = `n${nextNoteSerial}`
  nextNoteSerial += 1
  return id
}

function buildNotesFromPattern(pattern: NoteDuration[], sourceNotes: ScoreNote[]): ScoreNote[] {
  const basePitches = sourceNotes.length > 0 ? sourceNotes.map((note) => note.pitch) : INITIAL_NOTES.map((note) => note.pitch)
  return pattern.map((duration, index) => ({
    id: createNoteId(),
    pitch: basePitches[index % basePitches.length],
    duration,
  }))
}

function buildBassMockNotes(sourceNotes: ScoreNote[]): ScoreNote[] {
  return sourceNotes.map((note, index) => ({
    id: `bass-${index + 1}`,
    pitch: BASS_MOCK_PATTERN[index % BASS_MOCK_PATTERN.length],
    duration: note.duration,
  }))
}

function syncBassNotesToTreble(trebleNotes: ScoreNote[], currentBass: ScoreNote[]): ScoreNote[] {
  return trebleNotes.map((trebleNote, index) => ({
    id: currentBass[index]?.id ?? `bass-${index + 1}`,
    pitch: currentBass[index]?.pitch ?? BASS_MOCK_PATTERN[index % BASS_MOCK_PATTERN.length],
    duration: trebleNote.duration,
  }))
}

const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)

function getStrictStemDirection(pitch: Pitch): StemDirection {
  const line = PITCH_LINE_MAP.treble[pitch]
  return line < 3 ? 1 : -1
}

function getNearestPitchByY(y: number, pitchYMap: Record<Pitch, number>, preferred?: Pitch): Pitch {
  let winner: Pitch = preferred ?? PITCHES[0]
  let winnerDistance = Math.abs(y - (pitchYMap[winner] ?? 0))

  for (const pitch of PITCHES) {
    const distance = Math.abs(y - pitchYMap[pitch])
    if (distance < winnerDistance) {
      winner = pitch
      winnerDistance = distance
    }
  }

  return winner
}

function getHitNote(x: number, y: number, layouts: NoteLayout[], radius = 24): NoteLayout | null {
  if (layouts.length === 0) return null

  let winner: NoteLayout | null = null
  let winnerDistance = Number.POSITIVE_INFINITY

  for (const layout of layouts) {
    const distance = Math.hypot(layout.x - x, layout.y - y)
    if (distance < winnerDistance) {
      winner = layout
      winnerDistance = distance
    }
  }

  if (!winner || winnerDistance > radius) return null
  return winner
}

function updateNotePitch(notes: ScoreNote[], noteId: string, pitch: Pitch): ScoreNote[] {
  return notes.map((note) => (note.id === noteId ? { ...note, pitch } : note))
}

function createAiVariation(notes: ScoreNote[]): ScoreNote[] {
  let cursor = Math.floor(Math.random() * PITCHES.length)

  return notes.map((note) => {
    const deltaOptions = [-2, -1, 0, 1, 2]
    const delta = deltaOptions[Math.floor(Math.random() * deltaOptions.length)]
    cursor = clamp(cursor + delta, 0, PITCHES.length - 1)
    return { ...note, pitch: PITCHES[cursor] }
  })
}

function App() {
  const [notes, setNotes] = useState<ScoreNote[]>(INITIAL_NOTES)
  const [bassNotes, setBassNotes] = useState<ScoreNote[]>(INITIAL_BASS_NOTES)
  const [rhythmPreset, setRhythmPreset] = useState<RhythmPresetId>('quarter')
  const [activeSelection, setActiveSelection] = useState<Selection>({ noteId: INITIAL_NOTES[0].id, staff: 'treble' })
  const [draggingSelection, setDraggingSelection] = useState<Selection | null>(null)
  const [staffWidth, setStaffWidth] = useState<number>(860)
  const [isPlaying, setIsPlaying] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scoreRef = useRef<HTMLDivElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | null>(null)

  const pitchYRef = useRef<Record<StaffKind, Record<Pitch, number>>>({
    treble: {} as Record<Pitch, number>,
    bass: {} as Record<Pitch, number>,
  })
  const noteLayoutsRef = useRef<NoteLayout[]>([])
  const dragRef = useRef<DragState | null>(null)
  const stopPlayTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const host = scrollRef.current
    if (!host) return

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0].contentRect.width)
      setStaffWidth(Math.max(STAFF_MIN_WIDTH, nextWidth))
    })

    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setBassNotes((currentBass) => {
      const sameShape =
        currentBass.length === notes.length && currentBass.every((bassNote, index) => bassNote.duration === notes[index]?.duration)
      if (sameShape) return currentBass
      return syncBassNotesToTreble(notes, currentBass)
    })
  }, [notes])

  useEffect(() => {
    const root = scoreRef.current
    if (!root) return

    root.innerHTML = ''

    const renderer = new Renderer(root, Renderer.Backends.SVG)
    renderer.resize(staffWidth, STAFF_HEIGHT)
    const context = renderer.getContext()

    const staffWidthPx = staffWidth - STAFF_X * 2
    const trebleStave = new Stave(STAFF_X, TREBLE_STAFF_Y, staffWidthPx)
    const bassStave = new Stave(STAFF_X, BASS_STAFF_Y, staffWidthPx)

    trebleStave.addClef('treble').addTimeSignature('4/4')
    bassStave.addClef('bass').addTimeSignature('4/4')

    trebleStave.setContext(context).draw()
    bassStave.setContext(context).draw()

    new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.BRACE).setContext(context).draw()
    new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw()
    new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw()

    const trebleVexNotes = notes.map((note) => {
      const vexNote = new StaveNote({
        keys: [note.pitch],
        duration: note.duration,
        clef: 'treble',
        stemDirection: getStrictStemDirection(note.pitch),
      })
      if (note.pitch.includes('#')) vexNote.addModifier(new Accidental('#'), 0)
      return vexNote
    })

    const bassVexNotes = bassNotes.map((note) => {
      const vexNote = new StaveNote({
        keys: [note.pitch],
        duration: note.duration,
        clef: 'bass',
        autoStem: true,
      })
      if (note.pitch.includes('#')) vexNote.addModifier(new Accidental('#'), 0)
      return vexNote
    })

    trebleVexNotes.forEach((vexNote, index) => {
      const noteId = notes[index].id
      if (draggingSelection?.staff === 'treble' && draggingSelection.noteId === noteId) {
        vexNote.setKeyStyle(0, { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
      } else if (activeSelection.staff === 'treble' && activeSelection.noteId === noteId) {
        vexNote.setKeyStyle(0, { fillStyle: '#145f84', strokeStyle: '#145f84' })
      }
    })

    bassVexNotes.forEach((vexNote, index) => {
      const noteId = bassNotes[index].id
      if (draggingSelection?.staff === 'bass' && draggingSelection.noteId === noteId) {
        vexNote.setKeyStyle(0, { fillStyle: '#0e9ac7', strokeStyle: '#0e9ac7' })
      } else if (activeSelection.staff === 'bass' && activeSelection.noteId === noteId) {
        vexNote.setKeyStyle(0, { fillStyle: '#145f84', strokeStyle: '#145f84' })
      }
    })

    const trebleVoice = new Voice({ numBeats: 4, beatValue: 4 }).addTickables(trebleVexNotes)
    const bassVoice = new Voice({ numBeats: 4, beatValue: 4 }).addTickables(bassVexNotes)

    new Formatter()
      .joinVoices([trebleVoice])
      .joinVoices([bassVoice])
      .format([trebleVoice, bassVoice], trebleStave.getWidth() - 110)

    const trebleBeams = Beam.generateBeams(trebleVexNotes, { groups: [new Fraction(1, 4)] })
    const bassBeams = Beam.generateBeams(bassVexNotes, { groups: [new Fraction(1, 4)] })

    trebleVoice.draw(context, trebleStave)
    bassVoice.draw(context, bassStave)
    trebleBeams.forEach((beam) => beam.setContext(context).draw())
    bassBeams.forEach((beam) => beam.setContext(context).draw())

    const trebleLayouts: NoteLayout[] = trebleVexNotes.map((vexNote, index) => ({
      id: notes[index].id,
      staff: 'treble',
      x: vexNote.getAbsoluteX(),
      y: vexNote.getYs()[0],
    }))
    const bassLayouts: NoteLayout[] = bassVexNotes.map((vexNote, index) => ({
      id: bassNotes[index].id,
      staff: 'bass',
      x: vexNote.getAbsoluteX(),
      y: vexNote.getYs()[0],
    }))

    const treblePitchYMap = {} as Record<Pitch, number>
    const bassPitchYMap = {} as Record<Pitch, number>
    for (const pitch of PITCHES) {
      treblePitchYMap[pitch] = trebleStave.getYForNote(PITCH_LINE_MAP.treble[pitch])
      bassPitchYMap[pitch] = bassStave.getYForNote(PITCH_LINE_MAP.bass[pitch])
    }

    noteLayoutsRef.current = [...trebleLayouts, ...bassLayouts]
    pitchYRef.current = {
      treble: treblePitchYMap,
      bass: bassPitchYMap,
    }
  }, [notes, bassNotes, staffWidth, activeSelection, draggingSelection])

  useEffect(() => {
    synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination()
    return () => {
      synthRef.current?.dispose()
    }
  }, [])

  const commitDrag = (drag: DragState, pitch: Pitch) => {
    if (pitch === drag.pitch) return

    const nextDrag = { ...drag, pitch }
    dragRef.current = nextDrag
    if (nextDrag.staff === 'treble') {
      setNotes((current) => updateNotePitch(current, nextDrag.noteId, nextDrag.pitch))
    } else {
      setBassNotes((current) => updateNotePitch(current, nextDrag.noteId, nextDrag.pitch))
    }
  }

  const onSurfacePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return

    const surface = scoreRef.current
    if (!surface) return

    const rect = surface.getBoundingClientRect()
    const y = event.clientY - rect.top
    const targetY = y - drag.grabOffsetY
    const pitch = getNearestPitchByY(targetY, pitchYRef.current[drag.staff], drag.pitch)
    commitDrag(drag, pitch)
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return

    dragRef.current = null
    setDraggingSelection(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const playScore = async () => {
    const synth = synthRef.current
    if (!synth) return

    await Tone.start()
    setIsPlaying(true)

    const start = Tone.now() + 0.05
    let cursor = start
    notes.forEach((note, index) => {
      const bassNote = bassNotes[index]
      synth.triggerAttackRelease(toTonePitch(note.pitch), DURATION_TONE[note.duration], cursor)
      if (bassNote) {
        synth.triggerAttackRelease(toTonePitch(bassNote.pitch), DURATION_TONE[bassNote.duration], cursor, 0.72)
      }
      cursor += DURATION_BEATS[note.duration] * QUARTER_NOTE_SECONDS
    })

    if (stopPlayTimerRef.current !== null) {
      window.clearTimeout(stopPlayTimerRef.current)
    }

    stopPlayTimerRef.current = window.setTimeout(() => {
      setIsPlaying(false)
      stopPlayTimerRef.current = null
    }, Math.max(200, (cursor - start) * 1000 + 200))
  }

  const resetScore = () => {
    setNotes(INITIAL_NOTES)
    setBassNotes(INITIAL_BASS_NOTES)
    setActiveSelection({ noteId: INITIAL_NOTES[0].id, staff: 'treble' })
    setDraggingSelection(null)
    setRhythmPreset('quarter')
  }

  const runAiDraft = () => {
    setNotes((current) => createAiVariation(current))
  }

  const applyRhythmPreset = (presetId: RhythmPresetId) => {
    const preset = RHYTHM_PRESETS.find((item) => item.id === presetId)
    if (!preset) return

    let nextActive = ''
    setNotes((current) => {
      const next = buildNotesFromPattern(preset.pattern, current)
      nextActive = next[0]?.id ?? ''
      return next
    })
    if (nextActive) {
      setActiveSelection({ noteId: nextActive, staff: 'treble' })
    }
    setRhythmPreset(presetId)
  }

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const surface = scoreRef.current
    if (!surface) return

    const rect = surface.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const hitNote = getHitNote(x, y, noteLayoutsRef.current, 30)

    if (!hitNote) return

    event.preventDefault()
    const sourceNotes = hitNote.staff === 'treble' ? notes : bassNotes
    const current = sourceNotes.find((note) => note.id === hitNote.id)
    const noteCenterY = hitNote.y
    const grabOffsetY = y - noteCenterY
    const pitch = current?.pitch ?? getNearestPitchByY(noteCenterY, pitchYRef.current[hitNote.staff])

    const dragState: DragState = {
      noteId: hitNote.id,
      staff: hitNote.staff,
      pointerId: event.pointerId,
      pitch,
      grabOffsetY,
    }

    dragRef.current = dragState
    setActiveSelection({ noteId: hitNote.id, staff: hitNote.staff })
    setDraggingSelection({ noteId: hitNote.id, staff: hitNote.staff })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const activePool = activeSelection.staff === 'treble' ? notes : bassNotes
  const currentSelection = activePool.find((note) => note.id === activeSelection.noteId) ?? activePool[0] ?? notes[0]

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Interactive Music Score MVP</p>
        <h1>Real-time Staff Preview + Drag Editing</h1>
        <p className="subtitle">
          All rhythm examples now render as a grand staff: treble melody + bass mock notes, connected by a brace.
          Dragging edits whichever note you grabbed in either staff.
        </p>
      </section>

      <section className="control-row">
        <button type="button" onClick={playScore} disabled={isPlaying}>
          {isPlaying ? 'Playing...' : 'Play Measure'}
        </button>
        <button type="button" onClick={runAiDraft}>
          AI Draft
        </button>
        <button type="button" onClick={resetScore}>
          Reset
        </button>
      </section>

      <section className="rhythm-row">
        {RHYTHM_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`rhythm-btn ${rhythmPreset === preset.id ? 'active' : ''}`}
            onClick={() => applyRhythmPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </section>

      <section className="board">
        <div className="score-scroll" ref={scrollRef}>
          <div className="score-stage" style={{ width: `${staffWidth}px`, height: `${STAFF_HEIGHT}px` }}>
            <div
              className={`score-surface ${draggingSelection ? 'is-dragging' : ''}`}
              ref={scoreRef}
              onPointerDown={beginDrag}
              onPointerMove={onSurfacePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          </div>
        </div>

        <div className="inspector">
          <h2>Selected Note</h2>
          <p>
            Staff: <strong>{activeSelection.staff === 'treble' ? 'Treble' : 'Bass'}</strong>
          </p>
          <p>
            Pitch: <strong>{toDisplayPitch(currentSelection.pitch)}</strong>
          </p>
          <p>
            Duration: <strong>{toDisplayDuration(currentSelection.duration)}</strong>
          </p>
          <p>
            Position: <strong>{activePool.findIndex((note) => note.id === currentSelection.id) + 1}</strong> /{' '}
            {activePool.length}
          </p>
          <p className="sequence">Treble: {notes.map((note) => toDisplayPitch(note.pitch)).join('  |  ')}</p>
          <p className="sequence">Bass: {bassNotes.map((note) => toDisplayPitch(note.pitch)).join('  |  ')}</p>
        </div>
      </section>
    </main>
  )
}

export default App
