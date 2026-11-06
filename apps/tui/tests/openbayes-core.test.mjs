/**
 * Behaviour of the `/openbayes` copy and parsing layer.
 *
 * The bridge itself is a thin spawn layer; everything a person (or a log) can
 * see is decided here, including that a one-time code never becomes part of a
 * message. These tests therefore pin the wording contract and the redaction.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  VENDORS, MASK_CHAR, classifyFailure, errorText, firstDiagnostic, loginPromptText, loginSuccessText,
  logoutConfirmText, logoutDoneText, maskedInput, missingSkillText, normalizeCode, parseAuthorize, parseIdentity,
  parseLoginSuccess, redact, statusText, usageText,
} from '../src/hyperaiOpenbayesCore.js'

const LOGIN_OUTPUT = `Vendor: openbayes
Endpoint: https://openbayes.com/gateway/graphql
Device: dev-laptop

1. 在浏览器打开下面的授权页（需已登录该环境控制台）：
   https://openbayes.com/console/settings/account/cli/authorize?code_challenge=abc&device=dev-laptop
`

test('the authorize URL, endpoint and device are read from the first stage', () => {
  const parsed = parseAuthorize(LOGIN_OUTPUT)
  assert.match(parsed.url, /^https:\/\/openbayes\.com\/console\/settings\/account\/cli\/authorize\?/u)
  assert.equal(parsed.endpoint, 'https://openbayes.com/gateway/graphql')
  assert.equal(parsed.device, 'dev-laptop')
})

test('identity JSON becomes the status view without the token', () => {
  const identity = parseIdentity(JSON.stringify({
    vendor: 'openbayes',
    endpoint: 'https://openbayes.com/gateway/graphql',
    token_source: 'session:openbayes',
    sub: 'alice',
    kind: 'pat',
    jti: 'jti-value',
    expires_at: '2026-12-01T00:00:00Z',
    expired: false,
    verified: false,
  }))
  assert.equal(identity.username, 'alice')
  assert.equal(identity.expiresAt, '2026-12-01T00:00:00Z')
  assert.equal(identity.expired, false)
  assert.deepEqual(Object.keys(identity).sort(), ['endpoint', 'expired', 'expiresAt', 'username', 'vendor'])
})

test('login success line yields expiry and no token', () => {
  const parsed = parseLoginSuccess('Logged in as vendor "openbayes" (token name: CLI · dev-laptop, expires: 2026-12-01T00:00:00Z).\n')
  assert.equal(parsed.tokenName, 'CLI · dev-laptop')
  assert.equal(parsed.expiresAt, '2026-12-01T00:00:00Z')
})

test('failures carry the kinds the copy distinguishes', () => {
  assert.equal(classifyFailure({ code: 1, stderr: '[MISSING_TOKEN] Not logged in.' }), 'not-logged-in')
  assert.equal(classifyFailure({ code: 1, stderr: '[LOGIN_EXCHANGE_FAILED] 授权码无效或已过期' }), 'code')
  assert.equal(classifyFailure({ code: 1, stderr: "[ERROR] 'node' not found in PATH" }), 'node')
  assert.equal(classifyFailure({ code: 1, stderr: 'request failed: getaddrinfo ENOTFOUND openbayes.com' }), 'network')
  assert.equal(classifyFailure({ code: 1, timedOut: true }), 'timeout')
  assert.equal(classifyFailure({ code: 1, stderr: 'boom' }), 'unknown')
})

test('a code is trimmed, bounded and rejects control characters', () => {
  assert.deepEqual(normalizeCode('  abc-123  '), { ok: true, code: 'abc-123' })
  assert.equal(normalizeCode(undefined).reason, 'cancelled')
  assert.equal(normalizeCode('   ').reason, 'empty')
  assert.equal(normalizeCode('x'.repeat(513)).reason, 'too-long')
  assert.equal(normalizeCode('abc\u0007').reason, 'control')
})

test('redaction removes the code from diagnostics', () => {
  const message = 'LOGIN_EXCHANGE_FAILED: code abc-123 rejected'
  assert.equal(redact(message, 'abc-123'), 'LOGIN_EXCHANGE_FAILED: code *** rejected')
  assert.equal(redact(message, ''), message)
  assert.equal(redact(message, undefined), message)
})

test('error copy is actionable and never includes the code', () => {
  const code = 'secret-one-time-code'
  const message = errorText('code', redact(`[LOGIN_EXCHANGE_FAILED] 授权码无效：${code}`, code))
  assert.match(message, /一次性码无效或已过期/u)
  assert.match(message, /\/openbayes login/u)
  assert.equal(message.includes(code), false)
  assert.match(errorText('node'), /Node\.js/u)
  assert.match(errorText('network'), /网络/u)
  assert.match(errorText('timeout'), /超时/u)
  assert.match(errorText('not-logged-in'), /\/openbayes login/u)
})

test('status copy distinguishes signed-in, expired and signed-out', () => {
  assert.match(statusText(undefined), /未登录/u)
  assert.match(statusText(undefined), /\/openbayes login/u)
  const valid = statusText({ username: 'alice', expiresAt: '2026-12-01T00:00:00Z', expired: false })
  assert.match(valid, /alice/u)
  assert.match(valid, /有效/u)
  assert.match(statusText({ username: 'alice', expiresAt: '2020-01-01T00:00:00Z', expired: true }), /已过期/u)
})

test('login and logout copy contains the URL / revocation hint', () => {
  assert.match(loginPromptText({ url: 'https://example.test/authorize?x=1', device: 'laptop' }), /https:\/\/example\.test\/authorize/u)
  assert.match(loginPromptText({ url: 'https://example.test/a', device: 'laptop' }), /laptop/u)
  assert.match(loginSuccessText({ username: 'alice', expiresAt: '2026-12-01T00:00:00Z' }), /alice/u)
  assert.match(logoutConfirmText(), /服务端的令牌仍然有效/u)
  assert.match(logoutDoneText(VENDORS.openbayes, 'laptop'), /personalAccessToken/u)
  assert.match(logoutDoneText(VENDORS.openbayes, 'laptop'), /CLI · laptop/u)
})

test('missing skill copy tells the person how to install it', () => {
  assert.match(missingSkillText(VENDORS.openbayes), /openbayes-user was not found|没有找到 openbayes-user/u)
  assert.match(missingSkillText(VENDORS.openbayes), /npx skills add https:\/\/openbayes\.com\/skills\/openbayes-user/u)
})

test('usage lists exactly the three supported subcommands', () => {
  const usage = usageText()
  assert.match(usage, /\/openbayes login/u)
  assert.match(usage, /\/openbayes status/u)
  assert.match(usage, /\/openbayes logout/u)
  assert.equal(usage.includes('/hyperai'), false)
})

test('firstDiagnostic prefers stderr and skips blank lines', () => {
  assert.equal(firstDiagnostic({ stderr: '\n  boom  \nrest', stdout: 'out' }), 'boom')
  assert.equal(firstDiagnostic({}), '')
})

test('the masked rendering hides every character and keeps the raw value for submission', () => {
  const code = 'sample-secret-code'
  const masked = maskedInput(code)
  assert.equal(masked, MASK_CHAR.repeat(code.length))
  assert.equal(masked.includes('sample'), false)
  assert.equal([...masked].length, [...code].length)
  // The dialog resolves with the raw value; masking is display-only.
  assert.equal(normalizeCode(code).code, code)
})

test('the mask is opt-in: only the login dialog asks for it', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
  const bridge = readFileSync(join(pkg, 'src', 'hyperaiOpenbayes.js'), 'utf8')
  assert.match(bridge, /kind: 'input'[\s\S]*?mask: true/u)
  const patch = readFileSync(join(pkg, 'patches', 'dsh-tui@0.16.1.patch'), 'utf8')
  assert.match(patch, /dialog\.mask === true \?/u)
  // Every other source module must leave the option unset (default: plain text).
  const offenders = []
  for (const file of readdirSync(join(pkg, 'src'))) {
    if (file === 'hyperaiOpenbayes.js' || !file.endsWith('.js')) continue
    if (/\bmask:\s*true\b/u.test(readFileSync(join(pkg, 'src', file), 'utf8'))) offenders.push(file)
  }
  assert.deepEqual(offenders, [])
})
