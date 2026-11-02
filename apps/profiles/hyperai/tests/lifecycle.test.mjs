/** Lifecycle status/doctor/uninstall tests using temporary homes only. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diagnoseProfile, statusProfile, uninstallProfile } from '../scripts/manage.mjs'

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'hyperai-lifecycle-'))
  const profileDir = join(home, 'profiles', 'hyperai')
  mkdirSync(join(profileDir, 'skills', 'example'), { recursive: true })
  mkdirSync(join(profileDir, '.hyperai-skills'), { recursive: true })
  writeFileSync(join(profileDir, 'skills', 'example', 'SKILL.md'), '---\nname: example\ndescription: test\n---\n')
  writeFileSync(join(profileDir, '.hyperai-skills', 'manifest.json'), '{"schema":1,"skills":{}}\n')
  writeFileSync(join(profileDir, 'package.json'), '{"name":"dsh-profile-hyperai","hyperaiTuiManaged":true}\n')
  return { home, profileDir }
}

const optionsFor = ({ home, profileDir }) => ({
  dshHome: home, profileDir, profile: 'hyperai', dshBin: 'dsh', pnpmBin: 'pnpm', skills: true, yes: true,
})

test('status and doctor are read-only and expose lifecycle state (QA-012)', () => {
  const fixture = tempHome()
  try {
    const status = statusProfile(optionsFor(fixture))
    assert.equal(status.managed, true)
    assert.equal(status.skills, 0)
    const diagnosis = diagnoseProfile(optionsFor(fixture))
    assert.equal(diagnosis.status.managed, true)
    assert.ok(Array.isArray(diagnosis.issues))
    assert.ok(diagnosis.warnings.some(warning => /branding patch/u.test(warning)))
    assert.equal(existsSync(join(fixture.profileDir, '.hyperai-install.json')), false)
  } finally {
    rmSync(fixture.home, { recursive: true, force: true })
  }
})

test('uninstall archives user data and removes only managed runtime files (QA-012)', () => {
  const fixture = tempHome()
  try {
    const result = uninstallProfile(optionsFor(fixture))
    assert.equal(existsSync(join(fixture.profileDir, 'package.json')), false)
    assert.equal(existsSync(join(fixture.profileDir, 'skills', 'example', 'SKILL.md')), true)
    assert.ok(existsSync(join(result.archive, 'skills', 'example', 'SKILL.md')))
    assert.match(readFileSync(join(result.archive, 'README.txt'), 'utf8'), /Archived/u)
  } finally {
    rmSync(fixture.home, { recursive: true, force: true })
  }
})

test('uninstall refuses an unmanaged profile and requires --yes', () => {
  const fixture = tempHome()
  try {
    writeFileSync(join(fixture.profileDir, 'package.json'), '{"name":"foreign"}\n')
    assert.throws(() => uninstallProfile(optionsFor(fixture)), /not a managed/u)
  } finally {
    rmSync(fixture.home, { recursive: true, force: true })
  }
})
