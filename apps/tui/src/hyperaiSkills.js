/**
 * HyperAI skills updater bridge for the TUI.
 *
 * The TUI owns presentation and user choice; the profile's
 * `scripts/skills-update.mjs` owns remote scanning, SHA pinning, download,
 * install, backups and rollback. This module only:
 *
 * - runs the profile CLI asynchronously (never in the first-frame path),
 * - shows a non-blocking inline notice + the existing notification toast,
 * - opens the existing managed dialog for install / details / later,
 * - calls `update --yes` only after the person confirmed in that dialog, and
 * - pins the install to the exact SHA shown by check.
 *
 * It is copied into the patched dsh-tui package by
 * `apps/tui/scripts/build-patch.mjs`; no upstream dependency is added.
 */
import React from 'react'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getLang } from './i18n.js'
import { resolveDshProfileName } from './update.js'
import {
  choices, confirmMessage, currentText, detailOptions, dialogTitle, errorText, fingerprint,
  itemLine, laterText, normalizeCheck, noticeText, resultText,
} from './hyperaiSkillsCore.js'

const AUTO_DELAY_MS = 1500
const CHECK_TIMEOUT_MS = 45_000
const INSTALL_TIMEOUT_MS = 180_000

/** Current UI language (`zh` / `en`). Resolved at call time, so `/lang` works. */
function lang() {
  return getLang() === 'zh' ? 'zh' : 'en'
}

/** Locate the installed updater for this profile; undefined when unavailable. */
export function resolveUpdaterContext(env = process.env, argv = process.argv) {
  let profile = resolveDshProfileName(argv)
  profile ??= env.DSH_TUI_PROFILE
  profile ??= 'hyperai'
  const dshHome = env.DSH_HOME || join(homedir(), '.dsh')
  const script = join(dshHome, 'profiles', profile, 'scripts', 'skills-update.mjs')
  return {
    profile,
    dshHome,
    script,
    available: profile === 'hyperai' && existsSync(script),
    // Test-only injection: never persisted and never used by default launches.
    testRef: env.HYPERAI_SKILLS_TUI_REF || undefined,
    testSource: env.HYPERAI_SKILLS_TUI_SOURCE || undefined,
    disabled: env.HYPERAI_SKILLS_TUI_DISABLE === '1' || env.HYPERAI_SKILLS_TUI_AUTO === '0',
  }
}

