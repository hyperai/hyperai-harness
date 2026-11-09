/**
 * Install-scenario detection: fresh / upgrade / reinstall / downgrade /
 * interrupted / uninstalled / unknown / foreign, including semver ordering and
 * the read-only guarantee.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  compareVersions, describeScenario, detectInstallScenario, install, parseArgs, scenarioField,
} from '../scripts/install.mjs'

const TO = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dsh?.tui?.version
  ?? '0.2.0-beta.5'

function profileDir(home, profile = 'hyperai') {
  return join(home, 'profiles', profile)
}

/** Create a managed profile with the given version and optional state/marker. */
function makeProfile(home, { version = '0.2.0-beta.1', state = undefined, uninstall = undefined, foreign = false, profile = 'hyperai' } = {}) {
  const dir = profileDir(home, profile)
  mkdirSync(dir, { recursive: true })
  if (!foreign) {
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
      hyperaiTuiManaged: true,
      ...(version === undefined || version === null ? {} : { hyperaiTui: { version } }),
    }, undefined, 2)}\n`)
  } else {
    writeFileSync(join(dir, 'package.json'), '{"name":"foreign"}\n')
  }
  if (state !== undefined) writeFileSync(join(dir, '.hyperai-install.json'), `${JSON.stringify(state)}\n`)
  if (uninstall !== undefined) writeFileSync(join(dir, '.hyperai-uninstall.json'), `${JSON.stringify(uninstall)}\n`)
  return dir
}

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'hyperai-scenario-'))
}

test('semver comparison includes prerelease ordering', () => {
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0-beta.4'), -1)
  assert.equal(compareVersions('0.2.0-beta.4', '0.2.0-beta.5'), -1)
  assert.equal(compareVersions('0.2.0-beta.5', '0.2.0'), -1)
  assert.equal(compareVersions('0.2.0-beta.10', '0.2.0-beta.9'), 1)
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0)
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0-beta.1'), 0)
  assert.throws(() => compareVersions('nope', '0.2.0'))
})

test('fresh install when the profile is missing or empty', () => {
  const home = tempHome()
  try {
    assert.equal(detectInstallScenario({ profileDir: profileDir(home) }).mode, 'fresh')
    mkdirSync(profileDir(home), { recursive: true })
    assert.equal(detectInstallScenario({ profileDir: profileDir(home) }).mode, 'fresh')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('upgrade, reinstall and downgrade are distinguished by version', () => {
  for (const [version, mode, blocked] of [
    ['0.2.0-beta.1', 'upgrade', undefined],
    ['0.2.0-beta.4', 'upgrade', undefined],
    [TO, 'reinstall', undefined],
    ['0.2.0-beta.9', 'downgrade', true],
  ]) {
    const home = tempHome()
    try {
      makeProfile(home, { version })
      const scenario = detectInstallScenario({ profileDir: profileDir(home) })
      assert.equal(scenario.mode, mode, version)
      assert.equal(scenario.fromVersion, version)
      assert.equal(scenario.blocked, blocked)
      assert.notEqual(detectInstallScenario({ profileDir: profileDir(home), allowDowngrade: true }).blocked, true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
})

test('interrupted installs win over version comparison', () => {
  for (const status of ['installing', 'failed']) {
    const home = tempHome()
    try {
      makeProfile(home, { version: '0.2.0-beta.1', state: { status, phase: 'dependencies' } })
      const scenario = detectInstallScenario({ profileDir: profileDir(home) })
      assert.equal(scenario.mode, 'interrupted')
      assert.equal(scenario.phase, 'dependencies')
      assert.equal(scenario.state, status)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
})

test('uninstalled and unknown-version profiles are recognized', () => {
  const home = tempHome()
  try {
    makeProfile(home, { uninstall: { status: 'uninstalled', archive: '/tmp/archive' } })
    const uninstalled = detectInstallScenario({ profileDir: profileDir(home) })
    assert.equal(uninstalled.mode, 'uninstalled')
    assert.equal(uninstalled.archive, '/tmp/archive')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  const home2 = tempHome()
  try {
    makeProfile(home2, { version: null })
    assert.equal(detectInstallScenario({ profileDir: profileDir(home2) }).mode, 'upgrade-unknown')
  } finally {
    rmSync(home2, { recursive: true, force: true })
  }
})

test('a foreign profile is reported without touching it', () => {
  const home = tempHome()
  try {
    makeProfile(home, { foreign: true })
    assert.equal(detectInstallScenario({ profileDir: profileDir(home) }).mode, 'foreign')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

/** Hash every path and byte under a directory. */
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

test('detection is read-only for every scenario', () => {
  for (const options of [
    {},
    { version: '0.2.0-beta.1' },
    { version: TO },
    { version: '0.2.0-beta.9' },
    { version: '0.2.0-beta.9', state: { status: 'failed', phase: 'files' } },
    { version: undefined },
    { version: '0.2.0-beta.1', uninstall: { status: 'uninstalled', archive: '/tmp/a' } },
    { foreign: true },
  ]) {
    const home = tempHome()
    try {
      const dir = makeProfile(home, options)
      const before = treeHash(home)
      detectInstallScenario({ profileDir: dir })
      detectInstallScenario({ profileDir: dir, allowDowngrade: true })
      assert.equal(treeHash(home), before, JSON.stringify(options))
      assert.equal(existsSync(join(dir, 'node_modules')), false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
})

test('description and field helpers expose the same result', () => {
  const home = tempHome()
  try {
    makeProfile(home, { version: '0.2.0-beta.1' })
    const scenario = detectInstallScenario({ profileDir: profileDir(home) })
    assert.match(describeScenario(scenario, profileDir(home)), /这是一次覆盖升级/u)
    assert.match(describeScenario(scenario, profileDir(home)), /0\.2\.0-beta\.1/u)
    assert.equal(scenarioField(scenario, 'mode'), 'upgrade')
    assert.equal(scenarioField(scenario, 'from'), '0.2.0-beta.1')
    assert.equal(scenarioField(scenario, 'to'), TO)
    assert.equal(scenarioField(scenario, 'blocked'), '0')
    assert.throws(() => scenarioField(scenario, 'nope'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('--json gains scenario fields without changing the existing ones', async () => {
  const home = tempHome()
  try {
    makeProfile(home, { version: '0.2.0-beta.1' })
    const options = parseArgs(['--dry-run', '--dsh-home', home])
    options.preflight = false
    const result = await install(options)
    assert.equal(result.scenario.mode, 'upgrade')
    assert.equal(result.scenario.fromVersion, '0.2.0-beta.1')
    assert.equal(result.scenario.toVersion, TO)
    // Existing fields keep their shape.
    assert.equal(result.profileDir, profileDir(home))
    assert.equal(Array.isArray(result.plan), true)
    assert.equal(Array.isArray(result.warnings), true)
    assert.equal(result.skills.skipped, 'dry-run')
    assert.equal(result.openbayes.status, 'planned')
    // Dry-run still writes nothing.
    assert.equal(existsSync(join(profileDir(home), '.hyperai-install.json')), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
