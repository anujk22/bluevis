// Parsing the brain's reply: what gets spoken, what is only shown, and any
// structured directives (proposed actions and memory writes).

export interface ProposedAction {
  type: 'delegate'
  agent: 'codex' | 'claude'
  project?: string
  prompt: string
}

export interface MemoryWrite {
  kind: 'preference' | 'decision' | 'idea' | 'fact' | 'project' | 'goal' | 'person'
  title: string
  text: string
  project?: string
}

export interface ParsedReply {
  spoken: string
  shown: string
  actions: ProposedAction[]
  memories: MemoryWrite[]
}

const DIRECTIVE = /^\s*(ACTION|MEMORY):\s*(\{.*\})\s*$/

export function parseReply(raw: string): ParsedReply {
  const actions: ProposedAction[] = []
  const memories: MemoryWrite[] = []
  const kept: string[] = []
  for (const line of raw.split('\n')) {
    const m = line.match(DIRECTIVE)
    if (!m) {
      kept.push(line)
      continue
    }
    try {
      const obj = JSON.parse(m[2])
      if (m[1] === 'ACTION' && obj.type === 'delegate' && typeof obj.prompt === 'string') {
        actions.push({ type: 'delegate', agent: obj.agent === 'claude' ? 'claude' : 'codex', project: obj.project || undefined, prompt: obj.prompt })
      } else if (m[1] === 'MEMORY' && typeof obj.text === 'string' && typeof obj.title === 'string') {
        const kinds = ['preference', 'decision', 'idea', 'fact', 'project']
        memories.push({ kind: kinds.includes(obj.kind) ? obj.kind : 'fact', title: obj.title, text: obj.text, project: obj.project || undefined })
      }
    } catch {
      kept.push(line)
    }
  }
  const shown = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  // Everything before a lone '---' is spoken; the rest is detail for the screen.
  const parts = shown.split(/\n\s*---\s*\n/)
  const spoken = parts.length > 1 ? parts[0].trim() : firstSentences(shown, 3)
  return { spoken: speakable(spoken), shown: shown.replace(/\n\s*---\s*\n/, '\n\n'), actions, memories }
}

function firstSentences(text: string, n: number): string {
  if (/```/.test(text)) text = text.split('```')[0]
  return splitSentences(text.split(/\n\s*\n/)[0]).slice(0, n).join(' ')
}

/** Remove markdown and code that should never be read aloud. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sentence splitter tuned for TTS chunking. Keeps abbreviations and decimals intact. */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  const re = /[.!?]+(?=\s|$)/g
  let start = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    const piece = text.slice(start, end).trim()
    if (/\b(e\.g|i\.e|etc|vs|Mr|Ms|Dr|St)\.$/i.test(piece)) continue
    if (piece) out.push(piece)
    start = end
  }
  const rest = text.slice(start).trim()
  if (rest) out.push(rest)
  return out
}
