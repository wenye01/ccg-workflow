import type { CcgConfig, ModelRouting, SupportedLang } from '../types'
import fs from 'fs-extra'
import { parse, stringify } from 'smol-toml'
import { version as packageVersion } from '../../package.json'
import { CCG_BACKUP_DIR, CCG_CONFIG_FILE, CCG_PRIVATE_DIR, CCG_PROMPTS_DIR, CLAUDE_COMMANDS_DIR } from './paths'

export function getCcgDir(): string {
  return CCG_PRIVATE_DIR
}

export function getConfigPath(): string {
  return CCG_CONFIG_FILE
}

export async function ensureCcgDir(): Promise<void> {
  await fs.ensureDir(CCG_PRIVATE_DIR)
}

export async function readCcgConfig(): Promise<CcgConfig | null> {
  try {
    if (await fs.pathExists(CCG_CONFIG_FILE)) {
      const content = await fs.readFile(CCG_CONFIG_FILE, 'utf-8')
      return parse(content) as unknown as CcgConfig
    }
  }
  catch {
    // Config doesn't exist or is invalid
  }
  return null
}

export async function writeCcgConfig(config: CcgConfig): Promise<void> {
  await ensureCcgDir()
  const content = stringify(config as any)
  await fs.writeFile(CCG_CONFIG_FILE, content, 'utf-8')
}

export function createDefaultConfig(options: {
  language: SupportedLang
  routing: ModelRouting
  installedWorkflows: string[]
  mcpProvider?: string
  liteMode?: boolean
  skipImpeccable?: boolean
}): CcgConfig {
  return {
    general: {
      version: packageVersion,
      language: options.language,
      createdAt: new Date().toISOString(),
    },
    routing: options.routing,
    workflows: {
      installed: options.installedWorkflows,
    },
    paths: {
      commands: CLAUDE_COMMANDS_DIR,
      prompts: CCG_PROMPTS_DIR,
      backup: CCG_BACKUP_DIR,
    },
    mcp: {
      provider: options.mcpProvider || 'ace-tool',
      setup_url: 'https://augmentcode.com/',
    },
    performance: {
      liteMode: options.liteMode || false,
      skipImpeccable: options.skipImpeccable || false,
    },
  }
}

export function createDefaultRouting(): ModelRouting {
  return {
    frontend: {
      models: ['gemini'],
      primary: 'gemini',
      strategy: 'parallel',
    },
    backend: {
      models: ['codex'],
      primary: 'codex',
      strategy: 'parallel',
    },
    review: {
      models: ['codex', 'gemini'],
      strategy: 'parallel',
    },
    mode: 'smart',
  }
}
