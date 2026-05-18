import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function findPackageRoot(): string {
  let dir = import.meta.dirname
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir
    }
    dir = join(dir, '..')
  }
  throw new Error('Could not find package root')
}

export function buildLocalCodeagentWrapper(): { binaryPath: string, cleanup: () => void } {
  const packageRoot = findPackageRoot()
  const buildDir = join(tmpdir(), `ccg-test-wrapper-${process.pid}-${Date.now()}`)
  mkdirSync(buildDir, { recursive: true })

  const binaryName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const binaryPath = join(buildDir, binaryName)
  execFileSync('go', ['build', '-o', binaryPath, '.'], {
    cwd: join(packageRoot, 'codeagent-wrapper'),
    stdio: 'pipe',
  })

  const previous = process.env.CCG_WORKFLOW_LOCAL_BINARY
  process.env.CCG_WORKFLOW_LOCAL_BINARY = binaryPath

  return {
    binaryPath,
    cleanup: () => {
      if (previous === undefined) {
        delete process.env.CCG_WORKFLOW_LOCAL_BINARY
      }
      else {
        process.env.CCG_WORKFLOW_LOCAL_BINARY = previous
      }
      rmSync(buildDir, { recursive: true, force: true })
    },
  }
}
