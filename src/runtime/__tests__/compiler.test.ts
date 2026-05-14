import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compilePipeline, compilePipelineFile } from '../compiler'

describe('runtime compiler', () => {
  it('compiles YAML into a linear IR with control and data edges', () => {
    const pipeline = compilePipeline(`
version: 1
name: sample
policies:
  approval: never
  on_failure: abort
steps:
  - id: plan
    role: planning
    backend: codex
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
    backend: codex
    inputs:
      - artifact: plan
        version: 1
    bindings:
      PLAN_SUMMARY: plan.summary
`)

    expect(pipeline.name).toBe('sample')
    expect(pipeline.steps).toHaveLength(2)
    expect(pipeline.steps[0].control_edges).toEqual([{ type: 'next', target: 'develop' }])
    expect(pipeline.steps[1].resolved_inputs).toEqual([
      { artifact_type: 'plan', source_step: 'plan', version: 1 },
    ])
    expect(pipeline.steps[1].data_edges).toEqual([
      {
        from_step: 'plan',
        to_step: 'develop',
        artifact_type: 'plan',
        version: 1,
        bindings: { PLAN_SUMMARY: 'plan.summary' },
      },
    ])
    expect(pipeline.artifact_schemas.has('plan@1')).toBe(true)
  })

  it('compiles all built-in pipelines', async () => {
    const root = process.cwd()
    const files = ['default.yaml', 'full.yaml', 'team.yaml']

    for (const file of files) {
      const pipeline = await compilePipelineFile(join(root, 'src', 'pipelines', file))
      expect(pipeline.steps.length).toBeGreaterThan(0)
      expect(pipeline.metadata.source_path).toContain(file)
    }
  })
})
