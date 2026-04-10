import './App.css'
import { useCallback, useState } from 'react'
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
import { NativePreviewModal } from './score/components/NativePreviewModal'
import { RhythmTemplateLoadModal } from './score/components/RhythmTemplateLoadModal'
import { SmartChordToneModal } from './score/components/SmartChordToneModal'
import { PedalApplyModal } from './score/components/PedalApplyModal'
import { PlaybackVolumeModal } from './score/components/PlaybackVolumeModal'
import { AccompanimentNoteModal } from './score/components/AccompanimentNoteModal'
import { DatabaseWorkspacePage } from './database/DatabaseWorkspacePage'
import { clampPlaybackVolumePercent } from './score/playbackVolume'
import type { Pitch, ScoreNote } from './score/types'
import { Renderer } from 'vexflow'

const SCORE_RENDER_BACKEND = Renderer.Backends.CANVAS
const SCORE_STAGE_BORDER_PX = 1
const CHORD_HIGHLIGHT_PAD_X_PX = 4
const CHORD_HIGHLIGHT_PAD_Y_PX = 4
const DEFAULT_SELECTION_HIGHLIGHT_OPACITY_PERCENT = 42
const MIN_SELECTION_HIGHLIGHT_OPACITY_PERCENT = 10
const MAX_SELECTION_HIGHLIGHT_OPACITY_PERCENT = 80

const PITCHES: Pitch[] = createPianoPitches()
const INITIAL_BASS_NOTES: ScoreNote[] = buildBassMockNotes(INITIAL_NOTES)
type WorkspacePage = 'editor' | 'database'
const WORKSPACE_PAGE_LABELS: Record<WorkspacePage, string> = {
  editor: '编辑曲谱',
  database: '数据库',
}

