import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { ensureToneStarted, type PlaybackSynth } from '../notePreview'
import type { PlaybackTimelineEvent } from '../playbackTimeline'
import { QUARTER_NOTE_SECONDS, TICKS_PER_BEAT } from '../constants'
import { resolvePlaybackVelocityForStaff } from '../playbackVolume'
import { toTonePitch } from '../pitchUtils'

function clearTimerIds(timerIdsRef: MutableRefObject<number[]>) {
  timerIdsRef.current.forEach((timerId) => window.clearTimeout(timerId))
  timerIdsRef.current = []
}

export type AccompanimentPreviewPlaybackController = {
  activeCandidateKey: string | null
  playingMeasureNumber: number | null
  playbackTick: number | null
  playCachedTimeline: (params: {
    candidateKey: string
    measureNumber: number
    playbackTimelineEvents: PlaybackTimelineEvent[]
    playbackMeasureTicks: number
  }) => Promise<boolean>
  setPreviewCandidate: (candidateKey: string | null) => void
  stopPlayback: (reason?: string, options?: { clearActiveCandidate?: boolean }) => void
}

export function useAccompanimentPreviewPlaybackController(params: {
  synthRef: MutableRefObject<PlaybackSynth | null>
  playbackTrebleVolumePercent: number
  playbackBassVolumePercent: number
}) {
  const {
    synthRef,
    playbackTrebleVolumePercent,
    playbackBassVolumePercent,
  } = params
  const timerIdsRef = useRef<number[]>([])
  const stopTimerRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const sessionIdRef = useRef(0)
  const activeCandidateKeyRef = useRef<string | null>(null)
  const playingMeasureNumberRef = useRef<number | null>(null)
  const [activeCandidateKey, setActiveCandidateKey] = useState<string | null>(null)
  const [playingMeasureNumber, setPlayingMeasureNumber] = useState<number | null>(null)
  const [playbackTick, setPlaybackTick] = useState<number | null>(null)

  const stopPlayback = useCallback((reason = 'manual-stop', options?: { clearActiveCandidate?: boolean }) => {
    const clearActiveCandidate = options?.clearActiveCandidate ?? true
    const nextSessionId = sessionIdRef.current + 1
    if (import.meta.env.DEV) {
      console.info('[preview-playback:stop-requested]', {
        reason,
        currentSessionId: sessionIdRef.current,
        nextSessionId,
        activeCandidateKey: activeCandidateKeyRef.current,
        playingMeasureNumber: playingMeasureNumberRef.current,
        timerCount: timerIdsRef.current.length,
        hasStopTimer: stopTimerRef.current !== null,
        hasAnimationFrame: animationFrameRef.current !== null,
      })
    }
    sessionIdRef.current = nextSessionId
    clearTimerIds(timerIdsRef)
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    setPlayingMeasureNumber(null)
    playingMeasureNumberRef.current = null
    setPlaybackTick(null)
    if (clearActiveCandidate) {
      activeCandidateKeyRef.current = null
      setActiveCandidateKey(null)
    }
    const stoppableSynth = synthRef.current as (PlaybackSynth & { releaseAll?: (time?: number) => void }) | null
    if (stoppableSynth && typeof stoppableSynth.releaseAll === 'function') {
      try {
        stoppableSynth.releaseAll()
      } catch {
        // Ignore best-effort preview stop failures.
      }
    }
  }, [synthRef])

  const setPreviewCandidate = useCallback((candidateKey: string | null) => {
    activeCandidateKeyRef.current = candidateKey
    setActiveCandidateKey(candidateKey)
  }, [])

  const playCachedTimeline = useCallback(async (params: {
    candidateKey: string
    measureNumber: number
    playbackTimelineEvents: PlaybackTimelineEvent[]
    playbackMeasureTicks: number
  }): Promise<boolean> => {
    const { candidateKey, measureNumber, playbackTimelineEvents, playbackMeasureTicks } = params
    const events = playbackTimelineEvents
    if (events.length === 0) {
      if (import.meta.env.DEV) {
        console.info('[preview-playback:start-skipped]', { candidateKey, measureNumber, reason: 'no-events' })
      }
      stopPlayback('start-skipped:no-events')
      return false
    }

    setPreviewCandidate(candidateKey)
    stopPlayback('session-replaced', { clearActiveCandidate: false })
    await ensureToneStarted()

    const synth = synthRef.current
    if (!synth) {
      if (import.meta.env.DEV) {
        console.info('[preview-playback:start-skipped]', { candidateKey, measureNumber, reason: 'no-synth' })
      }
      stopPlayback('start-skipped:no-synth')
      return false
    }

    const firstEvent = events[0] ?? null
    const lastEvent = events[events.length - 1] ?? null
    const measureTicks = Math.max(
      1,
      playbackMeasureTicks,
      firstEvent?.measureTicks ?? Math.round(TICKS_PER_BEAT * 4),
    )
    const nominalMeasureDurationMs = Math.max(
      240,
      Math.round((measureTicks / TICKS_PER_BEAT) * QUARTER_NOTE_SECONDS * 1000),
    )
    const playbackDurationMs = Math.max(
      nominalMeasureDurationMs,
      Math.round((lastEvent?.latestReleaseAtSeconds ?? 0) * 1000) + 120,
    )
    const sessionId = sessionIdRef.current + 1
    sessionIdRef.current = sessionId
    const startedAtMs = performance.now()

    if (import.meta.env.DEV) {
      console.info('[preview-playback:start]', {
        candidateKey,
        measureNumber,
        sessionId,
        eventCount: events.length,
        measureTicks,
      })
    }

    setPlayingMeasureNumber(measureNumber)
    playingMeasureNumberRef.current = measureNumber
    setPlaybackTick(0)

    const animate = () => {
      if (sessionIdRef.current !== sessionId) return
      const elapsedMs = performance.now() - startedAtMs
      const ratio = Math.max(0, Math.min(1, elapsedMs / nominalMeasureDurationMs))
      setPlaybackTick(ratio * measureTicks)
      if (ratio >= 1) {
        animationFrameRef.current = null
        return
      }
      animationFrameRef.current = window.requestAnimationFrame(animate)
    }
    animationFrameRef.current = window.requestAnimationFrame(animate)

    const runPlaybackEvent = (event: PlaybackTimelineEvent) => {
      if (sessionIdRef.current !== sessionId) {
        if (import.meta.env.DEV) {
          console.info('[preview-playback:cancelled-by-session]', {
            candidateKey,
            measureNumber,
            sessionId,
            eventOnsetTick: event.onsetTick,
          })
        }
        return
      }
      const currentSynth = synthRef.current
      if (!currentSynth) return
      if (import.meta.env.DEV) {
        console.info('[preview-playback:event]', {
          candidateKey,
          measureNumber,
          sessionId,
          onsetTick: event.onsetTick,
          targetCount: event.targets.length,
        })
      }
      event.targets.forEach((target) => {
        const { resolvedVelocity } = resolvePlaybackVelocityForStaff({
          staff: target.staff,
          volumePercent: target.staff === 'treble'
            ? playbackTrebleVolumePercent
            : playbackBassVolumePercent,
        })
        currentSynth.triggerAttackRelease(
          toTonePitch(target.pitch),
          target.durationSeconds,
          undefined,
          resolvedVelocity,
        )
      })
      setPlaybackTick(event.onsetTick)
    }

    events.forEach((event: PlaybackTimelineEvent) => {
      const timeoutMs = Math.max(0, Math.round(event.atSeconds * 1000))
      if (timeoutMs === 0) {
        runPlaybackEvent(event)
        return
      }
      const timerId = window.setTimeout(() => {
        runPlaybackEvent(event)
      }, timeoutMs)
      timerIdsRef.current.push(timerId)
      if (import.meta.env.DEV) {
        console.info('[preview-playback:timer-registered]', {
          candidateKey,
          measureNumber,
          sessionId,
          onsetTick: event.onsetTick,
          timeoutMs,
          timerCount: timerIdsRef.current.length,
        })
      }
    })

    stopTimerRef.current = window.setTimeout(() => {
      if (sessionIdRef.current !== sessionId) return
      if (import.meta.env.DEV) {
        console.info('[preview-playback:stop]', {
          candidateKey,
          measureNumber,
          sessionId,
          reason: 'completed',
        })
      }
      stopPlayback('completed')
    }, playbackDurationMs)
    return true
  }, [
    playbackBassVolumePercent,
    playbackTrebleVolumePercent,
    setPreviewCandidate,
    stopPlayback,
    synthRef,
  ])

  useEffect(() => () => {
    if (import.meta.env.DEV) {
      console.info('[preview-playback:effect-cleanup]', {
        activeCandidateKey: activeCandidateKeyRef.current,
        currentSessionId: sessionIdRef.current,
        playingMeasureNumber: playingMeasureNumberRef.current,
        timerCount: timerIdsRef.current.length,
      })
    }
    stopPlayback('unmount-cleanup')
  }, [stopPlayback])

  return {
    activeCandidateKey,
    playingMeasureNumber,
    playbackTick,
    playCachedTimeline,
    setPreviewCandidate,
    stopPlayback,
  } satisfies AccompanimentPreviewPlaybackController
}
