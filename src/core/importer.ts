// Turning conversation exports and free-form "life dumps" into reviewable
// knowledge proposals. Nothing here writes to the vault; the user decides.

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface ChatThread {
  id: string
  title: string
  created: number
  messages: ChatMessage[]
}

export type ProposalKind = 'preference' | 'decision' | 'idea' | 'fact' | 'project' | 'goal' | 'person'

export interface Proposal {
  key: string
  kind: ProposalKind
  title: string
  text: string
  project?: string
  /** Who the claim comes from. Assistant suggestions are never promoted to decisions. */
  origin: 'user-stated' | 'assistant-suggested' | 'inferred'
  confidence: 'high' | 'medium' | 'low'
  source: { kind: 'chatgpt' | 'dump'; title: string; date: string; id: string }
}


/** Parse ChatGPT's `conversations.json`, following each conversation's active branch. */
export function parseChatGPTExport(data: unknown): ChatThread[] {
  if (!Array.isArray(data)) throw new Error('Expected conversations.json to contain an array of conversations')
  const threads: ChatThread[] = []
  for (const c of data as any[]) {
    const mapping = c?.mapping ?? {}
    let nodeId: string | undefined = c?.current_node
    if (!nodeId) {
      // Fall back to the deepest leaf when the active branch is missing.
      nodeId = Object.keys(mapping).find((k) => !(mapping[k]?.children?.length))
    }
    const chain: ChatMessage[] = []
    const seen = new Set<string>()
    while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
      seen.add(nodeId)
      const node = mapping[nodeId]
      const m = node.message
      const role = m?.author?.role
      if ((role === 'user' || role === 'assistant') && m?.content) {
        const text = contentText(m.content)
        if (text.trim() && m?.metadata?.is_visually_hidden_from_conversation !== true) chain.push({ role, text: text.trim() })
      }
      nodeId = node.parent
    }
    chain.reverse()
    if (!chain.some((m) => m.role === 'user')) continue
    threads.push({
      id: String(c.conversation_id ?? c.id ?? `${c.title}-${c.create_time}`),
      title: String(c.title || 'Untitled'),
      created: Math.round(Number(c.create_time ?? 0) * 1000),
      messages: chain
    })
  }
  return threads.sort((a, b) => a.created - b.created)
}

function contentText(content: any): string {
  if (Array.isArray(content.parts)) return content.parts.filter((p: unknown) => typeof p === 'string').join('\n')
  if (typeof content.text === 'string') return content.text
  return ''
}

const day = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'unknown date')

/**
 * Compact a thread for extraction. User turns are kept generously; assistant turns
 * are clipped hard because they are context, not evidence about the user.
 */
export function condense(t: ChatThread, maxChars = 6000): string {
  const lines: string[] = []
  let used = 0
  for (const m of t.messages) {
    const limit = m.role === 'user' ? 1200 : 280
    const body = m.text.length > limit ? `${m.text.slice(0, limit)}…` : m.text
    const line = `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${body.replace(/\s+/g, ' ')}`
    if (used + line.length > maxChars) {
      lines.push('(conversation truncated)')
      break
    }
    lines.push(line)
    used += line.length
  }
  return lines.join('\n')
}

/** Group threads into batches that fit a character budget, keeping each thread whole. */
export function batchThreads(threads: ChatThread[], budget = 22000): ChatThread[][] {
  const batches: ChatThread[][] = []
  let cur: ChatThread[] = []
  let size = 0
  for (const t of threads) {
    const len = Math.min(condense(t).length, 6000) + 80
    if (cur.length && size + len > budget) {
      batches.push(cur)
      cur = []
      size = 0
    }
    cur.push(t)
    size += len
  }
  if (cur.length) batches.push(cur)
  return batches
}

export function batchPrompt(batch: ChatThread[]): string {
  return batch.map((t, i) => `### [${i}] ${t.title} (${day(t.created)})\n${condense(t)}`).join('\n\n')
}

export const EXTRACT_INSTRUCTIONS = `You are building Anuj's personal knowledge base from past conversations. Extract only durable knowledge that would help an assistant help Anuj later: preferences, goals, projects (purpose, stack, status), decisions Anuj actually made, ideas worth keeping, important collaborators, and stable facts about Anuj's situation, skills, tools and work style.

Rules:
- Only extract what Anuj (USER) stated, asked for, or clearly confirmed. Something the ASSISTANT suggested that Anuj did not adopt is not a decision; if worth keeping at all, mark origin "assistant-suggested".
- Skip trivia, one-off tasks, homework answers, generic questions, and anything already obvious.
- Never extract passwords, credentials, financial account details, health information, or private details about other people beyond their role.
- Mark employer-confidential material as sensitive by not extracting it at all.
- Write "text" as one or two plain sentences that refer to Anuj by name rather than with pronouns ("Anuj prefers..."). Include when it was true if the date matters. No em dashes.
- "title" is a short noun phrase. "project" is the project name or "".
- "source_index" is the [n] of the conversation it came from.
- "confidence" is how sure you are that this is durable and correctly attributed.
- Return at most 12 items per batch. Returning zero items is fine.`

export const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'text', 'project', 'origin', 'source_index', 'confidence'],
        properties: {
          kind: { type: 'string', enum: ['preference', 'decision', 'idea', 'fact', 'project', 'goal', 'person'] },
          title: { type: 'string' },
          text: { type: 'string' },
          project: { type: 'string' },
          origin: { type: 'string', enum: ['user-stated', 'assistant-suggested', 'inferred'] },
          source_index: { type: 'integer' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        }
      }
    }
  }
}

/** Stable identity for a proposal so re-imports never resurrect rejected or duplicate items. */
export function proposalKey(kind: string, title: string, text: string): string {
  const norm = `${kind}|${title}|${text}`.toLowerCase().replace(/[^a-z0-9|]+/g, ' ').trim()
  let h = 5381
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0
  return `${kind}-${h.toString(36)}`
}

/** Parse the model's reply (strict JSON from a schema, or JSON embedded in text) into proposals. */
export function parseProposals(raw: string, sources: Proposal['source'][]): Proposal[] {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return []
  let items: any[] = []
  try {
    items = JSON.parse(match[0]).items ?? []
  } catch {
    return []
  }
  const kinds = ['preference', 'decision', 'idea', 'fact', 'project', 'goal', 'person']
  return items
    .filter((i) => i && typeof i.title === 'string' && typeof i.text === 'string' && kinds.includes(i.kind))
    .map((i) => {
      const source = sources[Number(i.source_index)] ?? sources[0]
      // An assistant suggestion can be kept as an idea, never as a decision.
      const kind: ProposalKind = i.kind === 'decision' && i.origin === 'assistant-suggested' ? 'idea' : i.kind
      return {
        key: proposalKey(kind, i.title, i.text),
        kind,
        title: i.title.trim().slice(0, 80),
        text: i.text.trim(),
        project: i.project?.trim() || undefined,
        origin: ['user-stated', 'assistant-suggested', 'inferred'].includes(i.origin) ? i.origin : 'inferred',
        confidence: ['high', 'medium', 'low'].includes(i.confidence) ? i.confidence : 'low',
        source
      } as Proposal
    })
}

export function threadSource(t: ChatThread): Proposal['source'] {
  return { kind: 'chatgpt', title: t.title, date: day(t.created), id: t.id }
}
