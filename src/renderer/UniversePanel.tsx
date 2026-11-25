import { useEffect, useState } from 'react'
import { useUniverseStore } from './universeStore'
import { Modal } from './ui'
import { ButtonIcon, EXPORT_ICON, LAUNCH_ICON, RefreshIcon, TRASH_ICON, UniverseIcon } from './icons'
import { getVide } from './vide'
import type { Universe } from './types'

const POLL_MS = 5000

const dangerIconButtonClass =
  'w-7 h-7 flex items-center justify-center rounded-lg border border-border text-red-400 hover:bg-red-600/20 hover:border-red-500/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0'
const cancelClass =
  'px-4 py-1.5 text-sm rounded-lg border border-border text-fg-muted hover:text-fg hover:border-fg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const dangerClass =
  'px-4 py-1.5 text-sm rounded-lg bg-red-600/80 hover:bg-red-600 text-white font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1.5'
const inputClass = 'w-full px-2 py-1 text-sm rounded-lg border border-border bg-bg text-fg font-mono'

const STATUS_DOT: Record<string, string> = { running: 'bg-green-500', stopped: 'bg-red-500', 'not-installed': 'bg-fg-subtle', unknown: 'bg-fg-subtle' }
const STATUS_LABEL: Record<string, string> = { running: 'Docker running', stopped: 'Docker stopped', 'not-installed': 'Docker not installed', unknown: 'Checking' }

export function formatAge(createdMs: number | null, now = Date.now()): string {
  if (createdMs === null) return 'unknown age'
  const s = Math.max(0, Math.round((now - createdMs) / 1000))
  if (s < 90) return `${s}s`
  if (s < 5400) return `${Math.round(s / 60)}m`
  if (s < 129600) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '?'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? Math.round(v * 10) / 10 : Math.round(v)} ${units[i]}`
}

function ConfirmDestroyModal({ title, text, confirmLabel, onConfirm, onClose }: {
  title: string
  text: string
  confirmLabel: string
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal onClose={onClose}>
      <h2 className="text-sm font-semibold text-fg mb-1">{title}</h2>
      <p className="text-sm text-fg-muted mb-5">{text}</p>
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} disabled={busy} className={cancelClass}>Cancel</button>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          className={dangerClass}
          onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false) } onClose() }}
        >
          {busy && <RefreshIcon className="animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

// User-only: this is a panel action, there is no agent tool that exports.
function ExportModal({ universe, onClose }: { universe: Universe; onClose: () => void }) {
  const exportWorkspace = useUniverseStore((s) => s.exportWorkspace)
  const [dest, setDest] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function browse() {
    const picked = await getVide().app.call<string | null>('pickFolder')
    if (picked) setDest(picked)
  }

  async function run() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await exportWorkspace(universe.name, dest.trim())
      setMessage(r.ok ? { ok: true, text: `Exported to ${dest.trim()}/${universe.name}` } : { ok: false, text: r.error ?? 'Export failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-sm font-semibold text-fg mb-1">Export to host</h2>
      <p className="text-sm text-fg-muted mb-3">
        Copy <span className="font-mono text-fg">{universe.name}</span>'s /workspace into a new folder named{' '}
        <span className="font-mono text-fg">{universe.name}</span> inside the destination.
      </p>
      <div className="flex gap-2 mb-3">
        <input
          className={inputClass}
          value={dest}
          placeholder="/Users/you/Desktop"
          aria-label="Destination folder"
          onChange={(e) => setDest(e.target.value)}
        />
        <button type="button" onClick={browse} className={cancelClass}>Browse</button>
      </div>
      {message && <p className={`text-xs mb-3 ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className={cancelClass}>{message?.ok ? 'Close' : 'Cancel'}</button>
        <button
          type="button"
          disabled={busy || !dest.trim() || message?.ok}
          aria-busy={busy}
          onClick={run}
          className="px-4 py-1.5 text-sm rounded-lg bg-accent text-on-accent font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          {busy && <RefreshIcon className="animate-spin" />}
          Export
        </button>
      </div>
    </Modal>
  )
}

function UniverseRow({ universe, onDestroy, onExport }: { universe: Universe; onDestroy: () => void; onExport: () => void }) {
  const running = universe.state === 'running'
  return (
    <li className="rounded-lg border border-border px-2.5 py-2 flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full shrink-0 ${running ? 'bg-green-500' : 'bg-fg-subtle'}`} title={universe.state} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg font-mono truncate">{universe.name}</div>
        <div className="text-[0.6875rem] text-fg-muted truncate">
          {universe.state} · {formatAge(universe.createdMs)} · ~{formatBytes(universe.sizeBytes)}
        </div>
      </div>
      <button type="button" title="Export to host" aria-label={`Export ${universe.name} to host`} onClick={onExport} className={`${dangerIconButtonClass} !text-fg-muted hover:!text-fg hover:!bg-white/5 hover:!border-fg-muted`}>
        <ButtonIcon d={EXPORT_ICON} />
      </button>
      <button type="button" title="Destroy universe" aria-label={`Destroy ${universe.name}`} onClick={onDestroy} className={dangerIconButtonClass}>
        <ButtonIcon d={TRASH_ICON} />
      </button>
    </li>
  )
}

