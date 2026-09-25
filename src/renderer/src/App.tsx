import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentTask, ModelChoice, OrbMode, Settings, Turn, VoiceHealth } from '../../core/types'
import { Close, Gear, Shrink } from './components/icons'
import { Orb } from './orb/Orb'
import { Listener, Speaker } from './voice'
import { Talk } from './views/Talk'
import { Agents } from './views/Agents'
import { Memory } from './views/Memory'
import { SettingsView } from './views/Settings'

export type View = 'talk' | 'agents' | 'memory' | 'settings'
export interface Ctx {
  activeProject?: string
  brain?: ModelChoice
  brainLabel?: string
}
export interface Shot {
  path: string
  preview: string
}

const ACTIVE = new Set(['starting', 'investigating', 'editing', 'testing', 'awaiting-approval'])

export function App() {
  const api = window.bluevis
  const [turns, setTurns] = useState<Turn[]>([])
  const [tasks, setTasks] = useState<Record<string, AgentTask>>({})
  const [busy, setBusy] = useState(false)
  const [ctx, setCtx] = useState<Ctx>({})
  const [settings, setSettings] = useState<Settings | null>(null)
  const [voice, setVoice] = useState<VoiceHealth>({ state: 'off', detail: '' })
  const [winMode, setWinMode] = useState<'compact' | 'expanded'>('expanded')
  const [view, setView] = useState<View>('talk')
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [shot, setShot] = useState<Shot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [focusTask, setFocusTask] = useState<string | null>(null)

  const listener = useRef<Listener | null>(null)
  const speaker = useMemo(() => new Speaker((text) => api.voice.tts(text) as Promise<ArrayBuffer>), [api])
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  useEffect(() => {
    speaker.onChange = setSpeaking
    void api.chat.turns().then((t) => setTurns(t as Turn[]))
    void api.tasks.list().then((l) => setTasks(Object.fromEntries((l as AgentTask[]).map((t) => [t.id, t]))))
    void api.chat.context().then((c) => setCtx(c as Ctx))
    void api.settings.get().then((s) => setSettings(s as Settings))
    void api.voice.health().then((h) => setVoice(h as VoiceHealth))
    void api.window.getMode().then((m) => setWinMode(m as 'compact' | 'expanded'))
    const offs = [
      api.on('turn', (t) =>
        setTurns((prev) => {
          const turn = t as Turn
          const i = prev.findIndex((x) => x.id === turn.id)
          if (i < 0) return [...prev, turn]
          const next = prev.slice()
          next[i] = turn
          return next
        })
      ),
      api.on('reset', () => setTurns([])),
      api.on('busy', (b) => setBusy(b as boolean)),
      api.on('task', (t) => setTasks((prev) => ({ ...prev, [(t as AgentTask).id]: t as AgentTask }))),
      api.on('context', (c) => setCtx(c as Ctx)),
      api.on('settings', (s) => setSettings(s as Settings)),
      api.on('voice:health', (h) => setVoice(h as VoiceHealth)),
      api.on('window:mode', (m) => setWinMode(m as 'compact' | 'expanded')),
      api.on('speak', (_id, text) => {
        if (voiceRef.current.state === 'ready') void speaker.speak(text as string).catch(() => setNotice('Speech failed. Replies stay on screen.'))
      }),
      api.on('speech:stop', () => speaker.stop()),
      api.on('hotkey:talk', () => toggleListen()),
      api.on('screen:attached', (s) => {
        const r = s as Shot | { error: string }
        if ('error' in r) setNotice(r.error)
        else setShot(r)
        setView('talk')
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const send = useCallback(
    async (text: string, via: 'voice' | 'text' = 'text') => {
      const t = text.trim()
      if (!t) return
      speaker.stop()
      setNotice(null)
      const attached = shot
      setShot(null)
      setView('talk')
      await api.chat.send(t, { via, screenshot: attached?.path })
    },
    [api, shot, speaker]
  )
  const sendRef = useRef(send)
  sendRef.current = send

  const toggleListen = useCallback(async () => {
    if (listener.current) {
      listener.current.stop()
      return
    }
    if (voiceRef.current.state !== 'ready') {
      setNotice(voiceRef.current.state === 'starting' ? 'Voice is still loading. Type for now, or try again in a moment.' : `Voice is unavailable: ${voiceRef.current.detail || 'turn it on in Settings'}.`)
      return
    }
    speaker.stop()
    const l = new Listener()
    listener.current = l
    setListening(true)
    const res = await l.listen()
    listener.current = null
    setListening(false)
    if ('cancelled' in res) {
      if (res.reason === 'error') setNotice(res.message ?? 'Microphone unavailable')
      return
    }
    try {
      const text = (await api.voice.stt(res.wav)) as string
      if (text.trim()) await sendRef.current(text, 'voice')
    } catch (e) {
      setNotice(`Transcription failed: ${(e as Error).message}`)
    }
  }, [api, speaker])

  const taskList = useMemo(() => Object.values(tasks).sort((a, b) => b.startedAt - a.startedAt), [tasks])
  const running = taskList.filter((t) => ACTIVE.has(t.status))
  const lastBluevis = [...turns].reverse().find((t) => t.speaker === 'bluevis')
  const pendingProposal = turns.some((t) => t.action?.state === 'proposed')
  const [errorFresh, setErrorFresh] = useState(false)
  useEffect(() => {
    if (!lastBluevis?.error) return setErrorFresh(false)
    setErrorFresh(true)
    const id = setTimeout(() => setErrorFresh(false), 4000)
    return () => clearTimeout(id)
  }, [lastBluevis?.id, lastBluevis?.error])

  const orbMode: OrbMode = listening
    ? 'listening'
    : speaking
      ? 'speaking'
      : busy
        ? 'thinking'
        : errorFresh
          ? 'error'
          : pendingProposal
            ? 'approval'
            : running.length
              ? 'acting'
              : 'idle'

  const level = useCallback(() => (listener.current ? listener.current.level : speaker.level()), [speaker])

  const openTask = (id: string) => {
    setFocusTask(id)
    setView('agents')
  }

  if (winMode === 'compact') {
    return (
      <div className="compact">
        <button className="stage-orb" onClick={() => api.window.setMode('expanded')} aria-label="Open Bluevis">
          <Orb mode={orbMode} level={level} moons={Math.min(running.length, 4)} size={176} radius={0.6} />
        </button>
        {orbMode !== 'idle' && <span className="compact-dot mono">{caption(orbMode, running.length)}</span>}
      </div>
    )
  }

  const empty = view === 'talk' && turns.length === 0
  return (
    <div className="shell" data-empty={empty}>
      <header className="header">
        <div className="wordmark">
          bluevis<i />
        </div>
        <nav className="nav" aria-label="Sections">
          {(['talk', 'agents', 'memory'] as const).map((v) => (
            <button key={v} aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
              {v === 'talk' ? 'Talk' : v === 'agents' ? 'Agents' : 'Memory'}
              {v === 'agents' && running.length > 0 && <span className="count">{running.length}</span>}
            </button>
          ))}
        </nav>
        <div className="header-right">
          {ctx.activeProject && (
            <button className="chip" title="Active project. Click to clear." onClick={() => api.projects.activate()}>
              <span className="dot" />
              {ctx.activeProject}
            </button>
          )}
          <button className="chip" title="Conversation model" onClick={() => setView('settings')}>
            {ctx.brainLabel ?? '…'}
          </button>
          <button className="icon-btn" aria-label="Settings" aria-pressed={view === 'settings'} onClick={() => setView(view === 'settings' ? 'talk' : 'settings')}>
            <Gear />
          </button>
          <button className="icon-btn" aria-label="Shrink to orb (⌥Space)" title="Shrink to orb (⌥Space)" onClick={() => api.window.setMode('compact')}>
            <Shrink />
          </button>
          <button className="icon-btn" aria-label="Hide" title="Hide (⌥Space brings it back)" onClick={() => api.window.hide()}>
            <Close />
          </button>
        </div>
      </header>
      <main className="view" key={view}>
        {view === 'talk' && (
          <Talk
            turns={turns}
            tasks={tasks}
            busy={busy}
            orb={<Orb mode={orbMode} level={level} moons={Math.min(running.length, 4)} size={empty ? 460 : 440} radius={empty ? 0.5 : 0.56} className="stage-orb" />}
            caption={caption(orbMode, running.length, ctx.brainLabel)}
            live={orbMode !== 'idle'}
            listening={listening}
            shot={shot}
            notice={notice}
            voice={voice}
            onSend={send}
            onListen={toggleListen}
            onOrb={() => (speaking ? speaker.stop() : toggleListen())}
            onShot={async () => {
              if (shot) {
                void api.screen.discard(shot.path)
                return setShot(null)
              }
              const r = (await api.screen.capture()) as Shot | { error: string }
              if ('error' in r) setNotice(r.error)
              else setShot(r)
            }}
            onStop={() => {
              speaker.stop()
              void api.chat.stop()
            }}
            onOpenTask={openTask}
          />
        )}
        {view === 'agents' && <Agents tasks={taskList} focus={focusTask} onFocus={setFocusTask} settings={settings} />}
        {view === 'memory' && <Memory />}
        {view === 'settings' && settings && <SettingsView settings={settings} voice={voice} onChange={setSettings} />}
      </main>
    </div>
  )
}

function caption(mode: OrbMode, running: number, model?: string): string {
  switch (mode) {
    case 'listening':
      return 'Listening'
    case 'speaking':
      return 'Speaking'
    case 'thinking':
      return model ? `Thinking · ${model}` : 'Thinking'
    case 'approval':
      return 'Waiting for your go-ahead'
    case 'error':
      return 'Something failed'
    case 'acting':
      return `${running} agent${running > 1 ? 's' : ''} working`
    default:
      return ''
  }
}
