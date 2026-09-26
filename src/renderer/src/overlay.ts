// The listening pill: live bars from the mic level, a running timer, then what was heard.

type State = { state: 'listening' | 'dictating' | 'transcribing' | 'heard' | 'hidden'; text?: string; startedAt?: number }

const pill = document.getElementById('pill')!
const label = document.getElementById('label')!
const time = document.getElementById('time')!
const text = document.getElementById('text')!
const barsEl = document.getElementById('bars')!
const N = 14
const bars = Array.from({ length: N }, () => barsEl.appendChild(document.createElement('i')))
const history: number[] = Array(N).fill(0)
let startedAt = Date.now()
let tick: number | undefined

const LABEL: Record<string, string> = { listening: 'Listening', dictating: 'Dictating', transcribing: 'Transcribing' }

function render(s: State) {
  pill.className = `pill ${s.state === 'hidden' ? '' : 'on'} ${s.state}`
  label.textContent = LABEL[s.state] ?? ''
  label.style.display = s.state === 'heard' ? 'none' : ''
  text.textContent = s.text ?? ''
  if (s.startedAt) startedAt = s.startedAt
  clearInterval(tick)
  if (s.state === 'listening' || s.state === 'dictating') {
    const draw = () => {
      const secs = Math.floor((Date.now() - startedAt) / 1000)
      time.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
    }
    draw()
    tick = window.setInterval(draw, 250)
  }
}

window.bluevis.on('overlay', (s) => render(s as State))
window.bluevis.on('overlay:level', (l) => {
  history.push(Math.min(1, (l as number) * 1.6))
  history.shift()
  bars.forEach((b, i) => (b.style.height = `${4 + history[i] * 20}px`))
})
export {}
