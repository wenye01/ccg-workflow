import { describe, expect, it } from 'vitest'
import { BackendRegistry, createDefaultBackendRegistry, MockAdapter } from '../index'

describe('backend registry', () => {
  it('registers, finds, and lists backends', () => {
    const registry = new BackendRegistry()
    registry.register(new MockAdapter())

    expect(registry.has('mock')).toBe(true)
    expect(registry.get('MOCK').name).toBe('mock')
    expect(registry.names()).toEqual(['mock'])
  })

  it('creates the default backend set', () => {
    const registry = createDefaultBackendRegistry()

    expect(registry.names()).toEqual(['claude', 'codex', 'gemini', 'mock'])
  })

  it('throws for unknown backends', () => {
    const registry = new BackendRegistry()

    expect(() => registry.get('missing')).toThrow('backend not registered')
  })
})

