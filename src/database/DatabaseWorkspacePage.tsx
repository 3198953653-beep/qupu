import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { Renderer } from 'vexflow'
import { createNoteId } from '../score/scoreOps'
import type { GrandStaffLayoutMetrics } from '../score/grandStaffLayout'
import { renderPreviewWithMainLayout } from '../score/components/previewNotationAdapter'
import type { SpacingLayoutMode, ScoreNote, TimeSignature } from '../score/types'
import type { TimeAxisSpacingConfig } from '../score/layout/timeAxisSpacing'
import {
  deleteAccompanimentNoteRows,
  deleteTemplateRows,
  fillMissingChordIndices,
  insertAccompanimentEntryRows,
  insertTemplateEntryRows,
  loadAccompanimentNoteRows,
  loadTemplateRows,
  updateAccompanimentNoteRow,
  updateTemplateRow,
} from './databaseQueries'
import {
  analyzeAccompanimentNoteFile,
  analyzeAccompanimentTemplateFile,
  analyzeRhythmTemplateFile,
} from './musicXmlDatabaseParser'
import { ensureDatabaseSchema } from './schema'
import {
  createBundledDatabaseInstance,
  createDatabaseFromBytes,
  exportDatabaseBytes,
  isFileSystemAccessAvailable,
  readDatabaseFileHandle,
  requestDatabaseFileHandle,
  requestDatabaseSaveHandle,
  safeCloseDatabase,
  writeDatabaseFileHandle,
  type SqlJsDatabase,
} from './sqliteRuntime'
import { loadTagLibraryState, saveTagLibraryState } from './tagStore'
import type {
  AccompanimentNoteDbRow,
  DatabaseSessionInfo,
  NoteEntryDraftRow,
  TagLibraryState,
  TemplateDbRow,
  TemplateEntryDraftRow,
  TemplateTableName,
} from './types'

type DatabaseWorkspacePageProps = {
  isVisible: boolean
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}

type WorkspaceTab = 'notes' | 'accompaniment-template' | 'rhythm-template'
type WorkspaceMode = 'database' | 'entry'
type SortDirection = 'asc' | 'desc'

type SortState = {
  column: string
  direction: SortDirection
}

type WorkspaceMessage = {
  kind: 'info' | 'success' | 'error'
  text: string
}

type TagModalState = {
  leftKey: keyof TagLibraryState
  rightKey: keyof TagLibraryState
  leftTitle: string
  rightTitle: string
}

type ContextMenuState = {
  x: number
  y: number
  rowId: number
  tab: WorkspaceTab
}

type NoteFilters = {
  notesQuery: string
  chordTypeQuery: string
  structureQuery: string
  noteCounts: string[]
  directions: string[]
  commonState: 'all' | 'yes' | 'no'
  styleTags: string[]
  specialTags: string[]
}

type TemplateFilters = {
  nameQuery: string
  durationComboQuery: string
  totalDurations: string[]
  difficultyTags: string[]
  styleTags: string[]
}

type NoteHeaderFilters = {
  notes: string
  noteCount: string
  chordType: string
  chordIndex: string
  noteDirection: string
  structure: string
  styleTags: string
  specialTags: string
}

type TemplateHeaderFilters = {
  name: string
  patternData: string
  totalDuration: string
  durationCombo: string
  difficultyTags: string
  styleTags: string
}

type EntryFileState = {
  fileNames: string[]
  statusText: string
  isParsing: boolean
}

const PAGE_SIZE = 50
const NOTE_PREVIEW_HEIGHT_PX = 160
const NOTE_PREVIEW_PADDING_X = 18

const DEFAULT_SESSION_INFO: DatabaseSessionInfo = {
  sourceKind: 'bundled',
  displayName: 'app_data.db',
  canSaveInPlace: false,
  isDirty: false,
  lastSavedAt: null,
  saveError: null,
}

const DEFAULT_TAB_MODE: Record<WorkspaceTab, WorkspaceMode> = {
  notes: 'database',
  'accompaniment-template': 'database',
  'rhythm-template': 'database',
}

const DEFAULT_PAGE_BY_TAB: Record<WorkspaceTab, number> = {
  notes: 1,
  'accompaniment-template': 1,
  'rhythm-template': 1,
}

const DEFAULT_SELECTION_BY_TAB: Record<WorkspaceTab, number[]> = {
  notes: [],
  'accompaniment-template': [],
  'rhythm-template': [],
}

const DEFAULT_SORT_BY_TAB: Record<WorkspaceTab, SortState | null> = {
  notes: null,
  'accompaniment-template': null,
  'rhythm-template': null,
}

const DEFAULT_HEADER_FILTER_ENABLED_BY_TAB: Record<WorkspaceTab, boolean> = {
  notes: false,
  'accompaniment-template': false,
  'rhythm-template': false,
}

const DEFAULT_NOTE_FILTERS: NoteFilters = {
  notesQuery: '',
  chordTypeQuery: '',
  structureQuery: '',
  noteCounts: [],
  directions: [],
  commonState: 'all',
  styleTags: [],
  specialTags: [],
}

const DEFAULT_TEMPLATE_FILTERS: TemplateFilters = {
  nameQuery: '',
  durationComboQuery: '',
  totalDurations: [],
  difficultyTags: [],
  styleTags: [],
}

const DEFAULT_NOTE_HEADER_FILTERS: NoteHeaderFilters = {
  notes: '',
  noteCount: '',
  chordType: '',
  chordIndex: '',
  noteDirection: '',
  structure: '',
  styleTags: '',
  specialTags: '',
}

const DEFAULT_TEMPLATE_HEADER_FILTERS: TemplateHeaderFilters = {
  name: '',
  patternData: '',
  totalDuration: '',
  durationCombo: '',
  difficultyTags: '',
  styleTags: '',
}

const TAB_LABELS: Record<WorkspaceTab, string> = {
  notes: '伴奏音符录入',
  'accompaniment-template': '伴奏模板录入',
  'rhythm-template': '律动模板录入',
}

function normalizeText(value: string | number | null | undefined): string {
  return String(value ?? '').trim()
}

function normalizeCsvTags(value: string): string {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== '无')
  return [...new Set(entries)].join(',')
}

function splitCsvTags(value: string): string[] {
  return normalizeCsvTags(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function csvTagsMatch(rowValue: string, requiredTags: string[]): boolean {
  if (requiredTags.length === 0) return true
  const rowSet = new Set(splitCsvTags(rowValue))
  return requiredTags.every((tag) => rowSet.has(tag))
}

function includesText(value: string | number | null | undefined, query: string): boolean {
  const normalizedQuery = normalizeText(query).toLowerCase()
  if (!normalizedQuery) return true
  return normalizeText(value).toLowerCase().includes(normalizedQuery)
}

function compareValues(left: string | number | null | undefined, right: string | number | null | undefined): number {
  const leftNumber = typeof left === 'number' ? left : Number(left)
  const rightNumber = typeof right === 'number' ? right : Number(right)
  const leftIsNumber = Number.isFinite(leftNumber)
  const rightIsNumber = Number.isFinite(rightNumber)
  if (leftIsNumber && rightIsNumber) {
    return leftNumber - rightNumber
  }
  return normalizeText(left).localeCompare(normalizeText(right), 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  })
}

function sortRows<T extends Record<string, unknown>>(rows: T[], sortState: SortState | null): T[] {
  if (!sortState) return rows
  const { column, direction } = sortState
  const multiplier = direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    const primary = compareValues(
      (left[column] as string | number | null | undefined) ?? null,
      (right[column] as string | number | null | undefined) ?? null,
    )
    if (primary !== 0) return primary * multiplier
    return compareValues(
      (left.id as string | number | null | undefined) ?? null,
      (right.id as string | number | null | undefined) ?? null,
    )
  })
}

function buildSuggestedDbFileName(displayName: string): string {
  const trimmed = normalizeText(displayName) || 'app_data'
  const withoutExt = trimmed.replace(/\.[^.]+$/, '')
  return `${withoutExt}-work.db`
}

function getTabTableName(tab: WorkspaceTab): TemplateTableName | null {
  if (tab === 'accompaniment-template') return '伴奏模板'
  if (tab === 'rhythm-template') return '律动模板'
  return null
}

function getTemplateTypeLabel(tableName: TemplateTableName): string {
  return tableName === '伴奏模板' ? '伴奏模板' : '律动模板'
}

function createSessionInfo(params: {
  sourceKind: DatabaseSessionInfo['sourceKind']
  displayName: string
  canSaveInPlace: boolean
  isDirty?: boolean
  lastSavedAt?: string | null
  saveError?: string | null
}): DatabaseSessionInfo {
  const {
    sourceKind,
    displayName,
    canSaveInPlace,
    isDirty = false,
    lastSavedAt = null,
    saveError = null,
  } = params
  return {
    sourceKind,
    displayName,
    canSaveInPlace,
    isDirty,
    lastSavedAt,
    saveError,
  }
}

function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), Math.max(1, pageCount))
}

function paginateRows<T>(rows: T[], page: number): { pageRows: T[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = clampPage(page, totalPages)
  const startIndex = (safePage - 1) * PAGE_SIZE
  return {
    pageRows: rows.slice(startIndex, startIndex + PAGE_SIZE),
    totalPages,
  }
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items.slice()]
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

function toPreviewPitch(token: string): string | null {
  const match = token.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/)
  if (!match) return null
  const [, step, accidental = '', octave = '4'] = match
  return `${step.toLowerCase()}${accidental}/${octave}`
}

function buildPreviewMeasures(notesText: string): Array<{
  pairIndex: number
  notes: ScoreNote[]
  clef: 'bass'
  keyFifths: number
  timeSignature: TimeSignature
  showKeySignature: boolean
  showTimeSignature: boolean
}> {
  const onsetTokens = notesText
    .split('_')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  const noteGroups = onsetTokens
    .map((onset) =>
      onset
        .split('+')
        .map((pitchText) => toPreviewPitch(pitchText))
        .filter((pitch): pitch is string => pitch !== null),
    )
    .filter((group) => group.length > 0)

  return chunkArray(noteGroups, 8).map((groupChunk, pairIndex) => ({
    pairIndex,
    notes: groupChunk.map((pitches) => {
      const [pitch, ...chordPitches] = pitches
      return {
        id: createNoteId(),
        pitch: pitch ?? 'c/3',
        duration: '8',
        chordPitches: chordPitches.length > 0 ? chordPitches : undefined,
      }
    }),
    clef: 'bass',
    keyFifths: 0,
    timeSignature: { beats: 4, beatType: 4 },
    showKeySignature: false,
    showTimeSignature: pairIndex === 0,
  }))
}

