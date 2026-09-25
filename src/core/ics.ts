// Minimal iCalendar (ICS) reader for Google Calendar and Canvas feeds:
// VEVENTs with time zones, all-day dates, and common recurrence rules.

export interface CalEvent {
  uid: string
  title: string
  start: number
  end?: number
  allDay: boolean
  location?: string
  url?: string
  description?: string
  calendar: string
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
}

/** UTC ms for a wall-clock time in an IANA zone. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(guess))
      .reduce<Record<string, number>>((a, p) => (p.type !== 'literal' ? { ...a, [p.type]: Number(p.value) } : a), {})
    const asZone = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    return guess - (asZone - guess)
  } catch {
    return guess
  }
}

function parseDate(value: string, params: Record<string, string>, fallbackTz: string): { t: number; allDay: boolean } {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return { t: NaN, allDay: false }
  const [, y, mo, d, h, mi, s, z] = m
  if (!h) return { t: zonedToUtc(+y, +mo, +d, 0, 0, 0, fallbackTz), allDay: true }
  if (z) return { t: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s), allDay: false }
  return { t: zonedToUtc(+y, +mo, +d, +h, +mi, +s, params.TZID ?? fallbackTz), allDay: false }
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/**
 * Parse a feed and return event occurrences overlapping [from, to).
 * Recurrence support covers DAILY and WEEKLY (with BYDAY, INTERVAL, COUNT, UNTIL, EXDATE),
 * which is what class schedules and personal calendars use in practice.
 */
export function parseIcs(text: string, calendar: string, from: number, to: number, tz = 'America/New_York'): CalEvent[] {
  const out: CalEvent[] = []
  let cur: Record<string, { value: string; params: Record<string, string> }[]> | null = null
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') cur = {}
    else if (line === 'END:VEVENT' && cur) {
      out.push(...expand(cur, calendar, from, to, tz))
      cur = null
    } else if (cur) {
      const i = line.indexOf(':')
      if (i < 0) continue
      const [name, ...rawParams] = line.slice(0, i).split(';')
      const params = Object.fromEntries(rawParams.map((p) => p.split('=') as [string, string]))
      ;(cur[name.toUpperCase()] ??= []).push({ value: line.slice(i + 1), params })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

function expand(ev: Record<string, { value: string; params: Record<string, string> }[]>, calendar: string, from: number, to: number, tz: string): CalEvent[] {
  const get = (k: string) => ev[k]?.[0]
  const dtstart = get('DTSTART')
  if (!dtstart || get('STATUS')?.value === 'CANCELLED') return []
  const start = parseDate(dtstart.value, dtstart.params, tz)
  if (Number.isNaN(start.t)) return []
  const dtend = get('DTEND')
  const end = dtend ? parseDate(dtend.value, dtend.params, tz).t : undefined
  const duration = end !== undefined ? end - start.t : start.allDay ? 86400000 : 0
  const base = {
    uid: get('UID')?.value ?? `${calendar}-${start.t}`,
    title: unescape(get('SUMMARY')?.value ?? '(untitled)'),
    allDay: start.allDay,
    location: get('LOCATION') ? unescape(get('LOCATION')!.value) : undefined,
    url: get('URL')?.value,
    description: get('DESCRIPTION') ? unescape(get('DESCRIPTION')!.value).slice(0, 600) : undefined,
    calendar
  }
  const make = (t: number): CalEvent => ({ ...base, start: t, end: duration ? t + duration : undefined })
  const overlaps = (t: number) => t < to && t + Math.max(duration, 1) > from

  const rrule = get('RRULE')?.value
  if (!rrule) return overlaps(start.t) ? [make(start.t)] : []
  const r = Object.fromEntries(rrule.split(';').map((p) => p.split('=') as [string, string]))
  if (r.FREQ !== 'DAILY' && r.FREQ !== 'WEEKLY') return overlaps(start.t) ? [make(start.t)] : []
  const exdates = new Set((ev.EXDATE ?? []).flatMap((x) => x.value.split(',').map((v) => parseDate(v, x.params, tz).t)))
  const until = r.UNTIL ? parseDate(r.UNTIL, {}, tz).t : Infinity
  const count = r.COUNT ? Number(r.COUNT) : Infinity
  const interval = Number(r.INTERVAL ?? 1)
  const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))) : null
  const results: CalEvent[] = []
  let n = 0
  // Step one day at a time in wall-clock terms so DST shifts keep the local time.
  const local = (t: number) => new Date(new Date(t).toLocaleString('en-US', { timeZone: tz }))
  const l0 = local(start.t)
  for (let day = 0; day < 3660 && n < count; day++) {
    const wall = new Date(l0.getFullYear(), l0.getMonth(), l0.getDate() + day, l0.getHours(), l0.getMinutes(), l0.getSeconds())
    const t = start.allDay ? zonedToUtc(wall.getFullYear(), wall.getMonth() + 1, wall.getDate(), 0, 0, 0, tz) : zonedToUtc(wall.getFullYear(), wall.getMonth() + 1, wall.getDate(), wall.getHours(), wall.getMinutes(), wall.getSeconds(), tz)
    if (t > until || t >= to) break
    let hit: boolean
    if (r.FREQ === 'DAILY') hit = day % interval === 0
    else {
      const week = Math.floor(day / 7)
      hit = week % interval === 0 && (byday ? byday.includes(wall.getDay()) : wall.getDay() === l0.getDay())
    }
    if (!hit) continue
    n++
    if (!exdates.has(t) && overlaps(t)) results.push(make(t))
  }
  return results
}

export function formatAgenda(events: CalEvent[], tz = 'America/New_York'): string {
  const day = (t: number) => new Date(t).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
  const time = (t: number) => new Date(t).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  return events
    .map((e) => `- ${day(e.start)}${e.allDay ? ' (all day)' : ` ${time(e.start)}${e.end ? `–${time(e.end)}` : ''}`} · ${e.title} [${e.calendar}]${e.location ? ` @ ${e.location}` : ''}`)
    .join('\n')
}
