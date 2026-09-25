import { useEffect, useMemo, useState } from 'react'
import { parseNote } from '../../../core/notes'
import type { Atlas, NoteSummary } from '../../../core/types'
import { Markdown } from '../components/Markdown'

const ORDER = ['Profile', 'Projects', 'Decisions', 'Ideas', 'Learning', 'Career', 'Work', 'Sessions', 'Outputs', 'Skills', 'Inbox', 'Sources', 'Home']

const GLYPH: Record<string, string> = { known: '●', 'needs-review': '◐', exploratory: '○', historical: '◌', superseded: '⊘' }
const WORDS: Record<string, string> = { known: 'known', 'needs-review': 'needs review', exploratory: 'idea', historical: 'historical', superseded: 'superseded' }

export function KStatus({ s }: { s?: string }) {
  if (!s) return null
  return (
    <span className="kstatus" data-k={s}>
      <span className="g">{GLYPH[s] ?? '·'}</span>
      {WORDS[s] ?? s.replace(/-/g, ' ')}
    </span>
  )
}

function when(at: number) {
  const d = new Date(at)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function Memory() {
  const api = window.bluevis
  const [atlas, setAtlas] = useState<Atlas | null>(null)
  const [area, setArea] = useState<string>('Profile')
  const [open, setOpen] = useState<NoteSummary | null>(null)
  const [content, setContent] = useState<string>('')

  const load = () => api.memory.atlas().then((a) => setAtlas(a as Atlas))
  useEffect(() => {
    void load()
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (open) void api.memory.read(open.path).then((t) => setContent(t as string))
  }, [open, atlas])

  const areas = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of atlas?.notes ?? []) counts.set(n.area, (counts.get(n.area) ?? 0) + 1)
    const rank = (a: string) => (ORDER.includes(a) ? ORDER.indexOf(a) : ORDER.length)
    return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [atlas])

  const notes = (atlas?.notes ?? []).filter((n) => n.area === area).sort((a, b) => a.title.localeCompare(b.title))
  const review = (atlas?.notes ?? []).filter((n) => n.status === 'needs-review').length
  const total = atlas?.notes.length ?? 0

  return (
    <div className="split memory">
      <aside className="panel">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Areas
        </div>
        <nav className="areas">
          {areas.map(([a, n]) => (
            <button
              key={a}
              aria-current={a === area}
              onClick={() => {
                setArea(a)
                setOpen(null)
              }}
            >
              {a}
              <span className="n">{n}</span>
            </button>
          ))}
        </nav>
        <div className="legend">
          <div className="eyebrow">Status</div>
          {Object.keys(GLYPH).map((k) => (
            <KStatus key={k} s={k} />
          ))}
        </div>
      </aside>

      <section className="panel">
        {open ? (
          <Reader note={open} content={content} onBack={() => setOpen(null)} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <h2 className="panel-title">What Bluevis knows</h2>
                <p className="panel-sub" style={{ margin: 0 }}>
                  {total} notes · {review} awaiting your review · plain Markdown in your vault
                </p>
              </div>
              <button className="btn" onClick={() => api.memory.open()}>
                Open vault
              </button>
            </div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              {area}
            </div>
            <div className="note-grid">
              {notes.map((n) => (
                <button key={n.path} className="note-card" onClick={() => setOpen(n)}>
                  <h4>{n.title}</h4>
                  {n.summary && <p>{n.summary}</p>}
                  <div className="foot">
                    <KStatus s={n.status} />
                    <span className="mono">{n.updated ?? ''}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <aside className="panel">
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          What changed
        </div>
        <p className="panel-sub" style={{ marginBottom: 8 }}>
          Every write is a commit in the vault’s own history.
        </p>
        <ul className="timeline">
          {(atlas?.changes ?? []).map((c) => (
            <li key={c.hash}>
              <div className="row">
                <span className="mono" style={{ color: 'var(--faint)' }}>
                  {when(c.at)}
                </span>
                {!/^Revert|^Record edits|^Initial/.test(c.subject) && (
                  <button className="link-btn" onClick={() => api.memory.revert(c.hash).then(load)} title="Undo this change with a new commit">
                    Revert
                  </button>
                )}
              </div>
              <div className="subj">{c.subject}</div>
              <div className="files mono">{c.files.slice(0, 3).join(' · ')}</div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

function Reader({ note, content, onBack }: { note: NoteSummary; content: string; onBack: () => void }) {
  const api = window.bluevis
  const { data, body } = parseNote(content)
  const props = Object.entries(data).filter(([k]) => k !== 'title')
  return (
    <div className="reader">
      <div className="reader-bar">
        <button className="btn btn-quiet" style={{ paddingLeft: 0 }} onClick={onBack}>
          ← {note.area}
        </button>
        <span className="mono" style={{ color: 'var(--faint)' }}>
          {note.path}
        </span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => api.memory.open(note.path)}>
          Edit
        </button>
      </div>
      {props.length > 0 && (
        <dl className="props">
          {props.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{k === 'status' ? <KStatus s={String(v)} /> : Array.isArray(v) ? v.join(', ') : v}</dd>
            </div>
          ))}
        </dl>
      )}
      <Markdown text={body} />
    </div>
  )
}
