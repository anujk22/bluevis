import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentTask, ModelChoice, OrbMode, Settings, Turn, VoiceHealth } from '../../core/types'
import { Search } from './components/icons'
import { UsageChips, useUsage } from './components/Usage'
import { AccountMenu, AttentionMenu, ModelMenu } from './components/HeaderMenus'
import { Orb } from './orb/Orb'
import { Listener, Speaker } from './voice'
import { Talk } from './views/Talk'
import { Agents } from './views/Agents'
import { Memory } from './views/Memory'
import { SettingsView } from './views/Settings'
import { Relays } from './views/Relays'
import type { RelayRun } from '../../core/relay'

export type View = 'talk' | 'agents' | 'relays' | 'memory' | 'settings'
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
  const usage = useUsage()
  const [searchFocus, setSearchFocus] = useState(0)
  const [relays, setRelays] = useState<Record<string, RelayRun>>({})
  const [focusRelay, setFocusRelay] = useState<string | null>(null)

  const listener = useRef<Listener | null>(null)
  const speaker = useMemo(() => new Speaker((text) => api.voice.tts(text) as Promise<ArrayBuffer>), [api])
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  useEffect(() => {
    speaker.onChange = setSpeaking
    void api.chat.turns().then((t) => setTurns(t as Turn[]))
    void api.tasks.list().then((l) => setTasks(Object.fromEntries((l as AgentTask[]).map((t) => [t.id, t]))))
    void api.chat.context().then((c) => setCtx(c as Ctx))
    void api.relays.list().then((l) => setRelays(Object.fromEntries((l as RelayRun[]).map((r) => [r.id, r]))))
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
      api.on('relay', (r) => setRelays((prev) => ({ ...prev, [(r as RelayRun).id]: r as RelayRun }))),
      api.on('busy', (b) => setBusy(b as boolean)),
      api.on('task', (t) => setTasks((prev) => ({ ...prev, [(t as AgentTask).id]: t as AgentTask }))),
      api.on('context', (c) => setCtx(c as Ctx)),
      api.on('settings', (s) => setSettings(s as Settings)),
      api.on('voice:health', (h) => setVoice(h as VoiceHealth)),
      api.on('window:mode', (m) => setWinMode(m as 'compact' | 'expanded')),
      api.on('speak', (_id, text) => {
        if (voiceRef.current.state === 'ready') void speaker.speak(text as string).catch(() => setNotice('Speech failed. Replies stay on screen.'))
      }),
      api.on('speak-chunk', (id, text) => {
        if (voiceRef.current.state === 'ready') void speaker.append(id as string, text as string).catch(() => setNotice('Speech failed. Replies stay on screen.'))
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
  const relayList = useMemo(() => Object.values(relays).sort((a, b) => b.startedAt - a.startedAt), [relays])
  const relaysRunning = relayList.filter((r) => r.status === 'running').length
  // Satellites count every live worker: agents and relays.
  const running = taskList.filter((t) => ACTIVE.has(t.status))
  const workers = running.length + relaysRunning
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
            : workers
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
          <Orb mode={orbMode} level={level} moons={Math.min(workers, 4)} size={176} radius={0.6} />
        </button>
        {orbMode !== 'idle' && <span className="compact-dot mono">{caption(orbMode, workers)}</span>}
      </div>
    )
  }

  const empty = view === 'talk' && turns.length === 0
  return (
    <div className="shell" data-empty={empty}>
      <header className="header glass">
        <div className="header-left">
          <div className="wordmark">bluevis</div>
          <UsageChips usage={usage} onOpen={() => setView('settings')} />
        </div>
        <nav className="nav" aria-label="Sections">
          {(['talk', 'agents', 'relays', 'memory'] as const).map((v) => (
            <button key={v} aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
              {v === 'talk' ? 'Talk' : v === 'agents' ? 'Agents' : v === 'relays' ? 'Relays' : 'Memory'}
              {v === 'agents' && running.length > 0 && <span className="count">{running.length}</span>}
              {v === 'relays' && relaysRunning > 0 && <span className="count">{relaysRunning}</span>}
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
          <ModelMenu settings={settings} label={ctx.brainLabel} usage={usage} onChange={setSettings} />
          <button
            className="icon-btn"
            aria-label="Search your vault"
            title="Search your vault"
            onClick={() => {
              setSearchFocus((n) => n + 1)
              setView('memory')
            }}
          >
            <Search />
          </button>
          <AttentionMenu
            turns={turns}
            tasks={taskList}
            relays={relayList}
            onGo={(where, id) => {
              if (where === 'agents' && id) setFocusTask(id)
              if (where === 'relays' && id) setFocusRelay(id)
              setView(where)
            }}
          />
          <AccountMenu onSettings={() => setView('settings')} />
        </div>
      </header>
      <main className="view" key={view}>
        {view === 'talk' && (
          <Talk
            turns={turns}
            tasks={tasks}
            busy={busy}
            orb={<Orb mode={orbMode} level={level} moons={Math.min(workers, 4)} size={empty ? 460 : 440} radius={empty ? 0.43 : 0.52} className="stage-orb" />}
            caption={caption(orbMode, workers, ctx.brainLabel)}
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
            relays={relays}
            onOpenRelay={(id) => {
              setFocusRelay(id)
              setView('relays')
            }}
          />
        )}
        {view === 'agents' && <Agents tasks={taskList} focus={focusTask} onFocus={setFocusTask} settings={settings} />}
        {view === 'relays' && <Relays runs={relayList} focus={focusRelay} onFocus={setFocusRelay} />}
        {view === 'memory' && <Memory searchFocus={searchFocus} />}
        {view === 'settings' && settings && <SettingsView settings={settings} voice={voice} usage={usage} onChange={setSettings} />}
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
      return `${running} worker${running > 1 ? 's' : ''} running`
    default:
      return ''
  }
}
