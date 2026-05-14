import type {
  ArtifactSchemaDecl,
  PipelineConfig,
  StepConfig,
  ValidationResult,
} from './types'

const ROLES = new Set([
  'research',
  'planning',
  'implementation',
  'quality_assurance',
  'review',
  'optimization',
])

const APPROVAL_POLICIES = new Set(['never', 'on-failure', 'always'])
const STEP_APPROVAL_POLICIES = new Set(['never', 'always'])
const FAILURE_POLICIES = new Set(['abort', 'retry', 'skip', 'fallback'])
const STEP_FAILURE_POLICIES = new Set(['abort', 'retry', 'skip'])

export function validatePipelineConfig(config: unknown): ValidationResult {
  const errors: string[] = []

  if (!isRecord(config)) {
    return { ok: false, errors: ['Pipeline config must be an object'] }
  }

  if (!Number.isInteger(config.version)) {
    errors.push('version must be an integer')
  }
  if (typeof config.name !== 'string' || config.name.length === 0) {
    errors.push('name must be a non-empty string')
  }
  if (!isRecord(config.policies)) {
    errors.push('policies must be an object')
  }
  else {
    if (!APPROVAL_POLICIES.has(String(config.policies.approval))) {
      errors.push('policies.approval must be one of never, on-failure, always')
    }
    if (!FAILURE_POLICIES.has(String(config.policies.on_failure))) {
      errors.push('policies.on_failure must be one of abort, retry, skip, fallback')
    }
    if (config.policies.max_retries !== undefined && !isNonNegativeInteger(config.policies.max_retries)) {
      errors.push('policies.max_retries must be a non-negative integer')
    }
  }

  if (!Array.isArray(config.steps) || config.steps.length === 0) {
    errors.push('steps must be a non-empty array')
  }
  else {
    config.steps.forEach((step, index) => validateStepShape(step, index, errors))
  }

  if (config.artifacts !== undefined) {
    if (!Array.isArray(config.artifacts)) {
      errors.push('artifacts must be an array when provided')
    }
    else {
      config.artifacts.forEach((artifact, index) => validateArtifactDecl(artifact, `artifacts[${index}]`, errors))
    }
  }

  return { ok: errors.length === 0, errors }
}

export function validatePipelineSemantics(config: PipelineConfig): ValidationResult {
  const errors: string[] = []
  const stepIds = new Set<string>()
  const produced = new Map<string, { stepId: string, version: number, schema: Record<string, unknown> }>()
  const declaredSchemas = new Map<string, ArtifactSchemaDecl>()

  for (const artifact of config.artifacts ?? []) {
    declaredSchemas.set(artifactKey(artifact.type, artifact.version), artifact)
  }

  for (const step of config.steps) {
    if (stepIds.has(step.id)) {
      errors.push(`Duplicate step id: ${step.id}`)
    }
    stepIds.add(step.id)

    for (const input of step.inputs ?? []) {
      const key = artifactKey(input.artifact, input.version)
      if (!produced.has(key)) {
        errors.push(`Step "${step.id}" input "${input.artifact}@${input.version}" has no producer in previous steps`)
      }
    }

    for (const [envName, binding] of Object.entries(step.bindings ?? {})) {
      const parsed = parseBinding(binding)
      if (!parsed) {
        errors.push(`Step "${step.id}" binding "${envName}" must use artifact.field syntax`)
        continue
      }

      const producer = findProducedArtifact(produced, parsed.artifact)
      if (!producer) {
        errors.push(`Step "${step.id}" binding "${envName}" references unknown artifact "${parsed.artifact}"`)
        continue
      }

      if (!schemaHasPath(producer.schema, parsed.path)) {
        errors.push(`Step "${step.id}" binding "${envName}" references missing schema field "${binding}"`)
      }
    }

    for (const output of step.outputs ?? []) {
      const key = artifactKey(output.type, output.version)
      const declared = declaredSchemas.get(key)
      if (declared && JSON.stringify(declared.schema) !== JSON.stringify(output.schema)) {
        errors.push(`Step "${step.id}" output "${output.type}@${output.version}" conflicts with declared artifact schema`)
      }
      produced.set(key, { stepId: step.id, version: output.version, schema: output.schema })
    }
  }

  return { ok: errors.length === 0, errors }
}

export function assertValidPipelineConfig(config: unknown): asserts config is PipelineConfig {
  const shape = validatePipelineConfig(config)
  if (!shape.ok) {
    throw new Error(`Invalid pipeline config:\n${shape.errors.join('\n')}`)
  }

  const semantics = validatePipelineSemantics(config as PipelineConfig)
  if (!semantics.ok) {
    throw new Error(`Invalid pipeline semantics:\n${semantics.errors.join('\n')}`)
  }
}

