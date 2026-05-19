import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import { createRuntimeLogger } from '../logger'

const tmpRoot = join(tmpdir(), `ccg-logger-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('runtime logger', () => {
  it('writes structured JSONL logs under the run directory', async () => {
    const logger = createRuntimeLogger({ rootDir: tmpRoot }).bindRun('run-log')

    await logger.info('Step completed', { step_id: 'plan', duration_ms: 12 })

    const logPath = join(tmpRoot, '.ccg', 'runs', 'run-log', 'runtime.log')
    const lines = (await fs.readFile(logPath, 'utf8')).trim().split('\n')
    const entry = JSON.parse(lines[0])

    expect(entry.level).toBe('info')
    expect(entry.message).toBe('Step completed')
    expect(entry.run_id).toBe('run-log')
    expect(entry.step_id).toBe('plan')
    expect(entry.data.duration_ms).toBe(12)
  })
})
