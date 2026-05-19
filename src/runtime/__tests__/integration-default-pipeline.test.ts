import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendRegistry, MockAdapter } from '../../backends'
import type { BackendInput, BackendOutput } from '../types'
import { compilePipelineFile, runPipeline } from '../index'

const tmpRoot = join(tmpdir(), `ccg-integration-default-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('default pipeline integration', () => {
  it('runs the built-in default pipeline end to end with schema-aware mock output', async () => {
    const pipeline = await compilePipelineFile(join(process.cwd(), 'src', 'pipelines', 'default.yaml'))
    const registry = new BackendRegistry()
    registry.register(new SchemaAwareMockAdapter())

    const state = await runPipeline({
      pipeline: {
        ...pipeline,
        steps: pipeline.steps.map(step => ({ ...step, backend: 'mock' })),
      },
      registry,
      workDir: tmpRoot,
      taskDescription: 'Build phase 5 runtime integration',
      runId: 'run-default',
    })

    expect(state.status).toBe('completed')
    expect(Object.values(state.steps).map(step => step.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
    expect(await fs.pathExists(state.artifacts.plan.path)).toBe(true)
    expect(await fs.pathExists(state.artifacts.implementation.path)).toBe(true)
    expect(await fs.pathExists(state.artifacts.qa_report.path)).toBe(true)
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
