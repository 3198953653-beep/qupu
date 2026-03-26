import { useCallback, useEffect, useRef, useState } from 'react'
import { getMidiNoteNumber } from '../midiInput'

const LOCAL_STORAGE_MIDI_INPUT_KEY = 'score.midi.selectedInputId'

export type MidiPermissionState = 'idle' | 'granted' | 'denied' | 'unsupported' | 'error'

export type MidiInputOption = {
  id: string
  name: string
}

export type WebMidiMessageEventLike = {
  data?: Uint8Array | number[] | null
}

export type WebMidiInputLike = {
  id: string
  name?: string
  onmidimessage: ((event: WebMidiMessageEventLike) => void) | null
}

export type WebMidiAccessLike = {
  inputs?: {
    values?: () => IterableIterator<WebMidiInputLike>
    forEach?: (callback: (value: WebMidiInputLike) => void) => void
  }
  onstatechange: ((event: unknown) => void) | null
}

function collectMidiInputs(access: WebMidiAccessLike | null): WebMidiInputLike[] {
  if (!access?.inputs) return []
  const values = access.inputs.values?.()
  if (values) {
    return Array.from(values).filter((input): input is WebMidiInputLike => Boolean(input?.id))
  }
  const list: WebMidiInputLike[] = []
  access.inputs.forEach?.((input) => {
    if (input?.id) list.push(input)
  })
  return list
}

function toMidiPermissionStateFromError(error: unknown): MidiPermissionState {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()
  if (message.includes('denied') || message.includes('notallowed') || message.includes('permission')) {
    return 'denied'
  }
  return 'error'
}

export function useMidiInputController(params: {
  onMidiNoteNumber: (midiNoteNumber: number) => void
}): {
  midiPermissionState: MidiPermissionState
  midiInputOptions: MidiInputOption[]
  selectedMidiInputId: string
  setSelectedMidiInputId: (nextId: string) => void
} {
  const { onMidiNoteNumber } = params
  const [midiPermissionState, setMidiPermissionState] = useState<MidiPermissionState>('idle')
  const [midiInputOptions, setMidiInputOptions] = useState<MidiInputOption[]>([])
  const [selectedMidiInputId, setSelectedMidiInputId] = useState('')

  const midiAccessRef = useRef<WebMidiAccessLike | null>(null)
  const midiInputsByIdRef = useRef<Map<string, WebMidiInputLike>>(new Map())
  const boundMidiInputIdRef = useRef<string>('')

  const refreshMidiInputs = useCallback((access: WebMidiAccessLike | null) => {
    const inputs = collectMidiInputs(access)
    const nextOptions: MidiInputOption[] = []
    const nextInputMap = new Map<string, WebMidiInputLike>()
    inputs.forEach((input) => {
      if (!input?.id) return
      nextInputMap.set(input.id, input)
      nextOptions.push({
        id: input.id,
        name: input.name?.trim() || '未命名设备',
      })
    })
    midiInputsByIdRef.current = nextInputMap
    setMidiInputOptions(nextOptions)
    setSelectedMidiInputId((current) => {
      if (current && nextInputMap.has(current)) return current
      const rememberedId = typeof window !== 'undefined' ? window.localStorage.getItem(LOCAL_STORAGE_MIDI_INPUT_KEY) : ''
      if (rememberedId && nextInputMap.has(rememberedId)) return rememberedId
      return nextOptions[0]?.id ?? ''
    })
  }, [])

  const handleMidiMessage = useCallback((event: WebMidiMessageEventLike) => {
    const rawData = event.data
    const message =
      rawData instanceof Uint8Array ? rawData : Array.isArray(rawData) ? new Uint8Array(rawData) : null
    if (!message) return
    const midiNoteNumber = getMidiNoteNumber(message)
    if (midiNoteNumber === null) return
    onMidiNoteNumber(midiNoteNumber)
  }, [onMidiNoteNumber])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (selectedMidiInputId) {
      window.localStorage.setItem(LOCAL_STORAGE_MIDI_INPUT_KEY, selectedMidiInputId)
    } else {
      window.localStorage.removeItem(LOCAL_STORAGE_MIDI_INPUT_KEY)
    }
  }, [selectedMidiInputId])

  useEffect(() => {
    const boundId = boundMidiInputIdRef.current
    if (boundId) {
      const previousInput = midiInputsByIdRef.current.get(boundId)
      if (previousInput) previousInput.onmidimessage = null
      boundMidiInputIdRef.current = ''
    }
    if (!selectedMidiInputId) return
    const selectedInput = midiInputsByIdRef.current.get(selectedMidiInputId)
    if (!selectedInput) return
    selectedInput.onmidimessage = handleMidiMessage
    boundMidiInputIdRef.current = selectedMidiInputId
    return () => {
      if (boundMidiInputIdRef.current !== selectedMidiInputId) return
      selectedInput.onmidimessage = null
      boundMidiInputIdRef.current = ''
    }
  }, [handleMidiMessage, selectedMidiInputId])

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      setMidiPermissionState('unsupported')
      return
    }
    const midiNavigator = navigator as Navigator & {
      requestMIDIAccess?: () => Promise<WebMidiAccessLike>
    }
    if (typeof midiNavigator.requestMIDIAccess !== 'function') {
      setMidiPermissionState('unsupported')
      setMidiInputOptions([])
      setSelectedMidiInputId('')
      return
    }

    let cancelled = false
    midiNavigator.requestMIDIAccess()
      .then((access) => {
        if (cancelled) return
        const normalizedAccess = access as unknown as WebMidiAccessLike
        midiAccessRef.current = normalizedAccess
        setMidiPermissionState('granted')
        refreshMidiInputs(normalizedAccess)
        normalizedAccess.onstatechange = () => {
          refreshMidiInputs(normalizedAccess)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        midiAccessRef.current = null
        midiInputsByIdRef.current = new Map()
        setMidiInputOptions([])
        setSelectedMidiInputId('')
        setMidiPermissionState(toMidiPermissionStateFromError(error))
      })

    return () => {
      cancelled = true
      const boundId = boundMidiInputIdRef.current
      if (boundId) {
        const boundInput = midiInputsByIdRef.current.get(boundId)
        if (boundInput) boundInput.onmidimessage = null
        boundMidiInputIdRef.current = ''
      }
      const access = midiAccessRef.current
      if (access) access.onstatechange = null
      midiAccessRef.current = null
    }
  }, [refreshMidiInputs])

  return {
    midiPermissionState,
    midiInputOptions,
    selectedMidiInputId,
    setSelectedMidiInputId,
  }
}
