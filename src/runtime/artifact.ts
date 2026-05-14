import type { Artifact, ArtifactRecord, ArtifactSchemaDecl } from './types'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import fs from 'fs-extra'

export interface ArtifactStoreOptions {
  rootDir: string
  runId: string
  schemas?: Map<string, ArtifactSchemaDecl>
}

export class ArtifactStore {
  private readonly artifactsDir: string
  private readonly schemas: Map<string, ArtifactSchemaDecl>

  constructor(private readonly options: ArtifactStoreOptions) {
    this.artifactsDir = join(options.rootDir, '.ccg', 'runs', options.runId, 'artifacts')
    this.schemas = options.schemas ?? new Map()
  }

  async write<T>(artifact: Artifact<T>): Promise<ArtifactRecord> {
    this.validateArtifact(artifact)

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

    this.validateArtifact(artifact)
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
  const errors: string[] = []
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
  }

  if (type === 'array' && Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((item, index) => {
      errors.push(...validateJsonSchema(item, schema.items as Record<string, unknown>, `${path}[${index}]`))
    })
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
