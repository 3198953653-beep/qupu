import initSqlJs from 'sql.js'
import type { QueryRow, SqlValue } from './types'

const RHYTHM_DB_ASSET_PATH = `${import.meta.env.BASE_URL}rhythm-db/app_data.db`
const RHYTHM_DB_WASM_PATH = `${import.meta.env.BASE_URL}rhythm-db/sql-wasm.wasm`

type SqlJsModule = Awaited<ReturnType<typeof initSqlJs>>
export type SqlJsDatabase = InstanceType<SqlJsModule['Database']>

let sqlJsPromise: Promise<SqlJsModule> | null = null
let bundledBytesPromise: Promise<Uint8Array> | null = null

type FilePickerWindow = Window & typeof globalThis & {
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle>
}

function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined'
    && 'showOpenFilePicker' in window
    && 'showSaveFilePicker' in window
  }

export async function loadSqlJs(): Promise<SqlJsModule> {
  if (sqlJsPromise) return sqlJsPromise
  sqlJsPromise = initSqlJs({
    locateFile: () => RHYTHM_DB_WASM_PATH,
  })
  return sqlJsPromise
}

export async function fetchBundledDatabaseBytes(): Promise<Uint8Array> {
  if (bundledBytesPromise) return bundledBytesPromise
  bundledBytesPromise = (async () => {
    const response = await fetch(RHYTHM_DB_ASSET_PATH)
    if (!response.ok) {
      throw new Error(`无法加载内置数据库：${response.status}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  })()
  return bundledBytesPromise
}

export async function createDatabaseFromBytes(bytes: Uint8Array): Promise<SqlJsDatabase> {
  const SQL = await loadSqlJs()
  return new SQL.Database(bytes)
}

export async function createBundledDatabaseInstance(): Promise<SqlJsDatabase> {
  const bytes = await fetchBundledDatabaseBytes()
  return createDatabaseFromBytes(bytes)
}

export async function readDatabaseFileHandle(handle: FileSystemFileHandle): Promise<Uint8Array> {
  const file = await handle.getFile()
  return new Uint8Array(await file.arrayBuffer())
}

export async function writeDatabaseFileHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable()
  const writableBytes = new Uint8Array(bytes.length)
  writableBytes.set(bytes)
  await writable.write(writableBytes)
  await writable.close()
}

export async function requestDatabaseFileHandle(): Promise<FileSystemFileHandle | null> {
  if (!supportsFileSystemAccess()) return null
  const pickerWindow = window as FilePickerWindow
  const handles = await pickerWindow.showOpenFilePicker?.({
    multiple: false,
    types: [{
      description: 'SQLite Database',
      accept: {
        'application/octet-stream': ['.db', '.sqlite', '.sqlite3'],
      },
    }],
  })
  return handles?.[0] ?? null
}

export async function requestDatabaseSaveHandle(suggestedName: string): Promise<FileSystemFileHandle | null> {
  if (!supportsFileSystemAccess()) return null
  const pickerWindow = window as FilePickerWindow
  return (await pickerWindow.showSaveFilePicker?.({
    suggestedName,
    types: [{
      description: 'SQLite Database',
      accept: {
        'application/octet-stream': ['.db'],
      },
    }],
  })) ?? null
}

export function isFileSystemAccessAvailable(): boolean {
  return supportsFileSystemAccess()
}

export function queryRows(db: SqlJsDatabase, sql: string, params: SqlValue[] = []): QueryRow[] {
  const result = db.exec(sql, params)
  const first = result[0]
  if (!first) return []
  const columns = first.columns ?? []
  const values = first.values ?? []
  return values.map((rowValues) => {
    const row: QueryRow = {}
    columns.forEach((column, index) => {
      row[column] = (rowValues[index] as SqlValue | undefined) ?? null
    })
    return row
  })
}

export function runStatement(db: SqlJsDatabase, sql: string, params: SqlValue[] = []): void {
  db.run(sql, params)
}

export function exportDatabaseBytes(db: SqlJsDatabase): Uint8Array {
  return db.export()
}

export function safeCloseDatabase(db: SqlJsDatabase | null | undefined): void {
  if (!db) return
  try {
    db.close()
  } catch {
    // ignore close race
  }
}
