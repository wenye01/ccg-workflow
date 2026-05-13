import type { CcgConfig, ModelRouting, ResolvedPaths, SupportedLang } from '../types'
import fs from 'fs-extra'
import { parse, stringify } from 'smol-toml'
import { version as packageVersion } from '../../package.json'
import { dirname } from 'pathe'
import { CCG_BACKUP_DIR, CCG_CONFIG_FILE, CCG_PRIVATE_DIR, CCG_PROMPTS_DIR, CLAUDE_COMMANDS_DIR } from './paths'

export function getCcgDir(): string {
  return CCG_PRIVATE_DIR
}

export function getConfigPath(): string {
  return CCG_CONFIG_FILE
}

export async function ensureCcgDir(ccgPrivateDir = CCG_PRIVATE_DIR): Promise<void> {
  await fs.ensureDir(ccgPrivateDir)
}

export async function readCcgConfig(configFile = CCG_CONFIG_FILE): Promise<CcgConfig | null> {
  try {
    if (await fs.pathExists(configFile)) {
      const content = await fs.readFile(configFile, 'utf-8')
      return parse(content) as unknown as CcgConfig
    }
  }
  catch {
    // Config doesn't exist or is invalid
  }
  return null
}

export async function writeCcgConfig(config: CcgConfig, configFile = CCG_CONFIG_FILE): Promise<void> {
  await fs.ensureDir(dirname(configFile))
  const content = stringify(config as any)
  await fs.writeFile(configFile, content, 'utf-8')
}

export async function readScopedConfig(paths: ResolvedPaths): Promise<CcgConfig | null> {
  return readCcgConfig(paths.ccgConfigFile)
}

export function mergeConfigs(globalConfig: CcgConfig, localConfig: Partial<CcgConfig>): CcgConfig {
  return {
    general: { ...globalConfig.general, ...localConfig.general },
    routing: {
      frontend: { ...globalConfig.routing.frontend, ...localConfig.routing?.frontend },
      backend: { ...globalConfig.routing.backend, ...localConfig.routing?.backend },
      review: { ...globalConfig.routing.review, ...localConfig.routing?.review },
      mode: localConfig.routing?.mode ?? globalConfig.routing.mode,
      geminiModel: localConfig.routing?.geminiModel ?? globalConfig.routing.geminiModel,
    },
    workflows: {
      installed: localConfig.workflows?.installed ?? globalConfig.workflows.installed,
    },
    paths: localConfig.paths ?? globalConfig.paths,
    mcp: { ...globalConfig.mcp, ...localConfig.mcp },
    performance: { ...globalConfig.performance, ...localConfig.performance },
  }
}

export async function readEffectiveConfig(paths: ResolvedPaths): Promise<CcgConfig | null> {
  const globalConfig = await readCcgConfig()
  if (!globalConfig) {
    if (paths.scope === 'local')
      return readCcgConfig(paths.ccgConfigFile)
    return null
  }

  if (paths.scope === 'global')
    return globalConfig

  const localConfig = await readCcgConfig(paths.ccgConfigFile) as Partial<CcgConfig> | null
  if (!localConfig)
    return globalConfig
  return mergeConfigs(globalConfig, localConfig)
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
