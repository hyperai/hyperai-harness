/** Isolated HyperAI dsh home: path selection and the one-time copy migration. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  detectMigration, install, parseArgs, performMigration,
} from '../scripts/install.mjs'

function tempHome() { return mkdtempSync(join(tmpdir(), 'hyperai-isolation-')) }

function treeHash(root) {
  const hash = createHash('sha256')
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      const stat = statSync(path)
      hash.update(`${relative(root, path)}:${stat.isDirectory() ? 'd' : stat.size}\n`)
      if (stat.isDirectory()) walk(path)
      else hash.update(readFileSync(path))
    }
  }
  walk(root)
  return hash.digest('hex')
}

function managedProfile(dir, version = '0.2.0-beta.6') {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    hyperaiTuiManaged: true,
    hyperaiTui: { version },
  }, undefined, 2)}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), '# profile config\n')
}

test('the default home is ~/.hyperai/dsh and ignores DSH_HOME', () => {
  const saved = { DSH_HOME: process.env.DSH_HOME, HYPERAI_DSH_HOME: process.env.HYPERAI_DSH_HOME }
  try {
    process.env.DSH_HOME = '/tmp/other-dsh'
    delete process.env.HYPERAI_DSH_HOME
    assert.equal(parseArgs(['--dry-run']).dshHome, join(homedir(), '.hyperai', 'dsh'))
    process.env.HYPERAI_DSH_HOME = '/tmp/hyperai-dsh'
    assert.equal(parseArgs(['--dry-run']).dshHome, '/tmp/hyperai-dsh')
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('migration is offered only for a managed profile and only once', () => {
  const home = tempHome()
  try {
    const env = { HOME: home }
    const dshHome = join(home, '.hyperai', 'dsh')
    managedProfile(join(home, '.dsh', 'profiles', 'hyperai'))
    const options = { HOME: home, dshHome, profile: 'hyperai' }
    assert.equal(detectMigration(options, env).kind, 'migrate')
    mkdirSync(join(dshHome, 'profiles', 'hyperai'), { recursive: true })
    assert.equal(detectMigration(options, env), undefined)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('migration copies profile and credentials, skips sessions/patch/shared tree, leaves ~/.dsh unchanged', () => {
  const home = tempHome()
  try {
    const old = join(home, '.dsh')
    const profile = join(old, 'profiles', 'hyperai')
    managedProfile(profile)
    mkdirSync(join(profile, 'skills', 'demo'), { recursive: true })
    writeFileSync(join(profile, 'skills', 'demo', 'SKILL.md'), '# demo\n')
    mkdirSync(join(profile, 'node_modules', 'ignored'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', 'ignored', 'x.js'), 'x\n')
    writeFileSync(join(old, '.credentials.yaml'), 'key: sk-test\n')
    mkdirSync(join(old, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    writeFileSync(join(old, 'storages', 'session_projcache', 'sessions', 's.json'), '{}\n')
    writeFileSync(join(old, 'cordis.patch.yml'), '- insert: []\n')
    mkdirSync(join(old, 'node_modules', '@deepseek-ai', 'legacy'), { recursive: true })
    writeFileSync(join(old, 'node_modules', '@deepseek-ai', 'legacy', 'package.json'), '{}\n')
    const before = treeHash(old)

    const dshHome = join(home, '.hyperai', 'dsh')
    const options = { dshHome, profile: 'hyperai', home }
    const migration = detectMigration(options, { HOME: home })
    const result = performMigration(options, migration)
    assert.equal(result.sessionsCopied, false)
    assert.equal(existsSync(join(dshHome, 'profiles', 'hyperai', 'skills', 'demo', 'SKILL.md')), true)
    assert.equal(existsSync(join(dshHome, 'profiles', 'hyperai', 'node_modules')), false)
    assert.equal(existsSync(join(dshHome, 'storages')), false)
    assert.equal(existsSync(join(dshHome, 'cordis.patch.yml')), false)
    assert.equal(existsSync(join(dshHome, 'node_modules')), false)
    const credentials = join(dshHome, '.credentials.yaml')
    assert.equal(readFileSync(credentials, 'utf8'), 'key: sk-test\n')
    assert.equal(statSync(credentials).mode & 0o777, 0o600)
    const record = JSON.parse(readFileSync(join(dshHome, '.hyperai-migration.json'), 'utf8'))
    assert.deepEqual(record.copied, ['profile', 'credentials'])
    assert.deepEqual(record.notCopied, ['sessions', 'storages', 'cordis.patch.yml', 'shared node_modules'])
    assert.equal(treeHash(old), before)
    assert.equal(detectMigration(options, { HOME: home }), undefined)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a failed migration rolls back the new home and keeps ~/.dsh intact', () => {
  const home = tempHome()
  try {
    const profile = join(home, '.dsh', 'profiles', 'hyperai')
    managedProfile(profile)
    const before = treeHash(join(home, '.dsh'))
    const blocker = join(home, 'blocker')
    writeFileSync(blocker, 'not a directory\n')
    const options = { dshHome: join(blocker, 'dsh'), profile: 'hyperai' }
    const migration = detectMigration(options, { HOME: home })
    assert.throws(() => performMigration(options, migration), /迁移失败/)
    assert.equal(treeHash(join(home, '.dsh')), before)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('dry-run reports the migration without writing anything', async () => {
  const home = tempHome()
  try {
    const profile = join(home, '.dsh', 'profiles', 'hyperai')
    managedProfile(profile)
    const before = treeHash(join(home, '.dsh'))
    const dshHome = join(home, '.hyperai', 'dsh')
    const options = parseArgs(['--dsh-home', dshHome, '--dry-run'])
    options.migrate = true
    options.preflight = false
    options.skills = false
    options.openbayes = false
    options.home = home
    const result = await install(options)
    assert.equal(result.migration.from, profile)
    assert.equal(result.migration.sessionsCopied, false)
    assert.equal(existsSync(dshHome), false)
    assert.equal(treeHash(join(home, '.dsh')), before)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
