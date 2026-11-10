/**
 * Every CLI script must run its main flow when reached through a symlink.
 *
 * macOS `/tmp` is a symlink to `/private/tmp`; Node resolves the module URL to
 * the real path while `process.argv[1]` keeps the logical one. A plain string
 * comparison silently skipped `main()` and exited 0 — this is the beta.1 bug
 * that made `install.sh` print “安装完成” without installing anything.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Scripts with a `invokedDirectly()` entry guard, and the text proving main ran. */
const SCRIPTS = [
  { file: 'install.mjs', marker: 'usage: node scripts/install.mjs' },
  { file: 'install-skills.mjs', marker: 'usage: node scripts/install-skills.mjs' },
  { file: 'manage.mjs', marker: 'usage: node scripts/manage.mjs' },
  { file: 'build-beta.mjs', marker: 'usage: node scripts/build-beta.mjs' },
]

for (const { file, marker } of SCRIPTS) {
  test(`main flow runs when ${file} is reached through a symlink`, () => {
    const root = mkdtempSync(join(tmpdir(), 'hyperai-entrypoint-'))
    try {
      const linkDir = join(root, 'linked')
      mkdirSync(linkDir)
      const link = join(linkDir, file)
      symlinkSync(join(PKG, 'scripts', file), link)
      const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8', timeout: 60_000 })
      assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`)
      assert.match(`${result.stdout}${result.stderr}`, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
      // The regression exited 0 with no output at all.
      assert.ok(`${result.stdout}${result.stderr}`.trim().length > 0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
