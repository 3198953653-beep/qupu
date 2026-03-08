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

export type NotationPaletteIconId =
  | 'note-solid'
  | 'rest-mark'
  | 'dur-32'
  | 'dur-16'
  | 'dur-8'
  | 'dur-4'
  | 'dur-2'
  | 'dur-1'
  | 'acc-bb'
  | 'acc-b'
  | 'acc-natural'
  | 'acc-sharp'
  | 'acc-double-sharp'
  | 'dot'
  | 'tie'
  | 'arpeggio'
  | 'reset'
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

export type NotationPaletteIconRenderKind = 'glyph' | 'glyph-layered' | 'fallback-text'

export type NotationPaletteGlyphLayer = {
  glyph: string
  fontSize: number
  dx?: number
  dy?: number
  fontFamily?: string
  fontWeight?: number | string
}

export type NotationPaletteIconSpec = {
  kind: NotationPaletteIconRenderKind
  layers: NotationPaletteGlyphLayer[]
  boxSize?: number
}

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
  iconId: NotationPaletteIconId
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
  { id: 'note', label: '音符', iconId: 'note-solid', group: 'mode', kind: 'mode' },
  { id: 'rest', label: '休止符', iconId: 'rest-mark', group: 'mode', kind: 'mode' },

  { id: '32', label: '32分音符', iconId: 'dur-32', group: 'duration', kind: 'duration' },
  { id: '16', label: '16分音符', iconId: 'dur-16', group: 'duration', kind: 'duration' },
  { id: '8', label: '8分音符', iconId: 'dur-8', group: 'duration', kind: 'duration' },
  { id: 'q', label: '4分音符', iconId: 'dur-4', group: 'duration', kind: 'duration' },
  { id: 'h', label: '2分音符', iconId: 'dur-2', group: 'duration', kind: 'duration' },
  { id: 'w', label: '全音符', iconId: 'dur-1', group: 'duration', kind: 'duration' },

  { id: 'bb', label: '重降记号', iconId: 'acc-bb', group: 'accidental', kind: 'accidental' },
  { id: 'b', label: '降记号', iconId: 'acc-b', group: 'accidental', kind: 'accidental' },
  { id: 'natural', label: '还原记号', iconId: 'acc-natural', group: 'accidental', kind: 'accidental' },
  { id: '#', label: '升记号', iconId: 'acc-sharp', group: 'accidental', kind: 'accidental' },
  { id: 'x', label: '重升记号', iconId: 'acc-double-sharp', group: 'accidental', kind: 'accidental' },

  { id: 'dotted', label: '附点', iconId: 'dot', group: 'modifiers', kind: 'modifier' },
  { id: 'tie', label: '延音线', iconId: 'tie', group: 'modifiers', kind: 'modifier' },
  { id: 'arpeggio', label: '琶音', iconId: 'arpeggio', group: 'modifiers', kind: 'modifier' },
  { id: 'reset', label: '还原选择', iconId: 'reset', group: 'modifiers', kind: 'action' },

  { id: 'slur', label: '连线', iconId: 'slur', group: 'future', kind: 'placeholder' },
  { id: 'staccato', label: '断音', iconId: 'staccato', group: 'future', kind: 'placeholder' },
  { id: 'accent', label: '重音', iconId: 'accent', group: 'future', kind: 'placeholder' },
  { id: 'tenuto', label: '保持音', iconId: 'tenuto', group: 'future', kind: 'placeholder' },
  { id: 'turn', label: '回音', iconId: 'turn', group: 'future', kind: 'placeholder' },
  { id: 'grace', label: '倚音', iconId: 'grace', group: 'future', kind: 'placeholder' },
  { id: 'triplet', label: '三连音', iconId: 'triplet', group: 'future', kind: 'placeholder' },
  { id: 'mordent', label: '波音', iconId: 'mordent', group: 'future', kind: 'placeholder' },
  { id: 'trill', label: '颤音', iconId: 'trill', group: 'future', kind: 'placeholder' },
  { id: 'ornament', label: '装饰音', iconId: 'ornament', group: 'future', kind: 'placeholder' },
  { id: 'repeat', label: '反复记号', iconId: 'repeat', group: 'future', kind: 'placeholder' },
  { id: 'all', label: 'All', iconId: 'all', group: 'future', kind: 'placeholder' },
]

