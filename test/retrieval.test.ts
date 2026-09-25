import { describe, expect, it } from 'vitest'
import { BM25, chunkNote, cosine, fuse, stem } from '../src/core/retrieval'

const note = (path: string, title: string, body: string, localOnly = false) => ({ path, title, area: path.split('/')[0], body, localOnly })

describe('chunking', () => {
  it('splits at headings and keeps the heading with each passage', () => {
    const p = chunkNote(note('Education/Academic record.md', 'Academic record', '# Academic record\n\nIntro line.\n\n## GPA and credits\n\nLatest resume GPA 3.65.\n\n## Courses\n\nCS211, CS206.'))
    expect(p.map((x) => x.heading)).toEqual(['', 'GPA and credits', 'Courses'])
    expect(p[1].text).toBe('Latest resume GPA 3.65.')
  })

  it('splits long sections on paragraph boundaries', () => {
    const long = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(80)).join('\n\n')
    const p = chunkNote(note('A/B.md', 'B', `## Big\n\n${long}`))
    expect(p.length).toBeGreaterThan(1)
    expect(p.every((x) => x.heading === 'Big' && x.text.length <= 2100)).toBe(true)
  })
})

describe('bm25', () => {
  const passages = [
    ...chunkNote(note('Education/Academic record.md', 'Academic record', '## GPA and credits\n\nLatest resume GPA is 3.65; older 3.667.')),
    ...chunkNote(note('Projects/Blues Basketball.md', 'Blues Basketball', '## Environment\n\nBeach and boardwalk world for the Roblox game.')),
    ...chunkNote(note('Private/Finances.md', 'Finances', '## Goals\n\nNet worth goal.', true))
  ]
  const bm = new BM25(passages)

  it('ranks the passage that matches the question', () => {
    const s = bm.scores('what is my gpa')
    expect(s.indexOf(Math.max(...s))).toBe(0)
    expect(s[1]).toBe(0)
  })

  it('weights titles and handles simple plurals', () => {
    const s = bm.scores('roblox games')
    expect(s.indexOf(Math.max(...s))).toBe(1)
    expect(stem('courses')).toBe(stem('course'))
    expect(stem('grading')).toBe(stem('graded'))
    expect(stem('boxes')).toBe('box')
    expect(stem('class')).toBe('class')
  })
})

describe('fusion', () => {
  it('merges keyword and semantic rankings and drops irrelevant passages', () => {
    expect(fuse([0, 2, 0, 1], null, 5)).toEqual([1, 3])
    // Semantic-only hit (index 2) is found when keywords miss it.
    expect(fuse([0, 2, 0, 0], [0.1, 0.6, 0.8, 0.2], 5, 0.5)).toEqual([1, 2])
  })

  it('computes cosine similarity', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([1, 0], [])).toBe(0)
  })
})

import { devpostRoot, htmlToText, relayTitle } from '../src/core/relay'

describe('relay page reading', () => {
  it('turns server-rendered HTML into readable text', () => {
    const t = htmlToText('<html><head><title>x</title></head><body><script>bad()</script><h1>HackNYU</h1><p>48-hour &amp; fun</p><ul><li>$11,000 grand</li></ul></body></html>')
    expect(t).toContain('## HackNYU')
    expect(t).toContain('48-hour & fun')
    expect(t).toContain('- $11,000 grand')
    expect(t).not.toContain('bad()')
    expect(relayTitle(t, 'https://hacknyu-2025.devpost.com/')).toBe('HackNYU')
  })

  it('normalizes Devpost links', () => {
    expect(devpostRoot('https://HackNYU-2025.devpost.com/rules?x=1')).toBe('https://hacknyu-2025.devpost.com')
    expect(devpostRoot('https://example.com')).toBeNull()
  })
})
