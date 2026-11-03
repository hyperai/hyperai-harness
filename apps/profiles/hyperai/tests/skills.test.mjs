/**
 * Skills installer logic checks. Network and the real skill repository are not
 * involved: these tests build fixture skill directories and exercise the
 * selection, validation, digest, and no-overwrite planning rules.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  digestSkill,
  installSkills,
  loadLock,
  planSkill,
  recoverSkillJournals,
  rollbackSkills,
  selectedSkills,
  validateSkill,
} from '../scripts/install-skills.mjs'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = join(PKG, 'skills', 'hyperai-skills.lock.json')
const skillBody = (name, description = 'Use when testing') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody.\n`

function temporaryDir() {
  return mkdtempSync(join(tmpdir(), 'hyperai-skills-test-'))
}

test('the lock pins a commit and separates verified from unverified skills', () => {
  const lock = loadLock(LOCK)
  assert.match(lock.ref, /^[0-9a-f]{40}$/u)
  assert.deepEqual(selectedSkills(lock, false).length, lock.verified.length + lock.unverified.length)
  assert.deepEqual(selectedSkills(lock, true).length, lock.verified.length)
  assert.ok(selectedSkills(lock, true).every(skill => skill.validated === true))
  assert.ok(selectedSkills(lock, false).some(skill => skill.validated === false))
})

test('validateSkill accepts DSH frontmatter and rejects the legacy spellings', () => {
  const root = temporaryDir()
  try {
    mkdirSync(join(root, 'good'))
    writeFileSync(join(root, 'good', 'SKILL.md'), skillBody('good'))
    assert.equal(validateSkill(join(root, 'good'), 'good').name, 'good')

    mkdirSync(join(root, 'wrong-name'))
    writeFileSync(join(root, 'wrong-name', 'SKILL.md'), skillBody('other'))
    assert.throws(() => validateSkill(join(root, 'wrong-name'), 'wrong-name'), /frontmatter name/u)

    mkdirSync(join(root, 'no-desc'))
    writeFileSync(join(root, 'no-desc', 'SKILL.md'), '---\nname: no-desc\n---\n')
    assert.throws(() => validateSkill(join(root, 'no-desc'), 'no-desc'), /description/u)

    mkdirSync(join(root, 'no-frontmatter'))
    writeFileSync(join(root, 'no-frontmatter', 'SKILL.md'), '# no frontmatter\n')
    assert.throws(() => validateSkill(join(root, 'no-frontmatter'), 'no-frontmatter'), /frontmatter/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('digestSkill covers SKILL.md and resource directories only', () => {
  const root = temporaryDir()
  try {
    mkdirSync(join(root, 'references'), { recursive: true })
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'SKILL.md'), skillBody('demo'))
    writeFileSync(join(root, 'references', 'notes.md'), 'notes\n')
    writeFileSync(join(root, 'scripts', 'run.py'), 'print(1)\n')
    writeFileSync(join(root, 'NOTES.md'), 'candidate notes\n')
    writeFileSync(join(root, 'README.md'), 'unrelated\n')
    const digest = digestSkill(root)
    assert.deepEqual(Object.keys(digest).sort(), ['SKILL.md', 'references/notes.md', 'scripts/run.py'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('planSkill installs, no-ops, updates, and protects user edits', () => {
  const root = temporaryDir()
  try {
    const source = join(root, 'source')
    const target = join(root, 'target')
    mkdirSync(source)
    writeFileSync(join(source, 'SKILL.md'), skillBody('demo'))
    const skill = { name: 'demo' }

    const fresh = planSkill(skill, source, target, { schema: 1, skills: {} })
    assert.equal(fresh.action, 'install')

    mkdirSync(target)
    writeFileSync(join(target, 'SKILL.md'), skillBody('demo'))
    const recorded = { files: digestSkill(target) }
    assert.equal(planSkill(skill, source, target, { schema: 1, skills: { demo: recorded } }).action, 'noop')

    writeFileSync(join(target, 'SKILL.md'), skillBody('demo', 'Use when the user edited this copy'))
    assert.equal(
      planSkill(skill, source, target, { schema: 1, skills: { demo: recorded } }).action,
      'skip-user-modified',
    )

    mkdirSync(join(root, 'unmanaged'))
    writeFileSync(join(root, 'unmanaged', 'SKILL.md'), skillBody('demo', 'Use when a different content'))
    assert.equal(
      planSkill(skill, source, join(root, 'unmanaged'), { schema: 1, skills: {} }).action,
      'skip-unmanaged',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the generated manifest schema stays at version 1', () => {
  const manifest = JSON.parse(readFileSync(join(PKG, 'skills', 'hyperai-skills.lock.json'), 'utf8'))
  assert.equal(manifest.schema, 1)
})

/** Build a small local git repo with one skill; returns repo/ref. */
function localSkillRepo() {
  const root = temporaryDir()
  const repo = join(root, 'repo')
  mkdirSync(join(repo, 'skills', 'example', 'references'), { recursive: true })
  writeFileSync(join(repo, 'skills', 'example', 'SKILL.md'), skillBody('example', 'Use when testing v1'))
  writeFileSync(join(repo, 'skills', 'example', 'references', 'notes.md'), 'v1\n')
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim()
  git('init', '-q', '-b', 'master')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'Test')
  git('add', '-A')
  git('commit', '-qm', 'v1')
  return { root, repo, ref: git('rev-parse', 'HEAD'), git }
}

