import { homedir } from 'node:os'
import { join } from 'pathe'

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
