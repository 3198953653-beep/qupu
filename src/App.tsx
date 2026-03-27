import './App.css'
import {
  INITIAL_NOTES,
  PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
  PREVIEW_START_THRESHOLD_PX,
} from './score/constants'
import { useScoreViewProps } from './score/hooks/useScoreViewProps'
import { useHorizontalScoreLayout } from './score/hooks/useHorizontalScoreLayout'
import { useScoreAppState } from './score/hooks/useScoreAppState'
import { useScoreEditorRefs } from './score/hooks/useScoreEditorRefs'
import { useScoreCoreEditingController } from './score/hooks/useScoreCoreEditingController'
import { useScoreInteractionRuntimeController } from './score/hooks/useScoreInteractionRuntimeController'
import { ScoreControls } from './score/components/ScoreControls'
import { ScoreBoard } from './score/components/ScoreBoard'
import {
  createPianoPitches,
} from './score/pitchUtils'
import {
  buildBassMockNotes,
} from './score/scoreOps'
import { buildSelectionsForMeasureStaff } from './score/selectionBuilders'
import { ImportProgressModal } from './score/components/ImportProgressModal'
import { OsmdPreviewModal } from './score/components/OsmdPreviewModal'
import type { Pitch, ScoreNote } from './score/types'
import { Renderer } from 'vexflow'

const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const SCORE_STAGE_BORDER_PX = 1
const CHORD_HIGHLIGHT_PAD_X_PX = 4
const CHORD_HIGHLIGHT_PAD_Y_PX = 4

const PITCHES: Pitch[] = createPianoPitches()
const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)

