/**
 * `/openbayes` command bridge and the startup sign-in gate for the TUI.
 *
 * Runs the skill's own `scripts/run_graphql.sh` locally: the authorize URL, the
 * one-time code and the token never go through the model, the chat transcript
 * or the session log. The gate blocks the chat with a managed dialog until a
 * session exists; a valid session enters directly, and a session close to
 * expiry only produces one startup notice.
 *
 * The skill is installed by the profile installer into `~/.agents/skills/`; it
 * is never modified here. `hyperaiOpenbayesCore.js` holds the formatting,
 * expiry math and validation so it can be tested without React or a terminal.
 */
import React from 'react'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { getLang } from './i18n.js'
import {
  VENDORS, classifyFailure, classifySession, errorText, expiredDuringUseText, expiringNoticeText, firstDiagnostic,
  gateText, loginGateSkipped, loginPromptText, loginSuccessText, logoutConfirmText, logoutDoneText,
  missingSkillText, normalizeCode, onlineNoticeText, parseAuthorize, parseIdentity, parseLoginSuccess, redact,
  clearSkipRecord, gateOptions, readSkipRecord, skippedGateText, skippedStatusText, startupDecision, statusText, unauthenticatedText, usageText, writeSkipRecord,
} from './hyperaiOpenbayesCore.js'

const LOGIN_TIMEOUT_MS = 60_000
const CODE_TIMEOUT_MS = 120_000
const IDENTITY_TIMEOUT_MS = 30_000
const WHOAMI_TIMEOUT_MS = 15_000
const LOGOUT_TIMEOUT_MS = 30_000
const DIALOG_TIMEOUT_MS = 300_000
/** Long enough to wait for a person; JS timers overflow above 2^31-1 ms. */
const GATE_DIALOG_TIMEOUT_MS = 24 * 60 * 60 * 1000
const EXPIRY_POLL_MS = 10_000

/** Current UI language (`zh` / `en`). Resolved at call time, so `/lang` works. */
function lang() {
  return getLang() === 'zh' ? 'zh' : 'en'
}

