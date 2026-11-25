import { describe, it, expect, vi } from 'vitest'
import { activate, removeSymlinks, sweepOldUniverses } from '../index'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import manifest from '../../../manifest.json'
import type { MainVideApi } from '../../vide'

type ExecResult = { code: number; stdout: string; stderr: string }

function makeFake(execImpl: (args: string[]) => Partial<ExecResult> = () => ({})) {
  const tools = new Map<string, (a: Record<string, unknown>, ctx: { windowId?: number }) => Promise<unknown>>()
  const handlers = new Map<string, (p: any, ctx: { windowId: number }) => any>()
  const calls: string[][] = []
  const exec = vi.fn(async (_b: string, args: string[]) => {
    calls.push(args)
    return { code: 0, stdout: '', stderr: '', ...execImpl(args) }
  })
  const vide = {
    apiVersion: 1,
    appId: 'universe',
    app: { handle: (m: string, fn: any) => { handlers.set(m, fn); return () => {} }, emit: () => {} },
    agentTools: {
      handle: (n: string, fn: any) => {
        if (!manifest.agentTools.tools.some((t) => t.name === n)) throw new Error(`undeclared ${n}`)
        tools.set(n, fn)
        return () => {}
      },
    },
    process: { exec, spawn: () => ({ kill: () => {} }) },
    windows: { onClose: () => () => {} },
  } as unknown as MainVideApi
  activate(vide)
  return { tools, handlers, calls }
}

const ps = (name: string, created: string) =>
  JSON.stringify({ Names: `vide-universe-${name}`, State: 'running', Status: 'Up', Labels: `vide.universe=1,vide.universe.name=${name},vide.universe.created=${created}` })

describe('activate', () => {
  it('registers a handler for every declared tool', () => {
    const { tools } = makeFake()
    expect([...tools.keys()].sort()).toEqual(manifest.agentTools.tools.map((t) => t.name).sort())
  })

  it('rejects bad names before touching docker', async () => {
    const { tools, calls } = makeFake()
    await expect(tools.get('universe_create')!({ name: '../x' }, {})).rejects.toThrow(/Invalid universe name/)
    await expect(tools.get('universe_exec')!({ name: 'a b', command: 'ls' }, {})).rejects.toThrow(/Invalid universe name/)
    expect(calls).toHaveLength(0)
  })

  it('explains when from_project has no project path, without creating anything', async () => {
    const { tools, calls } = makeFake()
    await expect(tools.get('universe_create')!({ name: 'demo', from_project: true }, { windowId: 1 })).rejects.toThrow(/project folder is not available/)
    expect(calls).toHaveLength(0)
  })

  it('ignores agent attempts to pass docker options in tool args', async () => {
    const { tools, calls } = makeFake((a) => (a[0] === 'ps' ? { stdout: '' } : {}))
    await tools.get('universe_create')!({ name: 'demo', network: 'host', privileged: true, image: 'evil', args: ['--privileged'], from_project: false }, {})
    const run = calls.find((a) => a[0] === 'run')!
    expect(run[run.indexOf('--network') + 1]).toBe('none')
    expect(run).not.toContain('--privileged')
    expect(run).not.toContain('evil')
  })

  it('uses the user config pushed by the renderer, clamped', async () => {
    const { tools, handlers, calls } = makeFake((a) => (a[0] === 'ps' ? { stdout: '' } : {}))
    handlers.get('configure')!({ config: { cpus: 4, memoryMb: 4096, pids: 100000, image: 'my/img:1' } }, { windowId: 1 })
    await tools.get('universe_create')!({ name: 'demo' }, {})
    const run = calls.find((a) => a[0] === 'run')!
    expect(run[run.indexOf('--cpus') + 1]).toBe('4')
    expect(run[run.indexOf('--memory') + 1]).toBe('4096m')
    expect(run[run.indexOf('--pids-limit') + 1]).toBe('4096')
    expect(run).toContain('my/img:1')
  })

  it('lists universes compactly', async () => {
    const { tools } = makeFake((a) => (a[0] === 'ps' ? { stdout: ps('demo', new Date().toISOString()) } : a[0] === 'exec' ? { stdout: '2048\t/workspace' } : {}))
    const out = (await tools.get('universe_list')!({}, {})) as string
    expect(out).toMatch(/^demo\s+running\s+age \d+s\s+workspace ~2 MB$/)
  })
})

describe('sweepOldUniverses', () => {
  it('destroys only universes older than the threshold', async () => {
    const now = Date.parse('2026-02-01T00:00:00Z')
    const lines = [ps('old', '2026-01-01T00:00:00Z'), ps('fresh', '2026-01-31T00:00:00Z')].join('\n')
    const calls: string[][] = []
    const exec = (async (_b: string, args: string[]) => { calls.push(args); return { code: 0, stdout: args[0] === 'ps' ? lines : '', stderr: '' } }) as never
    expect(await sweepOldUniverses(exec, 7, now)).toEqual(['old'])
    expect(calls.some((a) => a[0] === 'rm' && a.includes('vide-universe-fresh'))).toBe(false)
    expect(await sweepOldUniverses(exec, 0, now)).toEqual([])
  })
})

describe('removeSymlinks', () => {
  it('deletes links at any depth and keeps real files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'universe-export-'))
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'real.txt'), 'x')
    symlinkSync('/etc/hosts', join(dir, 'top-link'))
    symlinkSync(join(dir, 'sub'), join(dir, 'sub', 'dir-link'))
    expect(removeSymlinks(dir)).toBe(2)
    expect(existsSync(join(dir, 'sub', 'real.txt'))).toBe(true)
  })
})
