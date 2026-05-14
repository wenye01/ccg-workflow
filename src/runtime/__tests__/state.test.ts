import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import { compilePipeline } from '../compiler'
import { RunStateManager } from '../state'

const tmpRoot = join(tmpdir(), `ccg-state-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('run state manager', () => {
  it('creates, persists, loads, and updates run state', async () => {
    const pipeline = compilePipeline(`
version: 1
name: stateful
policies:
  approval: never
  on_failure: abort
steps:
  - id: plan
    role: planning
    backend: codex
  - id: review
    role: review
    backend: claude
    policies:
      approval: always
`)
    const manager = new RunStateManager(tmpRoot)

    const created = await manager.create(pipeline, 'run-1')
    expect(created.current_step).toBe('plan')
    expect(created.steps.plan.status).toBe('pending')
    expect(created.steps.review.approval_required).toBe(true)

    const loaded = await manager.load('run-1')
    expect(loaded.pipeline_name).toBe('stateful')

    const updated = await manager.update('run-1', state => {
      state.steps.plan.status = 'succeeded'
      state.current_step = 'review'
    })

    expect(updated.steps.plan.status).toBe('succeeded')
    expect(updated.current_step).toBe('review')
  })
})
