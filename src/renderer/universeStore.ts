import { create } from 'zustand'
import type { ActionResult, DockerStatus, Universe } from './types'
import { getVide } from './vide'

const call = <T,>(method: string, payload?: Parameters<ReturnType<typeof getVide>['app']['call']>[1]) =>
  getVide().app.call<T>(method, payload)

interface UniverseStore {
  status: DockerStatus
  universes: Universe[]
  loading: boolean
  refresh: () => Promise<void>
  destroy: (name: string) => Promise<ActionResult>
  destroyAll: () => Promise<ActionResult>
  openDocker: () => Promise<ActionResult>
  exportWorkspace: (name: string, dest: string) => Promise<ActionResult>
}

export const useUniverseStore = create<UniverseStore>((set, get) => {
  // Polls overlap (a slow `docker ps` against the next tick); only the newest lands.
  let token = 0
  return {
    status: 'unknown',
    universes: [],
    loading: false,

    refresh: async () => {
      const mine = ++token
      set({ loading: true })
      try {
        const status = await call<DockerStatus>('status')
        if (status === 'unknown') {
          if (mine === token) set({ loading: false })
          return
        }
        const universes = status === 'running' ? await call<Universe[]>('list') : []
        if (mine === token) set({ status, universes, loading: false })
      } catch {
        if (mine === token) set({ loading: false })
      }
    },
    destroy: async (name) => {
      const r = await call<ActionResult>('destroy', name)
      await get().refresh()
      return r
    },
    destroyAll: async () => {
      const r = await call<ActionResult>('destroyAll', get().universes.map((u) => u.name))
      await get().refresh()
      return r
    },
    openDocker: async () => {
      const r = await call<ActionResult>('openDocker')
      await get().refresh()
      return r
    },
    exportWorkspace: (name, dest) => call<ActionResult>('exportWorkspace', { name, dest }),
  }
})
