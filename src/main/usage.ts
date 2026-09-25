import { app } from 'electron'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseClaudeRateLimit, parseCodexRateLimits, type UsageSnapshot } from '../core/usage'
import { runProvider } from './providers'

/** Subscription usage, read from what Codex and Claude report about themselves. */
export class UsageService {
  private claude: UsageSnapshot | null = null
  private file = join(app.getPath('userData'), 'usage.json')

  constructor(private onChange: (u: { codex: UsageSnapshot | null; claude: UsageSnapshot | null }) => void) {
    try {
      this.claude = JSON.parse(readFileSync(this.file, 'utf8')).claude ?? null
    } catch {
      this.claude = null
    }
  }

  /** Called with every Claude `rate_limit_event`, from any run (chat, agents, relays). */
  recordClaude(raw: unknown) {
    const snap = parseClaudeRateLimit(raw, Date.now())
    if (!snap) return
    this.claude = snap
    writeFileSync(this.file, JSON.stringify({ claude: snap }))
    this.onChange(this.get())
  }

  /** Newest Codex session log that carries rate limits; its mtime is when the numbers were observed. */
  codex(): UsageSnapshot | null {
    const root = join(homedir(), '.codex', 'sessions')
    if (!existsSync(root)) return null
    const files: { path: string; mtime: number }[] = []
    const walk = (dir: string, depth: number) => {
      const entries = readdirSync(dir).sort().reverse()
      for (const name of depth < 3 ? entries.slice(0, 2) : entries) {
        const full = join(dir, name)
        if (depth < 3) walk(full, depth + 1)
        else if (name.endsWith('.jsonl')) files.push({ path: full, mtime: statSync(full).mtimeMs })
      }
    }
    try {
      walk(root, 0)
    } catch {
      return null
    }
    for (const f of files.sort((a, b) => b.mtime - a.mtime).slice(0, 12)) {
      const snap = parseCodexRateLimits(tail(f.path, 256 * 1024), f.mtime)
      if (snap) return snap
    }
    return null
  }

  get() {
    return { codex: this.codex(), claude: this.claude }
  }

  /** Costs one tiny Haiku call; only runs when the user asks. */
  refreshClaude(cwd: string): Promise<void> {
    return runProvider({ choice: { provider: 'claude', model: 'haiku' }, prompt: 'Reply with the single word: ok', cwd, role: 'brain', onEvent: () => {} }).done
  }
}

function tail(path: string, bytes: number): string {
  const size = statSync(path).size
  const fd = openSync(path, 'r')
  const len = Math.min(size, bytes)
  const buf = Buffer.alloc(len)
  readSync(fd, buf, 0, len, size - len)
  closeSync(fd)
  return buf.toString('utf8')
}
