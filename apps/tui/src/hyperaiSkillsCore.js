/**
 * Pure formatting/validation for the HyperAI skills-update TUI bridge.
 *
 * Kept dependency-free (no React, no child_process) so the prompt copy, the
 * plan fingerprint and the SHA-pinning comparison can be unit-tested offline.
 * `hyperaiSkills.js` is the thin React/spawn layer on top.
 */

/** Normalize the compact `skills-update check --json` payload. */
export function normalizeCheck(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('skills-update returned no object')
  const source = raw.source !== null && typeof raw.source === 'object' ? raw.source : {}
  const updates = Array.isArray(raw.updates)
    ? raw.updates
      .filter(item => item !== null && typeof item === 'object' && typeof item.name === 'string')
      .map(item => ({
        name: item.name,
        action: item.action === 'update' ? 'update' : 'add',
        version: typeof item.version === 'string' ? item.version : undefined,
        description: typeof item.description === 'string' ? item.description : undefined,
        files: typeof item.files === 'number' ? item.files : 0,
        bytes: typeof item.bytes === 'number' ? item.bytes : 0,
        digest: typeof item.digest === 'string' ? item.digest : '',
      }))
    : []
  return {
    resolvedRef: typeof source.resolvedRef === 'string' ? source.resolvedRef : '',
    requestedRef: typeof source.requestedRef === 'string' ? source.requestedRef : 'master',
    channel: source.channel === 'stable' ? 'stable' : 'prerelease',
    changes: raw.changes === true || updates.length > 0,
    count: updates.length,
    updates,
    dismissed: raw.dismissed === true,
    skipped: raw.skipped === true,
    skippedReason: typeof raw.skippedReason === 'string' ? raw.skippedReason : undefined,
  }
}

/** Stable identity of one checked batch: the SHA plus the shown content. */
export function fingerprint(check) {
  const normalized = normalizeCheck(check)
  const items = normalized.updates
    .map(item => `${item.action}:${item.name}:${item.digest}`)
    .sort()
    .join('|')
  return `${normalized.resolvedRef}|${items}`
}

/** Localized one-line summary shown in the transcript hint and notification. */
export function noticeText(check, lang = 'zh') {
  const { count, resolvedRef } = normalizeCheck(check)
  const suffix = resolvedRef === '' ? '' : ` · ${resolvedRef.slice(0, 8)}`
  return lang === 'zh'
    ? `HyperAI Skills 有 ${count} 项可安装更新 · 输入 /skills-update${suffix}`
    : `HyperAI Skills: ${count} update${count === 1 ? '' : 's'} available · run /skills-update${suffix}`
}

/** Per-item one-line label, e.g. `+ ppt-generation 新增 · v1.1.0`. */
export function itemLine(item, lang = 'zh') {
  const action = item.action === 'update' ? (lang === 'zh' ? '更新' : 'update') : (lang === 'zh' ? '新增' : 'new')
  const version = item.version === undefined ? '' : ` · v${item.version}`
  const mark = item.action === 'update' ? '↑' : '+'
  return `${mark} ${item.name}  ${action}${version}`
}

/** Dialog title for the plan. */
export function dialogTitle(check, lang = 'zh') {
  const { count } = normalizeCheck(check)
  return lang === 'zh' ? `HyperAI Skills · ${count} 项可安装` : `HyperAI Skills · ${count} available`
}

/** Top-level dialog choices. */
export function choices(check, lang = 'zh') {
  const { count, updates } = normalizeCheck(check)
  const names = updates.map(item => item.name).join(', ')
  return [
    { id: 'install', label: lang === 'zh' ? `安装更新（${count} 项）` : `Install updates (${count})`, description: names },
    { id: 'details', label: lang === 'zh' ? '查看详情' : 'View details' },
    { id: 'later', label: lang === 'zh' ? '稍后再说' : 'Later' },
  ]
}

/** Detail rows; `back` returns to the choices dialog. */
export function detailOptions(check, lang = 'zh') {
  const { updates } = normalizeCheck(check)
  return [
    ...updates.map(item => ({
      id: `item:${item.name}`,
      label: itemLine(item, lang),
      description: item.description ?? `${item.files} files · ${item.bytes} B`,
    })),
    { id: 'back', label: lang === 'zh' ? '返回' : 'Back' },
  ]
}

/** Message inside the final install confirmation. */
export function confirmMessage(check, lang = 'zh') {
  const { updates } = normalizeCheck(check)
  const rows = updates.map(item => itemLine(item, lang)).join('\n')
  return lang === 'zh'
    ? `\n${rows}\n\n将下载并安装这些 Skill；安装前会备份旧版本。`
    : `\n${rows}\n\nThese skills will be downloaded and installed; old versions are backed up first.`
}

/** Text after a successful install/update. */
export function resultText(result, lang = 'zh') {
  const installed = Array.isArray(result?.installed) ? result.installed : []
  const updated = Array.isArray(result?.updated) ? result.updated : []
  const failed = Array.isArray(result?.failed) ? result.failed : []
  const parts = []
  if (installed.length > 0) parts.push(lang === 'zh' ? `已安装 ${installed.join(', ')}` : `Installed ${installed.join(', ')}`)
  if (updated.length > 0) parts.push(lang === 'zh' ? `已更新 ${updated.join(', ')}` : `Updated ${updated.join(', ')}`)
  if (failed.length > 0) parts.push(lang === 'zh' ? `失败：${failed.map(item => item.name).join(', ')}` : `Failed: ${failed.map(item => item.name).join(', ')}`)
  return parts.join(lang === 'zh' ? '；' : '; ') || (lang === 'zh' ? '安装完成' : 'Update finished')
}

/** Short, user-facing error line (never a stack trace or a token). */
export function errorText(error, lang = 'zh') {
  const detail = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)
  const cleaned = detail.replace(/\s+/gu, ' ').trim().slice(0, 180)
  return lang === 'zh' ? `HyperAI Skills 检查失败：${cleaned}` : `HyperAI Skills check failed: ${cleaned}`
}

/** Text for a dismissed batch. */
export function laterText(lang = 'zh') {
  return lang === 'zh' ? '已稍后再说；本会话不再提示这批更新' : 'Later; this batch will not be shown again this session'
}

/** Text while a manual check is running (kept visible, not a 2.5s toast). */
export function checkingText(lang = 'zh') {
  return lang === 'zh' ? '正在检查 HyperAI Skills…' : 'Checking HyperAI Skills…'
}

/** Title for a manual-check failure dialog. */
export function errorTitle(lang = 'zh') {
  return lang === 'zh' ? 'HyperAI Skills 检查失败' : 'HyperAI Skills check failed'
}

/** Text after a manual check with no pending updates. */
export function currentText(lang = 'zh') {
  return lang === 'zh' ? 'HyperAI Skills 已是最新' : 'HyperAI Skills is up to date'
}
