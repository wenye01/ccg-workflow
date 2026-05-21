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

export interface DefaultBackendRegistryOptions {
  wrapperPath?: string
}

export function createDefaultBackendRegistry(options: DefaultBackendRegistryOptions = {}): BackendRegistry {
  const registry = new BackendRegistry()
  registry.register(new CodexAdapter({ wrapperPath: options.wrapperPath }))
  registry.register(new ClaudeAdapter({ wrapperPath: options.wrapperPath }))
  registry.register(new GeminiAdapter({ wrapperPath: options.wrapperPath }))
  registry.register(new MockAdapter())
  return registry
}

export * from './base'
export * from './claude'
export * from './codex'
export * from './gemini'
export * from './mock'
export type { StepResult } from './types'
