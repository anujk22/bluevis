import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentTask, ChatSummary, Narration, Turn, VoiceHealth } from '../../../core/types'
import type { Shot } from '../App'
import { Arrow, ArrowRight, Bars, Book, Clip, Clock, Eye, Mic, Person, Plus, SpeakerBrief, SpeakerFull, SpeakerMute, Square } from '../components/icons'
import { Popover } from '../components/HeaderMenus'
import { Inline, Markdown } from '../components/Markdown'
import { TaskStatus } from '../components/TaskStatus'
import { RelayInline } from './Relays'
import type { RelayRun } from '../../../core/relay'

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
  relays: Record<string, RelayRun>
  onOpenRelay: (id: string) => void
  narrate: Narration
  onNarrate: (n: Narration) => void
  onOpenChat: (id: string) => void
  onNewChat: () => void
}

const NARRATION: Record<Narration, { next: Narration; label: string; icon: ReactNode }> = {
  brief: { next: 'full', label: 'Narration: brief', icon: <SpeakerBrief /> },
  full: { next: 'mute', label: 'Narration: full', icon: <SpeakerFull /> },
  mute: { next: 'brief', label: 'Narration: muted', icon: <SpeakerMute /> }
}

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000)
  if (m < 60) return m < 1 ? 'just now' : `${m}m ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h ago` : new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Saved chats, newest first. Refreshed whenever the list is shown. */
