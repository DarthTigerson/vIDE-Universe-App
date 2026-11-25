// Background pulls of the sandbox image. The image is a few hundred MB, far more
// than an agent tool call can wait for (vIDE cuts tools off at 60s), so the pull
// runs as its own process that no tool timeout can kill, and callers only peek
// at its progress. A finished or failed pull is remembered per image name.
import type { MainVideApi } from '../vide'

type Spawn = MainVideApi['process']['spawn']

export type PullState = 'idle' | 'pulling' | 'ready' | 'failed'

export interface PullStatus {
  image: string
  state: PullState
  // Layer counts from `docker pull` output; total grows as layers are announced.
  layersDone: number
  layersTotal: number
  error?: string
}

// Folds `docker pull` output (non-TTY: one "<layer>: <status>" line per change)
// into per-layer states. Exported for tests.
export function parsePullOutput(text: string, layers: Map<string, string>): void {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{12}): (.+)$/.exec(line.trim())
    if (m) layers.set(m[1], m[2])
  }
}

export function countLayers(layers: Map<string, string>): { done: number; total: number } {
  let done = 0
  for (const s of layers.values()) if (/^(Pull complete|Already exists)/.test(s)) done++
  return { done, total: layers.size }
}

export function describePull(p: PullStatus): string {
  const layers = p.layersTotal > 0 ? `, ${p.layersDone} of ${p.layersTotal} layers done` : ''
  return `downloading${layers}`
}

const MAX_ERROR_CHARS = 400

export class ImagePuller {
  private pulls = new Map<string, PullStatus>()
  private waiters = new Map<string, Array<() => void>>()

  constructor(private spawn: Spawn, private onChange: (p: PullStatus) => void = () => {}) {}

  status(image: string): PullStatus {
    return this.pulls.get(image) ?? { image, state: 'idle', layersDone: 0, layersTotal: 0 }
  }

  // Starts a pull unless one for this image is already running.
  start(image: string): PullStatus {
    const cur = this.pulls.get(image)
    if (cur?.state === 'pulling') return cur
    const layers = new Map<string, string>()
    let tail = ''
    const p: PullStatus = { image, state: 'pulling', layersDone: 0, layersTotal: 0 }
    this.pulls.set(image, p)
    this.onChange(p)
    const update = () => {
      const c = countLayers(layers)
      if (c.done !== p.layersDone || c.total !== p.layersTotal) {
        p.layersDone = c.done
        p.layersTotal = c.total
        this.onChange(p)
      }
    }
    // No windowId: the pull belongs to no window and must outlive the one that asked.
    this.spawn('docker', ['pull', image], {
      onStdout: (chunk) => { parsePullOutput(chunk, layers); update() },
      onStderr: (chunk) => { tail = (tail + chunk).slice(-MAX_ERROR_CHARS) },
      onExit: (code) => {
        if (code === 0) {
          p.state = 'ready'
          p.layersDone = p.layersTotal
        } else {
          p.state = 'failed'
          p.error = tail.trim() || `docker pull exited with code ${code}`
        }
        this.onChange(p)
        for (const w of this.waiters.get(image) ?? []) w()
        this.waiters.delete(image)
      },
    })
    return p
  }

  // Resolves when the pull for image ends or after ms, whichever is first.
  wait(image: string, ms: number): Promise<PullStatus> {
    if (this.status(image).state !== 'pulling') return Promise.resolve(this.status(image))
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(this.status(image)) }
      const timer = setTimeout(() => {
        const list = this.waiters.get(image)
        if (list) this.waiters.set(image, list.filter((w) => w !== done))
        resolve(this.status(image))
      }, ms)
      const list = this.waiters.get(image) ?? []
      list.push(done)
      this.waiters.set(image, list)
    })
  }

  // A local build or removal makes a remembered result stale.
  forget(image: string): void {
    if (this.pulls.get(image)?.state !== 'pulling') this.pulls.delete(image)
  }
}
