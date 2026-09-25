import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { parseNote, rank, safeTitle, serializeNote, type Frontmatter } from '../core/notes'
import type { MemoryWrite } from '../core/reply'
import type { AgentTask, Atlas, MemoryChange, NoteSummary } from '../core/types'
import { run } from './shell'

interface LoadedNote extends NoteSummary {
  body: string
  data: Frontmatter
  mtime: number
}

const today = () => new Date().toLocaleDateString('en-CA')

export class Vault {
  private cache = new Map<string, LoadedNote>()

  constructor(public root: string) {}

  /** Create the vault from the bundled template on first run and make it a local git repo for history/undo. */
  async ensure(): Promise<void> {
    if (!existsSync(join(this.root, 'AGENTS.md'))) {
      const template = app.isPackaged ? join(process.resourcesPath, 'vault-template') : join(app.getAppPath(), 'vault-template')
      mkdirSync(this.root, { recursive: true })
      cpSync(template, this.root, { recursive: true, force: false, errorOnExist: false })
    }
    if (!existsSync(join(this.root, '.git'))) {
      await this.git(['init', '-q', '-b', 'main'])
      await this.git(['config', 'user.name', 'Bluevis'])
      await this.git(['config', 'user.email', 'bluevis@localhost'])
      writeFileSync(join(this.root, '.gitignore'), '.obsidian/workspace*.json\n.trash/\n')
    }
    await this.commit('Record edits made outside Bluevis')
  }

  private git(args: string[]) {
    return run('git', args, { cwd: this.root })
  }

  /** Commit everything pending. Returns the new commit hash, or undefined when nothing changed. */
  async commit(message: string): Promise<string | undefined> {
    await this.git(['add', '-A'])
    const r = await this.git(['commit', '-q', '-m', message])
    if (r.code !== 0) return undefined
    return (await this.git(['rev-parse', '--short', 'HEAD'])).stdout.trim()
  }

