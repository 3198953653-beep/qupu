import {
  useRef,
  type ChangeEvent,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type {
  ImportedNoteLocation,
  MeasureFrame,
  MeasurePair,
  MusicXmlMetadata,
  NoteLayout,
  PedalSpan,
  Selection,
  TimeSignature,
} from '../types'
import { useOsmdPreviewNavigation } from './useOsmdPreviewNavigation'
import { useOsmdPreviewExportActions } from './useOsmdPreviewExportActions'
import { useOsmdPreviewLifecycle } from './useOsmdPreviewLifecycle'
import { useOsmdPreviewRenderRuntime } from './useOsmdPreviewRenderRuntime'
import { useOsmdPreviewSettings } from './useOsmdPreviewSettings'
import {
  buildOsmdPreviewSystemMetrics,
} from './osmdPreviewUtils'

export type {
  OsmdPreviewInstance,
  OsmdPreviewRebalanceStats,
  OsmdPreviewSelectionTarget,
} from './osmdPreviewUtils'

type StateSetter<T> = Dispatch<SetStateAction<T>>

export function useOsmdPreviewController(params: {
  measurePairs: MeasurePair[]
  pedalSpans: PedalSpan[]
  measurePairsRef: MutableRefObject<MeasurePair[]>
  measureKeyFifthsFromImportRef: MutableRefObject<number[] | null>
  measureDivisionsFromImportRef: MutableRefObject<number[] | null>
  measureTimeSignaturesFromImportRef: MutableRefObject<TimeSignature[] | null>
  musicXmlMetadataFromImportRef: MutableRefObject<MusicXmlMetadata | null>
  importedNoteLookupRef: MutableRefObject<Map<string, ImportedNoteLocation>>
  horizontalMeasureFramesByPair: MeasureFrame[]
  noteLayoutsByPairRef: MutableRefObject<Map<number, NoteLayout[]>>
  noteLayoutByKeyRef: MutableRefObject<Map<string, NoteLayout>>
  horizontalRenderOffsetXRef: MutableRefObject<number>
  scoreScrollRef: MutableRefObject<HTMLDivElement | null>
  scoreScaleX: number
  setIsSelectionVisible: StateSetter<boolean>
  setActiveSelection: StateSetter<Selection>
  setSelectedSelections: StateSetter<Selection[]>
  setDraggingSelection: StateSetter<Selection | null>
  setSelectedMeasureScope: StateSetter<{ pairIndex: number; staff: Selection['staff'] } | null>
  clearActiveChordSelection: () => void
  resetMidiStepChain: () => void
}): {
  isOsmdPreviewOpen: boolean
  isOsmdPreviewExportingPdf: boolean
  osmdPreviewStatusText: string
  osmdPreviewError: string
  osmdPreviewPageIndex: number
  osmdPreviewPageCount: number
  osmdPreviewShowPageNumbers: boolean
  osmdPreviewZoomDraftPercent: number
  safeOsmdPreviewPaperScalePercent: number
  safeOsmdPreviewHorizontalMarginPx: number
  safeOsmdPreviewFirstPageTopMarginPx: number
  safeOsmdPreviewTopMarginPx: number
  safeOsmdPreviewBottomMarginPx: number
  osmdPreviewPaperScale: number
  osmdPreviewPaperWidthPx: number
  osmdPreviewPaperHeightPx: number
  osmdPreviewContainerRef: MutableRefObject<HTMLDivElement | null>
  osmdDirectFileInputRef: MutableRefObject<HTMLInputElement | null>
  osmdPreviewInstanceRef: ReturnType<typeof useOsmdPreviewSettings>['osmdPreviewInstanceRef']
  osmdPreviewLastRebalanceStatsRef: ReturnType<typeof useOsmdPreviewSettings>['osmdPreviewLastRebalanceStatsRef']
  osmdPreviewNoteLookupBySelectionRef: ReturnType<typeof useOsmdPreviewNavigation>['osmdPreviewNoteLookupBySelectionRef']
  osmdPreviewSelectedSelectionKeyRef: ReturnType<typeof useOsmdPreviewNavigation>['osmdPreviewSelectedSelectionKeyRef']
  closeOsmdPreview: () => void
  openOsmdPreview: () => void
  openDirectOsmdFilePicker: () => void
  onOsmdDirectFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  exportOsmdPreviewPdf: () => Promise<void>
  goToPrevOsmdPreviewPage: () => void
  goToNextOsmdPreviewPage: () => void
  commitOsmdPreviewZoomPercent: (nextValue: number) => void
  scheduleOsmdPreviewZoomPercentCommit: (nextValue: number) => void
  onOsmdPreviewPaperScalePercentChange: (nextValue: number) => void
  onOsmdPreviewHorizontalMarginPxChange: (nextValue: number) => void
  onOsmdPreviewFirstPageTopMarginPxChange: (nextValue: number) => void
  onOsmdPreviewTopMarginPxChange: (nextValue: number) => void
  onOsmdPreviewBottomMarginPxChange: (nextValue: number) => void
  onOsmdPreviewShowPageNumbersChange: (nextVisible: boolean) => void
  onOsmdPreviewSurfaceClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onOsmdPreviewSurfaceDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  dumpOsmdPreviewSystemMetrics: () => ReturnType<typeof buildOsmdPreviewSystemMetrics>
} {
  const {
    measurePairs,
    pedalSpans,
    measurePairsRef,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImportRef,
    importedNoteLookupRef,
    horizontalMeasureFramesByPair,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    scoreScrollRef,
    scoreScaleX,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setDraggingSelection,
    setSelectedMeasureScope,
    clearActiveChordSelection,
    resetMidiStepChain,
  } = params

  const settings = useOsmdPreviewSettings()
  const closeOsmdPreviewRef = useRef<(() => void) | null>(null)
  const navigation = useOsmdPreviewNavigation({
    measurePairs,
    measurePairsRef,
    importedNoteLookupRef,
    horizontalMeasureFramesByPair,
    noteLayoutsByPairRef,
    noteLayoutByKeyRef,
    horizontalRenderOffsetXRef,
    scoreScrollRef,
    scoreScaleX,
    osmdPreviewSourceMode: settings.osmdPreviewSourceMode,
    osmdPreviewContainerRef: settings.osmdPreviewContainerRef,
    osmdPreviewInstanceRef: settings.osmdPreviewInstanceRef,
    closeOsmdPreviewRef,
    resetMidiStepChain,
    setIsSelectionVisible,
    setActiveSelection,
    setSelectedSelections,
    setDraggingSelection,
    setSelectedMeasureScope,
    clearActiveChordSelection,
  })
  const lifecycle = useOsmdPreviewLifecycle({
    measurePairs,
    pedalSpans,
    measureKeyFifthsFromImportRef,
    measureDivisionsFromImportRef,
    measureTimeSignaturesFromImportRef,
    musicXmlMetadataFromImportRef,
    settings,
    navigation,
    closeOsmdPreviewRef,
  })
  const renderRuntime = useOsmdPreviewRenderRuntime({
    settings,
    navigation,
  })
  const exportActions = useOsmdPreviewExportActions({
    musicXmlMetadataFromImportRef,
    settings,
  })

  return {
    isOsmdPreviewOpen: settings.isOsmdPreviewOpen,
    isOsmdPreviewExportingPdf: settings.isOsmdPreviewExportingPdf,
    osmdPreviewStatusText: settings.osmdPreviewStatusText,
    osmdPreviewError: settings.osmdPreviewError,
    osmdPreviewPageIndex: settings.osmdPreviewPageIndex,
    osmdPreviewPageCount: settings.osmdPreviewPageCount,
    osmdPreviewShowPageNumbers: settings.osmdPreviewShowPageNumbers,
    osmdPreviewZoomDraftPercent: settings.osmdPreviewZoomDraftPercent,
    safeOsmdPreviewPaperScalePercent: settings.safeOsmdPreviewPaperScalePercent,
    safeOsmdPreviewHorizontalMarginPx: settings.safeOsmdPreviewHorizontalMarginPx,
    safeOsmdPreviewFirstPageTopMarginPx: settings.safeOsmdPreviewFirstPageTopMarginPx,
    safeOsmdPreviewTopMarginPx: settings.safeOsmdPreviewTopMarginPx,
    safeOsmdPreviewBottomMarginPx: settings.safeOsmdPreviewBottomMarginPx,
    osmdPreviewPaperScale: settings.osmdPreviewPaperScale,
    osmdPreviewPaperWidthPx: settings.osmdPreviewPaperWidthPx,
    osmdPreviewPaperHeightPx: settings.osmdPreviewPaperHeightPx,
    osmdPreviewContainerRef: settings.osmdPreviewContainerRef,
    osmdDirectFileInputRef: settings.osmdDirectFileInputRef,
    osmdPreviewInstanceRef: settings.osmdPreviewInstanceRef,
    osmdPreviewLastRebalanceStatsRef: settings.osmdPreviewLastRebalanceStatsRef,
    osmdPreviewNoteLookupBySelectionRef: navigation.osmdPreviewNoteLookupBySelectionRef,
    osmdPreviewSelectedSelectionKeyRef: navigation.osmdPreviewSelectedSelectionKeyRef,
    closeOsmdPreview: lifecycle.closeOsmdPreview,
    openOsmdPreview: lifecycle.openOsmdPreview,
    openDirectOsmdFilePicker: lifecycle.openDirectOsmdFilePicker,
    onOsmdDirectFileChange: lifecycle.onOsmdDirectFileChange,
    exportOsmdPreviewPdf: exportActions.exportOsmdPreviewPdf,
    goToPrevOsmdPreviewPage: settings.goToPrevOsmdPreviewPage,
    goToNextOsmdPreviewPage: settings.goToNextOsmdPreviewPage,
    commitOsmdPreviewZoomPercent: settings.commitOsmdPreviewZoomPercent,
    scheduleOsmdPreviewZoomPercentCommit: settings.scheduleOsmdPreviewZoomPercentCommit,
    onOsmdPreviewPaperScalePercentChange: settings.onOsmdPreviewPaperScalePercentChange,
    onOsmdPreviewHorizontalMarginPxChange: settings.onOsmdPreviewHorizontalMarginPxChange,
    onOsmdPreviewFirstPageTopMarginPxChange: settings.onOsmdPreviewFirstPageTopMarginPxChange,
    onOsmdPreviewTopMarginPxChange: settings.onOsmdPreviewTopMarginPxChange,
    onOsmdPreviewBottomMarginPxChange: settings.onOsmdPreviewBottomMarginPxChange,
    onOsmdPreviewShowPageNumbersChange: settings.onOsmdPreviewShowPageNumbersChange,
    onOsmdPreviewSurfaceClick: navigation.onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick: navigation.onOsmdPreviewSurfaceDoubleClick,
    dumpOsmdPreviewSystemMetrics: renderRuntime.dumpOsmdPreviewSystemMetrics,
  }
}
