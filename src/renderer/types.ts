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
