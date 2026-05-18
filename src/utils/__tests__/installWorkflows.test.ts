import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { getAllCommandIds, installWorkflows } from '../installer'
import { buildLocalCodeagentWrapper } from './localBinary'

const ALL_IDS = getAllCommandIds()

function collectMdFiles(dir: string): string[] {
  const files: string[] = []
  if (!fs.existsSync(dir))
    return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory())
      files.push(...collectMdFiles(full))
    else if (entry.name.endsWith('.md'))
      files.push(full)
  }
  return files
}

describe('installWorkflows E2E', () => {
  const tmpDir = join(tmpdir(), `ccg-test-install-${Date.now()}`)
  let localBinary: ReturnType<typeof buildLocalCodeagentWrapper>

  beforeAll(() => {
    localBinary = buildLocalCodeagentWrapper()
  }, 30_000)

  afterAll(async () => {
    localBinary?.cleanup()
    await fs.remove(tmpDir)
  })

  it('installs all workflows without errors', async () => {
    const result = await installWorkflows(ALL_IDS, tmpDir, true)
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.installedCommands.length).toBeGreaterThan(0)
  }, 15000)

  it('generated command and agent files contain no removed search references', async () => {
    const files = [
      ...collectMdFiles(join(tmpDir, 'commands', 'ccg')),
      ...collectMdFiles(join(tmpDir, 'agents', 'ccg')),
    ]
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      expect(content, file).not.toContain(`{{${'M' + 'CP_SEARCH_TOOL'}}}`)
      expect(content, file).not.toContain(`{{${'M' + 'CP_SEARCH_PARAM'}}}`)
      expect(content, file).not.toContain(`${'m' + 'cp'}__`)
    }
  })

  it('runtime workflows are installed as thin ccg run commands', async () => {
    const content = readFileSync(join(tmpDir, 'commands', 'ccg', 'plan.md'), 'utf-8')
    expect(content).toContain('ccg run default --prompt "$ARGUMENTS"')
    expect(content).not.toContain('Glob')
    expect(content).not.toContain('Grep')
  })

  it('planner.md frontmatter uses only filesystem tools', async () => {
    const content = readFileSync(join(tmpDir, 'agents', 'ccg', 'planner.md'), 'utf-8')
    const toolsLine = content.split('\n').find(l => l.startsWith('tools:'))
    expect(toolsLine).toBe('tools: Read, Write')
  })
})
