import { describe, it, expect } from 'vitest'
import manifest from '../../../manifest.json'

describe('manifest', () => {
  it('declares only valid, universe_-prefixed agent tools', () => {
    const tools = manifest.agentTools.tools
    expect(tools.length).toBeLessThanOrEqual(32)
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
      expect(t.name.startsWith('universe_')).toBe(true)
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.inputSchema.type).toBe('object')
    }
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length)
  })
})
