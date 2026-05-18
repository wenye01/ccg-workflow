import type { BackendAdapter, BackendOutput, CompiledStep, OrchestratorCallbacks, RunState } from './types'
import type { BackendRegistry } from '../backends'
import { ArtifactStore, createArtifact } from './artifact'
import { assemblePrompt } from './prompt-assembler'
import { resolveBindings } from './bindings'

export interface StepRunnerOptions {
  registry: BackendRegistry
  store: ArtifactStore
  workDir: string
  taskDescription: string
}

export class StepRunner {
  constructor(private readonly options: StepRunnerOptions) {}

  async run(step: CompiledStep, state: RunState, callbacks: OrchestratorCallbacks = {}): Promise<BackendOutput> {
    const bindings = await resolveBindings(step, this.options.store)
    const assembled = await assemblePrompt({
      step,
      workDir: this.options.workDir,
      taskDescription: this.options.taskDescription,
      bindings,
    })
    const backend = this.options.registry.get(step.backend)
    const stepState = state.steps[step.id]
    const input = {
      prompt: assembled.prompt,
      work_dir: this.options.workDir,
      session_id: stepState?.backend_session_id,
      timeout_seconds: step.policies?.timeout_seconds,
      env: bindings,
      output_schema: assembled.output_schema,
    }

    const result = await executeBackend(backend, input)
    if (!result.success) {
      throw new Error(result.error ?? `Step "${step.id}" failed with exit code ${result.exit_code}`)
    }

    await this.persistArtifacts(step, result, state, callbacks)
    return result
  }

  private async persistArtifacts(
    step: CompiledStep,
    result: BackendOutput,
    state: RunState,
    callbacks: OrchestratorCallbacks,
  ): Promise<void> {
    for (const output of step.outputs ?? []) {
      const data = extractArtifactData(output.type, step.outputs?.length ?? 0, result.artifacts)
      if (data === undefined) {
        if (output.required === false) {
          continue
        }
        throw new Error(`Step "${step.id}" did not produce required artifact "${output.type}"`)
      }

      const artifact = createArtifact({
        type: output.type,
        version: output.version,
        stepId: step.id,
        data,
      })
      const record = await this.options.store.write(artifact)
      state.artifacts[output.type] = record
      await callbacks.onArtifactProduced?.(artifact, state)
    }
  }
}

async function executeBackend(
  backend: BackendAdapter,
  input: Parameters<BackendAdapter['execute']>[0],
): Promise<BackendOutput> {
  if (input.session_id != null && backend.resume != null) {
    return backend.resume(input.session_id, input)
  }
  return backend.execute(input)
}

function extractArtifactData(
  outputType: string,
  outputCount: number,
  artifacts: Record<string, unknown> | undefined,
): unknown {
  if (artifacts == null) {
    return undefined
  }
  if (Object.prototype.hasOwnProperty.call(artifacts, outputType)) {
    return artifacts[outputType]
  }
  if (outputCount === 1) {
    return artifacts
  }
  return undefined
}
