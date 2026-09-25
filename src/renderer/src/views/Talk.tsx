import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentTask, Turn, VoiceHealth } from '../../../core/types'
import type { Shot } from '../App'
import { Arrow, Eye, Mic, Square } from '../components/icons'
import { Inline, Markdown } from '../components/Markdown'
import { TaskStatus } from '../components/TaskStatus'

interface Props {
  turns: Turn[]
  tasks: Record<string, AgentTask>
  busy: boolean
  orb: ReactNode
  caption: string
  live: boolean
  listening: boolean
  shot: Shot | null
  notice: string | null
  voice: VoiceHealth
  onSend: (text: string) => void
  onListen: () => void
  onOrb: () => void
  onShot: () => void
  onStop: () => void
  onOpenTask: (id: string) => void
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

const SUGGESTIONS = ['What do you know about me?', 'Where did I leave off on Bluevis?', 'Status', 'Explain this screen']

export function Talk(p: Props) {
  const empty = p.turns.length === 0
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = [...p.turns].reverse().find((t) => t.speaker === 'bluevis')?.id
  // A task's live card shows only on the most recent turn that refers to it.
  const cardTurn = new Map<string, string>()
  for (const t of p.turns) if (t.taskId) cardTurn.set(t.taskId, t.id)

  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [p.turns])

  const composer = <Composer {...p} />

  return (
    <div className="talk" data-empty={empty}>
      <div className="stage">
        <div onClick={p.onOrb} role="button" tabIndex={-1} aria-label="Talk to Bluevis" style={{ pointerEvents: 'auto', cursor: 'pointer', borderRadius: '50%' }}>
          {p.orb}
        </div>
        <div className="stage-caption eyebrow" aria-live="polite">
          {p.live && <span className="live" />}
          {p.caption}
        </div>
      </div>

      <div className="greeting" aria-hidden={!empty}>
        <h1>
          {greeting()}, <em>Anuj.</em>
        </h1>
        <p>Ask, delegate, or pick up where you left off. Everything worth keeping lands in your vault.</p>
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => (s === 'Explain this screen' ? p.onShot() : p.onSend(s))}>
              {s}
            </button>
          ))}
        </div>
        {empty && composer}
      </div>

      <section className="conversation" aria-label="Conversation">
        <div className="transcript" ref={scroller} role="log">
          {p.turns.map((t) => (
            <TurnView key={t.id} turn={t} latest={t.id === lastId} task={t.taskId && cardTurn.get(t.taskId) === t.id ? p.tasks[t.taskId] : undefined} tasks={p.tasks} onOpenTask={p.onOpenTask} />
          ))}
        </div>
        {!empty && composer}
      </section>
    </div>
  )
}

