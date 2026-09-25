import { useEffect, useRef, useState } from 'react'
import type { ModelChoice, ProviderHealth, Settings, VoiceHealth } from '../../../core/types'
import { UsageDetail, type UsageState } from '../components/Usage'

const CODEX_MODELS = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-5.6-luna']
const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus']
interface VoiceOption {
  id: string
  name: string
  kind: string
}

// Pocket TTS (Kyutai) sounds more natural; Kokoro is the fastest. Both run locally.
const VOICES: { engine: string; blurb: string; voices: VoiceOption[] }[] = [
  {
    engine: 'Pocket TTS',
    blurb: 'Natural, streams in about 0.2s, CPU',
    voices: [
      { id: 'pocket:charles', name: 'Charles', kind: 'male' },
      { id: 'pocket:paul', name: 'Paul', kind: 'male' },
      { id: 'pocket:george', name: 'George', kind: 'male' },
      { id: 'pocket:stuart_bell', name: 'Stuart', kind: 'male, narrator' },
      { id: 'pocket:peter_yearsley', name: 'Peter', kind: 'male, narrator' },
      { id: 'pocket:javert', name: 'Javert', kind: 'male' },
      { id: 'pocket:michael', name: 'Michael', kind: 'male' },
      { id: 'pocket:alba', name: 'Alba', kind: 'female' },
      { id: 'pocket:jane', name: 'Jane', kind: 'female' },
      { id: 'pocket:eve', name: 'Eve', kind: 'female' }
    ]
  },
  {
    engine: 'Kokoro',
    blurb: 'Fastest, more synthetic, MLX',
    voices: [
      { id: 'bm_george', name: 'George', kind: 'British male' },
      { id: 'bm_fable', name: 'Fable', kind: 'British male' },
      { id: 'bm_lewis', name: 'Lewis', kind: 'British male' },
      { id: 'bf_emma', name: 'Emma', kind: 'British female' },
      { id: 'af_heart', name: 'Heart', kind: 'American female' },
      { id: 'am_michael', name: 'Michael', kind: 'American male' }
    ]
  }
]

const PREVIEW = 'Good evening. Yonder is building cleanly again. Want me to have Codex take the next step?'

