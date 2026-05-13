import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { createEmptyManifest, readManifest, uninstallWithManifest, verifyManifest, writeManifest } from '../manifest'

const tmpRoot = join(tmpdir(), `ccg-manifest-test-${Date.now()}`)

afterEach(async () => {
  await fs.remove(tmpRoot)
})

describe('manifest', () => {
  it('writes and reads manifest.json', async () => {
    const manifestPath = join(tmpRoot, 'manifest.json')
    const manifest = createEmptyManifest('1.2.3')
    manifest.commands = ['workflow.md']

    await writeManifest(manifest, manifestPath)
    const read = await readManifest(manifestPath)

    expect(read?.ccgVersion).toBe('1.2.3')
    expect(read?.commands).toEqual(['workflow.md'])
  })

  it('uninstalls only files listed in manifest', async () => {
    const manifestPath = join(tmpRoot, '.ccg', 'manifest.json')
    const commandsDir = join(tmpRoot, '.claude', 'commands', 'ccg')
    const agentsDir = join(tmpRoot, '.claude', 'agents', 'ccg')
    const skillsDir = join(tmpRoot, '.claude', 'skills', 'ccg')
    const rulesDir = join(tmpRoot, '.claude', 'rules')
    const settingsFile = join(tmpRoot, '.claude', 'settings.json')

    await fs.ensureDir(commandsDir)
    await fs.ensureDir(agentsDir)
    await fs.ensureDir(join(skillsDir, 'tools'))
    await fs.ensureDir(rulesDir)
    await fs.writeFile(join(commandsDir, 'workflow.md'), '# workflow')
    await fs.writeFile(join(commandsDir, 'user.md'), '# user')
    await fs.writeFile(join(agentsDir, 'planner.md'), '# planner')
    await fs.writeFile(join(skillsDir, 'tools', 'run.md'), '# tool')
    await fs.writeFile(join(rulesDir, 'ccg-skills.md'), '# rules')
    await fs.writeJson(settingsFile, {
      env: { ANTHROPIC_AUTH_TOKEN: 'secret', USER_ENV: 'keep' },
      permissions: { allow: ['Bash(*codeagent-wrapper*)', 'Bash(user*)'] },
    })

    const manifest = createEmptyManifest('1.2.3')
    manifest.commands = ['workflow.md']
    manifest.agents = ['planner.md']
    manifest.skills = ['tools/run.md']
    manifest.rules = ['ccg-skills.md']
    manifest.settingsEntries.envVars = ['ANTHROPIC_AUTH_TOKEN']
    manifest.settingsEntries.permissions = ['Bash(*codeagent-wrapper*)']
    await writeManifest(manifest, manifestPath)

    const result = await uninstallWithManifest({
      manifestFile: manifestPath,
      claudeCommandsDir: commandsDir,
      claudeAgentsDir: agentsDir,
      claudeSkillsDir: skillsDir,
      claudeRulesDir: rulesDir,
      claudeSettingsFile: settingsFile,
    })

    expect(result.errors).toEqual([])
    expect(await fs.pathExists(join(commandsDir, 'workflow.md'))).toBe(false)
    expect(await fs.pathExists(join(commandsDir, 'user.md'))).toBe(true)
    expect(await fs.pathExists(join(skillsDir, 'tools', 'run.md'))).toBe(false)

    const settings = await fs.readJson(settingsFile)
    expect(settings.env).toEqual({ USER_ENV: 'keep' })
    expect(settings.permissions.allow).toEqual(['Bash(user*)'])
  })

  it('verifies missing manifest files', async () => {
    const manifestPath = join(tmpRoot, '.ccg', 'manifest.json')
    const commandsDir = join(tmpRoot, '.claude', 'commands', 'ccg')
    const manifest = createEmptyManifest('1.2.3')
    manifest.commands = ['workflow.md']
    await writeManifest(manifest, manifestPath)

    const result = await verifyManifest({ manifestFile: manifestPath, claudeCommandsDir: commandsDir })
    expect(result.ok).toBe(false)
    expect(result.missing).toContain('commands/workflow.md')
  })
})
