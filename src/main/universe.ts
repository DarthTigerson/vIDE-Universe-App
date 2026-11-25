// The container mechanism: pure argument building plus a thin wrapper over the
// docker CLI (through `vide.process.exec`, which resolves the login-shell PATH).
//
// Containment is total by construction. Agents only ever supply a universe
// *name* (validated to a slug); every other part of `docker run` comes from this
// file or from user-only settings, and buildRunArgs() takes no free-form
// argument list, so there is nothing an agent could use to weaken the sandbox.
import type { MainVideApi } from '../vide'

export type Exec = MainVideApi['process']['exec']
type ExecOpts = { timeoutMs?: number; windowId?: number }

export const LABEL = 'vide.universe'
export const LABEL_NAME = 'vide.universe.name'
export const LABEL_CREATED = 'vide.universe.created'
export const PREFIX = 'vide-universe-'
export const WORKSPACE = '/workspace'
export const MAX_UNIVERSES = 8

export const DEFAULT_IMAGE = 'ghcr.io/darthtigerson/universe-base:latest'

// User-only settings (set from the app's settings page, pushed to main by the
// renderer). Agents have no tool that reads or writes them.
export interface UniverseConfig {
  image: string
  cpus: number
  memoryMb: number
  pids: number
  cleanupDays: number
}

export const DEFAULT_CONFIG: UniverseConfig = {
  image: DEFAULT_IMAGE,
  cpus: 2,
  memoryMb: 2048,
  pids: 256,
  cleanupDays: 7,
}

export interface UniverseInfo {
  name: string
  container: string
  state: string
  status: string
  createdMs: number | null
  sizeBytes?: number
}

export class UniverseError extends Error {}

// ---- names and settings ----

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,29}$/

// A universe name becomes part of a container and volume name, so it is a
// strict slug: it can never start with "-" (read as a flag) or hold a path.
export function validateName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!NAME_RE.test(name)) {
    throw new UniverseError('Invalid universe name: use 1-30 lowercase letters, digits or dashes, starting with a letter or digit.')
  }
  return name
}

export const containerName = (name: string) => PREFIX + name
export const volumeName = (name: string) => PREFIX + name

const IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/

