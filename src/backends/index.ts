import type { BackendAdapter } from './types'
import { ClaudeAdapter } from './claude'
import { CodexAdapter } from './codex'
import { GeminiAdapter } from './gemini'
import { MockAdapter } from './mock'

export class BackendRegistry {
  private readonly adapters = new Map<string, BackendAdapter>()

  register(adapter: BackendAdapter): void {
    const name = adapter.name.trim().toLowerCase()
    if (name === '') {
      throw new Error('backend name is required')
    }
    this.adapters.set(name, adapter)
  }

  get(name: string): BackendAdapter {
    const adapter = this.adapters.get(name.trim().toLowerCase())
    if (adapter == null) {
      throw new Error(`backend not registered: ${name}`)
    }
    return adapter
  }

  has(name: string): boolean {
    return this.adapters.has(name.trim().toLowerCase())
  }

  list(): BackendAdapter[] {
    return [...this.adapters.values()]
  }

  names(): string[] {
    return [...this.adapters.keys()].sort()
  }
}

export function createDefaultBackendRegistry(): BackendRegistry {
  const registry = new BackendRegistry()
  registry.register(new CodexAdapter())
  registry.register(new ClaudeAdapter())
  registry.register(new GeminiAdapter())
  registry.register(new MockAdapter())
  return registry
}

export * from './base'
export * from './claude'
export * from './codex'
export * from './gemini'
export * from './mock'
export type { StepResult } from './types'
