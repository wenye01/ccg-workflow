import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../run'

const tmpRoot = join(tmpdir(), `ccg-run-command-test-${Date.now()}`)

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.remove(tmpRoot)
})

describe('run command', () => {
  it('runs the default pipeline with the mock backend override', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCommand('default', {
      backend: 'mock',
      prompt: 'Build phase 4 CLI integration',
      runId: 'run-default',
      workDir: tmpRoot,
    })

    const state = await fs.readJson(join(tmpRoot, '.ccg', 'runs', 'run-default', 'state.json'))
    expect(state.status).toBe('completed')
    expect(state.steps.plan.status).toBe('succeeded')
    expect(state.steps.develop.status).toBe('succeeded')
    expect(state.steps.qa.status).toBe('succeeded')
  })

  it('prints saved run status', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCommand('default', {
      backend: 'mock',
      runId: 'run-status',
      workDir: tmpRoot,
    })
    log.mockClear()

    await runCommand(undefined, {
      status: 'run-status',
      workDir: tmpRoot,
    })

    const output = log.mock.calls.map(call => String(call[0])).join('\n')
    expect(output).toContain('run-status')
    expect(output).toContain('default@1')
    expect(output).toContain('plan')
  })
})
