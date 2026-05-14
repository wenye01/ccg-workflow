import type { PipelineConfig } from '../types'
import { describe, expect, it } from 'vitest'
import { validatePipelineConfig, validatePipelineSemantics } from '../validator'

const planSchema = {
  type: 'object',
  required: ['summary'],
  properties: {
    summary: { type: 'string' },
  },
}

describe('runtime validator', () => {
  it('rejects missing previous artifact producers', () => {
    const config: PipelineConfig = {
      version: 1,
      name: 'invalid',
      policies: { approval: 'never', on_failure: 'abort' },
      steps: [
        {
          id: 'develop',
          role: 'implementation',
          backend: 'codex',
          inputs: [{ artifact: 'plan', version: 1 }],
        },
      ],
    }

    const result = validatePipelineSemantics(config)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('has no producer')
  })

  it('rejects bindings that are absent from the output schema', () => {
    const config: PipelineConfig = {
      version: 1,
      name: 'invalid-binding',
      policies: { approval: 'never', on_failure: 'abort' },
      steps: [
        {
          id: 'plan',
          role: 'planning',
          backend: 'codex',
          outputs: [{ type: 'plan', version: 1, schema: planSchema }],
        },
        {
          id: 'develop',
          role: 'implementation',
          backend: 'codex',
          inputs: [{ artifact: 'plan', version: 1 }],
          bindings: { PLAN_TITLE: 'plan.title' },
        },
      ],
    }

    const result = validatePipelineSemantics(config)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('missing schema field')
  })

  it('validates required top-level pipeline shape', () => {
    const result = validatePipelineConfig({
      version: 1,
      name: '',
      policies: { approval: 'later', on_failure: 'abort' },
      steps: [],
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('name must be a non-empty string')
    expect(result.errors).toContain('steps must be a non-empty array')
  })
})
