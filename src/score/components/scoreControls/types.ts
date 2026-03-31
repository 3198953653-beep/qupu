import type { ChangeEvent, RefObject } from 'react'
import type { BuiltInDemoMode, ImportFeedback, RhythmPresetId } from '../../types'
import type { NotationPaletteItem, NotationPaletteSelection } from '../../notationPaletteConfig'

export type ScoreControlsProps = {
  isPlaying: boolean
  onPlayScore: () => void
  onStopScore: () => void
  onOpenPlaybackVolumeModal: () => void
  onReset: () => void
  playheadFollowEnabled: boolean
  onTogglePlayheadFollow: () => void
  showChordDegreeEnabled: boolean
  onToggleChordDegreeDisplay: () => void
  showChordMarkerBackgroundEnabled: boolean
  onToggleChordMarkerBackgroundDisplay: () => void
  staffInterGapPx: number
  onStaffInterGapPxChange: (nextValue: number) => void
  showInScoreMeasureNumbers: boolean
  onToggleInScoreMeasureNumbers: () => void
  showNoteHeadJianpuEnabled: boolean
  onToggleNoteHeadJianpuDisplay: () => void
  onOpenMusicXmlFilePicker: () => void
  onLoadWholeNoteDemo: () => void
  onLoadHalfNoteDemo: () => void
  onExportMusicXmlFile: () => void
  onOpenOsmdPreview: () => void
  onOpenBeamGroupingTool: () => void
  canOpenPedalModal: boolean
  onOpenPedalModal: () => void
  isNotationPaletteOpen: boolean
  onToggleNotationPalette: () => void
  onCloseNotationPalette: () => void
  notationPaletteSelection: NotationPaletteSelection
  notationPaletteLastAction: string
  notationPaletteActiveItemIdsOverride?: ReadonlySet<string> | null
  notationPaletteSummaryOverride?: string | null
  onNotationPaletteSelectionChange: (
    next: NotationPaletteSelection,
    actionLabel: string,
    item: NotationPaletteItem,
  ) => void
  onOpenDirectOsmdFilePicker: () => void
  midiSupported: boolean
  midiPermissionState: 'idle' | 'granted' | 'denied' | 'unsupported' | 'error'
  midiInputOptions: Array<{ id: string; name: string }>
  selectedMidiInputId: string
  onSelectedMidiInputIdChange: (id: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  osmdDirectFileInputRef: RefObject<HTMLInputElement | null>
  onMusicXmlFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onOsmdDirectFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  importFeedback: ImportFeedback
  rhythmPreset: RhythmPresetId
  activeBuiltInDemo: BuiltInDemoMode
  onApplyRhythmPreset: (presetId: RhythmPresetId) => void
  autoScaleEnabled: boolean
  autoScalePercent: number
  onToggleAutoScale: () => void
  manualScalePercent: number
  onManualScalePercentChange: (nextPercent: number) => void
  canvasHeightPercent: number
  onCanvasHeightPercentChange: (nextPercent: number) => void
  pageHorizontalPaddingPx: number
  chordMarkerUiScalePercent: number
  chordMarkerPaddingPx: number
  baseMinGap32Px: number
  leadingBarlineGapPx: number
  secondChordSafeGapPx: number
  durationGapRatio32: number
  durationGapRatio16: number
  durationGapRatio8: number
  durationGapRatio4: number
  durationGapRatio2: number
  durationGapRatioWhole: number
  onPageHorizontalPaddingPxChange: (nextValue: number) => void
  onChordMarkerUiScalePercentChange: (nextValue: number) => void
  onChordMarkerPaddingPxChange: (nextValue: number) => void
  onBaseMinGap32PxChange: (nextValue: number) => void
  onLeadingBarlineGapPxChange: (nextValue: number) => void
  onSecondChordSafeGapPxChange: (nextValue: number) => void
  onDurationGapRatio32Change: (nextValue: number) => void
  onDurationGapRatio16Change: (nextValue: number) => void
  onDurationGapRatio8Change: (nextValue: number) => void
  onDurationGapRatio4Change: (nextValue: number) => void
  onDurationGapRatio2Change: (nextValue: number) => void
  onDurationGapRatioWholeChange: (nextValue: number) => void
  onResetSpacingConfig: () => void
}
