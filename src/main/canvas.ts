import { formatAnnouncements, formatGrades, formatPlanner, nextLink, type CanvasAnnouncement, type CanvasCourse, type PlannerItem } from '../core/canvas'
import { getSecret } from './secrets'
import { getSettings } from './settings'

export const DEFAULT_CANVAS = 'https://rutgers.instructure.com'

/** Read-only Canvas access with a personal access token. Every request is a GET. */
async function get<T>(path: string, token: string, base: string): Promise<T[]> {
  const out: T[] = []
  let url: string | null = `${base.replace(/\/$/, '')}/api/v1${path}`
  for (let page = 0; url && page < 10; page++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
    if (res.status === 401) throw new Error('Canvas rejected the token. Create a new one in Canvas under Account, Settings.')
    if (!res.ok) throw new Error(`Canvas returned ${res.status}`)
    const body = (await res.json()) as T | T[]
    out.push(...(Array.isArray(body) ? body : [body]))
    url = nextLink(res.headers.get('link'))
  }
  return out
}

/** Check a token before saving it. Returns the account's name. */
export async function verifyCanvas(token: string, base: string): Promise<string> {
  const [me] = await get<{ name: string }>('/users/self', token, base)
  return me.name
}

let cache: { at: number; text: string } | null = null

/** Due work (last week to two weeks out) with submission state, current grades, and recent announcements. */
export async function canvasBrief(): Promise<string | null> {
  const token = getSecret('canvas')
  if (!token) return null
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.text
  const base = getSettings().canvasUrl ?? DEFAULT_CANVAS
  const now = Date.now()
  const iso = (t: number) => new Date(t).toISOString()
  try {
    const courses = await get<CanvasCourse>('/courses?enrollment_state=active&include[]=total_scores&per_page=50', token, base)
    const codes = courses.map((c) => `context_codes[]=course_${c.id}`).join('&')
    const [planner, announcements] = await Promise.all([
      get<PlannerItem>(`/planner/items?start_date=${iso(now - 7 * 86400_000)}&end_date=${iso(now + 14 * 86400_000)}&per_page=100`, token, base),
      courses.length ? get<CanvasAnnouncement>(`/announcements?${codes}&start_date=${iso(now - 7 * 86400_000)}&end_date=${iso(now)}&per_page=50`, token, base) : Promise.resolve([])
    ])
    const text = [
      `Due work, past week through next two weeks:\n${formatPlanner(planner, now)}`,
      `Current grades:\n${formatGrades(courses)}`,
      `Announcements, last 7 days:\n${formatAnnouncements(announcements.sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at)), courses)}`
    ].join('\n\n')
    cache = { at: now, text }
    return text
  } catch (e) {
    return `(Canvas error: ${(e as Error).message})`
  }
}
