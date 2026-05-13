# CCG Workflow

CCG Workflow installs a Claude Code workflow pack that coordinates Claude, Codex, and Gemini for planning, implementation, review, Git workflows, OpenSpec flows, Agent Teams, prompts, skills, and output styles.

## Repository Map

| Path | Purpose |
|------|---------|
| `src/` | TypeScript CLI, installer, config, i18n, tests |
| `templates/` | Slash commands, agents, prompts, rules, skills, output styles |
| `codeagent-wrapper/` | Go wrapper used by generated commands to call Codex/Gemini/Claude |
| `docs/` | VitePress user documentation |
| `bin/ccg.mjs` | npm executable entry |

## Main CLI

| Command | Purpose |
|---------|---------|
| `npx ccg-workflow` | Open the interactive menu |
| `npx ccg-workflow init` | Install workflows |
| `npx ccg-workflow update` | Reinstall latest workflows |

The init flow has three interactive steps:

1. API provider
2. Model routing
3. Performance mode

## Installed Surface

CCG writes generated assets to the Claude Code environment:

- `commands/ccg`: slash commands
- `agents/ccg`: subagents
- `.ccg/prompts`: model role prompts
- `skills/ccg`: bundled skills
- `rules`: CCG trigger rules
- `output-styles`: optional output styles
- `.ccg/manifest.json`: installed-file manifest for uninstall

## Key Source Files

| File | Purpose |
|------|---------|
| `src/cli-setup.ts` | Register CLI commands |
| `src/commands/init.ts` | Install wizard and orchestration |
| `src/commands/menu.ts` | Interactive menu |
| `src/commands/update.ts` | Workflow update flow |
| `src/utils/installer.ts` | Main install/uninstall implementation |
| `src/utils/installer-data.ts` | Workflow registry |
| `src/utils/installer-template.ts` | Template variable replacement |
| `src/utils/manifest.ts` | Manifest read/write and uninstall cleanup |
| `src/utils/config.ts` | Config read/write/merge |

## Template Variables

Templates are installed after `injectConfigVariables()` replaces runtime configuration:

- `{{FRONTEND_PRIMARY}}`
- `{{BACKEND_PRIMARY}}`
- `{{FRONTEND_MODELS}}`
- `{{BACKEND_MODELS}}`
- `{{REVIEW_MODELS}}`
- `{{ROUTING_MODE}}`
- `{{GEMINI_MODEL_FLAG}}`
- `{{LITE_MODE_FLAG}}`

## Verification

Use the standard checks before shipping:

```bash
pnpm typecheck
pnpm test
pnpm build
```
