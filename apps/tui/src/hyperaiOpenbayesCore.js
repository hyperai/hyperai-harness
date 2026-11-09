/**
 * Pure formatting/validation for the OpenBayes TUI bridge.
 *
 * Kept dependency-free (no React, no child_process) so the login prompt, the
 * identity parsing, the error copy and the code hygiene can be unit-tested
 * offline. `hyperaiOpenbayes.js` is the thin React/spawn layer on top.
 *
 * The vendor is a parameter, not a constant in the logic: adding `/hyperai`
 * later should only register another command with a different descriptor.
 */

/** Console pages used in the copy; a future vendor only supplies its own. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const VENDORS = Object.freeze({
  openbayes: Object.freeze({
    name: 'openbayes',
    label: 'OpenBayes',
    consoleTokens: 'https://openbayes.com/console/settings/account/personalAccessToken',
  }),
})

/** Longest one-time code we accept; the real ones are far shorter. */
const MAX_CODE_LENGTH = 512

/** Translation pair helper; `lang` is `zh` or anything else for English. */
function pick(lang, zh, en) {
  return lang === 'zh' ? zh : en
}

/**
 * Reject empty/oversized/control-character codes before they become argv.
 * @param {string | undefined} raw Answer from the dialog.
 * @returns {{ ok: boolean, code?: string, reason?: string }}
 */
export function normalizeCode(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'cancelled' }
  const code = raw.trim()
  if (code === '') return { ok: false, reason: 'empty' }
  if (code.length > MAX_CODE_LENGTH) return { ok: false, reason: 'too-long' }
  if (/[\u0000-\u001f\u007f]/u.test(code)) return { ok: false, reason: 'control' }
  return { ok: true, code }
}

/** The character the TUI shows for each masked code cell. */
export const MASK_CHAR = '•'

/**
 * What the masked input renders for a value: one bullet per code point, so the
 * cursor offset and visible width stay aligned with the raw text.
 * @param {string} value
 * @returns {string}
 */
export function maskedInput(value) {
  return MASK_CHAR.repeat([...String(value)].length)
}

/** Remove a secret from any text that might be shown or logged. */
export function redact(text, secret) {
  if (typeof text !== 'string' || typeof secret !== 'string' || secret === '') return text
  return text.split(secret).join('***')
}

/**
 * Parse the first stage of `--login`: the authorize URL, endpoint and device.
 * @param {string} stdout
 */
export function parseAuthorize(stdout) {
  const text = typeof stdout === 'string' ? stdout : ''
  const url = text.match(/https?:\/\/\S+?authorize\S*/u)?.[0] ?? text.match(/https?:\/\/\S+/u)?.[0]
  const device = text.match(/^Device:\s*(.+)$/mu)?.[1]?.trim()
  const endpoint = text.match(/^Endpoint:\s*(.+)$/mu)?.[1]?.trim()
  return { url, device, endpoint }
}

/**
 * Parse `--identity` (JSON) into the small view the dialogs need.
 * @param {string} stdout
 */
export function parseIdentity(stdout) {
  const value = JSON.parse(stdout)
  if (value === null || typeof value !== 'object') throw new Error('identity returned no object')
  const username = typeof value.sub === 'string' && value.sub !== '' ? value.sub : undefined
  return {
    vendor: typeof value.vendor === 'string' ? value.vendor : undefined,
    username,
    expiresAt: typeof value.expires_at === 'string' ? value.expires_at : undefined,
    expired: value.expired === true,
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : undefined,
  }
}

/**
 * Parse the second stage confirmation line
 * (`Logged in as vendor "openbayes" (token name: …, expires: …).`).
 * @param {string} stdout
 */
export function parseLoginSuccess(stdout) {
  const text = typeof stdout === 'string' ? stdout : ''
  const tokenName = text.match(/token name:\s*([^,)]+)/u)?.[1]?.trim()
  const expiresAt = text.match(/expires:\s*([^)]+)\)/u)?.[1]?.trim()
  return { tokenName, expiresAt }
}

/**
 * Classify a failed command into the error kinds the copy distinguishes.
 * @param {{ code?: number, stdout?: string, stderr?: string, timedOut?: boolean }} result
 */
