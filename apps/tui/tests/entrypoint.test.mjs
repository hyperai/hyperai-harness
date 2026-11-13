/**
 * The TUI build scripts must run their main flow when reached through a symlink.
 *
 * Same defect class as the profile installer (RFC-003): Node resolves the module
 * URL through symlinks while `process.argv[1]` keeps the logical path.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SCRIPTS = [
  { file: 'build-patch.mjs', marker: 'usage: node scripts/build-patch.mjs' },
  { file: 'build-package.mjs', marker: 'usage: node scripts/build-package.mjs' },
]

for (const { file, marker } of SCRIPTS) {
  test(`main flow runs when ${file} is reached through a symlink`, () => {
    const root = mkdtempSync(join(tmpdir(), 'hyperai-tui-entrypoint-'))
    try {
      const linkDir = join(root, 'linked')
      mkdirSync(linkDir)
      const link = join(linkDir, file)
      symlinkSync(join(PKG, 'scripts', file), link)
      const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8', timeout: 60_000 })
      assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`)
      assert.match(`${result.stdout}${result.stderr}`, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
      assert.ok(`${result.stdout}${result.stderr}`.trim().length > 0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
