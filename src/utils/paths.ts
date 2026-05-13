import { homedir } from 'node:os'
import { join } from 'pathe'

export type InstallScope = 'global' | 'local'

export interface ResolvedPaths {
  scope: InstallScope
  projectRoot: string
  claudeDir: string
  claudeCommandsDir: string
  claudeAgentsDir: string
  claudeSkillsDir: string
  claudeRulesDir: string
  claudeOutputStylesDir: string
  claudeSettingsFile: string
  ccgPrivateDir: string
  ccgConfigFile: string
  ccgManifestFile: string
  ccgPromptsDir: string
  ccgBackupDir: string
  ccgBinDir: string
}

// CCG private data directory
export const CCG_PRIVATE_DIR = join(homedir(), '.ccg')
export const CCG_CONFIG_FILE = join(CCG_PRIVATE_DIR, 'config.toml')
export const CCG_PROMPTS_DIR = join(CCG_PRIVATE_DIR, 'prompts')
export const CCG_BACKUP_DIR = join(CCG_PRIVATE_DIR, 'backup')
export const CCG_BIN_DIR = join(CCG_PRIVATE_DIR, 'bin')
export const CCG_MANIFEST_FILE = join(CCG_PRIVATE_DIR, 'manifest.json')

// Claude Code directories
export const CLAUDE_DIR = join(homedir(), '.claude')
export const CLAUDE_COMMANDS_DIR = join(CLAUDE_DIR, 'commands', 'ccg')
export const CLAUDE_AGENTS_DIR = join(CLAUDE_DIR, 'agents', 'ccg')
export const CLAUDE_SKILLS_DIR = join(CLAUDE_DIR, 'skills', 'ccg')
export const CLAUDE_RULES_DIR = join(CLAUDE_DIR, 'rules')
export const CLAUDE_OUTPUT_STYLES_DIR = join(CLAUDE_DIR, 'output-styles')
export const CLAUDE_SETTINGS_FILE = join(CLAUDE_DIR, 'settings.json')

// Other tool configuration paths
export const CLAUDE_JSON_FILE = join(homedir(), '.claude.json')
export const CODEX_CONFIG_FILE = join(homedir(), '.codex', 'config.toml')
export const GEMINI_SETTINGS_FILE = join(homedir(), '.gemini', 'settings.json')

// Legacy paths for migration detection
export const LEGACY_CCG_DIR = join(homedir(), '.claude', '.ccg')
export const LEGACY_BIN_DIR = join(homedir(), '.claude', 'bin')
export const LEGACY_PROMPTS_DIR = join(homedir(), '.claude', 'prompts', 'ccg')

export function resolvePaths(scope: InstallScope, projectRoot?: string): ResolvedPaths {
  const home = homedir()

  if (scope === 'global') {
    return {
      scope: 'global',
      projectRoot: home,
      claudeDir: CLAUDE_DIR,
      claudeCommandsDir: CLAUDE_COMMANDS_DIR,
      claudeAgentsDir: CLAUDE_AGENTS_DIR,
      claudeSkillsDir: CLAUDE_SKILLS_DIR,
      claudeRulesDir: CLAUDE_RULES_DIR,
      claudeOutputStylesDir: CLAUDE_OUTPUT_STYLES_DIR,
      claudeSettingsFile: CLAUDE_SETTINGS_FILE,
      ccgPrivateDir: CCG_PRIVATE_DIR,
      ccgConfigFile: CCG_CONFIG_FILE,
      ccgManifestFile: CCG_MANIFEST_FILE,
      ccgPromptsDir: CCG_PROMPTS_DIR,
      ccgBackupDir: CCG_BACKUP_DIR,
      ccgBinDir: CCG_BIN_DIR,
    }
  }

  const root = projectRoot ?? process.cwd()
  return {
    scope: 'local',
    projectRoot: root,
    claudeDir: join(root, '.claude'),
    claudeCommandsDir: join(root, '.claude', 'commands', 'ccg'),
    claudeAgentsDir: join(root, '.claude', 'agents', 'ccg'),
    claudeSkillsDir: join(root, '.claude', 'skills', 'ccg'),
    claudeRulesDir: join(root, '.claude', 'rules'),
    claudeOutputStylesDir: join(root, '.claude', 'output-styles'),
    claudeSettingsFile: join(root, '.claude', 'settings.json'),
    ccgPrivateDir: join(root, '.ccg'),
    ccgConfigFile: join(root, '.ccg', 'config.toml'),
    ccgManifestFile: join(root, '.ccg', 'manifest.json'),
    ccgPromptsDir: join(root, '.ccg', 'prompts'),
    ccgBackupDir: join(root, '.ccg', 'backup'),
    ccgBinDir: CCG_BIN_DIR,
  }
}