export function UniversePanel() {
  const status = useUniverseStore((s) => s.status)
  const universes = useUniverseStore((s) => s.universes)
  const refresh = useUniverseStore((s) => s.refresh)
  const destroy = useUniverseStore((s) => s.destroy)
  const destroyAll = useUniverseStore((s) => s.destroyAll)
  const openDocker = useUniverseStore((s) => s.openDocker)
  const [destroyTarget, setDestroyTarget] = useState<Universe | null>(null)
  const [exportTarget, setExportTarget] = useState<Universe | null>(null)
  const [destroyAllOpen, setDestroyAllOpen] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  const pillButtonClass = getVide().ui.components.pillButtonClass

  return (
    <div className="h-full flex flex-col bg-sidebar border-r border-border overflow-hidden">
      <div className="h-9 px-3 border-b border-border shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
          <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider shrink-0">Universe</span>
          <span className="text-[0.625rem] text-fg-muted truncate">{STATUS_LABEL[status]}</span>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh universes"
          className="w-5 h-5 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-white/5 transition-colors shrink-0"
        >
          <RefreshIcon />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {status === 'not-installed' && (
          <p className="text-xs text-fg-muted text-center leading-relaxed pt-2">
            Docker is not installed. Install Docker Desktop, Colima or OrbStack to give agents sealed sandboxes.
          </p>
        )}
        {status === 'stopped' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
            <UniverseIcon className="w-10 h-10 text-fg-subtle" />
            <p className="text-xs text-fg-muted text-center leading-relaxed max-w-[200px]">
              Docker isn't running. Start Docker Desktop, Colima or OrbStack to use universes.
            </p>
          </div>
        )}
        {status === 'running' && universes.length === 0 && (
          <p className="text-xs text-fg-muted text-center leading-relaxed pt-2">
            No universes yet. Agents create them with universe_create; each one is sealed: no network, no access to your files.
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {status === 'running' && universes.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {universes.map((u) => (
              <UniverseRow key={u.name} universe={u} onDestroy={() => setDestroyTarget(u)} onExport={() => setExportTarget(u)} />
            ))}
          </ul>
        )}
      </div>

      {status === 'stopped' && (
        <div className="border-t border-border shrink-0 px-3 py-2">
          <button
            type="button"
            aria-label="Launch Docker"
            aria-busy={launching}
            className={pillButtonClass}
            disabled={launching}
            onClick={async () => { setLaunching(true); try { await openDocker() } finally { setLaunching(false) } }}
          >
            {launching ? <RefreshIcon className="animate-spin" /> : <><ButtonIcon d={LAUNCH_ICON} />Launch Docker</>}
          </button>
        </div>
      )}

      {status === 'running' && (
        <div className="border-t border-border shrink-0 px-3 py-2">
          <button
            type="button"
            aria-label="Destroy All Universes"
            className={pillButtonClass}
            disabled={universes.length === 0}
            onClick={() => setDestroyAllOpen(true)}
          >
            <ButtonIcon d={TRASH_ICON} />Destroy All
          </button>
        </div>
      )}

      {destroyTarget && (
        <ConfirmDestroyModal
          title="Destroy universe"
          text={`Destroy ${destroyTarget.name}? Its container and everything in /workspace are deleted. This cannot be undone.`}
          confirmLabel="Destroy"
          onClose={() => setDestroyTarget(null)}
          onConfirm={async () => { const r = await destroy(destroyTarget.name); setError(r.ok ? null : r.error ?? 'Destroy failed') }}
        />
      )}
      {destroyAllOpen && (
        <ConfirmDestroyModal
          title="Destroy all universes"
          text={`Destroy all ${universes.length} universe${universes.length === 1 ? '' : 's'}? Their containers and workspaces are deleted. This cannot be undone.`}
          confirmLabel="Destroy All"
          onClose={() => setDestroyAllOpen(false)}
          onConfirm={async () => { const r = await destroyAll(); setError(r.ok ? null : r.error ?? 'Destroy failed') }}
        />
      )}
      {exportTarget && <ExportModal universe={exportTarget} onClose={() => setExportTarget(null)} />}
    </div>
  )
}
