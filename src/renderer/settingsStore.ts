import { create } from 'zustand'
import { getVide } from './vide'

// Keys are app-relative: vIDE stores them as `vide:universe:<key>`. These are
// user-only: no agent tool can read or change them.
const KEYS = { image: 'image', cpus: 'cpus', memoryMb: 'memoryMb', pids: 'pids', cleanupDays: 'cleanupDays' } as const

export const DEFAULTS = {
  image: 'ghcr.io/forebeacon/universe-base:latest',
  cpus: '2',
  memoryMb: '2048',
  pids: '256',
  cleanupDays: '7',
}

export type SettingKey = keyof typeof KEYS

interface SettingsStore {
  values: Record<SettingKey, string>
  set: (key: SettingKey, value: string) => void
}

const read = (): Record<SettingKey, string> => {
  const s = getVide().settings
  const out = {} as Record<SettingKey, string>
  for (const k of Object.keys(KEYS) as SettingKey[]) out[k] = s.get(KEYS[k]) ?? DEFAULTS[k]
  return out
}

export const useUniverseSettingsStore = create<SettingsStore>((set) => ({
  values: { ...DEFAULTS },
  set: (key, value) => {
    getVide().settings.set(KEYS[key], value)
    set((s) => ({ values: { ...s.values, [key]: value } }))
  },
}))

// main.js sanitises and clamps these; the renderer just forwards the strings.
// Also tells main which project is open, so universe_create(from_project) knows
// where to copy from.
export function pushConfig(): void {
  const values = useUniverseSettingsStore.getState().values
  void getVide().app.call('configure', {
    config: {
      image: values.image,
      cpus: values.cpus,
      memoryMb: values.memoryMb,
      pids: values.pids,
      cleanupDays: values.cleanupDays,
    },
    projectRoot: getVide().project.root(),
  })
}

export function initUniverseSettings(): () => void {
  const s = getVide().settings
  const apply = () => { useUniverseSettingsStore.setState({ values: read() }); pushConfig() }
  apply()
  const offs = Object.values(KEYS).map((k) => s.subscribe(k, apply))
  offs.push(getVide().project.subscribe(() => pushConfig()))
  return () => offs.forEach((off) => off())
}
