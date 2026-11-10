/**
 * The result check in install.sh must follow the profile the caller asked for.
 *
 * The end-to-end proof is T6 (`install.sh --profile other`); this pins the shell
 * contract so the names cannot drift back to a hardcoded `hyperai`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install.sh'), 'utf8')

test('install.sh derives the profile directory from --profile', () => {
  assert.match(SCRIPT, /^PROFILE_NAME=hyperai$/mu)
  assert.match(SCRIPT, /--profile\)\s*PROFILE_NAME=\$arg/u)
  assert.match(SCRIPT, /--profile=\*\)\s*PROFILE_NAME=\$\{arg#\*=\}/u)
  assert.match(SCRIPT, /^PROFILE_DIR="\$DSH_HOME\/profiles\/\$PROFILE_NAME"$/mu)
  assert.doesNotMatch(SCRIPT, /^PROFILE_DIR="\$DSH_HOME\/profiles\/hyperai"$/mu)
})

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

/**
 * Run the real `finish_report` shell function for a scenario and return its
 * combined output. The function is extracted from install.sh so the test
 * exercises the shipped shell text instead of a re-implementation.
 */
function finishReportOutput(mode) {
  const match = SCRIPT.match(/^finish_report\(\) \{\n([\s\S]*?)^\}$/mu)
  assert.ok(match, 'finish_report is defined')
  const root = mkdtempSync(join(tmpdir(), 'hyperai-finish-'))
  try {
    const script = join(root, 'finish.sh')
    writeFileSync(script, [
      'say() { printf "%s\\n" "$*"; }',
      'LAUNCHER=/opt/hyperai/bin/hyperai',
      'BIN_DIR=/opt/hyperai/bin',
      'DSH_HOME=/tmp/hyperai-dsh',
      'PATH=/usr/bin:/bin',
      `SCENARIO_MODE=${mode}`,
      "SCENARIO_FROM='0.2.0-beta.1'",
      "SCENARIO_TO='0.2.0-beta.5'",
      `finish_report() {\n${match[1]}\n}`,
      'finish_report',
    ].join('\n'))
    const result = spawnSync('sh', [script], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return `${result.stdout}${result.stderr}`
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('only fresh and uninstalled installs ask for the first-time configuration', () => {
  assert.match(finishReportOutput('fresh'), /首次使用/u)
  assert.match(finishReportOutput('uninstalled'), /首次使用/u)
  assert.doesNotMatch(finishReportOutput('fresh'), /你原来的模型配置可以直接使用/u)

  for (const mode of ['upgrade', 'upgrade-unknown', 'reinstall', 'interrupted', 'downgrade']) {
    const output = finishReportOutput(mode)
    assert.doesNotMatch(output, /首次使用/u, mode)
    assert.match(output, /你原来的模型配置可以直接使用/u, mode)
  }
})

test('the finish summary is specific to each scenario', () => {
  assert.match(finishReportOutput('upgrade'), /已从 0\.2\.0-beta\.1 升级到 0\.2\.0-beta\.5/u)
  assert.match(finishReportOutput('fresh'), /已全新安装 0\.2\.0-beta\.5/u)
  assert.match(finishReportOutput('reinstall'), /已重新安装 0\.2\.0-beta\.5/u)
  assert.match(finishReportOutput('downgrade'), /已降级到 0\.2\.0-beta\.5（降级不做保证）/u)
})
