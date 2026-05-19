import { join } from 'node:path'
import ansis from 'ansis'
import fs from 'fs-extra'

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RuntimeLogEntry {
  timestamp: string
  level: RuntimeLogLevel
  message: string
  run_id?: string
  step_id?: string
  data?: Record<string, unknown>
}

export interface RuntimeLoggerOptions {
  rootDir: string
  runId?: string
  silent?: boolean
  console?: boolean
}

export class RuntimeLogger {
  private runId?: string

  constructor(private readonly options: RuntimeLoggerOptions) {
    this.runId = options.runId
  }

  bindRun(runId: string): RuntimeLogger {
    this.runId = runId
    return this
  }

  get logPath(): string | undefined {
    if (this.runId == null || this.runId.trim() === '') {
      return undefined
    }
    return join(this.options.rootDir, '.ccg', 'runs', this.runId, 'runtime.log')
  }

  debug(message: string, data?: Record<string, unknown>): Promise<void> {
    return this.write('debug', message, data)
  }

  info(message: string, data?: Record<string, unknown>): Promise<void> {
    return this.write('info', message, data)
  }

  warn(message: string, data?: Record<string, unknown>): Promise<void> {
    return this.write('warn', message, data)
  }

  error(message: string, data?: Record<string, unknown>): Promise<void> {
    return this.write('error', message, data)
  }

  async write(level: RuntimeLogLevel, message: string, data?: Record<string, unknown>): Promise<void> {
    const entry: RuntimeLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      run_id: this.runId,
      step_id: typeof data?.step_id === 'string' ? data.step_id : undefined,
      data,
    }

    const path = this.logPath
    if (path != null) {
      await fs.ensureDir(join(this.options.rootDir, '.ccg', 'runs', this.runId ?? ''))
      await fs.appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
    }

    if (this.options.console === true && this.options.silent !== true) {
      console.log(formatLogEntry(entry))
    }
  }
}

export function createRuntimeLogger(options: RuntimeLoggerOptions): RuntimeLogger {
  return new RuntimeLogger(options)
}

function formatLogEntry(entry: RuntimeLogEntry): string {
  const prefix = `[${entry.level}]`
  const scoped = entry.step_id != null ? ` ${entry.step_id}` : ''
  const message = `${prefix}${scoped} ${entry.message}`
  if (entry.level === 'error') return ansis.red(message)
  if (entry.level === 'warn') return ansis.yellow(message)
  if (entry.level === 'info') return ansis.cyan(message)
  return ansis.gray(message)
}
