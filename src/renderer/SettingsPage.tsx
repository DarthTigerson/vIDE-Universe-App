import { useEffect, useRef, useState } from 'react'
import { DEFAULTS, pushConfig, useUniverseSettingsStore, type SettingKey } from './settingsStore'
import { FeatureBlock, SettingRow } from './ui'
import { getVide } from './vide'
import type { ActionResult } from './types'

const inputClass = 'w-72 px-2 py-1 text-sm rounded-lg border border-border bg-bg text-fg font-mono'
const MAX_LOG_CHARS = 20000

// Edits locally and commits on blur/Enter so main isn't re-configured per keystroke.
function Field({ id, setting, type = 'text', min, max, step }: { id: string; setting: SettingKey; type?: string; min?: number; max?: number; step?: number }) {
  const value = useUniverseSettingsStore((s) => s.values[setting])
  const set = useUniverseSettingsStore((s) => s.set)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => { const v = draft.trim() === '' ? DEFAULTS[setting] : draft.trim(); setDraft(v); if (v !== value) set(setting, v) }
  return (
    <input
      id={id}
      className={inputClass}
      type={type}
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
    />
  )
}

function BuildImage() {
  const [building, setBuilding] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [log, setLog] = useState('')
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const vide = getVide()
    const offData = vide.app.on('build:data', (p) => setLog((l) => (l + String((p as { data?: string }).data ?? '')).slice(-MAX_LOG_CHARS)))
    const offDone = vide.app.on('build:done', (p) => {
      const code = (p as { code?: number }).code
      setBuilding(false)
      setResult(code === 0 ? { ok: true, text: 'Image built. New universes will use it.' } : { ok: false, text: `Build failed (exit ${code}). See the log below.` })
    })
    return () => { offData(); offDone() }
  }, [])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [log])

  async function build() {
    setBuilding(true)
    setResult(null)
    setLog('')
    pushConfig()
    const r = await getVide().app.call<ActionResult>('buildImage')
    if (!r.ok) { setBuilding(false); setResult({ ok: false, text: r.error ?? 'Could not start the build' }) }
  }

  return (
    <>
      <SettingRow label="Build image locally" description="Builds the bundled Dockerfile and tags it with the image name above. Needs internet, and takes a few minutes the first time.">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={building}
            onClick={build}
            className="px-4 py-1.5 text-sm rounded-lg border border-border text-fg hover:border-fg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {building ? 'Building...' : 'Build image locally'}
          </button>
          {building && (
            <button type="button" onClick={() => void getVide().app.call('cancelBuild')} className="px-3 py-1.5 text-sm rounded-lg border border-border text-fg-muted hover:text-fg">
              Cancel
            </button>
          )}
        </div>
      </SettingRow>
      {result && <p className={`text-xs mb-2 ${result.ok ? 'text-green-400' : 'text-red-400'}`}>{result.text}</p>}
      {log && (
        <pre ref={logRef} className="max-h-60 overflow-auto rounded-lg border border-border bg-bg p-2 text-[0.6875rem] text-fg-muted font-mono whitespace-pre-wrap">
          {log}
        </pre>
      )}
    </>
  )
}

export function UniverseSettingsPage() {
  return (
    <div className="h-full overflow-auto bg-panel p-6">
      <div className="max-w-[1000px]">
        <h1 className="mb-1 text-base font-semibold text-fg">Universe</h1>
        <p className="mb-4 text-sm text-fg-muted">
          Sealed, disposable Docker sandboxes for AI agents. Every universe has no network, runs as a non-root user with all
          capabilities dropped, and cannot see your machine. These limits are yours alone: agents cannot change them.
        </p>

        <FeatureBlock title="Image" description="The base image every universe is created from.">
          <SettingRow label="Image name" htmlFor="universe-image" description="Pulled if missing. If the pull fails, use Build image locally.">
            <Field id="universe-image" setting="image" />
          </SettingRow>
          <BuildImage />
        </FeatureBlock>

        <FeatureBlock title="Resource limits" description="Applied to each new universe. Existing universes keep the limits they were created with.">
          <SettingRow label="CPUs" htmlFor="universe-cpus">
            <Field id="universe-cpus" setting="cpus" type="number" min={0.25} max={16} step={0.25} />
          </SettingRow>
          <SettingRow label="Memory (MB)" htmlFor="universe-memory">
            <Field id="universe-memory" setting="memoryMb" type="number" min={256} max={65536} step={256} />
          </SettingRow>
          <SettingRow label="Max processes" htmlFor="universe-pids">
            <Field id="universe-pids" setting="pids" type="number" min={32} max={4096} step={32} />
          </SettingRow>
          <p className="max-w-[460px] text-xs text-fg-subtle">
            Disk: a universe's /workspace is a Docker volume and /tmp is capped at 256 MB. Docker has no portable per-volume size
            limit, so the workspace size is not enforced; the panel shows the approximate size and universes are capped at 8.
          </p>
        </FeatureBlock>

        <FeatureBlock title="Auto-cleanup" description="Universes are disposable. Old ones are destroyed when vIDE starts and then every hour.">
          <SettingRow label="Destroy universes older than (days)" htmlFor="universe-cleanup" description="0 turns auto-cleanup off.">
            <Field id="universe-cleanup" setting="cleanupDays" type="number" min={0} max={365} step={1} />
          </SettingRow>
        </FeatureBlock>
      </div>
    </div>
  )
}
