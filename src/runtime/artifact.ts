import type { Artifact, ArtifactRecord, ArtifactSchemaDecl } from './types'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import fs from 'fs-extra'

export interface ArtifactStoreOptions {
  rootDir: string
  runId: string
  schemas?: Map<string, ArtifactSchemaDecl>
}

export interface ArtifactWriteOptions {
  validate?: boolean
}

export class ArtifactStore {
  private readonly artifactsDir: string
  private readonly schemas: Map<string, ArtifactSchemaDecl>

  constructor(private readonly options: ArtifactStoreOptions) {
    this.artifactsDir = join(options.rootDir, '.ccg', 'runs', options.runId, 'artifacts')
    this.schemas = options.schemas ?? new Map()
  }

  async write<T>(artifact: Artifact<T>, options: ArtifactWriteOptions = {}): Promise<ArtifactRecord> {
    if (options.validate !== false) {
      this.validateArtifact(artifact)
    }

    await fs.ensureDir(this.artifactsDir)
    const path = join(this.artifactsDir, `${artifact.type}.json`)
    const content = `${JSON.stringify(artifact, null, 2)}\n`
    await fs.writeFile(path, content, 'utf8')

    return {
      type: artifact.type,
      version: artifact.version,
      step_id: artifact.step_id,
      created_at: artifact.created_at,
      path,
      checksum: checksum(content),
    }
  }

  async read<T = unknown>(type: string, version?: number): Promise<Artifact<T>> {
    const path = join(this.artifactsDir, `${type}.json`)
    const artifact = await fs.readJson(path) as Artifact<T>

    if (version !== undefined && artifact.version !== version) {
      throw new Error(`Artifact "${type}" version mismatch: expected ${version}, got ${artifact.version}`)
    }

    if (!isRawFallbackArtifact(artifact)) {
      this.validateArtifact(artifact)
    }
    return artifact
  }

  async exists(type: string): Promise<boolean> {
    return fs.pathExists(join(this.artifactsDir, `${type}.json`))
  }

  private validateArtifact(artifact: Artifact): void {
    const schema = this.schemas.get(`${artifact.type}@${artifact.version}`)
    if (!schema) {
      return
    }

    const errors = validateJsonSchema(artifact.data, schema.schema)
    if (errors.length > 0) {
      throw new Error(`Artifact "${artifact.type}@${artifact.version}" failed schema validation:\n${errors.join('\n')}`)
    }
  }
}

export function createArtifact<T>(params: {
  type: string
  version: number
  stepId: string
  data: T
  createdAt?: string
}): Artifact<T> {
  return {
    type: params.type,
    version: params.version,
    step_id: params.stepId,
    created_at: params.createdAt ?? new Date().toISOString(),
    data: params.data,
  }
}

export function validateJsonSchema(value: unknown, schema: Record<string, unknown>, path = '$'): string[] {
  if (path === '$') {
    const ajvErrors = validateJsonSchemaWithAjv(value, schema)
    if (ajvErrors != null) {
      return ajvErrors
    }
  }

  const errors: string[] = []

  if (Array.isArray(schema.allOf)) {
    for (const childSchema of schema.allOf) {
      if (isRecord(childSchema)) {
        errors.push(...validateJsonSchema(value, childSchema, path))
      }
    }
  }

  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(childSchema =>
    isRecord(childSchema) && validateJsonSchema(value, childSchema, path).length === 0
  )) {
    errors.push(`${path} must match at least one anyOf schema`)
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(childSchema =>
      isRecord(childSchema) && validateJsonSchema(value, childSchema, path).length === 0
    ).length
    if (matches !== 1) {
      errors.push(`${path} must match exactly one oneOf schema`)
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some(item => deepEqual(item, value))) {
    errors.push(`${path} must be one of ${schema.enum.map(item => JSON.stringify(item)).join(', ')}`)
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !deepEqual(schema.const, value)) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`)
  }

  const type = schema.type

  if (typeof type === 'string' && !matchesJsonType(value, type)) {
    errors.push(`${path} must be ${type}`)
    return errors
  }

  if (type === 'object') {
    if (!isRecord(value)) {
      return errors
    }

    const required = Array.isArray(schema.required) ? schema.required : []
    for (const field of required) {
      if (typeof field === 'string' && value[field] === undefined) {
        errors.push(`${path}.${field} is required`)
      }
    }

    const properties = isRecord(schema.properties) ? schema.properties : {}
    for (const [field, childSchema] of Object.entries(properties)) {
      if (value[field] !== undefined && isRecord(childSchema)) {
        errors.push(...validateJsonSchema(value[field], childSchema, `${path}.${field}`))
      }
    }

    if (Number.isInteger(schema.minProperties) && Object.keys(value).length < Number(schema.minProperties)) {
      errors.push(`${path} must have at least ${schema.minProperties} properties`)
    }
    if (Number.isInteger(schema.maxProperties) && Object.keys(value).length > Number(schema.maxProperties)) {
      errors.push(`${path} must have at most ${schema.maxProperties} properties`)
    }
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, field)) {
          errors.push(`${path}.${field} is not allowed`)
        }
      }
    }
  }

  if (type === 'array' && Array.isArray(value) && isRecord(schema.items)) {
    if (Number.isInteger(schema.minItems) && value.length < Number(schema.minItems)) {
      errors.push(`${path} must have at least ${schema.minItems} items`)
    }
    if (Number.isInteger(schema.maxItems) && value.length > Number(schema.maxItems)) {
      errors.push(`${path} must have at most ${schema.maxItems} items`)
    }
    value.forEach((item, index) => {
      errors.push(...validateJsonSchema(item, schema.items as Record<string, unknown>, `${path}[${index}]`))
    })
  }

  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < Number(schema.minLength)) {
      errors.push(`${path} must have at least ${schema.minLength} characters`)
    }
    if (Number.isInteger(schema.maxLength) && value.length > Number(schema.maxLength)) {
      errors.push(`${path} must have at most ${schema.maxLength} characters`)
    }
    if (typeof schema.pattern === 'string' && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`${path} must match pattern ${schema.pattern}`)
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`)
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      errors.push(`${path} must be > ${schema.exclusiveMinimum}`)
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      errors.push(`${path} must be < ${schema.exclusiveMaximum}`)
    }
  }

  return errors
}

function checksum(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function matchesJsonType(value: unknown, type: string): boolean {
  if (type === 'array') {
    return Array.isArray(value)
  }
  if (type === 'object') {
    return isRecord(value)
  }
  if (type === 'integer') {
    return Number.isInteger(value)
  }
  return typeof value === type
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRawFallbackArtifact(artifact: Artifact): boolean {
  return isRecord(artifact.data) && isRecord(artifact.data.raw_text)
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateJsonSchemaWithAjv(value: unknown, schema: Record<string, unknown>): string[] | undefined {
  try {
    const require = createRequire(import.meta.url)
    const Ajv = require('ajv')
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(schema)
    if (validate(value)) {
      return []
    }
    return (validate.errors ?? []).map((error: { instancePath?: string, dataPath?: string, message?: string }) => {
      const location = error.instancePath || error.dataPath || '$'
      return `${location === '' ? '$' : location} ${error.message ?? 'failed schema validation'}`
    })
  }
  catch {
    return undefined
  }
}
