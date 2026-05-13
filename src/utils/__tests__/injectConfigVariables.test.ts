import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { injectConfigVariables } from '../installer'
import { replaceHomePathsInTemplate } from '../installer-template'

function findPackageRoot(): string {
  let dir = import.meta.dirname
  for (let i = 0; i < 10; i++) {
    try {
      readFileSync(join(dir, 'package.json'))
      return dir
    }
    catch {
      dir = join(dir, '..')
    }
  }
  throw new Error('Could not find package root')
}

const PACKAGE_ROOT = findPackageRoot()
const TEMPLATES_DIR = join(PACKAGE_ROOT, 'templates', 'commands')

describe('injectConfigVariables', () => {
  it('injects routing variables', () => {
    const result = injectConfigVariables('{{FRONTEND_PRIMARY}} / {{BACKEND_PRIMARY}} / {{ROUTING_MODE}}', {
      routing: {
        mode: 'smart',
        frontend: { models: ['gemini'], primary: 'gemini' },
        backend: { models: ['codex'], primary: 'codex' },
      },
    })
    expect(result).toBe('gemini / codex / smart')
  })

  it('injects lite mode flag', () => {
    const result = injectConfigVariables('codeagent-wrapper {{LITE_MODE_FLAG}}--backend codex', { liteMode: true })
    expect(result).toBe('codeagent-wrapper --lite --backend codex')
  })
})

describe('replaceHomePathsInTemplate — CCG private path isolation', () => {
  it('maps legacy private paths to the isolated CCG directory', () => {
    const result = replaceHomePathsInTemplate(
      '~/.claude/.ccg/prompts/codex/reviewer.md',
      '/home/test/.claude',
      '/home/test/.ccg',
    )
    expect(result).toBe('/home/test/.ccg/prompts/codex/reviewer.md')
  })

  it('maps legacy binary path to ~/.ccg/bin', () => {
    const result = replaceHomePathsInTemplate(
      '~/.claude/bin/codeagent-wrapper --backend codex',
      '/home/test/.claude',
      '/home/test/.ccg',
    )
    expect(result).toContain('/home/test/.ccg/bin/codeagent-wrapper')
    expect(result).not.toContain('/home/test/.claude/bin')
  })

  it('keeps Claude commands under ~/.claude', () => {
    const result = replaceHomePathsInTemplate(
      '~/.claude/commands/ccg/plan.md',
      '/home/test/.claude',
      '/home/test/.ccg',
    )
    expect(result).toBe('/home/test/.claude/commands/ccg/plan.md')
  })
})

describe('templates contain no removed search placeholders', () => {
  function collectTemplateFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...collectTemplateFiles(fullPath))
      }
      else if (entry.name.endsWith('.md')) {
        files.push(fullPath)
      }
    }
    return files
  }

  it('has no removed search placeholders in command templates', () => {
    for (const file of collectTemplateFiles(TEMPLATES_DIR)) {
      const content = readFileSync(file, 'utf-8')
      expect(content, file).not.toContain(`{{${'M' + 'CP_SEARCH_TOOL'}}}`)
      expect(content, file).not.toContain(`{{${'M' + 'CP_SEARCH_PARAM'}}}`)
      expect(content, file).not.toContain(`${'m' + 'cp'}__`)
    }
  })
})
