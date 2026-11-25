import { describe, it, expect, vi } from 'vitest'
import { MAX_READ_BYTES, MAX_WRITE_BYTES, confinePath, listFiles, readFile, writeFile } from '../files'
import type { Exec } from '../universe'

describe('confinePath', () => {
  it('resolves relative and absolute paths under /workspace', () => {
    expect(confinePath('a/b.txt')).toBe('/workspace/a/b.txt')
    expect(confinePath('./a//b.txt')).toBe('/workspace/a/b.txt')
    expect(confinePath('/workspace/x.py')).toBe('/workspace/x.py')
  })
  it('treats empty as the root only when allowed', () => {
    expect(confinePath('', true)).toBe('/workspace')
    expect(confinePath('.', true)).toBe('/workspace')
    expect(() => confinePath('')).toThrow(/required/)
    expect(() => confinePath('.')).toThrow(/file inside/)
  })
  it.each(['../etc/passwd', 'a/../../etc', '/workspace/../etc', 'a/..', '/etc/passwd', '/workspace2/x', '/', 'a\0b', 'a\nb'])('rejects %j', (p) => {
    expect(() => confinePath(p, true)).toThrow(/Invalid path/)
  })
  it('rejects non-strings', () => {
    expect(() => confinePath(undefined)).toThrow()
    expect(() => confinePath(5)).toThrow()
  })
})

const psLine = JSON.stringify({ Names: 'vide-universe-demo', State: 'running', Status: 'Up', Labels: 'vide.universe=1,vide.universe.name=demo' })

function fake(execStdout = '') {
  const calls: string[][] = []
  const exec = vi.fn(async (_b: string, args: string[]) => {
    calls.push(args)
    return { code: 0, stdout: args[0] === 'ps' ? psLine : execStdout, stderr: '' }
  }) as unknown as Exec
  return { exec, calls, last: () => calls[calls.length - 1] }
}

describe('writeFile', () => {
  it('passes path and base64 content as argv, never interpolated into the script', async () => {
    const { exec, last } = fake()
    await writeFile(exec, 'demo', 'src/a.py', 'print("hi"); $(rm -rf /)\n', false)
    const args = last()
    expect(args.slice(0, 4)).toEqual(['exec', '-u', '1000:1000', '-w'])
    expect(args).toContain('vide-universe-demo')
    expect(args[args.length - 2]).toBe('/workspace/src/a.py')
    expect(Buffer.from(args[args.length - 1], 'base64').toString()).toBe('print("hi"); $(rm -rf /)\n')
    expect(args.find((a) => a.includes('base64 -d'))).not.toContain('rm -rf')
  })
  it('uses >> when appending', async () => {
    const { exec, last } = fake()
    await writeFile(exec, 'demo', 'a.txt', 'x', true)
    expect(last().some((a) => a.includes('>> "$1"'))).toBe(true)
  })
  it('rejects traversal before touching docker', async () => {
    const { exec, calls } = fake()
    await expect(writeFile(exec, 'demo', '../x', 'y', false)).rejects.toThrow(/Invalid path/)
    expect(calls).toHaveLength(0)
  })
  it('rejects oversize content', async () => {
    const { exec } = fake()
    await expect(writeFile(exec, 'demo', 'a', 'x'.repeat(MAX_WRITE_BYTES + 1), false)).rejects.toThrow(/limit/)
  })
})

describe('readFile', () => {
  it('returns content', async () => {
    expect(await readFile(fake('hello').exec, 'demo', 'a.txt')).toBe('hello')
  })
  it('truncates large output and says so', async () => {
    const out = await readFile(fake('x'.repeat(MAX_READ_BYTES + 1)).exec, 'demo', 'big.txt')
    expect(out).toContain('[truncated')
    expect(out.length).toBeLessThan(MAX_READ_BYTES + 200)
  })
  it('rejects paths outside the workspace', async () => {
    await expect(readFile(fake().exec, 'demo', '/etc/shadow')).rejects.toThrow(/Invalid path/)
  })
})

describe('listFiles', () => {
  it('formats folders and files', async () => {
    const out = await listFiles(fake('d 4096 src\nf 12 src/a.py\n').exec, 'demo', undefined)
    expect(out).toBe('/workspace:\nsrc/\nsrc/a.py  (12 B)')
  })
  it('reports empty folders', async () => {
    expect(await listFiles(fake('').exec, 'demo', 'x')).toContain('is empty')
  })
  it('rejects traversal', async () => {
    await expect(listFiles(fake().exec, 'demo', '../..')).rejects.toThrow(/Invalid path/)
  })
})
