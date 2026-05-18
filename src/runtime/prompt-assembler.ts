import type { CompiledStep } from './types'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'fs-extra'

export interface AssemblePromptOptions {
  step: CompiledStep
  workDir: string
  taskDescription: string
  bindings?: Record<string, string>
  projectContext?: string
}

export interface AssembledPrompt {
  prompt: string
  output_schema?: Record<string, unknown>
}

export async function assemblePrompt(options: AssemblePromptOptions): Promise<AssembledPrompt> {
  const rolePrompt = await readPromptTemplate(options.step.prompt_template, options.workDir)
  const projectContext = options.projectContext ?? await readProjectContext(options.workDir)
  const artifactContext = formatArtifactContext(options.bindings ?? {})
  const sections = [rolePrompt.trim()]

  if (options.taskDescription.trim() !== '') {
    sections.push(`## Current Task\n${options.taskDescription.trim()}`)
  }
  if (artifactContext !== '') {
    sections.push(`## Context from Previous Steps\n${artifactContext}`)
  }
  if (projectContext !== '') {
    sections.push(`## Project Context\n${projectContext}`)
  }

  return {
    prompt: `${sections.join('\n\n')}\n`,
    output_schema: buildOutputSchema(options.step),
  }
}

export async function readPromptTemplate(templatePath: string | undefined, workDir: string): Promise<string> {
  if (templatePath == null || templatePath.trim() === '') {
    return ''
  }

  const resolved = resolveTemplatePath(templatePath, workDir)
  return fs.readFile(resolved, 'utf8')
}

export async function readProjectContext(workDir: string): Promise<string> {
  const contextDir = join(workDir, '.context')
  if (!(await fs.pathExists(contextDir))) {
    return ''
  }

  const files = await collectContextFiles(contextDir)
  const chunks: string[] = []

  for (const file of files) {
    const relative = file.slice(contextDir.length + 1)
    const content = (await fs.readFile(file, 'utf8')).trim()
    if (content !== '') {
      chunks.push(`### .context/${relative}\n${content}`)
    }
  }

  return chunks.join('\n\n')
}

function resolveTemplatePath(templatePath: string, workDir: string): string {
  if (isAbsolute(templatePath)) {
    return templatePath
  }

  const candidates = [
    resolve(workDir, templatePath),
    resolve(projectRoot(), templatePath),
  ]
  const found = candidates.find(candidate => existsSync(candidate))
  if (found != null) {
    return found
  }

  return candidates[0]
}

function formatArtifactContext(bindings: Record<string, string>): string {
  return Object.entries(bindings)
    .map(([key, value]) => `### ${key}\n${value}`)
    .join('\n\n')
}

function buildOutputSchema(step: CompiledStep): Record<string, unknown> | undefined {
  const outputs = step.outputs ?? []
  if (outputs.length === 0) {
    return undefined
  }
  if (outputs.length === 1) {
    return outputs[0].schema
  }

  return {
    type: 'object',
    required: outputs.filter(output => output.required !== false).map(output => output.type),
    properties: Object.fromEntries(outputs.map(output => [output.type, output.schema])),
  }
}

async function collectContextFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectContextFiles(path))
    }
    else if (entry.isFile() && /\.(md|log|txt)$/i.test(entry.name)) {
      files.push(path)
    }
  }

  return files.sort()
}

function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}
