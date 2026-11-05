/**
 * `/openbayes` command bridge for the TUI.
 *
 * Runs the skill's own `scripts/run_graphql.sh` locally: the authorize URL, the
 * one-time code and the token never go through the model, the chat transcript
 * or the session log. The dialogs belong to the TUI chrome; the input answer is
 * handed straight back to the child process.
 *
 * The skill is installed by the profile installer into `~/.agents/skills/`; it
 * is never modified here. `hyperaiOpenbayesCore.js` holds the formatting and
 * validation so it can be tested without React or a terminal.
 */
import React from 'react'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { getLang } from './i18n.js'
import {
  VENDORS, classifyFailure, errorText, firstDiagnostic, loginPromptText, loginSuccessText, logoutConfirmText,
  logoutDoneText, missingSkillText, normalizeCode, parseAuthorize, parseIdentity, parseLoginSuccess, redact,
  statusText, usageText,
} from './hyperaiOpenbayesCore.js'

const LOGIN_TIMEOUT_MS = 60_000
const CODE_TIMEOUT_MS = 120_000
const IDENTITY_TIMEOUT_MS = 30_000
const LOGOUT_TIMEOUT_MS = 30_000
const DIALOG_TIMEOUT_MS = 300_000

/** Current UI language (`zh` / `en`). Resolved at call time, so `/lang` works. */
function lang() {
  return getLang() === 'zh' ? 'zh' : 'en'
}

/** Dialog title for a vendor and a phase. */
function heading(vendor, suffix, langCode) {
  return `${vendor.label}${suffix === undefined ? '' : suffix}`
}

/**
 * Resolve the skill location for a vendor. `HOME` is read at call time so a
 * test can point it at a temporary directory.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ name: string, label: string, consoleTokens: string }} vendor
 */
export function resolveOpenbayesContext(env = process.env, vendor = VENDORS.openbayes) {
  const home = env.HOME || homedir()
  const dir = join(home, '.agents', 'skills', `${vendor.name}-user`)
  const script = join(dir, 'scripts', 'run_graphql.sh')
  return { vendor, home, dir, script, available: existsSync(script) }
}

/** Run the skill CLI with a bounded lifetime; never throws. */
function run(context, args, timeoutMs) {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const settle = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn('bash', [context.script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => settle({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, timedOut }))
    child.on('close', code => settle({ code, stdout, stderr, timedOut }))
  })
}

/**
 * @param {{ channel: any, dialogs: any, vendor?: any }} options
 * @returns {{ login: () => Promise<void>, status: () => Promise<void>, logout: () => Promise<void>, help: () => Promise<void> }}
 */
