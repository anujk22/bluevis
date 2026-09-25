import { execFile, spawn, type SpawnOptions } from 'node:child_process'
import { promisify } from 'node:util'
import { LineBuffer } from '../core/parsers'

const pexec = promisify(execFile)

/**
 * GUI-launched apps on macOS get a minimal PATH, which hides nvm/Homebrew CLIs
 * like codex, claude and uv. Borrow the user's login-shell PATH once at startup.
 */
export async function adoptLoginShellPath(): Promise<void> {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const { stdout } = await pexec(shell, ['-ilc', 'printf "__PATH__%s" "$PATH"'], { timeout: 5000 })
    const path = stdout.split('__PATH__')[1]?.trim()
    if (path) process.env.PATH = path
  } catch {
    // Keep the inherited PATH; provider health checks will report missing CLIs.
  }
}

export async function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await pexec(cmd, args, { cwd: opts.cwd, timeout: opts.timeout ?? 15000, maxBuffer: 16 * 1024 * 1024 })
    return { stdout, stderr, code: 0 }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number | string; message: string }
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? err.message, code: typeof err.code === 'number' ? err.code : 1 }
  }
}

export function spawnLines(cmd: string, args: string[], opts: SpawnOptions & { onLine: (line: string) => void; onStderr?: (s: string) => void; stdin?: string }) {
  const child = spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] })
  const buf = new LineBuffer()
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (chunk: string) => buf.push(chunk).forEach((l) => l.trim() && opts.onLine(l)))
  child.stdout!.on('end', () => buf.flush().forEach((l) => l.trim() && opts.onLine(l)))
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (s: string) => opts.onStderr?.(s))
  if (opts.stdin !== undefined) child.stdin!.end(opts.stdin)
  else child.stdin!.end()
  return child
}
