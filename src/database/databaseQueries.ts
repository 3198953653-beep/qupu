import type {
  AccompanimentNoteDbRow,
  NoteEntryDraftRow,
  QueryRow,
  SqlValue,
  TemplateDbRow,
  TemplateEntryDraftRow,
  TemplateTableName,
} from './types'
import type { SqlJsDatabase } from './sqliteRuntime'
import { queryRows, runStatement } from './sqliteRuntime'

function toText(value: SqlValue | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function toNumberOrNull(value: SqlValue | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toBoolean(value: SqlValue | undefined): boolean {
  if (typeof value === 'number') return value !== 0
  const text = String(value ?? '').trim()
  return text === '1' || text.toLowerCase() === 'true'
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function mergeCsvTags(left: string, right: string): string {
  const merged = [...splitCsv(left), ...splitCsv(right)]
  return [...new Set(merged)].join(',')
}

function normalizeNoteRow(row: QueryRow): AccompanimentNoteDbRow {
  return {
    id: Number(row.id ?? 0),
    title: toText(row.title),
    artist: toText(row.artist),
    createdAt: toText(row.created_at),
    filePath: toText(row.file_path),
    notes: toText(row.notes),
    noteCount: toNumberOrNull(row.note_count),
    chordType: toText(row.chord_type),
    chordIndex: toText(row.chord_index),
    noteDirection: toText(row.note_direction),
    structure: toText(row.structure),
    styleTags: toText(row.style_tags),
    specialTags: toText(row.special_tags),
    isCommon: toBoolean(row.is_common),
  }
}

function normalizeTemplateRow(row: QueryRow, tableName: TemplateTableName): TemplateDbRow {
  return {
    id: Number(row.id ?? 0),
    name: toText(row.name),
    filePath: toText(row.file_path),
    patternData: toText(row.pattern_data),
    totalDuration: toNumberOrNull(row.total_duration),
    durationCombo: toText(row.duration_combo),
    difficultyTags: toText(row.difficulty_tags),
    styleTags: toText(row.style_tags),
    createdAt: toText(row.created_at),
    tableName,
  }
}

function inferTitleFromFilePath(filePath: string): string {
  const normalized = String(filePath ?? '').trim().replaceAll('\\', '/')
  if (!normalized) return '未命名'
  const parts = normalized.split('/')
  const last = parts[parts.length - 1] ?? '未命名'
  return last.replace(/\.[^.]+$/, '') || '未命名'
}

export function loadAccompanimentNoteRows(db: SqlJsDatabase): AccompanimentNoteDbRow[] {
  return queryRows(
    db,
    `SELECT id, title, artist, created_at, file_path, notes, note_count, chord_type, chord_index,
            note_direction, structure, style_tags, special_tags, is_common
     FROM "伴奏音符库"
     ORDER BY is_common DESC, created_at DESC, id DESC`,
  ).map(normalizeNoteRow)
}

export function loadTemplateRows(db: SqlJsDatabase, tableName: TemplateTableName): TemplateDbRow[] {
  return queryRows(
    db,
    `SELECT id, name, file_path, pattern_data, total_duration, duration_combo, difficulty_tags, style_tags, created_at
     FROM "${tableName}"
     ORDER BY created_at DESC, id DESC`,
  ).map((row) => normalizeTemplateRow(row, tableName))
}

export function updateAccompanimentNoteRow(db: SqlJsDatabase, row: AccompanimentNoteDbRow): void {
  runStatement(
    db,
    `UPDATE "伴奏音符库"
     SET notes = ?, note_count = ?, chord_type = ?, chord_index = ?, note_direction = ?, structure = ?,
         style_tags = ?, special_tags = ?, is_common = ?
     WHERE id = ?`,
    [
      row.notes,
      row.noteCount,
      row.chordType,
      row.chordIndex,
      row.noteDirection,
      row.structure,
      row.styleTags,
      row.specialTags,
      row.isCommon ? 1 : 0,
      row.id,
    ],
  )
}

export function updateTemplateRow(db: SqlJsDatabase, tableName: TemplateTableName, row: TemplateDbRow): void {
  runStatement(
    db,
    `UPDATE "${tableName}"
     SET name = ?, pattern_data = ?, total_duration = ?, duration_combo = ?, difficulty_tags = ?, style_tags = ?
     WHERE id = ?`,
    [
      row.name,
      row.patternData,
      row.totalDuration,
      row.durationCombo,
      row.difficultyTags,
      row.styleTags,
      row.id,
    ],
  )
}

export function deleteAccompanimentNoteRows(db: SqlJsDatabase, ids: number[]): void {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (uniqueIds.length === 0) return
  const placeholders = uniqueIds.map(() => '?').join(',')
  runStatement(db, `DELETE FROM "伴奏音符库" WHERE id IN (${placeholders})`, uniqueIds)
}

export function deleteTemplateRows(db: SqlJsDatabase, tableName: TemplateTableName, ids: number[]): void {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (uniqueIds.length === 0) return
  const placeholders = uniqueIds.map(() => '?').join(',')
  runStatement(db, `DELETE FROM "${tableName}" WHERE id IN (${placeholders})`, uniqueIds)
}

export function insertAccompanimentEntryRows(db: SqlJsDatabase, rows: NoteEntryDraftRow[]): {
  insertedCount: number
  mergedCount: number
  skippedCount: number
} {
  let insertedCount = 0
  let mergedCount = 0
  let skippedCount = 0

  rows.forEach((row) => {
    const notes = row.notes.trim()
    if (!notes) {
      skippedCount += 1
      return
    }

    const existing = queryRows(
      db,
      `SELECT id, style_tags, special_tags, is_common, chord_index
       FROM "伴奏音符库"
       WHERE notes = ?
       ORDER BY id ASC
       LIMIT 1`,
      [notes],
    )[0]

    if (!existing) {
      runStatement(
        db,
        `INSERT INTO "伴奏音符库" (
           title, artist, file_path, notes, note_count, chord_type, chord_index, note_direction,
           structure, style_tags, special_tags, is_common, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','+8 hours'))`,
        [
          inferTitleFromFilePath(row.filePath),
          '',
          row.filePath,
          notes,
          row.noteCount,
          row.chordType,
          row.chordIndex,
          row.noteDirection,
          row.structure,
          row.styleTags,
          row.specialTags,
          row.isCommon ? 1 : 0,
        ],
      )
      insertedCount += 1
      return
    }

    const mergedStyleTags = mergeCsvTags(toText(existing.style_tags), row.styleTags)
    const mergedSpecialTags = mergeCsvTags(toText(existing.special_tags), row.specialTags)
    const mergedIsCommon = toBoolean(existing.is_common) || row.isCommon
    const nextChordIndex = toText(existing.chord_index) || row.chordIndex

    const shouldUpdate = mergedStyleTags !== toText(existing.style_tags)
      || mergedSpecialTags !== toText(existing.special_tags)
      || mergedIsCommon !== toBoolean(existing.is_common)
      || nextChordIndex !== toText(existing.chord_index)

    if (!shouldUpdate) {
      skippedCount += 1
      return
    }

    runStatement(
      db,
      `UPDATE "伴奏音符库"
       SET style_tags = ?, special_tags = ?, is_common = ?, chord_index = ?
       WHERE id = ?`,
      [mergedStyleTags, mergedSpecialTags, mergedIsCommon ? 1 : 0, nextChordIndex, Number(existing.id ?? 0)],
    )
    mergedCount += 1
  })

  return {
    insertedCount,
    mergedCount,
    skippedCount,
  }
}

export function insertTemplateEntryRows(
  db: SqlJsDatabase,
  tableName: TemplateTableName,
  rows: TemplateEntryDraftRow[],
): number {
  let insertedCount = 0
  rows.forEach((row) => {
    const name = row.name.trim() || '未命名'
    const patternData = row.patternData.trim()
    if (!patternData) return
    runStatement(
      db,
      `INSERT INTO "${tableName}" (
         name, file_path, pattern_data, total_duration, duration_combo, difficulty_tags, style_tags, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','+8 hours'))`,
      [
        name,
        row.filePath,
        patternData,
        row.totalDuration,
        row.durationCombo,
        row.difficultyTags,
        row.styleTags,
      ],
    )
    insertedCount += 1
  })
  return insertedCount
}

export function detectChordIndices(notes: string): string {
  return notes
    .split('_')
    .map((token) => token.trim())
    .reduce<string[]>((indices, token, index) => {
      if (token.includes('+')) indices.push(String(index + 1))
      return indices
    }, [])
    .join(',')
}

export function fillMissingChordIndices(db: SqlJsDatabase): number {
  const rows = queryRows(
    db,
    `SELECT id, notes FROM "伴奏音符库"
     WHERE chord_index IS NULL OR chord_index = ''`,
  )
  let updatedCount = 0
  rows.forEach((row) => {
    const chordIndex = detectChordIndices(toText(row.notes))
    if (!chordIndex) return
    runStatement(db, 'UPDATE "伴奏音符库" SET chord_index = ? WHERE id = ?', [chordIndex, Number(row.id ?? 0)])
    updatedCount += 1
  })
  return updatedCount
}
