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
