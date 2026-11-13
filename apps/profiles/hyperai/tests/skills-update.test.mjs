/**
 * Skills updater tests. All repositories and Harness homes are temporary:
 * no network, no real profile, no user credentials.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(PKG, 'scripts', 'skills-update.mjs')
const LIB = join(PKG, 'scripts', 'skills-lib.mjs')
const DSH_MODULES = join(homedir(), '.local', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules')

function tempDir(prefix = 'hyperai-skills-update-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function skillFiles(version = '1.0.0', extraDescription = '') {
  return `---\nname: __NAME__\ndescription: Use when testing __NAME__ ${extraDescription}\nversion: ${version}\n---\n\n# __NAME__\n`
}

function writeSkill(repo, relative, name, version = '1.0.0', resources = {}) {
  const dir = join(repo, relative)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), skillFiles(version).replaceAll('__NAME__', name))
  for (const [file, content] of Object.entries(resources)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), content)
  }
  return dir
}

function initRepo() {
  const repo = tempDir('hyperai-skills-repo-')
  git(repo, 'init', '-q', '-b', 'master')
  git(repo, 'config', 'user.email', 'test@example.invalid')
  git(repo, 'config', 'user.name', 'Test')
  return repo
}

function commit(repo, message) {
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', message)
  return git(repo, 'rev-parse', 'HEAD')
}

/** A home with an installed profile skills root and an optional manifest. */
function createHome() {
  const root = tempDir('hyperai-skills-home-')
  const profileDir = join(root, 'profiles', 'hyperai')
  const skillsDir = join(profileDir, 'skills')
  const stateDir = join(profileDir, '.hyperai-skills')
  mkdirSync(skillsDir, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  return { root, profileDir, skillsDir, stateDir }
}

/** Install one local skill dir (used to seed legacy installs/user skills). */
function installLocal(home, remoteDir, name) {
  cpSync(remoteDir, join(home.skillsDir, name), { recursive: true })
}

/** Write a schema-1 manifest the way install-skills.mjs did. */
async function writeLegacyManifest(home, rows) {
  const { scanPackageFiles } = await import(LIB)
  const skills = {}
  for (const row of rows) {
    const dir = join(home.skillsDir, row.name)
    skills[row.name] = {
      ref: 'a'.repeat(40),
      validated: row.validated,
      description: `Use when testing ${row.name}`,
      files: scanPackageFiles(dir),
      installedAt: new Date().toISOString(),
    }
  }
  const manifest = {
    schema: 1,
    repository: 'https://example.invalid/repo.git',
    ref: 'a'.repeat(40),
    verified: rows.filter(row => row.validated).map(row => ({ name: row.name, area: 'skills', validated: true })),
    unverified: rows.filter(row => !row.validated).map(row => ({ name: row.name, area: 'inbox', validated: false })),
    skills,
  }
  writeFileSync(join(home.stateDir, 'manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  return manifest
}

function run(home, args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, HYPERAI_DSH_HOME: home.root, ...env },
  })
}

/** A standard master fixture: example + nested productivity/excel. */
function standardRepo() {
  const repo = initRepo()
  writeSkill(repo, 'skills/example', 'example', '1.0.0', { 'scripts/run.py': 'print(1)\n' })
  writeSkill(repo, 'skills/productivity/excel', 'excel', '2.0.0', { 'references/notes.md': 'notes\n' })
  commit(repo, 'master skills')
  return repo
}

function addPptBranch(repo) {
  git(repo, 'checkout', '-q', '-b', 'feat/ppt')
  writeSkill(repo, 'skills/ppt-generation', 'ppt-generation', '1.1.0', {
    'scripts/render.py': 'print("deck")\n',
    'templates/layouts.json': '{}\n',
    'examples/deck.json': '{}\n',
  })
  const sha = commit(repo, 'ppt')
  git(repo, 'checkout', '-q', 'master')
  return sha
}

function catalogTree(skillsDir) {
  return readdirSync(skillsDir).filter(name => existsSync(join(skillsDir, name, 'SKILL.md'))).sort()
}

