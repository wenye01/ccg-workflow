import type { CompiledPipeline, CompiledStep, StepPolicies } from './types'

export type FailureAction = 'abort' | 'retry' | 'skip'

export function resolveFailureAction(
  pipeline: CompiledPipeline,
  step: CompiledStep,
  attempt: number,
): FailureAction {
  const policy = effectiveFailurePolicy(pipeline, step)
  if (policy === 'retry' && attempt <= effectiveMaxRetries(pipeline, step)) {
    return 'retry'
  }
  if (policy === 'skip') {
    return 'skip'
  }
  return 'abort'
}

export function effectiveFailurePolicy(pipeline: CompiledPipeline, step: CompiledStep): StepPolicies['on_failure'] {
  const policy = step.policies?.on_failure ?? pipeline.policies.on_failure
  return policy === 'fallback' ? 'abort' : policy
}

export function effectiveMaxRetries(pipeline: CompiledPipeline, step: CompiledStep): number {
  return step.policies?.max_retries ?? pipeline.policies.max_retries ?? 0
}

export function requiresApproval(pipeline: CompiledPipeline, step: CompiledStep): boolean {
  return (step.policies?.approval ?? pipeline.policies.approval) === 'always'
}
