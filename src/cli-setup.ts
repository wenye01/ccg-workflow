import type { CAC } from 'cac'
import type { CliOptions } from './types'
import ansis from 'ansis'
import { version } from '../package.json'
import { init } from './commands/init'
import { showMainMenu } from './commands/menu'
import { registerRunCommand } from './commands/run'
import { update } from './commands/update'
import { i18n, initI18n } from './i18n'
import { readCcgConfig } from './utils/config'

function customizeHelp(sections: any[]): any[] {
  sections.unshift({
    title: '',
    body: ansis.cyan.bold(`CCG - Claude + Codex + Gemini v${version}`),
  })

  sections.push({
    title: ansis.yellow(i18n.t('cli:help.commands')),
    body: [
      `  ${ansis.cyan('ccg')}              ${i18n.t('cli:help.commandDescriptions.showMenu')}`,
      `  ${ansis.cyan('ccg init')} | ${ansis.cyan('i')}     ${i18n.t('cli:help.commandDescriptions.initConfig')}`,
      `  ${ansis.cyan('ccg run')}          Run a runtime pipeline`,
      `  ${ansis.cyan('ccg update')}        Update CCG workflows`,
      '',
      ansis.gray(`  ${i18n.t('cli:help.shortcuts')}`),
      `  ${ansis.cyan('ccg i')}            ${i18n.t('cli:help.shortcutDescriptions.quickInit')}`,
    ].join('\n'),
  })

  sections.push({
    title: ansis.yellow(i18n.t('cli:help.options')),
    body: [
      `  ${ansis.green('--lang, -l')} <lang>         ${i18n.t('cli:help.optionDescriptions.displayLanguage')} (zh-CN, en)`,
      `  ${ansis.green('--force, -f')}               ${i18n.t('cli:help.optionDescriptions.forceOverwrite')}`,
      `  ${ansis.green('--help, -h')}                ${i18n.t('cli:help.optionDescriptions.displayHelp')}`,
      `  ${ansis.green('--version, -v')}             ${i18n.t('cli:help.optionDescriptions.displayVersion')}`,
      '',
      ansis.gray(`  ${i18n.t('cli:help.nonInteractiveMode')}`),
      `  ${ansis.green('--skip-prompt, -s')}         ${i18n.t('cli:help.optionDescriptions.skipAllPrompts')}`,
      `  ${ansis.green('--frontend, -F')} <models>   ${i18n.t('cli:help.optionDescriptions.frontendModels')}`,
      `  ${ansis.green('--backend, -B')} <models>    ${i18n.t('cli:help.optionDescriptions.backendModels')}`,
      `  ${ansis.green('--mode, -m')} <mode>         ${i18n.t('cli:help.optionDescriptions.collaborationMode')}`,
      `  ${ansis.green('--workflows, -w')} <list>    ${i18n.t('cli:help.optionDescriptions.workflows')}`,
      `  ${ansis.green('--install-dir, -d')} <path>  ${i18n.t('cli:help.optionDescriptions.installDir')}`,
    ].join('\n'),
  })

  sections.push({
    title: ansis.yellow(i18n.t('cli:help.examples')),
    body: [
      ansis.gray(`  # ${i18n.t('cli:help.exampleDescriptions.showInteractiveMenu')}`),
      `  ${ansis.cyan('npx ccg')}`,
      '',
      ansis.gray(`  # ${i18n.t('cli:help.exampleDescriptions.runFullInitialization')}`),
      `  ${ansis.cyan('npx ccg init')}`,
      `  ${ansis.cyan('npx ccg i')}`,
      '',
      ansis.gray(`  # ${i18n.t('cli:help.exampleDescriptions.customModels')}`),
      `  ${ansis.cyan('npx ccg i --frontend gemini,codex --backend codex,gemini')}`,
      '',
      ansis.gray(`  # ${i18n.t('cli:help.exampleDescriptions.parallelMode')}`),
      `  ${ansis.cyan('npx ccg i --mode parallel')}`,
      '',
    ].join('\n'),
  })

  return sections
}

export async function setupCommands(cli: CAC): Promise<void> {
  try {
    const config = await readCcgConfig()
    const defaultLang = config?.general?.language || 'zh-CN'
    await initI18n(defaultLang)
  }
  catch {
    await initI18n('zh-CN')
  }

  // Default command - show menu
  cli
    .command('', i18n.t('cli:help.commandDescriptions.showMenu'))
    .option('--lang, -l <lang>', `${i18n.t('cli:help.optionDescriptions.displayLanguage')} (zh-CN, en)`)
    .action(async (options: CliOptions) => {
      if (options.lang) {
        await initI18n(options.lang)
      }
      await showMainMenu()
    })

  // Init command
  cli
    .command('init', i18n.t('cli:help.commandDescriptions.initConfig'))
    .alias('i')
    .option('--lang, -l <lang>', `${i18n.t('cli:help.optionDescriptions.displayLanguage')} (zh-CN, en)`)
    .option('--force, -f', i18n.t('cli:help.optionDescriptions.forceOverwrite'))
    .option('--skip-prompt, -s', i18n.t('cli:help.optionDescriptions.skipAllPrompts'))
    .option('--frontend, -F <models>', i18n.t('cli:help.optionDescriptions.frontendModels'))
    .option('--backend, -B <models>', i18n.t('cli:help.optionDescriptions.backendModels'))
    .option('--mode, -m <mode>', i18n.t('cli:help.optionDescriptions.collaborationMode'))
    .option('--workflows, -w <workflows>', i18n.t('cli:help.optionDescriptions.workflows'))
    .option('--install-dir, -d <path>', i18n.t('cli:help.optionDescriptions.installDir'))
    .option('--local', 'Install to project .claude/ directory')
    .option('--project-root <path>', 'Specify project root directory')
    .action(async (options: CliOptions) => {
      if (options.lang) {
        await initI18n(options.lang)
      }
      await init(options)
    })

  // Update command
  cli
    .command('update', 'Update CCG workflows')
    .action(async () => {
      await update()
    })

  registerRunCommand(cli)

  cli.help(sections => customizeHelp(sections))
  cli.version(version)
}
