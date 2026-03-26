import { useEffect } from 'react'

export function useScoreDebugApi<T extends object>(params: {
  enabled: boolean
  debugApi: T
}): void {
  const { enabled, debugApi } = params

  useEffect(() => {
    if (!enabled) return
    ;(window as unknown as { __scoreDebug?: T }).__scoreDebug = debugApi
    return () => {
      delete (window as unknown as { __scoreDebug?: T }).__scoreDebug
    }
  }, [debugApi, enabled])
}