export function useOpenbayes({ channel, dialogs, vendor = VENDORS.openbayes }) {
  const notify = React.useCallback(message => {
    try { channel.notify(message, { color: 'warning', timeoutMs: 10_000 }) } catch { /* the notification surface is best-effort */ }
  }, [channel])

  /** Persistent result dialog; a manual action must stay visible until dismissed. */
  const showInfo = React.useCallback(async (title, message) => {
    try {
      await dialogs.confirm({
        title,
        message,
        confirmLabel: lang() === 'zh' ? '确定' : 'OK',
        cancelLabel: lang() === 'zh' ? '关闭' : 'Close',
      }, undefined, DIALOG_TIMEOUT_MS)
    } catch {
      notify(message)
    }
  }, [dialogs, notify])

  const readIdentity = React.useCallback(async context => {
    const result = await run(context, ['--vendor', vendor.name, '--identity', '--pretty'], IDENTITY_TIMEOUT_MS)
    if (result.code !== 0) return { error: result }
    try {
      return { identity: parseIdentity(result.stdout) }
    } catch {
      return { error: result }
    }
  }, [vendor])

  const login = React.useCallback(async () => {
    const context = resolveOpenbayesContext(process.env, vendor)
    if (!context.available) {
      await showInfo(heading(vendor, undefined, lang()), missingSkillText(vendor, lang()))
      return
    }
    const started = await run(context, ['--login', '--vendor', vendor.name], LOGIN_TIMEOUT_MS)
    if (started.code !== 0) {
      await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in', lang()),
        errorText(classifyFailure(started), firstDiagnostic(started), lang()))
      return
    }
    const prompt = parseAuthorize(started.stdout)
    if (prompt.url === undefined) {
      await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in', lang()),
        errorText('unknown', firstDiagnostic(started), lang()))
      return
    }
    const proceed = await dialogs.confirm({
      title: heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in', lang()),
      message: loginPromptText(prompt, lang()),
      confirmLabel: lang() === 'zh' ? '已确认，输入一次性码' : 'Confirmed, enter code',
      cancelLabel: lang() === 'zh' ? '取消' : 'Cancel',
    }, undefined, DIALOG_TIMEOUT_MS)
    if (proceed !== true) return

    // The answer is used immediately and never echoed into the chat or logs.
    const answer = await dialogs.input({
      title: lang() === 'zh' ? '输入一次性码（5 分钟内有效）' : 'Enter the one-time code (valid for 5 minutes)',
      placeholder: lang() === 'zh' ? '粘贴一次性码' : 'Paste the one-time code',
    }, undefined, DIALOG_TIMEOUT_MS)
    const checked = normalizeCode(answer)
    if (!checked.ok) {
      if (checked.reason !== 'cancelled') {
        await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in', lang()),
          errorText('code', redact(firstDiagnostic(started), String(answer ?? '')), lang()))
      }
      return
    }

    const exchanged = await run(context, ['--login', '--vendor', vendor.name, '--code', checked.code], CODE_TIMEOUT_MS)
    const detail = redact(firstDiagnostic(exchanged), checked.code)
    if (exchanged.code !== 0) {
      await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in', lang()),
        errorText(classifyFailure(exchanged), detail, lang()))
      return
    }
    const { identity, error } = await readIdentity(context)
    if (identity === undefined) {
      // The exchange already reported success; fall back to its own summary when
      // `--identity` cannot be read (still no token, still no code).
      const success = parseLoginSuccess(exchanged.stdout)
      if (success.expiresAt !== undefined) {
        await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in', lang()),
          loginSuccessText({ expiresAt: success.expiresAt }, lang()))
        return
      }
      await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in', lang()),
        errorText(classifyFailure(error), redact(firstDiagnostic(error), checked.code), lang()))
      return
    }
    await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in', lang()), loginSuccessText(identity, lang()))
  }, [dialogs, readIdentity, showInfo, vendor])

  const status = React.useCallback(async () => {
    const context = resolveOpenbayesContext(process.env, vendor)
    if (!context.available) {
      await showInfo(heading(vendor, undefined, lang()), missingSkillText(vendor, lang()))
      return
    }
    const { identity, error } = await readIdentity(context)
    if (identity !== undefined) {
      await showInfo(heading(vendor, lang() === 'zh' ? ' 状态' : ' status', lang()), statusText(identity, lang()))
      return
    }
    const kind = classifyFailure(error)
    if (kind === 'not-logged-in') {
      await showInfo(heading(vendor, lang() === 'zh' ? ' 状态' : ' status', lang()), statusText(undefined, lang()))
      return
    }
    await showInfo(heading(vendor, lang() === 'zh' ? ' 状态' : ' status', lang()), errorText(kind, firstDiagnostic(error), lang()))
  }, [readIdentity, showInfo, vendor])

  const logout = React.useCallback(async () => {
    const context = resolveOpenbayesContext(process.env, vendor)
    if (!context.available) {
      await showInfo(heading(vendor, undefined, lang()), missingSkillText(vendor, lang()))
      return
    }
    const confirmed = await dialogs.confirm({
      title: lang() === 'zh' ? '退出 OpenBayes 登录？' : 'Sign out of OpenBayes?',
      message: logoutConfirmText(lang()),
      confirmLabel: lang() === 'zh' ? '退出登录' : 'Sign out',
      cancelLabel: lang() === 'zh' ? '取消' : 'Cancel',
    }, undefined, DIALOG_TIMEOUT_MS)
    if (confirmed !== true) return
    const result = await run(context, ['--logout', '--vendor', vendor.name], LOGOUT_TIMEOUT_MS)
    if (result.code !== 0) {
      await showInfo(heading(vendor, lang() === 'zh' ? ' 退出' : ' sign-out', lang()),
        errorText(classifyFailure(result), firstDiagnostic(result), lang()))
      return
    }
    await showInfo(heading(vendor, lang() === 'zh' ? ' 退出' : ' sign-out', lang()),
      logoutDoneText(vendor, hostname(), lang()))
  }, [dialogs, showInfo, vendor])

  const help = React.useCallback(async () => {
    await showInfo(heading(vendor, undefined, lang()), usageText(lang()))
  }, [showInfo, vendor])

  return { login, status, logout, help }
}
