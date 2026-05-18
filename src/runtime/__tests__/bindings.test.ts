import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactStore, createArtifact } from '../artifact'
import { applyTransforms, parseBindingExpression, resolveBindings } from '../bindings'
import { compilePipeline } from '../compiler'

const tmpRoot = join(tmpdir(), `ccg-bindings-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('binding resolver', () => {
  it('extracts artifact fields and applies transforms', async () => {
    const pipeline = compilePipeline(`
version: 1
name: bindings
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
          required: [summary, steps]
          properties:
            summary:
              type: string
            steps:
              type: array
  - id: develop
    role: implementation
    backend: mock
    inputs:
      - artifact: plan
        version: 1
    bindings:
      PLAN_SUMMARY: plan.summary|summary
      FIRST_STEP: plan.steps.0
      STEPS_JSON: plan.steps|first_n:1|json_stringify
`)
    const store = new ArtifactStore({ rootDir: tmpRoot, runId: 'run-1', schemas: pipeline.artifact_schemas })
    await store.write(createArtifact({
      type: 'plan',
      version: 1,
      stepId: 'plan',
      data: {
        summary: '  Ship   the runtime with   binding context.  ',
        steps: ['assemble', 'execute'],
      },
    }))

    const bindings = await resolveBindings(pipeline.steps[1], store)

    expect(bindings.PLAN_SUMMARY).toBe('Ship the runtime with binding context.')
    expect(bindings.FIRST_STEP).toBe('assemble')
    expect(bindings.STEPS_JSON).toBe('[\"assemble\"]')
  })

  it('parses transform syntax and rejects invalid transforms', () => {
    expect(parseBindingExpression('plan.summary|first_n:10')).toEqual({
      artifact: 'plan',
      path: 'summary',
      transforms: [{ name: 'first_n', argument: '10' }],
    })
    expect(() => applyTransforms('value', [{ name: 'first_n', argument: 'x' }])).toThrow('first_n')
  })
})
