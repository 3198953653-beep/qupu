import type { ScoreControlsProps } from '../types'

export type ScoreSpacingControlsProps = Pick<
  ScoreControlsProps,
  | 'pageHorizontalPaddingPx'
  | 'chordMarkerUiScalePercent'
  | 'chordMarkerPaddingPx'
  | 'staffInterGapPx'
  | 'baseMinGap32Px'
  | 'leadingBarlineGapPx'
  | 'secondChordSafeGapPx'
  | 'durationGapRatio32'
  | 'durationGapRatio16'
  | 'durationGapRatio8'
  | 'durationGapRatio4'
  | 'durationGapRatio2'
  | 'durationGapRatioWhole'
  | 'onPageHorizontalPaddingPxChange'
  | 'onChordMarkerUiScalePercentChange'
  | 'onChordMarkerPaddingPxChange'
  | 'onStaffInterGapPxChange'
  | 'onBaseMinGap32PxChange'
  | 'onLeadingBarlineGapPxChange'
  | 'onSecondChordSafeGapPxChange'
  | 'onDurationGapRatio32Change'
  | 'onDurationGapRatio16Change'
  | 'onDurationGapRatio8Change'
  | 'onDurationGapRatio4Change'
  | 'onDurationGapRatio2Change'
  | 'onDurationGapRatioWholeChange'
  | 'onResetSpacingConfig'
>

export function handleFloatValue(rawValue: string, onChange: (nextValue: number) => void) {
  onChange(Number(rawValue))
}