export function schemaHasPath(schema: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = schema

  for (const part of parts) {
    if (!isRecord(current)) {
      return false
    }

    const properties = current.properties
    if (!isRecord(properties) || !isRecord(properties[part])) {
      return false
    }

    current = properties[part]
  }

  return true
}

export function artifactKey(type: string, version: number): string {
  return `${type}@${version}`
}

function validateStepShape(step: unknown, index: number, errors: string[]): void {
  const prefix = `steps[${index}]`
  if (!isRecord(step)) {
    errors.push(`${prefix} must be an object`)
    return
  }

  if (typeof step.id !== 'string' || step.id.length === 0) {
    errors.push(`${prefix}.id must be a non-empty string`)
  }
  if (typeof step.role !== 'string' || !ROLES.has(step.role)) {
    errors.push(`${prefix}.role is invalid`)
  }
  if (typeof step.backend !== 'string' || step.backend.length === 0) {
    errors.push(`${prefix}.backend must be a non-empty string`)
  }

  validateInputs(step as StepConfig, prefix, errors)
  validateOutputs(step as StepConfig, prefix, errors)
  validateBindings(step as StepConfig, prefix, errors)
  validateStepPolicies(step as StepConfig, prefix, errors)
}

function validateInputs(step: StepConfig, prefix: string, errors: string[]): void {
  if (step.inputs === undefined) {
    return
  }
  if (!Array.isArray(step.inputs)) {
    errors.push(`${prefix}.inputs must be an array`)
    return
  }
  step.inputs.forEach((input, index) => {
    if (!isRecord(input)) {
      errors.push(`${prefix}.inputs[${index}] must be an object`)
      return
    }
    if (typeof input.artifact !== 'string' || input.artifact.length === 0) {
      errors.push(`${prefix}.inputs[${index}].artifact must be a non-empty string`)
    }
    if (!Number.isInteger(input.version)) {
      errors.push(`${prefix}.inputs[${index}].version must be an integer`)
    }
  })
}

function validateOutputs(step: StepConfig, prefix: string, errors: string[]): void {
  if (step.outputs === undefined) {
    return
  }
  if (!Array.isArray(step.outputs)) {
    errors.push(`${prefix}.outputs must be an array`)
    return
  }
  step.outputs.forEach((output, index) => {
    validateArtifactDecl(output, `${prefix}.outputs[${index}]`, errors)
  })
}

function validateBindings(step: StepConfig, prefix: string, errors: string[]): void {
  if (step.bindings === undefined) {
    return
  }
  if (!isRecord(step.bindings)) {
    errors.push(`${prefix}.bindings must be an object`)
    return
  }
  for (const [key, value] of Object.entries(step.bindings)) {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`${prefix}.bindings.${key} must be a non-empty string`)
    }
  }
}

function validateStepPolicies(step: StepConfig, prefix: string, errors: string[]): void {
  if (step.policies === undefined) {
    return
  }
  if (!isRecord(step.policies)) {
    errors.push(`${prefix}.policies must be an object`)
    return
  }
  if (step.policies.approval !== undefined && !STEP_APPROVAL_POLICIES.has(step.policies.approval)) {
    errors.push(`${prefix}.policies.approval must be one of never, always`)
  }
  if (step.policies.on_failure !== undefined && !STEP_FAILURE_POLICIES.has(step.policies.on_failure)) {
    errors.push(`${prefix}.policies.on_failure must be one of abort, retry, skip`)
  }
}

function validateArtifactDecl(artifact: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(artifact)) {
    errors.push(`${prefix} must be an object`)
    return
  }
  if (typeof artifact.type !== 'string' || artifact.type.length === 0) {
    errors.push(`${prefix}.type must be a non-empty string`)
  }
  if (!Number.isInteger(artifact.version)) {
    errors.push(`${prefix}.version must be an integer`)
  }
  if (!isRecord(artifact.schema)) {
    errors.push(`${prefix}.schema must be an object`)
  }
}

function parseBinding(binding: string): { artifact: string, path: string } | null {
  const dot = binding.indexOf('.')
  if (dot <= 0 || dot === binding.length - 1) {
    return null
  }
  return {
    artifact: binding.slice(0, dot),
    path: binding.slice(dot + 1),
  }
}

function findProducedArtifact(
  produced: Map<string, { stepId: string, version: number, schema: Record<string, unknown> }>,
  type: string,
): { stepId: string, version: number, schema: Record<string, unknown> } | undefined {
  for (const [key, artifact] of produced) {
    if (key.startsWith(`${type}@`)) {
      return artifact
    }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0
}
