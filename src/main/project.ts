// universe_create(from_project): copies the open project into a universe's
// volume. The project is first filtered into a private staging folder on the
// host, then `docker cp` streams that folder into the running container (the
// daemon writes into the named volume). Nothing is ever bind-mounted.
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { UniverseError, WORKSPACE, containerName, docker, formatBytes, type Exec } from './universe'

export const MAX_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_FILES = 20000

// Dependency, VCS, build and cache folders: large, regenerable, and (for .git)
// possibly holding credentials in remotes.
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit', '.turbo',
  '.cache', '.parcel-cache', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.gradle', '.idea', 'coverage', '.nyc_output', 'release',
])

// Files that commonly hold secrets, plus OS junk.
const SKIP_FILE = [/^\.env(\..*)?$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, /^\.npmrc$/, /^\.netrc$/, /^\.DS_Store$/, /^credentials(\.json)?$/i]

export interface StageResult {
  dir: string
  files: number
  bytes: number
  skipped: { reason: string; count: number; examples: string[] }[]
  truncated: boolean
}

export function stageProject(root: string, stageParent = tmpdir()): StageResult {
  const abs = resolve(root)
  if (abs === '/' || abs === resolve(homedir())) throw new UniverseError('Refusing to copy the filesystem root or home folder; open a specific project folder.')
  let st
  try { st = statSync(abs) } catch { throw new UniverseError(`The project folder "${abs}" does not exist.`) }
  if (!st.isDirectory()) throw new UniverseError(`The project path "${abs}" is not a folder.`)

  const dir = mkdtempSync(join(stageParent, 'universe-stage-'))
  const result: StageResult = { dir, files: 0, bytes: 0, skipped: [], truncated: false }
  const skip = (reason: string, rel: string) => {
    let s = result.skipped.find((x) => x.reason === reason)
    if (!s) result.skipped.push((s = { reason, count: 0, examples: [] }))
    s.count++
    if (s.examples.length < 3) s.examples.push(rel)
  }

  const walk = (rel: string): void => {
    if (result.truncated) return
    const names = readdirSync(join(abs, rel)).sort()
    for (const name of names) {
      const r = rel ? `${rel}/${name}` : name
      const full = join(abs, r)
      let l
      try { l = lstatSync(full) } catch { continue }
      if (l.isSymbolicLink()) { skip('symlinks', r); continue }
      if (l.isDirectory()) {
        if (SKIP_DIRS.has(name)) { skip('dependency/build/cache folders', r + '/'); continue }
        mkdirSync(join(dir, r), { recursive: true })
        chmodSync(join(dir, r), 0o777)
        walk(r)
        if (result.truncated) return
        continue
      }
      if (!l.isFile()) { skip('special files', r); continue }
      if (SKIP_FILE.some((re) => re.test(name))) { skip('secrets and junk files (.env*, keys, .DS_Store)', r); continue }
      if (l.size > MAX_FILE_BYTES) { skip(`files over ${formatBytes(MAX_FILE_BYTES)}`, r); continue }
      if (result.files >= MAX_FILES || result.bytes + l.size > MAX_TOTAL_BYTES) {
        result.truncated = true
        skip('not copied: size cap reached', r)
        return
      }
      // The copy lands owned by the host user's uid, so make it writable by uid 1000.
      copyFileSync(full, join(dir, r))
      chmodSync(join(dir, r), (l.mode & 0o777) | 0o666)
      result.files++
      result.bytes += l.size
    }
  }
  try {
    walk('')
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
  return result
}

export function describeSkipped(s: StageResult): string {
  const lines = s.skipped.map((x) => `- ${x.count} x ${x.reason} (e.g. ${x.examples.join(', ')})`)
  if (s.truncated) lines.push(`- Size cap reached (${formatBytes(MAX_TOTAL_BYTES)} / ${MAX_FILES} files): the rest of the project was NOT copied.`)
  return lines.length ? `Skipped:\n${lines.join('\n')}` : 'Nothing was skipped.'
}

export async function copyProjectIn(exec: Exec, name: string, root: string | undefined, windowId?: number): Promise<string> {
  if (!root) {
    throw new UniverseError(
      'The project folder is not available to this agent session (no vIDE window with an open project is known). ' +
        'Create the universe without from_project and write the files with universe_write_file, or ask the user to open the project in vIDE.',
    )
  }
  const staged = stageProject(root)
  try {
    if (staged.files === 0) return `Project copy: no files to copy. ${describeSkipped(staged)}`
    await docker(exec, ['cp', `${staged.dir}/.`, `${containerName(name)}:${WORKSPACE}`], { timeoutMs: 40000, windowId })
    return `Copied ${staged.files} files (${formatBytes(staged.bytes)}) from the project into /workspace. ${describeSkipped(staged)}`
  } finally {
    rmSync(staged.dir, { recursive: true, force: true })
  }
}