test('check scans master, supports nested skills, and is read-only', async () => {
  const repo = standardRepo()
  const home = createHome()
  const remoteExample = join(repo, 'skills', 'example')
  installLocal(home, remoteExample, 'example')
  mkdirSync(join(home.skillsDir, 'mineru-ocr'))
  writeFileSync(join(home.skillsDir, 'mineru-ocr', 'SKILL.md'), skillFiles('1.0.0').replaceAll('__NAME__', 'mineru-ocr'))
  mkdirSync(join(home.skillsDir, 'user-own'))
  writeFileSync(join(home.skillsDir, 'user-own', 'SKILL.md'), skillFiles('1.0.0').replaceAll('__NAME__', 'user-own'))
  await writeLegacyManifest(home, [{ name: 'example', validated: true }, { name: 'mineru-ocr', validated: false }])
  const before = catalogTree(home.skillsDir)
  const result = run(home, ['check', '--source', repo])
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stdout, /\+ add\s+excel/u)
  assert.match(result.stdout, /=\sunchanged\s+example/u)
  assert.match(result.stdout, /-\skeep\s+mineru-ocr\s+legacy-unverified/u)
  assert.match(result.stdout, /·\s*local\s+user-own/u)
  assert.deepEqual(catalogTree(home.skillsDir), before, 'check must not install anything')
  assert.equal(existsSync(join(home.stateDir, 'manifest.json')) && JSON.parse(readFileSync(join(home.stateDir, 'manifest.json'), 'utf8')).schema, 1)
})

test('dev branch check resolves its ref to a SHA, marks it prerelease, and finds new skills', () => {
  const repo = standardRepo()
  const pptSha = addPptBranch(repo)
  const home = createHome()
  const master = run(home, ['check', '--source', repo])
  assert.doesNotMatch(master.stdout, /ppt-generation/u)
  const dev = run(home, ['check', '--source', repo, '--ref', 'feat/ppt'])
  assert.equal(dev.status, 2, dev.stderr)
  assert.ok(dev.stdout.includes(pptSha), 'resolved SHA is printed')
  assert.match(dev.stdout, /prerelease\/test/u)
  assert.match(dev.stdout, /\+ add\s+ppt-generation/u)
  assert.doesNotMatch(dev.stdout, /no updates/u)
})

