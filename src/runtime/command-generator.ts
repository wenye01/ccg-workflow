import type { PipelineConfig } from './types'
import { basename, extname } from 'node:path'
import { parse } from 'yaml'

export interface RuntimeCommandOptions {
  pipeline: string
  description?: string
  promptFlag?: string
}

export function generateRuntimeCommand(options: RuntimeCommandOptions): string {
  const description = options.description ?? `Run ${options.pipeline} pipeline`
  const promptFlag = options.promptFlag ?? '--prompt "$ARGUMENTS"'

  return `---
description: '${escapeSingleQuotedYaml(description)}'
---
! \`ccg run ${options.pipeline} ${promptFlag}\`
`
}

export function generateRuntimeCommandFromPipeline(source: string, fallbackPipeline: string): string {
  const parsed = parse(source) as Partial<PipelineConfig> | null
  const pipeline = parsed?.name ?? pipelineNameFromPath(fallbackPipeline)
  const description = parsed?.description ?? `Run ${pipeline} pipeline`
  return generateRuntimeCommand({ pipeline, description })
}

function pipelineNameFromPath(path: string): string {
  const base = basename(path)
  const ext = extname(base)
  return ext === '' ? base : base.slice(0, -ext.length)
}

function escapeSingleQuotedYaml(value: string): string {
  return value.replace(/'/g, `''`)
}
