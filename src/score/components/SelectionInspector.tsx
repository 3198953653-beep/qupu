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
      </div>
      <textarea
        className="debug-log"
        value={dragDebugReport}
        readOnly
        placeholder="Drag a note, then click Dump Drag Log."
        spellCheck={false}
      />
    </div>
  )
}