function App() {
  const appState = useScoreAppState(INITIAL_BASS_NOTES)
  const {
    notes,
    bassNotes,
    activeSelection,
    selectedSelections,
    fullMeasureRestCollapseScopeKeys,
    isSelectionVisible,
    draggingSelection,
    importFeedback,
    measurePairsFromImport,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    importedChordRulerEntriesByPairFromImport,
  } = appState

  const editorRefs = useScoreEditorRefs({
    importFeedback,
    activeSelection,
    selectedSelections,
    fullMeasureRestCollapseScopeKeys,
    isSelectionVisible,
    draggingSelection,
  })
  const {
    horizontalRenderOffsetXRef,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
  } = editorRefs
  const layout = useHorizontalScoreLayout({
    notes,
    bassNotes,
    measurePairsFromImport,
    importedChordRulerEntriesByPairFromImport,
    measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport,
    autoScaleEnabled: appState.autoScaleEnabled,
    manualScalePercent: appState.manualScalePercent,
    canvasHeightPercent: appState.canvasHeightPercent,
    pageHorizontalPaddingPx: appState.pageHorizontalPaddingPx,
    chordMarkerUiScalePercent: appState.chordMarkerUiScalePercent,
    chordMarkerPaddingPx: appState.chordMarkerPaddingPx,
    timeAxisSpacingConfig: appState.timeAxisSpacingConfig,
    horizontalViewportXRange: appState.horizontalViewportXRange,
    widthProbeRendererRef,
    horizontalMeasureWidthCacheRef,
    horizontalRenderOffsetXRef,
  })
  const coreEditing = useScoreCoreEditingController({
    appState,
    editorRefs,
    layout,
    chordMarkerLabelLeftInsetPx: layout.chordMarkerStyleMetrics.labelLeftInsetPx,
    stageBorderPx: SCORE_STAGE_BORDER_PX,
    chordHighlightPadXPx: CHORD_HIGHLIGHT_PAD_X_PX,
    chordHighlightPadYPx: CHORD_HIGHLIGHT_PAD_Y_PX,
  })
  const runtime = useScoreInteractionRuntimeController({
    appState,
    editorRefs,
    layout,
    coreEditing,
    buildSelectionsForMeasureStaff,
    initialTrebleNotes: INITIAL_NOTES,
    initialBassNotes: INITIAL_BASS_NOTES,
    pitches: PITCHES,
    backend: SCORE_RENDER_BACKEND,
    previewDefaultAccidentalOffsetPx: PREVIEW_DEFAULT_ACCIDENTAL_OFFSET_PX,
    previewStartThresholdPx: PREVIEW_START_THRESHOLD_PX,
  })
  const { workspace, editorUi, playback } = runtime
  const {
    isImportLoading,
    importProgressPercent,
    isOsmdPreviewOpen,
    isOsmdPreviewExportingPdf,
    osmdPreviewStatusText,
    osmdPreviewError,
    osmdPreviewPageIndex,
    osmdPreviewPageCount,
    osmdPreviewShowPageNumbers,
    osmdPreviewZoomDraftPercent,
    safeOsmdPreviewPaperScalePercent,
    safeOsmdPreviewHorizontalMarginPx,
    safeOsmdPreviewFirstPageTopMarginPx,
    safeOsmdPreviewTopMarginPx,
    safeOsmdPreviewBottomMarginPx,
    osmdPreviewPaperScale,
    osmdPreviewPaperWidthPx,
    osmdPreviewPaperHeightPx,
    osmdPreviewContainerRef,
    closeOsmdPreview,
    exportOsmdPreviewPdf,
    goToPrevOsmdPreviewPage,
    goToNextOsmdPreviewPage,
    commitOsmdPreviewZoomPercent,
    scheduleOsmdPreviewZoomPercentCommit,
    onOsmdPreviewPaperScalePercentChange,
    onOsmdPreviewHorizontalMarginPxChange,
    onOsmdPreviewFirstPageTopMarginPxChange,
    onOsmdPreviewTopMarginPxChange,
    onOsmdPreviewBottomMarginPxChange,
    onOsmdPreviewShowPageNumbersChange,
    onOsmdPreviewSurfaceClick,
    onOsmdPreviewSurfaceDoubleClick,
  } = editorUi

  const { scoreControlsProps, scoreBoardProps } = useScoreViewProps({
    appState,
    editorRefs,
    layout,
    chordMarker: coreEditing.chordMarker,
    workspace,
    editorUi,
    playback,
  })

  return (
    <main className="app-shell">
      <ScoreControls {...scoreControlsProps} />

      <ScoreBoard {...scoreBoardProps} />

      <ImportProgressModal
        isOpen={isImportLoading}
        message={importFeedback.message}
        progressPercent={importProgressPercent}
      />

      <OsmdPreviewModal
        isOpen={isOsmdPreviewOpen}
        isExportingPdf={isOsmdPreviewExportingPdf}
        statusText={osmdPreviewStatusText}
        error={osmdPreviewError}
        pageIndex={osmdPreviewPageIndex}
        pageCount={osmdPreviewPageCount}
        showPageNumbers={osmdPreviewShowPageNumbers}
        zoomDraftPercent={osmdPreviewZoomDraftPercent}
        safePaperScalePercent={safeOsmdPreviewPaperScalePercent}
        safeHorizontalMarginPx={safeOsmdPreviewHorizontalMarginPx}
        safeFirstPageTopMarginPx={safeOsmdPreviewFirstPageTopMarginPx}
        safeTopMarginPx={safeOsmdPreviewTopMarginPx}
        safeBottomMarginPx={safeOsmdPreviewBottomMarginPx}
        paperScale={osmdPreviewPaperScale}
        paperWidthPx={osmdPreviewPaperWidthPx}
        paperHeightPx={osmdPreviewPaperHeightPx}
        containerRef={osmdPreviewContainerRef}
        closeOsmdPreview={closeOsmdPreview}
        exportOsmdPreviewPdf={exportOsmdPreviewPdf}
        goToPrevOsmdPreviewPage={goToPrevOsmdPreviewPage}
        goToNextOsmdPreviewPage={goToNextOsmdPreviewPage}
        commitOsmdPreviewZoomPercent={commitOsmdPreviewZoomPercent}
        scheduleOsmdPreviewZoomPercentCommit={scheduleOsmdPreviewZoomPercentCommit}
        onOsmdPreviewPaperScalePercentChange={onOsmdPreviewPaperScalePercentChange}
        onOsmdPreviewHorizontalMarginPxChange={onOsmdPreviewHorizontalMarginPxChange}
        onOsmdPreviewFirstPageTopMarginPxChange={onOsmdPreviewFirstPageTopMarginPxChange}
        onOsmdPreviewTopMarginPxChange={onOsmdPreviewTopMarginPxChange}
        onOsmdPreviewBottomMarginPxChange={onOsmdPreviewBottomMarginPxChange}
        onOsmdPreviewShowPageNumbersChange={onOsmdPreviewShowPageNumbersChange}
        onOsmdPreviewSurfaceClick={onOsmdPreviewSurfaceClick}
        onOsmdPreviewSurfaceDoubleClick={onOsmdPreviewSurfaceDoubleClick}
      />
    </main>
  )
}

export default App


