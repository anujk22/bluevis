// Passage-level retrieval over the vault: notes are split at headings into
// passages, scored with BM25, and optionally fused with semantic (embedding)
// similarity. Only a handful of passages reach the model per turn.

import { tokens } from './notes'

export interface Passage {
  id: string
  path: string
  title: string
  heading: string
  text: string
  area: string
  status?: string
  localOnly: boolean
  /** Obsidian `aliases`: other names the note answers to (e.g. "internship" for a Jennison note). */
  aliases?: string[]
}

const MAX = 1400

/** Split a note body into heading-scoped passages of at most ~1.4k characters. */
export function chunkNote(n: { path: string; title: string; area: string; body: string; status?: string; localOnly: boolean; aliases?: string[] }): Passage[] {
  const out: Passage[] = []
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }]
  for (const line of n.body.split('\n')) {
    const h = line.match(/^#{2,4}\s+(.*)$/)
    if (h) sections.push({ heading: h[1].trim(), lines: [] })
    else if (!/^#\s/.test(line)) sections.at(-1)!.lines.push(line)
  }
  for (const s of sections) {
    const text = s.lines.join('\n').trim()
    if (!text) continue
    // Long sections are split on paragraph boundaries so each passage stays focused.
    const parts: string[] = []
    let cur = ''
    for (const para of text.split(/\n\s*\n/)) {
      if (cur && cur.length + para.length > MAX) {
        parts.push(cur)
        cur = ''
      }
      cur = cur ? `${cur}\n\n${para}` : para
    }
    if (cur) parts.push(cur)
    parts.forEach((p, i) =>
      out.push({
        id: `${n.path}#${s.heading}#${i}`,
        path: n.path,
        title: n.title,
        heading: s.heading,
        text: p.length > MAX * 1.5 ? `${p.slice(0, MAX * 1.5)}…` : p,
        area: n.area,
        status: n.status,
        localOnly: n.localOnly,
        aliases: n.aliases
      })
    )
  }
  return out
}

export class BM25 {
  private df = new Map<string, number>()
  private docs: { terms: Map<string, number>; len: number }[] = []
  private avg = 1

  constructor(private passages: Passage[]) {
    for (const p of passages) {
      // Titles and headings are repeated so a match there counts more than one in the body.
      const names = [p.title, ...(p.aliases ?? [])].join(' ')
      const t = [...tokens(names), ...tokens(names), ...tokens(p.heading), ...tokens(p.heading), ...tokens(p.text)].map(stem)
      const terms = new Map<string, number>()
      for (const w of t) terms.set(w, (terms.get(w) ?? 0) + 1)
      for (const w of terms.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1)
      this.docs.push({ terms, len: t.length })
    }
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length)
  }

  scores(query: string): number[] {
    const q = [...new Set(tokens(query).map(stem))]
    const N = this.docs.length
    const k1 = 1.4
    const b = 0.72
    return this.docs.map((d) => {
      let s = 0
      for (const w of q) {
        const f = d.terms.get(w)
        if (!f) continue
        const idf = Math.log(1 + (N - this.df.get(w)! + 0.5) / (this.df.get(w)! + 0.5))
        s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avg)))
      }
      return s
    })
  }

  get size() {
    return this.passages.length
  }
}

/** A light suffix stripper so "courses"/"course" and "grading"/"grade" meet. */
export function stem(w: string): string {
  if (w.length <= 3) return w
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`
  if (/(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2)
  if (/[^s]s$/.test(w)) w = w.slice(0, -1)
  if (w.length > 5 && /(ing|ed)$/.test(w)) w = w.replace(/(ing|ed)$/, '').replace(/(.)\1$/, '$1')
  return w
}

/**
 * Reciprocal rank fusion of keyword and (optional) semantic rankings.
 * Returns passage indexes, best first, dropping passages that neither ranker found relevant.
 */
export function fuse(keyword: number[], semantic: number[] | null, limit: number, minSemantic = 0.55): number[] {
  const rank = (scores: number[], ok: (s: number) => boolean) =>
    scores
      .map((s, i) => [s, i] as const)
      .filter(([s]) => ok(s))
      .sort((a, b) => b[0] - a[0])
      .map(([, i]) => i)
  const K = 60
  const total = new Map<number, number>()
  rank(keyword, (s) => s > 0).forEach((i, r) => total.set(i, (total.get(i) ?? 0) + 1 / (K + r)))
  if (semantic) rank(semantic, (s) => s >= minSemantic).forEach((i, r) => total.set(i, (total.get(i) ?? 0) + 1 / (K + r)))
  return [...total.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([i]) => i)
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0
  let d = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return d / (Math.sqrt(na * nb) || 1)
}
