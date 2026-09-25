import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  batchPrompt,
  batchThreads,
  EXTRACT_INSTRUCTIONS,
  parseChatGPTExport,
  parseProposals,
  PROPOSAL_SCHEMA,
  threadSource,
  type Proposal
} from '../core/importer'
import type { ModelChoice } from '../core/types'
import { runProvider } from './providers'
import { getSettings } from './settings'
import { run } from './shell'
import type { Vault } from './vault'

export interface ImportState {
  state: 'idle' | 'running' | 'done' | 'failed' | 'stopped'
  label: string
  batchesDone: number
  batchesTotal: number
  threads: number
  skipped: number
  error?: string
}

interface Ledger {
  processed: string[]
  accepted: string[]
  rejected: string[]
}

/**
 * Extracts knowledge proposals from ChatGPT exports and free-form dumps.
 * Proposals wait for review; the ledger (committed in the vault) makes
 * re-imports idempotent and keeps rejected items from coming back.
 */
export class Importer {
  state: ImportState = { state: 'idle', label: '', batchesDone: 0, batchesTotal: 0, threads: 0, skipped: 0 }
  private proposals: Proposal[] = []
  private stopRequested = false
  private stopCurrent: (() => void) | null = null
  private file = join(app.getPath('userData'), 'proposals.json')

  constructor(
    private vault: Vault,
    private onState: (s: ImportState) => void,
    private onProposals: (p: Proposal[]) => void
  ) {
    try {
      if (existsSync(this.file)) this.proposals = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      this.proposals = []
    }
  }

  private get ledgerPath() {
    return join(this.vault.root, '.bluevis', 'imports.json')
  }

  private ledger(): Ledger {
    try {
      return { processed: [], accepted: [], rejected: [], ...JSON.parse(readFileSync(this.ledgerPath, 'utf8')) }
    } catch {
      return { processed: [], accepted: [], rejected: [] }
    }
  }

  private saveLedger(l: Ledger) {
    mkdirSync(join(this.vault.root, '.bluevis'), { recursive: true })
    writeFileSync(this.ledgerPath, JSON.stringify(l, null, 1))
  }

  list(): Proposal[] {
    return this.proposals
  }

  private set(patch: Partial<ImportState>) {
    this.state = { ...this.state, ...patch }
    this.onState({ ...this.state })
  }

  private saveProposals() {
    writeFileSync(this.file, JSON.stringify(this.proposals))
    this.onProposals(this.proposals)
  }

  private choice(): ModelChoice {
    const s = getSettings()
    // Personal history stays local if the conversation brain is local; otherwise use the agent model at low effort.
    if (s.brain.provider === 'local') return s.brain
    return { ...s.worker, effort: 'low' }
  }

  private extract(prompt: string): Promise<string> {
    const choice = this.choice()
    return new Promise((resolve, reject) => {
      let text = ''
      let err: string | null = null
      const h = runProvider({
        choice,
        prompt: `${EXTRACT_INSTRUCTIONS}\n\nRespond with JSON only: {"items":[...]}.\n\n<conversations>\n${prompt}\n</conversations>`,
        cwd: join(app.getPath('userData'), 'workspace'),
        role: 'brain',
        schema: choice.provider === 'codex' ? PROPOSAL_SCHEMA : undefined,
        localBaseUrl: getSettings().localBaseUrl,
        onEvent: (e) => {
          if (e.kind === 'message') text = e.text
          if (e.kind === 'text-delta' && choice.provider !== 'codex') text += e.text
          if (e.kind === 'error') err = e.message
        }
      })
      this.stopCurrent = h.stop
      void h.done.then(() => (err ? reject(new Error(err)) : resolve(text)))
    })
  }

  private addProposals(found: Proposal[]) {
    const l = this.ledger()
    const known = new Set([...l.accepted, ...l.rejected, ...this.proposals.map((p) => p.key)])
    const fresh = found.filter((p) => !known.has(p.key))
    this.proposals.push(...fresh)
    this.saveProposals()
    return fresh.length
  }

  stop() {
    this.stopRequested = true
    this.stopCurrent?.()
  }

