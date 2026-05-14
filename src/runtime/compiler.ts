import type {
  ArtifactSchemaDecl,
  CompiledPipeline,
  CompiledStep,
  DataEdge,
  PipelineConfig,
  ResolvedInput,
} from './types'
import fs from 'fs-extra'
import { parse } from 'yaml'
import { artifactKey, assertValidPipelineConfig } from './validator'

export async function compilePipelineFile(path: string): Promise<CompiledPipeline> {
  const source = await fs.readFile(path, 'utf8')
  return compilePipeline(source, path)
}

export function compilePipeline(source: string, sourcePath?: string): CompiledPipeline {
  const parsed = parse(source) as unknown
  assertValidPipelineConfig(parsed)
  return compilePipelineConfig(parsed, sourcePath)
}

export function compilePipelineConfig(config: PipelineConfig, sourcePath?: string): CompiledPipeline {
  assertValidPipelineConfig(config)

  const artifactSchemas = buildArtifactSchemaMap(config)
  const produced = new Map<string, { stepId: string, version: number }>()
  const steps: CompiledStep[] = []

  config.steps.forEach((step, index) => {
    const resolvedInputs: ResolvedInput[] = (step.inputs ?? []).map(input => {
      const producer = produced.get(artifactKey(input.artifact, input.version))
      if (!producer) {
        throw new Error(`Step "${step.id}" input "${input.artifact}@${input.version}" has no producer`)
      }

      return {
        artifact_type: input.artifact,
        source_step: producer.stepId,
        version: input.version,
      }
    })

    const dataEdges: DataEdge[] = resolvedInputs.map(input => ({
      from_step: input.source_step,
      to_step: step.id,
      artifact_type: input.artifact_type,
      version: input.version,
      bindings: bindingsForArtifact(step.bindings ?? {}, input.artifact_type),
    }))

    const nextStep = config.steps[index + 1]
    const compiledStep: CompiledStep = {
      ...step,
      index,
      resolved_inputs: resolvedInputs,
      control_edges: nextStep ? [{ type: 'next', target: nextStep.id }] : [],
      data_edges: dataEdges,
    }

    steps.push(compiledStep)

    for (const output of step.outputs ?? []) {
      produced.set(artifactKey(output.type, output.version), { stepId: step.id, version: output.version })
    }
  })

  return {
    version: config.version,
    name: config.name,
    steps,
    artifact_schemas: artifactSchemas,
    policies: config.policies,
    metadata: {
      compiled_at: new Date().toISOString(),
      source_path: sourcePath,
    },
  }
}

function buildArtifactSchemaMap(config: PipelineConfig): Map<string, ArtifactSchemaDecl> {
  const schemas = new Map<string, ArtifactSchemaDecl>()

  for (const artifact of config.artifacts ?? []) {
    schemas.set(artifactKey(artifact.type, artifact.version), artifact)
  }

  for (const step of config.steps) {
    for (const output of step.outputs ?? []) {
      schemas.set(artifactKey(output.type, output.version), {
        type: output.type,
        version: output.version,
        schema: output.schema,
      })
    }
  }

  return schemas
}

function bindingsForArtifact(bindings: Record<string, string>, artifactType: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(bindings).filter(([, value]) => value.startsWith(`${artifactType}.`)),
  )
}
