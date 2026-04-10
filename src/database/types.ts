export type DatabaseSourceKind = 'bundled' | 'file-handle'

export type SqlValue = string | number | Uint8Array | null

export type QueryRow = Record<string, SqlValue>

export type DatabaseSessionInfo = {
  sourceKind: DatabaseSourceKind
  displayName: string
  canSaveInPlace: boolean
  isDirty: boolean
  lastSavedAt: string | null
  saveError: string | null
}

export type AccompanimentNoteDbRow = {
  id: number
  title: string
  artist: string
  createdAt: string
  filePath: string
  notes: string
  noteCount: number | null
  chordType: string
  chordIndex: string
  noteDirection: string
  structure: string
  styleTags: string
  specialTags: string
  isCommon: boolean
}

export type TemplateTableName = '伴奏模板' | '律动模板'

export type TemplateDbRow = {
  id: number
  name: string
  filePath: string
  patternData: string
  totalDuration: number | null
  durationCombo: string
  difficultyTags: string
  styleTags: string
  createdAt: string
  tableName: TemplateTableName
}

export type NoteEntryDraftRow = {
  notes: string
  noteCount: number | null
  chordType: string
  chordIndex: string
  noteDirection: string
  structure: string
  styleTags: string
  specialTags: string
  isCommon: boolean
  filePath: string
}

export type TemplateEntryDraftRow = {
  name: string
  filePath: string
  patternData: string
  totalDuration: number | null
  durationCombo: string
  difficultyTags: string
  styleTags: string
}

export type TagLibraryState = {
  styleTags: string[]
  specialTags: string[]
  difficultyTags: string[]
}