/** Dialog title for a vendor and a phase. */
function heading(vendor, suffix) {
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

/** Read the offline identity of the current vendor. */
export async function readIdentityOnce(vendor = VENDORS.openbayes) {
  const context = resolveOpenbayesContext(process.env, vendor)
  if (!context.available) return { error: { code: -1, stdout: '', stderr: 'skill missing' }, missing: true }
  const result = await run(context, ['--vendor', vendor.name, '--identity', '--pretty'], IDENTITY_TIMEOUT_MS)
  if (result.code !== 0) return { error: result }
  try {
    return { identity: parseIdentity(result.stdout) }
  } catch {
    return { error: result }
  }
}

/** One lightweight online identity check (`whoami`); never blocks the first frame. */
export async function verifyOnline(vendor = VENDORS.openbayes) {
  const context = resolveOpenbayesContext(process.env, vendor)
  if (!context.available) return { kind: 'missing' }
  const whoami = join(context.dir, 'references', 'graphql-operations', 'common', 'whoami.graphql')
  const result = await run(context, ['--vendor', vendor.name, '--query-file', whoami], WHOAMI_TIMEOUT_MS)
  if (result.code === 0) return { ok: true }
  return { kind: classifyFailure(result) }
}

/**
 * The shared sign-in flow used by `/openbayes login` and the startup gate.
 * Returns `{ ok: true }` only after the exchange and identity read succeed.
 * @param {{ dialogs: any, vendor?: any, notify?: (message: string) => void }} options
 */
export async function runLoginFlow({ dialogs, vendor = VENDORS.openbayes, notify = () => {} }) {
  const showInfo = async (title, message) => {
    try {
      await dialogs.ask({
        kind: 'confirm',
        title,
        message,
        confirmLabel: lang() === 'zh' ? '确定' : 'OK',
        cancelLabel: lang() === 'zh' ? '关闭' : 'Close',
      }, undefined, DIALOG_TIMEOUT_MS)
    } catch {
      notify(message)
    }
  }
  const context = resolveOpenbayesContext(process.env, vendor)
  if (!context.available) {
    await showInfo(heading(vendor), missingSkillText(vendor, lang()))
    return { ok: false, missing: true }
  }
  const started = await run(context, ['--login', '--vendor', vendor.name], LOGIN_TIMEOUT_MS)
  if (started.code !== 0) {
    await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in'),
      errorText(classifyFailure(started), firstDiagnostic(started), lang()))
    return { ok: false, kind: classifyFailure(started) }
  }
  const prompt = parseAuthorize(started.stdout)
  if (prompt.url === undefined) {
    await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in'), errorText('unknown', firstDiagnostic(started), lang()))
    return { ok: false, kind: 'unknown' }
  }
  const proceed = await dialogs.ask({
    kind: 'confirm',
    title: heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in'),
    message: loginPromptText(prompt, lang()),
    confirmLabel: lang() === 'zh' ? '已确认，输入一次性码' : 'Confirmed, enter code',
    cancelLabel: lang() === 'zh' ? '取消' : 'Cancel',
  }, undefined, DIALOG_TIMEOUT_MS)
  if (proceed !== true) return { ok: false, cancelled: true }

  const answer = await dialogs.ask({
    kind: 'input',
    title: lang() === 'zh' ? '输入一次性码（5 分钟内有效）' : 'Enter the one-time code (valid for 5 minutes)',
    placeholder: lang() === 'zh' ? '粘贴一次性码' : 'Paste the one-time code',
    mask: true,
    initial: '',
  }, undefined, DIALOG_TIMEOUT_MS)
  const checked = normalizeCode(answer)
  if (!checked.ok) {
    if (checked.reason !== 'cancelled') {
      await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in'),
        errorText('code', redact(firstDiagnostic(started), String(answer ?? '')), lang()))
    }
    return { ok: false, kind: checked.reason === 'cancelled' ? 'cancelled' : 'code' }
  }

  const exchanged = await run(context, ['--login', '--vendor', vendor.name, '--code', checked.code], CODE_TIMEOUT_MS)
  const detail = redact(firstDiagnostic(exchanged), checked.code)
  if (exchanged.code !== 0) {
    await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in'), errorText(classifyFailure(exchanged), detail, lang()))
    return { ok: false, kind: classifyFailure(exchanged) }
  }
  const { identity, error } = await readIdentityOnce(vendor)
  if (identity === undefined) {
    const success = parseLoginSuccess(exchanged.stdout)
    if (success.expiresAt !== undefined) {
      await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in'), loginSuccessText({ expiresAt: success.expiresAt }, lang()))
      return { ok: true, identity: { expiresAt: success.expiresAt, expired: false } }
    }
    await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in'),
      errorText(classifyFailure(error), redact(firstDiagnostic(error), checked.code), lang()))
    return { ok: false, kind: classifyFailure(error) }
  }
  await showInfo(heading(vendor, lang() === 'zh' ? ' 登录' : ' sign-in'), loginSuccessText(identity, lang()))
  return { ok: true, identity }
}

/**
 * Startup sign-in gate. Mounted once by the Chat screen; it owns the blocking
 * dialog loop and the one-shot notices.
 * @param {{ channel: any, dialogs: any, vendor?: any }} options
 */
