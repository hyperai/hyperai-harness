/**
 * Skills installer logic checks. Network and the real skill repository are not
 * involved: these tests build fixture skill directories and exercise the
 * selection, validation, digest, and no-overwrite planning rules.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  digestSkill,
  loadLock,
  planSkill,
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
