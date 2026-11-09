/**
 * `doctor` must work in both profile layouts without extra environment setup.
 *
 * beta.1 shipped a README whose `doctor --dsh-bin …` command failed on a clean
 * Ubuntu because the runtime pnpm was not on PATH, and the tarball layout always
 * warned about a missing branding patch it never uses.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diagnoseProfile } from '../scripts/manage.mjs'

/** Create an executable that answers `--version` with a fixed string. */
function fakeBin(dir, name, version) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\necho ${version}\n`)
  chmodSync(path, 0o755)
  return path
}

/** Build a managed profile directory plus its install state. */
function makeProfile({ root, layout, withPatch }) {
  const profileDir = join(root, 'dsh-home', 'profiles', 'hyperai')
  mkdirSync(profileDir, { recursive: true })
  const manifest = layout === 'tarball'
    ? {
        name: 'dsh-profile-hyperai',
        private: true,
        hyperaiTuiManaged: true,
        dependencies: { '@hyperai/hyperai-tui': 'file:packages/hyperai-tui-0.2.0-beta.6.tgz' },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@hyperai/hyperai-tui'] } },
      }
    : {
        name: 'dsh-profile-hyperai',
        private: true,
        hyperaiTuiManaged: true,
        dependencies: { '@deepseek-ai/dsh-base': '0.2.0-rc.2', '@deepseek-harness-tui/dsh-tui': '0.16.1' },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui'] } },
      }
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  if (withPatch) {
    mkdirSync(join(profileDir, 'patches'), { recursive: true })
    writeFileSync(join(profileDir, 'patches', 'hyperai-tui.patch'), '# patch\n')
  }
  const runtime = join(root, 'runtime', 'node_modules', '.bin')
  const dshBin = fakeBin(runtime, 'dsh', '0.2.0-rc.2')
  const pnpmBin = fakeBin(runtime, 'pnpm', '10.28.1')
  writeFileSync(join(profileDir, '.hyperai-install.json'), `${JSON.stringify({
    schema: 1,
    version: '0.2.0-beta.6',
    status: 'completed',
    phase: 'done',
    runtime: { dshBin, pnpmBin, node: process.version },
  }, undefined, 2)}\n`)
  return { profileDir, dshBin, pnpmBin }
}

/** Doctor options that look like "no flags, fresh shell". */
function bareOptions(profileDir) {
  return {
    profile: 'hyperai',
    profileDir,
    dshBin: 'dsh',
    pnpmBin: 'pnpm',
    dshBinExplicit: false,
    pnpmBinExplicit: false,
  }
}

test('doctor uses the runtime recorded by the install and stays OK in the tarball layout', () => {
  const root = mkdtempSync(join(tmpdir(), 'hyperai-doctor-'))
  try {
    const { profileDir, dshBin } = makeProfile({ root, layout: 'tarball', withPatch: false })
    const result = diagnoseProfile(bareOptions(profileDir))
    assert.equal(result.ok, true, result.issues.join('; '))
    assert.equal(result.environment.dshVersion, '0.2.0-rc.2')
    assert.equal(result.environment.pnpmVersion, '10.28.1')
    assert.equal(result.warnings.some(warning => /branding patch/u.test(warning)), false, result.warnings.join('; '))
    // The recorded runtime is used instead of PATH.
    assert.match(dshBin, /runtime/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the old patch layout still warns when the copied patch is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'hyperai-doctor-'))
  try {
    const { profileDir } = makeProfile({ root, layout: 'patch', withPatch: false })
    const missing = diagnoseProfile(bareOptions(profileDir))
    assert.equal(missing.warnings.some(warning => /branding patch is missing/u.test(warning)), true, missing.warnings.join('; '))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the old patch layout is quiet when the copied patch exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'hyperai-doctor-'))
  try {
    const { profileDir } = makeProfile({ root, layout: 'patch', withPatch: true })
    const present = diagnoseProfile(bareOptions(profileDir))
    assert.equal(present.warnings.some(warning => /branding patch/u.test(warning)), false, present.warnings.join('; '))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an explicit --dsh-bin still wins over the recorded runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'hyperai-doctor-'))
  try {
    const { profileDir } = makeProfile({ root, layout: 'tarball', withPatch: false })
    const result = diagnoseProfile({ ...bareOptions(profileDir), dshBin: '/nonexistent/dsh', dshBinExplicit: true })
    assert.equal(result.ok, false)
    assert.ok(result.issues.length > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
