/**
 * Regression guard for the re-check handoff: `blockMissingSkill()` must not
 * call `evaluate()` from inside an active evaluation (the `checking` guard
 * would swallow it and drop the gate). It hands control back to the outer
 * evaluation instead.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../src/hyperaiOpenbayes.js', import.meta.url), 'utf8')

function section(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker)
  const end = SOURCE.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0 && end > start, `missing section ${startMarker}`)
  return SOURCE.slice(start, end)
}

test('the skill-missing retry hands control back instead of nesting evaluate', () => {
  const missing = section('const blockMissingSkill', 'const evaluate')
  assert.doesNotMatch(missing, /(return|await)\s+evaluate\s*\(/u, 'blockMissingSkill must not call evaluate while checking')
  assert.match(missing, /return 'retry'/u)
  const evaluate = section('const evaluate = React.useCallback', 'React.useEffect')
  assert.match(evaluate, /const retry = await blockMissingSkill\(\)/u)
  assert.match(evaluate, /if \(retry !== 'retry'\) return/u)
})

test('the gate stays suspended until the re-check result lands', () => {
  const evaluate = section('const evaluate = React.useCallback', 'React.useEffect')
  // A retry keeps the composer blocked, and every terminal branch clears it.
  assert.match(evaluate, /setBlocked\(true\)\n/u)
  assert.match(evaluate, /decision === 'enter-unauthenticated'[\s\S]*?setBlocked\(false\)/u)
  assert.match(evaluate, /setBlocked\(false\)\n\s*setNotice\(undefined\)/u)
})