function joinFileNames(fileNames: string[]): string {
  if (fileNames.length === 0) return '未选择文件'
  return fileNames.join('，')
}

function renderDirtyLabel(sessionInfo: DatabaseSessionInfo): string {
  if (sessionInfo.canSaveInPlace) {
    return sessionInfo.isDirty ? '本地工作库 · 未保存' : '本地工作库'
  }
  return sessionInfo.isDirty ? '内置数据库 · 仅内存改动' : '内置数据库'
}

function loadAllRows(db: SqlJsDatabase): {
  noteRows: AccompanimentNoteDbRow[]
  accompanimentTemplateRows: TemplateDbRow[]
  rhythmTemplateRows: TemplateDbRow[]
} {
  return {
    noteRows: loadAccompanimentNoteRows(db),
    accompanimentTemplateRows: loadTemplateRows(db, '伴奏模板'),
    rhythmTemplateRows: loadTemplateRows(db, '律动模板'),
  }
}

function CheckboxDropdown(props: {
  label: string
  options: string[]
  selectedValues: string[]
  onChange: (nextValues: string[]) => void
  emptyLabel?: string
}) {
  const { label, options, selectedValues, onChange, emptyLabel = '全部' } = props

  const summaryText = selectedValues.length > 0 ? selectedValues.join('，') : emptyLabel

  const toggleValue = useCallback((value: string) => {
    onChange(
      selectedValues.includes(value)
        ? selectedValues.filter((item) => item !== value)
        : [...selectedValues, value],
    )
  }, [onChange, selectedValues])

  return (
    <details className="database-multi-select">
      <summary>
        <span className="database-multi-select-label">{label}</span>
        <span className="database-multi-select-value">{summaryText}</span>
      </summary>
      <div className="database-multi-select-menu">
        {options.length === 0 && <span className="database-multi-select-empty">暂无选项</span>}
        {options.map((option) => (
          <label key={option} className="database-multi-select-option">
            <input
              type="checkbox"
              checked={selectedValues.includes(option)}
              onChange={() => toggleValue(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </details>
  )
}

function InlineTagSelector(props: {
  value: string
  options: string[]
  placeholder: string
  onChange: (nextValue: string) => void
}) {
  const { value, options, placeholder, onChange } = props

  return (
    <CheckboxDropdown
      label={placeholder}
      options={options.filter((entry) => entry !== '无')}
      selectedValues={splitCsvTags(value)}
      onChange={(nextValues) => onChange(nextValues.join(','))}
      emptyLabel="无"
    />
  )
}

function TagManagerModal(props: {
  state: TagModalState
  tagLibrary: TagLibraryState
  onClose: () => void
  onSave: (nextLibrary: TagLibraryState) => void
}) {
  const { state, tagLibrary, onClose, onSave } = props
  const [draftLibrary, setDraftLibrary] = useState<TagLibraryState>(tagLibrary)

  useEffect(() => {
    setDraftLibrary(tagLibrary)
  }, [tagLibrary])

  const updateList = useCallback((key: keyof TagLibraryState, nextValues: string[]) => {
    setDraftLibrary((current) => ({
      ...current,
      [key]: ['无', ...nextValues.filter((entry) => entry !== '无')],
    }))
  }, [])

  const handleAdd = useCallback((key: keyof TagLibraryState) => {
    const nextValue = window.prompt('请输入新标签')
    const normalized = normalizeText(nextValue)
    if (!normalized || normalized === '无') return
    updateList(key, [...draftLibrary[key], normalized])
  }, [draftLibrary, updateList])

  const handleEdit = useCallback((key: keyof TagLibraryState, value: string) => {
    if (value === '无') return
    const nextValue = window.prompt('修改标签名称', value)
    const normalized = normalizeText(nextValue)
    if (!normalized || normalized === '无') return
    updateList(
      key,
      draftLibrary[key].map((entry) => (entry === value ? normalized : entry)),
    )
  }, [draftLibrary, updateList])

  const handleDelete = useCallback((key: keyof TagLibraryState, value: string) => {
    if (value === '无') return
    updateList(
      key,
      draftLibrary[key].filter((entry) => entry !== value),
    )
  }, [draftLibrary, updateList])

  const renderColumn = (key: keyof TagLibraryState, title: string) => (
    <section className="database-tag-column">
      <header className="database-tag-column-header">
        <strong>{title}</strong>
        <button type="button" onClick={() => handleAdd(key)}>添加</button>
      </header>
      <div className="database-tag-list">
        {draftLibrary[key].map((value) => (
          <div key={`${key}-${value}`} className="database-tag-item">
            <span>{value}</span>
            <div className="database-tag-item-actions">
              <button type="button" onClick={() => handleEdit(key, value)} disabled={value === '无'}>
                编辑
              </button>
              <button type="button" onClick={() => handleDelete(key, value)} disabled={value === '无'}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )

  return (
    <div className="database-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="database-modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="database-modal-header">
          <div>
            <h3>标签管理</h3>
            <p>修改后会同步到三个数据库 tab 的筛选与录入选项。</p>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="database-tag-grid">
          {renderColumn(state.leftKey, state.leftTitle)}
          {renderColumn(state.rightKey, state.rightTitle)}
        </div>
        <div className="database-modal-footer">
          <button
            type="button"
            className="database-primary-button"
            onClick={() => onSave(draftLibrary)}
          >
            保存并关闭
          </button>
        </div>
      </div>
    </div>
  )
}

function ContextMenu(props: {
  state: ContextMenuState
  onClose: () => void
  onCopyRow: (state: ContextMenuState) => void
  onCopyNotes: (state: ContextMenuState) => void
  onDeleteRow: (state: ContextMenuState) => void
}) {
  const { state, onClose, onCopyRow, onCopyNotes, onDeleteRow } = props

  useEffect(() => {
    const handleClose = () => onClose()
    window.addEventListener('click', handleClose)
    window.addEventListener('contextmenu', handleClose)
    window.addEventListener('resize', handleClose)
    return () => {
      window.removeEventListener('click', handleClose)
      window.removeEventListener('contextmenu', handleClose)
      window.removeEventListener('resize', handleClose)
    }
  }, [onClose])

  return (
    <div
      className="database-context-menu"
      style={{ left: `${state.x}px`, top: `${state.y}px` }}
      role="menu"
    >
      <button type="button" onClick={() => onCopyRow(state)}>复制整行</button>
      {state.tab === 'notes' && <button type="button" onClick={() => onCopyNotes(state)}>复制 notes</button>}
      <button type="button" className="is-danger" onClick={() => onDeleteRow(state)}>删除</button>
    </div>
  )
}

function DatabaseNotePreviewCanvas(props: {
  notesText: string
  timeAxisSpacingConfig: TimeAxisSpacingConfig
  spacingLayoutMode: SpacingLayoutMode
  grandStaffLayoutMetrics: GrandStaffLayoutMetrics
}) {
  const { notesText, timeAxisSpacingConfig, spacingLayoutMode, grandStaffLayoutMetrics } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const measures = useMemo(() => buildPreviewMeasures(notesText), [notesText])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const renderer = new Renderer(canvas, Renderer.Backends.CANVAS)
    renderer.resize(1, NOTE_PREVIEW_HEIGHT_PX)
    const context = renderer.getContext()
    context.clearRect(0, 0, 1, NOTE_PREVIEW_HEIGHT_PX)

    const result = renderPreviewWithMainLayout({
      context,
      renderHeight: NOTE_PREVIEW_HEIGHT_PX,
      definitions: measures,
      paddingX: NOTE_PREVIEW_PADDING_X,
      timeAxisSpacingConfig,
      spacingLayoutMode,
      grandStaffLayoutMetrics,
    })

    renderer.resize(result.totalWidth, NOTE_PREVIEW_HEIGHT_PX)
    const nextContext = renderer.getContext()
    nextContext.clearRect(0, 0, result.totalWidth, NOTE_PREVIEW_HEIGHT_PX)
    renderPreviewWithMainLayout({
      context: nextContext,
      renderHeight: NOTE_PREVIEW_HEIGHT_PX,
      definitions: measures,
      paddingX: NOTE_PREVIEW_PADDING_X,
      timeAxisSpacingConfig,
      spacingLayoutMode,
      grandStaffLayoutMetrics,
    })

    return undefined
  }, [grandStaffLayoutMetrics, measures, spacingLayoutMode, timeAxisSpacingConfig])

  return (
    <div className="database-note-preview-scroll">
      <canvas ref={canvasRef} className="database-note-preview-canvas" />
    </div>
  )
}

function PaginationBar(props: {
  page: number
  totalPages: number
  totalRows: number
  selectedCount: number
  onPageChange: (nextPage: number) => void
}) {
  const { page, totalPages, totalRows, selectedCount, onPageChange } = props

  return (
    <div className="database-pagination">
      <div className="database-pagination-status">
        <span>{`共 ${totalRows} 条`}</span>
        <span>{`已选 ${selectedCount} 条`}</span>
        <span>{`第 ${page} / ${totalPages} 页`}</span>
      </div>
      <div className="database-pagination-actions">
        <button type="button" onClick={() => onPageChange(1)} disabled={page <= 1}>首页</button>
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>上一页</button>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>下一页</button>
        <button type="button" onClick={() => onPageChange(totalPages)} disabled={page >= totalPages}>末页</button>
      </div>
    </div>
  )
}

function DatabaseSectionCard(props: {
  eyebrow?: string
  title: string
  description?: string
  className?: string
  contentClassName?: string
  children: ReactNode
}) {
  const {
    eyebrow,
    title,
    description,
    className = '',
    contentClassName = '',
    children,
  } = props

  return (
    <section className={['database-section-card', className].filter(Boolean).join(' ')}>
      <header className="database-section-card-header">
        {eyebrow && <span className="database-section-card-eyebrow">{eyebrow}</span>}
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </header>
      <div className={['database-section-card-content', contentClassName].filter(Boolean).join(' ')}>
        {children}
      </div>
    </section>
  )
}

export function DatabaseWorkspacePage(props: DatabaseWorkspacePageProps) {
  const {
    isVisible,
    timeAxisSpacingConfig,
    spacingLayoutMode,
    grandStaffLayoutMetrics,
  } = props

  const [database, setDatabase] = useState<SqlJsDatabase | null>(null)
  const [databaseFileHandle, setDatabaseFileHandle] = useState<FileSystemFileHandle | null>(null)
  const [sessionInfo, setSessionInfo] = useState<DatabaseSessionInfo>(DEFAULT_SESSION_INFO)
  const [isLoadingDatabase, setIsLoadingDatabase] = useState(false)
  const [workspaceMessage, setWorkspaceMessage] = useState<WorkspaceMessage | null>(null)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('notes')
  const [tabModes, setTabModes] = useState<Record<WorkspaceTab, WorkspaceMode>>(DEFAULT_TAB_MODE)
  const [pageByTab, setPageByTab] = useState<Record<WorkspaceTab, number>>(DEFAULT_PAGE_BY_TAB)
  const [selectionByTab, setSelectionByTab] = useState<Record<WorkspaceTab, number[]>>(DEFAULT_SELECTION_BY_TAB)
  const [sortByTab, setSortByTab] = useState<Record<WorkspaceTab, SortState | null>>(DEFAULT_SORT_BY_TAB)
  const [headerFilterEnabledByTab, setHeaderFilterEnabledByTab] = useState<Record<WorkspaceTab, boolean>>(
    DEFAULT_HEADER_FILTER_ENABLED_BY_TAB,
  )
  const [notePreviewEnabled, setNotePreviewEnabled] = useState(false)
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null)
  const [tagLibrary, setTagLibrary] = useState<TagLibraryState>(() => loadTagLibraryState())
  const [tagModalState, setTagModalState] = useState<TagModalState | null>(null)

  const [noteRows, setNoteRows] = useState<AccompanimentNoteDbRow[]>([])
  const [accompanimentTemplateRows, setAccompanimentTemplateRows] = useState<TemplateDbRow[]>([])
  const [rhythmTemplateRows, setRhythmTemplateRows] = useState<TemplateDbRow[]>([])

  const [noteFilters, setNoteFilters] = useState<NoteFilters>(DEFAULT_NOTE_FILTERS)
  const [accompanimentTemplateFilters, setAccompanimentTemplateFilters] = useState<TemplateFilters>(DEFAULT_TEMPLATE_FILTERS)
  const [rhythmTemplateFilters, setRhythmTemplateFilters] = useState<TemplateFilters>(DEFAULT_TEMPLATE_FILTERS)
  const [noteHeaderFilters, setNoteHeaderFilters] = useState<NoteHeaderFilters>(DEFAULT_NOTE_HEADER_FILTERS)
  const [accompanimentTemplateHeaderFilters, setAccompanimentTemplateHeaderFilters] = useState<TemplateHeaderFilters>(
    DEFAULT_TEMPLATE_HEADER_FILTERS,
  )
  const [rhythmTemplateHeaderFilters, setRhythmTemplateHeaderFilters] = useState<TemplateHeaderFilters>(
    DEFAULT_TEMPLATE_HEADER_FILTERS,
  )

  const noteEntryInputRef = useRef<HTMLInputElement | null>(null)
  const accompanimentTemplateEntryInputRef = useRef<HTMLInputElement | null>(null)
  const rhythmTemplateEntryInputRef = useRef<HTMLInputElement | null>(null)

  const [noteEntryState, setNoteEntryState] = useState<EntryFileState>({
    fileNames: [],
    statusText: '尚未解析文件。',
    isParsing: false,
  })
  const [templateEntryState, setTemplateEntryState] = useState<EntryFileState>({
    fileNames: [],
    statusText: '尚未解析文件。',
    isParsing: false,
  })
  const [rhythmEntryState, setRhythmEntryState] = useState<EntryFileState>({
    fileNames: [],
    statusText: '尚未解析文件。',
    isParsing: false,
  })
  const [noteEntryFiles, setNoteEntryFiles] = useState<File[]>([])
  const [templateEntryFiles, setTemplateEntryFiles] = useState<File[]>([])
  const [rhythmEntryFiles, setRhythmEntryFiles] = useState<File[]>([])
  const [noteEntryDrafts, setNoteEntryDrafts] = useState<NoteEntryDraftRow[]>([])
  const [templateEntryDrafts, setTemplateEntryDrafts] = useState<TemplateEntryDraftRow[]>([])
  const [rhythmEntryDrafts, setRhythmEntryDrafts] = useState<TemplateEntryDraftRow[]>([])

  const markDirty = useCallback((saveError: string | null = null) => {
    setSessionInfo((current) => ({
      ...current,
      isDirty: true,
      saveError,
    }))
  }, [])

  const markSaved = useCallback(() => {
    const now = new Date().toLocaleString('zh-CN')
    setSessionInfo((current) => ({
      ...current,
      isDirty: false,
      lastSavedAt: now,
      saveError: null,
    }))
  }, [])

  const refreshRows = useCallback((targetDb: SqlJsDatabase) => {
    const next = loadAllRows(targetDb)
    setNoteRows(next.noteRows)
    setAccompanimentTemplateRows(next.accompanimentTemplateRows)
    setRhythmTemplateRows(next.rhythmTemplateRows)
  }, [])

  const replaceDatabase = useCallback((params: {
    nextDb: SqlJsDatabase
    nextFileHandle: FileSystemFileHandle | null
    nextSessionInfo: DatabaseSessionInfo
  }) => {
    const { nextDb, nextFileHandle, nextSessionInfo } = params
    ensureDatabaseSchema(nextDb)
    refreshRows(nextDb)
    setDatabase((current) => {
      if (current && current !== nextDb) safeCloseDatabase(current)
      return nextDb
    })
    setDatabaseFileHandle(nextFileHandle)
    setSessionInfo(nextSessionInfo)
    setSelectionByTab(DEFAULT_SELECTION_BY_TAB)
    setPageByTab(DEFAULT_PAGE_BY_TAB)
  }, [refreshRows])

  const loadBundledDatabase = useCallback(async () => {
    setIsLoadingDatabase(true)
    try {
      const nextDb = await createBundledDatabaseInstance()
      replaceDatabase({
        nextDb,
        nextFileHandle: null,
        nextSessionInfo: createSessionInfo({
          sourceKind: 'bundled',
          displayName: 'app_data.db',
          canSaveInPlace: false,
        }),
      })
      setWorkspaceMessage({
        kind: 'info',
        text: '已打开内置数据库 public/rhythm-db/app_data.db。',
      })
    } catch (error) {
      setWorkspaceMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '加载内置数据库失败。',
      })
    } finally {
      setIsLoadingDatabase(false)
    }
  }, [replaceDatabase])

  useEffect(() => {
    void loadBundledDatabase()
    return () => {
      setDatabase((current) => {
        safeCloseDatabase(current)
        return null
      })
    }
  }, [loadBundledDatabase])

  useEffect(() => {
    saveTagLibraryState(tagLibrary)
  }, [tagLibrary])

  const fileSystemAccessAvailable = isFileSystemAccessAvailable()

  const noteCountOptions = useMemo(
    () =>
      [...new Set(noteRows.map((row) => normalizeText(row.noteCount)).filter((value) => value.length > 0))]
        .sort((left, right) => compareValues(left, right)),
    [noteRows],
  )
  const noteDirectionOptions = useMemo(
    () =>
      [...new Set(noteRows.map((row) => normalizeText(row.noteDirection)).filter((value) => value.length > 0))]
        .sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [noteRows],
  )
  const noteStyleOptions = useMemo(() => tagLibrary.styleTags.filter((entry) => entry !== '无'), [tagLibrary.styleTags])
  const noteSpecialOptions = useMemo(() => tagLibrary.specialTags.filter((entry) => entry !== '无'), [tagLibrary.specialTags])
  const templateDurationOptions = useMemo(
    () =>
      [...new Set(
        [...accompanimentTemplateRows, ...rhythmTemplateRows]
          .map((row) => normalizeText(row.totalDuration))
          .filter((value) => value.length > 0),
      )].sort((left, right) => compareValues(left, right)),
    [accompanimentTemplateRows, rhythmTemplateRows],
  )

  const filteredNoteRows = useMemo(() => {
    const nextRows = noteRows.filter((row) => {
      if (!includesText(row.notes, noteFilters.notesQuery)) return false
      if (!includesText(row.chordType, noteFilters.chordTypeQuery)) return false
      if (!includesText(row.structure, noteFilters.structureQuery)) return false
      if (noteFilters.noteCounts.length > 0 && !noteFilters.noteCounts.includes(normalizeText(row.noteCount))) return false
      if (noteFilters.directions.length > 0 && !noteFilters.directions.includes(normalizeText(row.noteDirection))) return false
      if (noteFilters.commonState === 'yes' && !row.isCommon) return false
      if (noteFilters.commonState === 'no' && row.isCommon) return false
      if (!csvTagsMatch(row.styleTags, noteFilters.styleTags)) return false
      if (!csvTagsMatch(row.specialTags, noteFilters.specialTags)) return false
      if (!includesText(row.notes, noteHeaderFilters.notes)) return false
      if (!includesText(row.noteCount, noteHeaderFilters.noteCount)) return false
      if (!includesText(row.chordType, noteHeaderFilters.chordType)) return false
      if (!includesText(row.chordIndex, noteHeaderFilters.chordIndex)) return false
      if (!includesText(row.noteDirection, noteHeaderFilters.noteDirection)) return false
      if (!includesText(row.structure, noteHeaderFilters.structure)) return false
      if (!includesText(row.styleTags, noteHeaderFilters.styleTags)) return false
      if (!includesText(row.specialTags, noteHeaderFilters.specialTags)) return false
      return true
    })
    return sortRows(nextRows, sortByTab.notes)
  }, [noteFilters, noteHeaderFilters, noteRows, sortByTab.notes])

  const filteredAccompanimentTemplateRows = useMemo(() => {
    const nextRows = accompanimentTemplateRows.filter((row) => {
      if (!includesText(row.name, accompanimentTemplateFilters.nameQuery)) return false
      if (!includesText(row.durationCombo, accompanimentTemplateFilters.durationComboQuery)) return false
      if (accompanimentTemplateFilters.totalDurations.length > 0
        && !accompanimentTemplateFilters.totalDurations.includes(normalizeText(row.totalDuration))) return false
      if (!csvTagsMatch(row.difficultyTags, accompanimentTemplateFilters.difficultyTags)) return false
      if (!csvTagsMatch(row.styleTags, accompanimentTemplateFilters.styleTags)) return false
      if (!includesText(row.name, accompanimentTemplateHeaderFilters.name)) return false
      if (!includesText(row.patternData, accompanimentTemplateHeaderFilters.patternData)) return false
      if (!includesText(row.totalDuration, accompanimentTemplateHeaderFilters.totalDuration)) return false
      if (!includesText(row.durationCombo, accompanimentTemplateHeaderFilters.durationCombo)) return false
      if (!includesText(row.difficultyTags, accompanimentTemplateHeaderFilters.difficultyTags)) return false
      if (!includesText(row.styleTags, accompanimentTemplateHeaderFilters.styleTags)) return false
      return true
    })
    return sortRows(nextRows, sortByTab['accompaniment-template'])
  }, [
    accompanimentTemplateFilters,
    accompanimentTemplateHeaderFilters,
    accompanimentTemplateRows,
    sortByTab['accompaniment-template'],
  ])

  const filteredRhythmTemplateRows = useMemo(() => {
    const nextRows = rhythmTemplateRows.filter((row) => {
      if (!includesText(row.name, rhythmTemplateFilters.nameQuery)) return false
      if (!includesText(row.durationCombo, rhythmTemplateFilters.durationComboQuery)) return false
      if (rhythmTemplateFilters.totalDurations.length > 0
        && !rhythmTemplateFilters.totalDurations.includes(normalizeText(row.totalDuration))) return false
      if (!csvTagsMatch(row.difficultyTags, rhythmTemplateFilters.difficultyTags)) return false
      if (!csvTagsMatch(row.styleTags, rhythmTemplateFilters.styleTags)) return false
      if (!includesText(row.name, rhythmTemplateHeaderFilters.name)) return false
      if (!includesText(row.patternData, rhythmTemplateHeaderFilters.patternData)) return false
      if (!includesText(row.totalDuration, rhythmTemplateHeaderFilters.totalDuration)) return false
      if (!includesText(row.durationCombo, rhythmTemplateHeaderFilters.durationCombo)) return false
      if (!includesText(row.difficultyTags, rhythmTemplateHeaderFilters.difficultyTags)) return false
      if (!includesText(row.styleTags, rhythmTemplateHeaderFilters.styleTags)) return false
      return true
    })
    return sortRows(nextRows, sortByTab['rhythm-template'])
  }, [
    rhythmTemplateFilters,
    rhythmTemplateHeaderFilters,
    rhythmTemplateRows,
    sortByTab['rhythm-template'],
  ])

  const notePagination = useMemo(() => paginateRows(filteredNoteRows, pageByTab.notes), [filteredNoteRows, pageByTab.notes])
  const accompanimentTemplatePagination = useMemo(
    () => paginateRows(filteredAccompanimentTemplateRows, pageByTab['accompaniment-template']),
    [filteredAccompanimentTemplateRows, pageByTab['accompaniment-template']],
  )
  const rhythmTemplatePagination = useMemo(
    () => paginateRows(filteredRhythmTemplateRows, pageByTab['rhythm-template']),
    [filteredRhythmTemplateRows, pageByTab['rhythm-template']],
  )

  useEffect(() => {
    setPageByTab((current) => ({ ...current, notes: clampPage(current.notes, notePagination.totalPages) }))
  }, [notePagination.totalPages])

  useEffect(() => {
    setPageByTab((current) => ({
      ...current,
      'accompaniment-template': clampPage(current['accompaniment-template'], accompanimentTemplatePagination.totalPages),
    }))
  }, [accompanimentTemplatePagination.totalPages])

  useEffect(() => {
    setPageByTab((current) => ({
      ...current,
      'rhythm-template': clampPage(current['rhythm-template'], rhythmTemplatePagination.totalPages),
    }))
  }, [rhythmTemplatePagination.totalPages])

  const openTagManager = useCallback(() => {
    if (activeTab === 'notes') {
      setTagModalState({
        leftKey: 'styleTags',
        rightKey: 'specialTags',
        leftTitle: '风格标签',
        rightTitle: '特殊标签',
      })
      return
    }
    setTagModalState({
      leftKey: 'styleTags',
      rightKey: 'difficultyTags',
      leftTitle: '风格标签',
      rightTitle: '难度标签',
    })
  }, [activeTab])

  const updateSelection = useCallback((tab: WorkspaceTab, rowId: number, event: ReactMouseEvent<HTMLElement>) => {
    setSelectionByTab((current) => {
      const previous = current[tab]
      if (event.ctrlKey || event.metaKey) {
        return {
          ...current,
          [tab]: previous.includes(rowId) ? previous.filter((id) => id !== rowId) : [...previous, rowId],
        }
      }
      if (previous.length === 1 && previous[0] === rowId) return current
      return {
        ...current,
        [tab]: [rowId],
      }
    })
  }, [])

  const toggleSort = useCallback((tab: WorkspaceTab, column: string) => {
    setSortByTab((current) => {
      const previous = current[tab]
      const nextDirection: SortDirection =
        previous?.column === column && previous.direction === 'asc' ? 'desc' : 'asc'
      return {
        ...current,
        [tab]: {
          column,
          direction: nextDirection,
        },
      }
    })
  }, [])

  const handleCopyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setWorkspaceMessage({
        kind: 'success',
        text: '已复制到剪贴板。',
      })
    } catch {
      setWorkspaceMessage({
        kind: 'error',
        text: '复制失败，请检查浏览器剪贴板权限。',
      })
    }
  }, [])

  const deleteRowsByTab = useCallback((tab: WorkspaceTab, rowIds: number[]) => {
    if (!database || rowIds.length === 0) return
    if (!window.confirm(`确认删除 ${rowIds.length} 条记录吗？`)) return
    if (tab === 'notes') {
      deleteAccompanimentNoteRows(database, rowIds)
      setNoteRows((current) => current.filter((row) => !rowIds.includes(row.id)))
    } else {
      const tableName = getTabTableName(tab)
      if (!tableName) return
      deleteTemplateRows(database, tableName, rowIds)
      if (tab === 'accompaniment-template') {
        setAccompanimentTemplateRows((current) => current.filter((row) => !rowIds.includes(row.id)))
      } else {
        setRhythmTemplateRows((current) => current.filter((row) => !rowIds.includes(row.id)))
      }
    }
    setSelectionByTab((current) => ({
      ...current,
      [tab]: current[tab].filter((rowId) => !rowIds.includes(rowId)),
    }))
    markDirty()
    setWorkspaceMessage({
      kind: 'success',
      text: `已删除 ${rowIds.length} 条${TAB_LABELS[tab]}记录。`,
    })
  }, [database, markDirty])

  const handleCopyRow = useCallback((state: ContextMenuState) => {
    if (state.tab === 'notes') {
      const row = noteRows.find((entry) => entry.id === state.rowId)
      if (!row) return
      void handleCopyText(JSON.stringify(row, null, 2))
      return
    }
    const sourceRows = state.tab === 'accompaniment-template' ? accompanimentTemplateRows : rhythmTemplateRows
    const row = sourceRows.find((entry) => entry.id === state.rowId)
    if (!row) return
    void handleCopyText(JSON.stringify(row, null, 2))
  }, [accompanimentTemplateRows, handleCopyText, noteRows, rhythmTemplateRows])

  const handleCopyNotes = useCallback((state: ContextMenuState) => {
    if (state.tab !== 'notes') return
    const row = noteRows.find((entry) => entry.id === state.rowId)
    if (!row) return
    void handleCopyText(row.notes)
  }, [handleCopyText, noteRows])

  const handleDeleteFromContextMenu = useCallback((state: ContextMenuState) => {
    deleteRowsByTab(state.tab, [state.rowId])
    setContextMenuState(null)
  }, [deleteRowsByTab])

  const commitNoteRowChange = useCallback((rowId: number, patch: Partial<AccompanimentNoteDbRow>) => {
    if (!database) return
    setNoteRows((current) => {
      const target = current.find((row) => row.id === rowId)
      if (!target) return current
      const nextRow: AccompanimentNoteDbRow = { ...target, ...patch }
      updateAccompanimentNoteRow(database, nextRow)
      markDirty()
      return current.map((row) => (row.id === rowId ? nextRow : row))
    })
  }, [database, markDirty])

  const commitTemplateRowChange = useCallback((tab: WorkspaceTab, rowId: number, patch: Partial<TemplateDbRow>) => {
    if (!database) return
    const tableName = getTabTableName(tab)
    if (!tableName) return
    const setter = tab === 'accompaniment-template' ? setAccompanimentTemplateRows : setRhythmTemplateRows
    setter((current) => {
      const target = current.find((row) => row.id === rowId)
      if (!target) return current
      const nextRow: TemplateDbRow = { ...target, ...patch }
      updateTemplateRow(database, tableName, nextRow)
      markDirty()
      return current.map((row) => (row.id === rowId ? nextRow : row))
    })
  }, [database, markDirty])

  const handleOpenLocalDatabase = useCallback(async () => {
    if (!fileSystemAccessAvailable) {
      setWorkspaceMessage({
        kind: 'error',
        text: '当前浏览器未启用 File System Access API，暂时无法直接打开本地数据库。',
      })
      return
    }
    try {
      const handle = await requestDatabaseFileHandle()
      if (!handle) return
      setIsLoadingDatabase(true)
      const bytes = await readDatabaseFileHandle(handle)
      const nextDb = await createDatabaseFromBytes(bytes)
      replaceDatabase({
        nextDb,
        nextFileHandle: handle,
        nextSessionInfo: createSessionInfo({
          sourceKind: 'file-handle',
          displayName: handle.name,
          canSaveInPlace: true,
        }),
      })
      setWorkspaceMessage({
        kind: 'success',
        text: `已打开本地工作库 ${handle.name}。`,
      })
    } catch (error) {
      setWorkspaceMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '打开本地数据库失败。',
      })
    } finally {
      setIsLoadingDatabase(false)
    }
  }, [fileSystemAccessAvailable, replaceDatabase])

  const handleSaveAsDatabase = useCallback(async () => {
    if (!database) return
    if (!fileSystemAccessAvailable) {
      setWorkspaceMessage({
        kind: 'error',
        text: '当前浏览器未启用 File System Access API，暂时无法另存为工作库。',
      })
      return
    }
    try {
      const handle = await requestDatabaseSaveHandle(buildSuggestedDbFileName(sessionInfo.displayName))
      if (!handle) return
      const bytes = exportDatabaseBytes(database)
      await writeDatabaseFileHandle(handle, bytes)
      setDatabaseFileHandle(handle)
      setSessionInfo((current) => ({
        ...current,
        sourceKind: 'file-handle',
        displayName: handle.name,
        canSaveInPlace: true,
        isDirty: false,
        lastSavedAt: new Date().toLocaleString('zh-CN'),
        saveError: null,
      }))
      setWorkspaceMessage({
        kind: 'success',
        text: `已另存为工作库 ${handle.name}。`,
      })
    } catch (error) {
      setWorkspaceMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '另存为工作库失败。',
      })
    }
  }, [database, fileSystemAccessAvailable, sessionInfo.displayName])

  const handleSaveDatabase = useCallback(async () => {
    if (!database) return
    if (!databaseFileHandle || !sessionInfo.canSaveInPlace) {
      setWorkspaceMessage({
        kind: 'info',
        text: '当前是内置数据库或无文件句柄，请先使用“另存为工作库”再执行保存。',
      })
      return
    }
    try {
      const bytes = exportDatabaseBytes(database)
      await writeDatabaseFileHandle(databaseFileHandle, bytes)
      markSaved()
      setWorkspaceMessage({
        kind: 'success',
        text: `已保存到 ${databaseFileHandle.name}。`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败。'
      setSessionInfo((current) => ({
        ...current,
        saveError: message,
      }))
      setWorkspaceMessage({
        kind: 'error',
        text: message,
      })
    }
  }, [database, databaseFileHandle, markSaved, sessionInfo.canSaveInPlace])

  const handleFillChordIndices = useCallback(() => {
    if (!database) return
    const updatedCount = fillMissingChordIndices(database)
    if (updatedCount <= 0) {
      setWorkspaceMessage({
        kind: 'info',
        text: '当前没有缺失的和弦序号。',
      })
      return
    }
    refreshRows(database)
    markDirty()
    setWorkspaceMessage({
      kind: 'success',
      text: `已补充 ${updatedCount} 条缺失的和弦序号。`,
    })
  }, [database, markDirty, refreshRows])

  const handleSelectEntryFiles = useCallback((tab: WorkspaceTab, event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    const fileNames = files.map((file) => file.name)
    if (tab === 'notes') {
      setNoteEntryFiles(files)
      setNoteEntryState({ fileNames, statusText: files.length > 0 ? `已选择 ${files.length} 个文件。` : '尚未解析文件。', isParsing: false })
    } else if (tab === 'accompaniment-template') {
      setTemplateEntryFiles(files)
      setTemplateEntryState({ fileNames, statusText: files.length > 0 ? `已选择 ${files.length} 个文件。` : '尚未解析文件。', isParsing: false })
    } else {
      setRhythmEntryFiles(files)
      setRhythmEntryState({ fileNames, statusText: files.length > 0 ? `已选择 ${files.length} 个文件。` : '尚未解析文件。', isParsing: false })
    }
    event.target.value = ''
  }, [])

  const parseFiles = useCallback(async (tab: WorkspaceTab) => {
    const targetFiles =
      tab === 'notes'
        ? noteEntryFiles
        : tab === 'accompaniment-template'
          ? templateEntryFiles
          : rhythmEntryFiles
    if (targetFiles.length === 0) {
      setWorkspaceMessage({
        kind: 'info',
        text: '请先选择 MusicXML 文件。',
      })
      return
    }

    const setEntryState =
      tab === 'notes'
        ? setNoteEntryState
        : tab === 'accompaniment-template'
          ? setTemplateEntryState
          : setRhythmEntryState

    setEntryState((current) => ({
      ...current,
      isParsing: true,
      statusText: '正在解析文件...',
    }))

    try {
      if (tab === 'notes') {
        const rows = (await Promise.all(targetFiles.map(async (file) => analyzeAccompanimentNoteFile(await file.text(), file.name)))).flat()
        setNoteEntryDrafts(rows)
        setNoteEntryState((current) => ({ ...current, isParsing: false, statusText: `解析完成，共 ${rows.length} 条伴奏音符记录。` }))
      } else if (tab === 'accompaniment-template') {
        const rows = (await Promise.all(targetFiles.map(async (file) => analyzeAccompanimentTemplateFile(await file.text(), file.name)))).flat()
        setTemplateEntryDrafts(rows)
        setTemplateEntryState((current) => ({ ...current, isParsing: false, statusText: `解析完成，共 ${rows.length} 条伴奏模板记录。` }))
      } else {
        const rows = (await Promise.all(targetFiles.map(async (file) => analyzeRhythmTemplateFile(await file.text(), file.name)))).flat()
        setRhythmEntryDrafts(rows)
        setRhythmEntryState((current) => ({ ...current, isParsing: false, statusText: `解析完成，共 ${rows.length} 条律动模板记录。` }))
      }
    } catch (error) {
      setEntryState((current) => ({
        ...current,
        isParsing: false,
        statusText: error instanceof Error ? error.message : '文件解析失败。',
      }))
    }
  }, [noteEntryFiles, rhythmEntryFiles, templateEntryFiles])

  const clearEntryDrafts = useCallback((tab: WorkspaceTab) => {
    if (tab === 'notes') {
      setNoteEntryFiles([])
      setNoteEntryDrafts([])
      setNoteEntryState({ fileNames: [], statusText: '已清空伴奏音符暂存列表。', isParsing: false })
      return
    }
    if (tab === 'accompaniment-template') {
      setTemplateEntryFiles([])
      setTemplateEntryDrafts([])
      setTemplateEntryState({ fileNames: [], statusText: '已清空伴奏模板暂存列表。', isParsing: false })
      return
    }
    setRhythmEntryFiles([])
    setRhythmEntryDrafts([])
    setRhythmEntryState({ fileNames: [], statusText: '已清空律动模板暂存列表。', isParsing: false })
  }, [])

  const saveEntryDrafts = useCallback((tab: WorkspaceTab) => {
    if (!database) return
    if (tab === 'notes') {
      const result = insertAccompanimentEntryRows(database, noteEntryDrafts)
      refreshRows(database)
      markDirty()
      setWorkspaceMessage({
        kind: 'success',
        text: `伴奏音符入库完成：新增 ${result.insertedCount} 条，合并 ${result.mergedCount} 条，跳过 ${result.skippedCount} 条。`,
      })
      setTabModes((current) => ({ ...current, notes: 'database' }))
      return
    }
    const tableName = getTabTableName(tab)
    if (!tableName) return
    const insertedCount = insertTemplateEntryRows(
      database,
      tableName,
      tab === 'accompaniment-template' ? templateEntryDrafts : rhythmEntryDrafts,
    )
    refreshRows(database)
    markDirty()
    setWorkspaceMessage({
      kind: 'success',
      text: `${getTemplateTypeLabel(tableName)}入库完成：新增 ${insertedCount} 条。`,
    })
    setTabModes((current) => ({ ...current, [tab]: 'database' }))
  }, [database, markDirty, noteEntryDrafts, refreshRows, rhythmEntryDrafts, templateEntryDrafts])

  const renderSortIndicator = useCallback((tab: WorkspaceTab, column: string) => {
    const currentSort = sortByTab[tab]
    if (!currentSort || currentSort.column !== column) return null
    return <span className="database-sort-indicator">{currentSort.direction === 'asc' ? '↑' : '↓'}</span>
  }, [sortByTab])

  const renderDatabaseToolbar = useCallback(() => {
    if (activeTab === 'notes') {
      return (
        <div className="database-toolbar">
          <button type="button" onClick={() => refreshRows(database as SqlJsDatabase)} disabled={!database}>刷新</button>
          <button
            type="button"
            onClick={() => {
              setNoteFilters(DEFAULT_NOTE_FILTERS)
              setNoteHeaderFilters(DEFAULT_NOTE_HEADER_FILTERS)
              setPageByTab((current) => ({ ...current, notes: 1 }))
            }}
          >
            清空筛选
          </button>
          <button
            type="button"
            className={headerFilterEnabledByTab.notes ? 'is-active' : ''}
            onClick={() => setHeaderFilterEnabledByTab((current) => ({ ...current, notes: !current.notes }))}
          >
            表头筛选
          </button>
          <button
            type="button"
            className={notePreviewEnabled ? 'is-active' : ''}
            onClick={() => setNotePreviewEnabled((current) => !current)}
          >
            曲谱预览
          </button>
          <button type="button" onClick={handleFillChordIndices} disabled={!database}>补充和弦序号</button>
          <button type="button" onClick={openTagManager}>标签管理</button>
          <button type="button" className="is-danger" disabled={selectionByTab.notes.length === 0} onClick={() => deleteRowsByTab('notes', selectionByTab.notes)}>
            删除选中
          </button>
        </div>
      )
    }

    const tab = activeTab
    return (
      <div className="database-toolbar">
        <button type="button" onClick={() => refreshRows(database as SqlJsDatabase)} disabled={!database}>刷新</button>
        <button
          type="button"
          onClick={() => {
            if (tab === 'accompaniment-template') {
              setAccompanimentTemplateFilters(DEFAULT_TEMPLATE_FILTERS)
              setAccompanimentTemplateHeaderFilters(DEFAULT_TEMPLATE_HEADER_FILTERS)
              setPageByTab((current) => ({ ...current, 'accompaniment-template': 1 }))
            } else {
              setRhythmTemplateFilters(DEFAULT_TEMPLATE_FILTERS)
              setRhythmTemplateHeaderFilters(DEFAULT_TEMPLATE_HEADER_FILTERS)
              setPageByTab((current) => ({ ...current, 'rhythm-template': 1 }))
            }
          }}
        >
          清空筛选
        </button>
        <button
          type="button"
          className={headerFilterEnabledByTab[tab] ? 'is-active' : ''}
          onClick={() => setHeaderFilterEnabledByTab((current) => ({ ...current, [tab]: !current[tab] }))}
        >
          表头筛选
        </button>
        <button type="button" onClick={openTagManager}>标签管理</button>
        <button type="button" className="is-danger" disabled={selectionByTab[tab].length === 0} onClick={() => deleteRowsByTab(tab, selectionByTab[tab])}>
          删除选中
        </button>
      </div>
    )
  }, [
    activeTab,
    database,
    deleteRowsByTab,
    handleFillChordIndices,
    headerFilterEnabledByTab,
    notePreviewEnabled,
    openTagManager,
    refreshRows,
    selectionByTab,
  ])

  const renderNotesFilterBar = () => (
    <div className="database-filter-grid database-filter-grid--notes">
      <label>
        <span>伴奏音符</span>
        <input value={noteFilters.notesQuery} onChange={(event) => {
          setNoteFilters((current) => ({ ...current, notesQuery: event.target.value }))
          setPageByTab((current) => ({ ...current, notes: 1 }))
        }} placeholder="筛选 notes" />
      </label>
      <label>
        <span>和弦类型</span>
        <input value={noteFilters.chordTypeQuery} onChange={(event) => {
          setNoteFilters((current) => ({ ...current, chordTypeQuery: event.target.value }))
          setPageByTab((current) => ({ ...current, notes: 1 }))
        }} placeholder="例如 C / Amadd9" />
      </label>
      <label>
        <span>伴奏结构</span>
        <input value={noteFilters.structureQuery} onChange={(event) => {
          setNoteFilters((current) => ({ ...current, structureQuery: event.target.value }))
          setPageByTab((current) => ({ ...current, notes: 1 }))
        }} placeholder="例如 单音＋和弦" />
      </label>
      <CheckboxDropdown label="音的数量" options={noteCountOptions} selectedValues={noteFilters.noteCounts} onChange={(nextValues) => {
        setNoteFilters((current) => ({ ...current, noteCounts: nextValues }))
        setPageByTab((current) => ({ ...current, notes: 1 }))
      }} />
      <CheckboxDropdown label="音符方向" options={noteDirectionOptions} selectedValues={noteFilters.directions} onChange={(nextValues) => {
        setNoteFilters((current) => ({ ...current, directions: nextValues }))
        setPageByTab((current) => ({ ...current, notes: 1 }))
      }} />
      <label>
        <span>常用</span>
        <select value={noteFilters.commonState} onChange={(event) => {
          setNoteFilters((current) => ({ ...current, commonState: event.target.value as NoteFilters['commonState'] }))
          setPageByTab((current) => ({ ...current, notes: 1 }))
        }}>
          <option value="all">全部</option>
          <option value="yes">是</option>
          <option value="no">否</option>
        </select>
      </label>
      <CheckboxDropdown label="风格标签" options={noteStyleOptions} selectedValues={noteFilters.styleTags} onChange={(nextValues) => {
        setNoteFilters((current) => ({ ...current, styleTags: nextValues }))
        setPageByTab((current) => ({ ...current, notes: 1 }))
      }} />
      <CheckboxDropdown label="特殊标签" options={noteSpecialOptions} selectedValues={noteFilters.specialTags} onChange={(nextValues) => {
        setNoteFilters((current) => ({ ...current, specialTags: nextValues }))
        setPageByTab((current) => ({ ...current, notes: 1 }))
      }} />
    </div>
  )

  const renderTemplateFilterBar = (
    tab: WorkspaceTab,
    filters: TemplateFilters,
    setFilters: Dispatch<SetStateAction<TemplateFilters>>,
  ) => (
    <div className="database-filter-grid">
      <label>
        <span>模板名</span>
        <input value={filters.nameQuery} onChange={(event) => {
          setFilters((current) => ({ ...current, nameQuery: event.target.value }))
          setPageByTab((current) => ({ ...current, [tab]: 1 }))
        }} placeholder="按名称筛选" />
      </label>
      <label>
        <span>时值组合</span>
        <input value={filters.durationComboQuery} onChange={(event) => {
          setFilters((current) => ({ ...current, durationComboQuery: event.target.value }))
          setPageByTab((current) => ({ ...current, [tab]: 1 }))
        }} placeholder="例如 4_4" />
      </label>
      <CheckboxDropdown label="总时值" options={templateDurationOptions} selectedValues={filters.totalDurations} onChange={(nextValues) => {
        setFilters((current) => ({ ...current, totalDurations: nextValues }))
        setPageByTab((current) => ({ ...current, [tab]: 1 }))
      }} />
      <CheckboxDropdown label="难度标签" options={tagLibrary.difficultyTags.filter((entry) => entry !== '无')} selectedValues={filters.difficultyTags} onChange={(nextValues) => {
        setFilters((current) => ({ ...current, difficultyTags: nextValues }))
        setPageByTab((current) => ({ ...current, [tab]: 1 }))
      }} />
      <CheckboxDropdown label="风格标签" options={tagLibrary.styleTags.filter((entry) => entry !== '无')} selectedValues={filters.styleTags} onChange={(nextValues) => {
        setFilters((current) => ({ ...current, styleTags: nextValues }))
        setPageByTab((current) => ({ ...current, [tab]: 1 }))
      }} />
    </div>
  )

  const handleTemplateHeaderFilterChange = (
    tab: WorkspaceTab,
    key: keyof TemplateHeaderFilters,
    value: string,
  ) => {
    if (tab === 'accompaniment-template') {
      setAccompanimentTemplateHeaderFilters((current) => ({ ...current, [key]: value }))
      return
    }
    setRhythmTemplateHeaderFilters((current) => ({ ...current, [key]: value }))
  }

  const renderNotesTable = () => (
    <div className="database-table-wrap">
      <table className="database-table">
        <thead>
          <tr>
            <th>ID</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort('notes', 'notes')}>伴奏音符{renderSortIndicator('notes', 'notes')}</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort('notes', 'noteCount')}>音的数量{renderSortIndicator('notes', 'noteCount')}</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort('notes', 'chordType')}>和弦类型{renderSortIndicator('notes', 'chordType')}</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort('notes', 'chordIndex')}>和弦序号{renderSortIndicator('notes', 'chordIndex')}</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort('notes', 'noteDirection')}>音符方向{renderSortIndicator('notes', 'noteDirection')}</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort('notes', 'structure')}>伴奏结构{renderSortIndicator('notes', 'structure')}</th>
            <th>常用</th>
            <th>风格标签</th>
            <th>特殊标签</th>
          </tr>
          {headerFilterEnabledByTab.notes && (
            <tr className="database-header-filter-row">
              <th />
              <th><input value={noteHeaderFilters.notes} onChange={(event) => setNoteHeaderFilters((current) => ({ ...current, notes: event.target.value }))} /></th>
              <th><input value={noteHeaderFilters.noteCount} onChange={(event) => setNoteHeaderFilters((current) => ({ ...current, noteCount: event.target.value }))} /></th>
              <th><input value={noteHeaderFilters.chordType} onChange={(event) => setNoteHeaderFilters((current) => ({ ...current, chordType: event.target.value }))} /></th>
              <th><input value={noteHeaderFilters.chordIndex} onChange={(event) => setNoteHeaderFilters((current) => ({ ...current, chordIndex: event.target.value }))} /></th>
              <th><input value={noteHeaderFilters.noteDirection} onChange={(event) => setNoteHeaderFilters((current) => ({ ...current, noteDirection: event.target.value }))} /></th>
              <th><input value={noteHeaderFilters.structure} onChange={(event) => setNoteHeaderFilters((current) => ({ ...current, structure: event.target.value }))} /></th>
              <th />
              <th><input value={noteHeaderFilters.styleTags} onChange={(event) => setNoteHeaderFilters((current) => ({ ...current, styleTags: event.target.value }))} /></th>
              <th><input value={noteHeaderFilters.specialTags} onChange={(event) => setNoteHeaderFilters((current) => ({ ...current, specialTags: event.target.value }))} /></th>
            </tr>
          )}
        </thead>
        <tbody>
          {notePagination.pageRows.map((row) => (
            <tr
              key={row.id}
              className={selectionByTab.notes.includes(row.id) ? 'is-selected' : ''}
              onClick={(event) => updateSelection('notes', row.id, event)}
              onContextMenu={(event) => {
                event.preventDefault()
                updateSelection('notes', row.id, event)
                setContextMenuState({ x: event.clientX, y: event.clientY, rowId: row.id, tab: 'notes' })
              }}
            >
              <td>{row.id}</td>
              <td><textarea defaultValue={row.notes} rows={3} onBlur={(event) => {
                const nextValue = normalizeText(event.target.value)
                if (nextValue !== row.notes) commitNoteRowChange(row.id, { notes: nextValue })
              }} /></td>
              <td><input type="number" defaultValue={row.noteCount ?? ''} onBlur={(event) => {
                const raw = normalizeText(event.target.value)
                const nextValue = raw ? Number(raw) : null
                if (nextValue !== row.noteCount) commitNoteRowChange(row.id, { noteCount: nextValue })
              }} /></td>
              <td><input defaultValue={row.chordType} onBlur={(event) => {
                const nextValue = normalizeText(event.target.value)
                if (nextValue !== row.chordType) commitNoteRowChange(row.id, { chordType: nextValue })
              }} /></td>
              <td><input defaultValue={row.chordIndex} onBlur={(event) => {
                const nextValue = normalizeText(event.target.value)
                if (nextValue !== row.chordIndex) commitNoteRowChange(row.id, { chordIndex: nextValue })
              }} /></td>
              <td><input defaultValue={row.noteDirection} onBlur={(event) => {
                const nextValue = normalizeText(event.target.value)
                if (nextValue !== row.noteDirection) commitNoteRowChange(row.id, { noteDirection: nextValue })
              }} /></td>
              <td><input defaultValue={row.structure} onBlur={(event) => {
                const nextValue = normalizeText(event.target.value)
                if (nextValue !== row.structure) commitNoteRowChange(row.id, { structure: nextValue })
              }} /></td>
              <td>
                <label className="database-inline-checkbox">
                  <input type="checkbox" checked={row.isCommon} onChange={(event) => commitNoteRowChange(row.id, { isCommon: event.target.checked })} />
                  <span>{row.isCommon ? '是' : '否'}</span>
                </label>
              </td>
              <td><InlineTagSelector value={row.styleTags} options={tagLibrary.styleTags} placeholder="风格" onChange={(nextValue) => commitNoteRowChange(row.id, { styleTags: nextValue })} /></td>
              <td><InlineTagSelector value={row.specialTags} options={tagLibrary.specialTags} placeholder="特殊" onChange={(nextValue) => commitNoteRowChange(row.id, { specialTags: nextValue })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {notePagination.pageRows.length === 0 && <div className="database-empty-state">当前筛选条件下没有伴奏音符记录。</div>}
    </div>
  )

  const renderTemplateTable = (tab: WorkspaceTab, rows: TemplateDbRow[], headerFilters: TemplateHeaderFilters) => (
    <div className="database-table-wrap">
      <table className="database-table">
        <thead>
          <tr>
            <th>ID</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort(tab, 'name')}>模板名{renderSortIndicator(tab, 'name')}</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort(tab, 'patternData')}>模板详细内容{renderSortIndicator(tab, 'patternData')}</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort(tab, 'totalDuration')}>总时值{renderSortIndicator(tab, 'totalDuration')}</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort(tab, 'durationCombo')}>时值组合{renderSortIndicator(tab, 'durationCombo')}</th>
            <th>难易程度</th>
            <th>风格</th>
            <th role="button" tabIndex={0} onClick={() => toggleSort(tab, 'createdAt')}>创建时间{renderSortIndicator(tab, 'createdAt')}</th>
          </tr>
          {headerFilterEnabledByTab[tab] && (
            <tr className="database-header-filter-row">
              <th />
              <th><input value={headerFilters.name} onChange={(event) => handleTemplateHeaderFilterChange(tab, 'name', event.target.value)} /></th>
              <th><input value={headerFilters.patternData} onChange={(event) => handleTemplateHeaderFilterChange(tab, 'patternData', event.target.value)} /></th>
              <th><input value={headerFilters.totalDuration} onChange={(event) => handleTemplateHeaderFilterChange(tab, 'totalDuration', event.target.value)} /></th>
              <th><input value={headerFilters.durationCombo} onChange={(event) => handleTemplateHeaderFilterChange(tab, 'durationCombo', event.target.value)} /></th>
              <th><input value={headerFilters.difficultyTags} onChange={(event) => handleTemplateHeaderFilterChange(tab, 'difficultyTags', event.target.value)} /></th>
              <th><input value={headerFilters.styleTags} onChange={(event) => handleTemplateHeaderFilterChange(tab, 'styleTags', event.target.value)} /></th>
              <th />
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={selectionByTab[tab].includes(row.id) ? 'is-selected' : ''}
              onClick={(event) => updateSelection(tab, row.id, event)}
              onContextMenu={(event) => {
                event.preventDefault()
                updateSelection(tab, row.id, event)
                setContextMenuState({ x: event.clientX, y: event.clientY, rowId: row.id, tab })
              }}
            >
              <td>{row.id}</td>
              <td><input defaultValue={row.name} onBlur={(event) => {
                const nextValue = normalizeText(event.target.value) || '未命名'
                if (nextValue !== row.name) commitTemplateRowChange(tab, row.id, { name: nextValue })
              }} /></td>
              <td><textarea defaultValue={row.patternData} rows={4} onBlur={(event) => {
                const nextValue = event.target.value.trim()
                if (nextValue !== row.patternData) commitTemplateRowChange(tab, row.id, { patternData: nextValue })
              }} /></td>
              <td><input type="number" defaultValue={row.totalDuration ?? ''} onBlur={(event) => {
                const raw = normalizeText(event.target.value)
                const nextValue = raw ? Number(raw) : null
                if (nextValue !== row.totalDuration) commitTemplateRowChange(tab, row.id, { totalDuration: nextValue })
              }} /></td>
              <td><input defaultValue={row.durationCombo} onBlur={(event) => {
                const nextValue = normalizeText(event.target.value)
                if (nextValue !== row.durationCombo) commitTemplateRowChange(tab, row.id, { durationCombo: nextValue })
              }} /></td>
              <td>
                <select value={row.difficultyTags || '无'} onChange={(event) => commitTemplateRowChange(tab, row.id, { difficultyTags: event.target.value === '无' ? '' : event.target.value })}>
                  {tagLibrary.difficultyTags.map((tag) => (
                    <option key={`${row.id}-${tag}`} value={tag}>{tag}</option>
                  ))}
                </select>
              </td>
              <td><InlineTagSelector value={row.styleTags} options={tagLibrary.styleTags} placeholder="风格" onChange={(nextValue) => commitTemplateRowChange(tab, row.id, { styleTags: nextValue })} /></td>
              <td>{row.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="database-empty-state">当前筛选条件下没有模板记录。</div>}
    </div>
  )

  const renderNotePreviewGrid = () => (
    <div className="database-preview-grid">
      {notePagination.pageRows.map((row) => (
        <article
          key={row.id}
          className={`database-preview-card${selectionByTab.notes.includes(row.id) ? ' is-selected' : ''}`}
          onClick={(event) => updateSelection('notes', row.id, event as unknown as ReactMouseEvent<HTMLElement>)}
          onContextMenu={(event) => {
            event.preventDefault()
            setContextMenuState({ x: event.clientX, y: event.clientY, rowId: row.id, tab: 'notes' })
          }}
        >
          <header className="database-preview-card-header">
            <strong>{`${row.chordType || '未识别和弦'} · #${row.id}`}</strong>
            <span>{`${row.noteCount ?? 0} 音 / ${row.noteDirection || '-'}`}</span>
          </header>
          <DatabaseNotePreviewCanvas
            notesText={row.notes}
            timeAxisSpacingConfig={timeAxisSpacingConfig}
            spacingLayoutMode={spacingLayoutMode}
            grandStaffLayoutMetrics={grandStaffLayoutMetrics}
          />
          <div className="database-preview-card-meta">
            <span>{`结构：${row.structure || '-'}`}</span>
            <span>{`常用：${row.isCommon ? '是' : '否'}`}</span>
            <span>{`风格：${row.styleTags || '无'}`}</span>
            <span>{`特殊：${row.specialTags || '无'}`}</span>
          </div>
          <p className="database-preview-card-notes">{row.notes}</p>
        </article>
      ))}
      {notePagination.pageRows.length === 0 && <div className="database-empty-state">当前筛选结果没有可预览的伴奏音符。</div>}
    </div>
  )

  const renderEntryMode = () => {
    const currentState =
      activeTab === 'notes'
        ? noteEntryState
        : activeTab === 'accompaniment-template'
          ? templateEntryState
          : rhythmEntryState
    const currentDrafts =
      activeTab === 'notes'
        ? noteEntryDrafts
        : activeTab === 'accompaniment-template'
          ? templateEntryDrafts
          : rhythmEntryDrafts
    const fileInputRef =
      activeTab === 'notes'
        ? noteEntryInputRef
        : activeTab === 'accompaniment-template'
          ? accompanimentTemplateEntryInputRef
          : rhythmTemplateEntryInputRef
    const entryTypeLabel =
      activeTab === 'notes'
        ? '伴奏音符'
        : activeTab === 'accompaniment-template'
          ? '伴奏模板'
          : '律动模板'
    const entryContentTitle =
      activeTab === 'notes'
        ? '伴奏音符解析结果'
        : activeTab === 'accompaniment-template'
          ? '伴奏模板解析结果'
          : '律动模板解析结果'

    return (
      <section className="database-entry-panel">
        <div className="database-mode-layout">
          <DatabaseSectionCard
            eyebrow={TAB_LABELS[activeTab]}
            title="文件操作"
            description={`继续沿用当前多文件解析与暂存入库流程，直接整理 ${entryTypeLabel} 数据。`}
            className="database-section-card--file"
          >
            <div className="database-entry-toolbar">
              <div className="database-entry-file-path">{joinFileNames(currentState.fileNames)}</div>
              <button type="button" onClick={() => fileInputRef.current?.click()}>选择文件</button>
              <button type="button" onClick={() => void parseFiles(activeTab)} disabled={currentState.isParsing}>文件解析</button>
              <button type="button" onClick={() => clearEntryDrafts(activeTab)}>清空列表</button>
              <button type="button" onClick={openTagManager}>标签管理</button>
              <button type="button" className="database-primary-button" onClick={() => saveEntryDrafts(activeTab)} disabled={currentDrafts.length === 0}>保存到数据库</button>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept=".musicxml,.xml,text/xml,application/xml"
                onChange={(event) => handleSelectEntryFiles(activeTab, event)}
              />
            </div>
          </DatabaseSectionCard>

          <DatabaseSectionCard
            eyebrow={tabModes[activeTab] === 'entry' ? '录入数据' : TAB_LABELS[activeTab]}
            title={entryContentTitle}
            description={currentDrafts.length > 0 ? `当前暂存 ${currentDrafts.length} 条待入库记录。` : `当前还没有可入库的 ${entryTypeLabel} 解析结果。`}
            className="database-section-card--content"
          >
            {activeTab === 'notes' ? (
              <div className="database-table-wrap">
                <table className="database-table">
                  <thead>
                    <tr>
                      <th>#</th><th>伴奏音符</th><th>音的数量</th><th>和弦类型</th><th>和弦序号</th>
                      <th>音符方向</th><th>伴奏结构</th><th>常用</th><th>风格标签</th><th>特殊标签</th>
                    </tr>
                  </thead>
                  <tbody>
                    {noteEntryDrafts.map((row, index) => (
                      <tr key={`note-entry-${index + 1}`}>
                        <td>{index + 1}</td>
                        <td><textarea value={row.notes} rows={3} onChange={(event) => setNoteEntryDrafts((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, notes: event.target.value } : entry))} /></td>
                        <td><input type="number" value={row.noteCount ?? ''} onChange={(event) => {
                          const raw = normalizeText(event.target.value)
                          setNoteEntryDrafts((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, noteCount: raw ? Number(raw) : null } : entry))
                        }} /></td>
                        <td><input value={row.chordType} onChange={(event) => setNoteEntryDrafts((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, chordType: event.target.value } : entry))} /></td>
                        <td><input value={row.chordIndex} onChange={(event) => setNoteEntryDrafts((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, chordIndex: event.target.value } : entry))} /></td>
                        <td><input value={row.noteDirection} onChange={(event) => setNoteEntryDrafts((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, noteDirection: event.target.value } : entry))} /></td>
                        <td><input value={row.structure} onChange={(event) => setNoteEntryDrafts((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, structure: event.target.value } : entry))} /></td>
                        <td><label className="database-inline-checkbox"><input type="checkbox" checked={row.isCommon} onChange={(event) => setNoteEntryDrafts((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, isCommon: event.target.checked } : entry))} /><span>{row.isCommon ? '是' : '否'}</span></label></td>
                        <td><InlineTagSelector value={row.styleTags} options={tagLibrary.styleTags} placeholder="风格" onChange={(nextValue) => setNoteEntryDrafts((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, styleTags: nextValue } : entry))} /></td>
                        <td><InlineTagSelector value={row.specialTags} options={tagLibrary.specialTags} placeholder="特殊" onChange={(nextValue) => setNoteEntryDrafts((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, specialTags: nextValue } : entry))} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {noteEntryDrafts.length === 0 && <div className="database-empty-state">当前没有待入库的伴奏音符解析结果。</div>}
              </div>
            ) : (
              <div className="database-table-wrap">
                <table className="database-table">
                  <thead>
                    <tr>
                      <th>#</th><th>模板名</th><th>模板详细内容</th><th>总时值</th><th>时值组合</th><th>难易程度</th><th>风格</th><th>来源文件</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeTab === 'accompaniment-template' ? templateEntryDrafts : rhythmEntryDrafts).map((row, index) => (
                      <tr key={`${activeTab}-entry-${index + 1}`}>
                        <td>{index + 1}</td>
                        <td><input value={row.name} onChange={(event) => {
                          const setter = activeTab === 'accompaniment-template' ? setTemplateEntryDrafts : setRhythmEntryDrafts
                          setter((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, name: event.target.value } : entry))
                        }} /></td>
                        <td><textarea value={row.patternData} rows={4} onChange={(event) => {
                          const setter = activeTab === 'accompaniment-template' ? setTemplateEntryDrafts : setRhythmEntryDrafts
                          setter((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, patternData: event.target.value } : entry))
                        }} /></td>
                        <td><input type="number" value={row.totalDuration ?? ''} onChange={(event) => {
                          const raw = normalizeText(event.target.value)
                          const setter = activeTab === 'accompaniment-template' ? setTemplateEntryDrafts : setRhythmEntryDrafts
                          setter((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, totalDuration: raw ? Number(raw) : null } : entry))
                        }} /></td>
                        <td><input value={row.durationCombo} onChange={(event) => {
                          const setter = activeTab === 'accompaniment-template' ? setTemplateEntryDrafts : setRhythmEntryDrafts
                          setter((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, durationCombo: event.target.value } : entry))
                        }} /></td>
                        <td><select value={row.difficultyTags || '无'} onChange={(event) => {
                          const setter = activeTab === 'accompaniment-template' ? setTemplateEntryDrafts : setRhythmEntryDrafts
                          setter((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, difficultyTags: event.target.value === '无' ? '' : event.target.value } : entry))
                        }}>{tagLibrary.difficultyTags.map((tag) => <option key={`${activeTab}-difficulty-${index}-${tag}`} value={tag}>{tag}</option>)}</select></td>
                        <td><InlineTagSelector value={row.styleTags} options={tagLibrary.styleTags} placeholder="风格" onChange={(nextValue) => {
                          const setter = activeTab === 'accompaniment-template' ? setTemplateEntryDrafts : setRhythmEntryDrafts
                          setter((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, styleTags: nextValue } : entry))
                        }} /></td>
                        <td>{row.filePath}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(activeTab === 'accompaniment-template' ? templateEntryDrafts : rhythmEntryDrafts).length === 0 && <div className="database-empty-state">当前没有待入库的模板解析结果。</div>}
              </div>
            )}
          </DatabaseSectionCard>

          <DatabaseSectionCard
            eyebrow="当前状态"
            title="解析与入库进度"
            description={`当前模式保留现有表格内编辑模型，${entryTypeLabel} 数据可直接在结果表里整理。`}
            className="database-section-card--status"
            contentClassName="database-section-card-content--status"
          >
            <div className="database-entry-status-bar">
              <span className="database-entry-status">{currentState.statusText}</span>
              <span className="database-status-pill">{`暂存 ${currentDrafts.length} 条`}</span>
            </div>
          </DatabaseSectionCard>
        </div>
      </section>
    )
  }

  const renderDatabaseMode = () => {
    const currentTabLabel = TAB_LABELS[activeTab]
    const filterSection =
      activeTab === 'notes'
        ? renderNotesFilterBar()
        : activeTab === 'accompaniment-template'
          ? renderTemplateFilterBar(activeTab, accompanimentTemplateFilters, setAccompanimentTemplateFilters)
          : renderTemplateFilterBar(activeTab, rhythmTemplateFilters, setRhythmTemplateFilters)
    const contentSection =
      activeTab === 'notes'
        ? notePreviewEnabled ? renderNotePreviewGrid() : renderNotesTable()
        : activeTab === 'accompaniment-template'
          ? renderTemplateTable(activeTab, accompanimentTemplatePagination.pageRows, accompanimentTemplateHeaderFilters)
          : renderTemplateTable(activeTab, rhythmTemplatePagination.pageRows, rhythmTemplateHeaderFilters)
    const totalRows =
      activeTab === 'notes'
        ? filteredNoteRows.length
        : activeTab === 'accompaniment-template'
          ? filteredAccompanimentTemplateRows.length
          : filteredRhythmTemplateRows.length
    const selectedCount = selectionByTab[activeTab].length
    const page =
      activeTab === 'notes'
        ? clampPage(pageByTab.notes, notePagination.totalPages)
        : activeTab === 'accompaniment-template'
          ? clampPage(pageByTab['accompaniment-template'], accompanimentTemplatePagination.totalPages)
          : clampPage(pageByTab['rhythm-template'], rhythmTemplatePagination.totalPages)
    const totalPages =
      activeTab === 'notes'
        ? notePagination.totalPages
        : activeTab === 'accompaniment-template'
          ? accompanimentTemplatePagination.totalPages
          : rhythmTemplatePagination.totalPages
    const handlePageChange = (nextPage: number) => {
      if (activeTab === 'notes') {
        setPageByTab((current) => ({ ...current, notes: clampPage(nextPage, notePagination.totalPages) }))
        return
      }
      if (activeTab === 'accompaniment-template') {
        setPageByTab((current) => ({ ...current, 'accompaniment-template': clampPage(nextPage, accompanimentTemplatePagination.totalPages) }))
        return
      }
      setPageByTab((current) => ({ ...current, 'rhythm-template': clampPage(nextPage, rhythmTemplatePagination.totalPages) }))
    }
    const contentTitle =
      activeTab === 'notes'
        ? notePreviewEnabled ? '伴奏音符曲谱预览' : '伴奏音符数据库表格'
        : activeTab === 'accompaniment-template'
          ? '伴奏模板数据库表格'
          : '律动模板数据库表格'

    return (
      <section className="database-view-panel">
        <div className="database-mode-layout">
          <DatabaseSectionCard
            eyebrow={currentTabLabel}
            title="筛选条件"
            description="筛选区固定放在内容最上方，集中控制当前数据库结果。"
            className="database-section-card--filters"
          >
            {filterSection}
          </DatabaseSectionCard>

          <DatabaseSectionCard
            eyebrow={currentTabLabel}
            title="常用操作"
            description="保留当前刷新、清空筛选、表头筛选、标签管理和删除逻辑。"
            className="database-section-card--tools"
          >
            {renderDatabaseToolbar()}
          </DatabaseSectionCard>

          <DatabaseSectionCard
            eyebrow={currentTabLabel}
            title={contentTitle}
            description={activeTab === 'notes' && notePreviewEnabled ? '当前页结果以曲谱预览方式展示，但仍共用同一套筛选、选择与分页状态。' : '主内容区统一承载表格或预览内容，不再与筛选和工具平铺在同一层。'}
            className="database-section-card--content"
          >
            {contentSection}
          </DatabaseSectionCard>

          <DatabaseSectionCard
            eyebrow="结果统计"
            title="分页与状态"
            description={`当前筛选结果 ${totalRows} 条，已选 ${selectedCount} 条。`}
            className="database-section-card--footer"
            contentClassName="database-section-card-content--footer"
          >
            <PaginationBar page={page} totalPages={totalPages} totalRows={totalRows} selectedCount={selectedCount} onPageChange={handlePageChange} />
          </DatabaseSectionCard>
        </div>
      </section>
    )
  }

  return (
    <section className="database-workspace" hidden={!isVisible}>
      <header className="database-workspace-header">
        <div className="database-workspace-title">
          <div className="database-workspace-title-row">
            <h2>数据库工作区</h2>
            <span className="database-source-badge">{renderDirtyLabel(sessionInfo)}</span>
          </div>
          <p>{`当前数据库：${sessionInfo.displayName}`}{sessionInfo.lastSavedAt ? ` · 最近保存：${sessionInfo.lastSavedAt}` : ''}</p>
          {!fileSystemAccessAvailable && <p className="database-inline-hint">当前浏览器未启用 File System Access API，本地工作库打开/原地保存将不可用。</p>}
        </div>
        <div className="database-workspace-actions">
          <button type="button" onClick={handleOpenLocalDatabase} disabled={isLoadingDatabase}>打开本地数据库</button>
          <button type="button" onClick={handleSaveAsDatabase} disabled={!database}>另存为工作库</button>
          <button type="button" className="database-primary-button" onClick={handleSaveDatabase} disabled={!database || !sessionInfo.canSaveInPlace || !sessionInfo.isDirty}>保存</button>
          <button type="button" onClick={loadBundledDatabase} disabled={isLoadingDatabase}>重新打开内置库</button>
        </div>
      </header>

      {workspaceMessage && <div className={`database-message database-message--${workspaceMessage.kind}`}><span>{workspaceMessage.text}</span><button type="button" onClick={() => setWorkspaceMessage(null)}>关闭</button></div>}
      {sessionInfo.saveError && <div className="database-message database-message--error"><span>{sessionInfo.saveError}</span><button type="button" onClick={() => setSessionInfo((current) => ({ ...current, saveError: null }))}>关闭</button></div>}

      <div className="database-navigation-grid">
        <DatabaseSectionCard
          eyebrow="页面结构"
          title="数据库模块"
          description="三个主 tab 共享同一套页面骨架与布局节奏。"
          className="database-section-card--navigation"
        >
          <div className="database-top-tabs" role="tablist" aria-label="数据库工作区模块">
            {(Object.keys(TAB_LABELS) as WorkspaceTab[]).map((tab) => (
              <button key={tab} type="button" className={activeTab === tab ? 'is-active' : ''} onClick={() => setActiveTab(tab)}>
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </DatabaseSectionCard>

        <DatabaseSectionCard
          eyebrow={TAB_LABELS[activeTab]}
          title="当前模式"
          description="录入数据与查看数据库继续共用当前状态，不切断筛选和暂存上下文。"
          className="database-section-card--navigation"
        >
          <div className="database-mode-toggle">
            <button type="button" className={tabModes[activeTab] === 'entry' ? 'is-active' : ''} onClick={() => setTabModes((current) => ({ ...current, [activeTab]: 'entry' }))}>录入数据</button>
            <button type="button" className={tabModes[activeTab] === 'database' ? 'is-active' : ''} onClick={() => setTabModes((current) => ({ ...current, [activeTab]: 'database' }))}>查看数据库</button>
          </div>
        </DatabaseSectionCard>
      </div>

      {isLoadingDatabase ? <div className="database-loading-state">正在加载数据库...</div> : tabModes[activeTab] === 'entry' ? renderEntryMode() : renderDatabaseMode()}

      {tagModalState && <TagManagerModal state={tagModalState} tagLibrary={tagLibrary} onClose={() => setTagModalState(null)} onSave={(nextLibrary) => {
        setTagLibrary(nextLibrary)
        setTagModalState(null)
        setWorkspaceMessage({ kind: 'success', text: '标签库已更新。' })
      }} />}
      {contextMenuState && <ContextMenu state={contextMenuState} onClose={() => setContextMenuState(null)} onCopyRow={handleCopyRow} onCopyNotes={handleCopyNotes} onDeleteRow={handleDeleteFromContextMenu} />}
    </section>
  )
}
