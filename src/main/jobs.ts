// universe_exec and universe_job.
//
// Every command is a job that runs detached inside the container: under nohup,
// writing /tmp/jobs/<id>.log (stdout + stderr merged), a .pid file, and a .exit
// file when it finishes. A .off file remembers how much output has already been
// returned. This is deliberately not tracked host-side (a spawned `docker exec`
// per command): a host-side child dies with the vIDE window or a restart of
// vIDE, loses its output, and has no way to be polled again, whereas files in
// the container survive all of that and any number of polls. The cost is that
// /tmp is a tmpfs, so jobs vanish if the container restarts, and stdout and
// stderr are merged into one stream.
import { randomBytes } from 'node:crypto'
import { UniverseError, WORKSPACE, containerName, docker, requireRunning, type Exec } from './universe'

// Total tool time stays well under the 60s agent tool timeout.
export const MAX_WAIT_S = 38
export const MAX_OUTPUT_BYTES = 16 * 1024
export const MAX_COMMAND_BYTES = 32 * 1024

const JOB_ID_RE = /^[a-f0-9]{8}$/

const START_SCRIPT = `mkdir -p /tmp/jobs
: >"/tmp/jobs/$1.log"
nohup sh -c 'echo $$ >"/tmp/jobs/$0.pid"; sh -lc "$UCMD" >"/tmp/jobs/$0.log" 2>&1 </dev/null; echo $? >"/tmp/jobs/$0.exit.tmp"; mv "/tmp/jobs/$0.exit.tmp" "/tmp/jobs/$0.exit"' "$1" >/dev/null 2>&1 </dev/null &`

// args: id, wait seconds, max bytes. Prints "STATUS <s>", "SKIPPED <n>", then output.
const POLL_SCRIPT = `f=/tmp/jobs/$1
[ -f "$f.log" ] || { echo "STATUS missing"; exit 0; }
alive() { [ ! -f "$f.pid" ] || kill -0 "$(cat "$f.pid")" 2>/dev/null; }
i=0; max=$(( $2 * 2 ))
while [ ! -f "$f.exit" ] && alive && [ "$i" -lt "$max" ]; do sleep 0.5; i=$((i+1)); done
if [ -f "$f.exit" ]; then st="exited $(cat "$f.exit")"; elif alive; then st=running; else st=lost; fi
off=$(cat "$f.off" 2>/dev/null || echo 0)
size=$(wc -c <"$f.log")
n=$((size - off)); start=$off
if [ "$n" -gt "$3" ]; then start=$((size - $3)); n=$3; fi
echo "STATUS $st"
echo "SKIPPED $((start - off))"
tail -c +$((start + 1)) "$f.log" | head -c "$n"
echo $((start + n)) >"$f.off"`

export interface JobPoll {
  status: 'running' | 'exited' | 'lost' | 'missing'
  exitCode?: number
  skipped: number
  output: string
}

export function parsePoll(stdout: string): JobPoll {
  const nl1 = stdout.indexOf('\n')
  const head = (nl1 === -1 ? stdout : stdout.slice(0, nl1)).replace(/^STATUS /, '')
  if (head === 'missing') return { status: 'missing', skipped: 0, output: '' }
  const rest = nl1 === -1 ? '' : stdout.slice(nl1 + 1)
  const nl2 = rest.indexOf('\n')
  const skipped = parseInt((nl2 === -1 ? rest : rest.slice(0, nl2)).replace(/^SKIPPED /, ''), 10) || 0
  const output = nl2 === -1 ? '' : rest.slice(nl2 + 1)
  if (head.startsWith('exited ')) return { status: 'exited', exitCode: parseInt(head.slice(7), 10), skipped, output }
  if (head === 'lost') return { status: 'lost', skipped, output }
  return { status: 'running', skipped, output }
}

const execIn = (exec: Exec, name: string, script: string, args: string[], env: string[], timeoutMs: number, windowId?: number) =>
  docker(exec, ['exec', '-u', '1000:1000', '-w', WORKSPACE, ...env.flatMap((e) => ['-e', e]), containerName(name), 'sh', '-c', script, '_', ...args], { timeoutMs, windowId })

async function poll(exec: Exec, name: string, id: string, waitS: number, windowId?: number): Promise<JobPoll> {
  const r = await execIn(exec, name, POLL_SCRIPT, [id, String(waitS), String(MAX_OUTPUT_BYTES)], [], (waitS + 8) * 1000, windowId)
  return parsePoll(r.stdout)
}

function renderOutput(p: JobPoll): string {
  const skipped = p.skipped > 0 ? `[${p.skipped} bytes of earlier output skipped]\n` : ''
  return p.output ? `${skipped}${p.output}${p.output.endsWith('\n') ? '' : '\n'}` : skipped || '(no output)\n'
}

export async function execCommand(exec: Exec, name: string, command: unknown, windowId?: number): Promise<string> {
  if (typeof command !== 'string' || command.trim() === '') throw new UniverseError('command is required.')
  if (Buffer.byteLength(command) > MAX_COMMAND_BYTES) {
    throw new UniverseError(`command is too long (limit ${MAX_COMMAND_BYTES} bytes). Write it to a file with universe_write_file and run that.`)
  }
  await requireRunning(exec, name)
  const id = randomBytes(4).toString('hex')
  // The command travels in an environment variable, never inside the script text.
  await execIn(exec, name, START_SCRIPT, [id], [`UCMD=${command}`], 15000, windowId)
  let p: JobPoll
  try {
    p = await poll(exec, name, id, MAX_WAIT_S, windowId)
  } catch (e) {
    if (e instanceof UniverseError && /timed out/.test(e.message)) {
      return `The command is running in the background: job_id=${id}. Poll it with universe_job.`
    }
    throw e
  }
  if (p.status === 'exited') return `exit code ${p.exitCode}\n${renderOutput(p)}`.trimEnd()
  if (p.status === 'lost') return `The command (job_id=${id}) was killed before it finished (out of memory or pids limit?).\n${renderOutput(p)}`.trimEnd()
  return `Still running after ${MAX_WAIT_S}s: job_id=${id}. It keeps running in the background; poll it with universe_job.\nOutput so far:\n${renderOutput(p)}`.trimEnd()
}

export async function jobStatus(exec: Exec, name: string, jobId: unknown, waitSeconds: unknown, windowId?: number): Promise<string> {
  const id = typeof jobId === 'string' ? jobId.trim() : ''
  if (!JOB_ID_RE.test(id)) throw new UniverseError('Invalid job_id: use the job_id returned by universe_exec.')
  const w = typeof waitSeconds === 'number' && Number.isFinite(waitSeconds) ? Math.min(MAX_WAIT_S, Math.max(0, Math.floor(waitSeconds))) : 0
  await requireRunning(exec, name)
  const p = await poll(exec, name, id, w, windowId)
  if (p.status === 'missing') throw new UniverseError(`No job "${id}" in universe "${name}" (jobs are lost if the universe restarted).`)
  const state = p.status === 'exited' ? `finished, exit code ${p.exitCode}` : p.status === 'lost' ? 'killed before finishing' : 'still running'
  return `job ${id}: ${state}\nNew output since last poll:\n${renderOutput(p)}`.trimEnd()
}
