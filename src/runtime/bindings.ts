import type { CompiledStep } from './types'
import { ArtifactStore } from './artifact'

export interface ParsedBinding {
  artifact: string
  path: string
  transforms: BindingTransform[]
}

export interface BindingTransform {
  name: 'summary' | 'first_n' | 'json_stringify'
  argument?: string
}

export async function resolveBindings(
  step: CompiledStep,
  store: ArtifactStore,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}

  for (const [name, expression] of Object.entries(step.bindings ?? {})) {
    const parsed = parseBindingExpression(expression)
    const input = step.resolved_inputs.find(input => input.artifact_type === parsed.artifact)
    const artifact = await store.read(parsed.artifact, input?.version)
    const value = getPathValue(artifact.data, parsed.path)

    if (value === undefined) {
      throw new Error(`Binding "${name}" references missing artifact path "${parsed.artifact}.${parsed.path}"`)
    }

    resolved[name] = stringifyBindingValue(applyTransforms(value, parsed.transforms))
  }

  return resolved
}

export function parseBindingExpression(expression: string): ParsedBinding {
  const parts = expression.split('|').map(part => part.trim()).filter(Boolean)
  const source = parts.shift()
  if (source == null) {
    throw new Error('Binding expression is empty')
  }

  const dot = source.indexOf('.')
  if (dot <= 0 || dot === source.length - 1) {
    throw new Error(`Binding "${expression}" must use artifact.field syntax`)
  }

  return {
    artifact: source.slice(0, dot),
    path: source.slice(dot + 1),
    transforms: parts.map(parseTransform),
  }
}

export function getPathValue(value: unknown, path: string): unknown {
  let current = value

  for (const part of path.split('.').filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)]
      continue
    }
    if (!isRecord(current)) {
      return undefined
    }
    current = current[part]
  }

  return current
}

export function applyTransforms(value: unknown, transforms: BindingTransform[]): unknown {
  return transforms.reduce((current, transform) => {
    if (transform.name === 'json_stringify') {
      return JSON.stringify(current)
    }
    if (transform.name === 'first_n') {
      const count = Number.parseInt(transform.argument ?? '', 10)
      if (!Number.isFinite(count) || count < 0) {
        throw new Error(`Transform "first_n" requires a non-negative integer argument`)
      }
      return Array.isArray(current)
        ? current.slice(0, count)
        : stringifyBindingValue(current).slice(0, count)
    }
    return summarize(current)
  }, value)
}

function parseTransform(value: string): BindingTransform {
  const [name, argument] = value.split(':', 2)
  if (name === 'summary' || name === 'json_stringify') {
    return { name }
  }
  if (name === 'first_n') {
    return { name, argument }
  }
  throw new Error(`Unsupported binding transform "${value}"`)
}

function summarize(value: unknown): string {
  const text = stringifyBindingValue(value).replace(/\s+/g, ' ').trim()
  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}

function stringifyBindingValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value == null) {
    return ''
  }
  return JSON.stringify(value, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