export function useOpenbayesGate({ channel, dialogs, vendor = VENDORS.openbayes, onExit = () => {} }) {
  const skipped = loginGateSkipped(process.env)
  const [notice, setNotice] = React.useState(skipped ? skippedGateText(lang()) : undefined)
  const [blocked, setBlocked] = React.useState(false)
  const gateRef = React.useRef(false)
  const expiringNotified = React.useRef(false)
  const onlineNotified = React.useRef(false)
  const expiredNotified = React.useRef(false)
  const checking = React.useRef(false)

  const notify = React.useCallback(message => {
    try { channel.notify(message, { color: 'warning', timeoutMs: 12_000 }) } catch { /* best-effort */ }
  }, [channel])

  /** Leave the gate for a while, remembering the choice on disk. */
  const skipGate = React.useCallback(() => {
    writeSkipRecord()
    gateRef.current = false
    setBlocked(false)
    setNotice(unauthenticatedText(lang()))
  }, [])

  /** Block the chat until sign-in succeeds; the dialog reopens on cancel/Esc. */
  const blockUntilSignedIn = React.useCallback(async state => {
    if (gateRef.current) return
    gateRef.current = true
    setBlocked(true)
    try {
      while (gateRef.current) {
        const text = gateText(state, vendor, lang())
        let choice
        try {
          choice = await dialogs.ask({
            kind: 'select',
            title: text.title,
            message: text.message,
            options: gateOptions(lang()),
          }, undefined, GATE_DIALOG_TIMEOUT_MS)
        } catch {
          continue
        }
        if (choice === 'exit') {
          gateRef.current = false
          setBlocked(false)
          onExit()
          return
        }
        if (choice === 'skip') {
          skipGate()
          return
        }
        if (choice !== 'login') continue
        const result = await runLoginFlow({ dialogs, vendor, notify })
        if (!result.ok) continue
        const checked = await readIdentityOnce(vendor)
        const next = checked.identity === undefined ? { state: 'valid' } : classifySession(checked.identity)
        if (next.state === 'valid' || next.state === 'expiring') {
          gateRef.current = false
          setBlocked(false)
          clearSkipRecord()
          setNotice(undefined)
          void verifyOnline(vendor).then(online => {
            const message = online.kind === undefined ? undefined : onlineNoticeText(online.kind, lang())
            if (message !== undefined && !onlineNotified.current) {
              onlineNotified.current = true
              notify(message)
            }
          })
          return
        }
        state = next.state === 'expired' ? { state: 'expired', expiresAt: next.expiresAt } : { state: 'rejected' }
      }
    } finally {
      gateRef.current = false
    }
  }, [dialogs, notify, vendor])

  /** Skill missing: explain, offer manual install and a re-check loop. */
  const blockMissingSkill = React.useCallback(async () => {
    gateRef.current = true
    setBlocked(true)
    try {
      while (gateRef.current) {
        let choice
        try {
          choice = await dialogs.ask({
            kind: 'select',
            title: lang() === 'zh' ? '登录 OpenBayes（推荐）' : 'Sign in to OpenBayes (recommended)',
            message: `${missingSkillText(vendor, lang())}\n\n${lang() === 'zh' ? '手动安装后选择「重新检测」；也可以先跳过。' : 'After installing, choose "Check again"; you can also skip.'}`,
            options: [
              { id: 'retry', label: lang() === 'zh' ? '重新检测' : 'Check again' },
              { id: 'skip', label: lang() === 'zh' ? '跳过' : 'Skip' },
              { id: 'exit', label: lang() === 'zh' ? '退出程序' : 'Quit' },
            ],
          }, undefined, GATE_DIALOG_TIMEOUT_MS)
        } catch {
          continue
        }
        if (choice === 'exit') {
          gateRef.current = false
          setBlocked(false)
          onExit()
          return
        }
        if (choice === 'skip') {
          skipGate()
          return
        }
        if (choice !== 'retry') continue
        const context = resolveOpenbayesContext(process.env, vendor)
        if (!context.available) continue
        gateRef.current = false
        return evaluate({ online: true })
      }
    } finally {
      gateRef.current = false
    }
  }, [dialogs, vendor])

  const evaluate = React.useCallback(async ({ online = true, block = true } = {}) => {
    if (skipped || checking.current) return
    checking.current = true
    try {
      const context = resolveOpenbayesContext(process.env, vendor)
      if (!context.available) {
        if (block) await blockMissingSkill()
        return
      }
      const { identity, error } = await readIdentityOnce(vendor)
      const kind = identity === undefined ? classifyFailure(error) : undefined
      if (identity === undefined && kind !== 'not-logged-in' && kind !== 'rejected') {
        // An unreadable identity is treated as "not signed in" only when the
        // skill itself said so; otherwise keep the gate closed with a reason.
        if (block) await blockUntilSignedIn({ state: 'rejected' })
        return
      }
      if (identity === undefined) {
        if (readSkipRecord()?.skipped === true) {
          setNotice(unauthenticatedText(lang()))
          return
        }
        if (block) await blockUntilSignedIn({ state: kind === 'rejected' ? 'rejected' : 'missing' })
        return
      }
      const session = classifySession(identity)
      const skipRecord = readSkipRecord()
      const decision = startupDecision(identity, skipRecord)
      if (decision === 'enter-unauthenticated') {
        setNotice(unauthenticatedText(lang()))
        return
      }
      if (decision === 'gate') {
        if (block) return blockUntilSignedIn({ state: session.state === 'expired' ? 'expired' : 'missing', expiresAt: session.expiresAt })
        if (!expiredNotified.current) {
          expiredNotified.current = true
          notify(expiredDuringUseText(lang()))
        }
        return
      }
      setNotice(undefined)
      if (session.state === 'expiring' && !expiringNotified.current) {
        expiringNotified.current = true
        notify(expiringNoticeText(session.days, lang()))
      }
      if (online) {
        void verifyOnline(vendor).then(result => {
          if (result.ok === true) return
          const message = onlineNoticeText(result.kind, lang())
          if (message !== undefined && !onlineNotified.current) {
            onlineNotified.current = true
            notify(message)
          }
        })
      }
    } finally {
      checking.current = false
    }
  }, [blockMissingSkill, blockUntilSignedIn, notify, skipped, vendor])

  React.useEffect(() => {
    if (skipped) return undefined
    const timer = setTimeout(() => { void evaluate({ online: true }) }, 0)
    const poll = setInterval(() => { void evaluate({ online: false, block: false }) }, EXPIRY_POLL_MS)
    return () => { clearTimeout(timer); clearInterval(poll) }
  }, [evaluate, skipped])

  const requireLogin = React.useCallback(async () => {
    if (skipped) return
    // A scheduled expiry poll may be in flight; wait for it so the logout
    // check is never skipped by the `checking` guard.
    const deadline = Date.now() + 2_000
    while (checking.current && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    await evaluate({ online: true, block: true })
  }, [evaluate, skipped])

  return { notice, blocked, requireLogin, skipped }
}

/**
 * `/openbayes` command bridge: login / status / logout and the local help copy.
 * @param {{ channel: any, dialogs: any, vendor?: any, onLoggedOut?: () => void }} options
 */
export function useOpenbayes({ channel, dialogs, vendor = VENDORS.openbayes, onLoggedOut = () => {} }) {
  const notify = React.useCallback(message => {
    try { channel.notify(message, { color: 'warning', timeoutMs: 10_000 }) } catch { /* best-effort */ }
  }, [channel])

  const showInfo = React.useCallback(async (title, message) => {
    try {
      await dialogs.ask({
        kind: 'confirm',
        title,
        message,
        confirmLabel: lang() === 'zh' ? '确定' : 'OK',
        cancelLabel: lang() === 'zh' ? '关闭' : 'Close',
      }, undefined, DIALOG_TIMEOUT_MS)
    } catch {
      notify(message)
    }
  }, [dialogs, notify])

  const login = React.useCallback(async () => {
    await runLoginFlow({ dialogs, vendor, notify })
  }, [dialogs, notify, vendor])

  const status = React.useCallback(async () => {
    const context = resolveOpenbayesContext(process.env, vendor)
    if (!context.available) {
      await showInfo(heading(vendor), missingSkillText(vendor, lang()))
      return
    }
    const { identity, error } = await readIdentityOnce(vendor)
    if (identity !== undefined) {
      const session = classifySession(identity)
      const base = statusText(identity, lang())
      const text = session.state === 'expiring'
        ? `${base}\n${lang() === 'zh' ? '即将到期' : 'expiring soon'}`
        : base
      await showInfo(heading(vendor, lang() === 'zh' ? ' 状态' : ' status'), text)
      return
    }
    const kind = classifyFailure(error)
    if (kind === 'not-logged-in') {
      const text = readSkipRecord() === undefined ? statusText(undefined, lang()) : skippedStatusText(lang())
      await showInfo(heading(vendor, lang() === 'zh' ? ' 状态' : ' status'), text)
      return
    }
    await showInfo(heading(vendor, lang() === 'zh' ? ' 状态' : ' status'), errorText(kind, firstDiagnostic(error), lang()))
  }, [showInfo, vendor])

  const logout = React.useCallback(async () => {
    const context = resolveOpenbayesContext(process.env, vendor)
    if (!context.available) {
      await showInfo(heading(vendor), missingSkillText(vendor, lang()))
      return
    }
    const confirmed = await dialogs.ask({
      kind: 'confirm',
      title: lang() === 'zh' ? '退出 OpenBayes 登录？' : 'Sign out of OpenBayes?',
      message: logoutConfirmText(lang()),
      confirmLabel: lang() === 'zh' ? '退出登录' : 'Sign out',
      cancelLabel: lang() === 'zh' ? '取消' : 'Cancel',
    }, undefined, DIALOG_TIMEOUT_MS)
    if (confirmed !== true) return
    const result = await run(context, ['--logout', '--vendor', vendor.name], LOGOUT_TIMEOUT_MS)
    if (result.code !== 0) {
      await showInfo(heading(vendor, lang() === 'zh' ? ' 退出' : ' sign-out'),
        errorText(classifyFailure(result), firstDiagnostic(result), lang()))
      return
    }
    notify(logoutDoneText(vendor, hostname(), lang()))
    onLoggedOut()
  }, [dialogs, notify, onLoggedOut, showInfo, vendor])

  const help = React.useCallback(async () => {
    await showInfo(heading(vendor), usageText(lang()))
  }, [showInfo, vendor])

  return { login, status, logout, help }
}
