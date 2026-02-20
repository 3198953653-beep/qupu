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
      <h2>当前音符</h2>
      <p>
        谱表：<strong>{selectedStaffLabel}</strong>
      </p>
      <p>
        音高：<strong>{selectedPitchLabel}</strong>
      </p>
      <p>
        时值：<strong>{selectedDurationLabel}</strong>
      </p>
      <p>
        位置：<strong>{selectedPosition}</strong> / {selectedPoolSize}
      </p>
      <p className="sequence">高音谱表：{trebleSequenceText}</p>
      <p className="sequence">低音谱表：{bassSequenceText}</p>
      <div className="debug-tools">
        <button type="button" onClick={onDumpDragLog}>
          导出拖拽日志
        </button>
        <button type="button" onClick={onClearDragLog}>
          清空拖拽日志
        </button>
        <button type="button" onClick={onDumpMeasureEdgeLog}>
          导出小节边界日志
        </button>
        <button type="button" onClick={onClearMeasureEdgeLog}>
          清空小节边界日志
        </button>
      </div>
      <textarea
        className="debug-log"
        value={dragDebugReport}
        readOnly
        placeholder="先拖动一个音符，再点击“导出拖拽日志”。"
        spellCheck={false}
      />
      <textarea
        className="debug-log"
        value={measureEdgeDebugReport}
        readOnly
        placeholder="点击“导出小节边界日志”，查看每个小节最后音符与小节线的坐标。"
        spellCheck={false}
      />
    </div>
  )
}
