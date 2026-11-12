import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { detectMigration, parseArgs, performMigration } from '../scripts/install.mjs'

function home() { return mkdtempSync(join(tmpdir(), 'hyperai-iso-')) }
function profile(dir, version = '0.2.0-beta.2') {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ hyperaiTuiManaged: true, hyperaiTui: { version } }, undefined, 2)}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), '# hyperai profile patch layer\n\n- id: x\n  disabled: true\n')
}
function hashTree(root) {
  const hash = createHash('sha256')
  const walk = dir => { for (const name of readdirSync(dir).sort()) { const p = join(dir, name); const st = statSync(p); hash.update(`${relative(root, p)}:${st.isDirectory() ? 'd' : st.size}\n`); st.isDirectory() ? walk(p) : hash.update(readFileSync(p)) } }
  walk(root); return hash.digest('hex')
}

test('defaults ignore DSH_HOME and follow HYPERAI_HOME', () => {
  const saved = { DSH_HOME: process.env.DSH_HOME, HYPERAI_HOME: process.env.HYPERAI_HOME, HYPERAI_DSH_HOME: process.env.HYPERAI_DSH_HOME }
  try {
    process.env.DSH_HOME = '/tmp/dsh-other'; delete process.env.HYPERAI_HOME; delete process.env.HYPERAI_DSH_HOME
    assert.equal(parseArgs(['--dry-run']).dshHome, join(homedir(), '.hyperai', 'dsh'))
    process.env.HYPERAI_HOME = '/tmp/hyperai-home'; assert.equal(parseArgs(['--dry-run']).dshHome, '/tmp/hyperai-home/dsh')
    process.env.HYPERAI_DSH_HOME = '/tmp/hyperai-dsh'; assert.equal(parseArgs(['--dry-run']).dshHome, '/tmp/hyperai-dsh')
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v
  }
})

test('migration copies profile, credentials and TUI state but never sessions', () => {
  const h = home()
  try {
    const old = join(h, '.dsh'); const p = join(old, 'profiles', 'hyperai'); profile(p)
    mkdirSync(join(p, 'skills', 'demo'), { recursive: true }); writeFileSync(join(p, 'skills', 'demo', 'SKILL.md'), '# demo\n')
    mkdirSync(join(p, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(old, '.credentials.yaml'), 'k: v\n')
    mkdirSync(join(old, 'storages', 's'), { recursive: true }); writeFileSync(join(old, 'storages', 's', 'a.json'), '{}\n')
    const tui = join(h, '.dsh-tui-hyperai'); mkdirSync(tui); writeFileSync(join(tui, 'settings.json'), '{}\n')
    const before = hashTree(old)
    const dshHome = join(h, '.hyperai', 'dsh')
    const options = { HOME: h, home: h, dshHome, profile: 'hyperai', migrate: true }
    const migration = detectMigration(options, { HOME: h })
    assert.equal(migration.kind, 'migrate')
    const result = performMigration(options, migration)
    assert.equal(result.sessionsCopied, false)
    assert.equal(existsSync(join(dshHome, 'profiles', 'hyperai', 'skills', 'demo', 'SKILL.md')), true)
    assert.equal(existsSync(join(dshHome, 'profiles', 'hyperai', 'node_modules')), false)
    assert.equal(existsSync(join(dshHome, 'storages')), false)
    assert.equal(existsSync(join(h, '.hyperai', 'tui', 'settings.json')), true)
    assert.equal(statSync(join(dshHome, '.credentials.yaml')).mode & 0o777, 0o600)
    assert.equal(hashTree(old), before)
    assert.equal(detectMigration(options, { HOME: h }), undefined)
  } finally { rmSync(h, { recursive: true, force: true }) }
})

test('failed migration rolls back and keeps the old home intact', () => {
  const h = home()
  try {
    const old = join(h, '.dsh'); profile(join(old, 'profiles', 'hyperai'))
    const before = hashTree(old)
    const blocker = join(h, 'blocker'); writeFileSync(blocker, 'x')
    const options = { HOME: h, home: h, dshHome: join(blocker, 'dsh'), profile: 'hyperai', migrate: true }
    assert.throws(() => performMigration(options, detectMigration(options, { HOME: h })), /迁移失败/)
    assert.equal(hashTree(old), before)
  } finally { rmSync(h, { recursive: true, force: true }) }
})

test('foreign ~/.dsh profile is reported and left untouched', async () => {
  const h = home()
  try {
    mkdirSync(join(h, '.dsh', 'profiles', 'hyperai'), { recursive: true })
    writeFileSync(join(h, '.dsh', 'profiles', 'hyperai', 'package.json'), '{"name":"foreign"}\n')
    const before = hashTree(join(h, '.dsh'))
    const { install } = await import('../scripts/install.mjs')
    const result = await install({
      home: h, dshHome: join(h, '.hyperai', 'dsh'), profileDir: join(h, '.hyperai', 'dsh', 'profiles', 'hyperai'), profile: 'hyperai', dryRun: true,
      preflight: false, skills: false, verifiedOnly: false, migrate: true, dshBin: 'dsh', pnpmBin: 'pnpm', force: false, frozenLockfile: false,
    })
    assert.equal(result.foreignProfile, join(h, '.dsh', 'profiles', 'hyperai'))
    assert.match(result.warnings.map(w => w.message).join('\n'), /不是本安装器创建的 hyperai profile/u)
    assert.equal(hashTree(join(h, '.dsh')), before)
  } finally { rmSync(h, { recursive: true, force: true }) }
})
