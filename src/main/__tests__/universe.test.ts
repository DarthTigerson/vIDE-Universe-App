import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_CONFIG,
  buildRunArgs,
  checkDockerStatus,
  createUniverse,
  destroyUniverse,
  formatAge,
  formatBytes,
  parseUniverses,
  requireRunning,
  sanitizeConfig,
  validateName,
  type Exec,
} from '../universe'

const run = buildRunArgs('demo', DEFAULT_CONFIG, '2026-01-01T00:00:00.000Z')
const has = (args: string[], flag: string, value?: string) => {
  const i = args.indexOf(flag)
  return i !== -1 && (value === undefined || args[i + 1] === value)
}

describe('validateName', () => {
  it('accepts slugs and lowercases', () => {
    expect(validateName('demo')).toBe('demo')
    expect(validateName('  My-Test-1 ')).toBe('my-test-1')
  })
  it.each(['', '-x', 'a b', 'a/b', '../x', 'a;rm', 'x'.repeat(31), 'a_b', 'é', 5, null])('rejects %j', (n) => {
    expect(() => validateName(n)).toThrow(/Invalid universe name/)
  })
})

describe('sanitizeConfig', () => {
  it('uses defaults for empty input', () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG)
  })
  it('clamps limits and drops unsafe image names', () => {
    const c = sanitizeConfig({ image: '--privileged', cpus: 999, memoryMb: 1, pids: 'abc', cleanupDays: -3 })
    expect(c.image).toBe(DEFAULT_CONFIG.image)
    expect(c.cpus).toBe(16)
    expect(c.memoryMb).toBe(256)
    expect(c.pids).toBe(DEFAULT_CONFIG.pids)
    expect(c.cleanupDays).toBe(0)
  })
  it('keeps a normal registry image', () => {
    expect(sanitizeConfig({ image: 'ghcr.io/me/img:1.2' }).image).toBe('ghcr.io/me/img:1.2')
  })
})

describe('buildRunArgs containment', () => {
  it('always seals the container', () => {
    expect(has(run, '--network', 'none')).toBe(true)
    expect(has(run, '--user', '1000:1000')).toBe(true)
    expect(has(run, '--cap-drop', 'ALL')).toBe(true)
    expect(has(run, '--security-opt', 'no-new-privileges')).toBe(true)
    expect(run).toContain('--read-only')
    expect(run.some((a) => a.startsWith('/tmp:') && a.includes('size='))).toBe(true)
    expect(has(run, '--tmpfs')).toBe(true)
    expect(has(run, '-w', '/workspace')).toBe(true)
    expect(has(run, '--memory', '2048m')).toBe(true)
    expect(has(run, '--memory-swap', '2048m')).toBe(true)
    expect(has(run, '--cpus', '2')).toBe(true)
    expect(has(run, '--pids-limit', '256')).toBe(true)
    expect(has(run, '--entrypoint', 'sleep')).toBe(true)
    expect(run.slice(-2)).toEqual([DEFAULT_CONFIG.image, 'infinity'])
  })

  it('labels the container and names it from the slug', () => {
    expect(has(run, '--name', 'vide-universe-demo')).toBe(true)
    expect(run).toContain('vide.universe=1')
    expect(run).toContain('vide.universe.name=demo')
    expect(run).toContain('vide.universe.created=2026-01-01T00:00:00.000Z')
  })

  it('only mounts the named volume, never a host path or the docker socket', () => {
    const mounts = run.flatMap((a, i) => (a === '-v' || a === '--volume' || a === '--mount' ? [run[i + 1]] : []))
    expect(mounts).toEqual(['vide-universe-demo:/workspace'])
    expect(run.join(' ')).not.toMatch(/docker\.sock|--privileged|--cap-add|--network host|--pid[ =]|--ipc|--device|--userns|--security-opt (seccomp|apparmor)=unconfined/)
  })

  it('applies the user caps from settings', () => {
    const args = buildRunArgs('demo', sanitizeConfig({ cpus: 4, memoryMb: 4096, pids: 512 }), 'x')
    expect(has(args, '--cpus', '4')).toBe(true)
    expect(has(args, '--memory', '4096m')).toBe(true)
    expect(has(args, '--pids-limit', '512')).toBe(true)
  })

  it('cannot be weakened through extra properties on the config', () => {
    const evil = { ...DEFAULT_CONFIG, network: 'host', extraArgs: ['--privileged', '-v', '/:/host'], capAdd: ['ALL'], user: 'root' }
    const args = buildRunArgs('demo', sanitizeConfig(evil), 'x')
    expect(args).toEqual(buildRunArgs('demo', DEFAULT_CONFIG, 'x'))
  })

  it('does not let an evil image name inject flags', () => {
    const args = buildRunArgs('demo', sanitizeConfig({ image: 'img --privileged' }), 'x')
    expect(args).not.toContain('--privileged')
    expect(args).toEqual(buildRunArgs('demo', DEFAULT_CONFIG, 'x'))
  })
})

function fakeExec(handler: (args: string[]) => Partial<Awaited<ReturnType<Exec>>>) {
  const calls: string[][] = []
  const exec = vi.fn(async (_bin: string, args: string[]) => {
    calls.push(args)
    return { code: 0, stdout: '', stderr: '', ...handler(args) }
  }) as unknown as Exec
  return { exec, calls }
}

const psLine = (name: string, state = 'running', created = '2026-01-01T00:00:00.000Z') =>
  JSON.stringify({ Names: `vide-universe-${name}`, State: state, Status: 'Up', Labels: `vide.universe=1,vide.universe.name=${name},vide.universe.created=${created}` })

