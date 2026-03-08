export type NotationPaletteDuration = '32' | '16' | '8' | 'q' | 'h' | 'w'
export type NotationPaletteAccidental = 'bb' | 'b' | 'natural' | '#' | 'x' | null
export type NotationPaletteMode = 'note' | 'rest'
export type NotationPalettePlaceholderKey =
  | 'slur'
  | 'staccato'
  | 'accent'
  | 'tenuto'
  | 'turn'
  | 'grace'
  | 'triplet'
  | 'mordent'
  | 'trill'
  | 'ornament'
  | 'repeat'
  | 'all'

export type NotationPaletteSelection = {
  mode: NotationPaletteMode
  duration: NotationPaletteDuration
  accidental: NotationPaletteAccidental
  dotted: boolean
  tie: boolean
  arpeggio: boolean
  placeholders: Record<NotationPalettePlaceholderKey, boolean>
}

export type NotationPaletteGroupId = 'mode' | 'duration' | 'accidental' | 'modifiers' | 'future'

type NotationPaletteItemBase = {
  id: string
  label: string
  cellLabel: string
  group: NotationPaletteGroupId
}

export type NotationPaletteItem =
  | (NotationPaletteItemBase & { kind: 'mode'; id: NotationPaletteMode })
  | (NotationPaletteItemBase & { kind: 'duration'; id: NotationPaletteDuration })
  | (NotationPaletteItemBase & { kind: 'accidental'; id: Exclude<NotationPaletteAccidental, null> })
  | (NotationPaletteItemBase & { kind: 'modifier'; id: 'dotted' | 'tie' | 'arpeggio' })
  | (NotationPaletteItemBase & { kind: 'placeholder'; id: NotationPalettePlaceholderKey })
  | (NotationPaletteItemBase & { kind: 'action'; id: 'reset' })

export const NOTATION_PALETTE_GROUPS: Array<{ id: NotationPaletteGroupId; label: string }> = [
  { id: 'mode', label: '模式' },
  { id: 'duration', label: '时值' },
  { id: 'accidental', label: '变音' },
  { id: 'modifiers', label: '修饰' },
  { id: 'future', label: '占位' },
]

export const NOTATION_PALETTE_ITEMS: NotationPaletteItem[] = [
  { id: 'note', label: '音符', cellLabel: '音', group: 'mode', kind: 'mode' },
  { id: 'rest', label: '休止符', cellLabel: '休', group: 'mode', kind: 'mode' },

  { id: '32', label: '32分音符', cellLabel: '32', group: 'duration', kind: 'duration' },
  { id: '16', label: '16分音符', cellLabel: '16', group: 'duration', kind: 'duration' },
  { id: '8', label: '8分音符', cellLabel: '8', group: 'duration', kind: 'duration' },
  { id: 'q', label: '4分音符', cellLabel: '4', group: 'duration', kind: 'duration' },
  { id: 'h', label: '2分音符', cellLabel: '2', group: 'duration', kind: 'duration' },
  { id: 'w', label: '全音符', cellLabel: '1', group: 'duration', kind: 'duration' },

  { id: 'bb', label: '重降记号', cellLabel: 'bb', group: 'accidental', kind: 'accidental' },
  { id: 'b', label: '降记号', cellLabel: 'b', group: 'accidental', kind: 'accidental' },
  { id: 'natural', label: '还原记号', cellLabel: '♮', group: 'accidental', kind: 'accidental' },
  { id: '#', label: '升记号', cellLabel: '#', group: 'accidental', kind: 'accidental' },
  { id: 'x', label: '重升记号', cellLabel: 'x', group: 'accidental', kind: 'accidental' },

  { id: 'dotted', label: '附点', cellLabel: '·', group: 'modifiers', kind: 'modifier' },
  { id: 'tie', label: '延音线', cellLabel: '⌒', group: 'modifiers', kind: 'modifier' },
  { id: 'arpeggio', label: '琶音', cellLabel: '琶', group: 'modifiers', kind: 'modifier' },
  { id: 'reset', label: '还原选择', cellLabel: '清', group: 'modifiers', kind: 'action' },

  { id: 'slur', label: '连线', cellLabel: '连', group: 'future', kind: 'placeholder' },
  { id: 'staccato', label: '断音', cellLabel: '断', group: 'future', kind: 'placeholder' },
  { id: 'accent', label: '重音', cellLabel: '重', group: 'future', kind: 'placeholder' },
  { id: 'tenuto', label: '保持音', cellLabel: '保', group: 'future', kind: 'placeholder' },
  { id: 'turn', label: '回音', cellLabel: '回', group: 'future', kind: 'placeholder' },
  { id: 'grace', label: '倚音', cellLabel: '倚', group: 'future', kind: 'placeholder' },
  { id: 'triplet', label: '三连音', cellLabel: '3连', group: 'future', kind: 'placeholder' },
  { id: 'mordent', label: '波音', cellLabel: '波', group: 'future', kind: 'placeholder' },
  { id: 'trill', label: '颤音', cellLabel: '颤', group: 'future', kind: 'placeholder' },
  { id: 'ornament', label: '装饰音', cellLabel: '饰', group: 'future', kind: 'placeholder' },
  { id: 'repeat', label: '反复记号', cellLabel: '反', group: 'future', kind: 'placeholder' },
  { id: 'all', label: 'All', cellLabel: 'All', group: 'future', kind: 'placeholder' },
]

