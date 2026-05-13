import fs from 'fs-extra'
import { basename, dirname, join, relative } from 'pathe'
import { parse, stringify } from 'smol-toml'
import { version as packageVersion } from '../../package.json'
import {
  CCG_MANIFEST_FILE,
  CLAUDE_AGENTS_DIR,
  CLAUDE_COMMANDS_DIR,
  CLAUDE_JSON_FILE,
  CLAUDE_OUTPUT_STYLES_DIR,
  CLAUDE_RULES_DIR,
  CLAUDE_SETTINGS_FILE,
  CLAUDE_SKILLS_DIR,
  CODEX_CONFIG_FILE,
  GEMINI_SETTINGS_FILE,
} from './paths'

export interface CcgManifest {
  version: number
  createdAt: string
  updatedAt: string
  ccgVersion: string
  commands: string[]
  agents: string[]
  skills: string[]
  rules: string[]
  outputStyles: string[]
  settingsEntries: {
    envVars: string[]
    permissions: string[]
  }
  mcpServers: string[]
  mcpSyncTargets: {
    codex: string[]
    gemini: string[]
  }
  shellRc?: {
    file: string
    line: string
  }
}

export interface ManifestPaths {
  manifestFile?: string
  claudeCommandsDir?: string
  claudeAgentsDir?: string
  claudeSkillsDir?: string
  claudeRulesDir?: string
  claudeOutputStylesDir?: string
  claudeSettingsFile?: string
  claudeJsonFile?: string
  codexConfigFile?: string
  geminiSettingsFile?: string
}

export interface ManifestUninstallResult {
  removedCommands: string[]
  removedAgents: string[]
  removedSkills: string[]
  removedRules: string[]
  removedOutputStyles: string[]
  removedMcpServers: string[]
  removedCodexMcpServers: string[]
  removedGeminiMcpServers: string[]
  removedSettingsEntries: string[]
  removedShellRcLine: boolean
  errors: string[]
}

function paths(overrides: ManifestPaths = {}) {
  return {
    manifestFile: overrides.manifestFile ?? CCG_MANIFEST_FILE,
    claudeCommandsDir: overrides.claudeCommandsDir ?? CLAUDE_COMMANDS_DIR,
    claudeAgentsDir: overrides.claudeAgentsDir ?? CLAUDE_AGENTS_DIR,
    claudeSkillsDir: overrides.claudeSkillsDir ?? CLAUDE_SKILLS_DIR,
    claudeRulesDir: overrides.claudeRulesDir ?? CLAUDE_RULES_DIR,
    claudeOutputStylesDir: overrides.claudeOutputStylesDir ?? CLAUDE_OUTPUT_STYLES_DIR,
    claudeSettingsFile: overrides.claudeSettingsFile ?? CLAUDE_SETTINGS_FILE,
    claudeJsonFile: overrides.claudeJsonFile ?? CLAUDE_JSON_FILE,
    codexConfigFile: overrides.codexConfigFile ?? CODEX_CONFIG_FILE,
    geminiSettingsFile: overrides.geminiSettingsFile ?? GEMINI_SETTINGS_FILE,
  }
}

export function createEmptyManifest(ccgVersion = packageVersion): CcgManifest {
  const now = new Date().toISOString()
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    ccgVersion,
    commands: [],
    agents: [],
    skills: [],
    rules: [],
    outputStyles: [],
    settingsEntries: {
      envVars: [],
      permissions: [],
    },
    mcpServers: [],
    mcpSyncTargets: {
      codex: [],
      gemini: [],
    },
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

export async function readManifest(manifestFile = CCG_MANIFEST_FILE): Promise<CcgManifest | null> {
  if (!(await fs.pathExists(manifestFile))) return null
  return await fs.readJson(manifestFile) as CcgManifest
}

export async function writeManifest(manifest: CcgManifest, manifestFile = CCG_MANIFEST_FILE): Promise<void> {
  manifest.updatedAt = new Date().toISOString()
  await fs.ensureDir(dirname(manifestFile))
  await fs.writeJson(manifestFile, manifest, { spaces: 2 })
}

export async function collectRelativeFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  if (!(await fs.pathExists(dir))) return files

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      }
      else {
        files.push(relative(dir, fullPath))
      }
    }
  }

  await walk(dir)
  return uniqueSorted(files)
}

async function removeListedFiles(baseDir: string, files: string[], removed: string[], label: string, errors: string[]): Promise<void> {
  for (const file of files) {
    const target = join(baseDir, file)
    try {
      if (await fs.pathExists(target)) {
        await fs.remove(target)
        removed.push(file)
      }
    }
    catch (error) {
      errors.push(`Failed to remove ${label} ${file}: ${error}`)
    }
  }
}

async function removeJsonEntries(file: string, updater: (config: Record<string, any>) => string[]): Promise<string[]> {
  if (!(await fs.pathExists(file))) return []
  const config = await fs.readJson(file)
  const removed = updater(config)
  if (removed.length > 0) {
    await fs.writeJson(file, config, { spaces: 2 })
  }
  return removed
}

async function removeTomlEntries(file: string, updater: (config: Record<string, any>) => string[]): Promise<string[]> {
  if (!(await fs.pathExists(file))) return []
  const config = parse(await fs.readFile(file, 'utf-8')) as Record<string, any>
  const removed = updater(config)
  if (removed.length > 0) {
    await fs.writeFile(file, stringify(config), 'utf-8')
  }
  return removed
}

