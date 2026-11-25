import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_FILE_BYTES, copyProjectIn, describeSkipped, stageProject } from '../project'
import type { Exec } from '../universe'

let root: string
let staged: string[] = []
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'proj-test-')); staged = [] })
afterEach(() => { rmSync(root, { recursive: true, force: true }); staged.forEach((d) => rmSync(d, { recursive: true, force: true })) })

const put = (rel: string, content = 'x') => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}
const stage = () => { const s = stageProject(root); staged.push(s.dir); return s }
const files = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]))

describe('stageProject', () => {
  it('copies source and skips deps, vcs, build output and secrets', () => {
    put('src/a.ts'); put('README.md'); put('package.json')
    put('node_modules/x/index.js'); put('.git/config'); put('dist/out.js'); put('src/__pycache__/a.pyc')
    put('.env'); put('.env.local'); put('certs/server.pem'); put('.DS_Store')
    const s = stage()
    expect(files(s.dir).sort()).toEqual(['README.md', 'package.json', 'src/a.ts'])
    expect(s.files).toBe(3)
    const text = describeSkipped(s)
    expect(text).toContain('dependency/build/cache folders')
    expect(text).toContain('secrets')
  })

  it('skips symlinks', () => {
    put('a.txt')
    symlinkSync('/etc/passwd', join(root, 'link'))
    const s = stage()
    expect(files(s.dir)).toEqual(['a.txt'])
    expect(s.skipped.some((x) => x.reason === 'symlinks')).toBe(true)
  })

  it('skips oversize files', () => {
    put('big.bin', 'x'.repeat(MAX_FILE_BYTES + 1)); put('ok.txt')
    expect(files(stage().dir)).toEqual(['ok.txt'])
  })

  it('makes staged files writable for the sandbox user', () => {
    put('a.txt')
    const s = stage()
    expect(statSync(join(s.dir, 'a.txt')).mode & 0o666).toBe(0o666)
  })

  it('rejects missing folders, files and the filesystem root', () => {
    expect(() => stageProject('/definitely/not/here')).toThrow(/does not exist/)
    put('f.txt')
    expect(() => stageProject(join(root, 'f.txt'))).toThrow(/not a folder/)
    expect(() => stageProject('/')).toThrow(/Refusing/)
  })

  it('says when nothing was skipped', () => {
    put('a.txt')
    expect(describeSkipped(stage())).toBe('Nothing was skipped.')
  })
})

describe('copyProjectIn', () => {
  it('explains when the project path is unavailable', async () => {
    await expect(copyProjectIn(vi.fn() as unknown as Exec, 'demo', undefined)).rejects.toThrow(/project folder is not available/)
  })

  it('uses docker cp into the container volume and cleans up staging', async () => {
    put('a.txt')
    const calls: string[][] = []
    const exec = (async (_b: string, args: string[]) => { calls.push(args); return { code: 0, stdout: '', stderr: '' } }) as unknown as Exec
    const msg = await copyProjectIn(exec, 'demo', root)
    expect(msg).toContain('Copied 1 files')
    const cp = calls[0]
    expect(cp[0]).toBe('cp')
    expect(cp[2]).toBe('vide-universe-demo:/workspace')
    expect(existsSync(cp[1].replace(/\/\.$/, ''))).toBe(false)
    expect(calls.flat().join(' ')).not.toMatch(/-v |--mount|--volume/)
  })
})
