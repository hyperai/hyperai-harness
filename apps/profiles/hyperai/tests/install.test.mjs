/**
 * Installer planning checks: argument parsing, the dry-run plan, the managed
 * marker, and the refusal to touch a profile this installer did not create.
 * These never run pnpm and never touch the real Harness home.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { install, parseArgs, profileManifest, workspaceFile } from '../scripts/install.mjs'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TUI = resolve(PKG, '..', '..', 'tui')
const brand = JSON.parse(readFileSync(join(TUI, 'src', 'brand.json'), 'utf8'))

function temporaryHome() {
  return mkdtempSync(join(tmpdir(), 'hyperai-tui-test-'))
}

test('parseArgs defaults to the hyperai profile under the Harness home', () => {
  const options = parseArgs(['--dsh-home', '/tmp/example-home'])
  assert.equal(options.profile, brand.profileName)
  assert.equal(options.dshHome, '/tmp/example-home')
  assert.equal(options.profileDir, '/tmp/example-home/profiles/hyperai')
  assert.equal(options.skills, true)
  assert.equal(options.verifiedOnly, false)
})

test('parseArgs rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown argument/u)
})

test('dry run plans every managed file and writes nothing', async () => {
  const home = temporaryHome()
  try {
    const result = await install(parseArgs(['--dsh-home', home, '--no-skills', '--dry-run']))
    assert.deepEqual(
      result.plan.map(step => `${step.action} ${step.file}`),
      [
        'create package.json',
        'create cordis.patch.yml',
        'create pnpm-workspace.yaml',
        'create patches/hyperai-tui.patch',
      ],
    )
    assert.equal(existsSync(join(home, 'profiles', 'hyperai', 'package.json')), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('dry run is idempotent on a managed profile', async () => {
  const home = temporaryHome()
  try {
    const profileDir = join(home, 'profiles', 'hyperai')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(profileManifest(), undefined, 2)}\n`)
    writeFileSync(
      join(profileDir, 'cordis.patch.yml'),
      readFileSync(join(PKG, 'cordis.patch.yml'), 'utf8'),
    )
    writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), workspaceFile())
    const result = await install(parseArgs(['--dsh-home', home, '--no-skills', '--dry-run']))
    assert.deepEqual(
      result.plan.map(step => step.action),
      ['unchanged', 'unchanged', 'unchanged', 'create'],
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a foreign profile is refused without --force', async () => {
  const home = temporaryHome()
  try {
    const profileDir = join(home, 'profiles', 'hyperai')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), '{"name":"someone-elses-profile"}\n')
    await assert.rejects(
      install(parseArgs(['--dsh-home', home, '--no-skills', '--dry-run'])),
      /not created by this installer/u,
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
