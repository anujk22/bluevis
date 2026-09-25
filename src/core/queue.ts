// Agent briefs queued for later, and when spending allowance on them is worth a nudge.

import type { UsageSnapshot } from './usage'

export interface QueuedTask {
  id: string
  prompt: string
  project: string
  projectPath: string
  agent: 'codex' | 'claude'
  addedAt: number
  /** Set once the queue has started it; the task itself is tracked by TaskManager. */
  taskId?: string
}

/** The next time the queue should run: today at `runAt` (HH:MM, local) if that is still ahead and today has not run, else tomorrow. */
export function nextRun(runAt: string, lastRunDay: string | null, now: Date): Date {
  const [h, m] = runAt.split(':').map(Number)
  const at = new Date(now)
  at.setHours(h || 0, m || 0, 0, 0)
  if (at.getTime() <= now.getTime() && lastRunDay === now.toDateString()) at.setDate(at.getDate() + 1)
  else if (at.getTime() + 6 * 3600_000 < now.getTime()) at.setDate(at.getDate() + 1)
  return at
}

/** Whether the queue is due now: past today's run time (within six hours of it) and not yet run today. */
export function queueDue(runAt: string, lastRunDay: string | null, now: Date): boolean {
  const at = nextRun(runAt, lastRunDay, now)
  return at.getTime() <= now.getTime()
}

/** A nudge when a meaningful share of the weekly Codex allowance will reset unused within half a day. */
export function allowanceNudge(codex: UsageSnapshot | null, now: number): { left: number; hours: number } | null {
  const weekly = codex?.windows.find((w) => w.name === 'weekly')
  if (!weekly?.resetsAt || weekly.resetsAt < now) return null
  const left = 100 - weekly.usedPercent
  const hours = (weekly.resetsAt - now) / 3600_000
  return left >= 20 && hours <= 12 ? { left: Math.round(left), hours: Math.max(1, Math.round(hours)) } : null
}
