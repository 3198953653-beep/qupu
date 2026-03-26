export function ImportProgressModal(props: {
  isOpen: boolean
  message: string
  progressPercent: number | null
}) {
  const { isOpen, message, progressPercent } = props

  if (!isOpen) return null

  return (
    <div className="import-modal" role="status" aria-live="polite" aria-label="导入进行中">
      <div className="import-modal-card">
        <h3>正在加载乐谱</h3>
        <p>{message}</p>
        <div className="import-modal-track">
          <div
            className="import-modal-bar"
            style={{ width: `${progressPercent === null ? 45 : Math.max(4, progressPercent)}%` }}
          />
        </div>
        <p className="import-modal-percent">
          {progressPercent === null ? '处理中...' : `${progressPercent}%`}
        </p>
      </div>
    </div>
  )
}
