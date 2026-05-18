export interface PipelineConfig {
  version: number
  name: string
  description?: string
  policies: PipelinePolicies
  steps: StepConfig[]
  artifacts?: ArtifactSchemaDecl[]
}

export interface PipelinePolicies {
  approval: 'never' | 'on-failure' | 'always'
  on_failure: 'abort' | 'retry' | 'skip' | 'fallback'
  max_retries?: number
}

export type StepRole =
  | 'research'
  | 'planning'
  | 'implementation'
  | 'quality_assurance'
  | 'review'
  | 'optimization'

export interface StepConfig {
  id: string
  role: StepRole
  backend: string
  description?: string
  inputs?: InputBinding[]
  outputs?: OutputBinding[]
  bindings?: Record<string, string>
  prompt_template?: string
  policies?: StepPolicies
}

export interface InputBinding {
  artifact: string
  version: number
  required?: boolean
}

export interface OutputBinding {
  type: string
  version: number
  schema: Record<string, unknown>
  required?: boolean
}

export interface StepPolicies {
  approval?: 'never' | 'always'
  on_failure?: 'abort' | 'retry' | 'skip'
  max_retries?: number
  timeout_seconds?: number
}

export interface ArtifactSchemaDecl {
  type: string
  version: number
  schema: Record<string, unknown>
}

export interface CompiledPipeline {
  version: number
  name: string
  steps: CompiledStep[]
  artifact_schemas: Map<string, ArtifactSchemaDecl>
  policies: PipelinePolicies
  metadata: {
    compiled_at: string
    source_path?: string
  }
}

export interface CompiledStep extends StepConfig {
  index: number
  resolved_inputs: ResolvedInput[]
  control_edges: ControlEdge[]
  data_edges: DataEdge[]
}

export interface ResolvedInput {
  artifact_type: string
  source_step: string
  version: number
}

export type ControlEdgeType = 'next' | 'retry' | 'skip' | 'fallback' | 'abort'

export interface ControlEdge {
  type: ControlEdgeType
  target?: string
  condition?: string
}

export interface DataEdge {
  from_step: string
  to_step: string
  artifact_type: string
  version: number
  bindings: Record<string, string>
}

export type StepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'waiting_for_approval'

export interface RunState {
  run_id: string
  pipeline_name: string
  pipeline_version: number
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'paused'
  started_at: string
  updated_at: string
  current_step: string | null
  steps: Record<string, StepState>
  artifacts: ArtifactIndex
}

export interface StepState {
  step_id: string
  status: StepStatus
  started_at?: string
  completed_at?: string
  backend_session_id?: string
  attempt: number
  error?: string
  approval_required: boolean
}

export interface ArtifactIndex {
  [type: string]: ArtifactRecord
}

export interface ArtifactRecord {
  type: string
  version: number
  step_id: string
  created_at: string
  path: string
  checksum: string
}

export interface Artifact<T = unknown> {
  type: string
  version: number
  created_at: string
  step_id: string
  data: T
}

export interface BackendAdapter {
  name: string
  capabilities: BackendCapabilities
  execute: (input: BackendInput) => Promise<BackendOutput>
  resume?: (sessionId: string, input: BackendInput) => Promise<BackendOutput>
}

export interface BackendCapabilities {
  supports_session: boolean
  supports_structured_output: boolean
  supports_streaming: boolean
  max_context_tokens?: number
}

export interface BackendInput {
  prompt: string
  work_dir: string
  session_id?: string
  timeout_seconds?: number
  env?: Record<string, string>
  output_schema?: Record<string, unknown>
}

export interface BackendOutput {
  success: boolean
  session_id?: string
  message: string
  artifacts?: Record<string, unknown>
  exit_code: number
  error?: string
  log_path?: string
  duration_ms?: number
}

export interface OrchestratorCallbacks {
  onStepStart?: (step: CompiledStep, state: RunState) => void | Promise<void>
  onStepComplete?: (step: CompiledStep, result: BackendOutput, state: RunState) => void | Promise<void>
  onStepFailed?: (step: CompiledStep, error: Error, state: RunState) => void | Promise<void>
  onApprovalRequired?: (step: CompiledStep, state: RunState) => Promise<boolean>
  onArtifactProduced?: (artifact: Artifact, state: RunState) => void | Promise<void>
  onComplete?: (state: RunState) => void | Promise<void>
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}
