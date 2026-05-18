import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendRegistry, MockAdapter } from '../../backends'
import { compilePipeline } from '../compiler'
import { runPipeline } from '../orchestrator'

const tmpRoot = join(tmpdir(), `ccg-orchestrator-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('orchestrator', () => {
  it('runs a linear plan -> develop -> qa pipeline with MockAdapter', async () => {
    const pipeline = compilePipeline(`
version: 1
name: default
policies:
  approval: never
  on_failure: abort
steps:
  - id: plan
    role: planning
    backend: mock
    outputs:
      - type: plan
        version: 1
        schema:
          type: object
          required: [summary]
          properties:
            summary:
              type: string
  - id: develop
    role: implementation
    backend: mock
    inputs:
      - artifact: plan
        version: 1
    bindings:
      PLAN_SUMMARY: plan.summary
    outputs:
      - type: implementation
        version: 1
        schema:
          type: object
          required: [files]
          properties:
            files:
              type: array
  - id: qa
    role: quality_assurance
    backend: mock
    inputs:
      - artifact: implementation
        version: 1
    bindings:
      FILES: implementation.files|json_stringify
`)
    const registry = new BackendRegistry()
    registry.register(new MockAdapter({
      response: input => {
        if (input.env?.PLAN_SUMMARY != null) {
          return { artifacts: { implementation: { files: ['src/runtime/orchestrator.ts'] } } }
        }
        if (input.env?.FILES != null) {
          return { artifacts: undefined }
        }
        return { artifacts: { plan: { summary: 'Implement phase 3' } } }
      },
    }))

    const state = await runPipeline({
      pipeline,
      registry,
      workDir: tmpRoot,
      taskDescription: 'Phase 3',
      runId: 'run-ok',
    })

    expect(state.status).toBe('completed')
    expect(state.steps.plan.status).toBe('succeeded')
    expect(state.steps.develop.status).toBe('succeeded')
    expect(state.steps.qa.status).toBe('succeeded')
    expect(state.artifacts.plan.path).toContain('plan.json')
    expect(state.artifacts.implementation.path).toContain('implementation.json')
  })

  it('retries failed steps according to policy', async () => {
    let calls = 0
    const pipeline = compilePipeline(`
version: 1
name: retry
policies:
  approval: never
  on_failure: retry
  max_retries: 1
steps:
  - id: plan
    role: planning
    backend: mock
    outputs:
      - type: plan
        version: 1
        schema:
          type: object
          required: [summary]
          properties:
            summary:
              type: string
`)
    const registry = new BackendRegistry()
    registry.register(new MockAdapter({
      response: () => {
        calls += 1
        return calls === 1
          ? { success: false, exit_code: 1, error: 'temporary failure' }
          : { artifacts: { plan: { summary: 'ok' } } }
      },
    }))

    const state = await runPipeline({
      pipeline,
      registry,
      workDir: tmpRoot,
      taskDescription: 'Retry',
      runId: 'run-retry',
    })

    expect(state.status).toBe('completed')
    expect(state.steps.plan.attempt).toBe(2)
  })

  it('skips approval-gated steps when approval is denied', async () => {
    const pipeline = compilePipeline(`
version: 1
name: approval
policies:
  approval: never
  on_failure: abort
steps:
  - id: plan
    role: planning
    backend: mock
    policies:
      approval: always
`)
    const registry = new BackendRegistry()
    registry.register(new MockAdapter())

    const state = await runPipeline({
      pipeline,
      registry,
      workDir: tmpRoot,
      taskDescription: 'Approval',
      runId: 'run-approval',
      callbacks: {
        onApprovalRequired: async () => false,
      },
    })

    expect(state.status).toBe('completed')
    expect(state.steps.plan.status).toBe('skipped')
    expect(state.steps.plan.attempt).toBe(0)
  })

  it('marks failed steps as skipped when skip policy is active', async () => {
    const pipeline = compilePipeline(`
version: 1
name: skip
policies:
  approval: never
  on_failure: skip
steps:
  - id: plan
    role: planning
    backend: mock
`)
    const registry = new BackendRegistry()
    registry.register(new MockAdapter({ fail: true }))

    const state = await runPipeline({
      pipeline,
      registry,
      workDir: tmpRoot,
      taskDescription: 'Skip',
      runId: 'run-skip',
    })

    expect(state.status).toBe('completed')
    expect(state.steps.plan.status).toBe('skipped')
  })
})
