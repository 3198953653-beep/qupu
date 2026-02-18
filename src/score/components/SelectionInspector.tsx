export function SelectionInspector(props: {
  selectedStaffLabel: string
  selectedPitchLabel: string
  selectedDurationLabel: string
  selectedPosition: number
  selectedPoolSize: number
  trebleSequenceText: string
  bassSequenceText: string
  dragDebugReport: string
  onDumpDragLog: () => void
  onClearDragLog: () => void
  measureEdgeDebugReport: string
  onDumpMeasureEdgeLog: () => void
  onClearMeasureEdgeLog: () => void
}) {
  const {
    selectedStaffLabel,
    selectedPitchLabel,
    selectedDurationLabel,
    selectedPosition,
    selectedPoolSize,
    trebleSequenceText,
    bassSequenceText,
    dragDebugReport,
    onDumpDragLog,
    onClearDragLog,
    measureEdgeDebugReport,
    onDumpMeasureEdgeLog,
    onClearMeasureEdgeLog,
  } = props

  return (
    <div className="inspector">
      <h2>Selected Note</h2>
      <p>
        Staff: <strong>{selectedStaffLabel}</strong>
      </p>
      <p>
        Pitch: <strong>{selectedPitchLabel}</strong>
      </p>
      <p>
        Duration: <strong>{selectedDurationLabel}</strong>
      </p>
      <p>
        Position: <strong>{selectedPosition}</strong> / {selectedPoolSize}
      </p>
      <p className="sequence">Treble: {trebleSequenceText}</p>
      <p className="sequence">Bass: {bassSequenceText}</p>
      <div className="debug-tools">
        <button type="button" onClick={onDumpDragLog}>
          Dump Drag Log
        </button>
        <button type="button" onClick={onClearDragLog}>
          Clear Drag Log
        </button>
        <button type="button" onClick={onDumpMeasureEdgeLog}>
          Dump Measure Edge Log
        </button>
        <button type="button" onClick={onClearMeasureEdgeLog}>
          Clear Measure Edge Log
        </button>
      </div>
      <textarea
        className="debug-log"
        value={dragDebugReport}
        readOnly
        placeholder="Drag a note, then click Dump Drag Log."
        spellCheck={false}
      />
      <textarea
        className="debug-log"
        value={measureEdgeDebugReport}
        readOnly
        placeholder="Click Dump Measure Edge Log to inspect each rendered measure's last-note and barline coordinates."
        spellCheck={false}
      />
    </div>
  )
}
