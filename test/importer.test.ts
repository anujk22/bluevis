import { describe, expect, it } from 'vitest'
import { batchThreads, condense, parseChatGPTExport, parseProposals, proposalKey, threadSource } from '../src/core/importer'

const node = (id: string, parent: string | null, role: string | null, text: string, children: string[] = []) => ({
  id,
  parent,
  children,
  message: role ? { author: { role }, content: { content_type: 'text', parts: [text] } } : null
})

const exportJson = [
  {
    title: 'Yonder map clustering',
    create_time: 1750000000,
    conversation_id: 'c1',
    current_node: 'a2',
    mapping: {
      root: node('root', null, null, '', ['u1']),
      u1: node('u1', 'root', 'user', 'How should Yonder cluster bounty pins?', ['a1', 'a2']),
      a1: node('a1', 'u1', 'assistant', 'OLD BRANCH answer'),
      a2: node('a2', 'u1', 'assistant', 'Use supercluster.')
    }
  },
  { title: 'assistant only', create_time: 1750000100, id: 'c2', current_node: 'x', mapping: { x: node('x', null, 'assistant', 'hi') } }
]

describe('chatgpt export', () => {
  it('follows the active branch and drops threads without user turns', () => {
    const threads = parseChatGPTExport(exportJson)
    expect(threads).toHaveLength(1)
    expect(threads[0].messages.map((m) => m.text)).toEqual(['How should Yonder cluster bounty pins?', 'Use supercluster.'])
    expect(threadSource(threads[0])).toEqual({ kind: 'chatgpt', title: 'Yonder map clustering', date: '2025-06-15', id: 'c1' })
  })

  it('rejects non-array input', () => {
    expect(() => parseChatGPTExport({})).toThrow()
  })

  it('clips assistant turns harder than user turns and batches by budget', () => {
    const t = { id: 't', title: 't', created: 0, messages: [{ role: 'user' as const, text: 'u'.repeat(2000) }, { role: 'assistant' as const, text: 'a'.repeat(2000) }] }
    const c = condense(t)
    expect(c).toContain('u'.repeat(1200) + '…')
    expect(c).toContain('a'.repeat(280) + '…')
    expect(batchThreads([t, t, t, t, t, t, t], 3000).length).toBeGreaterThan(1)
  })
})

describe('proposals', () => {
  const sources = [{ kind: 'chatgpt' as const, title: 'Yonder map clustering', date: '2025-06-15', id: 'c1' }]

  it('parses structured output and never promotes assistant suggestions to decisions', () => {
    const raw = JSON.stringify({
      items: [
        { kind: 'decision', title: 'Use supercluster', text: 'Assistant suggested supercluster.', project: 'Yonder', origin: 'assistant-suggested', source_index: 0, confidence: 'medium' },
        { kind: 'preference', title: 'Map style', text: 'Anuj prefers dark maps.', project: '', origin: 'user-stated', source_index: 0, confidence: 'high' },
        { kind: 'nonsense', title: 'x', text: 'y' }
      ]
    })
    const p = parseProposals(raw, sources)
    expect(p).toHaveLength(2)
    expect(p[0].kind).toBe('idea')
    expect(p[0].project).toBe('Yonder')
    expect(p[1]).toMatchObject({ kind: 'preference', project: undefined, origin: 'user-stated', source: sources[0] })
  })

  it('tolerates prose around JSON and garbage', () => {
    expect(parseProposals('Here you go: {"items": []} thanks', sources)).toEqual([])
    expect(parseProposals('no json', sources)).toEqual([])
  })

  it('keys are stable across whitespace and case', () => {
    expect(proposalKey('fact', 'A  Title', 'Some text.')).toBe(proposalKey('fact', 'a title', 'some text'))
  })
})
