import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

import {
  NOTATION_PALETTE_GROUPS,
  NOTATION_PALETTE_ITEMS,
  applyNotationPaletteItemSelection,
  formatNotationPaletteSelectionSummary,
  isNotationPaletteItemActive,
  type NotationPaletteItem,
  type NotationPaletteSelection,
} from '../notationPaletteConfig'
import { NotationPaletteIcon } from './NotationPaletteIcon'

const PALETTE_WIDTH_PX = 282
const PALETTE_MIN_MARGIN_PX = 8
const PALETTE_TOP_OFFSET_PX = 8

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function NotationPalette(props: {
  open: boolean
  selection: NotationPaletteSelection
  lastActionLabel: string
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  activeItemIdsOverride?: ReadonlySet<string> | null
  summaryOverride?: string | null
  onSelectionChange: (next: NotationPaletteSelection, actionLabel: string, item: NotationPaletteItem) => void
}) {
  const {
    open,
    selection,
    lastActionLabel,
    anchorRef,
    onClose,
    activeItemIdsOverride = null,
    summaryOverride = null,
    onSelectionChange,
  } = props
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x: PALETTE_MIN_MARGIN_PX, y: PALETTE_MIN_MARGIN_PX })
  const [dragState, setDragState] = useState<{ offsetX: number; offsetY: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const anchorRect = anchorRef.current?.getBoundingClientRect()
    if (!anchorRect) return

    const nextX = clamp(
      anchorRect.left,
      PALETTE_MIN_MARGIN_PX,
      Math.max(PALETTE_MIN_MARGIN_PX, window.innerWidth - PALETTE_WIDTH_PX - PALETTE_MIN_MARGIN_PX),
    )
    const nextY = clamp(
      anchorRect.bottom + PALETTE_TOP_OFFSET_PX,
      PALETTE_MIN_MARGIN_PX,
      Math.max(PALETTE_MIN_MARGIN_PX, window.innerHeight - PALETTE_MIN_MARGIN_PX - 80),
    )
    setPosition({ x: nextX, y: nextY })
  }, [anchorRef, open])

  useEffect(() => {
    if (!dragState) return undefined

    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'

    const handlePointerMove = (event: PointerEvent) => {
      const popoverRect = popoverRef.current?.getBoundingClientRect()
      const popoverWidth = popoverRect?.width ?? PALETTE_WIDTH_PX
      const popoverHeight = popoverRect?.height ?? 360
      const nextX = clamp(
        event.clientX - dragState.offsetX,
        PALETTE_MIN_MARGIN_PX,
        Math.max(PALETTE_MIN_MARGIN_PX, window.innerWidth - popoverWidth - PALETTE_MIN_MARGIN_PX),
      )
      const nextY = clamp(
        event.clientY - dragState.offsetY,
        PALETTE_MIN_MARGIN_PX,
        Math.max(PALETTE_MIN_MARGIN_PX, window.innerHeight - popoverHeight - PALETTE_MIN_MARGIN_PX),
      )
      setPosition({ x: nextX, y: nextY })
    }

    const handlePointerUp = () => {
      setDragState(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragState])

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const popoverRect = popoverRef.current?.getBoundingClientRect()
    if (!popoverRect) return
    setDragState({
      offsetX: event.clientX - popoverRect.left,
      offsetY: event.clientY - popoverRect.top,
    })
    event.preventDefault()
  }

  const popoverStyle: CSSProperties = {
    left: `${position.x}px`,
    top: `${position.y}px`,
  }

  if (!open) return null

  return (
    <div
      ref={popoverRef}
      className="notation-palette-popover"
      style={popoverStyle}
      role="dialog"
      aria-label="记谱工具面板"
      aria-modal="false"
    >
      <div
        className={`notation-palette-header ${dragState ? 'is-dragging' : ''}`}
        onPointerDown={handleHeaderPointerDown}
      >
        <div className="notation-palette-title">记谱工具</div>
        <button
          type="button"
          className="notation-palette-close"
          aria-label="关闭记谱工具"
          title="关闭"
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {NOTATION_PALETTE_GROUPS.map((group) => {
        const groupItems = NOTATION_PALETTE_ITEMS.filter((item) => item.group === group.id)
        return (
          <section key={group.id} className="notation-palette-section">
            <header className="notation-palette-group-label">{group.label}</header>
            <div className="notation-palette-grid">
              {groupItems.map((item) => {
                const active =
                  activeItemIdsOverride !== null && activeItemIdsOverride !== undefined
                    ? activeItemIdsOverride.has(item.id)
                    : isNotationPaletteItemActive(selection, item)
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
                      onSelectionChange(result.nextSelection, result.actionLabel, item)
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
        <div>{summaryOverride ?? formatNotationPaletteSelectionSummary(selection)}</div>
      </div>
    </div>
  )
}
