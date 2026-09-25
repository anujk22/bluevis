import { formatAgenda, parseIcs, type CalEvent } from '../core/ics'
import { getSettings } from './settings'

const cache = new Map<string, { at: number; text: string }>()

/** Upcoming events from the user's private ICS feeds (Google Calendar, Canvas). */
export async function upcoming(days = 14): Promise<{ events: CalEvent[]; errors: string[]; feeds: number }> {
  const feeds = getSettings().calendarFeeds ?? []
  const from = Date.now() - 2 * 3600_000
  const to = Date.now() + days * 86400_000
  const errors: string[] = []
  const all = await Promise.all(
    feeds.map(async (f) => {
      try {
        let hit = cache.get(f.url)
        if (!hit || Date.now() - hit.at > 10 * 60_000) {
          const r = await fetch(f.url.replace(/^webcal:/, 'https:'), { signal: AbortSignal.timeout(15000) })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          hit = { at: Date.now(), text: await r.text() }
          cache.set(f.url, hit)
        }
        return parseIcs(hit.text, f.name, from, to)
      } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`)
        return []
      }
    })
  )
  return { events: all.flat().sort((a, b) => a.start - b.start), errors, feeds: feeds.length }
}

export async function agendaText(days = 14): Promise<string> {
  const { events, errors, feeds } = await upcoming(days)
  if (!feeds) return '(No calendar feeds connected. Add them in Settings → Calendars.)'
  return [events.length ? formatAgenda(events.slice(0, 80)) : `(No events in the next ${days} days.)`, ...errors.map((e) => `(Feed error: ${e})`)].join('\n')
}
