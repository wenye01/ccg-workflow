import { homedir } from 'node:os'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { resolvePaths } from '../paths'

describe('resolvePaths', () => {
  it('resolves global paths under the user home directory', () => {
    const home = homedir()
    const paths = resolvePaths('global')

    expect(paths.scope).toBe('global')
    expect(paths.projectRoot).toBe(home)
    expect(paths.claudeDir).toBe(join(home, '.claude'))
    expect(paths.ccgPrivateDir).toBe(join(home, '.ccg'))
    expect(paths.ccgBinDir).toBe(join(home, '.ccg', 'bin'))
  })

  it('resolves local install paths under the project while keeping binaries global', () => {
    const projectRoot = '/tmp/ccg-project'
    const paths = resolvePaths('local', projectRoot)

    expect(paths.scope).toBe('local')
    expect(paths.projectRoot).toBe(projectRoot)
    expect(paths.claudeCommandsDir).toBe(join(projectRoot, '.claude', 'commands', 'ccg'))
    expect(paths.ccgConfigFile).toBe(join(projectRoot, '.ccg', 'config.toml'))
    expect(paths.ccgBinDir).toBe(join(homedir(), '.ccg', 'bin'))
  })
})
