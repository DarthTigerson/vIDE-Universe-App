// Shapes returned by main.js (see src/main/universe.ts).
export type DockerStatus = 'not-installed' | 'stopped' | 'running' | 'unknown'

export interface Universe {
  name: string
  container: string
  state: string
  status: string
  createdMs: number | null
  sizeBytes?: number
}

export interface ActionResult {
  ok: boolean
  error?: string
}

// Background image pull (see src/main/imagePull.ts).
export interface PullStatus {
  image: string
  state: 'idle' | 'pulling' | 'ready' | 'failed'
  layersDone: number
  layersTotal: number
  error?: string
}

export interface ImageStatus {
  present: boolean
  pull: PullStatus
}
