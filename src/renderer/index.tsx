import { UniversePanel } from './UniversePanel'
import { UniverseSettingsPage } from './SettingsPage'
import { UniverseIcon } from './icons'
import { useUniverseStore } from './universeStore'
import { initUniverseSettings } from './settingsStore'
import { setVide } from './vide'
import type { Disposable, VideRendererApi } from '../vide'

let teardown: Array<() => void> = []

export function activate(vide: VideRendererApi): void {
  setVide(vide)
  // Pushes the user's limits and the open project folder to main.js; its
  // auto-cleanup sweep runs from that first push and then hourly.
  teardown.push(initUniverseSettings())

  const panel = vide.ui.registerSidebarPanel({
    title: 'Universe',
    icon: UniverseIcon,
    component: UniversePanel,
  })
  teardown.push(() => panel.dispose())
  teardown.push(vide.ui.registerSettingsPage({ title: 'Universe', component: UniverseSettingsPage }).dispose)

  // Badge: how many universes exist, kept fresh while the panel is closed too.
  const update = () => {
    const n = useUniverseStore.getState().universes.length
    panel.setBadge(n || undefined)
  }
  teardown.push(useUniverseStore.subscribe(update))
  void useUniverseStore.getState().refresh()
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') void useUniverseStore.getState().refresh()
  }, 30000)
  teardown.push(() => clearInterval(interval))

  // "Docker isn't running" notification while the daemon is confirmed stopped.
  let alert: Disposable | null = null
  const updateAlert = () => {
    const stopped = useUniverseStore.getState().status === 'stopped'
    if (stopped && !alert) {
      alert = vide.notifications.push({ id: 'universe-docker', text: "Docker isn't running: universes need it", onClick: () => vide.ui.openPanel() })
    } else if (!stopped && alert) {
      alert.dispose()
      alert = null
    }
  }
  teardown.push(useUniverseStore.subscribe(updateAlert))
  teardown.push(() => { alert?.dispose(); alert = null })
}

export function deactivate(): void {
  for (const off of teardown.reverse()) {
    try { off() } catch { /* best effort */ }
  }
  teardown = []
  setVide(null)
}
