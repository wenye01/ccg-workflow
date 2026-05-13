import type { CollaborationMode, InitOptions, ModelRouting, ModelType, SupportedLang } from '../types'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { i18n, initI18n } from '../i18n'
import { createDefaultConfig, ensureCcgDir, readEffectiveConfig, writeCcgConfig } from '../utils/config'
import { getAllCommandIds, installWorkflows, showBinaryDownloadWarning } from '../utils/installer'
import { migrateToV2_2_0, needsMigration } from '../utils/migration'
import { createEmptyManifest, readManifest, writeManifest } from '../utils/manifest'
import { CCG_BIN_DIR, resolvePaths } from '../utils/paths'

/**
 * Auto-approve codeagent-wrapper Bash commands in settings.json.
 *
 * All platforms use permissions.allow with wildcard pattern (v1.7.89+).
 * Old Hook-based approach and old permission entries are automatically cleaned up.
 */
async function installHook(settingsPath: string): Promise<'permission'> {
  let settings: Record<string, any> = {}
  if (await fs.pathExists(settingsPath)) {
    settings = await fs.readJSON(settingsPath)
  }

  // ── All platforms: permissions.allow approach (v1.7.89+) ──

  // Remove old Hook if it exists (migration from ≤v1.7.88)
  if (settings.hooks?.PreToolUse) {
    const hookIdx = settings.hooks.PreToolUse.findIndex(
      (h: any) => h.matcher === 'Bash' && h.hooks?.some((hh: any) => hh.command?.includes('codeagent-wrapper')),
    )
    if (hookIdx >= 0) {
      settings.hooks.PreToolUse.splice(hookIdx, 1)
      // Clean up empty arrays/objects
      if (settings.hooks.PreToolUse.length === 0)
        delete settings.hooks.PreToolUse
      if (settings.hooks && Object.keys(settings.hooks).length === 0)
        delete settings.hooks
    }
  }

  // Remove old permission entry without leading wildcard (migration from ≤v1.7.88)
  if (settings.permissions?.allow) {
    const oldEntry = 'Bash(codeagent-wrapper*)'
    const oldIdx = settings.permissions.allow.indexOf(oldEntry)
    if (oldIdx >= 0) {
      settings.permissions.allow.splice(oldIdx, 1)
    }
  }

  // Add permissions.allow entry
  if (!settings.permissions)
    settings.permissions = {}
  if (!settings.permissions.allow)
    settings.permissions.allow = []

  const permEntry = 'Bash(*codeagent-wrapper*)'
  if (!settings.permissions.allow.includes(permEntry)) {
    settings.permissions.allow.push(permEntry)
  }

  await fs.writeJSON(settingsPath, settings, { spaces: 2 })
  return 'permission'
}

// ═══════════════════════════════════════════════════════
// Interactive step state machine (v2.1.16+)
// ═══════════════════════════════════════════════════════
// Each step's first list prompt includes sentinel choices for
// "← back" (step 2+) and "× cancel". Users can also jump to any
// step from the final summary page.

type StepId = 'api' | 'model' | 'perf'
type StepReturn = 'next' | 'back' | 'cancel'
type SummaryAction = 'confirm' | 'cancel' | StepId

// Sentinel values injected into list choices for navigation.
const BACK_SENTINEL = '__ccg_back__'
const CANCEL_SENTINEL = '__ccg_cancel__'

/**
 * Build navigation sentinels to append to a step's first list prompt.
 * Always includes cancel; includes back only when canGoBack is true.
 */
function navSentinels(canGoBack: boolean): any[] {
  const items: any[] = [new inquirer.Separator()]
  if (canGoBack) {
    items.push({
      name: `${ansis.cyan('←')} ${i18n.t('init:nav.back')}`,
      value: BACK_SENTINEL,
    })
  }
  items.push({
    name: `${ansis.red('×')} ${i18n.t('init:nav.cancel')}`,
    value: CANCEL_SENTINEL,
  })
  return items
}

