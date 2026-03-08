import {
  NOTATION_PALETTE_GROUPS,
  NOTATION_PALETTE_ITEMS,
  applyNotationPaletteItemSelection,
  formatNotationPaletteSelectionSummary,
  isNotationPaletteItemActive,
  type NotationPaletteSelection,
} from '../notationPaletteConfig'
import { NotationPaletteIcon } from './NotationPaletteIcon'

export function NotationPalette(props: {
  open: boolean
  selection: NotationPaletteSelection
  lastActionLabel: string
  onSelectionChange: (next: NotationPaletteSelection, actionLabel: string) => void
}) {
  const { open, selection, lastActionLabel, onSelectionChange } = props

  if (!open) return null

  return (
    <div className="notation-palette-popover" role="dialog" aria-label="记谱工具面板">
      {NOTATION_PALETTE_GROUPS.map((group) => {
        const groupItems = NOTATION_PALETTE_ITEMS.filter((item) => item.group === group.id)
        return (
          <section key={group.id} className="notation-palette-section">
            <header className="notation-palette-group-label">{group.label}</header>
            <div className="notation-palette-grid">
              {groupItems.map((item) => {
                const active = isNotationPaletteItemActive(selection, item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`notation-palette-cell ${active ? 'is-active' : ''}`}
                    title={item.label}
                    aria-label={item.label}
                    aria-pressed={active}
                    onClick={() => {
                      const result = applyNotationPaletteItemSelection(selection, item)
                      onSelectionChange(result.nextSelection, result.actionLabel)
                    }}
                  >
                    <NotationPaletteIcon iconId={item.iconId} />
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
      <div className="notation-palette-footer">
        <div>最近操作：{lastActionLabel || '未选择'}</div>
        <div>{formatNotationPaletteSelectionSummary(selection)}</div>
      </div>
    </div>
  )
}
