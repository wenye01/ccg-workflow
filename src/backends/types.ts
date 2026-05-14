export type {
  BackendAdapter,
  BackendCapabilities,
  BackendInput,
  BackendOutput,
} from '../runtime/types'

export interface StepResult {
  success: boolean
  session_id?: string
  message: string
  artifacts?: Record<string, unknown>
  exit_code: number
  error?: string
  log_path?: string
  duration_ms?: number
}