export function classifyFailure(result = {}) {
  if (result.timedOut === true) return 'timeout'
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (/MISSING_TOKEN/u.test(text)) return 'not-logged-in'
  if (/\b401\b|Unauthorized|AUTH_|invalid[_ ]token|token[_ ]invalid|认证失败|登录已失效|已被吊销/iu.test(text)) return 'rejected'
  if (/LOGIN_EXCHANGE_FAILED|LOGIN_PENDING_EXPIRED|NO_PENDING_LOGIN|授权码无效|已过期|invalid|expired/iu.test(text)) return 'code'
  if (/'node' not found|Node\.js 18\+|node: command not found/iu.test(text)) return 'node'
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|timeout|timed out|网络/iu.test(text)) return 'network'
  return 'unknown'
}

/** First non-empty diagnostic line, for the generic error copy. */
export function firstDiagnostic(result = {}) {
  const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
  const line = text.split('\n').map(item => item.trim()).find(item => item !== '')
  return line ?? ''
}

/** `status` copy: logged in with name/expiry, or the not-logged-in hint. */
export function statusText(identity, lang = 'zh') {
  if (identity === undefined) {
    return pick(lang,
      '未登录 OpenBayes。执行 /openbayes login 登录。',
      'Not signed in to OpenBayes. Run /openbayes login.')
  }
  const name = identity.username ?? '（未知用户）'
  const expiry = identity.expiresAt ?? '（未知）'
  const state = identity.expired
    ? pick(lang, '已过期，请重新登录', 'expired; sign in again')
    : pick(lang, '有效', 'valid')
  return pick(lang,
    `已登录 OpenBayes\n用户名：${name}\n到期：${expiry}\n状态：${state}`,
    `Signed in to OpenBayes\nUser: ${name}\nExpires: ${expiry}\nState: ${state}`)
}

/** Login dialog copy; the URL is shown before the code is requested. */
export function loginPromptText({ url, device }, lang = 'zh') {
  return pick(lang,
    `用已经登录 OpenBayes 的浏览器打开下面的链接，确认后把一次性码粘贴到下一步的输入框：\n\n${url}\n\n` +
      `令牌有效期按需选择（日常建议 7 天或 30 天）。${device === undefined ? '' : `\n设备名：${device}`}`,
    `Open this URL in a browser already signed in to OpenBayes, confirm, then paste the one-time code in the next dialog:\n\n${url}\n\n` +
      `Pick the token lifetime you need (7 or 30 days for daily use).${device === undefined ? '' : `\nDevice: ${device}`}`)
}

/** Success copy after the code exchange. */
export function loginSuccessText(identity, lang = 'zh') {
  const name = identity?.username ?? '（未知用户）'
  const expiry = identity?.expiresAt ?? '（未知）'
  return pick(lang,
    `登录成功。用户名：${name}\n令牌到期：${expiry}`,
    `Signed in. User: ${name}\nToken expires: ${expiry}`)
}

/** Logout confirmation, then the message that explains server-side revocation. */
export function logoutConfirmText(lang = 'zh') {
  return pick(lang,
    '退出后这台机器上的登录会被删除。服务端的令牌仍然有效，需要到控制台手动吊销。',
    'Signing out removes the local session only. The server-side token stays valid until you revoke it in the console.')
}

export function logoutDoneText(vendor, device, lang = 'zh') {
  const suffix = device === undefined ? '' : ` · ${device}`
  return pick(lang,
    `本地登录已删除。服务端的令牌仍然有效，如需彻底撤销，请到 ${vendor.consoleTokens} 吊销名为 'CLI${suffix}' 的令牌。`,
    `Local session deleted. The server-side token is still valid; revoke 'CLI${suffix}' at ${vendor.consoleTokens}).`)
}

/** Missing-skill copy with the manual install command. */
export function missingSkillText(vendor, lang = 'zh') {
  return pick(lang,
    `没有找到 ${vendor.name}-user。请重新运行安装包，或手动安装：\n\nnpx skills add https://openbayes.com/skills/${vendor.name}-user`,
    `${vendor.name}-user was not found. Re-run the installer, or install it manually:\n\nnpx skills add https://openbayes.com/skills/${vendor.name}-user`)
}

/** Error copy keyed by {@link classifyFailure}. */
export function errorText(kind, detail, lang = 'zh') {
  const tail = detail === undefined || detail === '' ? '' : `\n${detail}`
  switch (kind) {
    case 'not-logged-in':
      return pick(lang,
        '未登录 OpenBayes。执行 /openbayes login 登录。',
        'Not signed in to OpenBayes. Run /openbayes login.')
    case 'code':
      return pick(lang,
        '一次性码无效或已过期。请重新执行 /openbayes login。',
        'The one-time code is invalid or expired. Run /openbayes login again.')
    case 'node':
      return pick(lang,
        '找不到 Node.js（openbayes-user 需要 18 及以上）。请先安装 Node.js，再重新登录。',
        'Node.js 18+ was not found (required by openbayes-user). Install it and try again.')
    case 'network':
      return pick(lang,
        '网络请求失败，请检查网络后重试。',
        'The network request failed. Check connectivity and try again.')
    case 'timeout':
      return pick(lang,
        '操作超时。请检查网络后重试。',
        'The operation timed out. Check connectivity and try again.')
    default:
      return pick(lang, `OpenBayes 操作失败。${tail}`, `OpenBayes failed.${tail}`)
  }
}

