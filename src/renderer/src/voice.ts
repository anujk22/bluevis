import { splitSentences } from '../../core/reply'

/** Encode mono float samples as 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

export type ListenResult = { wav: ArrayBuffer } | { cancelled: true; reason: 'silence' | 'manual' | 'error'; message?: string }

/**
 * One utterance of push-to-talk capture. Ends after ~1.1s of silence following
 * speech, on a manual stop, or after 30s. Exposes a live level for the orb.
 */
export class Listener {
  level = 0
  private stopRequested = false
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null

  async listen(): Promise<ListenResult> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch (e) {
      return { cancelled: true, reason: 'error', message: `Microphone unavailable: ${(e as Error).message}` }
    }
    this.ctx = new AudioContext()
    const src = this.ctx.createMediaStreamSource(this.stream)
    const proc = this.ctx.createScriptProcessor(2048, 1, 1)
    const chunks: Float32Array[] = []
    const rate = this.ctx.sampleRate
    let heard = false
    let silentFor = 0
    let elapsed = 0
    let noise = 0.008
    return new Promise((resolve) => {
      const finish = (r: ListenResult) => {
        proc.disconnect()
        src.disconnect()
        this.stream?.getTracks().forEach((t) => t.stop())
        void this.ctx?.close()
        this.level = 0
        resolve(r)
      }
      proc.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0))
        chunks.push(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
        const rms = Math.sqrt(sum / data.length)
        const dt = data.length / rate
        elapsed += dt
        // Adaptive noise floor so a fan or room tone doesn't count as speech.
        if (!heard) noise = noise * 0.95 + rms * 0.05
        this.level = Math.min(1, rms * 9)
        const speaking = rms > Math.max(0.018, noise * 2.6)
        if (speaking) {
          heard = true
          silentFor = 0
        } else silentFor += dt
        if (this.stopRequested) {
          this.stopRequested = false
          return heard ? finish({ wav: encodeWav(downsample(concat(chunks), rate, 16000), 16000) }) : finish({ cancelled: true, reason: 'manual' })
        }
        if (!heard && elapsed > 7) return finish({ cancelled: true, reason: 'silence' })
        if ((heard && silentFor > 1.1) || elapsed > 30) finish({ wav: encodeWav(downsample(concat(chunks), rate, 16000), 16000) })
      }
      src.connect(proc)
      proc.connect(this.ctx!.destination)
    })
  }

  stop() {
    this.stopRequested = true
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/**
 * Sentence-pipelined speech: synthesizes chunk n+1 while chunk n plays, so the
 * first words start quickly. `level` follows the audio actually playing.
 */
export class Speaker {
  private ctx = new AudioContext()
  private analyser = this.ctx.createAnalyser()
  private data = new Uint8Array(512)
  private generation = 0
  private source: AudioBufferSourceNode | null = null
  speaking = false
  onChange: (speaking: boolean) => void = () => {}

  constructor(private synth: (text: string) => Promise<ArrayBuffer>) {
    this.analyser.fftSize = 512
    this.analyser.connect(this.ctx.destination)
  }

  level = () => {
    if (!this.speaking) return 0
    this.analyser.getByteTimeDomainData(this.data)
    let sum = 0
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128
      sum += v * v
    }
    return Math.min(1, Math.sqrt(sum / this.data.length) * 5)
  }

  async speak(text: string): Promise<void> {
    this.stop()
    const gen = ++this.generation
    const chunks = chunk(splitSentences(text))
    if (!chunks.length) return
    await this.ctx.resume()
    this.set(true)
    let next = this.synth(chunks[0])
    try {
      for (let i = 0; i < chunks.length; i++) {
        const wav = await next
        if (gen !== this.generation) return
        if (i + 1 < chunks.length) next = this.synth(chunks[i + 1])
        const audio = await this.ctx.decodeAudioData(wav.slice(0))
        if (gen !== this.generation) return
        await this.play(audio)
        if (gen !== this.generation) return
      }
    } finally {
      if (gen === this.generation) this.set(false)
    }
  }

  private play(audio: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      const src = this.ctx.createBufferSource()
      src.buffer = audio
      src.connect(this.analyser)
      src.onended = () => resolve()
      this.source = src
      src.start()
    })
  }

  /** Stops audio only. It never cancels or undoes work. */
  stop() {
    this.generation++
    try {
      this.source?.stop()
    } catch {
      // already stopped
    }
    this.source = null
    this.set(false)
  }

  private set(v: boolean) {
    if (this.speaking !== v) {
      this.speaking = v
      this.onChange(v)
    }
  }
}

/** Merge short sentences so each synthesis call has enough text to sound natural. */
function chunk(sentences: string[]): string[] {
  const out: string[] = []
  for (const s of sentences) {
    const lastIdx = out.length - 1
    // The first sentence stays alone so speech starts as early as possible.
    if (lastIdx >= 1 && out[lastIdx].length < 60) out[lastIdx] += ` ${s}`
    else out.push(s)
  }
  return out
}
