import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseReply, type MemoryWrite } from '../core/reply'
import { matchProject, route, type Intent } from '../core/router'
import type { AgentTask, ModelChoice, Project, Settings, Turn, TurnAction } from '../core/types'
import { PERSONA, RESUME_PROMPT, SESSION_PROMPT } from './persona'
import { discoverProjects } from './projects'
import { runProvider, localModels, type RunHandle } from './providers'
import { getSettings, updateSettings } from './settings'
import { run } from './shell'
import type { TaskManager } from './tasks'
import type { Vault } from './vault'

export interface BrainEvents {
  turn: (t: Turn) => void
  reset: () => void
  busy: (busy: boolean) => void
  speak: (turnId: string, text: string) => void
  stopSpeech: () => void
  context: (c: { activeProject?: string; brain: ModelChoice }) => void
  settings: (s: Settings) => void
}

const BRAIN_DEFAULTS: Record<ModelChoice['provider'], ModelChoice> = {
  codex: { provider: 'codex', model: 'gpt-6-luna', effort: 'low' },
  claude: { provider: 'claude', model: 'haiku' },
  local: { provider: 'local', model: '' }
}

/** Owns the conversation: routes intents, builds scoped context, runs the brain, and applies its directives. */
export class Brain {
  turns: Turn[] = []
  private sessions: Partial<Record<ModelChoice['provider'], string>> = {}
  private current: RunHandle | null = null
  private activeProject?: Project
  private workspace = join(app.getPath('userData'), 'workspace')

  constructor(
    private vault: Vault,
    private tasks: TaskManager,
    private ev: BrainEvents
  ) {
    mkdirSync(this.workspace, { recursive: true })
  }

  private push(t: Omit<Turn, 'id' | 'at'> & Partial<Pick<Turn, 'id' | 'at'>>): Turn {
    const turn: Turn = { id: randomUUID(), at: Date.now(), ...t }
    this.turns.push(turn)
    this.ev.turn(turn)
    return turn
  }

  private update(turn: Turn) {
    this.ev.turn({ ...turn })
  }

  private say(text: string, extra: Partial<Turn> = {}, speak = true): Turn {
    const turn = this.push({ speaker: 'bluevis', text, ...extra })
    if (speak) this.ev.speak(turn.id, extra.spoken ?? text)
    return turn
  }

  private async projects(): Promise<Project[]> {
    return discoverProjects(getSettings().projectRoots, false, this.vault.projectLinks())
  }

  context() {
    return { activeProject: this.activeProject?.name, brain: getSettings().brain }
  }

  private setProject(p?: Project) {
    this.activeProject = p
    this.ev.context(this.context())
  }

  async setActiveProject(name?: string) {
    const p = name ? (await this.projects()).find((x) => x.name === name) : undefined
    this.setProject(p)
  }