/** `/openbayes` usage when no (or an unknown) subcommand is given. */
export function usageText(lang = 'zh') {
  return pick(lang,
    '用法：\n/openbayes login   登录 OpenBayes\n/openbayes status  查看登录状态\n/openbayes logout  退出登录（只删除本地 session）',
    'Usage:\n/openbayes login   sign in\n/openbayes status  show sign-in status\n/openbayes logout  sign out (local session only)')
}

/** How close to expiry a session must be before the startup notice appears. */
export const EXPIRY_NOTICE_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Milliseconds from now until `expiresAt`, or undefined when unparseable.
 * @param {string | undefined} expiresAt ISO timestamp from `--identity`.
 * @param {number} now epoch milliseconds (tests pass a fixed clock).
 */
export function millisUntilExpiry(expiresAt, now = Date.now()) {
  if (typeof expiresAt !== 'string') return undefined
  const at = Date.parse(expiresAt)
  if (Number.isNaN(at)) return undefined
  return at - now
}

/** Whole days shown to a person; zero or negative stays 0. */
export function daysUntilExpiry(expiresAt, now = Date.now()) {
  const remaining = millisUntilExpiry(expiresAt, now)
  if (remaining === undefined || remaining <= 0) return 0
  return Math.ceil(remaining / 86_400_000)
}

/**
 * Classify a session from the offline `--identity` view.
 * @param {{ expired?: boolean, expiresAt?: string } | undefined} identity
 * @param {number} now
 * @returns {{ state: 'missing'|'expired'|'expiring'|'valid'|'unknown', days?: number, expiresAt?: string }}
 */
export function classifySession(identity, now = Date.now()) {
  if (identity === undefined) return { state: 'missing' }
  if (identity.expired === true) return { state: 'expired', expiresAt: identity.expiresAt }
  const remaining = millisUntilExpiry(identity.expiresAt, now)
  if (remaining === undefined) return { state: 'unknown', expiresAt: identity.expiresAt }
  if (remaining <= 0) return { state: 'expired', expiresAt: identity.expiresAt, days: 0 }
  if (remaining < EXPIRY_NOTICE_MS) {
    return { state: 'expiring', days: daysUntilExpiry(identity.expiresAt, now), expiresAt: identity.expiresAt }
  }
  return { state: 'valid', days: daysUntilExpiry(identity.expiresAt, now), expiresAt: identity.expiresAt }
}

/** The startup gate is skipped only for the exact value `off`. */
export function loginGateSkipped(env = process.env) {
  return env.HYPERAI_LOGIN_GATE === 'off'
}

/** Persistent banner while the gate is skipped (test-only). */
export function skippedGateText(lang = 'zh') {
  return pick(lang, '测试模式：已跳过 OpenBayes 登录', 'Test mode: OpenBayes sign-in skipped')
}

/** Title + body of the blocking sign-in screen. */
export function gateText(state, vendor, lang = 'zh') {
  const expiryHint = state.expiresAt === undefined ? '' : `\n（到期时间：${state.expiresAt}）`
  const body = pick(lang,
    `你可以登录 OpenBayes（推荐），也可以跳过；跳过不影响非 OpenBayes 功能。\n\n` +
      `1. 选择下面的「登录 OpenBayes」；\n2. 用已登录 OpenBayes 的浏览器打开显示的链接；\n3. 确认后把一次性码粘贴回输入框。\n\n` +
      `按 Ctrl+D 退出程序。`,
    `Sign in to OpenBayes (recommended) or skip; skipping keeps all non-OpenBayes features available.\n\n` +
      `1. Choose "Sign in to OpenBayes" below.\n2. Open the link in a browser signed in to OpenBayes.\n3. Paste the one-time code back here.\n\n` +
      `Press Ctrl+D to quit.`)
  let reason = ''
  if (state.state === 'expired') {
    reason = pick(lang, `OpenBayes 登录已过期，请重新登录。${expiryHint}`, `OpenBayes sign-in expired; sign in again.${expiryHint}`)
  } else if (state.state === 'missing') {
    reason = pick(lang, '这台电脑还没有登录过 OpenBayes。', 'This computer has not signed in to OpenBayes yet.')
  } else if (state.state === 'rejected') {
    reason = pick(lang, 'OpenBayes 登录已失效，请重新登录。', 'OpenBayes sign-in is no longer valid; sign in again.')
  }
  return { title: pick(lang, '登录 OpenBayes（推荐）', 'Sign in to OpenBayes (recommended)'), message: reason === '' ? body : `${reason}\n\n${body}` }
}

