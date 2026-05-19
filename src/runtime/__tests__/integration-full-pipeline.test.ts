import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendRegistry, MockAdapter } from '../../backends'
import type { BackendInput, BackendOutput } from '../types'
import { compilePipelineFile, runPipeline } from '../index'

const tmpRoot = join(tmpdir(), `ccg-integration-full-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('full pipeline integration', () => {
  it('runs the built-in full pipeline end to end with mock backends', async () => {
    const pipeline = await compilePipelineFile(join(process.cwd(), 'src', 'pipelines', 'full.yaml'))
    const registry = new BackendRegistry()
    registry.register(new SchemaAwareMockAdapter())

    const state = await runPipeline({
      pipeline: {
        ...pipeline,
        policies: { ...pipeline.policies, approval: 'never' },
        steps: pipeline.steps.map(step => ({ ...step, backend: 'mock' })),
      },
      registry,
      workDir: tmpRoot,
      taskDescription: 'Build phase 5 runtime integration',
      runId: 'run-full',
    })

    expect(state.status).toBe('completed')
    expect(Object.values(state.steps)).toHaveLength(6)
    expect(Object.values(state.steps).every(step => step.status === 'succeeded')).toBe(true)
    expect(Object.keys(state.artifacts)).toEqual([
      'research_report',
      'concept',
      'plan',
      'implementation',
      'optimization_report',
      'review_report',
    ])
  })
})

class SchemaAwareMockAdapter extends MockAdapter {
  override async execute(input: BackendInput): Promise<BackendOutput> {
    const output = await super.execute(input)
    return {
      ...output,
      artifacts: input.output_schema == null ? output.artifacts : mockDataFromSchema(input.output_schema),
    }
  }
}

function mockDataFromSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  return Object.fromEntries(
    Object.entries(properties).map(([key, property]) => [key, mockValueForSchema(isRecord(property) ? property : {})]),
  )
}

function mockValueForSchema(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0]
  }

  switch (schema.type) {
    case 'array':
      return [mockValueForSchema(isRecord(schema.items) ? schema.items : { type: 'string' })]
    case 'boolean':
      return true
    case 'integer':
    case 'number':
      return 1
    case 'object':
      return mockDataFromSchema(schema)
    case 'string':
    default:
      return 'mock'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
