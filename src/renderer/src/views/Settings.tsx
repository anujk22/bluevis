import { useEffect, useState } from 'react'
import type { ModelChoice, ProviderHealth, Settings, VoiceHealth } from '../../../core/types'

const CODEX_MODELS = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-5.6-luna']
const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus']
const VOICES: [string, string][] = [
  ['bm_george', 'George (British)'],
  ['bm_lewis', 'Lewis (British)'],
  ['bm_daniel', 'Daniel (British)'],
  ['bm_fable', 'Fable (British)'],
  ['bf_emma', 'Emma (British)'],
  ['bf_isabella', 'Isabella (British)'],
  ['am_michael', 'Michael (American)'],
  ['af_heart', 'Heart (American)']
]

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

export function SettingsView({ settings, voice, onChange }: { settings: Settings; voice: VoiceHealth; onChange: (s: Settings) => void }) {
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
            <label>Voice</label>
            <div className="ctrl">
              <select className="select" value={settings.voice.ttsVoice} onChange={(e) => save({ voice: { ...settings.voice, ttsVoice: e.target.value } })} aria-label="Voice">
                {VOICES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <select className="select" value={String(settings.voice.speed)} onChange={(e) => save({ voice: { ...settings.voice, speed: Number(e.target.value) } })} aria-label="Speed">
                {[0.9, 1, 1.05, 1.1, 1.2].map((s) => (
                  <option key={s} value={s}>
                    {s}× speed
                  </option>
                ))}
              </select>
              <button className="btn" disabled={voice.state !== 'ready'} onClick={() => api.voice.tts('Good evening. Bluevis is online.').then((b) => new Audio(URL.createObjectURL(new Blob([b as ArrayBuffer], { type: 'audio/wav' }))).play())}>
                Preview
              </button>
            </div>
          </div>
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
