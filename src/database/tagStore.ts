import type { TagLibraryState } from './types'

const STORAGE_KEY = 'database-workspace-tags-v1'

const DEFAULT_STYLE_TAGS = ['无', '流行', '爵士', '初学者', '通用']
const DEFAULT_SPECIAL_TAGS = ['无', '简单使用', '副歌使用', '高难度使用']
const DEFAULT_DIFFICULTY_TAGS = ['无', '初学者', '进阶', '高难度']

function normalizeTags(source: unknown, defaults: string[]): string[] {
  const values = Array.isArray(source)
    ? source.map((entry) => String(entry ?? '').trim()).filter((entry) => entry.length > 0)
    : []
  const unique = [...new Set(values)]
  if (!unique.includes('无')) unique.unshift('无')
  return unique.length > 0 ? unique : defaults.slice()
}

export function getDefaultTagLibraryState(): TagLibraryState {
  return {
    styleTags: DEFAULT_STYLE_TAGS.slice(),
    specialTags: DEFAULT_SPECIAL_TAGS.slice(),
    difficultyTags: DEFAULT_DIFFICULTY_TAGS.slice(),
  }
}

export function loadTagLibraryState(): TagLibraryState {
  if (typeof window === 'undefined') return getDefaultTagLibraryState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return getDefaultTagLibraryState()
    const parsed = JSON.parse(raw) as Partial<TagLibraryState>
    return {
      styleTags: normalizeTags(parsed.styleTags, DEFAULT_STYLE_TAGS),
      specialTags: normalizeTags(parsed.specialTags, DEFAULT_SPECIAL_TAGS),
      difficultyTags: normalizeTags(parsed.difficultyTags, DEFAULT_DIFFICULTY_TAGS),
    }
  } catch {
    return getDefaultTagLibraryState()
  }
}

export function saveTagLibraryState(state: TagLibraryState): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    styleTags: normalizeTags(state.styleTags, DEFAULT_STYLE_TAGS),
    specialTags: normalizeTags(state.specialTags, DEFAULT_SPECIAL_TAGS),
    difficultyTags: normalizeTags(state.difficultyTags, DEFAULT_DIFFICULTY_TAGS),
  }))
}