function VoicePicker({ value, ready, onPick }: { value: string; ready: boolean; onPick: (id: string) => void }) {
  const api = window.bluevis
  const [playing, setPlaying] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const preview = async (id: string) => {
    audio.current?.pause()
    if (playing === id) return setPlaying(null)
    setLoading(id)
    try {
      const buf = (await api.voice.tts(PREVIEW, id)) as ArrayBuffer
      const a = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })))
      audio.current = a
      a.onended = () => setPlaying(null)
      setPlaying(id)
      await a.play()
    } finally {
      setLoading(null)
    }
  }
  return (
    <div className="voice-picker">
      {VOICES.map((group) => (
        <div key={group.engine}>
          <div className="eyebrow" style={{ margin: '14px 0 8px' }}>
            {group.engine} · {group.blurb}
          </div>
          <div className="voice-grid">
            {group.voices.map((v) => (
              <div key={v.id} className="voice-card" aria-current={value === v.id}>
                <button className="voice-pick" onClick={() => onPick(v.id)} aria-label={`Use ${v.name}`}>
                  <span className="vname">{v.name}</span>
                  <span className="mono vkind">{v.kind}</span>
                </button>
                <button className="voice-play" disabled={!ready || loading !== null} onClick={() => preview(v.id)} aria-label={`Preview ${v.name}`}>
                  {loading === v.id ? <span className="spin" /> : playing === v.id ? '■' : '▶'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Calendars({ settings, save }: { settings: Settings; save: (p: Partial<Settings>) => Promise<void> }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const feeds = settings.calendarFeeds ?? []
  const valid = /^(https?|webcal):\/\/\S+/i.test(url.trim()) && name.trim()
  return (
    <div>
      {feeds.map((f, i) => (
        <div key={f.url} className="field">
          <label>{f.name}</label>
          <div className="ctrl">
            <span className="mono" style={{ color: 'var(--mist)' }}>
              {f.url.replace(/^(\w+:\/\/[^/]+).*$/, '$1/•••')}
            </span>
            <button className="link-btn" onClick={() => save({ calendarFeeds: feeds.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <div className="field">
        <label>Add a feed</label>
        <div className="ctrl">
          <input className="input" style={{ minWidth: 120, width: 140 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Canvas)" aria-label="Feed name" />
          <input className="input mono" style={{ flex: 1 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… .ics" aria-label="Feed link" type="password" />
          <button
            className="btn"
            disabled={!valid}
            onClick={async () => {
              await save({ calendarFeeds: [...feeds, { name: name.trim(), url: url.trim() }] })
              setName('')
              setUrl('')
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

function ModelPicker({ value, onChange, localModels, allowLocal = true }: { value: ModelChoice; onChange: (c: ModelChoice) => void; localModels: string[]; allowLocal?: boolean }) {
  const models = value.provider === 'codex' ? CODEX_MODELS : value.provider === 'claude' ? CLAUDE_MODELS : localModels
  return (
    <div className="ctrl">
      <select
        className="select"
        value={value.provider}
        aria-label="Provider"
        onChange={(e) => {
          const p = e.target.value as ModelChoice['provider']
          onChange(p === 'codex' ? { provider: 'codex', model: 'gpt-6-luna', effort: 'low' } : p === 'claude' ? { provider: 'claude', model: 'haiku' } : { provider: 'local', model: localModels[0] ?? '' })
        }}
      >
        <option value="codex">Codex</option>
        <option value="claude">Claude</option>
        {allowLocal && <option value="local">Local (mlx-serve)</option>}
      </select>
      <select className="select" value={value.model} aria-label="Model" onChange={(e) => onChange({ ...value, model: e.target.value })}>
        {!models.includes(value.model) && <option value={value.model}>{value.model || 'no models found'}</option>}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {value.provider !== 'local' && (
        <select className="select" value={value.effort ?? 'medium'} aria-label="Reasoning effort" onChange={(e) => onChange({ ...value, effort: e.target.value as ModelChoice['effort'] })}>
          {['minimal', 'low', 'medium', 'high'].map((e) => (
            <option key={e} value={e}>
              {e} effort
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export function SettingsView({ settings, voice, usage, onChange }: { settings: Settings; voice: VoiceHealth; usage: UsageState; onChange: (s: Settings) => void }) {
  const api = window.bluevis
  const [health, setHealth] = useState<ProviderHealth[] | null>(null)
  const [roots, setRoots] = useState(settings.projectRoots.join('\n'))
  const localModels = health?.find((h) => h.provider === 'local' && h.ok)?.detail.split(', ') ?? []

  useEffect(() => {
    void api.providers.health().then((h) => setHealth(h as ProviderHealth[]))
  }, [api, settings.localBaseUrl])

  const save = async (patch: Partial<Settings>) => onChange((await api.settings.set(patch)) as Settings)

  return (
    <div className="settings">
      <div className="settings-inner">
        <div className="section">
          <h2 className="panel-title">Settings</h2>
          <p className="panel-sub" style={{ margin: 0 }}>
            Changes save immediately.
          </p>
        </div>

        <div className="section">
          <h3>Usage</h3>
          <p>As reported by Codex and Claude themselves. Each number shows when it was observed.</p>
          <UsageDetail usage={usage} />
        </div>

        <div className="section">
          <h3>Models</h3>
          <p>Conversation should be fast; agents should be capable. Local-only notes are only ever sent to a local model.</p>
          <div className="field">
            <label>Conversation</label>
            <ModelPicker value={settings.brain} localModels={localModels} onChange={(brain) => save({ brain })} />
          </div>
          <div className="field">
            <label>Default agent</label>
            <ModelPicker value={settings.worker} localModels={localModels} allowLocal={false} onChange={(worker) => save({ worker })} />
          </div>
          <div className="field">
            <label>Local server</label>
            <div className="ctrl">
              <input className="input mono" defaultValue={settings.localBaseUrl} onBlur={(e) => e.target.value !== settings.localBaseUrl && save({ localBaseUrl: e.target.value })} aria-label="Local model server URL" />
            </div>
          </div>
          <div className="health" style={{ marginTop: 14 }}>
            {(health ?? []).map((h) => (
              <div key={h.provider}>
                <span className="kstatus" data-k={h.ok ? 'known' : 'needs-review'}>
                  <span className="g">{h.ok ? '●' : '○'}</span>
                  {h.provider} · {h.ok ? 'available' : 'unavailable'}
                </span>
                <div className="d mono">{h.detail}</div>
              </div>
            ))}
            {!health && <div className="d">Checking providers…</div>}
          </div>
        </div>

        <div className="section">
          <h3>Voice</h3>
          <p>Whisper and Kokoro run locally on MLX. No audio leaves this Mac. The microphone is only open while the orb is listening.</p>
          <div className="field">
            <label>Local voice</label>
            <div className="ctrl">
              <button
                className="switch"
                role="switch"
                aria-checked={settings.voice.enabled}
                aria-label="Local voice"
                onClick={async () => {
                  const enabled = !settings.voice.enabled
                  await save({ voice: { ...settings.voice, enabled } })
                  if (enabled) await api.voice.start()
                  else await api.voice.stop()
                }}
              />
              <span className="mono" style={{ color: 'var(--mist)' }}>
                {voice.detail || voice.state}
              </span>
            </div>
          </div>
          <div className="field">
            <label>Speak replies</label>
            <div className="ctrl">
              <button className="switch" role="switch" aria-checked={settings.voice.speak} aria-label="Speak replies" onClick={() => save({ voice: { ...settings.voice, speak: !settings.voice.speak } })} />
            </div>
          </div>
          <div className="field">
            <label>Speed (Kokoro)</label>
            <div className="ctrl">
              <select className="select" value={String(settings.voice.speed)} onChange={(e) => save({ voice: { ...settings.voice, speed: Number(e.target.value) } })} aria-label="Speed">
                {[0.9, 1, 1.05, 1.1, 1.2].map((s) => (
                  <option key={s} value={s}>
                    {s}× speed
                  </option>
                ))}
              </select>
            </div>
          </div>
          <VoicePicker value={settings.voice.ttsVoice} ready={voice.state === 'ready'} onPick={(ttsVoice) => save({ voice: { ...settings.voice, ttsVoice } })} />
        </div>

        <div className="section">
          <h3>Calendars</h3>
          <p>
            Read-only feeds. Google Calendar: Settings → your calendar → Integrate calendar → Secret address in iCal format. Canvas: Calendar → Calendar feed. Then ask “what's due this week?”
          </p>
          <Calendars settings={settings} save={save} />
        </div>

        <div className="section">
          <h3>Knowledge and projects</h3>
          <p>The vault is plain Markdown with its own git history. Project discovery only scans the folders listed here.</p>
          <div className="field">
            <label>Vault</label>
            <div className="ctrl">
              <span className="mono" style={{ color: 'var(--bone-2)' }}>
                {settings.vaultPath}
              </span>
              <button className="btn" onClick={() => api.memory.open()}>
                Open
              </button>
            </div>
          </div>
          <div className="field" style={{ alignItems: 'start' }}>
            <label>Project folders</label>
            <textarea
              className="input mono"
              style={{ height: 110, padding: 10, resize: 'vertical' }}
              value={roots}
              onChange={(e) => setRoots(e.target.value)}
              onBlur={() => save({ projectRoots: roots.split('\n').map((r) => r.trim()).filter(Boolean) })}
              aria-label="Project folders, one per line"
            />
          </div>
          <div className="field">
            <label>Editor app</label>
            <input className="input" defaultValue={settings.editor} onBlur={(e) => save({ editor: e.target.value })} aria-label="Editor application name" />
          </div>
        </div>

        <div className="section">
          <h3>Shortcuts</h3>
          <div className="keys" style={{ marginTop: 12 }}>
            <kbd>⌥ Space</kbd>
            <span>Summon Bluevis, or shrink it to the orb</span>
            <kbd>⌥ ⇧ Space</kbd>
            <span>Talk (ends on silence; press again to stop)</span>
            <kbd>⌥ ⇧ L</kbd>
            <span>Look at the screen, then ask about it</span>
            <kbd>Esc</kbd>
            <span>Stop speaking and cancel the current reply. Running agents keep going.</span>
          </div>
        </div>

        <div className="section" style={{ borderBottom: 0 }}>
          <h3>What Bluevis can see</h3>
          <p>
            The screen only when you press ⌥⇧L or the eye. The microphone only while listening. Repos in the folders above, read on demand. Your Internship
            folder is not scanned. Email, calendar and ChatGPT history are not connected.
          </p>
        </div>
      </div>
    </div>
  )
}
