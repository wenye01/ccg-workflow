import type { BackendAdapter, BackendOutput, CompiledStep, OrchestratorCallbacks, OutputBinding, RunState, RuntimeLoggerLike } from './types'
import type { BackendRegistry } from '../backends'
import { ArtifactStore, createArtifact, validateJsonSchema } from './artifact'
import { assemblePrompt } from './prompt-assembler'
import { resolveBindings } from './bindings'

export interface StepRunnerOptions {
  registry: BackendRegistry
  store: ArtifactStore
  workDir: string
  taskDescription: string
  logger?: RuntimeLoggerLike
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
      const extraction = extractArtifactData(output, step.outputs?.length ?? 0, result)
      const data = extraction.data
      if (data === undefined) {
        if (output.required === false) {
          await this.persistRawArtifact(step, output, result, state, callbacks, 'artifact extraction failed')
          continue
        }
        throw new Error(`Step "${step.id}" did not produce required artifact "${output.type}"`)
      }

      const schemaErrors = validateJsonSchema(data, output.schema)
      if (schemaErrors.length > 0) {
        await this.options.logger?.warn?.('Artifact schema validation failed; degrading to raw_text artifact', {
          step_id: step.id,
          artifact: `${output.type}@${output.version}`,
          errors: schemaErrors,
        })
        await this.persistRawArtifact(step, output, result, state, callbacks, schemaErrors.join('\n'))
        continue
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

      if (extraction.source === 'message') {
        await this.options.logger?.warn?.('Artifact was extracted from backend message fallback', {
          step_id: step.id,
          artifact: `${output.type}@${output.version}`,
        })
      }
    }
  }

  private async persistRawArtifact(
    step: CompiledStep,
    output: OutputBinding,
    result: BackendOutput,
    state: RunState,
    callbacks: OrchestratorCallbacks,
    reason: string,
  ): Promise<void> {
    const artifact = createArtifact({
      type: output.type,
      version: output.version,
      stepId: step.id,
      data: {
        raw_text: {
          content: result.message,
          reason,
        },
      },
    })
    const record = await this.options.store.write(artifact, { validate: false })
    state.artifacts[output.type] = record
    await callbacks.onArtifactProduced?.(artifact, state)
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
  output: OutputBinding,
  outputCount: number,
  result: BackendOutput,
): { data: unknown, source: 'artifacts' | 'message' | 'none' } {
  const artifacts = result.artifacts
  const outputType = output.type
  if (artifacts == null) {
    const parsed = extractJsonObjectFromText(result.message)
    if (parsed == null) {
      return { data: undefined, source: 'none' }
    }
    return {
      data: Object.prototype.hasOwnProperty.call(parsed, outputType) ? parsed[outputType] : parsed,
      source: 'message',
    }
  }
  if (Object.prototype.hasOwnProperty.call(artifacts, outputType)) {
    return { data: artifacts[outputType], source: 'artifacts' }
  }
  if (outputCount === 1) {
    return { data: artifacts, source: 'artifacts' }
  }
  return { data: undefined, source: 'none' }
}

const fencedJsonBlockRe = /```json\s*([\s\S]*?)\s*```/gi

function extractJsonObjectFromText(text: string): Record<string, unknown> | undefined {
  const blocks = [...text.matchAll(fencedJsonBlockRe)].map(match => match[1])
  for (const candidate of [...blocks].reverse()) {
    const parsed = parseJsonObject(candidate)
    if (parsed != null) {
      return parsed
    }
  }
  return parseJsonObject(text)
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text.trim()) as unknown
    return isRecord(parsed) ? parsed : undefined
  }
  catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
