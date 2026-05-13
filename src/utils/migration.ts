/**
 * Migration utilities for CCG private data isolation.
 */

import fs from 'fs-extra'
import { dirname, join } from 'pathe'
import { parse, stringify } from 'smol-toml'
import { CCG_BACKUP_DIR, CCG_BIN_DIR, CCG_CONFIG_FILE, CCG_PRIVATE_DIR, CCG_PROMPTS_DIR, CLAUDE_COMMANDS_DIR, LEGACY_BIN_DIR, LEGACY_CCG_DIR, LEGACY_PROMPTS_DIR } from './paths'

export interface MigrationResult {
  success: boolean
  migratedFiles: string[]
  errors: string[]
  skipped: string[]
}

export async function migrateToV1_4_0(): Promise<MigrationResult> {
  return migrateToV2_2_0()
}

async function copyIfMissing(src: string, dest: string, label: string, result: MigrationResult): Promise<void> {
  if (!(await fs.pathExists(src))) {
    result.skipped.push(`${label} (does not exist, nothing to migrate)`)
    return
  }
  if (await fs.pathExists(dest)) {
    result.skipped.push(`${label} (target already exists)`)
    return
  }

  await fs.ensureDir(dirname(dest))
  await fs.copy(src, dest)
  await fs.remove(src)
  result.migratedFiles.push(`${label}`)
}

async function removeDirIfEmpty(dir: string): Promise<void> {
  if (!(await fs.pathExists(dir))) return
  const entries = await fs.readdir(dir)
  if (entries.length === 0) await fs.remove(dir)
}

async function updateMigratedConfig(result: MigrationResult): Promise<void> {
  if (!(await fs.pathExists(CCG_CONFIG_FILE))) return

  try {
    const content = await fs.readFile(CCG_CONFIG_FILE, 'utf-8')
    const config = parse(content) as any
    config.paths = {
      ...(config.paths || {}),
      commands: CLAUDE_COMMANDS_DIR,
      prompts: CCG_PROMPTS_DIR,
      backup: CCG_BACKUP_DIR,
    }
    await fs.writeFile(CCG_CONFIG_FILE, stringify(config), 'utf-8')
    result.migratedFiles.push('Updated ~/.ccg/config.toml paths')
  }
  catch (error) {
    result.errors.push(`Failed to update migrated config.toml: ${error}`)
    result.success = false
  }
}

/**
 * Migrate from v2.1.x/v1.4.x layout to v2.2.0 isolated private directory.
 *
 * Changes:
 * 1. ~/.claude/.ccg/config.toml → ~/.ccg/config.toml
 * 2. ~/.claude/.ccg/prompts/    → ~/.ccg/prompts/
 * 3. ~/.claude/.ccg/backup/     → ~/.ccg/backup/
 * 4. ~/.claude/bin/codeagent-wrapper(.exe) → ~/.ccg/bin/codeagent-wrapper(.exe)
 */
export async function migrateToV2_2_0(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    migratedFiles: [],
    errors: [],
    skipped: [],
  }

  try {
    await fs.ensureDir(CCG_PRIVATE_DIR)

    await copyIfMissing(
      join(LEGACY_CCG_DIR, 'config.toml'),
      CCG_CONFIG_FILE,
      '~/.claude/.ccg/config.toml → ~/.ccg/config.toml',
      result,
    )
    await copyIfMissing(
      join(LEGACY_CCG_DIR, 'prompts'),
      CCG_PROMPTS_DIR,
      '~/.claude/.ccg/prompts/ → ~/.ccg/prompts/',
      result,
    )
    await copyIfMissing(
      LEGACY_PROMPTS_DIR,
      CCG_PROMPTS_DIR,
      '~/.claude/prompts/ccg/ → ~/.ccg/prompts/',
      result,
    )
    await copyIfMissing(
      join(LEGACY_CCG_DIR, 'backup'),
      CCG_BACKUP_DIR,
      '~/.claude/.ccg/backup/ → ~/.ccg/backup/',
      result,
    )

    const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
    await copyIfMissing(
      join(LEGACY_BIN_DIR, wrapperName),
      join(CCG_BIN_DIR, wrapperName),
      `~/.claude/bin/${wrapperName} → ~/.ccg/bin/${wrapperName}`,
      result,
    )

    await updateMigratedConfig(result)

    await removeDirIfEmpty(LEGACY_CCG_DIR)
    await removeDirIfEmpty(LEGACY_BIN_DIR)
  }
  catch (error) {
    result.errors.push(`Migration failed: ${error}`)
    result.success = false
  }

  return result
}

/**
 * Check if migration is needed
 */
export async function needsMigration(): Promise<boolean> {
  const hasLegacyPrivateDir = await fs.pathExists(LEGACY_CCG_DIR)
  const hasLegacyPromptsDir = await fs.pathExists(LEGACY_PROMPTS_DIR)
  const hasLegacyBinary = await fs.pathExists(join(LEGACY_BIN_DIR, process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'))

  return hasLegacyPrivateDir || hasLegacyPromptsDir || hasLegacyBinary
}