export const DEFAULT_NOTATION_PALETTE_SELECTION: NotationPaletteSelection = {
  mode: 'note',
  duration: 'q',
  accidental: null,
  dotted: false,
  tie: false,
  arpeggio: false,
  placeholders: {
    slur: false,
    staccato: false,
    accent: false,
    tenuto: false,
    turn: false,
    grace: false,
    triplet: false,
    mordent: false,
    trill: false,
    ornament: false,
    repeat: false,
    all: false,
  },
}

const DURATION_LABELS: Record<NotationPaletteDuration, string> = {
  '32': '32分',
  '16': '16分',
  '8': '8分',
  q: '4分',
  h: '2分',
  w: '全音',
}

const ACCIDENTAL_LABELS: Record<Exclude<NotationPaletteAccidental, null>, string> = {
  bb: 'bb',
  b: 'b',
  natural: '♮',
  '#': '#',
  x: 'x',
}

const PLACEHOLDER_LABELS: Record<NotationPalettePlaceholderKey, string> = {
  slur: '连线',
  staccato: '断音',
  accent: '重音',
  tenuto: '保持音',
  turn: '回音',
  grace: '倚音',
  triplet: '三连音',
  mordent: '波音',
  trill: '颤音',
  ornament: '装饰音',
  repeat: '反复记号',
  all: 'All',
}

export function cloneNotationPaletteSelection(
  selection: NotationPaletteSelection = DEFAULT_NOTATION_PALETTE_SELECTION,
): NotationPaletteSelection {
  return {
    ...selection,
    placeholders: { ...selection.placeholders },
  }
}

export function getDefaultNotationPaletteSelection(): NotationPaletteSelection {
  return cloneNotationPaletteSelection(DEFAULT_NOTATION_PALETTE_SELECTION)
}

export function applyNotationPaletteItemSelection(
  selection: NotationPaletteSelection,
  item: NotationPaletteItem,
): { nextSelection: NotationPaletteSelection; actionLabel: string } {
  const nextSelection = cloneNotationPaletteSelection(selection)
  switch (item.kind) {
    case 'mode':
      nextSelection.mode = item.id
      break
    case 'duration':
      nextSelection.duration = item.id
      break
    case 'accidental':
      nextSelection.accidental = selection.accidental === item.id ? null : item.id
      break
    case 'modifier':
      if (item.id === 'dotted') nextSelection.dotted = !selection.dotted
      if (item.id === 'tie') nextSelection.tie = !selection.tie
      if (item.id === 'arpeggio') nextSelection.arpeggio = !selection.arpeggio
      break
    case 'placeholder':
      nextSelection.placeholders[item.id] = !selection.placeholders[item.id]
      break
    case 'action':
      return {
        nextSelection: getDefaultNotationPaletteSelection(),
        actionLabel: item.label,
      }
  }

  return {
    nextSelection,
    actionLabel: item.label,
  }
}

export function isNotationPaletteItemActive(
  selection: NotationPaletteSelection,
  item: NotationPaletteItem,
): boolean {
  switch (item.kind) {
    case 'mode':
      return selection.mode === item.id
    case 'duration':
      return selection.duration === item.id
    case 'accidental':
      return selection.accidental === item.id
    case 'modifier':
      if (item.id === 'dotted') return selection.dotted
      if (item.id === 'tie') return selection.tie
      return selection.arpeggio
    case 'placeholder':
      return selection.placeholders[item.id]
    case 'action':
      return false
  }
}

export function formatNotationPaletteSelectionSummary(selection: NotationPaletteSelection): string {
  const summaryParts = [
    selection.mode === 'note' ? '音符' : '休止符',
    DURATION_LABELS[selection.duration],
    selection.accidental ? ACCIDENTAL_LABELS[selection.accidental] : '无变音',
  ]
  if (selection.dotted) summaryParts.push('附点')
  if (selection.tie) summaryParts.push('延音线')
  if (selection.arpeggio) summaryParts.push('琶音')
  const placeholderLabels = Object.entries(selection.placeholders)
    .filter(([, enabled]) => enabled)
    .map(([key]) => PLACEHOLDER_LABELS[key as NotationPalettePlaceholderKey])
  if (placeholderLabels.length > 0) {
    summaryParts.push(`占位:${placeholderLabels.join('、')}`)
  }
  return `当前占位选择：${summaryParts.join(' / ')}`
}
