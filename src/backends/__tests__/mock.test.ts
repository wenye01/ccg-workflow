import { describe, expect, it } from 'vitest'
import { MockAdapter } from '../mock'

describe('mock adapter', () => {
  it('returns a successful backend output', async () => {
    const adapter = new MockAdapter({
      response: {
        message: 'done',
        artifacts: { plan: { summary: 'ship it' } },
      },
    })

    const output = await adapter.execute({
      prompt: 'task',
      work_dir: process.cwd(),
      output_schema: { type: 'object' },
    })

    expect(output.success).toBe(true)
    expect(output.message).toBe('done')
    expect(output.session_id).toBe('mock-session')
    expect(output.artifacts).toEqual({ plan: { summary: 'ship it' } })
  })

  it('simulates failures', async () => {
    const adapter = new MockAdapter({ fail: true, response: { error: 'boom' } })

    const output = await adapter.execute({ prompt: 'task', work_dir: process.cwd() })

    expect(output.success).toBe(false)
    expect(output.exit_code).toBe(1)
    expect(output.error).toBe('boom')
  })

  it('simulates timeout outputs', async () => {
    const adapter = new MockAdapter({ timeout: true })

    const output = await adapter.execute({
      prompt: 'task',
      work_dir: process.cwd(),
      timeout_seconds: 0.001,
    })

    expect(output.success).toBe(false)
    expect(output.exit_code).toBe(124)
  })
})