  async handle(text: string, opts: { via: 'voice' | 'text'; screenshot?: string }): Promise<void> {
    const projects = await this.projects()
    const names = projects.map((p) => p.name)
    const intent = route(text, names)
    if (intent.type === 'stop-speech') {
      this.ev.stopSpeech()
      return
    }
    this.push({ speaker: 'user', text, via: opts.via, attachments: opts.screenshot ? [opts.screenshot] : undefined })
    // A message that names a project makes it the active context.
    const mentioned = projects.find((p) => new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
    if (mentioned && mentioned.name !== this.activeProject?.name) this.setProject(mentioned)
    try {
      await this.dispatch(intent, projects, opts)
    } catch (e) {
      this.say(`That failed: ${(e as Error).message}`, { error: true }, false)
    }
  }

  private async dispatch(intent: Intent, projects: Project[], opts: { via: 'voice' | 'text'; screenshot?: string }) {
    switch (intent.type) {
      case 'chat':
        return this.chat(intent.text, opts.screenshot)
      case 'delegate':
        return this.delegate({ kind: 'delegate', agent: intent.agent, model: intent.model, project: intent.project, prompt: intent.prompt, state: 'proposed' }, projects, true)
      case 'open':
        return this.open(projects.find((p) => p.name === intent.target)!)
      case 'resume':
        return this.resume(intent.project ? projects.find((p) => p.name === matchProject(intent.project!, projects.map((x) => x.name))) : this.activeProject)
      case 'end-session':
        return this.endSession(intent.project)
      case 'remember': {
        const pref = /^(i (prefer|like|love|hate|don'?t like|want|always|never|use))\b|^(always|never)\b/i.test(intent.text)
        const kind: MemoryWrite['kind'] = intent.kind === 'idea' ? 'idea' : pref ? 'preference' : 'fact'
        const title = intent.text.split(/[.,;:]/)[0].slice(0, 60)
        return this.remember({ kind, title, text: intent.text, project: this.activeProject?.name }, 'Anuj, explicitly', intent.private)
      }
      case 'status':
        return this.status()
      case 'stop-task': {
        const running = this.tasks.active().filter((t) => !intent.agent || t.choice.provider === intent.agent)
        if (!running.length) return this.say('Nothing is running.')
        running.forEach((t) => this.tasks.stop(t.id))
        return this.say(
          `Stopped ${running.map((t) => `${label(t.choice)}${t.project ? ` on ${t.project}` : ''}`).join(' and ')}. Any edits already made are still in the working tree.`
        )
      }
      case 'switch-brain': {
        let choice = BRAIN_DEFAULTS[intent.provider]
        if (intent.provider === 'local') {
          const models = await localModels(getSettings().localBaseUrl)
          if (!models.length) return this.say(`The local model server isn't answering at ${getSettings().localBaseUrl}. Staying on ${label(getSettings().brain)}.`)
          choice = { provider: 'local', model: models[0] }
        }
        this.ev.settings(updateSettings({ brain: choice }))
        this.ev.context(this.context())
        return this.say(`Switched to ${label(choice)} for conversation.`)
      }
      case 'new-conversation':
        this.reset()
        return
    }
  }

  reset() {
    this.stop()
    this.turns = []
    this.sessions = {}
    this.ev.reset()
  }

  stop() {
    this.current?.stop()
    this.current = null
  }

  /** Run one brain turn and resolve with the final text (or throw). */
  private runBrain(prompt: string, o: { images?: string[]; fresh?: boolean; onDelta?: (text: string) => void } = {}): Promise<string> {
    const s = getSettings()
    const choice = s.brain
    const cwd = this.activeProject?.path ?? this.workspace
    const history = this.turns
      .filter((t) => (t.speaker === 'user' || t.speaker === 'bluevis') && !t.pending && !t.error)
      .slice(-12, -1)
      .map((t) => ({ role: t.speaker === 'user' ? ('user' as const) : ('assistant' as const), content: t.text }))
    return new Promise((resolve, reject) => {
      let text = ''
      let streamed = ''
      let failed: string | null = null
      const handle = runProvider({
        choice,
        prompt,
        cwd,
        role: 'brain',
        system: PERSONA,
        images: o.images,
        sessionId: o.fresh ? undefined : this.sessions[choice.provider],
        history: choice.provider === 'local' && !o.fresh ? history : undefined,
        localBaseUrl: s.localBaseUrl,
        onEvent: (e) => {
          if (e.kind === 'session' && !o.fresh) this.sessions[choice.provider] = e.id
          if (e.kind === 'text-delta') {
            streamed += e.text
            o.onDelta?.(streamed)
          }
          if (e.kind === 'message') text = text ? `${text}\n\n${e.text}` : e.text
          if (e.kind === 'error') failed = e.message
        }
      })
      this.current = handle
      void handle.done.then(() => {
        if (this.current === handle) this.current = null
        if (failed) reject(new Error(failed))
        else resolve(text || streamed)
      })
    })
  }

  private async chat(text: string, screenshot?: string) {
    const s = getSettings()
    const choice = s.brain
    const allowPrivate = choice.provider === 'local'
    const knowledge = this.vault.context(text, { allowPrivate, project: this.activeProject?.name })
    const projects = await this.projects()
    const running = this.tasks.active()
    const env = [
      `Now: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })} (America/New_York)`,
      this.activeProject
        ? `Active project: ${this.activeProject.name} at ${this.activeProject.path} (branch ${this.activeProject.branch ?? '?'}, ${this.activeProject.dirty ?? 0} uncommitted files). You may read its files.`
        : 'No active project.',
      `Known projects: ${projects.map((p) => p.name).join(', ') || 'none found'}`,
      running.length ? `Running agents: ${running.map((t) => `${label(t.choice)} on ${t.project ?? t.cwd}: ${t.status}`).join('; ')}` : 'No agents running.',
      screenshot ? 'A screenshot of Anuj’s screen, captured just now at Anuj’s request, is attached.' : ''
    ]
      .filter(Boolean)
      .join('\n')
    const prompt = `<situation>\n${env}\n</situation>\n\n<knowledge>\n${knowledge || '(nothing relevant in the vault)'}\n</knowledge>\n\nAnuj${screenshot ? ' (looking at the screen)' : ''}: ${text}`

    const turn = this.push({ speaker: 'bluevis', text: '', pending: true, model: label(choice) })
    this.ev.busy(true)
    try {
      const raw = await this.runBrain(prompt, {
        images: screenshot ? [screenshot] : undefined,
        onDelta: (partial) => {
          turn.text = parseReply(partial).shown
          this.update(turn)
        }
      })
      const reply = parseReply(raw)
      turn.text = reply.shown || '(no reply)'
      turn.spoken = reply.spoken
      turn.pending = false
      this.update(turn)
      if (reply.spoken) this.ev.speak(turn.id, reply.spoken)
      for (const a of reply.actions) this.push({ speaker: 'system', text: '', action: { kind: 'delegate', agent: a.agent, project: a.project, prompt: a.prompt, state: 'proposed' } })
      for (const m of reply.memories) await this.remember(m, 'inferred from conversation', false, true)
    } catch (e) {
      turn.pending = false
      turn.error = true
      turn.text = friendlyError((e as Error).message, choice)
      this.update(turn)
    } finally {
      this.ev.busy(false)
    }
  }

  async remember(m: MemoryWrite, origin: string, isPrivate: boolean, quiet = false) {
    const res = await this.vault.remember({ ...m, origin, private: isPrivate })
    this.push({
      speaker: 'system',
      text: '',
      memory: { path: res.path, title: m.title, hash: res.hash },
      evidence: origin.startsWith('inferred') ? 'inferred' : 'observed'
    })
    if (!quiet) this.say(m.kind === 'idea' ? 'Saved as an idea, not a commitment.' : isPrivate ? 'Noted, and kept out of cloud handoffs.' : 'Noted.')
  }

  async undoMemory(turnId: string) {
    const t = this.turns.find((x) => x.id === turnId)
    if (!t?.memory?.hash || t.memory.undone) return
    if (await this.vault.undo(t.memory.hash)) {
      t.memory.undone = true
      this.update(t)
    }
  }

  /** Start (or ask about) a delegated agent task. */
  async delegate(action: TurnAction, projects?: Project[], explicit = false, turnId?: string) {
    projects ??= await this.projects()
    const project = action.project ? projects.find((p) => p.name === matchProject(action.project!, projects!.map((x) => x.name))) : this.activeProject
    if (!project) {
      this.push({ speaker: 'system', text: '', action: { ...action, state: 'proposed', choices: projects.slice(0, 6).map((p) => p.name) } })
      this.say('Which project should it work in?')
      return
    }
    const s = getSettings()
    const choice: ModelChoice =
      action.agent === 'claude'
        ? { provider: 'claude', model: action.model ?? 'opus' }
        : { provider: 'codex', model: action.model ?? (s.worker.provider === 'codex' ? s.worker.model : 'gpt-6-sol'), effort: s.worker.effort ?? 'medium' }
    const brief = this.handoffBrief(project, action.prompt, choice)
    const title = action.prompt.charAt(0).toUpperCase() + action.prompt.slice(1, 90)
    const task = this.tasks.start({ title, prompt: brief, choice, cwd: project.path, project: project.name })
    if (turnId) {
      const t = this.turns.find((x) => x.id === turnId)
      if (t?.action) {
        t.action = { ...t.action, state: 'started', project: project.name }
        t.taskId = task.id
        this.update(t)
      }
    }
    this.setProject(project)
    const who = label(choice)
    this.say(explicit ? `${who} is on it in ${project.name}.` : `Started ${who} in ${project.name}.`, { taskId: task.id })
  }

  /** A scoped context brief for the agent: objective, project knowledge, constraints. Never local-only notes. */
  private handoffBrief(project: Project, objective: string, choice: ModelChoice): string {
    const knowledge = this.vault.context(`${project.name} ${objective}`, { allowPrivate: choice.provider === 'local', project: project.name, maxChars: 5000 })
    return `${objective}

<handoff from="Bluevis">
Project: ${project.name} (${project.path}, branch ${project.branch ?? 'unknown'})
Relevant knowledge (status "needs-review" means unconfirmed background):
${knowledge || '(none)'}

Constraints:
- Stay inside this repository. Do not push, publish, or change git history.
- Prefer small, verifiable changes. Run the relevant tests or build if they exist and report the actual result.
- End with a short summary: what you changed, what you verified (with the command and outcome), and what remains uncertain.
</handoff>`
  }

  onTaskFinished(t: AgentTask) {
    const outcome: Record<string, string> = {
      'completed-verified': 'finished, and a check passed after its last edit',
      'completed-unverified': 'finished, but I saw no passing check after its edits',
      failed: 'failed',
      stopped: 'was stopped'
    }
    const what = outcome[t.status] ?? t.status
    const files = t.filesChanged.length ? ` It changed ${t.filesChanged.length} file${t.filesChanged.length > 1 ? 's' : ''}.` : ''
    this.say(`${label(t.choice)} ${what}${t.project ? ` on ${t.project}` : ''}.${files}`, { taskId: t.id, evidence: t.status === 'completed-verified' ? 'observed' : 'reported' })
    void this.vault.writeAgentRun(t)
  }

  private async open(p: Project) {
    const editor = getSettings().editor
    const r = await run('open', ['-a', editor, p.path])
    if (r.code !== 0) await run('open', [p.path])
    this.setProject(p)
    this.say(r.code === 0 ? `Opened ${p.name} in ${editor}.` : `Opened ${p.name} in Finder. ${editor} wasn't available.`)
  }

  private async status() {
    const all = this.tasks.list().slice(0, 6)
    if (!all.length) return this.say('No agents have run this session.')
    const running = all.filter((t) => ['starting', 'investigating', 'editing', 'testing'].includes(t.status))
    const lines = all.map((t) => {
      const last = t.steps.at(-1)
      const age = Math.round((Date.now() - t.lastEventAt) / 1000)
      return `- **${label(t.choice)}** on ${t.project ?? t.cwd}: ${t.status.replace(/-/g, ' ')}${last ? `, last seen \`${last.label.slice(0, 80)}\` ${age}s ago` : ''}`
    })
    const spoken = running.length
      ? `${running.length} agent${running.length > 1 ? 's are' : ' is'} running. ${running.map((t) => `${label(t.choice)} is ${t.status} on ${t.project ?? 'a folder'}`).join('. ')}.`
      : 'Nothing is running right now.'
    this.say(`${spoken}\n\n${lines.join('\n')}`, { spoken, evidence: 'observed' })
  }

  private async resume(project?: Project) {
    if (!project) {
      const projects = await this.projects()
      return this.say(`Which project? Recent ones: ${projects.slice(0, 4).map((p) => p.name).join(', ')}.`)
    }
    this.setProject(project)
    const [log, status] = await Promise.all([
      run('git', ['log', '-8', '--format=%h %ad %s', '--date=relative'], { cwd: project.path }),
      run('git', ['status', '--short'], { cwd: project.path })
    ])
    const session = this.vault.latestSession(project.name)
    const note = this.vault.context(project.name, { allowPrivate: getSettings().brain.provider === 'local', project: project.name, maxChars: 4000 })
    const agentRuns = this.tasks.list().filter((t) => t.project === project.name).slice(0, 3)
    const evidence = `<evidence>
Project: ${project.name} at ${project.path}, branch ${project.branch ?? '?'}
Recent commits (observed):
${log.stdout.trim() || '(none)'}
Uncommitted changes (observed):
${status.stdout.trim() || '(clean)'}
Last session note (${session?.path ?? 'none'}):
${session?.body.slice(0, 2500) ?? '(no previous session recorded)'}
Agent runs this session: ${agentRuns.map((t) => `${label(t.choice)}: ${t.status}, ${t.finalMessage?.slice(0, 300) ?? ''}`).join(' | ') || 'none'}
Knowledge:
${note}
</evidence>`
    await this.chatWith(`${RESUME_PROMPT}\n\n${evidence}`, `Resuming ${project.name}`)
  }

  /** Run a one-off skill prompt through the brain and present it as a normal reply. */
  private async chatWith(prompt: string, labelText: string) {
    const turn = this.push({ speaker: 'bluevis', text: '', pending: true, model: label(getSettings().brain) })
    this.ev.busy(true)
    try {
      const raw = await this.runBrain(prompt, { fresh: true })
      const reply = parseReply(raw)
      turn.text = reply.shown
      turn.spoken = reply.spoken
      turn.pending = false
      this.update(turn)
      this.ev.speak(turn.id, reply.spoken)
    } catch (e) {
      turn.pending = false
      turn.error = true
      turn.text = `${labelText} failed. ${friendlyError((e as Error).message, getSettings().brain)}`
      this.update(turn)
    } finally {
      this.ev.busy(false)
    }
  }

  private async endSession(projectName?: string) {
    const projects = await this.projects()
    const match = projectName ? matchProject(projectName, projects.map((p) => p.name)) : undefined
    const project = match ? projects.find((p) => p.name === match) : this.activeProject
    const convo = this.turns.filter((t) => (t.speaker === 'user' || t.speaker === 'bluevis') && t.text && !t.error)
    const runs = this.tasks.list()
    if (convo.length < 3 && !runs.length) return this.say('Nothing worth recording this session. See you later.')
    const transcript = convo.map((t) => `${t.speaker === 'user' ? 'Anuj' : 'Bluevis'}: ${t.text.slice(0, 1200)}`).join('\n')
    const agentLog = runs
      .map((t) => `- ${label(t.choice)} on ${t.project ?? t.cwd}: ${t.status}; files: ${t.filesChanged.join(', ') || 'none'}; said: ${t.finalMessage?.slice(0, 400) ?? '(nothing)'}`)
      .join('\n')
    const pending = this.push({ speaker: 'bluevis', text: 'Writing up the session…', pending: true })
    this.ev.busy(true)
    try {
      const md = await this.runBrain(`${SESSION_PROMPT}\n\n<transcript>\n${transcript}\n</transcript>\n\n<agent-runs>\n${agentLog || 'none'}\n</agent-runs>`, { fresh: true })
      const title = project?.name ?? 'Session'
      const res = await this.vault.writeSession(title, parseReply(md).shown, project?.name)
      pending.pending = false
      const still = this.tasks.active()
      const tail = still.length ? ` ${still.length} agent${still.length > 1 ? 's are' : ' is'} still running and will keep going unless you stop ${still.length > 1 ? 'them' : 'it'}.` : ''
      pending.text = `Session saved to ${res.path}.${tail}`
      pending.memory = { path: res.path, title: `Session: ${title}`, hash: res.hash }
      this.update(pending)
      this.ev.speak(pending.id, `Session saved.${tail}`)
    } catch (e) {
      pending.pending = false
      pending.error = true
      pending.text = `Couldn't write the session summary: ${(e as Error).message}`
      this.update(pending)
    } finally {
      this.ev.busy(false)
    }
  }

  dismissAction(turnId: string) {
    const t = this.turns.find((x) => x.id === turnId)
    if (t?.action) {
      t.action.state = 'dismissed'
      this.update(t)
    }
  }

  async approveAction(turnId: string, project?: string, prompt?: string) {
    const t = this.turns.find((x) => x.id === turnId)
    if (!t?.action || t.action.state !== 'proposed') return
    await this.delegate({ ...t.action, project: project ?? t.action.project, prompt: prompt ?? t.action.prompt }, undefined, false, turnId)
  }
}

export function label(c: ModelChoice): string {
  if (c.provider === 'codex') return c.model.replace(/^gpt-/, 'GPT-').replace(/-(\w)/g, (_, x: string) => `-${x.toUpperCase()}`)
  if (c.provider === 'claude') return `Claude ${c.model[0].toUpperCase()}${c.model.slice(1)}`
  return c.model ? c.model.split('/').pop()!.slice(0, 24) : 'Local model'
}

function friendlyError(message: string, choice: ModelChoice): string {
  if (/not found|ENOENT|Could not start/i.test(message)) return `I couldn't start ${choice.provider}. Is its CLI installed and signed in?`
  if (/rate|limit|quota/i.test(message)) return `${label(choice)} is rate limited right now. Try again shortly, or say "switch to Claude".`
  if (/Stopped/.test(message)) return 'Stopped.'
  return message
}