/** Run the profile CLI and collect a bounded stdout/stderr. */
function runUpdater(context, args, timeoutMs) {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(process.execPath, [context.script, ...args], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => {
      if (stdout.length < 2_000_000) stdout += chunk
    })
    child.stderr?.on('data', chunk => {
      if (stderr.length < 200_000) stderr += chunk
    })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error instanceof Error ? error.message : String(error)}`, timedOut })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr, timedOut })
    })
  })
}

/** Parse the CLI's single JSON document, tolerating a leading warning line. */
function parseJson(text) {
  const trimmed = text.trim()
  if (trimmed === '') throw new Error('empty response')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.lastIndexOf('\n{')
    if (start >= 0) return JSON.parse(trimmed.slice(start + 1))
    throw new Error('response was not JSON')
  }
}

/** Run check through the profile CLI. `resolvedRef` pins a re-check. */
async function check(context, { manual, resolvedRef } = {}) {
  const args = ['check', '--json', manual ? '--manual' : '--auto', '--dsh-home', context.dshHome, '--profile', context.profile, '--timeout', '30000']
  if (resolvedRef !== undefined) args.push('--ref', resolvedRef)
  else if (context.testRef !== undefined) args.push('--ref', context.testRef)
  if (context.testSource !== undefined) args.push('--source', context.testSource)
  const result = await runUpdater(context, args, CHECK_TIMEOUT_MS)
  if (result.timedOut) throw new Error('check timed out')
  if (result.code !== 0 && result.code !== 2) throw new Error(result.stderr.trim() || `check exited ${result.code}`)
  return normalizeCheck(parseJson(result.stdout))
}

/** Remember a dismissed batch in the profile state (not the TUI state dir). */
async function dismiss(context, checked) {
  if (checked.resolvedRef === '') return
  const args = ['dismiss', '--json', '--ref', checked.resolvedRef, '--dsh-home', context.dshHome, '--profile', context.profile]
  for (const item of checked.updates) args.push('--skill', item.name)
  const result = await runUpdater(context, args, 15_000)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `dismiss exited ${result.code}`)
}

/** Install exactly the checked SHA; never resolves a branch again. */
async function install(context, checked) {
  if (!/^[0-9a-f]{40}$/u.test(checked.resolvedRef)) throw new Error('the update check did not return a pinned commit SHA')
  const args = ['update', '--json', '--yes', '--ref', checked.resolvedRef, '--dsh-home', context.dshHome, '--profile', context.profile, '--timeout', '30000']
  if (context.testSource !== undefined) args.push('--source', context.testSource)
  const result = await runUpdater(context, args, INSTALL_TIMEOUT_MS)
  if (result.timedOut) throw new Error('install timed out')
  if (result.code !== 0) throw new Error(result.stderr.trim() || `update exited ${result.code}`)
  return parseJson(result.stdout)
}

/**
 * React hook used by the chat screen.
 * @param {{channel: object, dialogs: {ask: Function}}} input
 */
export function useSkillsUpdate({ channel, dialogs }) {
  const contextRef = React.useRef(undefined)
  if (contextRef.current === undefined) contextRef.current = resolveUpdaterContext()
  const context = contextRef.current
  const [notice, setNotice] = React.useState(null)
  const notifiedRef = React.useRef(null)
  const busyRef = React.useRef(false)
  const aliveRef = React.useRef(true)
  React.useEffect(() => () => { aliveRef.current = false }, [])

  const notify = React.useCallback((text, options) => {
    try {
      channel.notify(text, options)
    } catch { /* the notification surface is best-effort */ }
  }, [channel])

  const present = React.useCallback(async checked => {
    let current = checked
    while (aliveRef.current) {
      const choice = await dialogs.ask({
        kind: 'select',
        title: dialogTitle(current, lang()),
        options: choices(current, lang()),
      }, undefined, 120_000)
      if (choice === undefined || choice === 'later') {
        if (choice === 'later') {
          try { await dismiss(context, current) } catch { /* session hint still suppresses */ }
          notifiedRef.current = fingerprint(current)
          setNotice(null)
          notify(laterText(lang()), { timeoutMs: 4000 })
        }
        return
      }
      if (choice === 'details') {
        let detail = 'details'
        while (detail === 'details' && aliveRef.current) {
          const picked = await dialogs.ask({
            kind: 'select',
            title: lang() === 'zh' ? 'HyperAI Skills 更新详情' : 'HyperAI Skills update details',
            options: detailOptions(current, lang()),
          }, undefined, 120_000)
          if (picked === 'back') detail = 'back'
          else if (picked === undefined) return
        }
        continue
      }
      if (choice === 'install') {
        const confirmed = await dialogs.ask({
          kind: 'confirm',
          title: lang() === 'zh' ? '确认安装 HyperAI Skills？' : 'Install HyperAI Skills?',
          message: confirmMessage(current, lang()),
          confirmLabel: lang() === 'zh' ? '安装' : 'Install',
          cancelLabel: lang() === 'zh' ? '取消' : 'Cancel',
        }, undefined, 120_000)
        if (confirmed !== true) continue
        // Re-check the exact pinned SHA: a changed plan must be shown and
        // confirmed again, never installed silently.
        notify(lang() === 'zh' ? '正在安装 HyperAI Skills…' : 'Installing HyperAI Skills…', { timeoutMs: 4000 })
        try {
          const fresh = await check(context, { manual: true, resolvedRef: current.resolvedRef })
          if (!fresh.changes) {
            setNotice(null)
            notify(currentText(lang()), { color: 'success' })
            return
          }
          if (fingerprint(fresh) !== fingerprint(current)) {
            setNotice(noticeText(fresh, lang()))
            notify(lang() === 'zh' ? '更新计划已变化，请重新确认' : 'The update plan changed; please confirm again', { color: 'warning', timeoutMs: 6000 })
            current = fresh
            continue
          }
          const result = await install(context, current)
          setNotice(null)
          notifiedRef.current = null
          const failed = Array.isArray(result.failed) && result.failed.length > 0
          notify(resultText(result, lang()), { color: failed ? 'error' : 'success', timeoutMs: failed ? 10_000 : 5000 })
          return
        } catch (error) {
          notify(errorText(error, lang()), { color: 'error', timeoutMs: 10_000 })
          return
        }
      }
    }
  }, [context, dialogs, notify])

  const open = React.useCallback(async () => {
    if (!context.available) {
      notify(lang() === 'zh' ? '此 Profile 未安装 HyperAI Skills 更新器' : 'This profile has no HyperAI Skills updater installed', { color: 'warning' })
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    try {
      notify(lang() === 'zh' ? '正在检查 HyperAI Skills…' : 'Checking HyperAI Skills…', { timeoutMs: 2500 })
      const checked = await check(context, { manual: true })
      if (!checked.changes) {
        setNotice(null)
        notify(currentText(lang()), { color: 'success' })
        return
      }
      setNotice(noticeText(checked, lang()))
      await present(checked)
    } catch (error) {
      notify(errorText(error, lang()), { color: 'error', timeoutMs: 10_000 })
    } finally {
      busyRef.current = false
    }
  }, [context, notify, present])

  React.useEffect(() => {
    if (!context.available || context.disabled) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      void check(context, { manual: false }).then(checked => {
        if (cancelled || !checked.changes || checked.dismissed || checked.skipped) return
        const key = fingerprint(checked)
        if (notifiedRef.current === key) return
        notifiedRef.current = key
        setNotice(noticeText(checked, lang()))
        notify(noticeText(checked, lang()), { timeoutMs: 12_000 })
      }).catch(() => { /* automatic checks fail silently; chat stays usable */ })
    }, AUTO_DELAY_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [context, notify])

  return { notice, open }
}
