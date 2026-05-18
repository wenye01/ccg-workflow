import type { BackendRegistry } from '../backends'
import type { CompiledPipeline, CompiledStep, OrchestratorCallbacks, RunState, StepStatus } from './types'
import { ArtifactStore } from './artifact'
import { resolveFailureAction, requiresApproval } from './recovery'
import { RunStateManager } from './state'
import { StepRunner } from './runner'

export interface OrchestratorOptions {
  pipeline: CompiledPipeline
  registry: BackendRegistry
  workDir: string
  taskDescription: string
  runId?: string
  callbacks?: OrchestratorCallbacks
}

export class Orchestrator {
  private readonly stateManager: RunStateManager
  private store: ArtifactStore
  private runner: StepRunner
  private readonly callbacks: OrchestratorCallbacks

  constructor(private readonly options: OrchestratorOptions) {
    this.stateManager = new RunStateManager(options.workDir)
    this.store = new ArtifactStore({
      rootDir: options.workDir,
      runId: options.runId ?? '',
      schemas: options.pipeline.artifact_schemas,
    })
    this.runner = new StepRunner({
      registry: options.registry,
      store: this.store,
      workDir: options.workDir,
      taskDescription: options.taskDescription,
    })
    this.callbacks = options.callbacks ?? {}
  }

  async run(): Promise<RunState> {
    let state = await this.loadOrCreateState()
    state.status = 'running'
    await this.stateManager.save(state)
    this.rebindRunScopedStore(state.run_id)

    for (const step of this.options.pipeline.steps) {
      const previousStatus = state.steps[step.id]?.status
      if (previousStatus === 'succeeded' || previousStatus === 'skipped') {
        continue
      }

      state.current_step = step.id

      if (requiresApproval(this.options.pipeline, step)) {
        state = await this.markStep(state, step, 'waiting_for_approval')
        const approved = await this.callbacks.onApprovalRequired?.(step, state) ?? false
        if (!approved) {
          state = await this.markStep(state, step, 'skipped')
          continue
        }
      }

      state = await this.runStepWithRecovery(step, state)
      if (state.status === 'failed' || state.status === 'aborted') {
        await this.callbacks.onComplete?.(state)
        return state
      }
    }

    state.status = 'completed'
    state.current_step = null
    await this.stateManager.save(state)
    await this.callbacks.onComplete?.(state)
    return state
  }

  private async runStepWithRecovery(step: CompiledStep, state: RunState): Promise<RunState> {
    while (true) {
      state = await this.startAttempt(state, step)
      await this.callbacks.onStepStart?.(step, state)

      try {
        const result = await this.runner.run(step, state, this.callbacks)
        const stepState = state.steps[step.id]
        stepState.status = 'succeeded'
        stepState.completed_at = new Date().toISOString()
        stepState.backend_session_id = result.session_id ?? stepState.backend_session_id
        delete stepState.error
        await this.stateManager.save(state)
        await this.callbacks.onStepComplete?.(step, result, state)
        return state
      }
      catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        await this.callbacks.onStepFailed?.(step, err, state)

        const action = resolveFailureAction(this.options.pipeline, step, state.steps[step.id].attempt)
        if (action === 'retry') {
          state.steps[step.id].error = err.message
          await this.stateManager.save(state)
          continue
        }
        if (action === 'skip') {
          state.steps[step.id].status = 'skipped'
          state.steps[step.id].completed_at = new Date().toISOString()
          state.steps[step.id].error = err.message
          await this.stateManager.save(state)
          return state
        }

        state.status = 'failed'
        state.steps[step.id].status = 'failed'
        state.steps[step.id].completed_at = new Date().toISOString()
        state.steps[step.id].error = err.message
        await this.stateManager.save(state)
        return state
      }
    }
  }

  private async startAttempt(state: RunState, step: CompiledStep): Promise<RunState> {
    const stepState = state.steps[step.id]
    stepState.status = 'running'
    stepState.started_at = stepState.started_at ?? new Date().toISOString()
    stepState.completed_at = undefined
    stepState.attempt += 1
    await this.stateManager.save(state)
    return state
  }

  private async markStep(state: RunState, step: CompiledStep, status: StepStatus): Promise<RunState> {
    const stepState = state.steps[step.id]
    stepState.status = status
    if (status === 'skipped') {
      stepState.completed_at = new Date().toISOString()
    }
    await this.stateManager.save(state)
    return state
  }

  private rebindRunScopedStore(runId: string): void {
    this.store = new ArtifactStore({
      rootDir: this.options.workDir,
      runId,
      schemas: this.options.pipeline.artifact_schemas,
    })
    this.runner = new StepRunner({
      registry: this.options.registry,
      store: this.store,
      workDir: this.options.workDir,
      taskDescription: this.options.taskDescription,
    })
  }

  private async loadOrCreateState(): Promise<RunState> {
    if (this.options.runId != null) {
      try {
        return await this.stateManager.load(this.options.runId)
      }
      catch {
        // Missing state for an explicit run id means this is a new named run.
      }
    }

    return this.stateManager.create(this.options.pipeline, this.options.runId)
  }
}

export async function runPipeline(options: OrchestratorOptions): Promise<RunState> {
  return new Orchestrator(options).run()
}
