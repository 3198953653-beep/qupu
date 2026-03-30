import { useCallback, useState } from 'react'
import { DEFAULT_PLAYBACK_VOLUME_PERCENT } from '../playbackVolume'

export function usePlaybackVolumeController(params: {
  setPlaybackTrebleVolumePercent: (value: number | ((current: number) => number)) => void
  setPlaybackBassVolumePercent: (value: number | ((current: number) => number)) => void
}) {
  const {
    setPlaybackTrebleVolumePercent,
    setPlaybackBassVolumePercent,
  } = params
  const [isOpen, setIsOpen] = useState(false)

  const openModal = useCallback(() => {
    setIsOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setIsOpen(false)
  }, [])

  const resetVolumes = useCallback(() => {
    setPlaybackTrebleVolumePercent(DEFAULT_PLAYBACK_VOLUME_PERCENT)
    setPlaybackBassVolumePercent(DEFAULT_PLAYBACK_VOLUME_PERCENT)
  }, [setPlaybackBassVolumePercent, setPlaybackTrebleVolumePercent])

  return {
    openPlaybackVolumeModal: openModal,
    playbackVolumeDialog: {
      isOpen,
      closeModal,
      resetVolumes,
    },
  }
}
