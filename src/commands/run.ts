import type { CAC } from 'cac'
import type { BackendAdapter, BackendInput, BackendOutput, CompiledPipeline, CompiledStep, RunState } from '../runtime'
import ansis from 'ansis'
import fs from 'fs-extra'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'pathe'
import { BackendRegistry, createDefaultBackendRegistry, MockAdapter } from '../backends'
import { compilePipelineFile, runPipeline, RunStateManager } from '../runtime'
import { PACKAGE_ROOT } from '../utils/installer-template'

const BUILT_IN_PIPELINES = ['default', 'full', 'team'] as const

export interface RunCommandOptions {
  list?: boolean
  status?: string
  resume?: string
  prompt?: string
  backend?: string
  workDir?: string
  runId?: string
}

export function registerRunCommand(cli: CAC): void {
  cli
    .command('run [pipeline]', 'Run a CCG runtime pipeline')
    .option('--list', 'List available runtime pipelines')
    .option('--status <run-id>', 'Show run status')
    .option('--resume <run-id>', 'Resume a previous run')
    .option('--prompt <prompt>', 'Task description to pass to the pipeline')
    .option('--backend <backend>', 'Override all step backends (for example: mock)')
    .option('--work-dir <path>', 'Project directory to run in')
    .option('--run-id <run-id>', 'Use a specific run id for a new run')
    .action(async (pipeline: string | undefined, options: RunCommandOptions) => {
      await runCommand(pipeline, options)
    })
}

export async function runCommand(pipelineArg?: string, options: RunCommandOptions = {}): Promise<void> {
  const workDir = resolve(options.workDir ?? process.cwd())
  const wrapperPath = await resolveWrapperPath(workDir)

  if (options.list) {
    await listPipelines()
    return
  }

  if (options.status != null) {
    await printStatus(workDir, options.status)
    return
  }

  const runId = options.resume ?? options.runId
  const pipeline = await loadPipeline(pipelineArg ?? 'default')
  const compiled = options.backend != null
    ? overridePipelineBackend(pipeline, options.backend)
    : pipeline
  const registry = createCliBackendRegistry(options.backend, wrapperPath)

  const state = await runPipeline({
    pipeline: compiled,
    registry,
    workDir,
    taskDescription: options.prompt ?? '',
    runId,
    callbacks: createConsoleCallbacks(),
  })

  printRunSummary(state)
}

async function listPipelines(): Promise<void> {
  console.log(ansis.cyan('Built-in pipelines:'))
  for (const name of BUILT_IN_PIPELINES) {
    const pipeline = await loadPipeline(name)
    console.log(`  ${ansis.green(name)}  ${pipeline.metadata.source_path ?? ''}`)
  }
}

async function printStatus(workDir: string, runId: string): Promise<void> {
  const state = await new RunStateManager(workDir).load(runId)
  console.log(`${ansis.cyan('Run')} ${state.run_id}`)
  console.log(`Pipeline: ${state.pipeline_name}@${state.pipeline_version}`)
  console.log(`Status: ${formatStateStatus(state.status)}`)
  console.log(`Current step: ${state.current_step ?? '-'}`)
  console.log(`Updated: ${state.updated_at}`)
  console.log('')

  for (const step of Object.values(state.steps)) {
    const attempt = step.attempt > 0 ? ` attempt=${step.attempt}` : ''
    const error = step.error != null ? ` ${ansis.red(step.error)}` : ''
    console.log(`  ${formatStepStatus(step.status)} ${step.step_id}${attempt}${error}`)
  }
}

async function loadPipeline(nameOrPath: string): Promise<CompiledPipeline> {
  const path = await resolvePipelinePath(nameOrPath)
  return compilePipelineFile(path)
}

