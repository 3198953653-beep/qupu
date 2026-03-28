import type { NoteDuration, ScoreNote, StaffKind } from './types'

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

export type NotationPaletteResolvedSelection = {
  noteId: string
  staff: StaffKind
  keyIndex: number
  note: ScoreNote
}

export type NotationPaletteDerivedDisplay = {
  activeItemIds: Set<string>
  summary: string
} | null

export type NotationPaletteGroupId = 'mode' | 'duration' | 'accidental' | 'modifiers' | 'future'
export type NotationPaletteBehavior =
  | 'ui-only'
  | 'duration-edit'
  | 'accidental-edit'
  | 'dot-toggle'
  | 'note-to-rest'
  | 'rest-to-note-disabled'

type NotationPaletteItemBase = {
  id: string
  label: string
  iconId: NotationPaletteIconId
  group: NotationPaletteGroupId
  behavior: NotationPaletteBehavior
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
  { id: 'note', label: '音符', iconId: 'note-solid', group: 'mode', kind: 'mode', behavior: 'rest-to-note-disabled' },
  { id: 'rest', label: '休止符', iconId: 'rest-mark', group: 'mode', kind: 'mode', behavior: 'note-to-rest' },

  { id: '32', label: '32分音符', iconId: 'dur-32', group: 'duration', kind: 'duration', behavior: 'duration-edit' },
  { id: '16', label: '16分音符', iconId: 'dur-16', group: 'duration', kind: 'duration', behavior: 'duration-edit' },
  { id: '8', label: '8分音符', iconId: 'dur-8', group: 'duration', kind: 'duration', behavior: 'duration-edit' },
  { id: 'q', label: '4分音符', iconId: 'dur-4', group: 'duration', kind: 'duration', behavior: 'duration-edit' },
  { id: 'h', label: '2分音符', iconId: 'dur-2', group: 'duration', kind: 'duration', behavior: 'duration-edit' },
  { id: 'w', label: '全音符', iconId: 'dur-1', group: 'duration', kind: 'duration', behavior: 'duration-edit' },

  { id: 'bb', label: '重降记号', iconId: 'acc-bb', group: 'accidental', kind: 'accidental', behavior: 'accidental-edit' },
  { id: 'b', label: '降记号', iconId: 'acc-b', group: 'accidental', kind: 'accidental', behavior: 'accidental-edit' },
  { id: 'natural', label: '还原记号', iconId: 'acc-natural', group: 'accidental', kind: 'accidental', behavior: 'accidental-edit' },
  { id: '#', label: '升记号', iconId: 'acc-sharp', group: 'accidental', kind: 'accidental', behavior: 'accidental-edit' },
  { id: 'x', label: '重升记号', iconId: 'acc-double-sharp', group: 'accidental', kind: 'accidental', behavior: 'accidental-edit' },

  { id: 'dotted', label: '附点', iconId: 'dot', group: 'modifiers', kind: 'modifier', behavior: 'dot-toggle' },
  { id: 'tie', label: '延音线', iconId: 'tie', group: 'modifiers', kind: 'modifier', behavior: 'ui-only' },
  { id: 'arpeggio', label: '琶音', iconId: 'arpeggio', group: 'modifiers', kind: 'modifier', behavior: 'ui-only' },
  { id: 'reset', label: '还原选择', iconId: 'reset', group: 'modifiers', kind: 'action', behavior: 'ui-only' },

  { id: 'slur', label: '连线', iconId: 'slur', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'staccato', label: '断音', iconId: 'staccato', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'accent', label: '重音', iconId: 'accent', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'tenuto', label: '保持音', iconId: 'tenuto', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'turn', label: '回音', iconId: 'turn', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'grace', label: '倚音', iconId: 'grace', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'triplet', label: '三连音', iconId: 'triplet', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'mordent', label: '波音', iconId: 'mordent', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'trill', label: '颤音', iconId: 'trill', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'ornament', label: '装饰音', iconId: 'ornament', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'repeat', label: '反复记号', iconId: 'repeat', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
  { id: 'all', label: 'All', iconId: 'all', group: 'future', kind: 'placeholder', behavior: 'ui-only' },
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

export function getBaseDurationFromNoteDuration(duration: NoteDuration): NotationPaletteDuration {
  switch (duration) {
    case '32':
    case '32d':
      return '32'
    case '16':
    case '16d':
      return '16'
    case '8':
    case '8d':
      return '8'
    case 'q':
    case 'qd':
      return 'q'
    case 'hd':
    case 'h':
      return 'h'
    case 'w':
    default:
      return 'w'
  }
}

export function toTargetDurationFromPalette(durationId: NotationPaletteDuration): NoteDuration {
  switch (durationId) {
    case '32':
      return '32'
    case '16':
      return '16'
    case '8':
      return '8'
    case 'q':
      return 'q'
    case 'h':
      return 'h'
    case 'w':
    default:
      return 'w'
  }
}

export function toTargetAlterFromPaletteAccidental(
  accidentalId: Exclude<NotationPaletteAccidental, null>,
): -2 | -1 | 0 | 1 | 2 {
  switch (accidentalId) {
    case 'bb':
      return -2
    case 'b':
      return -1
    case 'natural':
      return 0
    case '#':
      return 1
    case 'x':
    default:
      return 2
  }
}

export function toggleDottedDuration(duration: NoteDuration): NoteDuration | null {
  switch (duration) {
    case 'h':
      return 'hd'
    case 'hd':
      return 'h'
    case 'q':
      return 'qd'
    case 'qd':
      return 'q'
    case '8':
      return '8d'
    case '8d':
      return '8'
    case '16':
      return '16d'
    case '16d':
      return '16'
    case '32':
      return '32d'
    case '32d':
      return '32'
    case 'w':
    default:
      return null
  }
}

export function isDottedDuration(duration: NoteDuration): boolean {
  return duration === 'hd' || duration === 'qd' || duration === '8d' || duration === '16d' || duration === '32d'
}

function getAccidentalIdFromRenderedAccidental(
  accidental: string | null | undefined,
): NotationPaletteAccidental {
  if (accidental === 'bb') return 'bb'
  if (accidental === 'b') return 'b'
  if (accidental === 'n') return 'natural'
  if (accidental === '#') return '#'
  if (accidental === '##') return 'x'
  return null
}

export function buildEmptyNotationPaletteDisplay(): NotationPaletteDerivedDisplay {
  return {
    activeItemIds: new Set<string>(),
    summary: '当前选中：无',
  }
}

function buildSummary(parts: string[]): string {
  return `当前选中：${parts.join(' / ')}`
}

function getSelectionRenderedAccidental(note: ScoreNote, keyIndex: number): string | null | undefined {
  if (note.isRest) return null
  if (keyIndex <= 0) return note.accidental
  return note.chordAccidentals?.[keyIndex - 1] ?? null
}

function hasSelectionTieStart(note: ScoreNote, keyIndex: number): boolean {
  if (keyIndex <= 0) return Boolean(note.tieStart)
  return Boolean(note.chordTieStarts?.[keyIndex - 1])
}

export function buildNotationPaletteDisplayFromSingleNote(
  note: ScoreNote,
  keyIndex: number,
): NotationPaletteDerivedDisplay {
  const activeItemIds = new Set<string>()
  const summaryParts = [note.isRest ? '休止符' : '音符', DURATION_LABELS[getBaseDurationFromNoteDuration(note.duration)]]

  activeItemIds.add(note.isRest ? 'rest' : 'note')
  activeItemIds.add(getBaseDurationFromNoteDuration(note.duration))

  if (isDottedDuration(note.duration)) {
    activeItemIds.add('dotted')
    summaryParts.push('附点')
  }

  if (hasSelectionTieStart(note, keyIndex)) {
    activeItemIds.add('tie')
    summaryParts.push('延音线')
  }

  if (!note.isRest) {
    const accidentalId = getAccidentalIdFromRenderedAccidental(getSelectionRenderedAccidental(note, keyIndex))
    if (accidentalId) {
      activeItemIds.add(accidentalId)
      summaryParts.splice(2, 0, ACCIDENTAL_LABELS[accidentalId])
    }
  }

  return {
    activeItemIds,
    summary: buildSummary(summaryParts),
  }
}

export function buildNotationPaletteDisplayForChordSelection(note: ScoreNote): NotationPaletteDerivedDisplay {
  const activeItemIds = new Set<string>()
  activeItemIds.add(getBaseDurationFromNoteDuration(note.duration))
  const summaryParts = ['和弦多选', DURATION_LABELS[getBaseDurationFromNoteDuration(note.duration)]]
  if (isDottedDuration(note.duration)) {
    activeItemIds.add('dotted')
    summaryParts.push('附点')
  }
  return {
    activeItemIds,
    summary: buildSummary(summaryParts),
  }
}

export function buildNotationPaletteDerivedDisplay(params: {
  isSelectionVisible: boolean
  selections: NotationPaletteResolvedSelection[]
}): NotationPaletteDerivedDisplay {
  const { isSelectionVisible, selections } = params
  if (!isSelectionVisible || selections.length === 0) {
    return buildEmptyNotationPaletteDisplay()
  }

  if (selections.length === 1) {
    const selection = selections[0]
    return buildNotationPaletteDisplayFromSingleNote(selection.note, selection.keyIndex)
  }

  const firstSelection = selections[0]
  const isSameChordSelection = selections.every(
    (selection) => selection.noteId === firstSelection.noteId && selection.staff === firstSelection.staff,
  )
  if (isSameChordSelection) {
    return buildNotationPaletteDisplayForChordSelection(firstSelection.note)
  }

  return {
    activeItemIds: new Set<string>(),
    summary: '当前选中：多选（无统一属性）',
  }
}