function App() {
  const [selectionHighlightOpacityPercent, setSelectionHighlightOpacityPercent] = useState(
    DEFAULT_SELECTION_HIGHLIGHT_OPACITY_PERCENT,
  )
  const [activeWorkspacePage, setActiveWorkspacePage] = useState<WorkspacePage>('editor')
  const appState = useScoreAppState(INITIAL_BASS_NOTES)
  const openWorkspacePage = useCallback((page: WorkspacePage) => {
    setActiveWorkspacePage(page)
  }, [])

  const editorRefs = useScoreEditorRefs({
    importFeedback: appState.importFeedback,
    activeSelection: appState.activeSelection,
    activePedalSelection: appState.activePedalSelection,
    pedalSpans: appState.pedalSpans,
    selectedSelections: appState.selectedSelections,
    fullMeasureRestCollapseScopeKeys: appState.fullMeasureRestCollapseScopeKeys,
    isSelectionVisible: appState.isSelectionVisible,
    draggingSelection: appState.draggingSelection,
  })

  const layout = useHorizontalScoreLayout({
    notes: appState.notes,
    bassNotes: appState.bassNotes,
    measurePairsFromImport: appState.measurePairsFromImport,
    importedChordRulerEntriesByPairFromImport: appState.importedChordRulerEntriesByPairFromImport,
    measureKeyFifthsFromImport: appState.measureKeyFifthsFromImport,
    measureTimeSignaturesFromImport: appState.measureTimeSignaturesFromImport,
    pedalSpans: appState.pedalSpans,
    autoScaleEnabled: appState.autoScaleEnabled,
    manualScalePercent: appState.manualScalePercent,
    canvasHeightPercent: appState.canvasHeightPercent,
    staffInterGapPx: appState.staffInterGapPx,
    pageHorizontalPaddingPx: appState.pageHorizontalPaddingPx,
    chordMarkerUiScalePercent: appState.chordMarkerUiScalePercent,
    chordMarkerPaddingPx: appState.chordMarkerPaddingPx,
    timeAxisSpacingConfig: appState.timeAxisSpacingConfig,
    horizontalViewportXRange: appState.horizontalViewportXRange,
    widthProbeRendererRef: editorRefs.widthProbeRendererRef,
    horizontalMeasureWidthCacheRef: editorRefs.horizontalMeasureWidthCacheRef,
    horizontalRenderOffsetXRef: editorRefs.horizontalRenderOffsetXRef,
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
    isWorkspaceBlocked: activeWorkspacePage === 'database',
  })
  const {
    workspace,
    editorUi,
    playback,
    smartChordToneDialog,
    accompanimentNoteDialog,
    accompanimentPreviewPlayback,
    rhythmTemplateLoadModal,
    pedalApplyDialog,
    canOpenPedalModal,
    openPedalModal,
    playbackVolumeDialog,
    openPlaybackVolumeModal,
  } = runtime

  const { scoreControlsProps, scoreBoardProps } = useScoreViewProps({
    appState,
    editorRefs,
    layout,
    chordMarker: coreEditing.chordMarker,
    workspace,
    editorUi,
    playback,
    pedalApplyDialog,
    canOpenPedalModal,
    openPedalModal,
    playbackVolumeDialog,
    openPlaybackVolumeModal,
  })

  return (
    <main
      className={activeWorkspacePage === 'database' ? 'app-shell app-shell--database' : 'app-shell'}
      style={{
        ['--selection-highlight-alpha' as string]: `${selectionHighlightOpacityPercent / 100}`,
      }}
    >
      <header className="workspace-switcher" aria-label="全局页面切换">
        {(Object.keys(WORKSPACE_PAGE_LABELS) as WorkspacePage[]).map((page) => (
          <button
            key={page}
            type="button"
            className={activeWorkspacePage === page ? 'is-active' : ''}
            aria-pressed={activeWorkspacePage === page}
            onClick={() => openWorkspacePage(page)}
          >
            {WORKSPACE_PAGE_LABELS[page]}
          </button>
        ))}
      </header>

      <section className="editor-workspace" hidden={activeWorkspacePage !== 'editor'}>
        <section className="scale-row selection-highlight-opacity-row">
          <label htmlFor="selection-highlight-opacity-range">蓝框透明度</label>
          <input
            id="selection-highlight-opacity-range"
            type="range"
            min={MIN_SELECTION_HIGHLIGHT_OPACITY_PERCENT}
            max={MAX_SELECTION_HIGHLIGHT_OPACITY_PERCENT}
            step={1}
            value={selectionHighlightOpacityPercent}
            onInput={(event) => setSelectionHighlightOpacityPercent(Number((event.target as HTMLInputElement).value))}
            onChange={(event) => setSelectionHighlightOpacityPercent(Number(event.target.value))}
          />
          <input
            className="scale-percent-input"
            type="number"
            min={MIN_SELECTION_HIGHLIGHT_OPACITY_PERCENT}
            max={MAX_SELECTION_HIGHLIGHT_OPACITY_PERCENT}
            step={1}
            value={selectionHighlightOpacityPercent}
            onInput={(event) => setSelectionHighlightOpacityPercent(Number((event.target as HTMLInputElement).value))}
            onChange={(event) => setSelectionHighlightOpacityPercent(Number(event.target.value))}
          />
          <span className="scale-percent-label">%</span>
        </section>

        <ScoreControls {...scoreControlsProps} />

        <ScoreBoard {...scoreBoardProps} />

        <ImportProgressModal
          isOpen={editorUi.isImportLoading}
          message={appState.importFeedback.message}
          progressPercent={editorUi.importProgressPercent}
        />

        <OsmdPreviewModal
          isOpen={editorUi.isOsmdPreviewOpen}
          isExportingPdf={editorUi.isOsmdPreviewExportingPdf}
          statusText={editorUi.osmdPreviewStatusText}
          error={editorUi.osmdPreviewError}
          pageIndex={editorUi.osmdPreviewPageIndex}
          pageCount={editorUi.osmdPreviewPageCount}
          showPageNumbers={editorUi.osmdPreviewShowPageNumbers}
          zoomDraftPercent={editorUi.osmdPreviewZoomDraftPercent}
          safePaperScalePercent={editorUi.safeOsmdPreviewPaperScalePercent}
          safeHorizontalMarginPx={editorUi.safeOsmdPreviewHorizontalMarginPx}
          safeFirstPageTopMarginPx={editorUi.safeOsmdPreviewFirstPageTopMarginPx}
          safeTopMarginPx={editorUi.safeOsmdPreviewTopMarginPx}
          safeBottomMarginPx={editorUi.safeOsmdPreviewBottomMarginPx}
          paperScale={editorUi.osmdPreviewPaperScale}
          paperWidthPx={editorUi.osmdPreviewPaperWidthPx}
          paperHeightPx={editorUi.osmdPreviewPaperHeightPx}
          containerRef={editorUi.osmdPreviewContainerRef}
          closeOsmdPreview={editorUi.closeOsmdPreview}
          exportOsmdPreviewPdf={editorUi.exportOsmdPreviewPdf}
          goToPrevOsmdPreviewPage={editorUi.goToPrevOsmdPreviewPage}
          goToNextOsmdPreviewPage={editorUi.goToNextOsmdPreviewPage}
          commitOsmdPreviewZoomPercent={editorUi.commitOsmdPreviewZoomPercent}
          scheduleOsmdPreviewZoomPercentCommit={editorUi.scheduleOsmdPreviewZoomPercentCommit}
          onOsmdPreviewPaperScalePercentChange={editorUi.onOsmdPreviewPaperScalePercentChange}
          onOsmdPreviewHorizontalMarginPxChange={editorUi.onOsmdPreviewHorizontalMarginPxChange}
          onOsmdPreviewFirstPageTopMarginPxChange={editorUi.onOsmdPreviewFirstPageTopMarginPxChange}
          onOsmdPreviewTopMarginPxChange={editorUi.onOsmdPreviewTopMarginPxChange}
          onOsmdPreviewBottomMarginPxChange={editorUi.onOsmdPreviewBottomMarginPxChange}
          onOsmdPreviewShowPageNumbersChange={editorUi.onOsmdPreviewShowPageNumbersChange}
          onOsmdPreviewSurfaceClick={editorUi.onOsmdPreviewSurfaceClick}
          onOsmdPreviewSurfaceDoubleClick={editorUi.onOsmdPreviewSurfaceDoubleClick}
        />

        <NativePreviewModal
          isOpen={editorUi.isNativePreviewOpen}
          error={editorUi.nativePreviewError}
          statusText={editorUi.nativePreviewStatusText}
          pageIndex={editorUi.nativePreviewPageIndex}
          pageCount={editorUi.nativePreviewPageCount}
          showPageNumbers={editorUi.nativePreviewShowPageNumbers}
          zoomDraftPercent={editorUi.nativePreviewZoomDraftPercent}
          safeZoomPercent={editorUi.safeNativePreviewZoomPercent}
          safePaperScalePercent={editorUi.safeNativePreviewPaperScalePercent}
          safeHorizontalMarginPx={editorUi.safeNativePreviewHorizontalMarginPx}
          safeFirstPageTopMarginPx={editorUi.safeNativePreviewFirstPageTopMarginPx}
          safeTopMarginPx={editorUi.safeNativePreviewTopMarginPx}
          safeBottomMarginPx={editorUi.safeNativePreviewBottomMarginPx}
          safeMinEighthGapPx={editorUi.safeNativePreviewMinEighthGapPx}
          safeMinGrandStaffGapPx={editorUi.safeNativePreviewMinGrandStaffGapPx}
          paperScale={editorUi.nativePreviewPaperScale}
          paperWidthPx={editorUi.nativePreviewPaperWidthPx}
          paperHeightPx={editorUi.nativePreviewPaperHeightPx}
          currentPage={editorUi.nativePreviewCurrentPage}
          metadata={editorUi.nativePreviewMetadata}
          measurePairs={editorUi.nativePreviewMeasurePairs}
          pedalSpans={editorUi.nativePreviewPedalSpans}
          chordRulerEntriesByPair={editorUi.nativePreviewChordRulerEntriesByPair}
          measureKeyFifthsFromImport={editorUi.nativePreviewMeasureKeyFifthsFromImport}
          measureTimeSignaturesFromImport={editorUi.nativePreviewMeasureTimeSignaturesFromImport}
          supplementalSpacingTicksByPair={editorUi.nativePreviewSupplementalSpacingTicksByPair}
          timeAxisSpacingConfig={editorUi.nativePreviewTimeAxisSpacingConfig}
          grandStaffLayoutMetrics={editorUi.nativePreviewGrandStaffLayoutMetrics}
          showInScoreMeasureNumbers={editorUi.nativePreviewShowInScoreMeasureNumbers}
          showNoteHeadJianpuEnabled={editorUi.nativePreviewShowNoteHeadJianpuEnabled}
          onNativePreviewPageRenderedDiagnostics={editorUi.onNativePreviewPageRenderedDiagnostics}
          closeNativePreview={editorUi.closeNativePreview}
          goToPrevNativePreviewPage={editorUi.goToPrevNativePreviewPage}
          goToNextNativePreviewPage={editorUi.goToNextNativePreviewPage}
          commitNativePreviewZoomPercent={editorUi.commitNativePreviewZoomPercent}
          scheduleNativePreviewZoomPercentCommit={editorUi.scheduleNativePreviewZoomPercentCommit}
          onNativePreviewPaperScalePercentChange={editorUi.onNativePreviewPaperScalePercentChange}
          onNativePreviewHorizontalMarginPxChange={editorUi.onNativePreviewHorizontalMarginPxChange}
          onNativePreviewFirstPageTopMarginPxChange={editorUi.onNativePreviewFirstPageTopMarginPxChange}
          onNativePreviewTopMarginPxChange={editorUi.onNativePreviewTopMarginPxChange}
          onNativePreviewBottomMarginPxChange={editorUi.onNativePreviewBottomMarginPxChange}
          onNativePreviewMinEighthGapPxChange={editorUi.onNativePreviewMinEighthGapPxChange}
          onNativePreviewMinGrandStaffGapPxChange={editorUi.onNativePreviewMinGrandStaffGapPxChange}
          onNativePreviewShowPageNumbersChange={editorUi.onNativePreviewShowPageNumbersChange}
        />

        <SmartChordToneModal
          isOpen={smartChordToneDialog.isOpen}
          target={smartChordToneDialog.target}
          octaveOption={smartChordToneDialog.octaveOption}
          chordCountOption={smartChordToneDialog.chordCountOption}
          filterOptions={smartChordToneDialog.filterOptions}
          candidates={smartChordToneDialog.candidates}
          selectedCandidateKey={smartChordToneDialog.selectedCandidateKey}
          timeAxisSpacingConfig={appState.timeAxisSpacingConfig}
          spacingLayoutMode={layout.spacingLayoutMode}
          grandStaffLayoutMetrics={layout.grandStaffLayoutMetrics}
          onClose={smartChordToneDialog.closeSmartChordToneDialog}
          onToggleOctaveOption={smartChordToneDialog.toggleOctaveOption}
          onToggleChordCountOption={smartChordToneDialog.toggleChordCountOption}
          onToggleFilterOption={smartChordToneDialog.toggleFilterOption}
          onPreviewCandidate={smartChordToneDialog.previewCandidate}
          onApplyCandidate={smartChordToneDialog.applyCandidate}
        />

        <AccompanimentNoteModal
          isOpen={accompanimentNoteDialog.isOpen}
          target={
            accompanimentNoteDialog.target
              ? {
                  measureNumber: accompanimentNoteDialog.target.measureNumber,
                  chordName: accompanimentNoteDialog.target.chordName,
                  keyFifths: accompanimentNoteDialog.target.keyFifths,
                }
              : null
          }
          previewCandidates={accompanimentNoteDialog.previewCandidates}
          candidateMeasureMap={accompanimentNoteDialog.candidateMeasureMap}
          selectedCandidateKey={accompanimentNoteDialog.selectedCandidateKey}
          timeAxisSpacingConfig={appState.timeAxisSpacingConfig}
          spacingLayoutMode={layout.spacingLayoutMode}
          grandStaffLayoutMetrics={layout.grandStaffLayoutMetrics}
          showNoteHeadJianpuEnabled={appState.showNoteHeadJianpuEnabled}
          accompanimentPreviewPlayback={accompanimentPreviewPlayback}
          errorMessage={accompanimentNoteDialog.errorMessage}
          onClose={accompanimentNoteDialog.closeDialog}
          onPreviewCandidate={(candidateKey) => {
            void accompanimentNoteDialog.previewCandidate(candidateKey)
          }}
          onApplyCandidate={(candidateKey) => {
            void accompanimentNoteDialog.applyCandidate(candidateKey)
          }}
        />

        <RhythmTemplateLoadModal
          isOpen={rhythmTemplateLoadModal.isOpen}
          scope={rhythmTemplateLoadModal.scope}
          durationCombo={rhythmTemplateLoadModal.durationCombo}
          isLoading={rhythmTemplateLoadModal.isLoading}
          isApplying={rhythmTemplateLoadModal.isApplying}
          errorMessage={rhythmTemplateLoadModal.errorMessage}
          difficultyOptions={rhythmTemplateLoadModal.difficultyOptions}
          styleOptions={rhythmTemplateLoadModal.styleOptions}
          filteredTemplateRows={rhythmTemplateLoadModal.filteredTemplateRows}
          selectedDifficulty={rhythmTemplateLoadModal.selectedDifficulty}
          selectedStyles={rhythmTemplateLoadModal.selectedStyles}
          selectedTemplateId={rhythmTemplateLoadModal.selectedTemplateId}
          onClose={rhythmTemplateLoadModal.closeModal}
          onSelectDifficulty={rhythmTemplateLoadModal.setSelectedDifficulty}
          onToggleStyle={rhythmTemplateLoadModal.toggleStyleFilter}
          onSelectTemplate={rhythmTemplateLoadModal.setSelectedTemplateId}
          onApplyTemplate={() => {
            void rhythmTemplateLoadModal.applySelectedTemplate()
          }}
          onTemplateDoubleClick={rhythmTemplateLoadModal.handleTemplateDoubleClick}
        />

        <PedalApplyModal
          isOpen={pedalApplyDialog.isOpen}
          selectedScope={pedalApplyDialog.selectedScope}
          selectedLayoutMode={pedalApplyDialog.selectedLayoutMode}
          scopeOptions={pedalApplyDialog.scopeOptions}
          layoutModeOptions={pedalApplyDialog.layoutModeOptions}
          scopeSummary={pedalApplyDialog.scopeSummary}
          chordCountInScope={pedalApplyDialog.chordCountInScope}
          hasExistingSpansInScope={pedalApplyDialog.hasExistingSpansInScope}
          styleOptions={pedalApplyDialog.styleOptions}
          onClose={pedalApplyDialog.closeModal}
          onSelectScope={pedalApplyDialog.setSelectedScope}
          onSelectLayoutMode={pedalApplyDialog.setSelectedLayoutMode}
          onApplyStyle={pedalApplyDialog.applyStyle}
        />

        <PlaybackVolumeModal
          isOpen={playbackVolumeDialog.isOpen}
          trebleVolumePercent={appState.playbackTrebleVolumePercent}
          bassVolumePercent={appState.playbackBassVolumePercent}
          onTrebleVolumePercentChange={(nextValue) => {
            appState.setPlaybackTrebleVolumePercent(clampPlaybackVolumePercent(nextValue))
          }}
          onBassVolumePercentChange={(nextValue) => {
            appState.setPlaybackBassVolumePercent(clampPlaybackVolumePercent(nextValue))
          }}
          onReset={playbackVolumeDialog.resetVolumes}
          onClose={playbackVolumeDialog.closeModal}
        />
      </section>

      <DatabaseWorkspacePage
        isVisible={activeWorkspacePage === 'database'}
        timeAxisSpacingConfig={appState.timeAxisSpacingConfig}
        spacingLayoutMode={layout.spacingLayoutMode}
        grandStaffLayoutMetrics={layout.grandStaffLayoutMetrics}
      />
    </main>
  )
}

export default App