test('update installs new skills flattened, records additive manifest fields, and is idempotent', async () => {
  const repo = standardRepo()
  addPptBranch(repo)
  const home = createHome()
  const result = run(home, ['update', '--source', repo, '--ref', 'feat/ppt', '--yes'])
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.deepEqual(catalogTree(home.skillsDir), ['example', 'excel', 'ppt-generation'])
  assert.ok(existsSync(join(home.skillsDir, 'excel', 'references', 'notes.md')))
  assert.ok(existsSync(join(home.skillsDir, 'ppt-generation', 'scripts', 'render.py')))
  assert.ok(existsSync(join(home.skillsDir, 'ppt-generation', 'templates', 'layouts.json')))
  assert.equal(existsSync(join(home.skillsDir, 'productivity')), false, 'nested categories are flattened')
  const manifest = JSON.parse(readFileSync(join(home.stateDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.schema, 1)
  assert.equal(manifest.skills['ppt-generation'].managedBy, 'skills-updater')
  assert.equal(manifest.skills['ppt-generation'].sourcePath, 'ppt-generation')
  assert.equal(manifest.skills.excel.sourcePath, 'productivity/excel')
  const again = run(home, ['check', '--source', repo, '--ref', 'feat/ppt'])
  assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`)
  assert.match(again.stdout, /=\sunchanged\s+ppt-generation/u)
  const noop = run(home, ['update', '--source', repo, '--ref', 'feat/ppt', '--yes'])
  assert.equal(noop.status, 0, noop.stderr)
  assert.match(noop.stdout, /already up to date/u)
})

test('--dry-run writes nothing and --skill limits one update', () => {
  const repo = standardRepo()
  const home = createHome()
  const dry = run(home, ['update', '--source', repo, '--dry-run'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /dry run: no files written/u)
  assert.deepEqual(catalogTree(home.skillsDir), [])
  assert.equal(existsSync(join(home.stateDir, 'manifest.json')), false)
  const one = run(home, ['update', '--source', repo, '--skill', 'example', '--yes'])
  assert.equal(one.status, 0, one.stderr)
  assert.deepEqual(catalogTree(home.skillsDir), ['example'])
  const manifest = JSON.parse(readFileSync(join(home.stateDir, 'manifest.json'), 'utf8'))
  assert.deepEqual(Object.keys(manifest.skills), ['example'])
})

test('local modifications are skipped and never overwritten', async () => {
  const repo = standardRepo()
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  const target = join(home.skillsDir, 'excel', 'SKILL.md')
  writeFileSync(target, `${readFileSync(target, 'utf8')}\n<!-- user edit -->\n`)
  writeSkill(repo, 'skills/productivity/excel', 'excel', '2.1.0')
  commit(repo, 'excel 2.1')
  const check = run(home, ['check', '--source', repo])
  assert.equal(check.status, 0, check.stderr)
  assert.match(check.stdout, /local-modified/u)
  const update = run(home, ['update', '--source', repo, '--yes'])
  assert.equal(update.status, 0, update.stderr)
  assert.match(update.stdout, /nothing installable|local-modified/u)
  assert.match(readFileSync(target, 'utf8'), /user edit/u)
})

test('user-installed skills and extra files are preserved', async () => {
  const repo = standardRepo()
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  // User files inside a managed skill survive an update.
  writeFileSync(join(home.skillsDir, 'excel', 'NOTES.md'), 'user notes\n')
  mkdirSync(join(home.skillsDir, 'excel', 'custom'))
  writeFileSync(join(home.skillsDir, 'excel', 'custom', 'data.txt'), 'user data\n')
  writeSkill(repo, 'skills/productivity/excel', 'excel', '2.1.0')
  commit(repo, 'excel 2.1')
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  assert.equal(readFileSync(join(home.skillsDir, 'excel', 'NOTES.md'), 'utf8'), 'user notes\n')
  assert.equal(readFileSync(join(home.skillsDir, 'excel', 'custom', 'data.txt'), 'utf8'), 'user data\n')
  assert.match(readFileSync(join(home.skillsDir, 'excel', 'SKILL.md'), 'utf8'), /2\.1\.0/u)
  // A same-name user skill is never overwritten by a remote addition.
  mkdirSync(join(home.skillsDir, 'user-own'))
  writeFileSync(join(home.skillsDir, 'user-own', 'SKILL.md'), skillFiles('9.9.9').replaceAll('__NAME__', 'user-own'))
  writeSkill(repo, 'skills/user-own', 'user-own', '1.0.0')
  commit(repo, 'remote user-own')
  const check = run(home, ['check', '--source', repo])
  assert.match(check.stdout, /local-same-name/u)
  const update = run(home, ['update', '--source', repo, '--yes'])
  assert.equal(update.status, 0, update.stderr)
  assert.match(readFileSync(join(home.skillsDir, 'user-own', 'SKILL.md'), 'utf8'), /9\.9\.9/u)
})

test('extra user files inside resource dirs are preserved, and colliding extras are a conflict', async () => {
  const repo = standardRepo()
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  // A user file inside a package resource dir that the manifest does not own.
  writeFileSync(join(home.skillsDir, 'excel', 'references', 'user-notes.md'), 'my notes\n')
  writeSkill(repo, 'skills/productivity/excel', 'excel', '2.1.0', { 'references/notes.md': 'notes v2\n' })
  commit(repo, 'excel 2.1')
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  assert.equal(readFileSync(join(home.skillsDir, 'excel', 'references', 'user-notes.md'), 'utf8'), 'my notes\n')
  assert.equal(readFileSync(join(home.skillsDir, 'excel', 'references', 'notes.md'), 'utf8'), 'notes v2\n')
  // A user file that would collide with a new package file is a conflict, not an overwrite.
  mkdirSync(join(home.skillsDir, 'excel', 'scripts'), { recursive: true })
  writeFileSync(join(home.skillsDir, 'excel', 'scripts', 'new.py'), 'user script\n')
  writeSkill(repo, 'skills/productivity/excel', 'excel', '2.2.0', { 'references/notes.md': 'notes v3\n', 'scripts/new.py': 'remote script\n' })
  commit(repo, 'excel 2.2')
  const check = run(home, ['check', '--source', repo])
  assert.match(check.stdout, /extra-file-conflict/u)
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  assert.equal(readFileSync(join(home.skillsDir, 'excel', 'scripts', 'new.py'), 'utf8'), 'user script\n')
})


test('the legacy installer still reads the updater manifest', async () => {
  const repo = standardRepo()
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  const sha = git(repo, 'rev-parse', 'HEAD')
  const lockPath = join(tempDir('hyperai-skills-lock-'), 'lock.json')
  writeFileSync(lockPath, JSON.stringify({
    schema: 1,
    repository: repo,
    ref: sha,
    verified: [{ name: 'example', area: 'skills', validated: true }],
    unverified: [],
  }))
  const legacy = spawnSync(process.execPath, [
    join(PKG, 'scripts', 'install-skills.mjs'),
    '--dsh-home', home.root, '--source', repo, '--ref', sha, '--lock', lockPath, '--dry-run', '--json',
  ], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, HYPERAI_DSH_HOME: home.root } })
  assert.equal(legacy.status, 0, legacy.stderr)
  const result = JSON.parse(legacy.stdout)
  assert.deepEqual(result.unchanged, ['example'])
})

test('a skill with a missing referenced resource is rejected before writing', () => {
  const repo = initRepo()
  writeSkill(repo, 'skills/broken', 'broken', '1.0.0')
  const skillFile = join(repo, 'skills', 'broken', 'SKILL.md')
  writeFileSync(skillFile, `${readFileSync(skillFile, 'utf8')}\nSee \`scripts/missing.py\`.\n`)
  commit(repo, 'broken')
  const home = createHome()
  const result = run(home, ['check', '--source', repo])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /references missing resource/u)
  assert.deepEqual(catalogTree(home.skillsDir), [])
})

