import type { TaskStatus as S } from '../../../core/types'

const LABEL: Record<S, [string, string]> = {
  starting: ['', 'starting'],
  investigating: ['', 'investigating'],
  editing: ['', 'editing'],
  testing: ['', 'testing'],
  'awaiting-approval': ['!', 'needs you'],
  'completed-verified': ['✓', 'verified'],
  'completed-unverified': ['◐', 'done · unverified'],
  failed: ['✗', 'failed'],
  stopped: ['■', 'stopped']
}

const LIVE = new Set<S>(['starting', 'investigating', 'editing', 'testing'])

/** Status is always glyph + words, so it never relies on color alone. */
export function TaskStatus({ status }: { status: S }) {
  const [g, text] = LABEL[status]
  return (
    <span className="status" data-s={status}>
      {LIVE.has(status) ? <span className="spin" /> : <span className="g">{g}</span>}
      {text}
    </span>
  )
}
