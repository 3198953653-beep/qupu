import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { getVisibleSystemRange } from '../layout/viewport'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useVisibleSystemRangeTracking(params: {
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  systemCount: number
  setVisibleSystemRange: StateSetter<{ start: number; end: number }>
}): void {
  const { scoreScrollRef, systemCount, setVisibleSystemRange } = params

  useEffect(() => {
    const scrollHost = scoreScrollRef.current
    if (!scrollHost) return

    let rafId: number | null = null

    const updateVisibleRange = () => {
      const next = getVisibleSystemRange(scrollHost.scrollTop, scrollHost.clientHeight, systemCount)
      setVisibleSystemRange((current) => {
        if (current.start === next.start && current.end === next.end) return current
        return next
      })
    }

    const scheduleVisibleRangeUpdate = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        updateVisibleRange()
      })
    }

    updateVisibleRange()
    scrollHost.addEventListener('scroll', scheduleVisibleRangeUpdate, { passive: true })
    window.addEventListener('resize', scheduleVisibleRangeUpdate)

    return () => {
      scrollHost.removeEventListener('scroll', scheduleVisibleRangeUpdate)
      window.removeEventListener('resize', scheduleVisibleRangeUpdate)
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [scoreScrollRef, systemCount, setVisibleSystemRange])
}
