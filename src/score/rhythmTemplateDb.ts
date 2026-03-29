import initSqlJs from 'sql.js'

export type RhythmTemplateRow = {
  id: string
  name: string
  difficultyTags: string[]
  styleTags: string[]
  patternData: string
  totalDuration: number | null
  durationCombo: string | null
}

const RHYTHM_DB_ASSET_PATH = `${import.meta.env.BASE_URL}rhythm-db/app_data.db`
const RHYTHM_DB_WASM_PATH = `${import.meta.env.BASE_URL}rhythm-db/sql-wasm.wasm`

type SqlJsModule = Awaited<ReturnType<typeof initSqlJs>>
type SqlJsDatabase = InstanceType<SqlJsModule['Database']>

let sqlJsPromise: Promise<SqlJsModule> | null = null
let databasePromise: Promise<SqlJsDatabase> | null = null

function splitTags(value: string | number | null | undefined): string[] {
  if (value === null || value === undefined) return []
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

async function loadSqlJs(): Promise<SqlJsModule> {
  if (sqlJsPromise) return sqlJsPromise
  sqlJsPromise = initSqlJs({
    locateFile: () => RHYTHM_DB_WASM_PATH,
  })
  return sqlJsPromise
}

async function loadDatabase(): Promise<SqlJsDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = (async () => {
    const SQL = await loadSqlJs()
    const response = await fetch(RHYTHM_DB_ASSET_PATH)
    if (!response.ok) {
      throw new Error(`无法加载律动数据库：${response.status}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    return new SQL.Database(bytes)
  })()
  return databasePromise
}

function resolveDirectionAliases(direction: string | null): string[] | null {
  if (!direction) return null
  if (direction === '上上上上') return ['上上上上', '上行']
  if (direction === '下下下下') return ['下下下下', '下行']
  return [direction]
}

export function collectRhythmTemplateTagSets(rows: RhythmTemplateRow[]): {
  difficultyOptions: string[]
  styleOptions: string[]
} {
  const difficultySet = new Set<string>()
  const styleSet = new Set<string>()

  rows.forEach((row) => {
    row.difficultyTags.forEach((tag) => difficultySet.add(tag))
    row.styleTags.forEach((tag) => styleSet.add(tag))
  })

  return {
    difficultyOptions: [...difficultySet].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    styleOptions: [...styleSet].sort((left, right) => left.localeCompare(right, 'zh-CN')),
  }
}

export async function queryRhythmTemplateRowsByDurationCombo(durationCombo: string): Promise<RhythmTemplateRow[]> {
  const database = await loadDatabase()
  const result = database.exec(
    `SELECT id, name, difficulty_tags, style_tags, pattern_data, total_duration, duration_combo
     FROM "律动模板"
     WHERE duration_combo = ?
     ORDER BY created_at DESC`,
    [durationCombo],
  )
  const values = result[0]?.values ?? []

  return values.map((rowValues) => {
    const row = rowValues as Array<string | number | Uint8Array | null>
    return {
      id: String(row[0] ?? ''),
      name: String(row[1] ?? ''),
      difficultyTags: splitTags((row[2] as string | null | undefined) ?? null),
      styleTags: splitTags((row[3] as string | null | undefined) ?? null),
      patternData: String(row[4] ?? ''),
      totalDuration:
        typeof row[5] === 'number'
          ? row[5]
          : row[5] === null || row[5] === undefined || row[5] === ''
            ? null
            : Number(row[5]),
      durationCombo: row[6] === null || row[6] === undefined ? null : String(row[6]),
    }
  })
}

function buildChordTypeFallbacks(chordFamily: string): string[] {
  const value = String(chordFamily ?? '').trim()
  if (!value) return []

  const [baseChord = '', rawBass = ''] = value.split('/', 2)
  const bassSuffix = rawBass ? `/${rawBass.trim()}` : ''
  const lower = baseChord.toLowerCase()
  const fallbacks: string[] = []

  const push = (entry: string) => {
    const normalized = String(entry ?? '').trim()
    if (!normalized || fallbacks.includes(normalized)) return
    fallbacks.push(normalized)
  }

  push(value)
  if (lower.includes('add9')) {
    const root = baseChord.match(/^([A-G][#b]?)/)?.[1] ?? 'C'
    push(`${root}${bassSuffix}`)
  } else if (lower.includes('maj9')) {
    push(baseChord.replace(/Maj9/i, 'Maj7') + bassSuffix)
    const root = baseChord.match(/^([A-G][#b]?)/)?.[1] ?? 'C'
    push(`${root}${bassSuffix}`)
  } else if (/(^|[^a-z])9$/i.test(lower) && !lower.includes('add9')) {
    push(baseChord.replace(/9$/i, '7') + bassSuffix)
    const root = baseChord.match(/^([A-G][#b]?)/)?.[1] ?? 'C'
    push(`${root}${bassSuffix}`)
  } else if (lower.includes('maj7')) {
    const root = baseChord.match(/^([A-G][#b]?)/)?.[1] ?? 'C'
    push(`${root}${bassSuffix}`)
  } else if (lower.endsWith('7') && !lower.includes('maj7')) {
    const root = baseChord.match(/^([A-G][#b]?)/)?.[1] ?? 'C'
    push(`${root}${bassSuffix}`)
  }

  return fallbacks
}

export async function fetchNotesFromRhythmLibrary(params: {
  chordFamily: string
  noteCount: number
  direction: string | null
  structure: string | null
}): Promise<string | null> {
  const { chordFamily, noteCount, direction, structure } = params
  if (!Number.isFinite(noteCount) || noteCount <= 0) return null

  const database = await loadDatabase()
  const directionAliases = resolveDirectionAliases(direction)

  for (const chordType of buildChordTypeFallbacks(chordFamily)) {
    const sqlParams: Array<string | number> = [chordType, Math.max(1, Math.round(noteCount))]
    let sql = 'SELECT notes FROM "伴奏音符库" WHERE chord_type = ? AND note_count = ? '

    if (directionAliases && directionAliases.length > 0) {
      sql += `AND note_direction IN (${directionAliases.map(() => '?').join(',')}) `
      sqlParams.push(...directionAliases)
    }

    if (structure !== null) {
      sql += 'AND structure = ? '
      sqlParams.push(structure)
    }

    sql += 'ORDER BY created_at DESC LIMIT 1'
    const result = database.exec(sql, sqlParams)
    const matched = result[0]?.values?.[0]?.[0]
    if (typeof matched === 'string' && matched.trim().length > 0) {
      return matched.trim()
    }
  }

  return null
}
