import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BackendAdapter, BackendCapabilities, BackendInput, BackendOutput, StepResult } from './types'

const defaultWrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'

export interface BaseAdapterOptions {
  wrapperPath?: string
}

export abstract class AbstractBaseAdapter implements BackendAdapter {
  abstract name: string
  abstract capabilities: BackendCapabilities

  protected wrapperPath?: string

  constructor(options: BaseAdapterOptions = {}) {
    this.wrapperPath = options.wrapperPath
  }

  async execute(input: BackendInput): Promise<BackendOutput> {
    return this.invokeWrapper(input)
  }

  async resume(sessionId: string, input: BackendInput): Promise<BackendOutput> {
    return this.invokeWrapper({ ...input, session_id: sessionId })
  }

  protected async invokeWrapper(input: BackendInput): Promise<BackendOutput> {
    const schemaPath = input.output_schema ? await this.writeSchema(input.output_schema, input.work_dir) : undefined
    const args = this.buildArgs(input, schemaPath)

    try {
      return await this.runProcess(args, input)
    } finally {
      if (schemaPath != null) {
        await rm(schemaPath, { force: true }).catch(() => {})
      }
    }
  }

  protected buildArgs(input: BackendInput, schemaPath?: string): string[] {
    const args = ['--backend', this.name, '--json-output']
    if (schemaPath != null) {
      args.push('--output-schema', schemaPath)
    }

    if (input.session_id != null && input.session_id.trim() !== '') {
      args.push('resume', input.session_id, '-', input.work_dir)
    } else {
      args.push('-', input.work_dir)
    }

    return args
  }

  protected async writeSchema(schema: Record<string, unknown>, workDir: string): Promise<string> {
    const dir = resolve(workDir || process.cwd(), '.ccg', 'tmp')
    const path = join(dir, `schema-${randomUUID()}.json`)
    await mkdir(dir, { recursive: true })
    await writeFile(path, JSON.stringify(schema, null, 2), 'utf8')
    return path
  }

  protected async runProcess(args: string[], input: BackendInput): Promise<BackendOutput> {
    const wrapper = this.resolveWrapperPath()
    const startedAt = Date.now()

    return await new Promise<BackendOutput>((resolvePromise) => {
      const child = spawn(wrapper, args, {
        cwd: input.work_dir,
        env: { ...process.env, ...input.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let settled = false
      let timeout: NodeJS.Timeout | undefined

      const finish = (output: BackendOutput) => {
        if (settled) {
          return
        }
        settled = true
        if (timeout != null) {
          clearTimeout(timeout)
        }
        resolvePromise(output)
      }

      if (input.timeout_seconds != null && input.timeout_seconds > 0) {
        timeout = setTimeout(() => {
          child.kill('SIGTERM')
          finish({
            success: false,
            message: stdout,
            exit_code: 124,
            error: `backend ${this.name} timed out after ${input.timeout_seconds}s`,
            duration_ms: Date.now() - startedAt,
          })
        }, input.timeout_seconds * 1000)
      }

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        stdout += chunk
      })
      child.stderr.on('data', chunk => {
        stderr += chunk
      })

      child.on('error', error => {
        finish({
          success: false,
          message: stdout,
          exit_code: 127,
          error: error.message,
          duration_ms: Date.now() - startedAt,
        })
      })

      child.on('close', code => {
        finish(this.parseOutput(stdout, stderr, code ?? 1, Date.now() - startedAt))
      })

      child.stdin.end(input.prompt)
    })
  }

  protected parseOutput(stdout: string, stderr: string, exitCode: number, durationMs: number): BackendOutput {
    const trimmed = stdout.trim()
    if (trimmed !== '') {
      try {
        const result = JSON.parse(trimmed) as StepResult
        return {
          success: result.success,
          session_id: result.session_id,
          message: result.message,
          artifacts: result.artifacts,
          exit_code: result.exit_code,
          error: result.error,
          log_path: result.log_path,
          duration_ms: result.duration_ms ?? durationMs,
        }
      } catch {
        // Fall through to legacy text wrapping.
      }
    }

    return {
      success: exitCode === 0,
      message: stdout,
      exit_code: exitCode,
      error: exitCode === 0 ? undefined : stderr.trim() || `backend ${this.name} exited with code ${exitCode}`,
      duration_ms: durationMs,
    }
  }

  protected resolveWrapperPath(): string {
    if (this.wrapperPath != null && this.wrapperPath.trim() !== '') {
      return this.wrapperPath
    }
    if (process.env.CODEAGENT_WRAPPER_PATH != null && process.env.CODEAGENT_WRAPPER_PATH.trim() !== '') {
      return process.env.CODEAGENT_WRAPPER_PATH
    }

    const here = dirname(fileURLToPath(import.meta.url))
    return resolve(here, '..', '..', 'codeagent-wrapper', defaultWrapperName)
  }
}
