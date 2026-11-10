/**
 * Internal-beta installation-package layout.
 *
 * The full end-to-end install (dsh + pnpm + pnpm install) is exercised on real
 * machines by RFC-002 E2..E10. These tests cover the package-specific logic
 * that would otherwise only be proven by a manual run: the bundle-mode profile
 * template, the binary tarball copy and the local Skills snapshot.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { stageBinary } from '../scripts/install.mjs'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brand = JSON.parse(readFileSync(join(PKG, '..', '..', 'tui', 'src', 'brand.json'), 'utf8'))

/** Minimal installation-package layout understood by distribution.mjs. */
function makeBundle() {
  const root = mkdtempSync(join(tmpdir(), 'hyperai-bundle-'))
  for (const dir of ['profile/scripts', 'tui', 'skills/skills/demo-skill']) mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'profile', 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-hyperai',
    private: true,
    dependencies: { '@hyperai/hyperai-tui': 'file:packages/hyperai-tui-0.2.0-beta.1.tgz' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@hyperai/hyperai-tui'] } },
  }, undefined, 2)}\n`)
  writeFileSync(join(root, 'profile', 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  writeFileSync(join(root, 'profile', 'cordis.patch.yml'), '- id: skill-filesystem\n  disabled: false\n')
  writeFileSync(join(root, 'profile', 'LICENSE'), 'MIT\n')
  writeFileSync(join(root, 'profile', 'brand.json'), `${JSON.stringify(brand)}\n`)
  writeFileSync(join(root, 'profile', 'tui-meta.json'), JSON.stringify({ name: '@hyperai/hyperai-tui', version: '0.2.0-beta.1', upstreamVersion: brand.upstream.version }))
  writeFileSync(join(root, 'profile', 'skills.lock.json'), `${JSON.stringify({
    schema: 1,
    repository: 'https://github.com/hyperai/hyperai-skills.git',
    ref: '34f0a1be0cb3ae9905aecebba13efae6a8657be1',
    channel: 'feat/ppt-generation-upstream',
    prerelease: true,
    verified: [{ name: 'demo-skill', area: 'skills', validated: true }],
    unverified: [],
  }, undefined, 2)}\n`)
  writeFileSync(join(root, 'tui', 'hyperai-tui-0.2.0-beta.1.tgz'), Buffer.from([0x1f, 0x8b, 0x00, 0xff, 0xfe, 0x01]))
  writeFileSync(join(root, 'skills', 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: demo\n---\n\n# Demo\n')
  return root
}

test('the bundled profile template uses a file: tarball and the renamed bundle', () => {
  const root = makeBundle()
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'profile', 'package.json'), 'utf8'))
    assert.equal(manifest.dependencies['@hyperai/hyperai-tui'], 'file:packages/hyperai-tui-0.2.0-beta.1.tgz')
    assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@hyperai/hyperai-tui'])
    const workspace = readFileSync(join(root, 'profile', 'pnpm-workspace.yaml'), 'utf8')
    assert.equal(workspace.includes('patchedDependencies'), false, 'the pre-built product must not use patchedDependencies')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the product tarball is copied verbatim, not through a UTF-8 string', () => {
  const root = makeBundle()
  const profileDir = mkdtempSync(join(tmpdir(), 'hyperai-profile-'))
  try {
    const source = join(root, 'tui', 'hyperai-tui-0.2.0-beta.1.tgz')
    const plan = []
    stageBinary({ profileDir, dryRun: false, force: false }, join('packages', 'hyperai-tui-0.2.0-beta.1.tgz'), source, plan)
    assert.deepEqual(readFileSync(join(profileDir, 'packages', 'hyperai-tui-0.2.0-beta.1.tgz')), readFileSync(source))
    assert.deepEqual(plan, [{ file: 'packages/hyperai-tui-0.2.0-beta.1.tgz', action: 'create' }])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(profileDir, { recursive: true, force: true })
  }
})

test('bundle mode installs a profile from the bundle without the source checkout', () => {
  const root = makeBundle()
  const home = mkdtempSync(join(tmpdir(), 'hyperai-home-'))
  try {
    const output = execFileSync(process.execPath, [join(PKG, 'scripts', 'install.mjs'), '--dsh-home', join(home, '.dsh'), '--dry-run', '--json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        HYPERAI_DSH_HOME: join(home, '.dsh'),
        HYPERAI_DIST_ROOT: root,
      },
    })
    const result = JSON.parse(output)
    const planned = result.plan.map(step => step.file)
    assert.ok(planned.includes('packages/hyperai-tui-0.2.0-beta.1.tgz'), planned.join(', '))
    assert.equal(planned.includes(join('patches', 'hyperai-tui.patch')), false, 'bundle mode must not stage the pnpm patch')
    // `--dry-run` reports the plan and writes nothing.
    assert.equal(existsSync(join(home, '.dsh', 'profiles', 'hyperai', 'package.json')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('a bundled Skills snapshot installs from disk without git', () => {
  const root = makeBundle()
  const home = mkdtempSync(join(tmpdir(), 'hyperai-home-'))
  try {
    const output = execFileSync(process.execPath, [
      join(PKG, 'scripts', 'install-skills.mjs'),
      '--dsh-home', join(home, '.dsh'),
      '--source', join(root, 'skills'),
      '--lock', join(root, 'profile', 'skills.lock.json'),
      '--local-snapshot',
      '--dry-run',
      '--json',
    ], { encoding: 'utf8', env: { ...process.env, HOME: home } })
    const result = JSON.parse(output)
    assert.deepEqual(result.installed, ['demo-skill'])
    assert.equal(result.ref, '34f0a1be0cb3ae9905aecebba13efae6a8657be1')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('the installation-package root is inferred from the script location', () => {
  const root = makeBundle()
  try {
    cpSync(join(PKG, 'scripts', 'distribution.mjs'), join(root, 'profile', 'scripts', 'distribution.mjs'))
    const env = { ...process.env }
    delete env.HYPERAI_DIST_ROOT
    const module = pathToFileURL(join(root, 'profile', 'scripts', 'distribution.mjs')).href
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(module)}); console.log(JSON.stringify({ bundled: m.isBundled(), root: m.BUNDLE_ROOT, brand: m.brand().productName }))`,
    ], { encoding: 'utf8', env })
    const parsed = JSON.parse(output)
    assert.equal(parsed.bundled, true)
    assert.equal(realpathSync(parsed.root), realpathSync(root))
    assert.equal(parsed.brand, 'HyperAI Harness')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
