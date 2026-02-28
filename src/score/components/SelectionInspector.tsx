export function SelectionInspector(props: {
  selectedStaffLabel: string
  selectedPitchLabel: string
  selectedDurationLabel: string
  selectedPosition: number
  selectedPoolSize: number
  trebleSequenceText: string
  bassSequenceText: string
}) {
  const {
    selectedStaffLabel,
    selectedPitchLabel,
    selectedDurationLabel,
    selectedPosition,
    selectedPoolSize,
    trebleSequenceText,
    bassSequenceText,
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
    </div>
  )
}
