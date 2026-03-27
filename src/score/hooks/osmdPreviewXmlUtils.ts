import { getStepOctaveAlterFromPitch } from '../pitchMath'
import type { MeasurePair, Pitch } from '../types'

export function sanitizeMusicXmlForOsmdPreview(xmlText: string, measurePairs: MeasurePair[]): string {
  const source = xmlText.trim()
  if (!source) return xmlText
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(source, 'application/xml')
    const parseError = doc.querySelector('parsererror')
    if (parseError) return xmlText

    const partElement = doc.getElementsByTagName('part')[0]
    if (!partElement) return xmlText

    const toNoteKey = (noteId: string, keyIndex: number): string => `${noteId}:${keyIndex}`
    const getDirectChildElements = (parent: Element, tagName: string): Element[] =>
      Array.from(parent.children).filter((child): child is Element => child.tagName === tagName)
    const getStaffNumber = (noteElement: Element): number => {
      const staffElement = getDirectChildElements(noteElement, 'staff')[0]
      if (!staffElement) return 1
      const value = Number.parseInt(staffElement.textContent ?? '1', 10)
      if (!Number.isFinite(value)) return 1
      return value
    }

    const noteElementByKey = new Map<string, Element>()
    const measureElements = Array.from(partElement.getElementsByTagName('measure'))
    const measureCount = Math.min(measureElements.length, measurePairs.length)
    for (let pairIndex = 0; pairIndex < measureCount; pairIndex += 1) {
      const pair = measurePairs[pairIndex]
      const measureElement = measureElements[pairIndex]
      if (!pair || !measureElement) continue
      const measureNotes = getDirectChildElements(measureElement, 'note')
      const trebleElements = measureNotes.filter((noteElement) => getStaffNumber(noteElement) === 1)
      const bassElements = measureNotes.filter((noteElement) => getStaffNumber(noteElement) === 2)

      const assignStaffElements = (staffNotes: MeasurePair['treble'], staffElements: Element[]) => {
        let cursor = 0
        staffNotes.forEach((staffNote) => {
          const keyCount = 1 + (staffNote.chordPitches?.length ?? 0)
          for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
            const noteElement = staffElements[cursor]
            cursor += 1
            if (!noteElement) return
            noteElementByKey.set(toNoteKey(staffNote.id, keyIndex), noteElement)
          }
        })
      }

      assignStaffElements(pair.treble, trebleElements)
      assignStaffElements(pair.bass, bassElements)
    }

    const setPitchOnNoteElement = (noteElement: Element, pitch: Pitch): void => {
      getDirectChildElements(noteElement, 'rest').forEach((restElement) => {
        noteElement.removeChild(restElement)
      })
      let pitchElement = getDirectChildElements(noteElement, 'pitch')[0]
      if (!pitchElement) {
        pitchElement = doc.createElement('pitch')
        const firstElementChild = noteElement.firstElementChild
        if (firstElementChild) {
          noteElement.insertBefore(pitchElement, firstElementChild.nextSibling)
        } else {
          noteElement.appendChild(pitchElement)
        }
      }
      while (pitchElement.firstChild) {
        pitchElement.removeChild(pitchElement.firstChild)
      }
      const { step, alter, octave } = getStepOctaveAlterFromPitch(pitch)
      const stepElement = doc.createElement('step')
      stepElement.textContent = step
      pitchElement.appendChild(stepElement)
      if (alter !== 0) {
        const alterElement = doc.createElement('alter')
        alterElement.textContent = String(alter)
        pitchElement.appendChild(alterElement)
      }
      const octaveElement = doc.createElement('octave')
      octaveElement.textContent = String(octave)
      pitchElement.appendChild(octaveElement)
    }

    measurePairs.forEach((pair) => {
      ;(['treble', 'bass'] as const).forEach((staff) => {
        const staffNotes = staff === 'treble' ? pair.treble : pair.bass
        staffNotes.forEach((staffNote) => {
          if (staffNote.isRest) return
          const rootElement = noteElementByKey.get(toNoteKey(staffNote.id, 0))
          if (rootElement) {
            setPitchOnNoteElement(rootElement, staffNote.pitch)
          }
          staffNote.chordPitches?.forEach((pitch, chordIndex) => {
            const chordElement = noteElementByKey.get(toNoteKey(staffNote.id, chordIndex + 1))
            if (chordElement) {
              setPitchOnNoteElement(chordElement, pitch)
            }
          })
        })
      })
    })

    return new XMLSerializer().serializeToString(doc)
  } catch {
    return xmlText
  }
}

export function buildFastOsmdPreviewXml(xmlText: string, measureLimit: number): string {
  const safeLimit = Math.max(1, Math.floor(measureLimit))
  if (!Number.isFinite(safeLimit)) return xmlText
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, 'application/xml')
    if (doc.querySelector('parsererror')) return xmlText
    const partNodes = Array.from(doc.querySelectorAll('score-partwise > part, score-timewise > part'))
    if (partNodes.length === 0) return xmlText
    let hasTrimmedMeasures = false
    partNodes.forEach((partNode) => {
      const measureNodes = Array.from(partNode.children).filter((node) => node.tagName.toLowerCase() === 'measure')
      for (let index = safeLimit; index < measureNodes.length; index += 1) {
        measureNodes[index].remove()
        hasTrimmedMeasures = true
      }
    })
    if (!hasTrimmedMeasures) return xmlText
    return new XMLSerializer().serializeToString(doc)
  } catch {
    return xmlText
  }
}
