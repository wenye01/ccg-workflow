import { describe, expect, it } from 'vitest'
import { generateRuntimeCommand, generateRuntimeCommandFromPipeline } from '../command-generator'

describe('command generator', () => {
  it('generates a thin runtime slash command', () => {
    expect(generateRuntimeCommand({
      pipeline: 'default',
      description: 'Run default development pipeline',
    })).toBe(`---
description: 'Run default development pipeline'
---
! \`ccg run default --prompt "$ARGUMENTS"\`
`)
  })

  it('derives command metadata from pipeline yaml', () => {
    const command = generateRuntimeCommandFromPipeline(`
version: 1
name: team
description: Agent team workflow.
policies:
  approval: never
  on_failure: abort
steps: []
`, 'team.yaml')

    expect(command).toContain(`description: 'Agent team workflow.'`)
    expect(command).toContain('ccg run team')
  })
})