function clamp(value: unknown, def: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

// Settings arrive from the renderer as strings; anything out of range is
// clamped and a bad image name falls back to the default (never passed to docker).
export function sanitizeConfig(raw: Partial<Record<keyof UniverseConfig, unknown>> | null | undefined): UniverseConfig {
  const r = raw ?? {}
  const image = typeof r.image === 'string' ? r.image.trim() : ''
  return {
    image: IMAGE_RE.test(image) ? image : DEFAULT_CONFIG.image,
    cpus: clamp(r.cpus, DEFAULT_CONFIG.cpus, 0.25, 16),
    memoryMb: Math.round(clamp(r.memoryMb, DEFAULT_CONFIG.memoryMb, 256, 65536)),
    pids: Math.round(clamp(r.pids, DEFAULT_CONFIG.pids, 32, 4096)),
    cleanupDays: Math.round(clamp(r.cleanupDays, DEFAULT_CONFIG.cleanupDays, 0, 365)),
  }
}

// ---- docker run ----

// Where the read-only root filesystem still lets tools write caches.
const ENV = {
  HOME: '/tmp/home',
  GOCACHE: '/tmp/go-cache',
  GOPATH: '/tmp/go',
  npm_config_cache: '/tmp/npm',
  XDG_CACHE_HOME: '/tmp/cache',
  PIP_NO_INDEX: '1',
}

export function buildCreateVolumeArgs(name: string, createdIso: string): string[] {
  return ['volume', 'create', '--label', `${LABEL}=1`, '--label', `${LABEL_NAME}=${name}`, '--label', `${LABEL_CREATED}=${createdIso}`, volumeName(name)]
}

// Every flag below is unconditional. The only inputs are the validated name,
// the user's image/limits, and a timestamp.
export function buildRunArgs(name: string, config: UniverseConfig, createdIso: string): string[] {
  const memory = `${config.memoryMb}m`
  return [
    'run', '-d',
    '--name', containerName(name),
    '--network', 'none',
    '--user', '1000:1000',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', '/tmp:rw,nosuid,size=256m,mode=1777',
    '-v', `${volumeName(name)}:${WORKSPACE}`,
    '-w', WORKSPACE,
    '--memory', memory,
    '--memory-swap', memory,
    '--cpus', String(config.cpus),
    '--pids-limit', String(config.pids),
    '--init',
    '--restart', 'no',
    '--label', `${LABEL}=1`,
    '--label', `${LABEL_NAME}=${name}`,
    '--label', `${LABEL_CREATED}=${createdIso}`,
    ...Object.entries(ENV).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '--entrypoint', 'sleep',
    config.image,
    'infinity',
  ]
}

// ---- docker CLI wrapper ----

export interface DockerRun {
  code: number
  stdout: string
  stderr: string
  timedOut?: boolean
  errorCode?: string
}

export function dockerNotRunning(r: DockerRun): UniverseError | null {
  if (r.errorCode === 'ENOENT') return new UniverseError('Docker is not installed: install Docker Desktop, Colima or OrbStack.')
  if (r.timedOut) return null
  if (r.code !== 0 && /Cannot connect to the Docker daemon|Is the docker daemon running|error during connect|daemon is not running/i.test(r.stderr)) {
    return new UniverseError('Docker is not running: start Docker Desktop, Colima or OrbStack.')
  }
  return null
}

export type DockerStatus = 'not-installed' | 'stopped' | 'running' | 'unknown'

export async function checkDockerStatus(exec: Exec): Promise<DockerStatus> {
  const r = await exec('docker', ['info', '--format', '{{.ID}}'], { timeoutMs: 5000 })
  if (r.code === 0) return 'running'
  if (r.errorCode === 'ENOENT') return 'not-installed'
  if (r.timedOut) return 'unknown'
  return 'stopped'
}

// Runs docker and throws an actionable error on failure.
export async function docker(exec: Exec, args: string[], opts?: ExecOpts, fallback = 'docker command failed'): Promise<DockerRun> {
  const r = await exec('docker', args, opts)
  const down = dockerNotRunning(r)
  if (down) throw down
  if (r.timedOut) throw new UniverseError(`docker ${args[0]} timed out.`)
  if (r.code !== 0) throw new UniverseError(r.stderr.trim() || r.stdout.trim() || fallback)
  return r
}

function parseLabels(labels: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of (labels ?? '').split(',')) {
    const eq = pair.indexOf('=')
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return out
}

export function parseUniverses(stdout: string): UniverseInfo[] {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const raw = JSON.parse(line) as Record<string, string>
      const labels = parseLabels(raw.Labels)
      const created = Date.parse(labels[LABEL_CREATED] ?? '')
      const name = labels[LABEL_NAME] ?? (raw.Names ?? '').replace(PREFIX, '')
      return {
        name,
        container: raw.Names,
        state: raw.State,
        status: raw.Status,
        createdMs: Number.isNaN(created) ? null : created,
      }
    })
    .filter((u) => u.container === containerName(u.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listUniverses(exec: Exec): Promise<UniverseInfo[]> {
  const r = await docker(exec, ['ps', '-a', '--filter', `label=${LABEL}=1`, '--format', '{{json .}}'], { timeoutMs: 8000 })
  return parseUniverses(r.stdout)
}

// Approximate: `du` inside the running container. Best effort, never throws.
export async function workspaceSize(exec: Exec, name: string): Promise<number | undefined> {
  const r = await exec('docker', ['exec', containerName(name), 'du', '-sk', WORKSPACE], { timeoutMs: 5000 })
  if (r.code !== 0) return undefined
  const kb = parseInt(r.stdout, 10)
  return Number.isFinite(kb) ? kb * 1024 : undefined
}

export async function getUniverse(exec: Exec, name: string): Promise<UniverseInfo | null> {
  return (await listUniverses(exec)).find((u) => u.name === name) ?? null
}

// Looks the universe up and makes sure it is running (Docker restarting leaves
// the container exited). Every tool that touches a universe goes through this.
export async function requireRunning(exec: Exec, name: string): Promise<UniverseInfo> {
  const u = await getUniverse(exec, name)
  if (!u) throw new UniverseError(`No universe named "${name}". Use universe_list to see what exists, or universe_create to make one.`)
  if (u.state !== 'running') {
    await docker(exec, ['start', u.container], { timeoutMs: 20000 })
    return { ...u, state: 'running' }
  }
  return u
}

// Make sure the image exists locally; otherwise try a bounded pull.
export async function ensureImage(exec: Exec, image: string): Promise<void> {
  const have = await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 8000 })
  const down = dockerNotRunning(have)
  if (down) throw down
  if (have.code === 0) return
  const pull = await exec('docker', ['pull', image], { timeoutMs: 40000 })
  if (pull.code === 0) return
  throw new UniverseError(
    `The sandbox image "${image}" is not available locally and could not be pulled` +
      `${pull.timedOut ? ' (timed out)' : ''}. Ask the user to open Settings > Universe and click "Build image locally".`,
  )
}

export async function createUniverse(exec: Exec, name: string, config: UniverseConfig, windowId?: number): Promise<UniverseInfo> {
  const existing = await listUniverses(exec)
  if (existing.some((u) => u.name === name)) throw new UniverseError(`A universe named "${name}" already exists.`)
  if (existing.length >= MAX_UNIVERSES) {
    throw new UniverseError(`Universe limit reached (${MAX_UNIVERSES}). Destroy one you no longer need with universe_destroy.`)
  }
  await ensureImage(exec, config.image)
  const createdIso = new Date().toISOString()
  await docker(exec, buildCreateVolumeArgs(name, createdIso), { timeoutMs: 15000, windowId })
  try {
    await docker(exec, buildRunArgs(name, config, createdIso), { timeoutMs: 30000, windowId })
  } catch (e) {
    await exec('docker', ['volume', 'rm', '-f', volumeName(name)], { timeoutMs: 10000 })
    throw e
  }
  return { name, container: containerName(name), state: 'running', status: 'Up', createdMs: Date.parse(createdIso) }
}

// Removes the container and volume, but only a container that carries our label.
export async function destroyUniverse(exec: Exec, name: string): Promise<void> {
  const u = await getUniverse(exec, name)
  if (!u) throw new UniverseError(`No universe named "${name}".`)
  await docker(exec, ['rm', '-f', '-v', u.container], { timeoutMs: 30000 })
  await docker(exec, ['volume', 'rm', '-f', volumeName(name)], { timeoutMs: 15000 })
}

export function formatAge(createdMs: number | null, now = Date.now()): string {
  if (createdMs === null) return 'unknown age'
  const s = Math.max(0, Math.round((now - createdMs) / 1000))
  if (s < 90) return `${s}s`
  if (s < 5400) return `${Math.round(s / 60)}m`
  if (s < 129600) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '?'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? Math.round(v * 10) / 10 : Math.round(v)} ${units[i]}`
}
