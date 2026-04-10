import {
  createBundledDatabaseInstance,
  queryRows,
  type SqlJsDatabase,
} from '../database/sqliteRuntime'

export type RhythmTemplateRow = {
  id: string
  name: string
  difficultyTags: string[]
  styleTags: string[]
  patternData: string
  totalDuration: number | null
  durationCombo: string | null
}

export type AccompanimentOptionRow = {
  notes: string
  chordType: string
  sourceChordType: string
  specialTags: string
}

let databasePromise: Promise<SqlJsDatabase> | null = null

function splitTags(value: string | number | null | undefined): string[] {
  if (value === null || value === undefined) return []
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

async function loadDatabase(): Promise<SqlJsDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = createBundledDatabaseInstance()
  return databasePromise
}

function resolveDirectionAliases(direction: string | null): string[] | null {
  if (!direction) return null
  if (direction === '上上上上') return ['上上上上', '上行']
  if (direction === '下下下下') return ['下下下下', '下行']
  return [direction]
}

function normalizeStructureFilter(structure: string | null | undefined): string | null {
  const text = String(structure ?? '').trim()
  if (!text || text === '不限制') return null
  return text
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
  const values = queryRows(
    database,
    `SELECT id, name, difficulty_tags, style_tags, pattern_data, total_duration, duration_combo
     FROM "律动模板"
     WHERE duration_combo = ?
     ORDER BY created_at DESC`,
    [durationCombo],
  )

  return values.map((row) => {
    return {
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      difficultyTags: splitTags((row.difficulty_tags as string | null | undefined) ?? null),
      styleTags: splitTags((row.style_tags as string | null | undefined) ?? null),
      patternData: String(row.pattern_data ?? ''),
      totalDuration:
        typeof row.total_duration === 'number'
          ? row.total_duration
          : row.total_duration === null || row.total_duration === undefined || row.total_duration === ''
            ? null
            : Number(row.total_duration),
      durationCombo: row.duration_combo === null || row.duration_combo === undefined ? null : String(row.duration_combo),
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
    const result = queryRows(database, sql, sqlParams)
    const matched = result[0]?.notes
    if (typeof matched === 'string' && matched.trim().length > 0) {
      return matched.trim()
    }
  }

  return null
}

export async function queryAccompanimentOptionRows(params: {
  chordFamily: string
  noteCount: number
  direction: string | null
  structure: string | null
  limit?: number
}): Promise<AccompanimentOptionRow[]> {
  const { chordFamily, noteCount, direction, structure, limit = 20 } = params
  if (!Number.isFinite(noteCount) || noteCount <= 0) return []

  const database = await loadDatabase()
  const directionAliases = resolveDirectionAliases(direction)
  const normalizedStructure = normalizeStructureFilter(structure)
  const rows: AccompanimentOptionRow[] = []
  const seenNotes = new Set<string>()

  for (const chordType of buildChordTypeFallbacks(chordFamily)) {
    const sqlParams: Array<string | number> = [chordType, Math.max(1, Math.round(noteCount))]
    let sql = 'SELECT notes, chord_type, special_tags FROM "伴奏音符库" WHERE chord_type = ? AND note_count = ? '

    if (directionAliases && directionAliases.length > 0) {
      sql += `AND note_direction IN (${directionAliases.map(() => '?').join(',')}) `
      sqlParams.push(...directionAliases)
    }

    if (normalizedStructure) {
      sql += 'AND structure = ? '
      sqlParams.push(normalizedStructure)
    }

    sql += 'ORDER BY created_at DESC LIMIT ?'
    sqlParams.push(Math.max(1, Math.round(limit)))

    const matchedRows = queryRows(database, sql, sqlParams)
    matchedRows.forEach((row) => {
      const notes = String(row.notes ?? '').trim()
      if (!notes || seenNotes.has(notes)) return
      seenNotes.add(notes)
      rows.push({
        notes,
        chordType: String(row.chord_type ?? chordType),
        sourceChordType: chordType,
        specialTags: String(row.special_tags ?? ''),
      })
    })

    if (rows.length >= limit) {
      return rows.slice(0, limit)
    }
  }

  return rows.slice(0, limit)
}
