import { app, powerSaveBlocker } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isActive } from '../core/taskState'
import { queueDue, type QueuedTask } from '../core/queue'
import type { ModelChoice } from '../core/types'
import { getSettings } from './settings'
import type { TaskManager } from './tasks'

interface State {
  items: QueuedTask[]
  runAt: string
  lastRunDay: string | null
}

/** Agent briefs saved for later. At the run time (Mac awake), projects run in parallel and each project's tasks one after another. */
export class QueueManager {
  private file = join(app.getPath('userData'), 'queue.json')
  private state: State = { items: [], runAt: '01:30', lastRunDay: null }
  private running = false

  constructor(
    private tasks: TaskManager,
    private emit: (s: State) => void
  ) {
    try {
      this.state = { ...this.state, ...JSON.parse(readFileSync(this.file, 'utf8')) }
    } catch {
      // Empty queue.
    }
    setInterval(() => {
      if (!this.running && this.state.items.some((i) => !i.taskId) && queueDue(this.state.runAt, this.state.lastRunDay, new Date())) void this.run()
    }, 60_000)
  }

  get(): State {
    return structuredClone(this.state)
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.state, null, 1))
    this.emit(this.get())
  }

  add(t: Omit<QueuedTask, 'id' | 'addedAt'>) {
    this.state.items.push({ ...t, id: randomUUID(), addedAt: Date.now() })
    this.save()
    return this.get()
  }

  remove(id: string) {
    this.state.items = this.state.items.filter((i) => i.id !== id)
    this.save()
    return this.get()
  }

  setRunAt(runAt: string) {
    if (/^\d{2}:\d{2}$/.test(runAt)) this.state.runAt = runAt
    this.save()
    return this.get()
  }

  /** Start everything queued now. Keeps the Mac from idle-sleeping until the last task ends. */
  async run() {
    if (this.running) return
    const pending = this.state.items.filter((i) => !i.taskId)
    if (!pending.length) return
    this.running = true
    this.state.lastRunDay = new Date().toDateString()
    this.save()
    const blocker = powerSaveBlocker.start('prevent-app-suspension')
    const byProject = new Map<string, QueuedTask[]>()
    for (const i of pending) byProject.set(i.projectPath, [...(byProject.get(i.projectPath) ?? []), i])
    try {
      await Promise.all([...byProject.values()].map((list) => this.runSequence(list)))
    } finally {
      powerSaveBlocker.stop(blocker)
      this.running = false
      // Started items leave the queue; their results live under Work and in the morning brief.
      this.state.items = this.state.items.filter((i) => !i.taskId)
      this.save()
    }
  }

  private async runSequence(list: QueuedTask[]) {
    const s = getSettings()
    for (const item of list) {
      const choice: ModelChoice =
        item.agent === 'claude' ? { provider: 'claude', model: 'opus' } : { provider: 'codex', model: s.worker.provider === 'codex' ? s.worker.model : 'gpt-6-sol', effort: s.worker.effort ?? 'medium' }
      const task = this.tasks.start({ title: item.prompt.slice(0, 90), prompt: item.prompt, choice, cwd: item.projectPath, project: item.project })
      item.taskId = task.id
      this.save()
      while (true) {
        await new Promise((r) => setTimeout(r, 5000))
        const t = this.tasks.get(task.id)
        if (!t || !isActive(t)) break
      }
    }
  }
}
