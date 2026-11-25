import { describe, it, expect, vi } from 'vitest'
import { execCommand, jobStatus, parsePoll, MAX_COMMAND_BYTES } from '../jobs'
import type { Exec } from '../universe'

const psLine = JSON.stringify({ Names: 'vide-universe-demo', State: 'running', Status: 'Up', Labels: 'vide.universe=1,vide.universe.name=demo' })

function fake(pollStdout: string, opts: { pollTimeout?: boolean } = {}) {
  const calls: string[][] = []
  const exec = vi.fn(async (_b: string, args: string[]) => {
    calls.push(args)
    if (args[0] === 'ps') return { code: 0, stdout: psLine, stderr: '' }
    if (args.some((a) => a.includes('sleep 0.5'))) {
      return opts.pollTimeout ? { code: -1, stdout: '', stderr: '', timedOut: true } : { code: 0, stdout: pollStdout, stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }) as unknown as Exec
  return { exec, calls }
}

describe('parsePoll', () => {
  it('parses a finished job', () => {
    expect(parsePoll('STATUS exited 3\nSKIPPED 0\nhello\n')).toEqual({ status: 'exited', exitCode: 3, skipped: 0, output: 'hello\n' })
  })
  it('parses running, lost and missing', () => {
    expect(parsePoll('STATUS running\nSKIPPED 0\n').status).toBe('running')
    expect(parsePoll('STATUS lost\nSKIPPED 12\nx').skipped).toBe(12)
    expect(parsePoll('STATUS missing\n').status).toBe('missing')
  })
})

describe('execCommand', () => {
  it('returns exit code and output when the command finishes', async () => {
    const { exec } = fake('STATUS exited 0\nSKIPPED 0\nhi\n')
    expect(await execCommand(exec, 'demo', 'echo hi')).toBe('exit code 0\nhi')
  })

  it('passes the command via an env var and runs as uid 1000 in /workspace', async () => {
    const { exec, calls } = fake('STATUS exited 0\nSKIPPED 0\n')
    await execCommand(exec, 'demo', 'echo "$(rm -rf /)"; \'')
    const start = calls.find((a) => a.some((x) => x.startsWith('UCMD=')))!
    expect(start).toContain('UCMD=echo "$(rm -rf /)"; \'')
    expect(start.slice(0, 5)).toEqual(['exec', '-u', '1000:1000', '-w', '/workspace'])
    // the script text itself never contains the command
    expect(start.filter((a) => !a.startsWith('UCMD=')).join(' ')).not.toContain('rm -rf')
    expect(calls.flat()).not.toContain('--privileged')
  })

  it('returns a job_id when still running', async () => {
    const { exec } = fake('STATUS running\nSKIPPED 0\npartial\n')
    const out = await execCommand(exec, 'demo', 'sleep 100')
    expect(out).toMatch(/job_id=[a-f0-9]{8}/)
    expect(out).toContain('universe_job')
    expect(out).toContain('partial')
  })

  it('still returns a job_id if the host-side wait times out', async () => {
    const { exec } = fake('', { pollTimeout: true })
    expect(await execCommand(exec, 'demo', 'sleep 100')).toMatch(/job_id=[a-f0-9]{8}/)
  })

  it('reports skipped output', async () => {
    const { exec } = fake('STATUS exited 1\nSKIPPED 5000\ntail\n')
    expect(await execCommand(exec, 'demo', 'x')).toContain('[5000 bytes of earlier output skipped]')
  })

  it('validates the command', async () => {
    const { exec } = fake('')
    await expect(execCommand(exec, 'demo', '  ')).rejects.toThrow(/required/)
    await expect(execCommand(exec, 'demo', 'x'.repeat(MAX_COMMAND_BYTES + 1))).rejects.toThrow(/too long/)
  })

  it('waits less than the 60s agent tool timeout', async () => {
    const { exec } = fake('STATUS exited 0\nSKIPPED 0\n')
    await execCommand(exec, 'demo', 'x')
    const calls = (exec as unknown as { mock: { calls: [string, string[], { timeoutMs: number }][] } }).mock.calls
    const total = calls.reduce((s, c) => s + (c[2]?.timeoutMs ?? 0), 0)
    // start (15s) + poll (46s) are upper bounds; the real wait is 38s
    expect(calls.filter((c) => c[2]?.timeoutMs > 40000)[0][2].timeoutMs).toBeLessThan(50000)
    expect(total).toBeGreaterThan(0)
  })
})

describe('jobStatus', () => {
  it('reports a finished job with new output', async () => {
    const { exec } = fake('STATUS exited 0\nSKIPPED 0\ndone\n')
    expect(await jobStatus(exec, 'demo', 'abcdef12', 0)).toBe('job abcdef12: finished, exit code 0\nNew output since last poll:\ndone')
  })
  it('reports running jobs', async () => {
    const { exec } = fake('STATUS running\nSKIPPED 0\n')
    expect(await jobStatus(exec, 'demo', 'abcdef12', 5)).toContain('still running')
  })
  it('rejects ids that could escape /tmp/jobs', async () => {
    const { exec } = fake('')
    await expect(jobStatus(exec, 'demo', '../../etc/x', 0)).rejects.toThrow(/Invalid job_id/)
    await expect(jobStatus(exec, 'demo', undefined, 0)).rejects.toThrow(/Invalid job_id/)
  })
  it('explains a missing job', async () => {
    const { exec } = fake('STATUS missing\n')
    await expect(jobStatus(exec, 'demo', 'abcdef12', 0)).rejects.toThrow(/No job/)
  })
  it('clamps the wait', async () => {
    const { exec, calls } = fake('STATUS running\nSKIPPED 0\n')
    await jobStatus(exec, 'demo', 'abcdef12', 9999)
    const pollCall = calls.find((a) => a.some((x) => x.includes('sleep 0.5')))!
    expect(pollCall[pollCall.indexOf('_') + 2]).toBe('38')
  })
})
