/**
 * The diagnostics command must always answer, even without a TTY: the splash
 * logo decision must land on the ANSI fallback instead of hanging on a probe.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('diagnose-terminal reports the ANSI fallback without a TTY', () => {
  const stdout = execFileSync(process.execPath, [join(PKG, 'scripts', 'diagnose-terminal.mjs'), '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  })
  const result = JSON.parse(stdout)
  assert.equal(result.tty.stdin, false)
  assert.equal(result.decision.imagesAvailable, false)
  assert.equal(result.decision.protocol, 'none')
  assert.match(result.decision.path, /^ANSI sprite/u)
  assert.ok(result.decision.fallbackReasons.some(reason => /not a TTY/u.test(reason)))
})