export async function init(options: InitOptions = {}): Promise<void> {
  const scope = options.local ? 'local' : 'global'
  const paths = resolvePaths(scope, options.projectRoot)
  const isLocal = paths.scope === 'local'

  console.log()
  console.log(ansis.cyan.bold(`  CCG - Claude + Codex + Gemini`))
  console.log(ansis.gray(`  Multi-Model Collaboration Workflow`))
  if (isLocal) {
    console.log(ansis.gray(`  Local install → ${paths.projectRoot}`))
  }
  console.log()

  // ═══════════════════════════════════════════════════════
  // Step 0: Language selection (FIRST interactive step)
  // ═══════════════════════════════════════════════════════
  let language: SupportedLang = 'zh-CN'

  if (!options.skipPrompt) {
    // Check if user already has a language preference
    const existingConfig = await readEffectiveConfig(paths)
    const savedLang = existingConfig?.general?.language

    if (savedLang) {
      // Use saved language
      language = savedLang
      await initI18n(language)
    }
    else {
      // First time user: ask for language
      const { selectedLang } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedLang',
        message: '选择语言 / Select language',
        choices: [
          { name: `简体中文`, value: 'zh-CN' },
          { name: `English`, value: 'en' },
        ],
        default: 'zh-CN',
      }])
      language = selectedLang
      await initI18n(language)
    }
  }
  else if (options.lang) {
    language = options.lang
    await initI18n(language)
  }

  // Model routing configuration (user-selectable since v2.1.0)
  let frontendModels: ModelType[] = ['gemini']
  let backendModels: ModelType[] = ['codex']
  let geminiModel = 'gemini-3.1-pro-preview'
  const mode: CollaborationMode = 'smart'
  const selectedWorkflows = getAllCommandIds()

  // Non-interactive mode: preserve existing config
  if (options.skipPrompt) {
    const existingConfig = await readEffectiveConfig(paths)
    if (existingConfig?.routing) {
      frontendModels = existingConfig.routing.frontend?.models || ['gemini']
      backendModels = existingConfig.routing.backend?.models || ['codex']
      geminiModel = existingConfig.routing.geminiModel || 'gemini-3.1-pro-preview'
    }
  }

  // Performance mode selection
  let liteMode = false
  let skipImpeccable = false

  // Claude Code API configuration
  let apiUrl = ''
  let apiKey = ''

  // ═══════════════════════════════════════════════════════
  // Non-interactive mode (--skip-prompt): preserve existing settings
  // ═══════════════════════════════════════════════════════
  if (options.skipPrompt) {
    const existingConfig = await readEffectiveConfig(paths)
    if (existingConfig?.performance?.liteMode !== undefined) {
      liteMode = existingConfig.performance.liteMode
    }
    if (existingConfig?.performance?.skipImpeccable !== undefined) {
      skipImpeccable = existingConfig.performance.skipImpeccable
    }
  }

  // ═══════════════════════════════════════════════════════
  // Interactive state machine (v2.1.16+)
  //
  // Users can retry/back/cancel at each step, and jump back to any
  // step from the final summary page. Previously they had to Ctrl+C
  // and restart if they mistyped a URL/KEY.
  // ═══════════════════════════════════════════════════════
  if (!options.skipPrompt) {
    const existingConfig = await readEffectiveConfig(paths)

    // Initialize from existing config so re-running init shows saved values as defaults
    if (existingConfig?.routing) {
      const ef = existingConfig.routing.frontend?.primary
      const eb = existingConfig.routing.backend?.primary
      if (ef)
        frontendModels = [ef]
      if (eb)
        backendModels = [eb]
      if (existingConfig.routing.geminiModel)
        geminiModel = existingConfig.routing.geminiModel
    }
    if (existingConfig?.performance?.liteMode !== undefined) {
      liteMode = existingConfig.performance.liteMode
    }

    // ── Step runners (closures sharing outer-scope state) ──

    async function runApiStep(canGoBack: boolean): Promise<StepReturn> {
      console.log()
      console.log(ansis.cyan.bold(`  🔑 Step 1/3 — ${i18n.t('init:api.title')}`))
      console.log()

      const { apiProvider } = await inquirer.prompt([{
        type: 'list',
        name: 'apiProvider',
        message: i18n.t('init:api.providerPrompt'),
        choices: [
          { name: `${ansis.green('●')} ${i18n.t('init:api.officialOption')}`, value: 'official' },
          { name: `${ansis.cyan('●')} ${i18n.t('init:api.thirdPartyOption')}`, value: 'thirdparty' },
          { name: `${ansis.yellow('★')} ${i18n.t('init:api.sponsor302AI')} ${ansis.gray('— https://share.302.ai/oUDqQ6')}`, value: '302ai' },
          { name: `${ansis.gray('○')} ${i18n.t('init:api.skipOption')}`, value: 'skip' },
          ...navSentinels(canGoBack),
        ],
      }])

      if (apiProvider === BACK_SENTINEL)
        return 'back'
      if (apiProvider === CANCEL_SENTINEL)
        return 'cancel'

      // Clear stale values before collecting fresh input
      apiUrl = ''
      apiKey = ''

      if (apiProvider === '302ai') {
        apiUrl = 'https://api.302.ai/cc'
        console.log()
        console.log(`    ${ansis.yellow('★')} ${i18n.t('init:api.sponsor302AIGetKey')}: ${ansis.cyan.underline('https://share.302.ai/oUDqQ6')}`)
        console.log()
        const { key } = await inquirer.prompt([{
          type: 'password',
          name: 'key',
          message: `302.AI API Key ${ansis.gray(`(${i18n.t('init:api.keyRequired')})`)}`,
          mask: '*',
          validate: (v: string) => v.trim() !== '' || i18n.t('init:api.enterKey'),
        }])
        apiKey = key?.trim() || ''
      }
      else if (apiProvider === 'thirdparty') {
        const apiAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'url',
            message: `API URL ${ansis.gray(`(${i18n.t('init:api.urlRequired')})`)}`,
            validate: (v: string) => v.trim() !== '' || i18n.t('init:api.enterUrl'),
          },
          {
            type: 'password',
            name: 'key',
            message: `API Key ${ansis.gray(`(${i18n.t('init:api.keyRequired')})`)}`,
            mask: '*',
            validate: (v: string) => v.trim() !== '' || i18n.t('init:api.enterKey'),
          },
        ])
        apiUrl = apiAnswers.url?.trim() || ''
        apiKey = apiAnswers.key?.trim() || ''
      }
      else if (apiProvider === 'skip') {
        console.log()
        console.log(`    ${ansis.gray('○')} ${i18n.t('init:api.skipNoticeTitle')}`)
      }
      // 'official' leaves apiUrl/apiKey empty — will use OAuth login
      return 'next'
    }

    async function runModelStep(canGoBack: boolean): Promise<StepReturn> {
      console.log()
      console.log(ansis.cyan.bold(`  🧠 Step 2/3 — ${i18n.t('init:model.title')}`))
      console.log()

      const { selectedFrontend } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedFrontend',
        message: i18n.t('init:model.selectFrontend'),
        choices: [
          { name: `Gemini ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: 'gemini' as ModelType },
          { name: 'Codex', value: 'codex' as ModelType },
          ...navSentinels(canGoBack),
        ],
        default: frontendModels[0] || 'gemini',
      }])

      if (selectedFrontend === BACK_SENTINEL)
        return 'back'
      if (selectedFrontend === CANCEL_SENTINEL)
        return 'cancel'

      const { selectedBackend } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedBackend',
        message: i18n.t('init:model.selectBackend'),
        choices: [
          { name: 'Gemini', value: 'gemini' as ModelType },
          { name: `Codex ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: 'codex' as ModelType },
        ],
        default: backendModels[0] || 'codex',
      }])

      frontendModels = [selectedFrontend]
      backendModels = [selectedBackend]

      if (selectedFrontend === 'gemini' || selectedBackend === 'gemini') {
        const { selectedGeminiModel } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedGeminiModel',
          message: i18n.t('init:model.selectGeminiModel'),
          choices: [
            { name: `gemini-3.1-pro-preview ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: 'gemini-3.1-pro-preview' },
            { name: 'gemini-2.5-flash', value: 'gemini-2.5-flash' },
            { name: `${i18n.t('init:model.custom')}`, value: 'custom' },
          ],
          default: geminiModel || 'gemini-3.1-pro-preview',
        }])

        if (selectedGeminiModel === 'custom') {
          const { customModel } = await inquirer.prompt([{
            type: 'input',
            name: 'customModel',
            message: i18n.t('init:model.enterCustomModel'),
            default: geminiModel || '',
            validate: (v: string) => v.trim() !== '' || i18n.t('init:model.enterCustomModel'),
          }])
          geminiModel = customModel.trim()
        }
        else {
          geminiModel = selectedGeminiModel
        }
      }
      return 'next'
    }

    async function runPerfStep(canGoBack: boolean): Promise<StepReturn> {
      console.log()
      console.log(ansis.cyan.bold(`  ⚡ Step 3/3 — ${i18n.t('init:perf.title')}`))
      console.log()

      const { perfMode } = await inquirer.prompt([{
        type: 'list',
        name: 'perfMode',
        message: i18n.t('init:perf.selectMode'),
        choices: [
          { name: `${ansis.green('●')} ${i18n.t('init:perf.standardOption')}`, value: 'standard' },
          { name: `${ansis.cyan('●')} ${i18n.t('init:perf.liteOption')}`, value: 'lite' },
          ...navSentinels(canGoBack),
        ],
        default: liteMode ? 'lite' : 'standard',
      }])

      if (perfMode === BACK_SENTINEL)
        return 'back'
      if (perfMode === CANCEL_SENTINEL)
        return 'cancel'

      liteMode = perfMode === 'lite'

      const { includeImpeccable } = await inquirer.prompt([{
        type: 'confirm',
        name: 'includeImpeccable',
        message: i18n.t('init:commands.includeImpeccable'),
        default: !skipImpeccable,
      }])
      skipImpeccable = !includeImpeccable
      return 'next'
    }

    // Summary page renderer — returns 'confirm' | 'cancel' | StepId
    const runSummaryStep = async (workflowsCount: number): Promise<SummaryAction> => {
      console.log()
      console.log(ansis.yellow('━'.repeat(50)))
      console.log(ansis.bold(`  ${i18n.t('init:summary.title')}`))
      console.log()
      const fmName = frontendModels[0].charAt(0).toUpperCase() + frontendModels[0].slice(1)
      const bmName = backendModels[0].charAt(0).toUpperCase() + backendModels[0].slice(1)
      const apiLabel = (() => {
        if (apiUrl && apiKey)
          return `${ansis.green('●')} ${apiUrl} ${ansis.gray('+ ***')}`
        if (apiUrl)
          return `${ansis.green('●')} ${apiUrl}`
        return `${ansis.gray('○')} ${i18n.t('init:summary.apiSelfManaged')}`
      })()
      console.log(`  ${ansis.cyan(i18n.t('init:summary.apiProvider'))}  ${apiLabel}`)
      console.log(`  ${ansis.cyan(i18n.t('init:summary.modelRouting'))}  ${ansis.green(fmName)} (Frontend) + ${ansis.blue(bmName)} (Backend)`)
      if (frontendModels[0] === 'gemini' || backendModels[0] === 'gemini') {
        console.log(`  ${ansis.cyan(i18n.t('init:summary.geminiModel'))}   ${ansis.gray(geminiModel)}`)
      }
      console.log(`  ${ansis.cyan(i18n.t('init:summary.commandCount'))}  ${ansis.yellow(workflowsCount.toString())}`)
      console.log(`  ${ansis.cyan(i18n.t('init:summary.webUI'))}        ${liteMode ? ansis.gray(i18n.t('init:summary.disabled')) : ansis.green(i18n.t('init:summary.enabled'))}`)
      console.log(ansis.yellow('━'.repeat(50)))
      console.log()

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: i18n.t('init:summaryMenu.prompt'),
        choices: [
          { name: `${ansis.green('✓')} ${i18n.t('init:summaryMenu.confirm')}`, value: 'confirm' },
          new inquirer.Separator(),
          { name: `${ansis.cyan('✎')} ${i18n.t('init:summaryMenu.editApi')}`, value: 'api' },
          { name: `${ansis.cyan('✎')} ${i18n.t('init:summaryMenu.editModel')}`, value: 'model' },
          { name: `${ansis.cyan('✎')} ${i18n.t('init:summaryMenu.editPerf')}`, value: 'perf' },
          new inquirer.Separator(),
          { name: `${ansis.red('×')} ${i18n.t('init:summaryMenu.cancel')}`, value: 'cancel' },
        ],
        default: 'confirm',
      }])
      return action as SummaryAction
    }

    // ── Main state machine loop ──
    //
    // Each runStep returns 'next' | 'back' | 'cancel'. Navigation is
    // driven by sentinels inside each step's first list prompt. The
    // summary page is a separate jump-back menu that can land on any
    // step; after completing that jumped-to step we return to summary.
    const stepOrder: StepId[] = ['api', 'model', 'perf']
    let stepIdx = 0
    let jumpingToSummary = false

    while (true) {
      if (stepIdx < stepOrder.length) {
        const stepId = stepOrder[stepIdx]
        const canGoBack = stepIdx > 0

        let result: StepReturn
        switch (stepId) {
          case 'api':
            result = await runApiStep(canGoBack)
            break
          case 'model':
            result = await runModelStep(canGoBack)
            break
          case 'perf':
            result = await runPerfStep(canGoBack)
            break
        }

        if (result === 'cancel') {
          console.log(ansis.yellow(i18n.t('init:installCancelled')))
          return
        }
        if (result === 'back') {
          stepIdx = Math.max(0, stepIdx - 1)
          continue
        }

        // result === 'next'
        if (jumpingToSummary) {
          // Returned from a summary-triggered jump — go back to summary
          jumpingToSummary = false
          stepIdx = stepOrder.length
        }
        else {
          stepIdx++
        }
      }
      else {
        // Summary stage
        const summaryAction = await runSummaryStep(selectedWorkflows.length)
        if (summaryAction === 'confirm') {
          break
        }
        if (summaryAction === 'cancel') {
          console.log(ansis.yellow(i18n.t('init:installCancelled')))
          return
        }
        // Jump to the requested step, then return to summary
        jumpingToSummary = true
        stepIdx = stepOrder.indexOf(summaryAction)
      }
    }
  }

  // Build routing config (user-selectable since v2.1.0)
  const routing: ModelRouting = {
    frontend: {
      models: frontendModels,
      primary: frontendModels[0],
      strategy: 'fallback',
    },
    backend: {
      models: backendModels,
      primary: backendModels[0],
      strategy: 'fallback',
    },
    review: {
      models: [...new Set([...frontendModels, ...backendModels])],
      strategy: 'parallel',
    },
    mode,
    geminiModel,
  }

  // Summary + confirmation handled by runSummaryStep() inside the state
  // machine above. For --skip-prompt / --force paths, print a minimal
  // summary line so non-interactive runs still show what's being installed.
  if (options.skipPrompt || options.force) {
    console.log()
    console.log(ansis.yellow('━'.repeat(50)))
    console.log(ansis.bold(`  ${i18n.t('init:summary.title')}`))
    console.log()
    const fmName = frontendModels[0].charAt(0).toUpperCase() + frontendModels[0].slice(1)
    const bmName = backendModels[0].charAt(0).toUpperCase() + backendModels[0].slice(1)
    console.log(`  ${ansis.cyan(i18n.t('init:summary.modelRouting'))}  ${ansis.green(fmName)} (Frontend) + ${ansis.blue(bmName)} (Backend)`)
    console.log(`  ${ansis.cyan(i18n.t('init:summary.commandCount'))}  ${ansis.yellow(selectedWorkflows.length.toString())}`)
    console.log(ansis.yellow('━'.repeat(50)))
    console.log()
  }

  // Install
  const spinner = ora(i18n.t('init:installing')).start()

  try {
    // v2.2.0: Auto-migrate CCG private data out of ~/.claude/
    if (!isLocal && await needsMigration()) {
      spinner.text = 'Migrating CCG private data to ~/.ccg/...'
      const migrationResult = await migrateToV2_2_0()

      if (migrationResult.migratedFiles.length > 0) {
        spinner.info(ansis.cyan('Migration completed:'))
        console.log()
        for (const file of migrationResult.migratedFiles) {
          console.log(`  ${ansis.green('✓')} ${file}`)
        }
        if (migrationResult.skipped.length > 0) {
          console.log()
          console.log(ansis.gray('  Skipped:'))
          for (const file of migrationResult.skipped) {
            console.log(`  ${ansis.gray('○')} ${file}`)
          }
        }
        console.log()
        spinner.start(i18n.t('init:installing'))
      }

      if (migrationResult.errors.length > 0) {
        spinner.warn(ansis.yellow('Migration completed with errors:'))
        for (const error of migrationResult.errors) {
          console.log(`  ${ansis.red('✗')} ${error}`)
        }
        console.log()
        spinner.start(i18n.t('init:installing'))
      }
    }

    await ensureCcgDir(paths.ccgPrivateDir)

    // Create config
    const config = createDefaultConfig({
      language,
      routing,
      installedWorkflows: selectedWorkflows,
      liteMode,
      skipImpeccable,
    })
    config.paths = {
      commands: paths.claudeCommandsDir,
      prompts: paths.ccgPromptsDir,
      backup: paths.ccgBackupDir,
    }

    // Save config FIRST - ensure it's created even if installation fails
    await writeCcgConfig(config, paths.ccgConfigFile)

    // Install workflows and commands
    const installDir = !isLocal && options.installDir ? options.installDir : paths.claudeDir
    const installConfig = {
      routing,
      liteMode,
      skipImpeccable,
    }
    const result = !isLocal && options.installDir
      ? await installWorkflows(selectedWorkflows, installDir, options.force, installConfig)
      : await installWorkflows(selectedWorkflows, paths, {
          force: options.force,
          config: installConfig,
        })

    spinner.succeed(ansis.green(i18n.t('init:installSuccess')))

    // ═══════════════════════════════════════════════════════
    // Save settings.json: API config + Hook auto-approve
    // ═══════════════════════════════════════════════════════
    const settingsPath = join(installDir, 'settings.json')

    // Save API configuration if provided
    if (!isLocal && apiUrl && apiKey) {
      let settings: Record<string, any> = {}
      if (await fs.pathExists(settingsPath)) {
        settings = await fs.readJSON(settingsPath)
      }
      if (!settings.env)
        settings.env = {}
      settings.env.ANTHROPIC_BASE_URL = apiUrl
      settings.env.ANTHROPIC_AUTH_TOKEN = apiKey
      delete settings.env.ANTHROPIC_API_KEY
      // Default optimization config
      settings.env.DISABLE_TELEMETRY = '1'
      settings.env.DISABLE_ERROR_REPORTING = '1'
      settings.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
      settings.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
      // codeagent-wrapper permission allowlist
      if (!settings.permissions)
        settings.permissions = {}
      if (!settings.permissions.allow)
        settings.permissions.allow = []
      const wrapperPerms = [
        'Bash(~/.ccg/bin/codeagent-wrapper --backend gemini*)',
        'Bash(~/.ccg/bin/codeagent-wrapper --backend codex*)',
      ]
      for (const perm of wrapperPerms) {
        if (!settings.permissions.allow.includes(perm))
          settings.permissions.allow.push(perm)
      }
      await fs.writeJSON(settingsPath, settings, { spaces: 2 })
      console.log()
      console.log(`    ${ansis.green('✓')} API ${ansis.gray(`→ ${settingsPath}`)}`)
    }

    // Always install codeagent-wrapper auto-approve via permissions.allow for global installs.
    if (!isLocal) {
      await installHook(settingsPath)
      console.log()
      console.log(`    ${ansis.green('✓')} ${i18n.t('init:hooks.installed')} ${ansis.gray('(permissions.allow)')}`)
    }

    // jq check removed — permissions.allow approach does not require jq

    // Show result summary
    console.log()
    console.log(ansis.cyan(`  ${i18n.t('init:installedCommands')}`))
    result.installedCommands.forEach((cmd) => {
      console.log(`    ${ansis.green('✓')} /ccg:${cmd}`)
    })

    // Show installed prompts
    if (result.installedPrompts.length > 0) {
      console.log()
      console.log(ansis.cyan(`  ${i18n.t('init:installedPrompts')}`))
      // Group by model
      const grouped: Record<string, string[]> = {}
      result.installedPrompts.forEach((p) => {
        const [model, role] = p.split('/')
        if (!grouped[model])
          grouped[model] = []
        grouped[model].push(role)
      })
      Object.entries(grouped).forEach(([model, roles]) => {
        console.log(`    ${ansis.green('✓')} ${model}: ${roles.join(', ')}`)
      })
    }

    // Show installed skills
    if (result.installedSkills && result.installedSkills > 0) {
      console.log()
      console.log(ansis.cyan('  Skills:'))
      console.log(`    ${ansis.green('✓')} ${result.installedSkills} skills installed (quality gates + multi-agent)`)
      console.log(ansis.gray('       → ~/.claude/skills/'))
    }

    // Show installed rules
    if (result.installedRules) {
      console.log()
      console.log(ansis.cyan('  Rules:'))
      console.log(`    ${ansis.green('✓')} quality gate auto-trigger rules`)
      console.log(ansis.gray('       → ~/.claude/rules/ccg-skills.md'))
    }

    // Show errors if any
    if (result.errors.length > 0) {
      console.log()
      if (!result.success) {
        // Critical failure — prominent red box
        console.log(ansis.red.bold(`  ╔════════════════════════════════════════════════════════════╗`))
        console.log(ansis.red.bold(`  ║  ⚠  安装出现错误 / Installation errors detected           ║`))
        console.log(ansis.red.bold(`  ╚════════════════════════════════════════════════════════════╝`))
      }
      else {
        console.log(ansis.yellow(`  ⚠ ${i18n.t('init:installationErrors')}`))
      }
      result.errors.forEach((error) => {
        console.log(`    ${ansis.red('✗')} ${error}`)
      })
      if (!result.success) {
        console.log()
        console.log(ansis.yellow(`  尝试修复 / Try to fix:`))
        console.log(ansis.cyan(`    npx ccg-workflow@latest init --force`))
        console.log(ansis.gray(`    如仍失败，请提交 issue 并附上以上错误信息`))
        console.log(ansis.gray(`    If still failing, report an issue with the errors above`))
      }
    }

    // Show binary installation result
    if (!isLocal && result.binInstalled && result.binPath) {
      console.log()
      console.log(ansis.cyan(`  ${i18n.t('init:installedBinary')}`))
      console.log(`    ${ansis.green('✓')} codeagent-wrapper ${ansis.gray(`→ ${result.binPath}`)}`)

      const platform = process.platform

      if (platform === 'win32') {
        const windowsPath = result.binPath.replace(/\//g, '\\').replace(/\\$/, '')
        try {
          const { execSync } = await import('node:child_process')
          const psFlags = '-NoProfile -NonInteractive -ExecutionPolicy Bypass'
          const currentPath = execSync(`powershell ${psFlags} -Command "[System.Environment]::GetEnvironmentVariable('PATH', 'User')"`, { encoding: 'utf-8' }).trim()
          const currentPathNorm = currentPath.toLowerCase().replace(/\\$/g, '')
          const windowsPathNorm = windowsPath.toLowerCase()

          if (!currentPathNorm.includes(windowsPathNorm) && !currentPathNorm.includes('.ccg\\bin')) {
            const escapedPath = windowsPath.replace(/'/g, "''")
            const psScript = currentPath
              ? `$p=[System.Environment]::GetEnvironmentVariable('PATH','User');[System.Environment]::SetEnvironmentVariable('PATH',($p+';'+'${escapedPath}'),'User')`
              : `[System.Environment]::SetEnvironmentVariable('PATH','${escapedPath}','User')`
            execSync(`powershell ${psFlags} -Command "${psScript}"`, { stdio: 'pipe' })
            console.log(`    ${ansis.green('✓')} PATH ${ansis.gray('→ User env')}`)
          }
        }
        catch {
          // Silently ignore PATH config errors on Windows
        }
      }
      else if (!options.skipPrompt) {
        const exportCommand = `export PATH="${result.binPath}:$PATH"`
        const shell = process.env.SHELL || ''
        const isZsh = shell.includes('zsh')
        const isBash = shell.includes('bash')
        const isMacDefaultZsh = process.platform === 'darwin' && !shell

        if (isZsh || isBash || isMacDefaultZsh) {
          const shellRc = (isZsh || isMacDefaultZsh) ? join(homedir(), '.zshrc') : join(homedir(), '.bashrc')
          const shellRcDisplay = (isZsh || isMacDefaultZsh) ? '~/.zshrc' : '~/.bashrc'

          try {
            let rcContent = ''
            if (await fs.pathExists(shellRc)) {
              rcContent = await fs.readFile(shellRc, 'utf-8')
            }

            if (rcContent.includes(result.binPath) || rcContent.includes('/.ccg/bin')) {
              console.log(`    ${ansis.green('✓')} PATH ${ansis.gray(`→ ${shellRcDisplay} (${i18n.t('init:pathAlreadyConfigured', { file: shellRcDisplay })})`)}`)
            }
            else {
              const configLine = `\n# CCG multi-model collaboration system\n${exportCommand}\n`
              await fs.appendFile(shellRc, configLine, 'utf-8')
              const manifest = await readManifest(paths.ccgManifestFile) ?? createEmptyManifest()
              manifest.shellRc = { file: shellRc, line: exportCommand }
              await writeManifest(manifest, paths.ccgManifestFile)
              console.log(`    ${ansis.green('✓')} PATH ${ansis.gray(`→ ${shellRcDisplay}`)}`)
            }
          }
          catch {
            // Silently ignore PATH config errors
          }
        }
        else {
          console.log(`    ${ansis.yellow('⚠')} PATH ${ansis.gray(`→ ${i18n.t('init:addToPathManually')}`)}`)
          console.log(`      ${ansis.cyan(exportCommand)}`)
        }
      }
    }
    else if (!isLocal) {
      // Binary download failed — show prominent warning with manual fix instructions
      showBinaryDownloadWarning(CCG_BIN_DIR)
    }

    console.log()
  }
  catch (error) {
    spinner.fail(ansis.red(i18n.t('init:installFailed')))
    console.error(error)
  }
}
