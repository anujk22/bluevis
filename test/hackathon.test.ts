import { describe, expect, it } from 'vitest'
import { formatLeft, hackLine, hackStatus, parseExtract, type Hackathon } from '../src/core/hackathon'

const h0 = 1_800_000_000_000
const hack = (over: Partial<Hackathon> = {}): Hackathon => ({
  id: 'h',
  title: 'HackNYU',
  url: 'https://x.devpost.com',
  plan: '',
  hook: '',
  startedAt: h0,
  deadline: h0 + 36 * 3600_000,
  milestones: [
    { id: 'a', title: 'Core loop', hour: 6, done: true },
    { id: 'b', title: 'Camera works', hour: 12, done: false },
    { id: 'c', title: 'Polish', hour: 30, done: false }
  ],
  criteria: [],
  rehearsals: [],
  active: true,
  ...over
})

describe('hackathon', () => {
  it('knows what is behind and next', () => {
    const s = hackStatus(hack(), h0 + 14 * 3600_000)
    expect(s.behind.map((m) => m.id)).toEqual(['b'])
    expect(s.next?.id).toBe('c')
    expect(s.left).toBe(22 * 3600_000)
    expect(hackLine(hack(), h0 + 14 * 3600_000)).toContain('Behind on: Camera works (due hour 12)')
  })

  it('formats time left', () => {
    expect(formatLeft(22 * 3600_000 + 5 * 60_000)).toBe('22:05 left')
    expect(formatLeft(-1)).toBe('past deadline')
    expect(formatLeft(72 * 3600_000)).toBe('3d left')
  })

  it('parses fenced or bare JSON and drops malformed rows', () => {
    const r = parseExtract('Here:\n```json\n{"deadline":null,"hook":"x","milestones":[{"hour":4,"title":"A"},{"title":"no hour"}],"criteria":[{"name":"Impact","detail":"d"}]}\n```')
    expect(r?.milestones).toEqual([{ hour: 4, title: 'A' }])
    expect(r?.criteria[0].name).toBe('Impact')
    expect(parseExtract('no json')).toBeNull()
  })
})

import { allowanceNudge, queueDue, nextRun } from '../src/core/queue'

describe('overnight queue', () => {
  const at = (h: number, m = 0) => new Date(2026, 8, 25, h, m)
  it('runs once after the run time and never hours late', () => {
    expect(queueDue('01:30', null, at(1, 45))).toBe(true)
    expect(queueDue('01:30', at(1, 45).toDateString(), at(2))).toBe(false)
    expect(queueDue('01:30', null, at(0, 10))).toBe(false)
    expect(queueDue('01:30', null, at(23))).toBe(false)
    expect(nextRun('01:30', null, at(23)).getDate()).toBe(26)
  })
  it('nudges only when a real share of the week resets soon', () => {
    const now = Date.now()
    const snap = (used: number, inH: number) => ({ provider: 'codex' as const, observedAt: now, windows: [{ name: 'weekly', usedPercent: used, resetsAt: now + inH * 3600_000 }] })
    expect(allowanceNudge(snap(60, 4), now)).toEqual({ left: 40, hours: 4 })
    expect(allowanceNudge(snap(90, 4), now)).toBeNull()
    expect(allowanceNudge(snap(60, 40), now)).toBeNull()
  })
})