  /** Import a ChatGPT export (.zip or conversations.json). */
  async importChatGPT(path: string): Promise<void> {
    if (this.state.state === 'running') return
    let raw: string
    if (path.endsWith('.zip')) {
      const r = await run('unzip', ['-p', path, 'conversations.json'], { timeout: 120000 })
      if (r.code !== 0 || !r.stdout) return this.set({ state: 'failed', label: 'ChatGPT export', error: 'No conversations.json found in that zip.' })
      raw = r.stdout
    } else raw = readFileSync(path, 'utf8')
    let threads
    try {
      threads = parseChatGPTExport(JSON.parse(raw))
    } catch (e) {
      return this.set({ state: 'failed', label: 'ChatGPT export', error: (e as Error).message })
    }
    const ledger = this.ledger()
    const done = new Set(ledger.processed)
    const todo = threads.filter((t) => !done.has(`chatgpt:${t.id}`))
    const batches = batchThreads(todo)
    this.stopRequested = false
    this.set({ state: 'running', label: 'ChatGPT export', batchesDone: 0, batchesTotal: batches.length, threads: todo.length, skipped: threads.length - todo.length, error: undefined })
    for (const [i, batch] of batches.entries()) {
      if (this.stopRequested) return this.set({ state: 'stopped' })
      try {
        const reply = await this.extract(batchPrompt(batch))
        this.addProposals(parseProposals(reply, batch.map(threadSource)))
        // Only mark threads processed once their batch succeeded, so a failure can be retried.
        const l = this.ledger()
        l.processed.push(...batch.map((t) => `chatgpt:${t.id}`))
        this.saveLedger(l)
        this.set({ batchesDone: i + 1 })
      } catch (e) {
        if (this.stopRequested) return this.set({ state: 'stopped' })
        await this.vault.commit('Import progress')
        return this.set({ state: 'failed', error: `Batch ${i + 1} of ${batches.length} failed: ${(e as Error).message}. Run the import again to continue where it stopped.` })
      }
    }
    await this.vault.commit(`Imported ${todo.length} ChatGPT conversations for review`)
    this.set({ state: 'done' })
  }

  /** Turn a free-form description of Anuj's life and work into proposals. */
  async importText(text: string): Promise<void> {
    if (this.state.state === 'running' || !text.trim()) return
    const date = new Date().toLocaleDateString('en-CA')
    const source: Proposal['source'] = { kind: 'dump', title: 'In your own words', date, id: `dump-${Date.now()}` }
    this.stopRequested = false
    this.set({ state: 'running', label: 'In your own words', batchesDone: 0, batchesTotal: 1, threads: 1, skipped: 0, error: undefined })
    try {
      const reply = await this.extract(`### [0] In Anuj's own words (${date})\nUSER: ${text.trim()}`)
      this.addProposals(parseProposals(reply, [source]))
      this.set({ state: 'done', batchesDone: 1 })
    } catch (e) {
      this.set({ state: this.stopRequested ? 'stopped' : 'failed', error: (e as Error).message })
    }
  }

  async accept(key: string, edited?: { title?: string; text?: string }): Promise<void> {
    const p = this.proposals.find((x) => x.key === key)
    if (!p) return
    const origin = p.source.kind === 'chatgpt' ? `from ChatGPT “${p.source.title}” (${p.source.date})` : `in your own words (${p.source.date})`
    await this.vault.remember({
      kind: p.kind,
      title: edited?.title ?? p.title,
      text: edited?.text ?? p.text,
      project: p.project,
      origin: `${origin}, ${p.origin === 'user-stated' ? 'you said it' : p.origin.replace('-', ' ')}, confirmed by you`,
      status: p.kind === 'idea' ? 'exploratory' : 'known'
    })
    const l = this.ledger()
    l.accepted.push(key)
    this.saveLedger(l)
    await this.vault.commit('Import ledger')
    this.proposals = this.proposals.filter((x) => x.key !== key)
    this.saveProposals()
  }

  async reject(key: string): Promise<void> {
    const l = this.ledger()
    l.rejected.push(key)
    this.saveLedger(l)
    await this.vault.commit('Import ledger')
    this.proposals = this.proposals.filter((x) => x.key !== key)
    this.saveProposals()
  }
}
