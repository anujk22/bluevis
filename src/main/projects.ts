import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Project } from '../core/types'
import { slugify } from '../core/notes'
import { run } from './shell'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor', 'Pods', 'target'])

/** Find git repositories up to `depth` levels below each root. */
function findRepos(root: string, depth: number, acc: string[] = []): string[] {
  if (!existsSync(root)) return acc
  if (existsSync(join(root, '.git'))) {
    acc.push(root)
    return acc
  }
  if (depth === 0) return acc
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return acc
  }
  for (const name of entries) {
    if (name.startsWith('.') || SKIP.has(name)) continue
    const full = join(root, name)
    try {
      if (statSync(full).isDirectory()) findRepos(full, depth - 1, acc)
    } catch {
      // unreadable entries are skipped
    }
  }
  return acc
}

function titleCase(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

let cache: { at: number; projects: Project[] } | null = null

export async function discoverProjects(roots: string[], force = false): Promise<Project[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.projects
  const paths = [...new Set(roots.flatMap((r) => findRepos(r, 3)))]
  const projects = await Promise.all(
    paths.map(async (path): Promise<Project> => {
      const [log, status, remote, branch] = await Promise.all([
        run('git', ['log', '-1', '--format=%ct%x1f%s'], { cwd: path }),
        run('git', ['status', '--porcelain'], { cwd: path }),
        run('git', ['remote', 'get-url', 'origin'], { cwd: path }),
        run('git', ['branch', '--show-current'], { cwd: path })
      ])
      const [at, subject] = log.stdout.trim().split('\x1f')
      const name = titleCase(basename(path))
      return {
        name,
        slug: slugify(name),
        path,
        remote: remote.code === 0 ? remote.stdout.trim() : undefined,
        branch: branch.stdout.trim() || undefined,
        dirty: status.stdout.split('\n').filter(Boolean).length,
        lastCommit: at ? { at: Number(at) * 1000, subject } : undefined
      }
    })
  )
  projects.sort((a, b) => (b.lastCommit?.at ?? 0) - (a.lastCommit?.at ?? 0))
  cache = { at: Date.now(), projects }
  return projects
}