test('a rejected remote update leaves the installed version untouched', async () => {
  const repo = standardRepo()
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  const before = readFileSync(join(home.skillsDir, 'example', 'SKILL.md'), 'utf8')
  const skillFile = join(repo, 'skills', 'example', 'SKILL.md')
  writeFileSync(skillFile, `${readFileSync(skillFile, 'utf8')}\nSee \`scripts/missing.py\`.\n`)
  commit(repo, 'broken update')
  const check = run(home, ['check', '--source', repo])
  assert.equal(check.status, 1)
  assert.equal(readFileSync(join(home.skillsDir, 'example', 'SKILL.md'), 'utf8'), before)
})

test('installing a checked SHA never picks up a later branch commit', () => {
  const repo = standardRepo()
  const home = createHome()
  const checked = run(home, ['check', '--manual', '--json', '--source', repo])
  assert.equal(checked.status, 2, checked.stderr)
  const sha = JSON.parse(checked.stdout).source.resolvedRef
  writeSkill(repo, 'skills/example', 'example', '9.9.9')
  commit(repo, 'branch moved')
  const installed = run(home, ['update', '--yes', '--ref', sha, '--source', repo])
  assert.equal(installed.status, 0, installed.stderr)
  assert.match(readFileSync(join(home.skillsDir, 'example', 'SKILL.md'), 'utf8'), /1\.0\.0/u)
  assert.doesNotMatch(readFileSync(join(home.skillsDir, 'example', 'SKILL.md'), 'utf8'), /9\.9\.9/u)
  const manifest = JSON.parse(readFileSync(join(home.stateDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.skills.example.source.resolvedRef, sha)
})

test('auto interval, manual bypass and dismissal state are TUI-compatible', () => {
  const repo = standardRepo()
  const home = createHome()
  const first = run(home, ['check', '--auto', '--json', '--source', repo])
  assert.equal(first.status, 2, first.stderr)
  const firstPayload = JSON.parse(first.stdout)
  assert.equal(firstPayload.changes, true)
  assert.equal(firstPayload.count, 2)
  assert.deepEqual(firstPayload.updates.map(item => [item.name, item.action]), [['example', 'add'], ['excel', 'add']])
  assert.ok(firstPayload.source.resolvedRef.length === 40)
  const statePath = join(home.stateDir, 'tui-state.json')
  assert.ok(existsSync(statePath))
  assert.ok(JSON.parse(readFileSync(statePath, 'utf8')).lastAutoCheckAt)

  // Within the interval, no repository access may happen: point at a missing repo.
  const second = run(home, ['check', '--auto', '--json', '--repo', '/tmp/definitely-missing-skills-repo'])
  assert.equal(second.status, 0, second.stderr)
  const secondPayload = JSON.parse(second.stdout)
  assert.equal(secondPayload.skipped, true)
  assert.equal(secondPayload.skippedReason, 'auto-interval')

  // Manual checks bypass the interval and use the local fixture.
  const manual = run(home, ['check', '--manual', '--json', '--source', repo])
  assert.equal(manual.status, 2, manual.stderr)
  assert.equal(JSON.parse(manual.stdout).changes, true)

  // Dismiss exactly the shown batch, then the next due auto check suppresses it.
  const sha = firstPayload.source.resolvedRef
  const names = firstPayload.updates.map(item => item.name)
  const dismiss = run(home, ['dismiss', '--json', '--ref', sha, ...names.flatMap(name => ['--skill', name])])
  assert.equal(dismiss.status, 0, dismiss.stderr)
  const afterDismiss = run(home, ['check', '--auto', '--interval-hours', '0', '--json', '--source', repo])
  assert.equal(afterDismiss.status, 0, afterDismiss.stderr)
  const dismissedPayload = JSON.parse(afterDismiss.stdout)
  assert.equal(dismissedPayload.dismissed, true)
  assert.equal(dismissedPayload.count, 2)

  // Manual checks ignore a dismissed batch.
  const afterManual = run(home, ['check', '--manual', '--json', '--source', repo])
  assert.equal(afterManual.status, 2, afterManual.stderr)
  assert.equal(JSON.parse(afterManual.stdout).dismissed, false)
})

test('duplicate remote skill names are a hard error', () => {
  const repo = initRepo()
  writeSkill(repo, 'skills/a/dup', 'dup', '1.0.0')
  writeSkill(repo, 'skills/b/dup', 'dup', '1.0.0')
  commit(repo, 'duplicate')
  const home = createHome()
  const result = run(home, ['check', '--source', repo])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /duplicate skill name/u)
  assert.deepEqual(catalogTree(home.skillsDir), [])
})

test('remote-deleted skills are kept locally', async () => {
  const repo = standardRepo()
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  rmSync(join(repo, 'skills', 'productivity'), { recursive: true, force: true })
  commit(repo, 'remove excel')
  const check = run(home, ['check', '--source', repo])
  assert.equal(check.status, 0, check.stderr)
  assert.match(check.stdout, /keep\s+excel\s+remote-missing/u)
  assert.ok(existsSync(join(home.skillsDir, 'excel', 'SKILL.md')))
})

test('network/repository failures are reported and change nothing', async () => {
  const repo = standardRepo()
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  const before = catalogTree(home.skillsDir)
  const result = run(home, ['check', '--repo', '/tmp/definitely-not-a-git-repository', '--timeout', '5000'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ls-remote failed|git .* failed/u)
  assert.match(result.stderr, /definitely-not-a-git-repository/u)
  assert.deepEqual(catalogTree(home.skillsDir), before)
})

test('interrupted swap is recovered from the pending journal', async () => {
  const home = createHome()
  const target = join(home.skillsDir, 'demo')
  const oldPath = join(home.stateDir, 'staging', 'demo-old')
  mkdirSync(oldPath, { recursive: true })
  writeFileSync(join(oldPath, 'SKILL.md'), skillFiles('1.0.0').replaceAll('__NAME__', 'demo'))
  const snapshot = join(home.stateDir, 'backups', 'snap-1')
  mkdirSync(join(snapshot, 'skills', 'demo'), { recursive: true })
  cpSync(oldPath, join(snapshot, 'skills', 'demo'), { recursive: true })
  const { scanPackageFiles, recoverPending, readManifest, writeManifest } = await import(LIB)
  const oldManifest = { schema: 1, skills: { demo: { files: scanPackageFiles(join(snapshot, 'skills', 'demo')), validated: true } } }
  writeFileSync(join(snapshot, 'manifest.json'), `${JSON.stringify(oldManifest, undefined, 2)}\n`)
  const brokenManifest = { schema: 2, skills: { demo: { managedBy: 'skills-updater', files: { 'SKILL.md': '0'.repeat(64) }, digest: '0'.repeat(64) } } }
  writeManifest(home.stateDir, brokenManifest)
  mkdirSync(join(home.stateDir, 'pending'), { recursive: true })
  writeFileSync(join(home.stateDir, 'pending', 'demo.json'), JSON.stringify({
    name: 'demo', target, staging: join(home.stateDir, 'staging', 'demo-new'), oldPath, snapshot: 'snap-1',
  }))
  const recovered = recoverPending({ stateDir: home.stateDir, skillsDir: home.skillsDir })
  assert.deepEqual(recovered, ['demo'])
  assert.ok(existsSync(join(target, 'SKILL.md')))
  assert.equal(existsSync(join(home.stateDir, 'pending', 'demo.json')), false)
  assert.equal(readManifest(home.stateDir).schema, 1)
})

test('interrupted add is rolled back when the manifest was not written', async () => {
  const home = createHome()
  const target = join(home.skillsDir, 'new-skill')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'SKILL.md'), skillFiles('1.0.0').replaceAll('__NAME__', 'new-skill'))
  const snapshot = join(home.stateDir, 'backups', 'snap-add')
  mkdirSync(snapshot, { recursive: true })
  writeFileSync(join(snapshot, 'manifest.json'), JSON.stringify({ schema: 1, skills: {} }))
  mkdirSync(join(home.stateDir, 'pending'), { recursive: true })
  writeFileSync(join(home.stateDir, 'pending', 'new-skill.json'), JSON.stringify({
    name: 'new-skill', target, staging: join(home.stateDir, 'staging', 'new-skill'), oldPath: join(home.stateDir, 'staging', 'new-skill-old'), snapshot: 'snap-add',
  }))
  const { recoverPending, readManifest } = await import(LIB)
  assert.deepEqual(recoverPending({ stateDir: home.stateDir, skillsDir: home.skillsDir }), ['new-skill'])
  assert.equal(existsSync(target), false, 'the uncommitted add is removed')
  assert.deepEqual(Object.keys(readManifest(home.stateDir).skills), [])
})

