import { describe, expect, it } from 'vitest'
import { formatAgenda, parseIcs, zonedToUtc } from '../src/core/ics'

const feed = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a1
SUMMARY:CS211 Lecture
DTSTART;TZID=America/New_York:20260921T100000
DTEND;TZID=America/New_York:20260921T112000
RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261215T000000Z
EXDATE;TZID=America/New_York:20260924T100000
LOCATION:Hill 114
END:VEVENT
BEGIN:VEVENT
UID:a2
SUMMARY:Assignment 2 due\\, pointers
DTSTART:20260926T035900Z
END:VEVENT
BEGIN:VEVENT
UID:a3
SUMMARY:Career fair
DTSTART;VALUE=DATE:20260930
DTEND;VALUE=DATE:20261001
END:VEVENT
BEGIN:VEVENT
UID:a4
SUMMARY:Cancelled thing
STATUS:CANCELLED
DTSTART:20260926T150000Z
END:VEVENT
END:VCALENDAR`

describe('ics', () => {
  const from = Date.UTC(2026, 8, 21, 4)
  const to = Date.UTC(2026, 9, 2, 4)
  const events = parseIcs(feed, 'School', from, to)

  it('converts zoned wall time to UTC across DST', () => {
    expect(new Date(zonedToUtc(2026, 9, 21, 10, 0, 0, 'America/New_York')).toISOString()).toBe('2026-09-21T14:00:00.000Z')
    expect(new Date(zonedToUtc(2026, 12, 7, 10, 0, 0, 'America/New_York')).toISOString()).toBe('2026-12-07T15:00:00.000Z')
  })

  it('expands weekly recurrences with BYDAY and EXDATE', () => {
    const lectures = events.filter((e) => e.title === 'CS211 Lecture').map((e) => new Date(e.start).toISOString())
    // Mon 21, (Thu 24 excluded), Mon 28, Thu Oct 1
    expect(lectures).toEqual(['2026-09-21T14:00:00.000Z', '2026-09-28T14:00:00.000Z', '2026-10-01T14:00:00.000Z'])
  })

  it('handles UTC, all-day, escaped text and cancellations', () => {
    expect(events.find((e) => e.uid === 'a2')?.title).toBe('Assignment 2 due, pointers')
    expect(events.find((e) => e.uid === 'a3')?.allDay).toBe(true)
    expect(events.some((e) => e.uid === 'a4')).toBe(false)
    expect(formatAgenda(events.filter((e) => e.uid === 'a2'))).toContain('11:59 PM · Assignment 2 due, pointers [School]')
  })
})
