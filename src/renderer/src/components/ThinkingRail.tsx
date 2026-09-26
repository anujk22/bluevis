import { useEffect, useRef, useState } from 'react'
import type { ModelChoice, Settings } from '../../../core/types'
import { Brain } from './icons'

export type ThinkLevel = 'off' | 'low' | 'medium' | 'high' | 'ultra'
const LEVELS: { id: ThinkLevel; label: string; note: string }[] = [
  { id: 'off', label: 'Off', note: 'answers at once' },
  { id: 'low', label: 'Low', note: 'a few seconds' },
  { id: 'medium', label: 'Medium', note: 'thinks it through' },
  { id: 'high', label: 'High', note: 'slow and careful' },
  { id: 'ultra', label: 'Ultra', note: 'can split work across parallel agents' }
]

export function thinkLevel(s: Settings): ThinkLevel {
  if (s.ultra) return 'ultra'
  const e = s.brain.effort
  return e === 'low' || e === 'medium' || e === 'high' ? e : 'off'
}

/** The settings change for a level: effort on the conversation model, plus the Ultra flag. */
export function levelPatch(s: Settings, level: ThinkLevel): Partial<Settings> {
  const { effort: _, ...base } = s.brain
  const effort: ModelChoice['effort'] | undefined = level === 'ultra' ? 'high' : level === 'off' ? (s.brain.provider === 'codex' ? 'minimal' : undefined) : level
  return { brain: effort ? { ...base, effort } : base, ultra: level === 'ultra' }
}

/** Brain button for the composer. Opens a rail from Off to Ultra; scroll, drag the wheel, or use the arrow keys. */
export function ThinkingRail({ settings, onPick }: { settings: Settings; onPick: (l: ThinkLevel) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const level = thinkLevel(settings)
  const i = LEVELS.findIndex((l) => l.id === level)
  const wheel = useRef(0)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const step = (d: number) => {
    const n = Math.min(LEVELS.length - 1, Math.max(0, i + d))
    if (n !== i) onPick(LEVELS[n].id)
  }
  return (
    <div className="rail-anchor" ref={ref}>
      <button className="round" data-level={level} aria-expanded={open} onClick={() => setOpen(!open)} title={`Thinking: ${LEVELS[i].label}`} aria-label={`Thinking: ${LEVELS[i].label}`}>
        <Brain />
      </button>
      {open && (
        <div
          className="rail"
          role="radiogroup"
          aria-label="Thinking"
          tabIndex={-1}
          onWheel={(e) => {
            // Trackpads send many small deltas; one notch per ~60px of travel.
            wheel.current += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
            if (Math.abs(wheel.current) > 60) {
              step(Math.sign(wheel.current))
              wheel.current = 0
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') step(1)
            if (e.key === 'ArrowLeft') step(-1)
            if (e.key === 'Escape') setOpen(false)
          }}
        >
          <div className="rail-track" style={{ ['--i' as string]: i, ['--n' as string]: LEVELS.length }}>
            <span className="rail-thumb" data-ultra={level === 'ultra'} />
            {LEVELS.map((l) => (
              <button key={l.id} role="radio" aria-checked={l.id === level} className="rail-stop" onClick={() => onPick(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
          <div className="rail-note mono">{LEVELS[i].note}</div>
        </div>
      )}
    </div>
  )
}
