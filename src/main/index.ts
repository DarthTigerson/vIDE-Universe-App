// main.js entry: registers the Universe agent tools (sealed Docker sandboxes)
// and the handlers the panel and settings page call. Never imports electron.
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MainVideApi } from '../vide'
import * as u from './universe'
import { listFiles, readFile, writeFile } from './files'
import { execCommand, jobStatus } from './jobs'
import { copyProjectIn } from './project'

type Handle = { kill(): void }

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

// Removes universes older than `days` (0 = never). Returns the names removed.
export async function sweepOldUniverses(exec: u.Exec, days: number, now = Date.now()): Promise<string[]> {
  if (days <= 0) return []
  const removed: string[] = []
  for (const x of await u.listUniverses(exec)) {
    if (x.createdMs !== null && now - x.createdMs > days * 86400_000) {
      try {
        await u.destroyUniverse(exec, x.name)
        removed.push(x.name)
      } catch { /* best effort: try again next sweep */ }
    }
  }
  return removed
}

export function activate(vide: MainVideApi): void {
  const exec: u.Exec = (bin, args, opts) => vide.process.exec(bin, args, opts)
  const handle = (method: string, fn: (payload: any, ctx: { windowId: number }) => unknown) => vide.app.handle(method, fn)

  // User-only settings, pushed by the renderer. No agent tool reads or writes them.
  let config = u.DEFAULT_CONFIG
  // The open project folder per window, pushed by the renderer (ctx has only a windowId).
  const projects = new Map<number, string>()
  const projectFor = (windowId?: number): string | undefined => {
    if (windowId !== undefined && projects.has(windowId)) return projects.get(windowId)
    return projects.size === 1 ? [...projects.values()][0] : undefined
  }

  const tool = (name: string, fn: (args: Record<string, unknown>, windowId?: number) => Promise<string>) =>
    vide.agentTools.handle(name, (args, ctx) => fn(args ?? {}, ctx?.windowId))

  tool('universe_create', async (args, windowId) => {
    const name = u.validateName(args.name)
    const fromProject = args.from_project === true
    // Fail early, before creating anything, if the project can't be located.
    if (fromProject && !projectFor(windowId)) await copyProjectIn(exec, name, undefined)
    const created = await u.createUniverse(exec, name, config, windowId)
    let copied = ''
    if (fromProject) {
      try {
        copied = '\n' + (await copyProjectIn(exec, name, projectFor(windowId), windowId))
      } catch (e) {
        copied = `\nThe universe was created but the project copy failed: ${(e as Error).message}`
      }
    }
    return (
      `Created universe "${created.name}" (no network, non-root, ${config.cpus} CPUs, ${config.memoryMb} MB RAM, ${config.pids} pids). ` +
      `Working directory: /workspace.${copied}`
    )
  })

  tool('universe_list', async () => {
    const all = await u.listUniverses(exec)
    if (all.length === 0) return 'No universes. Create one with universe_create.'
    const sizes = await Promise.all(all.map((x) => (x.state === 'running' ? u.workspaceSize(exec, x.name) : undefined)))
    return all
      .map((x, i) => `${x.name}  ${x.state}  age ${u.formatAge(x.createdMs)}  workspace ~${u.formatBytes(sizes[i])}`)
      .join('\n')
  })

  tool('universe_write_file', async (a, w) => writeFile(exec, u.validateName(a.name), a.path, a.content, a.append, w))
  tool('universe_read_file', async (a, w) => readFile(exec, u.validateName(a.name), a.path, w))
  tool('universe_list_files', async (a, w) => listFiles(exec, u.validateName(a.name), a.path, w))
  tool('universe_exec', async (a, w) => execCommand(exec, u.validateName(a.name), a.command, w))
  tool('universe_job', async (a, w) => jobStatus(exec, u.validateName(a.name), a.job_id, a.wait_seconds, w))
  tool('universe_destroy', async (a) => {
    const name = u.validateName(a.name)
    await u.destroyUniverse(exec, name)
    return `Destroyed universe "${name}" (container and volume removed).`
  })

  // ---- panel and settings handlers (user only) ----
  const cleanup = () => { void sweepOldUniverses(exec, config.cleanupDays).catch(() => {}) }
  const timer = setInterval(cleanup, CLEANUP_INTERVAL_MS)
  timer.unref?.()
  stopTimer = () => clearInterval(timer)

  handle('status', () => u.checkDockerStatus(exec))
  handle('configure', (payload: { config?: Record<string, unknown>; projectRoot?: string | null }, ctx) => {
    if (payload?.config) config = u.sanitizeConfig(payload.config as never)
    if (payload && 'projectRoot' in payload) {
      if (payload.projectRoot) projects.set(ctx.windowId, payload.projectRoot)
      else projects.delete(ctx.windowId)
    }
    if (payload?.config) cleanup()
    return config
  })
  handle('list', async () => {
    const all = await u.listUniverses(exec)
    const sizes = await Promise.all(all.map((x) => (x.state === 'running' ? u.workspaceSize(exec, x.name) : undefined)))
    return all.map((x, i) => ({ ...x, sizeBytes: sizes[i] }))
  })
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); return { ok: true } } catch (e) { return { ok: false, error: (e as Error).message } }
  }
  handle('destroy', (name: string) => act(() => u.destroyUniverse(exec, u.validateName(name))))
  handle('destroyAll', (names: string[]) => act(async () => {
    for (const n of names) await u.destroyUniverse(exec, u.validateName(n))
  }))
  handle('openDocker', () => act(async () => {
    const mac = process.platform === 'darwin'
    const r = await exec(mac ? 'open' : 'systemctl', mac ? ['-a', 'Docker'] : ['--user', 'start', 'docker'])
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Failed to start Docker: try starting it manually.')
  }))

  // Export to host: the user picks a folder; /workspace is copied out with `docker cp`.
  handle('pickFolder', async () => {
    if (process.platform !== 'darwin') return null
    const r = await exec('osascript', ['-e', 'POSIX path of (choose folder with prompt "Export universe workspace to")'], { timeoutMs: 120000 })
    return r.code === 0 ? r.stdout.trim().replace(/\/$/, '') || null : null
  })
  handle('exportWorkspace', ({ name, dest }: { name: string; dest: string }, ctx) => act(async () => {
    const universe = u.validateName(name)
    if (typeof dest !== 'string' || !dest.startsWith('/')) throw new Error('Choose an absolute destination folder.')
    const target = join(dest, universe)
    if (existsSync(target)) throw new Error(`${target} already exists: pick another folder or remove it first.`)
    await u.requireRunning(exec, universe)
    mkdirSync(target, { recursive: true })
    await u.docker(exec, ['cp', `${u.containerName(universe)}:${u.WORKSPACE}/.`, target], { timeoutMs: 120000, windowId: ctx.windowId })
  }))

  // Build the bundled Dockerfile (dist/image) and tag it under the configured image name.
  let building: Handle | null = null
  handle('buildImage', (_p, ctx) => {
    if (building) return { ok: false, error: 'A build is already running.' }
    const dir = join(__dirname, 'image')
    if (!existsSync(join(dir, 'Dockerfile'))) return { ok: false, error: 'The bundled Dockerfile is missing from the app package.' }
    const windowId = ctx.windowId
    const send = (data: string) => vide.app.emit('build:data', { data }, { windowId })
    building = vide.process.spawn(
      'docker',
      ['build', '--progress=plain', '-t', config.image, dir],
      {
        onStdout: send,
        onStderr: send,
        onExit: (code) => { building = null; vide.app.emit('build:done', { code: code ?? 1 }, { windowId }) },
      },
      { windowId },
    )
    return { ok: true }
  })
  handle('cancelBuild', () => { building?.kill(); return true })

  vide.windows.onClose((windowId) => { projects.delete(windowId) })
}

let stopTimer: () => void = () => {}
export function deactivate(): void {
  stopTimer()
}