function Composer(p: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])
  const submit = () => {
    if (!text.trim()) return
    p.onSend(text)
    setText('')
  }
  return (
    <div>
      {p.notice && (
        <p className="notice" role="alert">
          {p.notice}
        </p>
      )}
      <div className="composer">
        {p.shot && (
          <div className="attachment">
            <img src={p.shot.preview} alt="Screenshot to send" />
            <span className="mono">Screen attached · sent with your next message</span>
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={p.shot ? 'What about it?' : 'Ask Bluevis, or “have Codex…”'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') p.onStop()
          }}
          aria-label="Message Bluevis"
        />
        <div className="composer-bar">
          <button
            className="round"
            aria-pressed={p.listening}
            onClick={p.onListen}
            title={p.voice.state === 'ready' ? 'Talk (⌥⇧Space)' : p.voice.detail}
            aria-label={p.listening ? 'Stop listening' : 'Talk'}
          >
            <Mic />
          </button>
          <button className="round" aria-pressed={!!p.shot} onClick={p.onShot} title="Look at my screen (⌥⇧L)" aria-label="Attach a screenshot">
            <Eye />
          </button>
          <span className="hint mono">{p.voice.state === 'ready' ? '⌥⇧Space talk · ⌥⇧L look' : p.voice.state === 'starting' ? 'Voice loading…' : 'Voice off'}</span>
          {p.busy ? (
            <button className="round send" onClick={p.onStop} aria-label="Stop (Esc)" title="Stop (Esc)">
              <Square />
            </button>
          ) : (
            <button className="round send" onClick={submit} aria-label="Send" disabled={!text.trim()}>
              <Arrow />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="elapsed">{Math.round((Date.now() - since) / 1000)}s</span>
}

function TurnView({ turn, latest, task, tasks, onOpenTask }: { turn: Turn; latest: boolean; task?: AgentTask; tasks: Record<string, AgentTask>; onOpenTask: (id: string) => void }) {
  const api = window.bluevis
  if (turn.speaker === 'user') {
    return (
      <div className="turn turn-user">
        <div className="turn-meta eyebrow">
          <span className="who">You{turn.via === 'voice' ? ' · voice' : ''}</span>
          <span>{time(turn.at)}</span>
        </div>
        <div className="body">{turn.text}</div>
      </div>
    )
  }

  if (turn.memory) {
    const m = turn.memory
    return (
      <div className="turn">
        <div className="memory-line" data-undone={!!m.undone}>
          <span className="glyph">◆</span>
          <span>
            {m.undone ? 'Removed' : 'Kept in memory'}: <b>{m.title}</b>
          </span>
          <span className="mono" style={{ color: 'var(--faint)' }}>
            {m.path}
          </span>
          {turn.evidence === 'inferred' && (
            <span className="evidence mono" data-kind="inferred">
              inferred
            </span>
          )}
          {!m.undone && (
            <button className="link-btn" onClick={() => api.memory.open(m.path)}>
              Open
            </button>
          )}
          {m.hash && !m.undone && (
            <button className="link-btn" onClick={() => api.memory.undo(turn.id)}>
              Undo
            </button>
          )}
        </div>
      </div>
    )
  }

  if (turn.action) return <Proposal turn={turn} task={turn.taskId ? tasks[turn.taskId] : undefined} onOpenTask={onOpenTask} />

  const [spoken, ...rest] = splitShown(turn)
  return (
    <div className={`turn ${latest ? 'turn-latest' : ''} ${turn.error ? 'turn-error' : ''}`}>
      <div className="turn-meta eyebrow">
        <span className="who">Bluevis{turn.model ? ` · ${turn.model}` : ''}</span>
        <span>{time(turn.at)}</span>
        {turn.evidence && (
          <span className="evidence" data-kind={turn.evidence}>
            {turn.evidence}
          </span>
        )}
      </div>
      {turn.pending && !turn.text ? (
        <div className="pending">
          <span className="ink-dots">
            <span />
            <span />
            <span />
          </span>
          working
          <Elapsed since={turn.at} />
        </div>
      ) : (
        <>
          <p className={`spoken ${spoken.length > 150 ? 'spoken-long' : ''}`}>
            <Inline text={spoken} />
          </p>
          {rest.length > 0 && <Markdown className="detail" text={rest.join('\n\n')} />}
        </>
      )}
      {!turn.pending && turn.sources && turn.sources.length > 0 && (
        <div className="sources-line">
          <span className="eyebrow">From your vault</span>
          {turn.sources.map((s) => (
            <button key={`${s.path}#${s.heading ?? ''}`} className="source-chip" onClick={() => api.memory.open(s.path)} title={s.path}>
              {s.title}
              {s.heading ? <span> › {s.heading}</span> : null}
            </button>
          ))}
        </div>
      )}
      {task && (
        <button className="task-inline" onClick={() => onOpenTask(task.id)}>
          <span className="mono" style={{ color: 'var(--bone)' }}>
            {task.project ?? 'folder'}
          </span>
          <span className="mono" style={{ color: 'var(--mist)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.title}
          </span>
          <TaskStatus status={task.status} />
          <span className="step mono">
            {task.steps.at(-1)?.label ?? 'waiting for first step'}
            {task.filesChanged.length ? ` · ${task.filesChanged.length} file${task.filesChanged.length > 1 ? 's' : ''} changed` : ''}
          </span>
        </button>
      )}
    </div>
  )
}

/** The first paragraph is the spoken line (set in serif); the rest renders as detail. */
function splitShown(turn: Turn): string[] {
  const text = turn.text.trim()
  if (turn.spoken && text.startsWith(turn.spoken.slice(0, 20))) {
    const idx = text.indexOf('\n\n')
    if (idx > 0) return [text.slice(0, idx), text.slice(idx + 2)]
    return [text]
  }
  const idx = text.indexOf('\n\n')
  const head = idx > 0 ? text.slice(0, idx) : text
  if (/^(#|```|[-*]\s|\d+\.|\|)/.test(head)) return ['', text]
  return idx > 0 ? [head, text.slice(idx + 2)] : [text]
}

function Proposal({ turn, task, onOpenTask }: { turn: Turn; task?: AgentTask; onOpenTask: (id: string) => void }) {
  const a = turn.action!
  const api = window.bluevis
  const [prompt, setPrompt] = useState(a.prompt)
  const [project, setProject] = useState<string | undefined>(a.project || undefined)
  const who = a.agent === 'claude' ? 'Claude' : 'Codex'
  return (
    <div className="turn">
      <div className="proposal" data-state={a.state}>
        <div className="eyebrow">
          {a.state === 'proposed' ? `Proposed · ${who}${project ? ` in ${project}` : ''}` : a.state === 'started' ? `Started · ${who} in ${a.project}` : 'Dismissed'}
        </div>
        {a.state === 'proposed' ? (
          <>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Agent brief" />
            {a.choices && a.choices.length > 0 && (
              <div className="row" style={{ marginBottom: 12 }}>
                {a.choices.map((c) => (
                  <button key={c} className="choice" aria-pressed={project === c} onClick={() => setProject(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="row">
              <button className="btn btn-warm" disabled={!project && !!a.choices?.length} onClick={() => api.actions.approve(turn.id, project, prompt)}>
                Start {who}
              </button>
              <button className="btn btn-quiet" onClick={() => api.actions.dismiss(turn.id)}>
                Dismiss
              </button>
              <span className="mono" style={{ color: 'var(--faint)', marginLeft: 'auto' }}>
                Sandboxed to the project folder
              </span>
            </div>
          </>
        ) : (
          <p style={{ margin: '8px 0 0', color: 'var(--bone-2)' }}>{a.prompt}</p>
        )}
        {task && (
          <button className="task-inline" onClick={() => onOpenTask(task.id)}>
            <span className="mono">{task.project}</span>
            <span />
            <TaskStatus status={task.status} />
            <span className="step mono">{task.steps.at(-1)?.label ?? 'waiting for first step'}</span>
          </button>
        )}
      </div>
    </div>
  )
}