test('rollback restores the previous version, backs up current state, and keeps user skills', async () => {
  const repo = standardRepo()
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  writeSkill(repo, 'skills/productivity/excel', 'excel', '2.1.0')
  commit(repo, 'excel 2.1')
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  assert.match(readFileSync(join(home.skillsDir, 'excel', 'SKILL.md'), 'utf8'), /2\.1\.0/u)
  mkdirSync(join(home.skillsDir, 'user-own'))
  writeFileSync(join(home.skillsDir, 'user-own', 'SKILL.md'), skillFiles('1.0.0').replaceAll('__NAME__', 'user-own'))
  const list = run(home, ['rollback', '--list'])
  assert.equal(list.status, 0, list.stderr)
  const rollbackResult = run(home, ['rollback', '--yes'])
  assert.equal(rollbackResult.status, 0, rollbackResult.stderr)
  assert.match(readFileSync(join(home.skillsDir, 'excel', 'SKILL.md'), 'utf8'), /2\.0\.0/u)
  assert.ok(existsSync(join(home.skillsDir, 'user-own', 'SKILL.md')), 'local-only skill survives rollback')
})

test('catalog is offline and classifies managed/legacy/local skills', async () => {
  const repo = standardRepo()
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--yes']).status, 0)
  mkdirSync(join(home.skillsDir, 'local-only'))
  writeFileSync(join(home.skillsDir, 'local-only', 'SKILL.md'), skillFiles('1.0.0').replaceAll('__NAME__', 'local-only'))
  const result = run(home, ['catalog'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /example\s+managed/u)
  assert.match(result.stdout, /local-only/u)
})

test('installed skills load through the real DSH skill filesystem', { skip: !existsSync(join(DSH_MODULES, '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js')) }, async () => {
  const repo = standardRepo()
  addPptBranch(repo)
  const home = createHome()
  assert.equal(run(home, ['update', '--source', repo, '--ref', 'feat/ppt', '--yes']).status, 0)
  const script = `
    import { Context } from ${JSON.stringify(join(DSH_MODULES, '@deepseek-ai', 'cordis', 'lib', 'index.js'))}
    import SkillRegistry from ${JSON.stringify(join(DSH_MODULES, '@deepseek-ai', 'dsh-skill', 'lib', 'index.js'))}
    import * as SkillFileSystem from ${JSON.stringify(join(DSH_MODULES, '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'))}
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { includeDefaultRoots: false, watch: false, customSkillDirs: [${JSON.stringify(home.skillsDir)}] })
      const list = (await ctx.skills.list()).map(skill => skill.name).sort()
      const ppt = await ctx.skills.get('ppt-generation')
      console.log(JSON.stringify({ list, hasPpt: ppt !== undefined && ppt.content.includes('ppt-generation') }))
    } finally { await ctx.fiber.dispose() }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout.trim().split('\n').at(-1))
  assert.deepEqual(payload.list, ['example', 'excel', 'ppt-generation'])
  assert.equal(payload.hasPpt, true)
})

test('DSH watcher discovers a skill installed after startup', { skip: !existsSync(join(DSH_MODULES, '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js')) }, async () => {
  const home = createHome()
  const script = `
    import { mkdirSync, writeFileSync } from 'node:fs'
    import { join } from 'node:path'
    import { Context } from ${JSON.stringify(join(DSH_MODULES, '@deepseek-ai', 'cordis', 'lib', 'index.js'))}
    import SkillRegistry from ${JSON.stringify(join(DSH_MODULES, '@deepseek-ai', 'dsh-skill', 'lib', 'index.js'))}
    import * as SkillFileSystem from ${JSON.stringify(join(DSH_MODULES, '@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js'))}
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { includeDefaultRoots: false, watch: true, customSkillDirs: [${JSON.stringify(home.skillsDir)}] })
      const before = (await ctx.skills.list()).map(skill => skill.name)
      mkdirSync(${JSON.stringify(join(home.skillsDir, 'late-skill'))})
      writeFileSync(${JSON.stringify(join(home.skillsDir, 'late-skill', 'SKILL.md'))}, '---\\nname: late-skill\\ndescription: Use when late\\n---\\n\\n# late\\n')
      await sleep(1500)
      const after = (await ctx.skills.list()).map(skill => skill.name).sort()
      console.log(JSON.stringify({ before, after }))
    } finally { await ctx.fiber.dispose() }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout.trim().split('\n').at(-1))
  assert.deepEqual(payload.before, [])
  assert.deepEqual(payload.after, ['late-skill'])
})

