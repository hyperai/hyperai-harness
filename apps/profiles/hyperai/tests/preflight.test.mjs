/**
 * Environment / Core compatibility preflight tests. The installer must reject
 * unsupported runtimes before writing anything, and must never offer a silent
 * version bypass.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  coreVersionSupported,
  inspectEnvironment,
  nodeVersionSupported,
  parseCliVersion,
  parseNodeVersion,
  validateEnvironment,
  PreflightError,
} from '../scripts/preflight.mjs'
import { install, parseArgs } from '../scripts/install.mjs'
import { readFileSync } from 'node:fs'

const brand = JSON.parse(readFileSync(new URL('../../../tui/src/brand.json', import.meta.url), 'utf8'))

test('Node engine range accepts supported lines and rejects Node 18/20/23', () => {
  assert.deepEqual(parseNodeVersion('v22.19.0'), { major: 22, minor: 19, patch: 0 })
  for (const version of ['22.19.0', '22.20.1', '24.0.0', '26.9.0']) assert.equal(nodeVersionSupported(version), true, version)
  for (const version of ['18.20.0', '20.19.0', '23.11.0']) assert.equal(nodeVersionSupported(version), false, version)
})

test('CLI version parser handles plain and prefixed output', () => {
  assert.equal(parseCliVersion('0.2.0-rc.2\n'), '0.2.0-rc.2')
  assert.equal(parseCliVersion('dsh 0.2.0-rc.2\n'), '0.2.0-rc.2')
  assert.equal(parseCliVersion('v0.2.1-rc.5'), '0.2.1-rc.5')
})

test('Core compatibility uses the pinned validated list and rejects rc.5', () => {
  const validated = brand.core.validated
  assert.equal(coreVersionSupported('0.2.0-rc.2', validated), true)
  assert.equal(coreVersionSupported('0.2.1-rc.2', validated), true)
  assert.equal(coreVersionSupported('0.2.1-rc.5', validated), false)
  assert.throws(
    () => validateEnvironment({ dshVersion: '0.2.1-rc.5', coreVersions: validated, testedCoreVersions: brand.core.tested }),
    error => error instanceof PreflightError && error.code === 'unsupported-core' && /Validated:/u.test(error.message),
  )
  assert.throws(
    () => validateEnvironment({ nodeVersion: '18.20.0', dshVersion: '0.2.0-rc.2', coreVersions: validated }),
    /unsupported Node/u,
  )
})

test('unsupported missing pnpm is reported before any profile write', () => {
  const home = mkdtempSync(join(tmpdir(), 'hyperai-preflight-'))
  try {
    assert.throws(
      () => inspectEnvironment({ dshBin: process.execPath, pnpmBin: 'definitely-not-a-real-pnpm-binary', timeoutMs: 10_000 }),
      /cannot run definitely-not-a-real-pnpm-binary --version/u,
    )
    assert.equal(existsSync(join(home, 'profiles')), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('cold installer rejects unsupported Core before creating the profile', async () => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'hyperai-preflight-installer-'))
  try {
    const fakeDsh = join(root, 'fake-dsh')
    writeFileSync(fakeDsh, '#!/bin/sh\nprintf "0.2.1-rc.5\\n"\n')
    chmodSync(fakeDsh, 0o755)
    const home = join(root, 'home')
    await assert.rejects(
      install(parseArgs(['--dsh-home', home, '--dsh-bin', fakeDsh, '--no-skills', '--dry-run'])),
      error => error instanceof PreflightError && error.code === 'unsupported-core',
    )
    assert.equal(existsSync(join(home, 'profiles')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('supported Core passes preflight and dry-run writes no profile', async () => {
  if (process.platform === 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'hyperai-preflight-installer-'))
  try {
    const fakeDsh = join(root, 'fake-dsh')
    writeFileSync(fakeDsh, '#!/bin/sh\nprintf "0.2.0-rc.2\\n"\n')
    chmodSync(fakeDsh, 0o755)
    const home = join(root, 'home')
    const result = await install(parseArgs(['--dsh-home', home, '--dsh-bin', fakeDsh, '--no-skills', '--dry-run']))
    assert.equal(result.environment.dshVersion, '0.2.0-rc.2')
    assert.equal(existsSync(join(home, 'profiles')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
