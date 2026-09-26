import { app } from 'electron'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatSummary, ModelChoice, Turn } from '../core/types'

interface SavedChat {
  id: string
  title: string
  at: number
  turns: Turn[]
  sessions: Partial<Record<ModelChoice['provider'], string>>
}

/** Talk conversations, one JSON file each, so any chat can be reopened and continued. */
export class ChatStore {
  private dir = join(app.getPath('userData'), 'chats')
  private index = new Map<string, ChatSummary>()

  constructor() {
    mkdirSync(this.dir, { recursive: true })
    for (const f of readdirSync(this.dir).filter((x) => x.endsWith('.json'))) {
      try {
        const c = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as SavedChat
        this.index.set(c.id, { id: c.id, title: c.title, at: c.at, count: c.turns.length })
      } catch {
        // A damaged file is skipped, not fatal.
      }
    }
  }

  list(): ChatSummary[] {
    return [...this.index.values()].sort((a, b) => b.at - a.at)
  }

  save(id: string, turns: Turn[], sessions: SavedChat['sessions']) {
    const first = turns.find((t) => t.speaker === 'user')
    if (!first) return
    const title = first.text.replace(/\s+/g, ' ').slice(0, 80)
    const at = turns.at(-1)?.at ?? Date.now()
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify({ id, title, at, turns, sessions } satisfies SavedChat))
    this.index.set(id, { id, title, at, count: turns.length })
  }

  load(id: string): SavedChat {
    const c = JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')) as SavedChat
    // A reply cut off by quitting stays as it was, not stuck "thinking".
    c.turns = c.turns.map((t) => (t.pending ? { ...t, pending: false, text: t.text || '(interrupted)' } : t))
    return c
  }
}