export const NOTATION_PALETTE_ICON_SPECS: Record<NotationPaletteIconId, NotationPaletteIconSpec> = {
  'note-solid': {
    kind: 'glyph',
    layers: [{ glyph: 'metNoteQuarterUp', fontSize: 18, dy: 0.9 }],
  },
  'rest-mark': {
    kind: 'glyph',
    layers: [{ glyph: 'restQuarter', fontSize: 18.5, dy: 0.6 }],
  },
  'dur-32': {
    kind: 'glyph',
    layers: [{ glyph: 'metNote32ndUp', fontSize: 17.2, dy: 1.1 }],
  },
  'dur-16': {
    kind: 'glyph',
    layers: [{ glyph: 'metNote16thUp', fontSize: 17.4, dy: 1.0 }],
  },
  'dur-8': {
    kind: 'glyph',
    layers: [{ glyph: 'metNote8thUp', fontSize: 17.6, dy: 0.95 }],
  },
  'dur-4': {
    kind: 'glyph',
    layers: [{ glyph: 'metNoteQuarterUp', fontSize: 18, dy: 0.85 }],
  },
  'dur-2': {
    kind: 'glyph',
    layers: [{ glyph: 'metNoteHalfUp', fontSize: 18, dy: 0.9 }],
  },
  'dur-1': {
    kind: 'glyph',
    layers: [{ glyph: 'metNoteWhole', fontSize: 18.2, dy: 0.9 }],
  },
  'acc-bb': {
    kind: 'glyph',
    layers: [{ glyph: 'accidentalDoubleFlat', fontSize: 18.3, dy: 0.85 }],
  },
  'acc-b': {
    kind: 'glyph',
    layers: [{ glyph: 'accidentalFlat', fontSize: 18.8, dy: 0.95 }],
  },
  'acc-natural': {
    kind: 'glyph',
    layers: [{ glyph: 'accidentalNatural', fontSize: 18, dy: 0.9 }],
  },
  'acc-sharp': {
    kind: 'glyph',
    layers: [{ glyph: 'accidentalSharp', fontSize: 18, dy: 0.9 }],
  },
  'acc-double-sharp': {
    kind: 'glyph',
    layers: [{ glyph: 'accidentalDoubleSharp', fontSize: 18, dy: 0.9 }],
  },
  dot: {
    kind: 'glyph',
    layers: [{ glyph: 'augmentationDot', fontSize: 17.5, dy: 0.7 }],
  },
  tie: {
    kind: 'fallback-text',
    layers: [{ glyph: '⌒', fontSize: 14.5, dy: 0.35, fontWeight: 600 }],
  },
  arpeggio: {
    kind: 'glyph',
    layers: [{ glyph: 'arpeggiatoUp', fontSize: 18, dy: 0.9 }],
  },
  reset: {
    kind: 'fallback-text',
    layers: [{ glyph: '↺', fontSize: 15, dy: 0.45, fontWeight: 700 }],
  },
  slur: {
    kind: 'fallback-text',
    layers: [{ glyph: '⌢', fontSize: 14.5, dy: 0.35, fontWeight: 600 }],
  },
  staccato: {
    kind: 'glyph',
    layers: [{ glyph: 'articStaccatoAbove', fontSize: 17.5, dy: 0.8 }],
  },
  accent: {
    kind: 'glyph',
    layers: [{ glyph: 'articAccentAbove', fontSize: 17.8, dy: 0.8 }],
  },
  tenuto: {
    kind: 'glyph',
    layers: [{ glyph: 'articTenutoAbove', fontSize: 17.5, dy: 0.8 }],
  },
  turn: {
    kind: 'glyph',
    layers: [{ glyph: 'ornamentTurn', fontSize: 16.8, dy: 0.8 }],
  },
  grace: {
    kind: 'glyph',
    layers: [{ glyph: 'graceNoteAppoggiaturaStemUp', fontSize: 17.1, dy: 0.95 }],
  },
  triplet: {
    kind: 'glyph',
    layers: [{ glyph: 'tuplet3', fontSize: 16.8, dy: 0.75 }],
  },
  mordent: {
    kind: 'glyph',
    layers: [{ glyph: 'ornamentMordent', fontSize: 16.8, dy: 0.8 }],
  },
  trill: {
    kind: 'glyph',
    layers: [{ glyph: 'ornamentTrill', fontSize: 16.8, dy: 0.8 }],
  },
  ornament: {
    kind: 'glyph',
    layers: [{ glyph: 'fermataAbove', fontSize: 17, dy: 0.8 }],
  },
  repeat: {
    kind: 'glyph-layered',
    layers: [
      { glyph: 'repeatLeft', fontSize: 17.8, dx: -1.35, dy: 0.9 },
      { glyph: 'repeatDots', fontSize: 16.2, dx: 2.4, dy: 0.9 },
    ],
  },
  all: {
    kind: 'fallback-text',
    layers: [{ glyph: 'All', fontSize: 12.5, dy: 0.45, fontWeight: 700 }],
  },
}

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
