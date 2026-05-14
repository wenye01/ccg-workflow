import type { CompiledPipeline, RunState, StepState } from './types'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import fs from 'fs-extra'

export interface CreateRunStateOptions {
  rootDir: string
  pipeline: CompiledPipeline
  runId?: string
  now?: string
}

export class RunStateManager {
  constructor(private readonly rootDir: string) {}

  getStatePath(runId: string): string {
    return join(this.rootDir, '.ccg', 'runs', runId, 'state.json')
  }

  async create(pipeline: CompiledPipeline, runId: string = randomUUID()): Promise<RunState> {
    const now = new Date().toISOString()
    const steps: Record<string, StepState> = {}

    for (const step of pipeline.steps) {
      steps[step.id] = {
        step_id: step.id,
        status: 'pending',
        attempt: 0,
        approval_required: (step.policies?.approval ?? pipeline.policies.approval) === 'always',
      }
    }

    const state: RunState = {
      run_id: runId,
      pipeline_name: pipeline.name,
      pipeline_version: pipeline.version,
      status: 'running',
      started_at: now,
      updated_at: now,
      current_step: pipeline.steps[0]?.id ?? null,
      steps,
      artifacts: {},
    }

    await this.save(state)
    return state
  }

  async load(runId: string): Promise<RunState> {
    return await fs.readJson(this.getStatePath(runId)) as RunState
  }

  async save(state: RunState): Promise<void> {
    state.updated_at = new Date().toISOString()
    const path = this.getStatePath(state.run_id)
    await fs.ensureDir(join(this.rootDir, '.ccg', 'runs', state.run_id))
    await fs.writeJson(path, state, { spaces: 2 })
  }

  async update(runId: string, mutate: (state: RunState) => void | Promise<void>): Promise<RunState> {
    const state = await this.load(runId)
    await mutate(state)
    await this.save(state)
    return state
  }
}

export async function createRunState(options: CreateRunStateOptions): Promise<RunState> {
  const manager = new RunStateManager(options.rootDir)
  const state = await manager.create(options.pipeline, options.runId)
  if (options.now) {
    state.started_at = options.now
    state.updated_at = options.now
    await manager.save(state)
  }
  return state
}