function useChats(deps: unknown[]): ChatSummary[] {
  const [chats, setChats] = useState<ChatSummary[]>([])
  useEffect(() => {
    void window.bluevis.chat.list().then((c) => setChats(c as ChatSummary[]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return chats
}

function RecentList({ chats, onOpen }: { chats: ChatSummary[]; onOpen: (id: string) => void }) {
  return (
    <>
      {chats.map((c) => (
        <button key={c.id} className="menu-item recent-item" onClick={() => onOpen(c.id)}>
          <span className="recent-title">{c.title}</span>
          <span className="mono menu-note">{ago(c.at)}</span>
        </button>
      ))}
    </>
  )
}

function RecentMenu({ onOpen }: { onOpen: (id: string) => void }) {
  const chats = useChats([])
  return (
    <div className="menu recent-menu">
      <div className="eyebrow menu-head">Recent chats</div>
      {chats.length ? <RecentList chats={chats.slice(0, 30)} onOpen={onOpen} /> : <span className="mono menu-note" style={{ padding: 10 }}>No saved chats yet.</span>}
    </div>
  )
}

function ChatBar(p: Props) {
  return (
    <div className="chat-bar">
      <Popover
        label="Recent chats"
        align="left"
        button={() => (
          <span className="chat-bar-btn">
            <Clock /> Recent
          </span>
        )}
      >
        {(close) => <RecentMenu onOpen={(id) => (p.onOpenChat(id), close())} />}
      </Popover>
      <button className="chat-bar-btn" onClick={p.onNewChat}>
        <Plus /> New chat
      </button>
    </div>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

const SUGGESTIONS = [
  { text: 'What do you know about me?', icon: <Person /> },
  { text: 'Where did I leave off?', icon: <Clock /> },
  { text: 'Brief me', send: 'Brief me', icon: <Bars /> },
  { text: 'Explain this screen', look: true, icon: <Book /> }
]

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Real readiness, not a decorative "all good". */
function StatusCorner({ voice, busy }: { voice: VoiceHealth; busy: boolean }) {
  const ok = voice.state === 'ready'
  const label = busy ? 'Working' : ok ? 'Ready' : voice.state === 'starting' ? 'Warming up' : 'Text only'
  const detail = ok ? 'Voice and memory are local' : voice.state === 'starting' ? voice.detail : voice.detail || 'Voice is off'
  return (
    <div className="corner corner-left" aria-live="polite">
      <div className="eyebrow">
        <span className="dot" data-ok={ok} />
        {label}
      </div>
      <div className="mono corner-sub">{detail}</div>
    </div>
  )
}

export function Talk(p: Props) {
  const empty = p.turns.length === 0
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = [...p.turns].reverse().find((t) => t.speaker === 'bluevis')?.id
  // A task's live card shows only on the most recent turn that refers to it.
  const cardTurn = new Map<string, string>()
  for (const t of p.turns) {
    if (t.taskId) cardTurn.set(t.taskId, t.id)
    if (t.relayId) cardTurn.set(t.relayId, t.id)
  }

  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [p.turns])

  const composer = <Composer {...p} />
  const now = useNow()

  return (
    <div className="talk" data-empty={empty}>
      <StatusCorner voice={p.voice} busy={p.busy} />
      <div className="corner corner-right eyebrow">
        {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </div>
      <div className="stage">
        <div onClick={p.onOrb} role="button" tabIndex={-1} aria-label="Talk to Vesper" style={{ pointerEvents: 'auto', cursor: 'pointer', borderRadius: '50%' }}>
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
            <button key={s.text} className="suggestion glass" onClick={() => (s.look ? p.onShot() : p.onSend(s.send ?? s.text))}>
              <span className="s-icon">{s.icon}</span>
              <span className="s-text">{s.text}</span>
              <span className="s-go">
                <ArrowRight />
              </span>
            </button>
          ))}
        </div>
        {empty && composer}
        {empty && <RecentStrip onOpen={p.onOpenChat} />}
        {empty && <div className="footnote eyebrow">⌥⇧Space to talk · ⌥⇧L to look · ⌥Space to hide</div>}
      </div>

      <section className="conversation" aria-label="Conversation">
        {!empty && <ChatBar {...p} />}
        <div className="transcript" ref={scroller} role="log">
          {p.turns.map((t) => (
            <TurnView key={t.id} turn={t} latest={t.id === lastId} task={t.taskId && cardTurn.get(t.taskId) === t.id ? p.tasks[t.taskId] : undefined} tasks={p.tasks} onOpenTask={p.onOpenTask} relay={t.relayId && cardTurn.get(t.relayId) === t.id ? p.relays[t.relayId] : undefined} onOpenRelay={p.onOpenRelay} />
          ))}
        </div>
        {!empty && composer}
      </section>
    </div>
  )
}

function RecentStrip({ onOpen }: { onOpen: (id: string) => void }) {
  const chats = useChats([])
  if (!chats.length) return null
  return (
    <div className="recent-strip">
      <div className="eyebrow">Recent</div>
      <RecentList chats={chats.slice(0, 4)} onOpen={onOpen} />
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
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`
    }
    fit()
    // The window can mount or grow while orb-sized; refit once it has its real width.
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
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
      <div className="composer glass" data-attached={!!p.shot}>
        {p.shot && (
          <div className="attachment">
            <img src={p.shot.preview} alt="Screenshot to send" />
            <span className="mono">Screen attached · sent with your next message</span>
          </div>
        )}
        <div className="composer-row">
          <button className="round" aria-pressed={!!p.shot} onClick={p.onShot} title="Look at my screen (⌥⇧L)" aria-label="Attach a screenshot">
            {p.shot ? <Eye /> : <Clip />}
          </button>
          <span className="composer-sep" aria-hidden="true" />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={p.shot ? 'What about it?' : 'Ask anything, delegate a task, or continue…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
              if (e.key === 'Escape') p.onStop()
            }}
            aria-label="Message Vesper"
          />
          <button
            className="round"
            aria-pressed={p.listening}
            onClick={p.onListen}
            title={p.voice.state === 'ready' ? 'Talk (⌥⇧Space)' : p.voice.detail}
            aria-label={p.listening ? 'Stop listening' : 'Talk'}
          >
            <Mic />
          </button>
          <button className="round" onClick={() => p.onNarrate(NARRATION[p.narrate].next)} title={`${NARRATION[p.narrate].label}. Click to change.`} aria-label={NARRATION[p.narrate].label}>
            {NARRATION[p.narrate].icon}
          </button>
          <span className="composer-sep" aria-hidden="true" />
          {p.busy ? (
            <button className="send" onClick={p.onStop} aria-label="Stop (Esc)" title="Stop (Esc)">
              <Square />
            </button>
          ) : (
            <button className="send" onClick={submit} aria-label="Send" disabled={!text.trim()}>
              <Arrow />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The model's thinking: live while it streams, then folded to one line that opens on click. */
function Thinking({ turn }: { turn: Turn }) {
  const live = !!turn.pending && !turn.text
  const tail = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (live && tail.current) tail.current.scrollTop = tail.current.scrollHeight
  }, [live, turn.thinking])
  const secs = Math.max(1, Math.round((turn.thoughtMs ?? Date.now() - turn.at) / 1000))
  return (
    <details className="thinking" open={live || undefined}>
      <summary className="eyebrow">
        {live ? (
          <>
            Thinking <Elapsed since={turn.at} />
          </>
        ) : (
          `Thought for ${secs}s`
        )}
      </summary>
      <div className="thinking-body" ref={tail} data-live={live}>
        {turn.thinking!.trim()}
      </div>
    </details>
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

function TurnView({ turn, latest, task, tasks, onOpenTask, relay, onOpenRelay }: { turn: Turn; latest: boolean; task?: AgentTask; tasks: Record<string, AgentTask>; onOpenTask: (id: string) => void; relay?: RelayRun; onOpenRelay: (id: string) => void }) {
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
        <span className="who">Vesper{turn.model ? ` · ${turn.model}` : ''}</span>
        <span>{time(turn.at)}</span>
        {turn.evidence && (
          <span className="evidence" data-kind={turn.evidence}>
            {turn.evidence}
          </span>
        )}
      </div>
      {turn.thinking && <Thinking turn={turn} />}
      {turn.pending && !turn.text ? (
        turn.thinking ? null : <div className="pending">
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
      {turn.activity && turn.activity.length > 0 && (
        <ul className="events" style={{ marginTop: 12 }}>
          {turn.activity.map((a, i) => (
            <li key={i} className="mono">
              {a}
            </li>
          ))}
        </ul>
      )}
      {turn.web && turn.web.length > 0 && (
        <div className="sources-line">
          <span className="eyebrow">Sources</span>
          {turn.web.map((w, i) => (
            <a key={w.url} className="source-chip" href={w.url} target="_blank" rel="noreferrer" title={w.url}>
              {i + 1} · {w.title.length > 48 ? `${w.title.slice(0, 46)}…` : w.title}
            </a>
          ))}
        </div>
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
      {relay && <RelayInline run={relay} onOpen={() => onOpenRelay(relay.id)} />}
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