async function resolvePipelinePath(nameOrPath: string): Promise<string> {
  if (nameOrPath.includes('/') || nameOrPath.includes('\\') || nameOrPath.endsWith('.yaml') || nameOrPath.endsWith('.yml')) {
    return isAbsolute(nameOrPath) ? nameOrPath : resolve(process.cwd(), nameOrPath)
  }

  const builtIn = join(PACKAGE_ROOT, 'src', 'pipelines', `${nameOrPath}.yaml`)
  if (await fs.pathExists(builtIn)) {
    return builtIn
  }

  throw new Error(`Unknown pipeline "${nameOrPath}". Use "ccg run --list" to see built-ins.`)
}

function overridePipelineBackend(pipeline: CompiledPipeline, backend: string): CompiledPipeline {
  return {
    ...pipeline,
    steps: pipeline.steps.map(step => ({ ...step, backend })),
  }
}

function createCliBackendRegistry(backendOverride?: string, wrapperPath?: string): BackendRegistry {
  if (backendOverride !== 'mock') {
    return createDefaultBackendRegistry({ wrapperPath })
  }

  const registry = createDefaultBackendRegistry({ wrapperPath })
  registry.register(new SchemaAwareMockAdapter())
  return registry
}

async function resolveWrapperPath(workDir: string): Promise<string | undefined> {
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const localWrapper = join(workDir, '.ccg', 'bin', wrapperName)
  const globalWrapper = join(homedir(), '.ccg', 'bin', wrapperName)
  const bundledWrapper = join(PACKAGE_ROOT, 'codeagent-wrapper', wrapperName)

  for (const candidate of [localWrapper, globalWrapper, bundledWrapper]) {
    if (await fs.pathExists(candidate)) {
      return candidate
    }
  }

  return undefined
}

function createConsoleCallbacks() {
  return {
    onStepStart(step: CompiledStep) {
      console.log(ansis.cyan(`→ ${step.id}`))
    },
    onStepComplete(step: CompiledStep, result: BackendOutput) {
      const duration = result.duration_ms != null ? ` (${result.duration_ms}ms)` : ''
      console.log(ansis.green(`✓ ${step.id}${duration}`))
    },
    onStepFailed(step: CompiledStep, error: Error) {
      console.log(ansis.red(`✗ ${step.id}: ${error.message}`))
    },
    async onApprovalRequired(step: CompiledStep) {
      console.log(ansis.yellow(`Approval required for step "${step.id}". Skipping in non-interactive runtime.`))
      return false
    },
  }
}

function printRunSummary(state: RunState): void {
  console.log('')
  console.log(`${ansis.cyan('Run ID:')} ${state.run_id}`)
  console.log(`${ansis.cyan('Status:')} ${formatStateStatus(state.status)}`)
}

function formatStateStatus(status: RunState['status']): string {
  if (status === 'completed') return ansis.green(status)
  if (status === 'failed' || status === 'aborted') return ansis.red(status)
  if (status === 'paused') return ansis.yellow(status)
  return ansis.cyan(status)
}

function formatStepStatus(status: string): string {
  if (status === 'succeeded') return ansis.green(status.padEnd(20))
  if (status === 'failed') return ansis.red(status.padEnd(20))
  if (status === 'skipped') return ansis.yellow(status.padEnd(20))
  return ansis.cyan(status.padEnd(20))
}

class SchemaAwareMockAdapter extends MockAdapter implements BackendAdapter {
  override async execute(input: BackendInput): Promise<BackendOutput> {
    const output = await super.execute(input)
    return {
      ...output,
      artifacts: input.output_schema == null
        ? output.artifacts
        : mockDataFromSchema(input.output_schema),
    }
  }
}

function mockDataFromSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const data: Record<string, unknown> = {}

  for (const [key, property] of Object.entries(properties)) {
    data[key] = mockValueForSchema(isRecord(property) ? property : {})
  }

  return data
}

function mockValueForSchema(schema: Record<string, unknown>): unknown {
  switch (schema.type) {
    case 'array':
      return ['mock']
    case 'number':
    case 'integer':
      return 1
    case 'boolean':
      return true
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
