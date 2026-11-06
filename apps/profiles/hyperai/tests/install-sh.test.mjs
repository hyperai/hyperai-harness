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
