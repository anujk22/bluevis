import type { AgentEvent, AgentTask, TaskStep } from './types'

const VERIFY_PATTERN =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|check|build|lint|typecheck)\b|\bnode\s+--test\b|\b(vitest|jest|pytest|mocha|tsc|cargo\s+(test|build|check)|go\s+(test|build|vet)|swift\s+(test|build)|xcodebuild|make\s+(test|check)|ruff|mypy|eslint)\b/

export function isVerificationCommand(command: string): boolean {
  return VERIFY_PATTERN.test(command)
}

// Ordering uses a per-task event counter, not wall time, so same-millisecond events stay ordered.
interface Internal {
  tick: number
  lastEditAt: number
  lastPassingCheckAt: number
  lastFailingCheckAt: number
}

const internals = new WeakMap<AgentTask, Internal>()

function meta(task: AgentTask): Internal {
  let m = internals.get(task)
  if (!m) {
    m = { tick: 0, lastEditAt: 0, lastPassingCheckAt: 0, lastFailingCheckAt: 0 }
    internals.set(task, m)
  }
  return m
}

function upsertStep(task: AgentTask, step: TaskStep) {
  const i = task.steps.findIndex((s) => s.id === step.id)
  if (i >= 0) task.steps[i] = { ...task.steps[i], ...step, label: step.label || task.steps[i].label }
  else task.steps.push(step)
}

/**
 * Fold a normalized provider event into task state. Mutates and returns the task.
 * Status only ever reflects what was observed in the event stream.
 */
export function applyTaskEvent(task: AgentTask, ev: AgentEvent, now = Date.now()): AgentTask {
  const m = meta(task)
  task.lastEventAt = now
  switch (ev.kind) {
    case 'session':
      task.sessionId = ev.id
      break
    case 'command': {
      const verify = isVerificationCommand(ev.command)
      upsertStep(task, {
        id: ev.id,
        at: now,
        kind: 'command',
        label: ev.command,
        status: ev.status,
        detail: ev.status === 'running' ? undefined : tail(ev.output)
      })
      if (ev.status === 'running') task.status = verify ? 'testing' : task.status === 'editing' ? 'editing' : 'investigating'
      if (verify && ev.status === 'done') m.lastPassingCheckAt = ++m.tick
      if (verify && ev.status === 'failed') m.lastFailingCheckAt = ++m.tick
      break
    }
    case 'file-change':
      for (const c of ev.changes) if (!task.filesChanged.includes(c.path)) task.filesChanged.push(c.path)
      upsertStep(task, {
        id: ev.id,
        at: now,
        kind: 'edit',
        label: ev.changes.map((c) => c.path.split('/').pop()).join(', '),
        status: 'done'
      })
      m.lastEditAt = ++m.tick
      task.status = 'editing'
      break
    case 'tool':
      if (ev.name) {
        upsertStep(task, { id: ev.id, at: now, kind: 'tool', label: ev.detail ? `${ev.name} · ${ev.detail}` : ev.name, status: ev.status })
        if (task.status === 'starting') task.status = 'investigating'
      } else {
        const s = task.steps.find((x) => x.id === ev.id)
        if (s) s.status = ev.status
      }
      break
    case 'plan':
      task.plan = ev.items
      break
    case 'message':
      task.finalMessage = ev.text
      break
    case 'error':
      task.error = ev.message
      task.status = 'failed'
      task.endedAt = now
      break
    case 'done':
      if (task.status !== 'failed') task.status = verdict(m)
      task.endedAt = now
      for (const s of task.steps) if (s.status === 'running') s.status = 'done'
      break
  }
  return task
}

function verdict(m: Internal): AgentTask['status'] {
  const checkedAfterEdit = m.lastPassingCheckAt > 0 && m.lastPassingCheckAt > m.lastEditAt && m.lastPassingCheckAt > m.lastFailingCheckAt
  return checkedAfterEdit ? 'completed-verified' : 'completed-unverified'
}

function tail(output?: string, lines = 6): string | undefined {
  if (!output) return undefined
  const all = output.trimEnd().split('\n')
  return all.slice(-lines).join('\n')
}

export function newTask(init: Pick<AgentTask, 'id' | 'title' | 'prompt' | 'choice' | 'cwd' | 'project'>, now = Date.now()): AgentTask {
  return { ...init, status: 'starting', steps: [], filesChanged: [], startedAt: now, lastEventAt: now }
}

export function isActive(task: AgentTask): boolean {
  return ['starting', 'investigating', 'editing', 'testing', 'awaiting-approval'].includes(task.status)
}
