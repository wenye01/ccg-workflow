import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactStore, createArtifact } from '../artifact'

const tmpRoot = join(tmpdir(), `ccg-artifact-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('artifact store', () => {
  it('writes and reads artifacts with checksum records', async () => {
    const store = new ArtifactStore({ rootDir: tmpRoot, runId: 'run-1' })
    const artifact = createArtifact({
      type: 'plan',
      version: 1,
      stepId: 'plan',
      data: { summary: 'ship it' },
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const record = await store.write(artifact)
    const read = await store.read('plan', 1)

    expect(record.path).toContain(join('.ccg', 'runs', 'run-1', 'artifacts', 'plan.json'))
    expect(record.checksum).toHaveLength(64)
    expect(read.data).toEqual({ summary: 'ship it' })
  })

  it('enforces artifact version checks', async () => {
    const store = new ArtifactStore({ rootDir: tmpRoot, runId: 'run-version' })
    await store.write(createArtifact({
      type: 'plan',
      version: 1,
      stepId: 'plan',
      data: { summary: 'v1' },
    }))

    await expect(store.read('plan', 2)).rejects.toThrow('version mismatch')
  })

  it('validates data against registered schemas', async () => {
    const schemas = new Map([
      ['plan@1', {
        type: 'plan',
        version: 1,
        schema: {
          type: 'object',
          required: ['summary'],
          properties: {
            summary: { type: 'string' },
          },
        },
      }],
    ])
    const store = new ArtifactStore({ rootDir: tmpRoot, runId: 'run-schema', schemas })

    await expect(store.write(createArtifact({
      type: 'plan',
      version: 1,
      stepId: 'plan',
      data: {},
    }))).rejects.toThrow('schema validation')
  })

  it('validates richer JSON schema constraints', async () => {
    const schemas = new Map([
      ['report@1', {
        type: 'report',
        version: 1,
        schema: {
          type: 'object',
          required: ['status', 'slug'],
          properties: {
            status: { type: 'string', enum: ['pass', 'fail'] },
            slug: { type: 'string', pattern: '^[a-z-]+$', minLength: 3 },
          },
        },
      }],
    ])
    const store = new ArtifactStore({ rootDir: tmpRoot, runId: 'run-rich-schema', schemas })

    await expect(store.write(createArtifact({
      type: 'report',
      version: 1,
      stepId: 'qa',
      data: { status: 'unknown', slug: 'A' },
    }))).rejects.toThrow('schema validation')
  })

  it('can bypass schema validation for degraded raw artifacts', async () => {
    const schemas = new Map([
      ['plan@1', {
        type: 'plan',
        version: 1,
        schema: {
          type: 'object',
          required: ['summary'],
          properties: {
            summary: { type: 'string' },
          },
        },
      }],
    ])
    const store = new ArtifactStore({ rootDir: tmpRoot, runId: 'run-raw', schemas })

    await store.write(createArtifact({
      type: 'plan',
      version: 1,
      stepId: 'plan',
      data: { raw_text: { content: 'not structured' } },
    }), { validate: false })

    const read = await store.read('plan')
    expect(read.data).toEqual({ raw_text: { content: 'not structured' } })
  })
})