export async function uninstallWithManifest(overrides: ManifestPaths = {}): Promise<ManifestUninstallResult> {
  const p = paths(overrides)
  const result: ManifestUninstallResult = {
    removedCommands: [],
    removedAgents: [],
    removedSkills: [],
    removedRules: [],
    removedOutputStyles: [],
    removedMcpServers: [],
    removedCodexMcpServers: [],
    removedGeminiMcpServers: [],
    removedSettingsEntries: [],
    removedShellRcLine: false,
    errors: [],
  }

  const manifest = await readManifest(p.manifestFile)
  if (!manifest) return result

  await removeListedFiles(p.claudeCommandsDir, manifest.commands, result.removedCommands, 'command', result.errors)
  await removeListedFiles(p.claudeAgentsDir, manifest.agents, result.removedAgents, 'agent', result.errors)
  await removeListedFiles(p.claudeSkillsDir, manifest.skills, result.removedSkills, 'skill', result.errors)
  await removeListedFiles(p.claudeRulesDir, manifest.rules, result.removedRules, 'rule', result.errors)
  await removeListedFiles(p.claudeOutputStylesDir, manifest.outputStyles, result.removedOutputStyles, 'output style', result.errors)

  try {
    result.removedSettingsEntries = await removeJsonEntries(p.claudeSettingsFile, (settings) => {
      const removed: string[] = []
      for (const envVar of manifest.settingsEntries.envVars) {
        if (settings.env && envVar in settings.env) {
          delete settings.env[envVar]
          removed.push(`env:${envVar}`)
        }
      }
      if (settings.env && Object.keys(settings.env).length === 0) delete settings.env

      const allow = settings.permissions?.allow
      if (Array.isArray(allow)) {
        settings.permissions.allow = allow.filter((entry: string) => {
          const keep = !manifest.settingsEntries.permissions.includes(entry)
          if (!keep) removed.push(`permission:${entry}`)
          return keep
        })
        if (settings.permissions.allow.length === 0) delete settings.permissions.allow
        if (Object.keys(settings.permissions).length === 0) delete settings.permissions
      }
      return removed
    })
  }
  catch (error) {
    result.errors.push(`Failed to clean settings.json: ${error}`)
  }

  if (manifest.mcpServers.length > 0) {
    try {
      result.removedMcpServers = await removeJsonEntries(p.claudeJsonFile, (config) => {
        const removed: string[] = []
        for (const server of manifest.mcpServers) {
          if (config.mcpServers?.[server]) {
            delete config.mcpServers[server]
            removed.push(server)
          }
        }
        if (config.mcpServers && Object.keys(config.mcpServers).length === 0) delete config.mcpServers
        return removed
      })
    }
    catch (error) {
      result.errors.push(`Failed to clean .claude.json: ${error}`)
    }
  }

  if (manifest.mcpSyncTargets.codex.length > 0) {
    try {
      result.removedCodexMcpServers = await removeTomlEntries(p.codexConfigFile, (config) => {
        const removed: string[] = []
        for (const server of manifest.mcpSyncTargets.codex) {
          if (config.mcp_servers?.[server]) {
            delete config.mcp_servers[server]
            removed.push(server)
          }
        }
        return removed
      })
    }
    catch (error) {
      result.errors.push(`Failed to clean Codex MCP config: ${error}`)
    }
  }

  if (manifest.mcpSyncTargets.gemini.length > 0) {
    try {
      result.removedGeminiMcpServers = await removeJsonEntries(p.geminiSettingsFile, (config) => {
        const removed: string[] = []
        for (const server of manifest.mcpSyncTargets.gemini) {
          if (config.mcpServers?.[server]) {
            delete config.mcpServers[server]
            removed.push(server)
          }
        }
        return removed
      })
    }
    catch (error) {
      result.errors.push(`Failed to clean Gemini MCP config: ${error}`)
    }
  }

  if (manifest.shellRc) {
    try {
      if (await fs.pathExists(manifest.shellRc.file)) {
        const content = await fs.readFile(manifest.shellRc.file, 'utf-8')
        const lines = content.split('\n')
        const filtered = lines.filter(line => line !== manifest.shellRc?.line)
        if (filtered.length !== lines.length) {
          await fs.writeFile(manifest.shellRc.file, filtered.join('\n'), 'utf-8')
          result.removedShellRcLine = true
        }
      }
    }
    catch (error) {
      result.errors.push(`Failed to clean shell rc: ${error}`)
    }
  }

  return result
}

export async function verifyManifest(overrides: ManifestPaths = {}): Promise<{ ok: boolean, missing: string[] }> {
  const p = paths(overrides)
  const manifest = await readManifest(p.manifestFile)
  if (!manifest) return { ok: false, missing: [p.manifestFile] }

  const checks: Array<[string, string[], string]> = [
    [p.claudeCommandsDir, manifest.commands, 'commands'],
    [p.claudeAgentsDir, manifest.agents, 'agents'],
    [p.claudeSkillsDir, manifest.skills, 'skills'],
    [p.claudeRulesDir, manifest.rules, 'rules'],
    [p.claudeOutputStylesDir, manifest.outputStyles, 'outputStyles'],
  ]
  const missing: string[] = []
  for (const [dir, files, label] of checks) {
    for (const file of files) {
      if (!(await fs.pathExists(join(dir, file)))) {
        missing.push(`${label}/${file}`)
      }
    }
  }
  return { ok: missing.length === 0, missing }
}

export function commandFileName(command: string): string {
  return command.endsWith('.md') ? basename(command) : `${command}.md`
}
