import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import type { BackendAdapter } from '../types'
import { BackendRegistry, MockAdapter } from '../../backends'
import { ArtifactStore } from '../artifact'
import { compilePipeline } from '../compiler'
import { StepRunner } from '../runner'
import { createRunState } from '../state'

const tmpRoot = join(tmpdir(), `ccg-runner-fallback-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('step runner artifact fallback', () => {
  it('extracts artifacts from fenced JSON in backend messages', async () => {
    const pipeline = compilePipeline(`
version: 1
name: fallback
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
`)
    const registry = new BackendRegistry()
    registry.register(new MessageOnlyAdapter('Here is the result:\n```json\n{"summary":"from message"}\n```'))
    const state = await createRunState({ rootDir: tmpRoot, pipeline, runId: 'run-message' })
    const store = new ArtifactStore({
      rootDir: tmpRoot,
      runId: state.run_id,
      schemas: pipeline.artifact_schemas,
    })
    const warnings: string[] = []

    await new StepRunner({
      registry,
      store,
      workDir: tmpRoot,
      taskDescription: 'test',
      logger: { warn: message => { warnings.push(message) } },
    }).run(pipeline.steps[0], state)

    const artifact = await store.read('plan')
    expect(artifact.data).toEqual({ summary: 'from message' })
    expect(warnings).toContain('Artifact was extracted from backend message fallback')
  })

  it('degrades schema-invalid optional artifacts to raw_text', async () => {
    const pipeline = compilePipeline(`
version: 1
name: degrade
policies:
  approval: never
  on_failure: abort
steps:
  - id: qa
    role: quality_assurance
    backend: mock
    outputs:
      - type: qa_report
        version: 1
        required: false
        schema:
          type: object
          required: [status]
          properties:
            status:
              type: string
              enum: [pass, fail]
`)
    const registry = new BackendRegistry()
    registry.register(new MockAdapter({
      response: {
        message: 'invalid enum output',
        artifacts: { qa_report: { status: 'unknown' } },
      },
    }))
    const state = await createRunState({ rootDir: tmpRoot, pipeline, runId: 'run-degrade' })
    const store = new ArtifactStore({
      rootDir: tmpRoot,
      runId: state.run_id,
      schemas: pipeline.artifact_schemas,
    })
    const warnings: string[] = []

    await new StepRunner({
      registry,
      store,
      workDir: tmpRoot,
      taskDescription: 'test',
      logger: { warn: message => { warnings.push(message) } },
    }).run(pipeline.steps[0], state)

    const artifact = await store.read('qa_report')
    expect(artifact.data).toMatchObject({
      raw_text: {
        content: 'invalid enum output',
      },
    })
    expect(warnings).toContain('Artifact schema validation failed; degrading to raw_text artifact')
  })

  it('fails required schema-invalid artifacts instead of degrading', async () => {
    const pipeline = compilePipeline(`
version: 1
name: required-invalid
policies:
  approval: never
  on_failure: abort
steps:
  - id: qa
    role: quality_assurance
    backend: mock
    outputs:
      - type: qa_report
        version: 1
        schema:
          type: object
          required: [status]
          properties:
            status:
              type: string
              enum: [pass, fail]
`)
    const registry = new BackendRegistry()
    registry.register(new MockAdapter({
      response: {
        message: 'invalid enum output',
        artifacts: { qa_report: { status: 'unknown' } },
      },
    }))
    const state = await createRunState({ rootDir: tmpRoot, pipeline, runId: 'run-required-invalid' })
    const store = new ArtifactStore({
      rootDir: tmpRoot,
      runId: state.run_id,
      schemas: pipeline.artifact_schemas,
    })

    await expect(new StepRunner({
      registry,
      store,
      workDir: tmpRoot,
      taskDescription: 'test',
    }).run(pipeline.steps[0], state)).rejects.toThrow('failed schema validation')
    expect(await store.exists('qa_report')).toBe(false)
    expect(state.artifacts.qa_report).toBeUndefined()
  })

  it('skips missing optional artifacts instead of writing raw_text', async () => {
    const pipeline = compilePipeline(`
version: 1
name: optional-missing
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
      - type: notes
        version: 1
        required: false
        schema:
          type: object
          required: [summary]
          properties:
            summary:
              type: string
`)
    const registry = new BackendRegistry()
    registry.register(new MessageOnlyAdapter('```json\n{"plan":{"summary":"ready"}}\n```'))
    const state = await createRunState({ rootDir: tmpRoot, pipeline, runId: 'run-optional-missing' })
    const store = new ArtifactStore({
      rootDir: tmpRoot,
      runId: state.run_id,
      schemas: pipeline.artifact_schemas,
    })

    await new StepRunner({
      registry,
      store,
      workDir: tmpRoot,
      taskDescription: 'test',
    }).run(pipeline.steps[0], state)

    expect((await store.read('plan')).data).toEqual({ summary: 'ready' })
    expect(await store.exists('notes')).toBe(false)
    expect(state.artifacts.notes).toBeUndefined()
  })
})

class MessageOnlyAdapter implements BackendAdapter {
  name = 'mock'
  capabilities = {
    supports_session: false,
    supports_structured_output: false,
    supports_streaming: false,
  }

  constructor(private readonly message: string) {}

  async execute() {
    return {
      success: true,
      message: this.message,
      exit_code: 0,
      duration_ms: 0,
    }
  }
}
