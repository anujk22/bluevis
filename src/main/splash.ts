import { spawn, type ChildProcess } from 'node:child_process'
import { localModels } from './providers'
import { getSettings } from './settings'

let child: ChildProcess | null = null

/** Start the Splash server when conversation uses a Splash model and nothing answers at the local URL yet. It stops when Bluevis quits. */
export async function ensureSplash() {
  const { brain, localBaseUrl } = getSettings()
  if (child || brain.provider !== 'local' || !brain.model.endsWith('-Splash')) return
  if ((await localModels(localBaseUrl)).length) return
  const port = new URL(localBaseUrl).port || '8000'
  child = spawn('splash', ['serve', '--model', brain.model, '--port', port, '--no-webui'], { stdio: 'ignore', detached: true })
  // Not installed (spawn error) or exited: allow a later retry.
  child.on('error', () => (child = null))
  child.on('exit', () => (child = null))
}

export function stopSplash() {
  // `splash` hands off to a Python server; signal the whole process group so the model's memory is freed.
  if (child?.pid) process.kill(-child.pid, 'SIGTERM')
  child = null
}
