// Shared types between the main process, preload bridge and renderer.

import type { Accent } from './color'

export type ProviderId = 'codex' | 'claude' | 'gemini' | 'local'

export interface ModelChoice {
  provider: ProviderId
  model: string
  effort?: 'minimal' | 'low' | 'medium' | 'high'
}

/** Normalized event emitted by any provider stream. */
export type AgentEvent =
  | { kind: 'session'; id: string }
  | { kind: 'text-delta'; text: string }
  | { kind: 'message'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'command'; id: string; command: string; status: 'running' | 'done' | 'failed'; exitCode?: number | null; output?: string }
  | { kind: 'file-change'; id: string; changes: { path: string; kind: string }[] }
  | { kind: 'tool'; id: string; name: string; detail?: string; status: 'running' | 'done' | 'failed' }
  | { kind: 'plan'; items: { text: string; done: boolean }[] }
  | { kind: 'usage'; input: number; output: number }
  | { kind: 'warning'; message: string }
  | { kind: 'limits'; raw: unknown }
  /** Live progress that replaces the previous progress line (e.g. thinking token counts). */
  | { kind: 'progress'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'done' }

/**
 * Honest task states. "completed-unverified" means the agent reported success
 * but Bluevis saw no passing check; "completed-verified" requires an observed
 * successful test/build command after the last file edit.
 */
export type TaskStatus =
  | 'starting'
  | 'investigating'
  | 'editing'
  | 'testing'
  | 'awaiting-approval'
  | 'completed-verified'
  | 'completed-unverified'
  | 'failed'
  | 'stopped'

export interface TaskStep {
  id: string
  at: number
  kind: 'command' | 'edit' | 'tool' | 'note' | 'plan'
  label: string
  status: 'running' | 'done' | 'failed'
  detail?: string
}

export interface AgentTask {
  id: string
  title: string
  prompt: string
  choice: ModelChoice
  cwd: string
  project?: string
  status: TaskStatus
  steps: TaskStep[]
  plan?: { text: string; done: boolean }[]
  finalMessage?: string
  error?: string
  sessionId?: string
  filesChanged: string[]
  diffStat?: string
  startedAt: number
  endedAt?: number
  lastEventAt: number
}

export type Speaker = 'user' | 'bluevis' | 'system'

export interface Turn {
  id: string
  speaker: Speaker
  text: string
  at: number
  via?: 'voice' | 'text'
  model?: string
  pending?: boolean
  error?: boolean
  attachments?: string[]
  /** Evidence label for system/status lines (PRD §8). */
  evidence?: 'observed' | 'reported' | 'inferred' | 'unknown'
  /** Text read aloud, when it differs from what is shown. */
  spoken?: string
  /** A proposed action awaiting the user's go-ahead. */
  action?: TurnAction
  /** A memory write, with its vault commit so it can be undone. */
  memory?: { path: string; title: string; hash?: string; undone?: boolean }
  taskId?: string
  /** Vault passages the model was given for this reply. */
  sources?: SourceRef[]
  relayId?: string
  /** Tool calls made while answering (e.g. Gmail searches), shown so answers are not a black box. */
  activity?: string[]
}

export interface TurnAction {
  kind: 'delegate'
  agent: 'codex' | 'claude'
  model?: string
  project?: string
  prompt: string
  state: 'proposed' | 'started' | 'dismissed'
  /** Candidate projects when the target was ambiguous. */
  choices?: string[]
}

/** A vault passage that was given to the model for a reply. */
export interface SourceRef {
  path: string
  title: string
  heading?: string
}

export type OrbMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting' | 'approval' | 'error'

export interface Project {
  name: string
  slug: string
  path: string
  remote?: string
  branch?: string
  dirty?: number
  lastCommit?: { at: number; subject: string }
  note?: string
}

export type KnowledgeStatus = 'known' | 'needs-review' | 'historical' | 'not-connected'

export interface NoteSummary {
  path: string
  title: string
  area: string
  status?: KnowledgeStatus | string
  updated?: string
  source?: string
  summary?: string
  tags?: string[]
}

export interface MemoryChange {
  hash: string
  at: number
  subject: string
  files: string[]
}

export interface Atlas {
  vaultPath: string
  notes: NoteSummary[]
  changes: MemoryChange[]
}

export interface Settings {
  brain: ModelChoice
  worker: ModelChoice
  localBaseUrl: string
  voice: { enabled: boolean; ttsVoice: string; speed: number; speak: boolean }
  projectRoots: string[]
  vaultPath: string
  editor: string
  /** Private ICS links (Google Calendar secret address, Canvas calendar feed). */
  calendarFeeds?: { name: string; url: string }[]
  /** App accent color; everything tinted follows it, neutrals stay graphite. */
  accent?: Accent
}

export interface ProviderHealth {
  provider: ProviderId
  ok: boolean
  detail: string
}

export interface VoiceHealth {
  state: 'off' | 'starting' | 'ready' | 'error'
  detail: string
}