/** One-time startup notice for a session that is about to expire. */
export function expiringNoticeText(days, lang = 'zh') {
  return pick(lang,
    `OpenBayes 登录将在 ${days} 天后到期，输入 /openbayes login 续期。`,
    `OpenBayes sign-in expires in ${days} day(s); run /openbayes login to renew.`)
}

/** One-time notices for online failures. */
export function onlineNoticeText(kind, lang = 'zh') {
  if (kind === 'network') {
    return pick(lang, '暂时连不上 OpenBayes，相关功能可能用不了。', 'Cannot reach OpenBayes right now; related features may not work.')
  }
  if (kind === 'rejected') {
    return pick(lang, 'OpenBayes 登录已失效，请输入 /openbayes login 重新登录。', 'OpenBayes sign-in is no longer valid; run /openbayes login.')
  }
  return undefined
}

/** Session expired while the app was running: one warning, no interruption. */
export function expiredDuringUseText(lang = 'zh') {
  return pick(lang,
    'OpenBayes 登录已过期。现在可以输入 /openbayes login 续期；不续期的话，下次启动时会回到登录界面。',
    'OpenBayes sign-in expired. Run /openbayes login to renew; otherwise the next launch will ask you to sign in.')
}


/** Where the "skip sign-in" preference lives (HyperAI's own TUI state). */
export function skipRecordPath(env = process.env) {
  const home = env.HOME || homedir()
  return join(home, '.dsh-tui-hyperai', 'login-skip.json')
}

/**
 * Read the skip preference. A missing or malformed file means "not skipped";
 * the file contains only the choice and a timestamp, never account data.
 */
export function readSkipRecord(env = process.env) {
  const path = skipRecordPath(env)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed?.skipped !== true) return undefined
    return { skipped: true, at: typeof parsed.at === 'string' ? parsed.at : undefined }
  } catch {
    return undefined
  }
}

/** Persist the skip choice; returns the record that was written. */
export function writeSkipRecord(env = process.env, now = new Date()) {
  const path = skipRecordPath(env)
  const record = { skipped: true, at: now.toISOString() }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, undefined, 2)}\n`, { mode: 0o600 })
  return record
}

/** Forget the skip choice (after a successful login). */
export function clearSkipRecord(env = process.env) {
  rmSync(skipRecordPath(env), { force: true })
}

/**
 * Startup decision with the skip preference applied.
 * @returns {'enter'|'enter-unauthenticated'|'gate'}
 */
export function startupDecision(identity, skipRecord, now = Date.now()) {
  const session = classifySession(identity, now)
  if (session.state === 'valid' || session.state === 'expiring') return 'enter'
  if (skipRecord?.skipped === true) return 'enter-unauthenticated'
  return 'gate'
}

/** Persistent status-line text while the person uses the app without signing in. */
export function unauthenticatedText(lang = 'zh') {
  return pick(lang, '未登录 OpenBayes · /openbayes login', 'OpenBayes: signed out · /openbayes login')
}

/** `/openbayes status` copy when there is no session but the person skipped. */
export function skippedStatusText(lang = 'zh') {
  return pick(lang,
    '未登录（已跳过登录）\n输入 /openbayes login 可以登录。',
    'Signed out (sign-in was skipped)\nRun /openbayes login to sign in.')
}

/** The three-way sign-in screen: login (default), skip, quit. */
export function gateOptions(lang = 'zh') {
  return [
    { value: 'login', label: pick(lang, '登录 OpenBayes', 'Sign in to OpenBayes'), description: pick(lang, '推荐；登录后可以使用 OpenBayes 相关功能', 'Recommended; enables OpenBayes features') },
    { value: 'skip', label: pick(lang, '跳过', 'Skip'), description: pick(lang, '不登录也能正常使用；以后随时可以输入 /openbayes login 登录', 'Use the app without signing in; run /openbayes login later') },
    { value: 'exit', label: pick(lang, '退出程序', 'Quit'), description: pick(lang, '按 Ctrl+D 也可以退出', 'Ctrl+D also quits') },
  ]
}