test('check --json is compact and omits the full plan (R2-09)', () => {
  const repo = standardRepo()
  const home = createHome()
  const result = run(home, ['check', '--source', repo, '--json'])
  assert.equal(result.status, 2, result.stderr)
  assert.ok(result.stdout.length < 2_000_000, `stdout is ${result.stdout.length} bytes`)
  const payload = JSON.parse(result.stdout)
  assert.equal('plan' in payload, false)
  assert.equal(Array.isArray(payload.updates), true)
})

test('check --json errors are one stable JSON envelope, not raw progress (BUG-R3B-04)', async () => {
  const home = createHome()
  const bin = tempDir('hyperai-fake-git-')
  try {
    const fakeGit = join(bin, 'git')
    writeFileSync(fakeGit, '#!/bin/sh\nsleep 30\n')
    const { chmodSync } = await import('node:fs')
    chmodSync(fakeGit, 0o755)
    const result = run(home, ['check', '--repo', 'https://example.invalid/hyperai-skills.git', '--timeout', '100', '--json'], {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    })
    assert.equal(result.status, 1, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'GIT_TIMEOUT')
    assert.match(payload.error.message, /timed out/u)
    assert.match(payload.error.hint, /--timeout|--source/u)
    assert.doesNotMatch(result.stdout, /^===|Progress:/mu)
    assert.equal(payload.error.message.includes('sleep 30'), false)
  } finally {
    rmSync(bin, { recursive: true, force: true })
    rmSync(home.root, { recursive: true, force: true })
  }
})