describe('parseUniverses', () => {
  it('reads name, state and created label', () => {
    const [u] = parseUniverses(psLine('demo'))
    expect(u.name).toBe('demo')
    expect(u.state).toBe('running')
    expect(u.createdMs).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
  })
  it('ignores containers whose name does not match their label', () => {
    const line = JSON.stringify({ Names: 'other', State: 'running', Status: 'Up', Labels: 'vide.universe=1,vide.universe.name=demo' })
    expect(parseUniverses(line)).toEqual([])
  })
})

describe('createUniverse / destroyUniverse', () => {
  it('creates the labelled volume, then runs the sealed container', async () => {
    const { exec, calls } = fakeExec((a) => (a[0] === 'ps' ? { stdout: '' } : {}))
    await createUniverse(exec, 'demo', DEFAULT_CONFIG)
    const names = calls.map((a) => a[0] + ' ' + (a[1] ?? ''))
    expect(names.indexOf('volume create')).toBeLessThan(names.indexOf('run -d'))
    const runArgs = calls.find((a) => a[0] === 'run')!
    expect(has(runArgs, '--network', 'none')).toBe(true)
  })

  it('every docker call from create contains no privileged or host-mount flags', async () => {
    const { exec, calls } = fakeExec((a) => (a[0] === 'ps' ? { stdout: '' } : {}))
    await createUniverse(exec, 'demo', DEFAULT_CONFIG)
    expect(calls.flat().join(' ')).not.toMatch(/--privileged|--cap-add|docker\.sock|--network host|--pid host/)
  })

  it('refuses a duplicate name', async () => {
    const { exec } = fakeExec((a) => (a[0] === 'ps' ? { stdout: psLine('demo') } : {}))
    await expect(createUniverse(exec, 'demo', DEFAULT_CONFIG)).rejects.toThrow(/already exists/)
  })

  it('refuses beyond the universe limit', async () => {
    const lines = Array.from({ length: 8 }, (_, i) => psLine(`u${i}`)).join('\n')
    const { exec } = fakeExec((a) => (a[0] === 'ps' ? { stdout: lines } : {}))
    await expect(createUniverse(exec, 'extra', DEFAULT_CONFIG)).rejects.toThrow(/limit reached/)
  })

  it('tells the user to build locally when the image cannot be pulled', async () => {
    const { exec } = fakeExec((a) => (a[0] === 'ps' ? { stdout: '' } : a[0] === 'image' || a[0] === 'pull' ? { code: 1, stderr: 'nope' } : {}))
    await expect(createUniverse(exec, 'demo', DEFAULT_CONFIG)).rejects.toThrow(/Build image locally/)
  })

  it('removes the volume if the run fails', async () => {
    const { exec, calls } = fakeExec((a) => (a[0] === 'ps' ? { stdout: '' } : a[0] === 'run' ? { code: 1, stderr: 'boom' } : {}))
    await expect(createUniverse(exec, 'demo', DEFAULT_CONFIG)).rejects.toThrow('boom')
    expect(calls.some((a) => a[0] === 'volume' && a[1] === 'rm')).toBe(true)
  })

  it('destroys container and volume of a labelled universe only', async () => {
    const { exec, calls } = fakeExec((a) => (a[0] === 'ps' ? { stdout: psLine('demo') } : {}))
    await destroyUniverse(exec, 'demo')
    expect(calls.some((a) => a[0] === 'rm' && a.includes('vide-universe-demo'))).toBe(true)
    expect(calls.some((a) => a[0] === 'volume' && a[1] === 'rm' && a.includes('vide-universe-demo'))).toBe(true)
    const { exec: e2, calls: c2 } = fakeExec(() => ({ stdout: '' }))
    await expect(destroyUniverse(e2, 'demo')).rejects.toThrow(/No universe named/)
    expect(c2.some((a) => a[0] === 'rm')).toBe(false)
  })
})

describe('requireRunning', () => {
  it('starts an exited universe', async () => {
    const { exec, calls } = fakeExec((a) => (a[0] === 'ps' ? { stdout: psLine('demo', 'exited') } : {}))
    await requireRunning(exec, 'demo')
    expect(calls.some((a) => a[0] === 'start')).toBe(true)
  })
  it('gives an actionable error when Docker is down', async () => {
    const { exec } = fakeExec(() => ({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' }))
    await expect(requireRunning(exec, 'demo')).rejects.toThrow(/Docker is not running/)
  })
  it('says when docker is not installed', async () => {
    const { exec } = fakeExec(() => ({ code: -1, errorCode: 'ENOENT' }))
    await expect(requireRunning(exec, 'demo')).rejects.toThrow(/not installed/)
  })
})

describe('misc', () => {
  it('reports docker status', async () => {
    expect(await checkDockerStatus(fakeExec(() => ({})).exec)).toBe('running')
    expect(await checkDockerStatus(fakeExec(() => ({ code: -1, errorCode: 'ENOENT' })).exec)).toBe('not-installed')
    expect(await checkDockerStatus(fakeExec(() => ({ code: 1 })).exec)).toBe('stopped')
  })
  it('formats age and size', () => {
    expect(formatAge(0, 30_000)).toBe('30s')
    expect(formatAge(0, 3 * 3600_000)).toBe('3h')
    expect(formatAge(0, 3 * 86400_000)).toBe('3d')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(undefined)).toBe('?')
  })
})