  load(): LoadedNote[] {
    const out: LoadedNote[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('.')) continue
        const full = join(dir, name)
        const st = statSync(full)
        if (st.isDirectory()) walk(full)
        else if (name.endsWith('.md') && !['AGENTS.md', 'CLAUDE.md'].includes(name)) {
          const rel = relative(this.root, full)
          const hit = this.cache.get(rel)
          if (hit && hit.mtime === st.mtimeMs) {
            out.push(hit)
            continue
          }
          const { data, body } = parseNote(readFileSync(full, 'utf8'))
          const str = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : undefined)
          const note: LoadedNote = {
            path: rel,
            title: str('title') ?? name.replace(/\.md$/, ''),
            area: rel.includes('/') ? rel.split('/')[0] : 'Home',
            status: str('status'),
            updated: str('updated'),
            source: str('source'),
            summary: str('summary') ?? firstParagraph(body),
            tags: Array.isArray(data.tags) ? data.tags : undefined,
            body,
            data,
            mtime: st.mtimeMs
          }
          this.cache.set(rel, note)
          out.push(note)
        }
      }
    }
    if (existsSync(this.root)) walk(this.root)
    return out
  }

  async changes(limit = 40): Promise<MemoryChange[]> {
    const r = await this.git(['log', `-${limit}`, '--name-only', '--format=\x1e%h\x1f%ct\x1f%s'])
    if (r.code !== 0) return []
    return r.stdout
      .split('\x1e')
      .filter(Boolean)
      .map((block) => {
        const [head, ...files] = block.trim().split('\n')
        const [hash, at, subject] = head.split('\x1f')
        return { hash, at: Number(at) * 1000, subject, files: files.filter(Boolean) }
      })
  }

  async atlas(): Promise<Atlas> {
    const notes = this.load().map(({ body: _b, data: _d, mtime: _m, ...summary }) => summary)
    return { vaultPath: this.root, notes, changes: await this.changes() }
  }

  read(rel: string): string {
    return readFileSync(this.safePath(rel), 'utf8')
  }

  private safePath(rel: string): string {
    const full = join(this.root, rel)
    if (relative(this.root, full).startsWith('..')) throw new Error('Path escapes the vault')
    return full
  }

  /**
   * Relevant knowledge for a model turn. Notes marked `share: local-only` are
   * excluded unless the target provider runs locally (PRD §10.9).
   */
  context(query: string, opts: { allowPrivate: boolean; project?: string; maxChars?: number }): string {
    const notes = this.load().filter((n) => opts.allowPrivate || n.data.share !== 'local-only')
    const core = notes.filter((n) => n.area === 'Profile')
    const project = opts.project ? notes.find((n) => n.area === 'Projects' && n.title.toLowerCase() === opts.project!.toLowerCase()) : undefined
    const ranked = rank(query, notes.filter((n) => n.area !== 'Profile' && n !== project), 4)
    const blocks: string[] = []
    const add = (n: LoadedNote, limit: number) => {
      const meta = [n.status && `status: ${n.status}`, n.source && `source: ${n.source}`, n.updated && `updated: ${n.updated}`].filter(Boolean).join('; ')
      blocks.push(`### ${n.path}${meta ? ` (${meta})` : ''}\n${n.body.trim().slice(0, limit)}`)
    }
    for (const n of core) add(n, 900)
    if (project) add(project, 2500)
    for (const n of ranked) add(n, 1200)
    return blocks.join('\n\n').slice(0, opts.maxChars ?? 9000)
  }

  /** Persist a memory the brain proposed or the user asked for. Returns the note path and commit hash. */
  async remember(w: MemoryWrite & { private?: boolean; origin: string }): Promise<{ path: string; hash?: string }> {
    const stamp = `(${today()}, ${w.origin})`
    let rel: string
    if (w.kind === 'preference') {
      rel = 'Profile/Preferences.md'
      this.appendBullet(rel, { title: 'Preferences', status: 'known' }, `${w.text} ${stamp}`)
    } else if (w.kind === 'project' && w.project) {
      rel = `Projects/${safeTitle(w.project)}.md`
      this.appendBullet(rel, { title: w.project, status: 'needs-review' }, `${w.title}: ${w.text} ${stamp}`, '## Log')
    } else {
      const folder = w.kind === 'decision' ? 'Decisions' : w.kind === 'idea' ? 'Ideas' : 'Inbox'
      rel = `${folder}/${safeTitle(w.title)}.md`
      const data: Frontmatter = {
        title: w.title,
        type: w.kind,
        status: w.kind === 'decision' ? 'known' : w.kind === 'idea' ? 'exploratory' : 'needs-review',
        source: w.origin,
        learned: today(),
        updated: today()
      }
      if (w.project) data.project = `[[${w.project}]]`
      if (w.private) data.share = 'local-only'
      const full = this.safePath(rel)
      if (existsSync(full)) {
        this.appendBullet(rel, data, `${w.text} ${stamp}`)
      } else {
        mkdirSync(dirname(full), { recursive: true })
        const hint =
          w.kind === 'idea' ? '\n\n> Exploratory. Not a commitment.' : w.kind === 'fact' ? '\n\n> Captured by Bluevis. Review and move to the right note.' : ''
        writeFileSync(full, serializeNote(data, `# ${w.title}${hint}\n\n${w.text}`))
      }
    }
    const hash = await this.commit(`Remember: ${w.title}`)
    return { path: rel, hash }
  }

  private appendBullet(rel: string, defaults: Frontmatter, line: string, heading?: string) {
    const full = this.safePath(rel)
    let data: Frontmatter = defaults
    let body = `# ${defaults.title}\n`
    if (existsSync(full)) ({ data, body } = parseNote(readFileSync(full, 'utf8')))
    data.updated = today()
    if (heading && !body.includes(heading)) body = `${body.trimEnd()}\n\n${heading}\n`
    if (heading) {
      const i = body.indexOf(heading) + heading.length
      body = `${body.slice(0, i)}\n- ${line}${body.slice(i)}`
    } else body = `${body.trimEnd()}\n- ${line}\n`
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, serializeNote(data, body))
  }

  async writeSession(title: string, markdown: string, project?: string): Promise<{ path: string; hash?: string }> {
    const date = today()
    const rel = `Sessions/${date} ${safeTitle(title)}.md`
    const data: Frontmatter = { title: `${date} ${title}`, type: 'session', status: 'historical', source: 'Bluevis session', updated: date }
    if (project) data.project = `[[${project}]]`
    mkdirSync(join(this.root, 'Sessions'), { recursive: true })
    writeFileSync(this.safePath(rel), serializeNote(data, markdown))
    return { path: rel, hash: await this.commit(`Session: ${title}`) }
  }

  /** Agent runs are outputs: kept with their prompt, observed status and changed files, never treated as evidence of their own claims. */
  async writeAgentRun(t: AgentTask): Promise<void> {
    const date = today()
    const rel = `Outputs/Agent runs/${date} ${safeTitle(`${t.project ?? 'folder'} ${t.title}`).slice(0, 70)}.md`
    const data: Frontmatter = {
      title: t.title,
      type: 'agent-run',
      status: t.status,
      agent: `${t.choice.provider}/${t.choice.model}`,
      source: 'Bluevis agent run (agent self-report plus observed commands)',
      updated: date
    }
    if (t.project) data.project = `[[${t.project}]]`
    const steps = t.steps
      .filter((s) => s.kind === 'command' || s.kind === 'edit')
      .slice(-25)
      .map((s) => `- ${s.status === 'failed' ? '✗' : '✓'} ${s.kind === 'edit' ? 'edited' : 'ran'} \`${s.label.slice(0, 140)}\``)
    const body = [
      `# ${t.title}`,
      `> Status observed by Bluevis: **${t.status}**. The summary below is the agent's own report.`,
      `## Request\n${t.prompt.split('<handoff')[0].trim()}`,
      t.finalMessage && `## Agent report\n${t.finalMessage}`,
      t.filesChanged.length && `## Files changed\n${t.filesChanged.map((f) => `- \`${f}\``).join('\n')}`,
      t.diffStat && `## Diff stat\n\`\`\`\n${t.diffStat}\n\`\`\``,
      steps.length && `## Observed steps\n${steps.join('\n')}`,
      t.error && `## Error\n${t.error}`
    ]
      .filter(Boolean)
      .join('\n\n')
    const full = this.safePath(rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, serializeNote(data, body))
    await this.commit(`Agent run: ${t.title.slice(0, 60)}`)
  }

  latestSession(project?: string): { path: string; body: string } | undefined {
    const sessions = this.load()
      .filter((n) => n.area === 'Sessions' && (!project || String(n.data.project ?? '').toLowerCase().includes(project.toLowerCase())))
      .sort((a, b) => b.path.localeCompare(a.path))
    return sessions[0] && { path: sessions[0].path, body: sessions[0].body }
  }

  async undo(hash: string): Promise<boolean> {
    const r = await this.git(['revert', '--no-edit', hash])
    return r.code === 0
  }
}

function firstParagraph(body: string): string | undefined {
  const p = body
    .replace(/^#.*$/gm, '')
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('>') && !s.startsWith('|'))
  return p
    ?.replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, '')
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 220)
}
