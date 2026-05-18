import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'fs-extra'
import { afterEach, describe, expect, it } from 'vitest'
import { compilePipeline } from '../compiler'
import { assemblePrompt } from '../prompt-assembler'

const tmpRoot = join(tmpdir(), `ccg-prompt-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('prompt assembler', () => {
  it('combines role prompt, task, artifact bindings, project context, and output schema', async () => {
    await fs.ensureDir(join(tmpRoot, 'prompts'))
    await fs.ensureDir(join(tmpRoot, '.context', 'prefs'))
    await fs.writeFile(join(tmpRoot, 'prompts', 'planner.md'), '# Planner\nPlan carefully.')
    await fs.writeFile(join(tmpRoot, '.context', 'prefs', 'workflow.md'), 'Prefer small commits.')

    const pipeline = compilePipeline(`
version: 1
name: prompt
policies:
  approval: never
  on_failure: abort
steps:
  - id: plan
    role: planning
    backend: mock
    prompt_template: prompts/planner.md
    outputs:
      - type: plan
        version: 1
        schema:
          type: object
          required: [summary]
          properties:
            summary:
              type: string
`)

    const assembled = await assemblePrompt({
      step: pipeline.steps[0],
      workDir: tmpRoot,
      taskDescription: 'Build phase 3.',
      bindings: { PRIOR_PLAN: 'Use runtime state.' },
    })

    expect(assembled.prompt).toContain('# Planner')
    expect(assembled.prompt).toContain('## Current Task\nBuild phase 3.')
    expect(assembled.prompt).toContain('## Context from Previous Steps')
    expect(assembled.prompt).toContain('### PRIOR_PLAN\nUse runtime state.')
    expect(assembled.prompt).toContain('## Project Context')
    expect(assembled.prompt).toContain('Prefer small commits.')
    expect(assembled.output_schema).toEqual(pipeline.steps[0].outputs?.[0].schema)
  })
})
