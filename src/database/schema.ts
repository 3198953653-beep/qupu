import type { SqlJsDatabase } from './sqliteRuntime'
import { queryRows, runStatement } from './sqliteRuntime'

const NOTE_TABLE_NAME = '伴奏音符库'
const TEMPLATE_TABLE_NAMES = ['伴奏模板', '律动模板'] as const

function getColumnNames(db: SqlJsDatabase, tableName: string): Set<string> {
  return new Set(
    queryRows(db, `PRAGMA table_info("${tableName}")`).map((row) => String(row.name ?? '').trim()).filter(Boolean),
  )
}

function ensureColumn(db: SqlJsDatabase, tableName: string, columnName: string, definition: string): void {
  const columns = getColumnNames(db, tableName)
  if (columns.has(columnName)) return
  runStatement(db, `ALTER TABLE "${tableName}" ADD COLUMN ${columnName} ${definition}`)
}

export function ensureDatabaseSchema(db: SqlJsDatabase): void {
  runStatement(db, `
    CREATE TABLE IF NOT EXISTS "${NOTE_TABLE_NAME}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      notes TEXT,
      note_count INTEGER,
      chord_type TEXT,
      chord_index TEXT,
      note_direction TEXT,
      structure TEXT,
      style_tags TEXT,
      special_tags TEXT,
      is_common INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  TEMPLATE_TABLE_NAMES.forEach((tableName) => {
    runStatement(db, `
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        file_path TEXT,
        pattern_data TEXT,
        total_duration INTEGER,
        duration_combo TEXT,
        difficulty_tags TEXT,
        style_tags TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
  })

  ensureColumn(db, NOTE_TABLE_NAME, 'file_path', 'TEXT')
  ensureColumn(db, NOTE_TABLE_NAME, 'notes', 'TEXT')
  ensureColumn(db, NOTE_TABLE_NAME, 'note_count', 'INTEGER')
  ensureColumn(db, NOTE_TABLE_NAME, 'chord_type', 'TEXT')
  ensureColumn(db, NOTE_TABLE_NAME, 'chord_index', 'TEXT')
  ensureColumn(db, NOTE_TABLE_NAME, 'note_direction', 'TEXT')
  ensureColumn(db, NOTE_TABLE_NAME, 'structure', 'TEXT')
  ensureColumn(db, NOTE_TABLE_NAME, 'style_tags', 'TEXT')
  ensureColumn(db, NOTE_TABLE_NAME, 'special_tags', 'TEXT')
  ensureColumn(db, NOTE_TABLE_NAME, 'is_common', 'INTEGER DEFAULT 0')
  ensureColumn(db, NOTE_TABLE_NAME, 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')

  TEMPLATE_TABLE_NAMES.forEach((tableName) => {
    ensureColumn(db, tableName, 'file_path', 'TEXT')
    ensureColumn(db, tableName, 'pattern_data', 'TEXT')
    ensureColumn(db, tableName, 'total_duration', 'INTEGER')
    ensureColumn(db, tableName, 'duration_combo', 'TEXT')
    ensureColumn(db, tableName, 'difficulty_tags', 'TEXT')
    ensureColumn(db, tableName, 'style_tags', 'TEXT')
    ensureColumn(db, tableName, 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
  })
}
