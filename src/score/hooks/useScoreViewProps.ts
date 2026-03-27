import { useScoreBoardProps } from './useScoreBoardProps'
import { useScoreControlsProps } from './useScoreControlsProps'
import type { ScoreViewAdapterParams, ScoreBoardProps, ScoreControlsProps } from './scoreViewAdapterTypes'

export function useScoreViewProps(params: ScoreViewAdapterParams): {
  scoreControlsProps: ScoreControlsProps
  scoreBoardProps: ScoreBoardProps
} {
  const scoreControlsProps = useScoreControlsProps(params)
  const scoreBoardProps = useScoreBoardProps(params)

  return {
    scoreControlsProps,
    scoreBoardProps,
  }
}
