import { powerMonitor } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { getSettings } from './settings'

let child: ChildProcess | null = null
let childModel = ''
let lastUse = Date.now()

async function models(base: string): Promise<string[]> {
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(1500) })
    return ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []
  } catch {
    return []
  }
}

const splashBrain = () => {
  const { brain } = getSettings()
  return brain.provider === 'local' && brain.model.endsWith('-Splash')
}

/**
 * Start the Splash server when conversation uses a Splash model and nothing answers at the local URL yet.
 * On battery it is not started ahead of time (`onDemand` starts it for a request). It stops when Vesper quits.
 */
export async function ensureSplash(onDemand = false) {
  const { brain, localBaseUrl } = getSettings()
  if (!splashBrain()) return
  if (!onDemand && powerMonitor.isOnBatteryPower()) return
  // Ours and already serving (or loading) the right model.
  if (child && childModel === brain.model) return
  const serving = await models(localBaseUrl)
  if (serving.includes(brain.model)) return
  // Switching Splash models means one server out, the other in: two would not fit in memory.
  if (child) await stopAndWait(localBaseUrl)
  else if (serving.length) return
  const port = new URL(localBaseUrl).port || '8000'
  // A busy server can miss the models check; if anything holds the port, never start a second copy of the model.
  if (await listening(Number(port))) return
  const proc = spawn('splash', ['serve', '--model', brain.model, '--port', port, '--no-webui'], { stdio: 'ignore', detached: true })
  child = proc
  childModel = brain.model
  // Not installed (spawn error) or exited: allow a later retry.
  const gone = () => child === proc && (child = null)
  proc.on('error', gone)
  proc.on('exit', gone)
}

async function stopAndWait(base: string) {
  stopSplash()
  for (let i = 0; i < 40 && (await models(base)).length; i++) await new Promise((r) => setTimeout(r, 250))
}

/** Before a local request: make sure the model is loaded, starting it if needed. `onLoading` fires only when it has to wait. */
export async function readySplash(base: string, onLoading?: () => void) {
  lastUse = Date.now()
  if (!splashBrain() || (await models(base)).includes(getSettings().brain.model)) return
  onLoading?.()
  await ensureSplash(true)
  for (const until = Date.now() + 120_000; Date.now() < until; ) {
    await new Promise((r) => setTimeout(r, 500))
    if ((await models(base)).includes(getSettings().brain.model)) return
  }
  throw new Error('The local model did not finish loading in two minutes.')
}

export function stopSplash() {
  // `splash` hands off to a Python server; signal the whole process group so the model's memory is freed.
  if (child?.pid) process.kill(-child.pid, 'SIGTERM')
  child = null
}

/**
 * Plugged in: keep the model loaded. On battery: unload at once, load again only when asked,
 * and unload again after ten minutes without use.
 */
export function managePower() {
  powerMonitor.on('on-battery', stopSplash)
  powerMonitor.on('on-ac', () => void ensureSplash())
  setInterval(() => {
    if (child && powerMonitor.isOnBatteryPower() && Date.now() - lastUse > 10 * 60_000) stopSplash()
  }, 60_000)
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1')
    sock.once('connect', () => (sock.destroy(), resolve(true)))
    sock.once('error', () => resolve(false))
  })
}
