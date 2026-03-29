import { useState } from 'react'
import { ScoreSpacingDurationRatioSection } from './scoreSpacingControls/ScoreSpacingDurationRatioSection'
import { ScoreSpacingGlobalGapSection } from './scoreSpacingControls/ScoreSpacingGlobalGapSection'
import { ScoreSpacingMarginSection } from './scoreSpacingControls/ScoreSpacingMarginSection'
import { type ScoreSpacingControlsProps } from './scoreSpacingControls/shared'

export function ScoreSpacingControls(props: ScoreSpacingControlsProps) {
  const {
    pageHorizontalPaddingPx,
    chordMarkerUiScalePercent,
    chordMarkerPaddingPx,
    staffInterGapPx,
    baseMinGap32Px,
    leadingBarlineGapPx,
    secondChordSafeGapPx,
    durationGapRatio32,
    durationGapRatio16,
    durationGapRatio8,
    durationGapRatio4,
    durationGapRatio2,
    durationGapRatioWhole,
    onPageHorizontalPaddingPxChange,
    onChordMarkerUiScalePercentChange,
    onChordMarkerPaddingPxChange,
    onStaffInterGapPxChange,
    onBaseMinGap32PxChange,
    onLeadingBarlineGapPxChange,
    onSecondChordSafeGapPxChange,
    onDurationGapRatio32Change,
    onDurationGapRatio16Change,
    onDurationGapRatio8Change,
    onDurationGapRatio4Change,
    onDurationGapRatio2Change,
    onDurationGapRatioWholeChange,
    onResetSpacingConfig,
  } = props

  const [showGlobalGapPanel, setShowGlobalGapPanel] = useState(false)
  const [showDurationRatioPanel, setShowDurationRatioPanel] = useState(false)
  const [showPageMarginPanel, setShowPageMarginPanel] = useState(false)
  return (
    <section className="spacing-panel">
      <div className="spacing-header">
        <h3>间距调节</h3>
        <div className="spacing-header-actions">
          <button
            type="button"
            className={`spacing-toggle-btn ${showGlobalGapPanel ? 'active' : ''}`}
            onClick={() => setShowGlobalGapPanel((current) => !current)}
          >间距大小</button>
          <button
            type="button"
            className={`spacing-toggle-btn ${showDurationRatioPanel ? 'active' : ''}`}
            onClick={() => setShowDurationRatioPanel((current) => !current)}
          >时值比例</button>
          <button
            type="button"
            className={`spacing-toggle-btn ${showPageMarginPanel ? 'active' : ''}`}
            onClick={() => setShowPageMarginPanel((current) => !current)}
          >
            边界距离
          </button>
          <button type="button" className="spacing-reset-btn" onClick={onResetSpacingConfig}>重置</button>
        </div>
      </div>
      {showGlobalGapPanel && (
        <ScoreSpacingGlobalGapSection
          chordMarkerUiScalePercent={chordMarkerUiScalePercent}
          chordMarkerPaddingPx={chordMarkerPaddingPx}
          staffInterGapPx={staffInterGapPx}
          baseMinGap32Px={baseMinGap32Px}
          leadingBarlineGapPx={leadingBarlineGapPx}
          secondChordSafeGapPx={secondChordSafeGapPx}
          onChordMarkerUiScalePercentChange={onChordMarkerUiScalePercentChange}
          onChordMarkerPaddingPxChange={onChordMarkerPaddingPxChange}
          onStaffInterGapPxChange={onStaffInterGapPxChange}
          onBaseMinGap32PxChange={onBaseMinGap32PxChange}
          onLeadingBarlineGapPxChange={onLeadingBarlineGapPxChange}
          onSecondChordSafeGapPxChange={onSecondChordSafeGapPxChange}
        />
      )}

      {showPageMarginPanel && (
        <ScoreSpacingMarginSection
          pageHorizontalPaddingPx={pageHorizontalPaddingPx}
          onPageHorizontalPaddingPxChange={onPageHorizontalPaddingPxChange}
        />
      )}

      {showDurationRatioPanel && (
        <ScoreSpacingDurationRatioSection
          durationGapRatio32={durationGapRatio32}
          durationGapRatio16={durationGapRatio16}
          durationGapRatio8={durationGapRatio8}
          durationGapRatio4={durationGapRatio4}
          durationGapRatio2={durationGapRatio2}
          durationGapRatioWhole={durationGapRatioWhole}
          onDurationGapRatio32Change={onDurationGapRatio32Change}
          onDurationGapRatio16Change={onDurationGapRatio16Change}
          onDurationGapRatio8Change={onDurationGapRatio8Change}
          onDurationGapRatio4Change={onDurationGapRatio4Change}
          onDurationGapRatio2Change={onDurationGapRatio2Change}
          onDurationGapRatioWholeChange={onDurationGapRatioWholeChange}
        />
      )}
    </section>
  )
}
