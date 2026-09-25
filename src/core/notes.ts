// Minimal, dependency-free Markdown note handling for an Obsidian-compatible
// vault: a YAML-subset frontmatter reader/writer and keyword retrieval.

export type Frontmatter = Record<string, string | string[]>

export interface ParsedNote {
  data: Frontmatter
  body: string
}

export function parseNote(text: string): ParsedNote {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: text }
  const data: Frontmatter = {}
  let listKey: string | null = null
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && listKey) {
      ;(data[listKey] as string[]).push(unquote(item[1]))
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, value] = kv
    if (value === '') {
      data[key] = []
      listKey = key
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean)
      listKey = null
    } else {
      data[key] = unquote(value)
      listKey = null
    }
  }
  return { data, body: m[2] }
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
  return s
}

function quote(s: string): string {
  return /[:#\[\]{},&*!|>'"%@`]|^\s|\s$|^$/.test(s) ? JSON.stringify(s) : s
}

export function serializeNote(data: Frontmatter, body: string): string {
  const lines = Object.entries(data).map(([k, v]) =>
    Array.isArray(v) ? (v.length ? `${k}:\n${v.map((x) => `  - ${quote(x)}`).join('\n')}` : `${k}: []`) : `${k}: ${quote(v)}`
  )
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Filesystem-safe note title that still reads naturally in Obsidian. */
export function safeTitle(s: string): string {
  return s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

const STOP = new Set(
  'a an the and or but if of to in on for with at by from is are was were be been it this that these those i me my we our you your he she they them what which who how why when where do does did can could should would will just about into than then so not no yes please tell show give make get have has had'.split(
    ' '
  )
)

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
}

export interface Searchable {
  path: string
  title: string
  body: string
  tags?: string[]
}

/** Rank notes by keyword overlap; title and tag hits weigh more than body hits. */
export function rank<T extends Searchable>(query: string, notes: T[], limit = 4): T[] {
  const q = new Set(tokens(query))
  if (!q.size) return []
  const scored = notes.map((n) => {
    const title = new Set(tokens(n.title))
    const tags = new Set((n.tags ?? []).flatMap(tokens))
    const body = tokens(n.body)
    let score = 0
    for (const t of q) {
      if (title.has(t)) score += 5
      if (tags.has(t)) score += 3
    }
    const bodyHits = body.filter((t) => q.has(t)).length
    score += Math.min(bodyHits, 8) * 0.5
    return { n, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.n)
}
