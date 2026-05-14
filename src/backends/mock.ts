import type { BackendAdapter, BackendCapabilities, BackendInput, BackendOutput } from './types'

export interface MockAdapterOptions {
  delayMs?: number
  fail?: boolean
  timeout?: boolean
  response?: Partial<BackendOutput> | ((input: BackendInput) => Partial<BackendOutput>)
}

export class MockAdapter implements BackendAdapter {
  name = 'mock'
  capabilities: BackendCapabilities = {
    supports_session: true,
    supports_structured_output: true,
    supports_streaming: false,
  }

  constructor(private readonly options: MockAdapterOptions = {}) {}

  async execute(input: BackendInput): Promise<BackendOutput> {
    if (this.options.timeout) {
      const timeoutSeconds = input.timeout_seconds ?? 1
      await sleep(timeoutSeconds * 1000)
      return {
        success: false,
        message: '',
        exit_code: 124,
        error: `mock backend timed out after ${timeoutSeconds}s`,
        duration_ms: timeoutSeconds * 1000,
      }
    }

    if (this.options.delayMs != null && this.options.delayMs > 0) {
      await sleep(this.options.delayMs)
    }

    const response = typeof this.options.response === 'function'
      ? this.options.response(input)
      : this.options.response

    if (this.options.fail) {
      return {
        success: false,
        message: response?.message ?? '',
        exit_code: response?.exit_code ?? 1,
        error: response?.error ?? 'mock backend failure',
        artifacts: response?.artifacts,
        duration_ms: response?.duration_ms ?? this.options.delayMs ?? 0,
      }
    }

    return {
      success: response?.success ?? true,
      session_id: response?.session_id ?? input.session_id ?? 'mock-session',
      message: response?.message ?? input.prompt,
      artifacts: response?.artifacts ?? (input.output_schema == null ? undefined : { mock: true }),
      exit_code: response?.exit_code ?? 0,
      error: response?.error,
      log_path: response?.log_path,
      duration_ms: response?.duration_ms ?? this.options.delayMs ?? 0,
    }
  }

  async resume(sessionId: string, input: BackendInput): Promise<BackendOutput> {
    return this.execute({ ...input, session_id: sessionId })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

