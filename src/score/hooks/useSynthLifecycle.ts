import { useEffect, type MutableRefObject } from 'react'
import * as Tone from 'tone'
import type { PlaybackSynth } from '../notePreview'

const PIANO_SAMPLE_URLS: Record<string, string> = {
  A0: 'A0.mp3',
  C1: 'C1.mp3',
  'D#1': 'Ds1.mp3',
  'F#1': 'Fs1.mp3',
  A1: 'A1.mp3',
  C2: 'C2.mp3',
  'D#2': 'Ds2.mp3',
  'F#2': 'Fs2.mp3',
  A2: 'A2.mp3',
  C3: 'C3.mp3',
  'D#3': 'Ds3.mp3',
  'F#3': 'Fs3.mp3',
  A3: 'A3.mp3',
  C4: 'C4.mp3',
  'D#4': 'Ds4.mp3',
  'F#4': 'Fs4.mp3',
  A4: 'A4.mp3',
  C5: 'C5.mp3',
  'D#5': 'Ds5.mp3',
  'F#5': 'Fs5.mp3',
  A5: 'A5.mp3',
  C6: 'C6.mp3',
  'D#6': 'Ds6.mp3',
  'F#6': 'Fs6.mp3',
  A6: 'A6.mp3',
  C7: 'C7.mp3',
  'D#7': 'Ds7.mp3',
  'F#7': 'Fs7.mp3',
  A7: 'A7.mp3',
  C8: 'C8.mp3',
}

const PIANO_SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'

export function useSynthLifecycle(params: {
  synthRef: MutableRefObject<PlaybackSynth | null>
}): void {
  const { synthRef } = params

  useEffect(() => {
    const fallbackSynth = new Tone.PolySynth(Tone.Synth).toDestination()
    synthRef.current = fallbackSynth
    const sampler = new Tone.Sampler({
      urls: PIANO_SAMPLE_URLS,
      baseUrl: PIANO_SAMPLE_BASE_URL,
      release: 1.8,
    }).toDestination()
    let isDisposed = false
    void Tone.loaded()
      .then(() => {
        if (isDisposed) return
        if (!sampler.loaded) return
        console.info('[audio] 高质量钢琴音源已加载（Salamander Sampler）。')
        synthRef.current = sampler
        fallbackSynth.dispose()
      })
      .catch((error: unknown) => {
        if (isDisposed) return
        sampler.dispose()
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[audio] 钢琴采样加载失败，已回退到默认合成器：${message}`)
      })
    return () => {
      isDisposed = true
      const currentSynth = synthRef.current
      currentSynth?.dispose()
      if (currentSynth !== fallbackSynth) {
        fallbackSynth.dispose()
      }
      if (currentSynth !== sampler) {
        sampler.dispose()
      }
      synthRef.current = null
    }
  }, [synthRef])
}
