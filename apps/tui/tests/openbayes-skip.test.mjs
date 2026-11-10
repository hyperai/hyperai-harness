/** The remembered "skip sign-in" choice and its startup decisions. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearSkipRecord, gateOptions, readSkipRecord, skipRecordPath, skippedStatusText, startupDecision,
  unauthenticatedText, writeSkipRecord,
} from '../src/hyperaiOpenbayesCore.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'hyperai-skip-'))
}

test('the skip record lives in the TUI state dir with only choice and time', () => {
  const home = tempHome()
  try {
    const env = { HOME: home }
    assert.equal(readSkipRecord(env), undefined)
    const record = writeSkipRecord(env, new Date('2026-01-02T03:04:05Z'))
    assert.equal(record.skipped, true)
    assert.equal(record.at, '2026-01-02T03:04:05.000Z')
    assert.equal(skipRecordPath(env), join(home, '.dsh-tui-hyperai', 'login-skip.json'))
    const raw = JSON.parse(readFileSync(skipRecordPath(env), 'utf8'))
    assert.deepEqual(Object.keys(raw).sort(), ['at', 'skipped'])
    assert.equal(statSync(skipRecordPath(env)).mode & 0o777, 0o600)
    assert.equal(readSkipRecord(env).skipped, true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('clearing, corrupt and foreign files all read as not skipped', () => {
  const home = tempHome()
  try {
    const env = { HOME: home }
    writeSkipRecord(env)
    clearSkipRecord(env)
    assert.equal(readSkipRecord(env), undefined)
    writeSkipRecord(env)
    writeFileSync(skipRecordPath(env), '{not json')
    assert.equal(readSkipRecord(env), undefined)
    writeFileSync(skipRecordPath(env), JSON.stringify({ skipped: false, at: 'x' }))
    assert.equal(readSkipRecord(env), undefined)
    clearSkipRecord(env) // absent is fine
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the startup decision matrix follows the RFC table', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  const valid = { expiresAt: '2026-01-11T00:00:00Z', expired: false }
  const expiring = { expiresAt: '2026-01-03T00:00:00Z', expired: false }
  const expired = { expiresAt: '2025-12-31T00:00:00Z', expired: true }
  for (const [identity, skip, expected] of [
    [valid, undefined, 'enter'],
    [valid, { skipped: true }, 'enter'],
    [expiring, undefined, 'enter'],
    [expiring, { skipped: true }, 'enter'],
    [undefined, undefined, 'gate'],
    [undefined, { skipped: true }, 'enter-unauthenticated'],
    [expired, undefined, 'gate'],
    [expired, { skipped: true }, 'enter-unauthenticated'],
  ]) {
    assert.equal(startupDecision(identity, skip, now), expected, JSON.stringify({ identity, skip }))
  }
})

test('the sign-in screen offers login (default), skip and quit', () => {
  const options = gateOptions('zh')
  assert.equal(options.length, 3)
  assert.equal(options[0].id, 'login')
  assert.equal(options[1].id, 'skip')
  assert.equal(options[2].id, 'exit')
  assert.match(options[1].description, /\/openbayes login/u)
  assert.match(unauthenticatedText('zh'), /未登录 OpenBayes · \/openbayes login/u)
  assert.match(skippedStatusText('zh'), /未登录（已跳过登录）/u)
  assert.match(skippedStatusText('zh'), /\/openbayes login/u)
})
