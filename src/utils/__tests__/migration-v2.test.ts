import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs-extra'

const home = join(tmpdir(), `ccg-migration-test-${Date.now()}`)

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => home,
  }
})

const { migrateToV2_2_0, needsMigration } = await import('../migration')

afterEach(async () => {
  await fs.remove(home)
})

describe('migrateToV2_2_0', () => {
  it('moves legacy private data into ~/.ccg and updates config paths', async () => {
    await fs.ensureDir(join(home, '.claude', '.ccg', 'prompts', 'codex'))
    await fs.ensureDir(join(home, '.claude', '.ccg', 'backup'))
    await fs.ensureDir(join(home, '.claude', 'bin'))
    await fs.writeFile(join(home, '.claude', '.ccg', 'config.toml'), [
      '[general]',
      'version = "2.1.16"',
      'language = "zh-CN"',
      'createdAt = "2026-01-01T00:00:00.000Z"',
      '',
      '[paths]',
      'commands = "/old/commands"',
      'prompts = "/old/prompts"',
      'backup = "/old/backup"',
    ].join('\n'))
    await fs.writeFile(join(home, '.claude', '.ccg', 'prompts', 'codex', 'reviewer.md'), '# reviewer')
    await fs.writeFile(join(home, '.claude', '.ccg', 'backup', 'old.json'), '{}')
    await fs.writeFile(join(home, '.claude', 'bin', 'codeagent-wrapper'), 'binary')

    expect(await needsMigration()).toBe(true)
    const result = await migrateToV2_2_0()

    expect(result.success).toBe(true)
    expect(await fs.pathExists(join(home, '.ccg', 'config.toml'))).toBe(true)
    expect(await fs.pathExists(join(home, '.ccg', 'prompts', 'codex', 'reviewer.md'))).toBe(true)
    expect(await fs.pathExists(join(home, '.ccg', 'backup', 'old.json'))).toBe(true)
    expect(await fs.pathExists(join(home, '.ccg', 'bin', 'codeagent-wrapper'))).toBe(true)
    expect(await fs.pathExists(join(home, '.claude', '.ccg', 'config.toml'))).toBe(false)

    const config = await fs.readFile(join(home, '.ccg', 'config.toml'), 'utf-8')
    expect(config).toContain(`${home}/.ccg/prompts`)
    expect(config).toContain(`${home}/.ccg/backup`)
    expect(config).toContain(`${home}/.claude/commands/ccg`)
  })
})
