// File tools: paths are confined to /workspace, and file content travels as
// arguments (base64 for writes) because vide.process.exec has no stdin.
import { UniverseError, WORKSPACE, containerName, docker, requireRunning, type Exec } from './universe'

export const MAX_WRITE_BYTES = 64 * 1024
export const MAX_READ_BYTES = 32 * 1024
export const MAX_LIST_ENTRIES = 300

// Resolves an agent-supplied path to an absolute /workspace path. Any ".."
// segment is rejected outright (not normalised away), as are NUL bytes and
// absolute paths outside /workspace.
export function confinePath(raw: unknown, allowRoot = false): string {
  if (typeof raw !== 'string' || (!allowRoot && raw.trim() === '')) throw new UniverseError('path is required.')
  const input = raw.trim() === '' ? '.' : raw
  if (/[\0\n\r]/.test(input)) throw new UniverseError('Invalid path: control characters are not allowed.')
  const abs = input.startsWith('/') ? input : `${WORKSPACE}/${input}`
  const parts = abs.split('/').filter((s) => s !== '' && s !== '.')
  if (parts.includes('..')) throw new UniverseError('Invalid path: ".." is not allowed. Paths must stay inside /workspace.')
  const resolved = '/' + parts.join('/')
  if (resolved !== WORKSPACE && !resolved.startsWith(WORKSPACE + '/')) {
    throw new UniverseError(`Invalid path "${input}": only paths inside ${WORKSPACE} are allowed.`)
  }
  if (!allowRoot && resolved === WORKSPACE) throw new UniverseError('path must name a file inside /workspace.')
  return resolved
}

const sh = (exec: Exec, name: string, script: string, args: string[], timeoutMs = 15000, windowId?: number) =>
  docker(exec, ['exec', '-u', '1000:1000', '-w', WORKSPACE, containerName(name), 'sh', '-c', script, '_', ...args], { timeoutMs, windowId })

export async function writeFile(exec: Exec, name: string, rawPath: unknown, content: unknown, append: unknown, windowId?: number): Promise<string> {
  const path = confinePath(rawPath)
  if (typeof content !== 'string') throw new UniverseError('content must be a string.')
  const buf = Buffer.from(content, 'utf8')
  if (buf.length > MAX_WRITE_BYTES) {
    throw new UniverseError(`content is ${buf.length} bytes; the limit is ${MAX_WRITE_BYTES} per call. Split it across several calls with append=true.`)
  }
  await requireRunning(exec, name)
  const op = append === true ? '>>' : '>'
  await sh(exec, name, `mkdir -p -- "$(dirname -- "$1")" && printf %s "$2" | base64 -d ${op} "$1"`, [path, buf.toString('base64')], 15000, windowId)
  return `${append === true ? 'Appended' : 'Wrote'} ${buf.length} bytes to ${path} in universe "${name}".`
}

export async function readFile(exec: Exec, name: string, rawPath: unknown, windowId?: number): Promise<string> {
  const path = confinePath(rawPath)
  await requireRunning(exec, name)
  // Read one byte past the cap so truncation is detectable.
  const r = await sh(exec, name, 'test -f "$1" || { echo "not a file: $1" >&2; exit 2; }; head -c "$2" -- "$1"', [path, String(MAX_READ_BYTES + 1)], 15000, windowId)
  const buf = Buffer.from(r.stdout, 'utf8')
  if (buf.length > MAX_READ_BYTES) {
    return `${buf.subarray(0, MAX_READ_BYTES).toString('utf8')}\n[truncated: showing the first ${MAX_READ_BYTES} bytes of ${path}]`
  }
  return r.stdout
}

export async function listFiles(exec: Exec, name: string, rawPath: unknown, windowId?: number): Promise<string> {
  const path = confinePath(rawPath ?? '', true)
  await requireRunning(exec, name)
  const r = await sh(
    exec,
    name,
    'test -d "$1" || { echo "not a folder: $1" >&2; exit 2; }; find "$1" -mindepth 1 -maxdepth 2 -printf "%y %s %P\\n" | sort -k3 | head -n "$2"',
    [path, String(MAX_LIST_ENTRIES + 1)],
    15000,
    windowId,
  )
  const lines = r.stdout.split('\n').filter(Boolean)
  if (lines.length === 0) return `${path} is empty.`
  const shown = lines.slice(0, MAX_LIST_ENTRIES).map((l) => {
    const [type, size, ...rest] = l.split(' ')
    const p = rest.join(' ')
    return type === 'd' ? `${p}/` : `${p}  (${size} B)`
  })
  return `${path}:\n${shown.join('\n')}${lines.length > MAX_LIST_ENTRIES ? `\n[truncated: first ${MAX_LIST_ENTRIES} entries shown]` : ''}`
}
