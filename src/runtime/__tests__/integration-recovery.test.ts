import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendRegistry, MockAdapter } from '../../backends'
import { compilePipeline, runPipeline } from '../index'

const tmpRoot = join(tmpdir(), `ccg-integration-recovery-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('recovery integration', () => {
  it('resumes a previous run and skips already completed steps', async () => {
    const pipeline = compilePipeline(`
version: 1
name: recovery
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
`)
    let calls = 0
    const registry = new BackendRegistry()
    registry.register(new MockAdapter({
      response: () => {
        calls += 1
        if (calls === 1) {
          return { artifacts: { plan: { summary: 'ready' } } }
        }
        return { success: false, exit_code: 1, error: 'develop failed once' }
      },
    }))

    const failed = await runPipeline({
      pipeline,
      registry,
      workDir: tmpRoot,
      taskDescription: 'recover',
      runId: 'run-recovery',
    })

    expect(failed.status).toBe('failed')
    expect(failed.steps.plan.status).toBe('succeeded')
    expect(failed.steps.develop.status).toBe('failed')
    expect(calls).toBe(2)

    const resumeRegistry = new BackendRegistry()
    resumeRegistry.register(new MockAdapter())
    const resumed = await runPipeline({
      pipeline,
      registry: resumeRegistry,
      workDir: tmpRoot,
      taskDescription: 'recover',
      runId: 'run-recovery',
    })

    expect(resumed.status).toBe('completed')
    expect(resumed.steps.plan.attempt).toBe(1)
    expect(resumed.steps.develop.status).toBe('succeeded')
  })
})