function localLock(root, repo, ref) {
  const lock = join(root, 'lock.json')
  writeFileSync(lock, `${JSON.stringify({
    schema: 1,
    repository: repo,
    ref,
    verified: [{ name: 'example', area: 'skills', validated: true }],
    unverified: [],
  }, undefined, 2)}\n`)
  return lock
}

test('installSkills accepts the partial options install.mjs passes (QA-003)', async () => {
  const fixture = localSkillRepo()
  const home = temporaryDir()
  try {
    const lockPath = localLock(fixture.root, fixture.repo, fixture.ref)
    const result = installSkills({ dshHome: home, profile: 'hyperai', lockPath, source: fixture.repo })
    assert.deepEqual(result.installed, ['example'])
    const profileDir = join(home, 'profiles', 'hyperai')
    assert.ok(existsSync(join(profileDir, 'skills', 'example', 'SKILL.md')))
    const manifest = JSON.parse(readFileSync(join(profileDir, '.hyperai-skills', 'manifest.json'), 'utf8'))
    assert.equal(manifest.schema, 1)
    assert.deepEqual(Object.keys(manifest.skills.example.files).sort(), ['SKILL.md', 'references/notes.md'])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('legacy update preserves extra files and rolls back manifest (QA-004/006/007)', async () => {
  const fixture = localSkillRepo()
  const home = temporaryDir()
  try {
    const lockPath = localLock(fixture.root, fixture.repo, fixture.ref)
    const base = { dshHome: home, profile: 'hyperai', lockPath, source: fixture.repo }
    installSkills(base)
    const profileDir = join(home, 'profiles', 'hyperai')
    const target = join(profileDir, 'skills', 'example')
    writeFileSync(join(target, 'references', 'user-notes.md'), 'user extra\n')
    writeFileSync(join(fixture.repo, 'skills', 'example', 'SKILL.md'), skillBody('example', 'Use when testing v2'))
    writeFileSync(join(fixture.repo, 'skills', 'example', 'references', 'notes.md'), 'v2\n')
    fixture.git('add', '-A')
    fixture.git('commit', '-qm', 'v2')
    const v2 = fixture.git('rev-parse', 'HEAD')
    const updated = installSkills({ ...base, ref: v2 })
    assert.deepEqual(updated.updated, ['example'])
    assert.equal(readFileSync(join(target, 'references', 'user-notes.md'), 'utf8'), 'user extra\n')
    const updatedManifest = JSON.parse(readFileSync(join(profileDir, '.hyperai-skills', 'manifest.json'), 'utf8'))
    assert.equal(updatedManifest.skills.example.ref, v2)
    const rolled = rollbackSkills(base)
    assert.deepEqual(rolled.restored, ['example'])
    assert.match(readFileSync(join(target, 'SKILL.md'), 'utf8'), /v1/u)
    assert.equal(readFileSync(join(target, 'references', 'user-notes.md'), 'utf8'), 'user extra\n')
    const rolledManifest = JSON.parse(readFileSync(join(profileDir, '.hyperai-skills', 'manifest.json'), 'utf8'))
    assert.equal(rolledManifest.skills.example.ref, fixture.ref)
    assert.ok(existsSync(join(profileDir, '.hyperai-skills', 'backups', updated.backup, 'manifest.json')))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('legacy snapshots without meta/manifest remain rollback-compatible (QA-008)', () => {
  const fixture = localSkillRepo()
  const home = temporaryDir()
  try {
    const lockPath = localLock(fixture.root, fixture.repo, fixture.ref)
    const base = { dshHome: home, profile: 'hyperai', lockPath, source: fixture.repo }
    installSkills(base)
    const profileDir = join(home, 'profiles', 'hyperai')
    const legacy = join(profileDir, '.hyperai-skills', 'backups', 'legacy-2000')
    mkdirSync(join(legacy, 'skills', 'example', 'references'), { recursive: true })
    writeFileSync(join(legacy, 'skills', 'example', 'SKILL.md'), skillBody('example', 'Use when testing legacy'))
    writeFileSync(join(legacy, 'skills', 'example', 'references', 'notes.md'), 'legacy\n')
    const result = rollbackSkills({ ...base, to: 'legacy-2000' })
    assert.deepEqual(result.restored, ['example'])
    assert.match(readFileSync(join(profileDir, 'skills', 'example', 'SKILL.md'), 'utf8'), /legacy/u)
    const manifest = JSON.parse(readFileSync(join(profileDir, '.hyperai-skills', 'manifest.json'), 'utf8'))
    assert.ok(manifest.skills.example.files['SKILL.md'])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('legacy git checkout has a bounded timeout (QA-013)', async () => {
  if (process.platform === 'win32') return
  const root = temporaryDir()
  const home = temporaryDir()
  try {
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const fakeGit = join(bin, 'git')
    writeFileSync(fakeGit, '#!/bin/sh\nsleep 5\n')
    const { chmodSync } = await import('node:fs')
    chmodSync(fakeGit, 0o755)
    const lockPath = join(root, 'lock.json')
    writeFileSync(lockPath, JSON.stringify({ schema: 1, repository: 'https://example.invalid/repo.git', ref: 'a'.repeat(40), verified: [], unverified: [] }))
    const oldPath = process.env.PATH
    process.env.PATH = `${bin}:${oldPath}`
    try {
      await assert.rejects(
        async () => installSkills({ dshHome: home, profile: 'hyperai', lockPath, source: root, timeoutMs: 100 }),
        /timed out|ETIMEDOUT|SIGTERM/u,
      )
    } finally {
      process.env.PATH = oldPath
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})


test('default install clones a file:// remote without --source and tolerates ignored stdout (R2-01)', async () => {
  const fixture = localSkillRepo()
  const home = temporaryDir()
  try {
    const lockPath = localLock(fixture.root, `file://${fixture.repo}`, fixture.ref)
    const result = installSkills({ dshHome: home, profile: 'hyperai', lockPath })
    assert.deepEqual(result.installed, ['example'])
    const profileDir = join(home, 'profiles', 'hyperai')
    assert.ok(existsSync(join(profileDir, 'skills', 'example', 'SKILL.md')))
    assert.equal(JSON.parse(readFileSync(join(profileDir, '.hyperai-skills', 'manifest.json'), 'utf8')).schema, 1)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('legacy SIGKILL between rename and manifest write is recovered (R2-08)', () => {
  const fixture = localSkillRepo()
  const home = temporaryDir()
  try {
    const lockPath = localLock(fixture.root, fixture.repo, fixture.ref)
    const base = { dshHome: home, profile: 'hyperai', lockPath, source: fixture.repo }
    installSkills(base)
    const profileDir = join(home, 'profiles', 'hyperai')
    const stateDir = join(profileDir, '.hyperai-skills')
    const target = join(profileDir, 'skills', 'example')
    const manifestPath = join(stateDir, 'manifest.json')
    const oldManifestText = readFileSync(manifestPath, 'utf8')
    const oldManifest = JSON.parse(oldManifestText)
    // Simulate a process killed after staging was renamed but before manifest.
    writeFileSync(join(target, 'SKILL.md'), skillBody('example', 'Use when testing v2'))
    writeFileSync(join(target, 'references', 'user-notes.md'), 'user extra\n')
    const newFiles = digestSkill(target)
    delete newFiles['references/user-notes.md']
    const newEntry = { ...oldManifest.skills.example, description: 'Use when testing v2', files: newFiles, installedAt: new Date().toISOString() }
    mkdirSync(join(stateDir, 'pending'), { recursive: true })
    writeFileSync(join(stateDir, 'pending', 'example.json'), JSON.stringify({
      name: 'example', target, snapshot: undefined, beforeEntry: oldManifest.skills.example, newEntry,
    }))
    // A later v3 must recover the journal, then update normally.
    writeFileSync(join(fixture.repo, 'skills', 'example', 'SKILL.md'), skillBody('example', 'Use when testing v3'))
    fixture.git('add', '-A')
    fixture.git('commit', '-qm', 'v3')
    const v3 = fixture.git('rev-parse', 'HEAD')
    const result = installSkills({ ...base, ref: v3 })
    assert.deepEqual(result.recovered, ['example'])
    assert.deepEqual(result.updated, ['example'])
    assert.match(readFileSync(join(target, 'SKILL.md'), 'utf8'), /v3/u)
    assert.equal(readFileSync(join(target, 'references', 'user-notes.md'), 'utf8'), 'user extra\n')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.skills.example.ref, v3)
    assert.equal(existsSync(join(stateDir, 'pending', 'example.json')), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})


test('recovery rejects an unreadable journal without deleting evidence (R2-08 fail-safe)', () => {
  const home = temporaryDir()
  try {
    const profileDir = join(home, 'profiles', 'hyperai')
    const stateDir = join(profileDir, '.hyperai-skills')
    const pending = join(stateDir, 'pending')
    mkdirSync(pending, { recursive: true })
    const journal = join(pending, 'example.json')
    writeFileSync(journal, '{not-json')
    assert.throws(
      () => recoverSkillJournals({ stateDir, skillsDir: join(profileDir, 'skills'), manifestPath: join(stateDir, 'manifest.json') }),
      error => error?.code === 'SKILL_RECOVERY_FAILED' && /parse|inspection/iu.test(error.message),
    )
    assert.equal(existsSync(journal), true, 'unreadable journal must be preserved')
    assert.equal(existsSync(pending), true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('undecidable missing-tree recovery fails loudly and keeps journal/staging (R2-08)', () => {
  const home = temporaryDir()
  try {
    const profileDir = join(home, 'profiles', 'hyperai')
    const stateDir = join(profileDir, '.hyperai-skills')
    const pending = join(stateDir, 'pending')
    mkdirSync(pending, { recursive: true })
    const journal = join(pending, 'example.json')
    writeFileSync(journal, `${JSON.stringify({
      name: 'example',
      target: join(profileDir, 'skills', 'example'),
      staging: join(stateDir, 'staging', 'example-new'),
      oldPath: undefined,
      beforeEntry: { ref: 'a'.repeat(40), files: { 'SKILL.md': '0'.repeat(64) } },
      newEntry: { ref: 'b'.repeat(40), files: { 'SKILL.md': '1'.repeat(64) } },
    })}\n`)
    assert.throws(
      () => recoverSkillJournals({ stateDir, skillsDir: join(profileDir, 'skills'), manifestPath: join(stateDir, 'manifest.json') }),
      error => error?.code === 'SKILL_RECOVERY_FAILED' && /undecidable|manual recovery/iu.test(error.message),
    )
    assert.equal(existsSync(journal), true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
