// A relay passes one problem between models in visible stages. Every stage's
// input, streamed output and handoff are kept so nothing is a black box.

import type { ModelChoice } from './types'

export type StageStatus = 'waiting' | 'running' | 'done' | 'failed' | 'stopped'

export interface StageRun {
  id: string
  label: string
  /** Who works this stage, as shown in the UI ("Claude Opus", "GPT-6-Astra · high"). */
  actor: string
  choice?: ModelChoice
  status: StageStatus
  /** What this stage was handed (shown as the handoff between columns). */
  handoff?: string
  /** Streamed or final text produced by the stage. */
  text: string
  /** Observable side events: tool calls, reasoning summaries, fetches. */
  events: { at: number; label: string; progress?: boolean }[]
  startedAt?: number
  endedAt?: number
  error?: string
}

export interface RelayRun {
  id: string
  kind: 'hackathon'
  title: string
  url: string
  note?: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  stages: StageRun[]
  startedAt: number
  endedAt?: number
  outputPath?: string
}

/** Extract readable text from a server-rendered page (Devpost overview or rules). */
export function htmlToText(html: string, max = 24000): string {
  let t = html
    .replace(/<(script|style|noscript|svg|head|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Math.min(Number(n) + 1, 4))} `)
    .replace(/<[^>]+>/g, ' ')
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
  t = t
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => !/unsupported browser|Internet Explorer 10|^#+$/i.test(l))
    .filter((l, i, a) => l || (a[i - 1] ?? '') !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t.length > max ? `${t.slice(0, max)}\n\n(page truncated)` : t
}

/** Normalize a Devpost link to its hackathon root, so /rules and /details can be derived. */
export function devpostRoot(url: string): string | null {
  const m = url.match(/^https?:\/\/([a-z0-9-]+)\.devpost\.com/i)
  return m ? `https://${m[1].toLowerCase()}.devpost.com` : null
}

export function relayTitle(pageText: string, url: string): string {
  const first = pageText
    .split('\n')
    .find((l) => /^#+\s+\S/.test(l))
    ?.replace(/^#+\s*/, '')
  return (first && first.length < 80 ? first : null) ?? devpostRoot(url)?.replace('https://', '').replace('.devpost.com', '') ?? 'Hackathon'
}

const HOUSE_RULES = `House rules: no em dashes. Be concrete and specific to this event. Do not invent prizes, rules, dates or judges that are not in the page text; say "not stated" when unknown. Anuj's background below is context for fit, not something to flatter.`

export function ideatePrompt(page: string, anuj: string, note?: string): string {
  return `You are the first of three minds in a hackathon strategy relay for Anuj. Your job: deep, original ideation.

${HOUSE_RULES}

<hackathon_page>
${page}
</hackathon_page>

<about_anuj>
${anuj}
</about_anuj>
${note ? `\nAnuj's note: ${note}\n` : ''}
Produce:
1. What actually wins here: judging criteria, sponsor prizes and tracks worth targeting, constraints (team size, time, required tech), each tied to the page text.
2. Eight distinct project ideas. For each: a one-line pitch, the human problem and who feels it, the emotional hook (the moment in the demo that makes judges feel something), the technical core, which prizes it can stack, and a 48-hour feasibility read.
3. Your top three and why.
Write for another expert who will challenge you next. Markdown, dense, no filler.`
}

export function challengePrompt(page: string, ideation: string, note?: string): string {
  return `You are the second mind in a hackathon strategy relay. The first mind (Claude Opus) produced the ideation below. Your job: challenge it hard and push it further.

${HOUSE_RULES}

<hackathon_page>
${page}
</hackathon_page>

<first_mind_ideation>
${ideation}
</first_mind_ideation>
${note ? `\nAnuj's note: ${note}\n` : ''}
Produce:
1. Where the first mind is wrong, generic, or overestimates feasibility or judge appeal. Be specific.
2. Two to four stronger or stranger ideas it missed, in the same format.
3. For the three most promising ideas overall: the riskiest assumption, how to de-risk it in the first 6 hours, and what the 90-second demo shows.
Markdown, dense, no filler.`
}

export function consolidatePrompt(page: string, ideation: string, challenge: string, note?: string): string {
  return `You are the first mind in a hackathon strategy relay, now closing it out. You wrote the ideation; a second mind (GPT-6-Astra) challenged it. Respond to the critique honestly (concede where it is right), then produce the final plan for Anuj.

${HOUSE_RULES}

<hackathon_page>
${page}
</hackathon_page>

<your_ideation>
${ideation}
</your_ideation>

<second_mind_challenge>
${challenge}
</second_mind_challenge>
${note ? `\nAnuj's note: ${note}\n` : ''}
Write the consolidated plan in markdown with exactly these sections:
## Verdict
One recommended project in two sentences, and why it beats the alternatives.
## Why it wins
Judging criteria and prizes it targets, citing the page.
## The emotional hook
The demo moment and the story around it.
## Build plan
Hour-by-hour milestones for the event window, the minimum demo that still wins, and what to cut first.
## Risks
The top risks and the de-risking step for each.
## Runners-up
Two alternatives in one paragraph each.
## Where the minds disagreed
What the two models disagreed on and how you resolved it.`
}
